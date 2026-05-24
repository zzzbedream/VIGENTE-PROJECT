/**
 * Vigente Protocol — Tranche 3 Validation Script
 *
 * Verifies that Tranche 3 (Mainnet Launch) deliverables are operational.
 * This script is a SKELETON — it cannot run until Tranche 3 deliverables exist
 * (mainnet deployment, npm package, pilot users, etc).
 *
 * Usage:
 *   npm run validate-t3
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ValidationResult {
  tranche: 3;
  status: "complete" | "incomplete" | "error" | "not_started";
  mainnet: {
    vigente_badge_contract_id: string | null;
    reference_vault_contract_id: string | null;
    multi_sig_admin: boolean;
    first_mint_tx: string | null;
  };
  sdk: {
    npm_package: string;
    npm_version: string | null;
    weekly_downloads: number | null;
  };
  pilot: {
    active_users_count: number | null;
    originations_total_usdc: number | null;
    default_rate_percent: number | null;
    lp_partners_count: number | null;
  };
  docs_site: string | null;
  monitoring_dashboard: string | null;
  notes: string[];
  timestamp: string;
}

async function run(): Promise<ValidationResult> {
  const notes: string[] = [];
  const projectRoot = path.resolve(__dirname, "..", "..");

  // Mainnet contract IDs — read from a future config file
  // (this validation will become real once mainnet deployment happens)
  let mainnetBadge: string | null = null;
  let mainnetVault: string | null = null;

  const mainnetConfigPath = path.join(projectRoot, "config", "mainnet.json");
  if (fs.existsSync(mainnetConfigPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(mainnetConfigPath, "utf-8"));
      mainnetBadge = cfg.vigente_badge_contract_id || null;
      mainnetVault = cfg.reference_vault_contract_id || null;
      notes.push("mainnet config found");
    } catch (e) {
      notes.push("mainnet config malformed");
    }
  } else {
    notes.push(
      "mainnet config not present at config/mainnet.json — Tranche 3 not yet started"
    );
  }

  // SDK package check
  const sdkPackagePath = path.join(projectRoot, "packages", "vigente-sdk", "package.json");
  let sdkVersion: string | null = null;
  if (fs.existsSync(sdkPackagePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(sdkPackagePath, "utf-8"));
      sdkVersion = pkg.version;
      notes.push(`SDK package found at v${sdkVersion}`);
    } catch {}
  } else {
    notes.push("SDK package not present — Tranche 3 deliverable");
  }

  const status: ValidationResult["status"] =
    mainnetBadge && mainnetVault && sdkVersion ? "complete" : "not_started";

  const result: ValidationResult = {
    tranche: 3,
    status,
    mainnet: {
      vigente_badge_contract_id: mainnetBadge,
      reference_vault_contract_id: mainnetVault,
      multi_sig_admin: false, // TODO: verify via stellar CLI when deployed
      first_mint_tx: null,
    },
    sdk: {
      npm_package: "@vigente/sdk",
      npm_version: sdkVersion,
      weekly_downloads: null,
    },
    pilot: {
      active_users_count: null,
      originations_total_usdc: null,
      default_rate_percent: null,
      lp_partners_count: null,
    },
    docs_site: null,
    monitoring_dashboard: null,
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
