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
Capa 1: Templar PoC ──▶ Datos: Floid (opcional) ──▶ Distribución: Meru/LOBSTR ──▶ Mainnet
   (señal de crédito        (enriquecimiento          (consumo del score          (multi-sig,
    consumida por un          consentido)               por usuarios reales)         SDK, piloto)
    protocolo real)
```

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

### H1 — Tramo 1 · hardening + Capa 1 (Templar)
| | |
|---|---|
| Objetivo | Postura de producción + primer integrador de protocolo (Templar) |
| Entregables | Spec + adapter Templar ([integration/TEMPLAR.md](integration/TEMPLAR.md), `templar-adapter.ts`, 7/7 tests) · ops de claves + rotación · score cache persistente · SEP draft credit attestation · **SGC marco+operativo** ([qms/](qms/README.md)) |
| Owner | CEO (adapter, ops) · COO (brief Templar, SCF) |
| Verificación | `npm run test:templar` · doc TEMPLAR.md con arquitectura A.0 confirmada · DPIA lista |
| Dependencia | Confirmar hooks de oráculo con el equipo Templar (pregunta abierta #1) |
| Gate | Gates 1–3 |

### H2 — Tramo 2 · datos + capa de yield
| | |
|---|---|
| Objetivo | Enriquecimiento de datos (opcional) + eficiencia de capital |
| Entregables | Open Finance **Floid/Fintoc** consentido (enriquecimiento, no path de confianza) · LP yield accounting · vault tokenizado SEP-0056 + DeFindex · reserva ociosa en Blend |
| Owner | COO (datos, acuerdos) · CTO (yield, vault) |
| Verificación | DPIA por flujo de datos ([qms/DPIA_TEMPLATE.md](qms/DPIA_TEMPLATE.md)) · `validate-t2` |
| Dependencia | Entidad legal chilena (PSBI) o agregador habilitado; consentimiento Ley 21.719 |
| Gate | Gates 1–4 (fairness si cambia el modelo) |

### H3 — Tramo 3 · mainnet + piloto de inclusión
| | |
|---|---|
| Objetivo | Mainnet + primeros usuarios reales con impacto medible |
| Entregables | Deploy mainnet multi-sig · SDK TypeScript en npm · distribución vía wallets (Meru/LOBSTR) · piloto con métricas de protección al cliente live (IRIS+) · audit (créditos SCF) |
| Owner | CTO (mainnet, audit) · COO (piloto, métricas) |
| Verificación | IDs en stellar.expert · SDK en npm · métricas no-vanity con dato real ([qms/IMPACT_MEASUREMENT.md](qms/IMPACT_MEASUREMENT.md)) |
| Dependencia | CP7 (canal de quejas) + DPIA aprobada **antes** de datos reales |
| Gate | Gates 1–5 |

## Fuera de alcance hasta mainnet (deliberado)
Token propio, multi-chain, KYC retail, competir con mercados de préstamo existentes.
Vigente es la capa de crédito que otros protocolos leen — no otra app de préstamo.

## Riesgos de gestión
- **Templar puede ser precio-only** (confirmado en A.0): el MVP de Capa 1 es el gate
  off-chain; sigue siendo válido y honesto.
- **Sostenibilidad post-grant**: el grant es plataforma, no plan. Monetización B2B
  SaaS desde H1 (ver IMPACT_MEASUREMENT §5).
- **Legal/datos**: la inmutabilidad on-chain vs. derecho de cancelación se resuelve
  manteniendo PII off-chain (hash + ZK). Bloqueante para H2/H3.
