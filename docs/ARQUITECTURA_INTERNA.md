# Arquitectura interna — brief de ingeniería

**Para:** Cristian (backend / integración Etherfuse) · **De:** Lucas
**Actualizado:** 2026-08-08 · **Red:** Stellar testnet

> Este documento describe el estado **real y verificable** del sistema, no el plan. Cada
> contrato citado está desplegado y cualquiera puede consultarlo con
> `stellar contract invoke --send=no`. Si algo aquí no coincide con lo que ves en el código,
> el código gana y hay que corregir este documento.

---

## 1. Qué está vivo en testnet

| Componente | Contract ID | Qué hace |
|---|---|---|
| **`margin-controller` (activo)** | `CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ` | **El producto.** Impone el LTV por usuario según su reputación, por delante del **pool propio**. Binario byte-idéntico a v1 (mismo wasm hash), redesplegado solo para apuntar al pool nuevo |
| `margin-controller` v1 | `CA4SFW7354P7AR6JQWLPNP4LUAH74KILBWMM2KFOJUJAOUM74XCMCHDV` | Sigue vivo sobre el pool canónico. **Histórico, no el producto**: se mantiene porque es evidencia ya publicada |
| **`vigente-badge` v3** | `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD` | SBT de reputación. El `mint` exige umbral **3-de-5** de firmas ed25519 verificadas on-chain |
| **`oracle-aggregator`** | `CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4` | **Nuestro.** SEP-40: rutas por asset con timelock de 48 h, staleness y deviation guard |
| **Pool propio "Vigente"** | `CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI` | Pool de Blend desplegado con **nuestro aggregator** como oráculo. USDC (deuda) + XLM (colateral) |
| Reflector | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` | Fuente de precio, **de terceros** |
| Pool canónico de Blend | `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` | Donde corría el ciclo **antes** de tener pool propio. Contexto histórico |

**El pool propio está ACTIVO** (`status: 0`): presta. Se activó el 2026-08-08 fondeando el
backstop — ver §4. El pool canónico ya no es donde corre el ciclo; queda como contexto.

## 2. El flujo

```
usuario deposita colateral
   → el controller lee su score del badge
   → calcula el LTV de su tier (≥800→85% · ≥550→75% · ≥300→60%)
   → valida capacidad contra el oráculo (precio fresco o revierte)
   → recién ahí manda la operación al pool de Blend
```

**Lo clave: Blend nunca lee el score.** La reputación vive solo en nuestro wrapper. Eso es lo
que nos permite componer con Blend sin pedirle permiso a nadie — su interfaz solo recibe
`Request{address, amount, request_type}`, no tiene campo de reputación.

La cadena de precio, verificable:

```
Blend pool ──lastprice(Asset::Stellar(…))──▶ NUESTRO aggregator ──▶ Reflector (tercero)
```

### Algo que tenés que saber porque es tu área

**El score se calcula off-chain** (`web/src/services/horizon-scoring.ts`,
`scoring-engine.ts`) y se firma k-de-n; **la cadena solo verifica firmas**. O sea: la
reputación **no es trustless**, y así hay que decirlo siempre, en cualquier documento o
conversación con partners. Es una decisión de diseño consciente, no un descuido. Reducir esa
confianza —firmantes en hosts independientes y metodología recomputable por un tercero— es
trabajo explícito del Tranche 2.

## 3. Tu carril: backend e integración con Etherfuse

### ✅ 1. Rutas API legacy — **YA RESUELTO, no trabajes en esto**

Estaba como urgente, pero se ejecutó el 2026-07-18 (commit `d4beaa7`). Se **eliminaron**
`api/mint`, `api/evaluate-and-fund`, `app/legacy` y `services/mint-service.ts`, que escribían
al contrato legacy donde cualquiera se auto-emitía un badge con score arbitrario (su
`mint_badge` autenticaba al beneficiario, no al oráculo). Verificación:
`grep -rn "NEXT_PUBLIC_CONTRACT_ID" web/src` → **0 referencias**. La ruta viva es
`api/mint-v3`, que usa el badge v3 con firmas threshold.

### 🔴 2. Separación de entornos (~10–12 h) — **empezá por acá**

Sandbox / testnet / prod **sin fallbacks hardcodeados**. Si falta una variable, el proceso
debe fallar ruidosamente, nunca continuar con un valor por defecto.

Caso concreto que queda: `web/scripts/validate-t1.ts:42-45` tiene un contract ID incrustado
como fallback. En un script de validación es tolerable; **ese patrón no puede existir en
runtime de producción**. Buen momento para dejar la configuración por entorno hecha antes de
que llegue el cliente de Etherfuse.

### 🟠 3. Etherfuse: **solo demo-grade** (~12–16 h)

Esto es importante: **no te tires a construir el cliente completo.** Para la submission del
16 de agosto solo necesitamos:

1. Cuenta en `devnet.etherfuse.com` + API key — *no requiere aprobación, se saca al toque*.
2. `GET /ramp/verify-api-key` · `GET /ramp/me` · `GET /ramp/assets?blockchain=stellar`.
3. Un onramp E2E: `quote` → `order` → **Simulate Fiat Received** (endpoint de sandbox) →
   claimable balance → claim.
4. Grabarlo.

Es simple porque en onramps, **pasando `walletAddress`, Etherfuse crea la cuenta y la
trustline por nosotros**.

### 🟢 4. El cliente completo lo **diseñás**, no lo construís

Webhooks con HMAC, pre-checks, idempotencia y conciliación de fees son ~85–100 h y
corresponden al **Tranche 2** de la propuesta del grant. Construirlo ahora significa trabajo
que no se puede imputar al presupuesto (el SCF no financia trabajo ya realizado). **Documentá
el diseño**: es lo que sostiene la credibilidad del T2 ante el panel.

## 4. El pool propio está activo — y cómo se llegó ahí

`get_config` devuelve `status: 0` con `oracle: CCG6EAGO…`. El ciclo completo corre encima:
supply → borrow → repay → withdraw. Evidencia con tx hashes en `audit/08_POOL_ACTIVATION.md`.

Como era una **brecha de capital y no de ingeniería**, el desbloqueo fue una donación de
testnet del equipo de Blend: **200.000 BLND + 15.000 USDC**. Con eso:

- Se mintearon **22.980 tokens LP** de Comet (185.524 BLND + 13.594 USDC).
- Depositados al backstop ⇒ **k = 110.015**, el **110 %** del umbral.
- Se reservaron **1.400 USDC** como liquidez prestable: un pool activo sin USDC no origina ni
  un préstamo.

### Un error nuestro que conviene que sepas, porque explica el número

Durante semanas dijimos que el umbral era **`k ≥ 200.000`**, cifra sacada de documentación.
**Está mal por un factor de 2.** La constante real vive en la herramienta oficial de Blend:

```ts
// blend-utils/src/v2/user-scripts/get-backstop-threshold.ts:22
const K_THRESHOLD = BigInt(100_000);
```

Con el número equivocado concluimos que la donación cubría solo el 59,6 % y llegamos a
redactar un pedido de **2,3× más tokens de los necesarios**. No se envió porque medimos con la
herramienta antes de pedir. De ahí la regla que aplicamos ahora: **si un número viene de
documentación y existe una herramienta oficial que lo calcula, se usa la herramienta y se cita
la línea.**

### Dos gotchas de Blend que cuestan horas

1. **`update_status` no levanta un on-ice puesto por el admin.** Corre limpio, devuelve `2` y
   no cambia nada. Solo `set_status(0)` del admin lo mueve — y esa función verifica el umbral
   dentro del contrato, así que **que pase es la prueba de que el backstop alcanza**.
2. **`repay` no respeta `i128::MAX` como "repagar todo"** en esta versión del pool: intenta
   transferir el literal y revierte. Hay que pasar el monto exacto.

> El contexto histórico de cuando el pool no se podía activar está en
> `audit/07_OWN_POOL_EVIDENCE.md`. Ese documento describe el estado previo; **`audit/08` es el
> vigente.**

## 5. Cuatro cosas de Etherfuse que si no las sabés te comés horas

**1️⃣ El fee viene contado adentro.** `feeBps` **ya incluye** nuestro partner fee, y
`destinationAmount` **ya viene neto**. Para sacar la parte de Etherfuse:
`platformBps = feeBps − partnerFeeBps`. Si lo sumás encima o lo descontás del neto, lo estás
contando dos veces.

**2️⃣ Offramps y swaps fallan en silencio.** Si la wallet no está fondeada (~1,5 XLM) o no
tiene la trustline del asset, Etherfuse no puede armar la transacción → **no devuelve nada y
no dispara ningún webhook**. Si alguna vez creás una orden y nunca llega la tx para firmar,
es esto. Hay que hacer pre-check explícito.

**3️⃣ Nunca hardcodear issuers.** Los assets son `CODE:ISSUER` y **el issuer es distinto entre
sandbox y producción**. Siempre leerlo de `GET /ramp/assets`.

**4️⃣ Dos detalles chicos:** el header es `Authorization: <api-key>` **sin prefijo `Bearer`**,
y las transacciones pre-construidas **expiran en 1–2 minutos** — hay que llamar
`regenerate_tx` como una vez por minuto mientras el usuario tenga una firma pendiente.

## 6. Reglas del repo

- **Ningún secreto entra al repositorio.** Hay un hook `pre-commit` que bloquea patrones de
  llave; actívalo en tu clon con `git config core.hooksPath .githooks`. Los secretos van en
  `.env` (ignorado) o en un gestor externo.
- **`archive/` es código histórico**: `reference-vault` y el legacy `pyme_token_v1` están
  archivados y **fuera de alcance**. No los forkees — el README de esa carpeta documenta sus
  defectos conocidos.
- **En esta máquina usar `cargo test -j 1`**: con el paralelismo por defecto el compilador
  agota la memoria y aborta.
- Los contratos **no son actualizables**. Cualquier cambio exige redesplegar y migrar; por eso
  las funciones nuevas se agrupan en un solo redeploy en vez de ir de a una.

## 7. Dónde mirar

| Documento | Para qué |
|---|---|
| `contracts/margin-controller/src/lib.rs` | La lógica de LTV por tier y las guardas de precio, con el porqué en los comentarios |
| **`audit/08_POOL_ACTIVATION.md`** | **Empieza por acá para el pool.** Activación, ciclo completo, prueba de custodia, y cómo verificarlo tú mismo |
| `audit/07_OWN_POOL_EVIDENCE.md` | Despliegue del pool. Su §"por qué no activa" quedó superada por `08` |
| `contracts/margin-controller/README.md` | Inventario de poderes admin: lo que puede y lo que **no** puede |
| `contracts/oracle-aggregator/src/lib.rs` | El aggregator, con el porqué del timelock en los comentarios |

Cualquier duda, escribime.
