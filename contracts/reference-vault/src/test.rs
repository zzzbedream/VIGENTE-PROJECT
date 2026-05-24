#![cfg(test)]
//! =============================================================================
//! REFERENCE VAULT — Integration Tests
//! =============================================================================
//!
//! Full lifecycle tests using vigente-badge + mock-usdc deployed in the same
//! Soroban test environment. Validates the cross-contract pattern end-to-end.
//! =============================================================================

use crate::{ReferenceVault, ReferenceVaultClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::TokenClient,
    Address, Env, String,
};

use mock_usdc::{MockUsdc, MockUsdcClient};
use vigente_badge::{VigenteBadge, VigenteBadgeClient};

// =============================================================================
// SETUP
// =============================================================================

const INITIAL_TIMESTAMP: u64 = 1_700_000_000;
const DEFAULT_LOAN_DURATION: u64 = 518_400; // 30 days
const DEFAULT_RATE_BPS: u32 = 500; // 5%
const POOL_SIZE: i128 = 100_000_0000000; // 100,000 USDC (7 decimals)

struct Harness<'a> {
    env: Env,
    admin: Address,
    oracle: Address,
    lp: Address,
    borrower: Address,
    badge_id: Address,
    badge: VigenteBadgeClient<'a>,
    vault_id: Address,
    vault: ReferenceVaultClient<'a>,
    usdc_id: Address,
    usdc: MockUsdcClient<'a>,
    token: TokenClient<'a>,
}

fn setup() -> Harness<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(LedgerInfo {
        timestamp: INITIAL_TIMESTAMP,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 12_614_400,
    });

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let lp = Address::generate(&env);
    let borrower = Address::generate(&env);

    // Deploy USDC mock
    let usdc_id = env.register_contract(None, MockUsdc);
    let usdc = MockUsdcClient::new(&env, &usdc_id);
    usdc.initialize(
        &admin,
        &7_u32,
        &String::from_str(&env, "Mock USDC"),
        &String::from_str(&env, "USDC"),
    );
    let token = TokenClient::new(&env, &usdc_id);

    // Deploy vigente-badge
    let badge_id = env.register_contract(None, VigenteBadge);
    let badge = VigenteBadgeClient::new(&env, &badge_id);
    badge.initialize(&admin);
    badge.add_oracle(&oracle);

    // Deploy reference-vault
    let vault_id = env.register_contract(None, ReferenceVault);
    let vault = ReferenceVaultClient::new(&env, &vault_id);
    vault.initialize(
        &admin,
        &badge_id,
        &usdc_id,
        &DEFAULT_RATE_BPS,
        &DEFAULT_LOAN_DURATION,
    );

    // Register vault as authorized slasher in badge contract
    badge.add_vault(&vault_id);

    // Mint USDC: LP gets pool capital, borrower gets some to repay
    usdc.mint(&lp, &POOL_SIZE);
    usdc.mint(&borrower, &50_000_0000000); // 50k USDC for repayments

    Harness {
        env: env.clone(),
        admin,
        oracle,
        lp,
        borrower,
        badge_id,
        badge,
        vault_id,
        vault,
        usdc_id,
        usdc,
        token,
    }
}

// =============================================================================
// HAPPY PATH: deposit → mint badge → borrow → repay
// =============================================================================

#[test]
fn test_full_lifecycle_happy_path() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000; // 90 days

    // 1. LP deposits
    h.vault.deposit(&h.lp, &POOL_SIZE);
    assert_eq!(h.vault.get_total_deposits(), POOL_SIZE);
    assert_eq!(h.token.balance(&h.lp), 0);

    // 2. Oracle mints credit badge for borrower (Gold tier, score 850)
    h.badge.mint(&h.oracle, &h.borrower, &850_u32, &expiration);
    assert_eq!(h.badge.get_score(&h.borrower), Some(850));

    // 3. Borrower takes a loan within their credit limit
    // max_loan = (100,000 / 10) * 850 / 1000 = 8,500 USDC
    let loan_amount = 5_000_0000000_i128; // 5,000 USDC
    h.vault.borrow(&h.borrower, &loan_amount);

    let loan = h.vault.get_loan(&h.borrower).unwrap();
    assert_eq!(loan.principal, loan_amount);
    assert_eq!(loan.score_at_origination, 850);
    assert!(!loan.repaid);

    // Borrower received the funds
    let expected_borrower_balance = 50_000_0000000 + loan_amount;
    assert_eq!(h.token.balance(&h.borrower), expected_borrower_balance);

    // 4. Borrower repays in full (principal + interest)
    h.vault.repay(&h.borrower);

    let loan = h.vault.get_loan(&h.borrower).unwrap();
    assert!(loan.repaid);

    // Badge is intact after successful repayment
    assert!(!h.badge.is_defaulted(&h.borrower));
    assert_eq!(h.badge.get_score(&h.borrower), Some(850));
}

// =============================================================================
// DEFAULT PATH: borrow → loan expires → liquidate → slash propagates
// =============================================================================

#[test]
fn test_default_lifecycle_triggers_slash() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    h.badge.mint(&h.oracle, &h.borrower, &800_u32, &expiration);

    let loan_amount = 3_000_0000000_i128;
    h.vault.borrow(&h.borrower, &loan_amount);

    // Fast-forward past loan due date
    h.env.ledger().set(LedgerInfo {
        timestamp: INITIAL_TIMESTAMP + DEFAULT_LOAN_DURATION + 1,
        protocol_version: 22,
        sequence_number: 200,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 12_614_400,
    });

    // Anyone can liquidate an overdue loan
    let keeper = Address::generate(&h.env);
    h.vault.liquidate(&keeper, &h.borrower);

    // Badge slashed cross-contract
    assert!(h.badge.is_defaulted(&h.borrower));
    assert_eq!(h.badge.get_score(&h.borrower), None);
    let default_record = h.badge.get_default(&h.borrower).unwrap();
    assert_eq!(default_record.score_at_default, 800);
    assert_eq!(default_record.reason, 1); // non_payment
    assert_eq!(default_record.slashed_by, h.vault_id);
}

// =============================================================================
// REJECTIONS
// =============================================================================

#[test]
#[should_panic(expected = "no active credit badge")]
fn test_borrow_without_badge_fails() {
    let h = setup();
    h.vault.deposit(&h.lp, &POOL_SIZE);
    // No badge minted — borrow should panic
    h.vault.borrow(&h.borrower, &1_000_0000000);
}

#[test]
#[should_panic(expected = "borrower is in default")]
fn test_borrow_when_defaulted_fails() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    h.badge.mint(&h.oracle, &h.borrower, &800_u32, &expiration);
    h.vault.borrow(&h.borrower, &1_000_0000000);

    // Force default
    h.env.ledger().set(LedgerInfo {
        timestamp: INITIAL_TIMESTAMP + DEFAULT_LOAN_DURATION + 1,
        protocol_version: 22,
        sequence_number: 200,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 12_614_400,
    });
    let keeper = Address::generate(&h.env);
    h.vault.liquidate(&keeper, &h.borrower);

    // Subsequent borrow attempt must fail
    let another_borrower_address_for_reuse = h.borrower.clone();
    h.vault.borrow(&another_borrower_address_for_reuse, &500_0000000);
}

#[test]
#[should_panic(expected = "amount exceeds credit limit")]
fn test_borrow_above_limit_fails() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    h.badge.mint(&h.oracle, &h.borrower, &500_u32, &expiration);

    // max_loan = (100,000 / 10) * 500 / 1000 = 5,000 USDC
    // Try to borrow 6,000 — should panic
    h.vault.borrow(&h.borrower, &6_000_0000000);
}

#[test]
#[should_panic(expected = "loan is not yet overdue")]
fn test_liquidate_before_due_fails() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    h.badge.mint(&h.oracle, &h.borrower, &800_u32, &expiration);
    h.vault.borrow(&h.borrower, &1_000_0000000);

    // Try to liquidate immediately (before due_at)
    let keeper = Address::generate(&h.env);
    h.vault.liquidate(&keeper, &h.borrower);
}

#[test]
#[should_panic(expected = "borrower has existing active loan")]
fn test_double_borrow_fails() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    h.badge.mint(&h.oracle, &h.borrower, &800_u32, &expiration);
    h.vault.borrow(&h.borrower, &1_000_0000000);
    // Second borrow without repaying should fail
    h.vault.borrow(&h.borrower, &500_0000000);
}

// =============================================================================
// VIEW FUNCTIONS
// =============================================================================

#[test]
fn test_max_loan_for_score_calculation() {
    let h = setup();
    h.vault.deposit(&h.lp, &POOL_SIZE);

    // available = 100k, per_borrower_cap = 10k, max for score 850 = 8,500 USDC
    let max = h.vault.max_loan_for_score(&850_u32);
    assert_eq!(max, 8_500_0000000_i128);

    let max_zero = h.vault.max_loan_for_score(&0_u32);
    assert_eq!(max_zero, 0);
}

#[test]
fn test_available_liquidity_updates_correctly() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    assert_eq!(h.vault.get_available_liquidity(), POOL_SIZE);

    h.badge.mint(&h.oracle, &h.borrower, &800_u32, &expiration);
    h.vault.borrow(&h.borrower, &5_000_0000000);
    assert_eq!(h.vault.get_available_liquidity(), POOL_SIZE - 5_000_0000000);

    h.vault.repay(&h.borrower);
    // After repay: principal returns, interest added to deposits → liquidity slightly higher
    let interest = 5_000_0000000_i128 * 500 / 10_000;
    assert_eq!(h.vault.get_available_liquidity(), POOL_SIZE + interest);
}

// =============================================================================
// MULTI-USER ISOLATION
// =============================================================================

#[test]
fn test_multi_user_default_isolated() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    let other_borrower = Address::generate(&h.env);
    h.usdc.mint(&other_borrower, &10_000_0000000);

    h.vault.deposit(&h.lp, &POOL_SIZE);
    h.badge.mint(&h.oracle, &h.borrower, &800_u32, &expiration);
    h.badge.mint(&h.oracle, &other_borrower, &700_u32, &expiration);

    // Both borrow
    h.vault.borrow(&h.borrower, &2_000_0000000);
    h.vault.borrow(&other_borrower, &1_000_0000000);

    // Force default on first borrower
    h.env.ledger().set(LedgerInfo {
        timestamp: INITIAL_TIMESTAMP + DEFAULT_LOAN_DURATION + 1,
        protocol_version: 22,
        sequence_number: 200,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 12_614_400,
    });
    let keeper = Address::generate(&h.env);
    h.vault.liquidate(&keeper, &h.borrower);

    // First borrower is slashed
    assert!(h.badge.is_defaulted(&h.borrower));
    // Other borrower's badge is intact
    assert!(!h.badge.is_defaulted(&other_borrower));
    assert_eq!(h.badge.get_score(&other_borrower), Some(700));

    // Other borrower can still repay successfully
    h.vault.repay(&other_borrower);
    let loan = h.vault.get_loan(&other_borrower).unwrap();
    assert!(loan.repaid);
}
