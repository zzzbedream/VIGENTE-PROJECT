/**
 * Vigente — lazy Drizzle client over Supabase Postgres.
 *
 * `getDb()` is lazy on purpose: the connection is created on first use, never at
 * import time, so importing this module (or building) without DATABASE_URL set
 * does not throw. Nothing in the current runtime imports it yet — the CTO wires
 * it into /api/oracle/score-onchain (cache) and the events indexer.
 *
 * `prepare: false` is required for Supabase's transaction-mode connection pooler
 * (port 6543), which does not support prepared statements.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let cached: Db | null = null;

export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL not set — Supabase connection string required (see src/db/README.md).");
  }
  const client = postgres(url, { prepare: false });
  cached = drizzle(client, { schema });
  return cached;
}

export { schema };
