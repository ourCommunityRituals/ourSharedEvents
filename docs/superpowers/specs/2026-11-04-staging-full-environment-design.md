# Two staging sites: empty and full (design)

Date: 2026-11-04. Owner: Matthew Zdano (PO). Status: draft for owner approval.

## Pivot 2026-11-05 (owner; supersedes the nightly search below)

- **No nightly search, ever.** The search ran once, on 2026-11-05. Its rows are committed
  (`stock/seed/finds.json`, `businesses.json`), and `scripts/stock/make-seed.mjs` turned them
  into the fixed seed `stock/seed/seed.json` (each address geocoded once with the US Census
  geocoder, cached in `stock/seed/geocode-cache.json`).
- **Loaded by hand.** `stock-data-full.yml` runs only on the owner's manual dispatch:
  access-gate → deploy → seed → build → check-swap. No schedule, no Claude action, no
  `ANTHROPIC_API_KEY`, no spend cap, no `STOCK_FULL_ENABLED` switch.
- **Places.** Populated: 60620 Auburn Gresham, 60406 Blue Island, 60805 Evergreen Park,
  60453 Oak Lawn. 60655 Mount Greenwood is deliberately empty, so the under-10 experience can be
  shown by zip. Beverly is dropped.
- **Dates are re-based on every load.** Each event keeps its offset in days from 2026-11-05 and
  its Chicago local start time (and duration when known). A load places it at load day +
  offset, at that wall-clock time in America/Chicago (DST-safe), so each place's count in the
  90-day window never changes.
- **Totals are tied to the tests.** The expected count per place comes from the committed seed
  (`expectedByNode`), never a literal; `stock/targets.json` is gone. A test on the committed
  seed asserts every populated place reaches the map gate of 10 and Mount Greenwood holds 0.
  The seed holds Auburn Gresham 14, Blue Island 12, Evergreen Park 15, Oak Lawn 17.
- **The empty place's check.** Mount Greenwood passes when no stock event is assigned to it and
  none is listed in a res-7 cell that is its own alone (five of its six cells are border cells
  shared with populated places). Its landing-map check is skipped: the zip view still takes
  about 17 km around the zip, and narrowing it is a separate story.

The sections below are corrected for the pivot; the rulings file
(`docs/superpowers/plans/2026-11-04-staging-full-environment-rulings.md`) lists the decisions.

## Intent

The owner needs to see OSE working every day, against realistic data that moves, in both of
the product's states: a near-empty site (under 10 events: the create doors lead, the example
map shows) and a saturated one (10 or more: the real map leads, many event types, sponsors at
every tier). Today only the empty state exists (`stg.oursharedevents.com`).

The full site is loaded, when the owner dispatches it, from a fixed seed of what was actually
going on in four places when it was searched (once, 2026-11-05), re-based to the load day. Each
load is an end-to-end check: real events go in through the real create API, get art and QR
codes, get sponsors, and must come out the other side working. After a load the owner creates
events and sponsors by hand on the full site to check those flows.

**Both sites are for the owner's testing only.** Neither is shown to anyone else. That matters
because the full site carries real-world data (real venues, real events, real businesses),
and copyright and implied-endorsement risk are only acceptable on a closed test site.

## Goals

1. A second staging site, the **full** site, fully separate from the empty one (own Worker,
   own `DB` and `FORMS_DB`, own buckets).
2. A **"Testing purposes only"** notice on every page of both staging sites.
3. A **load from the fixed seed**, on the owner's dispatch, of the full site only:
   1. The seed holds real events in the next 90 days from the one-time search (2026-11-05),
      **private sector first** (bars, restaurants, churches, other businesses), **then public
      sector** (park districts, libraries, chambers of commerce, villages), only events that fit
      an OSE event type (`lib/event-type-catalog.ts`, the `event_types` table). Each load
      re-bases their dates to the load day.
   2. Create each event through the real admin create API, so creation and QR codes are
      exercised. Attach one of the owner's own photos as art when one fits; otherwise create
      it without art.
   3. Seed the businesses found along each place's commercial strips as sponsors.
      **Anchors** (the venue or institution a node centers on) were identified by the search
      and must be present in every populated node. **Regionals** are the ones the owner names
      in a list file. Everything else is local. Both consent sides are set to accepted.
4. **Every populated place is saturated on its own** (owner, 2026-11-04): looking up any one
   of the four populated places by zip shows at least 10 listed events, so that place's map leads. The point is to
   find what is going on in your area without bleed-over from everywhere else. Patch,
   Facebook and Eventbrite flood people; OSE starts small, and going deeper is the person's
   choice, with minimal friction. A site that is only full when all four are added together
   fails this goal. Mount Greenwood is kept empty on purpose (pivot above).

The five places (nodes): **Blue Island, Auburn Gresham, Evergreen Park, Oak Lawn** (populated)
and **Mount Greenwood** (empty). Beverly was dropped on 2026-11-05.

## Non-goals

- Nothing changes on the empty site except the notice. CI (T1–T4) keeps targeting
  `stg.oursharedevents.com` exactly as today.
- No production change. Production never shows the notice and gets no new config.
- No invented events. A load shows only what the one-time search really found, at re-based
  dates (owner: the breadth of event types is what gives coverage).
- No change to the Worker's runtime: no model SDK or model URL under `src/`. The one-time
  search ran outside CI and outside the Worker; no workflow calls a model.

## Later layers (owner, 2026-11-04; not in this build)

This design is the **first layer**. A future feature widens the window step by step, by a
heuristic, until a place reaches at least 10 events, so the map is exposed even where one
place alone is thin. It is a future plan only: layer 1 builds nothing for it.

## Anti-goals (a failure even if it works)

- The owner opens the full site after a load and finds a populated place empty or half-built.
- Any copied third-party description text or images on the site.
- A seeded real business shown anywhere that is not a closed test site.
- A load touching the empty site's databases, or any production resource.
- The notice showing on production.

## Constraints

- Invariants in `AGENTS.md` all hold on the full site, including the under-5 floor, no
  cookies on public surfaces, place not person, and the display showing no counts.
- Colors only from `packages/tokens`; one `<h1>` per page (the notice is not a heading);
  touch targets ≥ 44 px.
- GitHub-hosted runners only.
- The owner provisions all Cloudflare resources and sets all secrets; agents never do.
- Instagram's terms: photos come only through Instagram's official API on the owner's own
  account (@brokenbatphoto, a Creator account), never by scraping.

## Decided by the owner

- Two sites; "empty" and "full" should be readable from the URL.
- Testing only; a "Testing purposes only" notice on both staging sites.
- ~~Daily teardown and rebuild of the full site, in the morning.~~ Superseded 2026-11-05: a
  fixed seed, loaded on manual dispatch, dates re-based each load.
- Real events only, 90 days ahead, private sector before public; four populated places and
  Mount Greenwood empty (2026-11-05).
- Art is the owner's own Broken Bat Photo work, via Instagram's API.
- The one-time search identified anchors; the owner names the regionals.
- Saturation is per place, never only in total: find what is going on in your area without
  bleed-over.

## The design

### 1. Names and hosts

| Site  | Host                           | Wrangler env   | Worker                     | Databases                                           |
| ----- | ------------------------------ | -------------- | -------------------------- | --------------------------------------------------- |
| Empty | `stg.oursharedevents.com`      | `staging`      | `oursharedevents-stg`      | `ocr-db-staging`, `ocr-forms-db-staging` (existing) |
| Full  | `stg-full.oursharedevents.com` | `staging-full` | `oursharedevents-stg-full` | `ocr-db-staging-full`, `ocr-forms-db-staging-full`  |

_My call:_ keep the existing host as the empty site, because every CI job points at it, and
add a second route `stg-empty.oursharedevents.com` on the same Worker so both names say what
they are. `stg.` keeps working unchanged.

_My call:_ the full Worker runs with `WORKER_ENV = "staging"`, so every staging-gated path
(key fallback, `ADMIN_SCOPE_ALL`, crawl policy) behaves exactly as on the empty site. A new
var `STAGING_VARIANT` (`"empty"` / `"full"`) is the only difference. The full site gets its
own R2 uploads bucket, KV namespace, rate-limit namespace ids and BigQuery dataset
(`oursharedevents_backup_stg_full`, or no BigQuery binding at all), and no scan queue (a
queue allows one consumer, and `ose-scans` is the empty site's).

`scripts/ci/env-parity.mjs` compares staging and production. It must keep comparing the
`staging` env to production and must not fail because `staging-full` exists.

_My call:_ the whole `stg-full` host sits behind a Cloudflare Access policy that only the
owner passes (owner edge setting), plus an Access service token for the load workflow. This is
what makes "testing only" true rather than a label. The job sends the service-token headers
(to pass the host policy) **and** the full site's own `ADMIN_KEY` Bearer (for the Worker's
admin guard); the Worker's admin auth is unchanged. **The workflow's first job requests
`stg-full` with no credentials and stops red unless Access answers instead of the Worker**,
so real-world data is never loaded onto an open host. It fails closed: the only pass is
Access's login redirect (302 or 303 to `https://<team>.cloudflareaccess.com`) on both a page
and the public API. A 403, 401 or 200 proves nothing about Access, so it fails.

_My call:_ the full site's deploy and migrations run in their own workflow, never inside
T1–T4. A failure there never turns `main` red and is not part of the Definition of Done.
The new env and its unscoped automation key get the normal CCR (with the Dr of Security)
on the PR that adds them.

### 2. The "Testing purposes only" notice

A thin band at the top of every HTML page whenever `WORKER_ENV` is not `production`: every
surface, including the display, the poster page and the form pages. Text: **"Testing purposes
only."** On the full site it adds one line: "Events, venues and businesses here are drawn from
public listings for testing; nothing here is an endorsement or an offer." Colors come from
semantic tokens; it is not a heading; it does not count toward the one-`<h1>` rule; it does not
cover content at phone width.

A worker spec fails if any served HTML page lacks it in staging, and fails if production
renders it (born red both ways). The empty site's existing Playwright and Bruno checks must
still pass with the band present.

### 3. Loading the full site from the seed

One GitHub Actions workflow, `stock-data-full.yml`, run only by the owner's manual dispatch
(pivot 2026-11-05: no schedule). Its jobs run in order; a red job stops the next:
access-gate → deploy → seed → build → check-swap.

**The one-time search and the seed (2026-11-05, not in CI).** The search found real events in
the next 90 days per place, private sector first, and businesses on each place's commercial
strips with `anchor: true|false`. Its rows are committed as `stock/seed/finds.json` and
`businesses.json`. `scripts/stock/make-seed.mjs` geocoded each address once (US Census
one-line geocoder, cached), ran the finds through `scripts/stock/validate-finds.mjs` (refusing
rows outside the 90-day window, with no source URL, with an event type not in the catalog from
the migrations, or with an address outside every node polygon; duplicates by venue and start
collapse; titles and summaries capped), placed each business by polygon, and wrote
`stock/seed/seed.json`. A find whose polygon disagrees with its searched zip keeps the
polygon's answer. The script stops without writing if a populated place falls under 10 or the
empty one would hold anything.

**Job: seed (plain code, tested, no secrets, no network).** `run-day.mjs seed` reads
`seed.json` and re-bases every event to the load day (`chicagoDate(now)`): load day + its
offset, at its Chicago local time, DST-safe, with its duration when the seed has one. It writes
the accepted rows (with `lat`, `lng`, `node` and the res-7 `cell`) and the businesses in the
shape the build reads, and `load.json` naming the load day, which the build records as the
manifest's date.

**Job C: build (plain code, tested).** `scripts/stock/build-full.mjs`, against the full site
only, through its public admin API with the automation key:

1. Creates the load's events in brand `root`, published, each placed by its cell. They must be
   in `root` because the landing page and `/events` list `root` only
   (`handlers/pages.ts`, `dp.listEvents('root')`). Every id the job creates (events,
   sponsors, placements, poster deployments, uploads) goes into a **manifest**,
   `stock/manifest-YYYYMMDD.json`, kept in the full site's uploads bucket.
2. Attaches art (section 4) when one fits, through the existing
   `POST /api/v2/admin/events/:id/uploads`; otherwise creates no art.
3. Creates a poster deployment and QR codes for each event.
4. Seeds sponsors from `businesses.json`: anchors, the owner's regionals from
   `stock/regionals.json`, all others local; both acceptance flags set; one placement per event
   at the event's node, so the sponsor strip shows under the title on every event page. The
   API is used wherever a route exists. Where one does not (for example the sponsor's side of
   acceptance, which normally comes from the sponsor's own page), the job seeds that field
   with SQL. What it checks is always read back through the real public pages.

**The seed sets the quantity, and the loader and every check read it (owner, 2026-11-04;
re-based on the seed 2026-11-05).** A check that hard-codes a count would drift out of line
with what was loaded, so the expected count per place is `expectedByNode(seed)`: the number of
seed events in that node, 0 for Mount Greenwood. That is the only source:

- the build loads **exactly the expected count per node**, in priority order (private before
  public, then soonest start); a node with fewer rows is recorded as short and fails;
- every check takes its expected numbers from the seed and that load's manifest, never from a
  literal in a test. The run summary prints the expected count per node so the owner's manual
  checks use the same numbers.

Events the owner creates by hand are not in the manifest. Checks therefore assert that exactly
the expected number of _stock_ events are listed per node. A hand-made event never fails the run.

**Job: check, then swap.** The load's data must pass all of these, read back over the
real public surfaces:

- **per populated node, strictly:** exactly its expected count of the load's manifest events
  are listed in the 90-day window, each with a res-7 cell in that node's own cell list
  (`stock/nodes.json`), read from the public `GET /api/v2/events`. Neighbors never count toward
  a node. A populated expectation must be at least 10 (the map gate); the check refuses one below
  that. Also, the landing page read with the node's zip
  (`/?zip=…`) leads with the map. The map leads on the live count (`landing-area.ts`
  `LIST_MAX`); it does not wait for the nightly latch.
  Finding (2026-11-04): today the zip view takes 8 rings of res-7 cells around the zip center
  (`lib/zip-areas.ts` `NEAR_RING_STEPS = 8`, about 17 km), which covers every node. So the
  zip view bleeds over by construction. Narrowing it is a product change outside this build;
  the strict count above is what this build checks;
- **the empty node (Mount Greenwood):** no manifest event is assigned to it, and none is listed
  in a res-7 cell that is its own alone (not shared with a populated node). Its landing-map
  check is skipped, for the zip-view reason above;
- every populated node has at least one anchor sponsor;
- every QR code resolves (`/q/…` returns the event, `/s/…` redirects);
- every event page renders with its sponsor strip; every art image loads.

_My call:_ the swap is **per node**. A node whose checks pass swaps to this load's data. A
node that fails keeps the previous load's data and this load's rows for it are purged. The run
goes red and names each node that failed and why. The others still refresh. The manifest
records each id's node so the purge can work node by node. The previous and new events overlap
for the few minutes between build and purge.

Before its first API call the build writes the empty manifest to R2 and lists its name in
`stock/manifest-index.json`, then keeps that copy at most 20 seconds behind, so a run cancelled
before the swap is still purged by the next run, which reads only the index. The swap overwrites
that copy with the complete manifest (or, with no artifact, purges every node of the copy), and
refuses, red, a copy holding ids its manifest does not. With no artifact it looks the copy up by
run id, preferring the current attempt and otherwise the highest readable one, because
re-running check-swap alone raises the attempt while the build's registration keeps its own.

_My call:_ the purge is direct SQL from CI (`wrangler d1 execute … --env staging-full
--remote`), deleting by manifest id, including the scans, placements and audit rows those
ids own. No purge route is added to the Worker. The admin delete refuses events that have
scans, and the QR checks themselves record scans, so the API could not do the purge.

_My call:_ only ids in a manifest are ever purged, so events and sponsors the owner creates
by hand survive every load.

A load never names `--env staging` or `--env production`; a test asserts that every
command and URL in the stock scripts targets `staging-full` / `stg-full` only.

### 4. The art pool (Instagram API)

The owner creates a Meta app once, authorizes it on @brokenbatphoto with Instagram's API
(Instagram Login, basic scope), and sets the long-lived token as a repo secret
(`INSTAGRAM_ACCESS_TOKEN`) in their own terminal.

On each load, in the build job, a step lists the account's posts (caption, hashtags, a fresh
media URL). Job C downloads the images it picks and uploads each through the event upload
route above. _My call:_ there is no separate art-pool bucket and no R2 credential in CI.
Instagram's media URLs expire, so they are read fresh every run and never stored.

_My call:_ fit is decided by `stock/art-tags.json`, an owner-editable map from hashtags and
caption words to event type slugs or categories. The pick is fixed per event (a hash of venue
and start), so an event keeps the same photo from load to load. A pool miss is not an error.

The token lasts 60 days. The step warns in the run summary from 10 days before expiry, and the
owner refreshes it. The job never writes secrets.

### 5. Files the owner edits

- `stock/regionals.json`: businesses to seed at the regional level.
- `stock/art-tags.json`: which photos fit which event types.
- `stock/nodes.json`: the five nodes and their cells. Seeded once from the boundaries of
  Blue Island, Auburn Gresham, Evergreen Park, Oak Lawn and Mount Greenwood (Beverly removed
  2026-11-05).
- `stock/seed/seed.json`: the fixed seed. Regenerate it only by re-running
  `scripts/stock/make-seed.mjs` on new search rows; every expected count follows it.

## Owner setup (agents never do these)

1. Create `ocr-db-staging-full`, `ocr-forms-db-staging-full`, R2 `ose-uploads-staging-full`,
   a KV namespace and a Meta app for the Instagram API; paste the ids into the PR.
2. DNS routes for `stg-full` and `stg-empty`; an Access policy over the whole `stg-full` host;
   an Access service token for the job.
3. Worker secrets for `staging-full` (same list as staging, all new values).
4. Repo secrets: `INSTAGRAM_ACCESS_TOKEN`, the full site's automation key, and the Access
   service token pair. (`ANTHROPIC_API_KEY` is no longer needed: there is no search in CI.)

## Left to the builder

- How the notice is injected (one shared HTML seam is preferred over per-template edits).
- How `stg-full` gets its migrations and deploys (a CI job mirroring T1, gated the same way).
- Story breakdown in Linear (team OSE), one CI/CD testing ticket per story.

## Test evidence expected

Each new gate is watched failing on an injected fault: the notice (missing in staging,
present in production), the validator (each refusal rule), the swap (a failed check keeps
yesterday's brand), the target guard (a stray `--env staging` fails), the re-basing (offset,
local time and DST), the committed seed's totals, the expected-0 node, and the workflow having
no schedule or search.
