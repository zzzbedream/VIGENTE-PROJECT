# 09 — Conectividad con la rampa fiat (sandbox)

**Fecha:** 2026-08-15 · **Proveedor:** Etherfuse · **Entorno:** sandbox
(`https://api.sand.etherfuse.com`)

Qué se probó y qué **no**, con la misma claridad. La relación comercial con el emisor está
firmada y con KYB aprobado; este documento registra el estado **técnico** de la integración,
que es distinto y está menos avanzado.

---

## 1. Resultado en una línea

**Los endpoints públicos responden y entregan datos utilizables. Los autenticados devuelven
401 por un problema de formato de nuestra credencial, no de permisos.** La integración
funcional queda pendiente.

| Endpoint | Auth | HTTP | Resultado |
|---|---|---|---|
| `GET /ramp/verify-api-key` | sí | **401** | formato de credencial inválido |
| `GET /ramp/me` | sí | **401** | ídem |
| `GET /ramp/assets?blockchain=stellar` | sí | **401** | ídem |
| `GET /lookup/stablebonds` | no | **200** | 11.008 bytes, catálogo completo |
| `GET /lookup/bonds/cost` | no | **200** | 19.017 bytes, 19 bonos con precios por proveedor |

## 2. El 401, con su causa exacta

La respuesta del servidor es explícita y **no ambigua**:

```json
{"error":"Invalid API key format. Expected: api_<environment>:<api_key>:<organization_id> (no Bearer prefix)"}
```

La credencial que teníamos es una cadena única de 73 caracteres. El proveedor espera **tres
partes separadas por dos puntos**: entorno, clave y organization ID. No es un problema de
permisos ni de cabecera —el `Authorization` sin prefijo `Bearer` es correcto— sino de que
tenemos un fragmento y no la credencial completa.

**Acción pendiente:** obtener la credencial en el formato completo desde el panel del
proveedor. Es un trámite, no un desarrollo.

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

## 4. Catálogo de stablebonds

`/lookup/stablebonds` devuelve el catálogo con precio, moneda y supply. CETES aparece con
`bondCurrency: "MXN"` y `tokenPriceDecimal: 1.141052` al momento de la consulta. Los
identificadores concretos que usaríamos como colateral salen de
`GET /ramp/assets?blockchain=stellar`, **que requiere la credencial correcta** — y que además
difieren entre sandbox y producción, por lo que nunca deben incrustarse en código.

## 5. Alcance — qué NO se probó

No se ejecutó ningún onramp, ninguna orden, ningún webhook y ninguna operación con fondos.
No se registró wallet institucional. No se verificó firma HMAC.

> This demonstrates that the provider's public catalogue and pricing surface are reachable and
> usable, and it surfaced a concrete calibration input for our oracle's deviation guard.
> Authenticated access is **not** yet working: our credential is in the wrong format and the
> provider returns an explicit error to that effect. The production integration — webhooks,
> idempotency, trustline pre-checks and reconciliation — is Tranche 2 work and is not claimed
> here.

## 6. Cómo reproducir

```bash
# Sin credencial — funcionan tal cual
curl -s https://api.sand.etherfuse.com/lookup/bonds/cost | head -c 400
curl -s https://api.sand.etherfuse.com/lookup/stablebonds | head -c 400

# Con credencial, una vez obtenida en el formato api_<env>:<key>:<org_id>
curl -s -H "Authorization: $ETHERFUSE_API_KEY" \
  https://api.sand.etherfuse.com/ramp/verify-api-key
```

La credencial se lee de `ETHERFUSE_API_KEY` en el entorno y **no está en el repositorio**.
