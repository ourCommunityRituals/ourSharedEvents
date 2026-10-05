# SharedReport Read API + WKRP Batch — Design

**Status:** **Design draft** (Session 5 of OSE-272; awaits ratification of S5-Q1—Q5)
**Date:** 2026-05-15
**Authors:** mzdan + Co-Architect
**Closes design phase of:** OSE-272 Session 5 (read API)
**Unblocks:** OSE-15 production launch readiness; future WKRP performer-attribution consumer
**Routing:** per `OCR-docs/OPERATING_SYSTEM.md §3` — per-repo feature design → `<repo>/docs/features/`

---

## Purpose

Sessions 3 and 4 ship the materialization and BigQuery export of the SharedReport primitives. **Session 5 ships the product surface** — the HTTP API that bars, sponsors, and (in-fleet) WKRP consume to actually read SharedReports.

Two endpoints land:

1. `GET /api/v2/events/:id/shared-report` — single-event SharedReport. The OSE-native product API; what a bar owner or sponsor calls to get their report for one event.
2. `POST /api/v2/events/shared-reports/batch { ids: [...] }` — WKRP batch endpoint (**ratified 2026-05-15**). A DJ with 100 gigs shouldn't fire 100 sequential `GET`s.

**Architectural commitment that gates everything below:** the read API serves **aggregate** data only. No row in any response identifies an individual attendee. Hashes are never returned (they're internal correlation keys); only aggregate counts and statistical signals. The anonymity invariant (ADR-001) is preserved by the read layer mechanically — the source D1 tables don't have raw `anon_id` to leak.

---

## Open design questions (RATIFY before code)

| Q         | Question                                                                                                                                                                | Co-Architect recommendation                                                                                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S5-Q1** | **Auth model.** Public? Signed-link-per-event for bars/sponsors? Admin-only? Service-token for WKRP?                                                                    | **Hybrid: signed link for product consumers (bars + sponsors), service-token for in-fleet consumers (WKRP).** Bars get a signed link per event (already standard for admin actions). WKRP authenticates via a service-account bearer token. No public endpoint.                                                        |
| **S5-Q2** | **Response shape.** Full SharedReport object in one call, or minimal field-list + per-field endpoints?                                                                  | **Full object.** Six fields, all derived from cached aggregates — composite cost is negligible. Per-field endpoints add API surface area without value.                                                                                                                                                                |
| **S5-Q3** | **Batch endpoint max IDs per request.**                                                                                                                                 | **50 IDs per batch.** A working DJ has 4–20 gigs/month; 50 covers ~3 months of activity in one call. Higher limits create timeout risk on cold-start; lower limits force pagination on common cases.                                                                                                                   |
| **S5-Q4** | **Caching.** Cache responses? TTL?                                                                                                                                      | **Yes, 1h TTL via `Cache-Control`.** Source aggregates refresh daily (Session 3 cron); a 1h cache is safely below the staleness floor. Cache key is `(event_id, viewer_token_role)` so signed-link viewers see their event; service-token viewers see batch results.                                                   |
| **S5-Q5** | **Below-minimum-sample handling.** Per Q4 (Session 1 ratified), corridor baseline needs ≥10 events/30d. What does the response do when an aggregate is below threshold? | **Return field as `null` with a `_meta.suppression_reasons[]` array naming the suppressed field + reason.** Consumers know _why_ a field is missing, not just _that_ it is. Critical for WKRP UX — a DJ at a new corridor sees "corridor density: still building baseline (3 of 10 events)" instead of opaque silence. |

---

## Endpoint contracts

### 1. `GET /api/v2/events/:id/shared-report`

**Auth (S5-Q1):** Signed-link token in the `Authorization: Bearer <token>` header. The token is a short-lived signed claim binding `(event_id, role)` where role ∈ `{bar_owner, sponsor, admin}`. Tokens are minted by an existing OSE admin/auth path (out-of-scope for Session 5; reuses existing signed-link infrastructure).

**Path params:**

- `id` — event ID. Token's `event_id` claim must match.

**Response (200 OK):** Full SharedReport object (see schema below).

**Error responses:**

- `401 Unauthorized` — missing or invalid token
- `403 Forbidden` — token's `event_id` claim does not match path `:id`
- `404 Not Found` — event does not exist
- `409 Conflict` — event is too recent (materialization hasn't run yet); response body suggests retry after the next cron tick
- `429 Too Many Requests` — more than 60 requests in a minute (`RATE_LIMIT_MAX`, owner ruling 2026-10-01). The bucket is the signed-link token; a request with no bearer token falls back to the caller's address. The refusal carries `Retry-After`, `Cache-Control: no-store`, and no report data. The limit exists because `poster_attribution` is a live join: an unbounded poll would let a link holder watch one poster's floored count tick (OSE-1421). It is applied at the route in `router.ts` through `publicReadLimited` (`lib/public-read-limit.ts`)

**Cache headers:** `Cache-Control: private, max-age=3600` (S5-Q4)

### 2. `POST /api/v2/events/shared-reports/batch`

**Auth (S5-Q1):** Service-account bearer token. In v1, only WKRP holds a token. Validated against an env-var `WKRP_SERVICE_TOKEN` (Doppler secret); token rotation handled via Doppler.

**Request body:**

```json
{
  "ids": ["evt_abc", "evt_def", "..."]
}
```

- `ids` — array of event IDs, length 1–50 (S5-Q3).

**Response (200 OK):**

```json
{
  "reports": {
    "evt_abc": {/* SharedReport object */},
    "evt_def": {/* SharedReport object */}
  },
  "errors": {
    "evt_xyz": { "code": "NOT_FOUND", "message": "event does not exist" }
  }
}
```

Per-ID errors are returned in `errors`; the batch as a whole returns 200 unless the request itself is malformed (400) or auth fails (401).

**Error responses:**

- `400 Bad Request` — `ids` missing, empty, > 50, or contains non-strings
- `401 Unauthorized` — invalid service token
- `429 Too Many Requests` — rate-limit triggered

**Cache headers:** `Cache-Control: no-store` (S5-Q4 — batch consumers are expected to manage their own caches; per-event caching happens at the single-event endpoint).

### SharedReport object schema (both endpoints)

```typescript
interface SharedReport {
  event_id: string;
  event_title: string;
  event_start_date: string; // ISO
  event_end_date: string | null; // ISO

  // 1. Unique gatherings — from scan_aggregates.distinct_agent_hashes
  unique_gatherings: number | null;

  // 2. Return rate — % of distinct anon_id_hashes seen at prior events at same venue/corridor
  return_rate: {
    venue_pct: number | null; // returners seen at THIS venue before
    corridor_pct: number | null; // returners seen at corridor before
    sample_size: number | null; // total distinct anons used as denominator
  };

  // 3. Corridor density — vs. rolling 30d/90d baseline
  corridor_density: {
    this_event_count: number | null;
    baseline_30d: number | null;
    baseline_90d: number | null;
    density_ratio_30d: number | null; // this_event / baseline_30d
    density_ratio_90d: number | null;
  };

  // 4. Sponsor impressions — per sponsor × surface
  sponsor_impressions: Array<{
    sponsor_id: string;
    sponsor_name: string;
    surface: 'public' | 'display' | 'poster' | 'form';
    count: number;
  }>;

  // 5. Poster-scan attribution — per poster × time bucket
  poster_attribution: Array<{
    poster_deployment_id: string;
    location: string; // venue label, not coords
    scan_count: number;
    first_scan_at: string; // ISO, UTC hour bucket
    last_scan_at: string; // ISO, UTC hour bucket
    first_scan_label: string; // OSE-1376 — same bucket in the event's zone, e.g. "Sat, Oct 24 · 7 PM CDT"
    last_scan_label: string;
  }>;

  // 6. Headcount trend — across confirmed event_series instances
  headcount_trend: {
    series_id: string | null; // null if no confirmed series for this event
    series_name: string | null;
    instances: Array<{
      event_id: string;
      start_date: string;
      unique_gatherings: number | null;
    }>;
  };

  _meta: {
    materialized_at: string; // ISO — when Session 3 last ran for this event
    suppression_reasons: Array<{
      // S5-Q5
      field: string; // e.g., "corridor_density.baseline_30d"
      reason: 'below_min_sample_size' | 'no_baseline_yet' | 'no_series' | 'materialization_pending';
      detail?: string; // e.g., "3 of 10 required events at this corridor"
    }>;
    // OSE-1376 — the zone every hour label is rendered in: the event's own IANA
    // zone, or 'America/Chicago' (platform home zone) with source
    // 'platform_default' when the event has none. Present at every depth.
    timezone: { zone: string; source: 'event' | 'platform_default' };
  };
}
```

**Hour labels (OSE-1376):** stored hour buckets stay UTC (`first_scan_at` /
`last_scan_at`, `corridor_density.bucket_hour` as a UTC lookup key). Human labels
are computed server-side in the event's zone (`lib/event-datetime.ts`
`formatHourBucketLabel`) — labels only, never a re-bucketing, so the 60-minute and
K≥5 floors act on the same cells. Half-hour zones label a UTC hour at its real
local start ("6:30 PM GMT+5:30"); the zone abbreviation keeps DST fall-back's
repeated hour distinct and a spring-forward gap is never invented.

---

## Implementation outline

### Router additions (`src/router.ts`)

Two new routes added to the existing router. Per existing pattern:

```typescript
// GET /api/v2/events/:id/shared-report
if (
  method === 'GET' &&
  pathParts[0] === 'api' &&
  pathParts[1] === 'v2' &&
  pathParts[2] === 'events' &&
  pathParts[4] === 'shared-report'
) {
  return handleGetSharedReport(req, env, pathParts[3]);
}

// POST /api/v2/events/shared-reports/batch
if (
  method === 'POST' &&
  pathParts[0] === 'api' &&
  pathParts[1] === 'v2' &&
  pathParts[2] === 'events' &&
  pathParts[3] === 'shared-reports' &&
  pathParts[4] === 'batch'
) {
  return handleBatchSharedReports(req, env);
}
```

### Handler: `src/handlers/shared-report-read.ts`

```typescript
export async function handleGetSharedReport(
  request: Request,
  env: SharedReportReadEnv,
  eventId: string
): Promise<Response>;

export async function handleBatchSharedReports(
  request: Request,
  env: SharedReportReadEnv
): Promise<Response>;
```

Both handlers delegate to a pure builder function:

### Lib: `src/lib/shared-report-builder.ts`

```typescript
export async function buildSharedReport(
  db: D1Database,
  eventId: string
): Promise<SharedReport | { error: 'NOT_FOUND' | 'MATERIALIZATION_PENDING' }>;
```

This is the only place that queries D1 for the report. Single-event handler calls it once; batch handler calls it N times in parallel via `Promise.all` (capped at 50 by S5-Q3).

**Below-minimum suppression (S5-Q5):** the builder reads `CORRIDOR_BASELINE_MIN_SAMPLE` from `src/lib/shared-report.ts` (already exported as `10`). For each computed field, if the underlying sample count is below threshold, the field is set to `null` and a `_meta.suppression_reasons` entry is added.

### Auth: `src/lib/shared-report-auth.ts`

Two functions:

```typescript
// Validates a signed-link bearer token and returns the bound event_id + role.
// Returns null if invalid.
export function verifySignedLinkToken(
  token: string,
  env: AuthEnv
): {
  eventId: string;
  role: 'bar_owner' | 'sponsor' | 'admin';
} | null;

// Validates the WKRP service-account bearer token. Returns true if valid.
export function verifyServiceToken(token: string, env: AuthEnv): boolean;
```

The signed-link verification reuses OSE's existing signed-link mechanism (HMAC + expiry). The service-token verification is a constant-time compare against `env.WKRP_SERVICE_TOKEN`.

### Cache (S5-Q4)

Cloudflare's `cf.cacheTtl` or response `Cache-Control` header. Single-event endpoint sets `private, max-age=3600`. Batch endpoint sets `no-store`. Cache key isolation via `Vary: Authorization`.

---

## Tests

**Unit (`src/lib/shared-report-builder.spec.ts`):**

- Empty event → returns `MATERIALIZATION_PENDING`
- Event with full materialization → returns SharedReport with all six fields
- Event with corridor below min-sample → `corridor_density.*` are null, suppression reason logged
- Event without a confirmed series → `headcount_trend.series_id` is null with `no_series` reason
- Event with confirmed series → `headcount_trend.instances[]` populated

**Integration (`tests/shared-report-read.spec.ts`):**

- `GET` with valid signed-link → 200 + SharedReport
- `GET` with mismatched event_id in token → 403
- `GET` with expired token → 401
- `GET` with no token → 401
- `GET` for nonexistent event → 404
- `POST batch` with 50 valid IDs → 200, all reports present
- `POST batch` with 51 IDs → 400
- `POST batch` with mixed valid/invalid IDs → 200, `reports` and `errors` populated correctly
- `POST batch` with no service token → 401
- `GET` the 61st time in a minute with one token → 429 with `Retry-After`; a second token from the same address is still served (`tests/shared-report-get-rate-limit.spec.ts`)
- Cache header presence per endpoint

**Gate (static-invariant test):**

- `tests/shared-report-pipeline-invariants.spec.ts` adds **Gate 6**: the read API handler must NEVER write to the SharedReport tables (`anon_id_returns`, `corridor_density_baseline`, `event_series`). Read-only invariant enforced by static-source check.

---

## Anonymity invariants

| Invariant                                 | How preserved                                                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No raw `anon_id` in response              | Source tables only hold `anon_id_hash`; response never includes hashes either (they're internal correlation keys, not consumer data).                       |
| No PII leakage via batch endpoint         | Service token gates access. Anonymity invariant doesn't change between single-event and batch — same anon-safe aggregates returned.                         |
| Sponsor-as-viewer can't see attendee data | Same shape as bar-owner-as-viewer. Both see aggregates only.                                                                                                |
| WKRP cannot enrich with identity in OSE   | OSE never sees `performer_id`. WKRP joins identity in its OWN DB after receiving the OSE aggregates. ADR-001 boundary preserved.                            |
| Below-min-sample suppression              | Prevents inference attacks via small denominators. A return rate computed from 1 attendee is effectively identifying; the suppression eliminates this risk. |

---

## Out of scope (explicit non-goals for Session 5)

- **Admin UI** for viewing reports. The UI is built on top of the API; that's a separate story.
- **Email-delivery of reports.** Cron job that emails bars their reports daily — separate, post-launch.
- **CSV/PDF export.** API returns JSON; format conversion is a frontend / downstream consumer concern.
- **Cross-event analytics** (e.g., "show me reports for all my events"). Bar admin UI iterates over `GET` calls; WKRP uses the batch endpoint.
- **Sponsor-attribution detail beyond impression counts.** Detail per impression (which scan, what surface variant) is BigQuery-only.
- **Real-time freshness.** Reports update daily via Session 3 cron. No live updates.
- **Rate-limit tuning per consumer.** Existing platform rate-limit middleware applies; per-token quotas are a Phase 2 concern.

---

## Session 5 PR scope (what lands)

```
workers/oursharedevents/src/lib/shared-report-builder.ts                  — NEW (pure builder)
workers/oursharedevents/src/lib/shared-report-auth.ts                     — NEW (signed-link + service-token verification)
workers/oursharedevents/src/handlers/shared-report-read.ts                — NEW (single + batch handlers)
workers/oursharedevents/src/router.ts                                     — 2 new routes wired
workers/oursharedevents/tests/shared-report-builder.spec.ts               — NEW (unit)
workers/oursharedevents/tests/shared-report-read.spec.ts                  — NEW (integration)
workers/oursharedevents/tests/shared-report-pipeline-invariants.spec.ts   — Gate 6 added
docs/features/SHARED-REPORT-READ-API.md                                   — THIS DOC
docs/adr/ADR-011-shared-report-wkrp-consumer-boundary.md                  — NEW (see below)
```

**Estimated diff:** ~800 LOC code + ~600 LOC tests + this design doc + the ADR.

---

## Companion ADR (lands in same PR as implementation)

**ADR-011 — SharedReport read API as the WKRP consumer boundary**

The decision to ship a batch endpoint is architecturally consequential and meets the OSE ADR criteria (≥ 2 of: real alternative rejected, ≥6mo consequence, non-obvious from code, touches multiple surfaces, creates/modifies invariant). Specifically:

- **Real alternative rejected**: WKRP could have been given direct D1 read access via a Cloudflare binding. Rejected: that would couple WKRP to OSE's schema; the API boundary insulates schema evolution.
- **≥6-month consequence**: every future fleet consumer (OurAirwaves, OSM whitelabel, OurEventRings analytics fabric) follows this same boundary pattern.
- **Non-obvious from code**: the "WKRP doesn't see performers because the API was designed to never need them" insight needs an ADR to capture.
- **Touches multiple surfaces**: schema, handler, ADR-001 boundary, anonymity invariant, batch contract.
- **Creates a CI-enforced invariant**: Gate 6 (read-only API).

The ADR will document the alternatives, the chosen consumer-boundary shape, and the consequences for future OCR products integrating with OSE.

---

## Hand-off to G1 build (post-Session 5)

The `/status-rollup` skill spec (PR #38, ratified 2026-05-15) names SharedReport signal as one of its inputs. Once this Session 5 read API is on `main`, the skill build phase begins — it calls `POST /api/v2/events/shared-reports/batch` with the active venue event IDs and rolls up aggregate signal into the weekly fleet `STATUS.md`.

This is the **closing loop**: Session 3 materializes, Session 4 exports for analytics, Session 5 surfaces for product + fleet skill consumption. After Session 5 ships, the routing matrix has a working example end-to-end.

---

## Ratification needed (5 questions)

S5-Q1 — Auth model (signed link + service token)?
S5-Q2 — Full SharedReport object per call?
S5-Q3 — Batch max 50 IDs?
S5-Q4 — Cache: 1h on single, no-store on batch?
S5-Q5 — Below-min-sample handling: null + `_meta.suppression_reasons[]`?

Shortest valid ratification: `"S5: all 5 yes."` plus any corrections inline.
