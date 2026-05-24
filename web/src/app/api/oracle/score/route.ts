import { NextResponse } from "next/server";
import { fetchPaykuData, calculateTransactionStats } from "@/services/payku-oracle";
import { calculateCreditScore } from "@/services/scoring-engine";
import * as crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const rut = searchParams.get("rut") || searchParams.get("userId");

        if (!rut) {
            return NextResponse.json({ error: "rut is required" }, { status: 400 });
        }

        // 1. Obtener datos del Oráculo (Payku)
        const oracleResponse = await fetchPaykuData(rut);

        if (!oracleResponse || !oracleResponse.transactions || oracleResponse.transactions.length === 0) {
            return NextResponse.json({
                found: false,
                message: "Sin historial transaccional en Payku para este RUT."
            });
        }

        // 2. Calcular Score & Tier
        const scoreResult = calculateCreditScore(oracleResponse.transactions);

        // Stats básicos para el UI
        const basicStats = calculateTransactionStats(oracleResponse.transactions);

        // 3. Generar Firma Mock (Simulando firma ed25519 del oráculo)
        const payloadStart = `${rut}:${scoreResult.totalScore}:${scoreResult.tier}`;
        const signature = crypto.createHmac('sha256', 'oracle-secret-key-mock')
            .update(payloadStart)
            .digest('hex');

        // 4. Construir Respuesta
        return NextResponse.json({
            found: true,

            // Merchant Profile (Payku)
            profile: {
                id: oracleResponse.merchant.id,
                name: oracleResponse.merchant.name,
                country: oracleResponse.merchant.country,
                kycLevel: oracleResponse.merchant.kycLevel,
                registeredAt: oracleResponse.merchant.registeredAt
            },

            // Scoring Result
            scoring: {
                totalScore: scoreResult.totalScore,
                tier: scoreResult.tier,
                badgeType: scoreResult.badgeType,
                maxLoanAmount: scoreResult.maxLoanAmount,
                breakdown: scoreResult.breakdown
            },

            // Transaction History (para gráficos)
            history: oracleResponse.transactions.map((tx: any) => ({
                date: tx.date,
                amount: tx.amountUSD,
                amountUSD: tx.amountUSD,
                amountCLP: tx.amountCLP,
                status: tx.status,
                type: tx.type,
                paymentMethod: tx.paymentMethod
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