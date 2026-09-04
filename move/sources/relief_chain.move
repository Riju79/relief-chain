module relief_chain::relief_chain {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use std::string::{Self, String};
    use sui::clock::{Self, Clock};

    // ── Error Codes ──
    const ENotAuthorized: u64 = 0;
    const EInvalidCampaignStatus: u64 = 1;
    const EInvalidMilestoneStatus: u64 = 2;
    const EInsufficientFunds: u64 = 3;
    const EAmountMismatch: u64 = 4;
    const EInvalidAmount: u64 = 5;
    const EInvalidBeneficiary: u64 = 6;
    const EMilestoneNotFound: u64 = 7;
    const EMilestoneAlreadyApproved: u64 = 8;
    const EOverRelease: u64 = 10;
    const ECampaignClosed: u64 = 11;
    const EZeroGoal: u64 = 12;
    const EEmptyString: u64 = 13;
    const EDuplicateEvidence: u64 = 14;

    // ── Status Constants ──
    const STATUS_SUBMITTED: u8 = 0; // Draft / Created by creator, awaiting verification
    const STATUS_VERIFIED: u8 = 1;  // Verified by auditor/verifier, active for donations
    const STATUS_FUNDED: u8 = 2;    // Goal met
    const STATUS_COMPLETED: u8 = 3; // Completed by verifier/admin
    const STATUS_CANCELLED: u8 = 4; // Cancelled by verifier/admin

    const MILESTONE_STATUS_PENDING: u8 = 0;
    const MILESTONE_STATUS_EVIDENCE_SUBMITTED: u8 = 1;
    const MILESTONE_STATUS_APPROVED: u8 = 2;
    const MILESTONE_STATUS_RELEASED: u8 = 3;

    // ── Capabilities ──
    public struct AdminCap has key, store {
        id: UID,
    }

    public struct VerifierCap has key, store {
        id: UID,
    }

    public struct CampaignAdminCap has key, store {
        id: UID,
        campaign_id: ID,
    }

    // ── Structs ──
    public struct Campaign has key {
        id: UID,
        title: String,
        description: String,
        location: String,
        severity: u8,
        goal: u64,
        funds_raised: u64,
        total_released: u64,
        treasury: Balance<SUI>,
        creator: address,
        status: u8,
        milestones: vector<Milestone>,
        evidence_records: vector<Evidence>,
    }

    public struct Milestone has store, copy, drop {
        index: u64,
        description: String,
        allocation: u64,
        released_amount: u64,
        status: u8,
        beneficiary: address,
    }

    public struct Evidence has store, copy, drop {
        evidence_id: String,
        walrus_blob_id: String,
        content_hash: String, // Cryptographic SHA-256 content hash
        uploader: address,
        timestamp: u64,
        mime_type: String,
        title: String,
        metadata: String,
        milestone_index: u64,
    }

    // ── Events ──
    public struct CampaignCreated has copy, drop {
        campaign_id: ID,
        title: String,
        creator: address,
        goal: u64,
    }

    public struct CampaignVerified has copy, drop {
        campaign_id: ID,
        verifier: address,
    }

    public struct DonationReceived has copy, drop {
        campaign_id: ID,
        donor: address,
        amount: u64,
        funds_raised: u64,
        treasury_balance: u64,
    }

    public struct MilestoneCreated has copy, drop {
        campaign_id: ID,
        milestone_index: u64,
        allocation: u64,
        beneficiary: address,
    }

    public struct MilestoneSubmitted has copy, drop {
        campaign_id: ID,
        milestone_index: u64,
    }

    public struct MilestoneApproved has copy, drop {
        campaign_id: ID,
        milestone_index: u64,
        verifier: address,
    }

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

    public struct FundsReleased has copy, drop {
        campaign_id: ID,
        milestone_index: u64,
        amount: u64,
        beneficiary: address,
        verifier: address,
        remaining_milestone_balance: u64,
    }

    public struct CampaignCompleted has copy, drop {
        campaign_id: ID,
        verifier: address,
    }

    public struct CampaignCancelled has copy, drop {
        campaign_id: ID,
        verifier: address,
        reason: String,
    }

    public struct VerifierGranted has copy, drop {
        verifier: address,
        granted_by: address,
    }

    // ── Initializer ──
    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        transfer::public_transfer(admin_cap, tx_context::sender(ctx));
    }

    // ── Admin / Verifier Functions ──

    public fun grant_verifier_role(
        _admin: &AdminCap,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let verifier_cap = VerifierCap {
            id: object::new(ctx),
        };
        transfer::public_transfer(verifier_cap, recipient);
        event::emit(VerifierGranted {
            verifier: recipient,
            granted_by: tx_context::sender(ctx),
        });
    }

    #[allow(lint(self_transfer))]
    public fun create_campaign(
        title: vector<u8>,
        description: vector<u8>,
        location: vector<u8>,
        severity: u8,
        goal: u64,
        ctx: &mut TxContext
    ) {
        assert!(goal > 0, EZeroGoal);
        assert!(vector::length(&title) > 0, EEmptyString);

        let sender = tx_context::sender(ctx);
        let id = object::new(ctx);
        let campaign_id = object::uid_to_inner(&id);

        let campaign = Campaign {
            id,
            title: string::utf8(title),
            description: string::utf8(description),
            location: string::utf8(location),
            severity,
            goal,
            funds_raised: 0,
            total_released: 0,
            treasury: balance::zero(),
            creator: sender,
            status: STATUS_SUBMITTED,
            milestones: vector[],
            evidence_records: vector[],
        };

        let campaign_admin_cap = CampaignAdminCap {
            id: object::new(ctx),
            campaign_id,
        };

        event::emit(CampaignCreated {
            campaign_id,
            title: campaign.title,
            creator: sender,
            goal,
        });

        transfer::public_transfer(campaign_admin_cap, sender);
        transfer::share_object(campaign);
    }

    public fun verify_campaign(
        _verifier: &VerifierCap,
        campaign: &mut Campaign,
        ctx: &mut TxContext
    ) {
        assert!(campaign.status == STATUS_SUBMITTED, EInvalidCampaignStatus);
        campaign.status = STATUS_VERIFIED;

        event::emit(CampaignVerified {
            campaign_id: object::uid_to_inner(&campaign.id),
            verifier: tx_context::sender(ctx),
        });
    }

    public fun add_milestone(
        cap: &CampaignAdminCap,
        campaign: &mut Campaign,
        description: vector<u8>,
        allocation: u64,
        beneficiary: address,
    ) {
        assert!(cap.campaign_id == object::uid_to_inner(&campaign.id), ENotAuthorized);
        assert!(campaign.status == STATUS_SUBMITTED || campaign.status == STATUS_VERIFIED, EInvalidCampaignStatus);
        assert!(allocation > 0, EInvalidAmount);
        assert!(beneficiary != @0x0, EInvalidBeneficiary);

        let milestone_index = vector::length(&campaign.milestones);

        let milestone = Milestone {
            index: milestone_index,
            description: string::utf8(description),
            allocation,
            released_amount: 0,
            status: MILESTONE_STATUS_PENDING,
            beneficiary,
        };

        vector::push_back(&mut campaign.milestones, milestone);

        event::emit(MilestoneCreated {
            campaign_id: object::uid_to_inner(&campaign.id),
            milestone_index,
            allocation,
            beneficiary,
        });
    }

    public fun donate(
        campaign: &mut Campaign,
        payment: &mut Coin<SUI>,
        amount: u64,
        ctx: &mut TxContext
    ) {
        assert!(amount > 0, EInvalidAmount);
        assert!(coin::value(payment) >= amount, EAmountMismatch);
        assert!(campaign.status == STATUS_VERIFIED || campaign.status == STATUS_FUNDED, ECampaignClosed);

        let sender = tx_context::sender(ctx);
        let coin_to_donate = coin::split(payment, amount, ctx);
        let balance_to_donate = coin::into_balance(coin_to_donate);

        balance::join(&mut campaign.treasury, balance_to_donate);
        campaign.funds_raised = campaign.funds_raised + amount;

        if (campaign.funds_raised >= campaign.goal && campaign.status == STATUS_VERIFIED) {
            campaign.status = STATUS_FUNDED;
        };

        event::emit(DonationReceived {
            campaign_id: object::uid_to_inner(&campaign.id),
            donor: sender,
            amount,
            funds_raised: campaign.funds_raised,
            treasury_balance: balance::value(&campaign.treasury),
        });
    }

    public fun attach_evidence(
        cap: &CampaignAdminCap,
        campaign: &mut Campaign,
        milestone_index: u64,
        evidence_id: vector<u8>,
        walrus_blob_id: vector<u8>,
        content_hash: vector<u8>,
        mime_type: vector<u8>,
        title: vector<u8>,
        metadata: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(cap.campaign_id == object::uid_to_inner(&campaign.id), ENotAuthorized);
        assert!(milestone_index < vector::length(&campaign.milestones), EMilestoneNotFound);
        assert!(vector::length(&walrus_blob_id) > 0, EEmptyString);
        assert!(vector::length(&content_hash) > 0, EEmptyString);

        let evidence_id_str = string::utf8(evidence_id);
        let walrus_blob_id_str = string::utf8(walrus_blob_id);
        let content_hash_str = string::utf8(content_hash);

        // Check for duplicate evidence_id
        let len = vector::length(&campaign.evidence_records);
        let mut i = 0;
        while (i < len) {
            let record = vector::borrow(&campaign.evidence_records, i);
            assert!(record.evidence_id != evidence_id_str, EDuplicateEvidence);
            i = i + 1;
        };

        let uploader = tx_context::sender(ctx);
        let timestamp = clock::timestamp_ms(clock);

        let evidence = Evidence {
            evidence_id: evidence_id_str,
            walrus_blob_id: walrus_blob_id_str,
            content_hash: content_hash_str,
            uploader,
            timestamp,
            mime_type: string::utf8(mime_type),
            title: string::utf8(title),
            metadata: string::utf8(metadata),
            milestone_index,
        };

        vector::push_back(&mut campaign.evidence_records, evidence);

        let milestone_ref = vector::borrow_mut(&mut campaign.milestones, milestone_index);
        if (milestone_ref.status == MILESTONE_STATUS_PENDING) {
            milestone_ref.status = MILESTONE_STATUS_EVIDENCE_SUBMITTED;
            event::emit(MilestoneSubmitted {
                campaign_id: object::uid_to_inner(&campaign.id),
                milestone_index,
            });
        };

        event::emit(EvidenceAttached {
            campaign_id: object::uid_to_inner(&campaign.id),
            evidence_id: evidence.evidence_id,
            milestone_index,
            walrus_blob_id: evidence.walrus_blob_id,
            content_hash: evidence.content_hash,
            mime_type: evidence.mime_type,
            uploader,
            timestamp,
        });
    }

    public fun approve_milestone(
        _verifier: &VerifierCap,
        campaign: &mut Campaign,
        milestone_index: u64,
        ctx: &mut TxContext
    ) {
        assert!(campaign.status == STATUS_VERIFIED || campaign.status == STATUS_FUNDED, ECampaignClosed);
        assert!(milestone_index < vector::length(&campaign.milestones), EMilestoneNotFound);

        let milestone = vector::borrow_mut(&mut campaign.milestones, milestone_index);
        assert!(milestone.status == MILESTONE_STATUS_EVIDENCE_SUBMITTED || milestone.status == MILESTONE_STATUS_PENDING, EMilestoneAlreadyApproved);

        milestone.status = MILESTONE_STATUS_APPROVED;

        event::emit(MilestoneApproved {
            campaign_id: object::uid_to_inner(&campaign.id),
            milestone_index,
            verifier: tx_context::sender(ctx),
        });
    }

    public fun release_funds(
        _verifier: &VerifierCap,
        campaign: &mut Campaign,
        milestone_index: u64,
        amount: u64,
        ctx: &mut TxContext
    ) {
        assert!(campaign.status == STATUS_VERIFIED || campaign.status == STATUS_FUNDED, ECampaignClosed);
        assert!(milestone_index < vector::length(&campaign.milestones), EMilestoneNotFound);
        assert!(amount > 0, EInvalidAmount);

        let milestone = vector::borrow_mut(&mut campaign.milestones, milestone_index);
        assert!(milestone.status == MILESTONE_STATUS_APPROVED || milestone.status == MILESTONE_STATUS_RELEASED, EInvalidMilestoneStatus);

        assert!(milestone.released_amount + amount <= milestone.allocation, EOverRelease);

        let available_treasury = balance::value(&campaign.treasury);
        assert!(available_treasury >= amount, EInsufficientFunds);

        let withdrawn_balance = balance::split(&mut campaign.treasury, amount);
        let withdrawn_coin = coin::from_balance(withdrawn_balance, ctx);

        let beneficiary = milestone.beneficiary;
        assert!(beneficiary != @0x0, EInvalidBeneficiary);

        milestone.released_amount = milestone.released_amount + amount;
        campaign.total_released = campaign.total_released + amount;

        if (milestone.released_amount == milestone.allocation) {
            milestone.status = MILESTONE_STATUS_RELEASED;
        };

        transfer::public_transfer(withdrawn_coin, beneficiary);

        event::emit(FundsReleased {
            campaign_id: object::uid_to_inner(&campaign.id),
            milestone_index,
            amount,
            beneficiary,
            verifier: tx_context::sender(ctx),
            remaining_milestone_balance: milestone.allocation - milestone.released_amount,
        });
    }

    public fun complete_campaign(
        _verifier: &VerifierCap,
        campaign: &mut Campaign,
        ctx: &mut TxContext
    ) {
        assert!(campaign.status == STATUS_VERIFIED || campaign.status == STATUS_FUNDED, ECampaignClosed);
        campaign.status = STATUS_COMPLETED;

        event::emit(CampaignCompleted {
            campaign_id: object::uid_to_inner(&campaign.id),
            verifier: tx_context::sender(ctx),
        });
    }

    public fun cancel_campaign(
        _verifier: &VerifierCap,
        campaign: &mut Campaign,
        reason: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert!(campaign.status != STATUS_COMPLETED && campaign.status != STATUS_CANCELLED, ECampaignClosed);
        campaign.status = STATUS_CANCELLED;

        event::emit(CampaignCancelled {
            campaign_id: object::uid_to_inner(&campaign.id),
            verifier: tx_context::sender(ctx),
            reason: string::utf8(reason),
        });
    }

    // ── Getters / Inspection Functions ──
    public fun get_title(campaign: &Campaign): String { campaign.title }
    public fun get_description(campaign: &Campaign): String { campaign.description }
    public fun get_location(campaign: &Campaign): String { campaign.location }
    public fun get_severity(campaign: &Campaign): u8 { campaign.severity }
    public fun get_goal(campaign: &Campaign): u64 { campaign.goal }
    public fun get_funds_raised(campaign: &Campaign): u64 { campaign.funds_raised }
    public fun get_total_donated(campaign: &Campaign): u64 { campaign.funds_raised }
    public fun get_available_treasury(campaign: &Campaign): u64 { balance::value(&campaign.treasury) }
    public fun get_total_released(campaign: &Campaign): u64 { campaign.total_released }
    public fun get_creator(campaign: &Campaign): address { campaign.creator }
    public fun get_status(campaign: &Campaign): u8 { campaign.status }
    public fun get_milestones_count(campaign: &Campaign): u64 { vector::length(&campaign.milestones) }
    public fun get_evidence_count(campaign: &Campaign): u64 { vector::length(&campaign.evidence_records) }

    public fun get_evidence_info(campaign: &Campaign, index: u64): (String, String, String, address, u64, String, u64) {
        assert!(index < vector::length(&campaign.evidence_records), EMilestoneNotFound);
        let e = vector::borrow(&campaign.evidence_records, index);
        (e.evidence_id, e.walrus_blob_id, e.content_hash, e.uploader, e.timestamp, e.mime_type, e.milestone_index)
    }

    public fun get_milestone_info(campaign: &Campaign, index: u64): (String, u64, u64, u8, address) {
        assert!(index < vector::length(&campaign.milestones), EMilestoneNotFound);
        let m = vector::borrow(&campaign.milestones, index);
        (m.description, m.allocation, m.released_amount, m.status, m.beneficiary)
    }

    public fun get_milestone_allocation(campaign: &Campaign, index: u64): u64 {
        assert!(index < vector::length(&campaign.milestones), EMilestoneNotFound);
        let m = vector::borrow(&campaign.milestones, index);
        m.allocation
    }

    public fun get_milestone_released(campaign: &Campaign, index: u64): u64 {
        assert!(index < vector::length(&campaign.milestones), EMilestoneNotFound);
        let m = vector::borrow(&campaign.milestones, index);
        m.released_amount
    }

    public fun get_milestone_remaining_balance(campaign: &Campaign, index: u64): u64 {
        assert!(index < vector::length(&campaign.milestones), EMilestoneNotFound);
        let m = vector::borrow(&campaign.milestones, index);
        m.allocation - m.released_amount
    }

    // Test-only helper
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
