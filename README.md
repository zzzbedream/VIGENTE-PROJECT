# Vigente Protocol — credit without permission

![Network](https://img.shields.io/badge/stellar-testnet-blue) ![Tests](https://img.shields.io/badge/tests-104%2B-green) ![Oracle](https://img.shields.io/badge/oracle-3--of--5%20threshold-22c55e) ![License](https://img.shields.io/badge/license-MIT-purple)

> **The missing credit primitive for Stellar DeFi.** A k-of-n threshold
> credit oracle on Soroban: verifiable borrower reputation signed by an
> independent quorum, with zero fintech in the trust path. Any Soroban
> contract can read `is_defaulted()` and `get_score()` — no permission,
> no registration, no token.

## Live Evidence — verify everything yourself

| Resource | Value |
|----------|-------|
| **Live app** (connect any wallet, score, mint) | https://vigente-project.vercel.app |
| **Badge contract v3** (threshold + age floor) | [`CDLLO7QE…HWVD`](https://stellar.expert/explorer/testnet/contract/CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD) |
| **Threshold mint — 3-of-5 ed25519 verified on-chain** | [`8b9fccfc…`](https://stellar.expert/explorer/testnet/tx/8b9fccfc9daaf594e457e19808ef9c0746e8e45f37aab8417b5fe8d59641bc85) · [`c5a071e8…`](https://stellar.expert/explorer/testnet/tx/c5a071e88fd021fa8d9b1b9cdf2f53a464ca87762b0a05bfff8c0ee339cdee84) · [`5bf78e25…`](https://stellar.expert/explorer/testnet/tx/5bf78e2590cdd83553183aaee17e09c23b032eda224dc6b8b69514ccc3859657) |
| **Tests** | 104+ across `vigente-badge`, `reference-vault`, `web/` — run `cargo test` / `npm run test:web` on a fresh clone |
| **Deployed WASM sha256** | `60fe64dc480893e28a54d35d544bc0344666e5e9f7cda6851f38ec6cc6d66c80` |
| **Machine-readable ABI** (exported from the live contract) | [`docs/integration/abi-v3.json`](docs/integration/abi-v3.json) |
| **SCF resubmission — every rejection answered with evidence** | [`docs/SCF_REBUTTAL.md`](docs/SCF_REBUTTAL.md) |

Historical contracts: v2 threshold [`CCD7KNYI…UMA5`](https://stellar.expert/explorer/testnet/contract/CCD7KNYIJAVN4JRZKCMZWCBK3ED43VYEBX5PSYHOBOR6BHMVMN2GUMA5) · v1 single-oracle `CATE7NUI…UH4W`.

---

## The Problem

Stellar DeFi has price oracles ([SEP-40]) and tokenized vaults ([SEP-56]),
but **no shared credit primitive**. Every protocol that wants to move
beyond 150% over-collateralization must reinvent reputation from scratch —
so none do. Meanwhile, LATAM alone has 1M+ microcommerces with consistent
cash flow and zero on-chain borrowing capacity: a $1.2T SME credit gap
(IFC) with no rail into permissionless liquidity.

## The Solution

Three independently verifiable components:

1. **`vigente-badge`** — a Soulbound credit token minted only with **3-of-5
   independent ed25519 oracle signatures** over a canonical 92-byte
   message, verified on-chain. Defaults are recorded immutably via
   `slash()`. No single party — including the contract admin — can
   fabricate a score.
2. **Synthetic scoring engine** — reads only public Stellar Horizon data
   (180-day window), discounts P2P churn 70% against an ecosystem
   whitelist, and renders a 180-day **credit heat map**. Fintech adapters
   (Payku, Fintoc) *enrich* scores; they are never required.
3. **`reference-vault`** — a complete credit-gated lending contract:
   score-tiered limits, first-loan throttling, TVL/utilization caps, LP
   withdrawal timelock, and a permissionless `liquidate()` that cascades
   cross-contract into `slash()`. A reference implementation any Stellar
   lending protocol can adopt.

---

## For Integrators — Credit Oracle Interface v1

Any Soroban contract or off-chain client can read borrower credit state from
the live testnet oracle. No permission, no registration, no token.

```rust
#[contractclient(name = "BadgeClient")]
pub trait VigenteBadge {
    fn is_defaulted(env: Env, borrower: Address) -> bool;
    fn get_score(env: Env, borrower: Address) -> Option<u32>;
}
```

| Resource | Where |
|---|---|
| Full interface spec (6 read functions, types, trust model, versioning) | [`contracts/vigente-badge/INTERFACE.md`](contracts/vigente-badge/INTERFACE.md) |
| Machine-readable ABI (live contract spec, testnet) | [`docs/integration/abi-v3.json`](docs/integration/abi-v3.json) |
| Compilable consumer example + cross-contract tests | [`examples/integration-snippet/`](examples/integration-snippet/) |
| Production-grade consumer (score tiers, slash cascade) | [`contracts/reference-vault/`](contracts/reference-vault/) |
| Proposed ecosystem standard (SEP draft) | [`docs/integration/sep-draft-credit-attestation.md`](docs/integration/sep-draft-credit-attestation.md) |

---

## Try It (3 minutes)

1. Open https://vigente-project.vercel.app/v3
2. **Connect wallet** — xBull, Albedo, Freighter, Rabet, Lobstr, and 4 more
   via one modal. New testnet accounts are funded automatically via
   Friendbot.
3. **Score** — your on-chain activity becomes a tier + a 180-day credit
   heat map (green = ecosystem flow, amber = P2P-heavy).
4. **Mint** — the relayer collects 3-of-5 threshold signatures and submits;
   the tx hash lands in your wallet and on stellar.expert.



The original fintech-adapter flow still works at `/legacy`. Test RUTs:
`20.244.452-1` (Gold) · `12.345.678-2` (Silver) · `99.999.999-9` (fail
case). RUTs ending in `1`/`K` → Tier A; `2` → Tier B; `9` → fail.

</details>

---

## Architecture

```
┌──────────────┐   ┌──────────────────────┐   ┌─────────────────────────┐
│ Stellar       │──►│ Synthetic scoring    │──►│ Threshold oracle quorum │
│ Horizon data  │   │ engine (180d window, │   │ 5 ed25519 keys, k = 3   │
│ (public)      │   │ P2P penalty, heatmap)│   │ sign 92-byte canonical  │
└──────────────┘   └──────────────────────┘   └───────────┬─────────────┘
                                                          │ signatures
                                                           ▼
┌──────────────────┐  get_score() / is_defaulted()  ┌──────────────────┐
│ reference-vault   │◄───────────────────────────── │ vigente-badge    │
│ (credit-gated     │                               │ SBT, verifies    │
│  lending, caps,   │ ──────────────────────────────►│ k-of-n on-chain, │
│  timelock)        │  slash() on liquidation        │ immutable slash  │
└──────────────────┘                               └──────────────────┘
```

Full spec: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Threat model
(6 STRIDE vectors, each mapped to code + a named test):
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)

---

## Current Status — the hyper-realistic version

Partners and reviewers deserve the unvarnished picture. Both columns are
equally true.

| ✅ Works TODAY (verifiable) | ❌ Does NOT exist yet (honest) |
|---|---|
| 3-of-5 threshold mint, verified on-chain ([tx proof](https://stellar.expert/explorer/testnet/tx/5bf78e2590cdd83553183aaee17e09c23b032eda224dc6b8b69514ccc3859657)) | Mainnet deployment — testnet only, by design until audit |
| Hardened lending vault (TVL/util caps, ladder, timelock, slash cascade) with 104+ tests | External users — every mint so far is from team wallets or labeled synthetics |
| Credit Oracle Interface v1: spec + live ABI + compilable consumer example | Signed commercial LOIs — one *non-binding* exploratory LOI (Payku); partner conversations in progress, dated in the pipeline table |
| Production app with 9-wallet onboarding + 180-day credit heat map | First off-chain originator integration — score API consumed by a remittance/PayFi partner for a real cohort (Vita = target, LOI in progress) |
| SEP draft for a Credit Attestation standard | Security audit (SCF provides audit credits at T3) |
| Threat model: 6 STRIDE vectors mapped to code + named tests | Independent oracle node separation — the 5 keypairs are cryptographically independent but co-located for the sprint |
| | Real-world data ZK pipeline — committed hashes only today; proofs are T2+ |

**The north:** become the credit attestation standard for Stellar — the
layer every lending protocol, wallet, and anchor reads before extending
under-collateralized credit. Not another lending app: the primitive
underneath them.

## Roadmap — SCF Build $60K (10/20/30/40) + a post-grant Tranche 4

Everything in "shipped" is verifiable on-chain today. The grant funds only
what is not built. Tranche 4 is deliberately **outside** the SCF ask —
funded by revenue / pre-seed — so the grant scope stays honest.

### Shipped (pre-grant, $0)
Threshold oracle live · badge + immutable defaults · hardened vault ·
Oracle Interface v1 + ABI · credit heat map · 9-wallet onboarding ·
production app · SEP draft.
**Validation:** tx hashes above · `cargo test` · [live app](https://vigente-project.vercel.app).

### Tranche 1 — $12K · first off-chain originator integration
The viable consumption path: an originator that **already** does KYC and
originates credit reads the score **off-chain** and applies its own policy.
Vigente never touches the loan.
- **Score attestation API hardened** — the existing HMAC-signed
  `get_score` / `is_defaulted` endpoint productized as a SEP-12-style
  attestation surface (keys, rate limits, signed payloads).
- **Originator integration guide** — how a remittance wallet / PayFi
  originator consumes the attestation. First target: **Vita Wallet**
  (LATAM remittances) — *target partner, LOI in progress, not signed*.
- Oracle ops: process separation for the 5 nodes + key-rotation runbook.
- Persistent score cache · `vigente.app` domain · admin dashboard.
- SEP draft submitted upstream (PR to `stellar/stellar-protocol`).
- **Validation:** a remittance/PayFi originator (Vita = target) reads
  `get_score` / `is_defaulted` via the API for a real cohort; coverage,
  latency and signal-utility metrics published. `npm run validate-t1` → JSON.

### Tranche 2 — $18K · open-finance enrichment (consented) + yield
- **Consented open-finance enrichment**: opt-in open-banking data
  (Fintoc / Prometeo) enriches the score — enrichment only, never a trust
  path; the core score stays trustless on-chain.
- **Yield layer on the `reference-vault`**: LP yield accounting (claim
  without exit) · SEP-0056 tokenized vault · `/earn` UI · liquidation
  keeper incentives. The vault remains **the** on-chain demonstration of
  credit-gated lending end-to-end (TVL cap, utilization rail, timelock,
  slash-on-default) — no third-party lending protocol is in the loop.
- **First ramp demo (testnet)**: loan disbursement → cash-out through a
  wallet with [SEP-24] anchor integration (Lobstr / Beans App flow).
- **Validation:** `npm run validate-t2` → `deposit→borrow→yield→claim` tx
  chain on the reference-vault + an enrichment-improved score measured on a
  cohort + ≥2 integrated consumers.

### Tranche 3 — $24K · mainnet + real money rails
- Mainnet deploy of badge + vault **behind multi-sig** · audit prep (SCF
  audit credits applied here).
- TypeScript SDK on npm · tier-segmented pools.
- **Stellar ramps, production**: end users cash loans in/out through
  existing SEP-24 anchors via partner wallets — zero licensing on our
  side, pure ecosystem composability. Target: one working LATAM corridor.
- Micro-commerce pilot (first cohort) via fintech adapter partners.
- **Validation:** mainnet contract IDs on stellar.expert + SDK on npm +
  one documented end-to-end loan: mint → borrow → SEP-24 cash-out →
  repay → badge intact.

### Tranche 4 — beyond the grant (post-SCF · revenue / pre-seed funded)
The scale chapter. Explicitly NOT part of the $60K ask:
- **Ramp corridors at scale**: SEP-24 + [SEP-31] cross-border flows across
  2-3 LATAM countries (Chile → regional), anchor partnerships.
- **Repayment interception (the moat)**: route a share of future remittance
  inflow to repayment **before** it reaches the borrower's wallet
  (Huma / Arf model) — lowers expected default for the originator that
  bears the credit risk. Design:
  [`docs/design/REPAYMENT_INTERCEPTION.md`](docs/design/REPAYMENT_INTERCEPTION.md). *Roadmap, not shipped.*
- **ZK attestation pipeline**: real zero-knowledge proofs over real-world
  data (invoices, bank statements) replacing today's hash commitments.
- **100+ merchant pilot** with default-rate data published openly —
  the dataset that prices LATAM micro-credit risk on-chain.
- Independent oracle operators (third parties running nodes) · full
  security audit.

**Deliberately out of scope at every stage:** any dependency on an
immutable price-oracle lending market reading our score on-chain — those
markets consume only SEP-40 *price* oracles, so they cannot gate on
reputation · own token · early multi-chain · retail KYC in-house ·
competing with existing lending markets. Vigente is the credit layer other
protocols and originators read — not another lending app.

---

## SCF Resubmission

Our first submission (SCF #41) was rejected on six points: solo-developer
execution risk, budget structure, third-party-oracle feasibility, default handling,
centralized oracle, and missing traction/validation. **Each point is now
answered with a verifiable artifact** — transactions, commits, live
deployments — in [`docs/SCF_REBUTTAL.md`](docs/SCF_REBUTTAL.md). The
historical item-by-item map lives in
[`docs/RESUBMISSION_FEEDBACK.md`](docs/RESUBMISSION_FEEDBACK.md).

---

## Tech Stack & Installation

| Layer | Technology |
|-------|-----------|
| Smart contracts | Rust + Soroban SDK (badge SBT, lending vault, mock USDC) |
| Oracle + scoring | Node.js + TypeScript (threshold simulator, Horizon scoring, fintech adapters) |
| Frontend | Next.js 16 + Tailwind + Stellar Wallets Kit (9 wallets) |
| Network | Stellar Testnet → Mainnet (sub-cent fees, 5s finality) |

```bash
git clone https://github.com/zzzbedream/VIGENTE-PROJECT.git

# Contracts (104+ tests)
cd VIGENTE-PROJECT/contracts/vigente-badge && cargo test
cd ../reference-vault && cargo test
cd ../mock-usdc && cargo test

# Web app
cd ../../web
npm install
cp .env.local.example .env.local   # see file for required vars
npm run dev                        # http://localhost:3000

# Tranche validation (JSON output for reviewers)
npm run validate-t1
```

Deploy your own instance:

```bash
cd contracts/vigente-badge
cargo build --target wasm32v1-none --release
stellar contract deploy --wasm target/wasm32v1-none/release/vigente_badge.wasm \
  --source <ADMIN_SECRET> --network testnet
```

---

## Security & Privacy

- **Threshold issuance**: no subset of fewer than k=3 oracles can mint;
  the admin holds zero oracle keys.
- **Privacy commitments**: only SHA-256 hashes of attested data touch the
  chain — never raw PII.
- **Soulbound + time-bound**: badges are non-transferable and expire
  (90 days), forcing fresh attestation.
- **Immutable defaults**: `slash()` writes a permanent `DefaultBadge`
  (~2-year TTL). No delete function exists.
- **Hardened vault**: TVL cap, 85% utilization cap, first-loan throttle,
  14-day LP withdrawal timelock.
- **Circuit breaker**: admin can pause `mint`/`slash` without touching
  existing data.

Full analysis: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)

---

## Team

Three seats, each visible in `git log` under their own authorship:

- **CEO / Founder (zzzbedream)** — protocol design, threshold cryptography, Soroban contracts
- **CTO** — contracts & backend roadmap, mainnet path, ecosystem integrations
- **COO** — partnerships, GTM, SCF compliance

Profiles: [`docs/TEAM.md`](docs/TEAM.md) · Contact: zzzbedream@gmail.com

## Contributing & AI Disclosure

Contributions welcome — open an issue or PR on
[GitHub](https://github.com/zzzbedream/VIGENTE-PROJECT/issues). Per SCF
Open Track requirements, AI assistance is fully disclosed in
[`docs/AI_DISCLOSURE.md`](docs/AI_DISCLOSURE.md): Anthropic Claude was
used as a collaborative coding and documentation assistant; all design
decisions and security-relevant code were author-reviewed.

## License

MIT — see [LICENSE](./LICENSE).

---

<p align="center">
  <strong>Vigente Protocol</strong><br/>
  The missing credit primitive for Stellar DeFi<br/>
  <a href="https://vigente-project.vercel.app">Live App</a> ·
  <a href="docs/SCF_REBUTTAL.md">SCF Rebuttal</a> ·
  <a href="https://stellar.expert/explorer/testnet/contract/CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD">Testnet Contract</a>
</p>

[SEP-40]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0040.md
[SEP-56]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0056.md
[SEP-24]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
[SEP-31]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0031.md
