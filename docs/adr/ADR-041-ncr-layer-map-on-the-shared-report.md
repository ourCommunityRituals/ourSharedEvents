# ADR-041: Draw the SharedReport's map as the NCR layer stack, from counts it already publishes

**Status:** Proposed (2026-11-25). The base, hexagon and corridor steps are built. Whether a report
may show ring shapes is the owner's open decision (below); until then the ring step is empty.
**Date:** 2026-11-25
**Deciders:** Owner (PO)

## Context

The owner asked (2026-11-25) for the Node, Corridor and Ring layer map built in ourEventRings (OER,
`ourCommunityRituals/ourEventRings` PR 6) to be applied to the SharedReport, in addition to OER, with
OER staying the source. The owner's stack order, bottom to top: the base map and roads, see-through,
with towns lightly shaded; hexagons at res 7, 6 and 5; corridors and their nodes in the middle, where
the map measures; rings highlighted on top. Each layer should read distinctly, one step at a time,
and the order and meaning must live in the data so an agent reads the same cues a person sees.

The owner also wants one layer map across the fleet (OSE, OW, OA), each surface choosing its layers.
That shared component and its registry are OCR-docs fleet ADR-013 (proposed, OCR-docs PR 198). This
ADR is OSE's first surface on it.

The report already has a map: `corridor_map`, poster spots (H3 res 9) at or above the floor of 5,
rounded to 5 (OSE-1459, OSE-2151), at Mid and Premium depth only (ADR-017, OSE-682).

## Decision

**D1. The report's map is the layer stack.** `corridor_map.svg` is drawn by
`lib/ncr/layer-stack.ts` (`renderLayerMap`), one `<g data-layer data-step data-order>` per layer in
the fleet registry's order:

| Order | Layer          | Step      | Privacy class | On the report today                                       |
| ----- | -------------- | --------- | ------------- | --------------------------------------------------------- |
| 10    | `base.towns`   | base      | geometry      | Town lines from OER, light tints no two neighbours share  |
| 20    | `base.streets` | base      | geometry      | Listed, not drawn: the street layer is ADR-036, not built |
| 30    | `hex.7`        | hexagons  | people-count  | Res 7 areas holding spots, shaded by their sum            |
| 40    | `hex.6`        | hexagons  | people-count  | Their res 6 parents                                       |
| 50    | `hex.5`        | hexagons  | people-count  | Their res 5 parents                                       |
| 60    | `corridors`    | corridors | geometry      | OER corridor segments crossing the frame                  |
| 70    | `nodes`        | corridors | geometry      | OER nodes in the frame                                    |
| 80    | `rings`        | rings     | oer-derived   | Empty (D5)                                                |
| 90    | `report.cells` | corridors | people-count  | The poster spots, as before                               |

The answer carries the same stack as data: `corridor_map.layers` (id, order, step, label, meaning,
privacy, marks drawn) and `corridor_map.areas` (res, cell, scans). The page walks the four steps,
earlier steps faded and later ones hidden, starting at the base, or shows all layers.

**D2. Only published parts are counted.** The renderer receives the spots the builder already
publishes (each at or above the floor, rounded). A res 7, 6 or 5 area is the sum of the spots inside
it, the `floorTotalOfParts` rule, so no total says anything a part did not. Towns, corridors, nodes
and rings carry no number. `tests/shared-report-neighbour-floor.spec.ts` registers each new number
(`areas[].scans` as a sum of floored parts) and checks it on every dataset.

**D3. Depth is unchanged.** The map stays inside `corridor_map`, so ADR-017's one gate decides who
gets it (Mid and Premium). The renderer and the page never gate.

**D4. OER's frame is a synced copy.** Towns, corridor segments and nodes come from OER through
`scripts/sync-oer-geographies.mjs` into `lib/ncr/oer-geographies.generated.ts`, pinned to an OER
commit (`OER_SOURCE.ref`), the ADR-012 pattern. The Worker reads no OER file, dataset or network.
This copy is road research and town lines, not anything OER derived from scans, so ADR-026 rule A
does not reach it. While OER PR 6 is open the pin is its head; a later sync moves it to OER `main`.

**D5. No ring on a report until the owner decides.** Rings are OER-derived: OER finds them by
reading many events' scans. ADR-026 rule A keeps anything OER derives away from readers of a
SharedReport until rule C (noise) exists. `lib/ncr/oer-rings.ts` is empty, and a test fails if it
is not, because OER's only rings today are practice data. The owner weighs three options, written up
with examples for him (Claude Docs, "Ring shapes on the SharedReport: the three options"):

1. Shapes only, no numbers, with a written exception to rule A and narrowing rules (every link in
   the ring at the floor, outlines changed once per sealed season, none in thin areas).
2. Wait for rule C; the ring step stays empty.
3. Shapes and saturation, after rule C.

**D6. The frame.** The map is fitted to the res 7 areas holding a shown spot plus one ring of their
neighbours (the event's own res 7 area when no spot is shown). It is geometric, so it points at no
withheld place. When ADR-036 adds streets to the report, it asks for that frame's cells.

## Alternatives Considered

### A separate layer-map section beside the corridor map

**Rejected because:** two maps of the same spots would double the places a count is published and
split one picture in two. The owner asked for the stack applied to the report's map.

### Read OER's layer files at request time

**Rejected because:** invariant 17 binds the Worker to `DB` and `FORMS_DB` only, and a runtime read
of a sibling repo adds a failure the report does not need (the ADR-012 reasoning).

### Draw OER's rings from its practice data now

**Rejected because:** practice rings are made up. A report must never show them as real.

## Consequences

### Positive

- The report shows where its scans sit at three scales, against towns and the corridors OER studies.
- The stack is data: a person and an agent read the same order and meaning.
- The renderer takes a layer list, so it moves onto the shared component without a rewrite.

### Negative

- The worker bundle grows by about 60 KB for the synced geographies (two places today).
- Corridors and towns show only where OER has a geography (Chicago southwest side, Sawyer MI).
- The sync is manual: an OER change reaches reports only through an OSE pull request.

## Open questions

1. Rings on reports: options 1 to 3 in D5. (Owner)
2. Accept this ADR. (Owner)

## References

- OCR-docs fleet ADR-013 (shared layer map, proposed); OER PR 6 (layers, corridor segments)
- ADR-009 (NCR hierarchy), ADR-012 (build-time consumption), ADR-017 (depth), ADR-025 (density),
  ADR-026 (analytic layer), ADR-036 (street layer on the report)
- OSE-1459, OSE-2151 (the report's poster spots and rounding)
