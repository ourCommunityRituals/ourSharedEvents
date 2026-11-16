# ADR-039: Stop our own systems calling Google Maps, starting with an event's place on the map

**Status:** Proposed. **The direction is the owner's ruling of 2026-11-16** ("The owner's ruling",
below): Google Maps is removed from our own systems, our own map is the map of record, and links
out for navigation stay. **How each call is replaced is not chosen**: those choices are in "Open,
for the owner", and merging the pull request that carries this record accepts none of them.
Nothing is built. It stays Proposed, not Accepted, because the code still calls Google: by this
repository's rule an Accepted record describes what is live. No runtime code changes with it, and
neither does `AGENTS.md`, `CLAUDE.md` or `OCR_VISION.md`.
**Date:** 2026-11-16
**Deciders:** Owner (PO). Dr of Security advises on what leaves the Worker and what is kept.
Counsel, for the terms questions marked below.
**Ticket:** OSE-1908 (epic OSE-1880); OSE-1985 (the venue image)

## Context

The landing map shows events as H3 hexagons over our own OpenStreetMap street layer (OSE ADR-035,
OSE ADR-036). No Google tile or image is drawn under either map. Google is under the map in one
way only: as data. When an event is saved, its address text goes to Google's geocoder, and both
map cells are worked out from the point that comes back.

The owner, 2026-11-09, ruled against Google Maps under the map ("this defeats the privacy on the
maps pov"), said links a visitor chooses to open are fine, and expected the lookup "would not pass
legal". The owner, 2026-11-16, asked whether Google's terms cover dots its geocoder placed over
OpenStreetMap streets: "I was trying to avoid interacting with google maps if I could. Are you
telling me there is no way to get around this interaction?" There is a way round. The lookup is
one optional call, and this record sets out three replacements for it.

**Scope, in the owner's words (2026-11-16):** "it being the analysis to not use google maps if
possible", and "I understand there will linking out, but I am speaking to the OCR/OSE/OW
internals". Read here as: in scope is every call our own systems make to Google Maps, in OSE,
ourWKRP and the spine. A link a visitor chooses to follow to Google is out of scope and may stay
(see "Link-out only"). The search of the three repositories is under "Across the repositories".

**What this record is not.** The location-precision review of 2026-11-09 ended at 0% and ruled that
no place or map text lands before a new ADR. Its owner decisions are still open: the finest
precision a public map may draw (res 7 or res 9), home addresses, whether "off the map" is a
privacy control, the paths that publish a place without the organizer choosing, and finding F37.
This record settles none of them, proposes no wording for invariant 3 or the vision, and does not
bring back that review's frozen drafts. The rule for what a public output may carry of a place is
a different record, which that review places in OCR-docs. This one takes a single question: what
our systems send to Google Maps, and what could stand in its place. Where an option depends on an
open decision, it says so.

### What the code does today

Read on `main` at `457f4ffe`, 2026-11-16. Paths are under `workers/oursharedevents/src/`.

**Calls the Worker makes to Google** (`maps.googleapis.com`, with the secret
`GOOGLE_MAPS_API_KEY`):

| #   | Call                                                    | When                                                                                                                                                                                            | What is sent                               | What is kept                                                                                                                               |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Event place lookup (`lib/event-place.ts`, `lib/geo.ts`) | On create when no coordinates were sent, on update when the place text changed (`handlers/events.ts`), and nightly for at most 25 events (`runEventPlaceBackfill`, then `runPlaceKindBackfill`) | The street address, else the place name    | `events.lat`, `lon`, `h3_res9`, `h3_res7`, `place_kind`, `place_checked_at`. Kept only when Google names a spot and it is not a part match |
| G2  | Admin lookup route (`POST /api/v2/admin/geocode`)       | The admin poster card, when an address is typed for where a poster hangs (`templates/admin.html`)                                                                                               | The address                                | The point goes back to the browser, which sends it with the poster: `poster_deployments.latitude`, `longitude` and both cells              |
| G3  | Sponsor sign-up draft (`handlers/sponsors-draft.ts`)    | A sponsor saves a draft with an address                                                                                                                                                         | The address                                | `sponsor_business_draft.lat`, `lon` and both cells                                                                                         |
| G4  | Venue image (`lib/maps.ts`, `handlers/venue-image.ts`)  | A visitor's view of an event page or a SharedReport, when the image is not in the edge cache                                                                                                    | The place name, else the address, as a pin | The image, in the edge cache for a day                                                                                                     |

With no key set, G1 is skipped and the save still succeeds: the event then has no cell, and the
nightly job does nothing. Whether the key is set on staging or production was not read (an agent
does not read secrets).

All four are a plain `fetch` to one host, `maps.googleapis.com`, at two addresses (the geocoder
and the static map). There is no Google SDK or package, and one secret name. The name appears in
`wrangler.toml` (two comments), `docs/deployment/INFRA-CHECKLIST.md` and a production-preflight
test fixture. No repository-level GitHub secret or variable name matches Google or Maps (names
listed 2026-11-16; environment-level names and the Worker's own secrets were not read).

**A visitor's browser cannot reach Google from an OSE page.** The page policy is
`img-src 'self' data:; connect-src 'self'` (`handlers/pages.ts`), so no Google image, script or
request loads in the page. The venue image is served from our own address. Old tests under
`tests/e2e/` and `archive/` still look for a Google Maps frame from the Apps Script product; no
page under `src/` has one.

### Link-out only

These send nothing unless the visitor follows them, and then the visitor's own browser goes to
Google (`rel="noopener noreferrer"`, so no referrer). They are outside the owner's scope and none
of the options below removes them.

- **Directions** (`lib/geo-link.ts`, on the event page): Google Maps and Apple Maps. Each carries
  the stored point when the event has one, else the address or place name. The poster page has a
  Google Maps link by place text (`templates/poster.html`).
- **Calendar** (`lib/calendar-links.ts`, on the event page and after a registration): a Google
  Calendar link carrying the title, the dates, the description and the place text, beside an
  `.ics` file; and a subscribe link for a brand's feed (Google and Outlook).

One thing ties them to this record: a Directions link carries a stored point. If an option stops
storing a point, the link carries words, which the code already does when a point is missing.
What a public link may carry is the precision review's question, not this record's.

### Across the repositories

Searched 2026-11-16 for Google Maps hosts, SDK names, key names and environment names. Names only;
no value was read.

| Where                                                        | Read at                                              | Calls to Google Maps from our systems                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **OSE** (this repository)                                    | `main` at `e7d21601`, whole repository               | The four above. Nothing else.                                                                                                          |
| **ourWKRP**                                                  | its `main` at `b1ae6d9` (matched against the remote) | **None.** No host, SDK, key or environment name. Its showcase draws its maps from OSE's public area route at build time (OSE ADR-033). |
| **The spine** (OurCommunityRituals: `packages/*`, workflows) | its `main` at `862171e` (matched against the remote) | **None.** The only matches are archived design notes that use the word "geocode" about OSE's sponsor draft.                            |
| The six other product repositories beside them               | local checkouts as they stood, not their `main`      | No match. A weak read: 5 to 40 files each, and not compared with the remote.                                                           |
| OCR-docs                                                     | not searched                                         | It holds documents, not a running system. The local copy of its `main` was behind the remote.                                          |

Two things the search found that are Google but not Google Maps, so outside this record:

- OSE's Worker calls Google Cloud for the BigQuery export (`cloud/config.ts`, `google/auth.ts`).
- ourWKRP's showcase pages load their fonts from Google's font hosts (`showcase/lib/render.mjs`).
  That is a request a visitor's browser makes to Google without choosing to. It is not a map, and
  it is the owner's to weigh.

### What is kept, and what we already host

**The point is kept, not only used.** AGENTS.md invariant 3 says admin placement writes take
coordinates only to derive the cell. The handlers do derive the cell (`maybeTag` in
`lib/h3-tagging.ts`), and they also store the coordinates: the event insert and update
(`handlers/events.ts`) and the poster insert and update (`handlers/poster-deployments.ts`). No
handler today takes a coordinate, works out the cell and drops the coordinate. So "not stored as a
point" in option 1 is new behaviour, not a description of what exists.

**What reads an event's stored point today:** the Directions links (`handlers/pages.ts`); the
zoomed area's dots, which use it only to find the event's res-9 block and list an event without
one as "somewhere in this area" (`lib/attendee-map.ts`); a venue poster, which takes the event's
point as its own (`handlers/poster-deployments.ts`); the repeat-event copy (`lib/event-repeat.ts`);
and the public event columns, which list `lat` and `lon` (`lib/public-event-projection.ts`,
`handlers/events-map.ts`). Any option that stops storing a point changes each of these.

**What we already host.** `lib/zip-areas-data.ts` holds the centres of 33,791 US Census ZIP Code
Tabulation Areas (public domain data, packaged by `us-zips` 2022.9.1, MIT). The landing search
already turns a typed zip into a res-7 cell with it (`lib/zip-areas.ts`), and `addressZip` already
reads the zip an address ends with. `lib/place-names-data.ts` holds US town names with their zips
(GeoNames, CC BY 4.0). No admin page draws a map: the poster card has two number boxes for
latitude and longitude.

**Sizes.** A res-7 cell is about 5.2 km² and 2.4 km across. A res-9 cell is about 0.1 km² and 350 m
across (arithmetic from H3's average cell areas).

## Decision (proposed)

### The owner's ruling

Shown this record's four calls, the empty search of ourWKRP and the spine, and the link-outs, the
owner answered on 2026-11-16, word for word (relayed to the author by the session the owner was
working in):

> "Yes.. Then Google maps is removed and my map is the map of record until the user clicks out
> for navigation"

What that sentence decides:

- **D1. Google Maps is removed from our own systems.** All four calls go: G1, G2, G3 and G4.
  Keeping the Google lookup (Alternative A) is refused.
- **D2. Our own map is the map of record:** the self-hosted street archive under the H3 layer
  (OSE ADR-035, OSE ADR-036).
- **D3. Links out for navigation stay.** The Directions links are untouched by this record.

What it does not decide, and this record does not decide for the owner:

- How an event gets its place once G1 is gone: option 1, option 2, or both.
- Whether the venue image is removed or redrawn from our own map. "My map is the map of record"
  leans toward redrawn; the owner did not say so.
- What happens to the points already stored from Google.
- The sponsor's "local" rule, the fonts in ourWKRP, and a rule for every product.
- Any of the location-precision review's decisions.

The Calendar link is not navigation. It stays under the owner's scope statement in "Context"
(linking out is understood), not under this sentence.

### The choices that remain

No option is chosen here. What follows is the shape of each remaining choice, call by call: for
G1 three options, each of which the owner can accept or refuse by itself (options 1 and 2 can be
accepted together); for G2, G3 and G4 what could replace each with nothing sent to Google; and a
recommendation that is the author's and not a ruling.

### G1. The event's place: three options

G1 is the large one. Without it an event has no source for a cell, so it needs a replacement and
not only a removal. Options 1 to 3 below are that replacement.

### Option 1. The organizer taps the spot on our own map

The admin shows our own map of the area the organizer named (a zip or a town, from the tables we
host). The organizer taps where the event is. Only the cell is kept.

Two forms, and the difference matters:

- **1a. Cells only.** The Worker draws the area as hexagons over the street layer, as the landing
  does, and each hexagon is a control that carries its own cell id. A tap posts a cell. No
  coordinate exists in the browser, in the request or in a log. This is how the public map read
  already works (`handlers/events-map.ts` refuses coordinate-shaped input), applied to a write.
- **1b. A coordinate, then dropped.** The browser sends the tapped latitude and longitude, the
  Worker works out the cell and does not store the point. Invariant 3's words allow this. It holds
  by policy and not by construction: the coordinate is in the request.

A res-7 cell can be picked from a frame of its neighbours. A res-9 cell can be picked only inside
one res-7 area: that area holds 49 of them. Whether each is large enough to tap in the landing's
frame was not worked out. Whether an event gets a res-9 cell at all is the open precision
decision, not this record's.

| Question                         | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What leaves the Worker           | Nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Cost                             | A map in the admin, which has none. One more step in each create flow. A way to place an event without a pointer or sight (a list of the same areas by name), because a tap-only control fails the accessibility gate. A path for automation, which has nobody to tap: it sends a cell or a zip. Nothing can be tapped sensibly until the street archive is loaded: a hexagon grid with no streets under it tells an organizer nothing. |
| What a test would have to prove  | A write that carries a coordinate-shaped field is refused (1a). The stored row has cells and no point, and its res-9 cell's parent is its res-7 cell. A cell far from the zip or town the organizer named is refused or asked about again. The placement can be done by keyboard alone, on staging. Each case in the workers pool and on staging, and each seen red on an injected fault.                                               |
| Events that already have a point | Their cells stay as they are until the organizer places the event again. The stored point can then be cleared, once the readers listed above use the cells or the words instead. Whether a cell worked out from a Google point may be kept after the point is gone is a question for counsel (see "What the pages say").                                                                                                                |
| Depends on                       | The street archive on staging (an owner step, not done). The precision decision, for res 9.                                                                                                                                                                                                                                                                                                                                             |

### Option 2. Zip code to cell, from the table we host

On save, the Worker reads the zip the address ends with (or a zip box in the form), finds that
zip's centre in the table we already ship, and stores the res-7 cell the centre is in. No lookup,
no network call, no new table.

**Say it plainly: this is good for the res-7 hexagon map and too coarse for a res-9 dot.** And the
res-7 answer has a limit of its own: the cell is the cell of the zip's centre, not the cell of the
venue. Measured on our table on 2026-11-16: the median zip centre has its nearest neighbour 7.5 km
away, a quarter have one within 4.4 km, and 9% have one within the width of a single res-7 cell. So
a typical zip covers several res-7 cells, the hexagon that lights up can be a cell or more away
from the venue, and every event in one zip shares one hexagon. That is honest for "what is going on
in this zip area", which is the question the landing asks. It is not a place on a street. A res-9
cell taken from a zip centre would name a block the event is not on, so none is stored.

| Question                         | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What leaves the Worker           | Nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Cost                             | Small: the table and the two functions exist. An address with no zip at its end needs a zip box, or the town table. A zip the table lacks gets no cell: the Census page says "Not all valid ZIP Codes are represented by a 2020 ZCTA". United States only. The kind of place (business or address) came from Google's answer and has no source here. No res-9 cell, so no dot on the zoomed area and no point for a venue poster to copy. |
| What a test would have to prove  | Known addresses give the expected res-7 cell. No res-9 cell and no point is stored when the source is a zip. A zip that is not in the table gives the organizer the "not found" notice and never fails the save. The landing's zip search finds the event under its own zip. The save makes no outbound request at all, proven by a case that goes red when one is injected. Each case in the workers pool and on staging.                |
| Events that already have a point | They can stay, or be worked out again from their zip. Working them out again moves each event to its zip centre's hexagon and clears its res-9 cell and its point, so it is a visible change on the map and should be counted on staging first.                                                                                                                                                                                           |
| Depends on                       | Nothing that is open. Res 7 is allowed under either answer to the precision decision.                                                                                                                                                                                                                                                                                                                                                     |

### Option 3. A lookup service that is not Google

The address text still leaves the Worker and goes to a third party, on every save. That is the
same shape as today with a different receiver. Four candidates were looked at.

| Candidate                                                              | What it would do for us                                                                                        | What stands in the way                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3a. The US Census Geocoder**                                         | Street address to a point, free, no key seen in its examples. United States, Puerto Rico and the Island Areas. | It wants a structured street address, so a venue name alone ("Rock Island Public House", the case the lookup was added for) does not match. The point is worked out along an address range, not at the door. No page read says anything on keeping results or on what is logged. |
| **3b. The public Nominatim service** (OpenStreetMap Foundation)        | Address or place name to a point, from OpenStreetMap data.                                                     | Its policy asks callers not to send personal data, and a home's address can be that. It runs on donated servers, has no service promise, and access can be withdrawn. One request a second at most.                                                                              |
| **3c. Our own geocoder on OpenStreetMap data** (Nominatim, or another) | Address to a point with no third party at all.                                                                 | It is a server, and OSE is one Worker and D1. Nominatim's manual asks for 128 GB of memory and 1 TB of disk for the planet; no figure for a smaller extract was found. Somebody would run, patch and pay for it.                                                                 |
| **3d. A commercial service built on OpenStreetMap data**               | The same as 3b with a contract.                                                                                | No such service's terms were read. Not proposed until they are.                                                                                                                                                                                                                  |

| Question                         | Answer                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What leaves the Worker           | The organizer's place text, to the service, on create, on a changed place and nightly. For a home event that is a home address.                                                                                                                                                                                                                                                                  |
| Cost                             | The code change is small (one function behind `geocodeVenue`). The standing cost is a second party: its terms, its uptime, its limits, a credit line where its data shows, and a privacy answer for what it logs.                                                                                                                                                                                |
| What a test would have to prove  | Only the place text is sent: no event id, brand, organizer or visitor value. A slow or failed lookup never fails a save (true today). The same text is not sent twice. The service's rate limit is kept by the nightly job. The credit shows wherever the result shows. A source gate allows exactly one named lookup host and fails on any other. Each case in the workers pool and on staging. |
| Events that already have a point | The shape of the data does not change. Replacing the Google points means sending every stored place text to the new service once. The Census service takes files of up to 10,000 addresses; Nominatim's policy discourages bulk use.                                                                                                                                                             |
| Depends on                       | Counsel, on the service's terms. The home-address decision.                                                                                                                                                                                                                                                                                                                                      |

### G2. The poster's spot (the admin lookup route)

**What it does.** On the admin poster card an organizer types the address where a poster hangs.
The page calls `POST /api/v2/admin/geocode`, the Worker asks Google, and the point comes back to
the browser, which sends it with the poster. The poster row keeps the address, the point and both
cells. A poster marked as the venue's own takes the event's point with no lookup. A poster's res-9
cell is what the SharedReport's map of placements is drawn from.

**What leaves the Worker.** The address where the poster hangs: usually a shop or a hall, and it
can be a home.

**What could replace it, with nothing sent to Google.**

- **A tap on our own map,** on the surface option 1 would build. This is the natural fit: a poster
  is a physical spot, and res 9 for a physical placement is already the written rule (invariant
  3), so the tap is not waiting on the precision decision the way an event's res-9 cell is.
- **The venue's poster takes the event's cell** where it takes the event's point today.
- **Zip to cell** gives res 7 only. A poster placed that way has no res-9 cell and would be
  missing from the report's map of placements.
- The two number boxes for latitude and longitude exist today and would be the fallback until a
  tap exists. They store the point.

**Cost to change.** Small to remove: the route, its handler (`handlers/geocode.ts`), the card's
call in `templates/admin.html`, and `tests/geocode-handler.spec.ts`. The replacement rides on
option 1's admin map, so its cost is that surface's cost, paid once for events and posters.

**A test would have to prove:** a poster can be placed with no outbound request; the row has a
res-9 cell whose parent is its res-7 cell and no point; the route answers 404 after removal; the
report's placement map still draws a poster placed by tap. Workers pool and staging, each seen red.

**Rows that already have a point.** Posters keep their cells. Clearing the stored point is safe
once nothing reads it; today the H3 backfill and the venue default do.

### G3. The sponsor's area (the sign-up draft)

**What it does.** A sponsor invited by a signed link saves a draft with its address. The Worker
asks Google and keeps the point and both cells on the draft. When the draft is promoted, the
sponsor is "local" only if its res-7 cell is the same cell as the event's
(`lib/sponsor-promotion.ts`). The draft is flagged for review either way. Nothing here needs
res 9.

**What leaves the Worker.** The sponsor's business address.

**What could replace it, with nothing sent to Google.** Zip to cell, with the function option 2
uses. It is enough for an area, and it changes what "local" means: a zip centre's cell is often
not the cell the business is in, so "the same cell as the event" would turn on how each side was
placed. Two sponsors on one street could come out differently. The honest rule under a zip source
is "the same zip area as the event", or "within so many cells", and that is a rule about the local
sponsor promise, which is the owner's (see "Open, for the owner").

**Cost to change.** Small in code: one call in `handlers/sponsors-draft.ts` and its tests. The
cost is the rule above. An admin who adds a sponsor directly sends coordinates today
(`handlers/sponsors.ts`) and is not a Google call.

**A test would have to prove:** a draft with an address ending in a zip gets a res-7 cell and no
point, with no outbound request; a draft with no usable zip stays flagged and is never local by
default; the locality rule the owner picks, with a sponsor on each side of its line.

**Rows that already have a point.** Drafts and sponsors keep their cells. Whether locality is
worked out again for sponsors already promoted is part of the rule question.

### G4. The venue image

**What it does.** The event page and the SharedReport's event list show a small map picture of
the venue. The `<img>` points at our own route, `GET /api/v2/maps/venue-image?event=<id>`. On a
miss the Worker asks Google's Static Maps for a road map at zoom 15 with a red marker on the venue
text, and keeps the picture in Cloudflare's edge cache for a day, keyed by the venue text. It is
the only one of the four that runs on a visitor's page view, and the only one billed per view
(free to 10,000 loads a month, then $2.00 per 1,000, `docs/positioning/MAPPING-COST-STRUCTURE.md`).

**What leaves the Worker.** The place name, else the address, of a public event. Google sees
Cloudflare's address, not the visitor's. The picture that comes back is Google's, shown inside our
page with a pin on the address.

**What could replace it, with nothing sent to Google.**

- **Remove it.** The page keeps the venue's words and the Directions links. Nothing is drawn.
- **Draw it ourselves from the street archive.** The event's area over our own OpenStreetMap
  streets, through `loadStreetLayer`, which takes cells and nothing else (OSE ADR-036, D1), with
  the OpenStreetMap credit. `MAPPING-COST-STRUCTURE.md` decision 3 already names this move. It
  shows an area, not a pin: a res-7 hexagon about 2.4 km across. A mark at the venue's block would
  need a res-9 cell and is the open precision decision. It draws nothing until the archive is
  loaded, and the page must be whole without it (the street layer is never the reason a page
  fails). On the SharedReport, OSE ADR-036 D2 already proposes the report's own map on the base
  map; the small picture in its event list could then simply go.
- **Both in order:** remove now, draw our own after the archive is on staging.

**Cost to change.** Removing is small: `lib/maps.ts`, `handlers/venue-image.ts`, the route, the
`<img>` in `handlers/pages.ts` and `templates/shared-report.html`, the `venue-image` name in
`lib/cost-metric.ts`, and `tests/venue-image.spec.ts` and `tests/maps.spec.ts`. Drawing our own is
a medium piece of work on two surfaces and waits on the archive. In money, the Google bill for it
goes to nothing; the self-hosted map is a few dollars a month at a million views by the same
document's estimate.

**A test would have to prove:** the event page and the report make no request to the removed
route and show no broken image; the route answers 404; with a street layer the picture is drawn
from cells only and carries the credit; with no layer the page is whole. Workers pool and staging.

**Rows that already have a point.** None are involved: the image is made from the venue text.
Pictures already in the edge cache age out within a day.

### What each G1 option does to the other pieces

Not decided here. What each option for G1 does to them:

| Piece                                                | Option 1 (tap)                                                                                                                                         | Option 2 (zip)                                                                                                      | Option 3 (another lookup)                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Venue image** (G4, OSE-1985)                       | Untouched by the option: it is its own call to Google, on a visitor's view. If it is to go, our own area map can stand in, from the cell the tap gave. | The same. A stand-in drawn from a zip-centre cell would show the zip's area, not the venue's.                       | The same. A stored point would let a stand-in be drawn near the venue. |
| **Directions links**                                 | With no stored point they carry the address or place name, which the code already does when a point is missing.                                        | The same as option 1.                                                                                               | Unchanged: they carry the point when there is one.                     |
| **Calendar link**                                    | Unchanged. It carries words and dates, never a point.                                                                                                  | Unchanged.                                                                                                          | Unchanged.                                                             |
| **Poster placement and sponsor address** (G2 and G3) | A tap suits a poster: it is a physical spot and res 9 is already its rule. A sponsor's address needs only its area.                                    | Enough for a sponsor's area. Too coarse for a poster, so the report's res-9 map would have no cell for that poster. | Unchanged in shape.                                                    |

If G1 goes and G2, G3 and G4 stay, the Worker still calls Google. "No call to Google" is true only
when all four are answered.

## What the pages say

Read on 2026-11-16 by fetching each page. Where a page did not load or does not say, that is
stated. Nothing here is a legal reading.

**Google.** `developers.google.com/maps/documentation/geocoding/policies` loaded. It says a
latitude and longitude from the Geocoding API may be cached for up to 30 consecutive calendar days
and must then be deleted; that content is not to be created from Google Maps content, with a
place's point used in a spatial analysis as one of its examples; and that place IDs may be stored
without limit. It names no exception for a value worked out from a point, such as a cell. It does
not say whether results may be shown on a map that is not Google's. The two pages of terms it
defers to (`cloud.google.com/maps-platform/terms` and `…/terms/maps-service-terms`) returned only
their titles and were **not read**. `NOTICE.md` question 6 is this same gap.

**US Census Geocoder.** Six pages loaded:
`geocoding.geo.census.gov/geocoder/`, its API page (`Geocoding_Services_API.html`, "Last updated
02/2026"), the technical documentation page on census.gov (revised 2026-05-19), the Census API
terms of service (revised 2026-04-14), the open data policy page and the privacy policy (revised
2026-10-09).

- On keeping results: **no page says anything.** No term on storing, caching, sharing or deriving
  from a result was found, and no licence line for the results. Silence is not a permission.
- On what it matches: "The current Geocoding Services engine requires a structure address be
  provided." Results are "interpolated, or approximated" from address ranges in the Bureau's
  MAF/TIGER data. Coverage is "the United States, Puerto Rico, and the U.S. Island Areas".
- On limits: "an upper limit of 10,000 records per batch file". No per-second limit is stated.
- On what it logs: nothing about addresses sent to the geocoder. The privacy policy covers visits
  to the Bureau's sites and says of its logs: "The logs may be kept indefinitely".
- The Census API terms say the API is provided "as is" and on an "as-available" basis and ask for
  a not-endorsed line. They do not name the Geocoder, so whether they bind it is not known.
- Not read: the Geocoder User Guide and FAQ (two PDFs the pages link to).

**Nominatim and OpenStreetMap.**

- The Nominatim usage policy (`operations.osmfoundation.org/policies/nominatim/`, no date shown)
  sets a maximum of one request a second, asks for an identifying User-Agent or Referer, forbids
  systematic queries and reselling results, says access may be withdrawn and that a caller must be
  able to switch away on request, and asks callers not to submit personal data. On keeping:
  "Results must be cached on your side."
- The Foundation's geocoding guideline
  (`osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline`, endorsed by its
  board 2017-08-24, last edited 2017-08-29) says results "may be stored (either permanently or
  temporarily)", that single results do not trigger the licence's share-alike duty, and that a
  collection built to stand in for the map database would. Credit to OpenStreetMap is asked for.
- The Foundation's privacy policy (last edited 2026-01-25) lists the IP address among what its
  services receive and says Nominatim queries are analysed to improve the data. It does not say
  how long a query's text is kept.
- Nominatim's installation manual (version 5.3.3) gives the server sizes quoted in option 3c.
- `photon.komoot.io`, another public geocoder on the same data, says heavy use is throttled and
  availability is not promised. It states no data licence on that page.

**Census zip areas.** The Bureau's ZCTA page (revised 2023-08-10) says a zip area is the Bureau's
own drawn version of a postal ZIP code and that not every valid ZIP has one. The gazetteer page
(revised 2026-09-04) offers a 2026 file. Neither page states a licence. The table's header in this
repo says public domain; the `us-zips` package page that would show which Census year our copy is
did not load (HTTP 403) and was **not read**.

## Recommendation (the author's, not a ruling)

1. **Option 2 for every in-person event,** because it sends nothing anywhere, needs no new table
   and no open decision, and answers the question the landing asks. It is the smallest change that
   takes Google out from under the map.
2. **Option 1, in its cells-only form (1a), as the way an organizer puts the event in the right
   hexagon,** and as the only source of a res-9 cell if the owner's precision decision allows one.
   It follows the street archive's load on staging. It also fits a poster's placement.
3. **Not option 3.** The two public services cannot be recommended from the pages read: the Census
   pages are silent on keeping results and cannot match a venue name, and the public Nominatim
   service asks not to be sent personal data and can be withdrawn. Running our own is a server
   this product does not have. If the owner wants an address placed with no effort from the
   organizer, 3c is the only form with no third party, and it is a new piece of infrastructure
   with its own ADR.
4. **G4, the venue image: swap it in one change, after the street archive is on staging.** The
   event page shows the event's area from our own map where Google's picture was, and Google's
   call goes in the same change, so the page is never left with no map. This replaces the first
   draft's "remove now, redraw later": the owner's ruling makes our map the map of record, and a
   gap with no picture is avoidable by waiting for the archive. It is still the call to take
   first, being the only one made on a visitor's view and billed per view.
5. **G3, the sponsor's area: zip to cell,** once the owner has said what "local" means when a
   place comes from a zip.
6. **G2, the poster's spot: a tap on our own map,** built once with option 1's surface. Until
   then the two number boxes stay and the lookup route goes.
7. **Hold the result with a source gate** like the LLM-free one: it fails when a Google Maps host
   or a `GOOGLE_MAPS_` name appears under `src/` or in `wrangler.toml`. The owner removes the
   secret. "No call to Google Maps" is true only when all four are answered.
8. **An order that never leaves a surface with no map:** the street archive on staging first;
   then each Google call replaced; the key and the code removed last. The slices are in
   "Implementation Notes".

**Where a rule for every product would live.** The search found no Google Maps call outside OSE,
so this record changes nothing in ourWKRP or the spine. If the owner wants "no product calls
Google Maps from its own systems" as a rule that binds all of them, that is an org invariant with
its own ADR in OCR-docs, not an OSE record. Nothing was written there.

## Alternatives Considered

### Alternative A: Keep the Google lookup

What the code does today.

**Refused by the owner's ruling of 2026-11-16 (D1).** Before it, the owner had said twice that the
aim was to avoid the lookup and expected it not to pass legal, and the one Google page that loaded
gives a 30-day limit on a kept point with no exception for a cell worked out from it. It is still
what runs until the slices that replace it are built.

### Alternative B: The organizer's device says where it is

A "use my location" button in the admin.

**Rejected because:** a device's position is a person's position, which invariant 3 never takes,
and an organizer creating an event is rarely standing at the venue.

### Alternative C: The organizer types a latitude and longitude

The event API already accepts `lat` and `lon`, and the poster card has two boxes for them.

**Rejected as the main path because:** it asks an organizer for numbers they do not have, a
mistyped digit moves the event to another state, and the handlers store the point. It stays as
what automation can send until option 1 gives automation a cell to send.

### Alternative D: Store Google's place ID in place of the point

Google's page says a place ID may be kept without limit.

**Rejected because:** the address still goes to Google, and a cell could be had from the ID only by
asking Google again. It is the interaction the owner asked to avoid.

## Consequences

Of merging this record: none on behaviour. The lookup runs as it does today.

### Positive

- The owner's question of 2026-11-16 has a written answer with its costs, in the repository.
- The four server calls to Google are listed in one place, with what each sends and keeps.

### Negative

- Every option that drops the lookup loses something an organizer has today: a place found from a
  venue name with no further step. Option 2 gives a coarser answer; option 1 asks for a tap.
- The kind of place (business or address) has no source once Google's answer is gone.

### Neutral

- Option 1 and the street archive are tied together. Staging draws no streets until the owner
  loads the archive (OSE ADR-035).
- Stored points are a separate clean-up from the choice of option, and wait on the same owner.

## Not proven

- Anything on staging. No option was built or run.
- How many events, posters and sponsor drafts hold a point from Google, on staging or production.
- Whether `GOOGLE_MAPS_API_KEY` is set on either environment, and so whether any lookup runs
  there today.
- That a res-9 cell can be picked by tap in the zoomed frame, and that the street layer is
  legible enough at that size to pick by.
- Which Census year our zip table is, and how many valid ZIP codes it lacks.
- Google's terms beyond the one policy page; whether the Census API terms cover the Geocoder; how
  long either Census or the OpenStreetMap Foundation keeps the text of a query.
- The zip-spacing figures are one run of a script on our own table (nearest-neighbour distance
  between centres). They say how far apart zip centres are, not how large each zip is.
- The cross-repository search is a text search of each repository's files. It cannot see a
  secret set on a deployed Worker, an environment-level GitHub secret, a Cloudflare dashboard
  setting, or which Google APIs are switched on for the key in Google's console.
- The six other product repositories were read as local checkouts, not at their `main`, and
  OCR-docs was not searched.
- That an event page and a report read well with no venue picture at all. Nobody has looked.

## Open, for the owner

Settled by the owner on 2026-11-16 and no longer open: Google Maps goes from our own systems
(D1), our own map is the map of record (D2), and links out for navigation stay (D3). Everything
below is still open.

1. **How an event gets its place (G1).** Option 1, option 2, or both. Keeping the Google lookup is
   refused (D1). Option 3 sends the address to a third party that is not Google, so the ruling's
   words do not refuse it; the author does not recommend it.
2. **If option 1:** cells only (1a), or a coordinate that is dropped (1b)? Res 7 only, or res 9
   too? The second half is the open precision decision.
3. **If option 2:** is the zip centre's hexagon an acceptable place for an event on the map? What
   should an organizer see when a zip is not in the table?
4. **If option 3:** which service, who reads its terms, and may a home address be sent to it?
5. **Stored points.** Keep them, clear them once nothing reads them, or place events again. For
   counsel: may a cell worked out from a Google point be kept after 30 days?
6. **The kind of place** (business or address): asked of the organizer, or dropped?
7. **The venue image (G4):** Google's picture goes (D1). In its place: the event's area drawn from
   our own map, or nothing (OSE-1985)? On the SharedReport's event list too?
8. **The poster's spot (G2):** a tap on our own map, at res 9 as the rule already allows? May the
   lookup route go before the tap exists, leaving the two number boxes?
9. **The sponsor's area (G3):** when a sponsor's place comes from a zip, is "local" the same zip
   area as the event, within so many cells, or still the same cell?
10. **The Calendar link:** the Directions links stay (D3). Does the Google Calendar link stay too,
    as linking out? What a Directions link may carry is the precision review's question.
11. **The source gate:** removing `GOOGLE_MAPS_API_KEY` follows from D1 and is the owner's step,
    last. Is the gate that keeps Google Maps from coming back wanted with it?
12. **A rule for every product:** is "no product calls Google Maps from its own systems" wanted as
    an org invariant in OCR-docs? It would be its own ADR there.
13. **Not a map, found in passing:** ourWKRP's showcase pages load fonts from Google's font hosts.
    Leave it, or host the fonts ourselves?

The location-precision review's own decisions stay open and are not restated as questions here.

## Implementation Notes

- Nothing is implemented. No ticket is created by this record.

### Proposed slices (under epic OSE-1880; none started, none ticketed by this record)

The order keeps a map on every surface at every step: our archive is on staging before anything
of Google's is taken away, each Google call is replaced before its code is removed, and the key
goes last. A slice is not built until the owner has answered the open questions it names.
Linear was searched on 2026-11-16 for work that already exists; the last column is what was found.

| #   | Slice                                                                                                                                                                                            | Waits on                                                                   | Already in Linear                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| S0  | The street archive loaded on staging, and the staging street cases binding. An owner step (OSE ADR-035). The build now cut is offered until about 2026-11-21 by one observation.                 | The owner                                                                  | OSE-2064 (the load), OSE-1535 (release work)                                                     |
| S1  | G1 by option 2: a save places an event from its zip, with no outbound request. The Google lookup stays as the fallback until S6.                                                                 | Open question 1 and 3                                                      | None found. OSE-1717 (ask for the place name and the address separately) touches the form        |
| S2  | G4: the event page shows the event's area from our own map where Google's picture was, and the venue-image route goes in the same change.                                                        | S0; open question 7                                                        | OSE-1985. OSE-1498 (the route's limits) ends with the route                                      |
| S3  | G3: a sponsor draft's area from its zip.                                                                                                                                                         | Open question 9                                                            | None found                                                                                       |
| S4  | The admin map: an organizer taps a hexagon to place an event (option 1), and a poster (G2). The admin lookup route goes in the same change.                                                      | S0; open questions 1, 2 and 8; the precision decision for an event's res 9 | None found. OSE-1357 (poster address to cells) and OSE-1504 (the route's limits) are the nearest |
| S5  | Stored points: the readers listed under "What is kept" move to cells or words, then the points are cleared.                                                                                      | Open question 5; the precision review for public outputs                   | None found                                                                                       |
| S6  | The end: the nightly lookups, `lib/geo.ts`, `lib/maps.ts` and their tests go; the source gate lands and is seen red; the secret's name leaves the config comments; the owner removes the secret. | S1 to S4; open question 11                                                 | None found                                                                                       |

Tickets the ruling turns round, for the owner or the epic's keeper to cancel or reword, not
touched here: OSE-1688 (turn on the Geocoding API for the Maps key), OSE-555 (provision the Maps
key), OSE-217 (Google Maps venue display in SharedReports), OSE-235 and OSE-260 (the admin
geocoder work). The fonts in ourWKRP (open question 13) would be a ticket in ourWKRP, not here.

- If option 2 is accepted, the change sits in `lib/event-place.ts` (a second source beside
  `lookUpEventPlace`), with `lib/zip-areas.ts` as it is.
- If option 1 is accepted, the frame and the hexagon outlines already come from
  `frameForCells` and the public area map's route (OSE ADR-033); the admin surface is new.
- Tests that pin today's behaviour and would change: `tests/event-place.spec.ts`,
  `tests/geo.spec.ts`, `tests/geocode-handler.spec.ts`, `tests/venue-image.spec.ts`,
  `tests/maps.spec.ts`, `tests/geo-link-maps-not-h3.spec.ts`.
- Other files that name the secret and would follow its removal: the two comments in
  `workers/oursharedevents/wrangler.toml`, `docs/deployment/INFRA-CHECKLIST.md`, and the fixture
  in `tests/unit/ci/prod-preflight.test.js`.
- Other repositories were read only. Nothing was changed in ourWKRP, the spine or OCR-docs.

## References

- OSE ADR-033 (the public area map), OSE ADR-035 (one bucket), OSE ADR-036 (the base map).
- `NOTICE.md`, "Questions for the owner", question 6.
- `docs/positioning/MAPPING-COST-STRUCTURE.md` (what the Google calls cost).
- The location-precision review of 2026-11-09 (its worksheet is not in this repository).
- Pages read 2026-11-16: listed under "What the pages say".

## Revisit Criteria

- The owner rules on the precision decision: option 1's res-9 half is then settled or removed.
- Counsel answers on Google's terms or on a candidate service's.
- The street archive is loaded on staging: option 1 can then be tried.
- OSE places events outside the United States: option 2's table does not reach them.
