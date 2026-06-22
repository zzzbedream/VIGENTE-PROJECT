"use client";

/**
 * Vigente Protocol — Landing page (Phase D refresh, wallet-kit aware).
 *
 * Bilingual (EN/ES) via a lightweight Lang context + `tr()` helper. Section
 * components read the language; leaf card components receive already-translated
 * strings. Technical tokens (get_score, byte layout, tx fields, ids) stay
 * universal. Brand palette: Vigente indigo/violet (#818cf8) + navy, amber for
 * the Gold tier.
 */

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useWalletKit } from "@/contexts/WalletKitContext";
import { getOracleStatus, type OracleStatus } from "@/lib/integrations/vigente-read";
import { verifyBadge } from "@/lib/stellar/vigente-contract";
import type { BadgeState } from "@/lib/integrations/eligibility-adapter";
import { VigenteLogo } from "@/components/VigenteLogo";

const VIGENTE_GREEN = "#818cf8";
const VIGENTE_NAVY = "#1e3a5f";

// --- i18n -----------------------------------------------------------------

type Lang = "en" | "es";
const LangCtx = createContext<{ lang: Lang; toggle: () => void }>({
  lang: "en",
  toggle: () => {},
});
const useLang = () => useContext(LangCtx);
function tr(lang: Lang, en: string, es: string): string {
  return lang === "es" ? es : en;
}

const NAV_LINKS = [
  { en: "protocol", es: "protocolo", href: "#protocol" },
  { en: "architecture", es: "arquitectura", href: "#architecture" },
  { en: "live", es: "en vivo", href: "#live" },
  { en: "threat model", es: "amenazas", href: "#threat-model" },
  { en: "partners", es: "socios", href: "#partners" },
  { en: "impact", es: "impacto", href: "#impact" },
  { en: "passport", es: "pasaporte", href: "/passport" },
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
  const [lang, setLang] = useState<Lang>("en");
  const toggle = () => setLang((l) => (l === "en" ? "es" : "en"));

  return (
    <LangCtx.Provider value={{ lang, toggle }}>
      <main
        style={{ fontFamily: "var(--font-readex-pro), system-ui, sans-serif" }}
        className="bg-[#050505] text-white antialiased"
      >
        <Hero />
        <LiveOnchainStatus />
        <ModuleEvaluate />
        <ModuleThresholdSign />
        <ArchitectureSection />
        <ThreatModelSection />
        <PartnersSection />
        <ImpactSection />
        <ModuleLiveTestnet />
        <RoadmapSection />
        <Footer />
      </main>
    </LangCtx.Provider>
  );
}

// ===========================================================================
// HERO
// ===========================================================================

function Hero() {
  const { lang } = useLang();
  const words = [
    { text: tr(lang, "credit", "tu"), style: "left-4 md:left-10 top-[18%]" },
    { text: tr(lang, "you", "crédito"), style: "right-4 md:right-10 top-[38%]" },
    { text: tr(lang, "own", "propio"), style: "left-[18%] md:left-[28%] top-[58%]" },
  ];

  return (
    <section className="relative h-screen w-full overflow-hidden bg-[#050505]">
      <HeroBackground />
      <HeroNav />

      <div className="relative h-full w-full">
        {words.map((w) => (
          <h1
            key={w.text}
            className={`hero-title absolute text-white font-medium text-[14vw] md:text-[13vw] ${w.style}`}
            style={{ letterSpacing: "-0.04em", lineHeight: 0.95 }}
          >
            {w.text}
          </h1>
        ))}

        <p className="absolute left-6 md:left-10 top-[44%] max-w-[300px] text-[15px] leading-snug text-white/90">
          {tr(
            lang,
            "a credit reputation you carry, not one a bank keeps. a k-of-n threshold oracle on stellar soroban turns your on-chain history into fair credit — portable, yours, signed by an independent quorum. zero fintech in the trust path.",
            "una reputación crediticia que llevas contigo, no una que guarda un banco. un oráculo de umbral k-de-n sobre stellar soroban convierte tu historial on-chain en crédito justo — portable, tuyo, firmado por un quórum independiente. cero fintech en el camino de confianza.",
          )}
        </p>

        <StatBlock
          position="absolute right-6 md:right-24 top-[14%]"
          number="3 of 5"
          label={tr(lang, "ed25519 threshold sigs", "firmas de umbral ed25519")}
          dividerRotation={20}
          align="right"
        />
        <StatBlock
          position="absolute left-6 md:left-20 bottom-20 md:bottom-24"
          number="104"
          label={tr(lang, "tests green across the matrix", "tests verdes en toda la matriz")}
          dividerRotation={-20}
          align="left"
        />
        <StatBlock
          position="absolute right-6 md:right-20 bottom-16 md:bottom-20"
          number="92 b"
          label={tr(lang, "canonical mint message", "mensaje canónico de minteo")}
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
  const { lang } = useLang();
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
            key={l.href}
            href={l.href}
            className="text-neutral-300 hover:text-[#818cf8] transition-colors text-sm px-5 py-2 rounded-full"
          >
            {tr(lang, l.en, l.es)}
          </a>
        ))}
      </div>

      {/* Right: language toggle + wallet pill */}
      <div className="flex items-center gap-3">
        <LangToggle />
        <ConnectWalletPill />
      </div>
    </nav>
  );
}

function LangToggle() {
  const { lang, toggle } = useLang();
  return (
    <button
      onClick={toggle}
      aria-label={tr(lang, "Switch to Spanish", "Cambiar a inglés")}
      className="flex items-center gap-1 bg-[#0d0f11]/90 backdrop-blur border border-white/5 rounded-full px-1 py-1 text-xs font-medium"
    >
      <span
        className={`px-2.5 py-1 rounded-full transition-colors ${
          lang === "en" ? "bg-[#818cf8] text-[#050505]" : "text-white/60"
        }`}
      >
        EN
      </span>
      <span
        className={`px-2.5 py-1 rounded-full transition-colors ${
          lang === "es" ? "bg-[#818cf8] text-[#050505]" : "text-white/60"
        }`}
      >
        ES
      </span>
    </button>
  );
}

function ConnectWalletPill() {
  const { lang } = useLang();
  const { address, connect, disconnect, connecting } = useWalletKit();
  const short = address
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : null;

  if (address) {
    return (
      <div className="flex items-center gap-2 bg-[#0d0f11]/90 backdrop-blur border border-[#818cf8]/40 rounded-full pl-3 pr-2 py-2">
        <span className="w-2 h-2 rounded-full bg-[#818cf8]" />
        <span className="text-[#818cf8] text-xs font-mono">{short}</span>
        <button
          onClick={() => disconnect()}
          className="ml-1 text-white/60 hover:text-white text-xs px-2 py-1 rounded-full hover:bg-white/5 transition-colors"
        >
          {tr(lang, "disconnect", "desconectar")}
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => connect()}
      disabled={connecting}
      className="bg-[#818cf8] text-[#050505] text-sm font-medium rounded-full px-6 py-3 hover:bg-[#a5b4fc] transition-colors disabled:opacity-60"
    >
      {connecting
        ? tr(lang, "connecting…", "conectando…")
        : tr(lang, "connect wallet", "conectar wallet")}
    </button>
  );
}

function BrandMark() {
  return <VigenteLogo className="h-5 w-5" />;
}

// ===========================================================================
// LIVE ON-CHAIN STATUS
// ===========================================================================

const PASSPORT_SAMPLE = "GBV676BNXDPVZDLUAB6O7DHWUIS42OTIWI5MIKCFJOWMJWTVKQNXFWCM";

function LiveOnchainStatus() {
  const { lang } = useLang();
  const [status, setStatus] = useState<OracleStatus | null>(null);
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getOracleStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatusError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const k = status?.threshold ?? 3;
  const n = status?.keyCount ?? 5;
  const minAge = status?.minWalletAgeDays;
  const live = status !== null && !statusError;

  return (
    <section
      id="live"
      className="border-t border-white/5 py-20 md:py-28 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <span
            className={`h-2 w-2 rounded-full ${
              live ? "bg-[#818cf8] animate-pulse" : "bg-white/30"
            }`}
          />
          <h2 className="text-2xl md:text-4xl font-medium tracking-tight">
            {tr(lang, "live on-chain", "en vivo on-chain")}
          </h2>
          <span className="text-xs text-white/40">
            {live
              ? tr(lang, "read from the contract just now", "leído del contrato ahora")
              : tr(lang, "reading…", "leyendo…")}
          </span>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          <LiveStat label={tr(lang, "threshold", "umbral")} value={`${k} of ${n}`} sub={tr(lang, "ed25519 quorum", "quórum ed25519")} />
          <LiveStat label={tr(lang, "oracle keys", "claves del oráculo")} value={`${n}`} sub={tr(lang, "independent signers", "firmantes independientes")} />
          <LiveStat
            label={tr(lang, "wallet age floor", "edad mínima de cuenta")}
            value={minAge != null ? `${minAge}d` : "—"}
            sub={tr(lang, "anti-sybil mint gate", "control anti-sybil")}
          />
          <LiveStat
            label={tr(lang, "contract", "contrato")}
            value="CDLLO7QE…"
            sub={tr(lang, "testnet · soroban", "testnet · soroban")}
            href="https://stellar.expert/explorer/testnet/contract/CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD"
          />
        </div>

        <BadgeLookup />
      </div>
    </section>
  );
}

function LiveStat({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub: string;
  href?: string;
}) {
  const inner = (
    <div className="bg-[#0d0f11] border border-white/5 rounded-xl p-5 h-full">
      <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">
        {label}
      </div>
      <div className="text-2xl font-medium text-white tracking-tight">{value}</div>
      <div className="text-xs text-white/40 mt-1">{sub}</div>
    </div>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block hover:border-[#818cf8]/40">
        {inner}
      </a>
    );
  }
  return inner;
}

function BadgeLookup() {
  const { lang } = useLang();
  const [pubkey, setPubkey] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BadgeState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isValid = PUBKEY_RE.test(pubkey.trim());

  async function lookup() {
    const addr = pubkey.trim();
    if (!PUBKEY_RE.test(addr)) {
      setError(tr(lang, "enter a valid G… public key", "ingresa una clave pública válida (G…)"));
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await verifyBadge(addr));
    } catch (e) {
      setError(e instanceof Error ? e.message : tr(lang, "lookup failed", "lectura fallida"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#0d0f11] border border-white/5 rounded-xl p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-sm font-medium text-white">
            {tr(lang, "read a live badge", "lee una atestación en vivo")}
          </div>
          <div className="text-xs text-white/40">
            {tr(
              lang,
              "permissionless get_score / is_defaulted — no wallet, no signature",
              "get_score / is_defaulted permissionless — sin wallet ni firma",
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPubkey(PASSPORT_SAMPLE)}
          className="self-start md:self-auto text-xs text-white/50 hover:text-[#818cf8] transition-colors"
        >
          {tr(lang, "use a sample address", "usar una dirección de ejemplo")}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={pubkey}
          onChange={(e) => setPubkey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookup()}
          placeholder={tr(lang, "G… stellar public key", "G… clave pública de stellar")}
          spellCheck={false}
          className="flex-1 bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm font-mono outline-none focus:border-[#818cf8]/60"
        />
        <button
          type="button"
          onClick={lookup}
          disabled={loading || !isValid}
          className="bg-[#818cf8] hover:bg-[#a5b4fc] disabled:opacity-40 disabled:cursor-not-allowed text-[#050505] font-medium text-sm rounded-lg px-6 py-3 transition-colors"
        >
          {loading ? tr(lang, "reading…", "leyendo…") : tr(lang, "read", "leer")}
        </button>
      </div>

      {error && <div className="text-red-400 text-sm mt-3">{error}</div>}

      {result && (
        <div className="flex flex-wrap items-center gap-6 mt-4 pt-4 border-t border-white/5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">score</div>
            <div className="text-xl font-medium text-white">
              {result.score != null ? `${result.score}/1000` : tr(lang, "no badge", "sin badge")}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">default</div>
            <div
              className={`text-xl font-medium ${
                result.isDefaulted ? "text-red-400" : "text-[#818cf8]"
              }`}
            >
              {result.isDefaulted ? tr(lang, "yes", "sí") : "no"}
            </div>
          </div>
          <Link
            href="/passport"
            className="ml-auto text-sm text-[#818cf8] hover:text-[#a5b4fc] transition-colors"
          >
            {tr(lang, "full credit passport →", "pasaporte crediticio completo →")}
          </Link>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// MODULE 1 — evaluate any stellar address (wallet-aware)
// ===========================================================================

function ModuleEvaluate() {
  const { lang } = useLang();
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
      <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-10 md:gap-16">
        <div>
          <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
            {tr(lang, "score any address, live", "evalúa cualquier dirección, en vivo")}
          </h2>
          <p className="text-white/70 mb-6 text-base md:text-lg max-w-md">
            {tr(
              lang,
              "paste any stellar public key. the scoring engine reads horizon and returns the same features the oracle signs — no fintech, no private data.",
              "pega cualquier clave pública de stellar. el motor de scoring lee horizon y devuelve las mismas features que firma el oráculo — sin fintech, sin datos privados.",
            )}
          </p>

          {connectedAddress && (
            <div className="mb-4 text-xs text-white/60">
              {tr(lang, "wallet connected", "wallet conectada")} ·{" "}
              <span className="font-mono text-[#818cf8]">
                {connectedAddress.slice(0, 8)}…{connectedAddress.slice(-6)}
              </span>{" "}
              {tr(lang, "(auto-filled below)", "(autocompletado abajo)")}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
            <input
              type="text"
              value={pubkey || connectedAddress || ""}
              onChange={(e) => setPubkey(e.target.value)}
              placeholder="GBV676BN..."
              className="flex-1 px-4 py-3 rounded-lg bg-[#0d0f11] border border-white/10 focus:border-[#818cf8] outline-none text-white placeholder-white/30 font-mono text-sm"
            />
            <button
              onClick={evaluate}
              disabled={!valid || loading}
              className="px-6 py-3 rounded-lg bg-[#818cf8] hover:bg-[#a5b4fc] disabled:bg-white/10 disabled:text-white/40 text-[#050505] font-medium text-sm transition-colors"
            >
              {loading ? tr(lang, "evaluating…", "evaluando…") : tr(lang, "evaluate", "evaluar")}
            </button>
          </div>
          {effective.length > 0 && !valid && (
            <p className="text-rose-400 text-sm mt-2">
              {tr(lang, "format must be G + 55 base32 characters.", "el formato debe ser G + 55 caracteres base32.")}
            </p>
          )}
          {error && <p className="text-rose-400 text-sm mt-2">{error}</p>}
        </div>

        <div className="bg-[#0d0f11] border border-white/5 rounded-xl p-6 min-h-[320px] flex flex-col gap-4">
          {!data && !loading && (
            <div className="text-white/40 text-sm flex-1 flex items-center justify-center">
              {tr(lang, "run an evaluation to see live features", "ejecuta una evaluación para ver features en vivo")}
            </div>
          )}
          {loading && (
            <div className="text-white/60 text-sm flex-1 flex items-center justify-center">
              {tr(lang, "calling horizon + scoring engine…", "llamando a horizon + motor de scoring…")}
            </div>
          )}
          {data && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-white/60 text-xs uppercase tracking-wider">
                  {tr(lang, "tier", "tier")}
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    TIER_PILL[data.score.badgeType]
                  }`}
                >
                  {data.score.badgeType}
                </span>
              </div>
              <Row label={tr(lang, "total score", "puntaje total")} value={`${data.score.totalScore} / 100`} />
              <Row label={tr(lang, "account age", "edad de la cuenta")} value={`${data.features.account_age_days} d`} />
              <Row
                label={tr(lang, "ops evaluated", "ops evaluadas")}
                value={`${data.features.ops_evaluated}${
                  data.features.capped ? tr(lang, " (capped)", " (limitado)") : ""
                }`}
              />
              <Row label={tr(lang, "total volume", "volumen total")} value={`$${data.features.total_volume_usd_equiv.toFixed(2)}`} />
              <Row label={tr(lang, "ecosystem", "ecosistema")} value={`$${data.features.contract_volume_usd_equiv.toFixed(2)}`} />
              <Row label={tr(lang, "p2p (penalized)", "p2p (penalizado)")} value={`$${data.features.p2p_volume_usd_equiv.toFixed(2)}`} />
              <Row label={tr(lang, "adjusted volume", "volumen ajustado")} value={`$${data.features.adjusted_volume_usd_equiv.toFixed(2)}`} />
              <div className="text-[10px] text-white/30 text-right pt-2">
                {data.latency_ms} ms{data.cache_hit ? tr(lang, " · cache hit", " · cache hit") : ""}
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
  const { lang } = useLang();
  const SIGNING_INDICES = [0, 1, 2];
  const ORACLES = [0, 1, 2, 3, 4];

  return (
    <section className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12 bg-gradient-to-b from-transparent via-[#818cf8]/[0.02] to-transparent">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          {tr(lang, "watch the threshold sign", "mira firmar el umbral")}
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          {tr(
            lang,
            "every mint requires k of n independent oracle signatures over the canonical 92-byte message. no single party can authorise alone.",
            "cada minteo requiere k de n firmas de oráculos independientes sobre el mensaje canónico de 92 bytes. ninguna parte puede autorizar sola.",
          )}
        </p>

        <div className="flex items-center justify-center gap-6 md:gap-12 mb-16 flex-wrap">
          {ORACLES.map((i) => {
            const signing = SIGNING_INDICES.includes(i);
            return (
              <div key={i} className="flex flex-col items-center gap-2">
                <div
                  className={`w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center border-2 transition-colors ${
                    signing
                      ? "border-[#818cf8] bg-[#818cf8]/10"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  {signing ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#818cf8"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-8 h-8"
                    >
                      <polyline points="4 13 10 19 20 6" />
                    </svg>
                  ) : (
                    <span className="text-white/30 text-xs uppercase">
                      {tr(lang, "idle", "inactivo")}
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
            {tr(lang, "canonical signed message — 92 bytes", "mensaje canónico firmado — 92 bytes")}
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-mono">
            <Chunk label="borrower xdr (44)" color="#1e3a5f" />
            <Chunk label="score u32 (4)" color="#818cf8" />
            <Chunk label="expiration u64 (8)" color="#818cf8" />
            <Chunk label="age_days u32 (4)" color="#818cf8" />
            <Chunk label="nonce (32)" color="#a5b4fc" />
          </div>
          <div className="mt-4 text-xs text-white/50 leading-relaxed">
            {tr(
              lang,
              "each oracle signs the same byte sequence with ed25519. the contract calls",
              "cada oráculo firma la misma secuencia de bytes con ed25519. el contrato llama",
            )}{" "}
            <code className="text-[#818cf8]">env.crypto().ed25519_verify</code>{" "}
            {tr(
              lang,
              "k times. fewer than k valid signatures, a duplicated oracle index, or any single tampered byte rejects the mint at simulation — no ledger pollution, no gas spent.",
              "k veces. menos de k firmas válidas, un índice de oráculo duplicado, o un solo byte alterado rechaza el minteo en simulación — sin contaminar el ledger, sin gastar gas.",
            )}
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
// ARCHITECTURE SECTION
// ===========================================================================

function ArchitectureSection() {
  const { lang } = useLang();
  const cards = [
    {
      step: "1",
      title: tr(lang, "synthetic scoring engine", "motor de scoring sintético"),
      body: tr(
        lang,
        "off-chain reader of stellar horizon. 180-day window, 200-op cap. p2p churn discounted 70% against an ecosystem whitelist. zero fintech dependency.",
        "lector off-chain de stellar horizon. ventana de 180 días, límite de 200 ops. rotación p2p descontada 70% contra una lista blanca del ecosistema. cero dependencia fintech.",
      ),
      tag: tr(lang, "off-chain", "off-chain"),
    },
    {
      step: "2",
      title: tr(lang, "threshold oracle quorum", "quórum de oráculo de umbral"),
      body: tr(
        lang,
        "five independent ed25519 keypairs. three signatures required. each signs the canonical 92-byte mint message. tampering one byte breaks all signatures.",
        "cinco pares de claves ed25519 independientes. tres firmas requeridas. cada una firma el mensaje canónico de 92 bytes. alterar un byte rompe todas las firmas.",
      ),
      tag: tr(lang, "off-chain", "off-chain"),
    },
    {
      step: "3",
      title: tr(lang, "soroban contracts", "contratos soroban"),
      body: tr(
        lang,
        "vigente-badge (soulbound credit token, threshold-verified mint, immutable slash) + reference-vault (credit-gated lending with TVL cap, util limit, withdrawal timelock).",
        "vigente-badge (token de crédito soulbound, minteo verificado por umbral, slash inmutable) + reference-vault (préstamo gateado por crédito con tope de TVL, límite de utilización, timelock de retiro).",
      ),
      tag: tr(lang, "on-chain", "on-chain"),
    },
  ];

  return (
    <section
      id="architecture"
      className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          {tr(lang, "architecture", "arquitectura")}
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          {tr(
            lang,
            "three components, each independently verifiable. nothing in the trust path is owned by a single party.",
            "tres componentes, cada uno verificable de forma independiente. nada en el camino de confianza es propiedad de una sola parte.",
          )}
        </p>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {cards.map((c) => (
            <ArchCard key={c.step} step={c.step} title={c.title} body={c.body} tag={c.tag} />
          ))}
        </div>

        <div className="bg-[#0d0f11] border border-white/5 rounded-xl p-6 md:p-8">
          <div className="text-xs uppercase tracking-wider text-white/40 mb-6">
            {tr(lang, "the road ahead — the pipeline", "el camino por delante — el pipeline")}
          </div>
          <PipelineInfographic />
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

const PIPELINE_TAG_COLOR: Record<string, string> = {
  optional: "bg-white/10 text-white/50",
  "off-chain": "bg-[#1e3a5f]/50 text-slate-300",
  "on-chain": "bg-[#818cf8]/15 text-[#818cf8]",
  read: "bg-[#1e3a5f]/50 text-slate-300",
  impact: "bg-amber-400/15 text-amber-300",
};

function PipelineInfographic() {
  const { lang } = useLang();
  const stages = [
    { key: "optional", title: tr(lang, "open finance", "open finance"), note: tr(lang, "consented bank-data enrichment", "enriquecimiento de datos bancarios consentido") },
    { key: "off-chain", title: tr(lang, "scoring engine", "motor de scoring"), note: tr(lang, "horizon · 180d · zero fintech in trust path", "horizon · 180d · cero fintech en el path") },
    { key: "off-chain", title: tr(lang, "threshold oracle", "oráculo de umbral"), note: tr(lang, "k-of-n ed25519 · signs the mint", "k-de-n ed25519 · firma el minteo") },
    { key: "on-chain", title: tr(lang, "badge SBT", "badge SBT"), note: tr(lang, "soulbound · immutable defaults", "soulbound · defaults inmutables") },
    { key: "read", title: tr(lang, "consumers", "consumidores"), note: tr(lang, "wallets · lending protocols", "wallets · protocolos de préstamo") },
    { key: "impact", title: tr(lang, "inclusion", "inclusión"), note: tr(lang, "first-time credit · measured (IRIS+)", "primer crédito · medido (IRIS+)") },
  ];

  return (
    <div className="flex flex-col md:flex-row md:items-stretch gap-2">
      {stages.map((s, i) => (
        <div key={`${s.key}-${i}`} className="flex flex-col md:flex-row md:items-stretch gap-2 md:flex-1">
          <div className="flex-1 bg-[#050505] border border-white/5 rounded-lg p-4 flex flex-col gap-2">
            <span
              className={`self-start text-[9px] uppercase tracking-wider rounded-full px-2 py-0.5 ${
                PIPELINE_TAG_COLOR[s.key]
              }`}
            >
              {s.key}
            </span>
            <div className="text-sm font-medium text-white">{s.title}</div>
            <div className="text-[11px] text-white/40 leading-snug">{s.note}</div>
          </div>
          {i < stages.length - 1 && (
            <div className="flex items-center justify-center text-[#818cf8]/60 shrink-0 rotate-90 md:rotate-0">
              →
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ===========================================================================
// THREAT MODEL SECTION
// ===========================================================================

function ThreatModelSection() {
  const { lang } = useLang();
  const threats = [
    {
      vector: tr(lang, "carousel / wash trading", "carrusel / wash trading"),
      mitigation: tr(
        lang,
        "ecosystem whitelist + 70% penalty on p2p volume, monthly bins and effective tx count",
        "lista blanca del ecosistema + 70% de penalización al volumen p2p, bins mensuales y conteo efectivo de tx",
      ),
    },
    {
      vector: tr(lang, "sybil bot farms", "granjas de bots sybil"),
      mitigation: tr(
        lang,
        "30-day wallet age floor folded into the signed mint message; tampered age breaks all sigs",
        "edad mínima de 30 días incluida en el mensaje firmado; alterar la edad rompe todas las firmas",
      ),
    },
    {
      vector: tr(lang, "long-con default", "default de estafa larga"),
      mitigation: tr(
        lang,
        "credit ladder: first loan = 10% of tier ceiling; full cap unlocked only after first successful repay",
        "escalera de crédito: primer préstamo = 10% del tope del tier; el tope completo se desbloquea solo tras el primer repago exitoso",
      ),
    },
    {
      vector: tr(lang, "vault drainage / unbounded exposure", "drenaje del vault / exposición ilimitada"),
      mitigation: tr(
        lang,
        "admin circuit breaker + TVL cap + 85% utilization rail (15% always liquid for LPs)",
        "circuit breaker de admin + tope de TVL + riel de utilización 85% (15% siempre líquido para LPs)",
      ),
    },
    {
      vector: tr(lang, "centralized oracle compromise", "compromiso de oráculo centralizado"),
      mitigation: tr(
        lang,
        "k-of-n ed25519 verification on-chain; anti-replay nonce stored per-mint",
        "verificación k-de-n ed25519 on-chain; nonce anti-replay almacenado por minteo",
      ),
    },
    {
      vector: tr(lang, "LP bank run", "corrida de LPs"),
      mitigation: tr(
        lang,
        "14-day withdrawal timelock + utilization floor — no single LP can drain on rumor alone",
        "timelock de retiro de 14 días + piso de utilización — ningún LP puede drenar por un rumor",
      ),
    },
  ];

  return (
    <section
      id="threat-model"
      className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          {tr(lang, "threat model", "modelo de amenazas")}
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          {tr(
            lang,
            "six adversarial scenarios. each one has a code-level mitigation that ships in the current testnet contracts.",
            "seis escenarios adversariales. cada uno tiene una mitigación a nivel de código que ya está en los contratos de testnet.",
          )}
        </p>

        <div className="bg-[#0d0f11] border border-white/5 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 px-4 md:px-6 py-3 text-[10px] md:text-xs uppercase tracking-wider text-white/40 border-b border-white/5">
            <div className="col-span-4 md:col-span-3">{tr(lang, "vector", "vector")}</div>
            <div className="col-span-6 md:col-span-7">{tr(lang, "mitigation", "mitigación")}</div>
            <div className="col-span-2 text-right">{tr(lang, "status", "estado")}</div>
          </div>
          {threats.map((t, i) => (
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
                <span className="inline-block text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-[#818cf8]/15 text-[#818cf8]">
                  {tr(lang, "shipped", "listo")}
                </span>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-white/40 mt-6 max-w-2xl">
          {tr(
            lang,
            "out-of-scope items (validator collapse, compromised user wallet, sdk bugs) are deliberately listed as such so the boundary of the protocol's responsibility is explicit.",
            "los ítems fuera de alcance (colapso de validadores, wallet de usuario comprometida, bugs del sdk) se listan deliberadamente como tales para que el límite de responsabilidad del protocolo sea explícito.",
          )}
        </p>
      </div>
    </section>
  );
}

// ===========================================================================
// PARTNERS SECTION
// ===========================================================================

function PartnersSection() {
  const { lang } = useLang();
  return (
    <section
      id="partners"
      className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          {tr(lang, "partners we're building with", "socios con los que construimos")}
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          {tr(
            lang,
            "vigente is the credit primitive — the lending stack lives on top, the data layer feeds in. we're forming partnerships in two directions, with conservative limits and client protection baked in.",
            "vigente es el primitivo de crédito — el stack de préstamo va encima, la capa de datos alimenta. formamos alianzas en dos direcciones, con límites conservadores y protección al cliente incorporada.",
          )}
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <PartnerCard
            track={tr(lang, "layer 1 · lending protocols", "capa 1 · protocolos de préstamo")}
            who={tr(lang, "soroban lending markets", "mercados de préstamo soroban")}
            why={tr(
              lang,
              "a protocol reads get_score / is_defaulted to open a reputation-tier pool. for price-oracle markets, vigente gates eligibility off-chain at conservative, throttled limits (CP2). reference-vault is the on-chain reference any protocol can read directly.",
              "un protocolo lee get_score / is_defaulted para abrir un pool por tier de reputación. para mercados con oráculo de precio, vigente gatea la elegibilidad off-chain con límites conservadores y throttled (CP2). reference-vault es la referencia on-chain que cualquier protocolo puede leer directo.",
            )}
            cta={tr(lang, "integrate vigente as credit layer", "integrar vigente como capa de crédito")}
            email="zzzbedream@gmail.com"
          />
          <PartnerCard
            track={tr(lang, "data · open finance (optional enrichment)", "datos · open finance (enriquecimiento opcional)")}
            who={tr(lang, "open finance aggregators · chile-first", "agregadores de open finance · chile primero")}
            why={tr(
              lang,
              "the core score reads only stellar horizon, so the trust path stays fintech-free. open finance is opt-in enrichment that adds detail to a thin-file borrower's profile — never a gate, never published on-chain.",
              "el score core lee solo stellar horizon, así el camino de confianza queda libre de fintech. el open finance es enriquecimiento opt-in que añade detalle al perfil de un prestatario sin historial — nunca un gate, nunca publicado on-chain.",
            )}
            cta={tr(lang, "partner on data", "aliarse en datos")}
            email="zzzbedream@gmail.com"
          />
        </div>

        <div className="bg-[#0d0f11] border border-[#818cf8]/20 rounded-xl p-6 md:p-8 flex flex-col md:flex-row gap-6 md:items-center">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-[#818cf8] mb-2">
              {tr(lang, "for protocol founders", "para fundadores de protocolos")}
            </div>
            <p className="text-white text-base md:text-lg leading-relaxed">
              {tr(
                lang,
                "if you run a soroban lending market and want to plug vigente's credit primitive in front of your pool — same week integration, zero token swap.",
                "si operas un mercado de préstamo soroban y quieres conectar el primitivo de crédito de vigente frente a tu pool — integración la misma semana, sin token swap.",
              )}
            </p>
          </div>
          <a
            href="mailto:zzzbedream@gmail.com?subject=Integration%20inquiry"
            className="bg-[#818cf8] hover:bg-[#a5b4fc] text-[#050505] font-medium text-sm rounded-full px-6 py-3 transition-colors whitespace-nowrap"
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
        <div className="text-xs uppercase tracking-wider text-[#818cf8] mb-2">
          {track}
        </div>
        <div className="text-base font-medium text-white">{who}</div>
      </div>
      <p className="text-sm text-white/60 leading-relaxed flex-1">{why}</p>
      <a
        href={`mailto:${email}`}
        className="inline-flex items-center gap-2 text-sm text-[#818cf8] hover:text-[#a5b4fc] transition-colors"
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
// IMPACT / INCLUSION
// ===========================================================================

function ImpactSection() {
  const { lang } = useLang();
  const cards = [
    {
      title: tr(lang, "shared value, not charity", "valor compartido, no caridad"),
      body: tr(
        lang,
        "the underserved market — earners with on-chain or open-finance data but no traditional score — IS the target market. every score that unlocks fair credit earns a fee and cuts financial exclusion at the same time.",
        "el mercado desatendido — personas con datos on-chain o de open finance pero sin score tradicional — ES el mercado objetivo. cada score que habilita crédito justo cobra un fee y a la vez reduce la exclusión financiera.",
      ),
    },
    {
      title: tr(lang, "no over-indebtedness", "sin sobreendeudamiento"),
      body: tr(
        lang,
        "conservative tier ceilings, a first-loan throttle to 10%, and immutable defaults. enabling credit to the unbanked must never push them into unpayable debt — the limits are proven on-chain in reference-vault.",
        "topes conservadores por tier, un throttle de 10% en el primer préstamo, y defaults inmutables. habilitar crédito a los no bancarizados nunca debe empujarlos a una deuda impagable — los límites están probados on-chain en reference-vault.",
      ),
    },
    {
      title: tr(lang, "metrics that aren't vanity", "métricas que no son vanidad"),
      body: tr(
        lang,
        "we measure first-time credit access, cost of credit before vs. after, real default rate, and 6/12-month persistence — with a baseline and external verification. not 'wallets created'.",
        "medimos acceso a crédito por primera vez, costo del crédito antes vs. después, tasa real de default, y persistencia a 6/12 meses — con línea base y verificación externa. no 'wallets creadas'.",
      ),
    },
    {
      title: tr(lang, "fair, explainable, private", "justo, explicable, privado"),
      body: tr(
        lang,
        "disparate-impact audits across groups, an explainable score with a right to human review (Ley 21.719), and no personal data published on-chain. client protection (Cerise+SPTF) is a release gate, not a slogan.",
        "auditorías de impacto dispar entre grupos, un score explicable con derecho a revisión humana (Ley 21.719), y sin datos personales publicados on-chain. la protección al cliente (Cerise+SPTF) es un gate de release, no un eslogan.",
      ),
    },
  ];

  return (
    <section
      id="impact"
      className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          {tr(lang, "inclusion is the product", "la inclusión es el producto")}
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          {tr(
            lang,
            "a credit history is an asset the user owns — soulbound, portable, readable by every protocol that integrates vigente. it turns on-chain activity into fair credit. funded by the protocols that use it, not by grants — sustainable by design, not charity.",
            "un historial crediticio es un activo que el usuario posee — soulbound, portable, legible por cada protocolo que integra vigente. convierte la actividad on-chain en crédito justo. financiado por los protocolos que lo usan, no por grants — sostenible por diseño, no caridad.",
          )}
        </p>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {cards.map((c) => (
            <div
              key={c.title}
              className="bg-[#0d0f11] border border-white/5 rounded-xl p-6 flex flex-col gap-3"
            >
              <h3 className="text-base font-medium text-white">{c.title}</h3>
              <p className="text-sm text-white/60 leading-relaxed">{c.body}</p>
            </div>
          ))}
        </div>

        <p className="text-white/40 text-xs mt-8 max-w-2xl">
          {tr(
            lang,
            "aligned to SDG 1 / 5 / 8 / 10 and the Cerise+SPTF client-protection standards. measured with IRIS+ — baseline, comparison group, external verification.",
            "alineado a los ODS 1 / 5 / 8 / 10 y a los estándares de protección al cliente Cerise+SPTF. medido con IRIS+ — línea base, grupo de comparación, verificación externa.",
          )}
        </p>
      </div>
    </section>
  );
}

// ===========================================================================
// MODULE 3 — pinned testnet evidence
// ===========================================================================

function ModuleLiveTestnet() {
  const { lang } = useLang();
  return (
    <section className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          {tr(lang, "see it live on testnet", "míralo en vivo en testnet")}
        </h2>
        <p className="text-white/70 max-w-2xl mb-12 text-base md:text-lg">
          {tr(lang, "two real soroban calls against", "dos llamadas soroban reales contra")}{" "}
          <code className="text-[#818cf8]">CDLLO7QE…</code>.{" "}
          {tr(
            lang,
            "the negative one shows the age floor enforcing on-chain through the signed account_age bytes.",
            "la negativa muestra la edad mínima aplicándose on-chain a través de los bytes firmados de account_age.",
          )}
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <TxCard
            title={tr(lang, "positive mint", "minteo positivo")}
            color="#818cf8"
            txHash="8b9fccfc9daaf594e457e19808ef9c0746e8e45f37aab8417b5fe8d59641bc85"
            badge={tr(lang, "tx on ledger", "tx en ledger")}
            fields={[
              ["score", "880"],
              [tr(lang, "age days", "días de edad"), "90"],
              ["status", "SUCCESS"],
              ["sigs", "3 of 5"],
              ["get_score returned", "880"],
            ]}
          />
          <TxCard
            title={tr(lang, "age-floor trap", "trampa de edad mínima")}
            color="#ef4444"
            txHash={null}
            badge={tr(lang, "rejected", "rechazado")}
            fields={[
              ["score", "700"],
              [tr(lang, "age days", "días de edad"), tr(lang, "10 (below 30 floor)", "10 (bajo el piso de 30)")],
              ["status", "Error(WasmVm, InvalidAction)"],
              [tr(lang, "ledger affected", "ledger afectado"), tr(lang, "no — rejected at simulation", "no — rechazado en simulación")],
              [tr(lang, "gas spent", "gas gastado"), "0"],
            ]}
          />
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/v3"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-[#818cf8] hover:bg-[#a5b4fc] text-[#050505] font-medium transition-colors"
          >
            {tr(lang, "try a mint yourself", "haz un minteo tú mismo")}
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
  badge,
  fields,
}: {
  title: string;
  color: string;
  txHash: string | null;
  badge: string;
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
          {badge}
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
          className="text-xs text-[#818cf8] hover:text-[#a5b4fc] break-all font-mono block pt-3 border-t border-white/5"
        >
          {txHash}
        </a>
      )}
    </div>
  );
}

// ===========================================================================
// ROADMAP
// ===========================================================================

function RoadmapSection() {
  const { lang } = useLang();
  const cards = [
    {
      tag: tr(lang, "shipped · live now", "listo · en vivo"),
      tagClass: "bg-[#818cf8]/15 text-[#818cf8]",
      title: tr(lang, "credit primitive", "primitivo de crédito"),
      items: [
        tr(lang, "3-of-5 threshold oracle verified on-chain", "oráculo de umbral 3-de-5 verificado on-chain"),
        tr(lang, "soulbound credit badge + immutable defaults", "badge de crédito soulbound + defaults inmutables"),
        tr(lang, "credit-gated reference vault (TVL cap, timelock)", "reference vault gateado por crédito (tope TVL, timelock)"),
        tr(lang, "credit oracle interface v1 + ABI for integrators", "interfaz v1 del oráculo de crédito + ABI para integradores"),
        tr(lang, "180-day on-chain credit heat map", "mapa de calor de crédito on-chain de 180 días"),
      ],
    },
    {
      tag: tr(lang, "tranche 1 · layer 1 (primary)", "tramo 1 · capa 1 (primario)"),
      tagClass: "bg-[#818cf8]/15 text-[#818cf8]",
      title: tr(lang, "first protocol integration", "primera integración de protocolo"),
      items: [
        tr(lang, "first lending-protocol integration (off-chain gate, tested)", "primera integración con protocolo de préstamo (gate off-chain, probado)"),
        tr(lang, "live reputation-tier pool at conservative limits", "pool por tier de reputación en vivo con límites conservadores"),
        tr(lang, "oracle ops + key rotation runbook", "ops del oráculo + runbook de rotación de claves"),
        tr(lang, "SEP draft: credit attestation standard", "borrador SEP: estándar de atestación de crédito"),
      ],
    },
    {
      tag: tr(lang, "tranche 2 · yield layer", "tramo 2 · capa de yield"),
      tagClass: "bg-white/10 text-white/70",
      title: tr(lang, "data + capital efficiency", "datos + eficiencia de capital"),
      items: [
        tr(lang, "open finance enrichment (consented bank data)", "enriquecimiento open finance (datos bancarios consentidos)"),
        tr(lang, "SEP-0056 tokenized vault + tokenized-vault listing", "vault tokenizado SEP-0056 + listado de vault tokenizado"),
        tr(lang, "idle reserve earning yield in soroban pools", "reserva ociosa ganando yield en pools soroban"),
        tr(lang, "/earn — one-click USDC deposits for LPs", "/earn — depósitos USDC de un clic para LPs"),
      ],
    },
    {
      tag: tr(lang, "tranche 3 · mainnet", "tramo 3 · mainnet"),
      tagClass: "bg-white/10 text-white/70",
      title: tr(lang, "open infrastructure", "infraestructura abierta"),
      items: [
        tr(lang, "mainnet deploy behind multi-sig", "deploy a mainnet detrás de multi-sig"),
        tr(lang, "typescript SDK on npm", "SDK de typescript en npm"),
        tr(lang, "tier-segmented pools + staking", "pools segmentados por tier + staking"),
        tr(lang, "inclusion pilot + client-protection metrics (IRIS+)", "piloto de inclusión + métricas de protección al cliente (IRIS+)"),
      ],
    },
  ];

  return (
    <section
      id="roadmap"
      className="border-t border-white/5 py-24 md:py-32 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">
          {tr(lang, "roadmap", "roadmap")}
        </h2>
        <p className="text-white/70 max-w-2xl mb-4 text-base md:text-lg">
          {tr(
            lang,
            "built in the open, funded in tranches. everything marked shipped is verifiable on-chain today — the rest is scoped, costed, and labeled by the tranche that pays for it.",
            "construido en abierto, financiado por tramos. todo lo marcado como listo es verificable on-chain hoy — el resto está dimensionado, costeado y etiquetado por el tramo que lo paga.",
          )}
        </p>
        <p className="text-[#818cf8] max-w-2xl mb-12 text-sm md:text-base">
          {tr(
            lang,
            "the wedge is layer 1: a live lending protocol reading the score in production. distribution and the data layer compound from there.",
            "la cuña es la capa 1: un protocolo de préstamo en vivo leyendo el score en producción. la distribución y la capa de datos se acumulan desde ahí.",
          )}
        </p>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {cards.map((c) => (
            <RoadmapCard key={c.title} tag={c.tag} tagClass={c.tagClass} title={c.title} items={c.items} />
          ))}
        </div>

        <p className="text-white/40 text-xs mt-8 max-w-2xl">
          {tr(
            lang,
            "deliberately out of scope until mainnet: own token, multi-chain, retail KYC, competing with existing lending markets. vigente is the credit layer other protocols read — not another lending app.",
            "deliberadamente fuera de alcance hasta mainnet: token propio, multi-chain, KYC retail, competir con mercados de préstamo existentes. vigente es la capa de crédito que otros protocolos leen — no otra app de préstamo.",
          )}
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
            <span className="text-[#818cf8] shrink-0">·</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// FOOTER
// ===========================================================================

function Footer() {
  const { lang } = useLang();
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
            {tr(lang, "contact", "contacto")}
          </a>
          <Link href="/v3" className="hover:text-white transition-colors">
            {tr(lang, "app", "app")}
          </Link>
          <Link href="/passport" className="hover:text-white transition-colors">
            {tr(lang, "passport", "pasaporte")}
          </Link>
          <Link href="/onepager" className="hover:text-white transition-colors">
            {tr(lang, "one-pager", "one-pager")}
          </Link>
          <a
            href="https://stellar.expert/explorer/testnet/contract/CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD"
            target="_blank"
            rel="noreferrer"
            className="hover:text-white transition-colors"
          >
            {tr(lang, "on-chain", "on-chain")}
          </a>
        </div>
      </div>
    </footer>
  );
}
