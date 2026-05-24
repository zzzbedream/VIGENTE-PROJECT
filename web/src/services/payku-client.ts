/**
 * Vigente Protocol — Payku API Client (Sandbox/Producción)
 *
 * Implementación estricta de la API REST de Payku según OpenAPI oficial
 * (ver `openapi-cl-es-v1.yaml` en la raíz del repo).
 *
 * Autenticación:
 *   - Authorization: Bearer <TOKEN_PUBLICO>      (todos los endpoints)
 *   - Sign: HMAC-SHA256(...)                      (solo wallet/payout, suscripciones, anulación, mall)
 *
 * Algoritmo de firma (réplica exacta del spec JS oficial):
 *   1. encodeURIComponent(requestPath)
 *   2. Ordenar alfabéticamente las keys del data
 *   3. Eliminar keys cuyo value sea object o array
 *   4. URLSearchParams(orderedData).toString()  ← clave: usa '+' para espacios
 *   5. concat = requestPath + '&' + arrayConcat
 *   6. HmacSHA256(concat, PRIVATE_TOKEN).hex()
 *
 * NOTA: el OpenAPI oficial muestra exactamente esta secuencia con
 * `URLSearchParams(orderedData).toString()`. NO usar encodeURIComponent
 * manual: difiere en el manejo de espacios y rompe la firma silenciosamente.
 */

import { createHmac } from "crypto";

// ─── Custom Errors ─────────────────────────────────────────────

export class PaykuAuthError extends Error {
  constructor(message = "Token público incorrecto o error de firma (HTTP 401)") {
    super(message);
    this.name = "PaykuAuthError";
  }
}

export class PaykuValidationError extends Error {
  public readonly statusCode = 422;
  public readonly errors?: unknown;
  constructor(message: string, errors?: unknown) {
    super(`Validación falló (HTTP 422): ${message}`);
    this.name = "PaykuValidationError";
    this.errors = errors;
  }
}

export class PaykuRateLimitError extends Error {
  public readonly statusCode = 429;
  constructor(message = "Rate limit excedido — demasiadas solicitudes (HTTP 429)") {
    super(message);
    this.name = "PaykuRateLimitError";
  }
}

export class PaykuNetworkError extends Error {
  constructor(message = "Timeout o sin conexión con Payku") {
    super(message);
    this.name = "PaykuNetworkError";
  }
}

export class PaykuNoDataError extends Error {
  constructor(message = "Payku retornó una respuesta vacía") {
    super(message);
    this.name = "PaykuNoDataError";
  }
}

export class PaykuAPIError extends Error {
  public readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(`Payku API Error (HTTP ${statusCode}): ${message}`);
    this.name = "PaykuAPIError";
    this.statusCode = statusCode;
  }
}

// ─── Configuration ─────────────────────────────────────────────

interface PaykuClientConfig {
  baseUrl: string;
  publicToken: string;
  privateToken: string;
  timeout: number;      // ms
  maxRetries: number;
}

// ─── Payku API Response Types ──────────────────────────────────

/**
 * Registro de transacción según GET /api/transaction.
 * Estructura inferida del schema IdentifierAllResponse del OpenAPI.
 */
export interface PaykuTransactionRecord {
  id?: string;
  identificador?: string;
  order?: string;
  amount?: number;
  currency?: string;
  status?: string;          // "success", "pending", "rejected", "failed", etc.
  payment?: string | number;
  payment_method?: string;
  created_at?: string;
  updated_at?: string;
  customer?: {
    name?: string;
    email?: string;
    document?: string;
  };
  [key: string]: unknown;
}

export interface PaykuTransactionListResponse {
  data?: PaykuTransactionRecord[];
  records?: PaykuTransactionRecord[];
  current_page?: number;
  per_page?: number;
  total?: number;
  last_page?: number;
  [key: string]: unknown;
}

/**
 * Registro de conciliación bancaria según POST /api/conciliation.
 * Rango máximo 30 días.
 */
export interface PaykuConciliationRecord {
  id: string;
  order: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  updated_at?: string;
  payment_method?: string;
  customer?: {
    name?: string;
    email?: string;
    document?: string;
  };
}

export interface PaykuConciliationResponse {
  data?: PaykuConciliationRecord[];
  records?: PaykuConciliationRecord[];
  [key: string]: unknown;
}

/**
 * Payload exacto para POST /api/wallet/payout según OpenAPI oficial.
 * `additional_parameters` es object → será excluido de la firma automáticamente.
 */
export interface PaykuPayoutApiRequest {
  email: string;
  phone?: string;
  subject: string;
  currency: string;          // "CLP"
  order: string;
  amount: number;
  accountbank_name: string;
  accountbank_rut: string;
  accountbank_sbif: string;
  accountbank_type: "1" | "2" | "3";  // 1=Corriente, 2=Vista, 3=Ahorro
  accountbank_num: string;
  url_notify?: string;
  additional_parameters?: Record<string, string>;
}

export interface PaykuPayoutApiResponse {
  id?: string;
  identifier_payout?: string;
  order?: string;
  status?: string;     // "success", "banking_error", "rejected", etc.
  update_at?: string;
  customer?: {
    name?: string;
    phone?: string;
    document?: string;
  };
}

// ─── Client Class ──────────────────────────────────────────────

export class PaykuClient {
  private config: PaykuClientConfig;

  constructor() {
    // baseUrl debe ser SIN el sufijo /api (los paths internos lo agregan
    // explícitamente para que coincida con el requestPath usado en la firma).
    const rawBase = process.env.PAYKU_BASE_URL || "https://des.payku.cl";
    this.config = {
      baseUrl: rawBase.replace(/\/api\/?$/, "").replace(/\/$/, ""),
      publicToken: process.env.PAYKU_PUBLIC_TOKEN || "",
      privateToken: process.env.PAYKU_PRIVATE_TOKEN || "",
      timeout: 10_000,
      maxRetries: 2,
    };
  }

  /** Indica si el cliente tiene credenciales mínimas para llamar al API. */
  get isConfigured(): boolean {
    return this.config.publicToken.length > 0;
  }

  /** Indica si puede firmar requests (necesario para wallet/payout). */
  get canSign(): boolean {
    return this.config.publicToken.length > 0 && this.config.privateToken.length > 0;
  }

  /**
   * Genera firma HMAC-SHA256 siguiendo EXACTAMENTE el ejemplo JS del OpenAPI:
   *
   *   const requestPath = encodeURIComponent('/api/suclient');
   *   const orderedData = { ...data ordenado por keys, sin objects/arrays };
   *   const arrayConcat = new URLSearchParams(orderedData).toString();
   *   const concat = requestPath + "&" + arrayConcat;
   *   const sign = HmacSHA256(concat, PRIVATE_TOKEN).hex();
   *
   * Importante: URLSearchParams encodea espacios como '+' (no '%20').
   * Esto difiere de encodeURIComponent. Replicar el algoritmo oficial es
   * obligatorio o la firma será rechazada con 401.
   */
  generateSignature(requestPath: string, data?: Record<string, unknown>): string {
    const encodedPath = encodeURIComponent(requestPath);

    // Construir orderedData: claves ordenadas alfabéticamente, sin objects/arrays
    const flat: Record<string, string> = {};
    if (data) {
      const sortedKeys = Object.keys(data).sort();
      for (const key of sortedKeys) {
        const val = data[key];
        if (val === null || val === undefined) continue;
        if (typeof val === "object") continue; // excluye objects y arrays (per spec)
        flat[key] = String(val);
      }
    }

    const arrayConcat = new URLSearchParams(flat).toString();
    const concat = arrayConcat ? `${encodedPath}&${arrayConcat}` : encodedPath;
    return createHmac("sha256", this.config.privateToken).update(concat).digest("hex");
  }

  /**
   * Helper público para testear el algoritmo de firma contra el ejemplo oficial.
   * El OpenAPI muestra que con los datos ejemplo + token "fe551abcef62fcf002dc598922e68f0a"
   * el resultado debe ser: "d891663698d31aa8b68babe96ac6497f5a0d874024368102998d5b79a4d12c36"
   */
  static referenceSignature(
    requestPath: string,
    data: Record<string, unknown>,
    privateToken: string
  ): string {
    const encodedPath = encodeURIComponent(requestPath);
    const flat: Record<string, string> = {};
    Object.keys(data)
      .sort()
      .forEach((key) => {
        const val = data[key];
        if (val !== null && val !== undefined && typeof val !== "object") {
          flat[key] = String(val);
        }
      });
    const arrayConcat = new URLSearchParams(flat).toString();
    const concat = arrayConcat ? `${encodedPath}&${arrayConcat}` : encodedPath;
    return createHmac("sha256", privateToken).update(concat).digest("hex");
  }

  /**
   * Realiza una petición HTTP con timeout, retry y mapeo de errores oficiales.
   */
  private async makeRequest<T>(
    method: "GET" | "POST",
    pathWithQuery: string,
    body?: Record<string, unknown>,
    requireSignature: boolean = false
  ): Promise<T> {
    if (!this.isConfigured) {
      throw new PaykuAuthError("PAYKU_PUBLIC_TOKEN no configurado en el entorno");
    }
    if (requireSignature && !this.canSign) {
      throw new PaykuAuthError(
        "PAYKU_PRIVATE_TOKEN no configurado — requerido para wallet/payout"
      );
    }

    // requestPath para firma = ruta SIN query string (la spec usa el path puro)
    const requestPath = pathWithQuery.split("?")[0];
    const url = `${this.config.baseUrl}${pathWithQuery}`;

    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.publicToken}`,
    };

    if (requireSignature) {
      headers["Sign"] = this.generateSignature(requestPath, body);
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const status = response.status;

        // Mapeo de errores oficiales (ver yaml líneas 187-251)
        if (status === 401) {
          throw new PaykuAuthError();
        }
        if (status === 422) {
          let errorPayload: unknown = null;
          try {
            errorPayload = await response.json();
          } catch {
            errorPayload = await response.text().catch(() => null);
          }
          throw new PaykuValidationError(
            "Datos de la solicitud no procesables — revisa el payload",
            errorPayload
          );
        }
        if (status === 429) {
          throw new PaykuRateLimitError();
        }
        if (!response.ok) {
          const errorBody = await response.text().catch(() => "Unknown error");
          throw new PaykuAPIError(status, errorBody);
        }

        return (await response.json()) as T;
      } catch (error: unknown) {
        // No reintentar errores deterministas
        if (error instanceof PaykuAuthError) throw error;
        if (error instanceof PaykuValidationError) throw error;
        if (error instanceof PaykuRateLimitError) throw error;

        lastError = error instanceof Error ? error : new Error(String(error));

        if ((error as DOMException)?.name === "AbortError") {
          lastError = new Error(`Request timeout tras ${this.config.timeout}ms`);
        }

        // Reintentar con backoff exponencial
        if (attempt < this.config.maxRetries) {
          const backoff = 1000 * (attempt + 1);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    throw new PaykuNetworkError(
      `Sin conexión a Payku tras ${this.config.maxRetries + 1} intentos: ${lastError?.message}`
    );
  }

  // ─── Public API Methods ──────────────────────────────────────

  /**
   * GET /api/transaction
   *
   * Lista transacciones del comercio con paginación (máx 4000 por página)
   * y filtros opcionales de fecha y estado.
   *
   * Ventajas sobre POST /api/conciliation para scoring:
   *   - Sin límite de 30 días (puede traer toda la historia)
   *   - Paginación nativa
   *   - No requiere firma HMAC
   *
   * @param opts.dateInit  "YYYY-MM-DD" — desde (opcional, default = hoy)
   * @param opts.dateEnd   "YYYY-MM-DD" — hasta (opcional, default = hoy)
   * @param opts.page      número de página (default 1)
   * @param opts.perPage   registros por página (default 100, máx 4000)
   * @param opts.success   filtra solo exitosas si true
   * @param opts.pending   incluye pendientes si true
   * @param opts.rejected  incluye rechazadas si true
   */
  async getTransactions(opts: {
    dateInit?: string;
    dateEnd?: string;
    page?: number;
    perPage?: number;
    success?: boolean;
    pending?: boolean;
    rejected?: boolean;
  } = {}): Promise<PaykuTransactionListResponse> {
    const params = new URLSearchParams();
    if (opts.dateInit) params.set("date_init", opts.dateInit);
    if (opts.dateEnd) params.set("date_end", opts.dateEnd);
    params.set("page", String(opts.page ?? 1));
    params.set("per_page", String(Math.min(opts.perPage ?? 100, 4000)));
    if (opts.success) params.set("success", "true");
    if (opts.pending) params.set("pending", "true");
    if (opts.rejected) params.set("rejected", "true");

    const path = `/api/transaction?${params.toString()}`;
    return this.makeRequest<PaykuTransactionListResponse>("GET", path);
  }

  /**
   * POST /api/conciliation
   *
   * Obtiene las conciliaciones bancarias (liquidaciones del comercio).
   * **RESTRICCIÓN ESTRICTA**: rango date_init → date_end ≤ 30 días.
   * Si necesitas más historia, usa `getTransactions()` o llama múltiples veces.
   *
   * @param dateInit  "YYYY-MM-DD"
   * @param dateEnd   "YYYY-MM-DD"
   */
  async getConciliation(dateInit: string, dateEnd: string): Promise<PaykuConciliationResponse> {
    // Validación local del rango antes de hacer el request (ahorra cuota / 422)
    const init = new Date(dateInit);
    const end = new Date(dateEnd);
    const diffDays = Math.ceil((end.getTime() - init.getTime()) / (1000 * 60 * 60 * 24));
    if (Number.isNaN(diffDays) || diffDays < 0) {
      throw new PaykuValidationError("date_init debe ser ≤ date_end y ambas válidas");
    }
    if (diffDays > 30) {
      throw new PaykuValidationError(
        `Rango ${diffDays} días excede el máximo de 30 días para conciliation`
      );
    }

    return this.makeRequest<PaykuConciliationResponse>("POST", "/api/conciliation", {
      date_init: dateInit,
      date_end: dateEnd,
    });
  }

  /**
   * POST /api/wallet/payout
   *
   * Crea una orden de dispersión desde la wallet del comercio.
   * Requiere firma HMAC-SHA256 en header Sign.
   *
   * Sandbox: amounts 1000/2000/3000 → aprobados; 1500/2500/3500 → rechazados.
   *
   * NOTA: `additional_parameters` es object → excluido automáticamente de la
   * firma por nuestro algoritmo (replica el comportamiento del SDK oficial).
   */
  async createPayout(data: PaykuPayoutApiRequest): Promise<PaykuPayoutApiResponse> {
    return this.makeRequest<PaykuPayoutApiResponse>(
      "POST",
      "/api/wallet/payout",
      data as unknown as Record<string, unknown>,
      true // requiere firma HMAC
    );
  }

  /**
   * GET /api/banks?currency=clp
   * Lista bancos disponibles para dispersión (códigos SBIF).
   */
  async getBanks(currency: string = "clp"): Promise<unknown> {
    return this.makeRequest("GET", `/api/banks?currency=${currency}`);
  }
}
