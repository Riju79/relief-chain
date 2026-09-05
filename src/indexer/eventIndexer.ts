import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bcs } from '@mysten/sui/bcs';
import suiClient from '../config/suiClient.js';

const CampaignBcs = bcs.struct('Campaign', {
  id: bcs.Address,
  title: bcs.string(),
  description: bcs.string(),
  location: bcs.string(),
  severity: bcs.u8(),
  goal: bcs.u64(),
  funds_raised: bcs.u64(),
  total_released: bcs.u64(),
  treasury: bcs.u64(),
  creator: bcs.Address,
  status: bcs.u8(),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SuiEventRecord {
  id: string; // `${txDigest}:${eventSeq}`
  type: string;
  packageId: string;
  transactionDigest: string;
  eventSeq: string;
  timestamp: number;
  parsedJson: Record<string, any>;
}

export interface CampaignProjection {
  campaignId: string;
  title: string;
  creator: string;
  goal: number;
  fundsRaised: number;
  totalReleased: number;
  status: number;
  milestones: any[];
  evidenceRecords: any[];
  donations: any[];
  isVerifiedOnChain: boolean;
  lastUpdated: number;
}

export class SuiEventIndexer {
  private dbPath: string;
  private processedEventIds: Set<string>;
  private projections: Map<string, CampaignProjection>;
  private lastCursor: string | null;

  constructor(customDbPath?: string) {
    this.dbPath = customDbPath || path.join(__dirname, '../../indexer_db.json');
    this.processedEventIds = new Set();
    this.projections = new Map();
    this.lastCursor = null;
    this.loadState();
  }

  /**
   * Load state from disk indexer database
   */
  private loadState(): void {
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const data = JSON.parse(raw);
        if (data.processedEventIds) {
          this.processedEventIds = new Set(data.processedEventIds);
        }
        if (data.projections) {
          Object.entries(data.projections).forEach(([id, proj]) => {
            this.projections.set(id, proj as CampaignProjection);
          });
        }
        this.lastCursor = data.lastCursor || null;
      } catch (e) {
        console.warn('[Indexer] Failed to parse database state. Initializing clean indexer state.', e);
      }
    }
  }

  /**
   * Save indexer state to disk database
   */
  public saveState(): void {
    const projectionsObj: Record<string, CampaignProjection> = {};
    this.projections.forEach((v, k) => {
      projectionsObj[k] = v;
    });

    const payload = {
      lastCursor: this.lastCursor,
      processedEventCount: this.processedEventIds.size,
      processedEventIds: Array.from(this.processedEventIds),
      projections: projectionsObj,
      lastSavedAt: Date.now()
    };

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(this.dbPath, JSON.stringify(payload, null, 2));
  }

  /**
   * Process a Sui Event with Idempotent Deduplication Guarantee.
   * If event was already processed (same txDigest + eventSeq), skips processing.
   * 
   * @param event - Raw or structured Sui Event
   * @returns boolean - True if newly processed, False if duplicate skipped
   */
  public processEvent(event: SuiEventRecord): boolean {
    const eventId = event.id || `${event.transactionDigest}:${event.eventSeq}`;

    // 1. Idempotency Check (Deduplication)
    if (this.processedEventIds.has(eventId)) {
      console.log(`[Indexer Deduplication] Event ${eventId} already processed. Skipping.`);
      return false;
    }

    const { type, parsedJson } = event;
    const shortType = type.split('::').pop() || type;

    console.log(`[Indexer Processing] New Event ${eventId} (${shortType})`);

    // 2. Route event type to Projection Reducer
    switch (shortType) {
      case 'CampaignCreated': {
        const { campaign_id, title, creator, goal } = parsedJson;
        this.projections.set(campaign_id, {
          campaignId: campaign_id,
          title: title || 'Untitled Campaign',
          creator: creator || '0x0',
          goal: Number(goal || 0),
          fundsRaised: 0,
          totalReleased: 0,
          status: 0, // STATUS_SUBMITTED
          milestones: [],
          evidenceRecords: [],
          donations: [],
          isVerifiedOnChain: false,
          lastUpdated: Date.now()
        });
        break;
      }

      case 'CampaignVerified': {
        const { campaign_id } = parsedJson;
        const proj = this.projections.get(campaign_id);
        if (proj) {
          proj.status = 1; // STATUS_VERIFIED
          proj.isVerifiedOnChain = true;
          proj.lastUpdated = Date.now();
        }
        break;
      }

      case 'DonationReceived': {
        const { campaign_id, donor, amount, funds_raised } = parsedJson;
        const proj = this.projections.get(campaign_id);
        if (proj) {
          proj.fundsRaised = Number(funds_raised || (proj.fundsRaised + Number(amount)));
          if (proj.fundsRaised >= proj.goal && proj.status === 1) {
            proj.status = 2; // STATUS_FUNDED
          }
          proj.donations.push({
            donor,
            amount: Number(amount),
            timestamp: Date.now(),
            txDigest: event.transactionDigest
          });
          proj.lastUpdated = Date.now();
        }
        break;
      }

      case 'MilestoneCreated': {
        const { campaign_id, milestone_index, allocation, beneficiary } = parsedJson;
        const proj = this.projections.get(campaign_id);
        if (proj) {
          proj.milestones.push({
            index: Number(milestone_index),
            allocation: Number(allocation),
            releasedAmount: 0,
            status: 0, // PENDING
            beneficiary
          });
          proj.lastUpdated = Date.now();
        }
        break;
      }

      case 'EvidenceAttached': {
        const { campaign_id, evidence_id, walrus_blob_id, content_hash, mime_type, uploader } = parsedJson;
        const proj = this.projections.get(campaign_id);
        if (proj) {
          proj.evidenceRecords.push({
            evidenceId: evidence_id,
            walrusBlobId: walrus_blob_id,
            contentHash: content_hash,
            mimeType: mime_type,
            uploader,
            timestamp: Date.now()
          });
          proj.lastUpdated = Date.now();
        }
        break;
      }

      case 'MilestoneApproved': {
        const { campaign_id, milestone_index } = parsedJson;
        const proj = this.projections.get(campaign_id);
        if (proj && proj.milestones[Number(milestone_index)]) {
          proj.milestones[Number(milestone_index)].status = 2; // APPROVED
          proj.lastUpdated = Date.now();
        }
        break;
      }

      case 'FundsReleased': {
        const { campaign_id, milestone_index, amount, beneficiary } = parsedJson;
        const proj = this.projections.get(campaign_id);
        if (proj) {
          const amt = Number(amount);
          proj.totalReleased += amt;
          const m = proj.milestones[Number(milestone_index)];
          if (m) {
            m.releasedAmount = (m.releasedAmount || 0) + amt;
            if (m.releasedAmount >= m.allocation) {
              m.status = 3; // RELEASED
            }
          }
          proj.lastUpdated = Date.now();
        }
        break;
      }

      case 'CampaignCompleted': {
        const { campaign_id } = parsedJson;
        const proj = this.projections.get(campaign_id);
        if (proj) {
          proj.status = 3; // COMPLETED
          proj.lastUpdated = Date.now();
        }
        break;
      }

      case 'CampaignCancelled': {
        const { campaign_id } = parsedJson;
        const proj = this.projections.get(campaign_id);
        if (proj) {
          proj.status = 4; // CANCELLED
          proj.lastUpdated = Date.now();
        }
        break;
      }

      default:
        console.warn(`[Indexer] Unhandled event type: ${type}`);
    }

    // Mark event ID as processed & advance cursor
    this.processedEventIds.add(eventId);
    this.lastCursor = eventId;
    this.saveState();
    return true;
  }

  /**
   * Reconcile indexed projection with authoritative Sui RPC on-chain state.
   * On-chain state ALWAYS overrides indexed projections.
   * 
   * @param campaignId - The Sui object ID of the campaign
   */
  public async reconcileWithSui(campaignId: string): Promise<CampaignProjection | null> {
    console.log(`[Reconciler] Reconciling indexed projection for ${campaignId} against Sui RPC...`);
    try {
      const obj = await suiClient.getObject({
        objectId: campaignId,
        include: { content: true }
      });

      let fields: any = null;
      const rawContent = (obj as any)?.object?.content;
      if (rawContent) {
        const raw = rawContent as any;
        const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(Object.values(raw));
        fields = CampaignBcs.parse(bytes);
      } else if ((obj as any)?.object?.json?.fields) {
        fields = (obj as any).object.json.fields;
      }

      if (fields) {
        const onChainProjection: CampaignProjection = {
          campaignId,
          title: fields.title || '',
          creator: fields.creator || '',
          goal: Number(fields.goal || 0),
          fundsRaised: Number(fields.funds_raised || 0),
          totalReleased: Number(fields.total_released || 0),
          status: Number(fields.status || 0),
          milestones: fields.milestones || [],
          evidenceRecords: fields.evidence_records || [],
          donations: this.projections.get(campaignId)?.donations || [],
          isVerifiedOnChain: Number(fields.status) >= 1,
          lastUpdated: Date.now()
        };

        // Overwrite projection with authoritative on-chain state
        this.projections.set(campaignId, onChainProjection);
        this.saveState();
        console.log(`[Reconciler SUCCESS] Reconciled ${campaignId} with on-chain Sui truth: status=${onChainProjection.status}, fundsRaised=${onChainProjection.fundsRaised}`);
        return onChainProjection;
      }
    } catch (e: any) {
      console.warn(`[Reconciler Warning] Could not fetch object ${campaignId} from Sui RPC: ${e.message}`);
    }
    return this.projections.get(campaignId) || null;
  }

  /**
   * Periodically reconcile all active campaign projections against authoritative Sui RPC state.
   */
  public async reconcileAllProjections(): Promise<CampaignProjection[]> {
    console.log(`[Reconciler Periodic] Reconciling all ${this.projections.size} active campaign projections...`);
    const results: CampaignProjection[] = [];
    for (const campaignId of Array.from(this.projections.keys())) {
      const reconciled = await this.reconcileWithSui(campaignId);
      if (reconciled) results.push(reconciled);
    }
    return results;
  }

  public getLastCursor(): string | null {
    return this.lastCursor;
  }

  public getProjection(campaignId: string): CampaignProjection | undefined {
    return this.projections.get(campaignId);
  }

  public getAllProjections(): CampaignProjection[] {
    return Array.from(this.projections.values());
  }

  public getProcessedCount(): number {
    return this.processedEventIds.size;
  }

  public isEventProcessed(eventId: string): boolean {
    return this.processedEventIds.has(eventId);
  }
}
