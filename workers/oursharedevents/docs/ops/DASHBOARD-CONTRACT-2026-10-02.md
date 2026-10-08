# Governed dashboards: contract (first slice, 2026-10-02)

Part of OSE-1468. The code is the source of truth:

- Metric registry, privacy classes and the not-measured list: `src/lib/dashboard-contract.ts` (`DASHBOARD_CONTRACT_VERSION` = `2.0.0`)
- Queries: `src/handlers/dashboards.ts`
- Seeded fixture: `tests/helpers/seed-dashboard-fixture.ts`
- Tests: `tests/dashboards.spec.ts` (26, workers pool); link taps also in `tests/reach-card-neighbour-floor.spec.ts`; corridor scans also in `tests/corridor-scans-neighbour-floor.spec.ts`

**Owner ruling, 2026-10-08:** "there should be no exceptions to the rule. Even at enterprise. the <5 rule still applies so there is consistency." The floor holds against a brand's own admin, at every tier (OSE-1655).

This page explains the decisions. If it disagrees with the code, the code wins and this page is wrong.

## The three endpoints

| Dashboard                         | Route                                     | Scope                                                                                  |
| --------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Founder / operations cockpit      | `GET /api/v2/admin/dashboards/operations` | Every brand the caller is a member of, or one brand with `?brand_id=`                  |
| Corridor / community intelligence | `GET /api/v2/admin/dashboards/corridor`   | Same as above                                                                          |
| Organizer / partner report        | `GET /api/v2/admin/events/:id/dashboard`  | One event. The object-scope guard returns 404 for an event outside the caller's brands |

All three need admin auth (`requireAdmin`) and send `Cache-Control: no-store`.

Query parameters for the two brand-scoped dashboards:

- `brand_id`: narrows to one brand the caller holds. A brand the caller does not hold returns 403 `BRAND_FORBIDDEN`. A value that is not a slug returns 400 `INVALID_BRAND_ID`.
- `data_class`: `production` (the default) or `all`. `all` includes demo and synthetic events, so the cockpit works on seeded staging data. Any other value returns 400 `INVALID_FILTER`.

An admin with no brand membership gets 403 `BRAND_SCOPE_DENIED`. A key actor in scope mode `all` must name a brand. Without one it gets 400 `BRAND_REQUIRED`, because these dashboards never merge every tenant into one view. That cross-tenant view belongs to OER, which reads exports.

## Every response carries

```json
{
  "contract": {
    "version": "2.0.0",
    "dashboard": "operations",
    "metrics": ["events.total", "..."],
    "floor": 5
  },
  "scope": { "brands": ["..."], "data_class": "production" },
  "generated_at": "ISO-8601",
  "not_measured": [{ "id": "surface_visits", "dashboard": "operations", "reason": "..." }]
}
```

The organizer report has no `scope` block, because its scope is the event id.

## Errors

A failed D1 or FORMS_DB read, or a missing FORMS_DB binding when the scope has events, is a logged `DASHBOARD_DB_ERROR` and a 503 `DB_UNAVAILABLE`. A dashboard never turns an outage into zeroes, and the event report never turns one into a 404.

## Floors across scopes

A caller can pick overlapping views: several brands or one, and `production` or `all`. Corridor scans therefore keep one raw count per part (brand, data class, source cell and destination), and each part is floored before any sum. Every view is a sum of parts that each cleared K, so subtracting one view from another cannot reveal a count under K. Per-event floors already work this way, because each event belongs to exactly one brand and one data class. So do the per-code floors on link taps: a code belongs to one event.

## Listed and admin activity

- `events.published` counts events on the public list and map now: `is_published = 1` and `status = 'active'`. A published draft is not listed.
- `admin_activity_30d` has one counter per audit action: `created`, `updated`, `qr_verified`, `qr_unverified`, `deleted` and `denied`. A status change made through `PUT /api/v2/admin/events/:id` is audited as `UPDATE_EVENT`, so it counts as `updated`. Counting those changes as lifecycle transitions needs the audit row to carry the from/to status, which is listed under not measured.

## Sponsors on show

`on_show` counts a placement only when a visitor can see it: active placement, active business, the sponsor accepted, the organizer accepted under the source-aware rule (a `sponsor_request` needs `organizer_accepted = 1`), the event is live, and the event is in the sponsor's own brand. The schema allows a cross-brand placement row; no sponsor count (on show, waiting, declined) includes one. The rule is `PLACEMENT_ON_SHOW_SQL` in `lib/sponsor-card.ts`, next to the card's `SPONSOR_ON_SHOW_SQL`. On show, waiting and declined never overlap.

## Privacy classes

| Class     | Meaning                                                                                                                                                    | Rule                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `entity`  | Counts of things, not people: events, posters, places, sponsor placements, admin actions                                                                   | Exact                                                                  |
| `floored` | Every count of people or of their actions: registrations, check-ins, email signups, short-link taps, poster scans (every grain), flows, SharedReport opens | K = 5 via `lib/count-floor.ts`, per contributing bucket before any sum |

Until `2.0.0` there was an `anonymous_exact` class for poster scans, exact for the organizer, and SharedReport opens were `entity`. OSE-1656 removed the class and retyped both (owner ruling 2026-10-08: no exceptions).

Each registry entry holds one value of one class and names its `path` in the response (`flows[].scans` maps over an array). A test resolves every path against a live response and checks the value has its class's shape: a `FlooredCount` for `floored`, and no `FlooredCount` anywhere inside for the exact classes. A second test fails on any response key no metric covers.

Floored totals follow the OSE-669 rule: each event is floored first and only the events at or above K are summed. A total can't be subtracted from another view to recover a small event. A flow (source cell to event cell) under K is left out entirely. Listing the pair, even as suppressed, would tell a reader that someone scanned from that cell to that one.

A source cell's scans are the sum of what the same response lists for it (since 2026-10-08): the flows from that cell, plus `scans_no_destination`, the cell's scans for events that have no place on the map and so are in no flow. The cell figure is built from those published numbers with `floorTotalOfParts`; it is not a count of its own. Before this the cell counted every scan on its posters, so a cell reading 10 beside one flow of 7 gave back the flow that was left out (3), and read 11 after one more scan on it. It now reads 7 in both cases. So:

- `source_cells[].scans` = the cell's listed flows + its `scans_no_destination`, always. It is a lower bound on the scans in the cell, and withheld means "no flow from this cell has 5 scans yet", not "fewer than 5 scans".
- `scans_no_destination` is one part, floored like a flow: withheld under 5. It is on every row, so its presence says nothing.
- A cell with no poster out is listed once it has a number to show, and not before. A row with no poster and a withheld count would say that someone once scanned there.
- Flows that tie are ordered by source cell, then destination. The order rows arrive in follows parts that are not listed.

`tests/corridor-scans-neighbour-floor.spec.ts` reads the route for datasets one scan apart on a withheld part, as one brand, as a member of two, with and without demo data, and requires that nothing published moves. The other repair considered was to list withheld flows as rows and total them with the same helper. It gives the same cell number, but a withheld row that appears with the first scan publishes "between 1 and 4", and listing a row for every poster and event pair instead is a larger change to the response.

No page renders the corridor dashboard yet. When one does, a withheld cell must be shown in words, never as 0.

Link taps go one grain finer, because the same organizer is shown taps per poster code on the pre-event card: each code is floored first and only the codes at or above K are summed (`floorTotalOfParts` in `lib/count-floor.ts`). On the **event** dashboard (`reach.clicks`) the total is withheld when no code has 5, however many small codes there are, so it cannot be subtracted against the card's listed codes.

The **operations** dashboard's `reach.link_taps` is the sum of those event totals (since 2026-10-08). Its query returns one count per event and code, grouped by `TAP_CODE_SQL`, the same expression the card groups by. Each event's codes at or above K are summed into that event's figure, the event figures are floored and summed, and the result is withheld when no code of any event in scope has 5 taps. A withheld value means "no link has 5 taps yet", not "fewer than 5 taps". Before this it floored each event's raw tap sum: with one event and links holding 10, 2 and 1 taps it read 13, and 14 after one more tap on a withheld link, while the card listed 10. It now reads 10 in both cases. `tests/reach-card-neighbour-floor.spec.ts` reads the route for datasets one tap apart, for one event and for a brand with three, and requires that nothing published moves.

No page renders `reach.link_taps` yet (the admin card is a next slice, below). When one does, it must show a withheld value in words, never as 0, as the Live page does for `reach.clicks` ("Held").

Places are H3 res-7 cells only. No response carries lat/lon or res-9 (Invariant #1). There is a test for this.

## How "anonymous versus explicit" maps to OSE data

- **Anonymous participation**: poster scans. They name no one.
- **Explicit choice**: registrations, check-ins and next-event email signups (FORMS_DB). The handler reads only per-event `COUNT`s, keyed by the brand-scoped event ids. It never reads a row or a PII column, and never joins across the two databases. `tests/architecture.spec.ts` lists `dashboards.ts` as an authorised FORMS_DB reader on those terms.
- **Named profile / flag**: the OW side. It stays in its own spoke and isn't read here.

## Source and destination layers (corridor)

- **Destination layer** (`event_cells`): the cell where each event is held (`events.h3_res7`), with its event count and live count.
- **Source layer** (`source_cells`): the cell where each poster hangs (`poster_deployments.h3_res7`), with its poster count (exact), its scan count (floored: the sum of its listed flows and its `scans_no_destination`) and its scans for events with no place on the map (`scans_no_destination`, floored). This is where the organizer put the poster, never where a scanner stood. A poster with no cell is in no row.
- **Flows**: scans from a source cell to an event cell, floored. A flow under K is not listed, and is not in its source cell's count either.

## Not measured yet

Each item below is in `NOT_MEASURED` and is returned in every response. The dashboard shows the gap rather than a made-up number.

| Item                                               | Why                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/public`, `/display`, `/sharedReport` page visits | No per-surface view counter exists                                                                                           |
| QR / short-link resolution failures                | Not stored in D1. Successes are counted as scans and taps                                                                    |
| Status changes made through PUT                    | Audited as `UPDATE_EVENT` with no from/to status                                                                             |
| API errors and 409 transition failures             | Worker log only. Needs a log-sink read                                                                                       |
| Ingestion, contract and CI gate health             | GitHub Actions and BigQuery, not D1                                                                                          |
| Profile / flag actions                             | OW spoke                                                                                                                     |
| Partner-page visits                                | `GET /sponsors/:id` isn't counted, and Invariant #25 forbids impression metrics                                              |
| Repeat participation                               | Published once, weekly and rounded, by `corridor_returns_export` (OSE-1460). A second read would open a differencing surface |
| Local showcase engagement                          | No showcase entity yet                                                                                                       |

## Versioning

Adding a metric is a minor bump. Removing or retyping one is a major bump. A test checks that every metric id a response lists exists in the registry.

The version follows the response shape. The two link-tap changes (the event figure in #871, then the operations figure on 2026-10-08) changed which taps a figure counts, not its shape, path or class, so the version stayed `1.0.0`. Both can only lower a figure or withhold it.

`1.1.0` (2026-10-08): the corridor's source cells gained `scans_no_destination`, a new metric, so a minor bump. The same change made `source_cells[].scans` the sum of the cell's listed parts; that alone changes which scans the figure counts, not its shape, and can only lower it or withhold it.

`2.0.0` (2026-10-08, OSE-1656): a major bump. Every scan metric (`reach.poster_scans`, `participation.anonymous.scans` on both dashboards, `reach.scans`, `reach.scansByDay[].count`) and both `shared_report.views_30d` metrics are retyped to `floored`; each is now a `FlooredCount`, not a number. `event.reach.scans_by_day.day` is new (the label beside each floored day).

## Scans: one grain everywhere (OSE-1656, 2026-10-08)

The 2026-10-08 ruling reached past the corridor: the operations total minus the corridor's cells was the scans the corridor withheld, and the event dashboard's exact `reach.scans` said it outright. Closed by giving every scan figure one grain, **one poster in one hour** (`lib/scan-cells.ts`). That is the cell the SharedReport's poster attribution already floors (OSE-1459): the scan path keeps one scan per person per poster per hour, so only a poster-hour of 5 or more is 5 or more people.

- Every scan figure, on every surface, is the sum of the poster-hours that clear the floor (`floorTotalOfParts`): a poster on its card, a day on the chart, the event on the card, `/stats` and its dashboard, the brand on the operations dashboard, a corridor part, and the sponsor's line. So any two of them differ by a sum of cells that each clear the floor, and none can be subtracted from another, or from the report, to get a group under 5 back. `tests/corridor-scans-neighbour-floor.spec.ts` now asserts that one more scan on a left-out flow moves neither the operations total nor the event's.
- Report opens are floored per event per day, the same way.
- The First-Scan gauge and the timeline's "People scanning" step read withheld until one poster has 5 scans in one hour: a gauge that showed 1 would tell "nobody" from "1 to 4".
- Not changed: the organizer's registration and survey lists. They are the organizer's own consented rows, which the organizer reads one by one (`lib/count-floor.ts`, scope note). A count floor on a list whose every row the reader holds protects no one.

## Next slices (not in this change)

1. An admin UI card for each dashboard, using the hub `@ocr/ui` partials and placed under the mobile-workability audit.
2. A T3/T4 staging E2E that goes from create event through poster, scan, report and dashboard.
3. Counters for the not-measured items that need one, starting with surface visits.
