/**
 * Vigente Protocol — Payku Payout Module (Hybrid)
 *
 * Dispersión de fondos vía POST /api/wallet/payout.
 * Estrategia híbrida: intenta API real → fallback a simulación local.
 *
 * Auth: Bearer Token + firma HMAC-SHA256 en header `Sign`.
 *
 * Payload exacto al OpenAPI oficial:
 *   email, phone?, subject, currency='CLP', order, amount,
 *   accountbank_name, accountbank_rut, accountbank_sbif,
 *   accountbank_type ("1"=Corriente, "2"=Vista, "3"=Ahorro),
 *   accountbank_num, url_notify?, additional_parameters?
 *
 * Sandbox behavior (de la doc): amounts 1000/2000/3000 → aprobados;
 * 1500/2500/3500 → rechazados. Útil para tests deterministas.
 */

import { PaykuClient } from "./payku-client";
import type { PaykuPayoutApiRequest } from "./payku-client";

// ─── Interfaces estables (consumidas por /api/evaluate-and-fund) ───

/**
 * Request del lado de Vigente (más simple que el payload Payku).
 * El módulo lo traduce al payload exacto al hacer la llamada.
 */
export interface PayoutRequest {
  merchantId: string;
  amountCLP: number;
  bankAccount: string;       // número de cuenta bancaria
  bankCode: string;          // código SBIF (4 dígitos, ej "0001")
  accountType?: "1" | "2" | "3"; // 1=Corriente (default), 2=Vista, 3=Ahorro
  rut: string;               // RUT del beneficiario
  beneficiaryName?: string;  // nombre titular cuenta (default: merchantId)
  email?: string;            // email del beneficiario para notificación
  phone?: string;
  reference: string;         // identifier de orden (Vigente-side)
  description: string;       // subject
  notifyUrl?: string;        // url_notify webhook
  extras?: Record<string, string>; // additional_parameters
}

export interface PayoutResponse {
  success: boolean;
  payoutId: string;
  status: "pending" | "processing" | "completed" | "failed";
  amountCLP: number;
  feeCLP: number;
  netAmountCLP: number;
  estimatedArrival: string;
  createdAt: string;
  dataSource: "payku_sandbox_real" | "payku_fallback_mock";
  rawStatus?: string;        // status crudo retornado por Payku (debug)
  rawId?: string;            // id crudo retornado por Payku
  errorReason?: string;
}

// ─── Config ────────────────────────────────────────────────────

const PAYKU_CONFIG = {
  feeRate: 0.015,                     // 1.5% fee modelo Vigente
  minPayoutCLP: 1_000,                // sandbox aprueba desde 1000
  estimatedArrivalHours: 24,
  defaultAccountType: "1" as const,   // Cuenta Corriente
};

const paykuClient = new PaykuClient();

// ─── Validación de inputs ──────────────────────────────────────

function validatePayoutRequest(req: PayoutRequest): string | null {
  if (req.amountCLP < PAYKU_CONFIG.minPayoutCLP) {
    return `Monto ${req.amountCLP} CLP < mínimo ${PAYKU_CONFIG.minPayoutCLP}`;
  }
  if (!req.bankCode || req.bankCode.length === 0) {
    return "bankCode (SBIF) es obligatorio";
  }
  if (!req.bankAccount || req.bankAccount.length === 0) {
    return "bankAccount es obligatorio";
  }
  if (!req.rut || req.rut.replace(/[^0-9kK]/g, "").length < 7) {
    return "rut inválido";
  }
  if (!req.reference || req.reference.length === 0) {
    return "reference (order) es obligatoria";
  }
  return null;
}

// ─── Construcción del payload exacto al spec ───────────────────

function buildPaykuPayload(req: PayoutRequest): PaykuPayoutApiRequest {
  const rutClean = req.rut.replace(/[^0-9kK]/g, "");
  // El SBIF en Payku es típicamente 4 chars (ej "0001"). Pad a 4 si llega "1".
  const sbif = req.bankCode.padStart(4, "0");

  const payload: PaykuPayoutApiRequest = {
    email: req.email || `${req.merchantId}@vigente.cl`,
    subject: req.description || `Vigente Payout ${req.reference}`,
    currency: "CLP",
    order: req.reference,
    amount: req.amountCLP,
    accountbank_name: req.beneficiaryName || req.merchantId,
    accountbank_rut: rutClean,
    accountbank_sbif: sbif,
    accountbank_type: req.accountType || PAYKU_CONFIG.defaultAccountType,
    accountbank_num: req.bankAccount,
  };

  if (req.phone) payload.phone = req.phone;
  if (req.notifyUrl) payload.url_notify = req.notifyUrl;
  if (req.extras && Object.keys(req.extras).length > 0) {
    payload.additional_parameters = req.extras;
  }

  return payload;
}

// ─── Fallback: simulación local ────────────────────────────────

function simulatePayout(req: PayoutRequest, errorReason?: string): PayoutResponse {
  const feeCLP = Math.round(req.amountCLP * PAYKU_CONFIG.feeRate);
  const netAmountCLP = req.amountCLP - feeCLP;
  const arrivalDate = new Date();
  arrivalDate.setHours(arrivalDate.getHours() + PAYKU_CONFIG.estimatedArrivalHours);

  return {
    success: true,
    payoutId: `PKU-SIM-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    status: "pending",
    amountCLP: req.amountCLP,
    feeCLP,
    netAmountCLP,
    estimatedArrival: arrivalDate.toISOString(),
    createdAt: new Date().toISOString(),
    dataSource: "payku_fallback_mock",
    errorReason,
  };
}

// ─── API pública ───────────────────────────────────────────────

export async function createPayout(request: PayoutRequest): Promise<PayoutResponse> {
  // Validación temprana (evita gastar cuota / 422 en Payku)
  const validationError = validatePayoutRequest(request);
  if (validationError) {
    return {
      success: false,
      payoutId: "",
      status: "failed",
      amountCLP: request.amountCLP,
      feeCLP: 0,
      netAmountCLP: 0,
      estimatedArrival: "",
      createdAt: new Date().toISOString(),
      dataSource: "payku_fallback_mock",
      errorReason: validationError,
    };
  }

  // Sin credenciales (o sin privateToken para firmar) → simulación
  if (!paykuClient.canSign) {
    console.info("[Payku Payout] Sin credenciales completas → simulación local");
    await new Promise((resolve) => setTimeout(resolve, 300));
    return simulatePayout(request, "no_credentials");
  }

  // Llamada real con firma HMAC
  try {
    const payload = buildPaykuPayload(request);
    console.info(
      `[Payku Payout] POST /api/wallet/payout — order=${payload.order} amount=${payload.amount} sbif=${payload.accountbank_sbif}`
    );

    const apiResponse = await paykuClient.createPayout(payload);

    // Sandbox: amounts 1000/2000/3000 = success; 1500/2500/3500 = rejected
    const rawStatus = (apiResponse.status || "").toLowerCase();
    const isSuccess = rawStatus === "success" || rawStatus === "approved";

    const feeCLP = Math.round(request.amountCLP * PAYKU_CONFIG.feeRate);
    const netAmountCLP = request.amountCLP - feeCLP;

    console.info(
      `[Payku Payout] ✓ status=${apiResponse.status} id=${apiResponse.id || apiResponse.identifier_payout}`
    );

    return {
      success: isSuccess,
      payoutId:
        apiResponse.id ||
        apiResponse.identifier_payout ||
        `PKU-REAL-${Date.now()}`,
      status: isSuccess ? "completed" : "failed",
      amountCLP: request.amountCLP,
      feeCLP,
      netAmountCLP,
      estimatedArrival: new Date(
        Date.now() + PAYKU_CONFIG.estimatedArrivalHours * 3600_000
      ).toISOString(),
      createdAt: apiResponse.update_at || new Date().toISOString(),
      dataSource: "payku_sandbox_real",
      rawStatus: apiResponse.status,
      rawId: apiResponse.id || apiResponse.identifier_payout,
      errorReason: isSuccess ? undefined : `payku_status=${apiResponse.status}`,
    };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[Payku Payout] Error en API real → fallback simulación:", errMsg);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return simulatePayout(request, errMsg.slice(0, 200));
  }
}

export function formatCLP(amount: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
  }).format(amount);
}
