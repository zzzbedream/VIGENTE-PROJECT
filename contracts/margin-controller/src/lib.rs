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
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token::TokenClient, vec, Address, Env, IntoVal, Map, Symbol, Vec,
};

#[cfg(test)]
mod test;

// =============================================================================
// TYPED ERRORS
// =============================================================================

/// Errors a caller can branch on.
///
/// This comment used to say that the existing string `panic!`s were left alone
/// because rewriting them "would churn every `should_panic` test for no gain".
/// That was wrong on both counts and it is no longer true: the churn WAS the
/// gain. A `should_panic(expected = "...")` has the same defect as the panic it
/// tests -- if the contract breaks for an unrelated reason and the message
/// happens to match, the test still passes. As of 2026-10-22 there are zero
/// string panics here and every test asserts *which* rule fired.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `liquidate` called with `liquidator == borrower`.
    ///
    /// Harmless while liquidation seizes everything and pays no bonus, but the
    /// proportional model pays the liquidator out of the borrower's own
    /// collateral: self-liquidation would then let a borrower extract locked
    /// collateral at a discount and bypass the health check that guards
    /// `withdraw_collateral`. Blocked before that lands, not after.
    SelfLiquidation = 1,
    /// A deposit or borrow would push this user past their per-user cap.
    UserCapExceeded = 2,
    /// `settle_seized` was called with an asset that is not the debt asset.
    SettleAssetNotDebtAsset = 3,
    /// `settle_seized` was called with nothing to settle.
    NothingToSettle = 4,
    /// `repay_amount` exceeds `CLOSE_FACTOR_BPS` of the outstanding debt.
    RepayExceedsCloseFactor = 5,
    /// The requested repay would seize more collateral than the borrower holds
    /// in that asset, yet the position as a whole is not insolvent. The
    /// liquidator should lower `repay_amount` or pick another asset.
    SeizeExceedsCollateral = 6,
    /// `init` was called with `user_cap <= 0`.
    ///
    /// M-04 shipped the per-user cap as code but left the parameter outside
    /// `InitConfig`, so every deployment started uncapped and the mitigation
    /// did nothing until somebody remembered `set_user_cap`. It was measured
    /// dormant in production on 2026-10-19: `get_user_cap` returned 0, which
    /// this contract reads as NO LIMIT. The safe value is now the one you get
    /// by default and the unsafe one takes a deliberate act.
    UserCapRequired = 7,

    // ---------------------------------------------------------------------
    // Reglas de negocio que un INTEGRADOR puede provocar.
    //
    // Estas son las que de verdad motivan el cambio. Hasta ahora llegaban como
    // `panic!` con string, que al cruzar la frontera del contrato se convierte
    // en `UnreachableCodeReached`: indistinguible de un fallo interno. Quien
    // integra no podia saber si rechazamos su operacion por una regla o si nos
    // habiamos roto.
    // ---------------------------------------------------------------------
    /// `amount <= 0` en `deposit_collateral`, `withdraw_collateral`, `borrow`,
    /// `repay` o `liquidate`.
    AmountNotPositive = 8,
    /// El deposito pasaria el tope TOTAL del activo (`Cap(asset)`), que es
    /// distinto del tope por usuario (`UserCapExceeded = 2`).
    AssetCapExceeded = 9,
    /// El retiro pide mas de lo que el usuario tiene en ese activo.
    WithdrawExceedsCollateral = 10,
    /// El retiro dejaria la posicion por debajo del umbral de salud. No es que
    /// falte saldo: es que ese saldo esta respaldando deuda.
    PositionWouldBeUnhealthy = 11,
    /// El badge del prestatario tiene un registro de impago.
    BorrowerInDefault = 12,
    /// El score no alcanza el tramo mas bajo de la escalera.
    ScoreBelowMinimumTier = 13,
    /// **El limite de LTV.** Es la regla central del producto: el prestamo
    /// pedido pasa lo que el colateral y el tramo de reputacion permiten.
    /// Tenia que ser la primera en dejar de ser un panic opaco.
    ExceedsCreditLimit = 14,
    /// El repago pide mas que la deuda contabilizada.
    RepayExceedsDebt = 15,
    /// `liquidate` sobre una posicion sin deuda.
    NoDebtToLiquidate = 16,
    /// `liquidate` sobre una posicion sana. No hay nada que liquidar.
    PositionIsHealthy = 17,
    /// El cortacircuitos esta activo. Solo frena la ENTRADA de riesgo nuevo:
    /// `withdraw_collateral`, `repay` y `liquidate` nunca lo ven.
    ContractPaused = 18,
    /// El activo no esta en la allowlist de colateral.
    AssetNotAllowlisted = 19,

    // ---------------------------------------------------------------------
    // La ruta del oraculo. Tipadas aparte porque un integrador necesita
    // distinguir "el precio esta rancio" -- que se resuelve esperando -- de
    // "este activo no tiene ruta", que no.
    // ---------------------------------------------------------------------
    /// El oraculo no devolvio precio para el activo.
    OracleNoPrice = 20,
    /// El oraculo devolvio un precio <= 0.
    OracleInvalidPrice = 21,
    /// El precio es mas viejo que `MaxPriceAge`. El contrato revierte en vez de
    /// operar con un numero que no pudo validar.
    OraclePriceStale = 22,

    // ---------------------------------------------------------------------
    // Configuracion. Las provoca un admin o un script de despliegue, no un
    // usuario. Van tipadas por la razon de 4.8: un script que afirma algo tiene
    // que poder distinguir que asercion fallo.
    // ---------------------------------------------------------------------
    /// `init` sobre un contrato ya inicializado.
    AlreadyInitialized = 23,
    /// `min_ltv_floor` fuera de rango.
    MinLtvFloorOutOfRange = 24,
    /// `param_grace_secs == 0` dejaria el timelock de parametros en nada.
    ParamGraceSecsRequired = 25,
    /// `max_price_age == 0` aceptaria cualquier precio por rancio que fuese.
    MaxPriceAgeRequired = 26,
    /// Un tope (total o por usuario) llego negativo.
    CapNegative = 27,
    /// Los decimales del colateral no coinciden con los del activo de deuda.
    /// La matematica de LTV asume la misma escala en los dos.
    DecimalsMismatch = 28,
    /// `apply_tier_ltv` antes de que venza la ventana de gracia.
    StillInGracePeriod = 29,
    /// `add_collateral_asset` sobre un activo que ya esta listado.
    AssetAlreadyListed = 30,
    /// Escalera de tramos vacia.
    EmptyTierLadder = 31,
    /// Un LTV de tramo por encima del margen del `c_factor` del pool.
    TierLtvOutOfRange = 32,
    /// Un LTV de tramo por debajo del piso inmutable.
    TierLtvBelowFloor = 33,
    /// Los pisos de score de la escalera no son estrictamente descendentes.
    TierFloorsNotDescending = 34,

    // ---------------------------------------------------------------------
    // Reglas de negocio que llegaban como `.expect()`. Mismo problema que los
    // `panic!`: al cruzar la frontera del contrato se vuelven indistinguibles
    // de un fallo interno.
    //
    // Las otras 23 `.expect("not initialized")` NO se tipan a proposito: esa
    // condicion no dice "tu operacion no cumple una regla" sino "este contrato
    // nunca se monto", y conviene que falle ruidosamente.
    // ---------------------------------------------------------------------
    /// El usuario no tiene badge vigente. Distinto de `ScoreBelowMinimumTier`:
    /// ahi hay badge y no alcanza; aca no hay badge.
    NoActiveBadge = 35,
    /// `apply_tier_ltv` sin nada encolado.
    NoPendingTierChange = 36,
    /// `accept_admin` sin rotacion encolada.
    NoPendingAdmin = 37,
    /// El activo esta en la allowlist pero no tiene clave de feed SEP-40.
    NoFeedForAsset = 38,

    // ---------------------------------------------------------------------
    // N-02. El corte del protocolo en una liquidacion se registraba bajo el
    // activo de COLATERAL y `settle_seized` solo acepta el de DEUDA, asi que
    // con XLM de colateral y USDC de deuda nunca se cruzaban: `Seized(XLM)`
    // era de solo escritura. `sweep_seized` es la ruta de salida que faltaba.
    // ---------------------------------------------------------------------
    /// `sweep_seized` sobre un activo sin nada barrible.
    ///
    /// "Nada barrible" no es lo mismo que "nada incautado": en el activo de
    /// DEUDA, lo que `PendingSettlement` reclama tiene prioridad y no se puede
    /// barrer. Si todo lo incautado esta reservado para repagar al pool, esto
    /// revierte aunque `get_seized` devuelva un numero positivo.
    NothingToSweep = 39,
    /// `init` fue llamado sin direccion de tesoreria utilizable.
    TreasuryRequired = 40,

    // ---------------------------------------------------------------------
    // N-01. Blend lleva los pasivos en dTokens y nosotros `TotalDebt` en
    // subyacente. La conversion redondea a favor del pool en los dos
    // sentidos, asi que todo repago TOTAL deja un resto que nuestros libros
    // no ven y que bloquea una salida completa.
    // ---------------------------------------------------------------------
    /// `sweep_interest` sin residuo que sanear.
    NothingToSweepInterest = 41,
    /// `sweep_interest` por encima del residuo real.
    ///
    /// **Es el tope que hace segura a la funcion.** Sin el, alguien podria
    /// pagar deuda REAL de usuarios mientras nuestros libros la siguen
    /// mostrando: la divergencia inversa a N-01, y creada por nosotros.
    SweepExceedsResidual = 42,
}

// =============================================================================
// CROSS-CONTRACT CLIENTS
// =============================================================================

/// Subset of the vigente-badge interface this controller calls.
#[contractclient(name = "BadgeClient")]
pub trait Badge {
    fn is_defaulted(env: Env, borrower: Address) -> bool;
    fn get_score(env: Env, borrower: Address) -> Option<u32>;
    fn slash(env: Env, caller: Address, borrower: Address, reason: u32);
    fn get_default(env: Env, borrower: Address) -> Option<DefaultBadge>;
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

/// SEP-40 price oracle subset. Reflector conforms — verified: it is the upstream
/// our aggregator routes to on testnet. No claim is made about any other provider.
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

/// Subconjunto del `ReserveConfig` de Blend. **Copiado campo por campo del
/// wasm desplegado**, no de la documentacion: el XDR se decodifica por
/// posicion y orden alfabetico, asi que un campo de menos o en otro lugar da
/// un error de decodificacion en produccion y no en los tests.
///
/// Leido el 2026-10-22 con
/// `stellar contract info interface --id CDYUHA3T... --network testnet`.
#[contracttype]
#[derive(Clone)]
pub struct ReserveConfig {
    pub c_factor: u32,
    pub decimals: u32,
    pub enabled: bool,
    pub index: u32,
    pub l_factor: u32,
    pub max_util: u32,
    pub r_base: u32,
    pub r_one: u32,
    pub r_three: u32,
    pub r_two: u32,
    pub reactivity: u32,
    pub supply_cap: i128,
    pub util: u32,
}

/// `ReserveData` de Blend. El campo que nos importa es **`d_rate`**: convierte
/// dTokens a subyacente, y es lo que hace falta para acotar `sweep_interest`.
#[contracttype]
#[derive(Clone)]
pub struct ReserveData {
    pub b_rate: i128,
    pub b_supply: i128,
    pub backstop_credit: i128,
    pub d_rate: i128,
    pub d_supply: i128,
    pub ir_mod: i128,
    pub last_time: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Reserve {
    pub asset: Address,
    pub config: ReserveConfig,
    pub data: ReserveData,
    pub scalar: i128,
}

/// Subset of the Blend pool interface this controller calls.
///
/// **Verified against the deployed wasm, not the documentation.** Read on
/// 2026-10-22 with `stellar contract info interface --id CDYUHA3T...
/// --network testnet`, which prints the interface the binary actually exports:
///
/// ```text
/// fn get_positions(env: soroban_sdk::Env, address: soroban_sdk::Address) -> Positions;
/// fn get_reserve(env: soroban_sdk::Env, asset: soroban_sdk::Address) -> Reserve;
/// ```
///
/// This matters for N-01. The whole finding is that our `TotalDebt` and
/// Blend's liability ledger drift apart, and we had no way to read Blend's
/// side: the trait only declared `submit`, so the only liability figure the
/// contract could see was its own.
#[contractclient(name = "BlendPoolClient")]
pub trait BlendPool {
    fn submit(
        env: Env,
        from: Address,
        spender: Address,
        to: Address,
        requests: Vec<Request>,
    ) -> Positions;
    /// What Blend says this address owes and holds. The maps are keyed by the
    /// reserve INDEX, not by asset address -- see `reserve_index`.
    fn get_positions(env: Env, address: Address) -> Positions;
    /// Needed only for `data.d_rate`, which converts dTokens to underlying.
    fn get_reserve(env: Env, asset: Address) -> Reserve;
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
    /// Per-asset limit applied to EACH user's holding of that asset
    /// (0 = uncapped). Finding M-04: without it a single user could absorb the
    /// whole asset cap. Gates entry only — never an exit.
    UserCap(Address),
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
    /// Donde salen los fondos de `sweep_seized`. Se escribe en `init` y NO
    /// tiene setter: el admin no puede redirigirla. Es lo que hace que esta
    /// funcion sea una ruta de salida y no un poder de mover fondos ajenos.
    Treasury,
    /// Debt written off at liquidation, pending Blend-side settlement.
    PendingSettlement,
    /// Debt that collateral could not cover at liquidation (insolvency).
    /// Recorded, never silently dropped.
    BadDebt,
    /// IMMUTABLE floor for any tier LTV — set once at init, no setter exists.
    /// Prevents the admin from making positions liquidatable by crushing LTVs.
    MinLtvFloor,
    /// IMMUTABLE grace window (seconds) for parameter/slash effects — set
    /// once at init, no setter exists.
    ParamGraceSecs,
    /// Queued tier-ladder change awaiting its grace period (timelock).
    PendingTiers,
    /// LTV bps applied at the user's last borrow — the valuation basis for
    /// their position during the post-slash grace window.
    LtvAtBorrow(Address),
    /// Two-step admin rotation: proposed new admin awaiting acceptance.
    PendingAdmin,
}

/// A tier-ladder change queued behind the grace-period timelock.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct PendingTierChange {
    pub tiers: Vec<TierLevel>,
    pub effective_at: u64,
}

/// Mirror of vigente-badge's DefaultBadge (field names must match the badge).
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct DefaultBadge {
    pub score_at_default: u32,
    pub defaulted_at: u64,
    pub slashed_by: Address,
    pub reason: u32,
}

/// One score band of the credit ladder: score >= min_score → ltv_bps.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct TierLevel {
    pub min_score: u32,
    pub ltv_bps: u32,
}

/// Everything `init` fixed, readable in one call.
///
/// Exists because ten configuration keys had no getter at all -- `Pool` and
/// `Oracle` among them, which govern where user funds go and where the price
/// comes from. They were readable off-chain by parsing instance storage, but
/// not through the ABI, so neither an integrating contract nor a deploy script
/// could assert anything about them. See ADR v4 4.10.
///
/// A struct rather than ten separate getters because the case that motivates it
/// -- the deploy script's assertion pass -- wants all of them at once.
#[contracttype]
pub struct ControllerConfig {
    pub admin: Address,
    pub oracle: Address,
    pub reputation_registry: Address,
    pub blend_pool: Address,
    pub borrow_asset: Address,
    pub max_price_age: u64,
    pub min_ltv_floor: u32,
    pub param_grace_secs: u64,
    pub paused: bool,
    pub treasury: Address,
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
    /// Immutable after init: no tier may ever have an LTV below this.
    pub min_ltv_floor: u32,
    /// Immutable after init: grace window (s) for tier changes and slash
    /// effects on existing positions (48 h recommended in production).
    pub param_grace_secs: u64,
    /// Per-user cap for the collateral asset registered here, in token units.
    /// MUST be positive: `init` rejects 0 with `Error::UserCapRequired`.
    /// Changed later with `set_user_cap`; extra assets get theirs through
    /// `add_collateral_asset`.
    pub user_cap: i128,
    /// Direccion que recibe el corte del protocolo via `sweep_seized`.
    /// Inmutable despues de `init`. MUST ser distinta del propio contrato:
    /// barrer hacia uno mismo dejaria los fondos igual de atrapados.
    pub treasury: Address,
}

/// Hard ceiling for any tier LTV. Must stay strictly below the Blend
/// reserve c_factor (90% on the canonical testnet pool) so the aggregate
/// position can never be liquidated by Blend at a user's limit.
pub const MAX_LTV_BPS: u32 = 9_000;

/// Liquidation parameters. Deliberately constants, not admin-settable: a lever
/// the admin can move is a lever the admin can abuse, and these do not need to
/// change during a capped pilot. Fewer admin powers is the point (see M-07).
///
/// Fraction of the debt a single liquidation may repay.
pub const CLOSE_FACTOR_BPS: u32 = 5_000; // 50 %
/// Discount the liquidator gets on the seized collateral.
pub const LIQUIDATION_PENALTY_BPS: u32 = 800; // 8 %
/// Share of that penalty routed to the protocol instead of the liquidator.
pub const PROTOCOL_PENALTY_SHARE_BPS: u32 = 2_000; // 20 % of 8 pts = 1.6 pts

/// `health()` sentinel for a user with zero debt.
pub const HEALTH_NO_DEBT: u32 = u32::MAX;

/// Escala del `d_rate` de Blend: 9 decimales.
const D_RATE_SCALAR: i128 = 1_000_000_000;

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
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        config.admin.require_auth();

        if config.min_ltv_floor == 0 || config.min_ltv_floor > MAX_LTV_BPS {
            panic_with_error!(&env, Error::MinLtvFloorOutOfRange);
        }
        if config.param_grace_secs == 0 {
            panic_with_error!(&env, Error::ParamGraceSecsRequired);
        }
        Self::validate_tiers(&env, &config.tier_ltv, config.min_ltv_floor);
        if config.max_price_age == 0 {
            panic_with_error!(&env, Error::MaxPriceAgeRequired);
        }
        if config.collateral_cap < 0 {
            panic_with_error!(&env, Error::CapNegative);
        }
        // Typed, not a string panic: a caller can branch on this one, and a
        // deployment script should be able to tell "you forgot the cap" apart
        // from any other init failure.
        if config.user_cap <= 0 {
            panic_with_error!(&env, Error::UserCapRequired);
        }
        // Barrer hacia el propio contrato no recupera nada: los fondos quedan
        // donde ya estaban. Se rechaza al desplegar y no en el primer barrido,
        // porque para entonces la direccion ya es inmutable.
        if config.treasury == env.current_contract_address() {
            panic_with_error!(&env, Error::TreasuryRequired);
        }
        // All Stellar classic-asset SACs use 7 decimals; the LTV math assumes
        // collateral and borrow asset share the same token scale.
        let borrow_decimals = TokenClient::new(&env, &config.borrow_asset).decimals();
        let coll_decimals = TokenClient::new(&env, &config.collateral_asset).decimals();
        if borrow_decimals != coll_decimals {
            panic_with_error!(&env, Error::DecimalsMismatch);
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
        s.set(&DataKey::UserCap(config.collateral_asset.clone()), &config.user_cap);
        s.set(&DataKey::Treasury, &config.treasury);
        s.set(&DataKey::TierLtv, &config.tier_ltv);
        s.set(&DataKey::MaxPriceAge, &config.max_price_age);
        // Immutable by construction: no setter exists for either key.
        s.set(&DataKey::MinLtvFloor, &config.min_ltv_floor);
        s.set(&DataKey::ParamGraceSecs, &config.param_grace_secs);
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
            panic_with_error!(&env, Error::AmountNotPositive);
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
        // M-04: concentration limit. Checked against this user's holding, not
        // the pool total, so one account cannot take the whole asset cap.
        let user_cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::UserCap(asset.clone()))
            .unwrap_or(0);
        if user_cap > 0 {
            let held: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Collateral(user.clone(), asset.clone()))
                .unwrap_or(0);
            if held + amount > user_cap {
                panic_with_error!(&env, Error::UserCapExceeded);
            }
        }
        if cap > 0 && total + amount > cap {
            panic_with_error!(&env, Error::AssetCapExceeded);
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
        // NON-CUSTODIAL INVARIANT: exits are NEVER pausable. See `pause()`.
        user.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::AmountNotPositive);
        }
        let key = DataKey::Collateral(user.clone(), asset.clone());
        let held: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount > held {
            panic_with_error!(&env, Error::WithdrawExceedsCollateral);
        }

        // Simulate the post-withdraw position before touching state.
        let debt: i128 = Self::get_debt(env.clone(), user.clone());
        if debt > 0 {
            let capacity_after =
                Self::borrow_capacity(&env, &user, &asset, held - amount);
            if capacity_after < debt {
                panic_with_error!(&env, Error::PositionWouldBeUnhealthy);
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
            panic_with_error!(&env, Error::AmountNotPositive);
        }

        let badge = Self::badge_client(&env);
        if badge.is_defaulted(&user) {
            panic_with_error!(&env, Error::BorrowerInDefault);
        }
        let score = badge
            .get_score(&user)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoActiveBadge));
        let ltv = Self::ltv_for_score(&env, score);
        if ltv == 0 {
            panic_with_error!(&env, Error::ScoreBelowMinimumTier);
        }

        let allowed = Self::max_borrow(env.clone(), user.clone());
        if amount > allowed {
            panic_with_error!(&env, Error::ExceedsCreditLimit);
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

        // Snapshot the LTV this position was underwritten at — it is the
        // valuation basis during the post-slash grace window (Fix B.3).
        let snap_key = DataKey::LtvAtBorrow(user.clone());
        env.storage().persistent().set(&snap_key, &ltv);
        env.storage().persistent().extend_ttl(&snap_key, TTL_LEDGERS, TTL_LEDGERS);
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
        // NON-CUSTODIAL INVARIANT: deleveraging is NEVER pausable. See `pause()`.
        user.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::AmountNotPositive);
        }
        let debt_key = DataKey::Debt(user.clone());
        let debt: i128 = env.storage().persistent().get(&debt_key).unwrap_or(0);
        if amount > debt {
            panic_with_error!(&env, Error::RepayExceedsDebt);
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
        if debt - amount == 0 {
            env.storage().persistent().remove(&DataKey::LtvAtBorrow(user.clone()));
        }

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
        let ltv = Self::effective_user_ltv(&env, &user);
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
    /// Partial liquidation, Model A: the liquidator repays part of the debt in
    /// the borrow asset and receives collateral at a discount. No swap, so no
    /// slippage and no dependency on a DEX.
    ///
    /// Closes M-03. Before this, `liquidate` seized 100 % of the collateral into
    /// a bucket with no way out. Now it seizes only what the repayment plus the
    /// penalty is worth; the remainder stays with the borrower and withdrawable.
    ///
    ///   penalty_value    = repay_amount x LIQUIDATION_PENALTY_BPS
    ///   protocol_cut     = penalty_value x PROTOCOL_PENALTY_SHARE_BPS
    ///   liquidator_bonus = penalty_value - protocol_cut   (split, not charged twice)
    ///   seize_value      = repay_amount + penalty_value
    ///   surplus          = collateral_held - seize_amount (stays with the borrower)
    ///
    /// Successive calls are allowed until `health >= 100`: one close factor does
    /// not always restore health.
    ///
    /// Never reads the pause flag - risk management must work while paused.
    pub fn liquidate(
        env: Env,
        liquidator: Address,
        user: Address,
        collateral_asset: Address,
        repay_amount: i128,
    ) {
        liquidator.require_auth();

        if liquidator == user {
            panic_with_error!(&env, Error::SelfLiquidation);
        }
        if repay_amount <= 0 {
            panic_with_error!(&env, Error::AmountNotPositive);
        }
        Self::require_collateral_asset(&env, &collateral_asset);

        let debt: i128 = Self::get_debt(env.clone(), user.clone());
        if debt <= 0 {
            panic_with_error!(&env, Error::NoDebtToLiquidate);
        }
        let hp = Self::health(env.clone(), user.clone());
        if hp >= 100 {
            panic_with_error!(&env, Error::PositionIsHealthy);
        }

        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");
        let me = env.current_contract_address();
        let now = env.ledger().timestamp();

        let collateral_value = Self::raw_collateral_value(&env, &user);
        if collateral_value < debt {
            Self::liquidate_insolvent(&env, &user, debt, collateral_value, now);
            return;
        }

        if repay_amount > debt * CLOSE_FACTOR_BPS as i128 / 10_000 {
            panic_with_error!(&env, Error::RepayExceedsCloseFactor);
        }

        let penalty_value = repay_amount * LIQUIDATION_PENALTY_BPS as i128 / 10_000;
        let protocol_cut_value = penalty_value * PROTOCOL_PENALTY_SHARE_BPS as i128 / 10_000;
        let liquidator_value = repay_amount + (penalty_value - protocol_cut_value);

        // Ceiling on both legs, then summed, so the two cannot disagree and the
        // rounding error can never be charged twice to the surplus.
        let to_liquidator = Self::value_to_collateral(&env, &collateral_asset, liquidator_value);
        let to_protocol = Self::value_to_collateral(&env, &collateral_asset, protocol_cut_value);
        let seize_amount = to_liquidator + to_protocol;

        let key = DataKey::Collateral(user.clone(), collateral_asset.clone());
        let held: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if seize_amount > held {
            // Solvent overall but not in this asset: the liquidator must lower
            // the amount or pick another collateral. Never silently over-seize.
            panic_with_error!(&env, Error::SeizeExceedsCollateral);
        }

        // 1. The liquidator funds the repayment.
        TokenClient::new(&env, &borrow_asset).transfer(&liquidator, &me, &repay_amount);
        Self::authorize_pool_pull(&env, &borrow_asset, repay_amount);
        let mut reqs: Vec<Request> = Vec::new(&env);
        reqs.push_back(Request {
            address: borrow_asset.clone(),
            amount: repay_amount,
            request_type: REQ_REPAY,
        });
        Self::pool_client(&env).submit(&me, &me, &me, &reqs);

        // 2. Books first, transfer after.
        env.storage().persistent().set(&key, &(held - seize_amount));
        let total_coll: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCollateral(collateral_asset.clone()))
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalCollateral(collateral_asset.clone()),
            &(total_coll - to_liquidator),
        );
        let debt_key = DataKey::Debt(user.clone());
        env.storage().persistent().set(&debt_key, &(debt - repay_amount));
        let total_debt: i128 = env.storage().instance().get(&DataKey::TotalDebt).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalDebt, &(total_debt - repay_amount));
        let seized: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Seized(collateral_asset.clone()))
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::Seized(collateral_asset.clone()),
            &(seized + to_protocol),
        );

        // 3. The liquidator share leaves the pool straight to their wallet. The
        //    protocol cut stays in the pool, tracked by `Seized`.
        let mut out: Vec<Request> = Vec::new(&env);
        out.push_back(Request {
            address: collateral_asset.clone(),
            amount: to_liquidator,
            request_type: REQ_WITHDRAW_COLLATERAL,
        });
        Self::pool_client(&env).submit(&me, &me, &liquidator, &out);

        env.events().publish(
            (symbol_short!("liq"), user.clone()),
            (repay_amount, to_liquidator, to_protocol, hp, now),
        );
    }

    /// Insolvent position: collateral is worth less than the debt. No penalty is
    /// charged - there is nothing to reward - everything is seized, the
    /// shortfall is recorded as bad debt rather than quietly dropped, and the
    /// badge is slashed.
    ///
    /// The only path that seizes a whole position under Model A.
    fn liquidate_insolvent(
        env: &Env,
        user: &Address,
        debt: i128,
        collateral_value: i128,
        now: u64,
    ) {
        let assets: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::CollateralAssets)
            .unwrap_or(Vec::new(env));
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
            env.events()
                .publish((symbol_short!("seize"), user.clone()), (asset, held, now));
        }

        env.storage().persistent().set(&DataKey::Debt(user.clone()), &0_i128);
        env.storage().persistent().remove(&DataKey::LtvAtBorrow(user.clone()));
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

        let shortfall = debt - collateral_value;
        let bad: i128 = env.storage().instance().get(&DataKey::BadDebt).unwrap_or(0);
        env.storage().instance().set(&DataKey::BadDebt, &(bad + shortfall));

        // M-02: the badge admin must not be able to block a liquidation. If the
        // badge is paused the slash is skipped and announced; the seizure still
        // completes.
        let me = env.current_contract_address();
        let badge = Self::badge_client(env);
        if !badge.is_defaulted(user) && badge.try_slash(&me, user, &3_u32).is_err() {
            env.events()
                .publish((symbol_short!("noslash"), user.clone()), now);
        }

        env.events().publish(
            (symbol_short!("liq_bad"), user.clone()),
            (debt, collateral_value, shortfall, now),
        );
    }

    /// Settle seized collateral against the pool debt.
    ///
    /// Second half of M-03. There is NO destination parameter by design: the
    /// only place funds can go is a `Repay` against the pool this contract
    /// borrows from. An address argument would turn the settlement path into an
    /// admin extraction route, which is the property the finding is about.
    /// Permissionless for the same reason.
    ///
    /// Only the debt asset settles directly. Any other asset must be sold for
    /// the debt asset first, and this contract deliberately contains no swap:
    /// that is a Tranche 2 deliverable with its own slippage bounds. Until then
    /// a non-debt asset reverts and says so, instead of pretending.
    pub fn settle_seized(env: Env, asset: Address) {
        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");
        if asset != borrow_asset {
            panic_with_error!(&env, Error::SettleAssetNotDebtAsset);
        }

        let seized: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Seized(asset.clone()))
            .unwrap_or(0);
        let pending: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PendingSettlement)
            .unwrap_or(0);
        let amount = if seized < pending { seized } else { pending };
        if amount <= 0 {
            panic_with_error!(&env, Error::NothingToSettle);
        }

        let me = env.current_contract_address();
        let mut pull: Vec<Request> = Vec::new(&env);
        pull.push_back(Request {
            address: asset.clone(),
            amount,
            request_type: REQ_WITHDRAW_COLLATERAL,
        });
        Self::pool_client(&env).submit(&me, &me, &me, &pull);

        Self::authorize_pool_pull(&env, &asset, amount);
        let mut repay: Vec<Request> = Vec::new(&env);
        repay.push_back(Request {
            address: asset.clone(),
            amount,
            request_type: REQ_REPAY,
        });
        Self::pool_client(&env).submit(&me, &me, &me, &repay);

        env.storage()
            .instance()
            .set(&DataKey::Seized(asset.clone()), &(seized - amount));
        env.storage()
            .instance()
            .set(&DataKey::PendingSettlement, &(pending - amount));
        env.events()
            .publish((symbol_short!("settle"), asset), amount);
    }

    // -------------------------------------------------------------------------
    // ADMIN
    // -------------------------------------------------------------------------

    /// Queue a tier-ladder replacement behind the grace-period timelock.
    /// NON-CUSTODIAL INVARIANT: a healthy position can never become
    /// liquidatable by an instant parameter change — every ladder change is
    /// announced (event) and only takes effect after `ParamGraceSecs`.
    pub fn queue_set_tier_ltv(env: Env, tiers: Vec<TierLevel>) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        let floor: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinLtvFloor)
            .expect("not initialized");
        Self::validate_tiers(&env, &tiers, floor);
        let grace: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ParamGraceSecs)
            .expect("not initialized");
        let effective_at = env.ledger().timestamp() + grace;
        let pending = PendingTierChange { tiers, effective_at };
        env.storage().instance().set(&DataKey::PendingTiers, &pending);
        env.events().publish((symbol_short!("tier_q"),), effective_at);
    }

    /// Apply a queued ladder change once its grace period has elapsed.
    /// Permissionless on purpose: the admin cannot delay or veto the apply
    /// any more than they can rush it.
    pub fn apply_tier_ltv(env: Env) {
        let pending: PendingTierChange = env
            .storage()
            .instance()
            .get(&DataKey::PendingTiers)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoPendingTierChange));
        if env.ledger().timestamp() < pending.effective_at {
            panic_with_error!(&env, Error::StillInGracePeriod);
        }
        env.storage().instance().set(&DataKey::TierLtv, &pending.tiers);
        env.storage().instance().remove(&DataKey::PendingTiers);
        env.events().publish((symbol_short!("tier_ok"),), pending.effective_at);
    }

    pub fn get_pending_tiers(env: Env) -> Option<PendingTierChange> {
        env.storage().instance().get(&DataKey::PendingTiers)
    }

    /// Two-step admin rotation (enables migrating to a multisig account).
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

    /// Set the total-collateral cap for an asset (0 = uncapped).
    pub fn set_cap(env: Env, asset: Address, cap: i128) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        if cap < 0 {
            panic_with_error!(&env, Error::CapNegative);
        }
        Self::require_collateral_asset(&env, &asset);
        env.storage().instance().set(&DataKey::Cap(asset.clone()), &cap);
        env.events().publish((symbol_short!("cap"), asset), cap);
    }

    /// Per-user limit for `asset` (0 = uncapped).
    ///
    /// Immediate, deliberately: like `set_cap`, this gates only NEW deposits.
    /// It can never block `repay`, `withdraw_collateral` or `liquidate`, so a
    /// user already above a freshly lowered cap keeps every exit — they simply
    /// cannot add more. Parameters that CAN make a healthy position
    /// liquidatable (the tier ladder) are the ones behind the 48 h timelock.
    pub fn set_user_cap(env: Env, asset: Address, cap: i128) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        if cap < 0 {
            panic_with_error!(&env, Error::CapNegative);
        }
        Self::require_collateral_asset(&env, &asset);
        env.storage()
            .instance()
            .set(&DataKey::UserCap(asset.clone()), &cap);
        env.events().publish((symbol_short!("ucap"), asset), cap);
    }

    /// Allowlist a new collateral asset with its SEP-40 feed key, its total
    /// cap and its per-user cap. This is how BENJI (or any RWA) drops in
    /// post-sprint: config, not code. `user_cap` MUST be positive -- see the
    /// body for why it is a parameter and not a follow-up call.
    pub fn add_collateral_asset(
        env: Env,
        asset: Address,
        feed: Asset,
        cap: i128,
        user_cap: i128,
    ) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        if cap < 0 {
            panic_with_error!(&env, Error::CapNegative);
        }
        // Same reason `init` demands it: the read path treats 0 as NO LIMIT, so
        // an asset listed without a per-user cap is listed uncapped. Before
        // this parameter existed the only way to cap a new asset was to
        // remember `set_user_cap` afterwards, and M-04 already showed what that
        // produces -- the cap stayed 0 in production until somebody looked.
        // The asset that most needs the cap is the one listed here, not the one
        // in `init`: an RWA with finite redemption capacity arrives this way.
        if user_cap <= 0 {
            panic_with_error!(&env, Error::UserCapRequired);
        }
        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");
        if TokenClient::new(&env, &asset).decimals()
            != TokenClient::new(&env, &borrow_asset).decimals()
        {
            panic_with_error!(&env, Error::DecimalsMismatch);
        }
        let mut assets: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::CollateralAssets)
            .unwrap_or(Vec::new(&env));
        if assets.contains(&asset) {
            panic_with_error!(&env, Error::AssetAlreadyListed);
        }
        assets.push_back(asset.clone());
        env.storage().instance().set(&DataKey::CollateralAssets, &assets);
        env.storage().instance().set(&DataKey::FeedKey(asset.clone()), &feed);
        env.storage().instance().set(&DataKey::Cap(asset.clone()), &cap);
        env.storage().instance().set(&DataKey::UserCap(asset.clone()), &user_cap);
        env.events().publish((symbol_short!("asset"), asset), cap);
    }


    /// Saca el corte del protocolo del pool y lo manda a la tesoreria — la
    /// ruta de salida que N-02 demostro que no existia.
    ///
    /// **El hallazgo, medido en produccion.** `liquidate` anota la incautacion
    /// bajo el activo de COLATERAL (`Seized(collateral_asset)`) y
    /// `settle_seized` rechaza todo lo que no sea el activo de DEUDA. Con XLM
    /// de colateral y USDC de deuda nunca se cruzan, asi que `Seized(XLM)` era
    /// una clave de solo escritura: 12.980.108 stroops (1,298 XLM) acumulados
    /// en `CAH2BHAE…` e inalcanzables, creciendo con cada liquidacion.
    ///
    /// **Por que en el activo incautado y no vendiendolo por el de deuda.**
    /// Vender exige un swap, y un swap dentro de una liquidacion trae
    /// deslizamiento, MEV y una dependencia de DEX que hoy no tenemos. El
    /// protocolo acumula el activo de colateral: es menos elegante y es
    /// verificable.
    ///
    /// **Por que el destino se fija en `init`.** Si `sweep_seized` tomara la
    /// direccion por parametro, el admin podria mandar el corte a donde
    /// quisiera, y eso SI seria un poder de mover fondos. Con el destino
    /// inmutable, lo unico que decide el admin es *cuando* se barre.
    ///
    /// **Prioridad sobre el activo de deuda.** Lo que `PendingSettlement`
    /// reclama es deuda incobrable que hay que repagarle al pool, y va antes
    /// que el corte del protocolo. Por eso lo barrible excluye esa reserva:
    /// cobrarnos antes que al pool seria quedarnos con una perdida ajena.
    pub fn sweep_seized(env: Env, asset: Address) {
        let admin = Self::require_admin(&env);
        admin.require_auth();
        Self::require_collateral_asset(&env, &asset);

        let seized: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Seized(asset.clone()))
            .unwrap_or(0);

        // En el activo de deuda, lo reservado para `settle_seized` no se toca.
        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");
        let reservado: i128 = if asset == borrow_asset {
            let pending: i128 = env
                .storage()
                .instance()
                .get(&DataKey::PendingSettlement)
                .unwrap_or(0);
            if seized < pending { seized } else { pending }
        } else {
            0
        };

        let amount = seized - reservado;
        if amount <= 0 {
            panic_with_error!(&env, Error::NothingToSweep);
        }

        // Sacarlo del pool y mandarlo a la tesoreria. El orden importa: se
        // descuenta `Seized` DESPUES de que las dos operaciones externas
        // salieron bien, para que un fallo no deje el contador dicho pero el
        // dinero sin mover.
        let me = env.current_contract_address();
        let mut pull: Vec<Request> = Vec::new(&env);
        pull.push_back(Request {
            address: asset.clone(),
            amount,
            request_type: REQ_WITHDRAW_COLLATERAL,
        });
        Self::pool_client(&env).submit(&me, &me, &me, &pull);

        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .expect("not initialized");
        TokenClient::new(&env, &asset).transfer(&me, &treasury, &amount);

        env.storage()
            .instance()
            .set(&DataKey::Seized(asset.clone()), &(seized - amount));
        env.events()
            .publish((symbol_short!("sweep"), asset), amount);
    }

    /// La direccion de tesoreria fijada en `init`. Sin setter.
    pub fn get_treasury(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Treasury)
            .expect("not initialized")
    }

    /// Cuanto de `Seized(asset)` se puede barrer AHORA. Distinto de
    /// `get_seized`: en el activo de deuda descuenta lo que
    /// `PendingSettlement` reclama. Existe para que un operador pueda
    /// comprobar antes de firmar, en vez de descubrirlo con una reversion.
    pub fn get_sweepable(env: Env, asset: Address) -> i128 {
        let seized: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Seized(asset.clone()))
            .unwrap_or(0);
        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");
        if asset != borrow_asset {
            return seized;
        }
        let pending: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PendingSettlement)
            .unwrap_or(0);
        let reservado = if seized < pending { seized } else { pending };
        seized - reservado
    }


    /// Paga el residuo de interes que Blend nos cobra y nuestros libros no ven
    /// — N-01.
    ///
    /// **El hallazgo, reproducido a proposito.** Blend guarda los pasivos en
    /// **dTokens**; el controller lleva `TotalDebt` en **subyacente**. Pedir
    /// prestado redondea los dTokens hacia arriba y repagar los redondea hacia
    /// abajo: las dos reglas van a favor del pool. Repagar el monto exacto que
    /// se pidio no lleva el pasivo de Blend a cero, y el resto es inalcanzable
    /// porque `repay` aborta si el monto supera la deuda contabilizada. Medido
    /// en produccion: el controller previo `CCZNOV65…` muestra
    /// `liabilities: {"0": 6}` con `get_total_debt() == 0`.
    ///
    /// **Permissionless a proposito.** Cualquiera puede sanear la posicion, y
    /// el destino no es parametrizable: es siempre un `Repay` contra el pool.
    /// No hay forma de desviar el pago. El costo es que alguien tiene que
    /// querer pagarlo; sin incentivo, nadie lo hace. Se eligio esto antes que
    /// barrer dentro de `repay`, que encareceria **todo** repago para corregir
    /// un residuo minimo.
    ///
    /// **El tope es la parte que importa.** `amount` no puede pasar de
    /// `residual = Σ(pasivos de Blend en subyacente) − TotalDebt`. Sin ese
    /// tope, alguien podria pagar deuda REAL de usuarios mientras nuestros
    /// libros la siguen mostrando — la divergencia inversa a N-01, y esta vez
    /// causada por nosotros.
    ///
    /// La deuda contabilizada de ningun usuario cambia aca. Esta funcion no
    /// toca `Debt(user)` ni `TotalDebt`: solo salda con el pool lo que el pool
    /// cree que le debemos de mas.
    pub fn sweep_interest(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::AmountNotPositive);
        }

        let residual = Self::interest_residual(&env);
        if residual <= 0 {
            panic_with_error!(&env, Error::NothingToSweepInterest);
        }
        if amount > residual {
            panic_with_error!(&env, Error::SweepExceedsResidual);
        }

        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");

        let me = env.current_contract_address();
        TokenClient::new(&env, &borrow_asset).transfer(&from, &me, &amount);
        Self::authorize_pool_pull(&env, &borrow_asset, amount);
        let mut reqs: Vec<Request> = Vec::new(&env);
        reqs.push_back(Request {
            address: borrow_asset.clone(),
            amount,
            request_type: REQ_REPAY,
        });
        Self::pool_client(&env).submit(&me, &me, &me, &reqs);

        env.events()
            .publish((symbol_short!("swpint"), from), amount);
    }

    /// Cuanto mas cree Blend que le debemos, comparado con nuestros libros, en
    /// unidades del activo de deuda.
    ///
    /// Devuelve 0 si no hay residuo. Un valor **negativo** seria la
    /// divergencia inversa —nuestros libros mostrando mas deuda que Blend— y
    /// tambien se devuelve como 0: no hay nada que sanear pagando.
    ///
    /// **La conversion es la parte delicada.** `get_positions` devuelve
    /// dTokens; `d_rate` los lleva a subyacente y cambia entre bloques. Se
    /// redondea **hacia abajo** a proposito: un residuo subestimado deja algo
    /// sin sanear, que es molesto; uno sobrestimado deja pagar deuda real, que
    /// es el bug que el tope existe para impedir.
    pub fn get_interest_residual(env: Env) -> i128 {
        Self::interest_residual(&env)
    }

    fn interest_residual(env: &Env) -> i128 {
        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");
        let me = env.current_contract_address();
        let pool = Self::pool_client(env);

        let reserve = pool.get_reserve(&borrow_asset);
        let idx = reserve.config.index;
        let d_rate = reserve.data.d_rate;
        if d_rate <= 0 {
            return 0;
        }

        let positions = pool.get_positions(&me);
        let d_tokens = positions.liabilities.get(idx).unwrap_or(0);
        if d_tokens <= 0 {
            return 0;
        }
        // Hacia abajo: subestimar es seguro, sobrestimar no.
        let en_subyacente = d_tokens * d_rate / D_RATE_SCALAR;

        let total_debt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalDebt)
            .unwrap_or(0);
        let residual = en_subyacente - total_debt;
        if residual > 0 { residual } else { 0 }
    }

    /// Circuit breaker — NON-CUSTODIAL INVARIANT: `pause` only freezes the
    /// entry of NEW risk (`deposit_collateral`, `borrow`). It can NEVER
    /// freeze `withdraw_collateral`, `repay`, or `liquidate`: the user can
    /// always exit and deleverage, and risk management keeps running.
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

    pub fn get_user_cap(env: Env, asset: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::UserCap(asset))
            .unwrap_or(0)
    }

    /// The TOTAL cap for this asset, across every user. `0` means NO CAP --
    /// the same encoding `deposit_collateral` reads (`if cap > 0`).
    pub fn get_cap(env: Env, asset: Address) -> i128 {
        env.storage().instance().get(&DataKey::Cap(asset)).unwrap_or(0)
    }

    /// The SEP-40 key this asset is priced under. Lets a deploy script check
    /// the oracle route end to end: read the key here, then ask the aggregator
    /// for `lastprice` of it.
    pub fn get_feed_key(env: Env, asset: Address) -> Option<Asset> {
        env.storage().instance().get(&DataKey::FeedKey(asset))
    }

    /// Whether the circuit breaker is on. Separate from `get_config` because
    /// this is the hot path: an integrator checking before building a
    /// transaction should not deserialize eight addresses to read one bool.
    ///
    /// Note what a `true` does NOT mean: `pause` never blocks `withdraw`,
    /// `repay` or `liquidate`. It only stops NEW risk from entering.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    /// Everything `init` fixed, in one call. Panics if not initialized --
    /// absent config is not a default, it is a contract that was never set up,
    /// and a script asserting against it should fail loudly rather than read
    /// zeros.
    pub fn get_config(env: Env) -> ControllerConfig {
        let s = env.storage().instance();
        ControllerConfig {
            admin: s.get(&DataKey::Admin).expect("not initialized"),
            oracle: s.get(&DataKey::Oracle).expect("not initialized"),
            reputation_registry: s.get(&DataKey::Registry).expect("not initialized"),
            blend_pool: s.get(&DataKey::Pool).expect("not initialized"),
            borrow_asset: s.get(&DataKey::BorrowAsset).expect("not initialized"),
            max_price_age: s.get(&DataKey::MaxPriceAge).expect("not initialized"),
            min_ltv_floor: s.get(&DataKey::MinLtvFloor).expect("not initialized"),
            param_grace_secs: s.get(&DataKey::ParamGraceSecs).expect("not initialized"),
            paused: s.get(&DataKey::Paused).unwrap_or(false),
            treasury: s.get(&DataKey::Treasury).expect("not initialized"),
        }
    }

    pub fn get_seized(env: Env, asset: Address) -> i128 {
        env.storage().instance().get(&DataKey::Seized(asset)).unwrap_or(0)
    }

    pub fn get_bad_debt(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::BadDebt).unwrap_or(0)
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
            panic_with_error!(&env, Error::ContractPaused);
        }
    }

    fn require_collateral_asset(env: &Env, asset: &Address) {
        let assets: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::CollateralAssets)
            .unwrap_or(Vec::new(env));
        if !assets.contains(asset) {
            panic_with_error!(&env, Error::AssetNotAllowlisted);
        }
    }

    fn validate_tiers(env: &Env, tiers: &Vec<TierLevel>, min_ltv_floor: u32) {
        if tiers.is_empty() {
            panic_with_error!(&env, Error::EmptyTierLadder);
        }
        let mut prev_floor: Option<u32> = None;
        for t in tiers.iter() {
            if t.ltv_bps == 0 || t.ltv_bps > MAX_LTV_BPS {
                panic_with_error!(&env, Error::TierLtvOutOfRange);
            }
            if t.ltv_bps < min_ltv_floor {
                panic_with_error!(&env, Error::TierLtvBelowFloor);
            }
            if let Some(p) = prev_floor {
                if t.min_score >= p {
                    panic_with_error!(&env, Error::TierFloorsNotDescending);
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

    /// LTV basis for valuing an EXISTING position (health / withdraw checks).
    /// - Active badge → its tier on the active ladder.
    /// - Slashed badge inside the grace window → the LTV the position was
    ///   underwritten at (snapshot), so an admin-inducible slash can never
    ///   make a healthy position liquidatable instantly (Fix B.3).
    /// - Otherwise (grace elapsed, or badge merely expired — expiry is
    ///   user-predictable, not admin-inducible) → the lowest tier.
    /// Note: this only affects LIQUIDATION exposure; new borrowing by a
    /// defaulted user stays blocked via `is_defaulted` in `borrow`.
    fn effective_user_ltv(env: &Env, user: &Address) -> u32 {
        let badge = Self::badge_client(env);
        if let Some(s) = badge.get_score(user) {
            return Self::ltv_for_score(env, s);
        }
        if let Some(d) = badge.get_default(user) {
            let grace: u64 = env
                .storage()
                .instance()
                .get(&DataKey::ParamGraceSecs)
                .unwrap_or(0);
            if env.ledger().timestamp() < d.defaulted_at + grace {
                let snap: Option<u32> = env
                    .storage()
                    .persistent()
                    .get(&DataKey::LtvAtBorrow(user.clone()));
                if let Some(ltv) = snap {
                    return ltv;
                }
            }
        }
        Self::lowest_tier_ltv(env)
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
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoFeedForAsset));
        let oracle = Self::oracle_client(env);
        let pd = match oracle.lastprice(&feed) {
            Some(p) => p,
            None => panic_with_error!(&env, Error::OracleNoPrice),
        };
        if pd.price <= 0 {
            panic_with_error!(&env, Error::OracleInvalidPrice);
        }
        let now = env.ledger().timestamp();
        let max_age: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MaxPriceAge)
            .expect("not initialized");
        if now.saturating_sub(pd.timestamp) > max_age {
            panic_with_error!(&env, Error::OraclePriceStale);
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
        let ltv = Self::effective_user_ltv(env, user);
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

    /// Total value of a user collateral, in borrow-asset units, with NO LTV
    /// applied. `capacity_of` with a 100 % factor is exactly that, so the price
    /// path and its staleness guards are shared rather than duplicated.
    fn raw_collateral_value(env: &Env, user: &Address) -> i128 {
        Self::total_borrow_capacity(env, user, 10_000)
    }

    /// Convert a value expressed in borrow-asset units into units of `asset`,
    /// rounding UP. Ceiling is deliberate: the rounding remainder is charged to
    /// the position being liquidated, never to the protocol or the liquidator,
    /// so repeated liquidations cannot leak value out of the contract.
    fn value_to_collateral(env: &Env, asset: &Address, value: i128) -> i128 {
        if value <= 0 {
            return 0;
        }
        let p_coll = Self::fresh_price(env, asset);
        let borrow_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::BorrowAsset)
            .expect("not initialized");
        let p_borrow = Self::fresh_price(env, &borrow_asset);
        let num = value * p_borrow;
        (num + p_coll - 1) / p_coll
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
