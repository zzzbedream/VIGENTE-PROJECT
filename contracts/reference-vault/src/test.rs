#![cfg(test)]
//! =============================================================================
//! REFERENCE VAULT — Integration Tests (Phase B' threat-model hardening)
//! =============================================================================
//!
//! Coverage:
//!   - Cross-contract happy path (mint via threshold sigs → borrow → repay).
//!   - Default cascade (liquidate → cross-contract slash).
//!   - Phase B'.3 credit ladder (first loan throttled to 10% of ceiling,
//!     full ceiling unlocks after the first successful repay).
//!   - Phase B'.4 TVL cap & utilization cap rejections.
//!   - Phase B'.5 LP withdrawal request → timelock → claim flow.
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
// THRESHOLD ORACLE HELPER
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

    fn build_message_bytes(
        env: &Env,
        borrower: &Address,
        score: u32,
        expiration: u64,
        account_age_days: u32,
        nonce: &[u8; 32],
    ) -> std::vec::Vec<u8> {
        let xdr_bytes: Bytes = borrower.clone().to_xdr(env);
        let mut msg: std::vec::Vec<u8> = xdr_bytes.iter().collect();
        msg.extend_from_slice(&score.to_be_bytes());
        msg.extend_from_slice(&expiration.to_be_bytes());
        msg.extend_from_slice(&account_age_days.to_be_bytes());
        msg.extend_from_slice(nonce);
        msg
    }

    fn sign_first(
        &self,
        env: &Env,
        borrower: &Address,
        score: u32,
        expiration: u64,
        account_age_days: u32,
        nonce: &[u8; 32],
        count: usize,
    ) -> Vec<(u32, BytesN<64>)> {
        let msg = Self::build_message_bytes(env, borrower, score, expiration, account_age_days, nonce);
        let mut out = Vec::new(env);
        for i in 0..count {
            let sig_bytes = self.nodes[i].signing_key.sign(&msg).to_bytes();
            out.push_back((i as u32, BytesN::from_array(env, &sig_bytes)));
        }
        out
    }
}

const DEFAULT_AGE_DAYS: u32 = 60;

fn fresh_nonce(seed: u8) -> [u8; 32] {
    let mut n = [0u8; 32];
    n[0] = seed;
    n[31] = seed.wrapping_add(0x5A);
    n
}

// =============================================================================
// SETUP & CONSTANTS
// =============================================================================

const INITIAL_TIMESTAMP: u64 = 1_700_000_000;
const DEFAULT_LOAN_DURATION: u64 = 518_400; // 30 days
const DEFAULT_RATE_BPS: u32 = 500; // 5%
const POOL_SIZE: i128 = 100_000_0000000; // 100,000 USDC (7 decimals)
/// 10M USDC headroom — well above POOL_SIZE so the cap doesn't fire in most tests.
const DEFAULT_MAX_TVL: i128 = 10_000_000_0000000;
const DAY: u64 = 24 * 60 * 60;

// Helper: convert "X USDC" to stroops at 7-decimal precision.
fn usdc(amount: i128) -> i128 {
    amount * 10_000_000
}

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
    setup_with(DEFAULT_MAX_TVL, 0_u32, 0_u64)
}

fn setup_with(max_tvl: i128, max_util_bps: u32, withdrawal_timelock: u64) -> Harness<'static> {
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

    let usdc_id = env.register_contract(None, MockUsdc);
    let usdc = MockUsdcClient::new(&env, &usdc_id);
    usdc.initialize(
        &admin,
        &7_u32,
        &String::from_str(&env, "Mock USDC"),
        &String::from_str(&env, "USDC"),
    );
    let token = TokenClient::new(&env, &usdc_id);

    let badge_id = env.register_contract(None, VigenteBadge);
    let badge = VigenteBadgeClient::new(&env, &badge_id);
    badge.initialize(&admin);
    let oracles = OracleSet::generate(DEFAULT_ORACLE_COUNT, DEFAULT_THRESHOLD);
    badge.set_oracle_keys(&oracles.pubkeys_vec(&env), &oracles.threshold);

    let vault_id = env.register_contract(None, ReferenceVault);
    let vault = ReferenceVaultClient::new(&env, &vault_id);
    vault.initialize(
        &admin,
        &badge_id,
        &usdc_id,
        &DEFAULT_RATE_BPS,
        &DEFAULT_LOAN_DURATION,
        &max_tvl,
        &max_util_bps,
        &withdrawal_timelock,
    );

    badge.add_vault(&vault_id);

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
        DEFAULT_AGE_DAYS,
        &nonce,
        h.oracles.threshold as usize,
    );
    h.badge.mint(
        borrower,
        &score,
        &expiration,
        &DEFAULT_AGE_DAYS,
        &BytesN::from_array(&h.env, &nonce),
        &sigs,
    );
}

// =============================================================================
// HAPPY PATH: deposit → mint badge → small first loan → repay
// =============================================================================

#[test]
fn test_full_lifecycle_happy_path() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000; // 90 days

    h.vault.deposit(&h.lp, &POOL_SIZE);
    assert_eq!(h.vault.get_total_deposits(), POOL_SIZE);
    assert_eq!(h.token.balance(&h.lp), 0);

    // Gold score 850. score_anchored = $2000 × 0.85 = $1700.
    // First loan cap = $170. We borrow $150 to stay safely under.
    mint_badge_threshold(&h, &h.borrower, 850, expiration, 1);
    let loan_amount = usdc(150);
    h.vault.borrow(&h.borrower, &loan_amount);

    let loan = h.vault.get_loan(&h.borrower).unwrap();
    assert_eq!(loan.principal, loan_amount);
    assert_eq!(loan.score_at_origination, 850);
    assert!(!loan.repaid);

    let expected_borrower_balance = 50_000_0000000 + loan_amount;
    assert_eq!(h.token.balance(&h.borrower), expected_borrower_balance);

    h.vault.repay(&h.borrower);

    let loan = h.vault.get_loan(&h.borrower).unwrap();
    assert!(loan.repaid);

    assert!(!h.badge.is_defaulted(&h.borrower));
    assert_eq!(h.badge.get_score(&h.borrower), Some(850));
    // Repay should have bumped the ladder counter to 1.
    assert_eq!(h.vault.get_repay_count(&h.borrower), 1);
}

// =============================================================================
// DEFAULT PATH: small first loan that misses its due date → liquidate → slash
// =============================================================================

#[test]
fn test_default_lifecycle_triggers_slash() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    mint_badge_threshold(&h, &h.borrower, 800, expiration, 2);
    // Score 800 Gold → score_anchored $1600 → first loan cap $160. Borrow $150.
    h.vault.borrow(&h.borrower, &usdc(150));

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
// REJECTIONS — pre-existing behaviors preserved post-refactor
// =============================================================================

#[test]
#[should_panic(expected = "no active credit badge")]
fn test_borrow_without_badge_fails() {
    let h = setup();
    h.vault.deposit(&h.lp, &POOL_SIZE);
    h.vault.borrow(&h.borrower, &usdc(50));
}

#[test]
#[should_panic(expected = "borrower is in default")]
fn test_borrow_when_defaulted_fails() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    mint_badge_threshold(&h, &h.borrower, 800, expiration, 3);
    // Small first loan within ladder.
    h.vault.borrow(&h.borrower, &usdc(50));

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

    // After default, ANY borrow attempt (even within cap) should panic with
    // "borrower is in default" — the default check fires first in borrow().
    let borrower_again = h.borrower.clone();
    h.vault.borrow(&borrower_again, &usdc(5));
}

#[test]
#[should_panic(expected = "amount exceeds credit limit")]
fn test_borrow_above_limit_fails() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    mint_badge_threshold(&h, &h.borrower, 500, expiration, 4);
    // Score 500 Bronze. score_anchored = $100 × 0.5 = $50. First loan = $5.
    // Borrowing $50 (10× the first-loan cap) must fail.
    h.vault.borrow(&h.borrower, &usdc(50));
}

#[test]
#[should_panic(expected = "loan is not yet overdue")]
fn test_liquidate_before_due_fails() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    mint_badge_threshold(&h, &h.borrower, 800, expiration, 5);
    h.vault.borrow(&h.borrower, &usdc(100));

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
    h.vault.borrow(&h.borrower, &usdc(100));
    h.vault.borrow(&h.borrower, &usdc(20));
}

// =============================================================================
// VIEW FUNCTIONS — credit ladder math
// =============================================================================

#[test]
fn test_max_loan_for_score_uses_tier_ceiling() {
    let h = setup();
    h.vault.deposit(&h.lp, &POOL_SIZE);

    // Score 850 Gold. score_anchored = $2000 × 0.85 = $1700. per_pool = $10k.
    // min($1700, $10k) = $1700.
    assert_eq!(h.vault.max_loan_for_score(&850_u32), usdc(1_700));

    // Score 700 Silver. score_anchored = $500 × 0.7 = $350. min($350, $10k) = $350.
    assert_eq!(h.vault.max_loan_for_score(&700_u32), usdc(350));

    // Score 0 → 0.
    assert_eq!(h.vault.max_loan_for_score(&0_u32), 0);

    // Score 200 (below Bronze floor) → 0.
    assert_eq!(h.vault.max_loan_for_score(&200_u32), 0);
}

#[test]
fn test_max_loan_for_borrower_applies_first_loan_throttle() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    mint_badge_threshold(&h, &h.borrower, 850, expiration, 50);

    // First time → 10% of $1700 = $170.
    assert_eq!(h.vault.max_loan_for_borrower(&h.borrower), usdc(170));

    // After one repay, the ladder lifts to the full $1700.
    h.vault.borrow(&h.borrower, &usdc(150));
    h.vault.repay(&h.borrower);
    assert_eq!(h.vault.get_repay_count(&h.borrower), 1);
    assert_eq!(h.vault.max_loan_for_borrower(&h.borrower), usdc(1_700));
}

#[test]
fn test_available_liquidity_updates_correctly() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;

    h.vault.deposit(&h.lp, &POOL_SIZE);
    assert_eq!(h.vault.get_available_liquidity(), POOL_SIZE);

    mint_badge_threshold(&h, &h.borrower, 800, expiration, 7);
    h.vault.borrow(&h.borrower, &usdc(150));
    assert_eq!(h.vault.get_available_liquidity(), POOL_SIZE - usdc(150));

    h.vault.repay(&h.borrower);
    let interest = usdc(150) * 500 / 10_000;
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
    mint_badge_threshold(&h, &h.borrower, 800, expiration, 8);
    mint_badge_threshold(&h, &other_borrower, 700, expiration, 9);

    // Gold 800 → first cap $160. Silver 700 → first cap $35.
    h.vault.borrow(&h.borrower, &usdc(100));
    h.vault.borrow(&other_borrower, &usdc(20));

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

// =============================================================================
// PHASE B'.3 — CREDIT LADDER
// =============================================================================

#[test]
#[should_panic(expected = "amount exceeds credit limit")]
fn test_first_loan_throttled_to_10pct_of_ceiling() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;
    h.vault.deposit(&h.lp, &POOL_SIZE);

    // Gold score 1000 → score_anchored = $2000. First loan cap = $200.
    // Borrowing $250 must panic on the credit ladder.
    mint_badge_threshold(&h, &h.borrower, 1000, expiration, 20);
    h.vault.borrow(&h.borrower, &usdc(250));
}

#[test]
fn test_ladder_lifts_to_full_ceiling_after_first_repay() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;
    h.vault.deposit(&h.lp, &POOL_SIZE);

    mint_badge_threshold(&h, &h.borrower, 900, expiration, 21);
    // First loan within the 10% throttle (≤ $180 for score 900).
    h.vault.borrow(&h.borrower, &usdc(150));
    h.vault.repay(&h.borrower);
    assert_eq!(h.vault.get_repay_count(&h.borrower), 1);

    // Second loan can now go up to the full $1800 (= $2000 × 0.9).
    h.vault.borrow(&h.borrower, &usdc(1_500));
    let loan = h.vault.get_loan(&h.borrower).unwrap();
    assert_eq!(loan.principal, usdc(1_500));
}

#[test]
#[should_panic(expected = "score below minimum tier")]
fn test_below_bronze_floor_rejected() {
    let h = setup();
    let expiration = INITIAL_TIMESTAMP + 7_776_000;
    h.vault.deposit(&h.lp, &POOL_SIZE);

    // Score 200 is below the Bronze floor (300). Even $1 should panic.
    mint_badge_threshold(&h, &h.borrower, 200, expiration, 22);
    h.vault.borrow(&h.borrower, &usdc(1));
}

// =============================================================================
// PHASE B'.4 — TVL CAP & UTILIZATION CAP
// =============================================================================

#[test]
#[should_panic(expected = "deposit exceeds TVL cap")]
fn test_tvl_cap_rejects_overflow() {
    let h = setup_with(usdc(1_000), 0, 0); // 1k USDC cap
    h.vault.deposit(&h.lp, &usdc(900));
    // Second deposit overflows the cap ($900 + $200 > $1000).
    h.vault.deposit(&h.lp, &usdc(200));
}

#[test]
fn test_tvl_cap_allows_at_exactly_limit() {
    let h = setup_with(usdc(1_000), 0, 0);
    h.vault.deposit(&h.lp, &usdc(1_000));
    assert_eq!(h.vault.get_total_deposits(), usdc(1_000));
}

#[test]
#[should_panic(expected = "amount exceeds utilization cap")]
fn test_utilization_cap_rejects_over_limit() {
    // Util cap = 1% so it binds before the per-pool 10% cap.
    let h = setup_with(usdc(1_000), 100_u32, 0);
    h.vault.deposit(&h.lp, &usdc(1_000));

    let expiration = INITIAL_TIMESTAMP + 7_776_000;
    // Score 1000 Gold → first loan cap = $200. Util cap = 1% × $1000 = $10.
    // Borrowing $20 fits the credit ladder but trips the utilization rail.
    mint_badge_threshold(&h, &h.borrower, 1000, expiration, 30);
    h.vault.borrow(&h.borrower, &usdc(20));
}

// =============================================================================
// PHASE B'.5 — LP WITHDRAWAL WITH TIMELOCK
// =============================================================================

#[test]
fn test_request_then_claim_withdraw_after_timelock() {
    let h = setup_with(DEFAULT_MAX_TVL, 0_u32, 14 * DAY);
    let lp_initial = h.token.balance(&h.lp);
    h.vault.deposit(&h.lp, &usdc(10_000));
    assert_eq!(h.token.balance(&h.lp), lp_initial - usdc(10_000));

    h.vault.request_withdraw(&h.lp, &usdc(3_000));
    let req = h.vault.get_withdrawal_request(&h.lp).unwrap();
    assert_eq!(req.amount, usdc(3_000));

    // Advance ledger past 14 days.
    h.env.ledger().set(LedgerInfo {
        timestamp: INITIAL_TIMESTAMP + 14 * DAY + 1,
        protocol_version: 22,
        sequence_number: 200,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 12_614_400,
    });

    h.vault.claim_withdraw(&h.lp);
    // Claim adds usdc(3_000) back to the LP wallet; balance now = initial - 10k + 3k.
    assert_eq!(h.token.balance(&h.lp), lp_initial - usdc(7_000));
    assert_eq!(h.vault.get_lp_balance(&h.lp), usdc(7_000));
    assert!(h.vault.get_withdrawal_request(&h.lp).is_none());
}

#[test]
#[should_panic(expected = "withdrawal is still locked")]
fn test_claim_before_timelock_fails() {
    let h = setup_with(DEFAULT_MAX_TVL, 0_u32, 14 * DAY);
    h.vault.deposit(&h.lp, &usdc(10_000));
    h.vault.request_withdraw(&h.lp, &usdc(3_000));

    // Only 13 days pass — must reject.
    h.env.ledger().set(LedgerInfo {
        timestamp: INITIAL_TIMESTAMP + 13 * DAY,
        protocol_version: 22,
        sequence_number: 150,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 12_614_400,
    });
    h.vault.claim_withdraw(&h.lp);
}

#[test]
#[should_panic(expected = "withdrawal already requested")]
fn test_double_withdrawal_request_rejected() {
    let h = setup();
    h.vault.deposit(&h.lp, &usdc(10_000));
    h.vault.request_withdraw(&h.lp, &usdc(1_000));
    h.vault.request_withdraw(&h.lp, &usdc(500));
}

#[test]
fn test_cancel_then_new_request_succeeds() {
    let h = setup();
    h.vault.deposit(&h.lp, &usdc(10_000));
    h.vault.request_withdraw(&h.lp, &usdc(1_000));
    h.vault.cancel_withdraw(&h.lp);
    assert!(h.vault.get_withdrawal_request(&h.lp).is_none());

    // New request now allowed.
    h.vault.request_withdraw(&h.lp, &usdc(500));
    assert_eq!(
        h.vault.get_withdrawal_request(&h.lp).unwrap().amount,
        usdc(500),
    );
}

#[test]
#[should_panic(expected = "request exceeds LP balance")]
fn test_request_above_balance_rejected() {
    let h = setup();
    h.vault.deposit(&h.lp, &usdc(100));
    h.vault.request_withdraw(&h.lp, &usdc(150));
}

#[test]
#[should_panic(expected = "no pending withdrawal")]
fn test_cancel_without_request_fails() {
    let h = setup();
    h.vault.cancel_withdraw(&h.lp);
}
