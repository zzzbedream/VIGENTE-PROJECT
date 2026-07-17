#![cfg(test)]
//! =============================================================================
//! MARGIN CONTROLLER — Unit + fuzz tests
//! =============================================================================
//!
//! The mock oracle (SEP-40) and mock pool (Blend `submit` subset) live inline
//! here — standard practice (Blend tests its pools the same way). The REAL
//! integration proof runs on testnet against the canonical Blend pool and
//! Reflector, driven by the deploy scripts + validate-t1.
//!
//! Coverage targets:
//!   - Reputation gate: max_borrow per tier, tier-up raises the limit (thesis),
//!     defaulted/no-badge blocked, sub-Bronze floor blocked.
//!   - Oracle safety: missing feed, missing price, stale price all revert.
//!   - Collateral lifecycle: deposit (cap), withdraw (health pre-check).
//!   - Debt lifecycle: borrow at/over limit, repay, health, liquidate → slash.
//!   - Fuzz: randomized amount × score × price, invariant vs. closed formula.
//! =============================================================================

extern crate std;

use crate::{
    Asset, InitConfig, MarginController, MarginControllerClient, Positions, PriceData, Request,
    TierLevel, HEALTH_NO_DEBT, REQ_BORROW, REQ_REPAY, REQ_SUPPLY_COLLATERAL,
    REQ_WITHDRAW_COLLATERAL,
};
use ed25519_dalek::{Signer, SigningKey};
use mock_usdc::{MockUsdc, MockUsdcClient};
use rand::rngs::{OsRng, StdRng};
use rand::{Rng, SeedableRng};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger, LedgerInfo},
    token::TokenClient,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, Map, String, Vec,
};
use vigente_badge::{VigenteBadge, VigenteBadgeClient};

// =============================================================================
// MOCK ORACLE — minimal SEP-40 feed with admin-settable prices
// =============================================================================

#[derive(Clone)]
#[contracttype]
pub enum OracleKey {
    Price(Asset),
    Decimals,
}

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn set_decimals(env: Env, d: u32) {
        env.storage().instance().set(&OracleKey::Decimals, &d);
    }

    pub fn set_price(env: Env, asset: Asset, price: i128, timestamp: u64) {
        env.storage()
            .persistent()
            .set(&OracleKey::Price(asset), &PriceData { price, timestamp });
    }

    pub fn clear_price(env: Env, asset: Asset) {
        env.storage().persistent().remove(&OracleKey::Price(asset));
    }

    pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
        env.storage().persistent().get(&OracleKey::Price(asset))
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&OracleKey::Decimals).unwrap_or(14)
    }
}

// =============================================================================
// MOCK POOL — Blend `submit` subset with real token movement
// =============================================================================

#[contract]
pub struct MockPool;

#[contractimpl]
impl MockPool {
    pub fn submit(
        env: Env,
        _from: Address,
        spender: Address,
        to: Address,
        requests: Vec<Request>,
    ) -> Positions {
        let me = env.current_contract_address();
        for req in requests.iter() {
            let token = TokenClient::new(&env, &req.address);
            match req.request_type {
                REQ_SUPPLY_COLLATERAL | REQ_REPAY => {
                    token.transfer(&spender, &me, &req.amount);
                }
                REQ_WITHDRAW_COLLATERAL | REQ_BORROW => {
                    token.transfer(&me, &to, &req.amount);
                }
                _ => panic!("unsupported request type"),
            }
        }
        Positions {
            collateral: Map::new(&env),
            liabilities: Map::new(&env),
            supply: Map::new(&env),
        }
    }
}

// =============================================================================
// THRESHOLD ORACLE HELPER (badge mints) — forked from reference-vault tests
// =============================================================================

const DEFAULT_THRESHOLD: u32 = 3;
const DEFAULT_ORACLE_COUNT: usize = 5;
const DEFAULT_AGE_DAYS: u32 = 60;

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

/// Advance the ledger clock. Prices become stale past MAX_PRICE_AGE — tests
/// that read prices after advancing must re-set them at the new timestamp.
fn advance_time(env: &Env, secs: u64) {
    let now = env.ledger().timestamp();
    env.ledger().set(LedgerInfo {
        timestamp: now + secs,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 12_614_400,
    });
}

fn fresh_nonce(seed: u32) -> [u8; 32] {
    let mut n = [0u8; 32];
    n[0..4].copy_from_slice(&seed.to_be_bytes());
    n[31] = 0x5A;
    n
}

// =============================================================================
// HARNESS
// =============================================================================

const INITIAL_TIMESTAMP: u64 = 1_700_000_000;
const BADGE_EXPIRY: u64 = INITIAL_TIMESTAMP + 7_776_000; // +90 days
const MAX_PRICE_AGE: u64 = 300; // 5 minutes, mirrors the testnet config
const MIN_LTV_FLOOR: u32 = 5_000; // immutable floor, below the Bronze tier
const GRACE_SECS: u64 = 3_600; // parameter/slash grace window in tests

/// Oracle prices at 14 decimals (Reflector's scale).
const P_XLM: i128 = 19_000_000_000_000; // $0.19
const P_USDC: i128 = 100_000_000_000_000; // $1.00

/// 7-decimal token helpers.
fn units(n: i128) -> i128 {
    n * 10_000_000
}

const POOL_LIQUIDITY: i128 = 10_000_000_0000000; // 10M USDC
const XLM_CAP: i128 = 0; // uncapped by default; cap tests use setup_with_cap

struct Harness<'a> {
    env: Env,
    admin: Address,
    oracles: OracleSet,
    borrower: Address,
    badge: VigenteBadgeClient<'a>,
    ctrl_id: Address,
    ctrl: MarginControllerClient<'a>,
    pool_id: Address,
    usdc_id: Address,
    usdc: TokenClient<'a>,
    xlm_id: Address,
    xlm: TokenClient<'a>,
    price_oracle: MockOracleClient<'a>,
}

fn default_tiers(env: &Env) -> Vec<TierLevel> {
    let mut tiers = Vec::new(env);
    tiers.push_back(TierLevel { min_score: 800, ltv_bps: 8_500 });
    tiers.push_back(TierLevel { min_score: 550, ltv_bps: 7_500 });
    tiers.push_back(TierLevel { min_score: 300, ltv_bps: 6_000 });
    tiers
}

fn setup() -> Harness<'static> {
    setup_with_cap(XLM_CAP)
}

fn setup_with_cap(xlm_cap: i128) -> Harness<'static> {
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
    let borrower = Address::generate(&env);

    // Tokens: borrow asset (USDC) + collateral (XLM stand-in), both 7 dec.
    let usdc_id = env.register_contract(None, MockUsdc);
    let usdc_admin = MockUsdcClient::new(&env, &usdc_id);
    usdc_admin.initialize(&admin, &7_u32, &String::from_str(&env, "USD Coin"), &String::from_str(&env, "USDC"));
    let xlm_id = env.register_contract(None, MockUsdc);
    let xlm_admin = MockUsdcClient::new(&env, &xlm_id);
    xlm_admin.initialize(&admin, &7_u32, &String::from_str(&env, "Lumens"), &String::from_str(&env, "XLM"));

    // Badge with 3-of-5 threshold oracle ACL.
    let badge_id = env.register_contract(None, VigenteBadge);
    let badge = VigenteBadgeClient::new(&env, &badge_id);
    badge.initialize(&admin);
    let oracles = OracleSet::generate(DEFAULT_ORACLE_COUNT, DEFAULT_THRESHOLD);
    badge.set_oracle_keys(&oracles.pubkeys_vec(&env), &oracles.threshold);

    // SEP-40 mock oracle with fresh prices.
    let oracle_id = env.register_contract(None, MockOracle);
    let price_oracle = MockOracleClient::new(&env, &oracle_id);
    price_oracle.set_decimals(&14_u32);
    price_oracle.set_price(&Asset::Stellar(xlm_id.clone()), &P_XLM, &INITIAL_TIMESTAMP);
    price_oracle.set_price(&Asset::Stellar(usdc_id.clone()), &P_USDC, &INITIAL_TIMESTAMP);

    // Mock Blend pool funded with borrow-asset liquidity.
    let pool_id = env.register_contract(None, MockPool);
    usdc_admin.mint(&pool_id, &POOL_LIQUIDITY);

    // The controller under test.
    let ctrl_id = env.register_contract(None, MarginController);
    let ctrl = MarginControllerClient::new(&env, &ctrl_id);
    ctrl.init(&InitConfig {
        admin: admin.clone(),
        oracle: oracle_id.clone(),
        reputation_registry: badge_id.clone(),
        blend_pool: pool_id.clone(),
        borrow_asset: usdc_id.clone(),
        borrow_feed: Asset::Stellar(usdc_id.clone()),
        collateral_asset: xlm_id.clone(),
        collateral_feed: Asset::Stellar(xlm_id.clone()),
        collateral_cap: xlm_cap,
        tier_ltv: default_tiers(&env),
        max_price_age: MAX_PRICE_AGE,
        min_ltv_floor: MIN_LTV_FLOOR,
        param_grace_secs: GRACE_SECS,
    });

    // Controller may slash badges on liquidation.
    badge.add_vault(&ctrl_id);

    // Borrower starts with collateral to lock.
    xlm_admin.mint(&borrower, &units(10_000));

    Harness {
        env: env.clone(),
        admin,
        oracles,
        borrower,
        badge,
        ctrl_id,
        ctrl,
        pool_id,
        usdc_id: usdc_id.clone(),
        usdc: TokenClient::new(&env, &usdc_id),
        xlm_id: xlm_id.clone(),
        xlm: TokenClient::new(&env, &xlm_id),
        price_oracle,
    }
}

fn mint_badge(h: &Harness, borrower: &Address, score: u32, nonce_seed: u32) {
    let nonce = fresh_nonce(nonce_seed);
    let sigs = h.oracles.sign_first(
        &h.env,
        borrower,
        score,
        BADGE_EXPIRY,
        DEFAULT_AGE_DAYS,
        &nonce,
        h.oracles.threshold as usize,
    );
    h.badge.mint(
        borrower,
        &score,
        &BADGE_EXPIRY,
        &DEFAULT_AGE_DAYS,
        &BytesN::from_array(&h.env, &nonce),
        &sigs,
    );
}

/// Closed-form expected capacity: amount × p_coll / p_borrow × ltv / 10000,
/// in the same integer-division order the contract uses.
fn expected_capacity(amount: i128, p_coll: i128, p_borrow: i128, ltv_bps: u32) -> i128 {
    amount * p_coll / p_borrow * ltv_bps as i128 / 10_000
}

// =============================================================================
// COLLATERAL LIFECYCLE
// =============================================================================

#[test]
fn test_deposit_records_and_forwards_to_pool() {
    let h = setup();
    let amount = units(1_000);
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &amount);

    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), amount);
    // Tokens flow user → controller → pool; nothing sticks to the controller.
    assert_eq!(h.xlm.balance(&h.ctrl_id), 0);
    assert_eq!(h.xlm.balance(&h.pool_id), amount);
    assert_eq!(h.xlm.balance(&h.borrower), units(10_000) - amount);
}

#[test]
#[should_panic(expected = "deposit exceeds collateral cap")]
fn test_deposit_above_cap_rejected() {
    let h = setup_with_cap(units(1_500));
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
}

#[test]
#[should_panic(expected = "asset not allowlisted")]
fn test_deposit_unlisted_asset_rejected() {
    let h = setup();
    // The borrow asset itself is not allowlisted as collateral.
    h.ctrl.deposit_collateral(&h.borrower, &h.usdc_id, &units(100));
}

#[test]
fn test_withdraw_without_debt_returns_tokens() {
    let h = setup();
    let amount = units(1_000);
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &amount);
    h.ctrl.withdraw_collateral(&h.borrower, &h.xlm_id, &amount);

    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), 0);
    assert_eq!(h.xlm.balance(&h.borrower), units(10_000));
    assert_eq!(h.xlm.balance(&h.pool_id), 0);
}

// =============================================================================
// REPUTATION GATE — max_borrow per tier
// =============================================================================

#[test]
fn test_max_borrow_zero_without_badge() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    assert_eq!(h.ctrl.max_borrow(&h.borrower), 0);
    assert_eq!(h.ctrl.ltv_bps_for(&h.borrower), 0);
}

#[test]
fn test_max_borrow_zero_below_bronze_floor() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 250, 1);
    assert_eq!(h.ctrl.max_borrow(&h.borrower), 0);
}

#[test]
fn test_max_borrow_per_tier_and_tier_up_raises_limit() {
    // THE THESIS: same collateral, higher reputation → higher max_borrow.
    let h = setup();
    let amount = units(1_000);
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &amount);

    mint_badge(&h, &h.borrower, 400, 1); // Bronze
    let bronze = h.ctrl.max_borrow(&h.borrower);
    assert_eq!(bronze, expected_capacity(amount, P_XLM, P_USDC, 6_000));
    assert_eq!(h.ctrl.ltv_bps_for(&h.borrower), 6_000);

    mint_badge(&h, &h.borrower, 600, 2); // Silver
    let silver = h.ctrl.max_borrow(&h.borrower);
    assert_eq!(silver, expected_capacity(amount, P_XLM, P_USDC, 7_500));

    mint_badge(&h, &h.borrower, 850, 3); // Gold
    let gold = h.ctrl.max_borrow(&h.borrower);
    assert_eq!(gold, expected_capacity(amount, P_XLM, P_USDC, 8_500));

    assert!(bronze < silver && silver < gold);
}

// =============================================================================
// BORROW / REPAY
// =============================================================================

#[test]
fn test_borrow_at_limit_succeeds() {
    let h = setup();
    let amount = units(1_000);
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &amount);
    mint_badge(&h, &h.borrower, 850, 1);

    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &max);

    assert_eq!(h.ctrl.get_debt(&h.borrower), max);
    assert_eq!(h.ctrl.get_total_debt(), max);
    assert_eq!(h.usdc.balance(&h.borrower), max);
    assert_eq!(h.usdc.balance(&h.pool_id), POOL_LIQUIDITY - max);
    // At the exact limit health sits at 100%.
    assert_eq!(h.ctrl.health(&h.borrower), 100);
    // And nothing further is available.
    assert_eq!(h.ctrl.max_borrow(&h.borrower), 0);
}

#[test]
#[should_panic(expected = "amount exceeds credit limit for tier")]
fn test_borrow_above_limit_fails() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &(max + 1));
}

#[test]
#[should_panic(expected = "no active credit badge")]
fn test_borrow_without_badge_fails() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    h.ctrl.borrow(&h.borrower, &units(10));
}

#[test]
#[should_panic(expected = "borrower is in default")]
fn test_borrow_when_defaulted_fails() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    // Slash through an authorized vault (the admin address doubles as one).
    h.badge.add_vault(&h.admin);
    h.badge.slash(&h.admin, &h.borrower, &1_u32);
    h.ctrl.borrow(&h.borrower, &units(10));
}

#[test]
fn test_repay_reduces_debt_and_returns_liquidity() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &max);

    let half = max / 2;
    h.ctrl.repay(&h.borrower, &half);
    assert_eq!(h.ctrl.get_debt(&h.borrower), max - half);

    h.ctrl.repay(&h.borrower, &(max - half));
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);
    assert_eq!(h.ctrl.get_total_debt(), 0);
    assert_eq!(h.ctrl.health(&h.borrower), HEALTH_NO_DEBT);
    assert_eq!(h.usdc.balance(&h.pool_id), POOL_LIQUIDITY);
}

#[test]
#[should_panic(expected = "repay exceeds outstanding debt")]
fn test_repay_more_than_debt_fails() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    h.ctrl.borrow(&h.borrower, &units(50));
    h.ctrl.repay(&h.borrower, &units(51));
}

// =============================================================================
// ORACLE SAFETY — stale / missing prices revert
// =============================================================================

#[test]
#[should_panic(expected = "oracle price is stale")]
fn test_stale_price_reverts_borrow() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    h.price_oracle.set_price(
        &Asset::Stellar(h.xlm_id.clone()),
        &P_XLM,
        &(INITIAL_TIMESTAMP - MAX_PRICE_AGE - 1),
    );
    h.ctrl.borrow(&h.borrower, &units(10));
}

#[test]
#[should_panic(expected = "oracle returned no price")]
fn test_missing_price_reverts_borrow() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    h.price_oracle.clear_price(&Asset::Stellar(h.xlm_id.clone()));
    h.ctrl.borrow(&h.borrower, &units(10));
}

// =============================================================================
// WITHDRAW HEALTH PRE-CHECK
// =============================================================================

#[test]
#[should_panic(expected = "position would become unhealthy")]
fn test_withdraw_blocked_while_at_limit() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &max);
    // Any withdrawal drops capacity below the debt.
    h.ctrl.withdraw_collateral(&h.borrower, &h.xlm_id, &1);
}

#[test]
fn test_withdraw_allowed_when_healthy() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    // Borrow half the capacity → roughly half the collateral is free.
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &(max / 2));

    let withdraw = units(400); // leaves 600 XLM ≈ capacity 96.9 ≥ debt 80.75
    h.ctrl.withdraw_collateral(&h.borrower, &h.xlm_id, &withdraw);
    assert_eq!(
        h.ctrl.get_collateral(&h.borrower, &h.xlm_id),
        units(1_000) - withdraw
    );
    assert_eq!(h.xlm.balance(&h.borrower), units(10_000) - units(1_000) + withdraw);
    assert!(h.ctrl.health(&h.borrower) >= 100);
}

// =============================================================================
// LIQUIDATION — price drop → seize + cross-contract slash
// =============================================================================

#[test]
fn test_liquidate_on_price_drop_seizes_and_slashes() {
    let h = setup();
    let amount = units(1_000);
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &amount);
    mint_badge(&h, &h.borrower, 850, 1);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &max);

    // XLM halves → health ~50 < 100.
    h.price_oracle.set_price(&Asset::Stellar(h.xlm_id.clone()), &(P_XLM / 2), &INITIAL_TIMESTAMP);
    let hp = h.ctrl.health(&h.borrower);
    assert!(hp < 100, "expected unhealthy, got {hp}");

    let keeper = Address::generate(&h.env);
    h.ctrl.liquidate(&keeper, &h.borrower);

    // Debt written off into the settlement bucket; claim seized.
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);
    assert_eq!(h.ctrl.get_total_debt(), 0);
    assert_eq!(h.ctrl.get_pending_settlement(), max);
    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), 0);
    assert_eq!(h.ctrl.get_seized(&h.xlm_id), amount);
    // Reputation burned atomically, cross-contract.
    assert!(h.badge.is_defaulted(&h.borrower));
}

#[test]
#[should_panic(expected = "position is healthy")]
fn test_liquidate_healthy_position_fails() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    h.ctrl.borrow(&h.borrower, &units(50));
    let keeper = Address::generate(&h.env);
    h.ctrl.liquidate(&keeper, &h.borrower);
}

#[test]
#[should_panic(expected = "no debt to liquidate")]
fn test_liquidate_without_debt_fails() {
    let h = setup();
    let keeper = Address::generate(&h.env);
    h.ctrl.liquidate(&keeper, &h.borrower);
}

// =============================================================================
// ADMIN / CIRCUIT BREAKER
// =============================================================================

#[test]
#[should_panic(expected = "contract is paused")]
fn test_pause_blocks_deposit() {
    let h = setup();
    h.ctrl.pause();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(100));
}

#[test]
fn test_unpause_restores_operations() {
    let h = setup();
    h.ctrl.pause();
    h.ctrl.unpause();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(100));
    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), units(100));
}

#[test]
#[should_panic(expected = "tier ltv out of range")]
fn test_tier_ltv_above_c_factor_margin_rejected() {
    let h = setup();
    let mut tiers = Vec::new(&h.env);
    // 95% would sit above the Blend c_factor safety margin (max 90%).
    tiers.push_back(TierLevel { min_score: 300, ltv_bps: 9_500 });
    h.ctrl.queue_set_tier_ltv(&tiers);
}

#[test]
fn test_queue_apply_tier_ltv_replaces_ladder() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);

    let mut tiers = Vec::new(&h.env);
    tiers.push_back(TierLevel { min_score: 800, ltv_bps: 5_000 });
    h.ctrl.queue_set_tier_ltv(&tiers);
    // Announced but not effective: the active ladder is untouched.
    assert_eq!(h.ctrl.ltv_bps_for(&h.borrower), 8_500);

    advance_time(&h.env, GRACE_SECS + 1);
    let now = h.env.ledger().timestamp();
    h.price_oracle.set_price(&Asset::Stellar(h.xlm_id.clone()), &P_XLM, &now);
    h.price_oracle.set_price(&Asset::Stellar(h.usdc_id.clone()), &P_USDC, &now);
    h.ctrl.apply_tier_ltv();

    assert_eq!(h.ctrl.ltv_bps_for(&h.borrower), 5_000);
    assert_eq!(
        h.ctrl.max_borrow(&h.borrower),
        expected_capacity(units(1_000), P_XLM, P_USDC, 5_000)
    );
}

// =============================================================================
// NON-CUSTODIAL INVARIANTS (fixes de auditoría — DoD LOI)
// =============================================================================

#[test]
fn test_pause_does_not_block_withdraw_or_repay() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &(max / 2));

    h.ctrl.pause();
    // Deleverage and exit stay live while paused.
    h.ctrl.repay(&h.borrower, &(max / 4));
    h.ctrl.withdraw_collateral(&h.borrower, &h.xlm_id, &units(100));
    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), units(900));
    // Entry of NEW risk stays blocked.
    assert!(h.ctrl.try_deposit_collateral(&h.borrower, &h.xlm_id, &units(1)).is_err());
    assert!(h.ctrl.try_borrow(&h.borrower, &1).is_err());
}

#[test]
fn test_pause_does_not_block_liquidate() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &max);

    h.price_oracle.set_price(&Asset::Stellar(h.xlm_id.clone()), &(P_XLM / 2), &INITIAL_TIMESTAMP);
    h.ctrl.pause();

    let keeper = Address::generate(&h.env);
    h.ctrl.liquidate(&keeper, &h.borrower);
    assert!(h.badge.is_defaulted(&h.borrower));
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);
}

#[test]
fn test_queued_ltv_downgrade_respects_grace_period() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &max); // health == 100 at 8500 bps

    // Admin queues a crushing (floor-respecting) downgrade.
    let mut tiers = Vec::new(&h.env);
    tiers.push_back(TierLevel { min_score: 300, ltv_bps: 5_000 });
    h.ctrl.queue_set_tier_ltv(&tiers);

    // Announced but NOT effective: the healthy position cannot be made
    // liquidatable by the admin's parameter change during the grace window.
    assert!(h.ctrl.get_pending_tiers().is_some());
    assert_eq!(h.ctrl.health(&h.borrower), 100);
    let keeper = Address::generate(&h.env);
    assert!(h.ctrl.try_liquidate(&keeper, &h.borrower).is_err());
    assert!(h.ctrl.try_apply_tier_ltv().is_err());

    // After the grace window anyone applies; the user had N hours to react.
    advance_time(&h.env, GRACE_SECS + 1);
    let now = h.env.ledger().timestamp();
    h.price_oracle.set_price(&Asset::Stellar(h.xlm_id.clone()), &P_XLM, &now);
    h.price_oracle.set_price(&Asset::Stellar(h.usdc_id.clone()), &P_USDC, &now);
    h.ctrl.apply_tier_ltv();
    assert!(h.ctrl.get_pending_tiers().is_none());
    assert!(h.ctrl.health(&h.borrower) < 100);
    h.ctrl.liquidate(&keeper, &h.borrower);
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);
}

#[test]
fn test_slash_grace_protects_healthy_position() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &max); // health == 100 at 8500 bps

    // Badge-admin-side slash (harness admin doubles as authorized vault).
    h.badge.add_vault(&h.admin);
    h.badge.slash(&h.admin, &h.borrower, &2_u32);

    // Inside the grace window the position is valued at its borrow-time LTV
    // snapshot: still healthy, not liquidatable.
    assert_eq!(h.ctrl.health(&h.borrower), 100);
    let keeper = Address::generate(&h.env);
    assert!(h.ctrl.try_liquidate(&keeper, &h.borrower).is_err());

    // Past the grace window it drops to the lowest tier and is liquidatable —
    // and liquidate must not double-slash an already-defaulted borrower.
    advance_time(&h.env, GRACE_SECS + 1);
    let now = h.env.ledger().timestamp();
    h.price_oracle.set_price(&Asset::Stellar(h.xlm_id.clone()), &P_XLM, &now);
    h.price_oracle.set_price(&Asset::Stellar(h.usdc_id.clone()), &P_USDC, &now);
    assert!(h.ctrl.health(&h.borrower) < 100);
    h.ctrl.liquidate(&keeper, &h.borrower);
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);
    assert_eq!(h.ctrl.get_seized(&h.xlm_id), units(1_000));
}

#[test]
#[should_panic(expected = "tier ltv below immutable floor")]
fn test_queue_rejects_ltv_below_floor() {
    let h = setup();
    let mut tiers = Vec::new(&h.env);
    tiers.push_back(TierLevel { min_score: 300, ltv_bps: MIN_LTV_FLOOR - 1 });
    h.ctrl.queue_set_tier_ltv(&tiers);
}

#[test]
#[should_panic(expected = "no pending tier change")]
fn test_apply_without_pending_fails() {
    let h = setup();
    h.ctrl.apply_tier_ltv();
}

#[test]
fn test_admin_two_step_rotation() {
    let h = setup();
    let new_admin = Address::generate(&h.env);
    h.ctrl.propose_admin(&new_admin);
    // Not effective until the proposed admin accepts.
    assert_eq!(h.ctrl.get_admin(), h.admin);
    h.ctrl.accept_admin();
    assert_eq!(h.ctrl.get_admin(), new_admin);
    // The pending slot is consumed.
    assert!(h.ctrl.try_accept_admin().is_err());
}

#[test]
fn test_init_getters() {
    let h = setup();
    assert_eq!(h.ctrl.get_admin(), h.admin);
    assert_eq!(h.ctrl.get_tier_ltv().len(), 3);
    let assets = h.ctrl.get_collateral_assets();
    assert_eq!(assets.len(), 1);
    assert_eq!(assets.get(0).unwrap(), h.xlm_id);
}

// =============================================================================
// FUZZ — randomized amount × score × price vs. the closed formula
// =============================================================================

#[test]
fn test_fuzz_max_borrow_matches_formula_and_never_exceeds() {
    let h = setup();
    h.env.budget().reset_unlimited();
    let mut rng = StdRng::seed_from_u64(42);
    let xlm_admin = MockUsdcClient::new(&h.env, &h.xlm_id);

    for i in 0..25_u32 {
        let user = Address::generate(&h.env);
        let amount: i128 = rng.gen_range(1..=units(5_000));
        let score: u32 = rng.gen_range(0..=1_000);
        let p_coll: i128 = rng.gen_range(1_000_000_000_000..=1_000_000_000_000_000);

        h.price_oracle.set_price(&Asset::Stellar(h.xlm_id.clone()), &p_coll, &INITIAL_TIMESTAMP);
        xlm_admin.mint(&user, &amount);
        h.ctrl.deposit_collateral(&user, &h.xlm_id, &amount);
        mint_badge(&h, &user, score, 1_000 + i);

        let ltv = if score >= 800 {
            8_500
        } else if score >= 550 {
            7_500
        } else if score >= 300 {
            6_000
        } else {
            0
        };
        let expected = expected_capacity(amount, p_coll, P_USDC, ltv);
        let max = h.ctrl.max_borrow(&user);
        assert_eq!(max, expected, "iter {i}: amount={amount} score={score} p={p_coll}");

        // Borrowing the limit succeeds; one stroop more never does.
        assert!(h.ctrl.try_borrow(&user, &(max + 1)).is_err(), "iter {i}: over-limit borrow must fail");
        if max > 0 {
            h.ctrl.borrow(&user, &max);
            assert_eq!(h.ctrl.get_debt(&user), max);
            assert_eq!(h.ctrl.max_borrow(&user), 0);
        }
    }
}
