import { NextResponse } from "next/server";
import { fetchPaykuData, calculateTransactionStats } from "@/services/payku-oracle";
import { calculateCreditScore } from "@/services/scoring-engine";
import { Keypair, Address } from "@stellar/stellar-sdk";
import { createHmac } from "crypto";
import { guardApiRequest, genericErrorResponse } from "@/lib/api-guard";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    // G.2: read + sign (no on-chain submit) — permissive limit.
    const blocked = guardApiRequest(req, { limit: 30 });
    if (blocked) return blocked;

    try {
        const { searchParams } = new URL(req.url);
        const rut = searchParams.get("rut");
        const userAddress = searchParams.get("userAddress");

        if (!rut) {
            return NextResponse.json({ error: "RUT required (?rut=76.543.210-K)" }, { status: 400 });
        }

        // 1. Fetch Data from Payku Oracle
        const oracleResponse = await fetchPaykuData(rut);

        if (!oracleResponse || !oracleResponse.transactions || oracleResponse.transactions.length === 0) {
            return NextResponse.json({
                found: false,
                message: "Sin historial transaccional en Payku. Intenta RUT terminado en 1, K, 2 o 9 para demo.",
                rut: rut || "N/A"
            }, { status: 200 });
        }

        // 2. Run Scoring Engine with error handling
        let scoreResult;
        try {
            scoreResult = calculateCreditScore(oracleResponse.transactions);
        } catch (scoringError: any) {
            console.error("Scoring engine error:", scoringError);
            scoreResult = {
                totalScore: 0,
                tier: 4,
                badgeType: "None" as const,
                maxLoanAmount: 0,
                breakdown: { volumePoints: 0, consistencyPoints: 0, frequencyPoints: 0 }
            };
        }

        // Stats básicos para mostrar en UI además del score
        const stats = calculateTransactionStats(oracleResponse.transactions);

        // ---------------------------------------------------------------------
        // 3. GENERATE ORACLE SIGNATURE
        // ---------------------------------------------------------------------
        // G.1 collateral: removed the `process.env.ADMIN_SECRET || 'fallback'`
        // path. If ADMIN_SECRET is missing the dataHash is simply null and
        // the response carries no signature material — the predictable
        // 'fallback' string is gone entirely. The only HMAC key accepted is
        // the real ADMIN_SECRET set at deploy time.
        let signature: string | null = null;
        let adminPublicKey: string | null = null;
        let dataHashHex: string | null = null;
        const adminSecret = process.env.ADMIN_SECRET;

        if (adminSecret && userAddress) {
            try {
                const rutClean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
                const dataHash = createHmac('sha256', adminSecret).update(rutClean).digest();
                dataHashHex = dataHash.toString('hex');

                const adminKeypair = Keypair.fromSecret(adminSecret);
                adminPublicKey = adminKeypair.publicKey();

                const tierBuf = Buffer.alloc(4);
                tierBuf.writeUInt32BE(scoreResult.tier);
                const scoreBuf = Buffer.alloc(4);
                scoreBuf.writeUInt32BE(scoreResult.totalScore);

                const address = Address.fromString(userAddress);
                const scAddress = address.toScAddress();
                const scAddressXdr = scAddress.toXDR('raw');

                const payload = Buffer.concat([
                    scAddressXdr,
                    tierBuf,
                    scoreBuf,
                    dataHash
                ]);

                signature = adminKeypair.sign(payload).toString('hex');
            } catch (err) {
                // Log server-side, never leak the reason to the client. Falling
                // through with signature=null surfaces as "unsigned response"
                // to the UI without exposing why.
                console.error("[score] signing error:", err);
            }
        }

        // G.5: dropped the `_debug` field — it leaked `hasSecret`, `signError`
        // and server-side state to anonymous callers. The response now
        // carries only legitimate signed payload fields. dataHash is only
        // present when ADMIN_SECRET is configured AND userAddress is supplied
        // (i.e. when the signature is meaningful).
        return NextResponse.json({
            found: true,
            rut: rut || "N/A",
            paykuMerchantId: oracleResponse.merchant.id,
            profile: {
                name: oracleResponse.merchant.name,
                country: oracleResponse.merchant.country,
                kycLevel: oracleResponse.merchant.kycLevel
            },
            scoring: {
                score: scoreResult.totalScore,
                tier: scoreResult.tier,
                tierLabel: scoreResult.badgeType === "None" ? "D" : scoreResult.badgeType === "Gold" ? "A" : scoreResult.badgeType === "Silver" ? "B" : "C",
                badgeType: scoreResult.badgeType,
                maxLoanAmount: scoreResult.maxLoanAmount,
                breakdown: scoreResult.breakdown,
                capability: scoreResult.tier === 1 ? "EXCELLENT" :
                    scoreResult.tier === 2 ? "GOOD" :
                        scoreResult.tier === 3 ? "FAIR" : "INSUFFICIENT",
                signature,
                adminPublicKey,
                dataHash: dataHashHex
            },
            stats: {
                monthlyVolume: stats.avgPerMonth,
                historyMonths: Number((stats.oldestTransactionDays / 30).toFixed(1)),
                totalTransactions: stats.transactionCount
            },
            history: oracleResponse.transactions.map((tx: any) => ({
                date: tx.date,
                amount: tx.amountUSD,
                amountUSD: tx.amountUSD,
                amountCLP: tx.amountCLP,
                status: tx.status
            }))
        });

    } catch (error: unknown) {
        return genericErrorResponse("score", error, 500);
    }
}