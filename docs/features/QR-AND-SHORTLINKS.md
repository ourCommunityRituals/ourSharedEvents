# QR codes and short links: how tracking and routing work

> **Status:** canonical feature reference, verified against `origin/main` at
> `edb9406` (2026-09-30). The implemented code is the system of record (see the
> ADR alignment rule in `CLAUDE.md`). Where a document and the code disagree,
> this page says so and the code wins.
>
> **Path convention:** code and worker-test paths are relative to
> `workers/oursharedevents/` unless they start with `docs/`, `tests/e2e/` or
> `.github/`.
>
> **Supersedes:** [QR-ROUTING.md](QR-ROUTING.md) as the overview. That page now
> covers only the narrower `/forms/` links.

---

## 1. Why this matters

QR codes and short links are how the platform learns that its marketing worked,
without learning who anybody is. Across the triangle:

- The **organizer** and the **sponsor** get counts: how many scans, how many
  taps, how many posters, in how many places. They are privacy-first, and
  floored for anyone outside the organizer.
- The **attendee** gets an easy way in. They point a camera or tap a link, land
  on the event page, and nothing asks who they are.

The whole design comes down to one line, which is printed on every anonymous
surface (`src/lib/never-who.ts`, `NEVER_WHO_LINE`): **"Never who, only how
many."**

---

## 2. The two instruments

There are two primitives. They are composed, never merged
(`src/lib/poster-codes.ts` header; migration `0073_shortlinks_add_target_url.sql`:
"/q/ = tracking, /s/ = routing").

|                           | **QR scan = TRACKING** (`/q/`)                                                                                                                                                                                                                                                                                                           | **Short link = ROUTING** (`/s/`)                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| URL shape                 | `/q/qrt_<16 hex>` (`qrt_` prefix, at most 128 chars), optional `?type=register\|checkin\|survey\|email-signup`                                                                                                                                                                                                                           | `/s/<6 chars base62>`                                                                                                                    |
| What it identifies        | One **placement**: a `poster_deployments` row, which is one poster hung at one place                                                                                                                                                                                                                                                     | One **destination** per (event, kind): the event page, anonymous check-in, or an organizer-chosen https link                             |
| Handler                   | `src/handlers/qr-scan.ts` (`handleQrScan`), routed at `src/router.ts` (`pathname.startsWith('/q/')`)                                                                                                                                                                                                                                     | `src/handlers/shortlink-resolve.ts` + `src/lib/shortlinks.ts`, routed at `src/router.ts` (`pathname.startsWith('/s/')`)                  |
| What the visitor sees     | 302 to `/events/<id>?type=<form>&deployment=<pd_id>` (`qrScanTarget`). Bad, unknown or inactive token: 302 to `/`                                                                                                                                                                                                                        | 302 to the stored https `target_url`, or the internal target (`/events/<id>`, or `/forms/<id>?type=checkin` for check-in). Bad code: 404 |
| What is stored            | Two rows per scan, split: `scan_placement_events` (event, deployment, hour bucket) and `scan_node_returns` (event, `anonymous_id`, 16-hex UA hash, hour bucket; `country_code` is always NULL since OSE-1460). Both rows also keep an internal `created_at` to the second, which never leaves the Worker (§4)                            | `shortlinks.clicks + 1` and `last_clicked_at`. No per-click row exists                                                                   |
| Cookie                    | **Yes.** Sets `ose_anon` (HttpOnly, Secure, SameSite=Lax, 1 year) on a visitor's first scan (`src/lib/anonymous-id.ts`)                                                                                                                                                                                                                  | **No.** No cookie read or set                                                                                                            |
| Never stored              | IP, country, Referer, coordinates or H3 cell on the scan row, anything from a named (ourWKRP) session. Exact time is kept only as the internal `created_at`; no report or export sees it                                                                                                                                                 | IP, `anon_id`, cookie, Referer, user agent, any location                                                                                 |
| Dedup                     | Best effort, one scan per person per poster per hour (OSE-1459): KV key `scan:dedup:{anonId}:{deploymentId}:{hour bucket}`, 3600 s TTL. A failed write releases the marker (on the hot path, or on the queue consumer's last delivery before dead-lettering), so a retry in the same hour is recorded. No KV means every scan is written | None. Every resolve increments                                                                                                           |
| Database                  | `DB` (main). Buffered through `SCAN_QUEUE` when bound (`src/lib/scan-buffer.ts`); direct D1 batch otherwise                                                                                                                                                                                                                              | `DB` (main), `shortlinks` table (migrations 0030, 0073, 0080)                                                                            |
| Where the code is printed | Per placement, from the admin poster-placement card (Download / Print QR, `src/templates/admin.html` `downloadPosterQr` / `printPosterQr`)                                                                                                                                                                                               | On the public `/poster` page: every code there is an `/s/` link (`src/templates/poster.html` `loadPosterQR`)                             |

Notes, each verified in code:

- **The `/poster` page prints only `/s/` codes.** `loadPosterQR` renders
  `bundle.slots`, and every slot is `origin + '/s/' + code`. The test
  `tests/poster-multi-code.spec.ts` asserts "all /s/ (never /q/)". A `/q/` code
  exists only for a registered placement, and it is printed from the admin card.
  `GET /api/v2/events/:id/poster-bundle?deployment=<id>` also emits `/q/` form
  links in its `links`/`qr` fields (`src/handlers/poster-bundle.ts` `scanUrl`),
  but `poster.html` does not render them.
- **The queue is dark in production.** `SCAN_QUEUE` is bound for staging only.
  The production producer and consumer blocks are commented out in
  `wrangler.toml`. Either way, the direct write is the floor, so counts are never
  lost (`src/lib/scan-buffer.ts`).
- **Why the scan write is split.** Migration `0062_split_scan_path.sql`
  (OSE-798) retired the combined `scans` table. The reason: no durable row may
  carry both a placement id (WHERE) and a session-derived value (WHO). Rollups
  read the WHO side (`scan_node_returns`) at event/hour level only. Per-poster
  reads use the WHERE side (`scan_placement_events`) only.
- **A `/q/` scan never attaches a named session.** An ourWKRP session cookie,
  profile cookies or a Bearer header on the request are ignored
  (`tests/forbidden-join-blindness.spec.ts`, OSE-1049).

---

## 3. Resolution rule: where a count "is"

**Founder decision, 2026-09-04**
([reconciliation §9](../discovery/OSE_REFERENCE_posterPrimitiveReconciliation_2026-09-04.md#9-surface-determines-resolution--proposed-invariant)):
geographic resolution is "a property of **the deployment**, never of the
person." The H3 cell on a record says "where the marketing was put", and it is
read from OCR's own registered placements.

| Surface                             | Resolution                                        | Where the cell comes from                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Physical**: a QR on a wall        | **res9 (Node) + res7 (Corridor)**                 | The **registered placement**. The organizer types an address in admin. The browser geocodes it once, through `POST /api/v2/admin/geocode` (admin-only). The server tags `h3_res9`/`h3_res7` (`src/handlers/poster-deployments.ts`, `src/lib/h3-tagging.ts` `maybeTag`, migrations 0047, 0079). |
| **Digital**: a short link in a feed | **res7 only**, the area it was **published into** | **Not built.** Today a click carries **no location at all** (see §7, "digital deployment").                                                                                                                                                                                                    |

**This is not measurement precision.** Per §9, res9 versus res7 is "the
granularity of the deployment itself". A poster hangs at one registered wall. A
digital link "hangs nowhere. There is no node to name." So a res9 cell on a
digital deployment would be fabricated, not merely imprecise. The proposed rule
(§9.1) is `surface = 'digital'` ⇒ `h3_res9 IS NULL`. §12.4 scopes it to
**fixed** placements: a mobile item must not inherit a cell.

A scan row never carries a cell of its own. Its place is the placement it
references (`scan_placement_events.poster_deployment_id` → `poster_deployments.h3_res9`).
This is asserted by test 8c in `tests/poster-deployments-h3-tagging.spec.ts`.

### No request geolocation, ever

§9.2 rejects IP geolocation and `request.cf` coordinates: "Nothing in this
design consults a request's apparent location." Enforcement lives in
`tests/poster-deployments-h3-tagging.spec.ts`, which runs in the T0 worker suite:

- **8b** fails if any file on the scan/click path (`qr-scan.ts`, `scan-buffer.ts`,
  `shortlink-resolve.ts`, `shortlinks.ts`, `uec-resolve.ts`, `forms.ts`,
  `form-pages.ts`, `pages.ts`) reads `navigator.geolocation`, `request.cf`
  latitude, longitude, city, postal code, metro code or region, or any finer
  `CF-IP*` header. A second 8b test fails if **any** served `src/` file calls the
  browser geolocation API, and that includes admin.
- **8c / 8d / 8e** fail if a scan table gains a coordinate or cell column, if
  `shortlinks` gains anything finer than res7, or if any table stores a cell
  finer than res9.

> **Resolved 2026-10-01 (OSE-1460): no visitor country.** Gate 8b used to allow
> `CF-IPCountry`, and `qr-scan.ts` stored it as `scan_node_returns.country_code`,
> which the rollup turned into `scan_aggregates.top_country`. The PO decided the
> product does not hold a request's apparent location at any grain. The scan path
> no longer reads the header, the rollup writes `top_country = NULL`, migration
> 0089 clears the recorded values, and gate 8b now forbids every `CF-IP*` header
> and `request.cf` geo field, country included.

### Which cells the SharedReport map uses

ADR-011 (Accepted): a scan's place is the poster it was scanned at. Every scan
comes in through a poster (`GET /q/:qr_token`), so the nightly job counts scans
at each **poster's own res9 cell** in `scan_cell_aggregates` (OSE-1459,
migration 0087). A poster at the venue sits in the venue's cell; one across
town sits in its own. The `corridor_map` reads that table, so each lit cell is a
poster cell and its value is **scans** there. Scans are deduplicated per
person per poster per hour, so an hourly poster count is a count of people
(best effort: without KV, and for a visitor with no cookie, repeats get
through). The K-floor is applied to each **poster-hour** before poster-hours are
added into their cell, because dedup is per poster: one person scanning five
posters in one cell is five scans but one person. A cell is built only from
poster-hours that clear the floor, and then from hours that clear it. A
cell-hour whose poster-hours are all under the floor is stored as 0, so the
report can tell "activity, withheld" from "no scans". A cell under the K-floor is
dropped, never drawn: its res9 is a poster's location, so it is not published
at all (the same rule as `poster_attribution`). If every cell is under the
floor, the report shows the map as hidden rather than the venue preview.

The table itself stores only scan counts. Doctrine rule 6 (OSE-798) keeps any
session-derived value off a row that carries a place, and the two halves of a
scan share no key, so no distinct count is possible there. The per-person
meaning comes from the dedup at ingestion. A cell's total is a sum of hourly
counts, so the same person scanning in two different hours counts twice. `scan_aggregates` stays event-level: its
`distinct_agent_hashes` and `top_country` are per event and hour, and its
`h3_res9/h3_res7` are the **event's venue** (`backfillH3Cells`), not a scan
place. Per-poster counts reach a report through `poster_attribution`, also
K-floored per poster-hour before the hours are summed (one scan in each of five
hours can be one person), and its first/last scan times come only from hours
that clear the floor (see §5).

---

## 4. Time: buckets, windows and the K=5 floor

### Buckets

- **Scans are stored at hour grain.** `scan_bucket = 'YYYY-MM-DDTHH:00'` UTC
  (`qr-scan.ts` `scanBucket`). The test is "scan_bucket is hour-granularity" in
  `tests/qr-scan.spec.ts`, and the structural lock is
  `tests/e2e/0-architecture/ncr-accumulation.structural.invariant.spec.ts`.
- **The rollup is also at hour grain.** `scan_aggregates` is keyed
  `(event_id, bucket_date, bucket_hour)`. Its one writer is the scheduled
  materializer (`aggregateScanBuckets` in `src/lib/shared-report.ts`), and it
  looks back 90 days.
- **Short links have no time series at all.** `shortlinks.clicks` is one running
  counter per code. Beside it, `last_clicked_at` is a single full-precision
  timestamp (`src/lib/shortlinks.ts` `incrementClick`). No `src/` reader outside
  that lib reads `last_clicked_at`.
- **Reports show totals per window, never per event.** The organizer's
  pre-event card groups hour buckets into the event's **local days** for the last
  14 days (`src/lib/pre-event-activity.ts` `bucketScansByDay`, `PRE_EVENT_DAYS = 14`).
  The SharedReport rounds `first_scan_at`/`last_scan_at` down to the hour
  (`bucketToHour`).

> **Resolved 2026-10-01 (OSE-1460): the time grain is hourly.** ADR-001 used to
> say 15-minute tranches. Code has always been hourly: scans, `scan_aggregates`,
> and forms (`bucketTimestamp()` in `src/lib/forms-db.ts` returns
> `toISOString().slice(0, 13)`). Hourly is coarser, so it is no less private.
> ADR-001 now says hourly.
>
> **Open item: `created_at` at rest.** Both scan tables still write
> `created_at = datetime('now')` at full precision (`src/lib/scan-buffer.ts`).
> Exposure is coarsened to the hour, but the at-rest value is finer than the
> hour floor. This is decision 3 in
> [SCAN_TIME_BUCKETING_DISCLOSURE_MODEL.md](../security/SCAN_TIME_BUCKETING_DISCLOSURE_MODEL.md)
> §4 and §8, and it is still open.

### The floor

`applyCountFloor` (`src/lib/count-floor.ts`) is the one rule. K is
`CORRIDOR_MAP_MIN_COUNT = 5` (`src/lib/shared-report.ts`). Below 5, the count is
`{ count: null, suppressed: true }`. At or above 5, the exact number is shown.
It is applied **server-side**, so a sub-5 value never reaches the client.
`tests/count-floor.spec.ts` pins K=5.

**The floor must apply at the finest grain that is displayed.** Any coarser
total must then be built **only from the cells that cleared the floor**. If it
is not, the hidden cells can be recovered by subtraction: total minus the sum
of the shown cells equals the sum of the hidden ones. Two rules cover this:

- **OSE-683 drop-before-sum.** `sumContributingBuckets` drops every contributing
  bucket under K before summing. It is used for `unique_gatherings` and the
  portfolio rollups (`src/lib/shared-report-builder.ts`,
  `src/handlers/portfolio-rollup.ts`).
- **Single rung per reader** (memo R1/R2). A reader never sees two time
  resolutions of one series at once. This is a **design memo, not ratified**, and
  no gate enforces it.

> **Closed (2026-10-07): subtraction leak in `click_outs`.** The SharedReport's
> `click_outs` (`src/lib/shared-report-builder.ts`, section 8) floored each kind
> on its own, then floored the **raw** total, including the suppressed kinds. With
> `public = 6` and `donate = 3`, it emitted `by_kind.public = 6`,
> `by_kind.donate = null`, `total = 9`, so `9 − 6 = 3`. The total is now the sum
> of the kinds that are published (`floorTotalOfParts`, `src/lib/count-floor.ts`):
> `total = 6` here, and null when no kind clears the floor, however many small
> kinds there are. `tests/shared-report-neighbour-floor.spec.ts` reads the report
> for two datasets one click apart and requires that nothing published moves;
> `tests/shared-report-kanon-floor.spec.ts`, which used to pin `total = 9`, now
> pins 6. `click_outs` is still not in `DEPTH_SECTIONS` (sponsor tokens never
> receive it) and no template renders it.
>
> **Closed (2026-10-07): the same leak on the organizer's pre-event card.** The
> card lists taps per code and withholds a code under 5 (`floorTaps`,
> `src/lib/poster-reach.ts`), but its totals were the raw sum: with taps 10, 2
> and 1 it listed 10, withheld the other two, and showed 13 in three fields of
> one response (`activity.clicks`, `reach.taps.total`, `reach.totals.taps`) and
> on the Live page (`reach.clicks` of the event dashboard). "Other links" was a
> raw sum too. All of them are now `floorTotalOfParts` over the per-code counts
> (10 here; null when no code has 5, however many small codes there are).
> `tests/reach-card-neighbour-floor.spec.ts` reads both routes for two datasets
> one tap apart and requires that nothing published moves. A withheld total
> therefore means "no link has 5 taps yet", not "fewer than 5 taps", and the
> card says so.
>
> **Closed (2026-10-08): the same leak on the operations dashboard.**
> `reach.link_taps` (`GET /api/v2/admin/dashboards/operations`) floored each
> event's raw tap sum, then added the events: 13 for the same 10, 2 and 1, and
> 14 after one more tap on a withheld link. Its query now returns taps per event
> and code, grouped by the expression the card groups by (`TAP_CODE_SQL`), and
> the figure is `floorTotalOfParts` over each event's codes, then over the
> events: 10 here, and withheld when no code of any event in scope has 5. The
> same spec reads the route for one event and for a brand with three. No page
> renders this figure yet.
>
> **Closed (2026-10-08): the same leak on the sponsor's line.** "So far: N link
> taps" was `floorPreEventActivity`'s raw sum, floored afterwards: 13 for 10, 2
> and 1, and 14 after one more tap on a withheld link. A sponsor is shown no
> per-code counts, but an organizer can open the sponsor's page and difference
> it against the card's listed codes. Owner decision, 2026-10-08: close it; the
> under-5 rule has no exceptions for any reader or tier. The figure is now
> `floorTotalOfParts` over the same per-code counts the organizer's total uses,
> so both audiences read the same number: 10 here. When no link has 5 the line
> says "fewer than 5 taps on any one link", because "fewer than 5 link taps"
> would be untrue for four links holding 15 between them. Nothing is pinned as
> open in that spec now.
>
> **Latent: same shape in `floorPreEventActivity`.** It floors the total and
> each day independently. The sponsor view renders totals only
> (`renderPreEventReach` in `src/lib/sponsor-home-render.ts`), so nothing can be
> differenced today. Rendering the per-day series to a sponsor would open the
> leak.

### Below the floor is week one, not an error

In a multi-week pre-event window, "the report legitimately shows _nothing_ early,
then crosses the floor and begins to resolve"
([reconciliation §10.1](../discovery/OSE_REFERENCE_posterPrimitiveReconciliation_2026-09-04.md#101-the-suppression-is-part-of-the-story)).
**The below-floor state is not an error state and must not be styled as one.**
The code follows this. The sponsor line reads "fewer than 5 poster scans" or
"fewer than 5 taps on any one link" in words, never a warning
(`renderPreEventReach` in `src/lib/sponsor-home-render.ts`). Public recap lines
read "Fewer than 5 …" (`statLine` in `src/handlers/pages.ts`).

---

## 5. Who sees what

Everything below was read from the handlers named. "Exact" means the raw count.
"Floored" means `applyCountFloor`, K=5.

| Signal                                       | Organizer (admin)                                                                                                                | Sponsor, via their `/sponsor?t=` home link                                                                                                                                                                        | SharedReport, **sponsor** token                                                                              | Attendee / public / TV display                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| QR scans, event total                        | **Exact**: `/stats` (`src/handlers/event-stats.ts`) and pre-event card (`src/handlers/pre-event-activity.ts`)                    | **Floored**. Shown only on an **accepted** placement (`sponsor_accepted = 1`) of a publicly renderable (active) event in the **pre-event** phase (`src/lib/sponsor-home-render.ts`, `canRender(state, 'public')`) | Not a section. `unique_gatherings` (distinct hashes, drop-before-sum, floored) at every depth                | **None**                                                        |
| QR scans per day (14 days)                   | **Exact** (admin card chart, `admin.html` reads `scansByDay`)                                                                    | Not shown. Computed floored, never rendered                                                                                                                                                                       | not sent                                                                                                     | None                                                            |
| QR scans per poster, with its res9 cell      | Via the SharedReport only: organizer/admin get the full report, `poster_attribution` floored, **sub-5 posters dropped entirely** | Not shown                                                                                                                                                                                                         | `poster_attribution` at **mid+** depth, same floor and drop (`tests/poster-attribution-kanon-floor.spec.ts`) | None                                                            |
| Short-link taps, event total                 | **Floored**: the taps on the codes with 5 or more each (`floorTotalOfParts`); pre-event card and Live page (§4)                  | **Floored**, same gating as scans                                                                                                                                                                                 | Not sent (`click_outs` is not in `DEPTH_SECTIONS`)                                                           | None                                                            |
| Short-link taps per destination kind         | SharedReport `click_outs`: floored per kind; the total is the sum of the published kinds (§4)                                    | Not shown                                                                                                                                                                                                         | not sent                                                                                                     | None                                                            |
| Posters out / places covered (distinct res7) | **Exact**                                                                                                                        | **Exact.** These are the organizer's own placements, not people (`floorPreEventActivity` leaves them exact)                                                                                                       | not a section                                                                                                | None                                                            |
| Corridor map                                 | Full report                                                                                                                      | —                                                                                                                                                                                                                 | **mid+** (`DEPTH_SECTIONS` in `src/lib/report-depth.ts`, ADR-017); cells are the event venue's               | None                                                            |
| Registrations / check-ins (forms, not QR)    | **Floored** (`event-stats.ts`)                                                                                                   | —                                                                                                                                                                                                                 | —                                                                                                            | Post-event recap: floored (`statLine`, `src/handlers/pages.ts`) |

Attendee and public, verified:

- The public event page, `/events`, and landing render no scan or tap count.
  They carry the never-who disclosure (`src/lib/never-who.ts`).
- The TV display renders no counts. Its "1/3" `display-sponsor-counter` is a
  rotation position. Its line is "We count the room, never the person."
  (`src/templates/display.html`).

Uncertain or worth a decision:

- **Organizer exact vs. "everyone sees the same".** The `count-floor.ts` header
  (OSE-665) says a sub-threshold cohort must look identical "on every surface —
  the organizer's admin tile, the sponsor-facing view, and the SharedReport". But
  `event-stats.ts` and `pre-event-activity.ts` show the organizer **exact**
  anonymous scan and tap counts, deliberately ("a first real scan must show as
  1"). Identity-derived form counts are floored for the organizer too. Treat this
  as a per-data-class policy that is currently written in handler comments, not
  in an ADR. See §9.
- **Cross-surface differencing.** A sponsor holding both a home link (floored
  event scan total) and a mid+ SharedReport (`poster_attribution` with sub-5
  posters dropped) could subtract to learn the combined count of the dropped
  posters. It could not learn their locations. Not verified whether any real
  sponsor holds both for the same event.

---

## 6. Poster codes and placements

### Tier 1: code kinds and plan limits (routing, `/s/`)

Since OSE-1357 part 2, a poster carries **several codes**, each pointing where the
organizer picks (`src/lib/poster-codes.ts`, `src/handlers/poster-codes.ts`,
`GET|PUT /api/v2/admin/events/:id/poster-codes`, admin-only and brand-scoped).

- **Kinds** (`POSTER_CODE_KINDS`):
  - **Internal**, built server-side at redirect time; a client-sent target is
    dropped: `public` (EVENT, always first), `checkin` (CHECK IN →
    `/forms/<id>?type=checkin`).
  - **External**, must pass `isValidHttpsTarget`: `donation`, `signup`,
    `tickets`, `ow` (ourWKRP), `league`, `workshop`, `substack`, `menu`,
    `website`.
  - Each kind prints a big WORD and an icon, so colour is never the only
    channel. Green is only check-in; blue is only donate.
- **Plan limits** (`POSTER_CODE_LIMITS`, counting the event-page code):
  **free 3, mid 5, enterprise 8**.
  - Enforced **server-side** on save (403 `PLAN_LIMIT`). The tier is read from
    the global flag set (`detectCurrentTier`).
  - Hard request ceiling: 20 codes.
  - Tests: `tests/poster-codes-parse.spec.ts`, `tests/poster-multi-code.spec.ts`.
- **Order** (migration `0080_shortlinks_add_poster_position.sql`):
  `poster_position = 0` is the event page, `1..N` are the organizer's codes, and
  `NULL` means off the poster.
  - Taking a code off never deletes the row, **so a printed code keeps working**.
  - Editing a target updates the row in place, so a printed code follows the fix.
  - Tested in `poster-multi-code.spec.ts` ("a removed code still routes").
- **Fallback:** until an organizer saves a list, the poster shows the event page
  plus the event's typed `what_url` link if it is enabled and https
  (`ensureSlotShortlinks`).

### Tier 2: placements (tracking, `/q/`)

A **placement** is a `poster_deployments` row (migrations 0003, 0047, 0079). It
has a `placement_label`, an optional `location_desc`, an optional `address`
(0079), lat/lng, and the derived `h3_res9`/`h3_res7`, all set by the organizer
in admin (`src/handlers/poster-deployments.ts`).

- **At the venue.** Several placements can share one event and one res7 while
  differing at res9. Test 9 of `poster-deployments-h3-tagging.spec.ts` covers
  two nearby placements.
- **In the community.** Placements anywhere, each tagged from the organizer's
  typed address. The address is admin-only; public surfaces and the scan path do
  not read it (0079 header; `tests/poster-deployment-address.spec.ts`).
- **The token is permanent in practice.** Retirement is a soft delete
  (`is_active = 0`); the scan lookup requires `is_active = 1`. The update
  allowlist has no `qr_token` field. **No gate** asserts that yet (PST-02; see
  §7).

### Tier 3: the pre-event reach picture

`readPreEventActivity` (`src/lib/pre-event-activity.ts`) returns **posters**
(active placements), **places** (distinct organizer-declared res7 cells), all-time
**scans** and **taps**, and **scans per local day** for 14 days. It reads no
`scan_node_returns`, no request, and no FORMS_DB. The test "the activity module
never touches the WHO side, the request, or FORMS_DB" in
`tests/pre-event-activity.spec.ts` enforces that.

- The **organizer** sees it on the admin pre-event card, with the public short
  link and its QR ("link first"): scans exact, taps floored. The tap total is
  the sum of the codes that have 5 or more taps each (§4).
- The **sponsor** sees one floored sentence on each accepted pre-event placement:
  "So far: N link taps · M poster scans. Your name is on P posters in Q places."
  (`renderPreEventReach`). N is the same figure the organizer's card shows: the
  taps on the links that have 5 or more each.

---

## 7. Status

BUILT = in code with a test. PARTIAL = some of it. NOT BUILT = cites the story in
[reconciliation §8](../discovery/OSE_REFERENCE_posterPrimitiveReconciliation_2026-09-04.md#8-task-3--proposed-sizing-not-created).

| Behavior                                                                                                  | State         | Evidence                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/q/` token check, active-placement lookup, 302 to event page                                             | **BUILT**     | `src/handlers/qr-scan.ts`; `tests/qr-scan.spec.ts`, `tests/qr-scan-routed.spec.ts`                                                                                                              |
| Split WHERE/WHO scan write                                                                                | **BUILT**     | `src/lib/scan-buffer.ts`, migration 0062; `tests/e2e/0-architecture/scan-path-split.invariant.spec.ts`, `tests/scan-buffer.spec.ts`                                                             |
| Hour bucket, hourly KV dedup (one per person per poster per hour)                                         | **BUILT**     | `qr-scan.ts`; `tests/qr-scan.spec.ts`                                                                                                                                                           |
| Scan write buffer (Queues)                                                                                | **PARTIAL**   | Code + `tests/scan-buffer.spec.ts`; bound on staging, **dark in production** (`wrangler.toml`)                                                                                                  |
| Placement res9 + res7 from an organizer address                                                           | **BUILT**     | `poster-deployments.ts`, `geocode.ts`, 0047, 0079; `tests/poster-deployments-h3-tagging.spec.ts`, `tests/poster-deployment-address.spec.ts`                                                     |
| No request/device geolocation on scan or click path                                                       | **BUILT**     | Gate 8b in `tests/poster-deployments-h3-tagging.spec.ts` (no `CF-IP*` header at all, country included, since OSE-1460)                                                                          |
| `/s/` resolve, click counter, 302, 404 on probe                                                           | **BUILT**     | `shortlink-resolve.ts`, `shortlinks.ts`; `tests/shortlinks.spec.ts`                                                                                                                             |
| Open-redirect protection (https-only at creation, re-checked at resolve, no destination from the request) | **BUILT**     | `isValidHttpsTarget`, resolver `startsWith('https://')`; `tests/shortlinks.spec.ts`, `tests/poster-multi-code.spec.ts` refusals                                                                 |
| Several codes per poster, kinds, plan limits, order                                                       | **BUILT**     | `src/lib/poster-codes.ts`, 0080; `tests/poster-codes-parse.spec.ts`, `tests/poster-multi-code.spec.ts`, `tests/poster-multi-code-ui.spec.ts`                                                    |
| Pre-event activity (organizer exact) and sponsor reach (floored)                                          | **BUILT**     | `src/lib/pre-event-activity.ts`, `src/lib/sponsor-home-render.ts`; `tests/pre-event-activity.spec.ts`                                                                                           |
| SharedReport `poster_attribution`, K-floored with sub-5 dropped                                           | **BUILT**     | `src/lib/shared-report-builder.ts` (OSE-711); `tests/poster-attribution-kanon-floor.spec.ts`                                                                                                    |
| SharedReport `click_outs` (the digital signal)                                                            | **PARTIAL**   | Built and tested, total is drop-before-sum (§4); neither rendered nor in `DEPTH_SECTIONS`                                                                                                       |
| Weekly per-poster scan series, K=5 (§8 story 2)                                                           | **PARTIAL**   | Per-poster **totals** (SharedReport) and per-day **event** totals (organizer card) exist. No per-poster time series                                                                             |
| `scan_node_returns` retention sweep (OSE-1351) and erasure by anon id (OSE-1350)                          | **BUILT**     | `src/lib/scan-returns-retention.ts` (**off unless `SCAN_RETURNS_RETENTION_DAYS` is set**), `src/handlers/data-subject.ts`; `tests/scan-returns-retention.spec.ts`, `tests/data-subject.spec.ts` |
| Static gate: `qr_token` never updated, PST-02 (§8 story 1)                                                | **NOT BUILT** | True in code (update allowlist omits it), ungated                                                                                                                                               |
| No scan-to-external-booking join, PST-03 (§8 story 6)                                                     | **PARTIAL**   | Named-session blindness is gated (`tests/forbidden-join-blindness.spec.ts`, `tests/forbidden-join-boundary.spec.ts`). No gate on external booking/reservation joins                             |
| `poster_deployments` campaign columns incl. `surface` (§8 story 3)                                        | **NOT BUILT** | No `surface`, `segment`, `variant_label`, `print_run`, `season_*` column in any migration                                                                                                       |
| `venues` entity + `consented_at`, PST-05 (§8 story 4)                                                     | **NOT BUILT** | No `venues` table; "the wall consented" (§9) has no record                                                                                                                                      |
| `surface = 'digital'` ⇒ `h3_res9 IS NULL` CHECK + gate (§8 story 7)                                       | **NOT BUILT** | No `surface` column. Nearest proxy: gate 8d (shortlinks has no cell finer than res7)                                                                                                            |
| Digital deployment: short link tied to a `surface = 'digital'` deployment tagged res7 (§8 story 8)        | **NOT BUILT** | `shortlinks` has no deployment link and no H3 (0030/0073/0080). Matches §9.3: the digital path resolves to **no place**                                                                         |
| Finalized-only exposure, no live open bucket (memo R4)                                                    | **NOT BUILT** | Memo is pre-constitution. The organizer card and the sponsor reach line include the current day/hour                                                                                            |

---

## 8. Invariants and gates

Unless noted, gates run in CI: 0-architecture structural specs in **T0 Gate
(invariants)**, and worker specs in **T0 Tests (worker-d1-schema)**
(`.github/workflows/oursharedevents-ci.yml`).

| Rule                                                                                                               | Gate                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No table couples a placement id with a session-derived value                                                       | `tests/e2e/0-architecture/scan-path-split.invariant.spec.ts`. **Main-DB migrations only**, see gap below                                               |
| Scan/click path reads no device or request geolocation (country included)                                          | `tests/poster-deployments-h3-tagging.spec.ts` 8b. Names its files (`SCAN_CLICK_PATH`), so a new scan-path file is not covered until it is added        |
| Nothing served asks the browser for its position                                                                   | same spec, 8b (second test; derives the file list from `src/`)                                                                                         |
| Scan rows carry no coordinate or cell; placement res9 is the only place                                            | same spec, 8c                                                                                                                                          |
| Short links store nothing finer than res7, and no identity column                                                  | same spec, 8d; `tests/shortlinks.spec.ts` (exact column list + forbidden PII names)                                                                    |
| No table stores a cell finer than res9                                                                             | same spec, 8e                                                                                                                                          |
| Short-link resolver reads no IP, cookie, anon id or Referer                                                        | `tests/shortlinks.spec.ts` ("zero per-attendee identity reads")                                                                                        |
| Short-link targets are https-only, validated at creation                                                           | `tests/shortlinks.spec.ts`, `tests/poster-multi-code.spec.ts`, `tests/poster-codes-parse.spec.ts`                                                      |
| No h3-js on the `/q/` hot path                                                                                     | `tests/qr-scan.spec.ts` (STATIC). `tests/h3-tagging.spec.ts` `SCAN_PATH` does **not** list `qr-scan.ts`, although the `qr-scan.ts` header says it does |
| Scans stored hour-bucketed; `scan_aggregates` and `scan_cell_aggregates` each have one scheduled writer and no TTL | `tests/e2e/0-architecture/ncr-accumulation.structural.invariant.spec.ts`; `tests/qr-scan.spec.ts`                                                      |
| K = 5                                                                                                              | `tests/count-floor.spec.ts`; `tests/e2e/0-architecture/aggregate-only.invariant.spec.ts` (corridor-map suppression, DS-01 `this_event_count`)          |
| Per-poster counts floored, sub-K dropped                                                                           | `tests/poster-attribution-kanon-floor.spec.ts`                                                                                                         |
| Sponsor reach floored; activity never touches WHO side, request or FORMS_DB                                        | `tests/pre-event-activity.spec.ts`                                                                                                                     |
| A named (ourWKRP) session never reaches a scan row                                                                 | `tests/forbidden-join-blindness.spec.ts`, `tests/forbidden-join-boundary.spec.ts`                                                                      |
| SharedReport depth enforced server-side at one point                                                               | `tests/shared-report-read.spec.ts`, `tests/report-depth.spec.ts` (ADR-017)                                                                             |

**Rules with no gate:**

1. `surface = 'digital'` ⇒ `h3_res9 IS NULL`. There is no `surface` column yet
   (§8 story 7).
2. `qr_token` is never updated (PST-02, §8 story 1).
3. **Drop-before-sum for any displayed total over floored cells.** Gated for
   the SharedReport by `tests/shared-report-neighbour-floor.spec.ts`: two
   datasets one person apart, nothing published may move; and a registry
   of every number the report publishes with its floor rule. Not gated for
   other surfaces (`floorPreEventActivity`, §4).
4. Finalized-only / single-rung exposure (memo R1, R2, R4): not ratified, not
   gated.
5. **Placement id and identity in one row, in FORMS_DB.**
   `form_registrations.source_placement_id` (`migrations-forms/0001`) is written
   next to `anonymous_id`, an email hash and an encrypted name
   (`src/handlers/forms.ts`). The row is TTL-bounded (90 days,
   `REGISTRATION_TTL_MS`), and it follows a QR scan that the attendee chose to
   follow into a form. But `scan-path-split` only reads `migrations/`, so this
   coupling is outside its reach. Decide whether rule 6 covers FORMS_DB.
6. **The never-who "event" disclosure is not true for QR arrivals.** It says
   "The link you followed counted as a single click; nothing about your device,
   location, or identity was collected" (`src/lib/never-who.ts`). That is true
   for `/s/`. A `/q/` arrival set a one-year cookie and stored a UA hash on the
   hop before the page (the country code is gone since OSE-1460). `tests/never-who-disclosure.spec.ts`
   checks presence and wording, not truth per arrival path.

---

## 9. Open decisions

1. **Promote §9 to an ADR.** "Surface determines resolution" is a founder
   decision, but it lives in a discovery doc and calls itself a "proposed
   invariant". It should be an ADR that settles:
   - the `surface` column;
   - the CHECK constraint and its gate;
   - the §12.4 fixed-vs-mobile scope;

   **Recommendation: write that ADR.** It is not written here.

2. **Destinations vs. corridors (§9.4).** `corridors` (migration 0010) is already
   `origin_node_id → destination_node_id`. Settle whether a travel "destination"
   is a new `destinations` entity or a destination node that needs a bookable
   face. This is §8 story 9, and it blocks story 10.
3. **Where digital res7 comes from.** §9 says the area the link was **published
   into**, recorded on a deployment OCR created. Deriving it from the visitor's
   request would reverse §9.2 and fail gate 8b. That would need a new ADR, not a
   code change.
4. **Organizer exact vs. uniform floor** (§5). Ratify the per-data-class policy:
   anonymous scans and taps exact for the organizer, identity-derived counts
   floored. The alternative is to amend the OSE-665 wording in
   `count-floor.ts`.
5. ~~Fix `click_outs` to drop-before-sum, and flip its test (§4).~~ Done
   2026-10-07.
6. **Retention of `scan_node_returns`.** The sweep exists but is off by default.
   The policy question from reconciliation §7/§10.3 (with Tom) is still open.
7. **`created_at` precision at rest** (memo §4, decision 3).
8. **Never-who copy for QR arrivals** (§8, rule 6). Either make the event-page
   body accurate for `/q/` arrivals, or change what `/q/` collects.

---

## 10. Related docs

- [Poster primitive reconciliation (2026-09-04)](../discovery/OSE_REFERENCE_posterPrimitiveReconciliation_2026-09-04.md):
  §8 stories, §9 resolution, §10 three-layer SharedReport, §12.4 mobile items
- [ADR-001: anonymous identity / two-DB](../adr/ADR-001-anonymous-identity-architecture.md).
  Says hourly since OSE-1460 (it used to say 15 minutes)
- [ADR-009: NCR v2 geographic hierarchy](../adr/ADR-009-ncr-v2-geographic-hierarchy.md)
- [ADR-017: SharedReport depth enforcement](../adr/ADR-017-sharedreport-depth-enforcement.md)
- [ADR-019: sponsor consent-traced rendering](../../workers/oursharedevents/docs/ops/ADR-019-sponsor-consent-traced-rendering.md):
  why sponsor reach only shows on accepted placements
- [ADR index and reconciliation process](../adr/README.md)
- [Scan time-bucketing disclosure model](../security/SCAN_TIME_BUCKETING_DISCLOSURE_MODEL.md)
- [0-architecture invariant gates](../../tests/e2e/0-architecture/README.md)
- [QR-ROUTING.md](QR-ROUTING.md): `/forms/` links only
- [FRIENDLY_URLS.md](../architecture/FRIENDLY_URLS.md). Mentions `/s/`; otherwise
  GAS-era (`Config.gs`)
- [worker-routing.md](../architecture/worker-routing.md). **Archival.** Its
  "Shortlink Routes" (`?p=r&t=…`, `worker.js`) are not the current `/s/`
- [ROUTE_CLASSIFICATION_POLICY.md](../security/ROUTE_CLASSIFICATION_POLICY.md).
  Does not list `/q/` or `/s/`. Its QR-0 note says bundles return
  `403 QR_NOT_VERIFIED`, but the poster bundle actually gates on event state
  (`403 NOT_RENDERABLE` via `assertRenderable`, where active ⟺ `qr_verified = 1`)
