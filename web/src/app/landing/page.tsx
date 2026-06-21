"use client";

/**
 * Vigente Protocol — institutional landing (B2B, remittance reputation layer).
 *
 * Direction: sober, high-trust, Stripe/Plaid-grade restraint on a premium dark
 * surface (slate-950) with an indigo/violet + gold accent drawn from the logo.
 * No neon, no generic 3D. Honest claims only: zkTLS is labeled as roadmap, and
 * there is no "award" claim — Vigente is an SCF applicant. The "live on-chain"
 * block reads the deployed contract in real time as the trust proof.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { VigenteLogo, VigenteWordmark } from "@/components/VigenteLogo";
import { getOracleStatus, type OracleStatus } from "@/lib/integrations/vigente-read";
import { verifyBadge } from "@/lib/stellar/vigente-contract";
import type { BadgeState } from "@/lib/integrations/eligibility-adapter";

const PUBKEY_RE = /^G[A-Z2-7]{55}$/;
const GITHUB_URL = "https://github.com/zzzbedream/VIGENTE-PROJECT";
const CONTRACT_ID = "CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD";
const CONTACT_EMAIL = "zzzbedream@gmail.com";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500/30">
      <Nav />
      <Hero />
      <TrustBar />
      <ProblemSolution />
      <UseCases />
      <LiveOnChain />
      <Footer />
    </main>
  );
}

// ===========================================================================
// NAV
// ===========================================================================

const NAV_LINKS = [
  { label: "Solución", href: "#solution" },
  { label: "Casos de uso", href: "#use-cases" },
  { label: "En vivo", href: "#live" },
  { label: "Docs", href: GITHUB_URL },
] as const;

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-900/80 bg-slate-950/80 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 md:px-8">
        <Link href="/" aria-label="Vigente Protocol — inicio">
          <VigenteWordmark />
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-sm text-slate-400 transition-colors hover:text-slate-100"
            >
              {l.label}
            </a>
          ))}
        </div>
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=Solicitud%20de%20Acceso%20API%20-%20Vigente%20Protocol`}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-400"
        >
          Solicitar Acceso API
        </a>
      </nav>
    </header>
  );
}

// ===========================================================================
// HERO
// ===========================================================================

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-slate-900">
      <HeroBackdrop />
      <div className="relative mx-auto max-w-6xl px-6 py-24 md:px-8 md:py-32">
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs font-medium text-slate-300">
          <VigenteLogo className="h-4 w-4" />
          Reputation Layer for Remittances
        </span>

        <h1 className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-white md:text-6xl">
          Transformando flujos de remesas en{" "}
          <span className="bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-transparent">
            reputación crediticia on-chain
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
          Vigente Protocol es la capa de infraestructura de atestación que permite
          a las plataformas de microcrédito evaluar el riesgo de poblaciones no
          bancarizadas de forma segura, sin fricciones y sin recolectar PII.
        </p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=Solicitud%20de%20Acceso%20API%20-%20Vigente%20Protocol`}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-colors hover:bg-indigo-400"
          >
            Solicitar Acceso API
            <IconArrowRight className="h-4 w-4" />
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-900"
          >
            <IconFileText className="h-4 w-4" />
            Leer Documentación Técnica
          </a>
        </div>
      </div>
    </section>
  );
}

function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute -top-40 left-1/2 h-[70vh] w-[60vw] -translate-x-1/2 rounded-full opacity-25 blur-[140px]"
        style={{ background: "radial-gradient(circle, #4f46e5 0%, transparent 65%)" }}
      />
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
    </div>
  );
}

// ===========================================================================
// TRUST BAR — honest infrastructure claims (no award; zk labeled roadmap)
// ===========================================================================

const TRUST_ITEMS = [
  { label: "Construido en Stellar", Icon: IconGlobe },
  { label: "Impulsado por Soroban", Icon: IconCpu },
  { label: "Atestación threshold k-of-n", Icon: IconShield },
  { label: "zkTLS · en el roadmap", Icon: IconLock },
] as const;

function TrustBar() {
  return (
    <section className="border-b border-slate-900 bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-8">
        <p className="mb-6 text-center text-xs uppercase tracking-widest text-slate-600">
          Infraestructura que nos respalda
        </p>
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {TRUST_ITEMS.map(({ label, Icon }) => (
            <div
              key={label}
              className="flex items-center justify-center gap-2.5 text-slate-500"
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// PROBLEM / SOLUTION
// ===========================================================================

const BROKEN = [
  "Remesas globales que mueven miles de millones, pero no dejan historial crediticio a quien las recibe.",
  "Poblaciones no bancarizadas evaluadas con datos que no existen — o excluidas por defecto.",
  "Tarifas altas y crédito informal porque no hay forma de probar capacidad de pago.",
];

const STANDARD = [
  "Exportación criptográfica de recibos desde Web2 hacia Web3, sin mover los datos personales a la cadena.",
  "Validación sin confianza: un quórum independiente k-of-n firma la atestación; nadie puede fabricarla.",
  "Límite de crédito dinámico habilitado en segundos, legible por cualquier protocolo sin permiso.",
];

function ProblemSolution() {
  return (
    <section id="solution" className="border-b border-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-20 md:px-8 md:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Del historial inexistente al nuevo estándar
          </h2>
          <p className="mt-4 text-slate-400">
            La reputación financiera debe ser propiedad de la persona, portable y
            verificable — no quedar encerrada en una institución.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          <Panel
            tone="muted"
            eyebrow="El sistema roto"
            EyebrowIcon={IconAlert}
            items={BROKEN}
          />
          <Panel
            tone="accent"
            eyebrow="El nuevo estándar"
            EyebrowIcon={IconShield}
            items={STANDARD}
          />
        </div>
      </div>
    </section>
  );
}

function Panel({
  tone,
  eyebrow,
  EyebrowIcon,
  items,
}: {
  tone: "muted" | "accent";
  eyebrow: string;
  EyebrowIcon: (p: { className?: string }) => React.ReactElement;
  items: readonly string[];
}) {
  const accent = tone === "accent";
  return (
    <div
      className={`rounded-2xl border p-7 ${
        accent
          ? "border-indigo-500/30 bg-indigo-500/[0.04]"
          : "border-slate-800 bg-slate-900/40"
      }`}
    >
      <div
        className={`mb-5 inline-flex items-center gap-2 text-sm font-semibold ${
          accent ? "text-indigo-300" : "text-slate-400"
        }`}
      >
        <EyebrowIcon className="h-4 w-4" />
        {eyebrow}
      </div>
      <ul className="space-y-4">
        {items.map((it) => (
          <li key={it} className="flex gap-3 text-[15px] leading-relaxed text-slate-300">
            <span className={accent ? "text-amber-400" : "text-slate-600"}>
              {accent ? <IconCheck className="mt-0.5 h-4 w-4" /> : <IconDot className="mt-0.5 h-4 w-4" />}
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// USE CASES
// ===========================================================================

const USE_CASES = [
  {
    Icon: IconLayers,
    title: "Plataformas de microcrédito",
    body: "Expansión del mercado hacia el sector sub-bancarizado con mitigación algorítmica de riesgo. Lee un score verificable on-chain y abre crédito a quien antes era invisible — con límites conservadores y protección al cliente incorporada.",
    points: ["Underwriting sin construir un bureau", "Límites y throttle anti-sobreendeudamiento", "Sin recolectar PII del solicitante"],
  },
  {
    Icon: IconZap,
    title: "Protocolos de liquidez DeFi",
    body: "Delegación de crédito y suscripción de riesgo basada en RWA formales. Un pool de reputación gateado por Vigente amplía el mercado direccionable más allá del colateral, manteniendo el control del riesgo.",
    points: ["Lectura permissionless: get_score / is_defaulted", "Defaults inmutables on-chain", "Integración sin token, sin cambiar el stack"],
  },
] as const;

function UseCases() {
  return (
    <section id="use-cases" className="border-b border-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-20 md:px-8 md:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Construido para integradores institucionales
          </h2>
          <p className="mt-4 text-slate-400">
            Vigente es la capa de crédito que otros protocolos leen — no otra app
            de préstamo.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {USE_CASES.map((uc) => (
            <div
              key={uc.title}
              className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-8 transition-colors hover:border-slate-700"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
                <uc.Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-xl font-semibold text-white">{uc.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-400">{uc.body}</p>
              <ul className="mt-5 space-y-2.5">
                {uc.points.map((p) => (
                  <li key={p} className="flex items-center gap-2.5 text-sm text-slate-300">
                    <IconCheck className="h-4 w-4 shrink-0 text-amber-400" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// LIVE ON-CHAIN — the trust proof (reads the deployed contract in real time)
// ===========================================================================

function LiveOnChain() {
  const [status, setStatus] = useState<OracleStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOracleStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const live = status !== null;
  const k = status?.threshold ?? 3;
  const n = status?.keyCount ?? 5;

  return (
    <section id="live" className="border-b border-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-20 md:px-8 md:py-28">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-emerald-400" : "bg-slate-600"}`}
              />
              <span className="text-xs uppercase tracking-widest text-slate-500">
                {live ? "Leído del contrato ahora" : "Conectando…"}
              </span>
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Verificable on-chain, hoy
            </h2>
          </div>
          <a
            href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-indigo-300 transition-colors hover:text-indigo-200"
          >
            Ver el contrato en stellar.expert →
          </a>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <LiveStat label="Umbral de firmas" value={`${k} de ${n}`} sub="quórum ed25519" />
          <LiveStat label="Claves del oráculo" value={`${n}`} sub="firmantes independientes" />
          <LiveStat
            label="Edad mínima de cuenta"
            value={status ? `${status.minWalletAgeDays}d` : "—"}
            sub="control anti-Sybil"
          />
          <LiveStat label="Red" value="Testnet" sub="mainnet en el roadmap" />
        </div>

        <BadgeLookup />
      </div>
    </section>
  );
}

function LiveStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

function BadgeLookup() {
  const [pubkey, setPubkey] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BadgeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isValid = PUBKEY_RE.test(pubkey.trim());

  async function lookup() {
    const addr = pubkey.trim();
    if (!PUBKEY_RE.test(addr)) {
      setError("Ingresa una clave pública válida (G…)");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await verifyBadge(addr));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lectura fallida");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="mb-4">
        <div className="text-sm font-semibold text-white">Lee una atestación en vivo</div>
        <div className="text-xs text-slate-500">
          get_score / is_defaulted — permissionless, sin wallet ni firma
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={pubkey}
          onChange={(e) => setPubkey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookup()}
          placeholder="G… clave pública de Stellar"
          spellCheck={false}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition-colors focus:border-indigo-500/60"
        />
        <button
          type="button"
          onClick={lookup}
          disabled={loading || !isValid}
          className="rounded-lg bg-indigo-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Leyendo…" : "Leer"}
        </button>
      </div>
      {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}
      {result && (
        <div className="mt-5 flex flex-wrap items-center gap-8 border-t border-slate-800 pt-5">
          <Readout label="Score" value={result.score != null ? `${result.score}/1000` : "sin badge"} />
          <Readout
            label="Default"
            value={result.isDefaulted ? "sí" : "no"}
            tone={result.isDefaulted ? "bad" : "good"}
          />
          <Link
            href="/passport"
            className="ml-auto text-sm text-indigo-300 transition-colors hover:text-indigo-200"
          >
            Pasaporte crediticio completo →
          </Link>
        </div>
      )}
    </div>
  );
}

function Readout({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "bad" ? "text-rose-400" : tone === "good" ? "text-emerald-400" : "text-white";
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

// ===========================================================================
// FOOTER
// ===========================================================================

const FOOTER_COLS = [
  {
    title: "Producto",
    links: [
      { label: "Solución", href: "#solution" },
      { label: "Casos de uso", href: "#use-cases" },
      { label: "Pasaporte crediticio", href: "/passport" },
      { label: "App", href: "/v3" },
    ],
  },
  {
    title: "Desarrolladores",
    links: [
      { label: "Documentación", href: GITHUB_URL },
      { label: "GitHub", href: GITHUB_URL },
      { label: "Contrato (testnet)", href: `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}` },
    ],
  },
] as const;

function Footer() {
  return (
    <footer className="bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-16 md:px-8">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <VigenteWordmark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500">
              La capa de reputación crediticia para remesas. Construida en Stellar
              Soroban, verificable on-chain.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <SocialLink href={GITHUB_URL} label="GitHub"><IconGithub className="h-4 w-4" /></SocialLink>
              <SocialLink href="https://x.com" label="X"><IconX className="h-4 w-4" /></SocialLink>
              <SocialLink href="https://linkedin.com" label="LinkedIn"><IconLinkedin className="h-4 w-4" /></SocialLink>
            </div>
          </div>
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <div className="text-sm font-semibold text-slate-300">{col.title}</div>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="text-sm text-slate-500 transition-colors hover:text-slate-200"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 border-t border-slate-900 pt-8">
          <p className="text-xs leading-relaxed text-slate-600">
            Vigente Protocol es infraestructura experimental desplegada en la red de
            pruebas (testnet) de Stellar. La información de este sitio es para fines
            informativos y no constituye asesoría financiera, legal ni de inversión, ni
            una oferta de crédito. Las funciones de conocimiento cero (zkTLS) y el
            despliegue en mainnet forman parte del roadmap y aún no están en producción.
            Vigente no recolecta información de identificación personal (PII) ni opera
            rampas fiduciarias.
          </p>
          <p className="mt-4 text-xs text-slate-700">
            © {new Date().getFullYear()} Vigente Protocol · Stellar Soroban
          </p>
        </div>
      </div>
    </footer>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 text-slate-400 transition-colors hover:border-slate-700 hover:text-slate-100"
    >
      {children}
    </a>
  );
}

// ===========================================================================
// INLINE ICONS (lucide-style; no external dependency)
// ===========================================================================

type IconProps = { className?: string };
const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconArrowRight({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
function IconFileText({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  );
}
function IconGlobe({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
function IconCpu({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  );
}
function IconShield({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}
function IconLock({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function IconLayers({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
function IconZap({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function IconCheck({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function IconDot({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="none">
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconAlert({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function IconGithub({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}
function IconX({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="none">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function IconLinkedin({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}
