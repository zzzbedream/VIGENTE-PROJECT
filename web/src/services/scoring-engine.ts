// =============================================================================
// SCORING ENGINE - Vigente Protocol
// =============================================================================
// 
// Motor de decisión crediticia basado en historial de remesas.
// Implementa el algoritmo de 3 factores: Volumen, Consistencia y Frecuencia.
// 
// Rango total: 0 - 1000 Pts
// =============================================================================

import { MoneyGramTransaction } from "./moneygram-oracle";

export interface CreditScoreResult {
    totalScore: number;      // 0-1000
    tier: number;            // 1=A, 2=B, 3=C, 4=Fail
    badgeType: "Gold" | "Silver" | "Bronze" | "None";
    maxLoanAmount: number;   // Monto máximo sugerido en USDC
    breakdown: {             // Detalle de puntos para UI
        volumePoints: number;
        consistencyPoints: number;
        frequencyPoints: number;
    };
}

/**
 * Calcula el Score Crediticio basado en transacciones de remesas.
 * 
 * @param transactions - Historial de transacciones del usuario
 * @param periodMonths - (Opcional) Período de análisis en meses, default 6
 */
export function calculateCreditScore(
    transactions: MoneyGramTransaction[],
    periodMonths: number = 6
): CreditScoreResult {

    // 0. Si no hay datos suficiente
    if (!transactions || transactions.length === 0) {
        return {
            totalScore: 0,
            tier: 4,
            badgeType: "None",
            maxLoanAmount: 0,
            breakdown: { volumePoints: 0, consistencyPoints: 0, frequencyPoints: 0 }
        };
    }

    // ---------------------------------------------------------------------------
    // 1. ANÁLISIS DE DATOS
    // ---------------------------------------------------------------------------

    const now = new Date();
    const periodStart = new Date();
    periodStart.setMonth(now.getMonth() - periodMonths);

    // Filtrar transacciones dentro del período de análisis
    const recentTx = transactions.filter(tx => new Date(tx.date) >= periodStart);

    // Calcular métricas base
    const totalVolume = recentTx.reduce((sum, tx) => sum + tx.amountUSD, 0);
    const avgMonthlyVolume = totalVolume / periodMonths;
    const transactionCount = recentTx.length;

    // Analizar consistencia (meses únicos con actividad)
    const activeMonths = new Set(
        recentTx.map(tx => {
            const d = new Date(tx.date);
            return `${d.getFullYear()}-${d.getMonth()}`;
        })
    ).size;

    // ---------------------------------------------------------------------------
    // 2. ALGORITMO DE SCORING
    // ---------------------------------------------------------------------------

    // A. VOLUMEN (Máx 400 pts)
    // Evalúa capacidad de pago basada en flujo mensual
    let volumePoints = 0;
    if (avgMonthlyVolume > 500) {
        volumePoints = 400;
    } else if (avgMonthlyVolume > 300) {
        volumePoints = 250;
    } else if (avgMonthlyVolume >= 100) {
        // Escala lineal entre $100 y $300: 50 pts base + prop
        volumePoints = 50 + Math.floor(((avgMonthlyVolume - 100) / 200) * 150);
    } else {
        volumePoints = 50;
    }

    // B. CONSISTENCIA (Máx 300 pts)
    // Evalúa regularidad de envíos (proxy de estabilidad laboral)
    let consistencyPoints = 0;
    // Threshold: al menos 4 de los últimos 6 meses (66% del tiempo)
    const consistencyRate = activeMonths / periodMonths;

    if (consistencyRate >= 0.66) { // Ejemplo: 4 de 6 meses
        consistencyPoints = 300;
    } else if (consistencyRate >= 0.5) { // 3 de 6 meses
        consistencyPoints = 200;
    } else {
        consistencyPoints = 100;
    }

    // C. FRECUENCIA (Máx 300 pts)
    // Evalúa uso del servicio (fidelidad y puntos de data)
    let frequencyPoints = 0;
    if (transactionCount > 10) {
        frequencyPoints = 300;
    } else if (transactionCount >= 5) {
        frequencyPoints = 200;
    } else {
        frequencyPoints = 100;
    }

    // SCORE FINAL
    const totalScore = volumePoints + consistencyPoints + frequencyPoints;

    // ---------------------------------------------------------------------------
    // 3. DETERMINACIÓN DE TIER Y BENEFICIOS
    // ---------------------------------------------------------------------------

    let tier = 4;
    let badgeType: "Gold" | "Silver" | "Bronze" | "None" = "None";
    let maxLoanAmount = 0;

    if (totalScore >= 800) {
        tier = 1; // Tier A
        badgeType = "Gold";
        maxLoanAmount = 500;
    } else if (totalScore >= 500) {
        tier = 2; // Tier B
        badgeType = "Silver";
        maxLoanAmount = 300;
    } else if (totalScore >= 300) {
        tier = 3; // Tier C
        badgeType = "Bronze";
        maxLoanAmount = 100;
    } else {
        tier = 4; // Fail
        badgeType = "None";
        maxLoanAmount = 0;
    }

    return {
        totalScore,
        tier,
        badgeType,
        maxLoanAmount,
        breakdown: {
            volumePoints,
            consistencyPoints,
            frequencyPoints
        }
    };
}
