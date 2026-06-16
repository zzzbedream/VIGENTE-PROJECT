# Partner brief — Templar (primer integrador de Capa 1)

> Material de aproximación. Resumen ejecutivo para abordar a Templar como primer
> protocolo que consume la capa de crédito de Vigente. Detalle técnico en
> [../integration/TEMPLAR.md](../integration/TEMPLAR.md).

## Por qué Templar

- **Momentum:** protocolo de préstamo más nuevo de Stellar (lanzado fin 2025),
  +89.5% QoQ en TVL (Q1 2026, ~$5.6M), foco explícito en **RWAs** (Centrifuge
  deJAA/deJTRSY, Etherfuse CETES/USTRY).
- **Apertura:** por ser nuevo y en expansión, es más probable que **co-diseñe** una
  primitiva de crédito que un protocolo ya consolidado (Blend).
- **Complementariedad:** Templar es colateralizado; Vigente extiende su mercado
  direccionable a prestatarios de **reputación** (subcolateralizados) que Templar
  hoy no atiende.

## Propuesta de valor para Templar

Underwriting de crédito de micro-comercio **sin construir un bureau**: Templar lee
una señal de crédito verificable on-chain (k-of-n, defaults inmutables) y abre un
pool de reputación cuya elegibilidad gestiona Vigente off-chain. Más usuarios
elegibles, mismo riesgo controlado, cero trabajo de scoring para Templar.

## Qué pedimos (el "ask")

1. **PoC conjunto:** un pool de reputación piloto gateado por Vigente (patrón
   off-chain, ver abajo), con topes conservadores (CP2).
2. **LOI no vinculante** para postular juntos al SCF / mostrar tracción.
3. Acceso a su config de mercado (Pyth price ID, decimales) y confirmación de si
   existe algún hook de elegibilidad on-chain.

## Cómo encaja técnicamente (honesto)

Templar usa **oráculo de precio Pyth** (igual que Blend usa SEP-40): no hay gate de
reputación on-chain. La integración es un **gate de elegibilidad off-chain** — el
backend Vigente decide quién entra al pool y con qué tope subcolateralizado; Templar
mantiene su oráculo de precio normal. Probado: `web/src/lib/integrations/templar-adapter.ts`
(7/7 tests), espejo off-chain de la política on-chain de `reference-vault`.

> Si Templar expone (o acepta añadir) un hook de elegibilidad por mercado, migramos
> a un gate on-chain real. Pregunta abierta #1 del doc de integración.

## Protección al usuario (diferenciador, no lavado de imagen)

El piloto opera bajo nuestro SGC: topes CP2, first-loan throttle 10%, default
inmutable, DPIA Ley 21.719, auditoría de fairness. Ver [../qms/README.md](../qms/README.md).
Esto es argumento de venta ante financiadores de impacto (SCF, CAF, SDF).

## Siguiente acción

- [ ] Confirmar arquitectura de oráculo y hooks directamente con el equipo Templar.
- [ ] Enviar one-pager + invitar a PoC.
- [ ] (Privado) términos del LOI en `docs/private/`.
