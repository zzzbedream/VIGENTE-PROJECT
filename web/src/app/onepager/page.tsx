"use client";

/**
 * Vigente — partner one-pager (print-friendly leave-behind).
 *
 * The attachment referenced by docs/private/outreach-emails.md. Light, single
 * page, print-to-PDF from the browser ("print" button → Save as PDF). Kept as a
 * route (not a static PDF) so the evidence stays in sync with the live deploy.
 */

const CONTRACT_ID = "CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD";

export default function OnePagerPage() {
  return (
    <main className="min-h-screen bg-white text-zinc-900 antialiased print:p-0">
      <div className="max-w-3xl mx-auto px-8 py-10 print:py-4">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Vigente</h1>
            <p className="text-sm text-zinc-600">
              The missing credit primitive for Stellar — a threshold credit
              oracle for financial inclusion.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="print:hidden text-xs border border-zinc-300 rounded-md px-3 py-1.5 hover:bg-zinc-100"
          >
            print / save PDF
          </button>
        </div>

        <Section title="The problem">
          Millions of LATAM earners are creditworthy but invisible: no formal
          credit history, so no fair credit. Traditional bureaus exclude them by
          design.
        </Section>

        <Section title="What Vigente is">
          A k-of-n threshold credit oracle live on Stellar Soroban. It mints a
          soulbound credit badge — a score (0–1000) plus immutable default records
          — signed by an independent 3-of-5 ed25519 quorum. Any contract or app
          reads <Mono>get_score()</Mono> / <Mono>is_defaulted()</Mono>{" "}
          permissionlessly. The core score reads only public Stellar data, so
          there is zero fintech in the trust path; open-finance data is optional,
          consented enrichment.
        </Section>

        <Section title="Evidence (verifiable today)">
          <ul className="list-disc list-inside space-y-1">
            <li>
              Live testnet contract <Mono>{CONTRACT_ID.slice(0, 10)}…</Mono> on
              stellar.expert
            </li>
            <li>97 Rust tests across badge, margin controller, and oracle aggregator</li>
            <li>3 verified threshold mints with on-chain tx hashes</li>
            <li>
              Interface v1 published; our own Blend pool runs the credit cycle
              end-to-end on our own SEP-40 oracle
            </li>
          </ul>
        </Section>

        <Section title="How partners integrate">
          <ul className="list-disc list-inside space-y-1">
            <li>
              <b>Wallets</b> (Meru, LOBSTR): embed a credit passport so users build
              and see a real, portable credit history.
            </li>
            <li>
              <b>Lending protocols</b> (any Soroban market): gate a reputation-tier
              pool. For price-oracle protocols the eligibility gate runs off-chain
              at conservative, throttled limits.
            </li>
            <li>
              <b>Data</b> (Floid, Fintoc): consented open-finance enrichment, never
              published on-chain.
            </li>
          </ul>
        </Section>

        <Section title="Responsible by design">
          Conservative tier ceilings, a first-loan throttle, and immutable
          defaults prevent over-indebtedness (Cerise+SPTF client protection).
          Impact measured with IRIS+ — first-time access, cost of credit, real
          default rate — not vanity metrics.
        </Section>

        <Section title="The ask">
          A 20-minute call and, if there is fit, a non-binding letter of intent to
          pilot. B2B model (fee per score query / subscription) — no token, no
          change to your stack.
        </Section>

        <p className="text-xs text-zinc-500 mt-6 border-t border-zinc-200 pt-3">
          vigente-project.vercel.app · zzzbedream@gmail.com · Stellar Soroban
          (testnet)
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-1">
        {title}
      </h2>
      <div className="text-sm leading-relaxed text-zinc-800">{children}</div>
    </section>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[0.85em] bg-zinc-100 px-1 py-0.5 rounded">
      {children}
    </code>
  );
}
