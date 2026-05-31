/**
 * Vigente Protocol — Threshold Sign API (B.6)
 *
 * POST /api/oracle/sign-threshold
 * Body: { borrower: string, score: number, expiration: string|number, nonce?: string }
 *
 * Returns a SignedMintRequest with k-of-n ed25519 signatures over the canonical
 * mint message. The frontend hands this payload to a relayer (or Freighter)
 * to assemble the Soroban transaction calling vigente-badge.mint() in Phase C.
 *
 * Security note: this endpoint MUST not exist in mainnet form. The threshold
 * oracle nodes are intended to run as independent processes; here they are
 * co-located for sprint demonstration. The SCF resubmission documents this
 * trade-off explicitly under docs/THREAT_MODEL.md (post-B').
 */

import { NextResponse } from "next/server";
import {
  buildSignedMintRequest,
  freshNonce,
  getOraclePubkeys,
  ORACLE_COUNT,
  ORACLE_THRESHOLD,
} from "@/services/threshold-oracle";

const PUBKEY_RE = /^G[A-Z2-7]{55}$/;

function badRequest(detail: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: detail, ...extra }, { status: 400 });
}

function parseExpiration(raw: unknown): bigint | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return BigInt(Math.floor(raw));
  }
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    try {
      const v = BigInt(raw);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseNonce(raw: unknown): Buffer | null {
  if (raw == null) return freshNonce();
  if (typeof raw !== "string") return null;
  const trimmed = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) return null;
  return Buffer.from(trimmed, "hex");
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const borrower = typeof body.borrower === "string" ? body.borrower.trim() : "";
  if (!borrower) return badRequest("missing required field: borrower");
  if (!PUBKEY_RE.test(borrower)) return badRequest("invalid Stellar pubkey format for borrower");

  const score = typeof body.score === "number" ? body.score : NaN;
  if (!Number.isInteger(score) || score < 0 || score > 1000) {
    return badRequest("score must be an integer in [0, 1000]");
  }

  const expiration = parseExpiration(body.expiration);
  if (expiration === null) return badRequest("expiration must be a positive integer (seconds since epoch)");

  const ageRaw = body.accountAgeDays ?? body.account_age_days;
  if (typeof ageRaw !== "number" || !Number.isInteger(ageRaw) || ageRaw < 0 || ageRaw > 0xffff_ffff) {
    return badRequest("accountAgeDays must be a non-negative integer fitting in u32");
  }
  const accountAgeDays = ageRaw;

  const nonce = parseNonce(body.nonce);
  if (nonce === null) return badRequest("nonce must be a 32-byte hex string (with or without 0x prefix)");

  try {
    const signed = buildSignedMintRequest(borrower, score, expiration, accountAgeDays, nonce);
    return NextResponse.json(signed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "signing failed", detail: msg },
      { status: 500 },
    );
  }
}

/**
 * GET /api/oracle/sign-threshold
 * Returns oracle configuration (pubkeys + threshold). Used by the deploy
 * script to call `set_oracle_keys` with the same pubkeys the signing endpoint
 * will produce signatures for.
 */
export async function GET() {
  const pubkeys = getOraclePubkeys().map((b) => b.toString("hex"));
  return NextResponse.json({
    threshold: ORACLE_THRESHOLD,
    oracleCount: ORACLE_COUNT,
    pubkeysHex: pubkeys,
  });
}
