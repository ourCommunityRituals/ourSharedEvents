# ADR-014: Ratify `ai-sanitization.ts` as the single sanctioned AI seam

**Status:** Accepted
**Date:** 2026-08-15
**Deciders:** mzdan + Co-Architect

## Context

OurSharedEvents makes a **free-forever** promise to churches and chosen
clients. That promise is not a pricing decision — it is a structural property
of the runtime: every served-user operation (create event, poster/QR render,
scan, SharedReport) is deterministic Cloudflare Workers compute and costs
**~0 model tokens**. Cost scales with cheap deterministic primitives, never
with per-operation token metering. The moment any runtime path makes a
per-request model call, a ~0-token operation silently becomes a token-metered
one, and the free-forever thesis stops being structurally sustainable.

COST-101 (OSE-770) shipped the mechanical guard for this: the
`runtime-llm-free.invariant.spec.ts` structural gate fails CI if any runtime
`.ts` under `workers/oursharedevents/src` imports a model-provider SDK or
references a model-provider API hostname. The gate carries an **allowlist of
exactly one file** — `src/lib/ai-sanitization.ts` (the dormant OSE-578
input-sanitization seam).

What COST-101 did **not** record is the _why_ behind that allowlist-of-one, or
what stops the single sanctioned entry from being quietly deleted, relocated,
or joined by a second entry. This ADR ratifies the seam as an architectural
contract and closes that governance gap (COST-102 / OSE-772).

The forcing functions:

- **Free-forever must be mechanically inviolable, not forbidden-by-decree.**
  We do not want to ban AI from the platform forever — a legitimate future
  feature (e.g. survey-response summarization) may need a model. We want AI to
  enter through **one reviewed door**, never through a silent import in an
  unrelated handler.
- **The cost posture must be a one-file audit.** "Does the runtime cost
  tokens?" must be answerable by reviewing a single sanctioned file, not by
  auditing every handler on every PR.
- **The seam's dormancy is the feature, not a smell.** `ai-sanitization.ts`
  is intentionally unused today. It is a pre-positioned, pre-reviewed choke
  point — a canary. Its presence means the first AI feature inherits a
  sanitizer and a review lock instead of inventing its own entry with neither.
- **Enforcement is mechanical, not vigilance-based.** Consistent with ADR-002
  (static-invariant gates as the load-bearing CI pattern) and the
  security-first bracket doctrine, the contract is enforced by CI + CODEOWNERS,
  not by hoping a reviewer notices.

## Decision

We ratify `workers/oursharedevents/src/lib/ai-sanitization.ts` as the **single
sanctioned AI seam**: the only place a model call may ever enter the OSE
runtime, and the only file allowlisted by the runtime-LLM-free invariant.

The contract has three mechanical parts, each already or now in place:

1. **Allowlist-of-one (COST-101, live).**
   `runtime-llm-free.invariant.spec.ts` allowlists exactly
   `lib/ai-sanitization.ts` and fails CI on any model-SDK import or model-API
   hostname in any other runtime path. Any future AI feature MUST route its
   model call through this seam, or the gate goes red.

2. **CODEOWNERS review-lock (COST-102, this ADR).**
   `.github/CODEOWNERS` names the seam file, the COST-101 invariant spec, and
   this ADR as security-owner-reviewed paths. A change that widens the seam,
   relaxes the invariant, or edits this decision cannot merge without an
   explicit security-owner review — it can never ride through under a
   broad default-owner rule.

3. **Governance contract test (COST-102, this ADR).**
   `tests/contract/ai-seam-governance.contract.test.js` asserts, on every PR,
   that all three parts remain wired: the seam file exists, the invariant still
   allowlists exactly one file, the CODEOWNERS lock is present, and this ADR
   exists and is Accepted. Deleting any leg of the contract turns CI red.

When the first real AI feature ships, the model call lands **inside** the seam
(with its own functional + red-team tests), the seam flips dormant → wired in
that same PR, and this ADR gains a superseding note only if the _architecture_
of the entry changes — not merely because the seam became active.

## Alternatives Considered

### Alternative A: Forbid runtime AI entirely — invariant with no allowlist

Keep the runtime-LLM-free invariant but allowlist nothing, so no runtime file
may reference a model at all.

**Rejected because:** it is too brittle. The first legitimate AI feature would
force a contributor to _delete the invariant wholesale_ to make room, throwing
away the guardrail at the exact moment it matters most. An allowlist-of-one
keeps the door **and** the lock: AI has a sanctioned path, and the cost guard
stays live around it. "One reviewed door" beats "no door until someone removes
the wall."

### Alternative B: Multiple entry points / per-feature seams

Let each AI feature declare its own sanctioned file and grow the invariant's
allowlist as features arrive.

**Rejected because:** it fragments the audit surface. The whole value of the
seam is that "does the runtime cost tokens?" is a one-file question. An
allowlist that grows to N files turns the cost posture into an N-file review on
every PR and multiplies the CODEOWNERS lock surface. If a second genuinely
independent entry is ever justified, that is a new decision deserving its own
ADR — not a default we bake in now.

### Alternative C: Delete the dead code

`ai-sanitization.ts` is unused today; delete it and re-add a sanitizer when an
AI feature actually needs one.

**Rejected because:** the seam's dormancy is precisely its value. Deleting it
means the first AI feature invents its own entry point — with no pre-reviewed
sanitizer, no CODEOWNERS lock, and no allowlist slot — under whatever schedule
pressure that feature ships. The pre-positioned choke point is a canary: it
exists so the guardrails are in place _before_ the first model call, not
scrambled together _after_ it. Dead-by-design here is a feature.

### Alternative D: Govern by convention and PR review alone

Document the "one seam" rule in the ADR and trust reviewers to enforce it,
without the CODEOWNERS lock or the contract test.

**Rejected because:** it is exactly the vigilance-based posture ADR-002 and the
security-first bracket doctrine exist to replace. A rule that lives only in a
doc is invisible to the contributor (human or agent) optimizing an unrelated
handler who adds `import OpenAI from 'openai'` without ever reading the ADR.
The lock + the contract test make the violation _fail CI_, which is the only
enforcement that survives contributor turnover and agent-authored PRs.

## Consequences

### Positive

- **Cost posture is a one-file audit.** The free-forever thesis is verifiable
  by reviewing a single sanctioned file plus a green invariant — not by
  auditing every handler.
- **AI has a reviewed on-ramp.** A future AI feature has an unambiguous,
  pre-sanitized, pre-locked place to enter. No design ambiguity, no
  scramble to add injection defenses after the fact.
- **The guard cannot silently regress.** Widening the allowlist, relaxing the
  invariant, deleting the seam, or removing the CODEOWNERS lock each turns CI
  red (contract test) and additionally requires a security-owner review
  (CODEOWNERS). Three independent legs, each mechanically enforced.
- **Prompt-injection defense is pre-positioned.** `sanitizeForAI()` /
  `sanitizeJsonForAI()` already neutralize known injection patterns, so the
  first model call inherits defense-in-depth rather than adding it late.

### Negative

- **The seam must stay maintained while dormant.** A file with no runtime
  caller still carries review weight and must keep passing lint/type checks.
  This is the acceptable carrying cost of a pre-positioned choke point.
- **The CODEOWNERS lock adds a review hop.** Changes to the seam, the
  invariant, or this ADR require a security-owner review even when the change
  is trivial. Deliberate: this class of file is where cost + injection posture
  is decided, so the friction is the point.

### Neutral

- The seam is a single small file (2 pure functions, no dependencies). Its
  presence has no runtime cost and no bundle impact until it is wired.
- Today's security owner for the seam is the solo founder (`@mzdano`); the
  CODEOWNERS lock is written against that handle. When a dedicated security
  team handle exists, the lock's owner is updated in a one-line CODEOWNERS
  edit — itself security-owner-reviewed under the same rule.

## Implementation Notes

- **Seam:** `workers/oursharedevents/src/lib/ai-sanitization.ts` (OSE-578) —
  `sanitizeForAI()`, `sanitizeJsonForAI()`; applied at read-time only, never
  mutates D1.
- **Invariant (allowlist-of-one):**
  `tests/e2e/0-architecture/runtime-llm-free.invariant.spec.ts` — `ALLOWLIST`
  = `{ 'lib/ai-sanitization.ts' }` (COST-101).
- **CODEOWNERS lock:** `.github/CODEOWNERS` — the AI-seam review-lock section
  (COST-102).
- **Contract test:** `tests/contract/ai-seam-governance.contract.test.js`
  (COST-102, L7 Contract) — runs under root `npm test` (vitest) in T0 Gate.
- **PR:** COST-102 / OSE-772.

## References

- COST-101 (OSE-770) — the runtime-LLM-free invariant this ADR ratifies the
  allowlist of
- COST-102 (OSE-772) — this decision (ADR + CODEOWNERS review-lock)
- OSE-578 — original AI input-sanitization seam
- [ADR-002](ADR-002-static-invariant-gates.md) — establishes static-invariant
  gates as the load-bearing enforcement pattern this decision applies
- `docs/cost-sustainability/BACKLOG.md` (monorepo) — the free-forever
  sustainability thesis and the M1/M2 cost-guardrail milestones
- Doctrine: security-first bracket (every flow opens S0 / closes S2) — the
  principle behind enforcing this contract mechanically rather than by review

## Revisit Criteria

- **When the first real AI feature ships** — the model call lands inside the
  seam with functional + red-team tests, and the seam flips dormant → wired in
  that PR. This ADR is superseded only if the _entry architecture_ changes, not
  merely because the seam became active.
- **If a second, genuinely independent AI entry is justified** — that is a new
  decision (Alternative B was rejected by default); write a superseding ADR
  that widens the sanctioned surface deliberately, with its own review.
- **When a dedicated security-owner handle replaces the solo founder** — the
  CODEOWNERS lock's owner is updated; no change to this decision, only to who
  holds the review.
