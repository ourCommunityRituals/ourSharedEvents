# Two staging sites: empty and full (design)

Date: 2026-11-04. Owner: Matthew Zdano (PO). Status: draft for owner approval.

## Intent

The owner needs to see OSE working every day, against realistic data that moves, in both of
the product's states: a near-empty site (under 10 events: the create doors lead, the example
map shows) and a saturated one (10 or more: the real map leads, many event types, sponsors at
every tier). Today only the empty state exists (`stg.oursharedevents.com`).

The full site is rebuilt every morning from what is actually going on in six places over the
next 90 days, so it doubles as a daily end-to-end check: real events go in through the real
create API, get art and QR codes, get sponsors, and must come out the other side working.
After the rebuild the owner creates events and sponsors by hand on the full site to check
those flows.

**Both sites are for the owner's testing only.** Neither is shown to anyone else. That matters
because the full site carries real-world data (real venues, real events, real businesses),
and copyright and implied-endorsement risk are only acceptable on a closed test site.

## Goals

1. A second staging site, the **full** site, fully separate from the empty one (own Worker,
   own `DB` and `FORMS_DB`, own buckets).
2. A **"Testing purposes only"** notice on every page of both staging sites.
3. A **daily morning rebuild** of the full site only:
   1. Search for real events in the next 90 days in the six places, **private sector first**
      (bars, restaurants, churches, other businesses), **then public sector** (park
      districts, libraries, chambers of commerce, villages). Keep only events that fit an OSE
      event type (`lib/event-type-catalog.ts`, the `event_types` table).
   2. Create each event through the real admin create API, so creation and QR codes are
      exercised. Attach one of the owner's own photos as art when one fits; otherwise create
      it without art.
   3. Find the businesses along each place's commercial strips and seed them as sponsors.
      **Anchors** (the venue or institution a node centers on) are identified by the search
      and must be present in every node. **Regionals** are the ones the owner names in a list
      file. Everything else is local. Both consent sides are set to accepted.
4. **Every place is saturated on its own** (owner, 2026-11-04): looking up any one of the six
   places by zip shows at least 10 listed events, so that place's map leads. The point is to
   find what is going on in your area without bleed-over from everywhere else. Patch,
   Facebook and Eventbrite flood people; OSE starts small, and going deeper is the person's
   choice, with minimal friction. A site that is only full when all six are added together
   fails this goal.

The six places (nodes): **Blue Island, Beverly, Auburn Gresham, Evergreen Park, Oak Lawn,
Mount Greenwood.**

## Non-goals

- Nothing changes on the empty site except the notice. CI (T1–T4) keeps targeting
  `stg.oursharedevents.com` exactly as today.
- No production change. Production never shows the notice and gets no new config.
- No invented events. The rebuild shows only what the search really found (owner: the
  breadth of event types is what gives coverage).
- No change to the Worker's runtime: no model SDK or model URL under `src/`. The search runs
  in CI, outside the Worker.

## Later layers (owner, 2026-11-04; not in this build)

This design is the **first layer**. A future feature widens the window step by step, by a
heuristic, until a place reaches at least 10 events, so the map is exposed even where one
place alone is thin. It is a future plan only: layer 1 builds nothing for it.

## Anti-goals (a failure even if it works)

- The owner opens the full site some morning and finds it empty or half-built.
- Any copied third-party description text or images on the site.
- A seeded real business shown anywhere that is not a closed test site.
- The rebuild touching the empty site's databases, or any production resource.
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
- Daily teardown and rebuild of the full site, in the morning.
- Real events only, 90 days ahead, the six places above, private sector before public.
- Art is the owner's own Broken Bat Photo work, via Instagram's API.
- The search identifies anchors; the owner names the regionals.
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
owner passes (owner edge setting), plus an Access service token for the morning job. This is
what makes "testing only" true rather than a label. The job sends the service-token headers
(to pass the host policy) **and** the full site's own `ADMIN_KEY` Bearer (for the Worker's
admin guard); the Worker's admin auth is unchanged. **The job's first step requests
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

### 3. The morning rebuild

One GitHub Actions workflow, `stock-data-full.yml`, scheduled each morning (_my call:_ 11:00
UTC, which is 5–6 AM in Chicago), plus manual dispatch. It runs four jobs in order; a red job
stops the next.

**Job A: search (Claude, in CI).** A Claude Code step with web search and a fixed prompt kept
in the repo (`stock/search-prompt.md`). It searches private sector first, then public, per
node, for events in the next 90 days, and writes `finds.json`: one row per event with venue
name, venue address, sector (`private` / `public`), node, event type slug (from the catalog),
start and end date and time, title, a one-line summary in its own words, and a source URL.
It also writes `businesses.json`: businesses on each node's commercial strips, each with
name, address, node and `anchor: true|false`. Needs an `ANTHROPIC_API_KEY` repo secret (owner).
_My call:_ `anthropics/claude-code-action` on Sonnet, with only its built-in web search and
web fetch tools and write access to the two output files, a turn cap and a 30-minute
timeout. _My call, pending the owner:_ a per-run spend cap set by a repo variable
(`STOCK_SEARCH_MAX_USD`, default 5), which the owner can change. The search works one node
at a time and stops a node once it has `perNode + 3` good finds (see `stock/targets.json`
below), so the cost stays roughly flat. The repo's `.claude/hooks/policy-gate.mjs` is a workstation hook and does not run
in CI.

**Job B: validate (plain code, tested).** `scripts/stock/validate-finds.mjs` refuses rows that
are outside the 90-day window, have no source URL, use an event type that is not in the
catalog, or have an address that does not land in one of the six nodes. _My call:_ addresses
go through the full site's own `POST /api/v2/admin/geocode`, so the server derives the res-7
cell exactly as it does for a hand-made event (one source of truth). The node test compares
that cell to the per-node cell list in `stock/nodes.json`. Duplicates (same venue, same
start) collapse to one row. Titles and summaries are capped in length; no description text
from the source is kept.

**Job C: build (plain code, tested).** `scripts/stock/build-full.mjs`, against the full site
only, through its public admin API with the automation key:

1. Creates today's events in brand `root`, published, each placed by its cell. They must be
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

**One number sets the quantity, and the loader and every check read it (owner,
2026-11-04).** Real data changes every day, so a check that hard-codes a count would drift out
of line with what was loaded. `stock/targets.json` holds `{ "perNode": 12 }` (_my call_: 12,
two above the map gate of 10). That number is the only source:

- the build loads **exactly `perNode` events per node**: the first `perNode` accepted finds in
  priority order (private before public, then soonest start). Extra finds are dropped, and a
  node with fewer fails;
- the search stops a node at `perNode + 3` good finds, a buffer for rows the validator refuses;
- every check takes its expected numbers from `targets.json` and that day's manifest, never
  from a literal in a test. The run summary prints the expected count per node so the owner's
  manual checks use the same numbers.

Events the owner creates by hand are not in the manifest. Checks therefore assert that exactly
`perNode` _stock_ events are listed per node, and that the node's total is at least `perNode`.
A hand-made event never fails the run.

**Job D: check, then swap.** The new day's data must pass all of these, read back over the
real public surfaces:

- **per node, strictly:** exactly `perNode` of that day's manifest events are listed in the
  90-day window, each with a res-7 cell in that node's own cell list (`stock/nodes.json`),
  read from the public `GET /api/v2/events`. Neighbors never count toward a node. `perNode`
  must be at least 10 (the map gate), and the check refuses a `targets.json` below that. Also, the landing page read with the node's zip
  (`/?zip=…`) leads with the map. The map leads on the live count (`landing-area.ts`
  `LIST_MAX`); it does not wait for the nightly latch.
  Finding (2026-11-04): today the zip view takes 8 rings of res-7 cells around the zip center
  (`lib/zip-areas.ts` `NEAR_RING_STEPS = 8`, about 17 km), which covers all six nodes. So the
  zip view bleeds over by construction. Narrowing it is a product change outside this build;
  the strict count above is what this build checks;
- every node has at least one anchor sponsor;
- every QR code resolves (`/q/…` returns the event, `/s/…` redirects);
- every event page renders with its sponsor strip; every art image loads.

_My call:_ the swap is **per node**. A node whose checks pass swaps to today's data. A node
that fails (a thin week in one place) keeps yesterday's data and today's rows for it are
purged. The run goes red and names each node that failed and why. The other five still
refresh. The manifest records each id's node so the purge can work node by node. The owner
never finds a place empty. Yesterday's and today's events overlap for the few
minutes between build and purge.

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
by hand survive every rebuild.

The rebuild never names `--env staging` or `--env production`; a test asserts that every
command and URL in the stock scripts targets `staging-full` / `stg-full` only.

### 4. The art pool (Instagram API)

The owner creates a Meta app once, authorizes it on @brokenbatphoto with Instagram's API
(Instagram Login, basic scope), and sets the long-lived token as a repo secret
(`INSTAGRAM_ACCESS_TOKEN`) in their own terminal.

Each morning, before Job C, a step lists the account's posts (caption, hashtags, a fresh
media URL). Job C downloads the images it picks and uploads each through the event upload
route above. _My call:_ there is no separate art-pool bucket and no R2 credential in CI.
Instagram's media URLs expire, so they are read fresh every run and never stored.

_My call:_ fit is decided by `stock/art-tags.json`, an owner-editable map from hashtags and
caption words to event type slugs or categories. The pick is fixed per event (a hash of venue
and start), so an event keeps the same photo day to day. A pool miss is not an error.

The token lasts 60 days. The step warns in the run summary from 10 days before expiry, and the
owner refreshes it. The job never writes secrets.

### 5. Files the owner edits

- `stock/regionals.json`: businesses to seed at the regional level.
- `stock/art-tags.json`: which photos fit which event types.
- `stock/nodes.json`: the six nodes and their cells. Seeded once from the boundaries of
  Blue Island, Beverly, Auburn Gresham, Evergreen Park, Oak Lawn and Mount Greenwood.

## Owner setup (agents never do these)

1. Create `ocr-db-staging-full`, `ocr-forms-db-staging-full`, R2 `ose-uploads-staging-full`,
   a KV namespace and a Meta app for the Instagram API; paste the ids into the PR.
2. DNS routes for `stg-full` and `stg-empty`; an Access policy over the whole `stg-full` host;
   an Access service token for the job.
3. Worker secrets for `staging-full` (same list as staging, all new values).
4. Repo secrets: `ANTHROPIC_API_KEY`, `INSTAGRAM_ACCESS_TOKEN`, the full site's automation
   key, and the Access service token pair.

## Left to the builder

- How the notice is injected (one shared HTML seam is preferred over per-template edits).
- The exact search prompt, within the rules above.
- How `stg-full` gets its migrations and deploys (a CI job mirroring T1, gated the same way).
- Story breakdown in Linear (team OSE), one CI/CD testing ticket per story.

## Test evidence expected

Each new gate is watched failing on an injected fault: the notice (missing in staging,
present in production), the validator (each refusal rule), the swap (a failed check keeps
yesterday's brand), and the target guard (a stray `--env staging` fails).
