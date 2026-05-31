#![no_std]
//! =============================================================================
//! VIGENTE PROTOCOL — CreditBadge SBT (Soulbound Token)
//! =============================================================================
//!
//! Non-transferable reputation badge for on-chain credit scoring.
//! Features:
//!   - mint():          Oracle-authorized badge issuance with score + expiry
//!   - slash():         Vault-authorized badge burning + immutable default record
//!   - is_defaulted():  Query whether an address has any active default
//!   - get_score():     Query the current active score (None if expired/slashed)
//!
//! Access Control:
//!   - Admin:           Can add/remove authorized oracle and vault addresses
//!   - Oracle:          Can call mint()
//!   - Vault:           Can call slash()
//!
//! Immutability Guarantees:
//!   - Default records (DefaultBadge) are stored in persistent storage and
//!     CANNOT be deleted by any party, including the admin. This ensures
//!     that negative credit events are preserved for the configured retention
//!     period, enforced by Soroban's TTL mechanism.
//! =============================================================================

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, Vec,
};

// External test module
#[cfg(test)]
mod test;

// =============================================================================
// STORAGE KEYS
// =============================================================================

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Contract administrator
    Admin,
    /// Ordered vector of authorized oracle ed25519 public keys (k-of-n threshold).
    /// Indices are stable: a signature references its oracle by index into this vector.
    OracleKeys,
    /// Threshold k — number of valid signatures required to authorize a mint.
    /// Invariant: 0 < OracleThreshold <= OracleKeys.len().
    OracleThreshold,
    /// Anti-replay marker: presence of UsedNonce(nonce) means the nonce was already consumed.
    /// Stored in persistent storage with infinite retention for the lifetime of the contract
    /// (sprint scope; cleanup tied to badge expiration is a post-grant optimization documented
    /// in docs/ARCHITECTURE.md).
    UsedNonce(BytesN<32>),
    /// Minimum wallet age in days required to mint. Phase B'.2 anti-Sybil floor.
    /// Default 30 days. Configurable by admin via `set_min_wallet_age`.
    MinWalletAgeDays,
    /// List of authorized vault addresses (Address-based ACL — vaults remain single-signer
    /// contracts in Soroban; threshold semantics only apply to the oracle side).
    AuthVaults,
    /// Active CreditBadge for a user
    Badge(Address),
    /// Default record for a user (immutable negative history)
    Default(Address),
    /// Whether the contract is paused (circuit breaker)
    Paused,
}

/// Default wallet age floor. Chosen to be hostile to throw-away bot wallets
/// without locking out real PyMEs who just discovered Stellar last month.
const DEFAULT_MIN_WALLET_AGE_DAYS: u32 = 30;

// =============================================================================
// CREDIT BADGE STRUCTURE
// =============================================================================

/// Active reputation badge — represents positive credit standing.
/// This is the "SBT" (Soulbound Token): non-transferable, bound to one address.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct CreditBadge {
    /// Credit score (0-1000)
    pub score: u32,
    /// Ledger timestamp when the badge was minted
    pub issued_at: u64,
    /// Ledger timestamp when the badge expires
    pub expires_at: u64,
    /// SHA-256 hash of the attested data (privacy commitment)
    pub data_hash: BytesN<32>,
    /// Whether the badge has been slashed (burned)
    pub slashed: bool,
}

/// Default record — immutable negative credit event.
/// Once created by a slash, this record CANNOT be deleted.
/// It is stored in persistent storage with a long TTL.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct DefaultBadge {
    /// The score the user had when they were slashed
    pub score_at_default: u32,
    /// Ledger timestamp when the default occurred
    pub defaulted_at: u64,
    /// Address of the vault that initiated the slash
    pub slashed_by: Address,
    /// Reason code (0=unspecified, 1=non_payment, 2=fraud, 3=collateral_shortfall)
    pub reason: u32,
}

// =============================================================================
// CONTRACT DEFINITION
// =============================================================================

#[contract]
pub struct VigenteBadge;

#[contractimpl]
impl VigenteBadge {
    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /// Initialize the contract with an admin address.
    /// Can only be called once.
    ///
    /// Oracle threshold ACL starts empty; admin must call `set_oracle_keys()` before
    /// any `mint()` can succeed. Vault ACL also starts empty; admin calls `add_vault()`.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        // Initialize empty oracle threshold ACL (admin sets these atomically later)
        let empty_keys: Vec<BytesN<32>> = Vec::new(&env);
        env.storage().instance().set(&DataKey::OracleKeys, &empty_keys);
        env.storage().instance().set(&DataKey::OracleThreshold, &0u32);
        // Initialize empty vault authorization list
        let empty_vaults: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&DataKey::AuthVaults, &empty_vaults);
        env.storage().instance().set(&DataKey::Paused, &false);
        // Phase B'.2: default wallet age floor (30 days). Configurable via set_min_wallet_age.
        env.storage().instance().set(&DataKey::MinWalletAgeDays, &DEFAULT_MIN_WALLET_AGE_DAYS);

        // Extend TTL: ~90 days at 5s/ledger
        env.storage().instance().extend_ttl(1_555_200, 1_555_200);

        env.events().publish(
            (symbol_short!("init"), admin.clone()),
            env.ledger().timestamp(),
        );
    }

    // =========================================================================
    // ACCESS CONTROL
    // =========================================================================

    /// Atomically replace the oracle key set and threshold.
    ///
    /// # Access Control
    /// Admin only.
    ///
    /// # Invariants enforced
    /// - `keys.len() > 0`
    /// - `0 < threshold <= keys.len()`
    /// - keys are unique (no duplicate pubkeys)
    ///
    /// # Rationale
    /// Atomic replacement (vs add/remove individual keys) prevents the bricked-contract
    /// failure mode where keys.len() drops below threshold mid-rotation. The admin
    /// must always present a self-consistent set in a single transaction.
    pub fn set_oracle_keys(env: Env, keys: Vec<BytesN<32>>, threshold: u32) {
        let admin: Address = Self::require_admin(&env);
        admin.require_auth();

        let n = keys.len();
        if n == 0 {
            panic!("oracle key set must be non-empty");
        }
        if threshold == 0 {
            panic!("threshold must be > 0");
        }
        if threshold > n {
            panic!("threshold exceeds oracle key count");
        }

        // Reject duplicates — every pubkey must be unique in the set.
        let mut i: u32 = 0;
        while i < n {
            let key_i = keys.get(i).unwrap();
            let mut j: u32 = i + 1;
            while j < n {
                let key_j = keys.get(j).unwrap();
                if key_i == key_j {
                    panic!("duplicate oracle pubkey in set");
                }
                j += 1;
            }
            i += 1;
        }

        env.storage().instance().set(&DataKey::OracleKeys, &keys);
        env.storage().instance().set(&DataKey::OracleThreshold, &threshold);

        env.events().publish(
            (symbol_short!("acl"), symbol_short!("oracles")),
            (n, threshold),
        );
    }

    /// Read-only: current oracle pubkey set.
    pub fn get_oracle_keys(env: Env) -> Vec<BytesN<32>> {
        env.storage().instance()
            .get(&DataKey::OracleKeys)
            .unwrap_or(Vec::new(&env))
    }

    /// Read-only: current threshold.
    pub fn get_oracle_threshold(env: Env) -> u32 {
        env.storage().instance()
            .get(&DataKey::OracleThreshold)
            .unwrap_or(0)
    }

    /// Admin-only: update the minimum wallet age in days required to mint.
    /// Phase B'.2 control surface — tune the anti-Sybil floor without redeploy.
    pub fn set_min_wallet_age(env: Env, min_days: u32) {
        let admin: Address = Self::require_admin(&env);
        admin.require_auth();
        env.storage().instance().set(&DataKey::MinWalletAgeDays, &min_days);
        env.events().publish(
            (symbol_short!("min_age"),),
            min_days,
        );
    }

    /// Read-only: current minimum wallet age requirement (days).
    pub fn get_min_wallet_age(env: Env) -> u32 {
        env.storage().instance()
            .get(&DataKey::MinWalletAgeDays)
            .unwrap_or(DEFAULT_MIN_WALLET_AGE_DAYS)
    }

    /// Add a vault address to the authorization list.
    /// Only the admin can call this.
    pub fn add_vault(env: Env, vault: Address) {
        let admin: Address = Self::require_admin(&env);
        admin.require_auth();

        let mut vaults: Vec<Address> = env.storage().instance()
            .get(&DataKey::AuthVaults)
            .unwrap_or(Vec::new(&env));

        if !vaults.contains(&vault) {
            vaults.push_back(vault.clone());
            env.storage().instance().set(&DataKey::AuthVaults, &vaults);
        }

        env.events().publish(
            (symbol_short!("acl"), symbol_short!("vault")),
            vault,
        );
    }

    /// Remove a vault address from the authorization list.
    /// Only the admin can call this.
    pub fn remove_vault(env: Env, vault: Address) {
        let admin: Address = Self::require_admin(&env);
        admin.require_auth();

        let vaults: Vec<Address> = env.storage().instance()
            .get(&DataKey::AuthVaults)
            .unwrap_or(Vec::new(&env));

        let mut new_vaults: Vec<Address> = Vec::new(&env);
        for v in vaults.iter() {
            if v != vault {
                new_vaults.push_back(v);
            }
        }
        env.storage().instance().set(&DataKey::AuthVaults, &new_vaults);
    }

    // =========================================================================
    // CORE FUNCTIONS
    // =========================================================================

    /// Mint a CreditBadge for a borrower, authorized by a k-of-n threshold of oracle signatures.
    ///
    /// # Access Control
    /// No single oracle authorizes mint. Instead, at least `OracleThreshold` valid
    /// ed25519 signatures over the canonical mint message must be provided, each one
    /// referencing its oracle by index into `OracleKeys`. Signature indices must be
    /// unique within a single call (a single oracle cannot vote twice).
    ///
    /// # Arguments
    /// - `borrower`:          The address receiving the badge.
    /// - `score`:             Credit score (0–1000).
    /// - `expiration`:        Ledger timestamp when the badge expires.
    /// - `account_age_days`:  Off-chain–measured wallet age. Must be >=
    ///                         MinWalletAgeDays. Bundled into the signed message
    ///                         so a compromised oracle node alone cannot grant
    ///                         a badge to a fresh bot wallet.
    /// - `nonce`:             32-byte anti-replay marker chosen off-chain. Each
    ///                         nonce can be used exactly once across the contract's
    ///                         lifetime.
    /// - `signatures`:        Vec of (oracle_index, ed25519_signature) tuples.
    ///                         Length must be >= OracleThreshold.
    ///
    /// # Canonical message
    /// Each oracle signs
    /// `borrower.to_xdr() || score.to_be_bytes() || expiration.to_be_bytes() || account_age_days.to_be_bytes() || nonce`.
    /// Off-chain signers MUST reproduce this byte sequence exactly.
    ///
    /// # Panics
    /// - If contract is paused.
    /// - If borrower is currently in default.
    /// - If score > 1000.
    /// - If expiration is not strictly in the future.
    /// - If account_age_days < MinWalletAgeDays.
    /// - If the nonce was already consumed.
    /// - If signatures.len() < OracleThreshold.
    /// - If any signature index is out of range or duplicated within this call.
    /// - If any signature fails ed25519 verification.
    pub fn mint(
        env: Env,
        borrower: Address,
        score: u32,
        expiration: u64,
        account_age_days: u32,
        nonce: BytesN<32>,
        signatures: Vec<(u32, BytesN<64>)>,
    ) -> CreditBadge {
        Self::require_not_paused(&env);

        // Cannot mint for a defaulted borrower.
        if Self::is_defaulted(env.clone(), borrower.clone()) {
            panic!("borrower is in default");
        }

        // Validate score.
        if score > 1000 {
            panic!("invalid score: must be 0-1000");
        }

        // Validate expiration is in the future.
        let now = env.ledger().timestamp();
        if expiration <= now {
            panic!("expiration must be in the future");
        }

        // Anti-Sybil floor: reject borrowers whose wallet is too young.
        // Note: the age value is bundled into the signed message below, so a
        // single rogue oracle cannot lie about it — the other k-1 honest
        // oracles refuse to co-sign a forged age.
        let min_age: u32 = env.storage().instance()
            .get(&DataKey::MinWalletAgeDays)
            .unwrap_or(DEFAULT_MIN_WALLET_AGE_DAYS);
        if account_age_days < min_age {
            panic!("wallet age below minimum");
        }

        // Anti-replay: the nonce must not have been used before.
        let nonce_key = DataKey::UsedNonce(nonce.clone());
        if env.storage().persistent().has(&nonce_key) {
            panic!("nonce already used");
        }

        // Threshold verification: load oracle key set + threshold from storage.
        let oracle_keys: Vec<BytesN<32>> = env.storage().instance()
            .get(&DataKey::OracleKeys)
            .unwrap_or(Vec::new(&env));
        let threshold: u32 = env.storage().instance()
            .get(&DataKey::OracleThreshold)
            .unwrap_or(0);

        if threshold == 0 || oracle_keys.is_empty() {
            panic!("oracle threshold ACL not configured");
        }
        if signatures.len() < threshold {
            panic!("insufficient signatures: threshold not met");
        }

        // Build the canonical mint message that every signature must verify against.
        let msg: Bytes = Self::build_mint_message(&env, &borrower, score, expiration, account_age_days, &nonce);

        // Verify each signature and enforce unique indices within this call.
        // We track seen indices in a Vec<u32>; the threshold is small (k <= n, typically
        // single-digit), so a linear scan is cheaper than a Map here.
        let n_keys = oracle_keys.len();
        let n_sigs = signatures.len();
        let mut seen_indices: Vec<u32> = Vec::new(&env);
        let mut i: u32 = 0;
        while i < n_sigs {
            let (idx, sig) = signatures.get(i).unwrap();
            if idx >= n_keys {
                panic!("oracle index out of range");
            }
            if seen_indices.contains(&idx) {
                panic!("duplicate oracle index in signatures");
            }
            seen_indices.push_back(idx);

            let pk = oracle_keys.get(idx).unwrap();
            // ed25519_verify panics on invalid signature — propagates as host error.
            env.crypto().ed25519_verify(&pk, &msg, &sig);

            i += 1;
        }

        // Mark the nonce consumed (anti-replay) before mutating any other persistent state.
        env.storage().persistent().set(&nonce_key, &true);
        env.storage().persistent().extend_ttl(&nonce_key, 1_555_200, 1_555_200);

        // Create badge — data_hash binds the badge to this specific borrower address.
        let data_hash: BytesN<32> = env.crypto().sha256(&borrower.clone().to_xdr(&env)).into();
        let badge = CreditBadge {
            score,
            issued_at: now,
            expires_at: expiration,
            data_hash: data_hash.clone(),
            slashed: false,
        };

        // Store in persistent storage.
        env.storage().persistent().set(&DataKey::Badge(borrower.clone()), &badge);
        env.storage().persistent().extend_ttl(
            &DataKey::Badge(borrower.clone()),
            1_555_200,
            1_555_200,
        );

        // Emit mint event.
        env.events().publish(
            (symbol_short!("mint"), borrower.clone()),
            (score, now, expiration),
        );

        badge
    }

    /// Build the canonical byte sequence each oracle signs over.
    /// Off-chain signers must reproduce this exactly:
    /// `borrower.to_xdr() || score_be(4) || expiration_be(8) || account_age_days_be(4) || nonce(32)`
    /// = 44 + 4 + 8 + 4 + 32 = 92 bytes for a G-address borrower.
    fn build_mint_message(
        env: &Env,
        borrower: &Address,
        score: u32,
        expiration: u64,
        account_age_days: u32,
        nonce: &BytesN<32>,
    ) -> Bytes {
        let mut msg = borrower.clone().to_xdr(env);
        msg.extend_from_array(&score.to_be_bytes());
        msg.extend_from_array(&expiration.to_be_bytes());
        msg.extend_from_array(&account_age_days.to_be_bytes());
        msg.append(&nonce.clone().into());
        msg
    }

    /// Slash (burn) a borrower's active badge and record a permanent default.
    ///
    /// # Access Control
    /// Only an authorized vault can call this function.
    ///
    /// # Arguments
    /// - `caller`:   The vault address invoking slash (must be authorized)
    /// - `borrower`: The address being slashed
    /// - `reason`:   Reason code (0=unspecified, 1=non_payment, 2=fraud, 3=collateral_shortfall)
    ///
    /// # Behavior
    /// 1. Marks the active CreditBadge as `slashed = true`
    /// 2. Creates an immutable DefaultBadge in persistent storage
    /// 3. Emits a "slash" event with the default details
    ///
    /// # Panics
    /// - If caller is not an authorized vault
    /// - If borrower has no active badge
    /// - If borrower is already in default
    pub fn slash(
        env: Env,
        caller: Address,
        borrower: Address,
        reason: u32,
    ) {
        Self::require_not_paused(&env);
        caller.require_auth();
        Self::require_vault(&env, &caller);

        // Verify borrower has an active badge
        let badge_key = DataKey::Badge(borrower.clone());
        let badge: CreditBadge = env.storage().persistent()
            .get(&badge_key)
            .expect("no active badge to slash");

        if badge.slashed {
            panic!("badge already slashed");
        }

        // Check not already defaulted
        if env.storage().persistent().has(&DataKey::Default(borrower.clone())) {
            panic!("borrower already in default");
        }

        // Validate reason code
        if reason > 3 {
            panic!("invalid reason code: must be 0-3");
        }

        let now = env.ledger().timestamp();

        // 1. Mark badge as slashed
        let slashed_badge = CreditBadge {
            score: badge.score,
            issued_at: badge.issued_at,
            expires_at: badge.expires_at,
            data_hash: badge.data_hash.clone(),
            slashed: true,
        };
        env.storage().persistent().set(&badge_key, &slashed_badge);

        // 2. Create immutable default record
        let default_badge = DefaultBadge {
            score_at_default: badge.score,
            defaulted_at: now,
            slashed_by: caller.clone(),
            reason,
        };

        let default_key = DataKey::Default(borrower.clone());
        env.storage().persistent().set(&default_key, &default_badge);
        // Extend TTL to maximum — this record should persist as long as possible
        // ~2 years at 5s/ledger
        env.storage().persistent().extend_ttl(&default_key, 12_614_400, 12_614_400);

        // 3. Emit slash event (immutable audit trail)
        env.events().publish(
            (symbol_short!("slash"), borrower.clone()),
            (badge.score, now, reason, caller),
        );
    }

    /// Check if a borrower is currently in default.
    ///
    /// Returns `true` if:
    /// - A DefaultBadge record exists for this borrower, OR
    /// - The borrower's active badge has been slashed
    ///
    /// This function is public and can be called by anyone (read-only).
    pub fn is_defaulted(env: Env, borrower: Address) -> bool {
        // Check for immutable default record
        if env.storage().persistent().has(&DataKey::Default(borrower.clone())) {
            return true;
        }

        // Also check if badge is slashed
        let badge: Option<CreditBadge> = env.storage().persistent()
            .get(&DataKey::Badge(borrower));

        match badge {
            Some(b) => b.slashed,
            None => false,
        }
    }

    /// Get the credit score for a borrower.
    ///
    /// Returns `None` if:
    /// - No badge exists
    /// - The badge has been slashed
    /// - The badge has expired
    ///
    /// Returns `Some(score)` if the badge is active and valid.
    pub fn get_score(env: Env, borrower: Address) -> Option<u32> {
        let badge: Option<CreditBadge> = env.storage().persistent()
            .get(&DataKey::Badge(borrower));

        match badge {
            Some(b) => {
                if b.slashed {
                    return None;
                }
                let now = env.ledger().timestamp();
                if now > b.expires_at {
                    return None;
                }
                Some(b.score)
            }
            None => None,
        }
    }

    /// Get the full badge details for a borrower (if active).
    pub fn get_badge(env: Env, borrower: Address) -> Option<CreditBadge> {
        let badge: Option<CreditBadge> = env.storage().persistent()
            .get(&DataKey::Badge(borrower));

        match badge {
            Some(b) => {
                if b.slashed {
                    return None;
                }
                let now = env.ledger().timestamp();
                if now > b.expires_at {
                    return None;
                }
                Some(b)
            }
            None => None,
        }
    }

    /// Get the default record for a borrower (if exists).
    /// This is public — anyone can check a borrower's default history.
    pub fn get_default(env: Env, borrower: Address) -> Option<DefaultBadge> {
        env.storage().persistent().get(&DataKey::Default(borrower))
    }

    /// Get the contract admin address.
    pub fn get_admin(env: Env) -> Address {
        Self::require_admin(&env)
    }

    // =========================================================================
    // CIRCUIT BREAKER
    // =========================================================================

    /// Pause the contract. Only admin can call.
    /// When paused, mint and slash are disabled.
    pub fn pause(env: Env) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (symbol_short!("pause"),),
            env.ledger().timestamp(),
        );
    }

    /// Unpause the contract. Only admin can call.
    pub fn unpause(env: Env) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (symbol_short!("unpause"),),
            env.ledger().timestamp(),
        );
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    fn require_admin(env: &Env) -> Address {
        env.storage().instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn require_vault(env: &Env, caller: &Address) {
        let vaults: Vec<Address> = env.storage().instance()
            .get(&DataKey::AuthVaults)
            .unwrap_or(Vec::new(env));

        if !vaults.contains(caller) {
            panic!("caller is not an authorized vault");
        }
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env.storage().instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }
}
