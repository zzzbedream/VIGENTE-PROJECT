// Debug del algoritmo de firma Payku — JS puro, sin ts-node.
// Prueba múltiples variantes contra el ejemplo canónico del OpenAPI.

import { createHmac } from "node:crypto";

const PRIVATE_TOKEN = "fe551abcef62fcf002dc598922e68f0a";
const REQUEST_PATH = "/api/suclient";
const EXPECTED = "d891663698d31aa8b68babe96ac6497f5a0d874024368102998d5b79a4d12c36";

const data = {
  email: "johndoe@example.com",
  name: "John Doe",
  phone: "923122312",
  address: "Moneda 101",
  country: "Chile",
  region: "Metropolitana",
  city: "Santiago",
  postal_code: "850000",
  additional_parameters: {
    parameter_1: "example",
    parameter_2: "example 2",
  },
};

function hash(concat) {
  return createHmac("sha256", PRIVATE_TOKEN).update(concat).digest("hex");
}

function pickFlat(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    out[k] = String(v);
  }
  return out;
}

const variants = [];

// V1: URLSearchParams (espacios como '+'), path encodeURIComponent
{
  const ordered = pickFlat(data);
  const concat = `${encodeURIComponent(REQUEST_PATH)}&${new URLSearchParams(ordered).toString()}`;
  variants.push({ name: "V1_URLSearchParams_encoded_path", concat });
}

// V2: encodeURIComponent en values (espacios como '%20'), path encoded
{
  const sorted = Object.keys(data).sort();
  const parts = [];
  for (const k of sorted) {
    const v = data[k];
    if (v === null || v === undefined || typeof v === "object") continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  const concat = `${encodeURIComponent(REQUEST_PATH)}&${parts.join("&")}`;
  variants.push({ name: "V2_encodeURIComponent_encoded_path", concat });
}

// V3: URLSearchParams + path raw (sin encodeURIComponent)
{
  const ordered = pickFlat(data);
  const concat = `${REQUEST_PATH}&${new URLSearchParams(ordered).toString()}`;
  variants.push({ name: "V3_URLSearchParams_raw_path", concat });
}

// V4: encodeURIComponent values + path raw
{
  const sorted = Object.keys(data).sort();
  const parts = [];
  for (const k of sorted) {
    const v = data[k];
    if (v === null || v === undefined || typeof v === "object") continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  const concat = `${REQUEST_PATH}&${parts.join("&")}`;
  variants.push({ name: "V4_encodeURIComponent_raw_path", concat });
}

// V5: URLSearchParams + path con trailing slash + encoded
{
  const ordered = pickFlat(data);
  const concat = `${encodeURIComponent("/api/suclient/")}&${new URLSearchParams(ordered).toString()}`;
  variants.push({ name: "V5_URLSearchParams_trailing_slash_encoded", concat });
}

// V6: encodeURIComponent + path con trailing slash encoded
{
  const sorted = Object.keys(data).sort();
  const parts = [];
  for (const k of sorted) {
    const v = data[k];
    if (v === null || v === undefined || typeof v === "object") continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  const concat = `${encodeURIComponent("/api/suclient/")}&${parts.join("&")}`;
  variants.push({ name: "V6_encodeURIComponent_trailing_slash_encoded", concat });
}

// V7: solo el path encoded (sin params)
{
  variants.push({ name: "V7_only_path_encoded", concat: encodeURIComponent(REQUEST_PATH) });
}

// V8: solo el path raw (sin params)
{
  variants.push({ name: "V8_only_path_raw", concat: REQUEST_PATH });
}

// V9: keys con additional_parameters incluido pero JSON stringified
{
  const sorted = Object.keys(data).sort();
  const parts = [];
  for (const k of sorted) {
    const v = data[k];
    if (v === null || v === undefined) continue;
    const strVal = typeof v === "object" ? JSON.stringify(v) : String(v);
    parts.push(`${k}=${encodeURIComponent(strVal)}`);
  }
  const concat = `${encodeURIComponent(REQUEST_PATH)}&${parts.join("&")}`;
  variants.push({ name: "V9_includes_object_as_json", concat });
}

// V10: Sin sort (orden de inserción)
{
  const parts = [];
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (v === null || v === undefined || typeof v === "object") continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  const concat = `${encodeURIComponent(REQUEST_PATH)}&${parts.join("&")}`;
  variants.push({ name: "V10_no_sort_encodeURIComponent", concat });
}

// V11: URLSearchParams pero con concat reverso (params + path)
{
  const ordered = pickFlat(data);
  const concat = `${new URLSearchParams(ordered).toString()}&${encodeURIComponent(REQUEST_PATH)}`;
  variants.push({ name: "V11_reverse_order_params_first", concat });
}

console.log(`Expected: ${EXPECTED}\n`);
console.log("=".repeat(80));
let matched = null;
for (const v of variants) {
  const h = hash(v.concat);
  const isMatch = h === EXPECTED;
  if (isMatch) matched = v.name;
  console.log(`\n${v.name}${isMatch ? "  ✅ MATCH" : ""}`);
  console.log(`  concat: ${v.concat}`);
  console.log(`  hash:   ${h}`);
}
console.log("\n" + "=".repeat(80));
if (matched) {
  console.log(`\n✅ Variante correcta: ${matched}`);
  process.exit(0);
} else {
  console.log("\n❌ Ninguna variante coincide con el hash esperado.");
  console.log("Posibles causas: token incorrecto, data adicional ocultas en el spec, encoding raro.");
  process.exit(1);
}
