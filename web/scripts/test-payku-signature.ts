/**
 * Test del algoritmo de firma Payku contra el ejemplo canónico del OpenAPI.
 *
 * Replicación self-contained (sin import del cliente) para detectar
 * cualquier divergencia algorítmica de raíz.
 */

import { createHmac } from "crypto";

const PRIVATE_TOKEN = "fe551abcef62fcf002dc598922e68f0a";
const REQUEST_PATH = "/api/suclient";
const EXPECTED_SIGN =
  "d891663698d31aa8b68babe96ac6497f5a0d874024368102998d5b79a4d12c36";

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

// Algoritmo idéntico al spec JS oficial (líneas 128-168 del OpenAPI)
const encodedPath = encodeURIComponent(REQUEST_PATH);

const orderedData: Record<string, string> = {};
Object.keys(data)
  .sort()
  .forEach((key) => {
    const val = data[key];
    if (val === null || val === undefined) return;
    if (typeof val === "object") return; // excluye objects/arrays per spec
    orderedData[key] = String(val);
  });

const arrayConcat = new URLSearchParams(orderedData).toString();
const concat = `${encodedPath}&${arrayConcat}`;
const actual = createHmac("sha256", PRIVATE_TOKEN).update(concat).digest("hex");

const match = actual === EXPECTED_SIGN;

console.log(
  JSON.stringify(
    {
      test: "payku_signature_canonical",
      request_path: REQUEST_PATH,
      encoded_path: encodedPath,
      ordered_keys: Object.keys(orderedData),
      url_concat_preview: concat.slice(0, 80) + "...",
      expected: EXPECTED_SIGN,
      actual,
      match,
      note: match
        ? "OK — algoritmo idéntico al spec oficial; la firma será aceptada por Payku"
        : "FAIL — divergencia algorítmica; revisar URLSearchParams encoding o el orden de keys",
    },
    null,
    2
  )
);

process.exit(match ? 0 : 1);
