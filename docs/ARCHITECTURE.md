# Vigente Protocol — Architecture

> Complete pre-submission architecture per SCF Build criteria: *"Your technical architecture must already be complete at the time of application."*

---

## 1. System Overview

Vigente is **non-custodial collateralized credit on Soroban, priced by reputation**. A margin
controller sets each borrower's LTV from an on-chain reputation badge, then forwards the
operation to an isolated Blend pool that runs on our own SEP-40 oracle. The lending market
never reads the score — it cannot, and it does not need to.

The system has two halves, and the split is the trust model:

- **On-chain** — the margin controller, the badge, the oracle aggregator, and the Blend pool.
  This half is trustless: anyone can verify it, and no admin key can move user funds.
- **Off-chain** — the scoring engine, the 3-of-5 threshold signers, and the Next.js API.
  This half is **trusted**. The chain verifies signatures, not the methodology that produced
  the score. See §1.2.

### 1.1 Component map

```
OFF-CHAIN (trusted)                          ON-CHAIN (trustless)
─────────────────────                        ──────────────────────────────────

Stellar Horizon  ──▶ scoring-engine.ts
(public data,         horizon-scoring.ts
 180d window)         ecosystem-whitelist.ts
                              │
                              ▼
                      threshold-oracle.ts
                      5 ed25519 keys, k = 3
                      sign a canonical message
                              │
                              │ 3 of 5 signatures
                              ▼
                      /api/mint-v3  ────────────▶  vigente-badge  (SBT)
                                                   verifies k-of-n on-chain
                                                   mint() · slash() · get_score()
                                                          ▲
                                                          │ get_score / is_defaulted
                                                          │
   user ──── deposit / borrow / repay / withdraw ──▶ margin-controller
                                                          │
                                        derives tier LTV, checks capacity
                                                          │
                                     ┌────────────────────┴──────────────┐
                                     ▼                                   ▼
                              oracle-aggregator                    Blend pool
                              (ours, SEP-40)  ◀──lastprice()──     (isolated)
                                     │
                                     ▼
                              Reflector (third party)
```

**Read the price path carefully:** the Blend pool asks *our* aggregator for prices, and the
aggregator routes upstream to Reflector. A Blend pool's oracle slot is immutable after
deployment, so this pool is permanently bound to our aggregator.

### 1.2 What is trusted, and what is not

| Property | Guarantee |
|---|---|
| User funds cannot be seized by any admin | **Trustless** — `withdraw_collateral`, `repay` and `liquidate` ignore the pause flag; no upgrade function exists |
| LTV floor cannot be lowered | **Trustless** — `min_ltv_floor` is set at `init` and has no setter |
| Tier changes cannot be applied instantly | **Trustless** — queue + 48h grace, applied permissionlessly |
| Prices are fresh and within bounds | **Trustless** — staleness bound and deviation guard in the aggregator; stale or absent price reverts the operation |
| **The score reflects real creditworthiness** | **TRUSTED** — computed off-chain, signed k-of-n. The chain verifies signatures, not the method |

That last row is the honest limitation of the design. It is a deliberate trade-off, not an
oversight: a fully on-chain scoring method would be gameable by construction, since the inputs
are public. Reducing that trust — independent signer hosts and a methodology a third party can
recompute — is explicit Tranche 2 work.

### 1.3 Persistence

There is a Drizzle/Postgres scaffold in `web/src/db/` with three tables: `score_cache`,
`badge_events` and `kpi_snapshots` — a score cache, an event index and a KPI time series.

**None of it is in the trust path, and none of it is wired into runtime.** As
`web/src/db/schema.ts` states in its header, the build and the current routes do not depend on
a database; the score cache is still an in-memory map. No authoritative state lives off-chain:
positions, debt, collateral and reputation are all on-chain. A reviewer seeing `web/drizzle/`
in the tree is looking at migrations for a cache that is not yet connected.


---

## 2. Why Stellar (Non-Superficial Use)

Per SCF criteria, Stellar must be used to meaningfully improve core features, not as a superficial integration or data storage layer. Vigente uses Stellar Soroban specifically for properties no off-chain stack provides:

| Stellar property | Vigente use case | Why this is non-superficial |
|------------------|------------------|----------------------------|
| **Permissionless contract calls** | Any protocol can query `is_defaulted()` and `get_score()` without permission from Vigente | Off-chain credit bureaus require contracts; Soroban makes reputation a public good |
| **Immutable storage with TTL** | `DefaultBadge` records persist for ~2 years with no delete function | Off-chain DBs can erase records; Soroban storage is enforced at protocol level |
| **Cross-contract atomic calls** | `margin-controller.liquidate()` atomically slashes the badge; the controller also composes with an immutable third-party lending market it cannot modify | Without atomicity, defaults could be evaded by reordering tx |
| **Sub-cent transaction fees** | Mint cost is fractional cents | Critical for microcommerce target where margins are thin |
| **5-second finality** | Borrow approval happens in real-time | Web2 credit checks take days; Soroban finality enables real-time UX |
| **Native cryptographic primitives** | `env.crypto().sha256()`, `ed25519_verify()` | Future TLSNotary attestation requires these as gas-efficient operations |

Vigente could **not** be built as a Web2 service. The composability, atomicity, and verifiability are the protocol's reason to exist.

---

## 3. Smart Contract Layer

### 3.1 `vigente-badge` — Credit Reputation SBT

**Contract type:** Non-transferable Soulbound Token (SBT). One badge per address. No `transfer()` function exists.

**Storage architecture:**

| Storage tier | Contents | TTL |
|--------------|----------|-----|
| Instance | Admin, AuthOracles, AuthVaults, Paused flag | ~90 days (auto-extended on use) |
| Persistent | `Badge(Address) → CreditBadge` | ~90 days |
| Persistent | `Default(Address) → DefaultBadge` | **~2 years** (intentional max retention) |
| Temporary | Not used | — |

**Data structures:**

```rust
pub struct CreditBadge {
    score: u32,               // 0–1000
    issued_at: u64,           // ledger timestamp
    expires_at: u64,
    data_hash: BytesN<32>,    // SHA-256 commitment to attested data
    slashed: bool,
}

pub struct DefaultBadge {
    score_at_default: u32,
    defaulted_at: u64,
    slashed_by: Address,      // which vault triggered the slash
    reason: u32,              // 0=unspecified, 1=non_payment, 2=fraud, 3=collateral_shortfall
}
```

**Access control (three-tier ACL):**

| Role | Can call | Cannot |
|------|----------|--------|
| Admin (single → multi-sig in T3) | `add_oracle`, `add_vault`, `remove_*`, `pause`, `unpause` | `mint`, `slash`, delete defaults |
| Authorized Oracles (vec) | `mint` | `slash`, ACL management |
| Authorized Vaults (vec) | `slash` | `mint`, ACL management |
| Public | `is_defaulted`, `get_score`, `get_badge`, `get_default` | Any write |

**Immutability of negative history (defense in depth):**
1. No `delete_default()` function exists in the code.
2. `DefaultBadge` TTL is the maximum Soroban allows (~2 years).
3. `mint()` calls `is_defaulted()` before issuing — a defaulted address cannot ever re-mint from this contract.
4. `is_defaulted()` uses dual check (DefaultBadge record OR badge.slashed).
5. The `slash` event is emitted to the ledger; even after TTL expiry, the event log is permanent.

### 3.2 `margin-controller` — Reputation-Priced LTV over Blend

**Contract type:** A thin policy layer in front of an isolated Blend pool. It holds the Blend
position itself and tracks per-user accounting internally, so Blend sees one counterparty and
never learns anything about reputation.

**Functions:**

```rust
fn deposit_collateral(user: Address, asset: Address, amount: i128)
fn borrow(user: Address, amount: i128)
fn repay(user: Address, amount: i128)
fn withdraw_collateral(user: Address, asset: Address, amount: i128)
fn liquidate(liquidator: Address, user: Address, ...)
fn max_borrow(user: Address) -> i128   // view
fn ltv_bps_for(user: Address) -> u32   // view
```

**The borrow path, in order:**

```rust
// 1. Reputation → tier LTV. No badge, or a defaulted badge, means no capacity.
let score = badge.get_score(&user).expect("no active credit badge");
let ltv_bps = tier_ltv_for(score);          // ≥800 → 8500 · ≥550 → 7500 · ≥300 → 6000

// 2. Price both legs through OUR aggregator. Stale or absent price reverts.
let p_coll   = oracle.lastprice(&collateral_feed).expect("no price");
let p_borrow = oracle.lastprice(&borrow_feed).expect("no price");

// 3. Capacity. Multiply before dividing so precision is not lost.
let capacity = amount * p_coll / p_borrow * ltv_bps as i128 / 10_000;

// 4. Only now does Blend get involved — and it receives no score.
pool.submit(&controller, &controller, &controller, &requests);
```

**Tier ladder** (live values, readable with `get_tier_ltv`):

| Score | Tier | LTV |
|---|---|---|
| ≥ 800 | Gold | 85% |
| ≥ 550 | Silver | 75% |
| ≥ 300 | Bronze | 60% |
| < 300 | — | cannot borrow |

Every tier stays strictly below the Blend reserve `c_factor`, enforced on-chain by
`MAX_LTV_BPS = 9000`, so the aggregate position can never be liquidated by Blend while a user
sits at their own limit.

**Non-custodial invariants, immutable after `init`:** `min_ltv_floor` (no tier can ever be set
below it), `param_grace_secs` (48h queue before a tier change applies, then applied
permissionlessly), and the pool address itself. There is no `update_current_contract_wasm` —
the code cannot be changed after deployment. Full inventory of admin powers:
[`contracts/margin-controller/README.md`](../contracts/margin-controller/README.md).

### 3.3 `oracle-aggregator` — SEP-40 price feed

Implements SEP-40 (`lastprice`, `decimals`) so a Blend pool can consume it directly. Per-asset
routes point upstream to a third-party source (today Reflector). Each route carries a
`max_age` staleness bound and a `max_deviation_bps` guard; a missing price, a non-positive
price, a stale price, or one that would round to zero at the target decimals all **revert**
rather than serve a bad number.

Route changes are **queued with a 48h timelock** and applied permissionlessly. `set_initial_route`
works only when no route exists, so the admin cannot silently re-point a live asset — there is
a test asserting exactly that
([`src/test.rs`](../contracts/oracle-aggregator/src/test.rs), `invariante_ruta_existente_no_se_re_rutea_instantaneamente_ni_por_el_admin`).

### 3.4 The Blend pool

An isolated pool deployed via `pool_factory.deploy(...)`, whose `oracle` parameter is our
aggregator. That slot is **immutable**, which is the whole point: the pool is permanently bound
to a price feed we operate, and no one — including us — can swap it afterwards. XLM is the
collateral reserve, USDC the debt reserve.

Activation required funding the backstop above Blend's product-constant threshold. That story,
including a factor-of-2 error we made and corrected, is in
[`audit/08_POOL_ACTIVATION.md`](../audit/08_POOL_ACTIVATION.md).

### 3.5 Open Source Plan

All Soroban contracts are MIT-licensed (`LICENSE` at repository root). The TypeScript SDK delivered in Tranche 3 is also MIT. There is no plan to introduce closed-source components or proprietary licensing. Forks, integrations, and modifications are encouraged.

---

## 4. Oracle Adapter Layer

### 4.1 Current state — k-of-n threshold, live

Five independent ed25519 keypairs each sign a **canonical message** binding the borrower,
score, expiration, wallet age and an anti-replay nonce. `/api/mint-v3` gathers 3 of the 5 and
submits; `vigente-badge.mint()` verifies the signatures **on-chain** with
`env.crypto().ed25519_verify()`. Fewer than 3 valid signatures, or any tampering with the
message, and the call reverts.

Two properties follow, and both are tested:

- **The admin holds no oracle keys.** The admin can add or remove signers, but cannot mint.
- **The single-signer trust assumption is gone.** Compromising one key achieves nothing;
  an attacker needs 3.

XDR parity between the TypeScript signers and the Rust verifier is asserted by tests on both
sides (`web/tests/xdr-parity.test.ts`, and the badge crate's test module), because a
serialization mismatch would silently break verification.

> An earlier design used a single server-side oracle with an HMAC over a Chilean RUT, sourced
> from a fintech adapter. That flow and its routes were **removed** — the score now derives
> from public Horizon data, and the trust model is k-of-n rather than a single operator.

### 4.2 Data sources

The scoring engine reads **only public Stellar Horizon data**. Fintech adapters (Payku,
Fintoc) exist in the codebase as *enrichment*, never as a requirement: a user with no fintech
relationship still gets a score. This matters for the trust model — the base score depends on
data anyone can independently recompute.

### 4.3 Remaining decentralization work

| Phase | Model | Trust assumption | Status |
|---|---|---|---|
| Single server-side oracle + HMAC | one operator | trust Vigente | superseded |
| **3-of-5 threshold ed25519, verified on-chain** | quorum | trust ≥3 of 5 signers | **live** |
| Signers on independent hosts, operated by third parties | quorum, physically separated | trust ≥3 independent operators | Tranche 2 |
| Recomputable methodology published | anyone can re-derive the score | verify rather than trust | Tranche 2 |
| Client-side attestation (TLSNotary-style) | user's device proves it | trustless | post-grant |

**Honest position on today's state:** the 5 keypairs are cryptographically independent but
**co-located** — they run in the same process. That removes single-key compromise, not
single-operator compromise. Separating them is Tranche 2 work and is not claimed as done.

---

## 5. Scoring Engine

Deterministic three-dimensional algorithm operating on 6-month transaction history:

```
Volume score (0–40):     based on total transactional USD equivalent
Consistency score (0–30): inverse coefficient of variation across monthly volumes
Frequency score (0–30):  transactions per month over the 6-month window

Total: 0–100 → mapped to Tier (Gold ≥80, Silver ≥55, Bronze ≥30, None < 30)
Max loan amount: tier-dependent (Gold: 10M CLP, Silver: 5M CLP, Bronze: 2M CLP, None: 0)
```

Implementation: `web/src/services/scoring-engine.ts`. Pure function, no side effects, deterministic for fixed inputs. Same algorithm runs server-side today and will move client-side post-TLSNotary integration.

---

## 6. Threat Model (Summary)

**Full STRIDE analysis with code references and live testnet evidence lives in [docs/THREAT_MODEL.md](THREAT_MODEL.md).** That document is the authoritative source; the table below is a quick reviewer pointer.

| Vector | Mitigation | Status | Code |
|---|---|---|---|
| Oracle key compromise (single signer) | k-of-n threshold ed25519 verification on-chain, anti-replay nonce | ✅ Shipped, live on testnet `CDLLO7QE…` | `contracts/vigente-badge/src/lib.rs` |
| Sybil farms / throw-away wallets | 30-day wallet-age floor folded into the signed mint message | ✅ Shipped | `vigente-badge.mint()` |
| Carousel / wash trading | Ecosystem-counterparty whitelist + 70% P2P penalty on volume and effective tx count | ✅ Shipped | `web/src/services/horizon-scoring.ts` |
| Long-con default | `slash()` writes an immutable `Default` record readable by any protocol; a defaulted badge yields zero borrow capacity | ✅ Shipped | `contracts/margin-controller/src/lib.rs` |
| Aggregate position liquidated by Blend at a user's own limit | Every tier LTV is held strictly below the reserve `c_factor` by the on-chain `MAX_LTV_BPS = 9000` ceiling | ✅ Shipped | `contracts/margin-controller/src/lib.rs` |
| Uncapped exposure to one asset | Per-asset `collateral_cap` checked on every deposit (pilot guardrail) | ✅ Shipped | `margin-controller.deposit_collateral()` |
| Admin trapping user funds behind `pause()` | `withdraw_collateral`, `repay` and `liquidate` never read the pause flag — proven on-chain under an active pause | ✅ Shipped | `audit/08_POOL_ACTIVATION.md` §6.4 |
| Admin silently lowering LTV to force liquidations | `min_ltv_floor` immutable after `init`; tier changes queue for 48h then apply permissionlessly; existing positions keep an `LtvAtBorrow` snapshot during the grace window | ✅ Shipped | `margin-controller.queue_set_tier_ltv()` |
| Admin re-pointing the price oracle | Blend's pool `oracle` slot is immutable; aggregator route changes carry a 48h timelock and `set_initial_route` only works when no route exists | ✅ Shipped | `contracts/oracle-aggregator/src/lib.rs` |
| Reentrancy | Soroban execution model inherently reentrancy-safe | ✅ Inherent | n/a |
| Pool-level liquidity risk (bank run, utilization spiral) | **Not ours to mitigate** — liquidity, utilization curves and LP withdrawal live in the Blend pool, which we compose with rather than reimplement | ⚠️ Inherited from Blend | n/a |
| Tampered off-chain attestation (TLSNotary) | Documented as post-grant work | ⏳ Out of scope of the grant | n/a |

---

## 7. Privacy Design

The base score is derived from **public Horizon data**, so the privacy surface is much smaller
than in the original fintech-adapter design: there is no national ID, no bank data and no PII
in the pipeline at all unless a user opts into enrichment.

**What goes on-chain:**
- Aggregate score (0–1000) and the derived tier
- A SHA-256 commitment to the attested data (`data_hash`)
- Timestamps, expiry, wallet-age floor
- Slashing events with reason codes

**What never goes on-chain:**
- Any raw identifier — only its hash
- Individual transaction amounts or counterparties
- Bank account numbers
- Names, emails, phone numbers

Two layers enforce this: the oracle never writes raw fields, and the contract structs
(`CreditBadge`, `DefaultBadge`) have nowhere to put them — they hold only hashes and
aggregates.

**A caveat worth stating.** The score itself is public and bound to an address, and the
underlying Horizon activity is public by construction. Someone who already knows which address
belongs to whom learns that person's credit tier. Pseudonymity is the only protection here, and
we do not claim more than that.

---

## 8. Data Flow — End-to-End

**Phase A — earning a badge**

```
1. User connects a wallet (Stellar Wallets Kit).
2. Scoring engine reads PUBLIC Horizon data for that account: 180-day window,
   P2P churn discounted against an ecosystem whitelist. No PII, no RUT, no
   fintech account required.  → web/src/services/horizon-scoring.ts
3. threshold-oracle.ts has 5 independent ed25519 keys sign a canonical message
   binding (borrower, score, expiration, account_age_days, nonce).
4. /api/mint-v3 collects 3 of the 5 signatures and assembles the transaction.
5. vigente-badge.mint(...) verifies the k-of-n signatures ON-CHAIN. Fewer than 3
   valid signatures, or a tampered message, and the call reverts.
6. Badge(user) is stored. Non-transferable, time-bound.
```

The admin holds **zero** oracle keys, so no single party — the admin included — can fabricate
a score.

**Phase B — borrowing against it**

```
 7. user → margin-controller.deposit_collateral(user, XLM, amount)
 8. Controller pre-authorizes exactly the pull Blend will make
    (authorize_as_current_contract) and forwards a SupplyCollateral request.
 9. user → margin-controller.borrow(user, amount)
10. Controller reads badge.get_score(user) and derives the tier LTV.
11. Controller prices both legs through OUR aggregator; stale or absent → revert.
12. If amount ≤ capacity, the controller forwards a Borrow request to Blend.
    Blend receives Request{address, amount, request_type} — no score field exists.
13. repay / withdraw_collateral run the same path in reverse, and neither
    consults the pause flag.
```

**Phase C — default**

```
14. Position goes unhealthy. liquidate() is permissionless: anyone can call it.
15. The controller seizes collateral and calls badge.slash(controller, user, reason).
16. Badge sets slashed = true and writes Default(user), TTL ~2 years, no delete.
17. Any contract calling is_defaulted(user) now reads true — including lenders
    that have nothing to do with Vigente.
```

Step 17 is the point of the whole design: a default recorded here is legible to any protocol
that chooses to look, without asking anyone's permission.

---

## 9. Failure Modes & Recovery

| Failure | Detection | Recovery |
|---------|-----------|----------|
| **Upstream price source stale or absent** | Aggregator's `max_age` bound | Every operation that needs a price **reverts**. Positions are frozen, never mispriced. Serving a stale number is the one failure the design refuses |
| Upstream price moves anomalously | `max_deviation_bps` guard | Reverts rather than propagating the outlier |
| Oracle signer key compromise (1 of 5) | Anomalous mint volume | Nothing happens — an attacker needs 3. Rotate via `remove_oracle()` / `add_oracle()` |
| ≥3 signer keys compromised | Anomalous mint volume, score/behavior mismatch | Admin `pause()` on the badge stops new mints. **Already-issued badges stay valid** — this is the residual risk of a co-located signer set, and the reason separation is Tranche 2 |
| Margin controller has a logic bug | Tests, audit, post-mortem | Contracts are immutable: deploy a new instance and users migrate voluntarily. **Users can always exit the old one** — `withdraw_collateral` ignores pause. Badges survive; they live in a separate contract |
| Blend pool degraded or frozen by its own admin | `get_config` status ≠ 0 | Outside our control. Borrowing stops; withdrawal paths remain per Blend's status semantics. This is the cost of composing rather than reimplementing |
| Soroban RPC outage | RPC unreachable | UI errors and retries; operations deferred. No state corruption |
| Enrichment adapter down (Payku / Fintoc) | Adapter retry exhausted | Base score is unaffected — enrichment is optional by design |

---

## 10. Standards & Interoperability

- **SEP-40 price oracle** — the `oracle-aggregator` implements it, which is what lets a Blend pool consume our feed at all. This is the interface that makes the whole composition possible.
- **SEP-41 token interface** — used for XLM and USDC SAC integration in the margin controller.
- **Soroban events** — all state-changing operations emit indexed events for Mercury / SubQuery indexers.
- **`is_defaulted()` and `get_score()`** as a de facto standard interface for any Stellar lending protocol that wants to query Vigente badges.

There is no Vigente-specific token standard. We use Soroban's native primitives.

---

## 11. Non-Goals (What This Architecture Does NOT Do)

To prevent scope creep and clarify the boundary:

- **Vigente does not issue stablecoins or fiat-backed tokens.** No Stellar Info File needed.
- **Vigente does not operate a fiat on/off ramp.** Fiat rails are a partner integration, not a component we run.
- **Vigente does not implement KYC.** The base score needs none — it reads public chain data. Where KYC matters, it belongs to whoever originates the credit.
- **Vigente is not a wallet.** The user brings their own via Stellar Wallets Kit.
- **Vigente is not a chain or L2.** It is a set of Soroban contracts, **on testnet today**; mainnet is gated on a security audit.
- **Vigente does not require any lending market to read its score on-chain.** Blend consumes only SEP-40 *price* oracles and cannot gate on reputation — so we never ask it to. The `margin-controller` sits in front, enforces the policy itself, and hands Blend an ordinary `Request`. Any other protocol may opt in to read `get_score` / `is_defaulted` directly, and originators that already do KYC can consume the score off-chain.
- **Vigente is not a lending pool.** Liquidity, interest curves and LP mechanics belong to Blend. We are the credit-policy layer in front of one, not a competitor to it.

---

*Document Version: 1.0.0*
*This document is pre-submission per SCF criteria. The contracts and data flows described here are implementation-complete in the repository at submission time, with deployment and final hardening delivered through Tranches 1–3.*
