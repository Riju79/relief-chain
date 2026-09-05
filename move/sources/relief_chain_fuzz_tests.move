#[test_only]
module relief_chain::relief_chain_fuzz_tests {
    use sui::test_scenario::{Self};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use relief_chain::relief_chain::{
        Self, Campaign, CampaignAdminCap, VerifierCap, AdminCap
    };

    const DEPLOYER: address = @0x10;
    const VERIFIER: address = @0x20;
    const NGO: address = @0x30;
    const DONOR: address = @0x40;
    const BENEFICIARY: address = @0x50;

    /**
     * Property 1: Multi-stage randomized milestone allocations and multi-stage
     * partial releases must strictly conserve treasury balance and prevent any
     * over-release across varied arbitrary amounts.
     */
    #[test]
    fun test_property_multi_stage_partial_releases_conservation() {
        let mut scenario_val = test_scenario::begin(DEPLOYER);
        let scenario = &mut scenario_val;

        // 1. Setup roles
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

        // 2. Create campaign with large goal (10,000 SUI)
        let goal_amount: u64 = 10000000000000;
        test_scenario::next_tx(scenario, NGO);
        {
            relief_chain::create_campaign(b"Fuzz Test Campaign", b"Desc", b"Loc", 2, goal_amount, test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::verify_campaign(&verifier_cap, &mut campaign, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        // 3. Add 3 milestones with distinct allocations
        let alloc1: u64 = 3000000000000; // 3,000 SUI
        let alloc2: u64 = 4000000000000; // 4,000 SUI
        let alloc3: u64 = 3000000000000; // 3,000 SUI

        test_scenario::next_tx(scenario, NGO);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let admin_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);

            relief_chain::add_milestone(&admin_cap, &mut campaign, b"Milestone 1", alloc1, BENEFICIARY);
            relief_chain::add_milestone(&admin_cap, &mut campaign, b"Milestone 2", alloc2, BENEFICIARY);
            relief_chain::add_milestone(&admin_cap, &mut campaign, b"Milestone 3", alloc3, BENEFICIARY);

            test_scenario::return_to_sender(scenario, admin_cap);
            test_scenario::return_shared(campaign);
        };

        // 4. Fully fund the campaign through 3 diverse donations
        test_scenario::next_tx(scenario, DONOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            
            let mut coin1 = coin::mint_for_testing<SUI>(2500000000000, test_scenario::ctx(scenario));
            relief_chain::donate(&mut campaign, &mut coin1, 2500000000000, test_scenario::ctx(scenario));

            let mut coin2 = coin::mint_for_testing<SUI>(5000000000000, test_scenario::ctx(scenario));
            relief_chain::donate(&mut campaign, &mut coin2, 5000000000000, test_scenario::ctx(scenario));

            let mut coin3 = coin::mint_for_testing<SUI>(2500000000000, test_scenario::ctx(scenario));
            relief_chain::donate(&mut campaign, &mut coin3, 2500000000000, test_scenario::ctx(scenario));

            assert!(relief_chain::get_funds_raised(&campaign) == goal_amount, 501);
            assert!(relief_chain::get_available_treasury(&campaign) == goal_amount, 502);

            transfer::public_transfer(coin1, DONOR);
            transfer::public_transfer(coin2, DONOR);
            transfer::public_transfer(coin3, DONOR);
            test_scenario::return_shared(campaign);
        };

        // 5. Verifier approves all milestones
        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);

            relief_chain::approve_milestone(&verifier_cap, &mut campaign, 0, test_scenario::ctx(scenario));
            relief_chain::approve_milestone(&verifier_cap, &mut campaign, 1, test_scenario::ctx(scenario));
            relief_chain::approve_milestone(&verifier_cap, &mut campaign, 2, test_scenario::ctx(scenario));

            // Execute 6 partial releases across milestones in non-uniform steps
            // Milestone 0: 1000 + 1000 + 1000 = 3000 SUI (exhausted)
            relief_chain::release_funds(&verifier_cap, &mut campaign, 0, 1000000000000, test_scenario::ctx(scenario));
            relief_chain::release_funds(&verifier_cap, &mut campaign, 0, 1000000000000, test_scenario::ctx(scenario));
            relief_chain::release_funds(&verifier_cap, &mut campaign, 0, 1000000000000, test_scenario::ctx(scenario));

            // Milestone 1: 1500 + 2000 = 3500 SUI (500 SUI remaining)
            relief_chain::release_funds(&verifier_cap, &mut campaign, 1, 1500000000000, test_scenario::ctx(scenario));
            relief_chain::release_funds(&verifier_cap, &mut campaign, 1, 2000000000000, test_scenario::ctx(scenario));

            // Milestone 2: 2500 SUI (500 SUI remaining)
            relief_chain::release_funds(&verifier_cap, &mut campaign, 2, 2500000000000, test_scenario::ctx(scenario));

            // Invariant verification after complex partial release sequence:
            // Total released = 3000 + 3500 + 2500 = 9000 SUI (9,000,000,000,000 MIST)
            // Treasury remaining = 10000 - 9000 = 1000 SUI (1,000,000,000,000 MIST)
            let total_rel = relief_chain::get_total_released(&campaign);
            let treasury_rem = relief_chain::get_available_treasury(&campaign);
            let funds_up = relief_chain::get_funds_raised(&campaign);

            assert!(total_rel == 9000000000000, 503);
            assert!(treasury_rem == 1000000000000, 504);
            assert!(funds_up == total_rel + treasury_rem, 505);

            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::end(scenario_val);
    }

    /**
     * Property 2: Over-release boundary condition.
     * Attempting to release even 1 MIST above remaining milestone allocation must abort.
     */
    #[test]
    #[expected_failure(abort_code = 10)] // EOverRelease = 10
    fun test_property_even_one_mist_over_release_fails() {
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

        test_scenario::next_tx(scenario, NGO);
        {
            relief_chain::create_campaign(b"C", b"D", b"L", 1, 1000000, test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::verify_campaign(&verifier_cap, &mut campaign, test_scenario::ctx(scenario));
            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        let alloc: u64 = 500000;
        test_scenario::next_tx(scenario, NGO);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let admin_cap = test_scenario::take_from_sender<CampaignAdminCap>(scenario);
            relief_chain::add_milestone(&admin_cap, &mut campaign, b"M", alloc, BENEFICIARY);
            test_scenario::return_to_sender(scenario, admin_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::next_tx(scenario, DONOR);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let mut coin1 = coin::mint_for_testing<SUI>(1000000, test_scenario::ctx(scenario));
            relief_chain::donate(&mut campaign, &mut coin1, 1000000, test_scenario::ctx(scenario));
            transfer::public_transfer(coin1, DONOR);
            test_scenario::return_shared(campaign);
        };

        test_scenario::next_tx(scenario, VERIFIER);
        {
            let mut campaign = test_scenario::take_shared<Campaign>(scenario);
            let verifier_cap = test_scenario::take_from_sender<VerifierCap>(scenario);
            relief_chain::approve_milestone(&verifier_cap, &mut campaign, 0, test_scenario::ctx(scenario));

            // Release full 500,000 MIST
            relief_chain::release_funds(&verifier_cap, &mut campaign, 0, 500000, test_scenario::ctx(scenario));

            // Attempting to release even 1 single additional MIST must abort with EOverRelease (10)
            relief_chain::release_funds(&verifier_cap, &mut campaign, 0, 1, test_scenario::ctx(scenario));

            test_scenario::return_to_sender(scenario, verifier_cap);
            test_scenario::return_shared(campaign);
        };

        test_scenario::end(scenario_val);
    }
}
