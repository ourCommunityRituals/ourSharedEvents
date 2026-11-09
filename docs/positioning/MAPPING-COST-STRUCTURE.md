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

| Layer                             | What it is                                                                                                                     | Status                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **H3 hexagons**                   | Server-drawn SVG from res-7 cell ids (`lib/attendee-map.ts`, `lib/corridor-map.ts`). No tiles, no JS, no outside request.      | Shipped                                                                   |
| **Venue image**                   | One Google Static Maps image per venue, fetched by the Worker (`GET /api/v2/maps/venue-image`, `lib/maps.ts`).                 | Shipped on event pages                                                    |
| **Street map under the hexagons** | Water, roads and town names drawn by the Worker as SVG under the hexagons (`lib/street-map.ts`), from a PMTiles archive in R2. | Built on the landing map; off until `MAP_TILES` is bound (see decision 4) |
| **Zoomed area with event dots**   | A tapped hexagon drawn alone over its streets, one dot per place (`lib/attendee-map.ts`, `/?area=`).                           | Built on the landing map (see decision 5); streets need `MAP_TILES`       |

## Cost lines

| Line                                     | Fixed / month                                                                      | Variable                                                                                                                               | Driver                                                                                                                                  | Who triggers it                           | Who pays                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------ |
| H3 hexagons                              | $0                                                                                 | $0 beyond Worker compute                                                                                                               | page views                                                                                                                              | everyone                                  | platform (inside the Workers plan)   |
| Place names on hexagons (first release)  | $0                                                                                 | $0                                                                                                                                     | page views                                                                                                                              | everyone                                  | platform                             |
| Google venue image (today)               | $0                                                                                 | first 10,000 loads/month free, then **$2.00 per 1,000**                                                                                | one load per venue, per Cloudflare location, per day (edge-cached)                                                                      | **attendees on public event pages**       | platform — not tied to any paid tier |
| Google place lookup (Geocoding)          | $0                                                                                 | Google's Geocoding list price after its free monthly allowance is **$5.00 per 1,000** (not re-read for this change; check the console) | one lookup per event save that changes the place, plus at most **25 a night** for events saved before 2026-10-11 (`lib/event-place.ts`) | **organizers** saving events (admin only) | platform                             |
| Self-hosted street map (Protomaps on R2) | storage: **$0.015/GB-month** (whole planet ≈ 120 GB ≈ **$1.80**; first 10 GB free) | reads: **$0.36 per million** after 10 million free; no egress fee                                                                      | tile reads per map view (estimate 10–30)                                                                                                | whoever sees the street map               | funded by Mid revenue (see below)    |

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
   keeps per isolate: at 1 million such views that is about 12 million R2 reads,
   about $0.75 a month after the free 10 million. Any failure, or a read slower than
   1.5 s, draws the hexagons alone. The OpenStreetMap credit shows whenever streets do.

   **Turning it on (owner steps):** create an R2 bucket per environment, load the
   regional archive (`proofs/street-map/README.md`, step 1), then add a `MAP_TILES`
   binding to `[env.staging]` and `[env.production]` in `wrangler.toml` in one PR
   (`MAP_TILES_ARCHIVE` names the file; the default is `chicago-region.pmtiles`).
   Until then staging and production show hexagons only. Local dev has the binding.

5. **Tap a hexagon to zoom in; events show as dots** (owner, 2026-11-09). On the
   landing each hexagon links to `/?area=<res-7 cell>`, which the Worker draws as
   that one area over the street map, with a numbered dot per place that holds an
   event. Each dot links to its event, or to its row in the list when it holds
   several. The type, date and where pills filter the dots as they filter the cards,
   still with no JavaScript. **Where a dot sits:** a place the lookup named a
   business or landmark (`events.place_kind = 'business'`, migration 0106) at its
   exact point; anything else, which can be a home, at the centre of its res-9 cell
   (about one block). A missing kind is drawn as a block. Only a res-7 cell is
   accepted; anything finer is ignored.

   **Cost:** the zoomed view reads the same 12 tiles at most as the hexagon view, so
   decision 4's figure holds per view. Kinds for events placed before 0105 are filled
   by the nightly place job from what is left of its 25 lookups a night; the nightly
   Google spend does not go up.

## If a large client arrives (American Bocce Co. or similar)

The PO needs a plan and a reaction ready for this inside the next year
(2026-10-03). For mapping, the reaction is fixed in advance:

| Question                                | Answer                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does their traffic change the map bill? | On Google, yes: a million venue-image loads is about $1,980 a month. Self-hosted, about $5–10.                                                                   |
| What do we do on signing?               | Build the self-hosted street map and move the venue image onto it **before** their events go live. Until that ships, set a daily quota cap on the Google key.    |
| Who pays?                               | Their Mid or Enterprise fee. Self-hosted, the map costs a few dollars a month even at a million views, so it is covered by a single $49 Mid seat.                |
| What do they get that others do not?    | Nothing on the public map (tier-blind). In reports: the corridor map across their venues, the portfolio roll-up, and their own styling through OurSharedMagnets. |
| What must be true first?                | The exposure below is closed, and the count of map loads is being read from `OPERATION_COST` monthly.                                                            |

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

## Measured in the street-map proof (2026-10-03)

The self-hosted line above was written from published figures. A local proof
(`proofs/street-map/`, not shipped, nothing on staging or production) measured it
for one region. These replace the estimates for that region only.

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
