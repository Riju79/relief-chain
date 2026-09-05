import { SuiEventIndexer, SuiEventRecord } from '../../src/indexer/eventIndexer.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.join(__dirname, '../../test_indexer_db.json');

async function runIndexerValidationTest() {
  console.log("==================================================");
  console.log("Starting Phase 10 Sui Event Indexer Validation Test");
  console.log("==================================================");

  // Clean test DB if exists
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  // 1. Initialize Indexer Instance #1
  console.log("[Step 1] Initializing Indexer instance #1...");
  let indexer = new SuiEventIndexer(TEST_DB_PATH);

  const sampleCampaignId = "0x9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef";
  const sampleTxDigest = "5xZ7Y8xQ9pW2mV1nU3tR4sQ5P6oN7mL8kJ9iH0gF1eD2";

  // Simulate Sui Events
  const events: SuiEventRecord[] = [
    {
      id: `${sampleTxDigest}:0`,
      type: '0x123::relief_chain::CampaignCreated',
      packageId: '0x123',
      transactionDigest: sampleTxDigest,
      eventSeq: '0',
      timestamp: Date.now(),
      parsedJson: {
        campaign_id: sampleCampaignId,
        title: 'Surma River Basin Emergency Flood Aid',
        creator: '0xabc123',
        goal: '5000000000'
      }
    },
    {
      id: `${sampleTxDigest}:1`,
      type: '0x123::relief_chain::CampaignVerified',
      packageId: '0x123',
      transactionDigest: sampleTxDigest,
      eventSeq: '1',
      timestamp: Date.now(),
      parsedJson: {
        campaign_id: sampleCampaignId,
        verifier: '0xverifier99'
      }
    },
    {
      id: `${sampleTxDigest}:2`,
      type: '0x123::relief_chain::MilestoneCreated',
      packageId: '0x123',
      transactionDigest: sampleTxDigest,
      eventSeq: '2',
      timestamp: Date.now(),
      parsedJson: {
        campaign_id: sampleCampaignId,
        milestone_index: 0,
        allocation: '2500000000',
        beneficiary: '0xbeneficiary88'
      }
    },
    {
      id: `${sampleTxDigest}:3`,
      type: '0x123::relief_chain::DonationReceived',
      packageId: '0x123',
      transactionDigest: sampleTxDigest,
      eventSeq: '3',
      timestamp: Date.now(),
      parsedJson: {
        campaign_id: sampleCampaignId,
        donor: '0xdonor77',
        amount: '1000000000',
        funds_raised: '1000000000'
      }
    },
    {
      id: `${sampleTxDigest}:4`,
      type: '0x123::relief_chain::EvidenceAttached',
      packageId: '0x123',
      transactionDigest: sampleTxDigest,
      eventSeq: '4',
      timestamp: Date.now(),
      parsedJson: {
        campaign_id: sampleCampaignId,
        evidence_id: 'EVID-FLOOD-001',
        walrus_blob_id: 'walrus_blob_surma_water_filters',
        content_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        mime_type: 'image/jpeg',
        uploader: '0xabc123'
      }
    }
  ];

  // 2. Process events into Indexer Instance #1
  console.log("[Step 2] Processing events into Indexer Instance #1...");
  events.forEach(ev => {
    const newlyProcessed = indexer.processEvent(ev);
    if (!newlyProcessed) {
      console.error(`❌ FAILURE: Initial event ${ev.id} was incorrectly flagged as duplicate!`);
      process.exit(1);
    }
  });

  const proj1 = indexer.getProjection(sampleCampaignId);
  console.log(`[Step 2 SUCCESS] Projected Campaign State:`, {
    title: proj1?.title,
    fundsRaised: proj1?.fundsRaised,
    isVerifiedOnChain: proj1?.isVerifiedOnChain,
    milestoneCount: proj1?.milestones.length,
    evidenceCount: proj1?.evidenceRecords.length
  });

  if (!proj1 || proj1.fundsRaised !== 1000000000 || !proj1.isVerifiedOnChain || proj1.evidenceRecords.length !== 1) {
    console.error(`❌ FAILURE: Projected campaign state does not match expected event sequence!`);
    process.exit(1);
  }

  // 3. Restart Indexer (simulate crash / restart by initializing Indexer Instance #2 with same DB)
  console.log("[Step 3] Restarting Indexer (Instance #2 loading persisted database)...");
  let indexerInstance2 = new SuiEventIndexer(TEST_DB_PATH);

  // 4. Re-feed SAME events (Simulating event re-processing / replay / restart)
  console.log("[Step 4] Re-feeding SAME events into Indexer Instance #2 to test Deduplication...");
  let duplicateCount = 0;
  events.forEach(ev => {
    const newlyProcessed = indexerInstance2.processEvent(ev);
    if (!newlyProcessed) {
      duplicateCount++;
    }
  });

  console.log(`[Step 4 SUCCESS] Processed ${events.length} re-sent events. Duplicates correctly skipped: ${duplicateCount}/${events.length}`);

  if (duplicateCount !== events.length) {
    console.error(`❌ DEDUPLICATION FAILURE: Re-fed events were re-processed instead of skipped!`);
    process.exit(1);
  }

  const proj2 = indexerInstance2.getProjection(sampleCampaignId);
  if (proj2?.fundsRaised !== 1000000000 || proj2?.evidenceRecords.length !== 1) {
    console.error(`❌ STATE CORRUPTION: Duplicate processing corrupted projected funds or evidence count!`);
    process.exit(1);
  }

  console.log("==================================================");
  console.log("PHASE 10 INDEXER VALIDATION TEST PASSED SUCCESSFULLY");
  console.log("==================================================");

  // Cleanup test file
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
}

runIndexerValidationTest().catch(err => {
  console.error("Indexer validation test failed:", err);
  process.exit(1);
});
