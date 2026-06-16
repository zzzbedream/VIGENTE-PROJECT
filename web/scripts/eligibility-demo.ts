/**
 * Off-chain eligibility-gate demo (the protocol pitch surface).
 *
 * Prints the off-chain eligibility decision for a set of borrower states, so a
 * lending protocol can see exactly how Vigente would gate a reputation-tier
 * pool — conservative ceilings + first-loan throttle, default = hard reject.
 *
 * Offline by default (uses canonical badge states). Pass a real testnet pubkey
 * to read the live badge and evaluate it:
 *
 *   cd web && npm run demo:eligibility
 *   cd web && npm run demo:eligibility -- GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 */

import {
  evaluateEligibility,
  type BadgeState,
} from "../src/lib/integrations/eligibility-adapter";

interface Scenario {
  name: string;
  state: BadgeState;
  hasPriorRepayment: boolean;
  requestedUsd: number;
}

const SCENARIOS: Scenario[] = [
  { name: "Gold, first loan", state: { score: 880, isDefaulted: false }, hasPriorRepayment: false, requestedUsd: 2000 },
  { name: "Gold, repeat borrower", state: { score: 880, isDefaulted: false }, hasPriorRepayment: true, requestedUsd: 2000 },
  { name: "Silver, first loan", state: { score: 600, isDefaulted: false }, hasPriorRepayment: false, requestedUsd: 500 },
  { name: "Bronze, small request", state: { score: 320, isDefaulted: false }, hasPriorRepayment: true, requestedUsd: 50 },
  { name: "Below floor", state: { score: 200, isDefaulted: false }, hasPriorRepayment: false, requestedUsd: 100 },
  { name: "No badge", state: { score: null, isDefaulted: false }, hasPriorRepayment: false, requestedUsd: 100 },
  { name: "Defaulted", state: { score: 880, isDefaulted: true }, hasPriorRepayment: true, requestedUsd: 2000 },
];

function row(name: string, state: BadgeState, hasPriorRepayment: boolean, requestedUsd: number): void {
  const d = evaluateEligibility(state, { hasPriorRepayment, requestedUsd });
  const verdict = d.eligible ? "APPROVE" : "REJECT";
  const amount = d.eligible ? `$${d.approvedUsd}` : "$0";
  console.log(
    `  ${name.padEnd(24)} ${verdict.padEnd(8)} tier=${d.tier.padEnd(6)} approved=${amount.padEnd(7)} reason=${d.reason}`,
  );
}

async function main(): Promise<void> {
  console.log("\nVigente — off-chain eligibility gate\n");
  console.log("Canonical scenarios (offline):");
  for (const s of SCENARIOS) {
    row(s.name, s.state, s.hasPriorRepayment, s.requestedUsd);
  }

  const pubkey = process.argv[2];
  if (pubkey) {
    console.log(`\nLive read for ${pubkey}:`);
    // Imported lazily so the offline path never touches the network.
    const { getBadgeState } = await import("../src/lib/integrations/vigente-read");
    const state = await getBadgeState(pubkey);
    console.log(`  badge state: score=${state.score} defaulted=${state.isDefaulted}`);
    row("live borrower", state, false, 2000);
  }

  console.log("\nPolicy mirrors contracts/reference-vault (proven on-chain).\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
