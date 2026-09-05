# Move Smart Contract Formal Invariants Specification

This document provides an audit specification of the mathematical, financial, and access-control invariants enforced by the **ReliefChain Move Smart Contract** ([`move/sources/relief_chain.move`](../../move/sources/relief_chain.move)) on the Sui blockchain.

---

## 1. Financial & Arithmetic Invariants

### Invariant 1: Milestone Release Ceiling (`INV-FIN-01`)
- **Formal Definition:** For every milestone $M_i$ associated with campaign $C$, the cumulative released amount $\sum r_i$ must never exceed the milestone allocation $A_i$.
  $$\forall i \in \{0, \dots, |M|-1\}: \quad r_i \le A_i$$
- **Enforcement Mechanism:** Enforced in `release_funds` via:
  ```move
  assert!(milestone.released_amount + amount <= milestone.allocation, EOverRelease); // code 10
  ```
- **Violation Result:** Reverts with error code `EOverRelease` (`10`).
- **Adversarial Test Case:** `test_invariant_released_amount_cannot_exceed_allocation`

---

### Invariant 2: Treasury Solvency & Non-Negativity (`INV-FIN-02`)
- **Formal Definition:** The campaign's treasury balance `Balance<SUI>` must be strictly greater than or equal to any payout release $R$. Treasury balance can never go negative or underflow.
  $$B_{\text{treasury}} \ge R$$
  $$B_{\text{treasury}} \ge 0 \quad \text{(Guaranteed by Move's native Balance<SUI> type)}$$
- **Enforcement Mechanism:** Enforced prior to balance split via:
  ```move
  assert!(balance::value(&campaign.treasury) >= amount, EInsufficientFunds); // code 3
  let payout_balance = balance::split(&mut campaign.treasury, amount);
  ```
- **Violation Result:** Reverts with error code `EInsufficientFunds` (`3`).
- **Adversarial Test Case:** `test_invariant_release_cannot_exceed_treasury_balance`

---

### Invariant 3: Treasury Conservation of Value (`INV-FIN-03`)
- **Formal Definition:** At all times, the total funds recorded as raised must equal the current treasury balance plus the total released funds.
  $$F_{\text{raised}} = B_{\text{treasury}} + \sum_{\text{all releases}} R$$
- **Enforcement Mechanism:** Donations increment both `funds_raised` and `treasury` by exactly identical amounts (`amount`). `release_funds` decrements `treasury` and increments `total_released` by identical amounts (`amount`).
- **Violation Result:** Move type system guarantees balance coins cannot be created or destroyed off-ledger.
- **Adversarial Test Case:** `test_invariant_treasury_conservation_of_value`

---

### Invariant 4: Non-Zero Parameter Requirement (`INV-FIN-04`)
- **Formal Definition:** Financial parameters (campaign goal $G$, milestone allocation $A_i$, donation amount $D$, fund release $R$) must be strictly positive.
  $$G > 0, \quad A_i > 0, \quad D > 0, \quad R > 0$$
- **Enforcement Mechanism:** Enforced across entrypoints:
  - `create_campaign`: `assert!(goal > 0, EZeroGoal);` (`code 12`)
  - `add_milestone`: `assert!(allocation > 0, EInvalidAmount);` (`code 5`)
  - `donate`: `assert!(coin::value(payment) >= amount && amount > 0, EInvalidAmount);` (`code 5`)
  - `release_funds`: `assert!(amount > 0, EInvalidAmount);` (`code 5`)
- **Violation Result:** Reverts with error code `EZeroGoal` (`12`) or `EInvalidAmount` (`5`).
- **Adversarial Test Cases:**
  - `test_invariant_zero_amount_donation_rejected`
  - `test_invariant_zero_amount_milestone_rejected`
  - `test_invariant_zero_amount_release_rejected`

---

## 2. Access Control & Capability Invariants

### Invariant 5: Auditor Role Restriction (`INV-AUTH-01`)
- **Formal Definition:** Verifier operations (`verify_campaign`, `approve_milestone`, `release_funds`, `complete_campaign`, `cancel_campaign`) can ONLY be executed with an explicit immutable reference `&VerifierCap`.
  $$\forall \text{ verifier\_op}: \quad \text{Caller must supply valid } \text{VerifierCap}$$
- **Enforcement Mechanism:** Required as first parameter in Move function signatures:
  ```move
  public entry fun release_funds(
      _verifier_cap: &VerifierCap,
      campaign: &mut Campaign,
      milestone_index: u64,
      amount: u64,
      ctx: &mut TxContext
  )
  ```
  Neither campaign creators, donors, beneficiaries, nor general public keys can call verifier operations without holding a `VerifierCap` object.
- **Violation Result:** Compilation error or Move runtime abort if caller lacks capability object.
- **Adversarial Test Cases:**
  - `test_invariant_unauthorized_caller_cannot_release_funds`
  - `test_invariant_unauthorized_caller_cannot_approve_milestone`

---

### Invariant 6: CampaignAdminCap Isolation (`INV-AUTH-02`)
- **Formal Definition:** A `CampaignAdminCap` minted for campaign $C_X$ is cryptographically and strictly bound to $C_X$. It cannot be used to modify milestones or attach evidence to a different campaign $C_Y$.
  $$\forall \text{ cap } \in \text{CampaignAdminCap}, \quad \text{cap.campaign\_id} == \text{object::id}(C)$$
- **Enforcement Mechanism:** Enforced in `add_milestone` and `attach_evidence`:
  ```move
  assert!(admin_cap.campaign_id == object::id(campaign), ENotAuthorized); // code 0
  ```
- **Violation Result:** Reverts with error code `ENotAuthorized` (`0`).
- **Adversarial Test Case:** `test_invariant_campaign_admin_cap_isolation_cross_campaign`

---

### Invariant 7: Admin Role Exclusivity (`INV-AUTH-03`)
- **Formal Definition:** New `VerifierCap` objects can ONLY be granted by the holder of `AdminCap`.
- **Enforcement Mechanism:**
  ```move
  public entry fun grant_verifier_role(
      _admin: &AdminCap,
      recipient: address,
      ctx: &mut TxContext
  )
  ```
- **Violation Result:** Reverts if caller does not hold the unique `AdminCap` object.

---

## 3. State Machine & Lifecycle Invariants

### Invariant 8: Monotonic Campaign Status Transition (`INV-STATE-01`)
- **Formal Definition:** A campaign must follow a forward-directed state machine:
  $$\text{STATUS\_SUBMITTED (0)} \longrightarrow \text{STATUS\_VERIFIED (1)} \longrightarrow \text{STATUS\_FUNDED (2)} \longrightarrow \text{STATUS\_COMPLETED (3) or STATUS\_CANCELLED (4)}$$
- **Rules:**
  - `STATUS_SUBMITTED (0)`: Cannot receive donations (`ECampaignClosed` = 11).
  - `STATUS_VERIFIED (1)`: Can receive donations until goal is met; then automatically transitions to `STATUS_FUNDED (2)`.
  - `STATUS_COMPLETED (3)` or `STATUS_CANCELLED (4)`: Terminal states. All further milestone approvals and payouts are permanently blocked.
- **Violation Result:** Reverts with error code `ECampaignClosed` (`11`) or `EInvalidCampaignStatus` (`1`).
- **Adversarial Test Cases:**
  - `test_unverified_campaign_cannot_receive_donations`
  - `test_invariant_cancelled_campaign_blocks_further_releases`

---

### Invariant 9: Milestone Approval Prerequisite (`INV-STATE-02`)
- **Formal Definition:** Funds for milestone $M_i$ cannot be released unless the milestone has already been formally inspected and transitioned to `MILESTONE_STATUS_APPROVED (2)`.
  $$\text{release\_funds}(M_i) \implies M_i.\text{status} \ge \text{MILESTONE\_STATUS\_APPROVED (2)}$$
- **Enforcement Mechanism:**
  ```move
  assert!(milestone.status >= MILESTONE_STATUS_APPROVED, EInvalidMilestoneStatus); // code 2
  ```
- **Violation Result:** Reverts with error code `EInvalidMilestoneStatus` (`2`).
- **Adversarial Test Case:** `test_invariant_unapproved_milestone_cannot_release_funds`

---

## 4. Evidence Cryptographic Anchoring Invariants

### Invariant 10: Evidence Identifier Uniqueness (`INV-EVID-01`)
- **Formal Definition:** Every evidence record attached to campaign $C$ must have a unique `evidence_id`. Re-submitting the same identifier is rejected.
  $$\forall e_1, e_2 \in C.\text{evidence\_records}, \quad e_1 \ne e_2 \implies e_1.\text{evidence\_id} \ne e_2.\text{evidence\_id}$$
- **Enforcement Mechanism:**
  ```move
  let len = vector::length(&campaign.evidence_records);
  let mut i = 0;
  while (i < len) {
      let existing = vector::borrow(&campaign.evidence_records, i);
      assert!(existing.evidence_id != evidence_id_str, EDuplicateEvidence); // code 14
      i = i + 1;
  };
  ```
- **Violation Result:** Reverts with error code `EDuplicateEvidence` (`14`).
- **Adversarial Test Case:** `test_duplicate_evidence_id`

---

### Invariant 11: Cryptographic Hash Non-Emptiness (`INV-EVID-02`)
- **Formal Definition:** All evidence records must anchor non-empty Walrus Blob IDs and non-empty SHA-256 digests.
- **Enforcement Mechanism:**
  ```move
  assert!(string::length(&walrus_blob_id_str) > 0, EEmptyString); // code 13
  assert!(string::length(&content_hash_str) > 0, EEmptyString); // code 13
  ```
- **Violation Result:** Reverts with error code `EEmptyString` (`13`).
- **Adversarial Test Case:** `test_empty_blob_id_evidence`
