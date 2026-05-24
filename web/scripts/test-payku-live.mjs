// Test EN VIVO contra Payku Sandbox.
// Usa las credenciales del .env.local del usuario.
// Prueba endpoints en orden de complejidad creciente:
//   1. GET /api/transaction          (solo Bearer — verifica auth básica)
//   2. POST /api/conciliation        (solo Bearer — verifica POST sin firma)
//   3. POST /api/wallet/payout       (Bearer + firma HMAC — verifica firma)
//
// Si la firma del paso 3 falla con 401, prueba variantes alternativas para
// encontrar la implementación correcta. Imprime un reporte JSON estructurado.

import { createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");

// ─── Cargar credenciales ───
if (!existsSync(envPath)) {
  console.error(JSON.stringify({ error: "No se encontró web/.env.local" }, null, 2));
  process.exit(1);
}
const envContent = readFileSync(envPath, "utf-8");
const env = {};
for (const line of envContent.split("\n")) {
  const m = line.match(/^([A-Z_]+)="?([^"\n]*)"?$/);
  if (m && !line.trim().startsWith("#")) env[m[1]] = m[2];
}

const PUBLIC_TOKEN = env.PAYKU_PUBLIC_TOKEN || "";
const PRIVATE_TOKEN = env.PAYKU_PRIVATE_TOKEN || "";
const BASE_URL = (env.PAYKU_BASE_URL || "https://des.payku.cl").replace(/\/api\/?$/, "").replace(/\/$/, "");

if (!PUBLIC_TOKEN || !PRIVATE_TOKEN) {
  console.error(
    JSON.stringify(
      {
        error: "Faltan PAYKU_PUBLIC_TOKEN o PAYKU_PRIVATE_TOKEN en .env.local",
        hint:
          "Descomenta las líneas PAYKU_* en web/.env.local y pega tus credenciales sandbox.",
      },
      null,
      2
    )
  );
  process.exit(1);
}

console.log(`[Payku Live Test] Base URL: ${BASE_URL}`);
console.log(`[Payku Live Test] Public token: ${PUBLIC_TOKEN.slice(0, 8)}... (${PUBLIC_TOKEN.length} chars)`);
console.log(`[Payku Live Test] Private token: ${PRIVATE_TOKEN.slice(0, 8)}... (${PRIVATE_TOKEN.length} chars)`);
console.log("");

// ─── Helpers ───

function pickFlat(data) {
  const out = {};
  for (const k of Object.keys(data).sort()) {
    const v = data[k];
    if (v === null || v === undefined || typeof v === "object") continue;
    out[k] = String(v);
  }
  return out;
}

const signatureVariants = {
  V1_URLSearchParams_encoded_path: (path, data) => {
    const flat = pickFlat(data);
    const concat = `${encodeURIComponent(path)}&${new URLSearchParams(flat).toString()}`;
    return createHmac("sha256", PRIVATE_TOKEN).update(concat).digest("hex");
  },
  V2_encodeURIComponent_encoded_path: (path, data) => {
    const sorted = Object.keys(data).sort();
    const parts = [];
    for (const k of sorted) {
      const v = data[k];
      if (v === null || v === undefined || typeof v === "object") continue;
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
    const concat = `${encodeURIComponent(path)}&${parts.join("&")}`;
    return createHmac("sha256", PRIVATE_TOKEN).update(concat).digest("hex");
  },
  V3_URLSearchParams_raw_path: (path, data) => {
    const flat = pickFlat(data);
    const concat = `${path}&${new URLSearchParams(flat).toString()}`;
    return createHmac("sha256", PRIVATE_TOKEN).update(concat).digest("hex");
  },
  V4_encodeURIComponent_raw_path: (path, data) => {
    const sorted = Object.keys(data).sort();
    const parts = [];
    for (const k of sorted) {
      const v = data[k];
      if (v === null || v === undefined || typeof v === "object") continue;
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
    const concat = `${path}&${parts.join("&")}`;
    return createHmac("sha256", PRIVATE_TOKEN).update(concat).digest("hex");
  },
};

async function call(method, path, body, signature) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Authorization: `Bearer ${PUBLIC_TOKEN}`,
  };
  if (signature) headers["Sign"] = signature;

  const url = `${BASE_URL}${path.split("?")[0]}${path.includes("?") ? "?" + path.split("?")[1] : ""}`;

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const elapsed = Date.now() - start;
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = await res.text().catch(() => null);
    }
    return { status: res.status, elapsed_ms: elapsed, payload };
  } catch (err) {
    return { status: 0, elapsed_ms: Date.now() - start, error: err.message };
  }
}

// ─── Tests ───

const report = {
  base_url: BASE_URL,
  steps: [],
  signature_variant_in_use: null,
  summary: "",
};

// STEP 1: GET /api/transaction (auth básica)
console.log("─── STEP 1: GET /api/transaction (solo Bearer) ───");
const t1 = await call(
  "GET",
  "/api/transaction?page=1&per_page=10",
  null,
  null
);
console.log(`Status: ${t1.status}, elapsed: ${t1.elapsed_ms}ms`);
const t1Records = Array.isArray(t1.payload?.data)
  ? t1.payload.data.length
  : Array.isArray(t1.payload)
  ? t1.payload.length
  : "?";
console.log(`Records in response: ${t1Records}`);
report.steps.push({
  endpoint: "GET /api/transaction",
  status: t1.status,
  ok: t1.status >= 200 && t1.status < 300,
  records_count: t1Records,
});

// STEP 2: POST /api/conciliation (sin firma, rango 7 días)
console.log("\n─── STEP 2: POST /api/conciliation (solo Bearer, rango 7 días) ───");
const dateEnd = new Date().toISOString().split("T")[0];
const dateInit = new Date(Date.now() - 7 * 86400 * 1000).toISOString().split("T")[0];
const t2 = await call(
  "POST",
  "/api/conciliation",
  { date_init: dateInit, date_end: dateEnd },
  null
);
console.log(`Status: ${t2.status}, elapsed: ${t2.elapsed_ms}ms`);
report.steps.push({
  endpoint: "POST /api/conciliation",
  status: t2.status,
  ok: t2.status >= 200 && t2.status < 300,
  date_range: `${dateInit} → ${dateEnd}`,
});

// STEP 3: POST /api/wallet/payout (con firma) — solo si los tokens son sandbox y user lo aprueba
console.log("\n─── STEP 3: POST /api/wallet/payout (con firma HMAC) ───");
const skipPayout = process.env.SKIP_PAYOUT === "1";
if (skipPayout) {
  console.log("(skipped — set SKIP_PAYOUT=0 para habilitar)");
  report.steps.push({ endpoint: "POST /api/wallet/payout", skipped: true });
} else {
  // Sandbox amount = 1000 → debería aprobarse
  const payoutPayload = {
    email: "test@vigente.cl",
    subject: "Vigente Live Test",
    currency: "CLP",
    order: `VIGENTE-LIVE-${Date.now()}`,
    amount: 1000,
    accountbank_name: "Test User",
    accountbank_rut: "111111111",
    accountbank_sbif: "0001",
    accountbank_type: "1",
    accountbank_num: "12312312312",
  };

  for (const [variantName, signer] of Object.entries(signatureVariants)) {
    const sig = signer("/api/wallet/payout", payoutPayload);
    console.log(`\nTrying ${variantName} → sign: ${sig.slice(0, 24)}...`);
    const t3 = await call("POST", "/api/wallet/payout", payoutPayload, sig);
    console.log(`Status: ${t3.status}, elapsed: ${t3.elapsed_ms}ms`);
    if (t3.payload && typeof t3.payload === "object") {
      console.log(`Payload preview: ${JSON.stringify(t3.payload).slice(0, 200)}`);
    }
    report.steps.push({
      endpoint: "POST /api/wallet/payout",
      variant: variantName,
      status: t3.status,
      ok: t3.status >= 200 && t3.status < 300,
      payload_preview:
        typeof t3.payload === "object" ? JSON.stringify(t3.payload).slice(0, 300) : t3.payload,
    });
    if (t3.status >= 200 && t3.status < 300) {
      report.signature_variant_in_use = variantName;
      console.log(`\n✅ MATCH — Payku acepta la firma generada por ${variantName}`);
      break;
    }
    // Si es 401 sigue probando; cualquier otro error → parar
    if (t3.status !== 401) {
      console.log(`(${t3.status} no es 401 — no es un problema de firma, parar)`);
      break;
    }
  }
}

// ─── Reporte final ───

const okSteps = report.steps.filter((s) => s.ok).length;
const totalSteps = report.steps.filter((s) => !s.skipped).length;
report.summary =
  report.signature_variant_in_use
    ? `Auth OK + firma OK con variante ${report.signature_variant_in_use}`
    : okSteps === totalSteps
    ? "Auth OK; payout no probado o sin variante exitosa"
    : `Auth/payout fallido — revisar credenciales y endpoint`;

console.log("\n" + "═".repeat(80));
console.log(JSON.stringify(report, null, 2));
process.exit(report.signature_variant_in_use ? 0 : 1);
