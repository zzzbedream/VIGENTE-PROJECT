//! **La invariante: `lastprice` devuelve un precio ESTRICTAMENTE POSITIVO, o
//! revierte con un error TIPADO. Nunca cero, y nunca un panico sin tipo.**
//!
//! Las dos mitades importan por razones distintas:
//!
//! - **Nunca cero.** Un precio 0 servido al pool vale como "este colateral no
//!   vale nada": liquidaria posiciones sanas. Es la peor salida posible y es
//!   mas peligrosa que revertir.
//! - **Nunca sin tipo.** Un `InvokeError::Abort` significa desborde aritmetico
//!   o un `unwrap` que exploto, no una guarda que decidio. Un error tipado es
//!   una decision del contrato; un abort es un defecto.
//!
//! La superficie que se fuzzea es **la que controla un atacante**: el precio y
//! la marca de tiempo que publica el upstream. Es exactamente la superficie de
//! H-03, que la guarda de desviacion acota pero no detiene.

#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use oracle_aggregator::{Asset, OracleAggregator, OracleAggregatorClient, PriceData, Route};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, Symbol,
};

// ---------------------------------------------------------------------------
// Upstream controlado por el fuzzer
// ---------------------------------------------------------------------------

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
    pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
        env.storage().persistent().get(&UpKey::Price(asset))
    }
    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&UpKey::Decimals).unwrap_or(14)
    }
}

const T0: u64 = 1_700_000_000;

#[derive(Arbitrary, Debug)]
struct Entrada {
    /// Lo que publica el upstream. **Totalmente libre**, incluidos negativos,
    /// cero y los extremos de i128.
    precio: i128,
    /// Cuan viejo es el precio respecto de `now`.
    edad: u32,
    /// Decimales del upstream y de salida, acotados al dominio con sentido:
    /// decimales absurdos son un error del admin, no un ataque.
    dec_upstream: u8,
    dec_salida: u8,
    max_age: u32,
    dev_bps: u16,
    /// Si hay una lectura previa que fije la referencia de desviacion.
    con_referencia: bool,
    precio_referencia: i128,
}

fuzz_target!(|e: Entrada| {
    let dec_up = (e.dec_upstream % 21) as u32;
    let dec_out = (e.dec_salida % 21) as u32;

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
    up.set_decimals(&dec_up);

    let agg_id = env.register_contract(None, OracleAggregator);
    let agg = OracleAggregatorClient::new(&env, &agg_id);
    agg.init(&admin, &dec_out, &172_800);

    let activo = Asset::Stellar(Address::generate(&env));
    let arriba = Asset::Other(Symbol::new(&env, "UP"));
    agg.set_initial_route(
        &activo,
        &Route {
            source: up_id.clone(),
            upstream_asset: arriba.clone(),
            max_age: e.max_age as u64,
            max_deviation_bps: e.dev_bps as u32,
        },
    );

    // Opcionalmente se fija la referencia de desviacion con una lectura previa.
    if e.con_referencia && e.precio_referencia > 0 {
        up.set_price(&arriba, &e.precio_referencia, &T0);
        let _ = agg.try_lastprice(&activo);
    }

    let ts = T0.saturating_sub(e.edad as u64);
    up.set_price(&arriba, &e.precio, &ts);

    match agg.try_lastprice(&activo) {
        Ok(Ok(Some(pd))) => {
            assert!(
                pd.price > 0,
                "se sirvio un precio no positivo ({}) con entrada {:?}",
                pd.price,
                e
            );
        }
        Ok(Ok(None)) => {}
        // Conversion rara del valor de retorno: no deberia pasar nunca.
        Ok(Err(err)) => panic!("retorno no convertible: {:?} con entrada {:?}", err, e),
        Err(Ok(_tipado)) => {
            // Un error tipado es una guarda que decidio. Es la salida correcta.
        }
        Err(Err(abort)) => panic!(
            "panico SIN TIPO ({:?}): desborde o unwrap, no una guarda. entrada {:?}",
            abort, e
        ),
    }
});
