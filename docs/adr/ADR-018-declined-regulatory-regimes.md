# ADR-018: Declined regulatory regimes — HIPAA / COPPA / SOPPA refuse, not route

**Status:** Accepted
**Date:** 2026-09-10
**Deciders:** Matthew Zdano (PO); founder-ratified standard (`OCR_STANDARD_declinedRegimes.md`, 2026-09-04)

> Documentation-only reconciliation (CCR continuity finding F2, OSE-1285). The
> decision was made and shipped on OSE-1220 (code PR #514, brain PR #122); this
> ADR records the long-form _why_ that the code comments and the Linear ticket
> assumed but no ADR captured. It also carries the supersession-of-routing notes
> now annotated on ADR-001 and ADR-009.

## Context

OSE's regulatory posture was originally modelled as a **five-phase maturity
ladder** (`docs/REGULATORY-PHASES.md`, ADR-009 growth waves): Phase 1–3 are
community / commerce / licensed events OSE serves today, and Phases 4 (HIPAA)
and 5 (COPPA, later widened to include SOPPA student data) were framed as
higher rungs OSE would _climb to_ once the compliance infrastructure — BAAs, PHI
handling, verifiable parental consent, student-record boundaries — was built.
ADR-001 encoded the same assumption in code: `pool-contract.ts` declared
`REGULATORY_POOLS = ['general', 'hipaa', 'coppa']` and `phaseToPool()` _routed_
tier 4 → `hipaa` and tier 5 → `coppa`, forwarding those exports to dedicated
BigQuery datasets. The brain modelled it too: `ocr-docs-brain/bigquery-schemas/`
carried `hipaa.json` (BAA identifiers, `phi_classification: direct`, a PHI access
audit log) and `coppa.json` (parental-consent batches, `age_group: under_13`).

A 3-loop CCR (`OCR-docs/docs/ccr/OCR_CCR_clearanceAxisCollision_2026-09-04.md`)
found the ladder framing was not merely aspirational — it was a **live latent
exposure**. The path from "all real event types are tier 1, everything routes to
`general`" to "exports land in a PHI/consent dataset" ran entirely through
non-code changes:

1. Migration 0057 already named `school_event` as a Phase 5 type.
2. `ALLOWED_MAX_TIER` was an **env config value** (`resolveAllowedMaxTier`) — a
   deploy-time setting, not a PR. Raising it required no code review.
3. `phaseToPool()` would then route those exports to `oureventring_hipaa` /
   `oureventring_coppa`, datasets whose schemas expect BAA and parental-consent
   records OSE never intended to collect.

The exposure was "one env var away, not one PR away." Meanwhile the founder
ratified `OCR_STANDARD_declinedRegimes.md` (2026-09-04; SOPPA added 2026-09-10),
stating plainly that hospital PII and COPPA under-13 child data — parental-
clearance mechanics included — are **off the books**. There is no roadmap on
which OCR acquires them.

The two artifacts were in direct contradiction: the doctrine declined regimes
the architecture was one config value away from routing into. This ADR records
the decision that resolves the contradiction — made and enforced on OSE-1220.

## Decision

**HIPAA, COPPA, and SOPPA are _declined regimes_ — regimes OSE structurally
refuses to enter, not tiers it matures into. The regulatory ladder is capped at
tier 3, and refusal is enforced by construction, not by policy or config.**

The refusal is made structural at four independent layers, so that no single
edit — and in particular no env-config change — can reopen the path:

1. **Refuse, don't route.** `phaseToPool(4|5)` throws `PoolRoutingError` rather
   than returning `'hipaa'` / `'coppa'`. This reuses the function's existing
   fail-closed shape (it already threw on out-of-range and malformed input), so
   a declined tier is refused for the same structural reason a garbage tier is:
   there is no pool to route to, so the function _cannot_ produce one.
   (`src/lib/pool-contract.ts`.)

2. **Narrow the pool declaration.** `REGULATORY_POOLS = ['general']` for OSE. A
   product must not declare pools it will never fill. `BIGQUERY_DATASETS` carries
   `general` only — the declined-regime datasets are deliberately absent, so
   there is no dataset name to route to even in principle. Brain conformance
   (`check_brain_contract.py`) verifies the narrowed list against the registry.

3. **Cap the ceiling as an invariant, not a config.**
   `resolveAllowedMaxTier()` **clamps** its result to
   `DECLINED_REGIME_MAX_TIER = 3`. Even `ALLOWED_MAX_TIER=5` resolves to 3 — the
   declined tiers are unreachable through config. The launch default
   (`LAUNCH_MAX_CLEARANCE_TIER = 1`) remains a raisable knob _within_ the tier
   1–3 band; the tier-3 cap is not raisable at all. (`src/lib/template-clearance.ts`.)

4. **Fail the build loudly on any regression.** A CI gate
   (`scripts/guard-declined-regimes.js`, self-tested by
   `scripts/guard-declined-regimes.test.js`) fails the build if `ALLOWED_MAX_TIER`
   is set above 3 or if a migration seeds a tier-4/5 event type. The
   misconfiguration is caught before merge, not discovered at runtime.

On the brain side (OCR-docs PR #122), `hipaa.json` and `coppa.json` are marked
`status: declined` with a pointer to the standard, so they read as records of
refusal rather than roadmap commitments.

**Declining costs OSE no business, because OSE tracks the item, not the
participant.** A rec-centre youth league, a library summer-reading programme, a
school activity, and a health-adjacent gathering are all servable in the
`general` pool: OSE records the event / venue / corridor by week; the institution
holds the roster, the enrolment, and the consent. A child-, student-, or
health-adjacent context therefore produces `general`-pool data — no age bracket,
no consent batch, no student record, no PHI. **Declining HIPAA is not declining
hospital business:** OSE may serve health-adjacent venues, but handles no PHI and
signs no BAA. If an engagement _requires_ HIPAA/BAA or verifiable parental
consent, there is no business — by decision, not by limitation.

## Alternatives Considered

### Alternative A: Keep routing; gate the ceiling with config + review discipline (the status quo)

Leave `phaseToPool()` routing 4→hipaa / 5→coppa and rely on `ALLOWED_MAX_TIER`
staying at 1 plus code review to catch tier-4/5 seeds.

**Rejected because:** this is exactly the exposure the CCR flagged. `ALLOWED_MAX_TIER`
is a deploy-time env value, not a reviewed code change, and migration 0057 had
_already_ named a Phase 5 type. The danger was one config value away. Review
discipline is not an enforcement layer at solo-developer scale (the same reason
ADR-001 and ADR-002 chose static gates over review). A declined regime must be
unreachable by construction, not merely un-selected by current config.

### Alternative B: Delete the HIPAA/COPPA schemas and Phase 4/5 sections entirely

Remove `hipaa.json` / `coppa.json` from the brain and delete the Phase 4/5
sections from `REGULATORY-PHASES.md`, erasing the declined regimes from the
record.

**Rejected because:** the historical record has value. A future contributor who
finds no trace of HIPAA/COPPA cannot tell whether the regimes were _considered
and declined_ or simply _never thought about_ — and might re-propose them. We
chose to **mark** rather than **erase**: schemas carry `status: declined` with a
pointer to the standard, and the Phase 4/5 sections are retained explicitly "as
a record of what is refused." The refusal is louder when it is visible.

### Alternative C: Build the compliance infrastructure and climb the ladder

Treat Phases 4/5 as genuine roadmap: build BAA generation, PHI-grade
anonymization, verifiable parental-consent flows, and FERPA boundaries, then open
the regimes.

**Rejected because:** the founder ratified that these regimes are off the books —
there is no roadmap on which OCR acquires them. The engineering cost is large
(FTC "verifiable" consent is not a checkbox; PHI handling implies BAA liability),
and item-tracking already serves the _adjacent_ business in the `general` pool
without incurring any of it. Building the ladder would be building capability the
company has decided not to offer.

## Consequences

### Positive

- **The declined regimes are unreachable by construction.** No env value, no
  migration, and no single code edit can route an export into a PHI or
  parental-consent dataset — each of the four layers independently blocks it, and
  the CI gate turns the attempt red before merge.
- **The doctrine and the architecture now agree.** `OCR_STANDARD_declinedRegimes.md`
  said "off the books"; the code now makes that true structurally. The ADR record
  no longer contradicts the ratified standard.
- **No business is lost.** Item-tracking serves health-/child-/student-adjacent
  venues in `general`. The refusal removes liability (no BAA, no PHI, no student
  records), not revenue.
- **The refusal is auditable and testable.** `phaseToPool(4)`/`phaseToPool(5)`
  throwing is a unit test; the ceiling clamp is a unit test; the gate is
  self-tested. "We decline these regimes" is a proposition CI proves on every PR.

### Negative

- **Raising the ceiling above tier 3 is now deliberately a multi-layer change.**
  If OCR ever reverses the founder's standard, re-opening a regime is not a config
  flip — it requires editing `DECLINED_REGIME_MAX_TIER`, widening `REGULATORY_POOLS`,
  restoring `phaseToPool` routing, un-declining the brain schemas, and updating the
  gate. This friction is intentional (see Revisit Criteria) but real.
- **Ongoing discipline at the tempting sites.** Nobody may "helpfully" restore a
  4→hipaa branch in `phaseToPool` or add a declined pool back to `REGULATORY_POOLS`.
  The rule is restated in each file's comments so the temptation is met with the
  reason at the point of edit.

### Neutral

- **Phases 4/5 remain documented, as records of refusal.** `REGULATORY-PHASES.md`
  keeps the sections behind a ⛔ banner. Readers see what was declined and why, not
  a blank where a regime used to be.
- **Health-adjacent and youth-adjacent events still happen on OSE** — they simply
  produce `general`-pool data. The decline is about the _data regime_, not about
  the _event category_.

## Implementation Notes

- **Code:**
  - `workers/oursharedevents/src/lib/pool-contract.ts` — `phaseToPool` refuses
    4/5 (`PoolRoutingError`); `REGULATORY_POOLS = ['general']`; `DECLINED_REGIMES`;
    `BIGQUERY_DATASETS` (general only).
  - `workers/oursharedevents/src/lib/template-clearance.ts` — `DECLINED_REGIME_MAX_TIER = 3`;
    `resolveAllowedMaxTier()` clamps to it.
- **CI gate:** `scripts/guard-declined-regimes.js` (self-tested by
  `scripts/guard-declined-regimes.test.js`) — fails on `ALLOWED_MAX_TIER > 3` or a
  seeded tier-4/5 event type.
- **Docs:** `docs/REGULATORY-PHASES.md` (⛔ declined-regimes banner + Phase 4/5
  sections retained as records of refusal).
- **Brain:** `OCR-docs/ocr-docs-brain/bigquery-schemas/{hipaa,coppa}.json`
  (`status: declined`); `product-registry.yaml` → `ose` → `regulatory_pools: [general]`.
- **PRs:** #514 (OSE enforcement half), OCR-docs #122 (brain half).

## References

- Linear: OSE-1220 (enforce declined regimes — the decision record and shipped
  change), OSE-1285 (this ADR / CCR finding F2), OSE-380 & Invariant #4
  (fail-closed pool routing).
- Standard: `OCR-docs/docs/standards/OCR_STANDARD_declinedRegimes.md` (founder-
  ratified 2026-09-04; SOPPA added 2026-09-10).
- CCR: `OCR-docs/docs/ccr/OCR_CCR_clearanceAxisCollision_2026-09-04.md` (the
  "one env var away" finding).
- Prior ADRs: **ADR-001** (anonymous-identity / two-DB separation — its
  regulatory-_routing_ layer is superseded by this ADR; the two-DB separation
  stands), **ADR-009** (NCR v2 hierarchy — its COPPA/HIPAA growth-wave on-ramps
  are superseded by this ADR; the hierarchy + corridor model stand).
- Feature doc: `docs/REGULATORY-PHASES.md`.

## Revisit Criteria

This is a **doctrine-level refusal**, not an engineering trade-off. The only
trigger that reopens it is the **founder rescinding `OCR_STANDARD_declinedRegimes.md`**.
Absent that, this decision is a floor: technical convenience, a customer request,
or a raised launch ceiling are explicitly _not_ grounds to route into a declined
regime. If the standard is ever rescinded, a new ADR must supersede this one and
walk back all four enforcement layers deliberately — the decline must be
un-made in the open, never eroded by a config value.
