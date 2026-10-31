#![cfg(test)]
//! =============================================================================
//! ORACLE AGGREGATOR — tests
//! =============================================================================
//!
//! El bloque que importa es § INVARIANTE DE RUTAS: es el DoD que condiciona el
//! despliegue. El slot `PoolConfig.oracle` de Blend es inmutable, así que si el
//! ruteo fuera manipulable no habría segunda oportunidad para arreglarlo.
//! =============================================================================

extern crate std;

use crate::{
    Asset, Error, OracleAggregator, OracleAggregatorClient, PriceData, Route,
    MAX_DEVIATION_CEILING_BPS, AccrualConfig, FxLeg, MAX_RATE_BPS, VaultNav,
};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, Symbol,
};

// =============================================================================
// UPSTREAM SIMULADO (solo test — nunca se despliega)
// =============================================================================

#[derive(Clone)]
#[contracttype]
pub enum UpKey {
    Price(Asset),
    Decimals,
}

#[contract]
pub struct MockUpstream;

#[contractimpl]
impl MockUpstream {
    pub fn set_decimals(env: Env, d: u32) {
        env.storage().instance().set(&UpKey::Decimals, &d);
    }
    pub fn set_price(env: Env, asset: Asset, price: i128, timestamp: u64) {
        env.storage()
            .persistent()
            .set(&UpKey::Price(asset), &PriceData { price, timestamp });
    }
    pub fn clear_price(env: Env, asset: Asset) {
        env.storage().persistent().remove(&UpKey::Price(asset));
    }
    pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
        env.storage().persistent().get(&UpKey::Price(asset))
    }
    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&UpKey::Decimals).unwrap_or(14)
    }
}

// =============================================================================
// HARNESS
// =============================================================================

const T0: u64 = 1_700_000_000;
const GRACE: u64 = 172_800; // 48 h, igual que en producción
const OUT_DECIMALS: u32 = 14;
const MAX_AGE: u64 = 900;
/// 10 %. NO coincide con produccion, y no puede: las dos rutas vivas usan
/// valores distintos --XLM 2.000 bps (20 %) y USDC 500 bps (5 %), leidos de
/// `CCG6EAGO…` el 2026-10-21-- y el fixture tiene un solo knob.
///
/// Los dos tests de desviacion que ya existian usan +58 % y +5 %, que caen
/// fuera y dentro de los tres valores, asi que sus conclusiones transfieren.
/// Lo que NO estaba cubierto es la banda entre 10 % y 20 %, donde produccion
/// ACEPTA y este fixture rechazaria: eso lo prueba
/// `banda_de_desviacion_de_la_ruta_viva_de_xlm`.
const DEV_BPS: u32 = 1_000;

/// Los bps de la ruta XLM desplegada. Es la guarda mas floja que corre hoy.
const DEV_BPS_XLM_PRODUCCION: u32 = 2_000; // 20%

struct H<'a> {
    env: Env,
    admin: Address,
    agg: OracleAggregatorClient<'a>,
    up: MockUpstreamClient<'a>,
    up_id: Address,
    xlm: Asset,
}

fn advance(env: &Env, secs: u64) {
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

fn setup() -> H<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(LedgerInfo {
        timestamp: T0,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 12_614_400,
    });

    let admin = Address::generate(&env);
    let up_id = env.register_contract(None, MockUpstream);
    let up = MockUpstreamClient::new(&env, &up_id);
    up.set_decimals(&OUT_DECIMALS);

    let agg_id = env.register_contract(None, OracleAggregator);
    let agg = OracleAggregatorClient::new(&env, &agg_id);
    agg.init(&admin, &OUT_DECIMALS, &GRACE);

    // El pool siempre pregunta por Stellar(contract); el upstream cotiza por ticker.
    let xlm = Asset::Stellar(Address::generate(&env));
    let up_xlm = Asset::Other(Symbol::new(&env, "XLM"));
    agg.set_initial_route(
        &xlm,
        &Route {
            source: up_id.clone(),
            upstream_asset: up_xlm.clone(),
            max_age: MAX_AGE,
            max_deviation_bps: DEV_BPS,
        },
    );
    up.set_price(&up_xlm, &19_000_000_000_000, &T0); // $0.19

    H { env: env.clone(), admin, agg, up, up_id, xlm }
}

fn up_xlm(env: &Env) -> Asset {
    Asset::Other(Symbol::new(env, "XLM"))
}

// =============================================================================
// § INVARIANTE DE RUTAS  (DoD — bloquea el despliegue si algo de esto falla)
// =============================================================================

#[test]
fn invariante_ruta_existente_no_se_re_rutea_instantaneamente_ni_por_el_admin() {
    let h = setup();
    let malicioso = Address::generate(&h.env);

    // El admin encola apuntar XLM a una fuente que controla.
    h.agg.queue_set_route(
        &h.xlm,
        &Route {
            source: malicioso.clone(),
            upstream_asset: up_xlm(&h.env),
            max_age: MAX_AGE,
            max_deviation_bps: DEV_BPS,
        },
    );

    // (a) La ruta activa NO cambió: sigue apuntando al upstream original.
    let vigente = h.agg.get_route(&h.xlm).unwrap();
    assert_eq!(vigente.source, h.up_id, "la ruta activa cambió sin grace period");

    // (b) El precio se sigue sirviendo desde la fuente original.
    assert!(h.agg.lastprice(&h.xlm).is_some());

    // (c) `apply_route` antes de tiempo falla.
    assert!(
        h.agg.try_apply_route(&h.xlm).is_err(),
        "apply_route no respetó el grace period"
    );

    // (d) No existe NINGUNA otra vía: el contrato solo expone set_initial_route
    //     (bloqueado si ya hay ruta) y queue/apply.
    assert!(
        h.agg
            .try_set_initial_route(
                &h.xlm,
                &Route {
                    source: malicioso,
                    upstream_asset: up_xlm(&h.env),
                    max_age: MAX_AGE,
                    max_deviation_bps: DEV_BPS,
                }
            )
            .is_err(),
        "set_initial_route permitió sobrescribir una ruta existente"
    );
}

#[test]
fn invariante_la_migracion_legitima_funciona_pasado_el_grace() {
    let h = setup();

    // Caso de uso real: migrar el bono a RedStone cuando publique el feed.
    let nuevo = h.env.register_contract(None, MockUpstream);
    let nuevo_c = MockUpstreamClient::new(&h.env, &nuevo);
    nuevo_c.set_decimals(&OUT_DECIMALS);
    nuevo_c.set_price(&up_xlm(&h.env), &20_000_000_000_000, &T0);

    h.agg.queue_set_route(
        &h.xlm,
        &Route {
            source: nuevo.clone(),
            upstream_asset: up_xlm(&h.env),
            max_age: MAX_AGE,
            max_deviation_bps: DEV_BPS,
        },
    );
    assert!(h.agg.get_pending_route(&h.xlm).is_some());

    advance(&h.env, GRACE + 1);
    let now = h.env.ledger().timestamp();
    nuevo_c.set_price(&up_xlm(&h.env), &20_000_000_000_000, &now);

    // Permissionless: no hace falta ser admin para aplicarla.
    h.agg.apply_route(&h.xlm);

    assert_eq!(h.agg.get_route(&h.xlm).unwrap().source, nuevo);
    assert!(h.agg.get_pending_route(&h.xlm).is_none());
    assert_eq!(h.agg.lastprice(&h.xlm).unwrap().price, 20_000_000_000_000);
}

#[test]
fn invariante_asset_nuevo_tambien_pasa_por_la_cola() {
    let h = setup();
    let usdc = Asset::Stellar(Address::generate(&h.env));
    let up_usdc = Asset::Other(Symbol::new(&h.env, "USDC"));
    h.up.set_price(&up_usdc, &100_000_000_000_000, &T0);

    h.agg.queue_set_route(
        &usdc,
        &Route {
            source: h.up_id.clone(),
            upstream_asset: up_usdc,
            max_age: MAX_AGE,
            max_deviation_bps: DEV_BPS,
        },
    );

    // Todavía no cotiza: no hay ruta activa.
    assert!(h.agg.get_route(&usdc).is_none());
    assert!(h.agg.lastprice(&usdc).is_none());
    assert!(h.agg.try_apply_route(&usdc).is_err());

    advance(&h.env, GRACE + 1);
    h.agg.apply_route(&usdc);
    assert!(h.agg.get_route(&usdc).is_some());
}

#[test]
fn apply_sin_pendiente_falla() {
    let h = setup();
    let err = h.agg.try_apply_route(&h.xlm).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::NoPendingRoute as u32));
}

// =============================================================================
// § GUARDAS DE PRECIO
// =============================================================================

#[test]
fn precio_viejo_revierte() {
    let h = setup();
    advance(&h.env, MAX_AGE + 1);
    let err = h.agg.try_lastprice(&h.xlm).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::UpstreamPriceStale as u32));
}

#[test]
fn upstream_sin_precio_revierte() {
    let h = setup();
    h.up.clear_price(&up_xlm(&h.env));
    let err = h.agg.try_lastprice(&h.xlm).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::UpstreamNoPrice as u32));
}

#[test]
fn precio_cero_revierte() {
    let h = setup();
    h.up.set_price(&up_xlm(&h.env), &0, &T0);
    let err = h.agg.try_lastprice(&h.xlm).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::UpstreamInvalidPrice as u32));
}

#[test]
fn salto_anomalo_revierte() {
    let h = setup();
    h.agg.lastprice(&h.xlm); // fija la referencia en $0.19
    // +58% de golpe, muy por encima del 10% permitido.
    h.up.set_price(&up_xlm(&h.env), &30_000_000_000_000, &T0);
    let err = h.agg.try_lastprice(&h.xlm).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::DeviationAboveLimit as u32));
}

#[test]
fn movimiento_dentro_de_la_banda_se_acepta() {
    let h = setup();
    h.agg.lastprice(&h.xlm);
    // +5%: dentro del 10%.
    h.up.set_price(&up_xlm(&h.env), &19_950_000_000_000, &T0);
    assert_eq!(h.agg.lastprice(&h.xlm).unwrap().price, 19_950_000_000_000);
}

#[test]
fn tras_migrar_de_fuente_no_se_arrastra_la_referencia_de_desviacion() {
    // Una fuente nueva puede cotizar en otra base; si conserváramos la
    // referencia anterior, la primera lectura post-migración se rechazaría.
    let h = setup();
    h.agg.lastprice(&h.xlm);

    let nuevo = h.env.register_contract(None, MockUpstream);
    let nuevo_c = MockUpstreamClient::new(&h.env, &nuevo);
    nuevo_c.set_decimals(&OUT_DECIMALS);

    h.agg.queue_set_route(
        &h.xlm,
        &Route {
            source: nuevo.clone(),
            upstream_asset: up_xlm(&h.env),
            max_age: MAX_AGE,
            max_deviation_bps: DEV_BPS,
        },
    );
    advance(&h.env, GRACE + 1);
    h.agg.apply_route(&h.xlm);

    let now = h.env.ledger().timestamp();
    nuevo_c.set_price(&up_xlm(&h.env), &40_000_000_000_000, &now); // +110%
    assert_eq!(h.agg.lastprice(&h.xlm).unwrap().price, 40_000_000_000_000);
}

// =============================================================================
// § NORMALIZACIÓN DE DECIMALES
// =============================================================================

#[test]
fn escala_hacia_arriba_desde_un_upstream_de_menos_decimales() {
    let h = setup();
    h.up.set_decimals(&7);
    h.up.set_price(&up_xlm(&h.env), &1_900_000, &T0); // $0.19 con 7 decimales
    // 1_900_000 * 10^(14-7) = 19_000_000_000_000
    assert_eq!(h.agg.lastprice(&h.xlm).unwrap().price, 19_000_000_000_000);
}

#[test]
fn escala_hacia_abajo_desde_un_upstream_de_mas_decimales() {
    let h = setup();
    h.up.set_decimals(&18);
    h.up.set_price(&up_xlm(&h.env), &190_000_000_000_000_000, &T0);
    // /10^(18-14) = 19_000_000_000_000
    assert_eq!(h.agg.lastprice(&h.xlm).unwrap().price, 19_000_000_000_000);
}

#[test]
fn un_precio_que_se_redondearia_a_cero_revierte() {
    // Servir 0 haría que el pool tratara el colateral como sin valor.
    let h = setup();
    h.up.set_decimals(&18);
    h.up.set_price(&up_xlm(&h.env), &1, &T0);
    let err = h.agg.try_lastprice(&h.xlm).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::PriceUnderflow as u32));
}

// =============================================================================
// § VALIDACIÓN E IDENTIDAD
// =============================================================================

#[test]
fn desviacion_por_encima_del_techo_se_rechaza() {
    let h = setup();
    let otro = Asset::Stellar(Address::generate(&h.env));
    let err = h
        .agg
        .try_set_initial_route(
            &otro,
            &Route {
                source: h.up_id.clone(),
                upstream_asset: up_xlm(&h.env),
                max_age: MAX_AGE,
                max_deviation_bps: MAX_DEVIATION_CEILING_BPS + 1,
            },
        )
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::DeviationAboveCeiling as u32));
}

#[test]
fn max_age_cero_se_rechaza() {
    let h = setup();
    let otro = Asset::Stellar(Address::generate(&h.env));
    let err = h
        .agg
        .try_set_initial_route(
            &otro,
            &Route {
                source: h.up_id.clone(),
                upstream_asset: up_xlm(&h.env),
                max_age: 0,
                max_deviation_bps: DEV_BPS,
            },
        )
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::MaxAgeRequired as u32));
}

#[test]
fn asset_sin_ruta_devuelve_none_en_vez_de_entrar_en_panico() {
    // Blend distingue "no cotizo este activo" de "el precio es inválido".
    let h = setup();
    let desconocido = Asset::Stellar(Address::generate(&h.env));
    assert!(h.agg.lastprice(&desconocido).is_none());
}

#[test]
fn superficie_sep40_y_enumeracion() {
    let h = setup();
    assert_eq!(h.agg.decimals(), OUT_DECIMALS);
    assert_eq!(h.agg.get_route_grace(), GRACE);
    assert_eq!(h.agg.assets().len(), 1);
    assert_eq!(h.agg.get_admin(), h.admin);
}

#[test]
fn rotacion_de_admin_en_dos_pasos() {
    let h = setup();
    let nuevo = Address::generate(&h.env);
    h.agg.propose_admin(&nuevo);
    assert_eq!(h.agg.get_admin(), h.admin, "cambió sin que el propuesto aceptara");
    h.agg.accept_admin();
    assert_eq!(h.agg.get_admin(), nuevo);
    assert!(h.agg.try_accept_admin().is_err());
}

#[test]
fn no_se_puede_re_inicializar() {
    let h = setup();
    let err = h.agg.try_init(&h.admin, &OUT_DECIMALS, &GRACE).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::AlreadyInitialized as u32));
}


// =============================================================================
// ACTIVOS QUE SE DEVENGAN  (Bloque C)
// =============================================================================

/// NAV de CETES medido el 2026-10-22 en el REST de Etherfuse:
/// `token_cost_in_fiat = 1.187337` MXN, a 14 decimales.
const NAV_CETES: i128 = 118_733_700_000_000;
/// `current_basis_points = 555` -> 5,55 % anual.
const RATE_CETES: u32 = 555;
/// FX medido en el Fiat FX de Reflector: 0,05340442685235 USD/MXN.
const FX_MXN: i128 = 5_340_442_685_235;
/// NAV de USTRY, que ya esta en dolares: 1,077848.
const NAV_USTRY: i128 = 107_784_800_000_000;

fn cfg_base(nav: i128, rate: u32, fx: FxLeg, at: u64) -> AccrualConfig {
    AccrualConfig {
        nav_anchor: nav,
        anchor_at: at,
        rate_bps: rate,
        fx_leg: fx,
        max_reanchor_bps: 100,       // 1 %
        min_reanchor_secs: 86_400,   // un dia
    }
}

/// El caso de los instrumentos en DOLARES: `fx_asset: None`, el mismo codigo
/// que precia CETES precia USTRY sin tocar nada.
///
/// Es la prueba de que el contrato no sabe que es CETES.
#[test]
fn devengo_sin_fx_precia_un_bono_ya_en_dolares() {
    let h = setup();
    let ustry = Asset::Stellar(Address::generate(&h.env));
    h.agg
        .set_initial_accrual(&ustry, &cfg_base(NAV_USTRY, 346, FxLeg::AlreadyInOutputCurrency, T0));

    // En el ancla, el precio es el NAV.
    assert_eq!(h.agg.lastprice(&ustry).unwrap().price, NAV_USTRY);

    // A 360 dias, sube exactamente la tasa: 3,46 %.
    advance(&h.env, 360 * 86_400);
    let esperado = NAV_USTRY + NAV_USTRY * 346 / 10_000;
    assert_eq!(h.agg.lastprice(&ustry).unwrap().price, esperado);
}

/// El caso de CETES: NAV en MXN compuesto con el FX de Reflector.
///
/// La pata volatil -- el FX -- viene de un tercero independiente del emisor del
/// bono. Eso es el punto del diseno, no un detalle.
#[test]
fn devengo_con_fx_compone_nav_por_tipo_de_cambio() {
    let h = setup();
    let mxn = Asset::Other(Symbol::new(&h.env, "MXN"));
    // El FX se resuelve por una ruta NORMAL, con sus propias guardas.
    h.agg.set_initial_route(
        &mxn,
        &Route {
            source: h.up_id.clone(),
            upstream_asset: mxn.clone(),
            max_age: MAX_AGE,
            max_deviation_bps: DEV_BPS,
        },
    );
    h.up.set_price(&mxn, &FX_MXN, &T0);

    let cetes = Asset::Stellar(Address::generate(&h.env));
    h.agg
        .set_initial_accrual(&cetes, &cfg_base(NAV_CETES, RATE_CETES, FxLeg::Via(mxn.clone()), T0));

    // 1,187337 MXN x 0,05340442685235 = 0,063409... USD
    let escala: i128 = 100_000_000_000_000; // 1e14
    let esperado = NAV_CETES * FX_MXN / escala;
    assert_eq!(h.agg.lastprice(&cetes).unwrap().price, esperado);

    // Y el orden de magnitud es el correcto: ~0,0634 USD a 14 decimales.
    assert!(esperado > 6_300_000_000_000 && esperado < 6_400_000_000_000);
}

/// INVARIANTE: el NAV es monotono no decreciente. Un bono corto devenga; no se
/// desploma. Que un NAV que baja no sea representable es la propiedad buscada.
#[test]
fn invariante_el_nav_nunca_baja() {
    let h = setup();
    let bono = Asset::Stellar(Address::generate(&h.env));
    h.agg
        .set_initial_accrual(&bono, &cfg_base(NAV_CETES, RATE_CETES, FxLeg::AlreadyInOutputCurrency, T0));

    let mut previo = h.agg.get_nav_now(&bono);
    for _ in 0..12 {
        advance(&h.env, 30 * 86_400);
        let actual = h.agg.get_nav_now(&bono);
        assert!(actual >= previo, "el NAV bajo: {} -> {}", previo, actual);
        previo = actual;
    }
    // Y a un ano, subio la tasa completa.
    assert!(previo > NAV_CETES);
}

/// La cota diaria, medida: con 555 bps el NAV no puede subir mas de
/// 0,015417 % por dia. Es lo que hace que la banda del re-ancla sea chica.
#[test]
fn el_incremento_diario_esta_acotado_por_la_tasa() {
    let h = setup();
    let bono = Asset::Stellar(Address::generate(&h.env));
    h.agg
        .set_initial_accrual(&bono, &cfg_base(NAV_CETES, RATE_CETES, FxLeg::AlreadyInOutputCurrency, T0));
    let antes = h.agg.get_nav_now(&bono);
    advance(&h.env, 86_400);
    let despues = h.agg.get_nav_now(&bono);

    let subida_bps = (despues - antes) * 1_000_000 / antes; // en millonesimas
    // 555/360 = 1,5417 bps diarios = 154,17 millonesimas de 1 %.
    assert!(subida_bps <= 160, "subio {} millonesimas en un dia", subida_bps);
}

/// Un activo tiene una ruta O un devengo, nunca las dos: dos caminos de precio
/// para el mismo activo no tienen por que coincidir.
#[test]
fn un_activo_no_puede_tener_ruta_y_devengo() {
    let h = setup();
    // El XLM del fixture ya tiene ruta.
    let err = h
        .agg
        .try_set_initial_accrual(&h.xlm, &cfg_base(NAV_CETES, RATE_CETES, FxLeg::AlreadyInOutputCurrency, T0))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::AssetAlreadyPriced as u32));

    // Y al reves.
    let bono = Asset::Stellar(Address::generate(&h.env));
    h.agg
        .set_initial_accrual(&bono, &cfg_base(NAV_CETES, RATE_CETES, FxLeg::AlreadyInOutputCurrency, T0));
    let err2 = h
        .agg
        .try_set_initial_route(
            &bono,
            &Route {
                source: h.up_id.clone(),
                upstream_asset: up_xlm(&h.env),
                max_age: MAX_AGE,
                max_deviation_bps: DEV_BPS,
            },
        )
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err2, soroban_sdk::Error::from_contract_error(Error::AssetAlreadyPriced as u32));
}

// --- las cuatro guardas del re-ancla -----------------------------------------

/// Un re-ancla legitimo funciona: corrige la deriva dentro de la banda.
#[test]
fn reanchor_dentro_de_la_banda_se_acepta() {
    let h = setup();
    let bono = Asset::Stellar(Address::generate(&h.env));
    h.agg
        .set_initial_accrual(&bono, &cfg_base(NAV_CETES, RATE_CETES, FxLeg::AlreadyInOutputCurrency, T0));

    advance(&h.env, 30 * 86_400);
    let predicho = h.agg.get_nav_now(&bono);
    // +0,5 %, dentro del 1 % configurado.
    let nuevo = predicho + predicho * 50 / 10_000;
    h.agg.reanchor(&bono, &nuevo, &(T0 + 30 * 86_400), &RATE_CETES);
    assert_eq!(h.agg.get_accrual(&bono).unwrap().nav_anchor, nuevo);
}

/// Guarda 2: antes de `min_reanchor_secs` se rechaza. Sin esto, varios
/// re-anclas dentro de la banda escalarian el precio igual.
#[test]
fn reanchor_demasiado_pronto_revierte() {
    let h = setup();
    let bono = Asset::Stellar(Address::generate(&h.env));
    h.agg
        .set_initial_accrual(&bono, &cfg_base(NAV_CETES, RATE_CETES, FxLeg::AlreadyInOutputCurrency, T0));
    advance(&h.env, 3_600); // una hora, menos que el dia exigido
    let err = h
        .agg
        .try_reanchor(&bono, &NAV_CETES, &(T0 + 3_600), &RATE_CETES)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::ReanchorTooSoon as u32));
}

/// Guarda 3: un ancla que hace BAJAR el NAV se rechaza.
#[test]
fn reanchor_que_baja_el_nav_revierte() {
    let h = setup();
    let bono = Asset::Stellar(Address::generate(&h.env));
    h.agg
        .set_initial_accrual(&bono, &cfg_base(NAV_CETES, RATE_CETES, FxLeg::AlreadyInOutputCurrency, T0));
    advance(&h.env, 30 * 86_400);
    let err = h
        .agg
        .try_reanchor(&bono, &(NAV_CETES / 2), &(T0 + 30 * 86_400), &RATE_CETES)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::NavWouldDecrease as u32));
}

/// Guarda 4, **la que importa**: fuera de la banda se rechaza. Es lo que
/// convierte el poder del admin de "fijar el precio" en "corregir la deriva".
#[test]
fn reanchor_fuera_de_la_banda_revierte() {
    let h = setup();
    let bono = Asset::Stellar(Address::generate(&h.env));
    h.agg
        .set_initial_accrual(&bono, &cfg_base(NAV_CETES, RATE_CETES, FxLeg::AlreadyInOutputCurrency, T0));
    advance(&h.env, 30 * 86_400);
    let predicho = h.agg.get_nav_now(&bono);
    // +10 %, muy por encima del 1 % configurado.
    let err = h
        .agg
        .try_reanchor(&bono, &(predicho * 110 / 100), &(T0 + 30 * 86_400), &RATE_CETES)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::ReanchorOutOfBand as u32));
}

/// **El ataque que la revision de seguridad encontro sobre el commit a74b128.**
///
/// `anchor_at` lo elige el admin. Con un ancla en el FUTURO, `nav_at` devuelve
/// un NAV muy mayor, la banda se mide contra ese valor inflado, y despues
/// `nav_at(cfg, ahora)` con `ahora < anchor_at` devuelve `nav_anchor` directo:
/// el precio salta de inmediato al NAV futuro.
///
/// Las cuatro guardas se evadian con un parametro, y la de monotonia no ayudaba
/// porque el precio SUBE. Este test fija el arreglo.
#[test]
fn reanchor_con_ancla_en_el_futuro_revierte() {
    let h = setup();
    let bono = Asset::Stellar(Address::generate(&h.env));
    h.agg.set_initial_accrual(
        &bono,
        &cfg_base(NAV_CETES, RATE_CETES, FxLeg::AlreadyInOutputCurrency, T0),
    );
    advance(&h.env, 2 * 86_400);

    let ahora = h.env.ledger().timestamp();
    let diez_anos = 10 * 360 * 86_400;
    // Lo que la vieja config predice a diez anos: ~55,5 % mas.
    let inflado = NAV_CETES + NAV_CETES * (RATE_CETES as i128) * 3_600 / (360 * 10_000);
    assert!(inflado > NAV_CETES * 15 / 10, "el escenario no infla lo suficiente");

    let err = h
        .agg
        .try_reanchor(&bono, &inflado, &(ahora + diez_anos), &RATE_CETES)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::AnchorInFuture as u32));

    // Y el precio no se movio: sigue siendo el devengado honesto de dos dias.
    let honesto = NAV_CETES + NAV_CETES * (RATE_CETES as i128) * 2 / (360 * 10_000);
    assert_eq!(h.agg.get_nav_now(&bono), honesto);
}

/// Y el mismo agujero al configurar por primera vez: un ancla inicial en el
/// futuro dejaria el precio congelado en un NAV que no se devengo.
#[test]
fn set_initial_accrual_con_ancla_en_el_futuro_revierte() {
    let h = setup();
    let bono = Asset::Stellar(Address::generate(&h.env));
    let futuro = h.env.ledger().timestamp() + 86_400;
    let err = h
        .agg
        .try_set_initial_accrual(
            &bono,
            &cfg_base(NAV_CETES, RATE_CETES, FxLeg::AlreadyInOutputCurrency, futuro),
        )
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::AnchorInFuture as u32));
}

/// Una tasa absurda no es un bono: se rechaza al configurar.
#[test]
fn tasa_por_encima_del_techo_se_rechaza() {
    let h = setup();
    let bono = Asset::Stellar(Address::generate(&h.env));
    let err = h
        .agg
        .try_set_initial_accrual(&bono, &cfg_base(NAV_CETES, MAX_RATE_BPS + 1, FxLeg::AlreadyInOutputCurrency, T0))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::RateAboveCeiling as u32));
}

/// La pata de FX hereda las guardas de su ruta: si el FX esta rancio, el precio
/// del bono revierte en vez de servirse con un tipo de cambio viejo.
///
/// Importa porque el FX es la pata VOLATIL. Un NAV viejo se desvia despacio; un
/// FX viejo puede estar muy lejos.
#[test]
fn si_el_fx_esta_rancio_el_bono_no_se_precia() {
    let h = setup();
    let mxn = Asset::Other(Symbol::new(&h.env, "MXN"));
    h.agg.set_initial_route(
        &mxn,
        &Route {
            source: h.up_id.clone(),
            upstream_asset: mxn.clone(),
            max_age: MAX_AGE,
            max_deviation_bps: DEV_BPS,
        },
    );
    h.up.set_price(&mxn, &FX_MXN, &T0);

    let cetes = Asset::Stellar(Address::generate(&h.env));
    h.agg
        .set_initial_accrual(&cetes, &cfg_base(NAV_CETES, RATE_CETES, FxLeg::Via(mxn), T0));
    assert!(h.agg.lastprice(&cetes).is_some());

    // El FX envejece mas alla de su `max_age` y no se refresca.
    advance(&h.env, MAX_AGE + 60);
    let err = h.agg.try_lastprice(&cetes).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::UpstreamPriceStale as u32));
}

// =============================================================================
// § LA GUARDA QUE DE VERDAD CORRE  (barrido de fixtures, Fase 5)
// =============================================================================

/// Donde esta el borde en la ruta XLM **desplegada**, no en la del fixture.
///
/// Produccion corre `max_deviation_bps = 2000`; la suite corria todo a 1.000.
/// Un salto de +15 % --que este archivo habria dado por rechazado-- hoy se
/// ACEPTA en testnet. Este test fija el borde real en los dos sentidos para que
/// un cambio de la ruta viva rompa algo aca antes que en produccion.
#[test]
fn banda_de_desviacion_de_la_ruta_viva_de_xlm() {
    let h = setup();
    let xlm_prod = Asset::Stellar(Address::generate(&h.env));
    h.agg.set_initial_route(
        &xlm_prod,
        &Route {
            source: h.up_id.clone(),
            upstream_asset: up_xlm(&h.env),
            max_age: MAX_AGE,
            max_deviation_bps: DEV_BPS_XLM_PRODUCCION,
        },
    );

    // Fija la referencia en $0,19.
    assert_eq!(h.agg.lastprice(&xlm_prod).unwrap().price, 19_000_000_000_000);

    // +15 %: por encima del 10 % del fixture, por debajo del 20 % desplegado.
    // Con DEV_BPS esto revertiria. Con la ruta real, pasa.
    h.up.set_price(&up_xlm(&h.env), &21_850_000_000_000, &T0);
    assert_eq!(
        h.agg.lastprice(&xlm_prod).unwrap().price,
        21_850_000_000_000,
        "produccion acepta +15 % y la suite no lo estaba probando"
    );
}

/// El otro lado del mismo borde: pasado el 20 % la ruta viva SI revierte.
#[test]
fn pasado_el_veinte_por_ciento_la_ruta_viva_de_xlm_revierte() {
    let h = setup();
    let xlm_prod = Asset::Stellar(Address::generate(&h.env));
    h.agg.set_initial_route(
        &xlm_prod,
        &Route {
            source: h.up_id.clone(),
            upstream_asset: up_xlm(&h.env),
            max_age: MAX_AGE,
            max_deviation_bps: DEV_BPS_XLM_PRODUCCION,
        },
    );
    h.agg.lastprice(&xlm_prod);
    // +21 %.
    h.up.set_price(&up_xlm(&h.env), &22_990_000_000_000, &T0);
    let err = h.agg.try_lastprice(&xlm_prod).err().unwrap().unwrap();
    assert_eq!(err, soroban_sdk::Error::from_contract_error(Error::DeviationAboveLimit as u32));
}

// =============================================================================
// `LastGood` VIEJO — LA GUARDA DE DESVIACION NO TIENE BASE DE TIEMPO
// =============================================================================
//
// `check_deviation` compara contra `LastGood`, que guarda **solo el precio, sin
// marca de tiempo**. Asi que la guarda no puede distinguir una referencia de un
// minuto de una de un mes, y trata un movimiento legitimo acumulado en semanas
// igual que un salto instantaneo.
//
// Y `LastGood` **solo avanza en una lectura que no revierte**: una simulacion
// no persiste. Entonces una vez que la referencia queda vieja, cada lectura
// revierte, y al revertir no actualiza la referencia. Se cierra sobre si misma.

/// **Una referencia vieja bloquea el precio, y leer no lo destraba.**
///
/// El unico camino de salida es un cambio de ruta, que cuesta el grace period
/// completo. Durante esas 48 h el activo **no tiene precio**: no se puede
/// depositar, ni pedir, ni retirar con deuda, ni liquidar.
#[test]
fn lastgood_viejo_bloquea_el_precio_y_solo_sale_por_un_cambio_de_ruta() {
    let h = setup();

    // Una lectura confirmada fija la referencia.
    let p0 = h.agg.lastprice(&h.xlm).unwrap().price;

    // Un mes sin operaciones, y el upstream se movio 30 %. El precio nuevo es
    // LEGITIMO y esta FRESCO: el movimiento se acumulo en treinta dias.
    advance(&h.env, 30 * 86_400);
    let legitimo = p0 * 130 / 100;
    h.up
        .set_price(&up_xlm(&h.env), &legitimo, &h.env.ledger().timestamp());

    let err = h.agg.try_lastprice(&h.xlm).err().unwrap().unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::DeviationAboveLimit as u32)
    );

    // Y no se destraba leyendo: la referencia solo avanza si la lectura NO
    // revierte, asi que queda en bucle. Esto es el bloqueo, no un tropiezo.
    for _ in 0..3 {
        assert!(
            h.agg.try_lastprice(&h.xlm).is_err(),
            "la referencia se destrabo sola: este test documenta un \
             comportamiento que ya no existe"
        );
    }

    // La unica salida: encolar un cambio de ruta y esperar la gracia completa.
    h.agg.queue_set_route(
        &h.xlm,
        &Route {
            source: h.up_id.clone(),
            upstream_asset: up_xlm(&h.env),
            max_age: MAX_AGE,
            max_deviation_bps: DEV_BPS,
        },
    );

    // Encolar NO alcanza: durante la gracia el activo sigue sin precio.
    assert!(
        h.agg.try_lastprice(&h.xlm).is_err(),
        "encolar la ruta destrabo el precio antes de la gracia"
    );

    advance(&h.env, GRACE + 1);
    h.up
        .set_price(&up_xlm(&h.env), &legitimo, &h.env.ledger().timestamp());
    h.agg.apply_route(&h.xlm);

    // `apply_route` borra la referencia, y recien ahi vuelve el precio.
    assert_eq!(h.agg.lastprice(&h.xlm).unwrap().price, legitimo);
}

/// **El movimiento gradual NO se bloquea**, y es lo que hace que el defecto
/// anterior sea tolerable en un protocolo con actividad.
///
/// Importa medirlo: si la guarda rechazara tambien la deriva lenta, no seria
/// un riesgo de liveness condicionado a la inactividad — seria un bloqueo
/// garantizado, y la guarda habria que sacarla.
#[test]
fn lastgood_la_deriva_lenta_con_actividad_no_bloquea_nada() {
    let h = setup();
    let mut p = h.agg.lastprice(&h.xlm).unwrap().price;

    // Treinta subidas de 1 %: +34 % acumulado, mucho mas que el tope de la
    // guarda, y ninguna lectura revierte porque cada paso cabe.
    for _ in 0..30 {
        advance(&h.env, 86_400);
        p = p * 101 / 100;
        h.up.set_price(&up_xlm(&h.env), &p, &h.env.ledger().timestamp());
        assert_eq!(h.agg.lastprice(&h.xlm).unwrap().price, p);
    }
    assert!(p > 13_000_000_000_000 * 130 / 100 / 10, "el precio no se movio");
}

// =============================================================================
// WP-1 · MODO `VaultNav` — NAV ATESTIGUADO POR UN TERCERO
// =============================================================================
//
// La interfaz del mock espeja la del `nav_oracle` REAL de Strata, leida de su
// contrato en testnet (`CBKVMUMI…63CO`) el 2026-10-30:
//
//   nav_per_share() -> i128     1000000000000000000  = 1,0 a 18 decimales
//   attested_at()   -> u64      1792783222
//   is_stale()      -> bool     true     state() -> "Stale"
//   ensure_consumable()         revierte HOY con Error(Contract, #3007)
//   config() -> cooldown 60 · freshness 86400 · max_up_bps 1000 · max_down_bps null

#[derive(Clone)]
#[contracttype]
pub enum VKey {
    Nav,
    At,
    Consumible,
}

#[contract]
pub struct MockVaultOracle;

#[contractimpl]
impl MockVaultOracle {
    pub fn poner(env: Env, nav: i128, at: u64) {
        env.storage().instance().set(&VKey::Nav, &nav);
        env.storage().instance().set(&VKey::At, &at);
    }
    pub fn set_consumible(env: Env, ok: bool) {
        env.storage().instance().set(&VKey::Consumible, &ok);
    }
    pub fn nav_per_share(env: Env) -> i128 {
        env.storage().instance().get(&VKey::Nav).unwrap_or(0)
    }
    pub fn attested_at(env: Env) -> u64 {
        env.storage().instance().get(&VKey::At).unwrap_or(0)
    }
    pub fn ensure_consumable(env: Env) {
        let ok: bool = env.storage().instance().get(&VKey::Consumible).unwrap_or(true);
        if !ok {
            // Asi se ve desde afuera un Error(Contract, 3007) de Strata: una
            // reversion del tercero que nosotros tenemos que traducir.
            panic!("not consumable");
        }
    }
}

const NAV_UNO: i128 = 1_000_000_000_000_000_000; // 1,0 a 18 decimales
const PRECIO_UNO: i128 = 100_000_000_000_000; // 1,0 a 14 decimales

/// Monta el agregador con un share de vault listado contra un oraculo de NAV.
fn con_vault(
    max_age: u64,
    max_up_bps: u32,
) -> (H<'static>, MockVaultOracleClient<'static>, Asset) {
    let h = setup();
    let nav_id = h.env.register_contract(None, MockVaultOracle);
    let nav = MockVaultOracleClient::new(&h.env, &nav_id);
    nav.poner(&NAV_UNO, &T0);

    let share = Asset::Stellar(Address::generate(&h.env));
    h.agg.set_initial_vault_nav(
        &share,
        &VaultNav {
            oracle: nav_id.clone(),
            decimals_in: 18,
            max_age,
            max_up_bps,
        },
    );
    (h, nav, share)
}

/// **KPI-1.1 — el NAV se sirve reescalado, con desvio CERO.**
#[test]
fn vault_nav_sirve_el_nav_reescalado_con_desvio_cero() {
    let (h, _nav, share) = con_vault(900, 1_000);

    let pd = h.agg.lastprice(&share).unwrap();
    assert_eq!(pd.price, PRECIO_UNO, "el reescalado 18->14 no da 1,0");

    let bp = (pd.price - PRECIO_UNO).abs() * 10_000 / PRECIO_UNO;
    assert_eq!(bp, 0, "desvio {} bp, se exige 0,0000", bp);

    // El timestamp es el de la ATESTIGUACION, no el de ahora.
    assert_eq!(pd.timestamp, T0, "se reporto una edad que no es la real");
}

/// **KPI-1.2 — si el tercero dice que no es consumible, revertimos TIPADO.**
///
/// Es el caso que hoy da el contrato real de Strata. Lo traducimos a un codigo
/// propio: el consumidor es nuestro y no tiene por que leer codigos ajenos.
#[test]
fn vault_nav_no_consumible_revierte_tipado() {
    let (h, nav, share) = con_vault(900, 1_000);
    nav.set_consumible(&false);

    let err = h.agg.try_lastprice(&share).err().unwrap().unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::VaultNotConsumable as u32),
        "un panico del tercero tiene que salir como error tipado nuestro"
    );
}

/// **Nuestra frescura rige sobre la del tercero.**
///
/// El oraculo se declara consumible —su ventana es de 86.400 s— y el NAV igual
/// se rechaza porque pasa NUESTRO `max_age`.
#[test]
fn vault_nav_nuestra_frescura_rige_sobre_la_del_tercero() {
    let (h, nav, share) = con_vault(900, 1_000);

    nav.poner(&NAV_UNO, &(T0 - 3_600));
    nav.set_consumible(&true);

    let err = h.agg.try_lastprice(&share).err().unwrap().unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::VaultNavStale as u32)
    );

    nav.poner(&NAV_UNO, &(T0 - 800));
    assert!(h.agg.lastprice(&share).is_some());
}

/// **INVARIANTE A.1.3 #1 — ninguna caida del NAV puede ser censurada.**
///
/// Si el activo vale menos, el protocolo tiene que enterarse. Siempre.
#[test]
fn vault_nav_invariante_ninguna_caida_se_censura() {
    for pct in [99_i128, 90, 50, 20, 5, 1] {
        let (h, nav, share) = con_vault(900, 1_000);
        assert_eq!(h.agg.lastprice(&share).unwrap().price, PRECIO_UNO);

        nav.poner(&(NAV_UNO * pct / 100), &T0);
        let pd = h
            .agg
            .lastprice(&share)
            .unwrap_or_else(|| panic!("se censuro una caida al {} %", pct));
        assert_eq!(
            pd.price,
            PRECIO_UNO * pct / 100,
            "la caida al {} % no se sirvio tal cual",
            pct
        );
    }
}

/// La otra mitad de la asimetria: una SUBIDA mayor al tope se rechaza.
#[test]
fn vault_nav_una_subida_mayor_al_tope_revierte() {
    let (h, nav, share) = con_vault(900, 1_000); // 10 %
    assert_eq!(h.agg.lastprice(&share).unwrap().price, PRECIO_UNO);

    nav.poner(&(NAV_UNO * 111 / 100), &T0);
    let err = h.agg.try_lastprice(&share).err().unwrap().unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::VaultNavAboveUpBand as u32)
    );

    nav.poner(&(NAV_UNO * 109 / 100), &T0);
    assert!(h.agg.lastprice(&share).is_some());
}

/// Un NAV no positivo no se sirve nunca.
#[test]
fn vault_nav_no_positivo_revierte() {
    for malo in [0_i128, -1, -NAV_UNO] {
        let (h, nav, share) = con_vault(900, 0);
        nav.poner(&malo, &T0);
        let err = h.agg.try_lastprice(&share).err().unwrap().unwrap();
        assert_eq!(
            err,
            soroban_sdk::Error::from_contract_error(Error::VaultNavNotPositive as u32),
            "NAV {} no se rechazo",
            malo
        );
    }
}

/// Los tres modos de precio son excluyentes: un activo tiene uno, nunca dos.
#[test]
fn vault_nav_es_excluyente_con_los_otros_modos() {
    let (h, _nav, _share) = con_vault(900, 1_000);

    // Al activo que YA tiene ruta no se le puede poner un vault.
    let nav_id2 = h.env.register_contract(None, MockVaultOracle);
    let err = h
        .agg
        .try_set_initial_vault_nav(
            &h.xlm,
            &VaultNav {
                oracle: nav_id2,
                decimals_in: 18,
                max_age: 900,
                max_up_bps: 1_000,
            },
        )
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(
        err,
        soroban_sdk::Error::from_contract_error(Error::AssetAlreadyPriced as u32)
    );
}
