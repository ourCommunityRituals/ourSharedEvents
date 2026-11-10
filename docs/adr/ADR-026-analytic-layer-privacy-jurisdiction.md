# ADR-026: Put the analytic layer under its own privacy control; ADR-014 and COST-101 do not reach it

**Status:** Proposed (2026-11-10). The owner approved building rule B on 2026-11-10, and it is built (see Enforcement). Rules A, C and D still need the owner's acceptance and are not built.
**Date:** 2026-11-10
**Deciders:** Owner (PO)
**Ticket:** OSE-1946

## Context

The fleet has one AI invariant. COST-101
(`tests/e2e/0-architecture/runtime-llm-free.invariant.spec.ts`), ratified by ADR-014, keeps every
model SDK and model API out of `workers/oursharedevents/src`, apart from one dormant seam. It governs
the Worker's cost and its injection posture. **It says nothing about the analytic layer**: the
BigQuery dataset `oureventring_general` that OSE exports to, and that ourEventRings (OER) is meant to
read as a RAG. Invariant 17 (`oer_emission_boundary`) governs what OSE _emits_ (corridor grain,
floors), not who reads it or what they may combine.

Nothing reads the dataset today. The `ourEventRings` repository holds an empty README (`989feea`), so
the only readers are people with GCP access. The exposure is latent, and this ADR sets the rule
before the first reader is built.

The analysis `.claude/outputs/OSE-1946-ANALYTIC-LAYER-QUERY-BOUND-2026-11-10.md` (PR #1166) works the
problem against the four tables OSE exports today. Its findings, each re-derivable from scripts in the
file:

1. **There is no query surface to budget.** The dataset is a publication, and one read returns every
   snapshot ever exported. What limits a reader is the export cadence (corridor baseline daily,
   corridor returns weekly), not a query count.
2. **A reader of the dataset alone** cannot rebuild a count under K from one snapshot. Across daily
   snapshots the fixed rounding leaks presence bits: someone attended event E.
3. **A reader who can also forge scans** (the organizer probe; the cookie is still unsigned, OSE-1496)
   rebuilds an exact count under K in ⌈log₂ K⌉ snapshots. That is 3 weeks for a returns group and
   4 days for a baseline bucket. No deterministic rule prevents it.
4. **A reader who holds one event's SharedReport and the dataset** rebuilds an exact count under 5 for
   another event from **one** snapshot in 8% of cases, and narrows it below "fewer than 5" in another
   72%. The cause is that the SharedReport publishes an event's sample size exactly while the export
   rounds a group containing the same people. Rounding both still leaks the presence bit in 40% of
   cases. Building the group only from published parts leaks in none.

## Decision (proposed)

1. **Jurisdiction.** The analytic layer (every dataset OSE writes, and every consumer of it) is
   governed by this ADR. ADR-014 and COST-101 do not reach it, and nothing in this ADR loosens them.
2. **Rule A: who may see dataset values.** No dataset value reaches anyone who can create an event,
   place or scan a QR, or read a SharedReport (organizers, sponsors, brand admins, the public). That
   covers a raw row, a cell, an OER answer and anything derived from a cell. Until rule C exists, the
   dataset's readers are internal and named. Findings 3 and 4 make this rule necessary, not optional.
3. **Rule B: export groups are built from published parts.** An exported count group sums only parts
   that are themselves published under the floor, which is the `floorTotalOfParts` rule the
   SharedReport already uses for its own totals. An event whose own figure is withheld adds nothing to
   any exported group. This closes finding 4 at the source, whatever happens to rule A.
   **The gate counts the rows the group sums.** The corridor baseline sums every row of an event,
   as the SharedReport's `sample_size` does, so it gates on every row. The returns export sums only
   rows hashed under the current pepper and seen in its window, so it gates on those. That subset
   at K or more implies the report publishes the event too, and no part under K enters a group
   while retired-pepper rows wait to be purged. Rule B also applies inside the SharedReport, where
   `this_event_count` is exact and `baseline_90d` is rounded.
   **Residual:** rule B removes withheld events from groups. It does not stop two _published_
   events from being compared: an exact count beside a rounded group that holds both still narrows
   how many people the two share. Rule A, and rule C before any outward-facing consumer, cover that.
4. **Rule C: noise before any outward-facing consumer.** A consumer that would show dataset-derived
   figures to anyone covered by rule A needs noise on those figures first, under the D5 spike's
   conditions (sealed periods, figures that never change once published, every total derived from the
   noisy values). The privacy budget is the owner's epsilon choice, shared with OSE-1780.
5. **Rule D: fewer snapshots.** Export the corridor baseline once per sealed week, not daily. This
   slows finding 2 (and finding 3, from 4 days to 4 weeks). It does not stop them, and it is no
   substitute for rule C.
6. **Query budgets are not a control for this layer.** They become relevant only if an interactive
   query surface is built (OSE-1150), and must then be decided in their own ADR.

## Alternatives considered

### A query budget on OER

**Rejected for the current layer:** there are no queries to count. One read returns every snapshot.

### Differential privacy on everything now

**Deferred, not rejected.** It is the only control that bounds finding 3, but it changes the promise
("exact at 5 or more") and depends on the owner's epsilon. Rule C makes it the condition for any
outward-facing consumer instead of a precondition for the internal layer.

### A restricted query surface that forbids the combinations that compose

**Folded into rules A and B.** For a materialized publication, restricting what is emitted and who
may read it is the restricted surface.

## Consequences

### Positive

- The control sits on the right side of the boundary. Today's invariant guards the Worker, and the
  risk is in the reader.
- Rule B removes a single-snapshot breach of invariant 2 that needs no injection.
- The rule exists before OER does, so OER is built to it rather than retrofitted.

### Negative

- Rule A delays any feature that shows OER output to organizers or sponsors until rule C exists.
- Rule B lowers some exported group values (withheld events no longer count toward them), so the
  dataset under-counts small corridors.
- Rule D makes the baseline in the dataset up to a week old.

## Enforcement (each gate must be watched failing first)

| Rule     | Gate                                                                                                                                                                                                                                                                                                                                | Where                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| B        | Built, each test seen red before the fix. Export: 11 + 4 exports as 10, not 15; K itself counts (11 + 5 is 15); no one is a returner through a withheld event; the gate counts current-pepper rows in the window (13 + 2 current + 3 retired exports as 10). Baseline: an event of 4 adds no one, an event of 5 does (`test.each`). | OSE workers pool, `tests/shared-report-bigquery-export.spec.ts`, `tests/shared-report-materialize.spec.ts` |
| D        | A test that pins the baseline export to one snapshot per sealed week                                                                                                                                                                                                                                                                | OSE                                                                                                        |
| A        | The dataset's IAM read list names only internal principals, and any consumer repository carries an invariant spec that refuses outward-facing routes over dataset values                                                                                                                                                            | GCP IAM (owner) and the consumer repository; OSE cannot enforce it alone                                   |
| Register | A new invariant entry for read-side composition, or invariant 17 extended to cover it                                                                                                                                                                                                                                               | OCR-docs `architectural-invariants.yaml` (owner decides which)                                             |

## Open questions

1. Accept rules A to D as written? (Owner)
2. A new invariant entry, or extend invariant 17? (Owner, OCR-docs)
3. The epsilon for rule C, shared with OSE-1780. (Owner)
4. Real-churn simulation of findings 2 and 3 by density; it interacts with ADR-025 (OSE-1944).

## References

- OSE-1946 (this decision), OSE-1189 (the composition property test), OSE-1149 (floor at read vs. write), OSE-1150 (the arbitrary-window query layer), OSE-805 (unit of publication), OSE-1780 (organizer probe and epsilon), OSE-1496 (the forgeable cookie), OSE-1944 / ADR-025 (density)
- ADR-014, COST-101, OCR-docs ADR-011, invariant 17 (`oer_emission_boundary`)
- `.claude/outputs/OSE-1946-ANALYTIC-LAYER-QUERY-BOUND-2026-11-10.md`

## Revisit criteria

- The first OER code lands, or any other consumer of the dataset.
- OSE-1150 builds an interactive query surface.
- The owner chooses an epsilon (OSE-1780).
