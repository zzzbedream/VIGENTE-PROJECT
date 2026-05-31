"use client";

/**
 * Vigente Protocol — Threshold Credit Badge (v3 demo, Phase C)
 *
 * End-to-end UI for the post-Phase-B' contract:
 *   1. Borrower pastes their Stellar G-address.
 *   2. (Optional) Friendbot funds the account if it doesn't exist yet.
 *   3. /api/oracle/score-onchain reads Horizon, runs the synthetic scoring
 *      engine with the ecosystem whitelist + P2P penalty, returns features.
 *   4. /api/mint-v3 collects 3-of-5 threshold signatures, assembles the
 *      Soroban tx against vigente-badge v3 (CDLLO7QE…), the mother account
 *      pays gas, and the badge lands on testnet.
 *   5. UI renders score breakdown, signing oracles, and a stellar.expert
 *      link for the resulting tx.
 *
 * Lives at /v3 so the existing demo at / keeps working until we cut over
 * in Phase D.
 */

import { useMemo, useState } from "react";

const PUBKEY_RE = /^G[A-Z2-7]{55}$/;
const FRIENDBOT_URL = "https://friendbot.stellar.org";

type Stage =
  | "idle"
  | "checking-account"
  | "funding"
  | "scoring"
  | "scored"
  | "minting"
  | "minted"
  | "error";

interface ScoreResponse {
  features: {
    pubkey: string;
    account_age_days: number;
    ops_evaluated: number;
    window_days: number;
    capped: boolean;
    total_volume_usd_equiv: number;
    contract_volume_usd_equiv: number;
    p2p_volume_usd_equiv: number;
    adjusted_volume_usd_equiv: number;
    ecosystem_payment_ratio: number | null;
    density_cv: number | null;
    reciprocity_ratio: number | null;
    asset_diversity: number;
    data_source: string;
  };
  score: {
    totalScore: number;
    tier: number;
    badgeType: "Gold" | "Silver" | "Bronze" | "None";
    maxLoanAmount: number;
    breakdown: {
      volumePoints: number;
      consistencyPoints: number;
      frequencyPoints: number;
    };
  };
  latency_ms: number;
  cache_hit: boolean;
}

interface MintResponse {
  ok?: boolean;
  contract_id?: string;
  tx_hash?: string;
  explorer_url?: string;
  borrower?: string;
  score?: number;
  account_age_days?: number;
  signed_by_oracles?: number[];
  score_on_chain?: number | null;
  error?: string;
  detail?: string;
}

const TIER_COLORS: Record<string, string> = {
  Gold: "bg-yellow-500 text-black",
  Silver: "bg-gray-300 text-black",
  Bronze: "bg-orange-600 text-white",
  None: "bg-zinc-700 text-white",
};

export default function V3Page() {
  const [pubkey, setPubkey] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [scoreResponse, setScoreResponse] = useState<ScoreResponse | null>(null);
  const [mintResponse, setMintResponse] = useState<MintResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pubkeyValid = useMemo(() => PUBKEY_RE.test(pubkey.trim()), [pubkey]);
  const busy =
    stage === "checking-account" ||
    stage === "funding" ||
    stage === "scoring" ||
    stage === "minting";

  function reset() {
    setStage("idle");
    setStatusMsg("");
    setScoreResponse(null);
    setMintResponse(null);
    setError(null);
  }

  async function accountExists(addr: string): Promise<boolean> {
    const r = await fetch(`https://horizon-testnet.stellar.org/accounts/${addr}`);
    return r.status === 200;
  }

  async function fundIfNeeded() {
    setError(null);
    setStage("checking-account");
    setStatusMsg("Buscando cuenta en testnet…");
    try {
      const addr = pubkey.trim();
      const exists = await accountExists(addr);
      if (exists) {
        setStatusMsg("La cuenta ya existe en testnet, no es necesario fondear.");
        setStage("idle");
        return;
      }
      setStage("funding");
      setStatusMsg("Pidiendo XLM a Friendbot…");
      const r = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(addr)}`);
      if (!r.ok) {
        throw new Error(`Friendbot devolvió ${r.status}`);
      }
      setStatusMsg("Cuenta activada con Friendbot.");
      setStage("idle");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Friendbot falló: ${msg}`);
      setStage("error");
    }
  }

  async function fetchScore() {
    setError(null);
    setScoreResponse(null);
    setMintResponse(null);
    setStage("scoring");
    setStatusMsg("Calculando score on-chain con horizon-scoring…");
    try {
      const r = await fetch(
        `/api/oracle/score-onchain?pubkey=${encodeURIComponent(pubkey.trim())}`,
      );
      const data = (await r.json()) as ScoreResponse | { error: string };
      if (!r.ok || "error" in data) {
        const msg =
          ("error" in data && data.error) || `Score endpoint ${r.status}`;
        throw new Error(msg);
      }
      setScoreResponse(data);
      setStatusMsg(
        `Score listo en ${data.latency_ms} ms${data.cache_hit ? " (cache hit)" : ""}.`,
      );
      setStage("scored");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`No pude calcular el score: ${msg}`);
      setStage("error");
    }
  }

  async function mint() {
    if (!scoreResponse) return;
    setError(null);
    setMintResponse(null);
    setStage("minting");
    setStatusMsg("Recolectando firmas threshold y enviando la transacción…");
    try {
      const r = await fetch("/api/mint-v3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrower: pubkey.trim(),
          score: scoreResponse.score.totalScore,
          accountAgeDays: scoreResponse.features.account_age_days,
        }),
      });
      const data = (await r.json()) as MintResponse;
      if (!r.ok || data.error) {
        throw new Error(data.error ?? `Mint endpoint ${r.status}`);
      }
      setMintResponse(data);
      setStatusMsg(`Badge minteado. Score on-chain: ${data.score_on_chain}.`);
      setStage("minted");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Mint falló: ${msg}`);
      setStage("error");
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Vigente — Threshold Credit Badge</h1>
          <p className="text-zinc-400">
            v3 demo: synthetic on-chain scoring + 3-of-5 threshold oracle mint
            contra <code className="text-amber-400">CDLLO7QE…</code> en Stellar
            testnet. No requiere Payku, no requiere KYC fintech, solo una
            dirección Stellar.
          </p>
        </header>

        <section className="bg-zinc-900 rounded-lg p-4 space-y-3">
          <label htmlFor="pubkey" className="block text-sm font-medium">
            Stellar pubkey (G…)
          </label>
          <input
            id="pubkey"
            type="text"
            value={pubkey}
            onChange={(e) => {
              setPubkey(e.target.value);
              if (stage !== "idle") reset();
            }}
            placeholder="GBV676BNXDPVZDLUAB6O7DHWUIS42OTIWI5MIKCFJOWMJWTVKQNXFWCM"
            className="w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 font-mono text-sm focus:border-amber-400 focus:outline-none"
            disabled={busy}
          />
          {!pubkeyValid && pubkey.length > 0 && (
            <p className="text-rose-400 text-sm">
              Formato inválido. Debe empezar con G y tener 56 caracteres en
              base32.
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={fundIfNeeded}
              disabled={!pubkeyValid || busy}
              className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-sm font-medium"
            >
              {stage === "funding"
                ? "Fondeando…"
                : "Activar con Friendbot (opcional)"}
            </button>
            <button
              onClick={fetchScore}
              disabled={!pubkeyValid || busy}
              className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-400 text-black disabled:bg-zinc-700 disabled:text-zinc-500 text-sm font-medium"
            >
              {stage === "scoring" ? "Calculando…" : "Calcular score on-chain"}
            </button>
            {scoreResponse && (
              <button
                onClick={mint}
                disabled={busy}
                className="px-4 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black disabled:bg-zinc-700 disabled:text-zinc-500 text-sm font-medium"
              >
                {stage === "minting"
                  ? "Minteando…"
                  : `Mintear badge ${scoreResponse.score.badgeType}`}
              </button>
            )}
          </div>

          {statusMsg && (
            <p className="text-sm text-zinc-400 pt-2">{statusMsg}</p>
          )}
          {error && <p className="text-sm text-rose-400 pt-2">{error}</p>}
        </section>

        {scoreResponse && (
          <section className="bg-zinc-900 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Score on-chain</h2>
              <span
                className={`px-3 py-1 rounded font-bold text-sm ${
                  TIER_COLORS[scoreResponse.score.badgeType] ?? ""
                }`}
              >
                {scoreResponse.score.badgeType}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Stat
                label="Total"
                value={`${scoreResponse.score.totalScore}/100`}
              />
              <Stat
                label="Volumen"
                value={`${scoreResponse.score.breakdown.volumePoints}/40`}
              />
              <Stat
                label="Consistencia"
                value={`${scoreResponse.score.breakdown.consistencyPoints}/30`}
              />
              <Stat
                label="Frecuencia"
                value={`${scoreResponse.score.breakdown.frequencyPoints}/30`}
              />
              <Stat
                label="Edad de cuenta"
                value={`${scoreResponse.features.account_age_days} d`}
              />
              <Stat
                label="Ops evaluadas"
                value={`${scoreResponse.features.ops_evaluated}${
                  scoreResponse.features.capped ? " (capped)" : ""
                }`}
              />
              <Stat
                label="Volumen total"
                value={`$${scoreResponse.features.total_volume_usd_equiv.toFixed(2)}`}
              />
              <Stat
                label="Volumen ecosistema"
                value={`$${scoreResponse.features.contract_volume_usd_equiv.toFixed(2)}`}
              />
              <Stat
                label="Volumen P2P (penalizado)"
                value={`$${scoreResponse.features.p2p_volume_usd_equiv.toFixed(2)}`}
              />
              <Stat
                label="Volumen ajustado"
                value={`$${scoreResponse.features.adjusted_volume_usd_equiv.toFixed(2)}`}
              />
              <Stat
                label="Ratio ecosistema"
                value={
                  scoreResponse.features.ecosystem_payment_ratio === null
                    ? "n/a"
                    : (
                        scoreResponse.features.ecosystem_payment_ratio * 100
                      ).toFixed(0) + "%"
                }
              />
              <Stat
                label="Max loan (CLP)"
                value={scoreResponse.score.maxLoanAmount.toLocaleString()}
              />
            </div>
            <p className="text-xs text-zinc-500 pt-2">
              Data source: {scoreResponse.features.data_source}. Score firmado
              en el message threshold antes de mintear, junto con account_age,
              expiration y nonce.
            </p>
          </section>
        )}

        {mintResponse && mintResponse.ok && (
          <section className="bg-emerald-950 border border-emerald-700 rounded-lg p-4 space-y-2">
            <h2 className="text-xl font-semibold text-emerald-300">
              ✅ Badge minteado en testnet
            </h2>
            <p className="text-sm">
              <span className="text-zinc-400">Contract:</span>{" "}
              <code className="text-amber-300">{mintResponse.contract_id}</code>
            </p>
            <p className="text-sm">
              <span className="text-zinc-400">Tx:</span>{" "}
              <a
                href={mintResponse.explorer_url}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 hover:underline break-all"
              >
                {mintResponse.tx_hash}
              </a>
            </p>
            <p className="text-sm">
              <span className="text-zinc-400">Firmado por oráculos:</span>{" "}
              <code className="text-amber-300">
                [{mintResponse.signed_by_oracles?.join(", ")}]
              </code>{" "}
              de 5 (threshold 3)
            </p>
            <p className="text-sm">
              <span className="text-zinc-400">Score on-chain confirmado:</span>{" "}
              <strong>{String(mintResponse.score_on_chain)}</strong>
            </p>
          </section>
        )}

        <footer className="text-xs text-zinc-600 pt-6">
          Vigente Protocol · Phase B' hardening · k-of-n threshold ed25519 ·
          age floor 30 d · ecosystem whitelist + P2P penalty
        </footer>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-800 rounded px-3 py-2">
      <div className="text-zinc-400 text-xs">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}
