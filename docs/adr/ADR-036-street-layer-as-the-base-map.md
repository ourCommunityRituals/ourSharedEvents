# ADR-036: Make the street layer the one base map, asked for with cells only

**Status:** Proposed. Nothing in it is built. It puts the owner's direction of 2026-11-15 into
decisions the owner can accept, change or refuse one by one. Merging the pull request that carries
it records the proposal; it does not accept D2 to D5, which stay open until the owner rules on
each (see "Open, for the owner").
**Date:** 2026-11-15
**Deciders:** Owner (PO). Dr of Security advises on D3, D4 and D5.
**Ticket:** OSE-2064 (the load), epic OSE-1880

## Context

The owner, 2026-11-15: "The plan is for this map to be the base support map", for the landing
screen and the SharedReport page, with security, functionality, CI/CD, batching and caching
worked out across Cloudflare.

Where things stand on `main` at `79647f2d`:

- The landing map, its zoomed area and the public area map (OSE ADR-033) draw streets through one
  function, `loadStreetLayer` (`workers/oursharedevents/src/lib/street-map.ts`). It takes cells
  and returns a layer or null. The archive is one object in one bucket (OSE ADR-035). No archive
  is loaded, so no street has been drawn by a Worker.
- The SharedReport draws a map of its own (`corridor_map`): poster placements at res 9, after the
  under-5 floor, in an equirectangular frame, with no street layer
  (`src/lib/shared-report-builder.ts`, `src/lib/corridor-map.ts`). The map exists only at Mid
  depth and above (`src/lib/report-depth.ts`).
- `docs/positioning/MAPPING-COST-STRUCTURE.md` says in one place that the SharedReport draws
  hexagons only, and in another that the street layer "lands here first". No ADR decides it.
- A drawn layer is kept nowhere. Each request reads, decodes and draws again.

The scenario pass behind this record is
`.claude/outputs/STREET-MAP-BASE-MAP-SCENARIOS-2026-11-15.md`: 22 scenarios across the four
surfaces, 20 gaps, the design and the ordered slices.

Rules already in force that every decision below must keep: never who, only how many; the under-5
floor with no exceptions; place, not person; no cookies on public surfaces; the SharedReport
decides who × plan on every read and fails closed; the map comes from our own R2 and database;
one bucket (OSE ADR-035); the street layer is never the reason a page fails.

## Decision (proposed)

**D1. One door, cells only.** Every surface that wants streets asks `loadStreetLayer` with H3
cell ids and nothing else: no event id, no token, no brand, no count and no viewer position. The
frame, the tiles read, the drawing and any cache key are functions of the cells, the archive and
the drawer's code. No surface reads tiles itself and no route serves one. This is what the code
does today; D1 makes it the rule a new surface is held to.

**D2. The SharedReport's map is drawn on the base map.** Its hexagons are projected in the base
map's Web Mercator frame, in colour tokens, with the street layer under them and the
OpenStreetMap credit below, at the depths that have the map today. A null layer leaves today's
map, whole.

**D3. Who × plan first, streets after.** The report is built, cut to its depth and floored
exactly as today. Only if the answer still holds a live map is the base map asked, by the read
handler. A reader whose depth has no map costs no tile read. A street failure never changes the
report's status or any other part of it. The layer travels inside the report's own answer: there
is no second request and no cell in an address.

**D4. The report's frame is the res-7 areas of its shown cells.** The base map is asked for the
res-7 parents of the cells that passed the floor, never for a cell that was dropped and never for
the res-9 cells themselves. So the frame cannot point at a withheld place, the layer is the one
the landing's zoomed view draws for that area, and nothing kept about the layer says a report
exists.

**D5. A drawn layer may be kept; a composed map and a report never.**

- Kept in the isolate: the street layer alone, keyed by the archive's key and etag, the drawer's
  version, the frame size and the cells. No decision is needed for this part.
- Kept at Cloudflare's edge: the same thing under the same key, for a long time, because the key
  names an object that is never overwritten (OSE ADR-035 D2) and a drawer version. A refresh or a
  drawer change makes new keys, so nothing is ever purged. **Which store, and whether to do it at
  all, is the owner's** (below).
- Never kept anywhere: a SharedReport answer or page (`no-store` stays); hexagons with their
  opacity, numbers, dots or counts; anything keyed by an event, a token, a brand or a count; a
  layer for cells that were not shown; a null layer.

**D6. The batch report read carries no streets** until a consumer needs them. If it ever does, it
is one deadline for the whole request and each tile read once.

## Alternatives Considered

### Alternative A: Keep the report's own map and leave streets off it

Hexagons only on the report, as `MAPPING-COST-STRUCTURE.md` says in its surface table.

**Not chosen here because:** the owner's direction names the SharedReport page. It remains the
fallback: D2's null case is exactly this.

### Alternative B: The report page asks the public area route for its streets

The page would call `GET /api/v2/map/areas?cells=…` from the reader's browser.

**Rejected because:** it puts a report's cells in a second address, from a visitor's browser,
outside the report's own `no-store` answer and outside its token. The area route also refuses
anything but res 7, for the reason given in OSE ADR-033 D3.

### Alternative C: Fit the report's frame to its res-9 cells

A frame a few hundred metres across.

**Rejected because:** the drawer shows a layer only with a main road and 100 road points
(`MIN_ROAD_POINTS`), which a single block often lacks, so most reports would draw none. The key
of any kept layer would also hold the poster cells themselves.

### Alternative D: Cache the whole landing page or the whole report

**Rejected because:** the landing depends on the event list and the search, and nobody asked for
it; the report depends on who is asking and on floored counts, and must never be stored.

## Consequences

### Positive

- One renderer and one frame for every map the product draws. The report's raw colours and its
  second projection go.
- A street layer can say nothing its cells do not say, on any surface, by construction.
- A kept layer is never stale: its key changes when the archive or the drawer does.

### Negative

- The report's map changes shape (a wider frame, the same hexagons smaller in it). It needs the
  owner's eye and a staging check that reads its cells and counts, which no staging test does
  today.
- The read handler gains a dependency on the street layer's environment (`MAP_TILES`), which the
  report's builder does not have today.
- The edge store may do nothing on production while production is closed: Cloudflare's Cache API
  page says the API is not available for Workers fronted by Cloudflare Access, and closing
  production is an Access policy over the whole host (AGENTS.md). Not tried.

### Neutral

- Staging has no archive, so every surface draws hexagons only until the owner loads it. Nothing
  here changes the order in the street-map review: corrections, the load, the look, the flag.
  Since 2026-11-15 the Worker also reads a switch, `STREET_MAP`. It was `"off"` on staging when it
  landed, and the owner set it to `"on"` the same day, before any load: with no object in the
  bucket staging still draws hexagons only, and the load is now the step that draws the first
  street (runbook, "Staging, in order", steps 4 and 8).
- OSE ADR-033's route and contract are unchanged.

## Not proven

- Anything on staging. No street has been drawn by a Worker.
- Which Cloudflare Access setup the Cache API sentence means, and so whether an edge store works
  on a closed production host.

## Open, for the owner

1. D2: should the SharedReport draw streets under its map at all, and at Mid and above only?
2. D4 and the review's question 6: is a poster's block over legible streets wanted on the report,
   for a sponsor's read too? The cell id is already in the answer.
3. D5: keep drawn layers at the edge, by the Cache API (used today for venue images), by Workers
   Cache, or not until staging has numbers?
4. The full list, twelve questions, is section 8 of the worksheet.

## Implementation Notes

- None of D2 to D6 is implemented, and neither is the in-isolate store of D5. The slices are
  section 7 of the worksheet: B1 to B9 need no ruling and touch no rule; O1 (the edge store) and
  O2 (the report) wait for D5 and D2 to D4.
- Status, 2026-11-16 (`main` at `44948a04`; the worksheet's section 10 has the evidence): slices
  B1, B3, B4 and B5 are on `main`, and so is the missing-object half of B2. The lost timeout race
  this record once listed under "Not proven" was shown in the Workers runtime and the reader
  corrected (PR 1276). Not built: the etag half of B2, and B6 to B9. The landing and the event
  list have a per-caller limit (PR 1308), which was slice O4. No archive is loaded.
- D1 is held today by the code's shape and by `tests/map-areas.spec.ts` (no database read). A
  structural gate for it belongs with the first new surface.

## References

- `.claude/outputs/STREET-MAP-BASE-MAP-SCENARIOS-2026-11-15.md` (this proposal's evidence).
- `.claude/outputs/CCR-STREET-MAP-WILL-IT-WORK-2026-11-15.md` (findings R1 to R26).
- OSE ADR-033 (the public area map), OSE ADR-035 (one bucket), OSE ADR-017 (report depth).
- `docs/positioning/MAPPING-COST-STRUCTURE.md`; `NOTICE.md`.
- Cloudflare pages read 2026-11-15: section 3 of the worksheet.

## Revisit Criteria

- The owner refuses D2: this record is cut back to D1 and D5.
- Staging numbers after the load show the in-isolate store is enough, or not enough.
- A third surface wants streets.
