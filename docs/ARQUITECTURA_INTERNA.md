# Arquitectura interna — brief de ingeniería

**Para:** Cristian (backend / integración Etherfuse) · **De:** Lucas
**Actualizado:** 2026-07-26 · **Red:** Stellar testnet

> Este documento describe el estado **real y verificable** del sistema, no el plan. Cada
> contrato citado está desplegado y cualquiera puede consultarlo con
> `stellar contract invoke --send=no`. Si algo aquí no coincide con lo que ves en el código,
> el código gana y hay que corregir este documento.

---

## 1. Qué está vivo en testnet

| Componente | Contract ID | Qué hace |
|---|---|---|
| **`margin-controller` v1** | `CA4SFW7354P7AR6JQWLPNP4LUAH74KILBWMM2KFOJUJAOUM74XCMCHDV` | **El producto.** Impone el LTV por usuario según su reputación, por delante de un pool de Blend |
| **`vigente-badge` v3** | `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD` | SBT de reputación. El `mint` exige umbral **3-de-5** de firmas ed25519 verificadas on-chain |
| **`oracle-aggregator`** | `CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4` | **Nuestro.** SEP-40: rutas por asset con timelock de 48 h, staleness y deviation guard |
| **Pool propio "Vigente"** | `CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI` | Pool de Blend desplegado con **nuestro aggregator** como oráculo. USDC (deuda) + XLM (colateral) |
| Reflector | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` | Fuente de precio, **de terceros** |
| Pool canónico de Blend | `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` | Donde corre hoy el ciclo de crédito completo |

**El pool propio está en `on-ice`** (status 2): acepta depósitos pero todavía no presta. No es
un bug — ver §4.

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

## 4. Estado del pool propio: por qué está en `on-ice`

No es un fallo de configuración. Lo medimos on-chain:

- Pool Comet de testnet: **BLND 3.889.851** · **USDC 291.944** (pesos 80:20).
- Constante de producto del pool completo: **k ≈ 2.317.000**.
- El umbral de Blend exige **k = 200.000** ⇒ hace falta **~8,63 % de todo el Comet ≈ $126.000**
  de valor.
- **BLND no es minteable por nosotros**: `admin()` del token devuelve un **contrato**
  (`CC3WJVJI…`, el emitter), no una cuenta que controlemos.
- Nuestro techo de USDC en testnet: pedir prestado contra nuestro colateral ≈ **$16**.

**Conclusión: activar un pool es una brecha de capital, no de ingeniería.** Es exactamente lo
que justifica que el Tranche 3 sea un piloto capado y que la liquidez del pool no vaya en el
presupuesto del grant. El desbloqueo es un correo al equipo de Blend, que sí controla el
emitter en testnet. Detalle completo en `audit/07_OWN_POOL_EVIDENCE.md`.

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
| `audit/00_INVENTORY.md` | Qué existe y qué no, sin supuestos, con los 10 invariantes formalizados |
| `audit/03_BLEND_FEASIBILITY.md` | Qué exige el slot de oráculo de Blend y cómo se despliega un pool |
| `audit/07_OWN_POOL_EVIDENCE.md` | Pool propio: IDs, tx y comandos de reproducción |
| `contracts/margin-controller/README.md` | Inventario de poderes admin: lo que puede y lo que **no** puede |
| `contracts/oracle-aggregator/src/lib.rs` | El aggregator, con el porqué del timelock en los comentarios |

Cualquier duda, escribime.
