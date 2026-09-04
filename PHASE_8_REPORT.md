# PHASE 8 REPORT: Decentralized Role-Based Verification & AI Boundary Enforcement

## Executive Summary

Phase 8 implements a credible, multi-tiered disaster verification architecture. It strictly delineates the responsibilities of human actors (**Protocol Admin**, **Verifier**, **Campaign Creator**, **Beneficiary**, **Donor**) and off-chain automation (**AI Engine**), ensuring that **neither the AI nor the backend database can directly control or release funds**.

All financial activations, milestone approvals, and payouts require capability-based on-chain transactions on the Sui blockchain (`VerifierCap`, `CampaignAdminCap`).

---

## Role Definitions & Explicit Permissions

| Role | On-Chain Capability | Permitted Actions | Excluded Actions |
| :--- | :--- | :--- | :--- |
| **Protocol Admin** | `AdminCap` | Grants `VerifierCap` to vetted human auditors (`grant_verifier_role`). | Cannot withdraw campaign funds or bypass verifiers. |
| **Human Verifier** | `VerifierCap` | Verifies submitted campaigns (`verify_campaign`), approves milestones (`approve_milestone`), authorizes fund payouts (`release_funds`), completes/cancels campaigns (`complete_campaign`/`cancel_campaign`). | Cannot alter campaign goals or redirect funds to unauthorized addresses. |
| **Campaign Creator** | `CampaignAdminCap` | Creates campaigns (`create_campaign`), adds milestones (`add_milestone`), attaches Walrus evidence (`attach_evidence`). | Cannot release funds, approve own milestones, or withdraw treasury funds directly. |
| **Beneficiary** | *Designated Address* | Receives SUI payout coins directly when an approved milestone fund release is executed by a Verifier. | Cannot initiate release or alter milestone allocations. |
| **Donor** | *Public User Address* | Donates SUI coins (`donate`) to verified active campaigns (`STATUS_VERIFIED` or `STATUS_FUNDED`). | Cannot access campaign treasury or alter campaign parameters. |

---

## End-to-End Verification Flow

```
[ Crisis Reporter / Creator ]
              │
              ▼
    [ Upload Evidence File ]
              │
              ▼
   [ Real Walrus Storage ] ──▶ Returns Blob ID
              │
              ▼
   [ AI Authenticity Engine ]
   (Classifies media, detects entropy, calculates risk score, extracts metadata)
              │
              ▼ (Off-Chain Assistive Telemetry)
    [ Human Verifier Review ]
    (Inspects AI risk analysis & Walrus proof content)
              │
              ▼ (Signs Sui Tx with VerifierCap)
 [ On-Chain Sui Verification ]
 (Calls verify_campaign / approve_milestone ➔ Emits CampaignVerified / MilestoneApproved)
              │
              ▼
   [ Campaign Activated / Milestone Unlocked for Payout ]
```

---

## Strict AI System Boundaries

The AI engine operates strictly as an off-chain diagnostic advisor:

### What the AI System MAY Do:
- Classify disaster evidence types (Flooding, Cyclone, Wildfire, Landslide, Earthquake).
- Extract MIME and metadata parameters.
- Detect suspicious filenames, low byte entropy, or placeholder attachments.
- Calculate authenticity confidence scores (0–100%).
- Present risk analysis flags to human verifiers in the UI.

### What the AI System MUST NOT Do:
- ❌ Release money or transfer SUI coins.
- ❌ Bypass Move capability authorization.
- ❌ Act as sole financial authority.
- ❌ Modify on-chain campaign states without human `VerifierCap` signatures.

---

## On-Chain Verification Representation

On-chain state transitions are enforced in Move (`move/sources/relief_chain.move`):

1. **Campaign Creation:** Created in `STATUS_SUBMITTED` (0). Unverified campaigns reject all public donations (`ECampaignClosed` = 11).
2. **Human Verification:** Requires `verify_campaign(&VerifierCap, &mut Campaign)`. Updates status to `STATUS_VERIFIED` (1) and emits `CampaignVerified` event.
3. **Milestone Payout Release:** Requires `release_funds(&VerifierCap, &mut Campaign, milestone_index, amount)`. Transfers SUI coins directly from `campaign.treasury` to `milestone.beneficiary` and emits `FundsReleased` event.

---

## Unauthorized Security Test Coverage

The Move unit test suite (`move/sources/relief_chain_tests.move`) verifies that all unauthorized actions abort immediately:

| Test Case | Description | Result |
| :--- | :--- | :--- |
| `test_complete_evidence_flow` | Authorized lifecycle: Admin grants Verifier ➔ NGO creates ➔ Verifier approves ➔ Donor funds ➔ NGO attaches evidence ➔ Verifier releases funds to Beneficiary. | **PASS** |
| `test_unauthorized_evidence_attachment` | Attempting to attach evidence to Campaign 1 using Stranger's `CampaignAdminCap` (for Campaign 2) aborts with code `0` (`ENotAuthorized`). | **PASS** |
| `test_empty_blob_id_evidence` | Submitting empty `walrus_blob_id` string aborts with code `13` (`EEmptyString`). | **PASS** |
| `test_duplicate_evidence_id` | Attaching duplicate `evidence_id` aborts with code `14` (`EDuplicateEvidence`). | **PASS** |
| `test_unverified_campaign_cannot_receive_donations` | Donating to unverified campaign (`STATUS_SUBMITTED`) before Human Verifier approval aborts with code `11` (`ECampaignClosed`). | **PASS** |

### Execution Command & Output

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
[ PASS    ] relief_chain::relief_chain_tests::test_unverified_campaign_cannot_receive_donations
Test result: OK. Total tests: 5; passed: 5; failed: 0
```

---

**Report Created:** September 5, 2026
