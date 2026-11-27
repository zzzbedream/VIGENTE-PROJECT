# Team

**Vigente is founder-led, and it is two people.** One person has written essentially all of
the code; one other person, the CTO, has contributed five commits plus design and review input.
Both hold equity in the project; the founder is the majority shareholder.

> **Correction — 25 November 2026.** Until today this document described three people,
> including a Commercial Lead, and said a commercial agreement with Etherfuse had been signed.
> Both were out of date or inaccurate. The team is two people. What exists with Etherfuse is an
> organisation approved in their sandbox, created by accepting their online terms; nothing has
> been signed for production.

That is a smaller claim than this document used to make, and it is the accurate one. The SCF
#41 review flagged execution risk for a solo builder, and the temptation is to answer it with
an org chart. A reviewer can check the real distribution in ten seconds:

```bash
git shortlog -sne --all
```

It prints four lines, because each contributor has committed under two name spellings — but
there are two people in that history, not four.

---

## Founder / Tech Lead

**zzzbedream** (GitHub handle; full name available on request to SCF reviewers under
confidentiality)

**Role:** Architecture, Soroban smart contracts, oracle integration, technical product
direction.

**Responsibilities in this grant:**
- Lead developer on the `margin-controller`, `oracle-aggregator` and `vigente-badge` contracts.
- Owner of testnet and mainnet deployments.
- Final technical authority on architectural decisions.
- Primary contact for SCF reviewers on technical questions.

**Background:**
- Self-taught full-stack engineer focused on Rust, TypeScript and blockchain.
- Built Vigente from inception — hackathon MVP through the current resubmission.

**Verifiable:** primary git author across `contracts/`, `web/` and `docs/`. The deployed
contracts, the isolated Blend pool and the credit cycle in
[`../audit/08_POOL_ACTIVATION.md`](../audit/08_POOL_ACTIVATION.md) are the substantive record.

---

## CTO — Christian Pérez de Arce

**Role:** Backend and integrations, testing, UX engineering. Appointed CTO in August 2026.

**Contribution to date:** five commits in the repository history, the last on 1 September 2026,
plus design and review input that does not appear as authorship. We are not going to describe
that as co-development of the protocol, because it isn't.

**Scope:** frontend and integration surfaces, test-suite expansion, and the fiat ramp client —
a sandbox client exists today; the production client is not built.

**Compensation:** equity.

---

## What the grant actually funds on the team side

Not a team that already exists at full capacity — **the hours to build one**. The honest
version of the response to "solo-developer execution risk" is: the risk is real, the answer so
far has been to ship verifiable infrastructure rather than argue about it, and the grant pays
for contributor hours rather than backfilling an org chart.

## Practices

- **Communication:** async-first through the repository (issues, PRs) plus project chat, with a
  weekly sync.
- **Technical decisions:** the founder has final authority.
- **Commercial decisions:** the founder.
- **Financial decisions** (grant disbursement, contractor hiring): the founder, as majority
  shareholder.
- **Conflict resolution:** documented discussion in repository issues. There is no external
  arbitrator; the team is small enough that adding one now would be theatre.

## Advisors

None today. The intent is to add one or two technical advisors for independent contract review
before mainnet. **No advisor arrangement — compensation or otherwise — currently exists**, and
none is included in the SCF budget.

---

## How to verify any of this

- `git shortlog -sne --all` — the real authorship distribution.
- LinkedIn profiles and CVs available to SCF reviewers under confidentiality.
- A video call with the team, on request.

If something in this document does not match what you can check, the checkable thing is right
and we want to hear about it.

---

*Last updated: 2026-11-25*
