# Mapa de socios — Vigente (vivo)

Mapa por capas del ecosistema-objetivo, con estado y siguiente acción. Datos de
mercado: Messari, *State of Stellar Q1 2026*. Estado: 🟢 acuerdo/LOI · 🟡 conversación
· 🔵 objetivo identificado · ⚪ canal de validación.

## Capa 1 — Protocolos DeFi (consumidores del score)

| Socio | Prioridad | Datos | Patrón de integración | Estado |
|---|---|---|---|---|
| **Templar** | **P1** | préstamo, +89.5% QoQ (~$5.6M), RWAs | gate de elegibilidad off-chain (oráculo Pyth precio-only) → ver [TEMPLAR_BRIEF.md](TEMPLAR_BRIEF.md) | 🔵 objetivo |
| **Blend** | P2 | líder de préstamo, ~$100.6M TVL | supply-side (reserva ociosa del vault gana yield); oráculo SEP-40 precio-only — no gatea borrowers | 🟡 feasibility corregida (J.3.2) |
| FxDAO / Aquarius | P3 | sobrecolateralizado / DEX líder | infraestructura de liquidez, no destino de scoring | 🔵 |

## Capa 2 — Distribución / usuarios (wallets, fintechs)

| Socio | Prioridad | Datos | Rol | Estado |
|---|---|---|---|---|
| **Meru** | P1 | wallet LATAM, +145K usuarios anuales, +$770M volumen, ya integra Blend, relación SDF | mejor primer partner de distribución del score | 🔵 |
| **LOBSTR** | P2 | ~120K MAU, mainstream Stellar, integra Blend earn | escala masiva | 🔵 |
| Beans / Vibrant | P3 | DeFindex+Blend / remesas MoneyGram | movimiento de dinero real | 🔵 |

## Capa 3 — Impacto / inclusión (validadores + fondos)

| Socio | Prioridad | Rol | Estado |
|---|---|---|---|
| **SDF** (programas de inclusión) | P1 | validador y financiador natural (Academic Research hasta $150K, Marketing hasta $500K, Enterprise/Matching Fund) | 🟡 vía SCF |
| **CAF** (LIF — Financial Inclusion Lab) | P2 | validador/financiador de impacto, mandato de inclusión, presencia en Chile; BID Lab / IFC similares | 🔵 |
| BancoEstado (CuentaRUT) | P3 | referente de impacto; institucional, conservador (IPC/IPI en SFA) | ⚪ validación |

## Capa 4 — Datos Open Finance (enriquecimiento opcional, consentido)

| Socio | Prioridad | Datos | Rol | Estado |
|---|---|---|---|---|
| **Floid** (CL) | P1 | ISO 27001-2, AES-256, cobertura andina, alianzas Mastercard/Experian | mejor primer partner de datos para MVP Chile | 🔵 |
| **Fintoc** (CL) | P2 | fuerte en CL/MX, iniciación de pagos | alternativa/segundo | 🔵 |
| Belvo (regional) | P3 | líder LATAM, MX/BR/CO, enrichment + data science | si se escala regionalmente | 🔵 |

> El diseño correcto: agregador → backend Vigente (entidad PSBI) → cálculo del score
> → atestación on-chain. Ningún agregador se conecta on-chain; todos exponen REST
> off-chain. El enriquecimiento es **opcional**: el score core lee Horizon, por eso
> "zero fintech in the trust path" sigue siendo cierto.

## Cooperativas de ahorro y crédito (Chile)

Oportunidad real de inclusión, pero sin presencia en Stellar y con salto cultural/
regulatorio grande (varias pidieron aplazar su entrada al SFA). **Tratar como canal
de validación de impacto y posible piloto off-chain, no como integrador técnico
temprano.**

---

*Negociaciones sensibles (equity, términos de LOI) viven solo en `docs/private/`.*
