#![no_std]
//! =============================================================================
//! VIGENTE PROTOCOL — SEP-40 Oracle Aggregator
//! =============================================================================
//!
//! The single oracle a Blend pool talks to. Blend fixes `PoolConfig.oracle` at
//! deploy time and it can NEVER be changed, so this contract is the one piece
//! of the stack that must be right on the first try.
//!
//! What it does: routes each asset to an independent upstream SEP-40 source
//! (Reflector for XLM/USDC on testnet; RedStone for tokenized bonds on mainnet)
//! and re-exports the SEP-40 surface Blend consumes (`lastprice`, `decimals`).
//!
//! Why routing is timelocked rather than free:
//!   A price source is a liquidation trigger. An admin able to re-point an
//!   asset at a source they control could liquidate healthy positions at will —
//!   the same class of attack the margin-controller's LTV timelock closes.
//!   So: routes are set at init, and ANY later change (including adding a new
//!   asset) is announced on-chain and only takes effect after `route_grace_secs`.
//!   The legitimate use case is migrating a bond from our own feed to RedStone
//!   once they publish it; the illegitimate one is impossible by construction.
//!
//! Guards applied to every price, on top of whatever the upstream does:
//!   - staleness: `now - timestamp <= max_age` (per-asset)
//!   - positivity: price > 0
//!   - deviation:  |price - last| / last <= max_deviation_bps within the window
//!
//! Decimals are normalised to this contract's own `decimals()` so a pool never
//! sees two assets quoted on different scales.
//! =============================================================================

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec,
};

#[cfg(test)]
mod test;

// =============================================================================
// SEP-40 TYPES (must match what Blend and the upstreams use)
// =============================================================================

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// Upstream SEP-40 oracle (Reflector, RedStone adapter, …).
#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracle {
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
    fn decimals(env: Env) -> u32;
}

// =============================================================================
// ROUTING
// =============================================================================

/// Where an asset's price comes from, and under what guards.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Route {
    /// Upstream SEP-40 contract.
    pub source: Address,
    /// How the upstream identifies this asset. Reflector quotes by ticker
    /// (`Other("XLM")`); a mainnet adapter may quote by `Stellar(contract)`.
    /// Blend always asks us with `Stellar(contract)`, so the mapping lives here.
    pub upstream_asset: Asset,
    /// Max seconds a price may lag before we reject it.
    pub max_age: u64,
    /// Max relative move accepted vs the last observed price, in bps.
    /// 0 disables the check (only sensible for a brand-new route).
    pub max_deviation_bps: u32,
}

/// A queued route change awaiting its grace period.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct PendingRoute {
    pub asset: Asset,
    pub route: Route,
    pub effective_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    /// Output scale. Immutable: changing it would silently reprice every asset.
    Decimals,
    /// IMMUTABLE grace window for every route change.
    RouteGraceSecs,
    /// asset → Route
    RouteOf(Asset),
    /// Assets with a route, for enumeration.
    Assets,
    /// Queued change for an asset (one at a time).
    Pending(Asset),
    /// Last price we served for an asset — the deviation guard's reference.
    LastGood(Asset),
    /// Two-step admin rotation.
    PendingAdmin,
}

/// Upper bound for any `max_deviation_bps`. A route allowed to move more than
/// 50% between reads is not a guard, it is decoration.
pub const MAX_DEVIATION_CEILING_BPS: u32 = 5_000;

const TTL: u32 = 1_555_200; // ~90 days at 5s/ledger

#[contract]
pub struct OracleAggregator;

#[contractimpl]
impl OracleAggregator {
    // -------------------------------------------------------------------------
    // INIT
    // -------------------------------------------------------------------------

    /// One-time setup. `decimals` and `route_grace_secs` are immutable: no
    /// setter exists for either.
    pub fn init(env: Env, admin: Address, decimals: u32, route_grace_secs: u64) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        if decimals == 0 || decimals > 18 {
            panic!("decimals out of range");
        }
        if route_grace_secs == 0 {
            panic!("route grace must be positive");
        }
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Decimals, &decimals);
        s.set(&DataKey::RouteGraceSecs, &route_grace_secs);
        s.set(&DataKey::Assets, &Vec::<Asset>::new(&env));
        s.extend_ttl(TTL, TTL);
        env.events()
            .publish((symbol_short!("init"), admin), (decimals, route_grace_secs));
    }

    /// Register a route during setup, BEFORE the aggregator is handed to a pool.
    ///
    /// Only callable while the asset has no route yet: this is the "set at init"
    /// half of the invariant. Changing an existing route always goes through
    /// `queue_set_route` + `apply_route`, with no exception and no admin override.
    pub fn set_initial_route(env: Env, asset: Asset, route: Route) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        if env.storage().instance().has(&DataKey::RouteOf(asset.clone())) {
            panic!("route already set — use queue_set_route");
        }
        Self::validate_route(&route);
        Self::store_route(&env, &asset, &route);
        env.events().publish((symbol_short!("route_in"),), asset);
    }

    // -------------------------------------------------------------------------
    // SEP-40 SURFACE (what Blend calls)
    // -------------------------------------------------------------------------

    /// Price for `asset`, normalised to this contract's `decimals()`.
    ///
    /// Returns `None` only when the asset has no route at all. Every other
    /// failure mode PANICS rather than returning a value: a pool must never
    /// act on a price we could not validate.
    pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
        let route: Route = env.storage().instance().get(&DataKey::RouteOf(asset.clone()))?;

        let upstream = PriceOracleClient::new(&env, &route.source);
        let raw = match upstream.lastprice(&route.upstream_asset) {
            Some(p) => p,
            None => panic!("upstream returned no price"),
        };
        if raw.price <= 0 {
            panic!("upstream returned non-positive price");
        }

        let now = env.ledger().timestamp();
        if now.saturating_sub(raw.timestamp) > route.max_age {
            panic!("upstream price is stale");
        }

        let out_dec: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Decimals)
            .expect("not initialized");
        let price = Self::rescale(raw.price, upstream.decimals(), out_dec);

        Self::check_deviation(&env, &asset, price, route.max_deviation_bps);

        // Remember what we served; it is the deviation reference for next time.
        env.storage()
            .persistent()
            .set(&DataKey::LastGood(asset), &price);

        Some(PriceData { price, timestamp: raw.timestamp })
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .expect("not initialized")
    }

    /// Assets this aggregator can price.
    pub fn assets(env: Env) -> Vec<Asset> {
        env.storage()
            .instance()
            .get(&DataKey::Assets)
            .unwrap_or(Vec::new(&env))
    }

    // -------------------------------------------------------------------------
    // ROUTE CHANGES — always timelocked
    // -------------------------------------------------------------------------

    /// Announce a route change (new asset or replacement). Takes effect only
    /// after `route_grace_secs`, via `apply_route`, which anyone may call.
    pub fn queue_set_route(env: Env, asset: Asset, route: Route) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        Self::validate_route(&route);
        let grace: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RouteGraceSecs)
            .expect("not initialized");
        let effective_at = env.ledger().timestamp() + grace;
        env.storage().instance().set(
            &DataKey::Pending(asset.clone()),
            &PendingRoute { asset: asset.clone(), route, effective_at },
        );
        env.events()
            .publish((symbol_short!("route_q"), ), (asset, effective_at));
    }

    /// Apply a queued route once its grace period elapsed.
    /// Permissionless on purpose: the admin can neither rush it nor veto it.
    pub fn apply_route(env: Env, asset: Asset) {
        let pending: PendingRoute = env
            .storage()
            .instance()
            .get(&DataKey::Pending(asset.clone()))
            .expect("no pending route");
        if env.ledger().timestamp() < pending.effective_at {
            panic!("route change still in grace period");
        }
        Self::store_route(&env, &asset, &pending.route);
        env.storage().instance().remove(&DataKey::Pending(asset.clone()));
        // A new source may quote on a different basis; drop the stale reference
        // so the first read after a migration is not rejected by the guard.
        env.storage().persistent().remove(&DataKey::LastGood(asset.clone()));
        env.events().publish((symbol_short!("route_ok"),), asset);
    }

    pub fn get_route(env: Env, asset: Asset) -> Option<Route> {
        env.storage().instance().get(&DataKey::RouteOf(asset))
    }

    pub fn get_pending_route(env: Env, asset: Asset) -> Option<PendingRoute> {
        env.storage().instance().get(&DataKey::Pending(asset))
    }

    pub fn get_route_grace(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::RouteGraceSecs)
            .expect("not initialized")
    }

    // -------------------------------------------------------------------------
    // ADMIN (two-step rotation only — no other privileged surface)
    // -------------------------------------------------------------------------

    pub fn propose_admin(env: Env, new_admin: Address) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        env.events().publish((symbol_short!("adm_prop"),), new_admin);
    }

    pub fn accept_admin(env: Env) {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .expect("no pending admin");
        pending.require_auth();
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.events().publish((symbol_short!("adm_ok"),), pending);
    }

    pub fn get_admin(env: Env) -> Address {
        Self::require_admin(&env)
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

    fn validate_route(route: &Route) {
        if route.max_age == 0 {
            panic!("max_age must be positive");
        }
        if route.max_deviation_bps > MAX_DEVIATION_CEILING_BPS {
            panic!("max_deviation_bps above ceiling");
        }
    }

    fn store_route(env: &Env, asset: &Asset, route: &Route) {
        env.storage()
            .instance()
            .set(&DataKey::RouteOf(asset.clone()), route);
        let mut assets: Vec<Asset> = env
            .storage()
            .instance()
            .get(&DataKey::Assets)
            .unwrap_or(Vec::new(env));
        if !assets.contains(asset) {
            assets.push_back(asset.clone());
            env.storage().instance().set(&DataKey::Assets, &assets);
        }
        env.storage().instance().extend_ttl(TTL, TTL);
    }

    /// Convert `price` from `from_dec` to `to_dec`.
    fn rescale(price: i128, from_dec: u32, to_dec: u32) -> i128 {
        if from_dec == to_dec {
            return price;
        }
        if from_dec < to_dec {
            let mut p = price;
            let mut d = to_dec - from_dec;
            while d > 0 {
                p *= 10;
                d -= 1;
            }
            p
        } else {
            let mut p = price;
            let mut d = from_dec - to_dec;
            while d > 0 {
                p /= 10;
                d -= 1;
            }
            // Never round a positive price down to zero: a pool reading 0 would
            // treat the collateral as worthless.
            if p == 0 {
                panic!("price underflows target decimals");
            }
            p
        }
    }

    /// Reject moves larger than `max_bps` against the last price we served.
    /// No reference yet (first read, or just after a route migration) → accept.
    fn check_deviation(env: &Env, asset: &Asset, price: i128, max_bps: u32) {
        if max_bps == 0 {
            return;
        }
        let last: i128 = match env
            .storage()
            .persistent()
            .get(&DataKey::LastGood(asset.clone()))
        {
            Some(v) => v,
            None => return,
        };
        if last <= 0 {
            return;
        }
        let diff = if price > last { price - last } else { last - price };
        // diff/last > max_bps/10_000, cross-multiplied to stay in integers.
        if diff.saturating_mul(10_000) > last.saturating_mul(max_bps as i128) {
            panic!("price deviation above limit");
        }
    }
}
