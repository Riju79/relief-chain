# PHASE 10 REPORT: Reliable Sui Event Indexing & Projection Layer

## Executive Summary

Phase 10 builds a reliable, fault-tolerant event indexing layer (`src/indexer/eventIndexer.ts`) for ReliefChain. The indexer acts as a read-only projection database designed to accelerate searches, dashboards, and timeline tracking.

Crucially, **the indexer database is strictly a projection of on-chain activity and never overrides Sui blockchain truth**. The indexer incorporates idempotent event deduplication, cursor persistence across restarts, and a direct on-chain reconciliation mechanism (`reconcileWithSui`).

---

## 1. Indexing Architecture & Supported Events

The indexer subscribes to or polls structured Move events emitted by the `relief_chain` smart contract package:

```
[ Sui Move Smart Contract ] ──▶ Emits Move Events
                                      │
                                      ▼
                      [ Sui Event Indexer Engine ]
                      - Checks Event ID (txDigest:eventSeq)
                      - Idempotent Deduplication (Skips duplicates)
                      - Reduces state into Campaign Projections
                                      │
                                      ▼
                      [ Read-Only Projection Database ]
                      (Serves fast search, analytics & frontend)
                                      │
                                      ▼
                      [ On-Chain Reconciler ]
                      (reconcileWithSui fetches Sui Object ➔ Overwrites Database)
```

### Indexed Event Types

1. `CampaignCreated`: Initializes a new campaign projection in `STATUS_SUBMITTED` (0).
2. `CampaignVerified`: Updates campaign status to `STATUS_VERIFIED` (1) and marks `isVerifiedOnChain: true`.
3. `DonationReceived`: Increments `fundsRaised`, updates status to `STATUS_FUNDED` (2) if goal is met, appends donation ledger entry.
4. `MilestoneCreated`: Adds milestone allocation and beneficiary mapping.
5. `EvidenceAttached`: Records evidence record (Walrus blob ID, SHA-256 content hash, MIME metadata).
6. `MilestoneApproved`: Updates milestone status to `MILESTONE_STATUS_APPROVED` (2).
7. `FundsReleased`: Increments `totalReleased`, updates milestone `releasedAmount` and status to `MILESTONE_STATUS_RELEASED` (3).
8. `CampaignCompleted`: Updates campaign status to `STATUS_COMPLETED` (3).
9. `CampaignCancelled`: Updates campaign status to `STATUS_CANCELLED` (4).

---

## 2. Reliability & Idempotency Rules

- **Unique Event ID:** Every event is uniquely keyed by `${transactionDigest}:${eventSeq}`.
- **Deduplication Guarantee:** If an event ID has already been recorded in `processedEventIds`, the indexer immediately skips processing. Duplicate processing will never double-count donations or release amounts.
- **Restart Recovery:** Processed event IDs and transaction cursors are persisted to disk (`indexer_db.json`). When the indexer restarts after a crash or shutdown, it resumes without reprocessing past events.
- **On-Chain Reconciliation (`reconcileWithSui`):** If database projection data ever becomes stale or out of sync, `reconcileWithSui(campaignId)` fetches the authoritative `Campaign` object directly from the Sui RPC endpoint (`suiClient.getObject`) and overwrites database fields with on-chain truth.

---

## 3. Validation Test & Simulation Results

A comprehensive validation script (`src/indexer/testIndexer.ts`) was created and executed:

```
Step 1: Initializing Indexer instance #1...
Step 2: Processing 5 events (CampaignCreated ➔ CampaignVerified ➔ MilestoneCreated ➔ DonationReceived ➔ EvidenceAttached)...
[Step 2 SUCCESS] Projected Campaign State: {
  title: 'Surma River Basin Emergency Flood Aid',
  fundsRaised: 1000000000,
  isVerifiedOnChain: true,
  milestoneCount: 1,
  evidenceCount: 1
}
Step 3: Simulating Indexer restart (Instance #2 loading persisted database)...
Step 4: Re-feeding SAME 5 events into Instance #2 to test Deduplication...
[Indexer Deduplication] Event 5xZ7Y8xQ9pW2mV1nU3tR4sQ5P6oN7mL8kJ9iH0gF1eD2:0 already processed. Skipping.
[Indexer Deduplication] Event 5xZ7Y8xQ9pW2mV1nU3tR4sQ5P6oN7mL8kJ9iH0gF1eD2:1 already processed. Skipping.
[Indexer Deduplication] Event 5xZ7Y8xQ9pW2mV1nU3tR4sQ5P6oN7mL8kJ9iH0gF1eD2:2 already processed. Skipping.
[Indexer Deduplication] Event 5xZ7Y8xQ9pW2mV1nU3tR4sQ5P6oN7mL8kJ9iH0gF1eD2:3 already processed. Skipping.
[Indexer Deduplication] Event 5xZ7Y8xQ9pW2mV1nU3tR4sQ5P6oN7mL8kJ9iH0gF1eD2:4 already processed. Skipping.
[Step 4 SUCCESS] Processed 5 re-sent events. Duplicates correctly skipped: 5/5
PHASE 10 INDEXER VALIDATION TEST PASSED SUCCESSFULLY
```

---

## 4. Full-Stack Build & Verification Summary

All verification suites executed and passed:

1. **Indexer Validation Test:** `npx tsx src/indexer/testIndexer.ts` ➔ **PASSED (5/5 duplicate events correctly skipped)**
2. **Move Unit Tests:** `sui move test` ➔ **PASSED (5/5 tests OK)**
3. **TypeScript Typecheck:** `npx tsc --noEmit` ➔ **PASSED (0 errors)**
4. **Vite Production Build:** `npx vite build` ➔ **PASSED (dist built in 105ms)**

---

**Report Created:** September 5, 2026
