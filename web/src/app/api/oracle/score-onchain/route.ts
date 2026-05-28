/**
 * Vigente Protocol — On-Chain Synthetic Score API
 *
 * GET /api/oracle/score-onchain?pubkey=GA...
 *
 * Returns a credit score derived from Stellar Horizon data only. No fintech
 * dependency. Caches results per pubkey for 5 minutes to keep Horizon out of
 * rate-limit territory when 50 synthetic profiles + reviewers + reloads hit
 * the endpoint simultaneously.
 *
 * Cache: in-memory Map scoped to the Next.js server process. Sufficient for
 * this sprint; swap to Redis in Tranche 2 if multi-instance deploy.
 */

import { NextResponse } from "next/server";
import { scoreFromStellar, type OnchainScoreResult } from "@/services/horizon-scoring";

const CACHE_TTL_MS = 5 * 60 * 1000;
const PUBKEY_RE = /^G[A-Z2-7]{55}$/;

interface CacheEntry {
  result: OnchainScoreResult;
  expires_at: number;
}

// One cache instance per Node process. Survives across requests until the
// process restarts (Vercel cold start or local dev reload).
const cache = new Map<string, CacheEntry>();

function isValidPubkey(input: string): boolean {
  return PUBKEY_RE.test(input);
}

function readCache(pubkey: string): OnchainScoreResult | null {
  const entry = cache.get(pubkey);
  if (!entry) return null;
  if (Date.now() > entry.expires_at) {
    cache.delete(pubkey);
    return null;
  }
  return entry.result;
}

function writeCache(pubkey: string, result: OnchainScoreResult): void {
  cache.set(pubkey, {
    result,
    expires_at: Date.now() + CACHE_TTL_MS,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pubkey = url.searchParams.get("pubkey")?.trim() ?? "";

  if (!pubkey) {
    return NextResponse.json(
      { error: "missing required query param: pubkey" },
      { status: 400 },
    );
  }
  if (!isValidPubkey(pubkey)) {
    return NextResponse.json(
      { error: "invalid Stellar pubkey format (expected G... ed25519 strkey)" },
      { status: 400 },
    );
  }

  const cached = readCache(pubkey);
  if (cached) {
    return NextResponse.json({
      ...cached,
      cache_hit: true,
    });
  }

  try {
    const result = await scoreFromStellar(pubkey);
    writeCache(pubkey, result);
    return NextResponse.json({
      ...result,
      cache_hit: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Horizon "Resource Missing" → account does not exist
    if (msg.includes("404") || msg.includes("Resource Missing") || msg.includes("Not Found")) {
      return NextResponse.json(
        { error: "account not found on Stellar testnet", pubkey, cache_hit: false },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "horizon fetch failed", detail: msg, pubkey, cache_hit: false },
      { status: 502 },
    );
  }
}
