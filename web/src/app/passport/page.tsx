"use client";

/**
 * Vigente — Credit Passport demo.
 *
 * The wallet-integration pitch surface: "this is how a user's Vigente credit
 * reputation looks embedded in your wallet." It reuses the live
 * synthetic score API (/api/oracle/score-onchain) for the computed profile +
 * 180-day heat map, and the permissionless on-chain badge read
 * (verifyBadge → Interface v1) for the minted badge state.
 *
 * Everything here is read-only and needs no wallet — the same calls a partner
 * would make to render a credit passport for their own users.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CreditHistoryHeatmap,
  type HeatmapDay,
} from "@/components/CreditHistoryHeatmap";
import { VigenteWordmark } from "@/components/VigenteLogo";
import { useWalletKit } from "@/contexts/WalletKitContext";
import { verifyBadge } from "@/lib/stellar/vigente-contract";
import type { BadgeState } from "@/lib/integrations/eligibility-adapter";

const PUBKEY_RE = /^G[A-Z2-7]{55}$/;

const TIER_PILL: Record<string, string> = {
  Gold: "bg-amber-400 text-black",
  Silver: "bg-zinc-300 text-black",
  Bronze: "bg-orange-600 text-white",
  None: "bg-zinc-700 text-white",
};

interface ScoreApiResponse {
  features: {
    account_age_days: number;
    ops_evaluated: number;
    daily_activity: HeatmapDay[];
  };
  score: {
    totalScore: number; // 0-100
    badgeType: "Gold" | "Silver" | "Bronze" | "None";
    breakdown: {
      volumePoints: number;
      consistencyPoints: number;
      frequencyPoints: number;
    };
  };
}

export default function PassportPage() {
  const [pubkey, setPubkey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ScoreApiResponse | null>(null);
  const [badge, setBadge] = useState<BadgeState | null>(null);

  const isValid = PUBKEY_RE.test(pubkey.trim());
  const { address: walletAddress, connect, connecting } = useWalletKit();

  // The passport should open itself. Three ways in, in priority order:
  //   1. ?pubkey=G…      — shareable deep link
  //   2. connected wallet — including one restored from a previous session
  //   3. manual paste     — the "look at any address" case the page is for
  // Asking someone to paste an address they just connected with is friction with
  // no purpose, so anything we can resolve on our own, we load without a click.
  const autoloaded = useRef(false);
  useEffect(() => {
    if (autoloaded.current) return;
    const fromUrl = new URLSearchParams(window.location.search).get("pubkey")?.trim();
    const addr = fromUrl && PUBKEY_RE.test(fromUrl) ? fromUrl : walletAddress;
    if (!addr || !PUBKEY_RE.test(addr)) return;
    autoloaded.current = true;
    setPubkey(addr);
    void loadPassport(addr);
    // Re-runs only until the first successful autoload; loadPassport takes its
    // address as an argument rather than reading state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  /** Connect, then go straight to the passport — no second step. */
  async function connectAndLoad() {
    const addr = await connect();
    if (addr && PUBKEY_RE.test(addr)) {
      autoloaded.current = true;
      setPubkey(addr);
      void loadPassport(addr);
    }
  }

  async function loadPassport(override?: string) {
    const addr = (override ?? pubkey).trim();
    if (!PUBKEY_RE.test(addr)) {
      setError("enter a valid stellar public key (G…, 56 chars)");
      return;
    }
    setLoading(true);
    setError(null);
    setProfile(null);
    setBadge(null);
    try {
      // Computed profile from Horizon (the "what you'd score" preview) and the
      // on-chain badge state run in parallel — both are read-only.
      const [profileRes, badgeState] = await Promise.all([
        fetch(`/api/oracle/score-onchain?pubkey=${addr}`).then(async (r) => {
          if (!r.ok) {
            const body = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `score api ${r.status}`);
          }
          return (await r.json()) as ScoreApiResponse;
        }),
        verifyBadge(addr).catch(() => null),
      ]);
      setProfile(profileRes);
      setBadge(badgeState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load passport");
    } finally {
      setLoading(false);
    }
  }

  /**
   * A4 credit passport. Mirrors the badge PDF in /v3 so a partner receives the
   * same artefact from either surface — a portable document, not a text dump.
   */
  async function downloadPassportPdf() {
    if (!profile) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const addr = pubkey.trim();
    const tier = profile.score.badgeType;
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
    doc.text("credit passport · Stellar Soroban testnet", 40, 100);

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(64);
    doc.text(tier.toUpperCase(), 40, 200);
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(r, g, b);
    doc.text(`tier · score ${profile.score.totalScore} / 100`, 40, 225);

    const row = (label: string, value: string, y: number) => {
      doc.setTextColor(130, 130, 130);
      doc.setFontSize(9);
      doc.text(label.toUpperCase(), 40, y);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.text(value, 40, y + 16);
    };

    let y = 285;
    row("account", addr, y); y += 46;
    row("account age", `${profile.features.account_age_days} days`, y); y += 46;
    row("operations evaluated", String(profile.features.ops_evaluated), y); y += 46;
    row(
      "score breakdown",
      `volume ${profile.score.breakdown.volumePoints} · consistency ${profile.score.breakdown.consistencyPoints} · frequency ${profile.score.breakdown.frequencyPoints}`,
      y,
    );
    y += 46;
    row(
      "on-chain badge",
      badge
        ? `score ${badge.score}${badge.isDefaulted ? " · DEFAULTED" : ""}`
        : "not minted",
      y,
    );
    y += 46;
    row("issued", new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC", y);

    // The limits below are what makes this a credit document rather than a score
    // sheet, so they are stated with their source and their caveat.
    y += 60;
    doc.setDrawColor(40, 40, 40);
    doc.line(40, y, 555, y);
    y += 24;
    doc.setTextColor(130, 130, 130);
    doc.setFontSize(9);
    doc.text("HOW THIS IS USED", 40, y);
    y += 18;
    doc.setTextColor(200, 200, 200);
    doc.setFontSize(10);
    for (const line of [
      "A margin controller reads the ON-CHAIN badge score and sets the borrower's",
      "loan-to-value from it. On the 0-1000 badge scale: >=800 borrows at 85% of",
      "collateral, >=550 at 75%, >=300 at 60%. Below 300 the protocol does not lend.",
      "",
      "Note the two scales. The profile score above is 0-100 and is the preview",
      "computed from public Stellar Horizon activity; the badge score is 0-1000 and is",
      "what the contract actually reads.",
      "",
      "The score is computed off-chain and signed by 3 of 5 independent keys, verified",
      "on-chain at mint. The chain verifies the signatures, not the methodology - this",
      "document is an attestation, not a credit rating.",
    ]) {
      doc.text(line, 40, y);
      y += 14;
    }

    y += 20;
    doc.setTextColor(110, 110, 110);
    doc.setFontSize(9);
    doc.text("VERIFY", 40, y);
    y += 16;
    doc.setTextColor(160, 160, 160);
    doc.setFontSize(8);
    doc.text("badge      CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD", 40, y);
    y += 12;
    doc.text("controller CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ", 40, y);
    y += 12;
    doc.text("pool       CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI", 40, y);
    y += 12;
    doc.text("github.com/zzzbedream/VIGENTE-PROJECT", 40, y);

    doc.setTextColor(90, 90, 90);
    doc.setFontSize(8);
    doc.text("Testnet. Not a credit report under any regulatory framework.", 40, 812);

    doc.save(`vigente-passport-${addr.slice(0, 8)}.pdf`);
  }

  return (
    <main
      style={{ fontFamily: "var(--font-readex-pro), system-ui, sans-serif" }}
      className="min-h-screen bg-[#050505] text-white antialiased px-6 md:px-12 py-16"
    >
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="inline-flex mb-8" aria-label="Vigente Protocol — inicio">
          <VigenteWordmark />
        </Link>
        <h1 className="text-3xl md:text-4xl font-medium tracking-tight mb-2">
          credit passport
        </h1>
        <p className="text-white/60 mb-8 text-sm md:text-base max-w-xl">
          how a vigente credit reputation looks embedded in a wallet. read-only,
          no signature — the same calls a partner makes to render it for their own
          users.
        </p>

        <div className="mb-6">
          <button
            type="button"
            onClick={() => void connectAndLoad()}
            disabled={connecting || loading}
            className="w-full sm:w-auto bg-[#22c55e] hover:bg-[#4ade80] disabled:opacity-40 disabled:cursor-not-allowed text-[#050505] font-medium text-sm rounded-lg px-6 py-3 transition-colors"
          >
            {connecting
              ? "connecting…"
              : walletAddress
                ? `view my passport (${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)})`
                : "connect wallet"}
          </button>
          <p className="text-white/40 text-xs mt-3">
            or look up any address below — this page is read-only and never asks
            for a signature.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-10">
          <input
            value={pubkey}
            onChange={(e) => setPubkey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadPassport()}
            placeholder="G… stellar public key"
            spellCheck={false}
            className="flex-1 bg-[#0d0f11] border border-white/10 rounded-lg px-4 py-3 text-sm font-mono outline-none focus:border-[#22c55e]/60"
          />
          <button
            type="button"
            onClick={() => loadPassport()}
            disabled={loading || !isValid}
            className="border border-white/15 hover:border-[#22c55e]/60 hover:text-[#22c55e] disabled:opacity-30 disabled:cursor-not-allowed text-white/80 text-sm rounded-lg px-6 py-3 transition-colors"
          >
            {loading ? "reading…" : "load passport"}
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3 text-sm mb-8">
            {error}
          </div>
        )}

        {profile && (
          <>
            <div className="flex justify-end mb-3">
              <button
                type="button"
                onClick={() => void downloadPassportPdf()}
                className="text-xs border border-white/15 hover:border-[#22c55e]/60 hover:text-[#22c55e] rounded-md px-3 py-1.5 transition-colors"
              >
                download PDF
              </button>
            </div>
            <PassportCard pubkey={pubkey.trim()} profile={profile} badge={badge} />
          </>
        )}
      </div>
    </main>
  );
}

function PassportCard({
  pubkey,
  profile,
  badge,
}: {
  pubkey: string;
  profile: ScoreApiResponse;
  badge: BadgeState | null;
}) {
  const { features, score } = profile;
  const onChainStatus = badgeStatus(badge);

  return (
    <div className="bg-[#0d0f11] border border-white/10 rounded-2xl p-6 md:p-8 flex flex-col gap-8">
      {/* header: identity + tier */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-white/40 mb-1">
            account
          </div>
          <div className="font-mono text-sm text-white/80 truncate">
            {pubkey.slice(0, 6)}…{pubkey.slice(-6)}
          </div>
          <div className="text-xs text-white/40 mt-1">
            {features.account_age_days} days old · {features.ops_evaluated} ops
          </div>
        </div>
        <span
          className={`shrink-0 text-xs uppercase tracking-wider rounded-full px-3 py-1.5 font-medium ${
            TIER_PILL[score.badgeType]
          }`}
        >
          {score.badgeType}
        </span>
      </div>

      {/* on-chain badge state */}
      <div className="flex items-center justify-between border-y border-white/5 py-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-white/40 mb-1">
            on-chain badge
          </div>
          <div className={`text-sm font-medium ${onChainStatus.className}`}>
            {onChainStatus.label}
          </div>
        </div>
        {badge?.score != null && (
          <div className="text-right">
            <div className="text-2xl font-medium text-white">
              {badge.score}
              <span className="text-sm text-white/40">/1000</span>
            </div>
            <div className="text-xs text-white/40">verified on testnet</div>
          </div>
        )}
      </div>

      {/* computed profile breakdown */}
      <div>
        <div className="flex items-baseline justify-between mb-4">
          <div className="text-xs uppercase tracking-wider text-white/40">
            computed credit profile (horizon)
          </div>
          <div className="text-sm text-white/60">
            {score.totalScore}
            <span className="text-white/30">/100</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <ScoreBar label="volume" value={score.breakdown.volumePoints} max={40} />
          <ScoreBar
            label="consistency"
            value={score.breakdown.consistencyPoints}
            max={30}
          />
          <ScoreBar
            label="frequency"
            value={score.breakdown.frequencyPoints}
            max={30}
          />
        </div>
      </div>

      {/* 180-day heat map */}
      <div>
        <div className="text-xs uppercase tracking-wider text-white/40 mb-4">
          180-day on-chain activity
        </div>
        <CreditHistoryHeatmap activity={features.daily_activity} />
      </div>
    </div>
  );
}

function ScoreBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = Math.round((Math.min(value, max) / max) * 100);
  return (
    <div className="bg-[#050505] border border-white/5 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">
        {label}
      </div>
      <div className="text-base font-medium text-white mb-2">
        {value}
        <span className="text-xs text-white/30">/{max}</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-[#22c55e] rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function badgeStatus(badge: BadgeState | null): {
  label: string;
  className: string;
} {
  if (!badge) return { label: "not read", className: "text-white/40" };
  if (badge.isDefaulted) return { label: "in default", className: "text-red-400" };
  if (badge.score != null) return { label: "active", className: "text-[#22c55e]" };
  return { label: "no badge yet — mint to activate", className: "text-white/50" };
}
