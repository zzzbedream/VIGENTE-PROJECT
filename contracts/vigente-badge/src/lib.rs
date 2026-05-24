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
    Address, BytesN, Env, Vec,
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
    /// List of authorized oracle addresses
    AuthOracles,
    /// List of authorized vault addresses
    AuthVaults,
    /// Active CreditBadge for a user
    Badge(Address),
    /// Default record for a user (immutable negative history)
    Default(Address),
    /// Whether the contract is paused (circuit breaker)
    Paused,
}

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
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        // Initialize empty authorization lists
        let empty_oracles: Vec<Address> = Vec::new(&env);
        let empty_vaults: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&DataKey::AuthOracles, &empty_oracles);
        env.storage().instance().set(&DataKey::AuthVaults, &empty_vaults);
        env.storage().instance().set(&DataKey::Paused, &false);

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

    /// Add an oracle address to the authorization list.
    /// Only the admin can call this.
    pub fn add_oracle(env: Env, oracle: Address) {
        let admin: Address = Self::require_admin(&env);
        admin.require_auth();

        let mut oracles: Vec<Address> = env.storage().instance()
            .get(&DataKey::AuthOracles)
            .unwrap_or(Vec::new(&env));

        // Prevent duplicates
        if !oracles.contains(&oracle) {
            oracles.push_back(oracle.clone());
            env.storage().instance().set(&DataKey::AuthOracles, &oracles);
        }

        env.events().publish(
            (symbol_short!("acl"), symbol_short!("oracle")),
            oracle,
        );
    }

    /// Remove an oracle address from the authorization list.
    /// Only the admin can call this.
    pub fn remove_oracle(env: Env, oracle: Address) {
        let admin: Address = Self::require_admin(&env);
        admin.require_auth();

        let oracles: Vec<Address> = env.storage().instance()
            .get(&DataKey::AuthOracles)
            .unwrap_or(Vec::new(&env));

        let mut new_oracles: Vec<Address> = Vec::new(&env);
        for o in oracles.iter() {
            if o != oracle {
                new_oracles.push_back(o);
            }
        }
        env.storage().instance().set(&DataKey::AuthOracles, &new_oracles);
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

    /// Mint a CreditBadge for a borrower.
    ///
    /// # Access Control
    /// Only an authorized oracle can call this function.
    ///
    /// # Arguments
    /// - `caller`:     The oracle address invoking mint (must be authorized)
    /// - `borrower`:   The address receiving the badge
    /// - `score`:      Credit score (0–1000)
    /// - `expiration`: Ledger timestamp when the badge expires
    ///
    /// # Panics
    /// - If caller is not an authorized oracle
    /// - If borrower is currently in default
    /// - If score > 1000
    /// - If contract is paused
    pub fn mint(
        env: Env,
        caller: Address,
        borrower: Address,
        score: u32,
        expiration: u64,
    ) -> CreditBadge {
        Self::require_not_paused(&env);
        caller.require_auth();
        Self::require_oracle(&env, &caller);

        // Cannot mint for a defaulted borrower
        if Self::is_defaulted(env.clone(), borrower.clone()) {
            panic!("borrower is in default");
        }

        // Validate score
        if score > 1000 {
            panic!("invalid score: must be 0-1000");
        }

        // Validate expiration is in the future
        let now = env.ledger().timestamp();
        if expiration <= now {
            panic!("expiration must be in the future");
        }

        // Create badge — data_hash binds the badge to this specific borrower address
        let data_hash: BytesN<32> = env.crypto().sha256(&borrower.clone().to_xdr(&env)).into();
        let badge = CreditBadge {
            score,
            issued_at: now,
            expires_at: expiration,
            data_hash: data_hash.clone(),
            slashed: false,
        };

        // Store in persistent storage
        env.storage().persistent().set(&DataKey::Badge(borrower.clone()), &badge);
        env.storage().persistent().extend_ttl(
            &DataKey::Badge(borrower.clone()),
            1_555_200,
            1_555_200,
        );

        // Emit mint event
        env.events().publish(
            (symbol_short!("mint"), borrower.clone()),
            (score, now, expiration),
        );

        badge
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

    fn require_oracle(env: &Env, caller: &Address) {
        let oracles: Vec<Address> = env.storage().instance()
            .get(&DataKey::AuthOracles)
            .unwrap_or(Vec::new(env));

        if !oracles.contains(caller) {
            panic!("caller is not an authorized oracle");
        }
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
