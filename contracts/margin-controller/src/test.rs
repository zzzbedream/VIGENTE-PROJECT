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
    Asset, Error, InitConfig, MarginController, MarginControllerClient, Positions, PriceData, Request,
    TierLevel, HEALTH_NO_DEBT, REQ_BORROW, REQ_REPAY, REQ_SUPPLY_COLLATERAL,
    REQ_WITHDRAW_COLLATERAL, Reserve, ReserveConfig, ReserveData,
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

/// Escala de `d_rate`, como en Blend: 9 decimales.
const D_SCALAR: i128 = 1_000_000_000;

#[contracttype]
#[derive(Clone)]
pub enum MockKey {
    /// activo -> indice de reserva. Blend indexa las posiciones por indice,
    /// no por direccion.
    Index(Address),
    NextIndex,
    /// (usuario, indice) -> colateral en SUBYACENTE.
    Coll(Address, u32),
    /// (usuario, indice) -> pasivo en **dTokens**, no en subyacente. Es la
    /// distincion que produce N-01.
    Liab(Address, u32),
    /// indice -> `d_rate`, escalado por `D_SCALAR`. Arranca en 1,0 y sube
    /// cuando se devenga interes.
    DRate(u32),
}

/// Pool Blend de prueba **con libro**.
///
/// El doble anterior devolvia `Positions` vacio, y eso es exactamente por lo
/// que N-01 pudo vivir meses sin que un test lo tocara: si el pool de prueba
/// no lleva cuentas, no puede discrepar de las nuestras.
///
/// Lo que este modela, y es lo unico que importa para N-01:
///
/// - Los pasivos se guardan en **dTokens**, como Blend. El controller lleva su
///   `TotalDebt` en subyacente. Son unidades distintas y la conversion es
///   `subyacente = dTokens x d_rate / D_SCALAR`.
/// - Al **pedir prestado**, los dTokens se redondean HACIA ARRIBA: el usuario
///   nunca queda debiendo menos de lo que recibio.
/// - Al **repagar**, se redondean HACIA ABAJO: nunca se quema mas deuda de la
///   que el pago cubre.
///
/// Las dos reglas van a favor del pool, y juntas dejan un resto: repagar el
/// monto exacto que se pidio no lleva el pasivo a cero. Eso es N-01.
#[contractimpl]
impl MockPool {
    /// `submit(from, spender, to, requests)` con la semantica de Blend, que
    /// importa y es facil de errar: **`from` es la direccion cuya POSICION se
    /// modifica**; `spender` paga lo que entra; `to` recibe lo que sale. No
    /// son lo mismo: `borrow` del controller llama
    /// `submit(me, me, user, ...)` -- el pasivo es del controller y los tokens
    /// van al usuario.
    ///
    /// El mock anterior ignoraba `from` (lo tenia como `_from`) y no llevaba
    /// libro, asi que esta distincion no podia manifestarse. La primera
    /// version de este mock la erro: uso `to` para el libro, y con eso N-01
    /// dejaba de reproducirse porque el pasivo se anotaba contra el usuario y
    /// el repago lo buscaba contra el controller.
    pub fn submit(
        env: Env,
        from: Address,
        spender: Address,
        to: Address,
        requests: Vec<Request>,
    ) -> Positions {
        let me = env.current_contract_address();
        for req in requests.iter() {
            let token = TokenClient::new(&env, &req.address);
            let idx = Self::index_of(&env, &req.address);
            let rate = Self::d_rate(&env, idx);
            match req.request_type {
                REQ_SUPPLY_COLLATERAL => {
                    token.transfer(&spender, &me, &req.amount);
                    let k = MockKey::Coll(from.clone(), idx);
                    let prev: i128 = env.storage().persistent().get(&k).unwrap_or(0);
                    env.storage().persistent().set(&k, &(prev + req.amount));
                }
                REQ_WITHDRAW_COLLATERAL => {
                    let k = MockKey::Coll(from.clone(), idx);
                    let prev: i128 = env.storage().persistent().get(&k).unwrap_or(0);
                    env.storage().persistent().set(&k, &(prev - req.amount));
                    token.transfer(&me, &to, &req.amount);
                }
                REQ_BORROW => {
                    // Redondeo HACIA ARRIBA contra el usuario.
                    let d = (req.amount * D_SCALAR + rate - 1) / rate;
                    let k = MockKey::Liab(from.clone(), idx);
                    let prev: i128 = env.storage().persistent().get(&k).unwrap_or(0);
                    env.storage().persistent().set(&k, &(prev + d));
                    token.transfer(&me, &to, &req.amount);
                }
                REQ_REPAY => {
                    token.transfer(&spender, &me, &req.amount);
                    // Redondeo HACIA ABAJO: el resto queda a favor del pool.
                    let d = req.amount * D_SCALAR / rate;
                    let k = MockKey::Liab(from.clone(), idx);
                    let prev: i128 = env.storage().persistent().get(&k).unwrap_or(0);
                    let nuevo = if d > prev { 0 } else { prev - d };
                    env.storage().persistent().set(&k, &nuevo);
                }
                _ => panic!("unsupported request type"),
            }
        }
        Self::get_positions(env.clone(), from)
    }

    /// Lo que el pool dice que esta direccion debe y tiene. Pasivos en
    /// **dTokens**; colateral en subyacente.
    pub fn get_positions(env: Env, address: Address) -> Positions {
        let mut collateral: Map<u32, i128> = Map::new(&env);
        let mut liabilities: Map<u32, i128> = Map::new(&env);
        let n: u32 = env.storage().instance().get(&MockKey::NextIndex).unwrap_or(0);
        for idx in 0..n {
            let c: i128 = env
                .storage()
                .persistent()
                .get(&MockKey::Coll(address.clone(), idx))
                .unwrap_or(0);
            if c != 0 {
                collateral.set(idx, c);
            }
            let l: i128 = env
                .storage()
                .persistent()
                .get(&MockKey::Liab(address.clone(), idx))
                .unwrap_or(0);
            if l != 0 {
                liabilities.set(idx, l);
            }
        }
        Positions { collateral, liabilities, supply: Map::new(&env) }
    }

    /// Lo que Blend expone de una reserva. Solo `config.index` y
    /// `data.d_rate` llevan valores con sentido; el resto va en cero porque
    /// el controller no los lee, y poner numeros inventados ahi haria creer
    /// que el mock modela mas de lo que modela.
    pub fn get_reserve(env: Env, asset: Address) -> Reserve {
        let idx = Self::index_of(&env, &asset);
        Reserve {
            asset: asset.clone(),
            config: ReserveConfig {
                c_factor: 0,
                decimals: 7,
                enabled: true,
                index: idx,
                l_factor: 0,
                max_util: 0,
                r_base: 0,
                r_one: 0,
                r_three: 0,
                r_two: 0,
                reactivity: 0,
                supply_cap: 0,
                util: 0,
            },
            data: ReserveData {
                b_rate: D_SCALAR,
                b_supply: 0,
                backstop_credit: 0,
                d_rate: Self::d_rate(&env, idx),
                d_supply: 0,
                ir_mod: 0,
                last_time: 0,
            },
            scalar: 10_000_000,
        }
    }

    /// Solo para tests: sube el `d_rate` de un activo, que es lo que hace el
    /// interes en Blend. No existe en el pool real.
    pub fn accrue(env: Env, asset: Address, bps: u32) {
        let idx = Self::index_of(&env, &asset);
        let rate = Self::d_rate(&env, idx);
        let nuevo = rate + rate * (bps as i128) / 10_000;
        env.storage().instance().set(&MockKey::DRate(idx), &nuevo);
    }

    /// Solo para tests: el `d_rate` vigente, para poder convertir dTokens a
    /// subyacente desde el lado del test.
    pub fn get_d_rate(env: Env, asset: Address) -> i128 {
        let idx = Self::index_of(&env, &asset);
        Self::d_rate(&env, idx)
    }

    /// Solo para tests: el indice de reserva que el mock asigno a un activo.
    pub fn reserve_index(env: Env, asset: Address) -> u32 {
        Self::index_of(&env, &asset)
    }

    fn index_of(env: &Env, asset: &Address) -> u32 {
        let k = MockKey::Index(asset.clone());
        if let Some(i) = env.storage().instance().get::<MockKey, u32>(&k) {
            return i;
        }
        let n: u32 = env.storage().instance().get(&MockKey::NextIndex).unwrap_or(0);
        env.storage().instance().set(&k, &n);
        env.storage().instance().set(&MockKey::NextIndex, &(n + 1));
        n
    }

    fn d_rate(env: &Env, idx: u32) -> i128 {
        env.storage().instance().get(&MockKey::DRate(idx)).unwrap_or(D_SCALAR)
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
/// 900 s = 15 min. Es el valor VIVO en el controller desplegado, leido del
/// almacenamiento de instancia de `CAH2BHAE…` el 2026-10-21. Hasta esa fecha el
/// fixture usaba 300 y el comentario afirmaba que "mirrors the testnet config",
/// que era falso: produccion tolera un precio tres veces mas rancio que
/// cualquier cosa que la suite probaba.
const MAX_PRICE_AGE: u64 = 900;
const MIN_LTV_FLOOR: u32 = 5_000; // immutable floor, below the Bronze tier
/// 172.800 s = 48 h, el valor vivo en produccion (`ParamGraceSecs`). Antes eran
/// 3.600: la suite probaba la ventana de gracia a 1/48 de su tamano real.
/// Alinearlo no rompio ningun test, asi que la divergencia era gratuita.
const GRACE_SECS: u64 = 172_800;

/// Oracle prices at 14 decimals (Reflector's scale).
const P_XLM: i128 = 19_000_000_000_000; // $0.19
const P_USDC: i128 = 100_000_000_000_000; // $1.00

/// 7-decimal token helpers.
fn units(n: i128) -> i128 {
    n * 10_000_000
}

const POOL_LIQUIDITY: i128 = 10_000_000_0000000; // 10M USDC
const XLM_CAP: i128 = 0; // uncapped by default; cap tests use setup_with_cap
/// Per-user cap del fixture. Deliberadamente generoso para no estorbar al resto
/// de los tests, pero NO cero: `init` ya lo rechaza, que es justo el punto de
/// que exista. Los tests de cap lo bajan con `set_user_cap`.
/// DELIBERADAMENTE distinto de produccion, que hoy tiene **150 XLM**
/// (`UserCap(XLM) = 1.500.000.000` stroops, medido el 2026-10-21).
///
/// No se alinea porque el tope por usuario es un limite de CONCENTRACION, no un
/// parametro de correccion: bajarlo a 150 obligaria a reescribir 32 de los 43
/// depositos de la suite y dejaria las cifras de liquidacion demasiado chicas
/// para ser legibles. Pero la leccion de N-02 es que un test verde sobre un
/// fixture que no existe en produccion no es cobertura, asi que el ciclo
/// completo SI se prueba una vez en el tope real:
/// `ciclo_completo_en_el_tope_real_de_produccion`.
/// DELIBERADAMENTE distinto de produccion, que hoy tiene **150 XLM**
/// (`UserCap(XLM) = 1.500.000.000` stroops, medido el 2026-10-21).
///
/// No se alinea porque el tope por usuario es un limite de CONCENTRACION, no un
/// parametro de correccion: bajarlo a 150 obligaria a reescribir 32 de los 43
/// depositos de la suite y dejaria las cifras de liquidacion demasiado chicas
/// para ser legibles. Pero la leccion de N-02 es que un test verde sobre un
/// fixture que no existe en produccion no es cobertura, asi que el ciclo
/// completo SI se prueba una vez en el tope real:
/// `ciclo_completo_en_el_tope_real_de_produccion`.
const USER_CAP: i128 = 1_000_000_0000000; // 1M XLM

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
    treasury: Address,
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

    // Tesoreria del protocolo: una direccion externa, como en produccion.
    // Que sea distinta del contrato es un requisito de `init`, no una
    // comodidad del test -- barrer hacia uno mismo no recupera nada.
    let treasury = Address::generate(&env);

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
        user_cap: USER_CAP,
        treasury: treasury.clone(),
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
        treasury,
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
fn test_deposit_above_cap_rejected() {
    let h = setup_with_cap(units(1_500));
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    let err = h.ctrl.try_deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000)).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::AssetCapExceeded as u32));
}

#[test]
fn test_deposit_unlisted_asset_rejected() {
    let h = setup();
    // The borrow asset itself is not allowlisted as collateral.
    let err = h.ctrl.try_deposit_collateral(&h.borrower, &h.usdc_id, &units(100)).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::AssetNotAllowlisted as u32));
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
fn test_borrow_above_limit_fails() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    let max = h.ctrl.max_borrow(&h.borrower);
    let err = h.ctrl.try_borrow(&h.borrower, &(max + 1)).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::ExceedsCreditLimit as u32));
}

#[test]
fn test_borrow_without_badge_fails() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    let err = h.ctrl.try_borrow(&h.borrower, &units(10)).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::NoActiveBadge as u32));
}

#[test]
fn test_borrow_when_defaulted_fails() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    // Slash through an authorized vault (the admin address doubles as one).
    h.badge.add_vault(&h.admin);
    h.badge.slash(&h.admin, &h.borrower, &1_u32);
    let err = h.ctrl.try_borrow(&h.borrower, &units(10)).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::BorrowerInDefault as u32));
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
fn test_repay_more_than_debt_fails() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    h.ctrl.borrow(&h.borrower, &units(50));
    let err = h.ctrl.try_repay(&h.borrower, &units(51)).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::RepayExceedsDebt as u32));
}

// =============================================================================
// ORACLE SAFETY — stale / missing prices revert
// =============================================================================

#[test]
fn test_stale_price_reverts_borrow() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    h.price_oracle.set_price(
        &Asset::Stellar(h.xlm_id.clone()),
        &P_XLM,
        &(INITIAL_TIMESTAMP - MAX_PRICE_AGE - 1),
    );
    let err = h.ctrl.try_borrow(&h.borrower, &units(10)).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::OraclePriceStale as u32));
}

#[test]
fn test_missing_price_reverts_borrow() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    h.price_oracle.clear_price(&Asset::Stellar(h.xlm_id.clone()));
    let err = h.ctrl.try_borrow(&h.borrower, &units(10)).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::OracleNoPrice as u32));
}

// =============================================================================
// WITHDRAW HEALTH PRE-CHECK
// =============================================================================

#[test]
fn test_withdraw_blocked_while_at_limit() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &max);
    // Any withdrawal drops capacity below the debt.
    let err = h.ctrl.try_withdraw_collateral(&h.borrower, &h.xlm_id, &1).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::PositionWouldBeUnhealthy as u32));
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
    // Colateral $95 < deuda $161: INSOLVENTE. Es la unica ruta que incauta el
    // 100 %, y la unica que genera colateral en Seized bajo el Modelo A.
    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(1));

    // Debt written off into the settlement bucket; claim seized.
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);
    assert_eq!(h.ctrl.get_total_debt(), 0);
    assert_eq!(h.ctrl.get_pending_settlement(), max);
    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), 0);
    assert_eq!(h.ctrl.get_seized(&h.xlm_id), amount);
    // Reputation burned atomically, cross-contract.
    assert!(h.badge.is_defaulted(&h.borrower));
    // Y el faltante queda registrado, no descartado en silencio.
    assert!(h.ctrl.get_bad_debt() > 0, "la insolvencia debe registrar bad debt");
}

#[test]
fn test_liquidate_healthy_position_fails() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    h.ctrl.borrow(&h.borrower, &units(50));
    let keeper = Address::generate(&h.env);
    let err = h.ctrl.try_liquidate(&keeper, &h.borrower, &h.xlm_id, &units(1)).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::PositionIsHealthy as u32));
}

#[test]
fn test_liquidate_without_debt_fails() {
    let h = setup();
    let keeper = Address::generate(&h.env);
    let err = h.ctrl.try_liquidate(&keeper, &h.borrower, &h.xlm_id, &units(1)).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::NoDebtToLiquidate as u32));
}

// =============================================================================
// ADMIN / CIRCUIT BREAKER
// =============================================================================

#[test]
fn test_pause_blocks_deposit() {
    let h = setup();
    h.ctrl.pause();
    let err = h.ctrl.try_deposit_collateral(&h.borrower, &h.xlm_id, &units(100)).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::ContractPaused as u32));
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
fn test_tier_ltv_above_c_factor_margin_rejected() {
    let h = setup();
    let mut tiers = Vec::new(&h.env);
    // 95% would sit above the Blend c_factor safety margin (max 90%).
    tiers.push_back(TierLevel { min_score: 300, ltv_bps: 9_500 });
    let err = h.ctrl.try_queue_set_tier_ltv(&tiers).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::TierLtvOutOfRange as u32));
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
    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(1));
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
    assert!(h.ctrl
        .try_liquidate(&keeper, &h.borrower, &h.xlm_id, &units(1))
        .is_err());
    assert!(h.ctrl.try_apply_tier_ltv().is_err());

    // After the grace window anyone applies; the user had N hours to react.
    advance_time(&h.env, GRACE_SECS + 1);
    let now = h.env.ledger().timestamp();
    h.price_oracle.set_price(&Asset::Stellar(h.xlm_id.clone()), &P_XLM, &now);
    h.price_oracle.set_price(&Asset::Stellar(h.usdc_id.clone()), &P_USDC, &now);
    h.ctrl.apply_tier_ltv();
    assert!(h.ctrl.get_pending_tiers().is_none());
    assert!(h.ctrl.health(&h.borrower) < 100);
    // Solvente pero insana: ruta PARCIAL. El deudor no pierde todo.
    // Bajo el Modelo A el liquidador PAGA deuda, asi que necesita el activo.
    MockUsdcClient::new(&h.env, &h.usdc_id).mint(&keeper, &units(1_000));
    let deuda_antes = h.ctrl.get_debt(&h.borrower);
    let colateral_antes = h.ctrl.get_collateral(&h.borrower, &h.xlm_id);
    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(20));
    assert_eq!(h.ctrl.get_debt(&h.borrower), deuda_antes - units(20));
    assert!(
        h.ctrl.get_collateral(&h.borrower, &h.xlm_id) > 0,
        "la liquidacion parcial NO puede dejar al deudor en cero"
    );
    assert!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id) < colateral_antes);
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
    assert!(h.ctrl
        .try_liquidate(&keeper, &h.borrower, &h.xlm_id, &units(1))
        .is_err());

    // Past the grace window it drops to the lowest tier and is liquidatable —
    // and liquidate must not double-slash an already-defaulted borrower.
    advance_time(&h.env, GRACE_SECS + 1);
    let now = h.env.ledger().timestamp();
    h.price_oracle.set_price(&Asset::Stellar(h.xlm_id.clone()), &P_XLM, &now);
    h.price_oracle.set_price(&Asset::Stellar(h.usdc_id.clone()), &P_USDC, &now);
    assert!(h.ctrl.health(&h.borrower) < 100);
    MockUsdcClient::new(&h.env, &h.usdc_id).mint(&keeper, &units(1_000));
    let deuda_antes = h.ctrl.get_debt(&h.borrower);
    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(20));
    assert_eq!(h.ctrl.get_debt(&h.borrower), deuda_antes - units(20));
    assert!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id) > 0);
}

#[test]
fn test_queue_rejects_ltv_below_floor() {
    let h = setup();
    let mut tiers = Vec::new(&h.env);
    tiers.push_back(TierLevel { min_score: 300, ltv_bps: MIN_LTV_FLOOR - 1 });
    let err = h.ctrl.try_queue_set_tier_ltv(&tiers).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::TierLtvBelowFloor as u32));
}

#[test]
fn test_apply_without_pending_fails() {
    let h = setup();
    let err = h.ctrl.try_apply_tier_ltv().err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::NoPendingTierChange as u32));
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

// =============================================================================
// PROPERTY TESTS DE INVARIANTES (audit/00_INVENTORY.md §b)
// =============================================================================
//
// Los tests de arriba prueban casos puntuales. Estos recorren estados
// aleatorios y afirman que los invariantes se sostienen SIEMPRE — la
// diferencia entre "probamos que funciona" y "probamos que no puede fallar".
// Responden a la objeción del panel: deliverables are missing a validation
// section.
// =============================================================================

/// **I1 — `paused = true` ⇒ withdraw, repay y liquidate siguen ejecutables.**
/// El pilar de la postura non-custodial: el admin frena la entrada de riesgo,
/// nunca la salida del usuario.
#[test]
fn prop_i1_pause_nunca_bloquea_las_salidas() {
    let h = setup();
    h.env.budget().reset_unlimited();
    let mut rng = StdRng::seed_from_u64(0xC0FFEE);
    let xlm_admin = MockUsdcClient::new(&h.env, &h.xlm_id);
    let usdc_admin = MockUsdcClient::new(&h.env, &h.usdc_id);

    for i in 0..10_u32 {
        let user = Address::generate(&h.env);
        let colateral: i128 = rng.gen_range(units(100)..=units(2_000));
        let score: u32 = rng.gen_range(300..=1_000);

        xlm_admin.mint(&user, &colateral);
        h.ctrl.deposit_collateral(&user, &h.xlm_id, &colateral);
        mint_badge(&h, &user, score, 5_000 + i);

        let max = h.ctrl.max_borrow(&user);
        if max <= 0 {
            continue;
        }
        let deuda = (max * rng.gen_range(20..=90) as i128) / 100;
        h.ctrl.borrow(&user, &deuda);
        usdc_admin.mint(&user, &deuda);

        h.ctrl.pause();

        // INVARIANTE: repagar y retirar siguen disponibles con el contrato pausado.
        h.ctrl.repay(&user, &deuda);
        assert_eq!(h.ctrl.get_debt(&user), 0, "iter {i}: repay bloqueado al pausar");
        h.ctrl.withdraw_collateral(&user, &h.xlm_id, &colateral);
        assert_eq!(
            h.ctrl.get_collateral(&user, &h.xlm_id),
            0,
            "iter {i}: withdraw bloqueado al pausar"
        );

        // La otra mitad del invariante: la entrada de riesgo SÍ queda frenada.
        assert!(h.ctrl.try_deposit_collateral(&user, &h.xlm_id, &units(1)).is_err());
        assert!(h.ctrl.try_borrow(&user, &1).is_err());

        h.ctrl.unpause();
    }
}

/// **I2 — ninguna secuencia de llamadas admin transfiere colateral a una
/// dirección elegida por el admin.**
#[test]
fn prop_i2_ningun_poder_admin_mueve_fondos_del_usuario() {
    let h = setup();
    let user = Address::generate(&h.env);
    let atacante = Address::generate(&h.env);
    let xlm_admin = MockUsdcClient::new(&h.env, &h.xlm_id);

    xlm_admin.mint(&user, &units(1_000));
    h.ctrl.deposit_collateral(&user, &h.xlm_id, &units(1_000));
    mint_badge(&h, &user, 850, 6_001);

    let colateral_antes = h.ctrl.get_collateral(&user, &h.xlm_id);
    let saldo_atacante = h.xlm.balance(&atacante);
    let saldo_admin = h.xlm.balance(&h.admin);

    // Todo el arsenal admin en secuencia.
    h.ctrl.pause();
    h.ctrl.unpause();
    h.ctrl.set_cap(&h.xlm_id, &units(1));
    let mut tiers = Vec::new(&h.env);
    tiers.push_back(TierLevel { min_score: 300, ltv_bps: MIN_LTV_FLOOR });
    h.ctrl.queue_set_tier_ltv(&tiers);
    h.ctrl.propose_admin(&atacante);
    h.ctrl.accept_admin();

    // INVARIANTE: el colateral no se movió y nadie lo recibió.
    assert_eq!(
        h.ctrl.get_collateral(&user, &h.xlm_id),
        colateral_antes,
        "un poder admin alteró el colateral del usuario"
    );
    assert_eq!(h.xlm.balance(&atacante), saldo_atacante, "el admin recibió fondos");
    assert_eq!(h.xlm.balance(&h.admin), saldo_admin, "el admin recibió fondos");

    // Y el usuario sigue pudiendo salir por su cuenta.
    h.ctrl.withdraw_collateral(&user, &h.xlm_id, &colateral_antes);
    assert_eq!(h.xlm.balance(&user), units(1_000));
}

/// **I5 — Σ Debt(u) = TotalDebt** con secuencias aleatorias de préstamo y repago.
#[test]
fn prop_i5_la_contabilidad_agregada_cuadra_siempre() {
    let h = setup();
    h.env.budget().reset_unlimited();
    let mut rng = StdRng::seed_from_u64(0xBEEF);
    let xlm_admin = MockUsdcClient::new(&h.env, &h.xlm_id);
    let usdc_admin = MockUsdcClient::new(&h.env, &h.usdc_id);

    let mut usuarios: std::vec::Vec<Address> = std::vec::Vec::new();
    for i in 0..6_u32 {
        let user = Address::generate(&h.env);
        let colateral: i128 = rng.gen_range(units(200)..=units(1_500));
        xlm_admin.mint(&user, &colateral);
        h.ctrl.deposit_collateral(&user, &h.xlm_id, &colateral);
        mint_badge(&h, &user, rng.gen_range(550..=1_000), 7_000 + i);

        let max = h.ctrl.max_borrow(&user);
        if max > 0 {
            let deuda = (max * rng.gen_range(30..=95) as i128) / 100;
            h.ctrl.borrow(&user, &deuda);
            usdc_admin.mint(&user, &deuda);
        }
        usuarios.push(user);
    }

    let suma: i128 = usuarios.iter().map(|u| h.ctrl.get_debt(u)).sum();
    assert_eq!(suma, h.ctrl.get_total_debt(), "la suma de deudas no cuadra tras los borrows");

    for u in usuarios.iter() {
        let d = h.ctrl.get_debt(u);
        if d > 2 {
            h.ctrl.repay(u, &(d / 3));
        }
    }
    let suma2: i128 = usuarios.iter().map(|u| h.ctrl.get_debt(u)).sum();
    assert_eq!(suma2, h.ctrl.get_total_debt(), "la suma no cuadra tras los repagos");
}

/// **I8 — ninguna ruta que lee precio opera con un precio inválido**, y las
/// salidas del usuario no dependen del oráculo (I6).
#[test]
fn prop_i8_ninguna_ruta_opera_con_precio_invalido() {
    let h = setup();
    let user = Address::generate(&h.env);
    let keeper = Address::generate(&h.env);
    let xlm_admin = MockUsdcClient::new(&h.env, &h.xlm_id);
    let usdc_admin = MockUsdcClient::new(&h.env, &h.usdc_id);

    xlm_admin.mint(&user, &units(1_000));
    h.ctrl.deposit_collateral(&user, &h.xlm_id, &units(1_000));
    mint_badge(&h, &user, 850, 8_001);
    let max = h.ctrl.max_borrow(&user);
    h.ctrl.borrow(&user, &(max / 2));

    // (a) Precio viejo: ninguna ruta que lo consulte debe operar.
    h.price_oracle.set_price(
        &Asset::Stellar(h.xlm_id.clone()),
        &P_XLM,
        &(INITIAL_TIMESTAMP - MAX_PRICE_AGE - 1),
    );
    assert!(h.ctrl.try_max_borrow(&user).is_err(), "max_borrow operó con precio viejo");
    assert!(h.ctrl.try_borrow(&user, &1).is_err(), "borrow operó con precio viejo");
    assert!(h.ctrl.try_health(&user).is_err(), "health operó con precio viejo");
    assert!(
        h.ctrl.try_liquidate(&keeper, &user, &h.xlm_id, &units(1)).is_err(),
        "liquidate opero con precio viejo"
    );
    assert!(
        h.ctrl.try_withdraw_collateral(&user, &h.xlm_id, &units(1)).is_err(),
        "withdraw con deuda operó con precio viejo"
    );

    // (b) Precio ausente: idéntico resultado.
    h.price_oracle.clear_price(&Asset::Stellar(h.xlm_id.clone()));
    assert!(h.ctrl.try_max_borrow(&user).is_err(), "max_borrow operó sin precio");

    // (c) I6: repagar NO consulta el oráculo — la salida siempre disponible.
    usdc_admin.mint(&user, &max);
    let deuda = h.ctrl.get_debt(&user);
    h.ctrl.repay(&user, &deuda);
    assert_eq!(h.ctrl.get_debt(&user), 0, "repay quedó bloqueado por el oráculo caído");

    // (d) Y sin deuda, retirar tampoco lo consulta.
    h.ctrl.withdraw_collateral(&user, &h.xlm_id, &units(1_000));
    assert_eq!(h.ctrl.get_collateral(&user, &h.xlm_id), 0);
}

// =============================================================================
// ALIASING AUTOREFERENCIAL (clase de bug de Comet) — P-04(e) del post mortem
// =============================================================================
//
// El barrido de 10_SECURITY_REVIEW_REPORT.md §3.3 concluyo que NO existe la
// clase de bug de Comet en estos contratos: ninguna funcion carga dos registros
// que puedan resolver a la misma clave y persiste ambos. Estos tests fijan esa
// conclusion para que una regresion futura falle aqui y no en produccion.
//
// Funciones con dos parametros de identidad, revisadas una por una:
//   liquidate(liquidator, user)          <- unico caso alcanzable y significativo
//   deposit_collateral(user, asset)      <- ver test de abajo
//   withdraw_collateral(user, asset)     <- idem
//   get_collateral(user, asset)          <- solo lectura
//   badge::slash(caller, borrower)       <- `caller` solo alimenta require_vault

#[test]
fn aliasing_liquidate_con_liquidador_igual_al_deudor_revierte() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 1);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &max);
    // Posicion insana: sin la guarda, el deudor podria autoliquidarse.
    h.price_oracle
        .set_price(&Asset::Stellar(h.xlm_id.clone()), &(P_XLM / 2), &INITIAL_TIMESTAMP);
    assert!(h.ctrl.health(&h.borrower) < 100);

    // `liquidate` devuelve (), asi que el cliente entrega un soroban_sdk::Error:
    // se compara contra el codigo de contrato exacto, no contra "fallo cualquiera".
    let err = h
        .ctrl
        .try_liquidate(&h.borrower, &h.borrower, &h.xlm_id, &units(1))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::SelfLiquidation as u32),
        "debe revertir con ESE error (SelfLiquidation), no con uno cualquiera"
    );

    // Un tercero sí puede liquidarla: la guarda no rompe la gestion de riesgo.
    let keeper = Address::generate(&h.env);
    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(1));
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);
}

#[test]
fn aliasing_user_igual_a_asset_no_corrompe_contabilidad() {
    // `deposit_collateral(user, asset)` toma dos Address. Que coincidan no puede
    // perder una escritura porque las claves son variantes distintas de DataKey
    // (Collateral(user,asset) vs TotalCollateral(asset)); ademas el asset debe
    // estar en la allowlist. Se fija el comportamiento: revierte por allowlist.
    let h = setup();
    let r = h.ctrl.try_deposit_collateral(&h.borrower, &h.borrower, &units(10));
    assert!(r.is_err(), "un asset no listado debe rechazarse aunque coincida con el usuario");
    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), 0);
}

#[test]
fn aliasing_la_contabilidad_agregada_cuadra_tras_liquidacion() {
    // sum(colateral por usuario) == TotalCollateral, incluido el camino de
    // liquidacion, que es donde Comet perdio la escritura.
    let h = setup();
    let a = Address::generate(&h.env);
    let b = Address::generate(&h.env);
    let xlm_admin = MockUsdcClient::new(&h.env, &h.xlm_id);
    xlm_admin.mint(&a, &units(1_000));
    xlm_admin.mint(&b, &units(1_000));
    h.ctrl.deposit_collateral(&a, &h.xlm_id, &units(1_000));
    h.ctrl.deposit_collateral(&b, &h.xlm_id, &units(1_000));
    mint_badge(&h, &a, 850, 40);
    let max = h.ctrl.max_borrow(&a);
    h.ctrl.borrow(&a, &max);

    h.price_oracle
        .set_price(&Asset::Stellar(h.xlm_id.clone()), &(P_XLM / 2), &INITIAL_TIMESTAMP);
    let keeper = Address::generate(&h.env);
    h.ctrl.liquidate(&keeper, &a, &h.xlm_id, &units(1));

    // Tras la liquidacion el colateral de `a` pasa a Seized; el de `b` intacto.
    let suma = h.ctrl.get_collateral(&a, &h.xlm_id)
        + h.ctrl.get_collateral(&b, &h.xlm_id)
        + h.ctrl.get_seized(&h.xlm_id);
    assert_eq!(suma, units(2_000), "nada se pierde ni se duplica en la liquidacion");
    assert_eq!(h.ctrl.get_collateral(&b, &h.xlm_id), units(1_000));
}

// =============================================================================
// M-04 — CAP DE EXPOSICION POR USUARIO
// =============================================================================

#[test]
fn user_cap_rechaza_deposito_que_lo_excede() {
    let h = setup();
    h.ctrl.set_user_cap(&h.xlm_id, &units(500));
    assert_eq!(h.ctrl.get_user_cap(&h.xlm_id), units(500));

    let err = h
        .ctrl
        .try_deposit_collateral(&h.borrower, &h.xlm_id, &units(501))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::UserCapExceeded as u32),
        "debe revertir con UserCapExceeded"
    );
    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), 0);
}

#[test]
fn user_cap_acepta_deposito_exactamente_en_el_limite() {
    let h = setup();
    h.ctrl.set_user_cap(&h.xlm_id, &units(500));
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(500));
    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), units(500));

    // Un stroop mas ya no entra: el limite es sobre el acumulado, no por deposito.
    assert!(h.ctrl.try_deposit_collateral(&h.borrower, &h.xlm_id, &1).is_err());
}

#[test]
fn user_cap_no_limita_a_otro_usuario() {
    // El cap es POR usuario: que uno lo agote no bloquea al resto. Ese es
    // exactamente el problema que M-04 describe con el cap por activo.
    let h = setup();
    h.ctrl.set_user_cap(&h.xlm_id, &units(500));
    let otro = Address::generate(&h.env);
    MockUsdcClient::new(&h.env, &h.xlm_id).mint(&otro, &units(1_000));

    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(500));
    h.ctrl.deposit_collateral(&otro, &h.xlm_id, &units(500));
    assert_eq!(h.ctrl.get_collateral(&otro, &h.xlm_id), units(500));
}

#[test]
fn user_cap_nunca_atrapa_una_posicion_preexistente() {
    // INVARIANTE DE CUSTODIA. Un cap que atrapa fondos es peor que no tener cap
    // y reabriria C-02, que ya esta cerrado. Se comprueba el caso hostil: el
    // admin baja el cap MUY por debajo de una posicion que ya existe.
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 70);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &(max / 2));

    // El admin baja el cap a 1 XLM: la posicion queda 1000x por encima.
    h.ctrl.set_user_cap(&h.xlm_id, &units(1));

    // No puede AGREGAR riesgo...
    assert!(h.ctrl.try_deposit_collateral(&h.borrower, &h.xlm_id, &units(1)).is_err());

    // ...pero todas las salidas siguen abiertas.
    h.ctrl.repay(&h.borrower, &(max / 2));
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);
    h.ctrl.withdraw_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), 0);
    assert_eq!(h.xlm.balance(&h.borrower), units(10_000), "recupero todo su colateral");
}

/// Antes este test se llamaba `user_cap_en_cero_significa_sin_limite` y fijaba
/// justo lo que resulto ser el problema: que un despliegue arrancaba SIN tope
/// por usuario y la mitigacion de M-04 no hacia nada hasta que alguien se
/// acordaba de `set_user_cap`. Se midio dormida en produccion el 2026-10-19.
///
/// Ahora `init` escribe el tope y lo exige positivo, asi que el valor seguro es
/// el que se obtiene por omision.
#[test]
fn init_deja_el_tope_por_usuario_puesto_sin_que_nadie_lo_llame() {
    let h = setup();
    assert_eq!(
        h.ctrl.get_user_cap(&h.xlm_id),
        USER_CAP,
        "init debe dejar el tope escrito: nadie llamo a set_user_cap"
    );
    // Y el tope rige de verdad, no es solo un valor guardado.
    h.ctrl.set_user_cap(&h.xlm_id, &units(5_000));
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(5_000));
    let err = h
        .ctrl
        .try_deposit_collateral(&h.borrower, &h.xlm_id, &units(1))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::UserCapExceeded as u32));
}

/// `init` con `user_cap = 0` revierte con error TIPADO. Es la diferencia entre
/// un script de despliegue que puede distinguir "te falto el tope" de
/// cualquier otro fallo, y uno que solo ve un panic opaco.
#[test]
fn init_rechaza_un_tope_por_usuario_en_cero() {
    let h = setup();

    // Instancia nueva, misma configuracion de PRODUCCION que el resto de los
    // tests -- colateral XLM, deuda USDC -- cambiando solo el tope a 0.
    let ctrl_id = h.env.register_contract(None, MarginController);
    let ctrl = MarginControllerClient::new(&h.env, &ctrl_id);
    let err = ctrl
        .try_init(&InitConfig {
            admin: h.admin.clone(),
            oracle: h.price_oracle.address.clone(),
            reputation_registry: h.badge.address.clone(),
            blend_pool: h.pool_id.clone(),
            borrow_asset: h.usdc_id.clone(),
            borrow_feed: Asset::Stellar(h.usdc_id.clone()),
            collateral_asset: h.xlm_id.clone(),
            collateral_feed: Asset::Stellar(h.xlm_id.clone()),
            collateral_cap: 0,
            tier_ltv: default_tiers(&h.env),
            max_price_age: MAX_PRICE_AGE,
            min_ltv_floor: MIN_LTV_FLOOR,
            param_grace_secs: GRACE_SECS,
            user_cap: 0,
            treasury: Address::generate(&h.env),
        })
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::UserCapRequired as u32));
}

/// El ciclo de credito completo en la configuracion EXACTA de produccion:
/// tope por usuario de 150 XLM, que es el que gobierna hoy en `CAH2BHAE…`.
///
/// Existe por la leccion de N-02 -- un test verde sobre un fixture que no
/// existe en produccion no es cobertura. El resto de la suite deposita entre
/// 500 y 5.000 XLM, montos que produccion RECHAZA: 32 de los 43 depositos de
/// este archivo estan por encima del tope real. La matematica es invariante de
/// escala, asi que sus conclusiones transfieren, pero nadie habia ejercitado el
/// ciclo en el techo que el usuario realmente tiene.
#[test]
fn ciclo_completo_en_el_tope_real_de_produccion() {
    const TOPE_PRODUCCION: i128 = 150; // XLM; UserCap(XLM) = 1_500_000_000 stroops
    let h = setup();
    h.ctrl.set_user_cap(&h.xlm_id, &units(TOPE_PRODUCCION));

    // Un XLM por encima del tope no entra.
    let err = h
        .ctrl
        .try_deposit_collateral(&h.borrower, &h.xlm_id, &units(TOPE_PRODUCCION + 1))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::UserCapExceeded as u32));

    // Justo en el tope, el ciclo entero funciona.
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(TOPE_PRODUCCION));
    mint_badge(&h, &h.borrower, 850, 7);

    // Que la cifra sea chica es el hallazgo, no un defecto del test: es el
    // prestamo maximo que el producto concede hoy a un usuario Gold.
    let max = h.ctrl.max_borrow(&h.borrower);
    assert!(max > 0, "en el tope real de produccion no se puede pedir nada");

    h.ctrl.borrow(&h.borrower, &max);
    assert_eq!(h.ctrl.get_debt(&h.borrower), max);

    h.ctrl.repay(&h.borrower, &max);
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);
    assert_eq!(h.ctrl.health(&h.borrower), HEALTH_NO_DEBT);

    h.ctrl.withdraw_collateral(&h.borrower, &h.xlm_id, &units(TOPE_PRODUCCION));
    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), 0);
}

/// La asercion del paso 2 de 4.8, como test: toda la configuracion que `init`
/// recibio se puede volver a leer POR LA ABI. Antes de `get_config` diez claves
/// no tenian getter -- `Pool` y `Oracle` entre ellas, las dos que deciden a
/// donde van los fondos y de donde sale el precio -- asi que un script de
/// despliegue no podia afirmar nada sobre ellas.
#[test]
fn get_config_devuelve_lo_que_init_recibio() {
    let h = setup();
    let c = h.ctrl.get_config();

    assert_eq!(c.admin, h.admin);
    assert_eq!(c.oracle, h.price_oracle.address);
    assert_eq!(c.reputation_registry, h.badge.address);
    assert_eq!(c.blend_pool, h.pool_id);
    assert_eq!(c.borrow_asset, h.usdc_id);
    assert_eq!(c.max_price_age, MAX_PRICE_AGE);
    assert_eq!(c.min_ltv_floor, MIN_LTV_FLOOR);
    assert_eq!(c.param_grace_secs, GRACE_SECS);
    assert!(!c.paused);

    // Per-activo: no caben en el struct global.
    assert_eq!(h.ctrl.get_cap(&h.xlm_id), XLM_CAP);
    assert_eq!(h.ctrl.get_feed_key(&h.xlm_id), Some(Asset::Stellar(h.xlm_id.clone())));
    // El activo de deuda tambien lleva feed, puesto por `init`.
    assert_eq!(h.ctrl.get_feed_key(&h.usdc_id), Some(Asset::Stellar(h.usdc_id.clone())));
    // Un activo que nadie listo devuelve None, no un panic: el script de
    // despliegue puede distinguir "no esta" de "esta mal".
    let ajeno = Address::generate(&h.env);
    assert_eq!(h.ctrl.get_feed_key(&ajeno), None);
    assert_eq!(h.ctrl.get_cap(&ajeno), 0);
}

/// `is_paused` sigue al cortacircuitos. Importa que exista porque hoy un
/// integrador no tiene forma de preguntarlo: solo puede mandar la transaccion
/// y ver si revierte.
#[test]
fn is_paused_sigue_al_cortacircuitos() {
    let h = setup();
    assert!(!h.ctrl.is_paused());
    h.ctrl.pause();
    assert!(h.ctrl.is_paused());
    assert!(h.ctrl.get_config().paused);
    h.ctrl.unpause();
    assert!(!h.ctrl.is_paused());
}

/// `add_collateral_asset` con `user_cap = 0` revierte, igual que `init`. Esta es
/// la ruta por la que entra un RWA, asi que es la que mas importa: un bono con
/// capacidad de redencion finita listado sin tope por usuario deja que una sola
/// cuenta tome todo lo que el emisor puede honrar.
#[test]
fn add_collateral_asset_rechaza_un_tope_por_usuario_en_cero() {
    let h = setup();
    let err = h
        .ctrl
        .try_add_collateral_asset(
            &h.usdc_id,
            &Asset::Stellar(h.usdc_id.clone()),
            &0_i128,
            &0_i128,
        )
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::UserCapRequired as u32));
}

/// El tope del activo nuevo esta vivo en el PRIMER deposito, sin que nadie llame
/// a `set_user_cap`. Antes de que el parametro existiera, este deposito pasaba:
/// el activo quedaba en 0, que la ruta de lectura interpreta como SIN LIMITE.
#[test]
fn add_collateral_asset_deja_el_tope_vivo_sin_llamar_a_set_user_cap() {
    let h = setup();
    h.ctrl.add_collateral_asset(
        &h.usdc_id,
        &Asset::Stellar(h.usdc_id.clone()),
        &0_i128, // cap total sin limite: el que frena es el por-usuario
        &units(100),
    );
    MockUsdcClient::new(&h.env, &h.usdc_id).mint(&h.borrower, &units(1_000));

    assert_eq!(h.ctrl.get_user_cap(&h.usdc_id), units(100));
    h.ctrl.deposit_collateral(&h.borrower, &h.usdc_id, &units(100));
    let err = h
        .ctrl
        .try_deposit_collateral(&h.borrower, &h.usdc_id, &units(1))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::UserCapExceeded as u32));
}




// =============================================================================
// N-01 — EL RESIDUO DE INTERES QUE BLEND COBRA Y NUESTROS LIBROS NO VEN
// =============================================================================

/// El fenomeno, antes que la funcion.
///
/// Blend lleva los pasivos en dTokens; el controller lleva `TotalDebt` en
/// subyacente. Pedir prestado redondea los dTokens hacia arriba y repagar los
/// redondea hacia abajo, las dos a favor del pool. Repagar el monto exacto no
/// lleva el pasivo de Blend a cero.
///
/// Este test falla si el `MockPool` vuelve a devolver mapas vacios, que es
/// como N-01 pudo vivir meses sin que ningun test lo tocara.
#[test]
fn n01_el_repago_total_deja_pasivo_en_blend() {
    let h = setup();
    let pool = MockPoolClient::new(&h.env, &h.pool_id);

    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 61);
    let prestamo = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &prestamo);

    // Interes devengado: el d_rate sube y la conversion deja de ser exacta.
    pool.accrue(&h.usdc_id, &250); // +2,5 %

    // Repago TOTAL segun nuestros libros.
    h.ctrl.repay(&h.borrower, &prestamo);
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0, "nuestros libros dicen 0");
    assert_eq!(h.ctrl.get_total_debt(), 0);

    // Y Blend sigue diciendo que debemos algo.
    let idx = pool.reserve_index(&h.usdc_id);
    let pasivo = pool
        .get_positions(&h.ctrl_id)
        .liabilities
        .get(idx)
        .unwrap_or(0);
    assert!(
        pasivo > 0,
        "N-01 no se reprodujo: Blend deberia conservar pasivo tras el repago total"
    );
}

/// El residuo se lee por la ABI y coincide con la conversion de dTokens a
/// subyacente. Es lo que acota `sweep_interest`.
#[test]
fn n01_el_residuo_se_puede_leer_y_cuadra_con_la_conversion() {
    let h = setup();
    let pool = MockPoolClient::new(&h.env, &h.pool_id);
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 62);
    let prestamo = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &prestamo);
    pool.accrue(&h.usdc_id, &250);
    h.ctrl.repay(&h.borrower, &prestamo);

    let idx = pool.reserve_index(&h.usdc_id);
    let d_tokens = pool.get_positions(&h.ctrl_id).liabilities.get(idx).unwrap_or(0);
    let d_rate = pool.get_d_rate(&h.usdc_id);
    let esperado = d_tokens * d_rate / 1_000_000_000;

    assert_eq!(h.ctrl.get_interest_residual(), esperado);
    assert!(esperado > 0);
}

/// El caso normal: alguien paga el residuo y el pasivo de Blend baja.
///
/// Es permissionless: lo paga un tercero cualquiera, no el admin ni el deudor.
#[test]
fn n01_sweep_interest_sanea_la_posicion() {
    let h = setup();
    let pool = MockPoolClient::new(&h.env, &h.pool_id);
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 63);
    let prestamo = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &prestamo);
    pool.accrue(&h.usdc_id, &250);
    h.ctrl.repay(&h.borrower, &prestamo);

    let residuo = h.ctrl.get_interest_residual();
    assert!(residuo > 0);

    // Un tercero sin ningun rol en el protocolo.
    let samaritano = Address::generate(&h.env);
    MockUsdcClient::new(&h.env, &h.usdc_id).mint(&samaritano, &units(10));

    let idx = pool.reserve_index(&h.usdc_id);
    let antes = pool.get_positions(&h.ctrl_id).liabilities.get(idx).unwrap_or(0);
    h.ctrl.sweep_interest(&samaritano, &residuo);
    let despues = pool.get_positions(&h.ctrl_id).liabilities.get(idx).unwrap_or(0);

    assert!(despues < antes, "el pasivo de Blend no bajo");
}

/// **El test que el ADR marca como el que importa:** la deuda contabilizada
/// del usuario NO cambia tras el barrido. `sweep_interest` salda con el pool,
/// no toca los libros de nadie.
#[test]
fn n01_el_barrido_no_toca_la_deuda_de_ningun_usuario() {
    let h = setup();
    let pool = MockPoolClient::new(&h.env, &h.pool_id);
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 64);
    let prestamo = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &prestamo);
    pool.accrue(&h.usdc_id, &250);

    // Se repaga solo la MITAD: el usuario queda con deuda real en los libros.
    let mitad = prestamo / 2;
    h.ctrl.repay(&h.borrower, &mitad);
    let deuda_antes = h.ctrl.get_debt(&h.borrower);
    let total_antes = h.ctrl.get_total_debt();
    assert!(deuda_antes > 0, "el usuario deberia conservar deuda");

    let residuo = h.ctrl.get_interest_residual();
    if residuo > 0 {
        let samaritano = Address::generate(&h.env);
        MockUsdcClient::new(&h.env, &h.usdc_id).mint(&samaritano, &units(1_000));
        h.ctrl.sweep_interest(&samaritano, &residuo);
    }

    assert_eq!(h.ctrl.get_debt(&h.borrower), deuda_antes, "la deuda del usuario cambio");
    assert_eq!(h.ctrl.get_total_debt(), total_antes, "TotalDebt cambio");
}

/// Por encima del residuo revierte TIPADO. Es el tope que impide pagar deuda
/// REAL de usuarios mientras nuestros libros la siguen mostrando — la
/// divergencia inversa a N-01, y creada por nosotros.
#[test]
fn n01_sweep_por_encima_del_residuo_revierte() {
    let h = setup();
    let pool = MockPoolClient::new(&h.env, &h.pool_id);
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 65);
    let prestamo = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &prestamo);
    pool.accrue(&h.usdc_id, &250);
    h.ctrl.repay(&h.borrower, &prestamo);

    let residuo = h.ctrl.get_interest_residual();
    let samaritano = Address::generate(&h.env);
    MockUsdcClient::new(&h.env, &h.usdc_id).mint(&samaritano, &units(100));

    let err = h
        .ctrl
        .try_sweep_interest(&samaritano, &(residuo + 1))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::SweepExceedsResidual as u32));
}

/// Sin residuo revierte TIPADO en vez de aceptar un pago que no corresponde.
#[test]
fn n01_sweep_sin_residuo_revierte() {
    let h = setup();
    assert_eq!(h.ctrl.get_interest_residual(), 0);
    let samaritano = Address::generate(&h.env);
    MockUsdcClient::new(&h.env, &h.usdc_id).mint(&samaritano, &units(10));
    let err = h
        .ctrl
        .try_sweep_interest(&samaritano, &units(1))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::NothingToSweepInterest as u32)
    );
}

/// INVARIANTE del plan: el pasivo en Blend menos `TotalDebt` queda **acotado y
/// es recuperable**. Tras barrer el residuo completo, lo que Blend cree que
/// debemos no supera lo que nuestros libros dicen.
#[test]
fn n01_invariante_tras_barrer_blend_no_cobra_mas_que_nuestros_libros() {
    let h = setup();
    let pool = MockPoolClient::new(&h.env, &h.pool_id);
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(&h, &h.borrower, 850, 66);
    let prestamo = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &prestamo);

    // Varias rondas de interes y repagos parciales, para que el redondeo se
    // acumule en vez de medirse una sola vez.
    for i in 0..3 {
        pool.accrue(&h.usdc_id, &150);
        h.ctrl.repay(&h.borrower, &(prestamo / 4));
        let _ = i;
    }

    let residuo = h.ctrl.get_interest_residual();
    if residuo > 0 {
        let samaritano = Address::generate(&h.env);
        MockUsdcClient::new(&h.env, &h.usdc_id).mint(&samaritano, &units(1_000));
        h.ctrl.sweep_interest(&samaritano, &residuo);
    }

    assert_eq!(
        h.ctrl.get_interest_residual(),
        0,
        "quedo residuo sin sanear despues de barrerlo entero"
    );
}

// =============================================================================
// FASE 1.3 — UN ACTIVO TIPO CETES COMO COLATERAL, DEUDA EN USDC
// =============================================================================

/// Precio del CETES de prueba: US$ 0,0643 con los 14 decimales del agregador.
/// Es el numero que midio `09_ORACLE_RWA_DECISION` componiendo el NAV de
/// Etherfuse con el FX de Reflector.
const P_CETES: i128 = 6_435_220_000_000; // $0.0643522

/// Lista un activo tipo CETES: 7 decimales como el SAC de
/// `CETES:GC3CW7ED…`, precio propio, y su tope por usuario.
///
/// Lo que este helper NO simula, y conviene decirlo: los flags del emisor.
/// El CETES real de testnet tiene `auth_clawback_enabled` y `auth_revocable`
/// activados, y un contrato de prueba no los tiene. El comportamiento ante un
/// clawback es la prueba T20 de la Fase 5 y necesita una red, no un test
/// unitario.
fn listar_cetes(h: &Harness) -> Address {
    let cetes_id = h.env.register_contract(None, MockUsdc);
    let cetes_admin = MockUsdcClient::new(&h.env, &cetes_id);
    // 7 decimales, igual que el SAC de CETES:GC3CW7ED... en testnet, y que el
    // activo de deuda: la matematica de LTV asume la misma escala en los dos.
    cetes_admin.initialize(
        &h.admin,
        &7_u32,
        &String::from_str(&h.env, "Cetes"),
        &String::from_str(&h.env, "CETES"),
    );
    cetes_admin.mint(&h.borrower, &units(100_000));
    h.price_oracle.set_price(
        &Asset::Stellar(cetes_id.clone()),
        &P_CETES,
        &INITIAL_TIMESTAMP,
    );
    h.ctrl.add_collateral_asset(
        &cetes_id,
        &Asset::Stellar(cetes_id.clone()),
        &0_i128,
        &USER_CAP,
    );
    cetes_id
}

/// El ciclo entero con CETES de colateral y USDC de deuda: deposito, borrow,
/// repago, retiro. Es la configuracion del MVP, no la del fixture.
#[test]
fn cetes_ciclo_completo_con_deuda_en_usdc() {
    let h = setup();
    let cetes = listar_cetes(&h);
    let cetes_token = TokenClient::new(&h.env, &cetes);
    let antes = cetes_token.balance(&h.borrower);

    h.ctrl.deposit_collateral(&h.borrower, &cetes, &units(10_000));
    mint_badge(&h, &h.borrower, 850, 51);

    let max = h.ctrl.max_borrow(&h.borrower);
    assert!(max > 0, "con CETES de colateral no se puede pedir nada");
    h.ctrl.borrow(&h.borrower, &max);
    assert_eq!(h.ctrl.get_debt(&h.borrower), max);

    h.ctrl.repay(&h.borrower, &max);
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);
    assert_eq!(h.ctrl.health(&h.borrower), HEALTH_NO_DEBT);

    h.ctrl.withdraw_collateral(&h.borrower, &cetes, &units(10_000));
    assert_eq!(cetes_token.balance(&h.borrower), antes);
}

/// Liquidacion de una posicion en CETES, y el corte del protocolo sale por
/// `sweep_seized`. Es N-02 cerrado sobre el activo que de verdad importa: un
/// RWA, no el XLM del fixture.
#[test]
fn cetes_liquidacion_y_el_protocolo_cobra_su_parte() {
    let h = setup();
    let cetes = listar_cetes(&h);
    let cetes_token = TokenClient::new(&h.env, &cetes);

    h.ctrl.deposit_collateral(&h.borrower, &cetes, &units(10_000));
    mint_badge(&h, &h.borrower, 850, 52);
    let max = h.ctrl.max_borrow(&h.borrower);
    h.ctrl.borrow(&h.borrower, &max);

    // El CETES cae al 55 %: insana pero solvente -> liquidacion parcial.
    h.price_oracle.set_price(
        &Asset::Stellar(cetes.clone()),
        &(P_CETES * 55 / 100),
        &INITIAL_TIMESTAMP,
    );
    let keeper = liquidador_financiado(&h);
    h.ctrl.liquidate(&keeper, &h.borrower, &cetes, &(max / 10));

    let incautado = h.ctrl.get_seized(&cetes);
    assert!(incautado > 0, "la liquidacion de CETES no dejo corte");

    let tesoreria_antes = cetes_token.balance(&h.treasury);
    h.ctrl.sweep_seized(&cetes);
    assert_eq!(cetes_token.balance(&h.treasury) - tesoreria_antes, incautado);
    assert_eq!(h.ctrl.get_seized(&cetes), 0);
}

/// El tope por usuario rige igual sobre el RWA. Importa mas aca que en el XLM:
/// un bono tiene capacidad de redencion finita, asi que una sola cuenta sin
/// tope puede tomar todo lo que el emisor puede honrar.
#[test]
fn cetes_el_tope_por_usuario_rige_sobre_el_rwa() {
    let h = setup();
    let cetes = listar_cetes(&h);
    h.ctrl.set_user_cap(&cetes, &units(1_000));

    h.ctrl.deposit_collateral(&h.borrower, &cetes, &units(1_000));
    let err = h
        .ctrl
        .try_deposit_collateral(&h.borrower, &cetes, &units(1))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::UserCapExceeded as u32));
}

// =============================================================================
// ALIASING — LOS CASOS QUE EL BARRIDO ANTERIOR NO VIO
// =============================================================================

/// `liquidate` toma TRES direcciones, no dos.
///
/// El barrido que `audit/12` cita para sostener que la clase de aliasing de
/// Comet no nos alcanza uso un patron de UNA SOLA LINEA, asi que se salto
/// `liquidate` y `slash`, que tienen la firma multilinea. La conclusion de
/// fondo aguanta --ninguna funcion toma dos ACTIVOS sobre la misma reserva,
/// que es la forma del bug de Comet-- pero el metodo estaba incompleto y estos
/// casos no tenian test. Se cierran aca.
#[test]
fn aliasing_liquidate_con_deudor_igual_al_activo_revierte() {
    let h = setup();
    posicion_insana_pero_solvente(&h);
    let keeper = liquidador_financiado(&h);
    // user == collateral_asset: el "activo" no esta en la allowlist, asi que
    // la operacion muere antes de tocar contabilidad alguna.
    let r = h.ctrl.try_liquidate(&keeper, &h.xlm_id, &h.xlm_id, &units(1));
    assert!(r.is_err(), "user == collateral_asset deberia revertir");
}

#[test]
fn aliasing_liquidate_con_liquidador_igual_al_activo_revierte() {
    let h = setup();
    posicion_insana_pero_solvente(&h);
    // liquidator == collateral_asset: el contrato del token tendria que
    // autorizar la transferencia que lo financia, y no lo hace.
    let r = h.ctrl.try_liquidate(&h.xlm_id, &h.borrower, &h.xlm_id, &units(1));
    assert!(r.is_err(), "liquidator == collateral_asset deberia revertir");
}

/// `withdraw_collateral(user, asset)` con los dos iguales, el hermano del caso
/// que ya estaba cubierto para `deposit_collateral`.
#[test]
fn aliasing_withdraw_con_user_igual_a_asset_revierte() {
    let h = setup();
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(100));
    let r = h.ctrl.try_withdraw_collateral(&h.borrower, &h.borrower, &units(1));
    assert!(r.is_err(), "user == asset deberia revertir por allowlist");
    // Y la contabilidad del deposito real sigue intacta.
    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), units(100));
}

// =============================================================================
// N-02 — EL CORTE DEL PROTOCOLO TIENE RUTA DE SALIDA
// =============================================================================

/// El test que cierra N-02: lo incautado sale del pool y llega a la tesoreria.
///
/// Antes esto era imposible de escribir. `liquidate` anota bajo el activo de
/// COLATERAL y `settle_seized` solo acepta el de DEUDA, asi que con XLM de
/// colateral y USDC de deuda `Seized(XLM)` era una clave de solo escritura.
#[test]
fn n02_sweep_saca_el_corte_del_protocolo_a_la_tesoreria() {
    let h = setup();
    posicion_insana_pero_solvente(&h);
    let keeper = liquidador_financiado(&h);
    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(10));

    let incautado = h.ctrl.get_seized(&h.xlm_id);
    assert!(incautado > 0, "la liquidacion no dejo corte para el protocolo");
    assert_eq!(h.ctrl.get_sweepable(&h.xlm_id), incautado,
               "el XLM no es el activo de deuda: todo deberia ser barrible");

    let antes = h.xlm.balance(&h.treasury);
    h.ctrl.sweep_seized(&h.xlm_id);

    assert_eq!(h.xlm.balance(&h.treasury) - antes, incautado,
               "la tesoreria no recibio exactamente lo incautado");
    assert_eq!(h.ctrl.get_seized(&h.xlm_id), 0);
    assert_eq!(h.ctrl.get_sweepable(&h.xlm_id), 0);
}

/// INVARIANTE: nunca existe saldo en `Seized(asset)` sin ruta de salida para
/// ese activo. Se comprueba sobre TODOS los activos de colateral listados, no
/// solo sobre el del fixture -- que es la forma del hallazgo original.
#[test]
fn n02_invariante_todo_activo_incautado_tiene_ruta_de_salida() {
    let h = setup();
    h.ctrl.add_collateral_asset(
        &h.usdc_id,
        &Asset::Stellar(h.usdc_id.clone()),
        &0_i128,
        &USER_CAP,
    );
    posicion_insana_pero_solvente(&h);
    let keeper = liquidador_financiado(&h);
    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(10));

    for asset in h.ctrl.get_collateral_assets().iter() {
        let incautado = h.ctrl.get_seized(&asset);
        if incautado == 0 {
            continue;
        }
        let barrible = h.ctrl.get_sweepable(&asset);
        assert!(
            barrible > 0 || asset == h.usdc_id,
            "hay saldo incautado sin ruta de salida"
        );
        if barrible > 0 {
            h.ctrl.sweep_seized(&asset);
            assert_eq!(h.ctrl.get_seized(&asset), incautado - barrible);
        }
    }
}

/// INVARIANTE: lo incautado = lo transferido a la tesoreria + lo que queda
/// pendiente, por activo. La contabilidad cuadra al entero, sin fugas.
#[test]
fn n02_invariante_lo_incautado_cuadra_con_lo_barrido_mas_lo_que_queda() {
    let h = setup();
    posicion_insana_pero_solvente(&h);
    let keeper = liquidador_financiado(&h);
    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(10));

    let incautado_inicial = h.ctrl.get_seized(&h.xlm_id);
    let tesoreria_antes = h.xlm.balance(&h.treasury);
    h.ctrl.sweep_seized(&h.xlm_id);

    let a_tesoreria = h.xlm.balance(&h.treasury) - tesoreria_antes;
    let queda = h.ctrl.get_seized(&h.xlm_id);
    assert_eq!(incautado_inicial, a_tesoreria + queda,
               "incautado != barrido + remanente");
}

/// En el activo de DEUDA, lo que `PendingSettlement` reclama no se puede
/// barrer: es deuda incobrable que hay que repagarle al pool, y va antes que
/// el corte del protocolo. Cobrarnos primero seria quedarnos con una perdida
/// ajena.
#[test]
fn n02_en_el_activo_de_deuda_lo_pendiente_tiene_prioridad() {
    let h = setup();
    h.ctrl.add_collateral_asset(
        &h.usdc_id,
        &Asset::Stellar(h.usdc_id.clone()),
        &0_i128,
        &USER_CAP,
    );
    MockUsdcClient::new(&h.env, &h.usdc_id).mint(&h.borrower, &units(1_000));

    // Insolvencia: el XLM se desploma y el USDC incautado queda pendiente.
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    h.ctrl.deposit_collateral(&h.borrower, &h.usdc_id, &units(100));
    mint_badge(&h, &h.borrower, 850, 41);
    h.ctrl.borrow(&h.borrower, &units(200));
    h.price_oracle.set_price(
        &Asset::Stellar(h.xlm_id.clone()),
        &(P_XLM * 10 / 100),
        &INITIAL_TIMESTAMP,
    );
    let keeper = liquidador_financiado(&h);
    h.ctrl.liquidate(&keeper, &h.borrower, &h.usdc_id, &units(1));

    let incautado = h.ctrl.get_seized(&h.usdc_id);
    let pendiente = h.ctrl.get_pending_settlement();
    assert!(incautado > 0 && pendiente > 0, "el escenario no produjo las dos cosas");

    // Lo barrible excluye la reserva.
    let reservado = if incautado < pendiente { incautado } else { pendiente };
    assert_eq!(h.ctrl.get_sweepable(&h.usdc_id), incautado - reservado);

    // Si todo esta reservado, barrer revierte TIPADO aunque `get_seized` sea
    // positivo. Es la distincion que `NothingToSweep` existe para hacer.
    if incautado <= pendiente {
        let err = h.ctrl.try_sweep_seized(&h.usdc_id).err().unwrap().unwrap();
        assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::NothingToSweep as u32));
    }
}

/// `sweep_seized` sin nada incautado revierte TIPADO, no con un panic opaco.
#[test]
fn n02_sweep_sin_nada_incautado_revierte_tipado() {
    let h = setup();
    assert_eq!(h.ctrl.get_seized(&h.xlm_id), 0);
    let err = h.ctrl.try_sweep_seized(&h.xlm_id).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::NothingToSweep as u32));
}

/// `init` rechaza una tesoreria igual al propio contrato: barrer hacia uno
/// mismo deja los fondos igual de atrapados, que es justo el bug que N-02
/// describe. Se rechaza al desplegar porque despues la direccion es inmutable.
#[test]
fn n02_init_rechaza_tesoreria_igual_al_contrato() {
    let h = setup();
    let ctrl_id = h.env.register_contract(None, MarginController);
    let ctrl = MarginControllerClient::new(&h.env, &ctrl_id);
    let err = ctrl
        .try_init(&InitConfig {
            admin: h.admin.clone(),
            oracle: h.price_oracle.address.clone(),
            reputation_registry: h.badge.address.clone(),
            blend_pool: h.pool_id.clone(),
            borrow_asset: h.usdc_id.clone(),
            borrow_feed: Asset::Stellar(h.usdc_id.clone()),
            collateral_asset: h.xlm_id.clone(),
            collateral_feed: Asset::Stellar(h.xlm_id.clone()),
            collateral_cap: 0,
            tier_ltv: default_tiers(&h.env),
            max_price_age: MAX_PRICE_AGE,
            min_ltv_floor: MIN_LTV_FLOOR,
            param_grace_secs: GRACE_SECS,
            user_cap: USER_CAP,
            treasury: ctrl_id.clone(),
        })
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::TreasuryRequired as u32));
}

/// La tesoreria se lee por la ABI y es la que `init` recibio. Sin setter: no
/// hay forma de que el admin la redirija, y eso es lo que hace que
/// `sweep_seized` no sea un poder de mover fondos ajenos.
#[test]
fn n02_la_tesoreria_es_inmutable_y_se_lee_por_la_abi() {
    let h = setup();
    assert_eq!(h.ctrl.get_treasury(), h.treasury);
    assert_eq!(h.ctrl.get_config().treasury, h.treasury);
}

// =============================================================================
// M-03 — LIQUIDACION PROPORCIONAL (Modelo A) Y RUTA DE SALIDA
// =============================================================================

/// Deja al deudor insano pero SOLVENTE: colateral por encima de la deuda, salud
/// bajo 100. Es la unica situacion donde corre la ruta parcial.
fn posicion_insana_pero_solvente(h: &Harness) -> i128 {
    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000));
    mint_badge(h, &h.borrower, 850, 90);
    h.ctrl.borrow(&h.borrower, &units(100));
    // 55 % del precio: valor ~105.8 > deuda 100 (solvente), salud ~89 < 100.
    h.price_oracle.set_price(
        &Asset::Stellar(h.xlm_id.clone()),
        &(P_XLM * 55 / 100),
        &INITIAL_TIMESTAMP,
    );
    assert!(h.ctrl.health(&h.borrower) < 100, "debe quedar insana");
    units(100)
}

fn liquidador_financiado(h: &Harness) -> Address {
    let k = Address::generate(&h.env);
    MockUsdcClient::new(&h.env, &h.usdc_id).mint(&k, &units(10_000));
    k
}

#[test]
fn m03_liquidacion_parcial_no_incauta_todo() {
    let h = setup();
    posicion_insana_pero_solvente(&h);
    let keeper = liquidador_financiado(&h);

    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(20));

    // Deuda baja exactamente lo repagado, no a cero.
    assert_eq!(h.ctrl.get_debt(&h.borrower), units(80));
    // Y queda excedente: esto es lo que M-03 pedia.
    let resto = h.ctrl.get_collateral(&h.borrower, &h.xlm_id);
    assert!(resto > units(700), "el excedente debe seguir siendo del deudor, hay {resto}");
    // El liquidador cobro colateral con descuento, en su propia wallet.
    assert!(h.xlm.balance(&keeper) > 0, "el liquidador recibe colateral");
    // Y el protocolo se quedo con su parte de la penalidad.
    assert!(h.ctrl.get_seized(&h.xlm_id) > 0, "el corte del protocolo va a Seized");
}

#[test]
fn m03_el_excedente_es_retirable_por_el_deudor() {
    // INVARIANTE CENTRAL DE M-03. Tras una liquidacion parcial el deudor no
    // queda expropiado: repaga lo que resta y recupera TODO su excedente.
    let h = setup();
    posicion_insana_pero_solvente(&h);
    let keeper = liquidador_financiado(&h);
    let antes = h.ctrl.get_collateral(&h.borrower, &h.xlm_id);

    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(20));
    let excedente = h.ctrl.get_collateral(&h.borrower, &h.xlm_id);
    assert!(excedente > 0 && excedente < antes);

    // El deudor cancela el resto y retira su excedente completo.
    h.ctrl.repay(&h.borrower, &units(80));
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);
    h.ctrl.withdraw_collateral(&h.borrower, &h.xlm_id, &excedente);
    assert_eq!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id), 0);
}

#[test]
fn m03_liquidaciones_sucesivas_hasta_recuperar_salud() {
    // Un solo close factor no siempre restaura la salud.
    let h = setup();
    posicion_insana_pero_solvente(&h);
    let keeper = liquidador_financiado(&h);

    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(20));
    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(20));
    assert_eq!(h.ctrl.get_debt(&h.borrower), units(60));
    assert!(h.ctrl.get_collateral(&h.borrower, &h.xlm_id) > 0);
}

#[test]
fn m03_close_factor_limita_una_sola_liquidacion() {
    let h = setup();
    posicion_insana_pero_solvente(&h);
    let keeper = liquidador_financiado(&h);

    // 50 % de 100 = 50. Un stroop mas debe rebotar.
    let err = h
        .ctrl
        .try_liquidate(&keeper, &h.borrower, &h.xlm_id, &(units(50) + 1))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::RepayExceedsCloseFactor as u32)
    );
    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(50));
}

#[test]
fn m03_settle_seized_rechaza_un_activo_que_no_es_el_de_deuda() {
    // El colateral incautado que NO es el activo de deuda necesita un swap, y
    // este contrato no tiene ninguno. Revierte diciendolo, en vez de fingir.
    let h = setup();
    let err = h.ctrl.try_settle_seized(&h.xlm_id).err().unwrap().unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::SettleAssetNotDebtAsset as u32)
    );
}

#[test]
fn m03_settle_seized_sin_nada_pendiente_revierte() {
    let h = setup();
    let err = h.ctrl.try_settle_seized(&h.usdc_id).err().unwrap().unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::NothingToSettle as u32)
    );
}

#[test]
fn m03_settle_seized_repaga_contra_el_pool() {
    // Ruta de salida completa: insolvencia -> Seized + PendingSettlement ->
    // settle_seized los reduce repagando al pool. Sin parametro de destino.
    //
    // Ojo con el diseno del escenario: el activo de deuda se lista TAMBIEN como
    // colateral, pero su precio no sirve para provocar la insolvencia, porque
    // aparece en el numerador y el denominador del ratio y se cancela. La
    // insolvencia se provoca con el XLM; el USDC incautado es lo que despues
    // permite ejercitar el unico caso implementado (asset == borrow_asset).
    let h = setup();
    h.ctrl
        .add_collateral_asset(&h.usdc_id, &Asset::Stellar(h.usdc_id.clone()), &0_i128, &USER_CAP);
    MockUsdcClient::new(&h.env, &h.usdc_id).mint(&h.borrower, &units(1_000));

    h.ctrl.deposit_collateral(&h.borrower, &h.xlm_id, &units(1_000)); // ~192
    h.ctrl.deposit_collateral(&h.borrower, &h.usdc_id, &units(100)); // 100
    mint_badge(&h, &h.borrower, 850, 91);
    h.ctrl.borrow(&h.borrower, &units(200));

    // El XLM se desploma: 19 + 100 = 119 < 200 -> insolvente.
    h.price_oracle.set_price(
        &Asset::Stellar(h.xlm_id.clone()),
        &(P_XLM * 10 / 100),
        &INITIAL_TIMESTAMP,
    );
    let keeper = liquidador_financiado(&h);
    h.ctrl.liquidate(&keeper, &h.borrower, &h.xlm_id, &units(1));

    let seized_usdc = h.ctrl.get_seized(&h.usdc_id);
    let pending = h.ctrl.get_pending_settlement();
    assert_eq!(seized_usdc, units(100), "la insolvencia incauta ambos colaterales");
    assert_eq!(pending, units(200), "la deuda entera pasa a settlement");
    assert!(h.ctrl.get_bad_debt() > 0, "el faltante queda registrado, no descartado");
    assert_eq!(h.ctrl.get_debt(&h.borrower), 0);

    // La ruta restringida: reduce ambos buckets repagando al pool.
    h.ctrl.settle_seized(&h.usdc_id);
    assert_eq!(h.ctrl.get_seized(&h.usdc_id), 0);
    assert_eq!(h.ctrl.get_pending_settlement(), pending - seized_usdc);

    // Y no queda nada mas que liquidar por esa via.
    let err = h.ctrl.try_settle_seized(&h.usdc_id).err().unwrap().unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::NothingToSettle as u32)
    );
}

#[test]
fn m03_fuzz_la_liquidacion_nunca_incauta_mas_de_lo_que_hay() {
    // Invariante: seize <= colateral disponible, el excedente nunca es negativo
    // y la deuda nunca crece. Precios y montos aleatorios.
    let h = setup();
    h.env.budget().reset_unlimited();
    let mut rng = StdRng::seed_from_u64(7);
    let xlm_admin = MockUsdcClient::new(&h.env, &h.xlm_id);
    let usdc_admin = MockUsdcClient::new(&h.env, &h.usdc_id);

    for i in 0..25_u32 {
        let user = Address::generate(&h.env);
        let keeper = Address::generate(&h.env);
        let colateral: i128 = units(rng.gen_range(500..=3_000));
        xlm_admin.mint(&user, &colateral);
        usdc_admin.mint(&keeper, &units(100_000));

        h.price_oracle
            .set_price(&Asset::Stellar(h.xlm_id.clone()), &P_XLM, &INITIAL_TIMESTAMP);
        h.ctrl.deposit_collateral(&user, &h.xlm_id, &colateral);
        mint_badge(&h, &user, 850, 2_000 + i);

        let max = h.ctrl.max_borrow(&user);
        if max <= units(10) {
            continue;
        }
        let deuda = max / 2;
        h.ctrl.borrow(&user, &deuda);

        // Caida aleatoria que deja la posicion insana.
        let factor: i128 = rng.gen_range(30..=60);
        h.price_oracle.set_price(
            &Asset::Stellar(h.xlm_id.clone()),
            &(P_XLM * factor / 100),
            &INITIAL_TIMESTAMP,
        );
        if h.ctrl.health(&user) >= 100 {
            continue;
        }

        let repay = deuda / 4;
        let antes = h.ctrl.get_collateral(&user, &h.xlm_id);
        let _ = h.ctrl.try_liquidate(&keeper, &user, &h.xlm_id, &repay);

        let despues = h.ctrl.get_collateral(&user, &h.xlm_id);
        assert!(despues >= 0, "iter {i}: el excedente no puede ser negativo");
        assert!(despues <= antes, "iter {i}: la liquidacion no puede aumentar colateral");
        assert!(
            h.ctrl.get_debt(&user) <= deuda,
            "iter {i}: la deuda nunca crece al liquidar"
        );
    }
}
