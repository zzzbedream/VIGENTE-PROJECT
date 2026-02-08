import { NextResponse } from "next/server";
import {
    fetchOracleData,
    calculateTransactionStats
} from "../../../services/moneygram-oracle";
import { calculateCreditScore } from "../../../services/scoring-engine";
import { Keypair, xdr, nativeToScVal, Address } from "@stellar/stellar-sdk";
import { createHmac } from "crypto";

export const dynamic = 'force-dynamic'; // Ensure endpoint is not cached eagerly

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const rut = searchParams.get("rut");

        // Si se pasa directo el userId (para debug), lo usamos.
        // Si no, mapeamos el RUT a un usuario mock para la demo.
        let userId = searchParams.get("userId");

        if (!userId && rut) {
            // DEMO MAPPING LOGIC
            // Digito verificador o último número decide el Tier
            const cleanRut = rut.replace(/[^0-9kK]/g, '').toUpperCase();
            const lastDigit = cleanRut.slice(-1);

            if (lastDigit === '1' || lastDigit === 'K') {
                userId = 'user_tier_a'; // Tier A (RUT termina en 1 o K)
            } else if (lastDigit === '2') {
                userId = 'user_tier_b'; // Tier B (RUT termina en 2)
            } else if (lastDigit === '9') {
                userId = 'user_fail';   // Fail (RUT termina en 9)
            } else {
                // Default a Tier C para otros casos
                userId = 'user_tier_b'; // Cambiado de user_tier_c_mock a user_tier_b para que siempre tenga datos
            }
        }

        if (!userId) {
            return NextResponse.json({ error: "RUT or userId required" }, { status: 400 });
        }

        // 1. Fetch Data from Oracle Service
        const oracleResponse = await fetchOracleData(userId);

        if (!oracleResponse || !oracleResponse.transactions || oracleResponse.transactions.length === 0) {
            // User not found or no transactions - return a friendly message instead of 404
            return NextResponse.json({
                found: false,
                message: "No financial history found for this user. Try RUT ending in 1, 2, or 3 for demo.",
                rut: rut || "N/A"
            }, { status: 200 }); // Changed to 200 to avoid error UI
        }

        // 2. Run Scoring Engine with error handling
        let scoreResult;
        try {
            scoreResult = calculateCreditScore(oracleResponse.transactions);
        } catch (scoringError: any) {
            console.error("Scoring engine error:", scoringError);
            // Return a default fail score instead of crashing
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
        // 3. GENERATE ORACLE SIGNATURE (NEW)
        // ---------------------------------------------------------------------
        const userAddress = searchParams.get("userAddress");
        let signature = null;
        let adminPublicKey = null;
        let signError: string | null = null;
        const hasSecret = !!process.env.ADMIN_SECRET;

        // Calculate data_hash outside try block so it's accessible in response
        const rutClean = rut!.replace(/[^0-9kK]/g, '').toUpperCase();
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

                // Build SCAddress XDR matching contract's user.to_xdr() EXACTLY
                // Contract does: user.to_xdr() which produces SCAddress XDR (not ScVal wrapped)
                const address = Address.fromString(userAddress);
                const scAddress = address.toScAddress();
                const scAddressXdr = scAddress.toXDR('raw');

                console.log('=== PAYLOAD HEX DEBUG ===');
                console.log('User address:', userAddress);
                console.log('scAddressXdr:', scAddressXdr.toString('hex'));
                console.log('scAddressXdr length:', scAddressXdr.length);
                console.log('tierBuf:', tierBuf.toString('hex'));
                console.log('scoreBuf:', scoreBuf.toString('hex'));
                console.log('dataHash:', dataHash.toString('hex'));

                const payload = Buffer.concat([
                    scAddressXdr, // SCAddress XDR - same as Rust's user.to_xdr()
                    tierBuf,
                    scoreBuf,
                    dataHash
                ]);

                console.log('FULL PAYLOAD:', payload.toString('hex'));
                console.log('PAYLOAD LENGTH:', payload.length);

                signature = adminKeypair.sign(payload).toString('hex');
                console.log('SIGNATURE:', signature);
            } catch (err: any) {
                signError = err?.message || String(err);
                console.error("Signing error:", signError);
            }
        }

        return NextResponse.json({
            found: true,
            rut: rut || "N/A",
            _debug: { hasSecret, hasUserAddress: !!userAddress, signError },
            moneyGramId: oracleResponse.user.id,
            profile: {
                name: oracleResponse.user.name,
                country: oracleResponse.user.country,
                kycLevel: oracleResponse.user.kycLevel
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
                // Return signature and dataHash for minting
                signature,
                adminPublicKey,
                dataHash: dataHash.toString('hex') // Return hex string for frontend
            },
            stats: {
                monthlyVolume: stats.avgPerMonth,
                historyMonths: Number((stats.oldestTransactionDays / 30).toFixed(1)),
                totalTransactions: stats.transactionCount
            },
            // Devolvemos las transacciones para el gráfico
            history: oracleResponse.transactions.map(tx => ({
                date: tx.date,
                amount: tx.amountUSD,
                status: tx.status
            }))
        });

    } catch (error: any) {
        console.error("Scoring API Error:", error);
        // Return a more user-friendly error instead of generic 500
        return NextResponse.json({
            error: "Failed to calculate score",
            message: "There was an error processing your request. Please try again.",
            details: error.message
        }, { status: 500 });
    }
}
