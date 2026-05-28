/**
 * Vigente Protocol — Scoring Engine
 *
 * Motor de scoring crediticio agnóstico de fuente. Evalúa volumen,
 * consistencia y frecuencia para asignar un Tier (Gold/Silver/Bronze/None).
 *
 * Inputs aceptados:
 *   - PaykuTransaction[] (vía calculateCreditScore — original path).
 *   - ScoringMetrics ya extraídos (vía calculateScoreFromMetrics — sprint
 *     synthetic-shamir, fuentes on-chain Stellar o cualquier otra).
 *
 * El core es calculateScoreFromMetrics. Los wrappers solo extraen métricas
 * de cada fuente y delegan.
 */

import type { PaykuTransaction } from "./payku-oracle";

export interface ScoreBreakdown {
  volumePoints: number;
  consistencyPoints: number;
  frequencyPoints: number;
}

export interface ScoreResult {
  totalScore: number;
  tier: number;               // 1=Gold, 2=Silver, 3=Bronze, 4=None
  badgeType: "Gold" | "Silver" | "Bronze" | "None";
  maxLoanAmount: number;      // CLP
  breakdown: ScoreBreakdown;
}

/**
 * Métricas pre-agregadas que el engine necesita. Cualquier fuente (Payku,
 * Horizon, mocks de test) debe colapsarse en esta forma antes de scoring.
 *
 * - totalVolumeUSD: suma de USD-equivalent en la ventana evaluada (180 días).
 * - monthlyVolumesUSD: array de 6 buckets mensuales, índice 0 = mes más
 *   reciente. Mismo orden y longitud que el cálculo Payku original.
 * - completedCount: cuenta de transacciones exitosas dentro de la ventana.
 */
export interface ScoringMetrics {
  totalVolumeUSD: number;
  monthlyVolumesUSD: number[];   // length 6, index 0 = most recent month
  completedCount: number;
}

const VOLUME_TIERS = { gold: 15_000, silver: 5_000, bronze: 1_500 };
const LOAN_AMOUNTS: Record<number, number> = { 1: 10_000_000, 2: 5_000_000, 3: 2_000_000, 4: 0 };

const EMPTY_RESULT: ScoreResult = {
  totalScore: 0,
  tier: 4,
  badgeType: "None",
  maxLoanAmount: 0,
  breakdown: { volumePoints: 0, consistencyPoints: 0, frequencyPoints: 0 },
};

/**
 * Core scoring function. Pure: same metrics in → same score out.
 * Used by both Payku and on-chain adapters.
 */
export function calculateScoreFromMetrics(metrics: ScoringMetrics): ScoreResult {
  if (metrics.completedCount === 0 || metrics.totalVolumeUSD === 0) {
    return EMPTY_RESULT;
  }

  // DIM 1: Volumen (0-40 pts)
  const v = metrics.totalVolumeUSD;
  let volumePoints: number;
  if (v >= VOLUME_TIERS.gold) volumePoints = 40;
  else if (v >= VOLUME_TIERS.silver) volumePoints = 25 + Math.round(((v - VOLUME_TIERS.silver) / (VOLUME_TIERS.gold - VOLUME_TIERS.silver)) * 15);
  else if (v >= VOLUME_TIERS.bronze) volumePoints = 12 + Math.round(((v - VOLUME_TIERS.bronze) / (VOLUME_TIERS.silver - VOLUME_TIERS.bronze)) * 13);
  else volumePoints = Math.round((v / VOLUME_TIERS.bronze) * 12);

  // DIM 2: Consistencia (0-30 pts) — CV sobre 6 buckets mensuales
  const monthly = metrics.monthlyVolumesUSD;
  const activeMonths = monthly.filter((x) => x > 0).length;
  const avgMonthly = monthly.reduce((a, b) => a + b, 0) / 6;
  const variance = monthly.reduce((sum, x) => sum + Math.pow(x - avgMonthly, 2), 0) / 6;
  const cv = avgMonthly > 0 ? Math.sqrt(variance) / avgMonthly : 1;
  let consistencyPoints: number;
  if (activeMonths >= 5 && cv < 0.3) consistencyPoints = 30;
  else if (activeMonths >= 4 && cv < 0.5) consistencyPoints = 20;
  else if (activeMonths >= 3) consistencyPoints = 10;
  else consistencyPoints = Math.round(activeMonths * 3);

  // DIM 3: Frecuencia (0-30 pts)
  const txPerMonth = metrics.completedCount / 6;
  let frequencyPoints: number;
  if (txPerMonth >= 10) frequencyPoints = 30;
  else if (txPerMonth >= 5) frequencyPoints = 20;
  else if (txPerMonth >= 2) frequencyPoints = 10;
  else frequencyPoints = Math.round(txPerMonth * 5);

  const totalScore = volumePoints + consistencyPoints + frequencyPoints;
  let tier: number;
  let badgeType: ScoreResult["badgeType"];
  if (totalScore >= 80) { tier = 1; badgeType = "Gold"; }
  else if (totalScore >= 55) { tier = 2; badgeType = "Silver"; }
  else if (totalScore >= 30) { tier = 3; badgeType = "Bronze"; }
  else { tier = 4; badgeType = "None"; }

  return {
    totalScore,
    tier,
    badgeType,
    maxLoanAmount: LOAN_AMOUNTS[tier],
    breakdown: { volumePoints, consistencyPoints, frequencyPoints },
  };
}

/**
 * Original Payku entry point. Extracts metrics and delegates to
 * calculateScoreFromMetrics. Public surface preserved for back-compat with
 * existing /api/oracle/score route.
 */
export function calculateCreditScore(transactions: PaykuTransaction[]): ScoreResult {
  const completed = transactions.filter((t) => t.status === "completed");
  if (completed.length === 0) return EMPTY_RESULT;

  const totalVolumeUSD = completed.reduce((sum, t) => sum + t.amountUSD, 0);

  const monthlyVolumesUSD: number[] = [];
  for (let i = 0; i < 6; i++) {
    const monthStart = new Date(); monthStart.setMonth(monthStart.getMonth() - i - 1);
    const monthEnd = new Date(); monthEnd.setMonth(monthEnd.getMonth() - i);
    monthlyVolumesUSD.push(
      completed
        .filter((t) => { const d = new Date(t.date); return d >= monthStart && d < monthEnd; })
        .reduce((s, t) => s + t.amountUSD, 0),
    );
  }

  return calculateScoreFromMetrics({
    totalVolumeUSD,
    monthlyVolumesUSD,
    completedCount: completed.length,
  });
}