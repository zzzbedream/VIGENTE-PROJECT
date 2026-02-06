import { NextResponse } from "next/server";
import {
    fetchOracleData,
    calculateTransactionStats
} from "../../../../services/moneygram-oracle";
import {
    calculateCreditScore
} from "../../../../services/scoring-engine";
import * as crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const rut = searchParams.get("rut") || searchParams.get("userId");

        if (!rut) {
            return NextResponse.json({ error: "rut is required" }, { status: 400 });
        }

        // 1. Obtener datos del Oráculo (MoneyGram)
        const oracleResponse = await fetchOracleData(rut);

        if (!oracleResponse) {
            // Retornamos 200 pero indicando que no hay datos,
            // para que el frontend pueda manejar el estado "Sin historial" elegantemente
            return NextResponse.json({
                found: false,
                message: "User not found or no transaction history."
            });
        }

        // 2. Calcular Score & Tier
        const scoreResult = calculateCreditScore(oracleResponse.transactions);

        // Stats básicos para el UI
        const basicStats = calculateTransactionStats(oracleResponse.transactions);

        // 3. Generar Firma Mock (Simulando firma ed25519 del oráculo)
        // En producción esto sería el firmado real con la llave privada del Oráculo
        const payloadStart = `${rut}:${scoreResult.totalScore}:${scoreResult.tier}`;
        const signature = crypto.createHmac('sha256', 'oracle-secret-key-mock')
            .update(payloadStart)
            .digest('hex');

        // 4. Construir Respuesta
        return NextResponse.json({
            found: true,

            // User Profile
            profile: {
                id: oracleResponse.user.id,
                name: oracleResponse.user.name,
                country: oracleResponse.user.country,
                kycLevel: oracleResponse.user.kycLevel,
                registeredAt: oracleResponse.user.registeredAt
            },

            // Scoring Result
            scoring: {
                totalScore: scoreResult.totalScore,
                tier: scoreResult.tier,        // 1-4
                badgeType: scoreResult.badgeType, // Gold, Silver, Bronze, None
                maxLoanAmount: scoreResult.maxLoanAmount,
                breakdown: scoreResult.breakdown
            },

            // Transaction History (para gráficos)
            history: oracleResponse.transactions.map(tx => ({
                date: tx.date,
                amount: tx.amountUSD,
                status: tx.status,
                recipientCountry: tx.recipientCountry
            })),

            // Oracle Signature (para verificación on-chain futura)
            oracleSignature: signature,
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        console.error("Oracle Score API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
