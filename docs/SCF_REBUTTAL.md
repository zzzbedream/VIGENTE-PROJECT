# SCF Resubmission — Evidence-Backed Answers to Every Rejection Point

> **Every claim in this document links to a verifiable artifact — a
> transaction on stellar.expert, a commit in this repository, or a live
> deployment.** Nothing here is a promise; promises are what got the first
> submission rejected. This document answers the SCF #41 panel feedback
> point by point, plus the diligence questions any strategic partner
> should ask.

| | |
|---|---|
| **Live app** | https://vigente-project.vercel.app |
| **Badge contract (testnet)** | `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD` |
| **Latest verified threshold mint** | [`5bf78e25…`](https://stellar.expert/explorer/testnet/tx/5bf78e2590cdd83553183aaee17e09c23b032eda224dc6b8b69514ccc3859657) |
| **Ask** | **$60,000** across 4 tranches (10/20/30/40) |

---

## 1. Execution Risk & Team

> *SCF: "The team is a solo student developer with hackathon experience…
> this is a significant ask ($123K)… execution risk is high."*

### A. Budget: confirmed at $60,000 — a 51% cut

The ask is restructured to **$60K following the exact SCF handbook
milestone structure**: Tranche #0 $6K (10%) → T1 $12K (20%) → T2 $18K
(30%) → T3 $24K (40%). Breakdown per tranche:
[TRANCHE_1](TRANCHE_1_DELIVERABLES.md) ·
[TRANCHE_2](TRANCHE_2_DELIVERABLES.md) ·
[TRANCHE_3](TRANCHE_3_DELIVERABLES.md).

The cut is itself the answer to "significant ask": **the MVP was built
without grant money** — live contracts, 97 Rust tests across three crates,
a production app, and an isolated Blend pool running on our own SEP-40
oracle. The grant funds only what is *not* built: mainnet hardening, audit
prep, and ecosystem integrations.

The team is structured as three seats — CEO (protocol & cryptography), CTO
(contracts & mainnet path), COO (partnerships & GTM) — each registered on
the SCF platform with KYC commitment. Profiles: [TEAM.md](TEAM.md).

**On execution risk.** This is a founder-led project and the commit history
says so honestly: essentially all of it is the founder's, with two commits
from a contributing engineer. We are not quoting a figure that moves with
every push — verify it yourself with `git shortlog -sne --all`, which
prints four lines because each of us has committed under two name
spellings, but there are two people in that history, not four.

What the same history also shows is sustained execution: four contracts
deployed and verifiable on testnet, a custom SEP-40 oracle aggregator, an
isolated Blend pool activated with our own oracle in its immutable slot, a
full security audit with documented remediation, and a signed commercial
agreement with a Mexican tokenized-asset issuer with KYB approved.

The #41 review flagged execution risk for a solo builder. That risk was
real. The response was to ship verifiable infrastructure instead of arguing
about it — and to **hire from the grant rather than claim a team that does
not exist yet**.

### B. Proof of execution on Soroban — verifiable by anyone

| Artifact | Where to verify |
|---|---|
| **Own Blend pool, active, on our own SEP-40 oracle** | `get_config` on `CDYUHA3T…` → `status: 0`, `oracle: CCG6EAGO…`. Full evidence: [audit/08](../audit/08_POOL_ACTIVATION.md) |
| **Full credit cycle on it** — supply → borrow → repay → withdraw | Tx hashes in [audit/08 §6](../audit/08_POOL_ACTIVATION.md) |
| **Reputation actually moves credit** — same collateral, score 650 vs 850 → `max_borrow` ratio exactly `8500/7500` | `max_borrow` on `CCZNOV65…` for the two demo accounts |
| **Non-custodial under adversarial admin** — admin pauses, user still withdraws everything | [`d370b84a…`](https://stellar.expert/explorer/testnet/tx/d370b84aab83cce899a3d944e7f9916520a202bdc4a4258e4a465d6006b6ba32) |
| Threshold mints with 3-of-5 ed25519 signatures verified **on-chain** | [`8b9fccfc…`](https://stellar.expert/explorer/testnet/tx/8b9fccfc9daaf594e457e19808ef9c0746e8e45f37aab8417b5fe8d59641bc85), [`c5a071e8…`](https://stellar.expert/explorer/testnet/tx/c5a071e88fd021fa8d9b1b9cdf2f53a464ca87762b0a05bfff8c0ee339cdee84), [`5bf78e25…`](https://stellar.expert/explorer/testnet/tx/5bf78e2590cdd83553183aaee17e09c23b032eda224dc6b8b69514ccc3859657) |
| 97 Rust tests across three crates | `cargo test` in `contracts/{vigente-badge,margin-controller,oracle-aggregator}`; `npm run test:web` in `web/` |
| Production deployment any reviewer can use | [vigente-project.vercel.app/v3](https://vigente-project.vercel.app/v3) — connect any wallet, score, mint |
| Versioned consumer interface + live ABI | [INTERFACE.md](../contracts/vigente-badge/INTERFACE.md) · [abi-v3.json](integration/abi-v3.json) |
| Threat model with code-level mitigations | [THREAT_MODEL.md](THREAT_MODEL.md) — 6 STRIDE vectors, each mapped to a contract function and a named test |

---

## 2. Blend Feasibility

> *SCF: "The Blend integration is referenced but Blend does not currently
> support third-party oracles."*

### C. We verified this — and it is exactly why Vigente exists

We did the homework the panel asked for, against Blend's official
documentation:

1. **Blend's oracle slot is a [SEP-40] *price* oracle** (`lastprice`,
   `decimals`) with no borrower context, set immutably at pool creation
   ([docs.blend.capital/pool-creators/selecting-an-oracle](https://docs.blend.capital/pool-creators/selecting-an-oracle)).
2. **Borrowing in Blend is permissionless by design** — no whitelists, no
   per-borrower gating
   ([docs.blend.capital/users/general-faq](https://docs.blend.capital/users/general-faq)).

The panel was right about the constraint and we did not argue with it. We
built around it — and then went further than the point required.

**We deployed our own isolated Blend pool whose oracle slot holds our own
SEP-40 aggregator, and ran the full credit cycle on it.** That slot is
immutable after pool creation, so the pool is permanently bound to a price
feed we operate. The score never enters Blend at any point:

```
user ──► VIGENTE margin-controller ──► BLEND pool (ours, isolated)
         reads badge, derives            receives Request{address,
         tier LTV, prices via            amount, request_type}
         our aggregator                  — no reputation field exists
                    │                              ▲
                    └── oracle-aggregator ─────────┘
                        (SEP-40, ours) ──► Reflector (third party)
```

| Claim | Verification |
|---|---|
| The pool is ours and active | `get_config` on `CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI` → `status: 0` |
| Its oracle is ours | same call → `oracle: CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4` |
| Credit runs on it | supply → borrow → repay → withdraw, tx hashes in [audit/08](../audit/08_POOL_ACTIVATION.md) |
| Reputation changes the outcome | identical collateral, score 650 vs 850, `max_borrow` ratio exactly `8500/7500` |

So the honest answer to *"Blend does not support third-party oracles"* is:
**it supports exactly one, chosen at pool creation and immutable — and on
our pool, that one is ours.** What Blend does not support is reading a
reputation score, which is why the controller sits in front and never asks
it to.

Also compiled and tested, for integrators who want the badge without the
controller:
[`examples/integration-snippet/`](../examples/integration-snippet/) — an
`ExampleLender` consuming the oracle cross-contract via
`#[contractclient]`, 2/2 green.

---

## 3. Default Handling & Decentralization

> *SCF: "The loan default handling logic is not well-elaborated, and the
> centralized oracle model introduces a single point of trust."*

### D. The k-of-n threshold oracle, mathematically

- **Scheme:** independent **ed25519** signatures; threshold **k = 3 of
  n = 5** keypairs, public keys stored on-chain
  (`get_oracle_keys()` / `get_oracle_threshold()`).
- **Canonical 92-byte message** every oracle signs:
  `borrower.to_xdr() ‖ score_be(4) ‖ expiration_be(8) ‖ account_age_days_be(4) ‖ nonce(32)`.
  Altering one byte invalidates **all** signatures.
- **On-chain verification:** `mint()` runs
  `env.crypto().ed25519_verify` per signature, enforces unique oracle
  indices (no double-voting), and consumes the nonce in persistent
  storage (anti-replay).
- **Why this is not a central server:** no subset smaller than k can
  issue reputation. The contract **admin cannot fabricate a score** — it
  holds zero oracle keys. Named tests:
  `test_mint_fails_with_2_signatures`,
  `test_mint_fails_with_duplicate_index`,
  `test_mint_fails_with_replayed_nonce`,
  `test_mint_fails_with_invalid_signature`.
- **Declared trade-off** (documented in [THREAT_MODEL.md](THREAT_MODEL.md)):
  the 5 oracle processes are co-located for the testnet sprint; process
  separation is a Tranche 1 deliverable. The *cryptography* is already
  threshold — the ops hardening is what the grant funds.

We have also drafted a proposed ecosystem standard generalizing this read
interface: [SEP draft — Credit Attestation Oracle Interface](integration/sep-draft-credit-attestation.md).

### E. Who calls `slash()` — exactly

Two layers, both already in code:

1. **`liquidate()` is permissionless** —
   [`reference-vault/src/lib.rs:645`](../archive/reference-vault/src/lib.rs):
   *"Anyone can trigger liquidation of an overdue loan."* Any keeper or
   incentivized liquidator calls `liquidate(liquidator, borrower)` once
   `due_at` passes. No privileged actor is required for defaults to be
   recorded.
2. **`slash()` is vault-only** — the badge contract's `add_vault` ACL
   means only authorized vault contracts can write the immutable
   `DefaultBadge`. The liquidator never touches the badge directly; the
   vault cascades cross-contract.

Covered end-to-end by `test_default_lifecycle_triggers_slash`. Tranche 2
adds a liquidation fee so keepers are economically incentivized
(permissionless-but-unpaid is sufficient on testnet).

---

## 4. Traction, MoneyGram & Go-To-Market

> *SCF: "Lacks verifiable traction, defined access to MoneyGram, or
> confirmed partnerships. Unclear target customers."*

### F. Partnerships — strictly what is real

- **Signed:** a commercial agreement with **Etherfuse** — a tokenized-asset
  issuer and fiat on/off-ramp — executed July 2026. Business verification
  (KYB) approved; sandbox and production API access granted. This is a
  counterparty that has completed diligence on us, not a letter of intent.
- **Drafted, not signed:** a non-binding exploratory LOI with Payku exists as
  a document and is pending signature. We do not count it as a partnership,
  because it is not one yet. The protocol is deliberately built so it does
  **not** depend on Payku or any fintech: the score comes from public Horizon
  data and the adapter is optional enrichment.
- **In progress (dated, documented):** strategic-partner conversations
  running on the live production app this week; Lobstr Partners
  application and PaltaLabs (DeFindex) outreach are the COO's first-week
  deliverables. The full pipeline lives in a public, weekly-updated
  integration-conversations table — entities, status, last contact.
- **Target customer, reframed:** the first segment is **Stellar DeFi
  protocols and DAO treasuries** — an audience that already exists
  on-chain and can consume `is_defaulted()`/`get_score()` today with
  zero permission ([INTERFACE.md](../contracts/vigente-badge/INTERFACE.md)).
  LATAM micro-commerce arrives through fintech adapters in later
  tranches, not as a cold-start B2C play.

We will not list "positive conversations" as traction. When an LOI is
signed, it appears here with a date.

### G. Cash-out: existing SEP-24 wallets, not MoneyGram

**Confirmed.** MoneyGram is removed from the proposal entirely (it was
never a confirmed partner). End users off-ramp loans through **wallets
that already ship [SEP-24] anchors** — Lobstr, Beans App, Vibrant —
requiring zero licensing on our side. This is Stellar composability used
as intended. The live app already integrates the **Stellar Wallets Kit
with 9 wallets** (Lobstr included) for onboarding.

---

## 5. Milestone Validation

> *SCF: "Reviewers need a clear method to test, view, or verify the
> completion of each milestone."*

### H. Three validation methods per tranche — two already operational

1. **One command per tranche, JSON out.** `npm run validate-t1` exists
   today: emits contract IDs, test counts, and a live threshold demo
   (3 signatures pass / 2 fail). `validate-t2` (deposit → yield → claim +
   DeFindex position) and `validate-t3` (mainnet IDs + npm SDK) follow
   the same pattern, specified in each tranche document.
2. **Live frontend.** A reviewer connects any wallet at
   [vigente-project.vercel.app/v3](https://vigente-project.vercel.app/v3),
   sees their on-chain score with a 180-day credit heat map, and mints a
   real badge — the tx hash lands in their wallet history and on
   stellar.expert.
3. **Trustless verification.** Nothing requires believing us: tx hashes
   on stellar.expert, `stellar contract invoke -- get_score` against the
   public contract ID, `cargo test` on a fresh clone, and the
   [machine-readable ABI](integration/abi-v3.json) exported from the
   deployed WASM.

---

*Questions: zzzbedream@gmail.com · This document supersedes the
item-by-item map in [RESUBMISSION_FEEDBACK.md](RESUBMISSION_FEEDBACK.md)
for the upcoming submission.*

[SEP-40]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0040.md
[SEP-24]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
[docs/integration/BLEND.md]: integration/
