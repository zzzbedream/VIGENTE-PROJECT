import { NextResponse } from "next/server";
import { fetchPaykuData } from "@/services/payku-oracle";
import { calculateCreditScore } from "@/services/scoring-engine";
import * as crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * Startup guard — fail fast at module load if the HMAC secret is missing
 * or weak. Next.js evaluates route modules on first request, so this
 * throws before any handler runs and the route returns 500 with the
 * message logged server-side. See plan appendix G.1.
 */
function requireHmacSecret(): string {
    const s = process.env.ORACLE_HMAC_SECRET;
    if (!s || s.length < 32) {
        throw new Error(
            "ORACLE_HMAC_SECRET is missing or too short (need >= 32 chars). " +
                "Set it as a Sensitive Env Var in Vercel before deploy. " +
                "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        );
    }
    return s;
}

const ORACLE_HMAC_SECRET = requireHmacSecret();

export async function GET(req: Request) {
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
            .createHmac("sha256", ORACLE_HMAC_SECRET)
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
        console.error("[oracle/score] error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}