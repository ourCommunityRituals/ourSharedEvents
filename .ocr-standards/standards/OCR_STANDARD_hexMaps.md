# OCR_STANDARD_hexMaps

| Field | Value |
|-------|-------|
| Status | Proposed (2026-10-08), pending owner ratification |
| Owner | Matt (founder) |
| Scope | Fleet-wide: any map drawn from H3 cells, in any product (OSE, OW, OA sites) or from OER |
| Builds on | ADR-011 (H3 resolution by signal), ADR-010 (hyperlocal correlation), `CHOICE-INVARIANTS.md`, `OCR_ARCHITECTURE_oerAggregationBoundary.md`, `OCR_STANDARD_declinedRegimes.md`, `@ocr/ui` guideline `30-uec-and-maps.md` |
| Invariants | #1 anonymous_id, #2 hyperlocal_geo_resolution, #7 aggregate_only_reporting, #9 tenant_isolation, #17 oer_emission_boundary, #22 cross_repo_import_isolation, #29 declined_regulatory_regimes |

---

## Statement

A hex map is a picture of counts. It is published the moment it is drawn,
so every rule that governs a published count governs every hexagon. A map
must never show what the same numbers would not be allowed to show in a
table.

## Rules

1. **Grain.** Every surface a person other than the organizer can see draws
   H3 resolution 7 (the corridor) or coarser. Resolution 9 is for physical
   places only (a poster's placement, live scans at the venue), and a poster
   spot is drawn only on the organizer's own admin screens. (ADR-011 rules
   1 and 4.)
2. **Source.** The outline comes from the cell id (`cellToBoundary`), never
   from a latitude or longitude. A map about an area uses an area the person
   picked, never one detected from their device. (ADR-011; hybrid brief §6.)
3. **Floor (K = 5), no exceptions.** A hexagon that stands for people or
   their actions (scans, taps, listeners, attributions) is drawn only when
   its count clears the floor. The count is a sum of parts, each floored at
   the finest grain that product floors before the sum (OSE: one poster in
   one hour, OSE-1459 and OSE-1656; OW: per track and per hour). None and 1
   to 4 look the same. The note "areas with fewer than 5 … are not shown"
   appears whenever the map is drawn, not only when a cell was dropped
   (OSE-1649). Owner ruling 2026-10-08: no exceptions, at any tier.
4. **Readiness.** An area with too few listings shows "not enough yet" and
   points to the nearest active area instead of drawing a map of two things
   (OSE `CORRIDOR_READY_MIN_EVENTS`).
5. **Colour carries the event category, never the person.** A filled cell
   uses its UEC category's `-ui` colour and carries the category glyph
   (guideline `30-uec-and-maps.md`). No colour, glyph or legend may encode a
   person attribute: no age, health, student or identity mode.
6. **No named/anonymous split.** No map may colour or count named (OW)
   people apart from anonymous (OSE) people in the same area. "Sponsors see
   the total, not the split" (CHOICE B-4).
7. **No cross-product cell, except from OER.** An OSE count and an OW count
   never share a hexagon unless OER produced it from each side's floored
   corridor counts. Products do not read each other's databases (#22, CHOICE
   A-7 and B-3). A map never shows an OER figure beside a product's own
   per-event figure, because the two could be subtracted (OER boundary §4.1.1
   rule 4).
8. **Listed and in scope.** A map draws only listed events (OSE
   `listedSql`), and only within the brands the surface is scoped to (#9).
9. **Declined regimes stay out.** A map draws only event types at
   `legal_clearance_tier` 3 or below. A health-, child- or student-adjacent
   category describes the event, never anyone who came (#29).
10. **Rendering.** Maps are server-rendered inline SVG under the page's CSP,
    with no client fetch of raw cells. An empty cell is outline only. A
    selected cell keeps its colour and gains a stroke (guideline
    `30-uec-and-maps.md`).
11. **Tests.** Every map that draws counts ships a neighbour-dataset test:
    two datasets one person (or one scan) apart under the floor must render
    the same, and a control above the floor must change it. The test is
    seen red before its fix, as `tests/shared-report-neighbour-floor.spec.ts`
    and `tests/scan-counts-neighbour-floor.spec.ts` (OSE) are.

## Where the maps are today (read 2026-10-08)

| Map | Where | Meets the rules? |
|-----|-------|------------------|
| Corridor map (SharedReport) | OSE `src/lib/corridor-map.ts`, server SVG | Yes: res7, floored per poster-hour, note always shown (after OSE-1649). Single colour. |
| Attendee map (`/events` landing) | OSE `src/lib/attendee-map.ts`, server SVG | Yes for its subject: it counts listed events, which are entities, not people, and is gated on corridor readiness. Single colour. |
| `HexMap` | `@ocr/ui` design system (`design-system/components/bundle.js`) | **No.** A design mock-up on a fixed grid with no real cells and no floor (rule 3). Empty cells are filled (rule 10). It uses the print colour, not `-ui`, and has no glyphs (rule 5). It is a browser component (rule 10). It must not be fed real data until it meets this standard. |
| OW | none | OW holds no geography of its own (a free-text `venue_name` only). An OW map can only take its area from the OSE event, through OER (rule 7). |

## Reconsideration

Changing a rule here is an owner decision recorded with a date. Until this
standard is ratified, its rules are the review checklist for any map PR.
