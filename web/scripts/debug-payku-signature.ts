/**
 * Debug del algoritmo de firma Payku.
 * Prueba variantes para encontrar la que match el hash oficial.
 */

import { createHmac } from "crypto";

const PRIVATE_TOKEN = "fe551abcef62fcf002dc598922e68f0a";
const REQUEST_PATH = "/api/suclient";
const EXPECTED = "d891663698d31aa8b68babe96ac6497f5a0d874024368102998d5b79a4d12c36";

const data: Record<string, unknown> = {
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

function hash(concat: string): string {
  return createHmac("sha256", PRIVATE_TOKEN).update(concat).digest("hex");
}

// Variantes a probar
const variants: { name: string; concat: string }[] = [];

// V1: URLSearchParams (espacios como +)
{
  const ordered: Record<string, string> = {};
  Object.keys(data)
    .sort()
    .forEach((k) => {
      const v = data[k];
      if (v !== null && v !== undefined && typeof v !== "object") {
        ordered[k] = String(v);
      }
    });
  const concat = `${encodeURIComponent(REQUEST_PATH)}&${new URLSearchParams(ordered).toString()}`;
  variants.push({ name: "V1_URLSearchParams", concat });
}

// V2: encodeURIComponent en values (espacios como %20)
{
  const sorted = Object.keys(data).sort();
  const parts: string[] = [];
  for (const k of sorted) {
    const v = data[k];
    if (v !== null && v !== undefined && typeof v !== "object") {
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
  }
  const concat = `${encodeURIComponent(REQUEST_PATH)}&${parts.join("&")}`;
  variants.push({ name: "V2_encodeURIComponent", concat });
}

// V3: requestPath SIN encoding (raw)
{
  const ordered: Record<string, string> = {};
  Object.keys(data)
    .sort()
    .forEach((k) => {
      const v = data[k];
      if (v !== null && v !== undefined && typeof v !== "object") {
        ordered[k] = String(v);
      }
    });
  const concat = `${REQUEST_PATH}&${new URLSearchParams(ordered).toString()}`;
  variants.push({ name: "V3_raw_path_URLSearchParams", concat });
}

// V4: requestPath raw + encodeURIComponent values
{
  const sorted = Object.keys(data).sort();
  const parts: string[] = [];
  for (const k of sorted) {
    const v = data[k];
    if (v !== null && v !== undefined && typeof v !== "object") {
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
  }
  const concat = `${REQUEST_PATH}&${parts.join("&")}`;
  variants.push({ name: "V4_raw_path_encodeURIComponent", concat });
}

// V5: SOLO requestPath sin params
{
  const concat = encodeURIComponent(REQUEST_PATH);
  variants.push({ name: "V5_only_path_encoded", concat });
}

// V6: requestPath raw sin params
{
  variants.push({ name: "V6_only_path_raw", concat: REQUEST_PATH });
}

// V7: URLSearchParams pero con trailing slash en path '/api/suclient/'
{
  const ordered: Record<string, string> = {};
  Object.keys(data)
    .sort()
    .forEach((k) => {
      const v = data[k];
      if (v !== null && v !== undefined && typeof v !== "object") {
        ordered[k] = String(v);
      }
    });
  const concat = `${encodeURIComponent("/api/suclient/")}&${new URLSearchParams(ordered).toString()}`;
  variants.push({ name: "V7_trailing_slash_URLSearchParams", concat });
}

// V8: encodeURIComponent values + trailing slash
{
  const sorted = Object.keys(data).sort();
  const parts: string[] = [];
  for (const k of sorted) {
    const v = data[k];
    if (v !== null && v !== undefined && typeof v !== "object") {
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
  }
  const concat = `${encodeURIComponent("/api/suclient/")}&${parts.join("&")}`;
  variants.push({ name: "V8_trailing_slash_encodeURIComponent", concat });
}

console.log(`Expected: ${EXPECTED}\n`);
for (const v of variants) {
  const h = hash(v.concat);
  const marker = h === EXPECTED ? "  ✓ MATCH" : "";
  console.log(`${v.name}${marker}`);
  console.log(`  concat: ${v.concat}`);
  console.log(`  hash:   ${h}\n`);
}
