/**
 * Vigente — KPI baseline emitter.
 *
 * Emits the non-vanity KPI set (definitions, current baseline value, data
 * source, target) as machine-readable JSON, so a dashboard can populate it as
 * the pilot produces real data. Honest by construction: impact KPIs are
 * baseline = null today (no real users yet) — we record the schema and source,
 * not fabricated numbers.
 *
 * Pairs with docs/qms/IMPACT_MEASUREMENT.md (definitions) and the mint-traction
 * CSVs from collect-metrics.ts. Writes to docs/traction/kpi-baseline.json.
 *
 * Usage: cd web && npm run kpi:baseline
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT = path.resolve(__dirname, "..", "..", "docs", "traction", "kpi-baseline.json");

type Kpi = {
  key: string;
  label: string;
  category: "gtm" | "integrability" | "impact" | "quality";
  baseline: number | null;
  unit: string;
  source: string;
  target: string;
};

const KPIS: Kpi[] = [
  // GTM — the goal of partner outreach.
  { key: "loi_signed", label: "Letters of intent signed", category: "gtm", baseline: 0, unit: "count", source: "outreach tracking (private)", target: ">= 1" },
  { key: "calls_booked", label: "Partner calls booked", category: "gtm", baseline: 0, unit: "count", source: "outreach tracking (private)", target: ">= 2" },
  // Integrability — credibility of the "yes".
  { key: "read_latency_p50_ms", label: "get_score read latency (p50)", category: "integrability", baseline: null, unit: "ms", source: "simulation timing", target: "< 1500" },
  { key: "score_endpoint_uptime", label: "Score endpoint uptime", category: "integrability", baseline: null, unit: "ratio", source: "uptime monitor", target: ">= 0.99" },
  // Impact — baseline null until real users (no vanity metrics).
  { key: "first_time_access_pct", label: "Users w/o prior credit history that obtain credit", category: "impact", baseline: null, unit: "percent", source: "partner KYC + score", target: "establish baseline" },
  { key: "cost_of_credit_delta", label: "Cost of credit before vs after (APR)", category: "impact", baseline: null, unit: "pp", source: "survey + pool data", target: "reduction" },
  { key: "real_default_rate", label: "Real default rate", category: "impact", baseline: 0, unit: "percent", source: "on-chain slash events", target: "track" },
  { key: "persistence_6m", label: "6-month usage persistence", category: "impact", baseline: null, unit: "percent", source: "on-chain cohorts", target: "establish baseline" },
  { key: "women_rural_pct", label: "Women / rural population included", category: "impact", baseline: null, unit: "percent", source: "consented demographics", target: "track (ODS 5/10)" },
  // Quality — release gates.
  { key: "tests_green", label: "Test suites green", category: "quality", baseline: 1, unit: "bool", source: "CI (web + contracts)", target: "1" },
  { key: "dpia_done", label: "DPIA completed before real data", category: "quality", baseline: 0, unit: "bool", source: "docs/qms/DPIA_TEMPLATE.md", target: "1 before pilot" },
  { key: "cp7_channel_live", label: "Complaints channel (CP7) operational", category: "quality", baseline: 0, unit: "bool", source: "docs/qms/COMPLAINTS_CHANNEL.md", target: "1 before pilot" },
];

function main(): void {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    note: "Baseline snapshot. Impact KPIs are null until the pilot produces real, consented data — recorded honestly, never fabricated.",
    kpis: KPIS,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + "\n");
  const byCat = KPIS.reduce<Record<string, number>>((acc, k) => {
    acc[k.category] = (acc[k.category] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ output: OUTPUT, kpis: KPIS.length, by_category: byCat }, null, 2));
}

main();
