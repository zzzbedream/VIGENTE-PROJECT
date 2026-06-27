# Roadmap de gestión — Vigente

Vista de **gestión** del proyecto: por hito, qué se logra, quién lo posee, el
entregable verificable, el gate de calidad y la dependencia. No es una lista de
features — es el plan para llegar a mainnet con un producto de inclusión legítimo y
sostenible. El detalle de features por tramo vive en
[TRANCHE_1_DELIVERABLES.md](TRANCHE_1_DELIVERABLES.md),
[TRANCHE_2_DELIVERABLES.md](TRANCHE_2_DELIVERABLES.md),
[TRANCHE_3_DELIVERABLES.md](TRANCHE_3_DELIVERABLES.md) (no se duplican aquí).

## Hacia dónde vamos (línea temporal)

```
Capa 1: PoC con protocolo ──▶ Datos: agregador OF (opcional) ──▶ Distribución: wallet ──▶ Mainnet
   (señal de crédito             (enriquecimiento                  (consumo del score      (multi-sig,
    consumida por un              consentido)                       por usuarios reales)     SDK, piloto)
    protocolo de préstamo)
```

> Los nombres concretos de socios-objetivo se mantienen en `docs/private/` (no confirmados).

Posicionamiento: **capa de scoring/atestación de reputación financiera B2B** para
wallets y fintechs reguladas, con la **inclusión financiera como núcleo**. El score
core es trustless on-chain; Open Finance es enriquecimiento opcional consentido.

## Roles

- **CEO** — protocolo, criptografía, oráculo threshold, arquitectura.
- **CTO** — contratos Soroban, mainnet, ops de claves (asiento en negociación — ver `docs/private/`).
- **COO** — partnerships, GTM, protección al cliente (CP8), piloto.

## Hitos

### H0 — Shipped (verificable on-chain hoy)
| | |
|---|---|
| Logro | Oráculo k-of-n 3-de-5, badge SBT + defaults inmutables, reference-vault, Interface v1 + ABI |
| Owner | CEO |
| Evidencia | Contrato testnet `CDLLO7QE…`, 104+ tests, mints con tx en stellar.expert |
| Gate | Gate 1+2 de [qms/RELEASE_QUALITY_GATES.md](qms/RELEASE_QUALITY_GATES.md) |

### H1 — Tramo 1 · hardening + Capa 1 (primer protocolo)
| | |
|---|---|
| Objetivo | Postura de producción + primer integrador de protocolo de préstamo |
| Entregables | Spec + adapter de elegibilidad (`eligibility-adapter.ts`, 7/7 tests; brief del protocolo en `docs/private/`) · ops de claves + rotación · score cache persistente · SEP draft credit attestation · **SGC marco+operativo** ([qms/](qms/README.md)) |
| Owner | CEO (adapter, ops) · COO (brief del protocolo, SCF) |
| Verificación | `npm run test:eligibility` · arquitectura A.0 confirmada (`docs/private/`) · DPIA lista |
| Dependencia | Confirmar hooks de oráculo con el equipo del protocolo (pregunta abierta #1) |
| Gate | Gates 1–3 |

### H2 — Tramo 2 · datos + capa de yield
| | |
|---|---|
| Objetivo | Enriquecimiento de datos (opcional) + eficiencia de capital |
| Entregables | Open Finance consentido (enriquecimiento, no path de confianza) · LP yield accounting · vault tokenizado SEP-0056 · reserva ociosa con yield en pools soroban |
| Owner | COO (datos, acuerdos) · CTO (yield, vault) |
| Verificación | DPIA por flujo de datos ([qms/DPIA_TEMPLATE.md](qms/DPIA_TEMPLATE.md)) · `validate-t2` |
| Dependencia | Entidad legal chilena (PSBI) o agregador habilitado; consentimiento Ley 21.719 |
| Gate | Gates 1–4 (fairness si cambia el modelo) |

### H3 — Tramo 3 · mainnet + piloto de inclusión
| | |
|---|---|
| Objetivo | Mainnet + primeros usuarios reales con impacto medible |
| Entregables | Deploy mainnet multi-sig · SDK TypeScript en npm · distribución vía wallets LATAM · piloto con métricas de protección al cliente live (IRIS+) · audit (créditos SCF) |
| Owner | CTO (mainnet, audit) · COO (piloto, métricas) |
| Verificación | IDs en stellar.expert · SDK en npm · métricas no-vanity con dato real ([qms/IMPACT_MEASUREMENT.md](qms/IMPACT_MEASUREMENT.md)) |
| Dependencia | CP7 (canal de quejas) + DPIA aprobada **antes** de datos reales |
| Gate | Gates 1–5 |

## Fuera de alcance hasta mainnet (deliberado)
Dependencia de un mercado de préstamo con oráculo de precio inmutable que lea nuestro
score on-chain (esos mercados consumen solo oráculos de **precio** SEP-40, así que no
pueden gatear por reputación) · token propio · multi-chain · KYC retail · competir con
mercados de préstamo existentes. Vigente es la capa de crédito que otros protocolos y
originadores leen — no otra app de préstamo.

> **Post-mainnet (moat):** interceptación de repago — enrutar parte del flujo futuro de
> remesas al repago **antes** de que llegue a la wallet del prestatario (modelo Huma/Arf),
> para bajar el default esperado del originador que asume el riesgo de crédito. Diseño:
> [design/REPAYMENT_INTERCEPTION.md](design/REPAYMENT_INTERCEPTION.md). Roadmap, no shipped.

## Riesgos de gestión
- **El protocolo objetivo puede ser precio-only** (confirmado en A.0): el MVP de Capa 1
  es el gate de elegibilidad off-chain; sigue siendo válido y honesto.
- **Sostenibilidad post-grant**: el grant es plataforma, no plan. Monetización B2B
  SaaS desde H1 (ver IMPACT_MEASUREMENT §5).
- **Legal/datos**: la inmutabilidad on-chain vs. derecho de cancelación se resuelve
  manteniendo PII off-chain (hash + ZK). Bloqueante para H2/H3.
