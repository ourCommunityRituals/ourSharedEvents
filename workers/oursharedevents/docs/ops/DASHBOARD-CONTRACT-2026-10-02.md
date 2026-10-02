# Governed dashboards: contract (first slice, 2026-10-02)

Part of OSE-1468. The code is the source of truth:

- Metric registry, privacy classes and the not-measured list: `src/lib/dashboard-contract.ts` (`DASHBOARD_CONTRACT_VERSION` = `1.0.0`)
- Queries: `src/handlers/dashboards.ts`
- Seeded fixture: `tests/helpers/seed-dashboard-fixture.ts`
- Tests: `tests/dashboards.spec.ts` (24, workers pool)

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
    "version": "1.0.0",
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

A failed D1 or FORMS_DB read is a logged `DASHBOARD_DB_ERROR` and a 503 `DB_UNAVAILABLE`. A dashboard never turns an outage into zeroes, and the event report never turns one into a 404.

## Sponsors on show

`on_show` counts a placement only when a visitor can see it: active placement, active business, the sponsor accepted, the organizer accepted under the source-aware rule (a `sponsor_request` needs `organizer_accepted = 1`), and the event is live. The rule is `PLACEMENT_ON_SHOW_SQL` in `lib/sponsor-card.ts`, next to the card's `SPONSOR_ON_SHOW_SQL`. On show, waiting and declined never overlap.

## Privacy classes

| Class             | Meaning                                                                                                      | Rule                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `entity`          | Counts of things, not people: events, posters, places, sponsor placements, admin actions, SharedReport opens | Exact                                                                           |
| `anonymous_exact` | Poster scans (`scan_placement_events`: event, poster, hour; no session, device or person)                    | Exact. Same rule as `/stats` and the pre-event card, so a first scan shows as 1 |
| `floored`         | Registrations, check-ins, email signups, short-link taps, scans per cell, flows                              | K = 5 via `lib/count-floor.ts`                                                  |

Each registry entry holds one value of one class and names its `path` in the response (`flows[].scans` maps over an array). A test resolves every path against a live response and checks the value has its class's shape: a `FlooredCount` for `floored`, and no `FlooredCount` anywhere inside for the exact classes. A second test fails on any response key no metric covers.

Floored totals follow the OSE-669 rule: each event is floored first and only the events at or above K are summed. A total can't be subtracted from another view to recover a small event. A flow (source cell to event cell) under K is left out entirely. Listing the pair, even as suppressed, would tell a reader that someone scanned from that cell to that one.

Places are H3 res-7 cells only. No response carries lat/lon or res-9 (Invariant #1). There is a test for this.

## How "anonymous versus explicit" maps to OSE data

- **Anonymous participation**: poster scans. They name no one.
- **Explicit choice**: registrations, check-ins and next-event email signups (FORMS_DB). The handler reads only per-event `COUNT`s, keyed by the brand-scoped event ids. It never reads a row or a PII column, and never joins across the two databases. `tests/architecture.spec.ts` lists `dashboards.ts` as an authorised FORMS_DB reader on those terms.
- **Named profile / flag**: the OW side. It stays in its own spoke and isn't read here.

## Source and destination layers (corridor)

- **Destination layer** (`event_cells`): the cell where each event is held (`events.h3_res7`), with its event count and live count.
- **Source layer** (`source_cells`): the cell where each poster hangs (`poster_deployments.h3_res7`), with its poster count (exact) and its scan count (floored). This is where the organizer put the poster, never where a scanner stood.
- **Flows**: scans from a source cell to an event cell, floored.

## Not measured yet

Each item below is in `NOT_MEASURED` and is returned in every response. The dashboard shows the gap rather than a made-up number.

| Item                                               | Why                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/public`, `/display`, `/sharedReport` page visits | No per-surface view counter exists                                                                                           |
| QR / short-link resolution failures                | Not stored in D1. Successes are counted as scans and taps                                                                    |
| API errors and 409 transition failures             | Worker log only. Needs a log-sink read                                                                                       |
| Ingestion, contract and CI gate health             | GitHub Actions and BigQuery, not D1                                                                                          |
| Profile / flag actions                             | OW spoke                                                                                                                     |
| Partner-page visits                                | `GET /sponsors/:id` isn't counted, and Invariant #25 forbids impression metrics                                              |
| Repeat participation                               | Published once, weekly and rounded, by `corridor_returns_export` (OSE-1460). A second read would open a differencing surface |
| Local showcase engagement                          | No showcase entity yet                                                                                                       |

## Versioning

Adding a metric is a minor bump. Removing or retyping one is a major bump. A test checks that every metric id a response lists exists in the registry.

## Next slices (not in this change)

1. An admin UI card for each dashboard, using the hub `@ocr/ui` partials and placed under the mobile-workability audit.
2. A T3/T4 staging E2E that goes from create event through poster, scan, report and dashboard.
3. Counters for the not-measured items that need one, starting with surface visits.
