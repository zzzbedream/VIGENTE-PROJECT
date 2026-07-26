#![cfg(test)]
//! Unit tests for VIGENTE PROTOCOL CreditBadge functionality
//! 
//! These tests verify the core badge minting and update operations
//! to ensure reliability before production deployment.

use crate::{VigenteProtocol, VigenteProtocolClient};
use soroban_sdk::{
    testutils::Address as _, 
    Address, BytesN, Env
};

/// Helper function to setup a fresh contract environment for testing
fn setup_test_contract(env: &Env) -> (Address, Address, VigenteProtocolClient) {
    // Register the contract
    let contract_id = env.register_contract(None, VigenteProtocol);
    let client = VigenteProtocolClient::new(env, &contract_id);
    
    // Generate admin and user addresses
    let admin = Address::generate(env);
    let user = Address::generate(env);
    
    // Mock all auth for testing
    env.mock_all_auths();
    
    // Initialize the contract with admin
    client.initialize(&admin);
    
    (admin, user, client)
}

/// Helper function to create a mock data hash for testing
fn mock_data_hash(env: &Env, seed: u8) -> BytesN<32> {
    let mut bytes = [seed; 32];
    bytes[0] = seed;
    BytesN::from_array(env, &bytes)
}

// =============================================================================
// TEST CASE 1: Mint Gold Badge (Tier 1)
// =============================================================================

#[test]
fn test_mint_gold() {
    let env = Env::default();
    let (_admin, user, client) = setup_test_contract(&env);
    
    // ARRANGE: Prepare Tier 1 (Gold) badge parameters
    let tier = 1u32;
    let score = 950u32;
    let data_hash = mock_data_hash(&env, 0xAA);
    
    // ACT: Mint a Gold badge
    let badge = client.mint_badge(&user, &tier, &score, &data_hash);
    
    // ASSERT: Verify badge properties
    assert_eq!(badge.tier, tier, "Badge tier should be 1 (Gold)");
    assert_eq!(badge.score, score, "Badge score should be 950");
    assert_eq!(badge.data_hash, data_hash, "Data hash should match");
    assert!(badge.expires_at > badge.issued_at, "Expiration should be after issuance");
    
    // ASSERT: Verify badge is retrievable from storage
    let stored_badge = client.verify_badge(&user);
    assert!(stored_badge.is_some(), "Badge should exist in storage");
    assert_eq!(stored_badge.unwrap().tier, tier, "Stored badge tier should match");
    
    // ASSERT: Verify get_tier helper function
    let tier_result = client.get_tier(&user);
    assert_eq!(tier_result, tier, "get_tier should return 1 for Gold badge");
}

// =============================================================================
// TEST CASE 2: Mint Silver Badge (Tier 2)
// =============================================================================

#[test]
fn test_mint_silver() {
    let env = Env::default();
    let (_admin, user, client) = setup_test_contract(&env);
    
    // ARRANGE: Prepare Tier 2 (Silver) badge parameters
    let tier = 2u32;
    let score = 650u32;
    let data_hash = mock_data_hash(&env, 0xBB);
    
    // ACT: Mint a Silver badge
    let badge = client.mint_badge(&user, &tier, &score, &data_hash);
    
    // ASSERT: Verify badge properties
    assert_eq!(badge.tier, tier, "Badge tier should be 2 (Silver)");
    assert_eq!(badge.score, score, "Badge score should be 650");
    assert_eq!(badge.data_hash, data_hash, "Data hash should match");
    
    // ASSERT: Verify badge is retrievable and has correct tier
    let stored_badge = client.verify_badge(&user);
    assert!(stored_badge.is_some(), "Badge should exist in storage");
    assert_eq!(stored_badge.unwrap().tier, tier, "Stored badge tier should be 2");
    
    // ASSERT: Verify get_tier returns correct value
    let tier_result = client.get_tier(&user);
    assert_eq!(tier_result, tier, "get_tier should return 2 for Silver badge");
}

// =============================================================================
// TEST CASE 3: Update Badge (Tier 2 → Tier 1 Upgrade)
// =============================================================================

#[test]
fn test_update_badge() {
    let env = Env::default();
    let (_admin, user, client) = setup_test_contract(&env);
    
    // ARRANGE: First mint a Tier 2 (Silver) badge
    let initial_tier = 2u32;
    let initial_score = 650u32;
    let initial_hash = mock_data_hash(&env, 0xCC);
    
    // ACT: Mint initial Silver badge
    let initial_badge = client.mint_badge(&user, &initial_tier, &initial_score, &initial_hash);
    
    // ASSERT: Verify initial badge
    assert_eq!(initial_badge.tier, initial_tier, "Initial badge should be Tier 2");
    assert_eq!(client.get_tier(&user), initial_tier, "User should have Tier 2");
    
    // ARRANGE: Prepare upgrade to Tier 1 (Gold)
    let upgraded_tier = 1u32;
    let upgraded_score = 920u32;
    let upgraded_hash = mock_data_hash(&env, 0xDD);
    
    // ACT: Mint new badge (this should overwrite the previous one)
    let upgraded_badge = client.mint_badge(&user, &upgraded_tier, &upgraded_score, &upgraded_hash);
    
    // ASSERT: Verify the badge was updated (not duplicated)
    assert_eq!(upgraded_badge.tier, upgraded_tier, "Badge should be upgraded to Tier 1");
    assert_eq!(upgraded_badge.score, upgraded_score, "Score should be updated to 920");
    assert_eq!(upgraded_badge.data_hash, upgraded_hash, "Data hash should be new hash");
    
    // ASSERT: Verify storage contains ONLY the new badge
    let current_badge = client.verify_badge(&user);
    assert!(current_badge.is_some(), "Badge should still exist");
    let current = current_badge.unwrap();
    assert_eq!(current.tier, upgraded_tier, "Current tier should be 1 (upgraded)");
    assert_eq!(current.score, upgraded_score, "Current score should be 920");
    // Note: In mock env, timestamps may be the same - we verify by checking the data changed
    assert_eq!(current.data_hash, upgraded_hash, "Data hash should reflect the upgrade");
    
    // ASSERT: Verify get_tier reflects the upgrade
    let final_tier = client.get_tier(&user);
    assert_eq!(final_tier, upgraded_tier, "get_tier should return 1 after upgrade");
}

// =============================================================================
// ADDITIONAL TEST: Multiple Users
// =============================================================================

#[test]
fn test_multiple_users_independent_badges() {
    let env = Env::default();
    let (_admin, user1, client) = setup_test_contract(&env);
    let user2 = Address::generate(&env);
    
    // Mint different badges for different users
    client.mint_badge(&user1, &1u32, &900u32, &mock_data_hash(&env, 0x11));
    client.mint_badge(&user2, &3u32, &400u32, &mock_data_hash(&env, 0x22));
    
    // Verify each user has their own badge
    assert_eq!(client.get_tier(&user1), 1, "User 1 should have Tier 1");
    assert_eq!(client.get_tier(&user2), 3, "User 2 should have Tier 3");
}

// =============================================================================
// ADDITIONAL TEST: Invalid Parameters
// =============================================================================

#[test]
#[should_panic(expected = "Invalid tier")]
fn test_invalid_tier_fails() {
    let env = Env::default();
    let (_admin, user, client) = setup_test_contract(&env);
    
    // Try to mint with invalid tier (5 > 4)
    client.mint_badge(&user, &5u32, &500u32, &mock_data_hash(&env, 0xFF));
}

#[test]
#[should_panic(expected = "Invalid score")]
fn test_invalid_score_fails() {
    let env = Env::default();
    let (_admin, user, client) = setup_test_contract(&env);
    
    // Try to mint with invalid score (1500 > 1000)
    client.mint_badge(&user, &1u32, &1500u32, &mock_data_hash(&env, 0xFF));
}
