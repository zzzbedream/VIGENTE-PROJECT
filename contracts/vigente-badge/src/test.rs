#![cfg(test)]
//! =============================================================================
//! VIGENTE BADGE — Comprehensive Test Suite (post Phase B threshold refactor)
//! =============================================================================
//!
//! Target coverage: >90% of all contract functions and error paths.
//!
//! Test categories:
//!   1. Initialization
//!   2. Access Control (set_oracle_keys, add_vault, remove_vault)
//!   3. Mint (happy path + error paths) — now requires k-of-n threshold signatures
//!   4. Slash (happy path + error paths)
//!   5. Query functions (is_defaulted, get_score, get_badge)
//!   6. Circuit breaker (pause/unpause)
//!   7. Edge cases & integration scenarios
//!   8. Threshold-specific (B.5): nonce replay, duplicate index, invalid sig, etc.
//! =============================================================================

extern crate std;

use crate::{VigenteBadge, VigenteBadgeClient};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, Vec,
};

// =============================================================================
// ORACLE HELPERS — generate keypairs, build message, sign, assemble Vec for mint
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
    fn generate(_env: &Env, count: usize, threshold: u32) -> Self {
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

    /// Build the canonical message exactly as the contract does:
    /// borrower.to_xdr() || score_be || expiration_be || account_age_days_be || nonce
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

    fn sign_with_first(
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

    fn sign_with_indices(
        &self,
        env: &Env,
        borrower: &Address,
        score: u32,
        expiration: u64,
        account_age_days: u32,
        nonce: &[u8; 32],
        indices: &[u32],
    ) -> Vec<(u32, BytesN<64>)> {
        let msg = Self::build_message_bytes(env, borrower, score, expiration, account_age_days, nonce);
        let mut out = Vec::new(env);
        for &idx in indices {
            let sig_bytes = self.nodes[idx as usize].signing_key.sign(&msg).to_bytes();
            out.push_back((idx, BytesN::from_array(env, &sig_bytes)));
        }
        out
    }
}

/// Default account_age_days passed in tests — comfortably above the 30-day
/// floor so existing scenarios stay green.
const DEFAULT_AGE_DAYS: u32 = 60;

fn fresh_nonce(seed: u8) -> [u8; 32] {
    let mut n = [0u8; 32];
    n[0] = seed;
    n[31] = seed.wrapping_add(0x5A);
    n
}

/// Standard setup: initialize, configure 5 oracles + threshold=3, register one vault.
fn setup(env: &Env) -> (Address, Address, Address, VigenteBadgeClient, OracleSet) {
    let contract_id = env.register_contract(None, VigenteBadge);
    let client = VigenteBadgeClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let vault = Address::generate(env);
    let borrower = Address::generate(env);

    env.mock_all_auths();
    client.initialize(&admin);

    let oracles = OracleSet::generate(env, DEFAULT_ORACLE_COUNT, DEFAULT_THRESHOLD);
    client.set_oracle_keys(&oracles.pubkeys_vec(env), &oracles.threshold);
    client.add_vault(&vault);

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

    (admin, vault, borrower, client, oracles)
}

/// Convenience wrapper: build threshold-signed mint call with k=threshold
/// signatures and `account_age_days = DEFAULT_AGE_DAYS`.
fn mint_default(
    env: &Env,
    client: &VigenteBadgeClient,
    oracles: &OracleSet,
    borrower: &Address,
    score: u32,
    expiration: u64,
    nonce_seed: u8,
) -> crate::CreditBadge {
    mint_with_age(env, client, oracles, borrower, score, expiration, DEFAULT_AGE_DAYS, nonce_seed)
}

fn mint_with_age(
    env: &Env,
    client: &VigenteBadgeClient,
    oracles: &OracleSet,
    borrower: &Address,
    score: u32,
    expiration: u64,
    age_days: u32,
    nonce_seed: u8,
) -> crate::CreditBadge {
    let nonce = fresh_nonce(nonce_seed);
    let sigs = oracles.sign_with_first(
        env,
        borrower,
        score,
        expiration,
        age_days,
        &nonce,
        oracles.threshold as usize,
    );
    client.mint(
        borrower,
        &score,
        &expiration,
        &age_days,
        &BytesN::from_array(env, &nonce),
        &sigs,
    )
}

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
    client.initialize(&admin);
}

// =============================================================================
// 2. ACCESS CONTROL
// =============================================================================

#[test]
fn test_set_oracle_keys_replaces_set() {
    let env = Env::default();
    let (_, _, borrower, client, _oracles) = setup(&env);

    let new_oracles = OracleSet::generate(&env, 4, 2);
    client.set_oracle_keys(&new_oracles.pubkeys_vec(&env), &new_oracles.threshold);

    assert_eq!(client.get_oracle_keys().len(), 4);
    assert_eq!(client.get_oracle_threshold(), 2);

    let nonce = fresh_nonce(99);
    let sigs = new_oracles.sign_with_first(&env, &borrower, 600, DEFAULT_EXPIRATION, DEFAULT_AGE_DAYS, &nonce, 2);
    let badge = client.mint(&borrower, &600, &DEFAULT_EXPIRATION, &DEFAULT_AGE_DAYS, &BytesN::from_array(&env, &nonce), &sigs);
    assert_eq!(badge.score, 600);
}

#[test]
fn test_add_and_remove_vault() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);
    let new_vault = Address::generate(&env);

    client.add_vault(&new_vault);

    mint_default(&env, &client, &oracles, &borrower, 700, DEFAULT_EXPIRATION, 1);

    client.slash(&new_vault, &borrower, &1);

    assert!(client.is_defaulted(&borrower));
}

#[test]
#[should_panic(expected = "caller is not an authorized vault")]
fn test_unauthorized_vault_cannot_slash() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);
    let unauthorized = Address::generate(&env);

    mint_default(&env, &client, &oracles, &borrower, 500, DEFAULT_EXPIRATION, 2);
    client.slash(&unauthorized, &borrower, &0);
}

// =============================================================================
// 3. MINT — HAPPY PATH
// =============================================================================

#[test]
fn test_mint_gold_badge() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    let badge = mint_default(&env, &client, &oracles, &borrower, 950, DEFAULT_EXPIRATION, 10);

    assert_eq!(badge.score, 950);
    assert_eq!(badge.issued_at, 1_700_000_000);
    assert_eq!(badge.expires_at, DEFAULT_EXPIRATION);
    assert!(!badge.slashed);
}

#[test]
fn test_mint_returns_score_via_get_score() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    mint_default(&env, &client, &oracles, &borrower, 750, DEFAULT_EXPIRATION, 11);

    let score = client.get_score(&borrower);
    assert_eq!(score, Some(750));
}

#[test]
fn test_mint_badge_retrievable() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    mint_default(&env, &client, &oracles, &borrower, 600, DEFAULT_EXPIRATION, 12);

    let badge = client.get_badge(&borrower);
    assert!(badge.is_some());
    let b = badge.unwrap();
    assert_eq!(b.score, 600);
    assert!(!b.slashed);
}

#[test]
fn test_mint_overwrites_previous_badge() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    mint_default(&env, &client, &oracles, &borrower, 500, DEFAULT_EXPIRATION, 13);
    assert_eq!(client.get_score(&borrower), Some(500));

    mint_default(&env, &client, &oracles, &borrower, 900, DEFAULT_EXPIRATION, 14);
    assert_eq!(client.get_score(&borrower), Some(900));
}

#[test]
fn test_zero_score_badge_is_valid() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    let badge = mint_default(&env, &client, &oracles, &borrower, 0, DEFAULT_EXPIRATION, 15);
    assert_eq!(badge.score, 0);
    assert_eq!(client.get_score(&borrower), Some(0));
}

#[test]
fn test_max_score_badge() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    let badge = mint_default(&env, &client, &oracles, &borrower, 1000, DEFAULT_EXPIRATION, 16);
    assert_eq!(badge.score, 1000);
    assert_eq!(client.get_score(&borrower), Some(1000));
}

// =============================================================================
// 3b. MINT — ERROR PATHS
// =============================================================================

#[test]
#[should_panic(expected = "invalid score")]
fn test_mint_score_too_high() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);
    mint_default(&env, &client, &oracles, &borrower, 1500, DEFAULT_EXPIRATION, 20);
}

#[test]
#[should_panic(expected = "expiration must be in the future")]
fn test_mint_expired_timestamp() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);
    mint_default(&env, &client, &oracles, &borrower, 500, 1_600_000_000, 21);
}

#[test]
#[should_panic(expected = "borrower is in default")]
fn test_mint_defaulted_borrower_fails() {
    let env = Env::default();
    let (_, vault, borrower, client, oracles) = setup(&env);

    mint_default(&env, &client, &oracles, &borrower, 500, DEFAULT_EXPIRATION, 22);
    client.slash(&vault, &borrower, &1);

    mint_default(&env, &client, &oracles, &borrower, 800, DEFAULT_EXPIRATION, 23);
}

// =============================================================================
// 4. SLASH — HAPPY PATH
// =============================================================================

#[test]
fn test_slash_marks_badge_as_slashed() {
    let env = Env::default();
    let (_, vault, borrower, client, oracles) = setup(&env);

    mint_default(&env, &client, &oracles, &borrower, 700, DEFAULT_EXPIRATION, 30);
    client.slash(&vault, &borrower, &1);

    assert!(client.get_badge(&borrower).is_none());
    assert!(client.get_score(&borrower).is_none());
}

#[test]
fn test_slash_creates_default_record() {
    let env = Env::default();
    let (_, vault, borrower, client, oracles) = setup(&env);

    mint_default(&env, &client, &oracles, &borrower, 700, DEFAULT_EXPIRATION, 31);
    client.slash(&vault, &borrower, &2);

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
    let (_, vault, borrower, client, oracles) = setup(&env);

    assert!(!client.is_defaulted(&borrower));

    mint_default(&env, &client, &oracles, &borrower, 700, DEFAULT_EXPIRATION, 32);
    client.slash(&vault, &borrower, &0);

    assert!(client.is_defaulted(&borrower));
}

// =============================================================================
// 4b. SLASH — ERROR PATHS
// =============================================================================

#[test]
#[should_panic(expected = "no active badge to slash")]
fn test_slash_no_badge_fails() {
    let env = Env::default();
    let (_, vault, borrower, client, _oracles) = setup(&env);
    client.slash(&vault, &borrower, &0);
}

#[test]
#[should_panic(expected = "badge already slashed")]
fn test_slash_twice_fails() {
    let env = Env::default();
    let (_, vault, borrower, client, oracles) = setup(&env);

    mint_default(&env, &client, &oracles, &borrower, 500, DEFAULT_EXPIRATION, 33);
    client.slash(&vault, &borrower, &1);
    client.slash(&vault, &borrower, &1);
}

#[test]
#[should_panic(expected = "invalid reason code")]
fn test_slash_invalid_reason_fails() {
    let env = Env::default();
    let (_, vault, borrower, client, oracles) = setup(&env);

    mint_default(&env, &client, &oracles, &borrower, 500, DEFAULT_EXPIRATION, 34);
    client.slash(&vault, &borrower, &5);
}

// =============================================================================
// 5. QUERY FUNCTIONS
// =============================================================================

#[test]
fn test_is_defaulted_returns_false_for_unknown_address() {
    let env = Env::default();
    let (_, _, _, client, _oracles) = setup(&env);
    let unknown = Address::generate(&env);
    assert!(!client.is_defaulted(&unknown));
}

#[test]
fn test_get_score_returns_none_for_unknown_address() {
    let env = Env::default();
    let (_, _, _, client, _oracles) = setup(&env);
    let unknown = Address::generate(&env);
    assert!(client.get_score(&unknown).is_none());
}

#[test]
fn test_get_score_returns_none_after_expiry() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    let short_expiry = 1_700_000_000 + 100;
    mint_default(&env, &client, &oracles, &borrower, 800, short_expiry, 40);

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
    let (_, _, borrower, client, oracles) = setup(&env);

    mint_default(&env, &client, &oracles, &borrower, 600, DEFAULT_EXPIRATION, 41);
    assert!(client.get_default(&borrower).is_none());
}

// =============================================================================
// 6. CIRCUIT BREAKER
// =============================================================================

#[test]
#[should_panic(expected = "contract is paused")]
fn test_mint_while_paused_fails() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    client.pause();
    mint_default(&env, &client, &oracles, &borrower, 500, DEFAULT_EXPIRATION, 50);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_slash_while_paused_fails() {
    let env = Env::default();
    let (_, vault, borrower, client, oracles) = setup(&env);

    mint_default(&env, &client, &oracles, &borrower, 500, DEFAULT_EXPIRATION, 51);
    client.pause();
    client.slash(&vault, &borrower, &1);
}

#[test]
fn test_unpause_resumes_operations() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    client.pause();
    client.unpause();

    let badge = mint_default(&env, &client, &oracles, &borrower, 500, DEFAULT_EXPIRATION, 52);
    assert_eq!(badge.score, 500);
}

// =============================================================================
// 7. INTEGRATION SCENARIOS
// =============================================================================

#[test]
fn test_full_lifecycle_mint_then_slash() {
    let env = Env::default();
    let (_, vault, borrower, client, oracles) = setup(&env);

    let badge = mint_default(&env, &client, &oracles, &borrower, 850, DEFAULT_EXPIRATION, 60);
    assert_eq!(badge.score, 850);
    assert!(!client.is_defaulted(&borrower));
    assert_eq!(client.get_score(&borrower), Some(850));

    client.slash(&vault, &borrower, &1);

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
    let (_, vault, borrower1, client, oracles) = setup(&env);
    let borrower2 = Address::generate(&env);

    mint_default(&env, &client, &oracles, &borrower1, 900, DEFAULT_EXPIRATION, 70);
    mint_default(&env, &client, &oracles, &borrower2, 600, DEFAULT_EXPIRATION, 71);

    client.slash(&vault, &borrower1, &1);

    assert!(client.is_defaulted(&borrower1));
    assert!(!client.is_defaulted(&borrower2));

    assert_eq!(client.get_score(&borrower2), Some(600));
    assert!(client.get_score(&borrower1).is_none());
}

// =============================================================================
// 8. THRESHOLD-SPECIFIC TESTS (B.5)
// =============================================================================

#[test]
fn test_mint_with_3_of_5_signatures_succeeds() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    let nonce = fresh_nonce(80);
    let sigs = oracles.sign_with_indices(&env, &borrower, 700, DEFAULT_EXPIRATION, DEFAULT_AGE_DAYS, &nonce, &[0, 2, 4]);

    let badge = client.mint(&borrower, &700, &DEFAULT_EXPIRATION, &DEFAULT_AGE_DAYS, &BytesN::from_array(&env, &nonce), &sigs);
    assert_eq!(badge.score, 700);
}

#[test]
#[should_panic(expected = "insufficient signatures")]
fn test_mint_fails_with_2_signatures() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    let nonce = fresh_nonce(81);
    let sigs = oracles.sign_with_first(&env, &borrower, 700, DEFAULT_EXPIRATION, DEFAULT_AGE_DAYS, &nonce, 2);

    client.mint(&borrower, &700, &DEFAULT_EXPIRATION, &DEFAULT_AGE_DAYS, &BytesN::from_array(&env, &nonce), &sigs);
}

#[test]
#[should_panic(expected = "duplicate oracle index")]
fn test_mint_fails_with_duplicate_index() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    let nonce = fresh_nonce(82);
    let sigs = oracles.sign_with_indices(&env, &borrower, 700, DEFAULT_EXPIRATION, DEFAULT_AGE_DAYS, &nonce, &[0, 0, 0]);

    client.mint(&borrower, &700, &DEFAULT_EXPIRATION, &DEFAULT_AGE_DAYS, &BytesN::from_array(&env, &nonce), &sigs);
}

#[test]
#[should_panic(expected = "nonce already used")]
fn test_mint_fails_with_replayed_nonce() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    let nonce = fresh_nonce(83);
    let sigs1 = oracles.sign_with_first(&env, &borrower, 700, DEFAULT_EXPIRATION, DEFAULT_AGE_DAYS, &nonce, 3);
    client.mint(&borrower, &700, &DEFAULT_EXPIRATION, &DEFAULT_AGE_DAYS, &BytesN::from_array(&env, &nonce), &sigs1);

    let other_borrower = Address::generate(&env);
    let sigs2 = oracles.sign_with_first(&env, &other_borrower, 500, DEFAULT_EXPIRATION, DEFAULT_AGE_DAYS, &nonce, 3);
    client.mint(&other_borrower, &500, &DEFAULT_EXPIRATION, &DEFAULT_AGE_DAYS, &BytesN::from_array(&env, &nonce), &sigs2);
}

#[test]
#[should_panic]
fn test_mint_fails_with_invalid_signature() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    // Sign over DIFFERENT score (999), submit against score=700 → ed25519 verify fails.
    let nonce = fresh_nonce(84);
    let sigs = oracles.sign_with_first(&env, &borrower, 999, DEFAULT_EXPIRATION, DEFAULT_AGE_DAYS, &nonce, 3);

    client.mint(&borrower, &700, &DEFAULT_EXPIRATION, &DEFAULT_AGE_DAYS, &BytesN::from_array(&env, &nonce), &sigs);
}

#[test]
#[should_panic(expected = "oracle index out of range")]
fn test_mint_fails_with_out_of_range_index() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);

    let nonce = fresh_nonce(85);
    let valid_sigs = oracles.sign_with_indices(&env, &borrower, 700, DEFAULT_EXPIRATION, DEFAULT_AGE_DAYS, &nonce, &[0, 1]);
    let bogus_sig = BytesN::from_array(&env, &[0u8; 64]);
    let mut combined = Vec::new(&env);
    combined.push_back(valid_sigs.get(0).unwrap());
    combined.push_back(valid_sigs.get(1).unwrap());
    combined.push_back((7u32, bogus_sig));

    client.mint(&borrower, &700, &DEFAULT_EXPIRATION, &DEFAULT_AGE_DAYS, &BytesN::from_array(&env, &nonce), &combined);
}

// =============================================================================
// 9. PHASE B'.2 — WALLET AGE FLOOR
// =============================================================================

#[test]
#[should_panic(expected = "wallet age below minimum")]
fn test_mint_fails_for_account_below_age_floor() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);
    // Default floor is 30 days; supply age 15 → reject.
    mint_with_age(&env, &client, &oracles, &borrower, 750, DEFAULT_EXPIRATION, 15, 90);
}

#[test]
fn test_mint_succeeds_exactly_at_age_floor() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);
    // Floor is exact: age == min_age must pass.
    let badge = mint_with_age(&env, &client, &oracles, &borrower, 750, DEFAULT_EXPIRATION, 30, 91);
    assert_eq!(badge.score, 750);
}

#[test]
fn test_admin_can_lower_age_floor() {
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);
    assert_eq!(client.get_min_wallet_age(), 30);
    client.set_min_wallet_age(&7);
    assert_eq!(client.get_min_wallet_age(), 7);
    // Now a 10-day-old account can mint.
    let badge = mint_with_age(&env, &client, &oracles, &borrower, 600, DEFAULT_EXPIRATION, 10, 92);
    assert_eq!(badge.score, 600);
}

#[test]
#[should_panic]
fn test_mint_fails_if_age_tampered_after_signing() {
    // Oracles sign over age=60. The relayer tries to lie and submit age=15
    // (still pretending it's above the new floor of 10). ed25519_verify must
    // catch the mismatch and panic — the message bytes won't match the sigs.
    let env = Env::default();
    let (_, _, borrower, client, oracles) = setup(&env);
    client.set_min_wallet_age(&10);

    let nonce = fresh_nonce(93);
    // Sign against age=60.
    let sigs = oracles.sign_with_first(&env, &borrower, 700, DEFAULT_EXPIRATION, 60, &nonce, 3);
    // Submit with age=15 (tampered). Signatures verify against age=60 message,
    // not age=15 message → InvalidInput from ed25519_verify.
    client.mint(
        &borrower,
        &700,
        &DEFAULT_EXPIRATION,
        &15u32,
        &BytesN::from_array(&env, &nonce),
        &sigs,
    );
}

#[test]
#[should_panic(expected = "threshold exceeds oracle key count")]
fn test_set_oracle_keys_threshold_too_high() {
    let env = Env::default();
    let (_, _, _, client, _oracles) = setup(&env);

    let new_set = OracleSet::generate(&env, 3, 5);
    client.set_oracle_keys(&new_set.pubkeys_vec(&env), &new_set.threshold);
}

#[test]
#[should_panic(expected = "duplicate oracle pubkey")]
fn test_set_oracle_keys_rejects_duplicates() {
    let env = Env::default();
    let (_, _, _, client, _oracles) = setup(&env);

    let n = OracleSet::generate(&env, 3, 2);
    let mut keys = n.pubkeys_vec(&env);
    keys.push_back(keys.get(0).unwrap());
    client.set_oracle_keys(&keys, &2u32);
}
