// DEFINITIVO: replica el código JS literal del spec usando crypto-js
// y compara con Node createHmac (mi V1). Si dan el mismo hash, la spec del
// "expected hash" está mal. Si difieren, hay un quirk de crypto-js que
// estoy ignorando.

import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const CryptoJS = require("crypto-js");

const EXPECTED = "d891663698d31aa8b68babe96ac6497f5a0d874024368102998d5b79a4d12c36";

// ─── Variante 1: replicación EXACTA del código JS del spec ───
// (líneas 128-168 del openapi-cl-es-v1.yaml)
function specReplicaCryptoJS() {
  const requestPath = encodeURIComponent("/api/suclient");
  const data = {
    email: "johndoe@example.com",
    name: "John Doe",
    phone: "923122312",
    address: "Moneda 101",
    country: "Chile",
    region: "Metropolitana",
    city: "Santiago",
    postal_code: "850000",
  };
  const orderedData = {};
  Object.keys(data)
    .sort()
    .forEach(function (key) {
      orderedData[key] = data[key];
      if (typeof orderedData[key] === "object") {
        delete orderedData[key];
      }
    });
  const arrayConcat = new URLSearchParams(orderedData).toString();
  const concat = requestPath + "&" + arrayConcat;
  const sign = CryptoJS.HmacSHA256(concat, "fe551abcef62fcf002dc598922e68f0a").toString();
  return { concat, sign };
}

// ─── Variante 2: misma data pero con Node createHmac ───
function specReplicaNode() {
  const requestPath = encodeURIComponent("/api/suclient");
  const data = {
    email: "johndoe@example.com",
    name: "John Doe",
    phone: "923122312",
    address: "Moneda 101",
    country: "Chile",
    region: "Metropolitana",
    city: "Santiago",
    postal_code: "850000",
  };
  const orderedData = {};
  Object.keys(data)
    .sort()
    .forEach((key) => {
      orderedData[key] = data[key];
      if (typeof orderedData[key] === "object") {
        delete orderedData[key];
      }
    });
  const arrayConcat = new URLSearchParams(orderedData).toString();
  const concat = requestPath + "&" + arrayConcat;
  const sign = createHmac("sha256", "fe551abcef62fcf002dc598922e68f0a")
    .update(concat)
    .digest("hex");
  return { concat, sign };
}

// ─── Variante 3: PHP data (con additional_parameters) + trailing slash ───
function specReplicaPhpStyleCryptoJS() {
  const requestPath = encodeURIComponent("/api/suclient/"); // PHP version
  const data = {
    email: "johndoe@example.com",
    name: "John Doe",
    phone: "923122312",
    address: "Moneda 101",
    country: "Chile",
    region: "Metropolitana",
    city: "Santiago",
    postal_code: "850000",
    additional_parameters: { parameter_1: "example", parameter_2: "example 2" },
  };
  const orderedData = {};
  Object.keys(data)
    .sort()
    .forEach((key) => {
      orderedData[key] = data[key];
      if (typeof orderedData[key] === "object") {
        delete orderedData[key];
      }
    });
  const arrayConcat = new URLSearchParams(orderedData).toString();
  const concat = requestPath + "&" + arrayConcat;
  const sign = CryptoJS.HmacSHA256(concat, "fe551abcef62fcf002dc598922e68f0a").toString();
  return { concat, sign };
}

const r1 = specReplicaCryptoJS();
const r2 = specReplicaNode();
const r3 = specReplicaPhpStyleCryptoJS();

console.log("═".repeat(80));
console.log(`Expected hash from spec: ${EXPECTED}\n`);

console.log("[V1] CryptoJS, JS-spec data (no trailing slash, no additional_parameters)");
console.log(`  concat: ${r1.concat}`);
console.log(`  hash:   ${r1.sign}  ${r1.sign === EXPECTED ? "✅ MATCH" : ""}\n`);

console.log("[V2] Node createHmac, same data");
console.log(`  concat: ${r2.concat}`);
console.log(`  hash:   ${r2.sign}  ${r2.sign === EXPECTED ? "✅ MATCH" : ""}\n`);

console.log("[V3] CryptoJS, PHP-spec data (trailing slash, includes additional_parameters)");
console.log(`  concat: ${r3.concat}`);
console.log(`  hash:   ${r3.sign}  ${r3.sign === EXPECTED ? "✅ MATCH" : ""}\n`);

console.log("═".repeat(80));
if (r1.sign === r2.sign) {
  console.log("✅ Node y CryptoJS producen el MISMO hash → mi V1 es algorítmicamente correcto.");
  console.log("   Conclusión: el 'expected hash' del OpenAPI tiene un error.");
  console.log("   Acción: confiar en V1 y validar con la API real de Payku.");
} else {
  console.log("⚠️ Node y CryptoJS DIFIEREN — hay un quirk de crypto-js que necesito investigar.");
}
