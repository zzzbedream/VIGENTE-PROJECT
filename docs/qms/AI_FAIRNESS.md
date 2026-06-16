# IA responsable y equidad algorítmica del scoring

El scoring algorítmico es central para una RSE creíble — y su principal riesgo
ético. Este documento enumera los riesgos reales y la mitigación concreta para cada
uno. No es opcional: es condición para operar con datos de personas reales.

## Riesgos y mitigaciones

### R1 — Sesgo algorítmico
El modelo puede penalizar a poblaciones cuyos patrones de datos difieren (mujeres,
trabajadores informales, rurales).
- **Mitigación:** auditoría de *disparate impact* por grupo (comparar tasas de
  aprobación y score medio entre subgrupos); pruebas de *equal opportunity* y
  *demographic parity*; datasets representativos; **publicar** las métricas de
  fairness por release. Gate en [RELEASE_QUALITY_GATES.md](RELEASE_QUALITY_GATES.md).

### R2 — Exclusión de poblaciones
Usar datos de Open Finance excluye por definición a quien no tiene cuenta.
- **Mitigación:** el score core lee Horizon (no requiere banco); Open Finance es
  enriquecimiento opcional. Incorporar fuentes alternativas (pagos de servicios,
  telco) a futuro. **Nunca** usar el score como único gate de exclusión.

### R3 — Opacidad del modelo
Un score que el usuario no entiende viola la transparencia (CP3 y el derecho de la
Ley 21.719 frente a decisiones automatizadas).
- **Mitigación:** explicabilidad — exponer el desglose (volumen/consistencia/
  frecuencia, ya computado en `scoring-engine.ts`) y un mensaje accionable; **derecho
  a revisión humana** de cualquier decisión automatizada.

### R4 — Sobreendeudamiento
El riesgo más grave (ver CP2).
- **Mitigación:** topes de tier conservadores, first-loan throttle 10%, evaluación de
  capacidad de pago, default inmutable. Probado en `reference-vault` y reflejado en
  `eligibility-adapter.ts`.

### R5 — Uso de datos sensibles
- **Mitigación:** DPIA obligatoria (Ley 21.719); minimización de datos; consentimiento
  granular; **no publicar PII vinculable on-chain** (la inmutabilidad choca con el
  derecho de cancelación). Ver [DPIA_TEMPLATE.md](DPIA_TEMPLATE.md).

## Protocolo de auditoría de fairness (por release con cambio de modelo)

1. Definir subgrupos protegidos a partir de datos demográficos consentidos.
2. Calcular, por subgrupo: tasa de aprobación, score medio, tasa de mora posterior.
3. Medir *disparate impact ratio* (regla del 80% como umbral de alerta).
4. Si una brecha supera el umbral → revisar features, no silenciar la métrica.
5. Registrar resultados y decisiones; publicar resumen.

> Un hallazgo de sesgo que cruza el umbral es un **incidente** →
> [INCIDENT_LOG.md](INCIDENT_LOG.md), no un detalle a ocultar.

## Estado actual

🟡 Marco definido. 🔴 Pipeline de auditoría automatizado pendiente (requiere datos
demográficos consentidos del piloto). Hasta entonces, el gate de fairness en cada
release es un **paso manual documentado**.
