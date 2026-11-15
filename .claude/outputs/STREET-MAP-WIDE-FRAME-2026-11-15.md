# The landing's map when its areas are far apart: a frame question for the owner

**Date:** 2026-11-15
**For:** the owner (PO). It sharpens question 4 of
`STREET-MAP-BASE-MAP-SCENARIOS-2026-11-15.md` (section 8) and question 8 of
`CCR-STREET-MAP-RERUN-2026-11-15.md`. Finding R51, gap G19.
**Status:** a write-up. No code changed. The rule in section 4 is a proposal;
nothing is built until the owner rules.
**Evidence:** source at `e8da1b9c`, and frame arithmetic run in Node with the
repository's own `h3-js` (the same formulas as `frameForCells` and `frameZoom`
in `workers/oursharedevents/src/lib/street-map.ts`). No Worker and no archive
were involved; the numbers are geometry, not timings.

## 1. What was asked

R51: "No span cap: one published event in a distant area drops the landing frame
under zoom 7 and removes streets for every visitor." The task was a span cap: a
rule for which cells the street frame covers when the full set is too wide, with
the hexagons outside that frame drawn as they are now.

## 2. Why that cannot be done without changing the hexagon map's frame

The street layer and the hexagons are one drawing in one frame.

- The landing's map fits its frame to every cell it draws
  (`attendee-map.ts`, `svgFor` → `frameForCells`).
- The street layer is drawn in a frame fitted to the cells it is given, and the
  map uses it only when those are exactly the cells it draws
  (`attendee-map.ts`, `opts.streets.cellsKey === cellsKey(drawn…)`). That check
  is what keeps a street under the hexagon that sits on it.

So a street layer for some of the cells, under a map framed to all of them, has
two possible shapes, and neither is a street map:

- **Drawn to the map's scale**, it is a patch a few map units across (table
  below, last column). The 18 km of streets around ten Chicago areas is 8 units
  of a 600-unit map once one event is listed in New York.
- **Drawn in its own frame**, the streets no longer sit under the hexagons.

A patch with blank land around it is also what R15 ruled out: streets on one side
of a map and nothing on the other read as "nothing is there", under a credit that
says the map is OpenStreetMap's.

## 3. What the far event takes first is the hexagons, not the streets

Ten areas on the south side of Chicago, and then one more listed event somewhere
else. The map is 600 units wide; the number printed in a hexagon is 26 units
tall; a touch target is 78 units (44 px on a 339 px map).

| The landing lists                | Away from Chicago | Frame zoom | Frame width | One hexagon is | The ten areas' 18 km frame is |
| -------------------------------- | ----------------- | ---------- | ----------- | -------------- | ----------------------------- |
| Ten areas, south Chicago         |                   | 12         | 18 km       | 93.5 units     | the whole map                 |
| and one in Milwaukee             | 155 km            | 8          | 316 km      | 5.3 units      | 34 units                      |
| and one in Indianapolis          | 246 km            | 7          | 426 km      | 3.9 units      | 25 units                      |
| and one in Detroit               | 390 km            | 7          | 466 km      | 3.6 units      | 23 units                      |
| and one in Minneapolis           | 584 km            | 7          | 761 km      | 2.2 units      | 14 units                      |
| and one in Nashville             | 616 km            | 6          | 1,179 km    | 1.4 units      | 9 units                       |
| and one in New York              | 1,148 km          | 6          | 1,363 km    | 1.2 units      | 8 units                       |
| and one in Los Angeles           | 2,797 km          | 5          | 3,033 km    | 0.6 units      | 4 units                       |
| Seventeen cities, coast to coast |                   | 4          | 5,115 km    | 0.3 units      | 2 units                       |

Streets stop under zoom 7 (`MIN_STREET_ZOOM`): about 650 km east to west or
400 km north to south at Chicago's latitude. **Long before that the hexagons are
gone.** One event 155 km away makes each hexagon 5 units wide, a fifth of the
number printed on it, and the ten numbers land on top of each other. Between
zoom 7 and about zoom 10 the street layer that does draw is highways under
hexagons a few units wide (the open half of question 8).

So the honest reading of R51 is wider than its text. A nationwide list, which is
what the landing shows with no search, is a map of sub-pixel hexagons with or
without streets. The comment on `MAX_MAP_AREAS` already says it: "Past this the
answer is clustering, not a bigger SVG." A span cap on the street layer alone
would leave that map as it is and add a patch to it.

A search already avoids this: a zip or a town filters the list to that place, the
frame is local and the streets draw. So does a tap on a hexagon, which frames one
area. The unsearched landing, and a name that is many towns, are the wide cases.

## 4. The decision, and a rule ready to build

The frame of the hexagon map is product behaviour, so this stops here for the
owner. Three answers, the same three as question 4:

**A. Keep today's frame.** Every listed area is in the frame. Far apart, the map
is dots and the streets are off. Nothing to build. R51 stays open and is
accepted.

**B. Frame the main group and list the rest (recommended).** The map frames the
areas that fit together; the others stay on the page, in the legend under a line
that says they are not on this map, each with its events and its "zoom in" link.
The card list is unchanged, so no event leaves the page. Proposed rule:

1. Take the areas in the order the map already numbers them: most listed events
   first, ties by cell id (`attendeeMapAreas`).
2. Start with area 1. Take each next area, in that order, if the frame of the
   group with it added is still at or above a floor zoom; otherwise it is
   listed, not drawn.
3. The map, its numbers, its street layer and the caption count the group. The
   legend lists the rest after it.

The floor zoom is the owner's number. At zoom 10 the frame is about 70 km wide
and a hexagon about 24 units, the size of its number; at zoom 9, 140 km and 12
units; at zoom 7 (the street floor), 550 km and 3 units. Zoom 10 is the proposal:
it is where a hexagon can still carry its number, and it also answers the open
half of question 8, because a frame at zoom 10 or closer is past the
highways-only range.

**C. Hexagons only below a chosen zoom, as today, but say so.** A line under a
wide map: "These areas are far apart. Search a town or zip, or tap an area." The
smallest change; it fixes neither the dots nor the streets.

What B keeps, and what to check before building it:

- **Never the visitor.** The rule reads cell ids and the number of listed events
  in each area, both already printed on the page. No request geo, no IP, no
  header. A search only narrows the list, as now.
- **The count floor.** The per-area numbers are counts of listed public events,
  each linked by name beside the number, not counts of people, and
  `lib/count-floor.ts` does not floor them today. Whether invariant 2 covers
  counts of events is the CCR's open question 7. If the owner rules that it
  does, the order in step 1 must be made from the floored values (every area
  under 5 ties, and the cell id decides), so which group wins can never say more
  than the page prints.
- **One event cannot move the map.** Today one listed event anywhere takes the
  streets, and the hexagons, from every visitor. Under B a far event is listed
  beside the map. To move the frame an area would have to become the busiest on
  the page.
- **Deterministic.** Same list, same map, for every visitor; so a kept street
  layer for that group is reused by everyone.
- Tests when built, born red at both layers: the two-group and single-outlier
  cases and ties (node, `street-map-landing.spec.ts`, `attendee-map.spec.ts`);
  a landing with one far cell still reads tiles (workers pool,
  `street-map-runtime.spec.ts`); the legend still names every area. The case
  that pins today's answer, "areas spread wider than a street map can show:
  plain hexagons, no credit, and the bucket is never asked"
  (`street-map-landing.spec.ts`), is rewritten by it. `attendee-map.ts` and
  `landing-area.ts` are under mutation floors (98.9 and 99.35).

## 5. What this does not settle

- How a nationwide landing should look at all: B frames one group and lists the
  rest. Groups as marks on a country map ("clustering") is a larger design and is
  not proposed here.
- The public area route (`/api/v2/map/areas`) is not part of this: its caller
  chooses the cells, and a frame under zoom 7 answers hexagons only.
- Nothing here was seen on staging: no staging list is that wide, and no archive
  is loaded.
