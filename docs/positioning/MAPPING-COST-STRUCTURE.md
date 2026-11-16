# Mapping Cost Structure

> **Rule (PO, 2026-10-03, non-negotiable):** every mapping feature carries a line in
> the cost structure before it ships. No map dependency is added without its unit
> cost, its driver, and the tier that pays for it written here.
>
> Companion to [`PRICING-PLAN.md`](PRICING-PLAN.md) (what is sold) and
> [`../monitoring/COST-METRIC-CONTRACT.md`](../monitoring/COST-METRIC-CONTRACT.md)
> (how runtime cost is observed). Prices were read on 2026-10-03 and must be
> re-read before any decision that depends on them. Volumes and tile counts are
> estimates, marked as such.

## The three map layers

| Layer                             | What it is                                                                                                                     | Status                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **H3 hexagons**                   | Server-drawn SVG from res-7 cell ids (`lib/attendee-map.ts`, `lib/corridor-map.ts`). No tiles, no JS, no outside request.      | Shipped                                                                                                                                  |
| **Venue image**                   | One Google Static Maps image per venue, fetched by the Worker (`GET /api/v2/maps/venue-image`, `lib/maps.ts`).                 | Shipped on event pages                                                                                                                   |
| **Street map under the hexagons** | Water, roads and town names drawn by the Worker as SVG under the hexagons (`lib/street-map.ts`), from a PMTiles archive in R2. | **Code merged; drawn nowhere yet.** No archive is loaded, so staging and production draw hexagons only (see "What is drawn where today") |
| **Zoomed area with event dots**   | A tapped hexagon drawn alone over its streets, one dot per place (`lib/attendee-map.ts`, `/?area=`).                           | **Code merged; the dots are not shown yet.** With no street layer the zoomed area lists its places and draws no dots (decision 5)        |

### What is drawn where today (read 2026-11-15)

**No street has been drawn on staging or production.** The load workflow has no `load` run (its
two `measure` runs of 2026-11-15 write nothing), the bucket
`ose-map-tiles` is empty, and `streetMapArchiveLoaded` is `"false"`. A green staging chain
says nothing about streets until that flag is `"true"`: the street cases print NOT RUN.

Once an archive is loaded and the street layer is switched on (`STREET_MAP = "on"` for that
environment in `wrangler.toml`; it is `"on"` on staging since 2026-11-15, set before any load,
and `"off"` on production; off reads nothing from the bucket, and on with no object in the
bucket asks the bucket and finds nothing each time a map would draw streets, because a miss is
not remembered), the code on `main` draws streets on two surfaces and no other:

| Surface                                              | What it draws                                                                     | Limit                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| The landing map (`/`)                                | Streets under every hexagon in view, in the frame fitted to those hexagons        | 12 tiles, zoom 14 or coarser; no zoom floor, so a frame a country wide still reads tiles and draws little |
| The zoomed area (`/?area=<res-7 cell>`)              | One area over its streets, with a numbered dot per place                          | The same read; with no street layer it lists the places and draws no dots                                 |
| The public area map (`GET /api/v2/map/areas`)        | The same street layer, handed to a reader outside OSE as SVG markup (OSE ADR-033) | The same read; below zoom 7 (a frame about 600 km across) it reads no tile and answers hexagons only      |
| Event page, `/events`, display, poster, SharedReport | Hexagons only. No street layer is drawn there                                     | —                                                                                                         |

The layer is water, roads in three weights (highways, major roads, minor roads) and up to six
town names. It is capped at 9,000 path points (`MAX_POINTS`).

**Not proven, and found wanting by the street-map review of 2026-11-15**
(`.claude/outputs/CCR-STREET-MAP-WILL-IT-WORK-2026-11-15.md`, score 0%, stopped at a human gate):

- No real archive has gone through the Worker's reader and drawer in a Worker. The United
  States file has never been cut or read (finding R1).
- The point cap is spent on water first, and a feature that does not fit is skipped whole. In
  the review's workstation run a 19-area frame over Manhattan drew water and no roads, and a
  7-area frame drew no minor roads (finding R7). A wide frame is not a street map today.
- The 1.5 s limit, the Worker's CPU and memory for a dense frame, and reads from R2 are
  unmeasured (findings R2, R3).
- Nothing tells a thin or wrong layer from a good one at run time (finding R18).
- The data's licence duties are in [`../../NOTICE.md`](../../NOTICE.md): the credit is in the
  code; some duties are NOT CLEAR and wait for the owner.

The owner chose "corrections first" on 2026-11-15: these are corrected before the load.

## Cost lines

| Line                                     | Fixed / month                                                                                                                                                                                                                                                                                                                                                                                    | Variable                                                                                                                               | Driver                                                                                                                                  | Who triggers it                           | Who pays                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------ |
| H3 hexagons                              | $0                                                                                                                                                                                                                                                                                                                                                                                               | $0 beyond Worker compute                                                                                                               | page views                                                                                                                              | everyone                                  | platform (inside the Workers plan)   |
| Place names on hexagons (first release)  | $0                                                                                                                                                                                                                                                                                                                                                                                               | $0                                                                                                                                     | page views                                                                                                                              | everyone                                  | platform                             |
| Google venue image (today)               | $0                                                                                                                                                                                                                                                                                                                                                                                               | first 10,000 loads/month free, then **$2.00 per 1,000**                                                                                | one load per venue, per Cloudflare location, per day (edge-cached)                                                                      | **attendees on public event pages**       | platform — not tied to any paid tier |
| Google place lookup (Geocoding)          | $0                                                                                                                                                                                                                                                                                                                                                                                               | Google's Geocoding list price after its free monthly allowance is **$5.00 per 1,000** (not re-read for this change; check the console) | one lookup per event save that changes the place, plus at most **25 a night** for events saved before 2026-10-11 (`lib/event-place.ts`) | **organizers** saving events (admin only) | platform                             |
| Self-hosted street map (Protomaps on R2) | storage: **$0.015/GB-month** after the free 10 GB per account. What is loaded is the United States subset, cut with a top zoom of 14 (owner, 2026-11-16); **9.7 GB by a dry run** (2026-11-16, build `20261115`; 20 GB with every zoom kept): $0 to $0.15 per month. The ceiling is the whole planet (138.5 GB measured): about **$1.93** for the first environment and **$2.08** for the second | reads: **$0.36 per million** after 10 million free; no egress fee                                                                      | tile reads per map view (estimate 10–30)                                                                                                | whoever sees the street map               | funded by Mid revenue (see below)    |

## What each option costs at volume (estimates)

Assumes one Google load per event-page view that is not already cached in the
visitor's browser, and 20 tile reads per street-map view. The Google column is the
worst case: since the edge cache (see "Open exposure"), views of the same venue
share one load, so the real figure is lower.

| Monthly map views | Google venue image | Self-hosted street map                          |
| ----------------- | ------------------ | ----------------------------------------------- |
| 10,000            | $0                 | about $2 (storage only)                         |
| 100,000           | about $180         | about $2                                        |
| 1,000,000         | about $1,980       | about $5–10 (storage + reads + Worker requests) |

The storage in the right-hand column is the whole planet's, the ceiling. The
file loaded is the United States subset (owner, 2026-11-10), which is smaller;
a dry run on 2026-11-15 gave it as 20 GB for build `20261109`, and one on
2026-11-16 gave the same 20 GB for build `20261115`, the build named now, and
9.7 GB with the top zoom of 14 the cut has since that day: $0 to about $0.15 a
month in storage (decision 4).

## Where each line sits in the tiers

- **Free / Local:** hexagons with place names on the public map. No report map. Cost: $0.
- **Mid ($49/month target):** the corridor map in the SharedReport is the paid line
  (`REPORT-DEPTH.md`). The street-map layer lands here first. At self-hosted prices
  the map cost per Mid customer is cents; the revenue funds the build, not a bill.
- **Enterprise:** the same map across markets (portfolio) and in the client's styling.
- **Public attendee experience is tier-blind** (Invariant #5). A street map on the
  public map is either on for every event or for none.

## Decisions

1. **No paid map service before paying customers** (PO, 2026-10-03). First release
   is hexagons plus place names.
2. **Street map = self-hosted OpenStreetMap (Protomaps) in our own Cloudflare
   storage**, when built: no per-view fee, and no outside company sees a visitor.
3. **Google is the only per-view map cost today, and it is driven by unpaid public
   traffic.** It is free up to 10,000 loads a month. Before public traffic nears
   that, either cap the Google quota or move the venue image to the self-hosted map.
4. **The street map is drawn by the server, as SVG** (owner, 2026-11-09), not as an
   interactive map in the browser. It keeps hex-map standard rule 10 (no JavaScript,
   no browser fetch), and the server, not the visitor, picks which tiles to read, so
   no tile request says where a person looked. The Worker reads at most 12 tiles
   (zoom 14 or coarser) per landing render where the map draws, plus directories it
   keeps per isolate. Tiles that sit together in the file come from one R2 read
   (2026-11-10). Measured on build `20261109` for three views: 3 reads for a first
   map and 1 for the next, where reading each tile by itself took 8 to 14 and 6
   to 12. At 1 million such views that is 1 to 3 million R2 reads, inside the
   free 10 million; tile by tile it was about 12 million, about $0.75 a month.
   Any failure, or a read slower than 1.5 s, draws the hexagons alone. The
   OpenStreetMap credit shows whenever streets do.

   **What those figures are, and are not (2026-11-15):** the read counts were measured
   from a workstation against the whole build at Protomaps, not through a Worker and not
   from R2, and not on the United States file, which does not exist yet. "Any failure
   draws the hexagons alone" holds when the read returns nothing. A layer that is read
   and drawn badly (water and no roads, for one) is not a failure to the code: it is
   shown, with the credit. The 1.5 s limit has no measurement on the Worker's path behind
   it. See "What is drawn where today".

   **Turning it on (owner steps, 2026-11-09 and 2026-11-10):** the archive is on
   our own Cloudflare account, and staging gets it before production. It is the
   **United States subset** of a Protomaps build: the 50 states, DC, Puerto Rico
   and the US Virgin Islands, cut out with `pmtiles extract` (owner, 2026-11-10,
   in place of the whole planet chosen on 2026-11-09). Areas outside it draw
   hexagons only. **By dry run that file was 20 GB for build `20261109`**
   (`measure` run 43753563640, 2026-11-15): the tile data alone, rounded, so at
   most 20.55 GB, with every zoom of the build kept. It is a dry-run figure, not
   the size of a loaded file. That build aged out at Protomaps before any load;
   the build named since 2026-11-16, `20261115`, was measured the same way that
   day (`measure` run 43792020396): **20 GB by dry run with every zoom kept**,
   and **9.7 GB by dry run with a top zoom of 14**, the deepest zoom the Worker
   reads, about 10.3 GB less. These too are dry-run figures (the tile data
   alone, rounded, without the new directories), not the size of a loaded
   file. **On those figures the owner decided, on 2026-11-16, that the cut
   gets a top zoom of 14**; the build is offered through 2026-11-21 (UTC). So
   the file a load cuts is the 9.7 GB one by dry run. At $0.015 per GB-month
   its storage is about **$0.15 a month** if something else uses the account's
   free 10 GB, and **nothing** while the file and whatever else the account
   stores stay inside it (what else the account stores was not read, and the
   loaded file's size is not known until a load). With every zoom kept, the
   20 GB file would have been about $0.15 a month if nothing else used the
   free 10 GB, and about $0.30 if something did. The load run reports the byte size
   when the file is cut, and the storage figures here are then replaced. The
   steps, the names, the region and the way back to hexagons only are in
   [`../runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md`](../runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md).
   The `MAP_TILES` binding for `[env.staging]` is on `main`. Its bucket,
   `ose-map-tiles`, is **one bucket that staging and production both read**
   (owner, 2026-11-14): the file is stored once and loaded once, and a loaded
   object is locked against change and delete. The bucket exists: the staging
   deploy of 2026-11-15 made it (the plan was that the owner would, see the
   runbook, "When the binding lands before the bucket"). The load workflow,
   dispatched by the owner, loads the file
   `MAP_TILES_ARCHIVE` names (no step runs on the owner's computer).
   Production gets a binding to the same bucket in its own PR afterwards; until then
   `scripts/ci/env-parity.mjs` lists the difference as open and production shows
   hexagons only. Local dev has its own binding and reads the regional file.

   **A layer needs tiles** (2026-11-09): when the archive holds no tile for the
   frame, the Worker draws no street layer at all, so the zoomed area lists its
   places and never puts dots on a blank rectangle. From 2026-11-15 (street-map
   CCR, R15) the same holds when any one tile of the frame is missing: every
   tile of the frame, or hexagons only.

5. **Tap a hexagon to zoom in; events show as dots** (owner, 2026-11-09). On the
   landing each hexagon links to `/?area=<res-7 cell>`, which the Worker draws as
   that one area over the street map, with a numbered dot per place that holds an
   event. Each dot links to its event, or to its row in the list when it holds
   several. The type, date and where pills filter the dots as they filter the cards,
   still with no JavaScript. **Where a dot sits:** every place sits at the centre
   of its res-9 cell (about one block), a business too. No dot is drawn at an exact
   point. A place the lookup named a business or landmark
   (`events.place_kind = 'business'`, migration 0106) is drawn solid and named; anything
   else, which can be a home, is drawn as a block. A missing kind is drawn as a block.
   Events on one block share a dot. Only a res-7 cell is accepted; anything finer is
   ignored. (Corrected 2026-11-15: this paragraph said a business sat at its exact
   point. The code is stricter, `mapDots` in `lib/attendee-map.ts`.)

   **Not shown yet:** the dots need a street layer, and no archive is loaded. Whether
   a dot for a home-hosted event over legible streets is wanted is an open owner
   question (street-map review 2026-11-15, finding R9).

   **Cost:** the zoomed view reads the same 12 tiles at most as the hexagon view, so
   decision 4's figure holds per view. Kinds for events placed before 0105 are filled
   by the nightly place job from what is left of its 25 lookups a night; the nightly
   Google spend does not go up.

## If a large client arrives (American Bocce Co. or similar)

The PO needs a plan and a reaction ready for this inside the next year
(2026-10-03). For mapping, the reaction is fixed in advance:

| Question                                | Answer                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does their traffic change the map bill? | On Google, yes: a million venue-image loads is about $1,980 a month. Self-hosted, about $5–10.                                                                                                                                                                                                                                                                                                            |
| What do we do on signing?               | Finish the self-hosted street map and move the venue image onto it **before** their events go live. Until that ships, set a daily quota cap on the Google key. **State on 2026-11-15: the street map's code is merged and it draws nowhere.** No archive is loaded, the review of that day scored it 0%, and nothing moves the venue image onto it. Do not tell a signing customer the street map exists. |
| Who pays?                               | Their Mid or Enterprise fee. Self-hosted, the map costs a few dollars a month even at a million views, so it is covered by a single $49 Mid seat.                                                                                                                                                                                                                                                         |
| What do they get that others do not?    | Nothing on the public map (tier-blind). In reports: the corridor map across their venues, the portfolio roll-up, and their own styling through OurSharedMagnets.                                                                                                                                                                                                                                          |
| What must be true first?                | The exposure below is closed, and the count of map loads is being read from `OPERATION_COST` monthly.                                                                                                                                                                                                                                                                                                     |

Their actual volumes are unknown; re-run the table above with their numbers at intake.

## Open exposure

**Fixed in code on 2026-10-03** (`handlers/venue-image.ts`, gate
`tests/venue-image.spec.ts`). **Still open: the daily quota cap on the key in
Google Cloud**, which is set in the Google console, not in this repo.

What it was: `GET /api/v2/maps/venue-image` took any `venue` text up to 200
characters and made a billed Google request for it. The route had no rate limit,
and the response was cached only in the visitor's browser. A script varying the
`venue` text could spend the free allowance and then run up charges.

What the route does now:

- **It is keyed by event, not by text.** `?event=<id>` only; `?venue=` is a 400. The
  venue text comes from the event row, and only for an event whose public page
  renders (published, not draft or ready). Anything else is a 404 with no Google
  request. The set of billable strings is the set of venues on public events.
- **It is rate-limited** at the router with the public-read limit
  (`publicReadLimited('venue-image', …)`).
- **It is cached at the edge**, keyed by the venue text (case and spacing ignored).
  A repeat view, or a second event at the same venue, makes no Google request for a
  day per Cloudflare location. A Google failure is remembered for 60 seconds.

What the code does not bound: the edge cache is per Cloudflare location and can be
evicted, and the rate limiter fails open when its storage is down. The quota cap in
Google Cloud is the only hard ceiling on the bill.

## How the cost is observed

`OPERATION_COST` logs one line per request with a masked route label. Since the edge
cache, the count of `GET /api/v2/maps/venue-image` lines per month is an **upper
bound** on billable Google loads (cache hits are counted but not billed); the exact
count is in the Google Cloud console for the key. A self-hosted street map would add
one tile route to count the same way.

## Sources (read 2026-10-03)

- Google Maps Static API: 10,000 free loads/month, then $2.00 per 1,000 — <https://developers.google.com/maps/billing-and-pricing/pricing>
- Cloudflare R2: $0.015/GB-month, Class B $0.36/million, 10 GB and 10 million Class B free, no egress fee — <https://developers.cloudflare.com/r2/platform/pricing/>
- Protomaps: planet file about 120 GB; R2 recommended for hosting — <https://docs.protomaps.com/basemaps/downloads>, <https://docs.protomaps.com/pmtiles/cloud-storage>
- Read again on 2026-11-09 for the load (upload limits, the S3 token, multipart operations), and on 2026-11-10 for cutting the United States subset (`pmtiles extract`): see the list in [`../runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md`](../runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md). R2's prices were unchanged.

## Measured in the street-map proof (2026-10-03)

The self-hosted line above was written from published figures. A local proof
(`proofs/street-map/`, not shipped, nothing on staging or production) measured it
for one region. These replace the estimates for that region only. The planet
rows are kept as the ceiling: the file loaded is the United States subset, and
**its loaded size and storage cost are not measured until a load is recorded**
(the runbook's step 5). The dry-run figures, 20 GB on 2026-11-15 for build
`20261109`, and on 2026-11-16 for build `20261115` 20 GB with every zoom kept
and 9.7 GB with a top zoom of 14, which is how the file is cut since that day,
are under decision 4.

| Item                                 | Measured                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| Region                               | Chicago area: west -91.0, south 40.9, east -86.2, north 43.3                   |
| Protomaps build                      | `20261003.pmtiles`; the planet file is 138.5 GB (not the 120 GB assumed above) |
| Regional file                        | **464,372,385 bytes (0.464 GB)**, zoom 0–15, 143,442 tiles                     |
| R2 storage for the region            | **$0.007 a month** at list price; $0 while the account stays under 10 GB       |
| R2 storage for the whole planet      | about $1.93 a month at list price, after the free 10 GB                        |
| Tile reads for one first map view    | **6–11** range reads, 91–634 KB (the estimate above was 10–30)                 |
| Browser libraries (once per visitor) | 1.27 MB raw, 330 KB gzip (MapLibre GL JS, PMTiles reader, style)               |
| Fonts and sprites stored             | 1.9 MB fonts (3 faces, Latin ranges) + 0.1 MB sprites                          |
| Transfer to cut the regional file    | 487 MB, 124 requests, about 1 minute                                           |

Each tile read is also one Worker request, billed under the Workers plan.

Not measured: reads per visit once a visitor pans and zooms; how much the 24-hour
browser cache cuts repeat reads; whether tile reads can be cached at Cloudflare's
edge (the proof answers byte ranges, HTTP 206, which the edge cache does not store
from a Worker).
