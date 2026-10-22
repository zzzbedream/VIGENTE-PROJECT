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
    MAX_DEVIATION_CEILING_BPS, AccrualConfig, FxLeg, MAX_RATE_BPS,
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
