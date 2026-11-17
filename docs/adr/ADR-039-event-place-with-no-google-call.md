# ADR-039: Stop our own systems calling Google Maps, starting with an event's place on the map

**Status:** Proposed. **The direction is the owner's ruling of 2026-11-16** ("The owner's ruling",
below): Google Maps is removed from our own systems, our own map is the map of record, and links
out for navigation stay. **Four of the choices that followed are the owner's too**, made the same day ("The owner's
choices"). **The owner then ruled what the first of them means** ("The owner's ruling on zip and
tap"): a zip finds an event, and only the organizer's tap places it on the map. No cell is made
from a zip. The first form of this record read that choice the other way; every line that did is
corrected here. The rest are in "Open, for the owner", and merging a pull request that carries
this record accepts none of those.
This record builds nothing. It stays Proposed, not Accepted, because the code still calls Google: by this
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
one optional call, and this record sets out the replacements considered for it: three in its first
form, and a fourth the owner put forward the same day (option 4).

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

Read on `main` at `457f4ffe`, 2026-11-16. Paths are under `workers/oursharedevents/src/`. The
sections added later ("The owner's ruling on zip and tap", option 4 and "What is stored about a
place") were read on `main` at `5bef37cd`, the same day.

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

Four of these were put to the owner later the same day and answered; see "The owner's choices".

The Calendar link is not navigation. It stays under the owner's scope statement in "Context"
(linking out is understood), not under this sentence.

### The owner's choices

Put to the owner on 2026-11-16 as four questions, each with the options this record sets out and
the author's recommendation marked. The owner picked one answer to each. The answers are quoted
as they were offered.

| #   | Question                                                                                                | The owner's answer         | What it means here                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | With Google's lookup removed, how should an event get its place on the map?                             | "Zip, plus a tap"          | **The zip finds an event and the organizer's tap places it** (the owner's ruling on zip and tap, below). The zip is stored and is what search reads. No cell is made from a zip, and an event has no hexagon until someone places it by a tap on our own map. Option 3 is not taken. The first form of this record read the answer as "placed from the zip, then moved by a tap"; that reading is withdrawn. |
| C2  | Google's venue picture on the event page and the SharedReport is going. What should stand in its place? | "Our own area map"         | Swapped in one change after the street archive is on staging: the event's area from our own streets, so the page is never left without a map. An area about 2.4 km across, not a pin.                                                                                                                                                                                                                        |
| C3  | What should happen to the points already stored from Google's lookup?                                   | "Keep cells, clear points" | The H3 cells already worked out stay. The readers of a stored point move to cells or words, and then the stored latitude and longitude are cleared. Whether a cell worked out from a Google point may be kept is still a question for counsel. **Confirmed by the ruling on zip and tap**, which kept already-stored cells.                                                                                  |
| C4  | ourWKRP's showcase pages load their fonts from Google's font hosts. What should be done?                | "Host them ourselves"      | The same fonts served from our own site. A change in the ourWKRP repository, with its own ticket there. Nothing was changed there by this record.                                                                                                                                                                                                                                                            |

These four are choices, not builds. What each still leaves open is in "Open, for the owner".

### The owner's ruling on zip and tap

The button "Zip, plus a tap" could be read two ways: the zip lights a hexagon until someone taps,
or the zip only finds the event and the tap alone places it. The first form of this record took
the first reading ("the zip centre's hexagon is where an event sits until someone taps", and a
slice in which "a save places an event from its zip"). The Where-step design, written the same
day in another session, took the second, on evidence this record did not have. The owner was
asked which stands, twice, and gave the same answer both times.

**Asked in the Where-step session, 2026-11-16:** "Should a zip only find an event (no hexagon
until tapped), with already-stored cells kept?" The owner answered, word for word:

> "Yes, that"

The record of it is section 13 of `.claude/outputs/WHERE-STEP-MAP-CHOICE-2026-11-16.md` (on `main`
since pull request 1377). It was relayed to this record's author by that session.

**Asked in this record's own session, the same day, in a question dialog:** "Should a zip ever
give an event a hexagon, or only the organizer's tap?" The owner chose the button:

> "Only the tap"

The other button was "Zip until tapped". This one is known to the author from the hand-over note
of the session that asked it, not from the dialog itself.

What the two answers decide:

- **R1. A zip finds an event; only the organizer's tap places it.** "Finds" means search: the zip
  the organizer gives is stored on the event (`events.zip_code`) and a zip or town search reads
  it. "Places" means a tap on our own map (option 1).
- **R2. No cell is made from a zip, for an event.** Not in `h3_res7`, and not in a column beside
  it. An event has no hexagon until someone places it.
- **R3. C3 stands: "Keep cells, clear points".** Cells already stored stay, those worked out from
  a Google point included. The Where-step design's earlier answer (clear those cells with the
  points) is withdrawn there.

Two more decisions belong to the same design and are recorded in its section 8. Asked there
"Confirm the Where-step design with all four recommended decisions?", the owner answered, word
for word, "Confirm all four". Two of the four are R1 and the answer R3 replaced. The other two:

- **A listed event that nobody placed stays listed** and found by its zip, with no hexagon.
- **A block and a dot come only by the organizer's own tap, only for a business or public place,
  never for a home.** That design reads this as its answer to the precision review's question on
  res 9. It puts no words into `OCR_VISION.md` or invariant 3, and neither does this record.

**What follows from R1 and R2, read in the code** (`main` at `5bef37cd`; the Where-step
worksheet's section 4 cites these lines and each was read again for this record):

| What reads an event's res-7 cell                                                             | An event nobody has placed (no cell)                                                                 | If a zip centre's cell had been stored there                                       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| The landing hexagons and the zoomed area                                                     | No hexagon and no dot. Still a card in the list                                                      | A hexagon at the zip's centre, often not the venue's                               |
| The corridor id sent to BigQuery (`canonicalCorridorId`, `lib/export-geography.ts`)          | The event's row is sent with the corridor `unknown`. Both count tables leave `unknown` out           | A neighbouring corridor, sent as if it were exact                                  |
| Corridor baselines (`refreshCorridorBaselines`, `lib/shared-report.ts`)                      | Not counted in any baseline; its own report says there is no baseline yet                            | People counted at one venue pooled with venues in another hexagon                  |
| The corridor latch (`lib/corridor-latch.ts`; its migration says "a latch is a one-way door") | Does not count toward the five events that open a corridor                                           | Five such events open a corridor that may hold no venue, and it never closes       |
| Sponsor "local" (`lib/sponsor-promotion.ts` and the other places that compare the two cells) | Never local                                                                                          | A false match, kept on the placement and not worked out again when the event moves |
| The venue key shared with ourWKRP (`venueCanonicalId`, `lib/spine-keys.ts`)                  | No key                                                                                               | One key when placed by zip and another when placed by tap                          |
| Zip and town search (`inZipsOwnArea`, `lib/zip-areas.ts`)                                    | **Not found today:** the function returns false before it reads a zip. Mended by slice W1 (OSE-2095) | Found                                                                              |

So the one thing a zip-centre cell would have mended is search, and search can read the zip
itself. Everything else it touched it would have made wrong, and two of those (the warehouse rows
and the latch) cannot be taken back afterwards.

**What the ruling does not decide**, and this record does not decide for the owner:

- **A sponsor draft's area (G3).** Both questions were about an event. Whether a sponsor's area
  may still come from its zip is not answered. The same evidence bears on it; see G3.
- **A poster's spot (G2).** Not asked. This record already proposed a tap for it.
- **Whether anything but a tap may ever suggest or make a cell**, for example a table of addresses
  we host ourselves (option 4, which the owner raised before the two answers above).
- What an organizer sees when their zip is not in our table, and the precision review's own
  decisions.

### The choices that remain

For G1 the owner has chosen: a tap places (option 1), a zip finds, and options 2 and 3 are not
taken as a source of an event's cell. They stay below as what was considered, with what was found.
Option 4 is new, was put forward by the owner, and is open: it can be accepted or refused by
itself. For G2, G3 and G4 what follows is what could replace each with nothing sent to Google.
The recommendation is the author's and not a ruling.

### G1. The event's place: the options

G1 is the large one. Without it an event has no source for a cell, so it needs a replacement and
not only a removal. Options 1 to 4 below are the replacements considered.

### Option 1. The organizer taps the spot on our own map

**Chosen by the owner (C1, R1): this is how an event is placed.**

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

**Not taken by the owner as a source of an event's cell (R2). The zip is for finding.** What is
kept from this option is its first half: the Worker reads the zip (the one the address ends with,
or a zip box in the form) and stores the zip. What is refused is its second half: turning the zip
into a stored cell. The rest of this section is the option as it was considered, with the
measurement that counts against it, so the reason stays on record.

As considered: on save, the Worker reads the zip the address ends with (or a zip box in the form),
finds that zip's centre in the table we already ship, and stores the res-7 cell the centre is in.
No lookup, no network call, no new table.

**Say it plainly: this is good for the res-7 hexagon map and too coarse for a res-9 dot.** And the
res-7 answer has a limit of its own: the cell is the cell of the zip's centre, not the cell of the
venue. Measured on our table on 2026-11-16: the median zip centre has its nearest neighbour 7.5 km
away, a quarter have one within 4.4 km, and 9% have one within the width of a single res-7 cell. So
a typical zip covers several res-7 cells, the hexagon that lights up can be a cell or more away
from the venue, and every event in one zip shares one hexagon. That is honest for "what is going on
in this zip area", which is the question the landing asks. It is not a place on a street. A res-9
cell taken from a zip centre would name a block the event is not on, so none is stored.

What the first form of this record missed: the res-7 cell is not only a hexagon on the landing.
It is the corridor every report is keyed by. The table under "The owner's ruling on zip and tap"
lists what a zip-centre cell would have done to each reader. The landing's question ("what is
going on in this zip area") is answered by search reading the stored zip, with no cell made.

| Question                         | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What leaves the Worker           | Nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Cost                             | Small: the table and the two functions exist. An address with no zip at its end needs a zip box, or the town table. A zip the table lacks gets no cell: the Census page says "Not all valid ZIP Codes are represented by a 2020 ZCTA". United States only. The kind of place (business or address) came from Google's answer and has no source here. No res-9 cell, so no dot on the zoomed area and no point for a venue poster to copy. |
| What a test would have to prove  | Known addresses give the expected res-7 cell. No res-9 cell and no point is stored when the source is a zip. A zip that is not in the table gives the organizer the "not found" notice and never fails the save. The landing's zip search finds the event under its own zip. The save makes no outbound request at all, proven by a case that goes red when one is injected. Each case in the workers pool and on staging.                |
| Events that already have a point | As considered: they could stay, or be worked out again from their zip, which would move each event to its zip centre's hexagon. **As ruled (R2, R3): they keep the cells they have and no cell is worked out from a zip.**                                                                                                                                                                                                                |
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

### Option 4. A table of addresses we host ourselves

**Open. Put forward by the owner; not chosen and not refused.** The owner's words, 2026-11-16
(given in the session the owner was working in, and quoted in the Where-step worksheet among the
directions it follows):

> "I would think that by using addresses this would correlate to locations"

Read here as: the address the organizer types is the record, and the place is worked out from it
by us, with nothing sent out. The owner said this before the two answers under "The owner's
ruling on zip and tap". Whether it was meant to place an event with nobody tapping was not asked.

**What it would be.** A file we build ahead of time and keep in our own bucket, mapping a
normalised street address to H3 cells. The Worker would read the few bytes it needs by range, the
way it reads the street archive (`lib/pmtiles.ts`). It is a static file, not a server, so it is
not option 3c. The build step would turn each address's point into cells and write only the
cells, so no coordinate of a looked-up place would exist in our schema or in our bucket.

**Where the addresses could come from.** Three sources were looked at. Pages read 2026-11-16;
quotes are short and exact.

| Source                                   | What it holds                                                                                                                                                                                                                             | What its pages say about reuse                                                                                                                                                                                                                    | What stands in the way                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OpenAddresses**                        | Address points gathered from public bodies: number, street, unit, city, postcode and a point. Its source files for the Chicago region exist for Cook County, the City of Chicago, DuPage, Will, Lake and Kane. There is no statewide file | No single licence. The project's README: "Individual sources will have their own licenses." Its front page says most sources ask only for attribution. None of the six Illinois source files carries a licence block                              | Each county's own terms would have to be read one by one. Cook County's open data pages did not load, so its terms were **not read**. The download site returned an empty shell: how the data is downloaded, whether an account is needed, and how large it is were **not read**                                   |
| **US Census TIGER/Line, address ranges** | By its name, the Address Range-Feature file: ranges of house numbers along street segments, one file for each county. A position comes from working out how far along the segment a number falls, not from the door                       | The documentation's first chapter: "Copyright protection is not available for any work of the United States Government". It asks that the Bureau be cited, gives no warranty on positional accuracy, and sets a rule on using the TIGER/Line name | A range is not a building: a number inside a range may not exist. The chapter that describes the file's records did not load as text and was **not read**. Released once a year by what the pages show (the 2025 files are dated 2025-09-22). County files seen in the listing run from under 1 MB to 24 MB zipped |
| **Our own street archive** (OSE ADR-035) | Roads with their kind. By Protomaps' build code, a minor road carries its name from zoom 14, and address points are written only at zoom 15, with the street name taken off them                                                          | Already ours to use under the terms in `NOTICE.md`                                                                                                                                                                                                | Our archive is cut at zoom 14 (`NOTICE.md`), so **it holds no house numbers**. Our decoder reads roads by kind and does not read their names today. No tile was opened to confirm the names are there                                                                                                              |

So the coarser fallback from data we already hold (a street name inside a zip, matched against
road names in our archive) is possible in principle and gives less than it sounds: the set of
hexagons a named street runs through inside one zip's area. For most streets that is several
hexagons. It is a short list for the organizer to pick from, not a place.

**How it sits with the rules.**

- **Invariant 3** (place, not person). No conflict. The address is one an organizer types about a
  venue, nothing is taken from a request, and nothing leaves the Worker.
- **Cells, not points.** Stricter than today: the stored row would never hold a coordinate.
- **The dot rule needs no point.** The question came with the note that a business is drawn
  exactly and so needs a point. The code does not do that: every dot is drawn at the centre of its
  res-9 block, a business too (`lib/attendee-map.ts`; owner, 2026-11-09). A business differs only
  in its mark and its words. A cell is enough.
- **R1, "Only the tap".** A table that gives an event a cell with nobody tapping is not inside
  the ruling as the owner gave it. A table that only chooses where the picker opens is.
- **The block rule** (a block only by the organizer's own tap, only for a business or public
  place, never a home). A table cannot be trusted to tell a shop from a home, so it must never
  set a block by itself.
- **What the file itself would be.** Built at res 9 it is a list of every address in a region
  with its block, homes included. That is public data rearranged, in a private bucket, served to
  nobody; it is still a new kind of thing for us to hold. Built at res 7 only, it says no more
  than which 5 km² an address is in, and that is all the picker needs.
- **One bucket** (owner, 2026-11-14; OSE ADR-035). The table would be another object the owner
  loads and locks, and that record would need to say so.

**What is hard about it.** The four points put to the owner hold, with two corrections.

- **Matching what people type.** Abbreviations, unit numbers, misspellings, a missing zip, a town
  written three ways. It needs a normaliser, a test set of mistyped addresses, and a plain "not
  found". **Correction:** "not found" cannot fall back to the zip's cell, because no cell is made
  from a zip (R2). It falls back to the picker opening on the zip's area, which is what the
  picker does anyway.
- **A venue name with no address resolves to nothing.** Confirmed. It is also the common case
  today: the wizard has one box, and its example is a venue name and a town.
- **Gaps and new buildings.** The table is only as new as its last build. It needs a rebuild
  schedule and a number for how many typed addresses it misses, measured on real entries.
- **Size, build time and cost. Not measured.** No page read gives a size or a count for the
  region, and nothing was built. `docs/positioning/MAPPING-COST-STRUCTURE.md` asks for a number
  before a map piece ships. **Correction to the sketch:** reading it "the way the street archive
  is read" still means a new file format and a new reader; the PMTiles reader does not fit a
  table keyed by text.
- United States only, like the zip table.

**Could existing rows be worked out again from their stored address?** In principle, for rows
whose `where_address` holds a street address. It would replace a cell that came from a Google
point with one that came from open data, which would take counsel's question about those cells
off the table. Against it: the owner chose to keep the cells (C3); a cell worked out again can
land one hexagon away, which moves the event to another corridor and splits its history; and it
places an event with nobody tapping. Not recommended unless counsel says the kept cells cannot
stay. Then it is one of two remedies, and the other is to clear them and ask organizers to tap.

| Question                         | Answer                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What leaves the Worker           | Nothing.                                                                                                                                                                                                                                                                                                         |
| Cost                             | A new data pipeline: choose sources county by county, read each one's terms, build, load, rebuild. A normaliser and its test set. A new reader. A size and a bill nobody has measured.                                                                                                                           |
| What a test would have to prove  | A known address opens the picker on the expected hexagon. A mistyped one still does, or says "not found" and opens the zip's area. A venue name alone says "not found". No cell is stored without a tap. No block is ever suggested for a home. A save makes no outbound request. The address text is in no log. |
| Events that already have a point | Untouched. See the paragraph above.                                                                                                                                                                                                                                                                              |
| Depends on                       | The owner (open questions 14 and 15). Option 1's picker, which it would feed. Terms read for each source. A spike for size and cost.                                                                                                                                                                             |

**How it ranks (the author's view, not a ruling).**

1. **Option 1** is the rule, and nothing here replaces it.
2. **Option 4 as an aid to the tap** is worth having later. It gives back some of what the Google
   lookup gave an organizer, a head start from the address they already typed, and sends nothing
   anywhere. It comes after the picker is on staging and after a spike says what it costs.
3. **Option 4 as a way to place with nobody tapping** is not inside R1. If the owner wants it,
   that is a change to the ruling, and it should then stop at res 7 and never set a block.
4. **Options 2 and 3** are not taken.

**Do the three make one fallback chain (address table, then zip, then tap)?** Not as a chain that
places an event. The middle link is gone, because a zip makes no cell, and the last link is not a
fallback: the tap is the act that places. They do make one chain for **where the picker opens**:
on the address's hexagon when the table knows the address; else on the zip's area; else on an
area the organizer names. The tap comes at the end of every path. And they make one chain for
**finding**: the stored zip, else the zip the address ends with.

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
  missing from the report's map of placements. The owner's ruling was about an event, not a
  poster, but nothing here recommends a zip-centre cell for a poster either.
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

**What could replace it, with nothing sent to Google.** The first form of this record proposed
zip to cell here, with the function option 2 uses. **The owner's ruling on zip and tap does not
answer this:** both questions put to the owner were about an event. It is flagged, not decided.
What the ruling's evidence says about it is plain enough: a zip centre's cell is often not the
cell the business is in, "local" is strict equality of two res-7 cells, and now that an event's
cell comes only from a tap, a sponsor's zip-centre cell would be compared with a tapped one. Two
sponsors on one street could come out differently, and a sponsor in the event's own zip could
miss. Three ways to answer it, for the owner:

- **The draft keeps its zip and no cell.** "Local" becomes: the sponsor's zip is the event's zip,
  or the two placed hexagons are the same. This is the Where-step design's recommendation and how
  its slice W6 is ticketed (OSE-2099). It makes no cell from a zip anywhere. It needs the event to
  have a zip, which slice W1 gives it.
- **The sponsor's cell from its zip centre,** as first proposed. It keeps one rule ("same cell")
  and carries the fault above. It would be the one place a zip still makes a cell.
- **The sponsor taps its own hexagon,** on the surface option 1 builds. Exact, and one more step
  in a sign-up that is already long.

Each is a rule about the local sponsor promise, which is the owner's (see "Open, for the owner").

**Cost to change.** Small in code: one call in `handlers/sponsors-draft.ts` and its tests. The
cost is the rule above. An admin who adds a sponsor directly sends coordinates today
(`handlers/sponsors.ts`) and is not a Google call.

**A test would have to prove:** a draft with an address ending in a zip keeps the zip and no
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
  map; the small picture in its event list could then simply go. Under R2 an event nobody has
  placed has no cell, so it shows the venue's words and the Directions links and no picture.
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

What each option for G1 does to them. Option 1 is the one chosen; options 2 and 3 are not taken
and are kept for the comparison; option 4 is open.

| Piece                                                | Option 1 (tap): chosen                                                                                                                                                                      | Option 2 (zip to cell): not taken                                                                             | Option 3 (another lookup): not taken                                   | Option 4 (our own address table): open                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Venue image** (G4, OSE-1985)                       | Untouched by the option: it is its own call to Google, on a visitor's view. Our own area map stands in (C2), from the cell the tap gave. An event nobody placed shows words and no picture. | The same. A stand-in drawn from a zip-centre cell would show the zip's area, not the venue's.                 | The same. A stored point would let a stand-in be drawn near the venue. | The same as option 1 once an event has a cell. It could give a cell to an event nobody tapped, if the owner allows that. |
| **Directions links**                                 | With no stored point they carry the address or place name, which the code already does when a point is missing.                                                                             | The same as option 1.                                                                                         | Unchanged: they carry the point when there is one.                     | The same as option 1: the table gives cells, and no point is stored.                                                     |
| **Calendar link**                                    | Unchanged. It carries words and dates, never a point.                                                                                                                                       | Unchanged.                                                                                                    | Unchanged.                                                             | Unchanged.                                                                                                               |
| **Poster placement and sponsor address** (G2 and G3) | A tap suits a poster: it is a physical spot and res 9 is already its rule. A sponsor's area is an open question (G3).                                                                       | Too coarse for a poster, so the report's res-9 map would have no cell for that poster. For a sponsor, see G3. | Unchanged in shape.                                                    | A poster's typed address could open the picker at the right block. A sponsor's address could give its area with no tap.  |

If G1 goes and G2, G3 and G4 stay, the Worker still calls Google. "No call to Google" is true only
when all four are answered.

## What is stored about a place, and what reaches BigQuery

The owner asked, 2026-11-16, "Does this effect BigQuery storage in anyway?", and then sharpened
it: "more the geographical data I am storing in my scheme across the monrorepo and its spokes"
(both relayed by the session the owner was working in). So the question is: with Google Maps
removed, what happens to the geographic data in our own schemas, across the spine and its
products, and from there what reaches BigQuery.

These are findings and options. The one decision in them is the owner's own (C3). Everything was
read in source, on `main` at `5bef37cd` for OSE: 110 migrations for `DB`, 18 for `FORMS_DB`. **No
database was read**, on staging or production, so nothing here says how many rows hold a value.

### 1. The inventory: OSE

`DB`, the anonymous side. Derived columns are grouped with what they are derived from.

| Table and column                                                                                                      | What it is                                             | Where its value comes from today                                                                                                                                                           | With Google removed                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events.location`, `events.where_address`                                                                             | Place name; address text                               | Typed by the organizer                                                                                                                                                                     | Nothing changes. These are the words Google was sent                                                                                                     |
| `events.zip_code` (in the schema since migration 0021)                                                                | Zip                                                    | **Nothing writes it.** Its one reader is a sponsor-matching path that is off unless a flag is set                                                                                          | Slice W1 starts writing it: typed, or read off the address. A new source, no new column                                                                  |
| `events.lat`, `events.lon`                                                                                            | Point                                                  | Google's answer (`savePlaceLookup`); or coordinates sent with the request, which only automation does (the admin pages send none for an event); copied by "repeat this event"              | The Google source goes. Stored values are cleared (C3, slice W7)                                                                                         |
| `events.h3_res9`, `events.h3_res7`                                                                                    | Res-9 and res-7 cells                                  | Our own h3-js, from whichever point the row was given                                                                                                                                      | The source becomes the cell the organizer taps (W3, W4). Stored values are kept (C3). The grain does not change; where the value comes from does         |
| `events.place_kind`, `events.place_checked_at`                                                                        | Business or address; when Google last answered         | Google only                                                                                                                                                                                | The kind becomes what the organizer says (W4). `place_checked_at` gets no new values. It is today the only mark on any row that a place came from Google |
| `events.corridor_id`                                                                                                  | A corridor id from before H3                           | Nothing writes it. It is read as the fallback after `h3_res7`                                                                                                                              | Nothing changes                                                                                                                                          |
| `events.venue_canonical_id` (and the id derived from it)                                                              | A hash of the place name and the res-7 cell            | Derived                                                                                                                                                                                    | Follows the cell: an event placed in a different hexagon gets a different key                                                                            |
| `poster_deployments.latitude`, `longitude`                                                                            | Point                                                  | Google's answer, relayed by the admin card through the lookup route (G2); or numbers the organizer typed; or the event's point for a venue poster                                          | The Google source goes (W3: a tap). Stored values are cleared (W7)                                                                                       |
| `poster_deployments.address`                                                                                          | Address text                                           | Typed; **or Google's own wording of the address** (`formatted_address`), which the card stores in place of what was typed when the lookup answers; or the event's words for a venue poster | Typed only. Rows that hold Google's wording are not points, so C3 as worded does not name them (choice 3 below)                                          |
| `poster_deployments.h3_res9`, `h3_res7`                                                                               | Cells                                                  | Our own h3-js from the poster's point                                                                                                                                                      | A tapped cell. Stored values are kept                                                                                                                    |
| `poster_deployments.location_desc`, `placement_label`                                                                 | Words                                                  | Typed                                                                                                                                                                                      | Nothing changes                                                                                                                                          |
| `sponsor_business_draft.address_raw`                                                                                  | Address text                                           | Typed by the sponsor                                                                                                                                                                       | Nothing changes                                                                                                                                          |
| `sponsor_business_draft.lat`, `lon`, `h3_res9`, `h3_res7`                                                             | Point and cells                                        | Google's answer (G3), and our h3-js from it. There is no other writer                                                                                                                      | The source goes (W6). What replaces it is open question 9. Neither sponsor table has a zip column                                                        |
| `sponsor_business.lat`, `lon`, `h3_res9`, `h3_res7`                                                                   | Point and cells                                        | Coordinates an admin sends; **or copied from a promoted draft, so Google's**                                                                                                               | Rows promoted from a draft hold a Google point. The W7 ticket names events, posters and drafts and not this table (choice 2 below)                       |
| `sponsor_business.address_line`                                                                                       | Address text, public on the sponsor's card             | Typed                                                                                                                                                                                      | Nothing changes                                                                                                                                          |
| `sponsor_placement.locality_band`                                                                                     | 1 when the sponsor's and the event's res-7 cells match | Derived                                                                                                                                                                                    | Follows the rule the owner picks (open question 9)                                                                                                       |
| `sponsor_areas.zip_code`, `lat`, `lon`, `radius_miles`                                                                | Zip; point; radius                                     | Sent by an admin. Read only by the same flag-gated matching path                                                                                                                           | Not Google's, and nothing changes. Whether "clear points" reaches them is open question 17                                                               |
| `sponsor_displays.h3_res7`                                                                                            | Res-7 cell                                             | The event's cell, copied when a display is counted                                                                                                                                         | Follows the event's cell                                                                                                                                 |
| `scan_cell_aggregates.h3_res9`, `h3_res7`                                                                             | Cells                                                  | The poster's cells, copied in the nightly roll-up. No scan row carries a cell or a coordinate of its own, and nothing is read from the request                                             | Follows the poster's cells                                                                                                                               |
| `scan_aggregates.h3_res9`, `h3_res7`                                                                                  | Cells                                                  | The event's cells, copied nightly. No reader was found                                                                                                                                     | Follows the event's cells                                                                                                                                |
| `corridor_density_baseline.corridor_id`, `corridor_density_snapshots.corridor_id`, `corridor_readiness_latch.h3_res7` | Res-7 cell                                             | The event's cell, in the nightly jobs                                                                                                                                                      | Follow the event's cell. A latch row is never changed once written                                                                                       |
| `node_hierarchy.latitude`, `longitude`; the `corridors` tables (migration 0010)                                       | A centre point for a named area; named routes          | Nothing under `src/` writes or reads them                                                                                                                                                  | Nothing changes                                                                                                                                          |
| `scan_node_returns.country_code`, `scan_aggregates.top_country`, `top_region`                                         | A visitor's country                                    | Always written empty, and cleared by migration 0089                                                                                                                                        | Nothing changes                                                                                                                                          |

Not geography, though the names suggest it: `event_booths.hall_x` and `hall_y` are a spot on a
hall plan, and the `venue_id` columns in the return tables hold an event id.

`FORMS_DB`, the identified side: **no geographic column in any of its 18 migrations.** Two loose
ends, neither a column: a survey's answers are stored as the form sent them, so a form that asks
for a zip would store one; and a registration keeps the id of the poster it came from.

Held outside a database: the zip table (`lib/zip-areas-data.ts`: 33,791 zips, each a zip and its
centre, bundled into the Worker) and the town table (`lib/place-names-data.ts`: 29,542 towns with
their zips). Neither is written to any column today. The street archive is in our bucket. The
venue image is kept in the edge cache for a day under the venue's words.

### 2. The inventory: the spine and the other products

Read only, at each repository's `main` as the local copy has it, without fetching. Where the
remote has moved on, the read is of the older commit and says so.

| Repository                                                                      | Read at                                                                        | Stored geographic fields                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The spine** (OurCommunityRituals)                                             | `862171e`, the same as the remote                                              | **None.** No migration or schema in the tree. `packages/data-provider` has no geographic type. The UI's map detail takes words such as a street corner, never a coordinate or a cell                                                                                       |
| **ourWKRP**                                                                     | `b1ae6d9`, the same as the remote                                              | **One: `dj_sets.venue_name`**, a venue name a DJ types. No point, cell, zip or address column in any migration. Its showcase reads OSE's public area route at build time, sends res-7 cells only, and keeps no coordinate. Two committed test fixtures hold made-up places |
| **OCR-docs**                                                                    | `0716b6b`, **behind the remote** (`e18c4bd` is not in the local copy)          | Documents, no database. One data file gives one named corridor an anchor point, a res-7 cell and a bounding box, written by hand. Its warehouse table definitions name `corridor_id` and no point or cell                                                                  |
| ourAirwaves, ourSharedGames, ourSharedMagnets, ourSharedPulse, ourSharedRecords | each **behind the remote**; ourEventRings at `7b1de37`, the same as the remote | **None.** Each holds workflow, standards and readme files only                                                                                                                                                                                                             |

So the stored geography of the whole line is in OSE. Removing Google changes nothing stored in
any other repository. ourWKRP is touched in one indirect way: the venue key OSE shares with it is
made from the res-7 cell, so an event with no cell has no key, and an event placed in a different
hexagon gets a different one.

### 3. Which stored values came from Google

- **Events:** `lat`, `lon`, both cells and `place_kind`, on rows where Google found a spot. Those
  rows can be told: `place_checked_at` is set and the point is not empty.
- **Posters:** the point, both cells, and sometimes the address wording, when the admin card
  looked the address up. **Nothing on the row says so.** A typed pair of numbers looks the same.
- **Sponsor drafts:** every stored point and cell. There is no other writer.
- **Sponsors:** the point and cells of any sponsor promoted from a draft. Nothing on the row
  tells it from one whose coordinates an admin sent.
- **Everything derived from those cells:** the venue key, sponsor "local", the baselines, the
  latch, the scan roll-up by poster cell, and the corridor ids already sent to the warehouse.

**How many rows: not counted.** It needs a read of the staging and production databases, which
this record's author does not make. It is one count for each table (for events: rows with
`place_checked_at` set and a point). It may be none: with no key set the lookup never runs, and
whether the key is set on either environment was not read.

### 4. What flows on to BigQuery

**Credentials are separate.** BigQuery is reached by workload identity (`WIF_*`,
`GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `BIGQUERY_DATASET_ID`; `cloud/config.ts`,
`cloud/bigquery.ts`, `google/auth.ts`). Maps uses one key name. Removing Maps touches no BigQuery
setting. Whether the Maps key sits in the same Google Cloud project or billing account as
BigQuery cannot be read from the repository.

**No point reaches BigQuery, and no Google-derived point ever did.** The exports select named
columns, and `assertCorridorGrainRow` (`lib/export-geography.ts`) throws on any row that carries
a coordinate, an address, a cell finer than res 7, or a corridor id that is neither a res-7 cell
nor `unknown`. A throw fails that export and sends nothing.

**What does reach it is one value, `corridor_id`,** in four tables: the nightly event backup
(`handlers/bigquery.ts`), and the returns, baseline and event-series exports
(`lib/shared-report-export.ts`). In all four it is the event's own `h3_res7`, or `unknown`.

**Rows are added and never rewritten.** Every export is a streaming insert. Nothing in the
Worker updates, deletes or merges a warehouse row.

| Export              | What decides a row is sent                                                                                | When an event's cell changes                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Event backup        | A listed event whose `updated_at` moved in the last 24 hours                                              | A new row with the new corridor, **only if the write that changed the cell stamped `updated_at`**. The old row stays |
| Returns by corridor | A fresh snapshot whenever the return rows have changed; counts under the floor and `unknown` are left out | The next snapshot counts that event's people under the new corridor. Earlier snapshots keep the old one              |
| Corridor baselines  | Rows recomputed in the Worker over the last 90 days from each event's current cell; `unknown` left out    | The whole 90 days moves to the new corridor at the next refresh. Rows already sent keep the old one                  |
| Event series        | Series rows changed since the last run                                                                    | The corridor is read at send time. Rows already sent keep the old one                                                |

A fault that exists today, with Google in place: the write that stores Google's answer does not
stamp `updated_at` (`savePlaceLookup`, `lib/event-place.ts`). An event listed before its lookup
ran is backed up as `unknown` and is not sent again when the nightly lookup places it, until
something else edits it. The picker's write must stamp it; slice W3's cases already say so.

**The cases the ruling leaves.**

- **An event that keeps the cell it has (C3).** Nothing changes. Its corridor is the same the day
  before and the day after Google goes. This is the main reason history stays comparable.
- **An event nobody places.** Its backup and series rows say `unknown`. It is in no returns
  snapshot and no baseline. That is a gap, stated as a gap, where a zip-centre cell would have
  been a wrong corridor stated as fact.
- **An event placed later.** From that day its rows carry the corridor. Its earlier rows still
  say `unknown`. Nothing is corrected, and nothing was wrong.
- **An event an organizer moves to another hexagon.** Its history is split across two corridors
  in the warehouse. In our own tables the last 90 days move with it at the next refresh.
- **Coverage, not position, is what shifts.** Today Google places an event with no one doing
  anything. After slice W3 an event has a corridor only when someone taps. So the share of
  `unknown` is likely to rise, and corridors that were fed by events nobody will place (made by
  automation, or listed by the sponsor path) will count fewer. A trend line across that date
  shows a change of method, not a change in the world.

### 5. Choices this sharpens

The owner has ruled on the stored points: **keep cells, clear points (C3)**. That stands and is
not reopened here. What the inventory adds to it, each for the owner or the slice that does the
work:

1. **The readers that must move first.** Besides those listed under "What is kept", two read a
   sponsor's stored point: the sponsor's own page (`handlers/sponsor-home.ts`), and the sponsor's
   event sign-up, which works out the sponsor's cell from its point each time
   (`lib/sponsor-discovery.ts`) where the stored cell would do. Clearing sponsor points before
   that moves would make a sponsor signing up there not local.
2. **Four tables hold points that came from Google, not three.** The Where-step design's W7
   names events, posters and drafts. `sponsor_business` holds points copied from promoted drafts.
3. **Google's wording of a poster's address** is stored on some poster rows. It is not a point.
   Google's policy page allows a latitude and longitude to be kept for 30 days and names no such
   allowance for other content except place IDs (see "What the pages say"). Whether "clear
   points" should reach that text is the owner's to say, and whether it must is counsel's.
4. **What is kept under C3 is more than two columns.** The cells feed the venue key, sponsor
   "local", the baselines, the latch, the scan roll-up and the corridor ids already in the
   warehouse. Counsel's open question (may a cell worked out from a Google point be kept past 30
   days) covers all of them, and a later answer of "no" could clear our own tables but could not
   take back rows already sent.
5. **Kept cells and tapped cells will look the same.** Only events carry a mark today
   (`place_checked_at`). If counsel's answer or a warehouse reader ever needs to tell them apart,
   the mark has to survive W7 on events, and posters and sponsors need one set at W7, when every
   row with both a point and a cell is by definition from before. Without it the difference is
   gone for good.

### 6. Is a schema change needed at all?

**Not to remove Google.** Every column the new sources write is already there: `events.zip_code`,
and the cell columns on events and posters. Clearing points is a change to rows, not to tables,
and the emptied columns can stay. Three changes are in code only: the runtime export guard should
refuse the zip names, as the static gate already does (`SUB_CORRIDOR_KEY` lists no `zip`,
`zip_code` or `postal_code`); the place writes should refuse coordinate fields; and a placement
write should stamp `updated_at`.

Three places where a schema change may follow, none of them needed for the removal itself:

- **A sponsor's zip.** Neither sponsor table has a zip column. If the owner's "local" rule is
  "the same zip" (open question 9), slice W6 either adds one or reads the zip off the address
  text each time.
- **A mark for how a place was set** (choice 5 above), on posters and sponsors.
- **Dropping the point columns** after they are cleared. Optional and later; a check that no
  handler writes them does the same work without a migration.

### 7. What keeps the history comparable (the author's recommendation)

1. **Keep the cells, as the owner chose.** Nothing then moves on the day Google goes.
2. **Rewrite nothing in the warehouse.** The exports only add rows, and the record of what was
   known at the time is worth more than a tidy table.
3. **Write the change date down where the warehouse's readers will find it**
   (`docs/features/SHARED-REPORT-BIGQUERY-EXPORT.md`): the day slice W3 ships on each
   environment is a change of method for every corridor count.
4. **Read the share of `unknown` beside any corridor trend that crosses that date.** The
   SharedReport exports already count rows with a real corridor and rows with `unknown` on each
   run.
5. **Stamp `updated_at` on every placement write,** so an event first sent as `unknown` is sent
   again with its corridor.
6. **Keep the mark of how a place was set** (choice 5), so the two populations can be told apart
   later.
7. **Leave an event that moves as two corridors in history.** The latest row is the current one.

Not verified for this section: any row count; whether the key is set; how the warehouse's own
views read `unknown` or pick the latest row (they are not in this repository); whether the
OCR-docs warehouse definitions are what is deployed; the five product repositories and OCR-docs
at their newest `main`.

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

Fetched a second time the same day, for the stored-geography section. The policy page loaded
again and reads the same: cached coordinates are allowed for "up to 30 consecutive calendar days,
after which you must delete the cached coordinates"; a place ID is outside that limit and may be
kept; and content is not to be made from Google Maps content. Its example of that last rule
names latitude and longitude from Places used in a point-in-polygon analysis; it does not name
the Geocoding API there. No sentence was found about a value worked out from a returned
coordinate. The two terms pages returned only their titles again, and a dated copy of the service
terms returned a "not found" page. Still **not read**.

**OpenAddresses** (for option 4). `openaddresses.io` and the project's README and contributing
guide on GitHub loaded; none shows a date. The front page says all the data is openly licensed
and that most sources ask only for attribution. The README: "Individual sources will have their
own licenses." A source file may carry a
licence block with fields for attribution and share-alike; the six Illinois files read (Cook, the
City of Chicago, DuPage, Will, Lake, Kane) carry none. Each points at that county's or city's own
map server. There is no statewide Illinois file. The download site (`batch.openaddresses.io`)
returned an empty page, so how to download, whether an account is needed, and any size or count
were **not read**. Cook County's open data pages did not load (an empty page, and one refusal),
so the county's own terms were **not read**.

**US Census TIGER/Line** (for option 4). The files page (revised 2026-10-14) says the 2026
shapefiles were released on 2026-10-14 and states no licence. The technical documentation's first
chapter was read as a PDF: "Copyright protection is not available for any work of the United
States Government"; it asks that the Bureau be cited, gives no warranty on the data's accuracy,
and says the TIGER/Line name may not be used in a product's name. The 2025 address-range folder lists one zipped file for each county, each dated 2025-09-22;
three seen were 745 KB, 21 MB and 24 MB. The chapters that describe the address-range records did
not open as text and were **not read**, so what a record holds is taken from the file's name.

**Protomaps** (for option 4 and the street archive). The layers page says the buildings layer
holds buildings and address points from OpenStreetMap, with a house-number attribute, and that
the tileset does not carry all of OpenStreetMap's data and tags. The downloads page gives zoom
levels 0 to 15. The build's own source files on GitHub were read: an address point is written
with a minimum zoom of 15, the street name is removed from it, and a road's name is attached from
zoom 14 by the default rule. The last two are a reading of code, not of a tile. The
OpenStreetMap wiki page for the house-number tag (last edited 2026-07-04) says nothing on how
complete that data is.

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

The first form of this record recommended option 2 (zip to cell) for every in-person event. **That
recommendation is withdrawn.** The owner did not take it (R2), and the evidence under "The owner's
ruling on zip and tap" is against it: the author had weighed the hexagon on the landing and not
the corridor the reports are keyed by. What is recommended now, each within the rulings as they
stand:

1. **The zip at the Where step, stored and read by search** (slice W1, OSE-2095). This is R1's
   "finds". It makes no cell, and it mends a fault that exists today with Google in place: an
   event whose lookup found no spot is missing from zip and town search.
2. **Option 1, in its cells-only form (1a), as the only source of an event's cell,** and of a
   res-9 block where the owner's confirmed block rule allows one (a business or public place, by
   the organizer's own tap, never a home). It follows the street archive's load on staging. It
   also fits a poster's placement.
3. **Option 4, not as a way to place an event, and not yet.** A table of addresses we host could
   open the picker at the right hexagon, with the organizer's tap still the act that places. Used
   that way it sits inside R1. Used to make a cell with nobody tapping, it is against "Only the
   tap" as the owner gave it, and would need the owner to say so. Either way it is a new data
   pipeline with no measured size or cost, so it ranks after option 1 is built and seen on
   staging. The ranking and the fallback-chain answer are under option 4.
4. **Not option 3.** The two public services cannot be recommended from the pages read: the Census
   pages are silent on keeping results and cannot match a venue name, and the public Nominatim
   service asks not to be sent personal data and can be withdrawn. Running our own is a server
   this product does not have. If the owner wants an address placed with no effort from the
   organizer, 3c is the only form with no third party, and it is a new piece of infrastructure
   with its own ADR.
5. **G4, the venue image: swap it in one change, after the street archive is on staging.** The
   event page shows the event's area from our own map where Google's picture was, and Google's
   call goes in the same change, so the page is never left with no map. This replaces the first
   draft's "remove now, redraw later": the owner's ruling makes our map the map of record, and a
   gap with no picture is avoidable by waiting for the archive. It is still the call to take
   first, being the only one made on a visitor's view and billed per view. An event nobody has
   placed shows its words and no picture.
6. **G3, the sponsor's area: the draft keeps its zip and no cell, and "local" is the same zip or
   the same placed hexagon,** once the owner has said so. This replaces the first form's "zip to
   cell", for the reason R2 gives for an event. It is a recommendation; the ruling did not reach
   it.
7. **G2, the poster's spot: a tap on our own map,** built once with option 1's surface. The
   lookup route goes in the change that ships the picker, not before.
8. **Stored geography: move the readers off the point, then clear the points, and change no
   table to do it.** The order, what reaches BigQuery and what keeps its history comparable are
   under "What is stored about a place".
9. **Hold the result with a source gate** like the LLM-free one: it fails when a Google Maps host
   or a `GOOGLE_MAPS_` name appears under `src/` or in `wrangler.toml`. The owner removes the
   secret. "No call to Google Maps" is true only when all four are answered.
10. **An order that never leaves a surface with no map:** the street archive on staging first;
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
  venue name with no further step. Under the ruling, an event shows a hexagon only when someone
  has tapped one.
- So some events will have no hexagon: the ones nobody places (automation, the sponsor path that
  lists an event, older rows whose lookup found no spot). They stay listed and are found by zip.
  Their reports have no corridor comparison, and their warehouse rows say `unknown`.
- The kind of place (business or address) has no source once Google's answer is gone, unless the
  organizer is asked.

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
- The owner's two answers on zip and tap were relayed to the author: the first by the Where-step
  session and its worksheet, the second by the hand-over note of the session that asked it. The
  author saw neither being given.
- Stored geography: every row count. Whether any poster row holds Google's wording of an address.
  How the warehouse's own views treat `unknown` or choose the latest row. Whether the Maps key
  and BigQuery share a Google Cloud project or billing account.
- Stored geography in the other repositories is a read of each local copy's `main`. OCR-docs and
  five of the six small product repositories were behind their remotes and were read at the
  older commit.
- Option 4: nothing was built or measured. No size, row count, build time or cost. No terms for
  any county's address data. What a TIGER address-range record holds, beyond the file's name.
  That road names are present in our zoom-14 archive: that is a reading of Protomaps' build code,
  and no tile was opened.
- That the share of events nobody places will be large or small once the lookup goes. It depends
  on how events are made, which was not counted.

## Open, for the owner

Settled by the owner on 2026-11-16 and no longer open: Google Maps goes from our own systems
(D1), our own map is the map of record (D2), links out for navigation stay (D3), a zip finds an
event and only the organizer's tap places it, with no cell made from a zip (C1 as ruled in R1 and
R2), our own area map stands where the venue image was (C2), cells are kept and stored points
cleared (C3, confirmed in R3), and ourWKRP hosts its own fonts (C4). The numbers below are kept
from earlier drafts so that references to them still hold.

1. **How an event gets its place (G1).** Answered: a tap places it (option 1) and a zip finds it
   (R1). An event nobody has placed has no hexagon (R2).
2. **If option 1:** cells only (1a), or a coordinate that is dropped (1b)? The Where-step design
   the owner confirmed is built on 1a (cell ids only), but none of the four decisions put to the
   owner names the choice, so it stays listed here. Res 7 only, or res 9 too: the same design
   records the owner's answer as a block only by the organizer's tap, only for a business or
   public place, never a home. Putting that into the written rule is the precision record's work.
3. **Option 2:** not taken as a source of an event's cell (R2). The earlier wording of this
   question ("the zip centre's hexagon is where an event sits until someone taps") is withdrawn.
   What is left of it: what should an organizer see when their zip is not in our table? The
   event still saves and is still found by its address's zip; the detail belongs to slice W1.
4. **Option 3:** not taken (C1). Nothing to answer.
5. **Stored points.** Answered: C3. Still for counsel: may a cell worked out from a Google point
   be kept after 30 days?
6. **The kind of place** (business or address): asked of the organizer, or dropped?
7. **The venue image (G4):** Answered: C2, on the event page and the SharedReport. Whether the
   report's small picture is redrawn or folded into the report's own map is OSE ADR-036's D2,
   which is still open there.
8. **The poster's spot (G2):** a tap on our own map, at res 9 as the rule already allows? May the
   lookup route go before the tap exists, leaving the two number boxes?
9. **The sponsor's area (G3):** the ruling on zip and tap was about an event and does not answer
   this. May a sponsor draft's area come from its zip at all? If the draft keeps only its zip, is
   "local" the same zip as the event, or the same placed hexagon, or either (the Where-step
   design's recommendation, ticketed as OSE-2099)? Or does the sponsor tap a hexagon too?
10. **The Calendar link:** the Directions links stay (D3). Does the Google Calendar link stay too,
    as linking out? What a Directions link may carry is the precision review's question.
11. **The source gate:** removing `GOOGLE_MAPS_API_KEY` follows from D1 and is the owner's step,
    last. Is the gate that keeps Google Maps from coming back wanted with it?
12. **A rule for every product:** is "no product calls Google Maps from its own systems" wanted as
    an org invariant in OCR-docs? It would be its own ADR there.
13. **The fonts in ourWKRP:** Answered: C4. The ticket and the change belong in ourWKRP.
14. **Option 4, our own address table:** accept it, refuse it, or leave it until option 1 is on
    staging? It was the owner's idea ("I would think that by using addresses this would correlate
    to locations"), given before "Only the tap".
15. **If option 4 is wanted: may anything but a tap make an event's cell?** As ruled, no. The
    table could then only open the picker at the right hexagon for the organizer to confirm. If
    the owner wants an address to place an event with nobody tapping, that changes R1 and is the
    owner's to say. A block (res 9) from an address with nobody tapping would also go against the
    confirmed block rule, and for a home address it would name the home's block.
16. **Rows that already hold a cell from a Google point:** they are kept (C3). Should they be
    told apart from tapped cells, in our own tables and in the warehouse? See "What is stored
    about a place", choice 5.
17. **The legacy sponsor areas** (`sponsor_areas`: a zip, or a point and a radius in miles): they
    hold points an admin typed, not Google's. Are they inside "clear points", or left as they are?
18. **The warehouse:** when an event first sent as `unknown` is later placed, is the old row left
    as history (recommended), or corrected in BigQuery by hand?

The location-precision review's own decisions stay open and are not restated as questions here.

## Implementation Notes

- This record implements nothing and created no ticket. The slices below were ticketed by the
  Where-step session on 2026-11-16, after the owner confirmed its design.

### The slices (under epic OSE-1880)

The order keeps a map on every surface at every step: our archive is on staging before anything
of Google's is taken away, each Google call is replaced before its code is removed, and the key
goes last. A slice is not built until the owner has answered the open questions it names.

The first form of this record proposed slices S0 to S6. The Where-step design
(`.claude/outputs/WHERE-STEP-MAP-CHOICE-2026-11-16.md`, sections 6 and 9) replaced them with W1 to
W8, and those are the ones in Linear. Each ticket below was read in Linear on 2026-11-16: the
seven new stories are in Backlog under OSE-1880, OSE-1985 existed already and sits under
OSE-1959, and each story has a CI/CD testing ticket under it. The S numbers are
kept so that earlier references still hold. Acceptance and test cases are on the tickets and in
the worksheet, not repeated here.

| Slice | What it does                                                                                                                                                                  | Story                 | CI/CD ticket | Was    | Waits on                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------ | ------ | ---------------------------------------------- |
| W1    | The ZIP at the Where step, stored on the event (`events.zip_code`); zip and town search read it for an event with no cell; the export guard refuses the zip names             | OSE-2095              | OSE-2102     | S1     | Nothing open                                   |
| W2    | Readers move off the stored point: dots from the block cell, no `lat` or `lon` in public output, Directions by words, poster and repeat copy cells                            | OSE-2096              | OSE-2103     | S5 (a) | Nothing open                                   |
| S0    | The street archive loaded on staging, and the staging street cases binding. An owner step (OSE ADR-035)                                                                       | OSE-2064, OSE-1535    |              | S0     | The owner                                      |
| W3    | The place picker in the admin: the organizer taps a hexagon on our own map, for an event's area and a poster's spot. The Google event lookup (G1) and the admin route (G2) go | OSE-2097              | OSE-2104     | S4     | S0. Open questions 2 and 8                     |
| W4    | The block step: a business or public place may be placed at its block, and the kind of place is what the organizer says                                                       | OSE-2098              | OSE-2105     | S4     | W3. The precision record, for the written rule |
| W5    | G4: the event page and the report show the event's area from our own map; the venue-image route goes in the same change                                                       | OSE-1985 (it existed) | OSE-2106     | S2     | S0. Chosen (C2)                                |
| W6    | G3: a sponsor draft keeps its zip with no lookup, and "local" by the owner's rule                                                                                             | OSE-2099              | OSE-2107     | S3     | Open question 9                                |
| W7    | Stored points cleared; cells already stored are kept; fixtures and the stock seed carry cells                                                                                 | OSE-2100              | OSE-2108     | S5 (b) | W2 and W3. Chosen (C3)                         |
| W8    | The end: the lookup code and both nightly jobs deleted, a source gate that holds it and is seen red, the key name out of the config; the owner removes the secret             | OSE-2101              | OSE-2109     | S6     | W3, W5, W6; open question 11                   |

**S1 is withdrawn as it was written** ("a save places an event from its zip"). No slice stores a
cell worked out from a zip. What stands in its place is W1, which stores the zip and teaches
search to read it.

Option 4 has no slice and no ticket. If the owner accepts it, it is a new slice after W3, with a
spike first for its size, build time and cost.

Other tickets already in Linear that these touch (found by search, 2026-11-16): OSE-1717 (ask for
the place name and the address separately; W1 takes it in), OSE-1750 (zip-sized areas for the
landing search and poster tagging), OSE-1357 (poster address to cells; W3), OSE-1498 and OSE-1504 (limits on the two
Google routes; they end with the routes), OSE-2073 (zoom tests owed on staging).

Tickets the ruling turns round, for the owner or the epic's keeper to cancel or reword, not
touched here: OSE-1688 (turn on the Geocoding API for the Maps key), OSE-555 (provision the Maps
key), OSE-217 (Google Maps venue display in SharedReports), OSE-235 and OSE-260 (the admin
geocoder work). The fonts in ourWKRP (open question 13) would be a ticket in ourWKRP, not here.

- W1 changes `inZipsOwnArea` in `lib/zip-areas.ts` and the create and update handlers; no
  migration is needed, because `events.zip_code` has been in the schema since migration 0021.
- For option 1, the frame and the hexagon outlines already come from
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
- `.claude/outputs/WHERE-STEP-MAP-CHOICE-2026-11-16.md`: the Where-step design. Section 4 is the
  evidence on a zip-centre cell, section 8 the four decisions the owner confirmed, section 13 the
  ruling on zip and tap, sections 6 and 9 the slices.
- `docs/features/SHARED-REPORT-BIGQUERY-EXPORT.md` (the export this record's stored-geography
  section reads).
- Pages read 2026-11-16: listed under "What the pages say".

## Revisit Criteria

- The owner rules on the precision decision: option 1's res-9 half is then settled or removed.
- Counsel answers on Google's terms or on a candidate service's.
- The street archive is loaded on staging: option 1 can then be tried.
- OSE places events outside the United States: our zip table does not reach them, so neither
  zip search nor the picker's opening area does.
- The owner rules on option 4, or on whether anything but a tap may make a cell.
