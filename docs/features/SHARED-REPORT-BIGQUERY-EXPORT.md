# SharedReport BigQuery Export — Design

**Status:** **Design ratified** (Session 4 of OSE-272; Session 3 = PR #187 in user's merge queue)
**Date:** 2026-05-15
**Authors:** mzdan + Co-Architect
**Closes design phase of:** OSE-272 Session 4 (BigQuery export)
**Unblocks:** OSE-272 Session 5 (read API + WKRP batch endpoint)
**Routing:** per `OCR-docs/OPERATING_SYSTEM.md §3` — per-repo feature design → `<repo>/docs/features/`

---

## Purpose

Session 3 (PR #187) shipped the cron materialization of the three SharedReport primitives:

- `anon_id_returns` — per-(anon_hash, venue) return tracking
- `corridor_density_baseline` — rolling 30d/90d distinct-hash counts per (corridor, dow, hour)
- `event_series` — recurring-event lifecycle (pending/confirmed/rejected, Q2 hybrid)

Session 4 ships the daily export of those aggregates into BigQuery so downstream analytics (dashboards, partner data feeds, OurEventRing data fabric, future WKRP performer-attribution joins) can consume them at fleet scale.

**Architectural commitment that gates everything below:** the export is **mechanical** — it streams already-aggregated, already-anonymized rows. No raw `anon_id`, no per-attendee data, no cross-DB join ever touches the BQ pipeline. Anonymity invariant (ADR-001) is preserved by construction because the source tables are already anonymity-clean.

---

## Ratified design decisions (2026-05-15)

| Q         | Decision                                               | Rationale                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S4-Q1** | **Same cron tick as materialization**                  | Materialize → export → done atomically per tick. If export fails, next tick retries. Simpler ops; one schedule to monitor.                                                                                            |
| **S4-Q2** | **Incremental export with state tracking**             | Per-table `last_exported_at` watermark in a `bigquery_export_state` table. Each tick exports rows whose `computed_at > last_exported_at`. Cheap at scale; idempotent on retry.                                        |
| **S4-Q3** | **Split by regulatory pool**                           | Each event's `legal_clearance_tier` (Phase 1-5) maps to a regulatory pool (`general` / `hipaa` / `coppa`). Aggregate rows route to the BQ dataset for that pool. Mirrors the existing pool-contract pattern.          |
| **S4-Q4** | **Failure-isolated; no block on next materialization** | Each per-table export wrapped in try/catch. Failure logs + sets `last_export_status = 'failed'` in state row. Next tick retries cleanly. Materialization phases (Session 3) always run, regardless of export outcome. |

---

## Inventory — what already exists

### `src/cloud/bigquery.ts` (BigQuery client)

- `bigQueryInsertRows(env, tableId, rows)` — streams up to 500 rows per batch via insertAll. WebCrypto + fetch only; Workers-native.
- `isBigQueryConfigured(env)` — checks WIF + project ID + dataset ID set.
- `bigQueryRunQuery(env, query)` — for future read-side use (irrelevant to Session 4).

### `src/handlers/bigquery.ts` (existing scheduled export)

- `runBigQueryBackup(env)` — daily backup of events updated in last 24h. Writes to `events_backup` table.
- Called from `scheduled()` in `index.ts` alongside Session 3's `runSharedReportMaterialization`.

### `src/lib/pool-contract.ts` (regulatory pool routing)

- `REGULATORY_POOLS = ['general', 'hipaa', 'coppa']`
- `BIGQUERY_DATASETS: Record<RegulatoryPool, string>` — maps pool to dataset name (`oureventring_general` / `_hipaa` / `_coppa`)
- `datasetForPool(pool)` — returns dataset name; throws on unknown pool.
- `REQUIRED_TAGS` — every BQ write must carry: `corridor_id`, `venue_id`, `event_type`, `uec_code`, `regulatory_pool`, `product_id`.
- `assertRequiredTags(tags)` — guards every write at pipeline entry.

### Regulatory schema (migration 0023)

- `events.legal_clearance_tier` — INTEGER 1-5, mirrors phase ceiling.
- `corridor_regulatory_status` — phase unlocked per corridor.
- `event_type_registry` — UEC code + phase per event type.

---

## What's missing (Session 4 net-new)

### Migration 0035 — `bigquery_export_state` table

Tracks watermark + status per exportable D1 table. Single source of truth for "what have we exported, and how recently."

```sql
CREATE TABLE IF NOT EXISTS bigquery_export_state (
  table_name              TEXT PRIMARY KEY,           -- 'anon_id_returns', 'corridor_density_baseline', 'event_series'
  last_exported_at        TEXT NOT NULL,              -- watermark — rows with computed_at > this get exported next
  last_export_status      TEXT NOT NULL DEFAULT 'success'
                          CHECK (last_export_status IN ('success', 'failed', 'pending')),
  rows_exported_lifetime  INTEGER NOT NULL DEFAULT 0, -- cumulative count for ops observability
  last_run_at             TEXT NOT NULL DEFAULT (datetime('now')),
  last_error              TEXT,                       -- populated on failure; cleared on success
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- PK is `table_name` (one row per table). PK protects against double-inserts.
- `last_exported_at` is the watermark queried by the export step: `WHERE computed_at > ?`.
- On first run for a table, no state row exists → INSERT with `last_exported_at = '1970-01-01T00:00:00Z'` (epoch) so the first export sweeps everything.
- `last_export_status` — `'pending'` while a tick is running, `'success'` or `'failed'` after.

### Helper: `phaseToPool(phase)` in `src/lib/pool-contract.ts`

> **Superseded (OSE-1220 / OSE-380).** HIPAA and COPPA are declined regimes. `phaseToPool`
> now maps tiers 1-3 and null/undefined to `general` and **throws** for 4, 5 or any value it
> cannot classify; there is no `hipaa` or `coppa` dataset to route to. The original design
> sketch is kept below for history only.

Original design (no longer the code):

```typescript
export function phaseToPool(phase: number): RegulatoryPool {
  if (phase >= 5) return 'coppa';
  if (phase >= 4) return 'hipaa';
  return 'general';
}
```

This codifies the mapping that until now lived only in the regulatory_schema migration comments. Brain conformance verifies the mapping appears in repo code.

### Lib: `src/lib/shared-report-export.ts` (pure functions, mirrors `shared-report.ts`)

Three pure functions, one per source table, each returning the same shape as Session 3's materialization results so observability stays uniform:

```typescript
export interface SharedReportExportEnv {
  DB: D1Database;
  // BigQuery env: WIF + project + dataset overrides
  WIF_PRIVATE_KEY_PEM?: string;
  WIF_POOL_ID?: string;
  WIF_PROVIDER_ID?: string;
  GCP_PROJECT_NUMBER?: string;
  GCP_PROJECT_ID?: string;
  BIGQUERY_DATASET_ID?: string;
}

export interface ExportResult {
  phase: string;
  rowsRead: number;
  rowsExported: number;
  rowsSkipped: number;
  errors: number;
  perPool: Record<'general' | 'hipaa' | 'coppa', number>;
  durationMs: number;
}

export async function exportAnonIdReturns(env): Promise<ExportResult>;
export async function exportCorridorDensityBaseline(env): Promise<ExportResult>;
export async function exportEventSeries(env): Promise<ExportResult>;
```

### Handler: `src/handlers/shared-report-export.ts` (cron orchestrator)

```typescript
export async function runSharedReportBigQueryExport(env): Promise<{
  ok: boolean;
  phases: ExportResult[];
  totalRowsExported: number;
  totalErrors: number;
  totalDurationMs: number;
}>;
```

Calls the three exporters in sequence. Failure isolation per phase (S4-Q4). Logs `SHARED_REPORT_EXPORT_COMPLETE`.

### `scheduled()` wiring (`index.ts`)

`scheduled()` runs `runSharedReportPipeline(env)`: materialization, **then** `runSharedReportBigQueryExport(env)`, in the same tick (S4-Q1). The order matters (OSE-616). A baseline refresh stamps every row with one `computed_at` and writes them one by one, and the export's watermark is that timestamp alone. An export running beside the refresh could ship part of a group and advance past the rest for good. The export still runs (in a `finally`) when materialization throws. Gate: `shared-report-pipeline-invariants.spec.ts`.

---

## Per-table export procedure (detailed)

### `anon_id_returns` export → corridor return counts (OSE-1460)

**Changed 2026-10-01 (OSE-1460, PO decision).** This phase used to send one row per
`(anon_id_hash, venue_id)` with first/last seen and a visit count. That is a
pseudonymous, per-person record, and it crossed the OER boundary, which allows
aggregates only, never `anon_id`, and corridor-level location only
(`OCR-docs/docs/architecture/OCR_ARCHITECTURE_oerAggregationBoundary.md`). It now
sends **counts**: no per-person row, no `anon_id_hash` and no venue leave the Worker.

**When:** once a week. The export runs on the nightly cron (`0 3 * * *` in
`wrangler.toml`), but a returns snapshot is taken only when one is due (see
"Rounding and cadence" below). Each due run snapshots events whose day
(`end_date`, else
`start_date`) falls in the last `RETURNS_WINDOW_DAYS` (90), up to and including today (an event rescheduled into the future is not counted), even when no source
row is past the watermark, because a rolling window changes as events age out.
The window is the event's day, not `last_seen_at`, which is when the cron
materialized the row (hours after the event, later again on a re-run).
Only rows hashed under the current `ANON_ID_HASH_PEPPER` count (`pepper_epoch`,
migration 0091): after a rotation the same browser has a second hash, so mixing
peppers could count three people as six and lift them over the floor. A rotation
resets the return counts; with no pepper configured, every group is empty. The watermark then records the newest source row seen. Each run
is its own snapshot, identified by its full `computed_at` timestamp; retries
inside one run reuse it, so their insertIds dedupe.

**Reading it:** every run writes one **snapshot marker** row per pool, with
`row_type = 'snapshot'`, `corridor_id = 'unknown'` and `groups_in_snapshot` set
to the number of groups. Data rows have `row_type = 'group'`. The current
snapshot is the latest marker's `computed_at`. Read the `group` rows with that
`computed_at`; there may be none. A group missing from it has aged out of the
window or fallen under the floor. Without the marker, a run in which every group
disappeared would write nothing, and the previous snapshot would look current.
Markers are not counted as exported rows. Runs are also recorded in the D1
`export_manifest`, but OER cannot see that table, so the marker is what OER uses.

**Grouping:** a person is counted once per (corridor, event type, pool). A return
means they were seen at 2 or more distinct events there. `visit_count` is not
used, because the materializer bumps it on every re-run. Tiers that share a pool
(NULL and 1–3 are `general`) are one group before the floor applies
(`RETURNS_POOL_KEY_SQL`). A declined regime is withheld (OSE-1220).

**Floor:** a group with fewer than `RETURNS_MIN_COUNT` people (5, the same
floor as `CORRIDOR_MAP_MIN_COUNT`) is not exported. Inside an exported group,
the counts are nested (`people_count` ⊇ `returned_2plus` ⊇ `returned_3plus` ⊇
`returned_5plus`) and are floored as one chain (`floorNestedCounts`,
`lib/count-floor.ts`): a count is sent only if it is at least 5 **and** it is
equal to, or at least 5 below, the last count sent before it. Otherwise it is
`null`, meaning suppressed. Without the second rule, `people_count` 12 and
`returned_2plus` 9 would tell a reader that 3 people came once. A group with
no real res7 corridor is withheld, never sent as `'unknown'`.

**Rounding and cadence (PO decision 2026-10-01):** a snapshot is compared
with the one before it, so exact counts would show a one-person change between
two runs (12, then 13). Every published count is rounded down to a multiple of
5 (`roundForPublish`, `PUBLISH_ROUNDING`) before the floors apply, and the
returns snapshot is taken weekly, not nightly: a run takes one only when both
the last complete snapshot (`bigquery_export_state` row
`corridor_returns_snapshot`) and the last run that began publishing (row
`corridor_returns_snapshot_claim`) are at least 6.5 days old. The claim is
written just before a run's first BigQuery insert, as a compare-and-set on the
value the due check read, so of two overlapping runs only one publishes. A run
that fails after
that point, or whose final state write fails, still uses up its week: some of
its rows may already be in BigQuery, and a retry the next night would put a
second snapshot one day after the first. A run that fails before it sends
anything (a D1 read error) writes no claim and is retried the next night. A run
that is not due sends nothing and moves no watermark. Rounding leaves every gap between published counts at 0 or a
multiple of 5, so the chain rule above can no longer be broken by rounded
values. The corridor baseline export is rounded the same way, but still follows
the baseline refresh cadence; making it weekly is a follow-up.

**Paging:** the grouped query is read 500 groups at a time
(`RETURNS_PAGE_SIZE`), keyed by (corridor, pool, type), and each page is
sent as it arrives, so the snapshot is never held whole in D1's result or
the Worker. The marker is written last; a run that stops part-way writes no
marker, so OER keeps reading the previous complete snapshot. A snapshot over
`RETURNS_MAX_PAGES` (200) pages fails closed.

**BQ row shape:**

```json
{
  "corridor_id": "the event's lowercase res7-or-coarser H3 cell",
  "venue_id": "corridor-aggregate",
  "event_type": "etr.uec_code or 'unknown'",
  "uec_code": "etr.uec_code or 'unknown'",
  "regulatory_pool": "general",
  "product_id": "ose",
  "window_days": 90,
  "people_count": 42,
  "returned_2plus": 17,
  "returned_3plus": 6,
  "returned_5plus": null,
  "row_type": "group",
  "computed_at": "the run's snapshot timestamp, ISO (full precision)",
  "exported_at": "ISO (now)"
}
```

`venue_id` carries the `'corridor-aggregate'` sentinel, as the corridor baseline
does, so the required-tag contract (`REQUIRED_TAGS`, brain `product-registry.yaml`)
is unchanged. `assertRequiredTags()` runs on each row before send.

**Grain you can query in OER:** one corridor × event type × pool, a 90-day
rolling window, with at most one new snapshot a week. You cannot see
individual journeys or venues, or anyone's movement between corridors.

**Corridor id for returns (OSE-1460).** A returns group with no real res7
corridor is **withheld**, never exported as `'unknown'`. Only the snapshot
marker carries `corridor_id = 'unknown'`. The paragraph below describes the
shared rule the other phases follow.

**Corridor id (ADR-011, OSE-616).** The corridor is the res7 H3 node. The
exported `corridor_id` is the event's `h3_res7`; a legacy non-H3
`events.corridor_id` (or none at all) exports as the explicit `'unknown'`
(`canonicalCorridorId` in `src/lib/export-geography.ts`). Every row then passes
`assertCorridorGrainRow`: a sub-corridor column (res9, coordinate, address,
placement reference), any H3 value finer than res7, or a `corridor_id` that is
neither a valid res7-or-coarser cell nor `'unknown'` **throws**, and the phase
fails closed (watermark held). Rows are rejected, never trimmed and shipped. The
event-backup route (`handlers/bigquery.ts`) applies the same two rules.

**BQ table:** `corridor_returns_export` in the pool's dataset (it replaces `anon_id_returns_export`, which was never created in any environment: BigQuery read 2026-10-01).

### `corridor_density_baseline` export

**Source:** `corridor_density_baseline` (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)

**Floor:** both windows count distinct people. Each is sent only at or above
`CORRIDOR_BASELINE_MIN_SAMPLE` (10), the rule the SharedReport read path uses,
and the pair is floored as a chain (90d ⊇ 30d): the 30-day count is `null`
when it sits 1–4 below the 90-day count, so `90d − 30d` never names fewer than
5 people. A row with both windows `null` is withheld.

**Routing:** Baselines are cross-event aggregates. **Default to `general` pool** for v1 — these are corridor-level density signals that don't encode per-attendee state. If a corridor's events span multiple pools, the baseline is intentionally less-precise on routing (it's a baseline; it summarizes mixed traffic). This is a deliberate v1 simplification documented for revisit if a HIPAA/COPPA corridor surfaces a routing issue.

**Query:**

```sql
SELECT
  cdb.corridor_id, cdb.bucket_dow, cdb.bucket_hour,
  cdb.window_30d_count, cdb.window_90d_count, cdb.computed_at
FROM corridor_density_baseline cdb
WHERE cdb.computed_at > ?
ORDER BY cdb.computed_at ASC
LIMIT 500;
```

**BQ row shape:**

```json
{
  "corridor_id": "the lowercase H3 cell (res7 or coarser) the baseline is keyed by — never 'unknown' (non-H3 keys are withheld)",
  "bucket_dow": 4,
  "bucket_hour": 19,
  "window_30d_count": 42,
  "window_90d_count": 119,
  "computed_at": "ISO",
  "venue_id": "(baseline level — not venue-specific)",
  "event_type": "(corridor aggregate — multiple types)",
  "uec_code": "(corridor aggregate)",
  "regulatory_pool": "general",
  "product_id": "ose",
  "exported_at": "ISO"
}
```

A baseline row whose key is not H3-shaped (a legacy named `corridors.id`) is
**withheld** (counted in `rowsSkipped`, reported as `rows_withheld` in the
manifest), not exported as `'unknown'`. It is not a corridor baseline under
ADR-011, and several such rows in one bucket would share an insertId and be
silently deduplicated by BigQuery.

H3 is case-insensitive but the baseline key is not, so `refreshCorridorBaselines`
groups by the **lowercased** res7 cell and deletes any baseline row stored under
another spelling of an H3 cell. If two rows in one export batch still map to the
same insertId, the phase fails closed (no watermark advance) rather than letting
BigQuery drop one while the phase counts both. The reconciliation deletes a key
only when `isValidCell` proves it is a real H3 cell; a legacy key that merely
looks H3-shaped is left for the export to withhold.

**Whole timestamp groups.** One refresh stamps every baseline row with the same
`computed_at`, and the watermark is that timestamp alone. So the baseline export
reads at least 200 rows **extended to the end of the last `computed_at` group it
reaches**, never a cut group, and inserts in chunks of 500. A plain `LIMIT`
would advance the watermark past the unread rest of a group, so those rows
would never be exported.

**Unreadable responses.** An insertAll response body that is not valid JSON
fails the insert (`INSERT_FAILED`): a 200 that BigQuery's result cannot be read
from has not confirmed anything.

For aggregate rows where individual `venue_id` / `event_type` doesn't apply, the required-tag values are sentinel strings (`"corridor-aggregate"`). `assertRequiredTags` checks presence + non-empty, so sentinels pass — and the data is honest about being an aggregate.

**BQ table:** `corridor_density_baseline_export` in the `oureventring_general` dataset.

### `event_series` export

**Source:** `event_series` (id, venue_id, series_name, day_of_week, hour_of_day, state, detected_at, confirmed_at, ...)

**Routing:** Only export `state = 'confirmed'` rows. `pending` and `rejected` rows are internal-to-OSE governance; the analytics layer only cares about confirmed recurrences. Route by the anchor `venue_id`'s event's pool, same lookup as `anon_id_returns`.

**Query:**

```sql
SELECT
  es.id, es.venue_id, es.series_name, es.cadence,
  es.day_of_week, es.hour_of_day, es.state, es.confirmed_at, es.updated_at,
  e.legal_clearance_tier, COALESCE(e.h3_res7, e.corridor_id) AS corridor_id, e.event_type_id,
  etr.uec_code
FROM event_series es
JOIN events e ON e.id = es.venue_id
LEFT JOIN event_type_registry etr ON etr.id = e.event_type_id
WHERE es.state = 'confirmed'
  AND es.updated_at > ?
ORDER BY es.updated_at ASC
LIMIT 500;
```

**BQ table:** `event_series_export` in the pool's dataset.

---

## Failure isolation pattern (S4-Q4)

Each per-table export is wrapped:

```typescript
try {
  await exportTable(env, 'anon_id_returns');
  await updateState('anon_id_returns', { last_export_status: 'success', last_error: null });
} catch (err) {
  await updateState('anon_id_returns', { last_export_status: 'failed', last_error: errMsg });
  // Continue to next table — failure does NOT abort siblings.
}
```

The watermark advances only after the **whole batch** is accepted (for the baseline phase, the whole `computed_at` group). If an insert fails partway:

- Rows BigQuery already accepted stay there.
- The watermark is NOT advanced past the failed batch.
- For the baseline and event-series phases, the next tick retries from the
  watermark. The returns snapshot does not: once a run has claimed its week
  (see "Rounding and cadence"), a failure waits for the next week's snapshot
  rather than retrying the next night, so a partial snapshot is never followed
  a day later by a second one. insertIds are content-derived (for returns: `cr-${computed_at}-${corridor_id}-${uec_code}-${pool}`; no person or event id is in any key), but BigQuery's `insertId` de-duplication is **best-effort, for roughly a minute**, so a retry on a later tick can land duplicate rows.

Delivery guarantee: **at-least-once** for the baseline and event-series phases.
For returns, each weekly snapshot is all-or-nothing from OER's point of view: a
snapshot without its marker row is incomplete and must be ignored, and it is
not retried. No row is skipped (the watermark only advances after every row of the batch is accepted), but a retried row may appear twice in BigQuery. Readers (OER) must dedupe on each table's natural key — `corridor_density_baseline_export`: `(corridor_id, bucket_dow, bucket_hour, computed_at)`; `corridor_returns_export`: `(corridor_id, uec_code, regulatory_pool, computed_at)`; `event_series_export`: `(id, updated_at)`; `events_backup`: `(id, updated_at)`. Exactly-once delivery (staging table + MERGE, or the Storage Write API with offsets) is tracked separately (OSE-1462).

**Rows BigQuery rejects inside an HTTP 200.** `tabledata.insertAll` reports
per-row rejections in `insertErrors` with a 200 status. `bigQueryInsertRowsToDataset`
treats any `insertErrors` as a failed insert (`BigQueryError INSERT_FAILED`,
"rejected N/M rows"), so the phase is marked failed, nothing is counted or
manifested as exported, and the watermark does not advance (OSE-616).

---

## Tests

Every line below names a test in `workers/oursharedevents/tests/shared-report-bigquery-export.spec.ts`.

**Unit (no BQ; mocked client):**

- Phase-to-pool mapping: phases 1-3 → general; null/undefined → general (the Phase-1 default); tiers 4 (HIPAA) and 5 (COPPA) are **refused**, never routed (OSE-1220); an unrecognized phase fails closed (OSE-380)
- Required-tag assertion (every exported row carries all 6 required tags)
- Graceful no-op when BigQuery is not configured

**Integration (vitest-pool-workers, D1 + mocked BQ):**

- Returns phase: one k-floored count row per corridor × event type × pool, with no person or venue in it; no two published counts subtract to a group under the floor; a group under the floor is withheld; a group with no real corridor is withheld; events before the 90-day window are not counted, even when materialized recently
- Every run writes one snapshot marker per pool, even with no groups, so an empty run is distinguishable from a missing run
- More than 500 groups go in chunks of at most 500
- Watermark advances to the newest source row on success and is **not** advanced when BigQuery rejects the insert (S4-Q4)
- A tier-4 group is quarantined, never routed or leaked
- On staging the export lands in `oureventring_general_stg`, never the production dataset (OSE-1416)
- Orchestrator: a failure in one phase does not abort the others

**Gate (static-invariant test):**

- `tests/shared-report-pipeline-invariants.spec.ts` adds **Gate 5**: the export library + handler must NOT be reachable from any user-facing route. Same pattern as Session 3's Gate 4 — `runSharedReportBigQueryExport` is referenced only from `index.ts scheduled()`, never from `router.ts`.

---

## Anonymity invariants (preserved by construction)

| Invariant                            | How it's preserved in Session 4                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| No `anon_id` or `anon_id_hash` to BQ | Since OSE-1460 the returns phase sends only k-floored corridor counts; the hash is used inside the Worker to count people and never leaves. |
| No cross-DB join with FORMS_DB       | Export library reads main DB only (Gate 1 carries over from Session 3).                                                                     |
| No user-facing surface               | Cron-only by static-source gate (Gate 5, new).                                                                                              |
| No re-hashing                        | Session 4 never re-hashes; the returns phase counts hashed ids in SQL and exports counts only.                                              |
| Pool isolation                       | `assertRequiredTags` + `phaseToPool` guarantee no HIPAA event's aggregate row lands in the general dataset.                                 |

---

## Out of scope (explicit non-goals for Session 4)

- **Read API for the BQ exports.** Session 5 ships the read API (`GET /api/v2/events/:id/shared-report` + WKRP batch). Session 4 is write-only.
- **WKRP batch endpoint.** Session 5 (ratified).
- **Historical backfill of pre-Session-3 data.** First export pass uses the epoch watermark — picks up everything in D1 at the time. No special backfill needed.
- **BQ table creation.** `tabledata.insertAll` fails when the table is missing; BigQuery never creates it on first insert. All four pool tables (`events_backup`, `corridor_returns_export`, `corridor_density_baseline_export`, `event_series_export`) have a checked-in schema at `workers/oursharedevents/bigquery/<table>.schema.json`, kept in step with the code by the export specs (`tests/helpers/bigquery-pool-schema.ts`), and are created by `scripts/bq-create-pool-tables.sh` (runbook: `docs/runbooks/RUNBOOK-DEPLOYMENT.md`, OSE-1416). Staging's tables exist since 2026-10-02; production's dataset does not exist yet.
- **Cross-pool baseline routing.** Corridor baselines default to `general` in v1. Documented for revisit if a HIPAA/COPPA corridor surfaces a need.
- **Sponsor impression export.** Sponsor impressions are already exported via the existing `runBigQueryBackup`. No change in Session 4.
- **Real-time export.** Cron-only, daily. No real-time streaming.

---

## Session 4 PR scope (what lands)

```
workers/oursharedevents/migrations/0035_create_bigquery_export_state.sql       — NEW
workers/oursharedevents/src/lib/pool-contract.ts                                — phaseToPool() helper added
workers/oursharedevents/src/lib/shared-report-export.ts                         — NEW (3 exporters)
workers/oursharedevents/src/handlers/shared-report-export.ts                    — NEW (orchestrator)
workers/oursharedevents/src/index.ts                                            — add to scheduled() Promise.all
workers/oursharedevents/tests/shared-report-export.spec.ts                      — NEW (unit + integration)
workers/oursharedevents/tests/shared-report-pipeline-invariants.spec.ts         — Gate 5 added
docs/features/SHARED-REPORT-BIGQUERY-EXPORT.md                                  — THIS DOC
```

**Estimated diff:** ~600 LOC code + ~400 LOC tests + this design doc.

---

## Session 4 → Session 5 hand-off

Session 5 (read API + WKRP batch) reads from **D1 directly**, not BigQuery. The BQ pipeline is for downstream consumers (dashboards, OurEventRing fabric, future cross-product joins). Bars/sponsors querying their own SharedReport via the OSE read API hit D1 because:

- Latency: D1 read in the same Worker is <10ms; BQ query is 1-5s.
- Cost: BQ queries cost per-byte-scanned; D1 reads are free.
- Freshness: D1 has the most recent materialization tick; BQ has the most recent EXPORTED tick (1-tick lag).

BigQuery is the **analytics surface**, not the **product read surface**. Session 5's WKRP batch endpoint also reads D1 — WKRP is an in-fleet consumer, not a third-party data warehouse query.

---

## Ratification status

**Design ratified 2026-05-15** via consolidation ack:

> _"S4-Q1 same tick. S4-Q2 incremental. S4-Q3 split by reg pool. S4-Q4 no, isolated. WKRP batch endpoint: yes."_

Implementation PR follows after PR #187 (Session 3) is merged to `main`. Session 4 references the Session 3 tables; merging Session 3 first preserves a clean dependency chain.
