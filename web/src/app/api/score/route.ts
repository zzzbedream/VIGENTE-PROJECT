import { NextResponse } from "next/server";
import {
    fetchOracleData,
    calculateTransactionStats
} from "../../../services/moneygram-oracle";
import { calculateCreditScore } from "../../../services/scoring-engine";

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
                // Default a Tier C para otros casos, o vacío
                userId = 'user_tier_c_mock'; // (El fallback del servicio devolverá empty array si no existe este ID, manejaremos eso)
            }
        }

        if (!userId) {
            return NextResponse.json({ error: "RUT or userId required" }, { status: 400 });
        }

        // 1. Fetch Data from Oracle Service
        const oracleResponse = await fetchOracleData(userId);

        if (!oracleResponse) {
            // User not found in MoneyGram (or mock)
            return NextResponse.json({
                found: false,
                message: "No financial history found for this user."
            }, { status: 404 });
        }

        // 2. Run Scoring Engine
        // Usamos el nuevo motor de scoring dedicado
        const scoreResult = calculateCreditScore(oracleResponse.transactions);

        // Stats básicos para mostrar en UI además del score
        const stats = calculateTransactionStats(oracleResponse.transactions);

        return NextResponse.json({
            found: true,
            rut: rut || "N/A",
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
                        scoreResult.tier === 3 ? "FAIR" : "INSUFFICIENT"
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
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
