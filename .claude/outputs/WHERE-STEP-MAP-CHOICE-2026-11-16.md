# The Where step, our own map, and the map choice: one design (2026-11-16)

**Status:** confirmed by the owner on 2026-11-16, with all four decisions in section 8 as
recommended. **The owner then ruled on the two that were in question (section 13):** D1 stands, and D4 is replaced by "keep cells, clear points". Nothing is built. The slices are ticketed (section 9). It was written as a read-only
pass: no code, test or migration was changed. Nothing here was run; every "today" line is a source read on `main` at
`e7d21601`, with the lines given. Paths are under `workers/oursharedevents/src/` unless they say
otherwise.

**Asked by the owner (2026-11-16), word for word:** "so go read the code and resolve".

**The direction this design follows, in the owner's words (2026-11-16):**

- "Yes.. Then Google maps is removed and my map is the map of record until the user clicks out for navigation"
- "I understand there will linking out, but I am speaking to the OCR/OSE/OW internals"
- "I would think that by using addresses this would correlate to locations"
- "Isn't that in the event record which resigtering with me. They have to let me know where the event is located as part of the Where field"
- "then they decide by choice if they want the event on the map or not"

**Earlier owner decisions the design also has to keep** (found while reading; each is on record):

- 2026-10-03, OSE-1560: a new event is off the map unless the organizer says otherwise (`lib/map-default.ts:3-5`).
- 2026-10-07: "off the map" means not listed, not hidden (`handlers/pages.ts:2362-2376`).
- 2026-10-26, OSE-1750: "The zip-sized area is the default for every new event; fine (res-9) precision is an explicit organizer opt-in", and existing fine-cell data is to stop surfacing and be removed in its own reviewed migration.
- 2026-11-05: a zip shows the events in its own area (`lib/zip-areas.ts:16-30`).
- 2026-11-09: tap a hexagon to zoom; every place at its res-9 block centre, a business too (`docs/positioning/MAPPING-COST-STRUCTURE.md`, decision 5).

**How this sits beside ADR-039 (PR 1369).** That record lists the four Google calls (G1 to G4) and the
options. This worksheet settles how G1 is replaced and what the three open points come to. It
departs from the ADR's recommendation 1 in one way, on evidence the ADR did not have: **a zip is
never turned into a stored map cell** (section 3). The owner ruled for this reading on 2026-11-16
(section 13). It is for the ADR's author to fold in.

---

## 1. The design in one paragraph

**The zip finds an event. The organizer's tap places it. Nothing else does either job.**

At the Where step the organizer types the place name, the street address if they wish, and the
ZIP code. They then answer the question the wizard already asks: on the map, or not. If yes, the
wizard opens **our own map** at that zip's area and they tap the hexagon the event is in. The
event stores the words, the zip, and the tapped cell. No point is stored, no coordinate exists in
the browser or the request, and nothing leaves the Worker. An event that is not on the map
stores the words and the zip and shows wherever it shows today: by its link, its codes, its
poster and its report.

---

## 2. Point 1: one choice or two

### What the code does today

- **The choice already exists, in the owner's words.** Wizard step 1, right under "Where is it?":
  "Yes — put it on the map" / "No — keep it off the map", with No selected
  (`templates/admin.html:2185-2219`). The advanced form: "List this publicly — show it on the map
  and in search", unchecked (`templates/admin.html:4322-4328`). Both send `is_published` only when
  the organizer touched the control (`:2937`, `:9972`); untouched, the server stores off
  (`handlers/events.ts:957-961`).
- **Off the map** takes the event out of the landing list and map, `/events`, the public list
  API, the map API, the sitemap, the brand calendar feed, sponsor discovery, "next at this venue",
  the BigQuery backup and the corridor latch (one filter each: `lib/data-provider.ts:292`,
  `handlers/events-map.ts:183`, `lib/crawl-policy.ts:201`, `lib/sponsor-discovery.ts:78`,
  `lib/next-at-venue.ts:46`, `handlers/bigquery.ts:82`, `lib/corridor-latch.ts:70`). The page by
  id, the `.ics`, `/e/<code>`, the forms, `/q`, the poster, the display and the SharedReport still
  work (`lib/data-provider.ts:235`, `handlers/pages.ts:2362-2376`, `handlers/event-code.ts:82-89`).
- **A listed event with no cell is a half-state that exists today, by accident.** It happens
  whenever the lookup finds no spot (`lib/event-place.ts:117`, `:143-149`). What each surface does
  with it:

| Surface                               | Listed, no cell                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Landing list and `/events`, no search | Shown as a card (`lib/landing-area.ts:339-341`, `handlers/pages.ts:431-434`)                                                            |
| Landing hexagons                      | Not drawn (`lib/attendee-map.ts:307-308`), yet it counts toward the "10 events, map leads" gate (`lib/landing-area.ts:358-359`, `:392`) |
| Zip or town search                    | Left out, silently (`lib/zip-areas.ts:218`)                                                                                             |
| Zoomed area, map API                  | Never matches (`lib/landing-area.ts:340`, `handlers/events-map.ts:184`)                                                                 |
| Public list API                       | Returned with null cell and point; the place words are still sent (`lib/public-event-projection.ts:39-75`)                              |
| Sponsor "local"                       | Never local (`lib/sponsor-promotion.ts:171-172`)                                                                                        |
| BigQuery                              | Event row exported with corridor `unknown`; left out of both count tables (section 4)                                                   |

### Resolution: one choice. No second level.

1. The existing switch **is** "on the map or not". The copy, the comments and the API all call it
   the map. It stays the only choice.
2. A second level ("listed, but not placed") would protect nothing. The list card and the public
   API already print the place words; a hexagon is a 5 km² area, coarser than the words beside it.
3. What needs to change is the half-state, not the switch. In the design, saying yes to the map
   **is** placing the event on it: the tap is part of the same step. A listed event with no cell
   then comes only from automation, from the sponsor path (`lib/map-default.ts:93-98` lists an
   event with no cell check) or from before this change. It keeps working: listed, found by its
   zip (section 3), no hexagon, and the admin says "listed, not placed on the map yet".
4. OSE-1002 (Backlog, 2026-08-25: "hide my exact location") is met in part: an event placed by
   area only has no block and no dot. Its other half, hiding the address words, is the precision
   review's decision 3 and is not settled here.

---

## 3. Point 2: search by area

### What the code does today

- **The Where step captures no zip, in any path.** The wizard has one box and sends it as
  `location` only; its example is "Rock Island Public House, Blue Island"
  (`templates/admin.html:2158-2167`, `:2932-2933`). The advanced form has "Venue" (`location`) and
  an optional "Where (full address)" whose example ends in a zip (`:4471-4478`). The wizard's edit
  sends `location` only (`:3340-3351`). The create and update handlers read no zip field
  (`handlers/events.ts:764`, `:780`, `:1248`, `:1261`).
- **A column for it already exists and has never been written:** `events.zip_code`, migration
  `0021_add_geo_to_events.sql:6`, added "for hyperlocal sponsor matching". Its one reader is the
  sponsor resolver (`lib/sponsor-resolver.ts:214`, `:370`, `:393`).
- **Search needs a cell first.** `inZipsOwnArea` returns false for an event with no cell at
  `lib/zip-areas.ts:218`, before it reads the address's own zip at `:223`. So an event at
  "…, Blue Island IL 60406" with no cell is not found by a search for 60406. The visitor is told
  "nothing near" (`handlers/pages.ts:3074-3084`). Town search goes through the same function
  (`lib/place-search.ts:143-149`), and so does `/events?q=<town or zip>`
  (`lib/event-discovery.ts:383-389`).
- One exception shows the fix is small: for a zip the Census table lacks (a PO-box zip), an event
  is matched by its address text alone (`lib/place-search.ts:145-148`, `lib/place-names.ts:107-115`).

### What the "search-only zip cell" proposal would touch

Stored in `events.h3_res7`, it is not search-only: every reader of that column would take it for
a real place. Stored in a new column, it needs a second set of writes and clears beside every
place edit (`handlers/events.ts:1402`, `:1427-1434`; `lib/event-place.ts:146`). Section 4 says
what the first form does to the reports.

### Resolution: search by the zip itself. No cell is made from a zip.

1. The Where step asks for the **ZIP code** (in person and both). It is stored in
   `events.zip_code`, five digits. The wizard fills it in when the address ends in a zip
   (`addressZip`, `lib/zip-areas.ts:130-147`) or when the town typed has exactly one zip
   (`findPlaces`, `lib/place-search.ts:101-126`). No migration: the column is there.
2. `inZipsOwnArea` changes in one place: an event with **no cell** belongs to the zip it gives
   (`zip_code`, else the zip its address ends with). An event with a cell keeps today's rule,
   with `zip_code` read ahead of the address. About ten lines, in one function that both the
   landing and `/events` already use.
3. Nothing else reads the zip as a place. No hexagon is lit from it and no report sees it.

This also mends a fault that exists today with Google in place: any event whose lookup found no
spot is missing from zip and town search.

---

## 4. Point 3: reports

### What the code does today

- **The corridor id is the event's own res-7 cell.** No parent cell, no table:
  `canonicalCorridorId` lowercases it or returns `unknown` (`lib/export-geography.ts:83-86`, `:53`).
- **BigQuery sends only listed events** (`handlers/bigquery.ts:82`). An off-map event sends nothing.
- **A listed event with no cell** exports its event row with corridor `unknown`
  (`handlers/bigquery.ts:157`; `lib/shared-report-export.ts:899`, `:930`). The two count tables
  leave `unknown` out (`lib/shared-report-export.ts:549-553`, `:753-757`). So `unknown` is never
  pooled into a made-up corridor of counts.
- **Corridor baselines** are worked out in the Worker, per (cell, weekday, hour), from events that
  have a cell (`lib/shared-report.ts:374-392`, filter at `:389`). An event with no cell gets no
  baseline, and its report says so: `no_baseline_yet` (`lib/shared-report-builder.ts:61-66`,
  `:714-719`, and `:627-633` for the return-rate comparison).
- **The corridor latch** records, once and for good, that a brand's cell held five listed events
  (`lib/corridor-latch.ts:61-80`; migration 0084: "Never updated, never deleted"). An event with
  no cell does not count (`:71`).
- **The SharedReport** draws its map and its poster table from **poster** cells and scan cells,
  not the event's (`lib/shared-report-builder.ts:816-874`, `:931-969`). With no event cell it
  loses only the corridor comparison and the "Neighborhood Preview" hexagon (`:975-990`).
- **Sponsor "local"** is strict equality of two res-7 cells, in five places
  (`lib/sponsor-promotion.ts:171-172`, `lib/sponsor-discovery.ts:108` and `:205`,
  `lib/sponsor-resolver.ts:361`, `handlers/sponsors.ts:1017`). No neighbours. Null on either side
  is not local. The answer is kept on the placement and is not worked out again when the event's
  cell changes (`handlers/sponsors.ts:1012-1019`).
- **The venue key** shared with ourWKRP is a hash of the place name and the res-7 cell
  (`lib/spine-keys.ts:112-118`). No cell, no key.

### Would a zip-centre cell fix or distort them? It distorts every one.

A res-7 cell is about 2.4 km across. The median zip centre is 7.5 km from the next one (ADR-039's
measurement). The corridor is exactly one res-7 cell, so a cell that is one hexagon off is a
different corridor. A rough estimate, not a measurement: a venue in a median zip shares its zip
centre's cell about one time in ten.

| Reader                                      | With a zip-centre cell in `h3_res7`                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| BigQuery corridor id                        | A wrong corridor, sent as if it were exact, where today it says `unknown`                 |
| Returns and baseline counts                 | People counted at one venue pooled with venues in another hexagon                         |
| SharedReport comparison and preview hexagon | A baseline from unrelated venues; a preview drawn in the wrong place                      |
| Corridor latch                              | Five such events open a corridor that holds no venue, for good                            |
| Sponsor "local"                             | A false match gives a sponsor the local share, and the kept answer is not corrected later |
| Venue key                                   | The same venue gets one key when placed by zip and another when placed by tap             |
| Zip search                                  | Fixed                                                                                     |

### Resolution

1. **No zip-centre cell is stored, in any column.** `h3_res7` and `h3_res9` hold only what the
   organizer placed. Everything in the table above keeps the safe handling it has today for an
   event with no cell.
2. **The runtime export guard gains the zip names.** `SUB_CORRIDOR_KEY`
   (`lib/export-geography.ts:26-27`) does not list `zip`, `zip_code` or `postal_code`; the static
   gate does (`tests/e2e/0-architecture/export-grain.invariant.spec.ts:98`). Once `zip_code` is
   written, both should refuse it.
3. **A placement write stamps `updated_at`,** so an event first exported as `unknown` is sent
   again under its real corridor (the backup takes rows updated in the last 24 hours,
   `handlers/bigquery.ts:314`; today's lookup write does not stamp it, `lib/event-place.ts:137`).
4. **Sponsor "local"** needs the owner's rule once the sponsor's own place comes from a zip
   (ADR-039, open question 9). Recommended: local when the two zips are the same, or the two
   tapped cells are.

---

## 5. The Where step, in full

### What the organizer types

| Field          | Stored in                  | Rule                                                                                                                                                                                  |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Place name     | `location`                 | As today. Required for in person and both                                                                                                                                             |
| Street address | `where_address`            | Optional. The wizard gains the box (this is OSE-1717, Backlog)                                                                                                                        |
| ZIP code       | `events.zip_code` (exists) | Five digits. Filled in from the address or a one-zip town; the organizer can change it. Asked for in person and both. "60406-1234" keeps the first five. Automation may still omit it |

An online event has no place, as today (`lib/attendance-mode.ts:91-94`).

### What they tap

Only after "Yes — put it on the map":

1. **The area.** The wizard shows the zip's own area: the hexagon the zip's centre is in and the
   two rings round it (19 hexagons, about 10 km across), over our street map. Each hexagon is a
   button that carries its own cell id. None is chosen for them. They tap the one the event is
   in. "Not here? Show a wider area" steps out one level.
2. **The block (optional, and only if the owner's precision ruling allows it).** For a business
   or public place the organizer may go on: seven smaller hexagons, then seven blocks. Each step
   is a choice of seven large targets, so the 44 px floor holds on a phone. A home or private
   address is not offered this step.

What is posted is cell ids only (ADR-039 option 1a). The picture is drawn by the Worker through
the one door that takes cells and nothing else (`loadStreetLayer`, ADR-036 D1).

### The way to place without a pointer

- Every hexagon is a real, focusable control in reading order, named by direction and nearest
  zip ("north-east of the centre, nearest ZIP 60655"). The same choices are shown as a list beside
  the map. Keyboard and screen reader use the list; so does everyone when the street layer does
  not draw.
- Automation sends a cell: the API takes `h3_res7`, and `h3_res9` with it.

### What is stored

|                         | On the map                                                                                       | Not on the map |
| ----------------------- | ------------------------------------------------------------------------------------------------ | -------------- |
| `is_published`          | 1                                                                                                | 0              |
| Words, zip              | yes                                                                                              | yes            |
| `h3_res7`               | the tapped hexagon                                                                               | none           |
| `h3_res9`, `place_kind` | only from the optional block step; `place_kind` is what the organizer said (business or address) | none           |
| `lat`, `lon`            | **never**                                                                                        | never          |

**Cell only, no point.** Invariant 3 says admin writes take coordinates "only to derive the cell";
the handlers store the point (`handlers/events.ts:973-977`, `lib/event-place.ts:137`). This design
is stricter than the invariant's words: no coordinate is taken at all. The server checks what it
is sent: a real cell, the right resolution, the block inside the area
(`tagsConsistent`, `lib/h3-tagging.ts:49-55`), and the area within the zip's own bound of eight
rings (`withinBound`, `lib/zip-areas.ts:188-195`). A cell in another state is refused, not stored.

**Editing.** A changed zip clears the placement and the admin asks again. A changed name or
address keeps it and asks the organizer to check the spot. Turning the map off keeps the stored
placement and stops showing it; turning it on again does not ask twice.

### Where a not-on-the-map event still shows

Its page by link, its `.ics`, `/e/<code>`, its forms, `/q` scans, its poster, the display, its
sponsor card, its SharedReport and the admin. Nowhere else. Its zip is used by nothing public.

### Existing events, and the points Google gave

- Rows hold `lat`, `lon`, both cells and a kind from Google, or from coordinates automation sent.
  A Google answer is marked by `place_checked_at` (`lib/event-place.ts:137`).
- **First the readers move off the point** (`lib/attendee-map.ts:588-599` uses it to find the
  block; `handlers/events-map.ts:202-203` and `lib/public-event-projection.ts:62-63` publish it;
  `lib/geo-link.ts:28-33` puts it in the Directions links; `handlers/poster-deployments.ts:236-239`
  and `lib/event-repeat.ts:141-146` copy it). They read the cells or the words instead.
- **Then the points are cleared**, in a migration of its own with a backup first (the owner's
  2026-10-26 decision 3).
- **Cells that came from a Google point are kept** (the owner's ruling of 2026-11-16, section 13:
  "Keep cells, clear points"). The migration clears points only and no cell, so those events
  keep their hexagon. Google's policy page gives a 30-day limit on a kept point and no exception
  for a value worked out from it; whether such a cell may be kept past the 30 days is still a
  question for counsel. The staging stock seed and the Bruno fixtures carry cells instead of
  coordinates.

### The dot rule without Google's place types

- The rule the code has is already the strict one: **every dot is the centre of its res-9 block, a
  business too.** The kind only changes the mark and the words
  (`lib/attendee-map.ts:594-602`, `:649`; `lib/map-place-panel.ts:126-134`). The comment that
  still says "exact point" is stale (`lib/event-place.ts:46-49`).
- It survives with two small changes. The dot reads the stored block (`h3_res9`) where it now
  works the block out from the point. And the kind becomes **what the organizer said**, asked at
  the block step, where it is now Google's label (`placeKindOf`, `lib/event-place.ts:56-58`).
- "Somewhere in this area" keeps its meaning: placed in the hexagon, no block chosen
  (`lib/attendee-map.ts:590-592`).

---

## 6. What it removes, and in what order

The order keeps a map on every surface at every step. Each Google call is replaced before its
code goes. ADR-039's S0 to S6 are the frame; W1 to W8 are these slices.

| Step | What changes                                                                                                                                                                                                                                             | Google after it           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| W1   | Zip at the Where step, stored; search by zip for an event with no cell; export guard names                                                                                                                                                               | Unchanged                 |
| W2   | Readers off the stored point: dots from the block, no `lat`/`lon` in the two public APIs, Directions by words, a venue poster takes cells                                                                                                                | Unchanged                 |
| S0   | The street archive loaded on staging (owner step; the build is offered through 2026-11-21)                                                                                                                                                               | Unchanged                 |
| W3   | The place picker in the admin, for an event's area and a poster's spot. **G1 goes in this change** (the lookup on create and update, and the nightly job at `index.ts:160`). **G2 goes in this change** (`POST /api/v2/admin/geocode`, `router.ts:2229`) | G3, G4 left               |
| W4   | The block step and the organizer's kind, for an event. Waits on W3                                                                                                                                                                                       | G3, G4 left               |
| W5   | **G4:** the event page and the report show the event's area from our own map; the venue-image route goes in the same change (OSE-1985)                                                                                                                   | G3 left                   |
| W6   | **G3:** a sponsor draft keeps its zip, with the owner's "local" rule                                                                                                                                                                                     | None                      |
| W7   | Stored points cleared; cells already stored are kept; fixtures and seed to cells                                                                                                                                                                         | None                      |
| W8   | `lib/geo.ts`, `lib/maps.ts`, the lookup and both nightly jobs deleted; a source gate fails on a Google Maps host or key name; the owner removes the secret                                                                                               | None, and a gate holds it |

Two things the order protects. The landing hexagons never empty: G1 stays until the picker that
replaces it ships in the same change. The event page never shows a broken picture: the image is
swapped, not removed.

---

## 7. The precision review's six decisions

The location-precision review (2026-11-09, 0%) left six decisions with the owner. This design:

| #   | Decision                                                    | This design                                                                                                         |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Which Google uses go                                        | **Answered by the owner on 2026-11-16.** The design carries it out                                                  |
| 2   | Finest precision a public map may draw: res 7, or res 9     | **Not answered.** Built to work either way: W1 to W3 need only res 7. W4 (the block) waits on the ruling            |
| 3   | Is a typed address public on the event page, and for a home | **Not answered, not touched.** It does remove the stored point and keeps a home off the block step                  |
| 4   | Is "off the map" a privacy control                          | **Not answered.** Keeps the 2026-10-07 meaning: not listed, not hidden                                              |
| 5   | Paths that publish without the organizer choosing           | **Not answered.** One new fact: the sponsor path can list an event that has no hexagon (`lib/map-default.ts:93-98`) |
| 6   | Count seeding through the forms (F37)                       | **Not answered, unrelated**                                                                                         |

The review's rule still holds: no place or map text lands in `OCR_VISION.md` or invariant 3
before a new ADR. This design changes neither. When it is built, invariant 3's sentence about
admin writes becomes true in a stricter form than it is written; rewording it is that ADR's work.

---

## 8. Decisions that need the owner

Only what the code could not settle. Each has a recommendation.

**The owner's answer (2026-11-16).** Asked "Confirm the Where-step design with all four
recommended decisions?", the owner answered, word for word: "Confirm all four". So each of the
four below is decided as recommended:

- **D1.** A zip finds an event; only the organizer's tap puts it on the map. No cell is made from a zip.
- **D2.** A listed event that nobody placed stays listed and found by zip, with no hexagon.
- **D3.** A block and a dot only by the organizer's own tap, only for a business or public
  place, never for a home. This answers the precision review's decision 2 for this design. It
  puts no text into `OCR_VISION.md` or invariant 3; that still needs the new ADR.
- **D4.** Cells that came from a Google point are cleared with the points. **Replaced the same
  day (section 13):** cells already stored are kept, and only the stored points are cleared.

**Two of the four were in question for about an hour, and the owner then ruled (section 13).**
D1 stands as written. D4 is replaced by "Keep cells, clear points". What follows is the record of
the question, kept so the ruling can be read against it. About forty
minutes after "Confirm all four", the owner answered four questions in the session that keeps
ADR-039, and that record (PR 1369, commit `1fafe532`) holds two answers that disagree with D1
and D4:

|                           | This worksheet                                                        | ADR-039, as recorded                                                                                       |
| ------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A zip and the map         | D1: no cell is made from a zip; an event nobody placed has no hexagon | C1, "Zip, plus a tap", read there as: "the zip centre's hexagon is where an event sits until someone taps" |
| Cells from a Google point | D4: cleared with the points                                           | C3, "Keep cells, clear points"                                                                             |

Neither record overrode the other. The button "Zip, plus a tap" can be read either way: as this
worksheet's rule (the zip finds, the tap places) or as the ADR's (the zip also lights a hexagon).
Section 4 is the evidence against the second reading: it sends a wrong corridor to BigQuery as if
exact, and sets the one-way corridor latch. **The owner settled both the same day (section 13):**
the zip finds and the tap places, so no slice may store a zip-centre cell; cells already stored
are kept and stored points are cleared, so W7 clears points only. While the question was open
nothing in W1 or W2 depended on either answer (W1 makes no cell from a zip, which is also what
the code does today). D2 and D3 were not touched by the ADR's answers. The ADR's C2 ("Our own
area map") agrees with this worksheet's recommendation on the venue picture and settles it.

The three lines after the list (sponsor "local", the venue picture, when the lookup route goes)
were recommendations on ADR-039's own questions. The owner's answer was to the four; those three
stand as recommendations and are written that way on their tickets.

1. **A zip finds an event; only the organizer's tap puts it on the map.** Recommended. The other
   way (the zip also lights the hexagon at the zip's centre) is ADR-039's option 2 and distorts
   the reports as section 4 shows.
2. **A listed event that nobody placed** (automation, the sponsor path, older rows): **let it
   stay listed and found by zip, with no hexagon** (recommended), or refuse to list until placed.
   Refusing changes every test that lists an event without a place.
3. **The block and the dot** (precision decision 2): **res 9 only by the organizer's own tap, only
   for a business or public place, never for a home** (recommended), or res 7 only with places
   listed by name, or a block for any address as the code does today.
4. **Cells that came from a Google point: clear them with the points** (recommended at the time),
   or keep the cells and clear only the points. **The owner chose the second (section 13).**
   Counsel may still have a view on it.

From ADR-039's own list, with this design's recommendation: question 9, sponsor "local" is the
same zip or the same tapped hexagon; question 7, the venue picture is the event's area from our
own map when it has one and nothing when it does not; question 8, the lookup route goes when the
picker ships, not before.

---

## 9. Build slices (epic OSE-1880). Ticketed on 2026-11-16 after the owner confirmed; nothing is built.

| Slice | Story                 | CI/CD testing ticket |
| ----- | --------------------- | -------------------- |
| W1    | OSE-2095              | OSE-2102             |
| W2    | OSE-2096              | OSE-2103             |
| W3    | OSE-2097              | OSE-2104             |
| W4    | OSE-2098              | OSE-2105             |
| W5    | OSE-1985 (it existed) | OSE-2106             |
| W6    | OSE-2099              | OSE-2107             |
| W7    | OSE-2100              | OSE-2108             |
| W8    | OSE-2101              | OSE-2109             |

Every slice has a CI/CD testing ticket and cases at both layers: the workers-pool mock layer and
staging (Bruno or Playwright, named in a workflow). Every new test is watched red on an injected
fault before it is trusted.

**Already in Linear (searched 2026-11-16), so nothing is filed twice:** OSE-1717 (wizard asks name
and address separately; W1 takes it in), OSE-1750 (zip-sized areas, decided 2026-10-26; W1 and W4
carry its decisions 1 and 3), OSE-1002 (hide my location; met in part), OSE-1985 (venue image;
W5), OSE-1498 and OSE-1504 (limits on the two Google routes; they end with the routes), OSE-1357
(poster address to cells; W3), OSE-2073 (zoom tests owed on staging; W2 and W4), OSE-1245 (its
open precision half; W2), OSE-941 (two corridor key spaces; untouched). To cancel or reword after
the ruling: OSE-1688, OSE-555, OSE-217, OSE-235, OSE-260.

### W1. The ZIP at the Where step, and search that reads it

**Acceptance**

- Both create paths and the wizard's edit show a ZIP box for in person and both; create and
  update store it in `events.zip_code`; an online event stores none.
- The wizard has a place name box and an address box (OSE-1717), and fills the ZIP from the
  address or a one-zip town.
- A listed event with no cell is found by `/?zip=`, `/?where=<town>` and `/events?q=` under its
  own zip, and under no other.
- An event with a cell is found exactly as before.
- No row bound for BigQuery can carry a zip: the runtime guard refuses the names.
- Writing a zip does not change which sponsors an event shows (`lib/sponsor-resolver.ts:367-411`
  starts filtering once an event has a zip; the slice either keeps that off or states it).

**Cases**

|            | Workers pool                                                                                                           | Staging                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Sunny      | Create with a zip stores it; search by that zip lists the event with no cell                                           | Bruno: create, list, `/?zip=` finds it                        |
| Rainy      | A zip not in the table saves, with a note; a PO-box zip still matches by address                                       | Bruno: the note is in the answer                              |
| Edge       | ZIP+4 keeps five; the zip and the address disagree (the box wins); a town with many zips is not filled in; `both` mode | Playwright: wizard fill-in from an address, phone and desktop |
| Fat finger | Four digits, letters, spaces, a street number that looks like a zip, a zip from another state with a cell here         | Bruno: each is a 400 or is ignored as stated                  |
| Born red   | Put the cell test back ahead of the zip: the search case fails. Drop a name from the guard: the export case fails      | The same two, seen in a CI log                                |

**CI/CD ticket:** the search cases join the landing zip suite at both layers; the guard case joins
the export-grain invariant in T0.

### W2. Readers off the stored point

**Acceptance**

- The zoomed map draws a dot from `h3_res9`; an event with an area and no block is under
  "Somewhere in this area".
- `GET /api/v2/events` and `GET /api/v2/events/map` send no `lat` or `lon`, with the API notice
  ADR-016 asks for.
- Directions links carry the address or the place name, never a point.
- A venue poster takes the event's cells. ("Repeat this event" is not in this slice: it copies
  the zip in W1 and the cells in W3, so W1 and W2 share no file.)
- A canary event with a known point: no public page, API answer, link or file contains it at any
  rounding (the precision review's gate G1).

**Cases**

|            | Workers pool                                                                                  | Staging                                    |
| ---------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Sunny      | Dot at the block centre from the cell alone                                                   | Playwright: zoomed area on the seeded cell |
| Rainy      | A block whose parent is not the area is not drawn                                             | Bruno: both APIs, no coordinate keys       |
| Edge       | Two events on one block share a dot; an event with a point and no block is listed, not dotted | Bruno: Directions link text                |
| Fat finger | A malformed cell in the row draws nothing and breaks nothing                                  |                                            |
| Born red   | Read the point again in any one reader: the canary fails                                      | The canary, seen red                       |

**CI/CD ticket:** the canary spec is listed in the T0 `invariants` step, with a Bruno twin.

### W3. The place picker, and the end of G1 and G2

Waits on S0. Decisions 1 and 2 are made (sections 8 and 13).

**Acceptance**

- "Yes — put it on the map" opens the picker at the zip's area; no hexagon is chosen in advance.
- A choice posts a cell id and nothing coordinate-shaped; the server refuses `lat`, `lon` and
  their other spellings on these writes.
- The stored row has the cell and no point; a cell outside the zip's eight-ring bound is refused.
- The whole placement can be done by keyboard, and with the street layer absent.
- A poster's spot is placed the same way, down to its block (res 9 is already its rule).
- A save makes **no outbound request**. The lookup on create and update, the nightly job and the
  admin lookup route are gone; the route answers 404.
- A changed zip clears the placement; the admin event page offers "Place on the map".

**Cases**

|            | Workers pool                                                                                                                | Staging                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Sunny      | Picker answer lists 19 cells for a zip; a post stores the cell                                                              | Playwright: tap a hexagon, the landing shows it      |
| Rainy      | No street layer: the list alone places the event; an unknown zip offers no picker and says why                              | Playwright: the same with the layer flag off         |
| Edge       | "Wider area"; a zip on a state line; an event moved to another hexagon keeps one row; a placement write stamps `updated_at` | Bruno: place, move, re-read                          |
| Fat finger | A res-9 cell sent as the area; an area 300 km from the zip; a cell with a capital letter; two taps in a row                 | Bruno: each refused with its code                    |
| A11y       | One `h1`; every target 44 px or more at 320 px; focus order; names read aloud                                               | The phone audit and axe, in the required job         |
| Born red   | Stub `fetch` to throw on any call: a save still succeeds. Remove the bound check: the far-cell case fails                   | A staging run with the outbound guard, seen red once |

**CI/CD ticket:** a source gate that fails when create or update can reach a lookup; the picker
journey in T3; the mobile audit.

### W4. The block and the organizer's kind

Waits on W3. Decision 3 is made (section 8).

**Acceptance:** a business or public place may go on to a block; the row gains `h3_res9` and
`place_kind` as the organizer said; a home is never offered the step; the landing dot and panel
read as they do today.

**Cases:** sunny (two steps of seven give a block inside the area); rainy (kind changed from
business to home clears the block); edge (two events on one block; a block on the area's edge);
fat finger (a block from another area refused); born red (swap business and address: the mark
test fails). Staging: Playwright on the zoomed area over real tiles (OSE-2073).

**CI/CD ticket:** mutation scope for the panel, the links and the place files.

### W5. The venue picture from our own map (G4)

Waits on S0. **Acceptance:** the event page and the report show the event's area from our street
layer with its credit; an event with no cell shows words and Directions and no picture; with no
layer the page is whole; the venue-image route answers 404; no request to Google on a page view.
**Cases:** sunny, no cell, no layer, a slow layer, both themes, phone width; born red by leaving
the old `<img>` in. **CI/CD ticket:** golden pages regenerated in the same change; a Bruno case
for the 404.

### W6. The sponsor's area from its zip (G3)

Waits on the "local" rule. **Acceptance:** a draft keeps its zip, makes no outbound request, and
is local by the owner's rule; a draft with no zip is never local by default. **Cases:** a sponsor
on each side of the rule's line; an address with no zip; a ZIP+4; born red by forcing local on.
**CI/CD ticket:** the covenant sponsor suite at both layers.

### W7. Stored points cleared

Waits on W2 and W3. Decision 4 is made (section 13): points are cleared, cells are kept.
**Acceptance:** a backup, then a migration that nulls every `lat` and `lon` on events, posters
and drafts and clears no cell; as many rows hold a cell after it as before; fixtures and the
stock seed carry cells; the daily stock totals still hold. **Cases:** counted on staging before
and after; a row placed by tap is untouched; a row a Google answer placed keeps both cells and
loses its point; born red by a check that fails if any point remains, and by one that fails if a
cell is lost. **CI/CD ticket:** a schema-level check in T0 that no handler writes those columns.

### W8. The end

**Acceptance:** `lib/geo.ts`, `lib/maps.ts`, the lookup functions and their specs are deleted; a
source gate, modelled on the LLM-free one, fails on a Google Maps host or a `GOOGLE_MAPS_` name
under `src/` or in `wrangler.toml`, and is seen red; the secret's name leaves the config and the
checklist; the owner removes the secret. **CI/CD ticket:** the gate listed in the T0 `invariants`
step.

---

## 10. Found in passing (not part of this design; none fixed)

- **A listed event with no cell tips the landing to "map leads" and adds no hexagon**
  (`lib/landing-area.ts:358-359`, `:392`).
- **The nightly landing latch counts online events; the landing list drops them**
  (`lib/corridor-latch.ts:96-98` against `handlers/pages.ts:2992`).
- **Create does not range-check coordinates; update does** (`handlers/events.ts:928-929` against
  `:1374`). By source, an out-of-range value on create reaches `tagCoordinates`, which throws
  (`lib/h3-tagging.ts:31-41`). Not run.
- **An in-person event can be left with no place on update:** clearing both text fields passes
  the place rule on the stored point, and the same update then clears the point
  (`handlers/events.ts:1427-1434`, `:1467-1473`). By source; not run.
- **The corridor latch has no test for a cell that later changes,** and a sponsor's kept "local"
  answer is not worked out again when the event moves.
- **Two stale comments:** `templates/admin.html:2175` says the API defaults `is_published` to 1 (it
  is 0); `lib/event-place.ts:46-49` says a business is drawn at its exact point (it is not).

## 11. Not verified

- Nothing was run: no test, no Worker, nothing on staging or production.
- Whether `GOOGLE_MAPS_API_KEY` is set anywhere, and so whether any lookup runs today.
- How many rows hold a Google point, and whether production holds any event.
- That 19 hexagons, and then seven and seven, are legible and tappable over our streets on a
  phone. The archive is not loaded; the top zoom is 14. This needs a spike at the start of W3.
- The "one time in ten" figure in section 4 is an estimate from zip spacing, not a count.
- Whether CI names every spec cited as today's cover.
- The warehouse side of BigQuery (views, how `unknown` is read) is not in this repository.

## 12. How this was read

Three read-only audits in parallel (backend, surfaces, data), each asked for file and line and to
list its commands; then the lines that carry a conclusion were re-read by the lead. ADR-039 was
read from PR 1369's head without touching its branch. The precision review was read from its
worksheet in worktree `nervous-goldstine-a50ad3` and its final loop file in the review's notes
folder. Linear was searched for duplicates; nothing was created or changed there.

## 13. The owner's ruling on the conflict (2026-11-16)

Section 8 records that D1 and D4 disagreed with two answers in ADR-039. The owner was asked:
"Should a zip only find an event (no hexagon until tapped), with already-stored cells kept?" and
answered, word for word: "Yes, that".

- **D1 stands.** A zip only finds an event. No cell is made from a zip, and an event has no
  hexagon until someone places it. ADR-039's reading of C1 ("the zip centre's hexagon is where an
  event sits until someone taps") is not the rule; "Zip, plus a tap" means the zip finds and the
  tap places.
- **D4 is replaced by ADR-039's C3: "Keep cells, clear points".** Cells already stored stay,
  those worked out from a Google point included. Stored points are cleared once nothing reads
  them. Whether such a cell may be kept past Google's 30 days is still a question for counsel.
- **What changes in the slices.** W7 clears points only, never cells, and is no longer on hold
  for this reason; it still waits on W2 and W3. Nothing else changes. Sections 5, 6, 8 and 9
  were brought into line with this ruling on 2026-11-16, in a change after the one that first
  put this worksheet on `main` (PR 1377), so they no longer speak of clearing a cell.
- **Done after this ruling (2026-11-16):** Linear OSE-2100 (W7) and its CI/CD ticket OSE-2108
  say points are cleared and cells are kept; OSE-2095 says the rule is settled.
- **Still owed:** ADR-039 reworded on C1. It reached `main` in PR 1369 at `1fafe532` with the
  other reading still in it: its C1 row ("Every event is placed from the zip in its address"),
  its open question 3 ("the zip centre's hexagon is where an event sits until someone taps") and
  its slice S1 ("a save places an event from its zip"). Those lines are not the rule. The
  rewording is with the ADR's keeper.
