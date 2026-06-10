/**
 * Vigente Protocol — API guard (Phase G.2)
 *
 * Two-layer protection for any route that mutates on-chain state or
 * touches paid resources (mother account XLM, Soroban RPC budget):
 *
 *   1. Webhook secret — server-to-server callers MUST present
 *      `x-webhook-secret: $VIGENTE_WEBHOOK_SECRET`. If they do, the
 *      guard waves them through with no further checks.
 *
 *   2. Same-origin allow — browser-driven calls from our own landing /
 *      app pass the gate without the secret (they couldn't carry it
 *      without leaking it). All other origins (anonymous curl, third
 *      parties) are blocked with 401.
 *
 *   3. Rate limit — every request that passes (1) or (2) is metered by
 *      client IP. Default 5 req/min. Returns 429 with Retry-After.
 *
 * Storage is an in-process Map. Vercel functions are ephemeral, so this
 * resets on cold starts — that is acceptable for sprint scope. Vercel KV
 * is the documented upgrade path for cross-instance counting.
 */

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

const WEBHOOK_SECRET = process.env.VIGENTE_WEBHOOK_SECRET ?? "";
const SITE_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://vigente-hackathon-final.vercel.app"
).replace(/\/$/, "");

interface Bucket {
  count: number;
  resetAt: number;
}

const BUCKETS = new Map<string, Bucket>();
const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_MS = 60_000;
/** Cap the in-memory map so a malicious caller can't blow up memory by
 * cycling IPs. We sweep stale buckets when we cross the cap. */
const MAX_BUCKETS = 10_000;

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function sweepStale(now: number): void {
  if (BUCKETS.size < MAX_BUCKETS) return;
  for (const [k, b] of BUCKETS) {
    if (b.resetAt <= now) BUCKETS.delete(k);
  }
}

export interface GuardOptions {
  /** Allow same-origin browser callers without the webhook secret. Default true. */
  allowSameOrigin?: boolean;
  /** Per-window request cap. Default 5. */
  limit?: number;
  /** Window length in ms. Default 60_000. */
  windowMs?: number;
}

/**
 * Returns null when the request is allowed. Returns a ready-to-return
 * NextResponse (401 or 429) when it should be blocked.
 */
export function guardApiRequest(
  req: Request,
  opts: GuardOptions = {},
): NextResponse | null {
  const {
    allowSameOrigin = true,
    limit = DEFAULT_LIMIT,
    windowMs = DEFAULT_WINDOW_MS,
  } = opts;

  // 1. Webhook gate
  const provided = req.headers.get("x-webhook-secret") ?? "";
  const webhookOk = WEBHOOK_SECRET.length > 0 && safeEqual(provided, WEBHOOK_SECRET);

  // 2. Same-origin allow (only relevant when webhook absent)
  let authorised = webhookOk;
  if (!webhookOk && allowSameOrigin) {
    authorised = isSameOriginCaller(req);
  }

  if (!authorised) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Rate limit by IP
  const ip = getClientIp(req);
  const now = Date.now();
  sweepStale(now);

  const bucket = BUCKETS.get(ip);
  if (!bucket || now > bucket.resetAt) {
    BUCKETS.set(ip, { count: 1, resetAt: now + windowMs });
    return null;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  return null;
}

function isSameOriginCaller(req: Request): boolean {
  const origin = (req.headers.get("origin") ?? "").replace(/\/$/, "");
  const referer = req.headers.get("referer") ?? "";

  // Server-side fetches (RSC, internal Next.js calls) often arrive with no
  // origin header — treat those as same-origin since they can't have crossed
  // a public boundary.
  if (!origin && !referer) return true;

  // True same-origin: compare against the host this request actually hit
  // (via the proxy-aware headers Vercel sets). This works on the production
  // domain, preview deployments, and localhost without any env var — and it
  // survives a misconfigured NEXT_PUBLIC_SITE_URL, which 401'd legit users
  // in production once already.
  const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const fwdProto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  if (fwdHost) {
    const self = `${fwdProto}://${fwdHost}`;
    if (origin === self || referer.startsWith(self + "/")) {
      return true;
    }
  }

  // Canonical site URL as an extra allowlist entry (covers e.g. a custom
  // domain fronting the deployment under a different Host).
  if (SITE_ORIGIN && (origin === SITE_ORIGIN || referer.startsWith(SITE_ORIGIN + "/"))) {
    return true;
  }

  // Dev: localhost on any port, any scheme.
  if (
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    referer.startsWith("http://localhost:") ||
    referer.startsWith("http://127.0.0.1:")
  ) {
    return true;
  }

  return false;
}

/** Constant-time string comparison for the webhook secret check. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Standard catch-block helper. Logs the full error server-side, returns
 * a generic message to the client. Matches the pattern in G.2 of the plan.
 */
export function genericErrorResponse(
  scope: string,
  err: unknown,
  status: number = 500,
): NextResponse {
  logger.error(scope, "error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status });
}

/** Exposed for tests only. */
export const __testing = {
  resetBuckets: () => BUCKETS.clear(),
  bucketCount: () => BUCKETS.size,
};
