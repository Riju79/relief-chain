# PHASE 6 REPORT: Real Walrus Evidence & Cryptographic Anchoring

## Executive Summary

Phase 6 completes the cryptographic bridge between decentralized off-chain storage (**Walrus Protocol**) and on-chain verification (**Sui Blockchain**). 

Instead of storing bulk file binaries directly on Sui (which would be inefficient and costly), standard relief evidence files (photos, invoices, GPS logs, audit receipts) are published directly to **Walrus**. The returned **Walrus Blob ID** along with the **SHA-256 Content Hash** are anchored on-chain in the `Campaign` struct via an authorized Move entry function (`attach_evidence`).

When evidence is retrieved by auditors, donors, or the frontend app, the retrieved content's SHA-256 hash is computed in real-time and strictly compared against the on-chain hash record. If any byte mismatch is detected, the frontend flags an **Evidence Integrity Failure** and marks the record as unverified/tampered.

---

## Technical Architecture & Data Model

### 1. On-Chain Evidence Model (`move/sources/relief_chain.move`)

```move
public struct Evidence has store, copy, drop {
    evidence_id: String,
    walrus_blob_id: String,
    content_hash: String,     // SHA-256 hex string of original file
    uploader: address,
    timestamp: u64,
    mime_type: String,
    title: String,
    metadata: String,         // JSON metadata (e.g. GPS coordinates)
    milestone_index: u64,
}
```

### 2. Move Event Emission (`EvidenceAttached`)

```move
public struct EvidenceAttached has copy, drop {
    campaign_id: ID,
    evidence_id: String,
    milestone_index: u64,
    walrus_blob_id: String,
    content_hash: String,
    mime_type: String,
    uploader: address,
    timestamp: u64,
}
```

### 3. Move Security Guards
- **Authorization Enforcement:** Requires `CampaignAdminCap` belonging strictly to the target campaign (`cap.campaign_id == object::uid_to_inner(&campaign.id)`). Unauthorized actors cannot attach fake evidence to protected campaigns (`ENotAuthorized` = 0).
- **Non-Empty Storage Identifier:** Rejects zero-length Walrus Blob IDs or Content Hashes (`EEmptyString` = 13).
- **Duplicate Prevention:** Prevents re-attaching duplicate `evidence_id` entries to the same campaign (`EDuplicateEvidence` = 14).

---

## Lifecycle Flow

```
[ User Uploads File ]
          │
          ▼
[ Server / Frontend ] ──▶ [ Calculates SHA-256 Hash ]
          │
          ▼
[ Walrus Aggregator / Publisher ]
          │
          ▼ Returns Real Blob ID
[ Sui Transaction (attach_evidence) ] ──▶ [ Checks CampaignAdminCap ]
          │                                  [ Emits EvidenceAttached Event ]
          ▼                                  [ Stores Evidence on-chain ]
[ Auditor / Frontend Verification ]
          │
          ├─▶ 1. Read On-Chain Evidence Record (Blob ID + SHA-256)
          ├─▶ 2. Fetch File from Walrus Aggregator (by Blob ID)
          ├─▶ 3. Re-calculate SHA-256 Hash of fetched file
          └─▶ 4. If Hash Match: ✅ Verified Integrity
                 If Mismatch:   ❌ Integrity Failure Alert
```

---

## Move Unit Test Coverage

All test scenarios specified in Phase 6 requirements were executed and passed:

| Test Case | Description | Result |
| :--- | :--- | :--- |
| `test_complete_evidence_flow` | Valid evidence attachment, getter retrieval, verifier milestone approval & payout release | **PASS** |
| `test_unauthorized_evidence_attachment` | Mismatched `CampaignAdminCap` attempt to attach evidence triggers abort code `0` (`ENotAuthorized`) | **PASS** |
| `test_empty_blob_id_evidence` | Submitting empty `walrus_blob_id` string triggers abort code `13` (`EEmptyString`) | **PASS** |
| `test_duplicate_evidence_id` | Attaching duplicate `evidence_id` triggers abort code `14` (`EDuplicateEvidence`) | **PASS** |

### Execution Command & Result

```bash
$ export PATH=$HOME/.local/bin:$PATH && cd move && sui move test
INCLUDING DEPENDENCY MoveStdlib
INCLUDING DEPENDENCY Sui
BUILDING relief_chain
Running Move unit tests
[ PASS    ] relief_chain::relief_chain_tests::test_complete_evidence_flow
[ PASS    ] relief_chain::relief_chain_tests::test_duplicate_evidence_id
[ PASS    ] relief_chain::relief_chain_tests::test_empty_blob_id_evidence
[ PASS    ] relief_chain::relief_chain_tests::test_unauthorized_evidence_attachment
Test result: OK. Total tests: 4; passed: 4; failed: 0
```

---

## Full Stack Verification & End-to-End Test

The complete toolchain was compiled and verified:

1. **Move Build & Unit Tests:** `sui move test` ➔ **PASSED (4/4)**
2. **TypeScript Compilation:** `npx tsc --noEmit` ➔ **PASSED (0 errors)**
3. **Frontend Vite Build:** `npx vite build` ➔ **PASSED (dist built in 147ms)**
4. **End-to-End Verification Test:** `npx tsx src/testPhase6Integrity.ts` ➔ **PASSED**

---

## Conclusion & Production Readiness

With Phase 6 complete:
- Every piece of relief evidence attached to a campaign has a verified, immutable SHA-256 cryptographic hash stored on the Sui blockchain.
- Walrus storage IDs are anchored on-chain with capability-protected access control.
- Any attempt to modify or tamper with off-chain Walrus blobs is instantly detected upon retrieval by client-side SHA-256 hashing.

---

**Report Created:** September 5, 2026
