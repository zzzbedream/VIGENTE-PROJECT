/**
 * Vigente Protocol - TTL keeper
 *
 * Why this exists: finding M-01 in audit/10_SECURITY_REVIEW_REPORT.md said TTL
 * maintenance was manual and nobody owned it. It was not theoretical - the badge
 * instance had already expired (H-04, liveUntilLedgerSeq 0) and the pool was down
 * to 2.8 days when we measured on 2026-09-02. Restoring them fixed the state; this
 * script is what fixes the cause.
 *
 * Soroban archives a contract instance once its TTL ledger passes. An archived
 * instance makes every real transaction against that contract fail until someone
 * pays for a RestoreFootprint. The CLI auto-restores when invoking, which is
 * exactly why manual testing did not notice the badge had expired.
 *
 * Usage:  npm run ttl-check
 * Exit:   0 = every instance above the threshold
 *         1 = at least one below the threshold, archived, or missing
 *         2 = the check itself could not run (RPC failure) - NOT a pass
 *
 * Env:    TTL_MIN_DAYS   alert threshold in days (default 30)
 *         NEXT_PUBLIC_RPC_URL   Soroban RPC (default SDF testnet)
 */

import { Address, rpc, xdr } from "@stellar/stellar-sdk";

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org";
const MIN_DAYS = Number(process.env.TTL_MIN_DAYS || 30);

/** Seconds per ledger on Stellar. Used only to turn ledgers into days. */
const SECONDS_PER_LEDGER = 5;

/**
 * Every instance whose expiry would break the pilot. The previous controller is
 * included on purpose: published evidence still links to it, and 10 XLM remain
 * locked in it (N-01), so letting it archive would break both.
 */
const WATCHED: ReadonlyArray<{ name: string; id: string; note: string }> = [
  {
    name: "badge",
    id: "CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD",
    note: "reputation registry - expired once already (H-04)",
  },
  {
    name: "pool",
    id: "CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI",
    note: "our isolated Blend pool",
  },
  {
    name: "aggregator",
    id: "CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4",
    note: "SEP-40 feed in the pool immutable oracle slot",
  },
  {
    name: "controller",
    id: "CAH2BHAEBYUCVQ4UQGNZKCLDD2KLP7GY3F2PWMNMXOZ7S54WLHG3C75W",
    note: "active",
  },
  {
    name: "controller-prev",
    id: "CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ",
    note: "superseded, still holds locked collateral (N-01)",
  },
];

/** LedgerKey for a contract instance. */
function instanceKey(contractId: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

interface Row {
  name: string;
  contract_id: string;
  live_until_ledger: number | null;
  days_left: number | null;
  status: "ok" | "below_threshold" | "archived" | "missing";
  note: string;
}

async function main(): Promise<void> {
  // rpc.Server, not raw fetch: Node global fetch (undici) keeps a socket handle
  // alive, and on Windows exiting with it pending trips a libuv assertion, so the
  // process dies with 127 instead of the intended code. The SDK client is also
  // what validate-t1.ts already uses.
  const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });

  const keys = WATCHED.map((w) => instanceKey(w.id));
  const b64 = keys.map((k) => k.toXDR("base64"));

  const res = await server.getLedgerEntries(...keys);
  const latest = res.latestLedger;
  const seen = new Map(
    res.entries.map((e) => [e.key.toXDR("base64"), e.liveUntilLedgerSeq]),
  );

  const rows: Row[] = WATCHED.map((w, i) => {
    const key = b64[i];
    const base = { name: w.name, contract_id: w.id, note: w.note };
    if (!seen.has(key)) {
      return { ...base, live_until_ledger: null, days_left: null, status: "missing" as const };
    }
    const liveUntil = seen.get(key);
    if (!liveUntil) {
      return { ...base, live_until_ledger: 0, days_left: 0, status: "archived" as const };
    }
    const days = ((liveUntil - latest) * SECONDS_PER_LEDGER) / 86400;
    return {
      ...base,
      live_until_ledger: liveUntil,
      days_left: Math.round(days * 10) / 10,
      status: days < MIN_DAYS ? ("below_threshold" as const) : ("ok" as const),
    };
  });

  const failing = rows.filter((r) => r.status !== "ok");

  console.log(`ledger ${latest} - threshold ${MIN_DAYS} days - ${RPC_URL}\n`);
  for (const r of rows) {
    const left = r.days_left === null ? "   n/a" : `${r.days_left}`.padStart(6);
    const mark = r.status === "ok" ? "ok " : "!! ";
    console.log(`${mark}${r.name.padEnd(16)} ${left} days   ${r.status.padEnd(16)} ${r.note}`);
  }

  console.log(`\n${JSON.stringify({ latest_ledger: latest, min_days: MIN_DAYS, rows, failing: failing.length }, null, 2)}`);

  if (failing.length > 0) {
    console.error(
      `\nFAIL: ${failing.length} instance(s) need attention: ${failing.map((f) => f.name).join(", ")}` +
        `\nRunbook: contracts/scripts/RUNBOOK-ttl.md`,
    );
    process.exit(1);
  }
  console.log("\nPASS: every watched instance is above the threshold.");
}

main().catch((err: unknown) => {
  // Exit 2, not 1: a check that could not run is not a passing check, and it is
  // not the same signal as an instance actually being low.
  console.error(`TTL check could not run: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
});
