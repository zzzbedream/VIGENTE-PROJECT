/**
 * Vigente Protocol — Tranche 1 Validation Script
 *
 * Verifies that Tranche 1 (MVP) deliverables are operational.
 *
 * Usage:
 *   npm run validate-t1
 *
 * Output: JSON to stdout. Non-zero exit on failure.
 */

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ValidationResult {
  tranche: 1;
  status: "complete" | "incomplete" | "error";
  vigente_badge: {
    contract_id: string | null;
    tests_passed: number | null;
    code_compiles: boolean;
  };
  payku_oracle: {
    client_present: boolean;
    sample_endpoint: string;
    data_source_expected: string;
  };
  frontend: {
    live_url: string;
    build_passes: boolean | null;
  };
  notes: string[];
  timestamp: string;
}

async function run(): Promise<ValidationResult> {
  const notes: string[] = [];
  const projectRoot = path.resolve(__dirname, "..", "..");

  // Check vigente-badge contract
  const contractDir = path.join(projectRoot, "contracts", "vigente-badge");
  let testCount: number | null = null;
  let compiles = false;
  try {
    const out = execSync("cargo test", {
      cwd: contractDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const match = out.match(/(\d+) passed/);
    if (match) testCount = parseInt(match[1], 10);
    compiles = true;
    notes.push(`vigente-badge: ${testCount} tests passed`);
  } catch (err: any) {
    notes.push(`vigente-badge: tests failed — ${err.message?.slice(0, 200)}`);
  }

  // Check Payku client present
  const paykuClientPath = path.join(
    projectRoot,
    "web",
    "src",
    "services",
    "payku-client.ts"
  );
  const paykuPresent = fs.existsSync(paykuClientPath);
  if (paykuPresent) {
    notes.push("payku-client.ts: present");
  } else {
    notes.push("payku-client.ts: MISSING");
  }

  // Read contract ID from .env.local
  let contractId: string | null = null;
  const envPath = path.join(projectRoot, "web", ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    const match = envContent.match(/NEXT_PUBLIC_CONTRACT_ID="?([^"\n]+)"?/);
    if (match) contractId = match[1].trim();
  }

  const result: ValidationResult = {
    tranche: 1,
    status:
      compiles && testCount === 30 && paykuPresent && contractId
        ? "complete"
        : "incomplete",
    vigente_badge: {
      contract_id: contractId,
      tests_passed: testCount,
      code_compiles: compiles,
    },
    payku_oracle: {
      client_present: paykuPresent,
      sample_endpoint: "/api/oracle/score?rut=76.543.210-K",
      data_source_expected: "payku_sandbox_real (with credentials) | payku_fallback_mock (without)",
    },
    frontend: {
      live_url: "https://vigente-hackathon-final.vercel.app",
      build_passes: null, // TODO: run `npm run build` and parse exit code
    },
    notes,
    timestamp: new Date().toISOString(),
  };

  return result;
}

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === "complete" ? 0 : 1);
  })
  .catch((err) => {
    console.error(JSON.stringify({ status: "error", error: err.message }, null, 2));
    process.exit(2);
  });
