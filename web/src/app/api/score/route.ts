import { NextResponse } from "next/server";
import { fetchPaykuData, calculateTransactionStats } from "@/services/payku-oracle";
import { calculateCreditScore } from "@/services/scoring-engine";
import { Keypair, xdr, nativeToScVal, Address } from "@stellar/stellar-sdk";
import { createHmac } from "crypto";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
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
        let signature = null;
        let adminPublicKey = null;
        let signError: string | null = null;
        const hasSecret = !!process.env.ADMIN_SECRET;

        // Calculate data_hash
        const rutClean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
        const dataHash = createHmac('sha256', process.env.ADMIN_SECRET || 'fallback').update(rutClean).digest();

        if (userAddress && process.env.ADMIN_SECRET) {
            console.log("SERVER DEBUG: Signing for User:", userAddress);
            try {
                const adminKeypair = Keypair.fromSecret(process.env.ADMIN_SECRET);
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
            } catch (err: any) {
                signError = err?.message || String(err);
                console.error("Signing error:", signError);
            }
        }

        return NextResponse.json({
            found: true,
            rut: rut || "N/A",
            _debug: { hasSecret, hasUserAddress: !!userAddress, signError },
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
                dataHash: dataHash.toString('hex')
            },
            stats: {
                monthlyVolume: stats.avgPerMonth,
                historyMonths: Number((stats.oldestTransactionDays / 30).toFixed(1)),
                totalTransactions: stats.transactionCount
            },
            // Transacciones para el gráfico
            history: oracleResponse.transactions.map((tx: any) => ({
                date: tx.date,
                amount: tx.amountUSD,
                amountUSD: tx.amountUSD,
                amountCLP: tx.amountCLP,
                status: tx.status
            }))
        });

    } catch (error: any) {
        console.error("Scoring API Error:", error);
        return NextResponse.json({
            error: "Failed to calculate score",
            message: "There was an error processing your request. Please try again.",
            details: error.message
        }, { status: 500 });
    }
}