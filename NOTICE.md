# NOTICE: map data and tools from other people

OurSharedEvents draws streets under its H3 hexagons from OpenStreetMap data. This file says
where that data comes from, under which licence, what credit the pages show, how our copy is
made, and which licence duties are met today.

- **Written:** 2026-11-15, from the licence texts read at their source that day (list at the
  end). Part of OSE-2064. It answers finding R25 of the street-map review
  (`.claude/outputs/CCR-STREET-MAP-WILL-IT-WORK-2026-11-15.md`).
- **It is a record, not legal advice.** Nobody with legal training has read it. Where the texts
  do not settle a duty, this file says NOT CLEAR and asks the owner; it does not guess.
- **How clauses are cited.** Each duty names the section and the address to read it at, and
  says in our own words what the section asks. The licence texts are not copied here.
- **Nothing is public yet.** No archive has been loaded, so no page has drawn a street
  (`streetMapArchiveLoaded` is `"false"`; the load workflow has no `load` run, only `measure`
  runs, which write nothing; read 2026-11-15).
  Every verdict below is about the code on `main` and the workflow as written.

## When the duties start

The credit and notice duties start when a picture drawn from the data is shown to people
outside our control (ODbL 1.0, section 1, "Publicly", and section 4.3). Staging counts:
`https://stg.oursharedevents.com/` answered 200 with no sign-in and no challenge on
2026-11-15, and the Worker draws streets on its next request once the object is in the
bucket (runbook, "Staging, in order", step 8). **So the first load to staging is the first
public street**, not the production binding.

## The data

| What                                   | Whose                                                                                   | Licence                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Roads, water (zoom 6 and finer), names | OpenStreetMap contributors                                                              | Open Database License 1.0 (ODbL): <https://opendatacommons.org/licenses/odbl/1-0/>                    |
| The tileset the data arrives in        | Protomaps (the `basemaps` project), daily build `20261115`, tileset version 4.15.2      | Protomaps: its tilesets are ODbL, given out as an ODbL "Produced Work", OpenStreetMap credit required |
| Water and land at zoom 0 to 5          | Natural Earth                                                                           | Public domain; no credit needed (Protomaps `LICENSE_DATA.md`)                                         |
| Coastline polygons at zoom 6 and finer | osmdata.openstreetmap.de, made from OpenStreetMap                                       | ODbL (Protomaps `LICENSE_DATA.md`)                                                                    |
| Land cover at zoom 0 to 7              | Daylight, made from ESA WorldCover                                                      | CC BY 4.0 (Protomaps `LICENSE_DATA.md`). **In the file, never drawn and never served by us**          |
| Ranking of place names                 | Wikidata ids joined to QRank                                                            | Protomaps' pages state no licence for either. Not read further                                        |
| Other inputs                           | Protomaps names "datasets for language support and ranking" and an Overture credit page | Not stated which layer they feed. Not read further                                                    |

**What we draw from it:** three layers only, `water`, `roads` and `places`
(`WANTED` in `workers/oursharedevents/src/lib/street-map.ts`). Buildings, points of
interest, land cover and every other layer stay in the file and are skipped without being
decoded. The file sits in a private bucket and is never offered for download.

## The credit the pages show

Text, from `workers/oursharedevents/src/lib/i18n/catalog.ts` (`map.credit`), with the two
names as links:

> Street map data © [OpenStreetMap](https://www.openstreetmap.org/copyright/en) contributors,
> prepared by [Protomaps](https://protomaps.com).

- **Languages:** English, Spanish, Polish and Arabic (`catalog.ts`, `catalog-pl.ts`,
  `catalog-ar.ts`). The Polish and Arabic lines are machine drafts awaiting a native read
  (OSE-1968). The OpenStreetMap link goes to that language's copyright page
  (`/copyright/en`, `/es`, `/pl`, `/ar`; each answered 200 on 2026-11-15).
- **Where:** a paragraph, `<p class="amap-credit">`, inside the map's `<figure>`, after the
  caption (`streetCredit` in `src/lib/attendee-map.ts`). It is beside the picture, not
  inside the `<svg>`. It is shown whenever the street layer is drawn and never without it.
- **The public area map** (`GET /api/v2/map/areas`, `src/handlers/map-areas.ts`) returns the
  same paragraph as `streets.credit.html`, **in English only**, in the same object as the
  street markup, and the reader's page is told to show it beside the map
  (`docs/integrations/PUBLIC-AREA-MAP.md`).

## How our copy is made (the method)

This section is the statement of method for ODbL section 4.6(b), in case that section
applies (duty L10).

1. **Source:** `https://build.protomaps.com/20261115.pmtiles`, the Protomaps daily build of
   2026-11-15 (139,532,869,447 bytes; listed with its checksums at
   <https://build-metadata.protomaps.dev/builds.json>). The build name is `PROTOMAPS_BUILD`
   in `.github/workflows/street-map-archive-load.yml`, which is the source of truth; a
   refresh changes it there and here in one pull request.
2. **Region:** [`docs/runbooks/street-map-us-region.geojson`](docs/runbooks/street-map-us-region.geojson),
   five boxes in degrees: the 48 contiguous states and DC, Alaska in two boxes, Hawaii,
   Puerto Rico with the US Virgin Islands.
3. **Command,** run by that workflow on a GitHub-hosted runner with `pmtiles` (go-pmtiles)
   v1.31.2:

   ```bash
   pmtiles extract https://build.protomaps.com/20261115.pmtiles us-20261115.pmtiles --region=docs/runbooks/street-map-us-region.geojson --maxzoom=14
   ```

4. **What the command changes:** it keeps the tiles that touch the region, down to zoom 14
   and no deeper (owner, 2026-11-16: the Worker reads zoom 14 at most), and every parent
   tile of a kept tile, and writes new directories for them. Tiles are copied as they are.
   Nothing is added, corrected or joined to other data (runbook, "What the docs say",
   read from the tool's source at `v1.31.2`).
5. **Where it goes:** the object `us-20261115.pmtiles` in the private R2 bucket
   `ose-map-tiles` (OSE ADR-035). Only the Worker reads it.
6. **The same data, from the source:** OpenStreetMap's own files are at
   <https://planet.openstreetmap.org/>; Protomaps' builds are listed at
   <https://maps.protomaps.com/builds/> and kept for about a week.

## Duties, one by one

MET means the code on `main` does what the section asks. It does not mean it was seen on a
page: no page with streets exists yet.

| Id  | What is asked                                                                                                 | Where it is written                                                                                                                                                                                                                           | Verdict                  | Why                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Credit OpenStreetMap wherever a picture made from its data is shown to the public                             | ODbL 1.0 s. 4.3 <https://opendatacommons.org/licenses/odbl/1-0/>; OSMF Attribution Guidelines, "Attribution text" <https://osmfoundation.org/wiki/Licence/Attribution_Guidelines>; <https://www.openstreetmap.org/copyright>, "How to credit" | MET                      | The credit names OpenStreetMap and is drawn with the street layer and never without it. The guidelines accept the older form "© OpenStreetMap contributors".                                                                                                                                                                                                                                                         |
| L2  | Make clear the data is under the ODbL                                                                         | ODbL s. 4.3; Attribution Guidelines, "Attribution text"; openstreetmap.org/copyright, "How to credit"                                                                                                                                         | MET                      | Both pages say a link from the word OpenStreetMap to openstreetmap.org/copyright does this. Ours links there.                                                                                                                                                                                                                                                                                                        |
| L3  | Put the credit where a viewer sees it without doing anything                                                  | Attribution Guidelines, "Requirements" (points 1 and 2), "Interactive maps", "Static images"                                                                                                                                                  | MET                      | A static image is credited as an interactive map is; a corner of the map is usual and "adjacent to the map" is allowed. Ours is a paragraph in the map's figure, always shown. **No text read asks for the credit inside the picture.**                                                                                                                                                                              |
| L4  | The credit is legible and understandable                                                                      | Attribution Guidelines, "Requirements" (point 3), "Attribution text" (font, size, colour, contrast; WCAG recommended)                                                                                                                         | NOT CLEAR                | No page with streets has been rendered, and no accessibility check has run with the credit on the page (review finding R24). No text read sets a rule on the credit's language; "understandable" is the only standard. Our pages translate it. The area map's credit is English only, whatever the reader's page is written in.                                                                                      |
| L5  | The credit reaches people who see the picture somewhere else                                                  | ODbL s. 4.3 (a notice fit to reach anyone who views or is exposed to the work); Attribution Guidelines, "Books, magazines, and printed maps"                                                                                                  | NOT CLEAR                | The area map hands the credit over with the streets, in one object, and tells the reader's page to show it. Whether the OurWKRP showcase shows it has not been checked from this repo. A copied `<svg>`, or a screenshot of the picture alone, carries no credit. A printed page prints the words and not the address; the guideline for printed maps asks for the address.                                          |
| L6  | Other credits must not suggest the data is not OpenStreetMap's                                                | Attribution Guidelines, "Requirements" (point 4); Protomaps `README.md` <https://github.com/protomaps/basemaps>                                                                                                                               | MET                      | Protomaps asks for a credit and does not require one; the owner chose to give it (2026-11-10). It follows the OpenStreetMap credit and says only that Protomaps prepared the data.                                                                                                                                                                                                                                   |
| L7  | Credit the other sources that ask for it                                                                      | Protomaps `LICENSE_DATA.md` <https://github.com/protomaps/basemaps/blob/main/LICENSE_DATA.md>; <https://docs.protomaps.com/basemaps/layers>                                                                                                   | MET, on one condition    | Natural Earth asks for none. Land cover (CC BY 4.0) is never drawn or served, so nothing of it is shared. **Condition:** a change that draws another layer, land cover above all, needs that layer's credit first. Wikidata and QRank: no licence stated on Protomaps' pages, not read further.                                                                                                                      |
| L8  | Keep the data under the ODbL; add no terms and no technical lock on top                                       | ODbL s. 4.4(a), 4.7, 4.8                                                                                                                                                                                                                      | MET                      | Nothing in this repo sets terms on the street layer, and the picture is plain SVG in the page.                                                                                                                                                                                                                                                                                                                       |
| L9  | Ship the licence with the database when the database itself is given to the public                            | ODbL s. 4.2, and the definition of "Convey" in s. 1                                                                                                                                                                                           | MET (not triggered)      | Our copy is not given to anyone. The bucket has no public address, and the load workflow reads both privacy settings and stops if either is on. Showing a picture over the network is not giving out the database. **Condition:** the bucket stays private.                                                                                                                                                          |
| L10 | When a picture made from a derived database is shown publicly, offer that database or the method of making it | ODbL s. 4.4(c), 4.6; OSMF Produced Work guideline (endorsed 2014-06-06) <https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline>; Trivial Transformations guideline (a proposal, not endorsed)                 | NOT CLEAR                | It turns on what our copy is. Protomaps gives its tileset out as a "Produced Work", which would leave only the credit. The OSMF test is whether the thing is meant for getting the original data back out. If our copy is a derived database, section 4.6 asks us to offer recipients the method: it is written above, in a public repository, **and no page points to it.**                                         |
| L11 | Share-alike must not be stretched to our own data, and ours must not be mixed into theirs                     | ODbL s. 4.5(a) and (b); OSMF Collective Database guideline (endorsed 2016-06-17) <https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline>                                                        | MET                      | The hexagons, counts and event places are drawn over the streets in one picture. Nothing of ours refers to an OpenStreetMap element, and nothing of ours is written into the archive.                                                                                                                                                                                                                                |
| L12 | Protomaps' own terms for its builds                                                                           | <https://docs.protomaps.com/basemaps/downloads>; <https://protomaps.com/legal>                                                                                                                                                                | MET, one point NOT CLEAR | Protomaps asks that builds are copied to one's own storage and not linked to from a live product: we cut once and serve from our bucket. Commercial use is allowed as far as the data's licence allows, and the ODbL allows it (s. 3.1). NOT CLEAR: the site terms forbid automated mass access to "the Site" and do not say whether the build host is part of it; the cut is the method Protomaps' own guide shows. |
| L13 | The two tools' licences                                                                                       | go-pmtiles `LICENSE` at `v1.31.2`; rclone `COPYING` at `v1.76.0` (addresses below)                                                                                                                                                            | MET                      | Both set conditions on passing the software on. We download each for one run, check its SHA-256, and pass it to nobody. Neither licence says anything about the files a run produces.                                                                                                                                                                                                                                |

For the record, not a duty: a breach ends the ODbL licence at once and without notice
(s. 9.1); it comes back if the breach stops, and for good once 60 days pass without a
notice, or when a first notice is cured within 30 days (s. 9.4).

## What must change in code before the first public street

Nothing here is done by this file. Each line is for a later pull request, and says whether a
text asks for it or the owner chooses it.

1. **A way from the page to the method** (L10). A link from the credit, or from a short
   "about this map" page, to the method above. Asked for by ODbL s. 4.6 only if our copy is
   a derived database (question 1). It costs one link, so the cautious course is to add it.
2. **A rendered check of the credit** (L4): the page with streets at 320 px in both themes,
   through axe, right to left included. This is already owed under review finding R24.
3. **The area map's credit in the reader's language** (L4): a `lang` parameter on
   `GET /api/v2/map/areas`, in place of the fixed `streetCredit('en')` at
   `src/handlers/map-areas.ts:192`. Owner's choice: no text read asks for a translation.
4. **The credit carried inside the picture** (L5): a small line of text in the street layer's
   `<g>`, so a copied or screenshotted map still says where its data is from. The review
   proposed this as the way to end R25. Owner's choice: no text read asks for it, and
   section 4.3 asks only that the notice is fit to reach whoever sees the work.
5. **A check at the reader** (L5): a test in ourWKRP that the showcase page shows
   `streets.credit.html` whenever it draws `streets.svg`. Another repository.
6. **The address in print** (L5): a print rule that writes the OpenStreetMap address after
   the link. Owner's choice (question 4).
7. **A test that pins the drawn layers** (L7): `WANTED` stays `water`, `roads`, `places`
   until a new layer's credit is in the credit line.
8. **This file in the drift check:** `tests/unit/ci/street-map-archive-load.test.js`
   compares the build, the key and the commands across the workflow, `wrangler.toml` and
   the runbook. This file repeats the build, the key and the cut command, and nothing
   compares it yet.

## Questions for the owner

1. **Is our United States copy a derived database, or part of a Produced Work?** Protomaps
   labels its tileset a Produced Work; the OSMF's test points the other way for a file that
   holds the data in a form it can be read back from. If it is a derived database, the
   method must be offered to the people who see the map (code item 1). Do you want that
   link added without settling the question, or a legal read first?
2. **Staging is public.** Does the list above have to be done before the load to staging,
   or do you accept staging showing streets with the credit as it is now, and the list done
   before production binds?
3. **Do you want the credit inside the picture** (code item 4)? The texts do not ask for
   it. It is the only form that survives a copy of the `<svg>` alone.
4. **Does a visitor printing a page count as our printed map?** If yes, the address must
   print (code item 6).
5. **Who checks the OurWKRP showcase?** It is the first reader of the area map and the
   credit is its to show (code item 5).
6. **Places found by Google's lookup, shown as dots over OpenStreetMap streets.** The dots
   on the zoomed area sit where `lib/event-place.ts` placed an event after a Google
   Geocoding lookup. Google's terms on showing its results over a map that is not Google's
   were **not read for this file**. They should be read before the dots show over streets.

## The tools

| Tool       | Version | Used for                            | Licence      | Copyright line                        | Read at                                                                  |
| ---------- | ------- | ----------------------------------- | ------------ | ------------------------------------- | ------------------------------------------------------------------------ |
| go-pmtiles | 1.31.2  | `pmtiles extract`, on the CI runner | BSD-3-Clause | Copyright 2021 Protomaps LLC          | <https://raw.githubusercontent.com/protomaps/go-pmtiles/v1.31.2/LICENSE> |
| rclone     | 1.76.0  | the upload to R2, on the CI runner  | MIT          | Copyright (C) 2012 by Nick Craig-Wood | <https://raw.githubusercontent.com/rclone/rclone/v1.76.0/COPYING>        |

Neither file names its licence; each is the standard text of the licence named here. Neither
tool is in the Worker, in this repository or in anything we hand to anyone.

The Worker's own reader and decoder (`src/lib/pmtiles.ts`, `src/lib/mvt.ts`) were written in
this repository against the published formats (the PMTiles v3 specification, which
Protomaps places in the public domain, and the Mapbox Vector Tile 2.1 specification). They
import no library of either project.

## What was read, and what was not

Read on 2026-11-15, each at the address given:

- Open Database License 1.0: <https://opendatacommons.org/licenses/odbl/1-0/> (sections 1,
  2.2, 2.4, 3.1, 3.2, 4.2 to 4.8, 6.2, 9.1, 9.4).
- OpenStreetMap, Copyright and License: <https://www.openstreetmap.org/copyright>.
- OpenStreetMap Foundation, Attribution Guidelines (adopted by its board 2021-06-25; the
  page was last edited 2026-09-10). It calls itself a safe harbour and says the licence
  text wins where the two differ: <https://osmfoundation.org/wiki/Licence/Attribution_Guidelines>.
- OpenStreetMap Foundation, Community Guidelines: Produced Work, Regional Cuts,
  Substantial and Horizontal Map Layers (each endorsed 2014-06-06), Collective Database
  (endorsed 2016-06-17), Trivial Transformations (marked a proposal; never endorsed):
  <https://osmfoundation.org/wiki/Licence/Community_Guidelines>.
- Protomaps: <https://docs.protomaps.com/basemaps/downloads>,
  <https://docs.protomaps.com/basemaps/build>, <https://docs.protomaps.com/basemaps/layers>,
  <https://docs.protomaps.com/pmtiles/cli>, <https://protomaps.com/legal>, and `README.md`,
  `LICENSE.md` and `LICENSE_DATA.md` of <https://github.com/protomaps/basemaps> on its
  `main` branch.
- The two tools' licence files, at the tagged versions above.

Not read: Google's terms (question 6); the licences of Wikidata, QRank, Daylight and
Overture at their own sources; the tile schema's licence (Protomaps says it is adapted from
Tilezen and links to that project's schema licence); any court's or regulator's reading of
the ODbL.
