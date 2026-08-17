# Documentation index

Everything here describes **what Vigente is today**: non-custodial collateralized credit,
where a reputation badge prices each borrower's LTV, in front of our own isolated Blend pool.
Documents that described earlier versions of the product were retired rather than left to
contradict the current ones — see *What is not here* at the bottom.

For evidence over explanation, start with the [`audit/`](../audit/) reports, not this folder.

## Architecture

| Document | What it answers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the system fits together and why Soroban |
| [ARQUITECTURA_INTERNA.md](ARQUITECTURA_INTERNA.md) | Contract-level internals (Spanish) |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Attack surfaces and mitigations, each linked to code or a test |
| [design/REPAYMENT_INTERCEPTION.md](design/REPAYMENT_INTERCEPTION.md) | Design sketch — **not implemented**, post-grant |

## Grant submission

| Document | What it answers |
|---|---|
| [SCF_REBUTTAL.md](SCF_REBUTTAL.md) | Every rejection point from the prior panel, answered with transactions and commits |
| [AI_DISCLOSURE.md](AI_DISCLOSURE.md) | Full disclosure of AI-assisted work, as SCF Open Track requires |
| [TEAM.md](TEAM.md) | Who does what, and what is not funded |
| [MARKET_ANALYSIS.md](MARKET_ANALYSIS.md) | Whether anyone else on Stellar is doing this (June 2026 research) |

## Integration

| Document | What it answers |
|---|---|
| [integration/sep-draft-credit-attestation.md](integration/sep-draft-credit-attestation.md) | Proposed SEP for a credit attestation interface |
| [integration/abi-v3.json](integration/abi-v3.json) | ABI of the deployed badge contract |

## Quality system (`qms/`)

Verifiable client-protection and impact standards, written so a funder or an integrating
protocol can audit that the project protects the end user. Start at [qms/README.md](qms/README.md).

## Engineering records

- [notes/](notes/) — dated acceptance records for the threshold oracle and badge. Two of them
  are cited as evidence from `THREAT_MODEL.md`.
- [traction/](traction/) — June 2026 metrics snapshot. Read [traction/README.md](traction/README.md)
  first: the "real metrics" file is deliberately empty.

## What is not here, and why

The business plan, PRD, tranche deliverable specs, management roadmap and the resubmission
feedback log all described the **pre-pivot** product — a credit-signal oracle sold to third
parties, with a Chilean payment-processor go-to-market — or budget figures the current
submission supersedes. Keeping them public meant shipping documents that contradicted the
product, the landing page and the live submission at the same time, so they were moved out of
the public tree on 2026-08-16.

Nothing was destroyed: they remain in the working copy under `docs/private/superseded/` and in
this repository's git history.

The current roadmap lives in the [root README](../README.md), section *Status and roadmap*.
