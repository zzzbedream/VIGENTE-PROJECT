/**
 * Drizzle Kit config — generates SQL migrations from src/db/schema.ts.
 *
 * `npm run db:generate` produces migrations into ./drizzle WITHOUT a database
 * connection (schema-only). `npm run db:migrate` applies them and DOES require
 * DATABASE_URL (the Supabase connection string).
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
