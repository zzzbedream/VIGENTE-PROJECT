<!-- .github/copilot-instructions.md -->
# Copilot / AI Agent Instructions — pyme-web

Purpose: help an AI coding agent become productive quickly in this Next.js + Soroban MVP.

- **Big picture:** This is a Next.js (v16) app using the App Router. UI lives in the `app` directory; a simple backend API route handles ledger minting via Soroban/stellar-sdk.
  - UI: [src/app/page.tsx](src/app/page.tsx#L1-L400) (client), [src/app/layout.tsx](src/app/layout.tsx#L1-L200)
  - API: [src/app/api/mint/route.ts](src/app/api/mint/route.ts#L1-L200) — POST /api/mint expects JSON { "rut": "..." }
  - Validation helper: [src/app/lib/rut-validator.ts](src/app/lib/rut-validator.ts#L1-L200)

- **Local dev / build**
  - Start dev server: `npm run dev` (Next defaults to http://localhost:3000)
  - Build: `npm run build`; Start prod: `npm run start`
  - Lint: `npm run lint` (eslint)

- **Important environment variables** (see .env.local)
  - `ADMIN_SECRET` — server-only secret (must never be exposed to client). Used to sign transactions in [src/app/api/mint/route.ts](src/app/api/mint/route.ts#L1-L200).
  - `NEXT_PUBLIC_CONTRACT_ID` — safe to expose to client; contract identifier used by the backend contract call.
  - `RPC_URL`, `NETWORK_PASSPHRASE` — Soroban / Stellar network config.
  - `AUTHORIZED_RUTS` — comma-separated whitelist for the MVP; backend checks this in [src/app/api/mint/route.ts](src/app/api/mint/route.ts#L1-L200).

- **API contract & flows**
  - Client calls `/api/mint` with POST JSON: { "rut": "<RUT-with-dv>" } from [src/app/page.tsx](src/app/page.tsx#L1-L200).
  - Backend flow: validate RUT via `RutValidator`, check `AUTHORIZED_RUTS`, build + sign Soroban transaction with `ADMIN_SECRET`, send via `RPC_URL`.
  - Success path in the backend returns { success: true, hash, status } — UI expects `success` and `hash`.

- **Project conventions & patterns**
  - TypeScript with `strict: true` and `noEmit` — prefer editing TSX/TS source directly.
  - Path alias: `@/*` => `./src/*` (tsconfig.json) — use for imports if adding new modules.
  - Code that uses secrets must run server-side (API routes). Look for `process.env.*` usages in backend files.
  - RUT formatting: code expects RUT with hyphen (e.g., `78043412-0`) — validator located at [src/app/lib/rut-validator.ts](src/app/lib/rut-validator.ts#L1-L200).

- **Places to edit for common tasks**
  - Update allowed demo RUTs: `.env.local` `AUTHORIZED_RUTS`.
  - Change mint contract method or args: [src/app/api/mint/route.ts](src/app/api/mint/route.ts#L1-L200), search for `mint_deal` and `nativeToScVal` usages.
  - Client UX and logs: [src/app/page.tsx](src/app/page.tsx#L1-L400) — the mock scoring and client fetch are implemented here.

- **External deps / integration notes**
  - Uses `@stellar/stellar-sdk` and `@stellar/freighter-api` to interact with Soroban/Stellar.
  - Network and contract calls rely on RPC responses; Soroban returns interim statuses (e.g., `PENDING`) — backend treats `PENDING` as initial success.

- **Safety & security**
  - Never commit `ADMIN_SECRET` to source control. Prefer local `.env` or secret manager in CI/CD.
  - `NEXT_PUBLIC_*` vars are safe to expose to client only if intentionally public.

If any of these files or env values are wrong or you want additional examples (unit tests, CI, or a mock server), tell me which area to expand and I will iterate.
