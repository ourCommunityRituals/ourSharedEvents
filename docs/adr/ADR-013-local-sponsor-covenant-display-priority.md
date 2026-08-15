# ADR-013: Enforce the Local Sponsor Covenant via display-priority sort, not a slot allocator

**Status:** Superseded by OSE-661 / OSE-663 (share-of-voice frequency-floor covenant, Brain Invariant #25 — ratified 2026-08-08)
**Date:** 2026-05-18
**Superseded:** 2026-08-08
**Deciders:** mzdan + Co-Architect

> **⚠️ SUPERSEDED (2026-08-08) — do not implement the decision below.**
>
> The decision in this ADR — a two-level **locals-first display-priority sort**
> (`sponsor-resolver.ts::tierSort()`, Brain Invariant #5) — has been replaced.
> Under the ratified **Sponsor Share Covenant** (Brain Invariant #25; OSE-661
> rotation + OSE-663 allocation math), the local guarantee is a
> **rotation-frequency FLOOR**, not a rank: the `is_local` class collectively
> holds ≥ `local_floor_pct` of rotation share via `allocateShares()`, and a
> premium non-local may legitimately be _seen more often_ than any single local
> so long as the local class holds its floor and no tier exceeds its cap.
> `tierSort` is **retired** (its retirement is now locked by
> `tests/e2e/0-architecture/tier-equity.invariant.spec.ts`). Rotation order is
> produced by `buildShareRotation()` — sorted by share, then a deterministic
> `id` tie-break — and carries **no** slot/size/position meaning.
>
> The historical decision, alternatives, and consequences are preserved below
> for context. Current source of truth: `src/lib/sponsor-allocation.ts`,
> `src/lib/sponsor-resolver.ts` (`buildShareRotation`), and
> `tests/sponsor-share-rotation.spec.ts`.

## Context

The Local Sponsor Covenant is the OurSharedEvents brand promise that
distinguishes the platform from a generic sponsor ad network:

> A sponsor matching platform that pushes the highest bidder to the
> top is a standard ad network. OSE's covenant — that the local stays
> in — is the differentiating brand promise that creates the local-
> economy flywheel.

Brain Invariant #5 (`tier_equity`, "Local Sponsor Covenant") captures
this as an architectural commitment: a local sponsor's display
position MUST NOT be displaceable by a higher-tier non-local sponsor's
payment. Tier breaks ties WITHIN a locality group, never ACROSS it.

OSE-330 Phase 1 (OCR-docs PR #53, merged 2026-05-18) shipped the
brain side: a new canonical artifact at
`OCR-docs/ocr-docs-brain/sponsor-allocation.yaml`, an upgraded
Invariant #5 (planned → partial), and a Level 2 brain schema check
that validates the new artifact's structure. Phase 1 also flipped
Invariant #5's `depends_on` from the orthogonal `tier-gates.yaml`
(pricing tiers — a different axis) to `sponsor-allocation.yaml`
(locality classification).

What was open before this ADR is **how** the OSE substrate
mechanically enforces the covenant. The current sponsor resolver
(`workers/oursharedevents/src/lib/sponsor-resolver.ts`) returns ALL
qualifying sponsors for an event and the surface filters down by
placement format. There is no slot cap today — every qualifying
sponsor appears on every surface they opt into. The covenant
therefore cannot be enforced by "reserve N slots for locals" logic
because there are no slots to reserve.

The forcing functions:

- **Brand promise must be mechanically inviolable.** A future
  contributor (human or agent) "optimizing" the sort back to
  tier-only must be caught by CI, not by code review alone. The
  covenant is the kind of architectural promise that earns its weight
  by being enforceable, not by being documented.
- **Backward compatibility for existing sponsors.** All sponsors
  shipped before this PR have no `is_local` field. They must continue
  to sort exactly as they did pre-OSE-330 — tier-only — until an
  admin actively marks one as local. This is non-negotiable: the
  covenant kicks in for events that have at least one local sponsor;
  events with zero locals MUST behave identically to today.
- **Two-axis orthogonality.** `is_local` is a classification axis
  orthogonal to `tier`. A sponsor can be `is_local=1` AND
  `tier='platinum'` simultaneously. The data model must not collapse
  these axes (the founder's "Two-Axis Tier Model" memory entry
  documents this rule at the ecosystem level — sponsor pricing tier
  vs flag presets, never merge).
- **No speculative slot-cap surface today.** The current resolver
  has no top-N selection step. Building a slot allocator now would
  require a consumer that doesn't yet exist. The canonical
  `slot_floor` config in `sponsor-allocation.yaml` is scaffolded
  (status: `scaffolded`) for the future surface that adds capping;
  today's enforcement is purely about sort order.

## Decision

We enforce the Local Sponsor Covenant via **display-priority
two-level sort** in `sponsor-resolver.ts::tierSort()`:

1. **Level 1 (the covenant):** `is_local=1` sponsors sort before
   `is_local=0` sponsors. No interleaving. No tier value on either
   side can cross this boundary.
2. **Level 2 (tie-break):** within each locality group, the existing
   tier priority (`title > platinum > gold > silver > bronze >
primary`) breaks ties.

Concretely, this PR ships:

- **Migration `0036_add_is_local_to_sponsors.sql`** — adds
  `is_local INTEGER NOT NULL DEFAULT 0` to the `sponsors` table plus
  an index. SQLite-safe ALTER TABLE ADD COLUMN with DEFAULT.
  Backward-compatible: all existing rows get `is_local=0`.
- **`src/lib/sponsor-allocation.ts`** — manually-synced TS module
  mirroring `OCR-docs/ocr-docs-brain/sponsor-allocation.yaml` per
  ADR-012's build-time-consumption pattern. Exports the typed
  canonical, plus `isSlotFloorActive()` and `getLocalFloor(surface)`
  helpers for the future slot-cap consumer.
- **`src/lib/sponsor-resolver.ts` upgrade** — `SponsorRow.is_local`
  field added, `tierSort()` upgraded to the two-level sort, header
  docstring extended with the Local Sponsor Covenant section
  referencing brain Invariant #5 + ADR-013 + the canonical YAML.
- **`tests/e2e/0-architecture/tier-equity.invariant.spec.ts`** —
  Playwright structural invariant (reads source files via fs, asserts
  code shape). 6 tests:
  - `SponsorRow` interface declares `is_local`
  - `tierSort` checks `is_local` BEFORE `TIER_PRIORITY`
  - `sponsor-allocation.ts` consumed copy exists with required
    exports
  - Migration 0036 exists and uses `DEFAULT 0`
  - Resolver header references the Covenant + Invariant #5
  - Brain canonical YAML is cited as source of truth in the
    consumed copy
- **`workers/oursharedevents/tests/tier-equity-sort.spec.ts`** —
  vitest functional invariant (seeds D1, hits the public sponsors
  endpoint, asserts sort order). 7 tests covering the covenant in
  one sentence, within-group tier sort, mixed 4-sponsor order, all-
  local backward compat, all-non-local backward compat, and
  NULL-`is_local` defensive treatment.

Together, the two test files form the structure + behavior pair: the
Playwright spec proves the contract STRUCTURE is in place; the
vitest spec proves the contract BEHAVIOR holds for synthetic inputs.

The brain canonical's `slot_floor.status: 'scaffolded'` reflects
that no consumer enforces the per-surface caps today. When a future
surface (e.g., TV-cycle picker with N rotation slots) adds a top-N
selection step, that consumer will branch on `isSlotFloorActive()`
and use `getLocalFloor()` to enforce the configured floor. The
status flip to `'active'` happens in the same PR that lands the
first consumer — not now.

## Alternatives Considered

### Alternative A: Build a slot allocator now

Ship a function `allocateSlotsWithLocalFloor(sponsors, surface,
cap)` that picks the top-N sponsors with a guaranteed minimum
local count, and refactor existing resolvers to call it.

**Rejected because:** there is no consumer today. The current
surfaces have no slot cap — every qualifying sponsor displays. A
slot allocator with no caller is speculative architecture; it
ships untested in production code paths. The brain canonical
already documents the future contract via the `slot_floor` block
(scaffolded status). When a real consumer arrives, the allocator
ships in the same PR with that consumer (single concrete shape, no
guessing). The covenant itself is fully enforceable today via
sort order alone, because sort order IS what displays.

### Alternative B: Tier-level local boost (e.g., `is_local` adds a tier-priority modifier)

Treat `is_local` as a numeric boost added to `TIER_PRIORITY` (e.g.,
`-100` for locals, shifting them above all non-locals in the same
priority math).

**Rejected because:** it collapses the two-axis orthogonality the
founder's Two-Axis Tier Model memory explicitly forbids. A "boost"
makes the covenant look like a tier modifier — when in fact it's a
group separator. A future contributor reading "locals get -100 in
the tier math" would reasonably ask "could a platinum-tier non-local
buy a `-200` upgrade?" — which is exactly the kind of question the
covenant exists to make unaskable. The two-level sort makes the
group boundary explicit and uncrossable.

### Alternative C: Per-surface allocation logic embedded in the resolver

Embed `local_floor` enforcement directly in `buildSponsorBundle()`,
applying the brain canonical's surface-specific floors when
constructing each surface's sponsor list.

**Rejected because:** `buildSponsorBundle()` doesn't have a slot
cap to enforce a floor against today. Same root issue as
Alternative A — the brain config's per-surface floors are
genuinely future-state scaffolding. Embedding logic that always
sees `cap: null` is dead-code-by-construction. Better: keep the
canonical config typed and accessible, ship the active enforcement
(display-priority sort) now, and let the floor enforcement code
land WITH its first consumer.

### Alternative D: Defer enforcement until the admin UI exists

Wait to ship the resolver upgrade until OSE-334 (admin UI for
marking sponsors local) and OSE-335 (sponsor onboarding flow with
`is_local` question) are also ready.

**Rejected because:** the enforcement mechanism is the
load-bearing piece; the UI is the user-facing piece. They can ship
independently. Shipping enforcement first means: (a) the moment an
admin manually flips a row's `is_local` value via D1 console or
SQL, the covenant kicks in correctly; (b) the brain ↔ substrate
contract is closed and Invariant #5 can flip partial → live; (c)
the admin UI story has a tested foundation to build on, not a
proposal to validate against. Splitting these into separate PRs
also keeps each PR reviewable.

## Consequences

### Positive

- **Mechanically inviolable covenant.** A primary-tier local
  appears BEFORE a platinum-tier non-local. This is asserted at
  three layers — the resolver code itself (`tierSort` body), the
  Playwright structural invariant (sort order in source matches the
  covenant), and the vitest functional invariant (seeded sort order
  matches the covenant under adversarial inputs). Any future change
  that violates the covenant fails CI.
- **Two-axis orthogonality preserved.** `is_local` and `tier` are
  independent dimensions in both the schema and the sort logic. The
  founder's Two-Axis Tier Model rule is mechanically respected.
- **Backward-compatible.** Existing events with no local sponsors
  sort exactly as they did pre-OSE-330. Migration 0036 defaults
  `is_local=0`, and the `aLocal !== bLocal` branch is skipped when
  all sponsors share the same locality group, falling through to
  the existing tier sort.
- **Slot-floor scaffolding ready.** Future surfaces that add top-N
  selection have a typed canonical config to consume
  (`getLocalFloor()`) and an active/scaffolded flag
  (`isSlotFloorActive()`) — no design ambiguity when the first
  consumer arrives.
- **Brain ↔ substrate contract complete.** Phase 1 (brain) + Phase 2
  (substrate enforcement) close the loop. Invariant #5 becomes
  flippable from `partial` → `live` in a small follow-on brain PR
  once this ships on staging.
- **Brand promise becomes contributor-visible.** The resolver
  header now names the Covenant + Invariant #5 + the canonical
  YAML. A new contributor reading `sponsor-resolver.ts` learns
  WHY the sort is two-level before they can change it.

### Negative

- **Sponsor data MUST be classified to benefit.** Until admins
  start flipping `is_local=1` on real sponsor rows, the covenant
  has no live data to enforce against. OSE-334 (admin UI) and
  OSE-335 (onboarding flow) close that gap; until then, manual
  D1 updates or SQL are the operational paths. This is the
  acceptable cost of shipping enforcement first.
- **Drift risk on the consumed copy.** Until OSE-336 extends the
  OSE-323-pattern drift check to cover
  `sponsor-allocation.yaml` ↔ `sponsor-allocation.ts`, divergence
  between the brain canonical and the OSE consumed copy is
  PR-review-gated only. OSE-336 is the hard mitigation; the
  consumed copy's header explicitly names this risk.
- **No active slot-floor enforcement today.** A surface that
  eventually adds slot capping must be the one to flip
  `slot_floor.status` to `active` and route through
  `getLocalFloor()`. Until then, the canonical YAML's per-surface
  floors are scaffolded, not authoritative. This is deliberate
  (Alternative A rationale), but worth naming so the
  scaffolded → active transition isn't surprising when it arrives.

### Neutral

- The `tierSort` function gains 5 lines (one comparison + comment).
  Performance impact is sub-microsecond per sort and the sort runs
  once per resolver call.
- The migration adds one column + one index to the `sponsors`
  table. Net schema cost is negligible at expected scale (sponsors
  is a low-cardinality table).
- The brain canonical's `local_floor` values (posterTop=1, tvTop=1,
  tvSide=2, mobileBanner=0) are documented in the YAML's
  `rationale` field per surface. These are the founder's calibrated
  starting points and may evolve as real surface data accumulates;
  the canonical is the editable source of truth when they do.

## Implementation Notes

- **Brain canonical:** `OCR-docs/ocr-docs-brain/sponsor-allocation.yaml`
  (OSE-330 Phase 1 / PR #53)
- **Brain invariant:** `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`
  entry #5 `tier_equity` (rich form, partial status; flips to live
  after this PR + staging verification)
- **Migration:** `workers/oursharedevents/migrations/0036_add_is_local_to_sponsors.sql`
- **OSE consumed copy:** `workers/oursharedevents/src/lib/sponsor-allocation.ts`
- **Resolver upgrade:** `workers/oursharedevents/src/lib/sponsor-resolver.ts`
  — `SponsorRow.is_local` field + two-level `tierSort()`
- **Tests:**
  - Structural (Playwright): `tests/e2e/0-architecture/tier-equity.invariant.spec.ts`
  - Functional (vitest): `workers/oursharedevents/tests/tier-equity-sort.spec.ts`
- **Linear:**
  - This story: OSE-330 (Local Sponsor Covenant — substrate enforcement)
  - Follow-on: OSE-334 (admin UI), OSE-335 (sponsor onboarding flow),
    OSE-336 (drift check extension to sponsor-allocation.yaml)

## References

- [ADR-001](ADR-001-anonymous-identity-architecture.md) — establishes
  the brain ↔ substrate pattern this ADR specializes
- [ADR-002](ADR-002-static-invariant-gates.md) — establishes the
  static-gate enforcement pattern the Playwright structural test
  applies
- [ADR-010](ADR-010-templates-breadth-tiers-depth.md) — establishes
  the orthogonality between sponsor classification and sponsor
  pricing tier that this ADR extends with the locality axis
- [ADR-012](ADR-012-uec-build-time-consumption.md) — establishes the
  manually-synced TS module pattern that
  `src/lib/sponsor-allocation.ts` follows
- Brain invariant #5 `tier_equity` (rich form, partial → live
  pending this PR) — full enforcement chain documented in
  `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`
- Brain canonical `sponsor-allocation.yaml` — load-bearing config
  for the covenant + future slot-floor enforcement

## Revisit Criteria

- **When the first slot-cap surface ships** (TV-cycle picker, paid
  ad rotation slots, etc.) — that consumer flips
  `slot_floor.status` to `active`, lands the allocator that
  consumes `getLocalFloor()`, and exercises the per-surface floors.
- **If a regulatory tier (HIPAA, COPPA) requires sponsor data
  segregation that the locality axis intersects with** — the
  two-axis orthogonality may need extension; revisit how `is_local`
  composes with regulatory pool routing.
- **If a brand contract evolves beyond "locals first"** (e.g., a
  per-event-author "preferred local list" with explicit ordering)
  — the two-level sort becomes a three-level sort, and the
  canonical YAML grows a new level above `display_priority.rule`.
- **If the manual-sync drift between
  `sponsor-allocation.yaml` ↔ `sponsor-allocation.ts` is
  consistently caught in practice** — that's the signal that
  OSE-336's drift check is necessary load-bearing infrastructure
  rather than nice-to-have polish.
