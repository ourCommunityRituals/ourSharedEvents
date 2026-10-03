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

| Layer                             | What it is                                                                                                                | Status                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **H3 hexagons**                   | Server-drawn SVG from res-7 cell ids (`lib/attendee-map.ts`, `lib/corridor-map.ts`). No tiles, no JS, no outside request. | Shipped                |
| **Venue image**                   | One Google Static Maps image per venue, fetched by the Worker (`GET /api/v2/maps/venue-image`, `lib/maps.ts`).            | Shipped on event pages |
| **Street map under the hexagons** | A political/street base map with the hexagons drawn on top.                                                               | Not built              |

## Cost lines

| Line                                     | Fixed / month                                                                      | Variable                                                          | Driver                                   | Who triggers it                     | Who pays                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- | ----------------------------------- | ------------------------------------ |
| H3 hexagons                              | $0                                                                                 | $0 beyond Worker compute                                          | page views                               | everyone                            | platform (inside the Workers plan)   |
| Place names on hexagons (first release)  | $0                                                                                 | $0                                                                | page views                               | everyone                            | platform                             |
| Google venue image (today)               | $0                                                                                 | first 10,000 loads/month free, then **$2.00 per 1,000**           | one load per uncached image request      | **attendees on public event pages** | platform — not tied to any paid tier |
| Self-hosted street map (Protomaps on R2) | storage: **$0.015/GB-month** (whole planet ≈ 120 GB ≈ **$1.80**; first 10 GB free) | reads: **$0.36 per million** after 10 million free; no egress fee | tile reads per map view (estimate 10–30) | whoever sees the street map         | funded by Mid revenue (see below)    |

## What each option costs at volume (estimates)

Assumes one Google load per event-page view that is not already cached in the
visitor's browser, and 20 tile reads per street-map view.

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

## Open exposure (not yet fixed)

`GET /api/v2/maps/venue-image` takes any `venue` text up to 200 characters and makes
a billed Google request for it. The route has no rate limit of its own in
`router.ts`, and the response is cached only in the visitor's browser. A script
varying the `venue` text could spend the free allowance and then run up charges.
Mitigations, cheapest first: set a daily quota cap on the key in Google Cloud;
wrap the route in the public-read rate limit; accept only venues that belong to a
published event; cache each image at the edge.

## How the cost is observed

`OPERATION_COST` already logs one line per request with a masked route label, so the
count of `GET /api/v2/maps/venue-image` lines per month is the count of billable
Google loads. No new metric is needed for the current layers. A self-hosted street
map would add one tile route to count the same way.

## Sources (read 2026-10-03)

- Google Maps Static API: 10,000 free loads/month, then $2.00 per 1,000 — <https://developers.google.com/maps/billing-and-pricing/pricing>
- Cloudflare R2: $0.015/GB-month, Class B $0.36/million, 10 GB and 10 million Class B free, no egress fee — <https://developers.cloudflare.com/r2/platform/pricing/>
- Protomaps: planet file about 120 GB; R2 recommended for hosting — <https://docs.protomaps.com/basemaps/downloads>, <https://docs.protomaps.com/pmtiles/cloud-storage>
