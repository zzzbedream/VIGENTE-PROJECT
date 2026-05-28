/**
 * Vigente Protocol — CLI: score any Stellar account
 *
 * Usage:
 *   npm run evaluate -- GA...PUBKEY
 *
 * Reads only Horizon API. No Payku, no fintech. Output is the same JSON
 * shape the on-chain threshold oracle will sign over in Phase B.
 */

import { scoreFromStellar } from "../src/services/horizon-scoring";

const PUBKEY_RE = /^G[A-Z2-7]{55}$/;

async function main(): Promise<void> {
  const arg = process.argv[2]?.trim() ?? "";
  if (!arg) {
    console.error("Usage: npm run evaluate -- <PUBKEY>");
    process.exit(1);
  }
  if (!PUBKEY_RE.test(arg)) {
    console.error(`Invalid Stellar pubkey: ${arg}`);
    console.error("Expected format: G<55 base32 chars>");
    process.exit(1);
  }

  console.log(`[evaluate] scoring ${arg} from Stellar testnet…`);
  const result = await scoreFromStellar(arg);

  console.log("\n=== SCORE ===");
  console.log(`Tier:        ${result.score.badgeType} (tier ${result.score.tier})`);
  console.log(`Total score: ${result.score.totalScore}/100`);
  console.log(`Max loan:    ${result.score.maxLoanAmount} CLP`);
  console.log("\n=== BREAKDOWN ===");
  console.log(`Volume:      ${result.score.breakdown.volumePoints}/40 pts`);
  console.log(`Consistency: ${result.score.breakdown.consistencyPoints}/30 pts`);
  console.log(`Frequency:   ${result.score.breakdown.frequencyPoints}/30 pts`);
  console.log("\n=== ON-CHAIN FEATURES ===");
  console.log(`Account age:       ${result.features.account_age_days} days`);
  console.log(`Ops evaluated:     ${result.features.ops_evaluated} (window ${result.features.window_days}d)`);
  console.log(`Capped:            ${result.features.capped}`);
  console.log(`Total volume XLM:  ${result.features.total_volume_xlm.toFixed(4)}`);
  console.log(`Total USD-equiv:   $${result.features.total_volume_usd_equiv.toFixed(2)}`);
  console.log(`Monthly USD bins:  [${result.features.monthly_volumes_usd.map((v) => v.toFixed(0)).join(", ")}]`);
  console.log(`Density CV:        ${result.features.density_cv?.toFixed(3) ?? "n/a"}`);
  console.log(`Reciprocity:       ${result.features.reciprocity_ratio?.toFixed(3) ?? "n/a"}`);
  console.log(`Asset diversity:   ${result.features.asset_diversity}`);
  console.log(`Data source:       ${result.features.data_source}`);
  console.log(`Latency:           ${result.latency_ms} ms`);

  console.log("\n=== JSON ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("[evaluate] FAILED:", err.message ?? err);
  process.exit(1);
});
