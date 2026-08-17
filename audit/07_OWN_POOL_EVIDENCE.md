# 07 — Pool propio con oráculo propio: evidencia on-chain

**Fecha:** 2026-07-26 · **Red:** Stellar testnet

Este documento cierra la objeción del revisor externo — *"Blend does not currently support
third-party oracles"* — con un despliegue real, no con un análisis de interfaz.

## Resultado

**Desplegamos un pool aislado de Blend cuyo oráculo es un contrato nuestro.** El pool lo
registró de forma inmutable y valúa colateral real a través de él.

| Pieza | Contract ID |
|---|---|
| **`oracle-aggregator` (nuestro)** | `CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4` |
| **Pool propio "Vigente"** | `CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI` |
| `pool_factory` de Blend (de terceros) | `CDV6RX4CGPCOKGTBFS52V3LMWQGZN3LCQTXF5RVPOOCG4XVMHXQ4NTF6` |
| Reflector, fuente de precio (de terceros) | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` |

Tx del despliegue del pool:
`404b9efeebb58ef8ad23753aed59a4dd13e37cebdc87d2849e4ed2c0b1c9f099`

## La cadena, verificable comando a comando

```
Blend pool  ──lastprice(Asset::Stellar(…))──▶  NUESTRO aggregator  ──▶  Reflector (tercero)
```

**1. El pool registró nuestro oráculo** (`get_config`):

```json
{"bstop_rate":1000000,"max_positions":4,"min_collateral":"100000000000000",
 "oracle":"CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4","status":2}
```

**2. Nuestro aggregator responde la interfaz que Blend consume** — `decimals()` → `14`;
`lastprice(Asset::Stellar(XLM))` → `{"price":"17965548877911","timestamp":1785096300}`
(≈ $0,1797) y `lastprice(Asset::Stellar(USDC))` → `{"price":"100080885788917",…}` (≈ $1,0008).
Ambos precios provienen de **Reflector**, un tercero independiente: el aggregator rutea, no
inventa precio.

**3. Las dos reservas quedaron configuradas** antes de sacar el pool de `Setup` (después
Blend impone cola de 7 días): USDC como deuda (`l_factor` 95 %, `util` 80 %) y XLM como
colateral (`c_factor` 90 %, `util` 50 %).

**4. El pool acepta colateral real valuado por nuestro oráculo** — `submit` con
`SupplyCollateral` de 50 XLM ejecutado con éxito contra el pool propio.

## Qué exige exactamente el slot de oráculo de Blend

Verificado contra los contratos desplegados, no contra documentación:

- `pool_factory.deploy(admin, name, salt, **oracle: Address**, backstop_take_rate,
  max_positions, min_collateral)` — acepta **cualquier** dirección de contrato. No hay
  allowlist de proveedores ni verificación de identidad del oráculo.
- El oráculo debe exponer `lastprice(Asset) -> Option<PriceData>` y `decimals() -> u32`, y el
  pool siempre pregunta con `Asset::Stellar(contract_address)`.
- `PoolConfig.oracle` es **inmutable** tras el deploy: por eso nuestro aggregator se probó
  contra cada reserva **antes** de crear el pool, y por eso sus rutas internas solo cambian
  con timelock de 48 h y evento público.

**Conclusión:** lo que Blend no ofrece es un oráculo *de reputación* —consume precios, no
scores—, y por eso el gate de reputación vive en nuestro `margin-controller`, delante del
pool. Pero "no soporta oráculos de terceros" es incorrecto: **el oráculo es un parámetro de
creación del pool, y el nuestro está funcionando.**

## Estado del pool: `on-ice` (status 2) — y por qué eso es un dato, no un fallo

`update_status()` ejecutado: el pool **permanece en on-ice**, que permite depósitos pero no
préstamos. La causa es que el backstop no alcanza el umbral mínimo (`pool_data` →
`{"shares":"0","tokens":"0"}`).

Esto **confirma empíricamente** lo anticipado: activar un
pool es una **brecha de capital, no de ingeniería**. El backstop se compra con tokens LP
BLND:USDC de Comet, no se programa. Es la justificación cuantificable de por qué el Tranche 3
se define como piloto **capado y whitelisted** y por qué la liquidez del pool **no** va en el
presupuesto del grant.

## Alcance honesto de esta evidencia

**Demostrado:** el pool existe, es nuestro, su oráculo es nuestro contrato, valúa vía un
tercero independiente y acepta colateral real.

**No demostrado todavía:** el ciclo de préstamo *sobre este pool* — requiere activarlo, y eso
requiere backstop. El E2E de crédito (depósito → LTV por tier → borrow → repay → withdraw)
sigue funcionando y demostrado sobre el **pool canónico de Blend**, con el `margin-controller`
v1 `CA4SFW7354P7AR6JQWLPNP4LUAH74KILBWMM2KFOJUJAOUM74XCMCHDV`.

**No se usa CETES como colateral en testnet**, por decisión deliberada: no existe feed de
precio de terceros para CETES en testnet — Reflector no lo cotiza. Valuar nuestro propio
colateral con un oráculo que operamos habría **confirmado** la objeción sobre centralización
del oráculo en lugar de refutarla. La incorporación de un activo tokenizado como colateral
queda para un tramo posterior, ruteado a un proveedor SEP-40 independiente — un cambio de ruta
que este aggregator ya soporta por diseño, con timelock. No nombramos aquí a ningún proveedor
concreto: no hay acuerdo firmado con ninguno.

## Reproducción por un tercero

```bash
# El pool registra nuestro aggregator como oráculo
stellar contract invoke --network testnet --send=no --source-account <CUALQUIERA> \
  --id CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI -- get_config

# Nuestro aggregator sirve precio de Reflector para el colateral del pool
stellar contract invoke --network testnet --send=no --source-account <CUALQUIERA> \
  --id CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4 \
  -- lastprice --asset '{"Stellar":"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"}'
```
