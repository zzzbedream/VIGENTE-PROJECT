/**
 * Vigente Protocol — horizon-scoring unit tests
 *
 * Offline-only. Drives __internal.computeFeatures with synthetic payment
 * fixtures and asserts the engine produces the expected tier + cap flags.
 * Does NOT hit Horizon.
 *
 * Run: cd web && npm run test:horizon
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { __internal, type OnchainFeatures } from "../src/services/horizon-scoring";
import { calculateScoreFromMetrics } from "../src/services/scoring-engine";

const ME = "GTESTPUBKEYTESTPUBKEYTESTPUBKEYTESTPUBKEYTESTPUBKEYTEST";
const OTHER = "GOTHERPUBKEYOTHERPUBKEYOTHERPUBKEYOTHERPUBKEYOTHERPUBKEY";

const DAY_MS = 24 * 60 * 60 * 1000;

interface SyntheticTx {
  ts_ms: number;
  from: string;
  to: string;
  amount_xlm: number;
  amount_usd_equiv: number;
  asset_key: string;
}

function tx(
  daysAgo: number,
  amountUsd: number,
  asset: "XLM" | "USDC" = "USDC",
  direction: "in" | "out" = "in",
): SyntheticTx {
  const ts_ms = Date.now() - daysAgo * DAY_MS;
  const amount_xlm = asset === "XLM" ? amountUsd / __internal.XLM_USD_PRICE : 0;
  return {
    ts_ms,
    from: direction === "in" ? OTHER : ME,
    to: direction === "in" ? ME : OTHER,
    amount_xlm,
    amount_usd_equiv: amountUsd,
    asset_key: asset === "XLM" ? "XLM" : "USDC:issuer123",
  };
}

function tierOfFixture(payments: SyntheticTx[]): string {
  const features = __internal.computeFeatures(ME, payments, false, 365);
  const metrics = __internal.featuresToMetrics(features);
  return calculateScoreFromMetrics(metrics).badgeType;
}

// ---------------------------------------------------------------------------
// Fixtures shaped to land in each tier band of the engine
// ---------------------------------------------------------------------------

test("gold profile: 6 active months at $3k/mo USDC → Gold", () => {
  // 6 months × 10 tx/mo × $300 each = $3000/mo total, $18k over the window.
  // Volume tier gold = $15k → 40 pts.
  // Active months = 6, CV very low → 30 pts.
  // 60 tx / 6 months = 10 tx/mo → 30 pts. Total: 100 pts.
  const payments: SyntheticTx[] = [];
  for (let m = 0; m < 6; m++) {
    for (let i = 0; i < 10; i++) {
      payments.push(tx(m * 30 + i * 2, 300));
    }
  }
  const tier = tierOfFixture(payments);
  assert.equal(tier, "Gold");
});

test("silver profile: 5 active months at $1.6k/mo → Silver", () => {
  // 5 months × 4 tx × $400 = $8k volume (silver band: 5k-15k) → ~30 pts.
  // 5 active months, monthly bins [1600×5, 0] → CV ~0.45 → 20 pts.
  // 20 tx / 6 = 3.33 tx/mo → 10 pts. Total: ~60 pts → Silver.
  const payments: SyntheticTx[] = [];
  for (let m = 0; m < 5; m++) {
    for (let i = 0; i < 4; i++) {
      payments.push(tx(m * 30 + i * 5, 400));
    }
  }
  const tier = tierOfFixture(payments);
  assert.equal(tier, "Silver");
});

test("bronze profile: 3 active months at $700/mo → Bronze", () => {
  // Volume $2100 (bronze band: 1.5k-5k) → ~15 pts.
  // 3 active months → 10 pts.
  // 9 tx / 6 = 1.5 tx/mo → 7 pts. Total: ~32 pts → Bronze.
  const payments: SyntheticTx[] = [];
  for (let m = 0; m < 3; m++) {
    for (let i = 0; i < 3; i++) {
      payments.push(tx(m * 30 + i * 8, 233));
    }
  }
  const tier = tierOfFixture(payments);
  assert.equal(tier, "Bronze");
});

test("empty profile: 0 ops → None", () => {
  const tier = tierOfFixture([]);
  assert.equal(tier, "None");
});

test("whale-capped flag propagates through features", () => {
  // 200 payments in the last 7 days — the API caller would set capped=true
  // because the 200-op limit fired before the 180-day window.
  const payments: SyntheticTx[] = [];
  for (let i = 0; i < 200; i++) {
    payments.push(tx(i * 0.03, 100));
  }
  const features = __internal.computeFeatures(ME, payments, true, 1825);
  assert.equal(features.ops_evaluated, 200);
  assert.equal(features.capped, true);
  assert.equal(features.window_days, __internal.WINDOW_DAYS);
});

test("normalizePaymentRecord accepts payment ops involving the pubkey", () => {
  const op = {
    type: "payment",
    created_at: new Date().toISOString(),
    from: OTHER,
    to: ME,
    amount: "100.0000000",
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: "GISSUERPUBKEY",
  };
  const norm = __internal.normalizePaymentRecord(ME, op);
  assert.ok(norm);
  assert.equal(norm.to, ME);
  assert.equal(norm.amount_usd_equiv, 100);
});

test("normalizePaymentRecord rejects ops not involving the pubkey", () => {
  const op = {
    type: "payment",
    created_at: new Date().toISOString(),
    from: "GAAAAA",
    to: "GBBBBB",
    amount: "50",
    asset_type: "native",
  };
  const norm = __internal.normalizePaymentRecord(ME, op);
  assert.equal(norm, null);
});

test("normalizePaymentRecord excludes exotic assets from USD volume", () => {
  const op = {
    type: "payment",
    created_at: new Date().toISOString(),
    from: OTHER,
    to: ME,
    amount: "1000",
    asset_type: "credit_alphanum4",
    asset_code: "SHIB",
    asset_issuer: "GSHIBSISSUER",
  };
  const norm = __internal.normalizePaymentRecord(ME, op);
  assert.ok(norm);
  assert.equal(norm.amount_usd_equiv, 0);
});

test("normalizePaymentRecord handles create_account funding", () => {
  const op = {
    type: "create_account",
    created_at: new Date().toISOString(),
    funder: OTHER,
    account: ME,
    starting_balance: "1000.0000000",
  };
  const norm = __internal.normalizePaymentRecord(ME, op);
  assert.ok(norm);
  assert.equal(norm.from, OTHER);
  assert.equal(norm.to, ME);
  assert.equal(norm.amount_xlm, 1000);
  // 1000 XLM × 0.10 USD = 100 USD
  assert.equal(norm.amount_usd_equiv, 100);
});

test("reciprocity ratio: pure inflows → 1.0", () => {
  const payments: SyntheticTx[] = [];
  for (let i = 0; i < 10; i++) payments.push(tx(i * 5, 100, "USDC", "in"));
  const features = __internal.computeFeatures(ME, payments, false, 365);
  assert.equal(features.reciprocity_ratio, 1);
});

test("reciprocity ratio: 50/50 split → 0.5", () => {
  const payments: SyntheticTx[] = [];
  for (let i = 0; i < 10; i++) {
    payments.push(tx(i * 5, 100, "USDC", i % 2 === 0 ? "in" : "out"));
  }
  const features = __internal.computeFeatures(ME, payments, false, 365);
  assert.ok(features.reciprocity_ratio !== null);
  assert.equal(Math.round(features.reciprocity_ratio * 10) / 10, 0.5);
});

test("density CV is null for <2 transactions", () => {
  const features: OnchainFeatures = __internal.computeFeatures(ME, [tx(1, 100)], false, 30);
  assert.equal(features.density_cv, null);
});
