# ADR-033: Serve the drawn area map as a public read of cells

**Status:** Proposed. Built as written here; the owner ratifies it by merging the pull request.
**Date:** 2026-11-14
**Deciders:** Owner (PO). Dr of Security advises on the limits.
**Ticket:** OSE-2039 (epic OSE-1880)

## Context

The owner wants one map renderer, OurSharedEvents'. The street tiles (OpenStreetMap, a Protomaps
build in one PMTiles archive) sit in the Worker's private `MAP_TILES` bucket, so only the Worker can
draw streets (`lib/street-map.ts`).

The OurWKRP creator showcase builds static pages. For each station it draws a "where" map of the
areas its events are in (`showcase/lib/map.mjs` in ourWKRP). It cannot reach the street layer, so it
draws hexagons only, and in its own projection (equirectangular, 640 by 360). OSE draws in Web
Mercator. Streets from one projection do not line up under hexagons from the other, so the showcase
needs the frame as well as the streets.

Rules already in force that this decision must keep:

- Place, not person (AGENTS.md invariant 3). A public read takes cells and refuses coordinate-shaped
  input, as `GET /api/v2/events/map` does.
- The hexagon map standard (`.ocr-standards/standards/OCR_STANDARD_hexMaps.md`): resolution 7 or
  coarser in public, the outline from the cell, server-drawn inline SVG, no client fetch of raw cells.
- Public reads are rate-limited at the route (`lib/public-read-limit.ts`).
- The street layer fails soft: it is never the reason a page fails.

**What was read on stg, 2026-11-14, from a cloud container with no browser and no header:**

| Address                                    | Answer                                                 |
| ------------------------------------------ | ------------------------------------------------------ |
| `/api/v2/events/map?cell=872664c1affffff`  | 200, from the Worker                                   |
| `/api/v2/map/areas?cells=…` (before build) | 404 JSON, from the Worker: the edge let the path in    |
| `/brands/root/calendar.ics`                | 403, `cf-mitigated: challenge`. The Worker did not run |

So a build-time reader reaches paths under `/api/v2/` on stg today. As OSE ADR-028 says, this is an
observed fact about the zone's rules, not a documented one.

## Decision

**D1. One public read under the API path.**

`GET /api/v2/map/areas?cells=<cell>,<cell>…[&around=1]`

It answers JSON:

- `frame`: the Web Mercator frame the map is drawn in (`projection`, `w`, `h`, `scale`, `x0`, `y0`),
  from `frameForCells`. It is always 600 by 360.
- `areas`: one entry per cell, in the order given: `cell`, `n` (from 1), `points` (the outline in
  frame units, ready for `<polygon points>`), `centre` (where the number goes).
- `around`: with `around=1`, the neighbouring cells' outlines, and the frame is fitted to them too.
- `streets`: `{ svg, css, credit }`, or `null` when no street layer can be drawn. `svg` is the one
  `<g>` the landing map puts under its hexagons. `css` is that layer's rules. `credit` is the
  OpenStreetMap credit, which the licence asks for wherever the streets show.

**D2. Parts, not a finished picture.** The route returns the layers and the frame. The caller puts
them in its own `<svg>` with its own classes, labels and accessible name.

**D3. The limits.**

- Cells only. A coordinate-shaped parameter is a 400 in any letter case, using the list
  `events-map.ts` uses.
- Resolution 7 only. Any other resolution is a 400.
- At most 12 cells. A 13th is a 400.
- The frame size is fixed. The caller cannot ask for a bigger one.
- The street read is bounded as on the landing: 12 tiles and 1.5 seconds at most. A frame too wide
  for a street map (below zoom 7, about 600 km across) reads no tile and answers hexagons only.
- `publicReadLimited('map-areas', …)`: 60 requests per 10 seconds and 360 per minute, per caller.
- No database is read. No cookie is set. Nothing is logged about the cells.

**D4. Fail soft.** No binding, no archive, no tile, bad data or a slow read is a 200 with the
hexagons and `streets: null`. Only a bad request is an error.

## Alternatives Considered

### Alternative A: Return one finished SVG

`Content-Type: image/svg+xml`, the whole map.

**Rejected because:** the caller numbers the areas in its own list order, names the map for a screen
reader in its own page, and styles it with its own classes. A finished picture would need all of that
passed in, or would be re-cut by string surgery. It also tempts a caller to load it with `<img>` from
a visitor's browser, which is the client fetch the hexagon standard rules out.

### Alternative B: Serve the tiles

A tile route (`/tiles/:z/:x/:y`), and each product draws its own streets.

**Rejected because:** it makes a second renderer, which is what the owner asked not to have. It also
turns a bounded read into an open tile server, where the caller, not the Worker, chooses what is read.

### Alternative C: Streets only, and the caller keeps its projection

Return the street `<g>` and let the showcase draw hexagons as it does now.

**Rejected because:** the hexagons would not sit on the streets. Returning the frame alone would
leave a second copy of the Web Mercator arithmetic in the showcase to drift from this one. Returning
the projected outlines removes the copy.

### Alternative D: Share the bucket with the showcase build

Give the build a credential for `MAP_TILES`.

**Rejected because:** it spreads a credential and a second copy of the reader, decoder and drawing
code, for a job one public read does.

## Consequences

### Positive

- One renderer. The showcase can drop its projection and fill its `hex-streets` group.
- The route says nothing the cell ids do not already say, so there is nothing to floor or scope.
- A build with no browser reaches it on stg today.

### Negative

- Each uncached request can cost one R2 read of up to 12 tiles. The route limit is the control. The
  answer is cacheable (one hour with streets), but nothing at the edge caches it today.
- The street markup and its class names (`amap-s`, `as-*`) become a contract with a reader outside
  this repo. A change to them is now a change for the showcase.
- The street CSS reads `@ocr/ui` colour tokens. A page that does not load them gets uncoloured
  streets.
- Reachability rests on the zone not challenging `/api/v2/`. Nobody decided that. The staging Bruno
  case fails by name if a read is challenged, so a change would be seen at T2.

### Neutral

- Staging has no street archive loaded today (`streetMapArchiveLoaded` is `"false"`,
  `docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md`). Until the owner loads it, stg answers
  `streets: null` and the staging street assertions print NOT RUN.
- Production is held closed (AGENTS.md). The showcase reads staging.

## Implementation Notes

- Handler: `workers/oursharedevents/src/handlers/map-areas.ts`. Route and header table:
  `src/router.ts`.
- `lib/street-map.ts`: `buildStreetLayer` and `loadStreetLayer` take the cells that carry a number,
  so town names keep clear of the areas and not of every framed neighbour.
- Tests: `tests/map-areas.spec.ts` (node), `tests/map-areas-route.spec.ts` (workers pool),
  `tests/street-map.spec.ts` (the numbered cells), and the Bruno folder
  `bruno/ose-pages/15. Public Area Map (OSE-2039)` on staging.
- Note for the reader's side: `docs/integrations/PUBLIC-AREA-MAP.md`.

## References

- OSE-2039 (this story), OSE-1880 (the map epic), OSE-1882 (streets under the landing map).
- OSE ADR-028 (the edge and machine reads).
- `.ocr-standards/standards/OCR_STANDARD_hexMaps.md`.

## Revisit Criteria

- A second reader outside OSE, or a reader that calls from a visitor's browser.
- The route's reads show in the rate-limit stats or the R2 bill.
- The zone starts challenging `/api/v2/`.
- The street markup changes shape.
