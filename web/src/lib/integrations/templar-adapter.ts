/**
 * Vigente × Templar — off-chain eligibility adapter (Capa 1 MVP).
 *
 * WHY THIS IS OFF-CHAIN. Templar is a *collateralized* lending protocol whose
 * on-chain oracle slot is a Pyth **price** feed (60s staleness, EMA), per the
 * market config. Like Blend (SEP-40), it has no on-chain hook to gate a
 * borrower by reputation. So Vigente cannot inject a credit score into
 * Templar's contract path. The honest, shippable integration is a *gate of
 * eligibility off-chain*: the Vigente backend reads the borrower's badge
 * (permissionless, via simulation) and decides who may enter a
 * reputation-tier pool and with what subcollateralized ceiling, while Templar
 * keeps using its normal price oracle. See docs/integration/TEMPLAR.md.
 *
 * This mirrors the J.3.2 Blend supply-side correction: the value frontier
 * (threshold oracle + scoring engine + badge SBT) is never delegated; Templar
 * is a distribution/consumer layer.
 *
 * The credit policy below is the off-chain twin of the on-chain policy proven
 * in contracts/reference-vault/src/lib.rs (tier ceilings + first-loan
 * throttle). reference-vault remains the canonical on-chain reference for any
 * protocol that DOES choose to read get_score/is_defaulted directly.
 *
 * Interface reference: contracts/vigente-badge/INTERFACE.md (Interface v1).
 */

/**
 * The credit tiers, mirrored from reference-vault. Scores are on the on-chain
 * 0-1000 scale returned by `get_score`.
 */
export type CreditTier = "Gold" | "Silver" | "Bronze" | "None";

/** Minimum on-chain score (0-1000) to enter each tier. Mirrors reference-vault. */
export const TIER_MIN_SCORE: Readonly<Record<Exclude<CreditTier, "None">, number>> = {
  Gold: 800,
  Silver: 550,
  Bronze: 300,
} as const;

/**
 * Subcollateralized credit ceiling per tier, in USD. Mirrors reference-vault
 * tier ceilings. These are deliberately small: CP2 (prevention of
 * over-indebtedness, Cerise+SPTF) requires conservative limits for an
 * unproven borrower. See docs/qms/CLIENT_PROTECTION.md.
 */
export const TIER_CEILING_USD: Readonly<Record<CreditTier, number>> = {
  Gold: 2000,
  Silver: 500,
  Bronze: 100,
  None: 0,
} as const;

/**
 * First-loan throttle: a borrower with no prior successful repayment is capped
 * at this fraction of their tier ceiling, unlocking to 100% only after the
 * first on-time repayment. Mirrors reference-vault's
 * `test_first_loan_throttled_to_10pct_of_ceiling`.
 */
export const FIRST_LOAN_FRACTION = 0.1 as const;

/** Minimum score (0-1000) below which no credit is extended. */
export const MIN_ELIGIBLE_SCORE = TIER_MIN_SCORE.Bronze;

/**
 * The borrower's Vigente badge state, as read from the Interface v1 functions
 * `get_score` and `is_defaulted`. `score` is `null` when there is no usable
 * signal (no badge, expired, or slashed) — NOT an error.
 */
export interface BadgeState {
  readonly score: number | null;
  readonly isDefaulted: boolean;
}

export interface EligibilityOptions {
  /**
   * Whether the borrower has at least one prior successful repayment. When
   * false (the default for a first-time borrower) the first-loan throttle
   * applies. Off-chain twin of reference-vault's repayment ladder.
   */
  readonly hasPriorRepayment?: boolean;
  /**
   * Borrower-requested amount in USD. The decision never approves more than
   * this, nor more than the throttled ceiling.
   */
  readonly requestedUsd?: number;
}

export interface EligibilityDecision {
  readonly eligible: boolean;
  readonly tier: CreditTier;
  /** Full tier ceiling in USD before the first-loan throttle. */
  readonly creditCeilingUsd: number;
  /** Throttle-adjusted, request-capped amount the pool may extend, in USD. */
  readonly approvedUsd: number;
  /** Machine-readable reason, useful for logging and the user-facing explainer. */
  readonly reason:
    | "approved"
    | "defaulted"
    | "no_signal"
    | "below_floor";
}

/** Map an on-chain score (0-1000) to its tier. */
export function tierForScore(score: number): CreditTier {
  if (score >= TIER_MIN_SCORE.Gold) return "Gold";
  if (score >= TIER_MIN_SCORE.Silver) return "Silver";
  if (score >= TIER_MIN_SCORE.Bronze) return "Bronze";
  return "None";
}

/**
 * Decide whether a borrower may enter a Vigente-gated Templar pool and the
 * subcollateralized amount the pool may extend.
 *
 * Pure function: same badge state in → same decision out. This is the
 * testable core of the off-chain gate. Network reads (`readBadgeState`) are
 * kept separate so this stays deterministic and offline-testable.
 *
 * Order of gates mirrors INTERFACE.md guidance: check `is_defaulted` FIRST
 * (survives badge expiry — defaults are immutable), then the score.
 */
export function evaluateTemplarEligibility(
  state: BadgeState,
  options: EligibilityOptions = {},
): EligibilityDecision {
  const deny = (
    tier: CreditTier,
    reason: EligibilityDecision["reason"],
  ): EligibilityDecision => ({
    eligible: false,
    tier,
    creditCeilingUsd: TIER_CEILING_USD[tier],
    approvedUsd: 0,
    reason,
  });

  // Gate 1: immutable default record is a hard reject.
  if (state.isDefaulted) {
    return deny("None", "defaulted");
  }

  // Gate 2: no usable credit signal (None from get_score) → no credit.
  if (state.score === null) {
    return deny("None", "no_signal");
  }

  // Gate 3: below the Bronze floor → not yet creditworthy.
  if (state.score < MIN_ELIGIBLE_SCORE) {
    return deny(tierForScore(state.score), "below_floor");
  }

  const tier = tierForScore(state.score);
  const creditCeilingUsd = TIER_CEILING_USD[tier];
  const throttled = options.hasPriorRepayment
    ? creditCeilingUsd
    : creditCeilingUsd * FIRST_LOAN_FRACTION;

  const requested = options.requestedUsd ?? throttled;
  const approvedUsd = Math.min(throttled, Math.max(0, requested));

  return {
    eligible: true,
    tier,
    creditCeilingUsd,
    approvedUsd,
    reason: "approved",
  };
}

/**
 * Read a borrower's badge state off-chain via Soroban simulation (free, no
 * signature). Thin wrapper over the Interface v1 reads documented in
 * INTERFACE.md §3. Kept out of the pure core so unit tests stay offline.
 *
 * `reader` is injected so callers can supply the project's existing Stellar
 * RPC client (or a fake in tests). Each function returns the raw Interface v1
 * value: `get_score` → number | null, `is_defaulted` → boolean.
 */
export interface BadgeReader {
  getScore(borrower: string): Promise<number | null>;
  isDefaulted(borrower: string): Promise<boolean>;
}

export async function readBadgeState(
  reader: BadgeReader,
  borrower: string,
): Promise<BadgeState> {
  const [score, isDefaulted] = await Promise.all([
    reader.getScore(borrower),
    reader.isDefaulted(borrower),
  ]);
  return { score, isDefaulted };
}
