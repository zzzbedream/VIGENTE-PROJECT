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
//! (Reflector for XLM/USDC on testnet; an independent SEP-40 provider for
//! tokenized bonds on mainnet — not chosen yet, and not agreed with anyone)
//! and re-exports the SEP-40 surface Blend consumes (`lastprice`, `decimals`).
//!
//! Why routing is timelocked rather than free:
//!   A price source is a liquidation trigger. An admin able to re-point an
//!   asset at a source they control could liquidate healthy positions at will —
//!   the same class of attack the margin-controller's LTV timelock closes.
//!   So: routes are set at init, and ANY later change (including adding a new
//!   asset) is announced on-chain and only takes effect after `route_grace_secs`.
//!   The legitimate use case is migrating a bond from our own feed to a
//!   third-party one once such a feed exists; the illegitimate one is
//!   impossible by construction.
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
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error, symbol_short,
    Address, Env, Symbol, Vec,
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

/// La pata de conversion de un activo devengado.
///
/// Es un enum y no un `Option<Asset>` porque Soroban no representa `Option` de
/// un tipo propio dentro de un `contracttype`. Queda mejor igual: los dos
/// estados tienen nombre y no hay forma de construir uno invalido.
#[contracttype]
#[derive(Clone)]
pub enum FxLeg {
    /// El bono ya esta en la moneda de salida. Es el caso de USTRY, USDY,
    /// deJTRSY y deJAAA: no se aplica ninguna conversion.
    AlreadyInOutputCurrency,
    /// Convertir usando este activo, resuelto por una `Route` normal.
    Via(Asset),
}

/// Como se precia un activo cuyo valor se DEVENGA en vez de cotizar.
///
/// Un bono soberano tokenizado no tiene precio de mercado continuo: tiene un
/// valor devengado que sube con el tiempo a una tasa conocida. Eso se calcula,
/// no se consulta, y esa es la diferencia con una `Route`.
///
/// **La forma generaliza a proposito.** `precio = NAV(local) x FX(local->salida)`
/// es la forma de CUALQUIER bono soberano tokenizado, no la de CETES:
///
/// | `fx_leg` | precia |
/// |---|---|
/// | `AlreadyInOutputCurrency` | USTRY, USDY, deJTRSY, deJAAA |
/// | `Via(Other("MXN"))` | CETES |
/// | `Via(Other("BRL"))` | TESOURO |
/// | `Via(Other("GBP"))` | GILTS |
///
/// Los contratos no son actualizables. Una ruta cableada a un activo nos ataria
/// a su emisor por una generacion entera, y el 2026-10-22 se midio que los seis
/// bonos soberanos con precio on-chain en Stellar comparten emisor.
#[contracttype]
#[derive(Clone)]
pub struct AccrualConfig {
    /// NAV en MONEDA LOCAL en el instante del ancla, escalado a `Decimals`.
    pub nav_anchor: i128,
    /// Instante del ancla.
    pub anchor_at: u64,
    /// Tasa de devengo ANUAL en bps, base 360. Para CETES se leyo 555 del
    /// `current_basis_points` del emisor el 2026-10-22.
    pub rate_bps: u32,
    /// Que activo usar para convertir a la moneda de salida, o
    /// `AlreadyInOutputCurrency` si el bono ya esta en ella.
    pub fx_leg: FxLeg,
    /// Cuanto puede apartarse un re-ancla de lo que la formula predice, en bps.
    /// Es la cota que convierte el re-ancla de "fijar el precio" en "corregir
    /// la deriva".
    pub max_reanchor_bps: u32,
    /// Minimo de segundos entre re-anclas. Sin esto, varios re-anclas
    /// consecutivos dentro de la banda podrian escalar el precio a voluntad.
    pub min_reanchor_secs: u64,
}

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
    /// activo -> AccrualConfig, para los activos que se DEVENGAN.
    /// Se consulta antes que `RouteOf`: un activo tiene una u otra, no las dos.
    AccrualOf(Asset),
    /// Two-step admin rotation.
    PendingAdmin,
}

/// Upper bound for any `max_deviation_bps`. A route allowed to move more than
/// 50% between reads is not a guard, it is decoration.
pub const MAX_DEVIATION_CEILING_BPS: u32 = 5_000;

/// Techo de la tasa de devengo: 100 % anual. Un bono soberano no paga eso; el
/// techo esta para que un error de dedo no se vuelva un precio.
pub const MAX_RATE_BPS: u32 = 10_000;

/// Base de dias del devengo. 360 es la convencion de los instrumentos de deuda
/// de corto plazo que nos interesan, incluido el CETES.
pub const DAY_BASIS: i128 = 360;

const SECS_PER_DAY: u64 = 86_400;

const TTL: u32 = 1_555_200; // ~90 days at 5s/ledger

/// Por que este contrato tiene errores tipados y no `panic!` con string.
///
/// El agregador vive en el slot de oraculo **inmutable** del pool Blend. Cuando
/// revierte, lo que revierte es una operacion de Blend, y un panic con string
/// cruza la frontera del contrato como `UnreachableCodeReached`: ni Blend ni un
/// integrador pueden distinguir "el precio esta rancio" --que se resuelve
/// esperando al proximo latido-- de "este contrato se rompio".
///
/// Los codigos son ABI. Se apendan, nunca se renumeran.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `init` sobre un contrato ya inicializado.
    AlreadyInitialized = 1,
    /// `decimals` fuera del rango admitido.
    DecimalsOutOfRange = 2,
    /// `route_grace_secs == 0` dejaria sin timelock el cambio de ruta, que es
    /// justo la garantia que impide al admin re-rutear un precio al instante.
    RouteGraceRequired = 3,
    /// `set_initial_route` sobre un activo que ya tiene ruta. Cambiarla exige
    /// pasar por `queue_set_route` y esperar la gracia.
    RouteAlreadySet = 4,
    /// El upstream no devolvio precio para el activo.
    UpstreamNoPrice = 5,
    /// El upstream devolvio un precio <= 0.
    UpstreamInvalidPrice = 6,
    /// El precio del upstream es mas viejo que el `max_age` de la ruta.
    UpstreamPriceStale = 7,
    /// `apply_set_route` antes de que venza la ventana de gracia.
    StillInGracePeriod = 8,
    /// `max_age == 0` aceptaria cualquier precio por rancio que fuese.
    MaxAgeRequired = 9,
    /// `max_deviation_bps` por encima del techo del contrato.
    DeviationAboveCeiling = 10,
    /// Al reescalar a los decimales de salida, el precio se redondearia a cero.
    /// Se revierte en vez de servir un cero, que para el pool vale lo mismo que
    /// "este colateral no vale nada".
    PriceUnderflow = 11,
    /// El salto contra la ultima referencia supera `max_deviation_bps`. Es la
    /// guarda contra manipulacion: acota la TASA de movimiento, no lo impide
    /// (ver H-03).
    DeviationAboveLimit = 12,
    /// `accept_admin` sin rotacion encolada.
    NoPendingAdmin = 13,
    /// `apply_set_route` sin ruta encolada.
    NoPendingRoute = 14,

    // ---------------------------------------------------------------------
    // Activos que se DEVENGAN. Un bono soberano tokenizado no cotiza: su valor
    // sube con el tiempo a una tasa conocida, asi que el precio se calcula.
    // ---------------------------------------------------------------------
    /// El activo ya tiene una `Route` o un `AccrualConfig`. Un activo tiene una
    /// u otra, nunca las dos: si no, dos caminos distintos darian dos precios.
    AssetAlreadyPriced = 15,
    /// `rate_bps` por encima del techo. Una tasa absurda no es un bono.
    RateAboveCeiling = 16,
    /// El ancla nueva haria BAJAR el NAV. Un bono corto devenga: no se
    /// desploma. Un NAV que baja es un dato malo, no un mercado en caida.
    NavWouldDecrease = 17,
    /// El ancla nueva se aparta de lo que la formula predice mas de
    /// `max_reanchor_bps`. Es la cota que impide fijar el precio a voluntad.
    ReanchorOutOfBand = 18,
    /// Re-ancla antes de que pase `min_reanchor_secs`. Sin esta guarda, varios
    /// re-anclas dentro de la banda escalarian el precio igual.
    ReanchorTooSoon = 19,
    /// `nav_anchor <= 0`.
    NavNotPositive = 20,
    /// No hay `AccrualConfig` para el activo.
    NoAccrualForAsset = 21,
}

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
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        if decimals == 0 || decimals > 18 {
            panic_with_error!(&env, Error::DecimalsOutOfRange);
        }
        if route_grace_secs == 0 {
            panic_with_error!(&env, Error::RouteGraceRequired);
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
            panic_with_error!(&env, Error::RouteAlreadySet);
        }
        // La exclusividad va en los DOS lados. Sin esta guarda se podia poner
        // una ruta sobre un activo que ya tenia devengo, y el activo quedaba
        // con dos caminos de precio que no tienen por que coincidir. Lo
        // encontro el test `un_activo_no_puede_tener_ruta_y_devengo`.
        if env.storage().instance().has(&DataKey::AccrualOf(asset.clone())) {
            panic_with_error!(&env, Error::AssetAlreadyPriced);
        }
        Self::validate_route(&env, &route);
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
        // Un activo que se DEVENGA no tiene upstream: su precio se calcula.
        // Se consulta primero porque un activo tiene una ruta o la otra, nunca
        // las dos -- `set_initial_accrual` y `set_initial_route` se rechazan
        // mutuamente con `AssetAlreadyPriced`.
        if let Some(cfg) = env
            .storage()
            .instance()
            .get::<DataKey, AccrualConfig>(&DataKey::AccrualOf(asset.clone()))
        {
            return Self::accrued_price(&env, &asset, &cfg);
        }

        let route: Route = env.storage().instance().get(&DataKey::RouteOf(asset.clone()))?;

        let upstream = PriceOracleClient::new(&env, &route.source);
        let raw = match upstream.lastprice(&route.upstream_asset) {
            Some(p) => p,
            None => panic_with_error!(&env, Error::UpstreamNoPrice),
        };
        if raw.price <= 0 {
            panic_with_error!(&env, Error::UpstreamInvalidPrice);
        }

        let now = env.ledger().timestamp();
        if now.saturating_sub(raw.timestamp) > route.max_age {
            panic_with_error!(&env, Error::UpstreamPriceStale);
        }

        let out_dec: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Decimals)
            .expect("not initialized");
        let price = Self::rescale(&env, raw.price, upstream.decimals(), out_dec);

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
        Self::validate_route(&env, &route);
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
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoPendingRoute));
        if env.ledger().timestamp() < pending.effective_at {
            panic_with_error!(&env, Error::StillInGracePeriod);
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
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoPendingAdmin));
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


    // =========================================================================
    // ACTIVOS QUE SE DEVENGAN
    // =========================================================================

    /// Registra como se precia un activo cuyo valor se devenga.
    ///
    /// Simetrico con `set_initial_route`: solo sirve para la PRIMERA vez. Un
    /// cambio posterior pasa por `reanchor`, que esta acotado.
    pub fn set_initial_accrual(env: Env, asset: Asset, cfg: AccrualConfig) {
        let admin = Self::require_admin(&env);
        admin.require_auth();

        // Un activo tiene una ruta O un devengo. Si tuviera las dos, habria dos
        // caminos de precio para el mismo activo y nada garantiza que coincidan.
        if env.storage().instance().has(&DataKey::RouteOf(asset.clone()))
            || env.storage().instance().has(&DataKey::AccrualOf(asset.clone()))
        {
            panic_with_error!(&env, Error::AssetAlreadyPriced);
        }
        Self::validate_accrual(&env, &cfg);

        env.storage().instance().set(&DataKey::AccrualOf(asset.clone()), &cfg);
        let mut assets: Vec<Asset> = env
            .storage()
            .instance()
            .get(&DataKey::Assets)
            .unwrap_or(Vec::new(&env));
        if !assets.contains(&asset) {
            assets.push_back(asset.clone());
            env.storage().instance().set(&DataKey::Assets, &assets);
        }
        env.events().publish((symbol_short!("accrual"), asset), cfg.nav_anchor);
    }

    /// Mueve el ancla del NAV, **dentro de una banda**.
    ///
    /// **Por que existe.** El NAV calculado se desvia del real si la tasa
    /// cambia, asi que alguien tiene que corregirlo. Y por que no hace falta un
    /// timelock de 48 h como el de las rutas: una ruta nueva puede apuntar el
    /// precio a cualquier parte, asi que la unica defensa es el tiempo. Un
    /// re-ancla **no puede**: las cuatro guardas de abajo lo acotan a corregir
    /// la deriva, no a fijar el precio.
    ///
    /// **Las cuatro guardas, y que impide cada una:**
    ///
    /// 1. `anchor_at` tiene que avanzar -> no se puede re-anclar en el pasado y
    ///    cosechar devengado que no ocurrio.
    /// 2. `min_reanchor_secs` -> sin esto, varios re-anclas consecutivos, cada
    ///    uno dentro de la banda, escalarian el precio igual.
    /// 3. El NAV no puede BAJAR -> un bono corto devenga; un NAV que baja es un
    ///    dato malo, no un mercado en caida.
    /// 4. `max_reanchor_bps` contra lo que la formula predice AHORA -> es la
    ///    cota que convierte el poder del admin de "fijar el precio" en
    ///    "corregir la deriva".
    ///
    /// Con eso, una llave comprometida solo puede adelantar o atrasar el
    /// devengado dentro de una banda chica. Importa porque M-07 sigue abierto.
    pub fn reanchor(env: Env, asset: Asset, nav_anchor: i128, anchor_at: u64, rate_bps: u32) {
        let admin = Self::require_admin(&env);
        admin.require_auth();

        let vieja: AccrualConfig = env
            .storage()
            .instance()
            .get(&DataKey::AccrualOf(asset.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoAccrualForAsset));

        if nav_anchor <= 0 {
            panic_with_error!(&env, Error::NavNotPositive);
        }
        if rate_bps > MAX_RATE_BPS {
            panic_with_error!(&env, Error::RateAboveCeiling);
        }
        // (1) y (2)
        if anchor_at <= vieja.anchor_at
            || anchor_at - vieja.anchor_at < vieja.min_reanchor_secs
        {
            panic_with_error!(&env, Error::ReanchorTooSoon);
        }

        // Lo que la configuracion vieja predice para ese mismo instante.
        let predicho = Self::nav_at(&vieja, anchor_at);
        // (3)
        if nav_anchor < predicho {
            panic_with_error!(&env, Error::NavWouldDecrease);
        }
        // (4)
        let banda = predicho * (vieja.max_reanchor_bps as i128) / 10_000;
        if nav_anchor - predicho > banda {
            panic_with_error!(&env, Error::ReanchorOutOfBand);
        }

        let nueva = AccrualConfig {
            nav_anchor,
            anchor_at,
            rate_bps,
            fx_leg: vieja.fx_leg.clone(),
            max_reanchor_bps: vieja.max_reanchor_bps,
            min_reanchor_secs: vieja.min_reanchor_secs,
        };
        env.storage().instance().set(&DataKey::AccrualOf(asset.clone()), &nueva);
        env.events().publish((symbol_short!("reanchor"), asset), nav_anchor);
    }

    pub fn get_accrual(env: Env, asset: Asset) -> Option<AccrualConfig> {
        env.storage().instance().get(&DataKey::AccrualOf(asset))
    }

    /// El NAV en moneda local AHORA, sin aplicar FX. Existe para que un
    /// operador pueda ver la pata que no depende de ningun oraculo.
    pub fn get_nav_now(env: Env, asset: Asset) -> i128 {
        let cfg: AccrualConfig = env
            .storage()
            .instance()
            .get(&DataKey::AccrualOf(asset))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoAccrualForAsset));
        Self::nav_at(&cfg, env.ledger().timestamp())
    }

    // ------------------------------------------------------------- internos --

    /// `NAV(t) = nav_anchor x (1 + rate x dias / 360)`, en enteros.
    ///
    /// **Monotono no decreciente por construccion:** `dias` solo crece, y
    /// `rate_bps` no es negativo. Un NAV que baja no es representable aca, que
    /// es exactamente la propiedad que se queria.
    ///
    /// Se trunca hacia abajo. Subestimar el NAV subestima el colateral, que
    /// es el lado seguro del error.
    fn nav_at(cfg: &AccrualConfig, at: u64) -> i128 {
        if at <= cfg.anchor_at {
            return cfg.nav_anchor;
        }
        let dias = ((at - cfg.anchor_at) / SECS_PER_DAY) as i128;
        cfg.nav_anchor + cfg.nav_anchor * (cfg.rate_bps as i128) * dias / (DAY_BASIS * 10_000)
    }

    /// El precio en la moneda de salida: NAV devengado, convertido si hace
    /// falta, con la misma guarda de desviacion que cualquier otra ruta.
    fn accrued_price(env: &Env, asset: &Asset, cfg: &AccrualConfig) -> Option<PriceData> {
        let now = env.ledger().timestamp();
        let nav = Self::nav_at(cfg, now);

        let price = match &cfg.fx_leg {
            // El bono ya esta en la moneda de salida: USTRY, USDY, deJTRSY.
            FxLeg::AlreadyInOutputCurrency => nav,
            // Hay que convertir. El FX se resuelve por la ruta NORMAL, asi que
            // hereda sus guardas de rancidez y de desviacion -- y viene de un
            // tercero independiente del emisor del bono, que es el punto.
            FxLeg::Via(fx) => {
                let out_dec: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::Decimals)
                    .expect("not initialized");
                let fx_price = Self::lastprice(env.clone(), fx.clone())
                    .unwrap_or_else(|| panic_with_error!(env, Error::UpstreamNoPrice))
                    .price;
                // Los dos estan escalados a `out_dec`, asi que el producto
                // queda al cuadrado y hay que bajarlo una vez.
                let mut escala: i128 = 1;
                let mut d = out_dec;
                while d > 0 {
                    escala *= 10;
                    d -= 1;
                }
                let p = nav * fx_price / escala;
                if p == 0 {
                    panic_with_error!(env, Error::PriceUnderflow);
                }
                p
            }
        };

        Self::check_deviation(env, asset, price, 0);
        env.storage()
            .persistent()
            .set(&DataKey::LastGood(asset.clone()), &price);

        // El timestamp es el de AHORA, no el de un upstream: el devengado es
        // una funcion del tiempo y esta fresco por definicion.
        Some(PriceData { price, timestamp: now })
    }

    fn validate_accrual(env: &Env, cfg: &AccrualConfig) {
        if cfg.nav_anchor <= 0 {
            panic_with_error!(env, Error::NavNotPositive);
        }
        if cfg.rate_bps > MAX_RATE_BPS {
            panic_with_error!(env, Error::RateAboveCeiling);
        }
        if cfg.max_reanchor_bps > MAX_DEVIATION_CEILING_BPS {
            panic_with_error!(env, Error::DeviationAboveCeiling);
        }
    }

    fn validate_route(env: &Env, route: &Route) {
        if route.max_age == 0 {
            panic_with_error!(&env, Error::MaxAgeRequired);
        }
        if route.max_deviation_bps > MAX_DEVIATION_CEILING_BPS {
            panic_with_error!(&env, Error::DeviationAboveCeiling);
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
    fn rescale(env: &Env, price: i128, from_dec: u32, to_dec: u32) -> i128 {
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
                panic_with_error!(&env, Error::PriceUnderflow);
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
            panic_with_error!(&env, Error::DeviationAboveLimit);
        }
    }
}
