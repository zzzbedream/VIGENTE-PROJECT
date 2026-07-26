/**
 * Vigente — database schema (Drizzle / Postgres / Supabase).
 *
 * Scaffold for the CTO. Three tables that productionise what the app currently
 * does in-memory or reads ad-hoc:
 *   - score_cache   : persist computed Horizon scores (today: in-memory Map in
 *                     /api/oracle/score-onchain). Swap that cache to this table.
 *   - badge_events  : index of mint/slash events from the badge contract, so the
 *                     KPI dashboard and the traction CSVs read from one source.
 *   - kpi_snapshots : time series of the KPI baseline (see scripts/kpi-baseline.ts).
 *
 * Not wired into runtime yet — the build and the current routes do not depend
 * on a database. The CTO connects DATABASE_URL (Supabase) and does the swap.
 * See README.md in this folder.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  serial,
  bigint,
  index,
} from "drizzle-orm/pg-core";

/** Persisted Horizon score per account (replaces the in-memory cache). */
export const scoreCache = pgTable("score_cache", {
  pubkey: text("pubkey").primaryKey(),
  score: integer("score"),
  features: jsonb("features"),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Index of mint/slash events emitted by vigente-badge. */
export const badgeEvents = pgTable(
  "badge_events",
  {
    id: serial("id").primaryKey(),
    txHash: text("tx_hash").notNull().unique(),
    borrower: text("borrower").notNull(),
    eventType: text("event_type").notNull(), // 'mint' | 'slash'
    score: integer("score"),
    reason: integer("reason"), // slash reason code (0-3), null for mint
    ledger: bigint("ledger", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    borrowerIdx: index("badge_events_borrower_idx").on(t.borrower),
  }),
);

/** Time series of the non-vanity KPI set (see scripts/kpi-baseline.ts). */
export const kpiSnapshots = pgTable("kpi_snapshots", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  value: text("value"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
});
