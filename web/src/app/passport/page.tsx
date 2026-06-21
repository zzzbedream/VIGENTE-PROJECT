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
import { useState } from "react";
import {
  CreditHistoryHeatmap,
  type HeatmapDay,
} from "@/components/CreditHistoryHeatmap";
import { VigenteWordmark } from "@/components/VigenteLogo";
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

  async function loadPassport() {
    const addr = pubkey.trim();
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
            onClick={loadPassport}
            disabled={loading || !isValid}
            className="bg-[#22c55e] hover:bg-[#4ade80] disabled:opacity-40 disabled:cursor-not-allowed text-[#050505] font-medium text-sm rounded-lg px-6 py-3 transition-colors"
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
          <PassportCard pubkey={pubkey.trim()} profile={profile} badge={badge} />
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
