# DB scaffold (Supabase / Postgres) — para el CTO

Scaffold Drizzle listo para conectar. **No está cableado al runtime** todavía: el
build y las rutas actuales no dependen de la DB. Tu trabajo es conectar Supabase,
correr migraciones y hacer el swap de los dos consumidores.

## 1. Crear el proyecto Supabase y obtener la URL
- En Supabase → Project Settings → Database → **Connection pooler** (Transaction mode, puerto **6543**).
- Copiar la connection string:
  `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
- Ponerla en `web/.env.local` como `DATABASE_URL=...` (ver `.env.local.example`).

## 2. Migraciones
```bash
cd web
npm run db:generate   # genera SQL en ./drizzle desde src/db/schema.ts (NO necesita conexión)
npm run db:migrate    # aplica a Supabase (NECESITA DATABASE_URL)
```

## 3. Esquema (`src/db/schema.ts`)
| Tabla | Para qué |
|---|---|
| `score_cache` | Persistir scores de Horizon. **Swap**: reemplazar el `Map` in-memory de `src/app/api/oracle/score-onchain/route.ts`. |
| `badge_events` | Índice de eventos mint/slash del contrato. Fuente única para KPIs + CSVs de tracción. |
| `kpi_snapshots` | Serie temporal del set de KPIs (ver `scripts/kpi-baseline.ts`). |

## 4. Uso desde el código
```ts
import { getDb, schema } from "@/db/client";

const db = getDb(); // lazy: crea la conexión en el primer uso
await db.insert(schema.scoreCache).values({ pubkey, score, features, expiresAt });
```
`getDb()` es lazy a propósito: importar el módulo sin `DATABASE_URL` no rompe el build.
`prepare: false` ya está puesto para el pooler de Supabase (no soporta prepared statements).

## 5. Swap recomendado (orden)
1. `score_cache` ← cache de `score-onchain` (gana persistencia entre cold starts de Vercel).
2. `badge_events` ← indexer de eventos Soroban (hoy `collect-metrics.ts` usa tx hashes baked-in).
3. `kpi_snapshots` ← `kpi-baseline.ts` escribe una fila por corrida.

## Notas
- En Vercel, `DATABASE_URL` va como Env Var (Sensitive). Usar el pooler (6543), no el puerto directo 5432.
- Migraciones versionadas en `web/drizzle/` (commit). No editar a mano el SQL generado.
