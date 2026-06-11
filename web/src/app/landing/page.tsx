"use client";

/**
 * Vigente Protocol — Landing page (Phase D refresh, wallet-kit aware).
 *
 * Sections live in-page (not on GitHub): hero, evaluate, threshold sign,
 * architecture, threat model, partnerships, live testnet evidence, footer.
 * Top-right corner reads "vigente protocol" and a Stellar Wallets Kit
 * connect pill — supports xBull, Albedo, Freighter, Rabet, WalletConnect,
 * Lobstr, Hana, Hot Wallet, Klever via one modal.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useWalletKit } from "@/contexts/WalletKitContext";

const VIGENTE_GREEN = "#22c55e";
const VIGENTE_NAVY = "#1e3a5f";

const HERO_WORDS = [
  { text: "credit", style: "left-4 md:left-10 top-[18%]" },
  { text: "without", style: "right-4 md:right-10 top-[38%]" },
  { text: "permission", style: "left-[18%] md:left-[28%] top-[58%]" },
] as const;

const NAV_LINKS = [
  { label: "protocol", href: "#protocol" },
  { label: "architecture", href: "#architecture" },
  { label: "threat model", href: "#threat-model" },
  { label: "partners", href: "#partners" },
] as const;

const PUBKEY_RE = /^G[A-Z2-7]{55}$/;

interface ScoreResponse {
  features: {
    account_age_days: number;
    ops_evaluated: number;
    capped: boolean;
    total_volume_usd_equiv: number;
    contract_volume_usd_equiv: number;
    p2p_volume_usd_equiv: number;
    adjusted_volume_usd_equiv: number;
    ecosystem_payment_ratio: number | null;
    asset_diversity: number;
  };
  score: {
    totalScore: number;
    badgeType: "Gold" | "Silver" | "Bronze" | "None";
    breakdown: {
      volumePoints: number;
      consistencyPoints: number;
      frequencyPoints: number;
    };
  };
  latency_ms: number;
  cache_hit: boolean;
}

const TIER_PILL: Record<string, string> = {
  Gold: "bg-amber-400 text-black",
  Silver: "bg-zinc-300 text-black",
  Bronze: "bg-orange-600 text-white",
  None: "bg-zinc-700 text-white",
};

export default function LandingPage() {
  return (
    <main
      style={{ fontFamily: "var(--font-readex-pro), system-ui, sans-serif" }}
      className="bg-[#050505] text-white antialiased"
    >
      <Hero />
      <ModuleEvaluate />
      <ModuleThresholdSign />
      <ArchitectureSection />
      <ThreatModelSection />
      <PartnersSection />
      <ModuleLiveTestnet />
      <RoadmapSection />
      <Footer />
    </main>
  );
}

// ===========================================================================
// HERO
// ===========================================================================

function Hero() {
  return (
    <section className="relative h-screen w-full overflow-hidden bg-[#050505]">
      <HeroBackground />
      <HeroNav />

      <div className="relative h-full w-full">
        {HERO_WORDS.map((w) => (
          <h1
            key={w.text}
            className={`hero-title absolute text-white font-medium text-[14vw] md:text-[13vw] ${w.style}`}
            style={{ letterSpacing: "-0.04em", lineHeight: 0.95 }}
          >
            {w.text}
          </h1>
        ))}

        <p className="absolute left-6 md:left-10 top-[46%] max-w-[280px] text-[15px] leading-snug text-white/90">
          a k-of-n threshold credit oracle on stellar soroban. your borrowing
          reputation lives on-chain, signed by an independent quorum, with
          zero fintech in the trust path.
        </p>

        <StatBlock
          position="absolute right-6 md:right-24 top-[14%]"
          number="3 of 5"
          label="ed25519 threshold sigs"
          dividerRotation={20}
          align="right"
        />
        <StatBlock
          position="absolute left-6 md:left-20 bottom-20 md:bottom-24"
          number="104"
          label="tests green across the matrix"
          dividerRotation={-20}
          align="left"
        />
        <StatBlock
          position="absolute right-6 md:right-20 bottom-16 md:bottom-20"
          number="92 b"
          label="canonical mint message"
          dividerRotation={-20}
          align="right"
        />
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-b from-transparent to-[#050505]" />
    </section>
  );
}

function StatBlock({
  position,
  number,
  label,
  dividerRotation,
  align,
}: {
  position: string;
  number: string;
  label: string;
  dividerRotation: number;
  align: "left" | "right";
}) {
  const divider = (
    <div
      className="hidden md:block h-px w-24"
      style={{
        background: `${VIGENTE_GREEN}66`,
        transform: `rotate(${dividerRotation}deg)`,
      }}
    />
  );
  return (
    <div className={position}>
      <div
        className={`flex items-center gap-3 ${
          align === "right" ? "justify-end" : ""
        }`}
      >
        {align === "right" && divider}
        <span className="text-4xl md:text-5xl font-medium tracking-tight">
          {number}
        </span>
        {align === "left" && divider}
      </div>
      <div
        className={`text-xs md:text-sm text-white/70 mt-1 ${
          align === "right" ? "text-right" : ""
        }`}
      >
        {label}
      </div>
    </div>
  );
}

function HeroBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="absolute -top-1/4 left-1/4 h-[120vh] w-[80vw] rounded-full opacity-30 blur-[160px]"
        style={{
          background: `radial-gradient(circle, ${VIGENTE_NAVY} 0%, transparent 60%)`,
        }}
      />
      <div
        className="absolute bottom-0 right-0 h-[80vh] w-[60vw] rounded-full opacity-20 blur-[140px]"
        style={{
          background: `radial-gradient(circle, ${VIGENTE_GREEN} 0%, transparent 60%)`,
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.4) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}

function HeroNav() {
  return (
    <nav className="absolute z-20 top-0 left-0 right-0 px-6 md:px-10 pt-6 flex items-center justify-between gap-4">
      {/* Left pill: brand mark */}
      <div className="flex items-center gap-2 bg-[#0d0f11]/90 backdrop-blur border border-white/5 rounded-full pl-4 pr-6 py-3">
        <BrandMark />
        <span className="text-white text-sm font-normal tracking-tight">
          vigente
        </span>
      </div>

      {/* Center pill: internal anchors */}
      <div className="hidden md:flex items-center gap-1 bg-[#0d0f11]/90 backdrop-blur border border-white/5 rounded-full px-3 py-2">
        {NAV_LINKS.map((l) => (
          <a
            key={l.label}
            href={l.href}
            className="text-neutral-300 hover:text-[#22c55e] transition-colors text-sm px-5 py-2 rounded-full"
          >
            {l.label}
          </a>
        ))}
      </div>

      {/* Right: brand tag + wallet pill */}
      <div className="flex items-center gap-3">
        <span className="hidden md:inline text-white/80 text-sm font-medium tracking-tight">
          vigente protocol
        </span>
        <ConnectWalletPill />
      </div>
    </nav>
  );
}

function ConnectWalletPill() {
  const { address, connect, disconnect, connecting } = useWalletKit();
  const short = address
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : null;

  if (address) {
    return (
      <div className="flex items-center gap-2 bg-[#0d0f11]/90 backdrop-blur border border-[#22c55e]/40 rounded-full pl-3 pr-2 py-2">
        <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
        <span className="text-[#22c55e] text-xs font-mono">{short}</span>
        <button
          onClick={() => disconnect()}
          className="ml-1 text-white/60 hover:text-white text-xs px-2 py-1 rounded-full hover:bg-white/5 transition-colors"
        >
          disconnect
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => connect()}
      disabled={connecting}
      className="bg-[#22c55e] text-[#050505] text-sm font-medium rounded-full px-6 py-3 hover:bg-[#4ade80] transition-colors disabled:opacity-60"
    >
      {connecting ? "connecting…" : "connect wallet"}
    </button>
  );
}

function BrandMark() {
  return (
    <svg
      viewBox="0 0 100 80"
      className="h-5 w-5"
      fill="none"
      aria-label="Vigente logo"
    >
      <g stroke="#22c55e" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 45 38 63 90 10" />
      </g>
      <g fill={VIGENTE_NAVY}>
        <circle cx="20" cy="45" r="4" />
        <circle cx="29" cy="54" r="3" />
        <circle cx="38" cy="63" r="4" />
      </g>
    </svg>
  );
}

// ===========================================================================
// MODULE 1 — evaluate any stellar address (wallet-aware)
// ===========================================================================

function ModuleEvaluate() {
  const { address: connectedAddress } = useWalletKit();
  const [pubkey, setPubkey] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effective = pubkey.trim() || connectedAddress || "";
  const valid = useMemo(() => PUBKEY_RE.test(effective), [effective]);

  async function evaluate() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await fetch(
        `/api/oracle/score-onchain?pubkey=${encodeURIComponent(effective)}`,
      );
      const j = (await r.json()) as ScoreResponse | { error: string };
      if (!r.ok || "error" in j) {
        throw new Error("error" in j ? j.error : `HTTP ${r.status}`);
      }
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      id="protocol"
      className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-12">
        <div className="md:col-span-2">
          <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
            evaluate any stellar address
          </h2>
          <p className="text-white/70 max-w-xl mb-8 text-base md:text-lg">
            real horizon read, 180-day window, p2p churn discounted 70%. no
            signup, no fintech credentials. paste any G-address or connect a
            wallet up top to auto-fill.
          </p>

          {connectedAddress && (
            <div className="mb-4 text-xs text-white/60">
              wallet connected ·{" "}
              <span className="font-mono text-[#22c55e]">
                {connectedAddress.slice(0, 8)}…{connectedAddress.slice(-6)}
              </span>{" "}
              (auto-filled below)
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
            <input
              type="text"
              value={pubkey || connectedAddress || ""}
              onChange={(e) => setPubkey(e.target.value)}
              placeholder="GBV676BN..."
              className="flex-1 px-4 py-3 rounded-lg bg-[#0d0f11] border border-white/10 focus:border-[#22c55e] outline-none text-white placeholder-white/30 font-mono text-sm"
            />
            <button
              onClick={evaluate}
              disabled={!valid || loading}
              className="px-6 py-3 rounded-lg bg-[#22c55e] hover:bg-[#4ade80] disabled:bg-white/10 disabled:text-white/40 text-[#050505] font-medium text-sm transition-colors"
            >
              {loading ? "evaluating…" : "evaluate"}
            </button>
          </div>
          {effective.length > 0 && !valid && (
            <p className="text-rose-400 text-sm mt-2">
              format must be G + 55 base32 characters.
            </p>
          )}
          {error && <p className="text-rose-400 text-sm mt-2">{error}</p>}
        </div>

        <div className="bg-[#0d0f11] border border-white/5 rounded-xl p-6 min-h-[320px] flex flex-col gap-4">
          {!data && !loading && (
            <div className="text-white/40 text-sm flex-1 flex items-center justify-center">
              run an evaluation to see live features
            </div>
          )}
          {loading && (
            <div className="text-white/60 text-sm flex-1 flex items-center justify-center">
              calling horizon + scoring engine…
            </div>
          )}
          {data && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-white/60 text-xs uppercase tracking-wider">
                  tier
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    TIER_PILL[data.score.badgeType]
                  }`}
                >
                  {data.score.badgeType}
                </span>
              </div>
              <Row label="total score" value={`${data.score.totalScore} / 100`} />
              <Row
                label="account age"
                value={`${data.features.account_age_days} d`}
              />
              <Row
                label="ops evaluated"
                value={`${data.features.ops_evaluated}${
                  data.features.capped ? " (capped)" : ""
                }`}
              />
              <Row
                label="total volume"
                value={`$${data.features.total_volume_usd_equiv.toFixed(2)}`}
              />
              <Row
                label="ecosystem"
                value={`$${data.features.contract_volume_usd_equiv.toFixed(2)}`}
              />
              <Row
                label="p2p (penalized)"
                value={`$${data.features.p2p_volume_usd_equiv.toFixed(2)}`}
              />
              <Row
                label="adjusted volume"
                value={`$${data.features.adjusted_volume_usd_equiv.toFixed(2)}`}
              />
              <div className="text-[10px] text-white/30 text-right pt-2">
                {data.latency_ms} ms{data.cache_hit ? " · cache hit" : ""}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-white/60">{label}</span>
      <span className="font-mono text-white">{value}</span>
    </div>
  );
}

// ===========================================================================
// MODULE 2 — watch the threshold sign
// ===========================================================================

function ModuleThresholdSign() {
  const SIGNING_INDICES = [0, 1, 2];
  const ORACLES = [0, 1, 2, 3, 4];

  return (
    <section className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12 bg-gradient-to-b from-transparent via-[#22c55e]/[0.02] to-transparent">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          watch the threshold sign
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          every mint requires k of n independent oracle signatures over the
          canonical 92-byte message. no single party can authorise alone.
        </p>

        <div className="flex items-center justify-center gap-6 md:gap-12 mb-16 flex-wrap">
          {ORACLES.map((i) => {
            const signing = SIGNING_INDICES.includes(i);
            return (
              <div key={i} className="flex flex-col items-center gap-2">
                <div
                  className={`w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center border-2 transition-colors ${
                    signing
                      ? "border-[#22c55e] bg-[#22c55e]/10"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  {signing ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-8 h-8"
                    >
                      <polyline points="4 13 10 19 20 6" />
                    </svg>
                  ) : (
                    <span className="text-white/30 text-xs uppercase">
                      idle
                    </span>
                  )}
                </div>
                <span className="text-xs text-white/60 font-mono">
                  oracle&nbsp;{i}
                </span>
              </div>
            );
          })}
        </div>

        <div className="bg-[#0d0f11] border border-white/5 rounded-xl p-6 max-w-4xl mx-auto">
          <div className="text-xs uppercase tracking-wider text-white/40 mb-3">
            canonical signed message — 92 bytes
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-mono">
            <Chunk label="borrower xdr (44)" color="#1e3a5f" />
            <Chunk label="score u32 (4)" color="#22c55e" />
            <Chunk label="expiration u64 (8)" color="#22c55e" />
            <Chunk label="age_days u32 (4)" color="#22c55e" />
            <Chunk label="nonce (32)" color="#4ade80" />
          </div>
          <div className="mt-4 text-xs text-white/50 leading-relaxed">
            each oracle signs the same byte sequence with ed25519. the contract
            calls{" "}
            <code className="text-[#22c55e]">env.crypto().ed25519_verify</code>{" "}
            k times. fewer than k valid signatures, a duplicated oracle index,
            or any single tampered byte rejects the mint at simulation — no
            ledger pollution, no gas spent.
          </div>
        </div>
      </div>
    </section>
  );
}

function Chunk({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="px-3 py-1.5 rounded border"
      style={{
        borderColor: `${color}66`,
        background: `${color}1a`,
        color: "white",
      }}
    >
      {label}
    </span>
  );
}

// ===========================================================================
// ARCHITECTURE SECTION (lives on the page, not on GitHub)
// ===========================================================================

function ArchitectureSection() {
  return (
    <section
      id="architecture"
      className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          architecture
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          three components, each independently verifiable. nothing in the trust
          path is owned by a single party.
        </p>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <ArchCard
            step="1"
            title="synthetic scoring engine"
            body="off-chain reader of stellar horizon. 180-day window, 200-op cap. p2p churn discounted 70% against an ecosystem whitelist. zero fintech dependency."
            tag="off-chain"
          />
          <ArchCard
            step="2"
            title="threshold oracle quorum"
            body="five independent ed25519 keypairs. three signatures required. each signs the canonical 92-byte mint message. tampering one byte breaks all signatures."
            tag="off-chain"
          />
          <ArchCard
            step="3"
            title="soroban contracts"
            body="vigente-badge (soulbound credit token, threshold-verified mint, immutable slash) + reference-vault (credit-gated lending with TVL cap, util limit, withdrawal timelock)."
            tag="on-chain"
          />
        </div>

        <div className="bg-[#0d0f11] border border-white/5 rounded-xl p-6 md:p-8">
          <div className="text-xs uppercase tracking-wider text-white/40 mb-4">
            data flow
          </div>
          <div className="space-y-3 font-mono text-xs md:text-sm text-white/80">
            <FlowLine>
              <span className="text-[#22c55e]">①</span> user (or wallet) sends
              G-address → <span className="text-[#1e3a5f]">scoring engine</span>{" "}
              reads horizon
            </FlowLine>
            <FlowLine>
              <span className="text-[#22c55e]">②</span> engine returns features
              + tier → <span className="text-[#1e3a5f]">threshold oracle</span>{" "}
              signs message
            </FlowLine>
            <FlowLine>
              <span className="text-[#22c55e]">③</span> relayer assembles
              soroban call → <span className="text-[#1e3a5f]">badge contract</span>{" "}
              verifies k-of-n
            </FlowLine>
            <FlowLine>
              <span className="text-[#22c55e]">④</span> badge minted, nonce
              consumed, event emitted → readable by{" "}
              <span className="text-[#1e3a5f]">any vault</span> for credit-gated
              lending
            </FlowLine>
          </div>
        </div>
      </div>
    </section>
  );
}

function ArchCard({
  step,
  title,
  body,
  tag,
}: {
  step: string;
  title: string;
  body: string;
  tag: string;
}) {
  return (
    <div className="bg-[#0d0f11] border border-white/5 rounded-xl p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-3xl font-medium text-white/30 tracking-tight">
          {step}
        </span>
        <span
          className="text-[10px] uppercase tracking-wider px-2 py-1 rounded"
          style={{ background: `${VIGENTE_NAVY}55`, color: "#cbd5e1" }}
        >
          {tag}
        </span>
      </div>
      <h3 className="text-lg font-medium text-white">{title}</h3>
      <p className="text-sm text-white/60 leading-relaxed">{body}</p>
    </div>
  );
}

function FlowLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 leading-relaxed">{children}</div>
  );
}

// ===========================================================================
// THREAT MODEL SECTION (lives on the page, not on GitHub)
// ===========================================================================

const THREATS = [
  {
    vector: "carousel / wash trading",
    mitigation:
      "ecosystem whitelist + 70% penalty on p2p volume, monthly bins and effective tx count",
    status: "shipped",
  },
  {
    vector: "sybil bot farms",
    mitigation:
      "30-day wallet age floor folded into the signed mint message; tampered age breaks all sigs",
    status: "shipped",
  },
  {
    vector: "long-con default",
    mitigation:
      "credit ladder: first loan = 10% of tier ceiling; full cap unlocked only after first successful repay",
    status: "shipped",
  },
  {
    vector: "vault drainage / unbounded exposure",
    mitigation:
      "admin circuit breaker + TVL cap + 85% utilization rail (15% always liquid for LPs)",
    status: "shipped",
  },
  {
    vector: "centralized oracle compromise",
    mitigation:
      "k-of-n ed25519 verification on-chain; anti-replay nonce stored per-mint",
    status: "shipped",
  },
  {
    vector: "LP bank run",
    mitigation:
      "14-day withdrawal timelock + utilization floor — no single LP can drain on rumor alone",
    status: "shipped",
  },
] as const;

function ThreatModelSection() {
  return (
    <section
      id="threat-model"
      className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          threat model
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          six adversarial scenarios. each one has a code-level mitigation that
          ships in the current testnet contracts.
        </p>

        <div className="bg-[#0d0f11] border border-white/5 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 px-4 md:px-6 py-3 text-[10px] md:text-xs uppercase tracking-wider text-white/40 border-b border-white/5">
            <div className="col-span-4 md:col-span-3">vector</div>
            <div className="col-span-6 md:col-span-7">mitigation</div>
            <div className="col-span-2 text-right">status</div>
          </div>
          {THREATS.map((t, i) => (
            <div
              key={t.vector}
              className={`grid grid-cols-12 px-4 md:px-6 py-4 text-sm ${
                i % 2 === 1 ? "bg-white/[0.015]" : ""
              }`}
            >
              <div className="col-span-4 md:col-span-3 text-white font-medium">
                {t.vector}
              </div>
              <div className="col-span-6 md:col-span-7 text-white/70 leading-relaxed">
                {t.mitigation}
              </div>
              <div className="col-span-2 text-right">
                <span className="inline-block text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-[#22c55e]/15 text-[#22c55e]">
                  {t.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-white/40 mt-6 max-w-2xl">
          out-of-scope items (validator collapse, compromised user wallet, sdk
          bugs) are deliberately listed as such so the boundary of the
          protocol's responsibility is explicit.
        </p>
      </div>
    </section>
  );
}

// ===========================================================================
// PARTNERS SECTION — APR + lending pool partnerships
// ===========================================================================

function PartnersSection() {
  return (
    <section
      id="partners"
      className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          partners we're building with
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          vigente is the credit primitive — the yield + lending stack lives on
          top. we're actively forming partnerships in two directions.
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <PartnerCard
            track="apr partners (yield for LPs)"
            who="anchors, money-market protocols, stablecoin issuers"
            why="vigente badges unlock undercollateralised credit — LPs want stable USDC yield while their capital is at work. partners that already serve LATAM stablecoin holders are first in line."
            cta="apply as yield partner"
            email="zzzbedream@gmail.com"
          />
          <PartnerCard
            track="decentralised lending pools"
            who="blend, soroswap-lend, fixed-rate protocols on soroban"
            why="reference-vault is a working example, not the production lending market. mature soroban lending protocols can read get_score / is_defaulted from vigente-badge to gate their own pools, instantly underwriting micro-commerce credit risk."
            cta="integrate vigente as oracle"
            email="zzzbedream@gmail.com"
          />
        </div>

        <div className="bg-[#0d0f11] border border-[#22c55e]/20 rounded-xl p-6 md:p-8 flex flex-col md:flex-row gap-6 md:items-center">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-[#22c55e] mb-2">
              for protocol founders
            </div>
            <p className="text-white text-base md:text-lg leading-relaxed">
              if you run a soroban lending market and want to plug vigente's
              credit primitive in front of your pool — same week integration,
              zero token swap.
            </p>
          </div>
          <a
            href="mailto:zzzbedream@gmail.com?subject=Integration%20inquiry"
            className="bg-[#22c55e] hover:bg-[#4ade80] text-[#050505] font-medium text-sm rounded-full px-6 py-3 transition-colors whitespace-nowrap"
          >
            zzzbedream@gmail.com
          </a>
        </div>
      </div>
    </section>
  );
}

function PartnerCard({
  track,
  who,
  why,
  cta,
  email,
}: {
  track: string;
  who: string;
  why: string;
  cta: string;
  email: string;
}) {
  return (
    <div className="bg-[#0d0f11] border border-white/5 rounded-xl p-6 flex flex-col gap-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-[#22c55e] mb-2">
          {track}
        </div>
        <div className="text-base font-medium text-white">{who}</div>
      </div>
      <p className="text-sm text-white/60 leading-relaxed flex-1">{why}</p>
      <a
        href={`mailto:${email}`}
        className="inline-flex items-center gap-2 text-sm text-[#22c55e] hover:text-[#4ade80] transition-colors"
      >
        {cta}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3 h-3"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </a>
    </div>
  );
}

// ===========================================================================
// MODULE 3 — pinned testnet evidence
// ===========================================================================

function ModuleLiveTestnet() {
  return (
    <section className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          see it live on testnet
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          two real soroban calls against{" "}
          <code className="text-[#22c55e]">CDLLO7QE…</code>. the negative one
          shows the age floor enforcing on-chain through the signed account_age
          bytes.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <TxCard
            title="positive mint"
            color="#22c55e"
            txHash="8b9fccfc9daaf594e457e19808ef9c0746e8e45f37aab8417b5fe8d59641bc85"
            fields={[
              ["score", "880"],
              ["age days", "90"],
              ["status", "SUCCESS"],
              ["sigs", "3 of 5"],
              ["get_score returned", "880"],
            ]}
          />
          <TxCard
            title="age-floor trap"
            color="#ef4444"
            txHash={null}
            fields={[
              ["score", "700"],
              ["age days", "10 (below 30 floor)"],
              ["status", "Error(WasmVm, InvalidAction)"],
              ["ledger affected", "no — rejected at simulation"],
              ["gas spent", "0"],
            ]}
          />
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/v3"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-[#22c55e] hover:bg-[#4ade80] text-[#050505] font-medium transition-colors"
          >
            try a mint yourself
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

function TxCard({
  title,
  color,
  txHash,
  fields,
}: {
  title: string;
  color: string;
  txHash: string | null;
  fields: Array<[string, string]>;
}) {
  return (
    <div className="bg-[#0d0f11] border border-white/5 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-white">{title}</h3>
        <span
          className="px-2 py-1 rounded text-[10px] uppercase tracking-wider"
          style={{ background: `${color}22`, color }}
        >
          {txHash ? "tx on ledger" : "rejected"}
        </span>
      </div>
      <div className="space-y-2 mb-4">
        {fields.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between text-sm">
            <span className="text-white/60">{k}</span>
            <span className="font-mono text-white text-right">{v}</span>
          </div>
        ))}
      </div>
      {txHash && (
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[#22c55e] hover:text-[#4ade80] break-all font-mono block pt-3 border-t border-white/5"
        >
          {txHash}
        </a>
      )}
    </div>
  );
}

// ===========================================================================
// ROADMAP — honest tranche-aligned path to mainnet. "shipped" claims are
// verifiable on-chain; everything else is labeled by funding tranche.
// ===========================================================================

function RoadmapSection() {
  return (
    <section
      id="roadmap"
      className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          roadmap
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          built in the open, funded in tranches. everything marked shipped is
          verifiable on-chain today — the rest is scoped, costed, and labeled
          by the tranche that pays for it.
        </p>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <RoadmapCard
            tag="shipped · live now"
            tagClass="bg-[#22c55e]/15 text-[#22c55e]"
            title="credit primitive"
            items={[
              "3-of-5 threshold oracle verified on-chain",
              "soulbound credit badge + immutable defaults",
              "credit-gated reference vault (TVL cap, timelock)",
              "credit oracle interface v1 + ABI for integrators",
              "180-day on-chain credit heat map",
            ]}
          />
          <RoadmapCard
            tag="tranche 1 · hardening"
            tagClass="bg-white/10 text-white/70"
            title="production posture"
            items={[
              "oracle ops + key rotation runbook",
              "score cache to persistent storage",
              "vigente.app domain + admin dashboard",
              "SEP draft: credit attestation standard",
            ]}
          />
          <RoadmapCard
            tag="tranche 2 · yield layer"
            tagClass="bg-white/10 text-white/70"
            title="capital efficiency"
            items={[
              "LP yield accounting (claim without exit)",
              "SEP-0056 tokenized vault + DeFindex listing",
              "idle reserve earning in Blend pools",
              "/earn — one-click USDC deposits for LPs",
            ]}
          />
          <RoadmapCard
            tag="tranche 3 · mainnet"
            tagClass="bg-white/10 text-white/70"
            title="open infrastructure"
            items={[
              "mainnet deploy behind multi-sig",
              "typescript SDK on npm",
              "tier-segmented pools + staking",
              "micro-commerce pilot with fintech partners",
            ]}
          />
        </div>

        <p className="text-white/40 text-xs mt-8 max-w-2xl">
          deliberately out of scope until mainnet: own token, multi-chain,
          retail KYC, competing with existing lending markets. vigente is the
          credit layer other protocols read — not another lending app.
        </p>
      </div>
    </section>
  );
}

function RoadmapCard({
  tag,
  tagClass,
  title,
  items,
}: {
  tag: string;
  tagClass: string;
  title: string;
  items: string[];
}) {
  return (
    <div className="bg-[#0d0f11] border border-white/5 rounded-xl p-6 flex flex-col gap-4">
      <span
        className={`self-start text-[10px] uppercase tracking-wider rounded-full px-2.5 py-1 ${tagClass}`}
      >
        {tag}
      </span>
      <h3 className="text-lg font-medium text-white">{title}</h3>
      <ul className="space-y-2 text-sm text-white/70">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-[#22c55e] shrink-0">·</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// FOOTER (github link stays here, but not in top nav)
// ===========================================================================

function Footer() {
  return (
    <footer className="border-t border-white/5 py-12 px-6 md:px-12">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-6 items-center justify-between text-xs text-white/40">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span>vigente protocol · stellar soroban · testnet</span>
        </div>
        <div className="flex gap-6">
          <a
            href="mailto:zzzbedream@gmail.com"
            className="hover:text-white transition-colors"
          >
            contact
          </a>
          <Link href="/v3" className="hover:text-white transition-colors">
            app
          </Link>
          <a
            href="https://stellar.expert/explorer/testnet/contract/CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD"
            target="_blank"
            rel="noreferrer"
            className="hover:text-white transition-colors"
          >
            on-chain
          </a>
        </div>
      </div>
    </footer>
  );
}
