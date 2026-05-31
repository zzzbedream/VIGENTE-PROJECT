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
import {
  ECOSYSTEM_P2P_FACTOR,
  __resetEcosystemWhitelist,
  isEcosystemCounterparty,
} from "../src/services/ecosystem-whitelist";

const ME = "GTESTPUBKEYTESTPUBKEYTESTPUBKEYTESTPUBKEYTESTPUBKEYTEST";
const OTHER = "GOTHERPUBKEYOTHERPUBKEYOTHERPUBKEYOTHERPUBKEYOTHERPUBKEY";
/** A counterparty present in the seed whitelist — counted at full weight. */
const ECOSYSTEM_HUB = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const DAY_MS = 24 * 60 * 60 * 1000;

interface SyntheticTx {
  ts_ms: number;
  from: string;
  to: string;
  amount_xlm: number;
  amount_usd_equiv: number;
  asset_key: string;
  is_ecosystem: boolean;
}

function tx(
  daysAgo: number,
  amountUsd: number,
  asset: "XLM" | "USDC" = "USDC",
  direction: "in" | "out" = "in",
  counterparty: string = OTHER,
): SyntheticTx {
  const ts_ms = Date.now() - daysAgo * DAY_MS;
  const amount_xlm = asset === "XLM" ? amountUsd / __internal.XLM_USD_PRICE : 0;
  return {
    ts_ms,
    from: direction === "in" ? counterparty : ME,
    to: direction === "in" ? ME : counterparty,
    amount_xlm,
    amount_usd_equiv: amountUsd,
    asset_key: asset === "XLM" ? "XLM" : "USDC:issuer123",
    is_ecosystem: isEcosystemCounterparty(counterparty),
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

test("gold profile via ecosystem counterparty (full weight) → Gold", () => {
  // 60 tx × $300 through an ecosystem hub. Full-weight volume = $18k → Gold tier.
  const payments: SyntheticTx[] = [];
  for (let m = 0; m < 6; m++) {
    for (let i = 0; i < 10; i++) {
      payments.push(tx(m * 30 + i * 2, 300, "USDC", "in", ECOSYSTEM_HUB));
    }
  }
  const tier = tierOfFixture(payments);
  assert.equal(tier, "Gold");
});

test("silver profile via ecosystem counterparty → Silver", () => {
  const payments: SyntheticTx[] = [];
  for (let m = 0; m < 5; m++) {
    for (let i = 0; i < 4; i++) {
      payments.push(tx(m * 30 + i * 5, 400, "USDC", "in", ECOSYSTEM_HUB));
    }
  }
  const tier = tierOfFixture(payments);
  assert.equal(tier, "Silver");
});

test("bronze profile via ecosystem counterparty → Bronze", () => {
  const payments: SyntheticTx[] = [];
  for (let m = 0; m < 3; m++) {
    for (let i = 0; i < 3; i++) {
      payments.push(tx(m * 30 + i * 8, 233, "USDC", "in", ECOSYSTEM_HUB));
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

// ---------------------------------------------------------------------------
// Phase B'.1 — ecosystem whitelist + P2P penalty
// ---------------------------------------------------------------------------

test("pure P2P volume is discounted by ECOSYSTEM_P2P_FACTOR (Carousel mitigation)", () => {
  // $18k churned between three wallets — none of them in the whitelist.
  // Raw total = $18k, but adjusted = $18k × 0.3 = $5.4k → Silver tier band.
  const payments: SyntheticTx[] = [];
  for (let m = 0; m < 6; m++) {
    for (let i = 0; i < 10; i++) {
      payments.push(tx(m * 30 + i * 2, 300, "USDC", "in", OTHER));
    }
  }
  const features = __internal.computeFeatures(ME, payments, false, 365);
  assert.equal(features.total_volume_usd_equiv, 18_000);
  assert.equal(features.contract_volume_usd_equiv, 0);
  assert.equal(features.p2p_volume_usd_equiv, 18_000);
  assert.equal(
    features.adjusted_volume_usd_equiv,
    18_000 * ECOSYSTEM_P2P_FACTOR,
  );
  assert.equal(features.ecosystem_payment_ratio, 0);
  // A would-be Gold profile collapses out of the Gold band thanks to the penalty.
  const tier = tierOfFixture(payments);
  assert.notEqual(tier, "Gold");
});

test("same volume via ecosystem counterparty gets full weight", () => {
  const payments: SyntheticTx[] = [];
  for (let m = 0; m < 6; m++) {
    for (let i = 0; i < 10; i++) {
      payments.push(tx(m * 30 + i * 2, 300, "USDC", "in", ECOSYSTEM_HUB));
    }
  }
  const features = __internal.computeFeatures(ME, payments, false, 365);
  assert.equal(features.contract_volume_usd_equiv, 18_000);
  assert.equal(features.p2p_volume_usd_equiv, 0);
  assert.equal(features.adjusted_volume_usd_equiv, 18_000);
  assert.equal(features.ecosystem_payment_ratio, 1);
});

test("mixed ecosystem and P2P traffic produces ratio between 0 and 1", () => {
  const payments: SyntheticTx[] = [
    tx(5, 100, "USDC", "in", ECOSYSTEM_HUB),
    tx(10, 100, "USDC", "in", OTHER),
    tx(15, 100, "USDC", "in", ECOSYSTEM_HUB),
    tx(20, 100, "USDC", "in", OTHER),
  ];
  const features = __internal.computeFeatures(ME, payments, false, 365);
  assert.equal(features.contract_volume_usd_equiv, 200);
  assert.equal(features.p2p_volume_usd_equiv, 200);
  assert.equal(features.adjusted_volume_usd_equiv, 200 + 200 * ECOSYSTEM_P2P_FACTOR);
  assert.equal(features.ecosystem_payment_ratio, 0.5);
});

test("isEcosystemCounterparty recognises the seed list", () => {
  __resetEcosystemWhitelist();
  assert.equal(isEcosystemCounterparty(ECOSYSTEM_HUB), true);
  assert.equal(isEcosystemCounterparty(OTHER), false);
  assert.equal(isEcosystemCounterparty(""), false);
});

test("VIGENTE_ECOSYSTEM_EXTRA_ADDRESSES env var injects new entries", () => {
  process.env.VIGENTE_ECOSYSTEM_EXTRA_ADDRESSES = `${OTHER}, GFOO`;
  __resetEcosystemWhitelist();
  assert.equal(isEcosystemCounterparty(OTHER), true);
  delete process.env.VIGENTE_ECOSYSTEM_EXTRA_ADDRESSES;
  __resetEcosystemWhitelist();
  assert.equal(isEcosystemCounterparty(OTHER), false);
});
