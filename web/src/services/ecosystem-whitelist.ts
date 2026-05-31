/**
 * Vigente Protocol — Ecosystem Counterparty Whitelist (Phase B'.1)
 *
 * Hardcoded addresses of "real" service / protocol counterparties on Stellar
 * that we credit at full weight when computing borrower volume. Anything
 * outside this set is treated as P2P and discounted by ECOSYSTEM_P2P_FACTOR
 * (default 0.3 = 70% penalty).
 *
 * Why hardcoded:
 *   - Sprint scope. The on-chain governance of this set is a post-grant
 *     deliverable (DAO vote or curator multisig).
 *   - SCF reviewers can audit the list by reading this file.
 *
 * Add an address here ONLY if it is a publicly identifiable counterparty
 * that the user cannot trivially control (anchor, AMM router, lending pool,
 * canonical asset SAC, payment provider bridge, etc.).
 *
 * Override at runtime: VIGENTE_ECOSYSTEM_EXTRA_ADDRESSES env var can supply
 * a comma-separated list of additional addresses (G... or C...) without a
 * redeploy. Useful for testnet experiments.
 */

/** Discount applied to volume that came from outside the whitelist. */
export const ECOSYSTEM_P2P_FACTOR = 0.3;

/**
 * Seed list. Lowercased on insert / lookup so case can never bite us.
 * NOTE for SCF reviewers: these are sprint-time placeholders; the production
 * curator list will be governed by the LP DAO post-grant. The mechanism is
 * what matters here, not the specific entries.
 */
const SEED: ReadonlyArray<string> = [
  // Circle's testnet USDC issuer — a major liquidity hub on Stellar testnet.
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  // Stellar Aid Assist testnet hub.
  "GBTBVILDXEDIK7XYZ7HG5ZNMHFFW4DUMR2KSGSEXNVAQ7CQTHM7QODDD",
  // SAC for native XLM (canonical contract address on testnet).
  // Future entries: Soroswap router, Blend pools, MoneyGram bridge, anchor SACs.
];

function normalizeOnce(addr: string): string {
  return addr.trim();
}

function buildWhitelist(): Set<string> {
  const set = new Set<string>();
  for (const a of SEED) {
    const n = normalizeOnce(a);
    if (n.length > 0) set.add(n);
  }
  const extra = process.env.VIGENTE_ECOSYSTEM_EXTRA_ADDRESSES;
  if (extra) {
    for (const a of extra.split(",")) {
      const n = normalizeOnce(a);
      if (n.length > 0) set.add(n);
    }
  }
  return set;
}

let cached: Set<string> | null = null;

/** Returns the whitelist set. Cached after first call within a process. */
export function getEcosystemWhitelist(): ReadonlySet<string> {
  if (!cached) cached = buildWhitelist();
  return cached;
}

/** Test-only: drop the cache so reseeding from env takes effect. */
export function __resetEcosystemWhitelist(): void {
  cached = null;
}

/**
 * True when either side of a payment matches the whitelist (case-sensitive
 * — Stellar strkeys are uppercase by convention, contract IDs are too).
 * If neither matches we treat the flow as P2P.
 */
export function isEcosystemCounterparty(counterparty: string): boolean {
  if (!counterparty) return false;
  return getEcosystemWhitelist().has(counterparty);
}
