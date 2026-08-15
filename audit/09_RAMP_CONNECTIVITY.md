# 09 — Conectividad con la rampa fiat (sandbox)

**Fecha:** 2026-08-15 · **Proveedor:** Etherfuse · **Entorno:** sandbox
(`https://api.sand.etherfuse.com`)

Qué se probó y qué **no**, con la misma claridad. La relación comercial con el emisor está
firmada y con KYB aprobado; este documento registra el estado **técnico** de la integración,
que es distinto y está menos avanzado.

---

## 1. Resultado en una línea

**Acceso autenticado funcionando.** La organización está aprobada, el descubrimiento de
activos responde, y el catálogo público entrega datos que sirven para calibrar nuestro
oráculo. No se ejecutó ninguna operación con fondos.

| Endpoint | Auth | HTTP | Resultado |
|---|---|---|---|
| `GET /ramp` | sí | **200** | `org_id` |
| `GET /ramp/me` | sí | **200** | organización, fecha de aprobación, fee por defecto |
| `GET /ramp/assets?blockchain=…&currency=…&wallet=…` | sí | **200** | 9 activos en Stellar |
| `GET /lookup/stablebonds` | no | **200** | 11.008 bytes, catálogo |
| `GET /lookup/bonds/cost` | no | **200** | 19.017 bytes, 19 bonos con precio por proveedor |

### Identidad de la organización

```json
{"id":"2a64da05-63f7-4502-aa2e-750a19e679b1",
 "displayName":"Vigente Protocol",
 "approvedAt":"2026-08-03 23:32:28.713840 +00:00",
 "partnerFeeDefaultBps":0}
```

`approvedAt` es **la fecha de aprobación de KYB reportada por el propio proveedor**, no una
declaración nuestra: 3 de agosto de 2026. `partnerFeeDefaultBps: 0` significa que no hay fee de
partner configurado por defecto.

## 2. Dos obstáculos que costaron tiempo, documentados para el próximo

**a) La credencial lleva tres segmentos y el placeholder no va literal.** El formato es
`api_{env}:{key_id}:{org_id}`, donde `{env}` es un marcador. Guardarla con las llaves incluidas
—`api_{sand}:…`— produce `401 {"error":"Invalid API key"}`. Quitándolas, autentica. La cabecera
va **sin** prefijo `Bearer`; enviarlo es la otra causa habitual de 401.

**b) `/ramp/verify-api-key` no existe** (404). El endpoint que valida credenciales y devuelve
el `org_id` es **`GET /ramp`**. Y `/ramp/assets` exige **tres** parámetros —`blockchain`,
`currency` y `wallet`—, no solo `blockchain`: omitir cualquiera devuelve
`400 Query deserialize error: missing field …`, que es un mensaje útil pero solo revela un
campo faltante por vez.

## 2b. 🔴 Hallazgo de integración: el USDC de la rampa no es el de nuestro pool

| Origen | Identificador |
|---|---|
| Rampa (sandbox) | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Reserva de deuda de nuestro pool | `USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56` |

**Emisores distintos: son activos distintos.** Un usuario que compre USDC por la rampa **no
puede repagar directamente** un préstamo denominado en el USDC del pool; hace falta un swap o
un path payment en el medio. No es un bloqueante del diseño, pero sí un paso obligatorio del
flujo que hay que construir y presupuestar — y que no aparecería si uno se quedara leyendo la
documentación.

El identificador de **CETES en sandbox** es
`CETES:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4`. Los emisores **difieren entre
sandbox y producción**, así que ninguno de estos valores puede incrustarse en código: se leen
siempre de `GET /ramp/assets`.

## 3. 🎯 Dispersión entre proveedores de tipo de cambio

El endpoint `/lookup/bonds/cost` expone, por cada bono, un mapa `sources` con el tipo de
cambio derivado **por cada proveedor de FX** que consulta el emisor. Cinco proveedores
independientes, 19 bonos. Esto es el dato más útil que salió de la prueba.

| Bono | Moneda | Proveedores | Spread (bps) |
|---|---|---|---|
| CARN, TESOURO | BRL | 5 | **47,2** |
| CETES, Cetes2, CZERO, JoGo, TURK, BEAUT, mxnCx | **MXN** | 5 | **8,8** |
| KTB | KRW | 5 | 6,2 |
| GILTS | GBP | 5 | 4,4 |
| EURO | EUR | 5 | 1,8 |
| USTRY, USDx | USD | 5 | 0,0 |

```
observaciones: 19     mínimo: 0,0     mediana: 8,8     p90: 47,2     máximo: 47,2 bps
```

Reproducible: `GET /lookup/bonds/cost` (sin autenticación) y, por bono,
`(max − min) / media × 10.000` sobre `sources[*].exchange_rate`.

### Qué implica — y qué NO implica

**Lo que muestra:** el ruido legítimo entre fuentes independientes es de **~9 bps para MXN**,
la moneda de CETES, y **47 bps en el peor caso** observado. Ese es el piso de desacuerdo
esperable entre proveedores honestos.

**La comparación que NO se puede hacer directamente:** el `max_deviation_bps` del
`oracle-aggregator` está hoy en **2000 bps**, pero guarda otra cosa. Según
[`lib.rs:26`](../contracts/oracle-aggregator/src/lib.rs#L26), compara
`|price − last| / last` — es decir, **el salto contra el último precio que servimos**, una
medida temporal, no la dispersión transversal entre proveedores. Decir "el guard está 42×
flojo" sería mezclar dos métricas distintas.

**Lo que sí se puede afirmar:** un guard de 2000 bps permite pasar un movimiento del **20 % en
un solo paso**. Para un token que sigue un instrumento soberano de corto plazo en MXN, cuyas
fuentes independientes no difieren más de 9 bps entre sí, un salto de 20 % entre dos lecturas
consecutivas es difícil de justificar como movimiento legítimo. **El parámetro está puesto a
ojo y estos datos sugieren que es demasiado permisivo para activos RWA**, aunque su calibración
correcta requiere volatilidad de serie temporal, que no medimos acá.

**Queda como hallazgo del Tranche 1.** No se toca el contrato: el `oracle-aggregator`
`CCG6EAGO…` está en el slot inmutable de oráculo del pool y redesplegarlo lo inutilizaría.
Recalibrar exige un despliegue nuevo, con su migración.

## 4. Catálogo de activos

`GET /ramp/assets` devuelve **9 activos** en Stellar sandbox: CETES, MEXe, CZERO, CARN, USTRY,
TESOURO, KTB y USDC entre ellos. Los bonos de Etherfuse comparten emisor (`GC3CW7ED…` en
sandbox); el USDC tiene el suyo propio.

`/lookup/stablebonds` complementa con precio, moneda y supply: CETES figura con
`bondCurrency: "MXN"` y `tokenPriceDecimal: 1.141052` al momento de la consulta.

## 4b. Intento de onramp completo — bloqueado, y el bloqueo es la información

Se intentó el ciclo `quote → order → fiat_received → claim`. **No se completó**, y la razón es
estructural, no un error nuestro.

**Lo que sí funcionó:**

```json
POST /ramp/wallet  →  200
{"walletId":"62f6706e-ffd9-43d6-adb7-a2a152647c15",
 "customerId":"2a64da05-63f7-4502-aa2e-750a19e679b1",
 "publicKey":"GC5PQMUM226EBHVYT54Y…"}
```

La wallet externa queda registrada y aparece en `GET /ramp/wallets`. Nótese que el
`customerId` es el mismo `org_id`: para wallets institucionales, la organización actúa como
cliente.

**Dónde se detiene, y por qué importa para el diseño:**

| Endpoint | Cuerpo `{}` devuelve | Lectura |
|---|---|---|
| `POST /ramp/quote` | `missing field 'quoteId'` | **Consume** una cotización, no la crea |
| `POST /ramp/order` | `missing field 'orderId'` | Ídem: consume una orden preexistente |
| `POST /ramp/order/fiat_received` | `missing field 'orderId'` | Simula el depósito de una orden ya creada |
| `POST /ramp/onboarding-url` | `missing field 'bankAccountId'` | Requiere cuenta bancaria previa |
| `POST /ramp/bank-account` | `missing field 'presignedUrl'` | Requiere una URL prefirmada |
| `GET /ramp/bank-accounts` | `{"items":[],"totalItems":0}` | No hay ninguna registrada |

Enviar un cuerpo de cotización completo —`walletAddress`, `blockchain`, `currency`, monto e
`identifier`— sigue devolviendo `missing field 'quoteId'`. El endpoint no acepta esa forma.

**Conclusión: la cotización no se origina desde la API de partner.** Nace en el flujo de
onboarding alojado, que a su vez exige una cuenta bancaria registrada mediante una URL
prefirmada que no encontramos forma de generar con la clave de partner sola. Los tres endpoints
del ciclo (`quote`, `order`, `fiat_received`) operan sobre identificadores producidos por ese
flujo.

**Qué implica para nosotros:** el onramp **no es headless**. Hay un paso alojado por el
proveedor en el medio, y eso condiciona el diseño del producto —dónde vive la sesión del
usuario, cómo se retoma un flujo interrumpido, qué se puede automatizar y qué no—. Es
presupuestable y es Tranche 2, pero había que descubrirlo probando: la documentación describe
el ciclo como si fuera una secuencia de tres llamadas.

**Primera pregunta para la sesión técnica:** ¿cómo se origina un `quoteId` desde una
integración de partner? ¿Existe una ruta headless para clientes institucionales, o el paso de
onboarding alojado es obligatorio también en ese caso?

## 5. Alcance — qué NO se probó

**No se ejecutó ninguna operación con fondos.** Sin onramp completado, sin órdenes, sin webhooks, sin
registro de wallet institucional, sin verificación de firma HMAC, sin swap. Tampoco se probó
producción: la credencial es de sandbox y los dos entornos no son intercambiables.

> This demonstrates authenticated access, organization identity with a provider-reported KYB
> approval date, and asset discovery against the provider's sandbox — plus a concrete
> calibration input for our oracle's deviation guard and one integration gap: the ramp's USDC
> is a different asset from our pool's debt reserve. The production integration — webhooks,
> idempotency, trustline pre-checks, the swap leg and reconciliation — is Tranche 2 work and is
> not claimed here.

## 6. Cómo reproducir

```bash
# Públicos, sin credencial
curl -s https://api.sand.etherfuse.com/lookup/bonds/cost  | head -c 400
curl -s https://api.sand.etherfuse.com/lookup/stablebonds | head -c 400

# Autenticados. La clave va cruda, sin prefijo Bearer, y con los tres segmentos
# REALES: api_sand:… — no api_{sand}:…, las llaves son un placeholder de la doc.
curl -s -H "Authorization: $ETHERFUSE_API_KEY" https://api.sand.etherfuse.com/ramp
curl -s -H "Authorization: $ETHERFUSE_API_KEY" https://api.sand.etherfuse.com/ramp/me
curl -s -H "Authorization: $ETHERFUSE_API_KEY"   "https://api.sand.etherfuse.com/ramp/assets?blockchain=stellar&currency=MXN&wallet=<G...>"
```

La credencial se lee de `ETHERFUSE_API_KEY` en el entorno y **no está en el repositorio**.
