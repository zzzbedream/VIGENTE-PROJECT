# 08 — Activación del pool propio y ciclo de crédito completo

**Red:** Stellar testnet · **Fecha:** 2026-08-08 · **Estado:** pool **activo** (`status: 0`)

Este documento registra la activación del pool de Blend desplegado por Vigente contra
**nuestro propio oráculo SEP-40**, y el ciclo de crédito completo corriendo sobre él con LTV
modulado por reputación. Todo lo afirmado acá es verificable con los comandos de la §8.

Cierra la objeción de fondo: hasta ahora el ciclo corría sobre el pool canónico de Blend, lo
que dejaba abierta la pregunta de si el diseño dependía de infraestructura ajena. Ya no.

---

## 1. Contratos

| Componente | Contract ID |
|---|---|
| Pool propio "Vigente" | `CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI` |
| **`oracle-aggregator` (nuestro)** | `CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4` |
| `margin-controller` — instancia del pool propio | `CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ` |
| `margin-controller` v1 — sigue vivo en el pool canónico | `CA4SFW7354P7AR6JQWLPNP4LUAH74KILBWMM2KFOJUJAOUM74XCMCHDV` |
| `vigente-badge` v3 | `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD` |
| Backstop V2 de Blend | `CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA` |
| Comet LP (BLND/USDC 80:20) | `CA5UTUUPHYL5K22UBRUVC37EARZUGYOSGK3IKIXG2JLCC5ZZLI4BDWDM` |

Reservas del pool: **USDC** `CAQCFVLO…` (deuda) · **XLM** `CDLZFC3S…` (colateral).

---

## 2. El umbral del backstop — y un error nuestro que conviene contar

Durante semanas sostuvimos que el umbral era `k ≥ 200.000`, cifra tomada de documentación.
**Estaba mal por un factor de 2.** La constante real está en la herramienta oficial de Blend:

```ts
// blend-utils/src/v2/user-scripts/get-backstop-threshold.ts:13,22
 * Formula: k = A^0.8 * B^0.2 where k >= 100,000
const K_THRESHOLD = BigInt(100_000);
```

La consecuencia práctica fue seria: con 200.000 concluimos que la donación de testnet cubría
solo el 59,6 % y llegamos a redactar un pedido de **2,3× más tokens de los necesarios**. Ese
pedido nunca se envió porque medimos antes de pedir.

**Regla que adoptamos a partir de esto:** cuando un número venga de documentación y exista una
herramienta oficial que lo calcule, se usa la herramienta y se cita la línea de código.

### Salida literal de la medición

```
$ node ./lib/v2/user-scripts/get-backstop-threshold.js testnet vigente

569503n
336891n
4597762n
Current Backstop Requirements
Total Required Comet LP Tokens: 20891
Required LP Tokens to reach threshold: 20891
========================================
For a Balanced Deposit:
Required BLND: 168658
Required USDC: 12358
========================================
For a Solo BLND Deposit:
Required BLND: 212417.15889302007
========================================
For a Solo USDC Deposit:
Required USDC: 66692.79212917227
```

Replicamos la fórmula de forma independiente y coincide al dígito (20.891 LP · 168.660 BLND —
la diferencia de 2 unidades contra 168.658 es truncado de `BigInt` · 12.358 USDC).

---

## 3. Qué se depositó, y por qué no todo

Disponible: **200.000 BLND + 15.000 USDC** (donación de testnet del equipo de Blend).

**Decisión de reparto — el punto no obvio:** no se depositó todo al backstop. Un pool activo
sin USDC prestable no puede originar ni un préstamo, así que se reservó liquidez **antes** de
fondear. El mecanismo de seguridad fue el parámetro `max_amounts_in` de `join_pool`: fijar el
tope de USDC en 13.600 hace **imposible por construcción** gastar la reserva, aunque el ratio
del Comet se mueva entre la simulación y la ejecución.

| Destino | BLND | USDC |
|---|---|---|
| Backstop (vía LP de Comet) | 185.524,07 | 13.593,90 |
| **Liquidez prestable del pool** | — | **1.400,00** |
| Buffer sin comprometer | 14.475,93 | 6,10 |

Resultado: **22.980 LP**, es decir **k = 110.015 → 110,0 % del umbral**. El margen del 10 % es
deliberado y suficiente: `requiredLP` es estable frente a entradas proporcionales al Comet
(si alguien entra al ratio, `LP_TOTAL` y `k` escalan juntos y el requisito no se mueve).

Estado del backstop tras el depósito:

```json
{"blnd":"1855240686180","q4w_pct":"0","shares":"229800000000",
 "token_spot_price":"29577680","tokens":"229800000000","usdc":"135939017280"}
```

> **Advertencia operativa:** el depósito al backstop tiene **cola de retiro de 17 días**. Se
> hizo una sola vez, con la simulación validada antes.

---

## 4. Activación: `get_config` antes y después

```jsonc
// ANTES
{"bstop_rate":1000000,"max_positions":4,"min_collateral":"100000000000000",
 "oracle":"CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4","status":2}

// DESPUÉS
{"bstop_rate":1000000,"max_positions":4,"min_collateral":"100000000000000",
 "oracle":"CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4","status":0}
```

**Detalle que cuesta horas si no se sabe:** `update_status` —la función permissionless— corrió
sin error y devolvió **`2`**, dejando el pool igual. El estado 2 es *admin on-ice* y es
pegajoso: la ruta permissionless no puede levantarlo. Solo `set_status(0)`, llamada por el
admin, lo hace.

Y eso **no es un atajo**: `set_status(0)` verifica el umbral del backstop dentro del contrato y
revierte si no se alcanza. Que la transacción pasara es, en sí misma, la prueba on-chain de que
el backstop cumple. El umbral no se sorteó — lo validó Blend.

---

## 5. La cadena de precio, verificada

```
Blend pool CDYUHA3T ──lastprice(Asset::Stellar(…))──▶ oracle-aggregator CCG6EAGO (NUESTRO)
                                                              │
                                                              └──▶ Reflector CCYOZJCO (tercero)
```

El campo `oracle` de `get_config` es exactamente `CCG6EAGO…`. **El slot de oráculo de un pool
de Blend es inmutable**, así que este pool queda permanentemente atado a nuestro aggregator.
Ambas reservas devuelven precio positivo y fresco; el aggregator aplica staleness bound,
deviation guard y timelock de 48 h sobre cambios de ruta.

Esto refuta de forma concreta la objeción "Blend no admite oráculos de terceros".

---

## 6. El ciclo completo

### 6.1 Prueba directa contra el pool (sin controller)

Aísla la pregunta "¿el pool funciona?" de "¿el controller funciona?".

| Paso | Tx | Resultado |
|---|---|---|
| Supply 1.400 USDC (liquidez) | [`246bc12b`](https://stellar.expert/explorer/testnet/tx/246bc12bd005ebaa2322dd26c9827a54785cd71688d27fb06904e08c65a8f8f0) | `supply:{"0":"14000000000"}`, `collateral` vacío |
| SupplyCollateral 1.000 XLM | [`05187f15`](https://stellar.expert/explorer/testnet/tx/05187f15c0d9e3e59f468151f566223c358d9999e7a47bc76db7c1660fd06e50) | `collateral:{"1":"10000000000"}` |
| Borrow 50 USDC | [`a1b5b625`](https://stellar.expert/explorer/testnet/tx/a1b5b62570e52f3ac0f31c1ad2670926e84252d40df4f7dfb289ca96a4a3db61) | `liabilities:{"0":"500000000"}` |
| Repay | [`88e431e5`](https://stellar.expert/explorer/testnet/tx/88e431e506e4e313a97ef76da9e86598e06e87b711873a9dda073faead8fa74b) | deuda → 9 dTokens de polvo |

> Nota: este pool **no** implementa el convenio `amount = i128::MAX` para "repagar todo";
> intenta transferir el literal y revierte. Hay que pasar el monto exacto.

### 6.2 🎯 La capa de reputación — la evidencia central

Dos usuarios, **colateral idéntico**, badges con score distinto, mismo bloque:

| Usuario | Colateral | Score | `ltv_bps_for` | `max_borrow` |
|---|---|---|---|---|
| Silver `GC6IPCM3…` | 1.000 XLM | 650 | **7500** | **1223133480** (122,31 USDC) |
| Gold `GDESGH52…` | 1.000 XLM | 850 | **8500** | **1386217944** (138,62 USDC) |

`1386217944 / 1223133480 = 1,13333…` = exactamente `8500 / 7500`.

Depósitos: Silver [`787a44ad`](https://stellar.expert/explorer/testnet/tx/787a44ad68998cdeca21d0fda19970a70b08c3b594cf0af73b7a246e6b33d0e4) ·
Gold [`98c0ea45`](https://stellar.expert/explorer/testnet/tx/98c0ea45007a18838640e78064505129477a469b9e2e721340116897aa0c842f).
Badges minteados con umbral 3-de-5:
[`7c186685`](https://stellar.expert/explorer/testnet/tx/7c186685fd39c05b90b50719a22122ff3f973cad163eccb65f765742e3e80c6a) ·
[`82a34f3e`](https://stellar.expert/explorer/testnet/tx/82a34f3ea5cc2b7cf203172ced8aee8d7996fec41a3ef619c238bce988948d10).

**Lo que esto demuestra:** la reputación modula el crédito on-chain, y **Blend nunca ve el
score**. Su interfaz solo recibe `Request{address, amount, request_type}` — no tiene campo de
reputación. Toda la lógica vive en nuestro wrapper, lo que permite componer con Blend sin
pedirle permiso a nadie.

**Lo que esto NO demuestra:** que la reputación sea trustless. El score se calcula off-chain y
se firma k-de-n; la cadena solo verifica firmas. Es una decisión de diseño consciente y hay que
decirlo siempre. Reducir esa confianza es trabajo explícito del Tranche 2.

### 6.3 Ciclo a través del controller

| Paso | Tx | Resultado |
|---|---|---|
| `borrow` 100 USDC (Gold) | [`e85cb1a6`](https://stellar.expert/explorer/testnet/tx/e85cb1a6f9786ff95068c80acb9ca56da3a70670f371c0167b09526f68d78692) | deuda 100 USDC, health 138 % |
| `repay` | [`a1436a2d`](https://stellar.expert/explorer/testnet/tx/a1436a2dc0a48948aee5a36179366af27e835d475fcf44f90a2f389ecc7c5305) | **deuda → 0** |
| `withdraw_collateral` 200 XLM | [`c07ed1a2`](https://stellar.expert/explorer/testnet/tx/c07ed1a2bad54897ba3cd5d057eb0fa2e6c07f49b4b2aa727255e7a9b8668e2f) | quedan 800 XLM |

### 6.4 🔒 Prueba de custodia

La demostración más fuerte de la narrativa no custodial: **el admin pausa y el usuario igual
saca todo su dinero.**

| # | Acción | Tx | Resultado |
|---|---|---|---|
| 1 | Admin `pause()` | [`e8803f60`](https://stellar.expert/explorer/testnet/tx/e8803f60719d78e29dfcc4b593b8e687e4c93d2c49092701d132ef3dc9d12a82) | contrato pausado |
| 2 | `deposit_collateral` pausado | — | **revierte** (entrada de riesgo bloqueada) |
| 3 | **`withdraw_collateral` 800 XLM pausado** | [`d370b84a`](https://stellar.expert/explorer/testnet/tx/d370b84aab83cce899a3d944e7f9916520a202bdc4a4258e4a465d6006b6ba32) | **ÉXITO — colateral → 0** |
| 4 | Admin `unpause()` | [`d555c94c`](https://stellar.expert/explorer/testnet/tx/d555c94c4803ffbe7d9946ab3185cde12d4a3184447fe63b8f288a6b7c2f8a7a) | operación normal restaurada |

El pause frena la **entrada** de riesgo nuevo; no puede atrapar fondos. Es una propiedad del
código, no una promesa: `withdraw_collateral`, `repay` y `liquidate` no consultan el flag de
pausa. Ver el inventario de poderes admin en `contracts/margin-controller/README.md`.

---

## 7. Despliegue de la instancia: byte-idéntica, sin recompilar

Para apuntar el controller al pool nuevo hacía falta una instancia nueva —`init` tiene guardia
de "already initialized" (`src/lib.rs:245`) y `DataKey::Pool` solo se escribe dentro de `init`
(`:275`), sin setter. En vez de recompilar, se clonó el binario del ledger:

```bash
stellar contract fetch --id CA4SFW73… --out-file v1.wasm
sha256sum v1.wasm   # 6e7d3a3d72fe5fab5323cf4281d1ce1715a1452d988fcbe9adc6fe584ccffe95
stellar contract deploy --wasm-hash 6e7d3a3d72fe… --network testnet
```

El hash del artefacto local compilado **coincide** con el descargado del ledger, así que el
código de la instancia nueva es idéntico al auditado en v1 — verificado, no asumido.

Deploy [`b439b4f4`](https://stellar.expert/explorer/testnet/tx/b439b4f4a73c882de6dc891f9101d391e2debd4350975febdbf6c913a48031bd) ·
`init` [`4d38ae5a`](https://stellar.expert/explorer/testnet/tx/4d38ae5a0aaabeb3ef0ae18be7885473d698c3162038ac81e940ce32cafd326f) ·
`badge.add_vault` [`c1347ab2`](https://stellar.expert/explorer/testnet/tx/c1347ab2cb3d9a4c5884233e3b1ad7c1df6a52bd45f878feab90991c0c0603c4).

> `add_vault` es fácil de olvidar: sin él, la instancia nueva no puede ejecutar `slash` sobre
> el badge y las liquidaciones quedan a medias.

Validación final, `cd web && npm run validate-t1` → **`"status": "complete"`**, exit 0, con
`blend_pool` = nuestro pool y `price_oracle` = nuestro aggregator.

---

## 8. Cómo verificar esto tú mismo

Requiere solo el CLI de Stellar. Ninguna llave.

```bash
POOL=CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI
CTRL=CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ
AGG=CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4

# 1. El pool está activo y usa NUESTRO oráculo (status 0, oracle CCG6EAGO…)
stellar contract invoke --id $POOL --network testnet --source-account <TU_CUENTA> \
  --send=no -- get_config

# 2. Nuestro aggregator sirve precio fresco y positivo
stellar contract invoke --id $AGG --network testnet --source-account <TU_CUENTA> \
  --send=no -- lastprice --asset '{"Stellar":"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"}'

# 3. El backstop supera el umbral (k = 110% de 100.000)
stellar contract invoke --id CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA \
  --network testnet --source-account <TU_CUENTA> --send=no -- pool_data --pool $POOL

# 4. LA CLAVE: mismo colateral, distinto score, distinta capacidad
stellar contract invoke --id $CTRL --network testnet --source-account <TU_CUENTA> --send=no -- \
  max_borrow --user GC6IPCM3OO44PW4Y62XD54HLT5Q23E5OFNFMYPMNUDSDRUK37ZFB6ECZ   # Silver 650 → 1223133480
stellar contract invoke --id $CTRL --network testnet --source-account <TU_CUENTA> --send=no -- \
  max_borrow --user GDESGH52DW7PYVRTYR43POJ7QHHLZ337SLKSAVMQ4OKFKNS2RPT3YJYF   # Gold 850 → 1386217944

# 5. El binario es el mismo que v1 (hashes idénticos)
stellar contract fetch --id CA4SFW7354P7AR6JQWLPNP4LUAH74KILBWMM2KFOJUJAOUM74XCMCHDV \
  --network testnet --out-file v1.wasm && sha256sum v1.wasm
```

Y el umbral, reproducible desde cero:

```bash
git clone https://github.com/blend-capital/blend-utils && cd blend-utils && npm i && npm run build
# agregar el pool al address book como "vigente", luego:
node ./lib/v2/user-scripts/get-backstop-threshold.js testnet vigente
```

---

## 9. Guion de video

Seis tomas. La 4 es la que importa; si hay que recortar, se recorta todo menos la 4 y la 5.

**Toma 1 — El pool es nuestro y el oráculo también (30 s).**
Terminal con `get_config`. Señalar **`"status": 0`** y **`"oracle":"CCG6EAGO…"`**.
En pantalla debe verse el ID del pool `CDYUHA3T…`.
*Narración:* "Este pool es nuestro, está activo, y su oráculo es nuestro. El slot de oráculo en
Blend es inmutable: queda atado para siempre."

**Toma 2 — El oráculo sirve precio real (20 s).**
`lastprice` de XLM y USDC. Señalar el timestamp contra el reloj.
*Narración:* "Precio fresco, con staleness bound y deviation guard."

**Toma 3 — El backstop supera el umbral (25 s).**
`pool_data` al lado de la salida de `get-backstop-threshold.js`. Ambos en pantalla.
*Narración:* "20.891 LP requeridos, 22.980 depositados. Medido con la herramienta oficial de
Blend, no con nuestra documentación."

**Toma 4 — 🎯 LA REPUTACIÓN MUEVE EL CRÉDITO (45 s).**
Pantalla dividida. Izquierda Silver, derecha Gold. Mostrar en este orden:
`get_collateral` (idéntico en ambos) → `get_score` (650 vs 850) → `ltv_bps_for` (7500 vs 8500)
→ `max_borrow` (**1223133480 vs 1386217944**).
Deben quedar visibles las dos direcciones y el ID del controller `CCZNOV65…`.
*Narración:* "Mismo colateral, mismo bloque, mismo contrato. Lo único distinto es la
reputación. Y Blend nunca vio el score: su interfaz no tiene campo para eso."

**Toma 5 — 🔒 CUSTODIA (40 s).**
Seguidas, sin cortes: `pause` (admin) → `deposit_collateral` **revierte** → `withdraw_collateral`
de 800 XLM **pasa** → `get_collateral` devuelve `0` → `unpause`.
*Narración:* "El admin acaba de pausar el contrato. No puede impedir que el usuario retire. El
pause frena la entrada de riesgo, no la salida de fondos. Es código, no una promesa."

**Toma 6 — Cierre (20 s).**
`npm run validate-t1` mostrando `"status": "complete"` con `blend_pool` y `price_oracle`
apuntando a los nuestros.

---

## 10. Limitaciones — lo que esto no prueba

1. **La reputación no es trustless.** Score off-chain, firmas k-de-n verificadas on-chain.
   Trabajo del Tranche 2.
2. **Escala de testnet.** 1.400 USDC de liquidez. Prueba la mecánica, no el comportamiento
   bajo carga ni la dinámica de tasas.
3. **Sin liquidaciones bajo estrés real.** `liquidate` tiene cobertura en tests, pero no se
   ejecutó una liquidación en este pool con caída de precio real.
4. **Backstop bloqueado 17 días.** Los LP no se pueden recuperar antes de ese plazo.
5. **Un solo par de activos.** XLM colateral / USDC deuda.
