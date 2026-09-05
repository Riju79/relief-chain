#[test_only]
module relief_chain::relief_chain_tests {
    use sui::test_scenario::{Self};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::clock::{Self};
    use relief_chain::relief_chain::{
        Self, Campaign, CampaignAdminCap, VerifierCap, AdminCap
    };

    // Test addresses
    const DEPLOYER: address = @0x10;
    const VERIFIER: address = @0x20;
    const NGO_CREATOR: address = @0x30;
    const DONOR: address = @0x40;
    const BENEFICIARY: address = @0x50;
    const STRANGER: address = @0x60;

    #[test]
    fun test_complete_evidence_flow() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        // Step 1: Admin grants verifier role
        test_scenario::next_tx(scenario, DEPLOYER);
        {
            relief_chain::init_for_testing(test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, DEPLOYER);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(scenario);
            relief_chain::grant_verifier_role(&admin_cap, VERIFIER, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, admin_cap);
        };

        // Step 2: NGO creates campaign
        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(
                b"Flood Relief 2026",
                b"Emergency relief for flood victims",
                b"Region Alpha",
                3, // Severity
                1000000000, // Goal: 1 SUI
                test_scenario::ctx(scenario)
            );
        };

        // Step 3: Verifier verifies campaign
        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            
            relief_chain::verify_campaign(&verifier_cap, &mut campaign, test_scenario::ctx(scenario));
            
            assert!(relief_chain::get_status(&campaign) == 1, 101); // STATUS_VERIFIED = 1
            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        // Step 4: NGO adds milestone
        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let admin_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);

            relief_chain::add_milestone(
                &admin_cap,
                &mut campaign,
                b"Milestone 1: Clean Water Distribution",
                500000000, // 0.5 SUI
                BENEFICIARY
            );

            assert!(relief_chain::get_milestones_count(&campaign) == 1, 102);
            test_scenario::return_to_sender(scenario, admin_cap);
            test_scenario::return_shared(campaign);
        };

        // Step 5: Donor donates SUI
        test_scenario::next_tx(scenario, DONOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let mut donor_coin = coin::mint_for_testing<SUI>(1000000000, test_scenario::ctx(scenario));

            relief_chain::donate(
                &mut campaign,
                &mut donor_coin,
                500000000,
                test_scenario::ctx(scenario)
            );

            assert!(relief_chain::get_funds_raised(&campaign) == 500000000, 103);
            assert!(relief_chain::get_available_treasury(&campaign) == 500000000, 104);

            transfer::public_transfer(donor_coin, DONOR);
            test_scenario::return_shared(campaign);
        };

        // Step 6: Attach real Walrus evidence to milestone 0
        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let admin_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);
            let clock = clock::create_for_testing(test_scenario::ctx(scenario));

            relief_chain::attach_evidence(
                &admin_cap,
                &mut campaign,
                0, // milestone index
                b"EVID-001", // evidence_id
                b"walrus_blob_abc123xyz789", // walrus_blob_id
                b"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // SHA-256 hash
                b"image/jpeg", // mime_type
                b"Receipt & Delivery Photo", // title
                b"{\"latitude\":22.5,\"longitude\":88.3}", // metadata
                &clock,
                test_scenario::ctx(scenario)
            );

            assert!(relief_chain::get_evidence_count(&campaign) == 1, 105);

            let (ev_id, blob_id, hash, uploader, timestamp, mime, m_idx) = relief_chain::get_evidence_info(&campaign, 0);
            assert!(ev_id == std::string::utf8(b"EVID-001"), 106);
            assert!(blob_id == std::string::utf8(b"walrus_blob_abc123xyz789"), 107);
            assert!(hash == std::string::utf8(b"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), 108);
            assert!(uploader == NGO_CREATOR, 109);
            assert!(timestamp == 0, 110);
            assert!(mime == std::string::utf8(b"image/jpeg"), 111);
            assert!(m_idx == 0, 112);

            clock::destroy_for_testing(clock);
            test_scenario::return_to_sender(scenario, admin_cap);
            test_scenario::return_shared(campaign);
        };

        // Step 7: Verifier approves milestone & releases funds to beneficiary
        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);

            relief_chain::approve_milestone(&verifier_cap, &mut campaign, 0, test_scenario::ctx(scenario));
            relief_chain::release_funds(&verifier_cap, &mut campaign, 0, 500000000, test_scenario::ctx(scenario));

            assert!(relief_chain::get_total_released(&campaign) == 500000000, 113);
            assert!(relief_chain::get_available_treasury(&campaign) == 0, 114);

            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        // Step 8: Beneficiary receives payment coin
        test_scenario::next_tx(scenario, BENEFICIARY);
        {
            let payout = test_scenario::take_from_sender<Coin<SUI>>(scenario);
            assert!(coin::value(&payout) == 500000000, 115);
            test_scenario::return_to_sender(scenario, payout);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = 0)]
    fun test_unauthorized_evidence_attachment() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        // NGO creates campaign 1
        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(
                b"Campaign 1",
                b"Desc",
                b"Loc",
                1,
                1000,
                test_scenario::ctx(scenario)
            );
        };

        // NGO adds milestone to campaign 1
        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            let mut campaign1 = test_scenario::take_shared<Campaign>(scenario);
            let ngo_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);

            relief_chain::add_milestone(&ngo_cap, &mut campaign1, b"M1", 500, BENEFICIARY);

            test_scenario::return_to_sender(scenario, ngo_cap);
            test_scenario::return_shared(campaign1);
        };

        // Stranger creates campaign 2
        test_scenario::next_tx(scenario, STRANGER);
        {
            relief_chain::create_campaign(
                b"Campaign 2",
                b"Desc",
                b"Loc",
                1,
                1000,
                test_scenario::ctx(scenario)
            );
        };

        // Stranger tries to use Stranger's Cap (for Campaign 2) on Campaign 1
        test_scenario::next_tx(scenario, STRANGER);
        {
            let campaign2 = test_scenario::take_shared<Campaign>(scenario);
            let mut campaign1 = test_scenario::take_shared<Campaign>(scenario);
            let stranger_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);
            let clock = clock::create_for_testing(test_scenario::ctx(scenario));

            // stranger_cap has campaign_id of Campaign 2, but target is campaign1 -> trigger ENotAuthorized (0)
            relief_chain::attach_evidence(
                &stranger_cap,
                &mut campaign1,
                0,
                b"EVID-BAD",
                b"blob123",
                b"hash123",
                b"image/png",
                b"Title",
                b"{}",
                &clock,
                test_scenario::ctx(scenario)
            );

            clock::destroy_for_testing(clock);
            test_scenario::return_to_sender(scenario, stranger_cap);
            test_scenario::return_shared(campaign1);
            test_scenario::return_shared(campaign2);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = 13)]
    fun test_empty_blob_id_evidence() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(
                b"Campaign 1",
                b"Desc",
                b"Loc",
                1,
                1000,
                test_scenario::ctx(scenario)
            );
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let admin_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);

            relief_chain::add_milestone(&admin_cap, &mut campaign, b"M1", 500, BENEFICIARY);

            let clock = clock::create_for_testing(test_scenario::ctx(scenario));

            // Empty walrus_blob_id should fail
            relief_chain::attach_evidence(
                &admin_cap,
                &mut campaign,
                0,
                b"EVID-001",
                b"", // Empty blob ID!
                b"hash123",
                b"image/png",
                b"Title",
                b"{}",
                &clock,
                test_scenario::ctx(scenario)
            );

            clock::destroy_for_testing(clock);
            test_scenario::return_to_sender(scenario, admin_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = 14)]
    fun test_duplicate_evidence_id() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(
                b"Campaign 1",
                b"Desc",
                b"Loc",
                1,
                1000,
                test_scenario::ctx(scenario)
            );
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let admin_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);

            relief_chain::add_milestone(&admin_cap, &mut campaign, b"M1", 500, BENEFICIARY);

            let clock = clock::create_for_testing(test_scenario::ctx(scenario));

            relief_chain::attach_evidence(
                &admin_cap,
                &mut campaign,
                0,
                b"EVID-DUP",
                b"blob1",
                b"hash1",
                b"image/png",
                b"Title 1",
                b"{}",
                &clock,
                test_scenario::ctx(scenario)
            );

            // Attempting to attach same evidence_id should trigger EDuplicateEvidence (14)
            relief_chain::attach_evidence(
                &admin_cap,
                &mut campaign,
                0,
                b"EVID-DUP",
                b"blob2",
                b"hash2",
                b"image/png",
                b"Title 2",
                b"{}",
                &clock,
                test_scenario::ctx(scenario)
            );

            clock::destroy_for_testing(clock);
            test_scenario::return_to_sender(scenario, admin_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = 11)] // ECampaignClosed = 11 (unverified campaign cannot accept donations)
    fun test_unverified_campaign_cannot_receive_donations() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        // NGO creates campaign (starts in STATUS_SUBMITTED)
        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(
                b"Unverified Campaign",
                b"Desc",
                b"Loc",
                1,
                1000000,
                test_scenario::ctx(scenario)
            );
        };

        // Donor tries to donate before Human Verifier approves it -> abort 11
        test_scenario::next_tx(scenario, DONOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let mut donor_coin = coin::mint_for_testing<SUI>(1000, test_scenario::ctx(scenario));

            relief_chain::donate(&mut campaign, &mut donor_coin, 1000, test_scenario::ctx(scenario));

            transfer::public_transfer(donor_coin, DONOR);
            test_scenario::return_shared(campaign);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = 10)] // EOverRelease = 10
    fun test_invariant_released_amount_cannot_exceed_allocation() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        test_scenario::next_tx(scenario, DEPLOYER);
        {
            relief_chain::init_for_testing(test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, DEPLOYER);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(scenario);
            relief_chain::grant_verifier_role(&admin_cap, VERIFIER, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, admin_cap);
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(b"C1", b"D", b"L", 1, 1000000000, test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::verify_campaign(&verifier_cap, &mut campaign, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let admin_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);
            relief_chain::add_milestone(&admin_cap, &mut campaign, b"M1", 500000000, BENEFICIARY);
            test_scenario::return_to_sender(scenario, admin_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::next_tx(scenario, DONOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let mut donor_coin = coin::mint_for_testing<SUI>(1000000000, test_scenario::ctx(scenario));
            relief_chain::donate(&mut campaign, &mut donor_coin, 1000000000, test_scenario::ctx(scenario));
            transfer::public_transfer(donor_coin, DONOR);
            test_scenario::return_shared(campaign);
        };

        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::approve_milestone(&verifier_cap, &mut campaign, 0, test_scenario::ctx(scenario));
            // Attempt to release 600M when allocation is only 500M -> abort 10
            relief_chain::release_funds(&verifier_cap, &mut campaign, 0, 600000000, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = 3)] // EInsufficientFunds = 3
    fun test_invariant_release_cannot_exceed_treasury_balance() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        test_scenario::next_tx(scenario, DEPLOYER);
        {
            relief_chain::init_for_testing(test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, DEPLOYER);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(scenario);
            relief_chain::grant_verifier_role(&admin_cap, VERIFIER, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, admin_cap);
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(b"C1", b"D", b"L", 1, 1000000000, test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::verify_campaign(&verifier_cap, &mut campaign, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let admin_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);
            relief_chain::add_milestone(&admin_cap, &mut campaign, b"M1", 500000000, BENEFICIARY);
            test_scenario::return_to_sender(scenario, admin_cap);
            test_scenario::return_shared(campaign);
        };

        // Donor donates only 100M SUI
        test_scenario::next_tx(scenario, DONOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let mut donor_coin = coin::mint_for_testing<SUI>(100000000, test_scenario::ctx(scenario));
            relief_chain::donate(&mut campaign, &mut donor_coin, 100000000, test_scenario::ctx(scenario));
            transfer::public_transfer(donor_coin, DONOR);
            test_scenario::return_shared(campaign);
        };

        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::approve_milestone(&verifier_cap, &mut campaign, 0, test_scenario::ctx(scenario));
            // Attempt to release 300M when treasury only has 100M -> abort 3
            relief_chain::release_funds(&verifier_cap, &mut campaign, 0, 300000000, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = 0)] // ENotAuthorized = 0
    fun test_invariant_campaign_admin_cap_isolation_cross_campaign() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        // NGO 1 creates Campaign X
        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(b"Campaign X", b"D", b"L", 1, 1000000, test_scenario::ctx(scenario));
        };

        // Stranger creates Campaign Y
        test_scenario::next_tx(scenario, STRANGER);
        {
            relief_chain::create_campaign(b"Campaign Y", b"D", b"L", 1, 1000000, test_scenario::ctx(scenario));
        };

        // NGO 1 takes their CampaignAdminCap (for X) and attempts to add a milestone to Campaign Y -> abort 0
        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            let cap_for_x = test_scenario::take_from_sender<CampaignAdminCap>(scenario);
            let mut campaign_y = test_scenario::take_shared<Campaign>(scenario);

            // This must abort with ENotAuthorized (0) due to campaign ID mismatch
            relief_chain::add_milestone(&cap_for_x, &mut campaign_y, b"Unauthorized Milestone", 100000, BENEFICIARY);

            test_scenario::return_to_sender(scenario, cap_for_x);
            test_scenario::return_shared(campaign_y);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = 5)] // EInvalidAmount = 5
    fun test_invariant_zero_amount_donation_rejected() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        test_scenario::next_tx(scenario, DEPLOYER);
        {
            relief_chain::init_for_testing(test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, DEPLOYER);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(scenario);
            relief_chain::grant_verifier_role(&admin_cap, VERIFIER, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, admin_cap);
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(b"C1", b"D", b"L", 1, 1000000, test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::verify_campaign(&verifier_cap, &mut campaign, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::next_tx(scenario, DONOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let mut donor_coin = coin::mint_for_testing<SUI>(1000, test_scenario::ctx(scenario));
            // Donating 0 amount -> abort 5
            relief_chain::donate(&mut campaign, &mut donor_coin, 0, test_scenario::ctx(scenario));
            transfer::public_transfer(donor_coin, DONOR);
            test_scenario::return_shared(campaign);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = 5)] // EInvalidAmount = 5
    fun test_invariant_zero_amount_milestone_rejected() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(b"C1", b"D", b"L", 1, 1000000, test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let admin_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);
            // Adding milestone with 0 allocation -> abort 5
            relief_chain::add_milestone(&admin_cap, &mut campaign, b"Zero Milestone", 0, BENEFICIARY);
            test_scenario::return_to_sender(scenario, admin_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = 2)] // EInvalidMilestoneStatus = 2
    fun test_invariant_unapproved_milestone_cannot_release_funds() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        test_scenario::next_tx(scenario, DEPLOYER);
        {
            relief_chain::init_for_testing(test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, DEPLOYER);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(scenario);
            relief_chain::grant_verifier_role(&admin_cap, VERIFIER, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, admin_cap);
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(b"C1", b"D", b"L", 1, 1000000, test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::verify_campaign(&verifier_cap, &mut campaign, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let admin_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);
            relief_chain::add_milestone(&admin_cap, &mut campaign, b"M1", 500000, BENEFICIARY);
            test_scenario::return_to_sender(scenario, admin_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::next_tx(scenario, DONOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let mut donor_coin = coin::mint_for_testing<SUI>(1000000, test_scenario::ctx(scenario));
            relief_chain::donate(&mut campaign, &mut donor_coin, 1000000, test_scenario::ctx(scenario));
            transfer::public_transfer(donor_coin, DONOR);
            test_scenario::return_shared(campaign);
        };

        // Verifier attempts to release funds WITHOUT approving milestone first -> abort 2
        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::release_funds(&verifier_cap, &mut campaign, 0, 250000, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    fun test_invariant_treasury_conservation_of_value() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        test_scenario::next_tx(scenario, DEPLOYER);
        {
            relief_chain::init_for_testing(test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, DEPLOYER);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(scenario);
            relief_chain::grant_verifier_role(&admin_cap, VERIFIER, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, admin_cap);
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            relief_chain::create_campaign(b"C1", b"D", b"L", 1, 1000000, test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::verify_campaign(&verifier_cap, &mut campaign, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::next_tx(scenario, NGO_CREATOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let admin_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);
            relief_chain::add_milestone(&admin_cap, &mut campaign, b"M1", 500000, BENEFICIARY);
            test_scenario::return_to_sender(scenario, admin_cap);
            test_scenario::return_shared(campaign);
        };

        // Donors donate in 2 stages
        test_scenario::next_tx(scenario, DONOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let mut coin1 = coin::mint_for_testing<SUI>(300000, test_scenario::ctx(scenario));
            relief_chain::donate(&mut campaign, &mut coin1, 300000, test_scenario::ctx(scenario));

            let mut coin2 = coin::mint_for_testing<SUI>(400000, test_scenario::ctx(scenario));
            relief_chain::donate(&mut campaign, &mut coin2, 400000, test_scenario::ctx(scenario));

            // Total raised = 700k, Treasury = 700k, Released = 0
            assert!(relief_chain::get_funds_raised(&campaign) == 700000, 201);
            assert!(relief_chain::get_available_treasury(&campaign) == 700000, 202);
            assert!(relief_chain::get_total_released(&campaign) == 0, 203);

            transfer::public_transfer(coin1, DONOR);
            transfer::public_transfer(coin2, DONOR);
            test_scenario::return_shared(campaign);
        };

        // Approve and release 250k
        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::approve_milestone(&verifier_cap, &mut campaign, 0, test_scenario::ctx(scenario));
            relief_chain::release_funds(&verifier_cap, &mut campaign, 0, 250000, test_scenario::ctx(scenario));

            // Conservation invariant check: funds_raised == treasury + total_released
            let raised = relief_chain::get_funds_raised(&campaign);
            let treasury = relief_chain::get_available_treasury(&campaign);
            let released = relief_chain::get_total_released(&campaign);

            assert!(raised == 700000, 204);
            assert!(treasury == 450000, 205);
            assert!(released == 250000, 206);
            assert!(raised == treasury + released, 207); // Perfect conservation!

            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::end(scenario_val);
    }
}

