/**
 * Vigente × Templar — off-chain eligibility adapter tests.
 *
 * Offline-only. Drives the pure `evaluateTemplarEligibility` gate with badge
 * states and asserts the subcollateralized decision. Does NOT hit the network.
 *
 * The two headline cases mirror the on-chain reference-vault proofs:
 *   - an eligible borrower is approved (throttled on first loan), and
 *   - a defaulted borrower is hard-rejected (is_defaulted survives expiry).
 *
 * Run: cd web && npm run test:templar
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTemplarEligibility,
  tierForScore,
  TIER_CEILING_USD,
  FIRST_LOAN_FRACTION,
  type BadgeState,
} from "../src/lib/integrations/templar-adapter";

const GOLD: BadgeState = { score: 880, isDefaulted: false };
const DEFAULTED: BadgeState = { score: 880, isDefaulted: true };

test("eligible Gold borrower is approved, throttled to 10% on first loan", () => {
  const decision = evaluateTemplarEligibility(GOLD);

  assert.equal(decision.eligible, true);
  assert.equal(decision.tier, "Gold");
  assert.equal(decision.creditCeilingUsd, TIER_CEILING_USD.Gold);
  assert.equal(decision.reason, "approved");
  // First loan: 10% of the $2000 Gold ceiling.
  assert.equal(decision.approvedUsd, TIER_CEILING_USD.Gold * FIRST_LOAN_FRACTION);
});

test("defaulted borrower is hard-rejected regardless of score", () => {
  const decision = evaluateTemplarEligibility(DEFAULTED);

  assert.equal(decision.eligible, false);
  assert.equal(decision.approvedUsd, 0);
  assert.equal(decision.reason, "defaulted");
});

test("repayment ladder lifts first-loan throttle to the full ceiling", () => {
  const first = evaluateTemplarEligibility(GOLD, { hasPriorRepayment: false });
  const repeat = evaluateTemplarEligibility(GOLD, { hasPriorRepayment: true });

  assert.equal(first.approvedUsd, TIER_CEILING_USD.Gold * FIRST_LOAN_FRACTION);
  assert.equal(repeat.approvedUsd, TIER_CEILING_USD.Gold);
});

test("no badge signal (null score) yields no credit", () => {
  const decision = evaluateTemplarEligibility({ score: null, isDefaulted: false });

  assert.equal(decision.eligible, false);
  assert.equal(decision.tier, "None");
  assert.equal(decision.reason, "no_signal");
});

test("score below the Bronze floor is not yet creditworthy", () => {
  const decision = evaluateTemplarEligibility({ score: 200, isDefaulted: false });

  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "below_floor");
});

test("approval never exceeds the borrower's requested amount", () => {
  const decision = evaluateTemplarEligibility(GOLD, {
    hasPriorRepayment: true,
    requestedUsd: 50,
  });

  assert.equal(decision.approvedUsd, 50);
});

test("tierForScore maps the 0-1000 scale to reference-vault tiers", () => {
  assert.equal(tierForScore(800), "Gold");
  assert.equal(tierForScore(550), "Silver");
  assert.equal(tierForScore(300), "Bronze");
  assert.equal(tierForScore(299), "None");
});
