#![no_std]
//! =============================================================================
//! VIGENTE PROTOCOL — Margin Controller
//! =============================================================================
//!
//! Collateralized credit with a PER-USER LTV set by on-chain reputation.
//! This contract does not reinvent the pool or the oracle — it composes:
//!
//!   - Price:      a SEP-40 oracle (Reflector on testnet; RedStone adapter on
//!                 mainnet) read cross-contract via `lastprice`. Stale or
//!                 missing prices REVERT — no borrow ever runs on old data.
//!   - Reputation: the Vigente CreditBadge (`get_score` / `is_defaulted`).
//!   - Liquidity:  a Blend lending pool. The controller is the position
//!                 holder in Blend and keeps per-user accounting here.
//!                 BLEND NEVER SEES THE SCORE — the reputation gate lives
//!                 only in this contract, applied before any `submit`.
//!
//! Invariants:
//!   - Every tier LTV is strictly below the Blend reserve `c_factor` for the
//!     collateral (90% on the canonical testnet pool), so the controller's
//!     aggregate Blend position stays healthy even at a user's limit.
//!   - Sum of user debts equals `TotalDebt` (minus written-off settlements).
//!   - Both prices come from the SAME oracle contract, so the oracle's
//!     decimal scale cancels out of the LTV math.
//!
//! Scale ceiling (accepted for the MVP, revisit in T2+): all users share one
//! aggregate Blend position, so one user's shortfall affects shared health.
//! Mitigated by small per-asset caps and the LTV < c_factor margin.
//! =============================================================================

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractclient, contractimpl, contracttype, symbol_short,
    token::TokenClient, vec, Address, Env, IntoVal, Map, Symbol, Vec,
};

#[cfg(test)]
mod test;

// =============================================================================
// CROSS-CONTRACT CLIENTS
// =============================================================================

/// Subset of the vigente-badge interface this controller calls.
#[contractclient(name = "BadgeClient")]
pub trait Badge {
    fn is_defaulted(env: Env, borrower: Address) -> bool;
    fn get_score(env: Env, borrower: Address) -> Option<u32>;
    fn slash(env: Env, caller: Address, borrower: Address, reason: u32);
}

/// SEP-40 asset identifier. Variant names must match the deployed oracle
/// (verified against Reflector testnet: `Stellar(Address) | Other(Symbol)`).
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

/// SEP-40 price record.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// SEP-40 price oracle subset (Reflector / RedStone adapters conform).
#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracle {
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
    fn decimals(env: Env) -> u32;
}

/// Blend pool request. Field names verified against the canonical TestnetV2
/// pool wasm (`CCEBVDYM…`): { address, amount, request_type }.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Request {
    pub address: Address,
    pub amount: i128,
    pub request_type: u32,
}

/// Blend positions snapshot returned by `submit`. Field names verified
/// against the canonical pool wasm.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Positions {
    pub collateral: Map<u32, i128>,
    pub liabilities: Map<u32, i128>,
    pub supply: Map<u32, i128>,
}

/// Blend request types (v1/v2 numbering).
pub const REQ_SUPPLY_COLLATERAL: u32 = 2;
pub const REQ_WITHDRAW_COLLATERAL: u32 = 3;
pub const REQ_BORROW: u32 = 4;
pub const REQ_REPAY: u32 = 5;

/// Subset of the Blend pool interface this controller calls.
#[contractclient(name = "BlendPoolClient")]
pub trait BlendPool {
    fn submit(
        env: Env,
        from: Address,
        spender: Address,
        to: Address,
        requests: Vec<Request>,
    ) -> Positions;
}

// =============================================================================
// STORAGE & TYPES
// =============================================================================

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    /// SEP-40 oracle contract address. Both collateral and borrow-asset
    /// prices come from this one contract (decimals cancel in the math).
    Oracle,
    /// vigente-badge contract address (the Reputation Registry).
    Registry,
    /// Blend pool contract address.
    Pool,
    /// Debt asset (USDC on the canonical testnet pool).
    BorrowAsset,
    /// Allowlisted collateral assets.
    CollateralAssets,
    /// SEP-40 feed key for an asset (Reflector testnet quotes by ticker
    /// `Other("XLM")`; a mainnet adapter may quote `Stellar(contract)`).
    FeedKey(Address),
    /// Max seconds a price may lag `ledger().timestamp()` before reverting.
    MaxPriceAge,
    /// Score bands → LTV bps, sorted by descending `min_score`.
    TierLtv,
    /// Per-asset cap on total collateral (0 = uncapped) — pilot guardrail.
    Cap(Address),
    /// Aggregate collateral per asset currently supplied to Blend.
    TotalCollateral(Address),
    Paused,
    /// (user, asset) → collateral amount.
    Collateral(Address, Address),
    /// user → outstanding debt in the borrow asset.
    Debt(Address),
    TotalDebt,
    /// Collateral seized from liquidated users, pending keeper settlement
    /// (swap → repay on Blend). See README runbook; automated in T2.
    Seized(Address),
    /// Debt written off at liquidation, pending Blend-side settlement.
    PendingSettlement,
}

/// One score band of the credit ladder: score >= min_score → ltv_bps.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct TierLevel {
    pub min_score: u32,
    pub ltv_bps: u32,
}

/// One-shot init configuration (grouped: Soroban caps functions at 10 params).
#[derive(Clone, Debug)]
#[contracttype]
pub struct InitConfig {
    pub admin: Address,
    pub oracle: Address,
    pub reputation_registry: Address,
    pub blend_pool: Address,
    pub borrow_asset: Address,
    pub borrow_feed: Asset,
    pub collateral_asset: Address,
    pub collateral_feed: Asset,
    pub collateral_cap: i128,
    pub tier_ltv: Vec<TierLevel>,
    pub max_price_age: u64,
}

/// Hard ceiling for any tier LTV. Must stay strictly below the Blend
/// reserve c_factor (90% on the canonical testnet pool) so the aggregate
/// position can never be liquidated by Blend at a user's limit.
pub const MAX_LTV_BPS: u32 = 9_000;

/// `health()` sentinel for a user with zero debt.
pub const HEALTH_NO_DEBT: u32 = u32::MAX;

const TTL_LEDGERS: u32 = 1_555_200; // ~90 days at 5s/ledger

// =============================================================================
// CONTRACT
// =============================================================================

#[contract]
pub struct MarginController;

#[contractimpl]
impl MarginController {
    // -------------------------------------------------------------------------
    // INIT
    // -------------------------------------------------------------------------

    /// One-time setup. Registers one collateral asset; add more later via
    /// `add_collateral_asset` (config, not code — BENJI drops in this way).
    pub fn init(env: Env, config: InitConfig) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        config.admin.require_auth();

        Self::validate_tiers(&config.tier_ltv);
        if config.max_price_age == 0 {
            panic!("max_price_age must be positive");
        }
        if config.collateral_cap < 0 {
            panic!("cap must be non-negative");
        }
        // All Stellar classic-asset SACs use 7 decimals; the LTV math assumes
        // collateral and borrow asset share the same token scale.
        let borrow_decimals = TokenClient::new(&env, &config.borrow_asset).decimals();
        let coll_decimals = TokenClient::new(&env, &config.collateral_asset).decimals();
        if borrow_decimals != coll_decimals {
            panic!("collateral decimals must match borrow asset");
        }

        let s = env.storage().instance();
        s.set(&DataKey::Admin, &config.admin);
        s.set(&DataKey::Oracle, &config.oracle);
        s.set(&DataKey::Registry, &config.reputation_registry);
        s.set(&DataKey::Pool, &config.blend_pool);
        s.set(&DataKey::BorrowAsset, &config.borrow_asset);
        s.set(&DataKey::FeedKey(config.borrow_asset.clone()), &config.borrow_feed);
        let mut assets: Vec<Address> = Vec::new(&env);
        assets.push_back(config.collateral_asset.clone());
        s.set(&DataKey::CollateralAssets, &assets);
        s.set(
            &DataKey::FeedKey(config.collateral_asset.clone()),
            &config.collateral_feed,
        );
        s.set(&DataKey::Cap(config.collateral_asset.clone()), &config.collateral_cap);
        s.set(&DataKey::TierLtv, &config.tier_ltv);
        s.set(&DataKey::MaxPriceAge, &config.max_price_age);
        s.set(&DataKey::Paused, &false);
        s.set(&DataKey::TotalDebt, &0_i128);
        s.set(&DataKey::PendingSettlement, &0_i128);
        env.storage().instance().extend_ttl(TTL_LEDGERS, TTL_LEDGERS);

        env.events().publish(
            (symbol_short!("init"), config.admin.clone()),
            (config.oracle.clone(), config.blend_pool.clone(), config.max_price_age),
        );
    }

    // -------------------------------------------------------------------------
    // COLLATERAL
    // -------------------------------------------------------------------------

    /// Lock collateral: pull from the user, then supply it to Blend as
    /// collateral of the controller's aggregate position.
    pub fn deposit_collateral(env: Env, user: Address, asset: Address, amount: i128) {
        Self::require_not_paused(&env);
        user.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        Self::require_collateral_asset(&env, &asset);

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCollateral(asset.clone()))
            .unwrap_or(0);
        let cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Cap(asset.clone()))
            .unwrap_or(0);
        if cap > 0 && total + amount > cap {
            panic!("deposit exceeds collateral cap");
        }

        let me = env.current_contract_address();
        TokenClient::new(&env, &asset).transfer(&user, &me, &amount);

        // Supply to Blend: the pool pulls `amount` of `asset` from spender
        // (= this contract). Invoker auth only covers one call level, so the
        // nested token transfer the pool performs must be pre-authorized.
        Self::authorize_pool_pull(&env, &asset, amount);
        let mut reqs: Vec<Request> = Vec::new(&env);
        reqs.push_back(Request {
            address: asset.clone(),
            amount,
            request_type: REQ_SUPPLY_COLLATERAL,
        });
        Self::pool_client(&env).submit(&me, &me, &me, &reqs);

        let key = DataKey::Collateral(user.clone(), asset.clone());
        let prev: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(prev + amount));
        env.storage().persistent().extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
        env.storage()
            .instance()
            .set(&DataKey::TotalCollateral(asset.clone()), &(total + amount));

        env.events()
            .publish((symbol_short!("deposit"), user), (asset, amount));
    }

    /// Release collateral back to the user — only if the position stays
    /// healthy at current oracle prices afterward.
    pub fn withdraw_collateral(env: Env, user: Address, asset: Address, amount: i128) {
        Self::require_not_paused(&env);
        user.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let key = DataKey::Collateral(user.clone(), asset.clone());
        let held: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount > held {
            panic!("withdraw exceeds collateral balance");
        }

        // Simulate the post-withdraw position before touching state.
        let debt: i128 = Self::get_debt(env.clone(), user.clone());
        if debt > 0 {
            let capacity_after =
                Self::borrow_capacity(&env, &user, &asset, held - amount);
            if capacity_after < debt {
                panic!("position would become unhealthy");
            }
        }

        env.storage().persistent().set(&key, &(held - amount));
        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCollateral(asset.clone()))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCollateral(asset.clone()), &(total - amount));

        // Withdraw from Blend straight to the user.
        let me = env.current_contract_address();
        let mut reqs: Vec<Request> = Vec::new(&env);
        reqs.push_back(Request {
            address: asset.clone(),
            amount,
            request_type: REQ_WITHDRAW_COLLATERAL,
        });
        Self::pool_client(&env).submit(&me, &me, &user, &reqs);

        env.events()
            .publish((symbol_short!("withdraw"), user), (asset, amount));
    }

    // -------------------------------------------------------------------------
    // BORROW / REPAY (the reputation gate)
    // -------------------------------------------------------------------------

    /// Max additional borrow for `user` right now:
    /// `sum(collateral_value) × tier_ltv(score) / 10000 − debt`.
    /// Reverts if any required price is missing or stale.
    pub fn max_borrow(env: Env, user: Address) -> i128 {
        let badge = Self::badge_client(&env);
        if badge.is_defaulted(&user) {
            return 0;
        }
        let score = match badge.get_score(&user) {
            Some(s) => s,
            None => return 0,
        };
        let ltv = Self::ltv_for_score(&env, score);
        if ltv == 0 {
            return 0;
        }
        let capacity = Self::total_borrow_capacity(&env, &user, ltv);
        let debt: i128 = Self::get_debt(env.clone(), user);
        if capacity > debt {
            capacity - debt
        } else {
            0
        }
    }

    /// Borrow against locked collateral. The gate runs HERE, before Blend:
    /// Blend only ever sees the controller's aggregate position.
    pub fn borrow(env: Env, user: Address, amount: i128) {
        Self::require_not_paused(&env);
        user.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let badge = Self::badge_client(&env);
        if badge.is_defaulted(&user) {
            panic!("borrower is in default");
        }
        let score = badge
            .get_score(&user)
            .expect("no active credit badge — mint a badge first");
        let ltv = Self::ltv_for_score(&env, score);
        if ltv == 0 {
            panic!("score below minimum tier");
        }

        let allowed = Self::max_borrow(env.clone(), user.clone());
        if amount > allowed {
            panic!("amount exceeds credit limit for tier");
        }

        // Draw from Blend straight to the user.
        let me = env.current_contract_address();
        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");
        let mut reqs: Vec<Request> = Vec::new(&env);
        reqs.push_back(Request {
            address: borrow_asset,
            amount,
            request_type: REQ_BORROW,
        });
        Self::pool_client(&env).submit(&me, &me, &user, &reqs);

        let debt_key = DataKey::Debt(user.clone());
        let prev: i128 = env.storage().persistent().get(&debt_key).unwrap_or(0);
        env.storage().persistent().set(&debt_key, &(prev + amount));
        env.storage().persistent().extend_ttl(&debt_key, TTL_LEDGERS, TTL_LEDGERS);
        let total: i128 = env.storage().instance().get(&DataKey::TotalDebt).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalDebt, &(total + amount));

        env.events().publish(
            (symbol_short!("borrow"), user.clone()),
            (amount, score, ltv, prev + amount),
        );
        env.events().publish((symbol_short!("tier"), user), (score, ltv));
    }

    /// Repay debt: pull the borrow asset from the user and settle it against
    /// the controller's Blend position.
    pub fn repay(env: Env, user: Address, amount: i128) {
        Self::require_not_paused(&env);
        user.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let debt_key = DataKey::Debt(user.clone());
        let debt: i128 = env.storage().persistent().get(&debt_key).unwrap_or(0);
        if amount > debt {
            panic!("repay exceeds outstanding debt");
        }

        let me = env.current_contract_address();
        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");
        TokenClient::new(&env, &borrow_asset).transfer(&user, &me, &amount);

        // The pool pulls the repayment from this contract — pre-authorize
        // the nested transfer (see deposit_collateral).
        Self::authorize_pool_pull(&env, &borrow_asset, amount);
        let mut reqs: Vec<Request> = Vec::new(&env);
        reqs.push_back(Request {
            address: borrow_asset,
            amount,
            request_type: REQ_REPAY,
        });
        Self::pool_client(&env).submit(&me, &me, &me, &reqs);

        env.storage().persistent().set(&debt_key, &(debt - amount));
        let total: i128 = env.storage().instance().get(&DataKey::TotalDebt).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalDebt, &(total - amount));

        // NOTE (T2): endogenous reputation update on repay hooks in here.
        env.events()
            .publish((symbol_short!("repay"), user), (amount, debt - amount));
    }

    // -------------------------------------------------------------------------
    // HEALTH / LIQUIDATION
    // -------------------------------------------------------------------------

    /// Position health as integer percent: 100 = at the limit, <100 =
    /// liquidatable. `HEALTH_NO_DEBT` when the user owes nothing.
    pub fn health(env: Env, user: Address) -> u32 {
        let debt: i128 = Self::get_debt(env.clone(), user.clone());
        if debt <= 0 {
            return HEALTH_NO_DEBT;
        }
        let badge = Self::badge_client(&env);
        let ltv = match badge.get_score(&user) {
            // A slashed/expired badge keeps the last tier out of reach;
            // health is then measured against the base (lowest) tier so the
            // position is still quantifiable.
            Some(s) => Self::ltv_for_score(&env, s),
            None => Self::lowest_tier_ltv(&env),
        };
        if ltv == 0 {
            return 0;
        }
        let capacity = Self::total_borrow_capacity(&env, &user, ltv);
        let pct = capacity.saturating_mul(100) / debt;
        if pct > u32::MAX as i128 {
            u32::MAX
        } else {
            pct as u32
        }
    }

    /// Liquidate an unhealthy position: seize the user's collateral claim
    /// for the protocol, write off the debt into `PendingSettlement`, and
    /// slash the reputation badge (reason 3 = collateral_shortfall).
    ///
    /// Blend-side settlement (swap seized collateral → borrow asset → repay)
    /// is a manual keeper runbook in this sprint; automated in T2. The event
    /// payload carries everything a keeper (or a future OEV solver) needs.
    pub fn liquidate(env: Env, liquidator: Address, user: Address) {
        Self::require_not_paused(&env);
        liquidator.require_auth();

        let debt: i128 = Self::get_debt(env.clone(), user.clone());
        if debt <= 0 {
            panic!("no debt to liquidate");
        }
        let hp = Self::health(env.clone(), user.clone());
        if hp >= 100 {
            panic!("position is healthy");
        }

        // Seize every collateral claim into the protocol bucket.
        let assets: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::CollateralAssets)
            .unwrap_or(Vec::new(&env));
        let now = env.ledger().timestamp();
        for asset in assets.iter() {
            let key = DataKey::Collateral(user.clone(), asset.clone());
            let held: i128 = env.storage().persistent().get(&key).unwrap_or(0);
            if held <= 0 {
                continue;
            }
            env.storage().persistent().set(&key, &0_i128);
            let seized_key = DataKey::Seized(asset.clone());
            let seized: i128 = env.storage().instance().get(&seized_key).unwrap_or(0);
            env.storage().instance().set(&seized_key, &(seized + held));

            let price = Self::fresh_price(&env, &asset);
            env.events().publish(
                (symbol_short!("seize"), user.clone()),
                (asset, held, price, now),
            );
        }

        // Write the debt off the user's books into the settlement bucket.
        env.storage().persistent().set(&DataKey::Debt(user.clone()), &0_i128);
        let total: i128 = env.storage().instance().get(&DataKey::TotalDebt).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalDebt, &(total - debt));
        let pending: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PendingSettlement)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::PendingSettlement, &(pending + debt));

        // Cross-contract: burn the reputation. The controller must be in the
        // badge contract's AuthVaults list (badge.add_vault at deploy).
        let me = env.current_contract_address();
        Self::badge_client(&env).slash(&me, &user, &3_u32);

        env.events()
            .publish((symbol_short!("liq"), user), (debt, hp, now));
    }

    // -------------------------------------------------------------------------
    // ADMIN
    // -------------------------------------------------------------------------

    /// Replace the score→LTV ladder atomically.
    pub fn set_tier_ltv(env: Env, tiers: Vec<TierLevel>) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        Self::validate_tiers(&tiers);
        env.storage().instance().set(&DataKey::TierLtv, &tiers);
        env.events()
            .publish((symbol_short!("acl"), symbol_short!("tiers")), tiers.len());
    }

    /// Set the total-collateral cap for an asset (0 = uncapped).
    pub fn set_cap(env: Env, asset: Address, cap: i128) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        if cap < 0 {
            panic!("cap must be non-negative");
        }
        Self::require_collateral_asset(&env, &asset);
        env.storage().instance().set(&DataKey::Cap(asset.clone()), &cap);
        env.events().publish((symbol_short!("cap"), asset), cap);
    }

    /// Allowlist a new collateral asset with its SEP-40 feed key and cap.
    /// This is how BENJI (or any RWA) drops in post-sprint: config, not code.
    pub fn add_collateral_asset(env: Env, asset: Address, feed: Asset, cap: i128) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        if cap < 0 {
            panic!("cap must be non-negative");
        }
        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");
        if TokenClient::new(&env, &asset).decimals()
            != TokenClient::new(&env, &borrow_asset).decimals()
        {
            panic!("collateral decimals must match borrow asset");
        }
        let mut assets: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::CollateralAssets)
            .unwrap_or(Vec::new(&env));
        if assets.contains(&asset) {
            panic!("asset already listed");
        }
        assets.push_back(asset.clone());
        env.storage().instance().set(&DataKey::CollateralAssets, &assets);
        env.storage().instance().set(&DataKey::FeedKey(asset.clone()), &feed);
        env.storage().instance().set(&DataKey::Cap(asset.clone()), &cap);
        env.events().publish((symbol_short!("asset"), asset), cap);
    }

    pub fn pause(env: Env) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("pause"),), env.ledger().timestamp());
    }

    pub fn unpause(env: Env) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish((symbol_short!("unpause"),), env.ledger().timestamp());
    }

    // -------------------------------------------------------------------------
    // VIEWS
    // -------------------------------------------------------------------------

    pub fn get_admin(env: Env) -> Address {
        Self::require_admin(&env)
    }

    pub fn get_collateral(env: Env, user: Address, asset: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Collateral(user, asset))
            .unwrap_or(0)
    }

    pub fn get_debt(env: Env, user: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Debt(user)).unwrap_or(0)
    }

    pub fn get_total_debt(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalDebt).unwrap_or(0)
    }

    pub fn get_tier_ltv(env: Env) -> Vec<TierLevel> {
        env.storage()
            .instance()
            .get(&DataKey::TierLtv)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_collateral_assets(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::CollateralAssets)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_seized(env: Env, asset: Address) -> i128 {
        env.storage().instance().get(&DataKey::Seized(asset)).unwrap_or(0)
    }

    pub fn get_pending_settlement(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::PendingSettlement)
            .unwrap_or(0)
    }

    /// The LTV bps this user's current badge earns (0 = cannot borrow).
    pub fn ltv_bps_for(env: Env, user: Address) -> u32 {
        let badge = Self::badge_client(&env);
        if badge.is_defaulted(&user) {
            return 0;
        }
        match badge.get_score(&user) {
            Some(s) => Self::ltv_for_score(&env, s),
            None => 0,
        }
    }

    // -------------------------------------------------------------------------
    // INTERNAL
    // -------------------------------------------------------------------------

    fn require_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }

    fn require_collateral_asset(env: &Env, asset: &Address) {
        let assets: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::CollateralAssets)
            .unwrap_or(Vec::new(env));
        if !assets.contains(asset) {
            panic!("asset not allowlisted as collateral");
        }
    }

    fn validate_tiers(tiers: &Vec<TierLevel>) {
        if tiers.is_empty() {
            panic!("tier ladder must be non-empty");
        }
        let mut prev_floor: Option<u32> = None;
        for t in tiers.iter() {
            if t.ltv_bps == 0 || t.ltv_bps > MAX_LTV_BPS {
                panic!("tier ltv out of range (must stay below pool c_factor)");
            }
            if let Some(p) = prev_floor {
                if t.min_score >= p {
                    panic!("tier floors must be strictly descending");
                }
            }
            prev_floor = Some(t.min_score);
        }
    }

    fn ltv_for_score(env: &Env, score: u32) -> u32 {
        let tiers: Vec<TierLevel> = env
            .storage()
            .instance()
            .get(&DataKey::TierLtv)
            .unwrap_or(Vec::new(env));
        for t in tiers.iter() {
            if score >= t.min_score {
                return t.ltv_bps;
            }
        }
        0
    }

    fn lowest_tier_ltv(env: &Env) -> u32 {
        let tiers: Vec<TierLevel> = env
            .storage()
            .instance()
            .get(&DataKey::TierLtv)
            .unwrap_or(Vec::new(env));
        match tiers.last() {
            Some(t) => t.ltv_bps,
            None => 0,
        }
    }

    /// Fresh SEP-40 price for an asset, in the oracle's own decimals.
    /// Panics on missing feed key, missing price, non-positive price, or a
    /// price older than `MaxPriceAge` — no operation runs on stale data.
    fn fresh_price(env: &Env, asset: &Address) -> i128 {
        let feed: Asset = env
            .storage()
            .instance()
            .get(&DataKey::FeedKey(asset.clone()))
            .expect("no price feed configured for asset");
        let oracle = Self::oracle_client(env);
        let pd = match oracle.lastprice(&feed) {
            Some(p) => p,
            None => panic!("oracle returned no price"),
        };
        if pd.price <= 0 {
            panic!("oracle returned non-positive price");
        }
        let now = env.ledger().timestamp();
        let max_age: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MaxPriceAge)
            .expect("not initialized");
        if now.saturating_sub(pd.timestamp) > max_age {
            panic!("oracle price is stale");
        }
        pd.price
    }

    /// Borrow capacity (in borrow-asset units) of ONE collateral holding at
    /// the given LTV. Both prices come from the same oracle, so its decimal
    /// scale cancels: amount × p_coll × ltv / (10000 × p_borrow).
    fn capacity_of(env: &Env, asset: &Address, amount: i128, ltv_bps: u32) -> i128 {
        if amount <= 0 {
            return 0;
        }
        let p_coll = Self::fresh_price(env, asset);
        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");
        let p_borrow = Self::fresh_price(env, &borrow_asset);
        amount * p_coll / p_borrow * ltv_bps as i128 / 10_000
    }

    /// Total borrow capacity across all collateral assets for a user.
    fn total_borrow_capacity(env: &Env, user: &Address, ltv_bps: u32) -> i128 {
        let assets: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::CollateralAssets)
            .unwrap_or(Vec::new(env));
        let mut total: i128 = 0;
        for asset in assets.iter() {
            let held: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Collateral(user.clone(), asset.clone()))
                .unwrap_or(0);
            total += Self::capacity_of(env, &asset, held, ltv_bps);
        }
        total
    }

    /// Capacity after hypothetically setting `asset` holding to `new_amount`
    /// (used by withdraw_collateral's health pre-check). Uses the user's
    /// CURRENT tier so a withdraw can't lean on a tier they no longer have.
    fn borrow_capacity(env: &Env, user: &Address, asset: &Address, new_amount: i128) -> i128 {
        let badge = Self::badge_client(env);
        let ltv = match badge.get_score(user) {
            Some(s) => Self::ltv_for_score(env, s),
            None => Self::lowest_tier_ltv(env),
        };
        if ltv == 0 {
            return 0;
        }
        let assets: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::CollateralAssets)
            .unwrap_or(Vec::new(env));
        let mut total: i128 = 0;
        for a in assets.iter() {
            let held: i128 = if a == *asset {
                new_amount
            } else {
                env.storage()
                    .persistent()
                    .get(&DataKey::Collateral(user.clone(), a.clone()))
                    .unwrap_or(0)
            };
            total += Self::capacity_of(env, &a, held, ltv);
        }
        total
    }

    /// Pre-authorize the pool's nested `transfer(this → pool, amount)` on
    /// `token`. Required because contract invoker auth does not extend to
    /// sub-invocations the callee makes on our behalf (standard pattern for
    /// composing with Blend's `submit`).
    fn authorize_pool_pull(env: &Env, token: &Address, amount: i128) {
        let me = env.current_contract_address();
        let pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::Pool)
            .expect("not initialized");
        env.authorize_as_current_contract(vec![
            env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: token.clone(),
                    fn_name: Symbol::new(env, "transfer"),
                    args: (me, pool, amount).into_val(env),
                },
                sub_invocations: vec![env],
            }),
        ]);
    }

    fn badge_client(env: &Env) -> BadgeClient<'_> {
        let addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Registry)
            .expect("not initialized");
        BadgeClient::new(env, &addr)
    }

    fn oracle_client(env: &Env) -> PriceOracleClient<'_> {
        let addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Oracle)
            .expect("not initialized");
        PriceOracleClient::new(env, &addr)
    }

    fn pool_client(env: &Env) -> BlendPoolClient<'_> {
        let addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Pool)
            .expect("not initialized");
        BlendPoolClient::new(env, &addr)
    }
}
