# AGENTS.md — Vigente Protocol Web

This file is the working map for AI agents and developers touching `web/`.
Read it before editing. The project is not a generic Next.js app: it is the
web/demo surface for Vigente Protocol, a Stellar/Soroban credit reputation
system with synthetic on-chain scoring, threshold oracle signing, and Payku demo
paths.

## Project Snapshot

- App: Next.js App Router app in `src/app`.
- Runtime: Node `>=20`, TypeScript strict mode, React 19, Next 16.
- Styling: Tailwind CSS v4 via `@import "tailwindcss"` in `src/app/globals.css`;
  most pages use utility classes directly.
- Blockchain: Stellar testnet / Soroban via `@stellar/stellar-sdk`.
- Wallets: `@creit-tech/stellar-wallets-kit` wrapper in
  `src/contexts/WalletKitContext.tsx`.
- Primary protocol flow: Horizon data -> scoring engine -> threshold-signed
  Soroban mint through `/api/mint-v3`.
- Legacy/demo flow: Payku data -> scoring -> old badge mint / payout through
  older routes. Keep it working unless asked to remove it.
- Python sidecar: `services/legalcore` is a tiny FastAPI consent simulator.

## Commands

Run commands from `web/` unless stated otherwise.

```bash
pnpm run dev
pnpm run build
pnpm run lint
pnpm run test:web
pnpm run test:horizon
pnpm run test:threshold
pnpm run test:eligibility
```

Operational scripts:

```bash
pnpm run setup:mother
pnpm run setup:oracle-keys
pnpm run verify
pnpm run mint:onchain
pnpm run validate-t1
pnpm run validate-t2
pnpm run validate-t3
pnpm run collect:metrics
pnpm run kpi:baseline
```

Package manager note: use PNPM for this app. `vercel.json` uses
`pnpm install` and `pnpm run build`; keep `web/package.json` and
`web/pnpm-lock.yaml` in sync. Do not regenerate `web/package-lock.json`.

## Important Routes

### Pages

- `/` redirects to `/landing`.
- `/landing` is the current main marketing/product surface. Copy is in
  `src/app/landing/copy.ts`; visuals include `NetworkCanvas`.
- `/v3` is the end-to-end threshold credit badge demo. It checks/funds a
  Stellar testnet account, scores it with Horizon, mints a v3 badge through the
  server relay, and can generate a PDF badge.
- `/passport` is a read-only wallet/partner demo. It renders the computed
  Horizon profile plus the live on-chain badge state.
- `/legacy` and `/onepager` are older demo/pitch surfaces. Treat as preserved
  compatibility surfaces unless the task targets them.

### API Routes

- `GET /api/oracle/score-onchain?pubkey=G...`
  - Main synthetic scoring endpoint.
  - Reads Horizon testnet, aggregates recent payments, applies ecosystem/P2P
    weighting, and returns score/features.
  - Has an in-memory 5 minute per-pubkey cache.

- `POST /api/mint-v3`
  - Main mint relay.
  - Body: `{ borrower, score, accountAgeDays, expirationDays? }`.
  - Uses the in-process threshold oracle simulator to sign the canonical mint
    message, builds the Soroban transaction, signs with the mother account, and
    polls inclusion.
  - Requires `VIGENTE_MOTHER_SECRET`.

- `POST /api/oracle/sign-threshold`
  - Server-to-server demo endpoint for threshold signatures.
  - Same-origin browser calls are intentionally rejected. Use
    `x-webhook-secret` with `VIGENTE_WEBHOOK_SECRET`.
  - Should not become a mainnet-style public oracle endpoint.

- `GET /api/oracle/sign-threshold`
  - Returns oracle pubkeys and threshold for deployment/setup scripts.

- `GET /api/evaluate-and-fund`
  - Legacy combined Payku -> scoring -> old Soroban mint -> Payku payout path.
  - Mutates or simulates multiple systems. Keep guarded and do not expose
    detailed errors.

- `/api/score`, `/api/oracle/score`, `/api/mint`
  - Older Payku/HMAC/admin mint routes. They still matter for legacy demos and
    tests, but they are not the preferred v3 flow.

## Core Modules

- `src/services/scoring-engine.ts`
  - Pure scoring core.
  - `calculateScoreFromMetrics` is the source-agnostic path.
  - `calculateCreditScore` is the Payku adapter wrapper.
  - Tier mapping: `1=Gold`, `2=Silver`, `3=Bronze`, `4=None`.
  - Score dimensions: volume 40 pts, consistency 30 pts, frequency 30 pts.

- `src/services/horizon-scoring.ts`
  - Main on-chain synthetic scoring adapter.
  - Reads Horizon payments in reverse order with a hard cap of 200 ops and a
    180 day window.
  - Converts native XLM with `XLM_USD_PRICE` (default `0.10`), treats `USDC`
    and `USD` as face-value stable assets, and excludes other assets from USD
    volume.
  - Splits volume/count into ecosystem vs P2P and feeds adjusted values into
    the scoring engine.

- `src/services/ecosystem-whitelist.ts`
  - Full-weight counterparties for scoring.
  - Non-whitelisted P2P flows are discounted by `ECOSYSTEM_P2P_FACTOR = 0.3`.
  - Extra runtime entries come from `VIGENTE_ECOSYSTEM_EXTRA_ADDRESSES`.
  - Add addresses only when they are externally controlled/publicly
    identifiable counterparties, not user-controlled wallets.

- `src/services/threshold-oracle.ts`
  - In-process ed25519 k-of-n oracle simulator.
  - `ORACLE_COUNT = 5`, `ORACLE_THRESHOLD = 3`.
  - Canonical message must match the Soroban contract byte-for-byte:
    `borrower.to_xdr || score u32 BE || expiration u64 BE || accountAgeDays u32 BE || nonce`.
  - If changing this file, run `pnpm run test:threshold` and preserve
    `tests/xdr-parity.test.ts` expectations.
  - Production keys should come from `VIGENTE_ORACLE_SEEDS_HEX`; otherwise the
    service generates ephemeral keys that will not match on-chain pubkeys.

- `src/lib/integrations/vigente-read.ts`
  - Canonical permissionless read client for the live badge contract.
  - Uses Soroban simulation, no wallet, no funded source account.
  - Exposes `getScore`, `isDefaulted`, `getOracleStatus`, and `vigenteReader`.

- `src/lib/integrations/eligibility-adapter.ts`
  - Pure off-chain eligibility policy.
  - Mirrors the reference vault policy: Gold/Silver/Bronze floors, tier
    ceilings, hard reject on default, and first-loan throttle.
  - Keep policy changes test-backed.

- `src/lib/api-guard.ts`
  - Shared guard for sensitive API routes.
  - Supports webhook secret, same-origin allowance, and per-IP in-memory rate
    limits.
  - Use `genericErrorResponse` in public catch blocks to avoid leaking stack
    traces, RPC details, internal pipeline state, or secrets.

- `src/contexts/WalletKitContext.tsx`
  - Lazy client-only init of Stellar Wallets Kit.
  - Stores last connected address in `sessionStorage`.
  - Do not import wallet kit directly into SSR/server modules.

- `src/lib/stellar/vigente-contract.ts`
  - Thin read-oriented helper.
  - Client-side minting is intentionally disabled here. The write path is
    `/api/mint-v3`; reads go through `vigente-read`.

- `src/services/mint-service.ts`
  - Older Freighter/client-signing mint service. It conflicts with the current
    v3 relay architecture. Do not revive it unless the user explicitly asks for
    legacy behavior and the security trade-off is understood.

- `src/services/payku-client.ts`, `payku-oracle.ts`, `payku-payout.ts`
  - Payku sandbox/production client and legacy demo adapters.
  - The Payku signature algorithm must match the official JS behavior:
    `encodeURIComponent(path)`, sorted flat data, `URLSearchParams`, HMAC-SHA256.
    Do not hand-roll URL encoding differently.

## Environment Variables

Common/public:

- `NEXT_PUBLIC_SITE_URL`: canonical site URL for metadata/CSP/api guard fallback.
- `NEXT_PUBLIC_RPC_URL`: public Soroban RPC URL for client/read paths.
- `NEXT_PUBLIC_NETWORK_PASSPHRASE`: public network passphrase.
- `NEXT_PUBLIC_CONTRACT_ID`: legacy badge contract.
- `NEXT_PUBLIC_CONTRACT_ID_V2`: older on-chain script path.
- `NEXT_PUBLIC_CONTRACT_ID_V3`: current v3 badge contract. Defaults in code to
  `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD`.
- `NEXT_PUBLIC_MARGIN_CONTROLLER_ID`: validation script input.

Server-only/protocol:

- `RPC_URL`: server Soroban RPC URL.
- `NETWORK_PASSPHRASE`: server network passphrase.
- `VIGENTE_MOTHER_SECRET`: mother account secret used by `/api/mint-v3`.
- `VIGENTE_MOTHER_PUBKEY`: written by `pnpm run setup:mother`.
- `VIGENTE_ORACLE_SEEDS_HEX`: five comma-separated 32-byte hex seeds for
  deterministic oracle keys.
- `VIGENTE_WEBHOOK_SECRET`: secret for server-to-server guarded endpoints.
- `VIGENTE_ECOSYSTEM_EXTRA_ADDRESSES`: comma-separated extra whitelist entries.
- `HORIZON_URL`: Horizon endpoint for synthetic scoring.
- `XLM_USD_PRICE`: conversion price used by Horizon scoring.
- `ADMIN_SECRET`: legacy admin mint/HMAC secret.
- `ORACLE_HMAC_SECRET`: older HMAC oracle route secret.
- `SUPABASE_URL`: server Supabase project URL for waitlist writes.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase service role key; never
  expose this as `NEXT_PUBLIC_*`.

Payku:

- `PAYKU_BASE_URL`: defaults to `https://des.payku.cl`.
- `PAYKU_PUBLIC_TOKEN`: enables real Payku reads.
- `PAYKU_PRIVATE_TOKEN`: required for signed wallet/payout calls.
- `USD_CLP_RATE`: default `950`, used by Payku transaction conversion.
- `SKIP_PAYOUT`: used by live Payku test script.

Never commit `.env.local` or real secrets. The current repo has scripts that
write `.env.local`; inspect changes before staging.

## Security And Protocol Invariants

- Keep minting server-side for v3. Browser wallets may connect for identity and
  signing future user actions, but badge minting is currently an oracle/relay
  concern.
- Do not remove `accountAgeDays` from the threshold message or mint call. It is
  part of the anti-Sybil age floor and the signature payload.
- Do not expose raw internal errors from API routes that touch Soroban, mother
  account funds, Payku, or oracle signing. Log server-side, return generic
  client errors where appropriate.
- Guard routes that mutate state or consume paid/rate-limited resources with
  `guardApiRequest`.
- `sign-threshold` is demonstration infrastructure, not a production oracle
  topology. The comment warning in the route is intentional.
- `get_score` returning `null` means no usable signal, not necessarily a
  transport error.
- `is_defaulted` is a hard reject and should be checked before score-based
  eligibility decisions.
- Do not treat P2P churn as full-weight payment activity. The ecosystem
  whitelist penalty is a deliberate carousel-attack mitigation.
- CSP in `next.config.ts` is intentionally tight around wallet origins and
  Stellar endpoints. If adding integrations, update CSP with the exact required
  origins.

## Testing Guidance

Prefer the narrowest test that covers the touched behavior:

- Scoring changes: `pnpm run test:horizon` and, if pure scoring changes are
  broad, `pnpm run test:web`.
- Threshold/oracle/mint payload changes: `pnpm run test:threshold`.
- Eligibility policy changes: `pnpm run test:eligibility`.
- UI or route changes: `pnpm run lint` plus manual/dev-server verification when
  practical.
- Contract parity changes: do not skip `tests/xdr-parity.test.ts`; it protects
  the byte layout shared with Soroban.
- Build/config changes: `pnpm run build`.

The tests are intentionally offline where possible. Do not add network calls to
unit tests unless the file is clearly an integration/live script.

## Frontend Conventions

- Use App Router conventions under `src/app`.
- Mark interactive pages/components with `"use client"`.
- Keep server-only imports like `crypto`, `dotenv`, private secrets, and
  `Keypair.fromSecret` out of client components.
- Use `@/*` imports for `src/*`.
- Prefer existing visual language: dark, restrained, green accent, compact
  protocol/demo surfaces. Avoid turning internal tools into marketing cards.
- Landing copy is centralized in `src/app/landing/copy.ts`; change both Spanish
  and English mirrors when editing public landing messaging.
- Wallet connection should flow through `useWalletKit`, not direct wallet-kit
  imports.

## Python Legalcore Sidecar

`services/legalcore` contains a minimal FastAPI app:

- `POST /consent` with `{ rut, partner_id }`.
- It currently simulates consent by requiring a hyphenated RUT and non-empty
  partner id.
- Dependencies are managed by Poetry in `pyproject.toml`.

Treat this as a stub unless a task explicitly expands compliance/consent
behavior.

## Deployment Notes

- `vercel.json` sets `buildCommand: pnpm run build`, `installCommand: pnpm install`,
  framework `nextjs`, region `iad1`, and API max duration 30s.
- `next.config.ts` enables React Compiler and caps build workers/Turbopack memory.
- Security headers and CSP are emitted through `next.config.ts`.

## Working Style For Future Agents

- Start by reading the touched route/service and its tests; comments in this
  repo carry important protocol rationale.
- Keep changes narrow. There are several historical flows side by side; do not
  delete legacy paths unless the user asks.
- Preserve public response shapes unless updating all consumers at the same
  time.
- When adding env vars, document them here and avoid `NEXT_PUBLIC_` unless the
  value is safe for browsers.
- When touching Stellar transaction code, verify network passphrase, contract
  id, argument order, and ScVal types carefully.
- When touching Payku code, keep the signature algorithm byte-compatible with
  the official spec.
- Before finalizing, mention which checks were run. If a check was skipped, say
  why.
