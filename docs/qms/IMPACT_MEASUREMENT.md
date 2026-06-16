# Medición de impacto — Teoría del Cambio, IRIS+ y ODS

Medición seria, no vanity. Toda métrica de impacto declarada aquí debe tener línea
base, fuente de dato y método de verificación. Evitamos explícitamente las "vanity
metrics" (p. ej. "número de wallets creadas" sin uso).

## 1. Teoría del Cambio

| Eslabón | Contenido |
|---|---|
| **Insumos** | Datos públicos de Horizon; Open Finance opcional consentido (Floid/Fintoc); modelo de scoring; contratos Soroban (badge + reference-vault); grant SCF; entidad legal chilena (PSBI o vía agregador habilitado). |
| **Actividades** | Cálculo de score off-chain → atestación k-of-n on-chain (mint badge) → integración con protocolos (Templar) y wallets (Meru/LOBSTR). |
| **Productos (outputs)** | # scores generados · # atestaciones publicadas · # wallets/protocolos integrados. |
| **Resultados (outcomes)** | # personas no-bancarizadas que acceden a crédito por **primera** vez · reducción de tasa pagada vs. alternativa informal · tasa de repago sostenida. |
| **Impacto** | Inclusión financiera medible y sostenida; construcción de historial crediticio formal. |

## 2. Métricas verificables (no-vanity)

| Métrica | Línea base | Fuente | Verificación |
|---|---|---|---|
| % de usuarios **sin historial crediticio previo** que obtienen crédito | 0 (pre-piloto) | KYC del integrador + score | muestreo auditado |
| Costo de crédito **antes/después** (TAE) | informal ~estimar | encuesta + datos del pool | comparación pareada |
| Tasa de mora real | n/a | eventos `slash` on-chain | público en cadena |
| % mujeres y población rural incluidas | 0 | datos demográficos consentidos | reporte trimestral |
| Persistencia de uso a 6 / 12 meses | n/a | actividad on-chain | cohortes |

> Las métricas de mora y atestaciones son **verificables on-chain** por cualquiera
> (eventos `mint`/`slash`), lo que da una transparencia que un bureau tradicional no
> ofrece. Ver `contracts/vigente-badge/INTERFACE.md` §5 (Events).

## 3. IRIS+ (GIIN) — set de Inclusión Financiera

Usar el catálogo IRIS+ de Inclusión Financiera (Navigating Impact, co-desarrollado
con SPTF), mapeado a las métricas anteriores. Incluir como mínimo:

- **Client Protection Policy (OI4753)** — política de protección al cliente vigente
  (ver [CLIENT_PROTECTION.md](CLIENT_PROTECTION.md)).
- Indicadores de alcance (clients reached), profundidad (first-time access) y
  calidad (over-indebtedness, retention).

## 4. Alineación con ODS (con medición, no solo declaración)

| ODS | Meta | Indicador IRIS+ mapeado |
|---|---|---|
| **ODS 1** Fin de la pobreza | 1.4 acceso a servicios financieros | % first-time access |
| **ODS 8** Trabajo decente | 8.10 ampliar acceso bancario/financiero | # cuentas/credito activadas |
| **ODS 10** Reducción de desigualdades | acceso de poblaciones excluidas | % rural / informal incluido |
| **ODS 5** Igualdad de género | si se prioriza inclusión de mujeres | % mujeres incluidas |

Cada ODS requiere **línea base + grupo de comparación + verificación externa** antes
de reportarse. No se declara "contribuimos al ODS X" sin dato.

## 5. Sostenibilidad más allá del grant (punto de fallo crítico)

El SCF advierte: "el grant es plataforma de lanzamiento, no plan de largo plazo".
Modelos de monetización por viabilidad:

1. **B2B SaaS / fee por consulta de score** (el más viable) — wallets, fintechs,
   cooperativas pagan por consulta o suscripción. Mercado: wallets Stellar con Blend
   integrado (Meru ~145K usuarios anuales, LOBSTR ~120K MAU) + fintechs LATAM.
2. **Revenue share con protocolos** — % del interés de créditos originados gracias
   al score (p. ej. con Templar).
3. **Micro-fee on-chain por invocación** (modelo oráculo, tipo Reflector).

Error a evitar: depender de emisiones de un token propio o de grants recurrentes.
