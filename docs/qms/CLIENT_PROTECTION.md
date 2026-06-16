# Estándares de Protección al Cliente (Cerise+SPTF) aplicados a Vigente

Los 8 estándares de protección al cliente son el marco mundial de referencia para
finanzas inclusivas responsables. A continuación, cada uno con **cómo se cumple
en Vigente hoy** y **qué falta**. Estado: 🟢 implementado · 🟡 parcial · 🔴 pendiente.

> Vigente no presta directamente. Es la capa de score/atestación + una referencia
> de política de crédito (reference-vault) que terceros (protocolos de préstamo, wallets) consumen.
> Por eso varios estándares se cumplen "por diseño de la primitiva" y otros se
> trasladan como **requisitos contractuales** a los integradores.

## CP1 — Diseño y distribución apropiados de productos 🟡

- El score es agnóstico de fuente y conservador: scoring sintético sobre Horizon
  (180 días, P2P descontado 70%) más enriquecimiento Open Finance **opcional y
  consentido**. No se fuerza un producto sobre quien no lo necesita.
- **Falta:** definir, junto al integrador, el perfil de usuario objetivo y excluir
  explícitamente segmentos donde el crédito haría daño.

## CP2 — Prevención del sobreendeudamiento 🟢 (el más crítico)

Es el riesgo ético más grave: habilitar crédito subcolateralizado a no-bancarizados
puede empujarlos a deuda impagable (patrón de las crisis de microfinanzas).

- **Topes de tier conservadores**: Gold $2000 / Silver $500 / Bronze $100, probados
  on-chain en `reference-vault` y replicados off-chain en `eligibility-adapter.ts`.
- **First-loan throttle 10%**: un prestatario nuevo recibe como máximo el 10% del
  tope hasta su primer repago a tiempo (`test_first_loan_throttled_to_10pct_of_ceiling`).
- **Default inmutable**: `is_defaulted` se chequea **primero** y sobrevive a la
  expiración del badge — no se puede borrar un historial de impago.
- **Falta:** evaluación de capacidad de pago con datos de flujo (Open Finance) antes
  de subir de tier; límite de exposición agregada por persona entre pools.

## CP3 — Transparencia 🟡

- Estándar de explicabilidad ligado a Ley 21.719 (decisiones automatizadas).
- El `data_hash` on-chain es un compromiso de privacidad, no un dato opaco para el
  usuario; el desglose del score (volumen/consistencia/frecuencia) es computable.
- **Falta:** un explicador de score orientado al usuario final ("por qué obtuviste
  este puntaje y cómo mejorarlo"). Ver [AI_FAIRNESS.md](AI_FAIRNESS.md).

## CP4 — Precio responsable 🟡

- Vigente no fija la tasa (la fija el protocolo de préstamo). El modelo de negocio
  es fee por consulta / suscripción B2B, **no** spread sobre el crédito del usuario,
  lo que evita el incentivo a encarecer.
- **Falta:** cláusula en los acuerdos de integración que prohíba usar el score para
  discriminación de precio abusiva (price gouging) sobre poblaciones vulnerables.

## CP5 — Trato justo y respetuoso de los clientes 🟡

- No se publican datos personales identificables on-chain (solo direcciones y hash).
- **Falta:** código de conducta para los integradores (cobranza no abusiva).

## CP6 — Privacidad de los datos del cliente 🟢

- Minimización: el contrato almacena score + hash, no los datos crudos.
- Consentimiento granular para cualquier dato de Open Finance.
- La inmutabilidad on-chain choca con el derecho de cancelación → **no se publican
  datos vinculables**; se usa hash + (futuro) pruebas de conocimiento cero.
- Detalle y obligaciones legales en [DPIA_TEMPLATE.md](DPIA_TEMPLATE.md).

## CP7 — Mecanismos para resolución de quejas 🟡

- **Definido:** canal + SLA + derecho a revisión humana en
  [COMPLAINTS_CHANNEL.md](COMPLAINTS_CHANNEL.md), con registro en
  [INCIDENT_LOG.md](INCIDENT_LOG.md).
- **Falta:** activarlo (correo de soporte operativo) antes de cualquier usuario real.

## CP8 — Gobernanza y RRHH responsables 🟡

- Decisiones financieras por unanimidad del equipo fundador; negociaciones de equity
  fuera del repo público.
- **Falta:** política de gobernanza de datos y un responsable de protección al
  cliente nombrado (puede ser el COO) antes del piloto.

---

## Resumen de brechas para el piloto (orden de prioridad)

1. **CP7** — canal de quejas + derecho a revisión humana (bloqueante para datos reales).
2. **CP2** — evaluación de capacidad de pago + exposición agregada.
3. **CP3** — explicador de score al usuario.
4. **CP4/CP5** — cláusulas de conducta en los acuerdos de integración.

Estas brechas alimentan el [RELEASE_QUALITY_GATES.md](RELEASE_QUALITY_GATES.md) y el
[../ROADMAP.md](../ROADMAP.md).
