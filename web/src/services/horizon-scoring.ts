/**
 * Vigente Protocol — Synthetic Scoring Engine (on-chain Stellar)
 *
 * Phase A entry point for the Synthetic-Shamir pivot. Produces a credit
 * score for any Stellar account using ONLY Horizon API data — no fintech
 * dependency.
 *
 * Performance strategy (matches Day-1 plan):
 *   - Reverse pagination: GET /payments?order=desc&limit=200. Horizon does
 *     the heavy lifting; we never paginate forward through 10k-tx whales.
 *   - Hard cap: stop when either 200 ops or 180 days from "now" is reached
 *     (whichever fires first). The capped flag in the response surfaces this.
 *   - Account age from the first operation (single asc call, limit=1).
 *
 * Acceptance target: <3s for accounts within the cap, <6s for whales where
 * the cap activates with capped=true in the metadata.
 *
 * USD conversion: XLM is multiplied by a configurable XLM_USD_PRICE env var
 * (default 0.10) to align with the Payku-trained Volume tiers in the engine.
 * USDC is taken at face value (1:1). All other assets are excluded from the
 * volume calculation to avoid speculative valuations.
 */

import { Horizon } from "@stellar/stellar-sdk";
import {
  calculateScoreFromMetrics,
  type ScoreResult,
  type ScoringMetrics,
} from "./scoring-engine";
import {
  ECOSYSTEM_P2P_FACTOR,
  isEcosystemCounterparty,
} from "./ecosystem-whitelist";

const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const XLM_USD_PRICE = parseFloat(process.env.XLM_USD_PRICE || "0.10");

const MAX_OPS = 200;
const WINDOW_DAYS = 180;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Asset codes we treat as USD-stable (face value). Anything else is XLM-priced
// only if asset_type === "native"; other tokens are excluded from volume.
const STABLE_USD_ASSETS = new Set(["USDC", "USD"]);

export interface OnchainFeatures {
  pubkey: string;
  account_age_days: number;
  ops_evaluated: number;
  window_days: number;
  capped: boolean;            // true if 200-op cap fired before 180d window
  total_volume_xlm: number;
  /** Raw USD-equiv volume in the window. Kept for backward-compatibility. */
  total_volume_usd_equiv: number;
  /** USD-equiv volume whose counterparty is in the ecosystem whitelist. */
  contract_volume_usd_equiv: number;
  /** USD-equiv volume whose counterparty is NOT in the whitelist (= P2P). */
  p2p_volume_usd_equiv: number;
  /** contract_volume + p2p_volume × ECOSYSTEM_P2P_FACTOR. This is what feeds scoring. */
  adjusted_volume_usd_equiv: number;
  /** contract_volume / (contract_volume + p2p_volume). null if no flow. */
  ecosystem_payment_ratio: number | null;
  /** Number of payments whose counterparty is in the whitelist. */
  contract_tx_count: number;
  /** Number of payments whose counterparty is NOT in the whitelist. */
  p2p_tx_count: number;
  /** contract_tx_count + p2p_tx_count × ECOSYSTEM_P2P_FACTOR (rounded). */
  effective_tx_count: number;
  monthly_volumes_usd: number[];   // length 6, index 0 = most recent month; adjusted basis
  density_cv: number | null;       // null if <2 ops
  reciprocity_ratio: number | null; // in / (in + out); null if no flow
  asset_diversity: number;          // distinct assets seen in window
  data_source: "stellar_onchain";
}

export interface OnchainScoreResult {
  features: OnchainFeatures;
  score: ScoreResult;
  latency_ms: number;
}

// -----------------------------------------------------------------------------
// Payment record shape we consume (narrowed subset of stellar-sdk types).
// We do not import the SDK type to avoid coupling to its versioning churn.
// -----------------------------------------------------------------------------

interface NormalizedPayment {
  ts_ms: number;
  from: string;
  to: string;
  amount_xlm: number;
  amount_usd_equiv: number;
  asset_key: string; // "XLM" | "USDC:<issuer>" | "OTHER:<code>:<issuer>"
  /** True if either side of the payment is in the ecosystem whitelist. */
  is_ecosystem: boolean;
}

function classifyAsset(op: Record<string, unknown>): { key: string; usd: number; xlm: number } | null {
  const amount = parseFloat(String(op.amount ?? "0"));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (op.asset_type === "native") {
    return {
      key: "XLM",
      usd: amount * XLM_USD_PRICE,
      xlm: amount,
    };
  }
  const code = String(op.asset_code ?? "");
  const issuer = String(op.asset_issuer ?? "");
  if (STABLE_USD_ASSETS.has(code)) {
    return {
      key: `${code}:${issuer}`,
      usd: amount, // 1:1 face value
      xlm: 0,
    };
  }
  return {
    key: `OTHER:${code}:${issuer}`,
    usd: 0, // excluded from volume — no price oracle
    xlm: 0,
  };
}

function normalizePaymentRecord(
  pubkey: string,
  op: Record<string, unknown>,
): NormalizedPayment | null {
  const type = String(op.type ?? "");
  // payment, path_payment_strict_send, path_payment_strict_receive, create_account
  const isPayment =
    type === "payment" ||
    type === "path_payment_strict_send" ||
    type === "path_payment_strict_receive";
  const isCreateAccount = type === "create_account";
  if (!isPayment && !isCreateAccount) return null;

  const tsStr = String(op.created_at ?? "");
  const ts_ms = Date.parse(tsStr);
  if (!Number.isFinite(ts_ms)) return null;

  let from: string;
  let to: string;
  let assetInfo: { key: string; usd: number; xlm: number } | null;

  if (isCreateAccount) {
    from = String(op.funder ?? "");
    to = String(op.account ?? "");
    const starting = parseFloat(String(op.starting_balance ?? "0"));
    if (!Number.isFinite(starting) || starting <= 0) return null;
    assetInfo = { key: "XLM", usd: starting * XLM_USD_PRICE, xlm: starting };
  } else {
    from = String(op.from ?? "");
    to = String(op.to ?? "");
    assetInfo = classifyAsset(op);
    if (!assetInfo) return null;
  }

  // Only count ops that involve this pubkey directly
  if (from !== pubkey && to !== pubkey) return null;

  // Counterparty = the side that is NOT the pubkey under evaluation.
  const counterparty = from === pubkey ? to : from;
  const is_ecosystem = isEcosystemCounterparty(counterparty);

  return {
    ts_ms,
    from,
    to,
    amount_xlm: assetInfo.xlm,
    amount_usd_equiv: assetInfo.usd,
    asset_key: assetInfo.key,
    is_ecosystem,
  };
}

// -----------------------------------------------------------------------------
// Horizon calls
// -----------------------------------------------------------------------------

async function fetchAccountAgeDays(server: Horizon.Server, pubkey: string): Promise<number> {
  // The first operation of an account is typically its create_account funding.
  // A single asc query with limit=1 is far cheaper than walking the full history.
  const firstOps = await server
    .operations()
    .forAccount(pubkey)
    .order("asc")
    .limit(1)
    .call();
  const first = firstOps.records[0];
  if (!first?.created_at) return 0;
  const created_ms = Date.parse(first.created_at);
  if (!Number.isFinite(created_ms)) return 0;
  const age_ms = Date.now() - created_ms;
  return Math.max(0, Math.floor(age_ms / (24 * 60 * 60 * 1000)));
}

async function fetchRecentPayments(
  server: Horizon.Server,
  pubkey: string,
): Promise<{ payments: NormalizedPayment[]; capped: boolean }> {
  // Reverse pagination: latest first, max 200. Horizon enforces the cap;
  // we only post-filter on the 180-day window.
  const cutoff_ms = Date.now() - WINDOW_MS;
  const page = await server
    .payments()
    .forAccount(pubkey)
    .order("desc")
    .limit(MAX_OPS)
    .call();

  const records = page.records as unknown as Record<string, unknown>[];
  const collected: NormalizedPayment[] = [];
  let hitWindowCutoff = false;

  for (const op of records) {
    const norm = normalizePaymentRecord(pubkey, op);
    if (!norm) continue;
    if (norm.ts_ms < cutoff_ms) {
      hitWindowCutoff = true;
      break;
    }
    collected.push(norm);
  }

  // capped = we hit the 200-op cap AND there could be more inside the window.
  // If we exited because of cutoff_ms, we covered the full window — not capped.
  const capped = records.length >= MAX_OPS && !hitWindowCutoff;
  return { payments: collected, capped };
}

// -----------------------------------------------------------------------------
// Feature aggregation
// -----------------------------------------------------------------------------

function computeFeatures(pubkey: string, payments: NormalizedPayment[], capped: boolean, accountAgeDays: number): OnchainFeatures {
  const total_volume_xlm = payments.reduce((s, p) => s + p.amount_xlm, 0);
  const total_volume_usd_equiv = payments.reduce((s, p) => s + p.amount_usd_equiv, 0);

  // Phase B'.1: split BOTH volume AND tx count by whitelist membership. The
  // scoring engine then sees adjusted figures across all three dimensions
  // (volume, consistency, frequency) — a carousel attacker can't keep the
  // frequency points by churning between their own wallets.
  const contract_payments = payments.filter((p) => p.is_ecosystem);
  const contract_volume_usd_equiv = contract_payments.reduce(
    (s, p) => s + p.amount_usd_equiv,
    0,
  );
  const p2p_volume_usd_equiv = total_volume_usd_equiv - contract_volume_usd_equiv;
  const adjusted_volume_usd_equiv =
    contract_volume_usd_equiv + p2p_volume_usd_equiv * ECOSYSTEM_P2P_FACTOR;
  const ecosystem_payment_ratio =
    total_volume_usd_equiv > 0
      ? contract_volume_usd_equiv / total_volume_usd_equiv
      : null;

  const contract_tx_count = contract_payments.length;
  const p2p_tx_count = payments.length - contract_tx_count;
  const effective_tx_count = Math.round(
    contract_tx_count + p2p_tx_count * ECOSYSTEM_P2P_FACTOR,
  );

  // Monthly buckets — index 0 = most recent month. Each entry uses the
  // adjusted basis so consistency / frequency math sees the same penalty.
  const now = Date.now();
  const monthly_volumes_usd: number[] = [0, 0, 0, 0, 0, 0];
  for (const p of payments) {
    const age_ms = now - p.ts_ms;
    const monthIdx = Math.floor(age_ms / MONTH_MS);
    if (monthIdx >= 0 && monthIdx < 6) {
      const weight = p.is_ecosystem ? 1 : ECOSYSTEM_P2P_FACTOR;
      monthly_volumes_usd[monthIdx] += p.amount_usd_equiv * weight;
    }
  }

  // Density CV — coefficient of variation of inter-tx gaps in seconds
  let density_cv: number | null = null;
  if (payments.length >= 2) {
    const sorted_ts = [...payments].sort((a, b) => a.ts_ms - b.ts_ms);
    const gaps_s: number[] = [];
    for (let i = 1; i < sorted_ts.length; i++) {
      gaps_s.push((sorted_ts[i].ts_ms - sorted_ts[i - 1].ts_ms) / 1000);
    }
    const mean = gaps_s.reduce((a, b) => a + b, 0) / gaps_s.length;
    if (mean > 0) {
      const variance = gaps_s.reduce((s, g) => s + Math.pow(g - mean, 2), 0) / gaps_s.length;
      density_cv = Math.sqrt(variance) / mean;
    }
  }

  // Reciprocity ratio (incoming USD-equivalent) / (total USD-equivalent)
  const in_usd = payments.filter((p) => p.to === pubkey).reduce((s, p) => s + p.amount_usd_equiv, 0);
  const reciprocity_ratio = total_volume_usd_equiv > 0 ? in_usd / total_volume_usd_equiv : null;

  // Asset diversity — distinct asset keys observed
  const asset_keys = new Set(payments.map((p) => p.asset_key));

  return {
    pubkey,
    account_age_days: accountAgeDays,
    ops_evaluated: payments.length,
    window_days: WINDOW_DAYS,
    capped,
    total_volume_xlm,
    total_volume_usd_equiv,
    contract_volume_usd_equiv,
    p2p_volume_usd_equiv,
    adjusted_volume_usd_equiv,
    ecosystem_payment_ratio,
    contract_tx_count,
    p2p_tx_count,
    effective_tx_count,
    monthly_volumes_usd,
    density_cv,
    reciprocity_ratio,
    asset_diversity: asset_keys.size,
    data_source: "stellar_onchain",
  };
}

function featuresToMetrics(features: OnchainFeatures): ScoringMetrics {
  // Phase B'.1: scoring runs entirely on the adjusted (whitelist-weighted)
  // basis. monthly_volumes_usd is already adjusted. effective_tx_count
  // applies the same factor to the count so frequency can't be gamed by
  // churning many small payments between an attacker's own wallets.
  return {
    totalVolumeUSD: features.adjusted_volume_usd_equiv,
    monthlyVolumesUSD: features.monthly_volumes_usd,
    completedCount: features.effective_tx_count,
  };
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function fetchHorizonFeatures(pubkey: string): Promise<OnchainFeatures> {
  const server = new Horizon.Server(HORIZON_URL);
  const [ageDays, paymentsResult] = await Promise.all([
    fetchAccountAgeDays(server, pubkey),
    fetchRecentPayments(server, pubkey),
  ]);
  return computeFeatures(pubkey, paymentsResult.payments, paymentsResult.capped, ageDays);
}

export async function scoreFromStellar(pubkey: string): Promise<OnchainScoreResult> {
  const t0 = Date.now();
  const features = await fetchHorizonFeatures(pubkey);
  const score = calculateScoreFromMetrics(featuresToMetrics(features));
  return { features, score, latency_ms: Date.now() - t0 };
}

// Test-only export so unit tests can drive computation deterministically.
export const __internal = {
  normalizePaymentRecord,
  computeFeatures,
  featuresToMetrics,
  WINDOW_DAYS,
  MAX_OPS,
  XLM_USD_PRICE,
};
