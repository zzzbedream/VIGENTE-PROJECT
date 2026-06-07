/**
 * Vigente Protocol — env-aware logger (Phase G.4)
 *
 * Two truths that this module enforces:
 *
 *   1. On the server we ALWAYS log. The output goes to the Vercel
 *      function log stream where it stays useful for debugging and
 *      never leaks to a user. Drop nothing.
 *
 *   2. In the browser we log only in development. In production builds
 *      the console is silent because (a) end users should not see
 *      protocol internals, (b) wallet kit / RPC errors otherwise stream
 *      to the devtools console of every visitor, and (c) some of those
 *      messages used to disclose detail useful to an attacker.
 *
 * Replaces direct `console.log/warn/error` calls across the web/ tree.
 * The `scope` string prefixes each line so server logs grep cleanly.
 */

const isServer = typeof window === "undefined";
const isDev = process.env.NODE_ENV !== "production";

/** Server always speaks; browser only in dev. */
function shouldLog(): boolean {
  return isServer || isDev;
}

export const logger = {
  info(scope: string, ...args: unknown[]): void {
    if (shouldLog()) {
      // eslint-disable-next-line no-console -- sole sink for application logs
      console.log(`[${scope}]`, ...args);
    }
  },
  warn(scope: string, ...args: unknown[]): void {
    if (shouldLog()) {
      // eslint-disable-next-line no-console
      console.warn(`[${scope}]`, ...args);
    }
  },
  error(scope: string, ...args: unknown[]): void {
    if (shouldLog()) {
      // eslint-disable-next-line no-console
      console.error(`[${scope}]`, ...args);
    }
  },
};
