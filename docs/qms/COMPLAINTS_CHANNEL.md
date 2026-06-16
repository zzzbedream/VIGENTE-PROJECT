# Canal de quejas y revisión humana (CP7)

Cumple el estándar **CP7 — Mecanismos para resolución de quejas** (Cerise+SPTF) y el
derecho de la **Ley 21.719** a revisión humana de decisiones automatizadas. Mínimo viable
operable. **Prerrequisito de release antes de incorporar al primer usuario real** (Gate 3
de [RELEASE_QUALITY_GATES.md](RELEASE_QUALITY_GATES.md)).

## Canal
- **Correo de soporte:** soporte@vigente.app *(o el que se defina; hoy: zzzbedream@gmail.com)*.
- Toda queja se registra como incidente en [INCIDENT_LOG.md](INCIDENT_LOG.md) con su SLA.
- En partners integradores, el canal del partner enruta a este registro (cláusula en el acuerdo).

## Tipos de queja contemplados
1. **Decisión automatizada injusta** (score / elegibilidad) → **derecho a revisión humana**:
   un responsable revisa el cálculo y el desglose, y responde con explicación.
2. **Datos personales** (acceso, rectificación, cancelación, oposición) → ver
   [DPIA_TEMPLATE.md](DPIA_TEMPLATE.md) §4.
3. **Trato/cobranza abusiva** por un integrador → escalamiento + revisión de la cláusula CP5.

## SLA (alineado a INCIDENT_LOG)
| Severidad | Acuse | Resolución objetivo |
|---|---|---|
| Crítico (decisión injusta con daño, fuga de datos) | 4 h | 24 h |
| Alto (queja de decisión automatizada) | 24 h | 5 días |
| Medio / bajo | 3–5 días | 15–30 días |

## Responsable
Responsable de protección al cliente (rol del COO hasta nombrar uno dedicado — CP8).

## Estado
🔴 Pendiente de activar. Disparador: primer usuario real con datos personales. Hasta
entonces, el proyecto opera en testnet sin usuarios reales.
