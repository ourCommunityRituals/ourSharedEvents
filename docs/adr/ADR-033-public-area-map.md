# ADR-033: Serve the drawn area map as a public read of cells

**Status:** Proposed. Built as written here; the owner ratifies it by merging the pull request.
Reconciled with the code on 2026-11-15 (see "Reconciliation" at the end): the cache headers, the
full list of refusals and the limit of "fail soft" were in the code and not in this record.
**Date:** 2026-11-14
**Deciders:** Owner (PO). Dr of Security advises on the limits.
**Ticket:** OSE-2039 (epic OSE-1880)

## Context

The owner wants one map renderer, OurSharedEvents'. The street tiles (OpenStreetMap, a Protomaps
build in one PMTiles archive) sit in the Worker's private `MAP_TILES` bucket, so only the Worker can
draw streets (`lib/street-map.ts`). The bucket, its key and who may read and write it are OSE
ADR-035; the data's licence and credit are in `NOTICE.md`.

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
  `around` is `0`, `1` or absent. Any other value is a 400 (`AROUND_INVALID`).
- `streets`: `{ svg, css, credit }`, or `null` when no street layer can be drawn. `svg` is the one
  `<g>` the landing map puts under its hexagons. `css` is that layer's rules. `credit` is the
  OpenStreetMap credit, which the licence asks for wherever the streets show: `credit.html` is the
  paragraph the landing shows and `credit.osm` is the address it links to. **The credit is in
  English only** (`streetCredit('en')`), whatever language the reader's page is in.

**D2. Parts, not a finished picture.** The route returns the layers and the frame. The caller puts
them in its own `<svg>` with its own classes, labels and accessible name.

**D3. The limits.**

- Cells only. A coordinate-shaped parameter is a 400 in any letter case
  (`COORDINATES_NOT_ACCEPTED`), using the list `events-map.ts` uses.
- `cells` is required (`CELLS_REQUIRED`), and each entry must be a valid H3 cell (`CELL_INVALID`).
- Resolution 7 only. Any other resolution is a 400 (`CELL_RESOLUTION`).
- At most 12 cells. A 13th is a 400 (`TOO_MANY_CELLS`).
- `around` is `0` or `1`. Anything else is a 400 (`AROUND_INVALID`).
- The frame size is fixed. The caller cannot ask for a bigger one.
- The street read is bounded as on the landing: 12 tiles and 1.5 seconds at most. A frame too wide
  for a street map (below zoom 7, about 600 km across) reads no tile and answers hexagons only.
- `publicReadLimited('map-areas', …)`: 60 requests per 10 seconds and 360 per minute, per caller.
- No database is read. No cookie is set. Nothing is logged about the cells.

**D4. Fail soft.** No binding, no archive, no tile, bad data or a slow read is a 200 with the
hexagons and `streets: null`. Only a bad request is an error.

This holds when the street read returns nothing. It does not cover a layer that is drawn and
wrong. A layer that decodes but shows water and no roads, or nothing a reader can use, is not
`null`: it is returned as `streets`, with the credit and the long cache header of D5 (street-map
review 2026-11-15, findings R7 and R18). Nothing in the route tells a thin layer from a good one
today.

**D5. Cache headers.** The route sets `Cache-Control` itself
(`handlers/map-areas.ts`, the last lines of `handleMapAreas`):

| Answer                   | `Cache-Control`                                      |
| ------------------------ | ---------------------------------------------------- |
| 200 with `streets`       | `public, max-age=3600, stale-while-revalidate=86400` |
| 200 with `streets: null` | `public, max-age=60`                                 |
| Any refusal (400, 429)   | `no-store`                                           |

An answer with streets may be kept for an hour and served stale for a further day while it is
re-read, so a browser or a build that honours the header can show one answer for up to 25 hours.
An answer without streets is kept for a minute, so a failed read is not what a build keeps
getting. No cache at Cloudflare's edge stores the route today (`caches.default` is not used for
it), so the header reaches only browsers and readers. The archive's key is not part of the
address: after a refresh, a reader that kept an answer shows the old streets until its copy ends.

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
  answer is cacheable (D5), but nothing at the edge caches it today.
- A wrong layer that is not `null` is kept by a reader for up to 25 hours (D4, D5).
- The credit reaches the reader's page only if that page shows `credit.html`. The route hands it
  over in the same object as the streets and cannot make the reader show it (`NOTICE.md`, duty L5).
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
- Town names are placed with room for 28 map units a letter (2026-11-15, street-map review
  findings R24 and R38), the size the landing sets them in under 480 px
  (`lib/map-narrow-style.ts`). `streets.css` still sets 22, and the landing's narrow rule is not
  part of this route's answer: a reader that draws the map narrower than 355 px sets its own size
  (`docs/integrations/PUBLIC-AREA-MAP.md`). The markup's shape did not change; an answer can hold
  fewer names than before.
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

## Reconciliation

Per `ADR-RECONCILIATION-PROCESS.md`. The code was read on `main` at `7daf52ed`; no code changed.

### ADR drift register

| ADR     | Status   | Last verified | Code evidence                                                           | Drift note                                                                                                                                                                                                                                                                                                     | Owner |
| ------- | -------- | ------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| ADR-033 | Proposed | 2026-11-15    | `src/handlers/map-areas.ts`, `src/router.ts`, `tests/map-areas.spec.ts` | The record had no cache headers (now D5), listed three of the six refusals (now all six, with `AROUND_INVALID`), did not say the credit is English only (D1), and read "fail soft" as covering a wrong layer, which it does not (D4). Found by the street-map review of 2026-11-15, findings R18, R19 and R26. | Owner |

Still true, and still not proven: no archive is loaded, so no reader has received a street layer
from this route on staging, and the staging street assertions print NOT RUN.
