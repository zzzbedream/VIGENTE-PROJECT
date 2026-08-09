# Market Analysis — Where Vigente Fits in the Stellar Ecosystem

> Research date: June 2026. Every competitor claim below is sourced; every
> Vigente claim links to a verifiable artifact. This document exists to
> answer one question honestly: **is there room for a credit reputation
> primitive on Stellar, and is anyone already doing it?**

## TL;DR

There is **no native credit/reputation oracle on Stellar today**, and **no
native Sybil-resistance / reputation-passport equivalent** (Gitcoin
Passport, Human Passport, Worldcoin all live on other chains). Every Stellar
lending protocol — Blend ($80M+ TVL), Laina, FxDAO — is **over-collateralized
because the reputation primitive they'd need does not exist**. Vigente is
positioned to be that primitive: not a competitor to the lenders, but the
layer they read.

## 1. The Stellar DeFi landscape (June 2026)

| Protocol | Category | Collateral model | Reputation layer? | TVL / signal |
|---|---|---|---|---|
| **Blend** | Lending primitive | Over-collateralized, SEP-40 *price* oracle | No | $80M+ (DeFiLlama, Q1 2026) |
| **Laina** | Lending platform (single-token pools) | Over-collateralized | No | SCF-funded |
| **FxDAO** | CDP stablecoin | Over-collateralized | No | — |
| **Soroswap / Aquarius** | DEX / AMM | n/a | No | — |
| **DeFindex (PaltaLabs)** | Yield aggregator | n/a | No | — |
| **Reflector & SEP-40 oracles** | **Price** oracles | n/a | No (price only) | mature |

Ecosystem context: Soroban smart-contract volume ~$16M/day (8× YoY), USDC
~$500M/month, stablecoin cap ~$300M (Messari, State of Stellar Q1 2026).
DeFi on Stellar is real and growing — but **entirely over-collateralized**,
because there is no shared way to price a borrower's trustworthiness.

## 2. The two gaps

### Gap A — No credit/reputation oracle
Searches for "credit scoring oracle", "reputation primitive", "Soroban
credit" return **zero native protocols**. Price oracles (SEP-40) are mature
and standardized; **credit oracles do not exist**. Every lender reinvents
risk as "demand 150% collateral" because that's the only tool available.

### Gap B — No native Sybil-resistance / reputation passport
The proof-of-personhood and wallet-reputation market is large and active —
**but entirely off Stellar**: Gitcoin Passport, Human Passport, Worldcoin,
Trusta Labs, Holonym all live on Ethereum and other chains. A Stellar
project running an airdrop or reputation-weighted governance today has **no
native tool** to filter Sybil farms.

## 3. Tailwinds from the protocol itself

- **Protocol 25 "X-Ray"** (testnet Jan 2026): native zero-knowledge proofs
  and configurable privacy.
- **Nethermind Risc Zero verifier** being integrated into Soroban by SDF.
- **Protocol 27** (Jul 2026): delegated authentication.

These are the rails for Vigente's future real-world-data attestation
pipeline — **being built by the Stellar Development Foundation itself**. The
infrastructure for privacy-preserving credential proofs is arriving as a
platform feature, not something Vigente must build alone.

## 4. Cross-chain comparables (the model we bring to Stellar)

| Project | Chain | What it does | Lesson for Vigente |
|---|---|---|---|
| Gitcoin / Human Passport | Ethereum | Composite wallet reputation, Sybil scoring | Reputation-as-a-read-API is a proven, monetizable model |
| Worldcoin | Multi | Proof of personhood (biometric) | Demand for "is this a real, unique actor" is large |
| Trusta Labs | Multi | ML Sybil detection for airdrops | Airdrop-gating is a *today* revenue path, no lending needed |
| Spectral / Cred | Ethereum | On-chain credit scores (MACRO score) | On-chain behavioral credit scoring is validated — but none on Stellar |

None of these exist natively on Stellar. Vigente is the first to bring the
category — with a differentiator none of them have: **a k-of-n threshold
quorum signing the score on-chain**, so the reputation is decentralized,
not a single company's database.

## 5. Where Vigente sits — complement, not competitor

```
              PRICE side                         CREDIT side
        ┌──────────────────┐              ┌──────────────────────┐
        │ Reflector / SEP-40│              │  VIGENTE             │
        │ (asset prices)    │              │  (borrower reputation)│
        └─────────┬─────────┘              └──────────┬───────────┘
                  │         both are read by ↓        │
        ┌─────────┴────────────────────────────────────┴─────────┐
        │   Blend · Laina · FxDAO · RWA protocols · wallets        │
        │   (they hold the capital and bear the risk)             │
        └─────────────────────────────────────────────────────────┘
```

Blend reads a **price** oracle to value collateral. It has no **credit**
oracle to read, and being immutable it never will. So instead of asking it
to change, Vigente sits **in front of** it: a margin controller that prices
each borrower's LTV from reputation and hands Blend an ordinary request.

**We do not compete for the liquidity seat.** Blend keeps the pool, the
interest curves and the LP mechanics. We take the credit-policy seat that
nobody currently occupies — and because the badge is readable by any
contract, other protocols can occupy it too.

## 6. Honest competitive risks

- **"Build it yourself" risk:** a large lender (Blend) could build its own
  internal scoring. Mitigation: a *shared* primitive with a threshold quorum
  and an open standard (our SEP draft) is more valuable to the ecosystem than
  N siloed scores — and the network effect (one default visible everywhere)
  only works if the primitive is shared.
- **Cold-start:** a reputation oracle is only as useful as the protocols
  reading it. Mitigation: the Sybil/airdrop wedge delivers value with **zero
  lenders involved** — it bootstraps usage before the lending flywheel.
- **Thin on-chain data:** for borrowers with little Stellar history, the
  score is weak today. Honest position: real-world attestation is a later
  phase, on the ZK rails SDF is shipping; the MVP serves crypto-native
  actors whose on-chain history is already sufficient.

## 7. Conclusion

Stellar has a mature price-oracle layer and a growing, **fully
over-collateralized** lending layer. The credit/reputation primitive that
would unlock under-collateralized lending — and the Sybil-resistance tool
the ecosystem lacks entirely — **does not exist natively**. That is the
whitespace. Vigente already has the hard part built and running on testnet:
threshold oracle, on-chain scoring, the read interface, our own SEP-40 price
feed, and an isolated Blend pool with reputation-priced LTV on top of it
(see `../audit/08_POOL_ACTIVATION.md`). The work ahead is hardening it for
mainnet and earning the first real borrowers.

---

*Sources: Messari — State of Stellar Q1 2026 · DeFiLlama (Blend TVL) ·
stellar.org/blog (DeFi on Stellar; Protocol 25 X-Ray; 5 Real-World ZK Use
Cases / Nethermind Risc Zero) · SCF Handbook (stellar.gitbook.io) ·
communityfund.stellar.org/projects (Laina) · human.tech, Gitcoin Passport,
Trusta Labs (cross-chain Sybil comparables). Vigente artifacts: see
[SCF_REBUTTAL.md](SCF_REBUTTAL.md) and [INTERFACE.md](../contracts/vigente-badge/INTERFACE.md).*
