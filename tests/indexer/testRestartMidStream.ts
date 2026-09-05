import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { SuiEventIndexer, SuiEventRecord } from '../../src/indexer/eventIndexer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.join(__dirname, '../../test_midstream_indexer_db.json');

async function runMidStreamRestartTest() {
  console.log('====================================================');
  console.log('🧪 RUNNING SUI EVENT INDEXER MID-STREAM RESTART & IDEMPOTENCY TEST');
  console.log('====================================================\n');

  // Clean test DB if exists
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  const campaignId = '0x11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
  const txDigest = '8Kj3mN5vQ7xZ9pW2mV1nU3tR4sQ5P6oN7mL8kJ9iH0gF';

  const fullEventStream: SuiEventRecord[] = [
    {
      id: `${txDigest}:0`,
      type: '0x9c0e::relief_chain::CampaignCreated',
      packageId: '0x9c0e',
      transactionDigest: txDigest,
      eventSeq: '0',
      timestamp: Date.now(),
      parsedJson: {
        campaign_id: campaignId,
        title: 'Midstream Test Flood Relief',
        creator: '0xb08cc125ff07d8df0b47eb8a59b8caf473de1b78000f736f8739bea0a1d2ecb3',
        goal: '50000000000'
      }
    },
    {
      id: `${txDigest}:1`,
      type: '0x9c0e::relief_chain::CampaignVerified',
      packageId: '0x9c0e',
      transactionDigest: txDigest,
      eventSeq: '1',
      timestamp: Date.now(),
      parsedJson: {
        campaign_id: campaignId,
        verifier: '0xb08cc125ff07d8df0b47eb8a59b8caf473de1b78000f736f8739bea0a1d2ecb3'
      }
    },
    {
      id: `${txDigest}:2`,
      type: '0x9c0e::relief_chain::MilestoneCreated',
      packageId: '0x9c0e',
      transactionDigest: txDigest,
      eventSeq: '2',
      timestamp: Date.now(),
      parsedJson: {
        campaign_id: campaignId,
        milestone_index: 0,
        allocation: '25000000000',
        beneficiary: '0xbeneficiary1111'
      }
    },
    {
      id: `${txDigest}:3`,
      type: '0x9c0e::relief_chain::DonationReceived',
      packageId: '0x9c0e',
      transactionDigest: txDigest,
      eventSeq: '3',
      timestamp: Date.now(),
      parsedJson: {
        campaign_id: campaignId,
        donor: '0xdonor2222',
        amount: '10000000000',
        funds_raised: '10000000000'
      }
    },
    {
      id: `${txDigest}:4`,
      type: '0x9c0e::relief_chain::EvidenceAttached',
      packageId: '0x9c0e',
      transactionDigest: txDigest,
      eventSeq: '4',
      timestamp: Date.now(),
      parsedJson: {
        campaign_id: campaignId,
        evidence_id: 'EVID-MIDSTREAM-001',
        walrus_blob_id: 'walrus_blob_midstream_clean_water',
        content_hash: '3a7b9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
        mime_type: 'image/jpeg',
        uploader: '0xb08cc125ff07d8df0b47eb8a59b8caf473de1b78000f736f8739bea0a1d2ecb3'
      }
    }
  ];

  // ---------------------------------------------------------------
  // Phase A: Process events 0 and 1, then simulate crash mid-stream
  // ---------------------------------------------------------------
  console.log('--- Phase A: Processing First 2 Events Before Simulated Crash ---');
  let indexerA: SuiEventIndexer | null = new SuiEventIndexer(TEST_DB_PATH);

  const processed0 = indexerA.processEvent(fullEventStream[0]);
  const processed1 = indexerA.processEvent(fullEventStream[1]);

  if (!processed0 || !processed1) {
    throw new Error('Phase A events were not processed!');
  }

  const cursorBeforeCrash = indexerA.getLastCursor();
  console.log(`Phase A Cursor before crash: ${cursorBeforeCrash}`);
  if (cursorBeforeCrash !== `${txDigest}:1`) {
    throw new Error(`Expected cursor ${txDigest}:1, got ${cursorBeforeCrash}`);
  }

  // Crash indexer A
  console.log('💥 SIMULATING PROCESS CRASH / MID-STREAM ABORT...');
  indexerA = null; // Kill instance

  // ---------------------------------------------------------------
  // Phase B: Boot Indexer B from persisted database & verify cursor
  // ---------------------------------------------------------------
  console.log('\n--- Phase B: Booting Indexer B from Persisted DB ---');
  const indexerB = new SuiEventIndexer(TEST_DB_PATH);
  const resumedCursor = indexerB.getLastCursor();
  console.log(`Resumed Cursor in Indexer B: ${resumedCursor}`);

  if (resumedCursor !== `${txDigest}:1`) {
    throw new Error(`Cursor did not persist! Expected ${txDigest}:1, got ${resumedCursor}`);
  }

  // ---------------------------------------------------------------
  // Phase C: Replay entire stream (testing deduplication and completion)
  // ---------------------------------------------------------------
  console.log('\n--- Phase C: Replaying Entire Event Stream (Events 0..4) ---');
  let duplicateCount = 0;
  let newlyProcessedCount = 0;

  for (const ev of fullEventStream) {
    const isNew = indexerB.processEvent(ev);
    if (isNew) {
      newlyProcessedCount++;
    } else {
      duplicateCount++;
    }
  }

  console.log(`Results: Newly processed = ${newlyProcessedCount}, Duplicates skipped = ${duplicateCount}`);

  if (duplicateCount !== 2) {
    throw new Error(`Expected 2 duplicate events skipped, but skipped ${duplicateCount}`);
  }
  if (newlyProcessedCount !== 3) {
    throw new Error(`Expected 3 new events processed (2, 3, 4), but processed ${newlyProcessedCount}`);
  }
  if (indexerB.getProcessedCount() !== 5) {
    throw new Error(`Expected total processed count 5, got ${indexerB.getProcessedCount()}`);
  }

  // ---------------------------------------------------------------
  // Phase D: Validate Projected State
  // ---------------------------------------------------------------
  console.log('\n--- Phase D: Validate Projected Campaign State ---');
  const projection = indexerB.getProjection(campaignId);
  if (!projection) {
    throw new Error('Projection not found!');
  }

  console.log('Projected State:', {
    title: projection.title,
    status: projection.status,
    fundsRaised: projection.fundsRaised,
    milestones: projection.milestones.length,
    evidenceRecords: projection.evidenceRecords.length
  });

  if (projection.status !== 1) {
    throw new Error(`Expected status 1 (STATUS_VERIFIED), got ${projection.status}`);
  }
  if (projection.fundsRaised !== 10000000000) {
    throw new Error(`Expected fundsRaised 10000000000, got ${projection.fundsRaised}`);
  }
  if (projection.milestones.length !== 1) {
    throw new Error(`Expected 1 milestone, got ${projection.milestones.length}`);
  }
  if (projection.evidenceRecords.length !== 1) {
    throw new Error(`Expected 1 evidence record, got ${projection.evidenceRecords.length}`);
  }
  console.log('✔ All projection assertions passed without data loss or double-counting!');

  // ---------------------------------------------------------------
  // Phase E: Reconcile with Sui RPC (Authoritative on-chain truth)
  // ---------------------------------------------------------------
  console.log('\n--- Phase E: Reconcile with Live Sui RPC Campaign ---');
  const liveCampaignObjectId = '0xbc6d224b09671eb9806eacf818ea558e525443491b0729684d930ab595a78494';
  const reconciled = await indexerB.reconcileWithSui(liveCampaignObjectId);
  if (!reconciled) {
    throw new Error('Reconciliation with live Sui object failed!');
  }

  console.log('Reconciled On-Chain Campaign:', {
    id: reconciled.campaignId,
    title: reconciled.title,
    status: reconciled.status,
    goal: reconciled.goal,
    fundsRaised: reconciled.fundsRaised,
    isVerifiedOnChain: reconciled.isVerifiedOnChain
  });

  if (reconciled.status < 1 || !reconciled.isVerifiedOnChain) {
    throw new Error(`On-chain reconciled status invalid: ${reconciled.status}`);
  }
  console.log('✔ On-chain reconciliation successfully verified authoritative Sui RPC state!');

  console.log('\n====================================================');
  console.log('🎉 SUI EVENT INDEXER MID-STREAM RESTART TEST PASSED!');
  console.log('====================================================\n');

  // Clean test DB
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
}

runMidStreamRestartTest().catch(err => {
  console.error('❌ Mid-stream restart test failed:', err);
  process.exit(1);
});
