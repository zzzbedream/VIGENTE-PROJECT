#![cfg(test)]
//! =============================================================================
//! REFERENCE VAULT — Integration Tests (post Phase B threshold refactor)
//! =============================================================================
//!
//! Full lifecycle tests using vigente-badge + mock-usdc deployed in the same
//! Soroban test environment. Validates the cross-contract pattern end-to-end.
//!
//! After Phase B (k-of-n threshold signatures), `badge.mint()` no longer
//! accepts a single oracle Address. The test harness now generates 5 ed25519
//! keypairs, configures the badge with `set_oracle_keys`, and signs each
//! mint message off-chain (this mirrors what the production threshold oracle
//! will do in Tranche 1 / Phase C).
//! =============================================================================

extern crate std;

use crate::{ReferenceVault, ReferenceVaultClient};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::TokenClient,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, String, Vec,
};

use mock_usdc::{MockUsdc, MockUsdcClient};
use vigente_badge::{VigenteBadge, VigenteBadgeClient};

// =============================================================================
// THRESHOLD ORACLE HELPER — generates k-of-n ed25519 set, signs mint messages
// =============================================================================

const DEFAULT_THRESHOLD: u32 = 3;
const DEFAULT_ORACLE_COUNT: usize = 5;

struct OracleNode {
    signing_key: SigningKey,
    pubkey_bytes: [u8; 32],
}

struct OracleSet {
    nodes: std::vec::Vec<OracleNode>,
    threshold: u32,
}

impl OracleSet {
    fn generate(count: usize, threshold: u32) -> Self {
        let mut rng = OsRng;
        let mut nodes = std::vec::Vec::with_capacity(count);
        for _ in 0..count {
            let signing_key = SigningKey::generate(&mut rng);
            let pubkey_bytes = signing_key.verifying_key().to_bytes();
            nodes.push(OracleNode { signing_key, pubkey_bytes });
        }
        Self { nodes, threshold }
    }

    fn pubkeys_vec(&self, env: &Env) -> Vec<BytesN<32>> {
        let mut keys = Vec::new(env);
        for n in &self.nodes {
            keys.push_back(BytesN::from_array(env, &n.pubkey_bytes));
        }
        keys
    }

    /// Build the canonical message exactly as the badge contract does:
    /// borrower.to_xdr() || score.to_be_bytes() || expiration.to_be_bytes() || nonce
    fn build_message_bytes(
        env: &Env,
        borrower: &Address,
        score: u32,
        expiration: u64,
        nonce: &[u8; 32],
    ) -> std::vec::Vec<u8> {
        let xdr_bytes: Bytes = borrower.clone().to_xdr(env);
        let mut msg: std::vec::Vec<u8> = xdr_bytes.iter().collect();
        msg.extend_from_slice(&score.to_be_bytes());
        msg.extend_from_slice(&expiration.to_be_bytes());
        msg.extend_from_slice(nonce);
        msg
    }

    fn sign_first(
        &self,
        env: &Env,
        borrower: &Address,
        score: u32,
        expiration: u64,
        nonce: &[u8; 32],
        count: usize,
    ) -> Vec<(u32, BytesN<64>)> {
        let msg = Self::build_message_bytes(env, borrower, score, expiration, nonce);
        let mut out = Vec::new(env);
        for i in 0..count {
            let sig_bytes = self.nodes[i].signing_key.sign(&msg).to_bytes();
            out.push_back((i as u32, BytesN::from_array(env, &sig_bytes)));
        }
        out
    }
}

fn fresh_nonce(seed: u8) -> [u8; 32] {
    let mut n = [0u8; 32];
    n[0] = seed;
    n[31] = seed.wrapping_add(0x5A);
    n
}

// =============================================================================
// SETUP
// =============================================================================

const INITIAL_TIMESTAMP: u64 = 1_700_000_000;
const DEFAULT_LOAN_DURATION: u64 = 518_400; // 30 days
const DEFAULT_RATE_BPS: u32 = 500; // 5%
const POOL_SIZE: i128 = 100_000_0000000; // 100,000 USDC (7 decimals)

struct Harness<'a> {
    env: Env,
    #[allow(dead_code)]
    admin: Address,
    oracles: OracleSet,
    lp: Address,
    borrower: Address,
    #[allow(dead_code)]
    badge_id: Address,
    badge: VigenteBadgeClient<'a>,
    vault_id: Address,
    vault: ReferenceVaultClient<'a>,
    #[allow(dead_code)]
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

    // Deploy vigente-badge + configure k-of-n threshold oracle ACL
    let badge_id = env.register_contract(None, VigenteBadge);
    let badge = VigenteBadgeClient::new(&env, &badge_id);
    badge.initialize(&admin);
    let oracles = OracleSet::generate(DEFAULT_ORACLE_COUNT, DEFAULT_THRESHOLD);
    badge.set_oracle_keys(&oracles.pubkeys_vec(&env), &oracles.threshold);

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
        oracles,
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

/// Mint a credit badge for `borrower` using the threshold signature flow.
/// Uses the first `threshold` oracles in the set (any combination is valid
/// from the contract's perspective; the badge tests already cover non-contiguous
/// index selection separately).
fn mint_badge_threshold(
    h: &Harness,
    borrower: &Address,
    score: u32,
    expiration: u64,
    nonce_seed: u8,
) {
    let nonce = fresh_nonce(nonce_seed);
    let sigs = h.oracles.sign_first(
        &h.env,
        borrower,
        score,
        expiration,
        &nonce,
        h.oracles.threshold as usize,
    );
    h.badge.mint(
        borrower,
        &score,
        &expiration,
        &BytesN::from_array(&h.env, &nonce),
        &sigs,
    );
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

    // 2. Threshold oracle issues badge for borrower (Gold tier, score 850)
    mint_badge_threshold(&h, &h.borrower, 850, expiration, 1);
    assert_eq!(h.badge.get_score(&h.borrower), Some(850));

    // 3. Borrower takes a loan within their credit limit
    // max_loan = (100,000 / 10) * 850 / 1000 = 8,500 USDC
    let loan_amount = 5_000_0000000_i128; // 5,000 USDC
    h.vault.borrow(&h.borrower, &loan_amount);

    let loan = h.vault.get_loan(&h.borrower).unwrap();
    assert_eq!(loan.principal, loan_amount);
    assert_eq!(loan.score_at_origination, 850);
    assert!(!loan.repaid);

    let expected_borrower_balance = 50_000_0000000 + loan_amount;
    assert_eq!(h.token.balance(&h.borrower), expected_borrower_balance);

    // 4. Borrower repays in full
    h.vault.repay(&h.borrower);

    let loan = h.vault.get_loan(&h.borrower).unwrap();
    assert!(loan.repaid);

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
    mint_badge_threshold(&h, &h.borrower, 800, expiration, 2);

    let loan_amount = 3_000_0000000_i128;
    h.vault.borrow(&h.borrower, &loan_amount);

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

    assert!(h.badge.is_defaulted(&h.borrower));
    assert_eq!(h.badge.get_score(&h.borrower), None);
    let default_record = h.badge.get_default(&h.borrower).unwrap();
    assert_eq!(default_record.score_at_default, 800);
    assert_eq!(default_record.reason, 1);
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
    h.vault.borrow(&h.borrower, &1_000_0000000);
}

#[test]
#[should_panic(expected = "borrower is in default")]
fn test_borrow_when_defaulted_fails() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    mint_badge_threshold(&h, &h.borrower, 800, expiration, 3);
    h.vault.borrow(&h.borrower, &1_000_0000000);

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

    let borrower_again = h.borrower.clone();
    h.vault.borrow(&borrower_again, &500_0000000);
}

#[test]
#[should_panic(expected = "amount exceeds credit limit")]
fn test_borrow_above_limit_fails() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    mint_badge_threshold(&h, &h.borrower, 500, expiration, 4);

    // max_loan = (100,000 / 10) * 500 / 1000 = 5,000 USDC. Borrow 6,000 → panic.
    h.vault.borrow(&h.borrower, &6_000_0000000);
}

#[test]
#[should_panic(expected = "loan is not yet overdue")]
fn test_liquidate_before_due_fails() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    mint_badge_threshold(&h, &h.borrower, 800, expiration, 5);
    h.vault.borrow(&h.borrower, &1_000_0000000);

    let keeper = Address::generate(&h.env);
    h.vault.liquidate(&keeper, &h.borrower);
}

#[test]
#[should_panic(expected = "borrower has existing active loan")]
fn test_double_borrow_fails() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    mint_badge_threshold(&h, &h.borrower, 800, expiration, 6);
    h.vault.borrow(&h.borrower, &1_000_0000000);
    h.vault.borrow(&h.borrower, &500_0000000);
}

// =============================================================================
// VIEW FUNCTIONS
// =============================================================================

#[test]
fn test_max_loan_for_score_calculation() {
    let h = setup();
    h.vault.deposit(&h.lp, &POOL_SIZE);

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

    mint_badge_threshold(&h, &h.borrower, 800, expiration, 7);
    h.vault.borrow(&h.borrower, &5_000_0000000);
    assert_eq!(h.vault.get_available_liquidity(), POOL_SIZE - 5_000_0000000);

    h.vault.repay(&h.borrower);
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
    // Two mints in one test → distinct nonce seeds.
    mint_badge_threshold(&h, &h.borrower, 800, expiration, 8);
    mint_badge_threshold(&h, &other_borrower, 700, expiration, 9);

    h.vault.borrow(&h.borrower, &2_000_0000000);
    h.vault.borrow(&other_borrower, &1_000_0000000);

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

    assert!(h.badge.is_defaulted(&h.borrower));
    assert!(!h.badge.is_defaulted(&other_borrower));
    assert_eq!(h.badge.get_score(&other_borrower), Some(700));

    h.vault.repay(&other_borrower);
    let loan = h.vault.get_loan(&other_borrower).unwrap();
    assert!(loan.repaid);
}
