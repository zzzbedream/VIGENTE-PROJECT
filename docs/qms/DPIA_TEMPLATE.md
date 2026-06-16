# DPIA — Evaluación de Impacto en Protección de Datos (Ley 21.719)

> Plantilla obligatoria **antes** de procesar cualquier dato personal real (Open
> Finance, KYC del integrador, demográficos). La Ley 21.719 (Chile) exige DPIA para
> tratamientos de alto riesgo, incluidas las **decisiones automatizadas** como el
> scoring crediticio. Completar una instancia por cada nuevo flujo de datos.

## 0. Identificación

| Campo | Valor |
|---|---|
| Flujo de datos evaluado | _(p. ej. enriquecimiento open finance para el piloto con un protocolo)_ |
| Responsable del tratamiento | _(entidad legal chilena / PSBI)_ |
| Encargado(s) | _(agregador Open Finance, hosting)_ |
| Fecha / versión | _____ |
| Responsable de protección al cliente | _(nombre — CP8)_ |

## 1. Descripción del tratamiento
- Categorías de datos: _(transacciones, ingresos, identidad, demográficos)_
- Origen y base de licitud: **consentimiento granular** del titular.
- Finalidad: cálculo de score crediticio y atestación.
- Destinatarios: backend Vigente → atestación on-chain (solo hash + score).

## 2. Necesidad y proporcionalidad
- **Minimización:** ¿se recoge solo lo imprescindible para el score? Sí/No + justificación.
- **Limitación de plazo:** TTL de datos crudos off-chain; el badge expira (~90 días).
- ¿Podría lograrse la finalidad con menos datos? _____

## 3. Riesgos para los derechos del titular

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Decisión automatizada injusta | | | derecho a revisión humana (CP3, AI_FAIRNESS R3) |
| Reidentificación on-chain | | | no se publica PII vinculable; solo `data_hash` |
| Conflicto inmutabilidad vs. cancelación | Alta | Alto | datos personales **off-chain**; on-chain solo hash + ZK (futuro) |
| Brecha en el encargado (agregador) | | | due diligence (ISO 27001), cifrado, contrato DPA |
| Sesgo discriminatorio | | | auditoría disparate impact ([AI_FAIRNESS.md](AI_FAIRNESS.md)) |

## 4. Derechos del titular (cómo se ejercen)
- Acceso, rectificación, **cancelación**, oposición, portabilidad.
- **Decisión automatizada:** derecho a explicación y a revisión humana.
- Canal: _(ver CP7 — mecanismo de quejas, [INCIDENT_LOG.md](INCIDENT_LOG.md))_.

## 5. Punto de fallo crítico — inmutabilidad on-chain vs. derecho de cancelación
Publicar atestaciones on-chain vinculables a una persona choca con el derecho de
cancelación. **Regla del proyecto:** los datos personales nunca se publican on-chain;
solo se publica `score + data_hash` (compromiso SHA-256) y, a futuro, pruebas de
conocimiento cero. Si la asesoría legal determina que incluso el vínculo
dirección↔persona es problemático, pivotar a atestaciones no reversibles.

## 6. Dictamen
- [ ] Tratamiento aprobado con las mitigaciones listadas
- [ ] Aprobado con condiciones: _____
- [ ] Rechazado / requiere rediseño

Firma responsable: __________ Fecha: __________
