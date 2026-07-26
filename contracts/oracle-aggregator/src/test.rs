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
    Asset, OracleAggregator, OracleAggregatorClient, PriceData, Route, MAX_DEVIATION_CEILING_BPS,
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
const DEV_BPS: u32 = 1_000; // 10%

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
#[should_panic(expected = "no pending route")]
fn apply_sin_pendiente_falla() {
    let h = setup();
    h.agg.apply_route(&h.xlm);
}

// =============================================================================
// § GUARDAS DE PRECIO
// =============================================================================

#[test]
#[should_panic(expected = "stale")]
fn precio_viejo_revierte() {
    let h = setup();
    advance(&h.env, MAX_AGE + 1);
    h.agg.lastprice(&h.xlm);
}

#[test]
#[should_panic(expected = "no price")]
fn upstream_sin_precio_revierte() {
    let h = setup();
    h.up.clear_price(&up_xlm(&h.env));
    h.agg.lastprice(&h.xlm);
}

#[test]
#[should_panic(expected = "non-positive")]
fn precio_cero_revierte() {
    let h = setup();
    h.up.set_price(&up_xlm(&h.env), &0, &T0);
    h.agg.lastprice(&h.xlm);
}

#[test]
#[should_panic(expected = "deviation above limit")]
fn salto_anomalo_revierte() {
    let h = setup();
    h.agg.lastprice(&h.xlm); // fija la referencia en $0.19
    // +58% de golpe, muy por encima del 10% permitido.
    h.up.set_price(&up_xlm(&h.env), &30_000_000_000_000, &T0);
    h.agg.lastprice(&h.xlm);
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
#[should_panic(expected = "underflows")]
fn un_precio_que_se_redondearia_a_cero_revierte() {
    // Servir 0 haría que el pool tratara el colateral como sin valor.
    let h = setup();
    h.up.set_decimals(&18);
    h.up.set_price(&up_xlm(&h.env), &1, &T0);
    h.agg.lastprice(&h.xlm);
}

// =============================================================================
// § VALIDACIÓN E IDENTIDAD
// =============================================================================

#[test]
#[should_panic(expected = "above ceiling")]
fn desviacion_por_encima_del_techo_se_rechaza() {
    let h = setup();
    let otro = Asset::Stellar(Address::generate(&h.env));
    h.agg.set_initial_route(
        &otro,
        &Route {
            source: h.up_id.clone(),
            upstream_asset: up_xlm(&h.env),
            max_age: MAX_AGE,
            max_deviation_bps: MAX_DEVIATION_CEILING_BPS + 1,
        },
    );
}

#[test]
#[should_panic(expected = "max_age must be positive")]
fn max_age_cero_se_rechaza() {
    let h = setup();
    let otro = Asset::Stellar(Address::generate(&h.env));
    h.agg.set_initial_route(
        &otro,
        &Route {
            source: h.up_id.clone(),
            upstream_asset: up_xlm(&h.env),
            max_age: 0,
            max_deviation_bps: DEV_BPS,
        },
    );
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
#[should_panic(expected = "already initialized")]
fn no_se_puede_re_inicializar() {
    let h = setup();
    h.agg.init(&h.admin, &OUT_DECIMALS, &GRACE);
}
