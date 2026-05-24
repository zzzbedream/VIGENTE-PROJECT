/**
 * Vigente Protocol — Payku Oracle (Hybrid)
 *
 * Estrategia híbrida:
 * 1. Si hay credenciales, llama GET /api/transaction (paginación 4000/página).
 * 2. Si la API falla o no retorna transacciones, usa fixtures mock.
 * 3. El campo `metadata.source` indica el origen del dato:
 *      "payku_sandbox_real"  → llamada HTTP real exitosa
 *      "payku_fallback_mock" → fallback determinístico
 *
 * El scoring engine consume `PaykuTransaction[]` sin saber el origen.
 */

import { PaykuClient } from "./payku-client";
import type { PaykuTransactionRecord } from "./payku-client";

// ─── Tipos públicos (interfaz estable consumida por scoring-engine) ───

export interface PaykuTransaction {
  date: string;
  amountCLP: number;
  amountUSD: number;
  status: "completed" | "pending" | "failed" | "refunded";
  type: "payin" | "payout" | "transfer";
  paymentMethod: "card" | "transfer" | "cash";
  orderId: string;
}

export interface PaykuMerchantProfile {
  id: string;
  name: string;
  email: string;
  rut: string;
  country: string;
  kycLevel: number;
  registeredAt: string;
  monthlyAvgVolume: number;
  totalTransactions: number;
}

export interface PaykuOracleResponse {
  merchant: PaykuMerchantProfile;
  transactions: PaykuTransaction[];
  metadata: {
    source: "payku_sandbox_real" | "payku_fallback_mock";
    fetchedAt: string;
    periodMonths: number;
    pagesFetched?: number;
  };
}

// ─── Payku client (singleton) ──────────────────────────────────

const paykuClient = new PaykuClient();
const USD_CLP_RATE = Number(process.env.USD_CLP_RATE) || 950;

// ─── ADAPTER: respuesta real de Payku → PaykuTransaction[] ─────

function mapPaykuStatus(raw?: string): PaykuTransaction["status"] {
  const s = raw?.toLowerCase() ?? "";
  if (s === "success" || s === "completed" || s === "approved") return "completed";
  if (s === "pending" || s === "processing") return "pending";
  if (s === "failed" || s === "rejected" || s === "banking_error") return "failed";
  if (s === "refunded" || s === "reversed") return "refunded";
  return "completed";
}

function mapPaykuMethod(raw?: string): PaykuTransaction["paymentMethod"] {
  const m = raw?.toLowerCase() ?? "";
  if (m.includes("card") || m.includes("credit") || m.includes("debit")) return "card";
  if (m.includes("transfer") || m.includes("bank")) return "transfer";
  return "cash";
}

function transformTransactionsToScoring(records: PaykuTransactionRecord[]): PaykuTransaction[] {
  return records
    .map((rec): PaykuTransaction => {
      const amountCLP = Number(rec.amount ?? 0);
      const dateRaw = String(rec.created_at ?? "");
      const date =
        dateRaw.split(" ")[0] ||
        dateRaw.split("T")[0] ||
        new Date().toISOString().split("T")[0];
      const paymentMethodRaw =
        rec.payment_method ?? (typeof rec.payment === "string" ? rec.payment : undefined);
      return {
        date,
        amountCLP,
        amountUSD: Math.round(amountCLP / USD_CLP_RATE),
        status: mapPaykuStatus(rec.status),
        type: "payin" as const,
        paymentMethod: mapPaykuMethod(paymentMethodRaw),
        orderId: String(rec.order ?? rec.id ?? rec.identificador ?? "unknown"),
      };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** Extrae el array de transacciones de la respuesta paginada. */
function extractTransactionRecords(payload: unknown): PaykuTransactionRecord[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data as PaykuTransactionRecord[];
  if (Array.isArray(obj.records)) return obj.records as PaykuTransactionRecord[];
  // Algunos endpoints retornan el array directo bajo otra key — fallback genérico
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (
      Array.isArray(val) &&
      val.length > 0 &&
      typeof val[0] === "object" &&
      val[0] !== null &&
      "amount" in (val[0] as object)
    ) {
      return val as PaykuTransactionRecord[];
    }
  }
  return [];
}

// ─── PERFIL DE COMERCIO desde datos reales ──────────────────────

function buildMerchantFromRealData(rut: string, transactions: PaykuTransaction[]): PaykuMerchantProfile {
  const completed = transactions.filter((t) => t.status === "completed");
  const totalCLP = completed.reduce((sum, t) => sum + t.amountCLP, 0);
  const periodMonths = 6;
  const oldest =
    completed.length > 0
      ? completed[completed.length - 1].date
      : new Date().toISOString().split("T")[0];

  return {
    id: `payku_real_${rut.replace(/[^0-9kK]/g, "")}`,
    name: "Comercio Payku",
    email: "",
    rut,
    country: "Chile",
    kycLevel: 2,
    registeredAt: oldest,
    monthlyAvgVolume: Math.round(totalCLP / periodMonths),
    totalTransactions: completed.length,
  };
}

// ─── LLAMADA REAL: GET /api/transaction con paginación ──────────

async function fetchRealTransactions(
  rut: string
): Promise<{ transactions: PaykuTransaction[]; merchant: PaykuMerchantProfile; pages: number } | null> {
  // Ventana 6 meses
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const dateInit = sixMonthsAgo.toISOString().split("T")[0];
  const dateEnd = now.toISOString().split("T")[0];

  const perPage = 1000; // razonable: muchas páginas pequeñas vs pocas enormes
  const allRecords: PaykuTransactionRecord[] = [];
  let page = 1;
  let pagesFetched = 0;
  const MAX_PAGES = 24; // tope defensivo: 24 × 1000 = 24K transacciones

  while (page <= MAX_PAGES) {
    let response: unknown;
    try {
      response = await paykuClient.getTransactions({
        dateInit,
        dateEnd,
        page,
        perPage,
        success: true, // solo exitosas (para scoring)
      });
    } catch (error) {
      console.warn(
        `[Payku Oracle] page=${page} fetch error → ${
          error instanceof Error ? error.message : error
        }`
      );
      break;
    }

    pagesFetched++;
    const records = extractTransactionRecords(response);
    allRecords.push(...records);

    // Si la página retorna menos del perPage, ya terminamos
    if (records.length < perPage) break;
    page++;
  }

  if (allRecords.length === 0) return null;

  const transactions = transformTransactionsToScoring(allRecords);
  const merchant = buildMerchantFromRealData(rut, transactions);
  return { transactions, merchant, pages: pagesFetched };
}

// ─── FALLBACK: fixtures mock determinísticos ────────────────────

const MERCHANT_PROFILES: Record<string, PaykuMerchantProfile> = {
  merchant_gold: {
    id: "payku_merchant_001",
    name: "Comercializadora SpA",
    email: "contacto@comercializadora.cl",
    rut: "76.543.210-K",
    country: "Chile",
    kycLevel: 3,
    registeredAt: "2024-01-15",
    monthlyAvgVolume: 5_200_000,
    totalTransactions: 342,
  },
  merchant_silver: {
    id: "payku_merchant_002",
    name: "Servicios Profesionales Ltda",
    email: "info@servpro.cl",
    rut: "76.321.456-7",
    country: "Chile",
    kycLevel: 2,
    registeredAt: "2024-06-01",
    monthlyAvgVolume: 2_100_000,
    totalTransactions: 156,
  },
  merchant_bronze: {
    id: "payku_merchant_003",
    name: "Emprendimiento Digital",
    email: "ventas@emprendedigital.cl",
    rut: "76.111.222-3",
    country: "Chile",
    kycLevel: 1,
    registeredAt: "2025-01-10",
    monthlyAvgVolume: 680_000,
    totalTransactions: 47,
  },
  merchant_fail: {
    id: "payku_merchant_004",
    name: "Negocio Inactivo",
    email: "contacto@inactivo.cl",
    rut: "76.000.111-2",
    country: "Chile",
    kycLevel: 1,
    registeredAt: "2025-04-01",
    monthlyAvgVolume: 45_000,
    totalTransactions: 3,
  },
};

function generateMockTransactions(tier: string): PaykuTransaction[] {
  const now = new Date();
  const transactions: PaykuTransaction[] = [];

  const configs: Record<string, { count: number; minAmount: number; maxAmount: number; failRate: number }> = {
    merchant_gold:   { count: 60, minAmount: 80_000, maxAmount: 950_000, failRate: 0.03 },
    merchant_silver: { count: 35, minAmount: 30_000, maxAmount: 450_000, failRate: 0.06 },
    merchant_bronze: { count: 15, minAmount: 10_000, maxAmount: 150_000, failRate: 0.12 },
    merchant_fail:   { count: 3,  minAmount: 5_000,  maxAmount: 25_000,  failRate: 0.40 },
  };

  const config = configs[tier] || configs.merchant_fail;

  for (let i = 0; i < config.count; i++) {
    const daysAgo = Math.floor(Math.random() * 180);
    const date = new Date(now.getTime() - daysAgo * 86_400_000);
    const amountCLP = Math.floor(
      Math.random() * (config.maxAmount - config.minAmount) + config.minAmount
    );
    const isFailed = Math.random() < config.failRate;

    const methods: PaykuTransaction["paymentMethod"][] = ["card", "transfer", "cash"];
    const method = methods[Math.floor(Math.random() * methods.length)];

    transactions.push({
      date: date.toISOString().split("T")[0],
      amountCLP,
      amountUSD: Math.round(amountCLP / USD_CLP_RATE),
      status: isFailed ? "failed" : "completed",
      type: Math.random() > 0.1 ? "payin" : "transfer",
      paymentMethod: method,
      orderId: `PKU-${Date.now()}-${i}`,
    });
  }

  return transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function mapRutToMerchant(rut: string): string {
  const cleanRut = rut.replace(/[^0-9kK]/g, "").toUpperCase();
  const lastDigit = cleanRut.slice(-1);
  if (lastDigit === "1" || lastDigit === "K") return "merchant_gold";
  if (lastDigit === "2" || lastDigit === "3") return "merchant_silver";
  if (lastDigit === "4" || lastDigit === "5" || lastDigit === "6") return "merchant_bronze";
  if (lastDigit === "9") return "merchant_fail";
  return "merchant_silver";
}

function getFallbackData(rut: string): PaykuOracleResponse {
  const merchantKey = mapRutToMerchant(rut);
  const merchant = MERCHANT_PROFILES[merchantKey];
  const transactions = generateMockTransactions(merchantKey);
  return {
    merchant,
    transactions,
    metadata: {
      source: "payku_fallback_mock",
      fetchedAt: new Date().toISOString(),
      periodMonths: 6,
    },
  };
}

// ─── API PÚBLICA ───────────────────────────────────────────────

export async function fetchPaykuData(rut: string): Promise<PaykuOracleResponse> {
  if (!paykuClient.isConfigured) {
    console.info("[Payku Oracle] Sin PAYKU_PUBLIC_TOKEN → fallback mock");
    return getFallbackData(rut);
  }

  try {
    console.info(`[Payku Oracle] Consultando GET /api/transaction (RUT ${rut})`);
    const result = await fetchRealTransactions(rut);

    if (!result || result.transactions.length === 0) {
      console.warn("[Payku Oracle] API sin transacciones → fallback mock");
      return getFallbackData(rut);
    }

    console.info(
      `[Payku Oracle] ✓ ${result.transactions.length} transacciones reales (${result.pages} páginas)`
    );

    return {
      merchant: result.merchant,
      transactions: result.transactions,
      metadata: {
        source: "payku_sandbox_real",
        fetchedAt: new Date().toISOString(),
        periodMonths: 6,
        pagesFetched: result.pages,
      },
    };
  } catch (error) {
    console.error(
      "[Payku Oracle] Error en API real → fallback mock:",
      error instanceof Error ? error.message : error
    );
    return getFallbackData(rut);
  }
}

export function calculateTransactionStats(transactions: PaykuTransaction[]) {
  const completed = transactions.filter((t) => t.status === "completed");
  const totalAmount = completed.reduce((sum, t) => sum + t.amountUSD, 0);
  const avgPerMonth = completed.length > 0 ? totalAmount / 6 : 0;
  const dates = completed.map((t) => new Date(t.date).getTime());
  const oldestTimestamp = dates.length > 0 ? Math.min(...dates) : Date.now();
  const oldestTransactionDays = Math.floor((Date.now() - oldestTimestamp) / 86_400_000);

  return {
    transactionCount: completed.length,
    totalVolumeUSD: totalAmount,
    avgPerMonth: Math.round(avgPerMonth),
    oldestTransactionDays,
    failedCount: transactions.filter((t) => t.status === "failed").length,
  };
}
