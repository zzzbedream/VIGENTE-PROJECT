/**
 * Vigente Protocol — Tranche 2 Validation Script
 *
 * Verifies that Tranche 2 (Testnet Expansion) deliverables are operational:
 *   - vigente-badge, reference-vault, and mock-usdc all compile and test
 *   - Cross-contract integration tests pass
 *   - Validation JSON includes test counts and lifecycle assertions
 *
 * Usage:
 *   npm run validate-t2
 */

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ValidationResult {
  tranche: 2;
  status: "complete" | "incomplete" | "error";
  contracts: {
    vigente_badge: { tests_passed: number | null; compiles: boolean };
    reference_vault: { tests_passed: number | null; compiles: boolean };
    mock_usdc: { tests_passed: number | null; compiles: boolean };
  };
  cross_contract_assertions: {
    full_lifecycle_test: boolean;
    default_slash_propagation: boolean;
    multi_user_isolation: boolean;
  };
  fintoc_integration: {
    quickstart_present: boolean;
    real_http_call: boolean; // true when live API integration replaces fixtures
  };
  total_tests: number;
  notes: string[];
  timestamp: string;
}

function runCargoTests(crateDir: string): {
  tests_passed: number | null;
  compiles: boolean;
  output: string;
} {
  try {
    const out = execSync("cargo test", {
      cwd: crateDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const match = out.match(/(\d+) passed/);
    return {
      tests_passed: match ? parseInt(match[1], 10) : null,
      compiles: true,
      output: out,
    };
  } catch (err: any) {
    return {
      tests_passed: null,
      compiles: false,
      output: err.message?.slice(0, 500) || "",
    };
  }
}

async function run(): Promise<ValidationResult> {
  const notes: string[] = [];
  const projectRoot = path.resolve(__dirname, "..", "..");
  const contractsRoot = path.join(projectRoot, "contracts");

  // Run tests for all three contracts
  const badge = runCargoTests(path.join(contractsRoot, "vigente-badge"));
  const vault = runCargoTests(path.join(contractsRoot, "reference-vault"));
  const usdc = runCargoTests(path.join(contractsRoot, "mock-usdc"));

  // Inspect vault test output for specific cross-contract assertions
  const fullLifecycle = vault.output.includes("test_full_lifecycle_happy_path ... ok");
  const defaultSlash = vault.output.includes("test_default_lifecycle_triggers_slash ... ok");
  const multiUser = vault.output.includes("test_multi_user_default_isolated ... ok");

  // Check Fintoc integration
  const fintocQuickstart = fs.existsSync(
    path.join(projectRoot, "integrations", "fintoc-sandbox", "src", "quickstart.js")
  );

  // Real HTTP call detection: look for fetch/axios in fintoc-sandbox source
  let realHttp = false;
  try {
    const quickstartSource = fs.readFileSync(
      path.join(projectRoot, "integrations", "fintoc-sandbox", "src", "quickstart.js"),
      "utf-8"
    );
    realHttp = /fetch\s*\(|axios\.|http\.get/.test(quickstartSource);
  } catch {}

  const totalTests =
    (badge.tests_passed || 0) + (vault.tests_passed || 0) + (usdc.tests_passed || 0);

  notes.push(`Total contract tests passing: ${totalTests}`);
  if (!realHttp) {
    notes.push("Fintoc integration: still using fixtures, not live HTTP — Tranche 2 work item");
  }

  const allCompile = badge.compiles && vault.compiles && usdc.compiles;
  const allAssertions = fullLifecycle && defaultSlash && multiUser;

  const result: ValidationResult = {
    tranche: 2,
    status: allCompile && allAssertions ? "complete" : "incomplete",
    contracts: {
      vigente_badge: { tests_passed: badge.tests_passed, compiles: badge.compiles },
      reference_vault: { tests_passed: vault.tests_passed, compiles: vault.compiles },
      mock_usdc: { tests_passed: usdc.tests_passed, compiles: usdc.compiles },
    },
    cross_contract_assertions: {
      full_lifecycle_test: fullLifecycle,
      default_slash_propagation: defaultSlash,
      multi_user_isolation: multiUser,
    },
    fintoc_integration: {
      quickstart_present: fintocQuickstart,
      real_http_call: realHttp,
    },
    total_tests: totalTests,
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
