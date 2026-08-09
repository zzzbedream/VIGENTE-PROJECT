CREATE TABLE IF NOT EXISTS "badge_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tx_hash" text NOT NULL,
	"borrower" text NOT NULL,
	"event_type" text NOT NULL,
	"score" integer,
	"reason" integer,
	"ledger" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badge_events_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kpi_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "score_cache" (
	"pubkey" text PRIMARY KEY NOT NULL,
	"score" integer,
	"features" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "badge_events_borrower_idx" ON "badge_events" USING btree ("borrower");