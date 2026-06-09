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

import { useEffect, useMemo, useState } from "react";
import { useWalletKit } from "@/contexts/WalletKitContext";
import { waitForAccountIndexed } from "@/lib/poll-account";
import {
  CreditHistoryHeatmap,
  type HeatmapDay,
} from "@/components/CreditHistoryHeatmap";

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
    daily_activity?: HeatmapDay[];
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
  const { address: connectedAddress, connect, connecting, disconnect } = useWalletKit();
  const [pubkey, setPubkey] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [scoreResponse, setScoreResponse] = useState<ScoreResponse | null>(null);
  const [mintResponse, setMintResponse] = useState<MintResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill the pubkey field with the connected wallet's address.
  useEffect(() => {
    if (connectedAddress && pubkey !== connectedAddress) {
      setPubkey(connectedAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAddress]);

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

  async function downloadBadgePdf(
    mint: MintResponse,
    score: ScoreResponse | null,
  ) {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const tier = score?.score.badgeType ?? "—";
      const tierColors: Record<string, [number, number, number]> = {
        Gold: [212, 175, 55],
        Silver: [192, 192, 192],
        Bronze: [205, 127, 50],
        None: [80, 80, 80],
      };
      const [r, g, b] = tierColors[tier] ?? [34, 197, 94];

      doc.setFillColor(5, 5, 5);
      doc.rect(0, 0, 595, 842, "F");

      doc.setFillColor(r, g, b);
      doc.rect(0, 0, 595, 8, "F");

      doc.setTextColor(34, 197, 94);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(28);
      doc.text("VIGENTE PROTOCOL", 40, 80);
      doc.setTextColor(180, 180, 180);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text("threshold-signed credit badge · Stellar Soroban testnet", 40, 100);

      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(64);
      doc.text(tier.toUpperCase(), 40, 200);
      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(r, g, b);
      doc.text(`tier · score ${mint.score} / 1000`, 40, 225);

      const writeRow = (label: string, value: string, y: number) => {
        doc.setTextColor(140, 140, 140);
        doc.setFontSize(10);
        doc.text(label.toUpperCase(), 40, y);
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11);
        doc.setFont("courier", "normal");
        const wrapped = doc.splitTextToSize(value, 480);
        doc.text(wrapped, 40, y + 16);
        doc.setFont("helvetica", "normal");
        return y + 16 + wrapped.length * 14;
      };

      let y = 290;
      y = writeRow("Borrower address", mint.borrower ?? "—", y) + 14;
      y = writeRow("Contract ID (v3)", mint.contract_id ?? "—", y) + 14;
      y = writeRow("Transaction hash", mint.tx_hash ?? "—", y) + 14;
      y = writeRow(
        "Stellar Expert URL",
        mint.explorer_url ?? "—",
        y,
      ) + 14;
      y = writeRow(
        "Signed by oracles",
        `[${(mint.signed_by_oracles ?? []).join(", ")}] of 5 (threshold 3)`,
        y,
      ) + 14;
      y = writeRow(
        "Account age at mint",
        `${mint.account_age_days ?? "—"} days`,
        y,
      ) + 14;
      y = writeRow(
        "Score confirmed on-chain",
        String(mint.score_on_chain ?? "—"),
        y,
      ) + 14;
      y = writeRow("Issued at", new Date().toISOString(), y) + 14;

      doc.setTextColor(110, 110, 110);
      doc.setFontSize(8);
      doc.text(
        "Phase B' hardening · k-of-n threshold ed25519 · age floor 30 d · ecosystem whitelist + P2P penalty",
        40,
        800,
      );
      doc.text("This badge is verifiable on Stellar testnet. Visit the Stellar Expert URL to confirm.", 40, 815);

      const filename = `vigente-badge-${mint.borrower?.slice(0, 8)}-${(mint.tx_hash ?? "tx").slice(0, 8)}.pdf`;
      doc.save(filename);
    } catch (e) {
      console.error("[badge-pdf] failed:", e);
    }
  }

  async function fundViaFriendbotSilent(addr: string): Promise<boolean> {
    try {
      const r = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(addr)}`);
      return r.ok;
    } catch {
      return false;
    }
  }

  function looksLikeAccountNotFound(payload: unknown, status: number): boolean {
    if (status === 404) return true;
    if (
      payload &&
      typeof payload === "object" &&
      "error" in (payload as Record<string, unknown>)
    ) {
      const e = String((payload as { error: unknown }).error ?? "").toLowerCase();
      return (
        e.includes("not found") ||
        e.includes("account not found") ||
        e.includes("resource missing")
      );
    }
    return false;
  }

  async function fetchScore() {
    setError(null);
    setScoreResponse(null);
    setMintResponse(null);
    setStage("scoring");
    setStatusMsg("Calculando score on-chain con horizon-scoring…");
    const addr = pubkey.trim();
    try {
      let r = await fetch(
        `/api/oracle/score-onchain?pubkey=${encodeURIComponent(addr)}`,
      );
      let data = (await r.json()) as ScoreResponse | { error: string };

      // Auto-Friendbot: if the borrower's account doesn't exist on testnet
      // yet, fund it silently and retry once. This makes a freshly-generated
      // xBull / Albedo / Freighter address work without an extra click.
      if (!r.ok && looksLikeAccountNotFound(data, r.status)) {
        setStatusMsg("Activando la cuenta con Friendbot…");
        const funded = await fundViaFriendbotSilent(addr);
        if (!funded) {
          throw new Error(
            "La cuenta no existe en testnet y Friendbot no pudo activarla.",
          );
        }
        // G.5: poll Horizon with backoff instead of sleeping a fixed 2s.
        // A static delay loses races on slow days and wastes seconds on
        // fast days. Bounded by maxMs so a wedged Horizon doesn't hang.
        const indexed = await waitForAccountIndexed(addr, { maxMs: 15_000 });
        if (!indexed) {
          throw new Error(
            "La cuenta se fondeó pero Horizon no la indexó en 15s — reintenta.",
          );
        }
        setStatusMsg("Cuenta activada, reintentando score…");
        r = await fetch(
          `/api/oracle/score-onchain?pubkey=${encodeURIComponent(addr)}`,
        );
        data = (await r.json()) as ScoreResponse | { error: string };
      }

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
    <main className="min-h-screen bg-[#050505] text-zinc-100 px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Top wallet bar — brand left, nav center, wallet right */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#0d0f11] border border-white/5 rounded-2xl md:rounded-full px-4 py-3">
          <a href="/landing" className="flex items-center gap-2 text-sm">
            <svg viewBox="0 0 100 80" className="h-5 w-5" fill="none" aria-label="Vigente">
              <g stroke="#22c55e" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 45 38 63 90 10" />
              </g>
              <g fill="#1e3a5f">
                <circle cx="20" cy="45" r="4" />
                <circle cx="29" cy="54" r="3" />
                <circle cx="38" cy="63" r="4" />
              </g>
            </svg>
            <span className="text-white font-medium">vigente</span>
            <span className="hidden md:inline text-white/40 text-xs">protocol</span>
          </a>

          <div className="hidden md:flex items-center gap-1">
            <a href="/landing#protocol" className="text-neutral-300 hover:text-[#22c55e] transition-colors text-xs px-3 py-1.5 rounded-full">
              protocol
            </a>
            <a href="/landing#architecture" className="text-neutral-300 hover:text-[#22c55e] transition-colors text-xs px-3 py-1.5 rounded-full">
              architecture
            </a>
            <a href="/landing#threat-model" className="text-neutral-300 hover:text-[#22c55e] transition-colors text-xs px-3 py-1.5 rounded-full">
              threat model
            </a>
            <a href="/landing#partners" className="text-neutral-300 hover:text-[#22c55e] transition-colors text-xs px-3 py-1.5 rounded-full">
              partners
            </a>
          </div>

          {connectedAddress ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-[#22c55e] bg-[#22c55e]/10 border border-[#22c55e]/30 px-3 py-1.5 rounded-full">
                {connectedAddress.slice(0, 6)}…{connectedAddress.slice(-6)}
              </span>
              <button
                onClick={() => {
                  disconnect();
                  setPubkey("");
                }}
                className="text-xs text-white/40 hover:text-white transition-colors px-2"
              >
                disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="bg-[#22c55e] text-[#050505] text-sm font-medium rounded-full px-4 py-2 hover:bg-[#4ade80] disabled:opacity-60 transition-colors"
            >
              {connecting ? "connecting…" : "connect wallet"}
            </button>
          )}
        </div>

        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Vigente — Threshold Credit Badge</h1>
          <p className="text-zinc-400">
            v3 demo: synthetic on-chain scoring + 3-of-5 threshold oracle mint
            contra <code className="text-[#22c55e]">CDLLO7QE…</code> en Stellar
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
            className="w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 font-mono text-sm focus:border-[#22c55e] focus:outline-none"
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
              className="px-4 py-2 rounded-full bg-[#1e3a5f] hover:bg-[#274b78] disabled:bg-white/5 disabled:text-white/30 text-white text-sm font-medium transition-colors"
            >
              {stage === "funding"
                ? "Fondeando…"
                : "Activar con Friendbot (opcional)"}
            </button>
            <button
              onClick={fetchScore}
              disabled={!pubkeyValid || busy}
              className="px-4 py-2 rounded-full bg-[#22c55e] hover:bg-[#4ade80] disabled:bg-white/5 disabled:text-white/30 text-[#050505] text-sm font-medium transition-colors"
            >
              {stage === "scoring" ? "Calculando…" : "Calcular score on-chain"}
            </button>
            {scoreResponse && (
              <button
                onClick={mint}
                disabled={busy}
                className="px-4 py-2 rounded-full bg-[#22c55e] hover:bg-[#4ade80] disabled:bg-white/5 disabled:text-white/30 text-[#050505] text-sm font-medium transition-colors"
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

        {scoreResponse && (
          <section>
            <CreditHistoryHeatmap
              activity={scoreResponse.features.daily_activity ?? []}
              windowDays={scoreResponse.features.window_days || 180}
            />
          </section>
        )}

        {mintResponse && mintResponse.ok && (
          <section className="bg-emerald-950 border border-emerald-700 rounded-lg p-4 space-y-2">
            <h2 className="text-xl font-semibold text-emerald-300">
              ✅ Badge minteado en testnet
            </h2>
            <p className="text-sm">
              <span className="text-zinc-400">Contract:</span>{" "}
              <code className="text-[#22c55e]">{mintResponse.contract_id}</code>
            </p>
            <p className="text-sm">
              <span className="text-zinc-400">Tx:</span>{" "}
              <a
                href={mintResponse.explorer_url}
                target="_blank"
                rel="noreferrer"
                className="text-[#22c55e] hover:text-[#4ade80] hover:underline break-all"
              >
                {mintResponse.tx_hash}
              </a>
            </p>
            <p className="text-sm">
              <span className="text-zinc-400">Firmado por oráculos:</span>{" "}
              <code className="text-[#22c55e]">
                [{mintResponse.signed_by_oracles?.join(", ")}]
              </code>{" "}
              de 5 (threshold 3)
            </p>
            <p className="text-sm">
              <span className="text-zinc-400">Score on-chain confirmado:</span>{" "}
              <strong>{String(mintResponse.score_on_chain)}</strong>
            </p>
            <div className="pt-3">
              <button
                onClick={() => downloadBadgePdf(mintResponse, scoreResponse)}
                className="bg-[#22c55e] text-[#050505] text-sm font-medium rounded-full px-5 py-2 hover:bg-[#4ade80] transition-colors"
              >
                ⬇ Download badge (PDF)
              </button>
            </div>
          </section>
        )}

        {/* Explore — friendly cross-links to the rest of the protocol surface */}
        <section className="space-y-3 pt-8">
          <h2 className="text-lg font-medium text-white/80">explore the protocol</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ExploreCard
              href="/landing#architecture"
              title="architecture"
              body="three components, each verifiable. scoring engine + threshold quorum + soroban contracts."
            />
            <ExploreCard
              href="/landing#threat-model"
              title="threat model"
              body="six adversarial vectors. each one has a mitigation that ships in the current testnet contracts."
            />
            <ExploreCard
              href="/landing#partners"
              title="become a partner"
              body="APR provider, decentralised lending pool, or anchor — vigente is the credit primitive your pool plugs into."
            />
          </div>
        </section>

        <footer className="text-xs text-zinc-600 pt-6 flex flex-col md:flex-row gap-2 justify-between border-t border-white/5 mt-6">
          <span>
            Vigente Protocol · Phase B' hardening · k-of-n threshold ed25519 ·
            age floor 30 d · ecosystem whitelist + P2P penalty
          </span>
          <a
            href="mailto:zzzbedream@gmail.com"
            className="hover:text-[#22c55e] transition-colors"
          >
            zzzbedream@gmail.com
          </a>
        </footer>
      </div>
    </main>
  );
}

function ExploreCard({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <a
      href={href}
      className="block bg-[#0d0f11] border border-white/5 hover:border-[#22c55e]/50 rounded-xl p-4 transition-colors group"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-white group-hover:text-[#22c55e] transition-colors">
          {title}
        </h3>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-white/40 group-hover:text-[#22c55e] transition-colors">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </div>
      <p className="text-xs text-white/55 leading-relaxed">{body}</p>
    </a>
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
