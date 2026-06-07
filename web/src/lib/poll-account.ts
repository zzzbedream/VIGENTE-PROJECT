/**
 * Vigente Protocol — Horizon account indexing poller (Phase G.5)
 *
 * Replaces the fixed `setTimeout(2000)` that lived in v3/page.tsx after a
 * Friendbot funding. A fixed 2s sleep is the worst of both worlds: too
 * long when Horizon indexes in 300ms (slow demos) and too short when
 * Horizon is congested (false "account doesn't exist" errors).
 *
 * Backoff: 250ms, 500ms, 1s, 2s, 2s... capped at 2s, total wall-clock
 * bounded by maxMs. Returns true the moment the account is visible.
 */

const HORIZON_ACCOUNT_URL = "https://horizon-testnet.stellar.org/accounts";

async function accountExists(addr: string): Promise<boolean> {
  try {
    const r = await fetch(`${HORIZON_ACCOUNT_URL}/${encodeURIComponent(addr)}`);
    return r.ok;
  } catch {
    return false;
  }
}

export interface WaitForAccountOptions {
  /** Maximum wall-clock time before giving up. Default 15s. */
  maxMs?: number;
  /** Initial delay before the first re-check. Default 250ms. */
  initialDelayMs?: number;
  /** Cap on the backoff delay. Default 2000ms. */
  maxDelayMs?: number;
}

/**
 * Poll Horizon until the account is indexed, or give up after maxMs.
 * Returns true if the account became visible within the budget, false
 * otherwise.
 */
export async function waitForAccountIndexed(
  addr: string,
  opts: WaitForAccountOptions = {},
): Promise<boolean> {
  const { maxMs = 15_000, initialDelayMs = 250, maxDelayMs = 2_000 } = opts;
  const start = Date.now();
  let delay = initialDelayMs;

  // Cheap probe before sleeping — Horizon may already have it.
  if (await accountExists(addr)) return true;

  while (Date.now() - start < maxMs) {
    await new Promise((res) => setTimeout(res, delay));
    if (await accountExists(addr)) return true;
    delay = Math.min(delay * 2, maxDelayMs);
  }
  return false;
}
