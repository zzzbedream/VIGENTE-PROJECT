#![cfg(test)]
//! =============================================================================
//! VIGENTE BADGE — Comprehensive Test Suite
//! =============================================================================
//!
//! Target coverage: >90% of all contract functions and error paths.
//!
//! Test categories:
//!   1. Initialization
//!   2. Access Control (ACL)
//!   3. Mint (happy path + error paths)
//!   4. Slash (happy path + error paths)
//!   5. Query functions (is_defaulted, get_score, get_badge)
//!   6. Circuit breaker (pause/unpause)
//!   7. Edge cases & integration scenarios
//! =============================================================================

use crate::{VigenteBadge, VigenteBadgeClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

// =============================================================================
// TEST HELPERS
// =============================================================================

fn setup(env: &Env) -> (Address, Address, Address, Address, VigenteBadgeClient) {
    let contract_id = env.register_contract(None, VigenteBadge);
    let client = VigenteBadgeClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let oracle = Address::generate(env);
    let vault = Address::generate(env);
    let borrower = Address::generate(env);

    env.mock_all_auths();

    // Initialize + set up ACL
    client.initialize(&admin);
    client.add_oracle(&oracle);
    client.add_vault(&vault);

    // Set ledger timestamp to a realistic value
    env.ledger().set(LedgerInfo {
        timestamp: 1_700_000_000,
        protocol_version: 21,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 12_614_400,
    });

    (admin, oracle, vault, borrower, client)
}

// Expiration 90 days from the default test timestamp
const DEFAULT_EXPIRATION: u64 = 1_700_000_000 + 7_776_000;

// =============================================================================
// 1. INITIALIZATION
// =============================================================================

#[test]
fn test_initialize_success() {
    let env = Env::default();
    let contract_id = env.register_contract(None, VigenteBadge);
    let client = VigenteBadgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin);

    let stored_admin = client.get_admin();
    assert_eq!(stored_admin, admin);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_fails() {
    let env = Env::default();
    let contract_id = env.register_contract(None, VigenteBadge);
    let client = VigenteBadgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin);
    client.initialize(&admin); // Should panic
}

// =============================================================================
// 2. ACCESS CONTROL
// =============================================================================

#[test]
fn test_add_and_remove_oracle() {
    let env = Env::default();
    let (_, _, _, borrower, client) = setup(&env);
    let new_oracle = Address::generate(&env);

    // Add new oracle
    client.add_oracle(&new_oracle);

    // New oracle can mint
    let badge = client.mint(&new_oracle, &borrower, &800, &DEFAULT_EXPIRATION);
    assert_eq!(badge.score, 800);

    // Remove the oracle
    client.remove_oracle(&new_oracle);
}

#[test]
fn test_add_and_remove_vault() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);
    let new_vault = Address::generate(&env);

    // Add new vault
    client.add_vault(&new_vault);

    // Mint a badge first
    client.mint(&oracle, &borrower, &700, &DEFAULT_EXPIRATION);

    // New vault can slash
    client.slash(&new_vault, &borrower, &1);

    assert!(client.is_defaulted(&borrower));
}

#[test]
#[should_panic(expected = "caller is not an authorized oracle")]
fn test_unauthorized_oracle_cannot_mint() {
    let env = Env::default();
    let (_, _, _, borrower, client) = setup(&env);
    let unauthorized = Address::generate(&env);

    client.mint(&unauthorized, &borrower, &500, &DEFAULT_EXPIRATION);
}

#[test]
#[should_panic(expected = "caller is not an authorized vault")]
fn test_unauthorized_vault_cannot_slash() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);
    let unauthorized = Address::generate(&env);

    client.mint(&oracle, &borrower, &500, &DEFAULT_EXPIRATION);
    client.slash(&unauthorized, &borrower, &0);
}

// =============================================================================
// 3. MINT — HAPPY PATH
// =============================================================================

#[test]
fn test_mint_gold_badge() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);

    let badge = client.mint(&oracle, &borrower, &950, &DEFAULT_EXPIRATION);

    assert_eq!(badge.score, 950);
    assert_eq!(badge.issued_at, 1_700_000_000);
    assert_eq!(badge.expires_at, DEFAULT_EXPIRATION);
    assert!(!badge.slashed);
}

#[test]
fn test_mint_returns_score_via_get_score() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);

    client.mint(&oracle, &borrower, &750, &DEFAULT_EXPIRATION);

    let score = client.get_score(&borrower);
    assert_eq!(score, Some(750));
}

#[test]
fn test_mint_badge_retrievable() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);

    client.mint(&oracle, &borrower, &600, &DEFAULT_EXPIRATION);

    let badge = client.get_badge(&borrower);
    assert!(badge.is_some());
    let b = badge.unwrap();
    assert_eq!(b.score, 600);
    assert!(!b.slashed);
}

#[test]
fn test_mint_overwrites_previous_badge() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);

    client.mint(&oracle, &borrower, &500, &DEFAULT_EXPIRATION);
    assert_eq!(client.get_score(&borrower), Some(500));

    // Mint again with higher score
    client.mint(&oracle, &borrower, &900, &DEFAULT_EXPIRATION);
    assert_eq!(client.get_score(&borrower), Some(900));
}

// =============================================================================
// 3b. MINT — ERROR PATHS
// =============================================================================

#[test]
#[should_panic(expected = "invalid score")]
fn test_mint_score_too_high() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);
    client.mint(&oracle, &borrower, &1500, &DEFAULT_EXPIRATION);
}

#[test]
#[should_panic(expected = "expiration must be in the future")]
fn test_mint_expired_timestamp() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);
    // Timestamp in the past
    client.mint(&oracle, &borrower, &500, &1_600_000_000);
}

#[test]
#[should_panic(expected = "borrower is in default")]
fn test_mint_defaulted_borrower_fails() {
    let env = Env::default();
    let (_, oracle, vault, borrower, client) = setup(&env);

    // Mint and then slash
    client.mint(&oracle, &borrower, &500, &DEFAULT_EXPIRATION);
    client.slash(&vault, &borrower, &1);

    // Attempt to mint again should fail
    client.mint(&oracle, &borrower, &800, &DEFAULT_EXPIRATION);
}

// =============================================================================
// 4. SLASH — HAPPY PATH
// =============================================================================

#[test]
fn test_slash_marks_badge_as_slashed() {
    let env = Env::default();
    let (_, oracle, vault, borrower, client) = setup(&env);

    client.mint(&oracle, &borrower, &700, &DEFAULT_EXPIRATION);
    client.slash(&vault, &borrower, &1);

    // Badge should be gone (get_badge returns None for slashed)
    assert!(client.get_badge(&borrower).is_none());
    // Score should be None
    assert!(client.get_score(&borrower).is_none());
}

#[test]
fn test_slash_creates_default_record() {
    let env = Env::default();
    let (_, oracle, vault, borrower, client) = setup(&env);

    client.mint(&oracle, &borrower, &700, &DEFAULT_EXPIRATION);
    client.slash(&vault, &borrower, &2); // reason: fraud

    let default = client.get_default(&borrower);
    assert!(default.is_some());
    let d = default.unwrap();
    assert_eq!(d.score_at_default, 700);
    assert_eq!(d.reason, 2);
    assert_eq!(d.slashed_by, vault);
}

#[test]
fn test_slash_sets_is_defaulted_true() {
    let env = Env::default();
    let (_, oracle, vault, borrower, client) = setup(&env);

    // Before: not defaulted
    assert!(!client.is_defaulted(&borrower));

    client.mint(&oracle, &borrower, &700, &DEFAULT_EXPIRATION);
    client.slash(&vault, &borrower, &0);

    // After: defaulted
    assert!(client.is_defaulted(&borrower));
}

// =============================================================================
// 4b. SLASH — ERROR PATHS
// =============================================================================

#[test]
#[should_panic(expected = "no active badge to slash")]
fn test_slash_no_badge_fails() {
    let env = Env::default();
    let (_, _, vault, borrower, client) = setup(&env);
    client.slash(&vault, &borrower, &0);
}

#[test]
#[should_panic(expected = "badge already slashed")]
fn test_slash_twice_fails() {
    let env = Env::default();
    let (_, oracle, vault, borrower, client) = setup(&env);

    client.mint(&oracle, &borrower, &500, &DEFAULT_EXPIRATION);
    client.slash(&vault, &borrower, &1);
    client.slash(&vault, &borrower, &1); // Should panic
}

#[test]
#[should_panic(expected = "invalid reason code")]
fn test_slash_invalid_reason_fails() {
    let env = Env::default();
    let (_, oracle, vault, borrower, client) = setup(&env);

    client.mint(&oracle, &borrower, &500, &DEFAULT_EXPIRATION);
    client.slash(&vault, &borrower, &5); // reason > 3
}

// =============================================================================
// 5. QUERY FUNCTIONS
// =============================================================================

#[test]
fn test_is_defaulted_returns_false_for_unknown_address() {
    let env = Env::default();
    let (_, _, _, _, client) = setup(&env);
    let unknown = Address::generate(&env);
    assert!(!client.is_defaulted(&unknown));
}

#[test]
fn test_get_score_returns_none_for_unknown_address() {
    let env = Env::default();
    let (_, _, _, _, client) = setup(&env);
    let unknown = Address::generate(&env);
    assert!(client.get_score(&unknown).is_none());
}

#[test]
fn test_get_score_returns_none_after_expiry() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);

    // Mint with short expiration
    let short_expiry = 1_700_000_000 + 100;
    client.mint(&oracle, &borrower, &800, &short_expiry);

    // Advance ledger past expiration
    env.ledger().set(LedgerInfo {
        timestamp: 1_700_000_000 + 200,
        protocol_version: 21,
        sequence_number: 200,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 12_614_400,
    });

    assert!(client.get_score(&borrower).is_none());
    assert!(client.get_badge(&borrower).is_none());
}

#[test]
fn test_get_default_returns_none_for_non_defaulted() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);

    client.mint(&oracle, &borrower, &600, &DEFAULT_EXPIRATION);
    assert!(client.get_default(&borrower).is_none());
}

// =============================================================================
// 6. CIRCUIT BREAKER
// =============================================================================

#[test]
#[should_panic(expected = "contract is paused")]
fn test_mint_while_paused_fails() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);

    client.pause();
    client.mint(&oracle, &borrower, &500, &DEFAULT_EXPIRATION);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_slash_while_paused_fails() {
    let env = Env::default();
    let (_, oracle, vault, borrower, client) = setup(&env);

    client.mint(&oracle, &borrower, &500, &DEFAULT_EXPIRATION);
    client.pause();
    client.slash(&vault, &borrower, &1);
}

#[test]
fn test_unpause_resumes_operations() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);

    client.pause();
    client.unpause();

    // Should work after unpause
    let badge = client.mint(&oracle, &borrower, &500, &DEFAULT_EXPIRATION);
    assert_eq!(badge.score, 500);
}

// =============================================================================
// 7. INTEGRATION SCENARIOS
// =============================================================================

#[test]
fn test_full_lifecycle_mint_then_slash() {
    let env = Env::default();
    let (_, oracle, vault, borrower, client) = setup(&env);

    // Step 1: Mint
    let badge = client.mint(&oracle, &borrower, &850, &DEFAULT_EXPIRATION);
    assert_eq!(badge.score, 850);
    assert!(!client.is_defaulted(&borrower));
    assert_eq!(client.get_score(&borrower), Some(850));

    // Step 2: Slash
    client.slash(&vault, &borrower, &1); // non_payment

    // Step 3: Verify aftermath
    assert!(client.is_defaulted(&borrower));
    assert!(client.get_score(&borrower).is_none());
    assert!(client.get_badge(&borrower).is_none());

    let default = client.get_default(&borrower).unwrap();
    assert_eq!(default.score_at_default, 850);
    assert_eq!(default.reason, 1);
}

#[test]
fn test_multiple_borrowers_independent() {
    let env = Env::default();
    let (_, oracle, vault, borrower1, client) = setup(&env);
    let borrower2 = Address::generate(&env);

    // Mint for both
    client.mint(&oracle, &borrower1, &900, &DEFAULT_EXPIRATION);
    client.mint(&oracle, &borrower2, &600, &DEFAULT_EXPIRATION);

    // Slash only borrower1
    client.slash(&vault, &borrower1, &1);

    // borrower1 is defaulted, borrower2 is not
    assert!(client.is_defaulted(&borrower1));
    assert!(!client.is_defaulted(&borrower2));

    // borrower2 still has score
    assert_eq!(client.get_score(&borrower2), Some(600));
    assert!(client.get_score(&borrower1).is_none());
}

#[test]
fn test_zero_score_badge_is_valid() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);

    let badge = client.mint(&oracle, &borrower, &0, &DEFAULT_EXPIRATION);
    assert_eq!(badge.score, 0);
    assert_eq!(client.get_score(&borrower), Some(0));
}

#[test]
fn test_max_score_badge() {
    let env = Env::default();
    let (_, oracle, _, borrower, client) = setup(&env);

    let badge = client.mint(&oracle, &borrower, &1000, &DEFAULT_EXPIRATION);
    assert_eq!(badge.score, 1000);
    assert_eq!(client.get_score(&borrower), Some(1000));
}
