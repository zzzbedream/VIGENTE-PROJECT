import { NextResponse } from "next/server";
import { fetchPaykuData } from "@/services/payku-oracle";
import { calculateCreditScore } from "@/services/scoring-engine";
import * as crypto from "crypto";
import { guardApiRequest, genericErrorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * Lazy fail-fast guard — fail at the first REQUEST if the HMAC secret is
 * missing or weak. Originally a module-load throw (G.1), but Vercel's
 * build collects page data by importing each route module, which broke
 * the build when the env var wasn't set yet. Lazy keeps the same
 * security posture (no request signed without a real secret) without
 * blocking the build.
 */
let cachedHmacSecret: string | null = null;
function getHmacSecret(): string {
    if (cachedHmacSecret !== null) return cachedHmacSecret;
    const s = process.env.ORACLE_HMAC_SECRET;
    if (!s || s.length < 32) {
        throw new Error(
            "ORACLE_HMAC_SECRET is missing or too short (need >= 32 chars). " +
                "Set it as a Sensitive Env Var in Vercel before deploy. " +
                "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        );
    }
    cachedHmacSecret = s;
    return s;
}

export async function GET(req: Request) {
    // G.2: read-only Payku-backed scoring — permissive limit (30/min) for
    // the demo UI, blocks anonymous cross-origin spam.
    const blocked = guardApiRequest(req, { limit: 30 });
    if (blocked) return blocked;

    try {
        const { searchParams } = new URL(req.url);
        const rut = searchParams.get("rut") || searchParams.get("userId");

        if (!rut) {
            return NextResponse.json({ error: "rut is required" }, { status: 400 });
        }

        const oracleResponse = await fetchPaykuData(rut);

        if (!oracleResponse || !oracleResponse.transactions || oracleResponse.transactions.length === 0) {
            return NextResponse.json({
                found: false,
                message: "Sin historial transaccional en Payku para este RUT.",
            });
        }

        const scoreResult = calculateCreditScore(oracleResponse.transactions);

        const payloadStart = `${rut}:${scoreResult.totalScore}:${scoreResult.tier}`;
        const signature = crypto
            .createHmac("sha256", getHmacSecret())
            .update(payloadStart)
            .digest("hex");

        return NextResponse.json({
            found: true,

            profile: {
                id: oracleResponse.merchant.id,
                name: oracleResponse.merchant.name,
                country: oracleResponse.merchant.country,
                kycLevel: oracleResponse.merchant.kycLevel,
                registeredAt: oracleResponse.merchant.registeredAt,
            },

            scoring: {
                totalScore: scoreResult.totalScore,
                tier: scoreResult.tier,
                badgeType: scoreResult.badgeType,
                maxLoanAmount: scoreResult.maxLoanAmount,
                breakdown: scoreResult.breakdown,
            },

            history: oracleResponse.transactions.map((tx: any) => ({
                date: tx.date,
                amount: tx.amountUSD,
                amountUSD: tx.amountUSD,
                amountCLP: tx.amountCLP,
                status: tx.status,
                type: tx.type,
                paymentMethod: tx.paymentMethod,
            })),

            oracleSignature: signature,
            timestamp: new Date().toISOString(),
        });

    } catch (error: unknown) {
        // Full detail server-side, generic message to client. The startup
        // guard re-throws here as well, so the absence of ORACLE_HMAC_SECRET
        // surfaces as a 500 with a clear log entry on the first request.
        return genericErrorResponse("oracle/score", error, 500);
    }
}