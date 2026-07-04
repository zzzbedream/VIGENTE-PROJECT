"use client";

/**
 * Vigente Protocol — Landing (pivot 2026-07: reputation-powered collateralized
 * credit on Stellar).
 *
 * Narrative: borrow against your assets today; reputation — on-chain repayments
 * plus consented off-chain income/remittance data — raises LTV and lowers rate,
 * with sub-collateralization as the glide-path vision (not a day-1 promise).
 *
 * Live on-chain pieces are real reads against the testnet contract:
 *  - TrustSection shows oracle status via `getOracleStatus()`.
 *  - PassportSection's wallet verification calls `verifyBadge()` (permissionless
 *    get_score / is_defaulted simulation) — no fake timers. The address comes
 *    either from a pasted G… string or from the wallet kit (`useWalletKit`);
 *    the connect modal lives here, not in the nav, to preserve the approved
 *    nav design.
 *
 * Copy lives in ./copy.ts (ES canonical, EN mirror). Hero alternates are
 * selectable via `?hero=a|b|c` for partner/AB tests; default is variant A.
 */

import Link from "next/link";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { getOracleStatus, type OracleStatus } from "@/lib/integrations/vigente-read";
import { verifyBadge } from "@/lib/stellar/vigente-contract";
import type { BadgeState } from "@/lib/integrations/eligibility-adapter";
import { useWalletKit } from "@/contexts/WalletKitContext";
import { VigenteLogo } from "@/components/VigenteLogo";
import { COPY, type Lang, type LandingCopy } from "./copy";
import { NetworkCanvas } from "./network-canvas";

const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const monoFont = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = monoFont.className;

const CONTRACT_ID = "CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD";
const CONTRACT_URL = `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`;
const CONTACT_EMAIL = "zzzbedream@gmail.com";
const PUBKEY_RE = /^G[A-Z2-7]{55}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- i18n -------------------------------------------------------------------

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "es",
  setLang: () => {},
});

function useCopy(): { lang: Lang; setLang: (l: Lang) => void; t: LandingCopy } {
  const { lang, setLang } = useContext(LangCtx);
  return { lang, setLang, t: COPY[lang] };
}

// --- page -------------------------------------------------------------------

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>("es");

  return (
    <LangCtx.Provider value={{ lang, setLang }}>
      <main className={`${grotesk.className} min-h-screen bg-[#0B0D0F] text-[#E8ECEA] antialiased`}>
        <Nav />
        <Hero />
        <TrustStrip />
        <HowItWorks />
        <Differentiator />
        <WhoItsFor />
        <PassportSection />
        <TrustSection />
        <WaitlistSection />
        <VisionSection />
        <FlowSection />
        <NetworkSection />
        <RoadmapSection />
        <FaqSection />
        <Footer />
      </main>
    </LangCtx.Provider>
  );
}

// --- nav --------------------------------------------------------------------

function Nav() {
  const { lang, setLang, t } = useCopy();
  const links = [
    { label: t.navHow, href: "#how" },
    { label: t.navWho, href: "#who" },
    { label: t.navTrust, href: "#trust" },
    { label: t.navFaq, href: "#faq" },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-[#1C2126] bg-[#0B0D0F]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
        <div className="flex items-baseline gap-2.5">
          <VigenteLogo className="h-5 w-5 self-center" />
          <span className="text-lg font-bold tracking-tight">vigente protocol</span>
          <span className={`${mono} rounded border border-[#8BE9B0]/30 px-1.5 py-0.5 text-[11px] text-[#8BE9B0]`}>
            testnet
          </span>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <div className="hidden items-center gap-5 md:flex">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="whitespace-nowrap text-[#9AA3A0] transition-colors hover:text-[#E8ECEA]">
                {l.label}
              </a>
            ))}
          </div>
          <div className={`${mono} flex overflow-hidden rounded-full border border-[#2A2F35] text-[11px]`}>
            {(["es", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`px-2.5 py-1.5 uppercase transition-colors ${
                  lang === l ? "bg-[#8BE9B0] text-[#0B0D0F]" : "text-[#9AA3A0] hover:text-[#E8ECEA]"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <a
            href="#waitlist"
            className="shrink-0 whitespace-nowrap rounded-lg bg-[#8BE9B0] px-4 py-2 text-[13px] font-semibold text-[#0B0D0F] transition-colors hover:bg-[#A5F0C2]"
          >
            {t.navCta}
          </a>
        </div>
      </div>
    </nav>
  );
}

// --- hero -------------------------------------------------------------------

const HERO_PARAM_TO_INDEX: Record<string, number> = { a: 0, b: 1, c: 2 };

const noopSubscribe = () => () => {};

/**
 * Alternate heroes for partner/AB tests: /landing?hero=b. The URL is external
 * state, so useSyncExternalStore keeps the prerendered snapshot (variant 0)
 * hydration-safe while the client snapshot picks up the query param.
 */
function useHeroVariant(): number {
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      const param = new URLSearchParams(window.location.search).get("hero");
      return param && param in HERO_PARAM_TO_INDEX ? HERO_PARAM_TO_INDEX[param] : 0;
    },
    () => 0,
  );
}

function Hero() {
  const { t } = useCopy();
  const hero = t.heroVariants[useHeroVariant()];

  return (
    <header className="relative overflow-hidden">
      <NetworkCanvas count={34} alpha={0.55} dist={150} className="pointer-events-none absolute inset-0 h-full w-full opacity-40" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-14 pt-16 md:grid-cols-[1.15fr_0.85fr] md:pt-20">
        <div>
          <h1 className="mb-5 text-4xl font-bold leading-[1.06] tracking-tight md:text-[52px]">{hero.title}</h1>
          <p className="mb-8 max-w-[520px] text-lg leading-relaxed text-[#B4BCB9]">{hero.sub}</p>
          <div className="flex flex-wrap items-center gap-3.5">
            <a
              href="#waitlist"
              className="rounded-[10px] bg-[#8BE9B0] px-6 py-3.5 text-base font-semibold text-[#0B0D0F] transition-colors hover:bg-[#A5F0C2]"
            >
              {t.heroCta}
            </a>
            <a
              href="#passport"
              className="rounded-[10px] border border-[#2A2F35] px-5 py-3.5 text-[15px] text-[#E8ECEA] transition-colors hover:border-[#8BE9B0]"
            >
              {t.heroCta3}
            </a>
            <a
              href={CONTRACT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-3.5 text-sm text-[#9AA3A0] transition-colors hover:text-[#8BE9B0]"
            >
              {t.heroCta2} →
            </a>
          </div>
          <p className={`${mono} mt-6 text-xs text-[#6B7370]`}>{t.heroFinePrint}</p>
        </div>
        <TierSimulator />
      </div>
    </header>
  );
}

function TierSimulator() {
  const { t } = useCopy();
  const [tierIdx, setTierIdx] = useState(1);
  const tier = t.tiers[tierIdx];
  const ltvPct = Math.round(tier.ltv * 100);

  return (
    <div className="rounded-[14px] border border-[#23282E] bg-[#12151A] p-6">
      <div className={`${mono} mb-4 text-xs text-[#9AA3A0]`}>{t.demoTitle}</div>
      <div className="mb-5 flex gap-2">
        {t.tiers.map((tr, i) => (
          <button
            key={tr.label}
            type="button"
            onClick={() => setTierIdx(i)}
            className={`${mono} flex-1 rounded-lg border px-1 py-2 text-xs transition-colors ${
              i === tierIdx
                ? "border-[#8BE9B0]/40 bg-[#8BE9B0]/10 text-[#8BE9B0]"
                : "border-[#2A2F35] text-[#9AA3A0] hover:text-[#E8ECEA]"
            }`}
          >
            {tr.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3">
        <SimRow label={t.demoCollateral} value="$1,000 USDC" />
        <SimRow label="LTV" value={`${ltvPct}%`} big accent />
        <SimRow label={t.demoBorrow} value={`$${Math.round(tier.ltv * 1000)}`} big />
        <SimRow label={t.demoRate} value={tier.rate} accent last />
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#1C2126]">
        <div
          className="h-full rounded-full bg-[#8BE9B0] transition-all duration-300"
          style={{ width: `${ltvPct}%` }}
        />
      </div>
      <p className="mt-3.5 text-xs leading-relaxed text-[#6B7370]">{t.demoNote}</p>
    </div>
  );
}

function SimRow({
  label,
  value,
  big,
  accent,
  last,
}: {
  label: string;
  value: string;
  big?: boolean;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between ${last ? "" : "border-b border-[#1C2126] pb-3"}`}>
      <span className="text-sm text-[#9AA3A0]">{label}</span>
      <span
        className={`${mono} ${big ? "text-[22px] font-semibold" : "text-base"} ${
          accent ? "text-[#8BE9B0]" : "text-[#E8ECEA]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// --- trust strip --------------------------------------------------------------

function TrustStrip() {
  const { t } = useCopy();
  return (
    <div className="border-y border-[#1C2126] bg-[#0E1114]">
      <div className={`${mono} mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-6 py-4 text-[13px] text-[#9AA3A0]`}>
        <span>{t.strip1}</span>
        <span>{t.strip2}</span>
        <span>{t.strip3}</span>
        <span>{t.strip4}</span>
      </div>
    </div>
  );
}

// --- how it works -------------------------------------------------------------

function SectionHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-[34px]">{title}</h2>
      {sub && <p className="mb-10 max-w-[600px] text-base text-[#9AA3A0]">{sub}</p>}
    </>
  );
}

function HowItWorks() {
  const { t } = useCopy();
  return (
    <section id="how" className="mx-auto max-w-6xl px-6 pt-22 md:pt-24">
      <SectionHeading title={t.howTitle} sub={t.howSub} />
      <div className="grid gap-5 md:grid-cols-3">
        {t.steps.map((step) => (
          <div key={step.num} className="rounded-[14px] border border-[#23282E] bg-[#12151A] p-6">
            <div className={`${mono} mb-3.5 text-[13px] text-[#8BE9B0]`}>{step.num}</div>
            <h3 className="mb-2.5 text-[19px] font-semibold">{step.title}</h3>
            <p className="text-sm leading-relaxed text-[#9AA3A0]">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- differentiator -----------------------------------------------------------

function Differentiator() {
  const { t } = useCopy();
  return (
    <section className="mx-auto max-w-6xl px-6 pt-22 md:pt-24">
      <div className="grid items-start gap-10 md:grid-cols-2 md:gap-14">
        <div>
          <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-[34px]">{t.diffTitle}</h2>
          <p className="mb-4 text-base leading-relaxed text-[#B4BCB9]">{t.diffBody1}</p>
          <p className="text-base leading-relaxed text-[#B4BCB9]">{t.diffBody2}</p>
        </div>
        <div className="overflow-hidden rounded-[14px] border border-[#23282E] bg-[#12151A]">
          <div className={`${mono} grid grid-cols-[1.2fr_1fr_1fr] border-b border-[#23282E] px-5 py-3.5 text-xs text-[#6B7370]`}>
            <span />
            <span>{t.diffColCdp}</span>
            <span className="text-[#8BE9B0]">vigente</span>
          </div>
          {t.diffRows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[1.2fr_1fr_1fr] items-baseline border-b border-[#1C2126] px-5 py-3.5 text-sm last:border-b-0"
            >
              <span className="text-[#9AA3A0]">{row.label}</span>
              <span className="text-[#6B7370]">{row.cdp}</span>
              <span className="text-[#E8ECEA]">{row.vig}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// --- who it's for ---------------------------------------------------------------

function WhoItsFor() {
  const { t } = useCopy();
  return (
    <section id="who" className="mx-auto max-w-6xl px-6 pt-22 md:pt-24">
      <SectionHeading title={t.whoTitle} />
      <div className="grid gap-5 md:grid-cols-2">
        {t.segments.map((seg) => (
          <div key={seg.tag} className="rounded-[14px] border border-[#23282E] bg-[#12151A] p-7">
            <div className={`${mono} mb-3.5 text-xs text-[#8BE9B0]`}>{seg.tag}</div>
            <h3 className="mb-3 text-[22px] font-semibold tracking-tight">{seg.title}</h3>
            <p className="text-[15px] leading-relaxed text-[#9AA3A0]">{seg.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- financial passport ---------------------------------------------------------

type HistoryKey = "none" | "always" | "sometimes" | "late";
const HISTORY_BONUS: Record<HistoryKey, number> = { always: 100, sometimes: 30, late: -80, none: 0 };
const TIER_LTVS = [50, 65, 75];

interface PassportResult {
  score: number;
  tierIdx: number;
  ltv: number;
  inc: number;
  rem: number;
  exp: number;
  history: HistoryKey;
}

function calcPassport(incRaw: string, remRaw: string, expRaw: string, history: HistoryKey): PassportResult | null {
  const inc = parseFloat(incRaw) || 0;
  const rem = parseFloat(remRaw) || 0;
  const exp = parseFloat(expRaw) || 0;
  if (inc + rem <= 0) return null;
  const flow = inc + rem * 0.8;
  const ratio = Math.max(0, Math.min(1, (flow - exp) / flow));
  const remitBonus = rem > 0 ? 40 : 0;
  const score = Math.round(Math.max(300, Math.min(850, 350 + ratio * 360 + HISTORY_BONUS[history] + remitBonus)));
  const tierIdx = score >= 700 ? 2 : score >= 550 ? 1 : 0;
  return { score, tierIdx, ltv: TIER_LTVS[tierIdx], inc, rem, exp, history };
}

const passportInputCls =
  "rounded-[10px] border border-[#2A2F35] bg-[#0B0D0F] px-3.5 py-3 text-[15px] text-[#E8ECEA] outline-none transition-colors focus:border-[#8BE9B0]";

function PassportSection() {
  const { t } = useCopy();
  const { address: kitAddress, connecting, connect, disconnect } = useWalletKit();
  const [income, setIncome] = useState("");
  const [remit, setRemit] = useState("");
  const [expenses, setExpenses] = useState("");
  const [history, setHistory] = useState<HistoryKey>("none");
  const [result, setResult] = useState<PassportResult | null>(null);
  const [calcError, setCalcError] = useState(false);

  const [wallet, setWallet] = useState("");
  const [walletError, setWalletError] = useState<"format" | "read" | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [onchain, setOnchain] = useState<BadgeState | null>(null);
  const [onchainAddr, setOnchainAddr] = useState("");

  const verified = onchain !== null;

  function handleCalc() {
    const r = calcPassport(income, remit, expenses, history);
    if (!r) {
      setCalcError(true);
      return;
    }
    setCalcError(false);
    setResult(r);
    try {
      localStorage.setItem(
        "vigente_passport",
        JSON.stringify({ score: r.score, tierIdx: r.tierIdx, ltv: r.ltv, ts: Date.now() }),
      );
    } catch {
      // localStorage unavailable (private mode) — the on-screen result is enough
    }
  }

  async function handleVerify() {
    // Connected wallet wins; the pasted address is the fallback path so anyone
    // on Stellar can verify without installing a wallet.
    const addr = (kitAddress ?? wallet).trim();
    if (!PUBKEY_RE.test(addr)) {
      setWalletError("format");
      return;
    }
    setWalletError(null);
    setVerifying(true);
    try {
      setOnchain(await verifyBadge(addr));
      setOnchainAddr(addr);
    } catch {
      setWalletError("read");
    } finally {
      setVerifying(false);
    }
  }

  function handleDownload() {
    if (!result || !verified) return;
    const f = t.ppFile;
    const histLabel = t.ppHistoryOpts.find((o) => o.v === result.history)?.label ?? result.history;
    const onchainLine =
      onchain && onchain.score != null ? `${onchain.score} / 1000` : f.onchainNone;
    const lines = [
      f.title,
      "=".repeat(f.title.length),
      "",
      `${f.date}: ${new Date().toISOString().slice(0, 10)}`,
      `${f.score}: ${result.score} / 850`,
      `${f.tier}: ${t.ppTiers[result.tierIdx]}`,
      `${f.ltv}: ${result.ltv}%`,
      "",
      `${f.income}: $${result.inc}`,
      `${f.remit}: $${result.rem}`,
      `${f.expenses}: $${result.exp}`,
      `${f.history}: ${histLabel}`,
      "",
      `Wallet (Stellar): ${onchainAddr}`,
      `${f.onchain}: ${onchainLine}`,
      `Contract: ${CONTRACT_ID} (testnet)`,
      "",
      f.note,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vigente-passport-${result.score}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <section id="passport" className="mx-auto max-w-6xl px-6 pt-22 md:pt-24">
      <div className="rounded-[18px] border border-[#23282E] bg-gradient-to-b from-[#12151A] to-[#0E1114] p-7 md:p-12">
        <div className={`${mono} mb-3.5 text-xs text-[#8BE9B0]`}>{t.ppTag}</div>
        <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-[34px]">{t.ppTitle}</h2>
        <p className="mb-3 max-w-[640px] text-base leading-relaxed text-[#9AA3A0]">{t.ppSub}</p>
        <p className={`${mono} mb-9 text-xs text-[#6B7370]`}>
          {t.ppOnchainHint}{" "}
          <Link href="/passport" className="text-[#8BE9B0] transition-colors hover:text-[#A5F0C2]">
            → /passport
          </Link>
        </p>
        <div className="grid items-start gap-10 md:grid-cols-2">
          {/* form */}
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-sm text-[#B4BCB9]">
              <span>{t.ppIncome}</span>
              <input
                type="number"
                min="0"
                value={income}
                onChange={(e) => {
                  setIncome(e.target.value);
                  setCalcError(false);
                }}
                placeholder="500"
                className={`${mono} ${passportInputCls}`}
              />
            </label>
            <label className="grid gap-1.5 text-sm text-[#B4BCB9]">
              <span>{t.ppRemit}</span>
              <input
                type="number"
                min="0"
                value={remit}
                onChange={(e) => {
                  setRemit(e.target.value);
                  setCalcError(false);
                }}
                placeholder="200"
                className={`${mono} ${passportInputCls}`}
              />
            </label>
            <label className="grid gap-1.5 text-sm text-[#B4BCB9]">
              <span>{t.ppExpenses}</span>
              <input
                type="number"
                min="0"
                value={expenses}
                onChange={(e) => {
                  setExpenses(e.target.value);
                  setCalcError(false);
                }}
                placeholder="350"
                className={`${mono} ${passportInputCls}`}
              />
            </label>
            <label className="grid gap-1.5 text-sm text-[#B4BCB9]">
              <span>{t.ppHistory}</span>
              <select
                value={history}
                onChange={(e) => setHistory(e.target.value as HistoryKey)}
                className={passportInputCls}
              >
                {t.ppHistoryOpts.map((opt) => (
                  <option key={opt.v} value={opt.v}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={handleCalc}
              className="mt-1 rounded-[10px] bg-[#8BE9B0] px-5 py-3.5 text-base font-semibold text-[#0B0D0F] transition-colors hover:bg-[#A5F0C2]"
            >
              {t.ppCalc}
            </button>
            {calcError && <p className="text-[13px] text-[#E9998B]">{t.ppError}</p>}
            <p className="text-xs leading-relaxed text-[#6B7370]">{t.ppPrivacy}</p>
          </div>

          {/* result */}
          <div className="flex min-h-[320px] flex-col justify-center rounded-[14px] border border-[#23282E] bg-[#0B0D0F] p-7">
            {!result ? (
              <div className="mb-6 text-center">
                <div className={`${mono} mb-3.5 text-[40px] text-[#2A2F35]`}>···</div>
                <p className="text-sm leading-relaxed text-[#6B7370]">{t.ppEmpty}</p>
              </div>
            ) : (
              <div>
                <div className={`${mono} mb-2.5 text-xs text-[#9AA3A0]`}>{t.ppScoreLabel}</div>
                <div className="mb-4 flex items-baseline gap-3.5">
                  <span className={`${mono} text-[52px] font-semibold leading-none text-[#8BE9B0]`}>{result.score}</span>
                  <span className={`${mono} text-sm text-[#9AA3A0]`}>/ 850</span>
                  <span
                    className={`${mono} rounded border px-2 py-0.5 text-[11px] ${
                      verified
                        ? "border-[#8BE9B0]/40 text-[#8BE9B0]"
                        : "border-[#E9C98B]/35 text-[#E9C98B]"
                    }`}
                  >
                    {verified ? t.ppBadgeVerified : t.ppBadgePreview}
                  </span>
                </div>
                <div className="mb-4 h-2 overflow-hidden rounded-full bg-[#1C2126]">
                  <div
                    className="h-full rounded-full bg-[#8BE9B0] transition-all duration-300"
                    style={{ width: `${Math.round(((result.score - 300) / 550) * 100)}%` }}
                  />
                </div>
                <div className="mb-5 grid gap-2.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9AA3A0]">{t.ppTierLabel}</span>
                    <span className={`${mono} text-[#E8ECEA]`}>{t.ppTiers[result.tierIdx]}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9AA3A0]">{t.ppLtvLabel}</span>
                    <span className={`${mono} text-[#8BE9B0]`}>{result.ltv}%</span>
                  </div>
                  {verified && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[#9AA3A0]">{t.ppOnchainScore}</span>
                      <span className={`${mono} text-[#E8ECEA]`}>
                        {onchain && onchain.score != null ? `${onchain.score} / 1000` : t.ppOnchainNone}
                      </span>
                    </div>
                  )}
                </div>
                <p className="mb-5 text-[13px] leading-relaxed text-[#9AA3A0]">{t.ppNote}</p>
              </div>
            )}

            {!verified ? (
              <div className="rounded-xl border border-[#2A2F35] bg-[#E9C98B]/[0.03] p-4.5">
                <div className={`${mono} mb-2 text-xs text-[#E9C98B]`}>{t.ppCapacityTitle}</div>
                <p className="mb-3.5 text-[13px] leading-relaxed text-[#9AA3A0]">{t.ppGlidepath}</p>
                <div className="grid gap-2.5">
                  {kitAddress ? (
                    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[#8BE9B0]/35 bg-[#8BE9B0]/5 px-3.5 py-2.5">
                      <span className={`${mono} min-w-0 truncate text-xs text-[#8BE9B0]`}>
                        {t.ppConnectedAs.replace("{addr}", `${kitAddress.slice(0, 4)}…${kitAddress.slice(-4)}`)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void disconnect()}
                        className={`${mono} shrink-0 text-xs text-[#9AA3A0] transition-colors hover:text-[#E8ECEA]`}
                      >
                        {t.ppDisconnect}
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2.5">
                      <input
                        type="text"
                        value={wallet}
                        onChange={(e) => {
                          setWallet(e.target.value);
                          setWalletError(null);
                        }}
                        placeholder="G…"
                        spellCheck={false}
                        className={`${mono} min-w-0 flex-1 rounded-[10px] border border-[#2A2F35] bg-[#0B0D0F] px-3.5 py-3 text-[13px] text-[#E8ECEA] outline-none transition-colors focus:border-[#8BE9B0]`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setWalletError(null);
                          void connect();
                        }}
                        disabled={connecting}
                        className="shrink-0 rounded-[10px] border border-[#8BE9B0]/40 px-3.5 py-3 text-[13px] font-semibold text-[#8BE9B0] transition-colors hover:bg-[#8BE9B0]/10 disabled:opacity-60"
                      >
                        {connecting ? t.ppConnecting : t.ppConnect}
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleVerify}
                    disabled={verifying}
                    className="rounded-[10px] bg-[#8BE9B0] px-4 py-3 text-sm font-semibold text-[#0B0D0F] transition-colors hover:bg-[#A5F0C2] disabled:opacity-60"
                  >
                    {verifying ? t.ppVerifying : t.ppVerify}
                  </button>
                  {walletError && (
                    <p className="text-xs text-[#E9998B]">
                      {walletError === "format" ? t.ppWalletError : t.ppReadError}
                    </p>
                  )}
                  <p className="text-xs leading-relaxed text-[#6B7370]">{t.ppLockBody}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-4 rounded-xl border border-[#8BE9B0]/35 bg-[#8BE9B0]/5 p-4.5">
                  <div className={`${mono} mb-1.5 text-xs text-[#8BE9B0]`}>✓ {t.ppVerifiedTag}</div>
                  <div className={`${mono} truncate text-xs text-[#9AA3A0]`}>
                    {onchainAddr.slice(0, 8)}…{onchainAddr.slice(-6)}
                  </div>
                  {!result && (
                    <div className="mt-2.5 flex justify-between text-sm">
                      <span className="text-[#9AA3A0]">{t.ppOnchainScore}</span>
                      <span className={`${mono} text-[#E8ECEA]`}>
                        {onchain && onchain.score != null ? `${onchain.score} / 1000` : t.ppOnchainNone}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  {result && (
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="rounded-[10px] border border-[#8BE9B0]/40 px-4 py-3 text-sm font-semibold text-[#8BE9B0] transition-colors hover:bg-[#8BE9B0]/10"
                    >
                      {t.ppDownload} ↓
                    </button>
                  )}
                  <Link
                    href="/passport"
                    className="rounded-[10px] border border-[#2A2F35] px-4 py-3 text-sm text-[#E8ECEA] transition-colors hover:border-[#8BE9B0]"
                  >
                    {t.ppFullPassport} →
                  </Link>
                  <a
                    href="#waitlist"
                    className="rounded-[10px] border border-[#2A2F35] px-4 py-3 text-sm text-[#E8ECEA] transition-colors hover:border-[#8BE9B0]"
                  >
                    {t.ppNext}
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// --- trust / infrastructure -----------------------------------------------------

function TrustSection() {
  const { t } = useCopy();
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

  const live = status !== null && !statusError;
  const k = status?.threshold ?? 3;
  const n = status?.keyCount ?? 5;
  const minAge = status?.minWalletAgeDays;

  return (
    <section id="trust" className="mx-auto max-w-6xl px-6 pt-22 md:pt-24">
      <SectionHeading title={t.trustTitle} sub={t.trustSub} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {t.trustCards.map((card) => (
          <div key={card.name} className="rounded-[14px] border border-[#23282E] bg-[#12151A] p-6">
            <div className={`${mono} mb-2.5 text-sm font-semibold text-[#E8ECEA]`}>{card.name}</div>
            <p className="text-sm leading-relaxed text-[#9AA3A0]">{card.body}</p>
          </div>
        ))}
      </div>

      {/* live proof of the "live primitive" card — real read from the contract */}
      <div className="mt-8 rounded-[14px] border border-[#23282E] bg-[#12151A] p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-[#8BE9B0]" : "bg-white/30"}`} />
          <span className="text-lg font-semibold">{t.liveTitle}</span>
          <span className="text-xs text-[#6B7370]">{live ? t.liveRead : t.liveReading}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <LiveStat label={t.liveThreshold} value={`${k} / ${n}`} sub={t.liveThresholdSub} />
          <LiveStat label={t.liveKeys} value={`${n}`} sub={t.liveKeysSub} />
          <LiveStat label={t.liveAge} value={minAge != null ? `${minAge}d` : "—"} sub={t.liveAgeSub} />
          <LiveStat label={t.liveContract} value="CDLLO7QE…" sub={t.liveContractSub} href={CONTRACT_URL} />
        </div>
      </div>

      <a
        href={CONTRACT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`${mono} mt-6 inline-block rounded-lg border border-[#8BE9B0]/30 px-4 py-2.5 text-[13px] text-[#8BE9B0] transition-colors hover:bg-[#8BE9B0]/10`}
      >
        CDLLO7QE…HWVD · stellar.expert →
      </a>
    </section>
  );
}

function LiveStat({ label, value, sub, href }: { label: string; value: string; sub: string; href?: string }) {
  const inner = (
    <div className="h-full rounded-xl border border-[#1C2126] bg-[#0B0D0F] p-4">
      <div className={`${mono} mb-1.5 text-[10px] uppercase tracking-wider text-[#6B7370]`}>{label}</div>
      <div className={`${mono} text-xl font-medium text-[#E8ECEA]`}>{value}</div>
      <div className="mt-1 text-xs text-[#6B7370]">{sub}</div>
    </div>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block transition-opacity hover:opacity-80">
      {inner}
    </a>
  ) : (
    inner
  );
}

// --- waitlist --------------------------------------------------------------------

function WaitlistSection() {
  const { t } = useCopy();
  const [email, setEmail] = useState("");
  const [wantsData, setWantsData] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [emailError, setEmailError] = useState(false);

  function handleSubmit() {
    if (!EMAIL_RE.test(email)) {
      setEmailError(true);
      return;
    }
    try {
      const key = "vigente_waitlist_signups";
      const prev = JSON.parse(localStorage.getItem(key) || "[]") as unknown[];
      prev.push({ email, wantsData, ts: Date.now() });
      localStorage.setItem(key, JSON.stringify(prev));
    } catch {
      // storage unavailable — the mailto fallback below still captures the signup
    }
    setSubmitted(true);
  }

  const mailtoHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Whitelist Vigente")}&body=${encodeURIComponent(
    `${email}${wantsData ? " · pre-calificar reputación (datos ingreso/remesas)" : ""}`,
  )}`;

  return (
    <section id="waitlist" className="mx-auto max-w-6xl px-6 pt-22 md:pt-24">
      <div className="grid items-center gap-10 rounded-[18px] border border-[#23282E] bg-gradient-to-b from-[#12151A] to-[#0E1114] p-8 md:grid-cols-2 md:gap-12 md:p-12">
        <div>
          <h2 className="mb-3.5 text-3xl font-bold tracking-tight md:text-[34px]">{t.wlTitle}</h2>
          <p className="text-base leading-relaxed text-[#9AA3A0]">{t.wlSub}</p>
        </div>
        <div>
          {!submitted ? (
            <div className="grid gap-3.5">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder={t.wlPlaceholder}
                className="rounded-[10px] border border-[#2A2F35] bg-[#0B0D0F] px-4 py-3.5 text-[15px] text-[#E8ECEA] outline-none transition-colors focus:border-[#8BE9B0]"
              />
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-[#9AA3A0]">
                <input
                  type="checkbox"
                  checked={wantsData}
                  onChange={(e) => setWantsData(e.target.checked)}
                  className="mt-0.5 accent-[#8BE9B0]"
                />
                <span>{t.wlCheckbox}</span>
              </label>
              <button
                type="button"
                onClick={handleSubmit}
                className="rounded-[10px] bg-[#8BE9B0] px-5 py-3.5 text-base font-semibold text-[#0B0D0F] transition-colors hover:bg-[#A5F0C2]"
              >
                {t.wlButton}
              </button>
              {emailError && <p className="text-[13px] text-[#E9998B]">{t.wlError}</p>}
              <p className="text-xs text-[#6B7370]">{t.wlPrivacy}</p>
            </div>
          ) : (
            <div className="rounded-xl border border-[#8BE9B0]/35 bg-[#8BE9B0]/[0.06] p-6">
              <div className="mb-2 text-lg font-semibold text-[#8BE9B0]">{t.wlSuccessTitle}</div>
              <p className="mb-4 text-sm leading-relaxed text-[#B4BCB9]">
                {t.wlSuccessBody}
                {wantsData && ` ${t.wlSuccessData}`}
              </p>
              <a
                href={mailtoHref}
                className="inline-block rounded-[10px] bg-[#8BE9B0] px-4 py-2.5 text-sm font-semibold text-[#0B0D0F] transition-colors hover:bg-[#A5F0C2]"
              >
                {t.wlSuccessMail} →
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// --- vision / glide-path ------------------------------------------------------------

function VisionSection() {
  const { t } = useCopy();
  return (
    <section className="mx-auto max-w-6xl px-6 pt-22 md:pt-24">
      <div className="max-w-[720px]">
        <div className={`${mono} mb-3.5 text-xs text-[#8BE9B0]`}>{t.visionTag}</div>
        <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-[34px]">{t.visionTitle}</h2>
        <p className="mb-4 text-[17px] leading-relaxed text-[#B4BCB9]">{t.visionBody1}</p>
        <p className="text-[17px] leading-relaxed text-[#B4BCB9]">{t.visionBody2}</p>
      </div>
      <div className="mt-10 flex flex-col items-stretch gap-6 md:flex-row md:gap-0">
        {t.glidePath.map((gp) => (
          <div key={gp.phase} className="flex-1 py-1 pl-5 pr-6" style={{ borderLeft: `2px solid ${gp.border}` }}>
            <div className={`${mono} mb-2 text-xs`} style={{ color: gp.color }}>
              {gp.phase}
            </div>
            <div className="mb-1.5 text-[15px] font-semibold">{gp.title}</div>
            <div className="text-[13px] leading-relaxed text-[#9AA3A0]">{gp.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- onboarding flow -----------------------------------------------------------------

function FlowSection() {
  const { t } = useCopy();
  return (
    <section id="flow" className="mx-auto max-w-6xl px-6 pt-22 md:pt-24">
      <SectionHeading title={t.flowTitle} sub={t.flowSub} />
      <div className="grid gap-y-3.5 md:grid-cols-3">
        {t.flow.map((fs, i) => {
          const showArrow = (i + 1) % 3 !== 0 && i < t.flow.length - 1;
          return (
            <div key={fs.num} className="flex items-center">
              <div
                className={`flex-1 self-stretch rounded-xl border bg-[#12151A] p-4 ${
                  fs.optional ? "border-[#E9C98B]/40" : "border-[#23282E]"
                }`}
              >
                <div className={`${mono} mb-2 text-[11px] ${fs.optional ? "text-[#E9C98B]" : "text-[#8BE9B0]"}`}>
                  {fs.num}
                  {fs.optional ? t.flowOptional : ""}
                </div>
                <div className="mb-1.5 text-[15px] font-semibold">{fs.title}</div>
                <div className="text-[12.5px] leading-relaxed text-[#9AA3A0]">{fs.body}</div>
              </div>
              <div className={`${mono} hidden px-2 text-[15px] text-[#8BE9B0] md:block`}>{showArrow ? "→" : " "}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- network banner -------------------------------------------------------------------

function NetworkSection() {
  const { t } = useCopy();
  return (
    <section className="relative mt-24 overflow-hidden border-y border-[#1C2126] bg-[#080A0C]">
      <NetworkCanvas count={70} alpha={0.9} dist={170} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="relative mx-auto max-w-6xl px-6 py-24 text-center md:py-28">
        <div className={`${mono} mb-4 text-xs tracking-[0.15em] text-[#8BE9B0]`}>{t.netTag}</div>
        <h2 className="mx-auto mb-5 max-w-[760px] text-4xl font-bold leading-[1.1] tracking-tight md:text-[52px]">
          {t.netTitle}
        </h2>
        <p className="mx-auto max-w-[560px] text-[17px] leading-relaxed text-[#9AA3A0]">{t.netSub}</p>
        <div className="mt-12 flex flex-wrap justify-center gap-12">
          {t.netStats.map((ns) => (
            <div key={ns.label}>
              <div className={`${mono} text-3xl font-semibold text-[#8BE9B0]`}>{ns.value}</div>
              <div className="mt-1.5 text-[13px] text-[#6B7370]">{ns.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// --- roadmap ------------------------------------------------------------------------

function RoadmapSection() {
  const { t } = useCopy();
  return (
    <section id="roadmap" className="mx-auto max-w-6xl px-6 pt-22 md:pt-24">
      <SectionHeading title={t.roadmapTitle} />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {t.roadmap.map((r) => (
          <div key={r.phase} className="pt-4" style={{ borderTop: `2px solid ${r.accent}` }}>
            <div className={`${mono} mb-2.5 text-xs`} style={{ color: r.accent }}>
              {r.phase} · {r.status}
            </div>
            <div className="mb-2 text-lg font-semibold">{r.title}</div>
            <p className="text-[13.5px] leading-relaxed text-[#9AA3A0]">{r.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- faq ----------------------------------------------------------------------------

function FaqSection() {
  const { t } = useCopy();
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 pt-22 md:pt-24">
      <h2 className="mb-8 text-3xl font-bold tracking-tight md:text-[34px]">{t.faqTitle}</h2>
      <div className="grid gap-3">
        {t.faqs.map((faq, i) => {
          const isOpen = open === i;
          return (
            <div key={faq.q} className="overflow-hidden rounded-xl border border-[#23282E] bg-[#12151A]">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-base font-semibold text-[#E8ECEA]"
              >
                <span>{faq.q}</span>
                <span className={`${mono} shrink-0 text-lg text-[#8BE9B0]`}>{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div className="px-6 pb-5">
                  <p className="text-[15px] leading-relaxed text-[#9AA3A0]">{faq.a}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- footer -------------------------------------------------------------------------

function Footer() {
  const { t } = useCopy();
  return (
    <footer className="mt-24 border-t border-[#1C2126]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8">
        <div className={`${mono} flex items-center gap-2 text-[13px] text-[#6B7370]`}>
          <VigenteLogo className="h-4 w-4" />
          <span>vigente protocol · stellar soroban · testnet</span>
        </div>
        <div className="flex flex-wrap items-center gap-5 text-[13px]">
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#9AA3A0] transition-colors hover:text-[#E8ECEA]">
            {t.footContact}
          </a>
          <Link href="/v3" className="text-[#9AA3A0] transition-colors hover:text-[#E8ECEA]">
            {t.footApp}
          </Link>
          <Link href="/passport" className="text-[#9AA3A0] transition-colors hover:text-[#E8ECEA]">
            {t.footPassport}
          </Link>
          <Link href="/onepager" className="text-[#9AA3A0] transition-colors hover:text-[#E8ECEA]">
            {t.footOnePager}
          </Link>
          <a
            href={CONTRACT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#9AA3A0] transition-colors hover:text-[#E8ECEA]"
          >
            {t.footOnchain} →
          </a>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-6 pb-7 text-xs leading-relaxed text-[#4C5350]">{t.footDisclaimer}</div>
    </footer>
  );
}
