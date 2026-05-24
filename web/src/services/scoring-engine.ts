/**
 * Vigente Protocol — Scoring Engine
 * 
 * Motor de scoring crediticio alimentado por datos transaccionales de Payku.
 * Evalúa volumen, consistencia y frecuencia de cobros para asignar
 * un Tier de riesgo (A=Gold, B=Silver, C=Bronze, D=Rechazado).
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

const VOLUME_TIERS = { gold: 15_000, silver: 5_000, bronze: 1_500 };
const LOAN_AMOUNTS: Record<number, number> = { 1: 10_000_000, 2: 5_000_000, 3: 2_000_000, 4: 0 };

export function calculateCreditScore(transactions: PaykuTransaction[]): ScoreResult {
  const completed = transactions.filter((t) => t.status === "completed");

  if (completed.length === 0) {
    return { totalScore: 0, tier: 4, badgeType: "None", maxLoanAmount: 0, breakdown: { volumePoints: 0, consistencyPoints: 0, frequencyPoints: 0 } };
  }

  // DIM 1: Volumen (0-40 pts)
  const totalVolumeUSD = completed.reduce((sum, t) => sum + t.amountUSD, 0);
  let volumePoints: number;
  if (totalVolumeUSD >= VOLUME_TIERS.gold) volumePoints = 40;
  else if (totalVolumeUSD >= VOLUME_TIERS.silver) volumePoints = 25 + Math.round(((totalVolumeUSD - VOLUME_TIERS.silver) / (VOLUME_TIERS.gold - VOLUME_TIERS.silver)) * 15);
  else if (totalVolumeUSD >= VOLUME_TIERS.bronze) volumePoints = 12 + Math.round(((totalVolumeUSD - VOLUME_TIERS.bronze) / (VOLUME_TIERS.silver - VOLUME_TIERS.bronze)) * 13);
  else volumePoints = Math.round((totalVolumeUSD / VOLUME_TIERS.bronze) * 12);

  // DIM 2: Consistencia (0-30 pts)
  const monthlyVolumes: number[] = [];
  for (let i = 0; i < 6; i++) {
    const monthStart = new Date(); monthStart.setMonth(monthStart.getMonth() - i - 1);
    const monthEnd = new Date(); monthEnd.setMonth(monthEnd.getMonth() - i);
    monthlyVolumes.push(completed.filter((t) => { const d = new Date(t.date); return d >= monthStart && d < monthEnd; }).reduce((s, t) => s + t.amountUSD, 0));
  }
  const activeMonths = monthlyVolumes.filter((v) => v > 0).length;
  const avgMonthly = monthlyVolumes.reduce((a, b) => a + b, 0) / 6;
  const variance = monthlyVolumes.reduce((sum, v) => sum + Math.pow(v - avgMonthly, 2), 0) / 6;
  const cv = avgMonthly > 0 ? Math.sqrt(variance) / avgMonthly : 1;
  let consistencyPoints: number;
  if (activeMonths >= 5 && cv < 0.3) consistencyPoints = 30;
  else if (activeMonths >= 4 && cv < 0.5) consistencyPoints = 20;
  else if (activeMonths >= 3) consistencyPoints = 10;
  else consistencyPoints = Math.round(activeMonths * 3);

  // DIM 3: Frecuencia (0-30 pts)
  const txPerMonth = completed.length / 6;
  let frequencyPoints: number;
  if (txPerMonth >= 10) frequencyPoints = 30;
  else if (txPerMonth >= 5) frequencyPoints = 20;
  else if (txPerMonth >= 2) frequencyPoints = 10;
  else frequencyPoints = Math.round(txPerMonth * 5);

  const totalScore = volumePoints + consistencyPoints + frequencyPoints;
  let tier: number; let badgeType: ScoreResult["badgeType"];
  if (totalScore >= 80) { tier = 1; badgeType = "Gold"; }
  else if (totalScore >= 55) { tier = 2; badgeType = "Silver"; }
  else if (totalScore >= 30) { tier = 3; badgeType = "Bronze"; }
  else { tier = 4; badgeType = "None"; }

  return { totalScore, tier, badgeType, maxLoanAmount: LOAN_AMOUNTS[tier], breakdown: { volumePoints, consistencyPoints, frequencyPoints } };
}