# SharedReport Data Pipeline — Design

**Status:** **Design ratified** (Session 1 of OSE-272 complete; Session 2 unblocked)
**Date:** 2026-05-14 (drafted), **2026-05-15 (ratified)**
**Authors:** mzdan + Co-Architect
**Closes design phase of:** OSE-272 (data pipeline)
**Unblocks:** OSE-245 (post-event rendering), OSE-178 (SPON-5 sponsor analytics pane), OSE-246 (sponsor impression logging extension)

---

## Purpose

The SharedReport is the **product SKU** OSE sells per BEACHHEAD-ICP — the data deliverable bars receive at the close of every event. It contains six data fields enumerated in the BEACHHEAD-ICP doc:

1. **Unique gatherings** — anonymized count of distinct anon-IDs in the event window
2. **Return rate** — % of anon-IDs seen at prior events at this venue or corridor
3. **Corridor density** — how busy the venue was vs. the 2-mile corridor baseline
4. **Sponsor-rotation impressions** — per-sponsor × surface impression counts
5. **Poster-scan attribution** — which venue / placement / time generated which scans
6. **Headcount trend** — recurring event series instance-over-instance pattern

This document captures the data pipeline that produces those fields: what exists, what's missing, what gets added, where it lives, and the anonymity invariants that gate every step.

**The architectural commitment that gates everything below:** no data primitive in this pipeline ever resolves an anon_id to attendee identity. Aggregates are computed FROM anon_ids but never expose them; all retention is governed by the hourly time bucket + anonymous-id contract (ADR-001). Since OSE-1460 only k-floored corridor counts of returns are exported to OER, never a per-person row.

---

## Inventory — what already exists

Two relevant primitives are already shipped:

### `scan_aggregates` (migration 0006)

```sql
CREATE TABLE scan_aggregates (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  bucket_date     TEXT NOT NULL,
  bucket_hour     INTEGER,
  total_scans     INTEGER NOT NULL DEFAULT 0,
  distinct_agent_hashes   INTEGER NOT NULL DEFAULT 0,
  top_country     TEXT,   -- always NULL since OSE-1460 (0089 cleared it)
  top_region      TEXT,   -- never written
  computed_at     TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);
```

**Role in SharedReport:** Provides **(1) unique gatherings** for an event when filtered to its `bucket_date` window. `distinct_agent_hashes` = distinct anon_id count in the bucket. ✅ already aligned with the SharedReport spec.

**Critical note:** the comment in 0006 says _"WRITTEN BY SCHEDULED WORKER ONLY — never by user-facing endpoints."_ That discipline is preserved. The new pipeline below builds on this — no real-time aggregation, all materialization is cron-driven.

### `sponsor_impressions` (migration 0022)

```sql
CREATE TABLE sponsor_impressions (
  id         TEXT PRIMARY KEY,
  sponsor_id TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  surface    TEXT NOT NULL,     -- 'public' | 'display' | 'poster' | 'form'
  placement  TEXT NOT NULL,     -- placement slot within the surface
  event_type TEXT NOT NULL DEFAULT 'impression',  -- 'impression' | 'click'
  created_at TEXT NOT NULL,
  FOREIGN KEY (sponsor_id) REFERENCES sponsors(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
```

**Role in SharedReport:** Provides **(4) sponsor-rotation impressions** directly. Aggregation = `COUNT(*) GROUP BY sponsor_id, surface, placement, event_type`. ✅ already aligned.

**Gap:** OSE-246 (BE-30 Sponsor Ops impression logging) is filed but not shipped — the table exists; the _writes_ into it across all three lifecycle phases haven't been wired comprehensively. That's a sibling story to this design.

---

## Inventory — what's missing

Three new schema concepts are needed to complete the SharedReport pipeline:

### 1. `anon_id_returns` — return rate aggregate

**For SharedReport field:** Return rate (% anon-IDs seen at prior events here)

Current platform: scans go into `scan_aggregates` as a count, but there's no per-anon-id history that lets us compute "this anon_id was seen at event A 3 months ago AND now at event B today."

**Proposed:**

```sql
CREATE TABLE anon_id_returns (
  -- Composite key: a single row per (anon_id, venue, day-bucket)
  -- This is purely AGGREGATE — never queried for individual anon_ids
  -- in user-facing endpoints. Cron-materialized only.
  anon_id_hash    TEXT NOT NULL,    -- HASH(anon_id, pepper) — NEVER raw anon_id
  venue_id        TEXT NOT NULL,    -- which venue / event-series root
  first_seen_at   TEXT NOT NULL,    -- ISO timestamp of the materializer run (full precision, not bucketed)
  last_seen_at    TEXT NOT NULL,    -- ISO timestamp of the materializer run (full precision, not bucketed)
  visit_count     INTEGER NOT NULL DEFAULT 1,
  computed_at     TEXT NOT NULL,
  PRIMARY KEY (anon_id_hash, venue_id),
  FOREIGN KEY (venue_id) REFERENCES events(id)  -- venue_id = event.id of first event at venue
);
```

**Anonymity invariants:**

- `anon_id_hash` is `SHA-256(anon_id || pepper)` — the same pattern as `ip_hash` in subscribers (OSE-207). **Raw anon_id is never persisted in this table.**
- The hash is one-way: knowing the hash doesn't let an attacker derive the anon_id without the pepper.
- A different pepper rotation than IP hashing — anon_id hash compromise must not derive subscriber IP hashes or vice versa.
- Static gate: this table MUST NOT be JOINed to FORMS_DB (architectural isolation per ADR-001).
- The table is read at SharedReport materialization time only — never exposed to user-facing endpoints.

**Materialization:**

- Cron worker reads scan telemetry events (OSE-218) by venue, hashes anon_id with pepper, upserts the row.
- Return rate at SharedReport time = `COUNT(anon_id_hash) WHERE venue_id = ? AND visit_count > 1 / COUNT(anon_id_hash) WHERE venue_id = ?`.

### 2. `corridor_density_baseline` — 2-mile corridor rolling aggregate

**For SharedReport field:** Corridor density vs. baseline

Current platform: events have a `corridor_id` column (migration 0029 events_5w_and_corridor), but no precomputed baseline for "what's the typical density for this corridor at this time of week."

**Proposed:**

```sql
CREATE TABLE corridor_density_baseline (
  corridor_id      TEXT NOT NULL,        -- 2-mile geo bucket
  bucket_dow       INTEGER NOT NULL,     -- 0-6 day of week
  bucket_hour      INTEGER NOT NULL,     -- 0-23 hour of day
  window_30d_count INTEGER NOT NULL,     -- rolling 30-day distinct anon_id count
  window_90d_count INTEGER NOT NULL,     -- rolling 90-day distinct anon_id count
  computed_at      TEXT NOT NULL,
  PRIMARY KEY (corridor_id, bucket_dow, bucket_hour)
);
```

**Anonymity invariants:**

- Same as `anon_id_returns` — aggregates only, no PII, no FORMS_DB joins.
- Indexes on `(corridor_id, bucket_dow, bucket_hour)` for fast lookup at SharedReport time.
- Materialization runs nightly. Cron worker computes rolling-window aggregates across all events in each corridor.

**Materialization:**

- Nightly cron reads `scan_aggregates` joined to `events.corridor_id`, bucketed by day-of-week × hour-of-day, computes 30-day and 90-day rolling distinct anon counts.

**SharedReport read pattern:** for event E, the report compares E's event-window scan count to `corridor_density_baseline.window_30d_count` for E's corridor + day-of-week + hour-of-day. Density = `event_scans / baseline_30d`.

### 3. `event_series` — recurring event linkage

**For SharedReport field:** Headcount trend over recurring instances

Current platform: each event is a row in `events`, but there's no formal "this is the same trivia night every Thursday" linkage. The platform infers this informally; the SharedReport needs explicit linkage.

**Proposed:**

```sql
CREATE TABLE event_series (
  id              TEXT PRIMARY KEY,
  venue_id        TEXT NOT NULL,    -- the venue's anchor event_id
  series_name     TEXT NOT NULL,    -- 'Thursday Trivia', 'Monday Bocce', etc.
  cadence         TEXT,             -- 'weekly' | 'biweekly' | 'monthly' (informational)
  day_of_week     INTEGER,          -- 0-6, optional
  hour_of_day     INTEGER,          -- 0-23, optional
  active_from     TEXT,
  active_until    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (venue_id) REFERENCES events(id)
);

-- Extend events with optional series_id
ALTER TABLE events ADD COLUMN series_id TEXT REFERENCES event_series(id);
```

**SharedReport read pattern:** for event E with `series_id = S`, the report computes headcount trend by ordering `scan_aggregates.distinct_agent_hashes` for all events in S by `start_date` ASC, showing the trend line.

**Anonymity:** no per-attendee data; just event-level aggregates linked via series.

---

## Materialization architecture

### Where it runs

A new scheduled handler at `src/handlers/shared-report-materialize.ts`. The cron triggers post-event aggregation N hours after event end, plus nightly corridor-baseline computation.

Cron schedule (wrangler.toml):

```toml
# Post-event SharedReport aggregation — runs hourly, picks up events
# whose end_date is ≥ 2 hours ago and < 26 hours ago.
[[triggers.crons]]
schedule = "5 * * * *"   # 5 past each hour

# Corridor density baseline — recomputed nightly.
[[triggers.crons]]
schedule = "30 4 * * *"  # 4:30 AM UTC
```

### Where it writes

All SharedReport aggregates write to the **main `DB`** (not `FORMS_DB`). Rationale:

1. **Architectural invariant.** FORMS_DB holds per-attendee form data — registrations, surveys, email signups. SharedReport aggregates are NOT per-attendee; they're per-event/corridor/series. Putting them in FORMS_DB would violate the two-DB separation (ADR-001).
2. **Static gate.** The `architecture.spec.ts` invariant gate explicitly forbids non-forms handlers from reading FORMS_DB. SharedReport materialization is a non-forms scheduled worker — main DB is the right home.
3. **BigQuery export contract.** Phase 1 ships to the `general` regulatory pool. Phase 4 / Phase 5 (HIPAA / COPPA) get their own DB and export targets per the multi-D1 architecture in BEACHHEAD-ICP — those will eventually have their own per-tier `shared_report_*` aggregate tables.

### What it produces

A single read-time view `v_shared_report` (or a query function) that the SharedReport renderer (OSE-245) reads from:

```sql
-- Pseudocode — actual implementation likely a function in src/lib/
SELECT
  sa.event_id,
  sa.distinct_agent_hashes              AS unique_gatherings,
  rr.return_rate                AS return_rate_pct,
  (sa.distinct_agent_hashes * 1.0 / cdb.window_30d_count) AS corridor_density_ratio,
  si.impression_count,
  si.click_count,
  hcs.trend_array               AS headcount_trend
FROM scan_aggregates sa
LEFT JOIN (SELECT venue_id, return_rate FROM anon_id_returns_view) rr ON ...
LEFT JOIN corridor_density_baseline cdb ON sa.event_id->corridor + dow + hour
LEFT JOIN (SELECT event_id, COUNT(*) FILTER (...) AS impression_count FROM sponsor_impressions) si ON ...
LEFT JOIN (SELECT series_id, JSON_GROUP_ARRAY(headcount) FROM ... ORDER BY date) hcs ON ...
WHERE sa.event_id = ?
```

### BigQuery export

Per-event aggregates flow to BigQuery `general` dataset after D1 materialization. Tier routing per `src/lib/pool-contract.ts`. Phase 4+5 will eventually route HIPAA/COPPA aggregates to their respective datasets.

Export contract (one row per event):

| field                  | type       | source                                                  |
| ---------------------- | ---------- | ------------------------------------------------------- |
| event_id               | string     | events.id                                               |
| corridor_id            | string     | events.corridor_id                                      |
| event_date             | date       | events.start_date                                       |
| unique_gatherings      | int        | scan_aggregates.distinct_agent_hashes                   |
| return_rate_pct        | float      | anon_id_returns aggregate                               |
| corridor_density_ratio | float      | scan_aggregates ÷ corridor_density_baseline.window_30d  |
| sponsor_impressions    | int        | sponsor_impressions count where event_type='impression' |
| sponsor_clicks         | int        | sponsor_impressions count where event_type='click'      |
| headcount_trend        | array[int] | event_series rolling headcounts                         |
| materialized_at        | timestamp  | computed_at of the aggregation                          |

**Crucial:** NO `anon_id` or `anon_id_hash` field in the BigQuery export. The export is per-event, not per-attendee.

---

## Static-invariant gates (CI-enforced)

The pipeline gets the same static-gate discipline as ADR-001 / ADR-002. New gate file: `tests/shared-report-pipeline-invariants.spec.ts`.

### Gate 1 — no FORMS_DB reads in SharedReport pipeline

```ts
// SharedReport materialization MUST NOT read from FORMS_DB.
// Per ADR-001 architectural isolation, only forms-handler files
// touch FORMS_DB; SharedReport is aggregate-event data only.
expect(materializationSource).not.toMatch(/env\.FORMS_DB/);
```

### Gate 2 — no raw anon_id storage in SharedReport tables

```ts
// anon_id_returns stores anon_id_hash only — never raw anon_id.
// Migration text must contain anon_id_hash (HASH column) and
// must NOT define a column named just `anon_id` (raw).
expect(migration0031Source).toMatch(/anon_id_hash\s+TEXT NOT NULL/);
expect(migration0031Source).not.toMatch(/\banon_id\s+TEXT NOT NULL/);
```

### Gate 3 — BigQuery export contains no per-attendee fields

```ts
// The export contract for shared_report rows MUST NOT include
// any of: anon_id, anon_id_hash, ip_hash, email, name, phone.
const forbiddenInExport = [/\banon_id\b/, /\bip_hash\b/, /\bemail\b/, /\bname\b/, /\bphone\b/];
// Tested against the BigQuery export builder source.
```

### Gate 4 — materialization is cron-only, never user-facing

```ts
// SharedReport materialization handler MUST NOT be wired to any
// user-facing route in router.ts. Only the scheduled trigger
// reaches it.
expect(routerSource).not.toMatch(/handleMaterializeSharedReport/);
expect(scheduledSource).toMatch(/runSharedReportMaterialization/);
```

---

## Phase-by-phase execution plan

Session 1 (this PR — **doc only, no code**):

- This design doc lands and gets reviewed
- Schema decisions ratified or refined

Session 2 (engineering — migration):

- Migration 0031: `anon_id_returns` table
- Migration 0032: `corridor_density_baseline` table
- Migration 0033: `event_series` table + `events.series_id` column
- Pepper rotation: new `ANON_ID_HASH_PEPPER` env var (distinct from `IP_HASH_PEPPER`)
- Static gates 1+2 from above

Session 3 (engineering — materialization handlers):

- `src/handlers/shared-report-materialize.ts` — cron worker
- `src/lib/shared-report.ts` — aggregation function + types
- Static gate 4

Session 4 (engineering — BigQuery export):

- Extend the existing BigQuery exporter (`src/handlers/bigquery.ts`) with `exportSharedReport(eventId)`
- Tier routing per pool-contract.ts
- Static gate 3

Session 5 (engineering — read API):

- `GET /api/v2/events/:id/shared-report` returns the materialized aggregate as JSON
- This is what OSE-245 renderer consumes
- Tier-gated per OSE-250

After this chain lands, **OSE-245 (post-event rendering) can ship a real SharedReport** instead of a placeholder.

---

## What this design does NOT commit to

- **Specific aggregation cadence beyond hourly cron** — if hourly is wrong, the cron schedule changes, not the schema.
- **Specific column-level statistics** — confidence intervals, sample-size annotations, etc. live in the renderer (OSE-245), not the pipeline.
- **HIPAA / COPPA aggregate schemas** — those are Phase 4 / Phase 5 work, with their own physically-separate D1 databases per the BEACHHEAD-ICP 5-phase model.
- **Multi-tenant aggregates** — Enterprise tier (OSE-254) will eventually scope aggregates per `tenant_id`; this design leaves room for that column to be added later.
- **Partner-sponsor funnel attribution** — OSE-282 introduces a fourth SKU dimension (partner-sponsor cross-venue commerce) that needs its own attribution column. The schema above is forward-compatible: when OSE-282 ships, `sponsor_impressions` extends with an optional `partner_sponsor_id` column, and the SharedReport export gets `partner_funnel_scans` + `partner_funnel_clicks` columns.

---

## Ratified decisions (2026-05-15)

The 5 open questions surfaced in the initial design draft have been answered. Session 2 (migrations) ships against these decisions.

### Q1 — Pepper rotation cadence → **Separate peppers, separate cadence**

`ANON_ID_HASH_PEPPER` is its own Wrangler secret, rotated independently of `IP_HASH_PEPPER`. Rationale: the two peppers protect different anonymity scopes (per-attendee event correlation vs. rate-limit/subscriber identity) and should have independent compromise blast radii. Ops overhead is one extra Wrangler secret + one extra entry in the rotation runbook.

**Implementation:**

- New secret: `ANON_ID_HASH_PEPPER` (Doppler-managed per `reference_doppler.md` memory)
- Distinct from existing `IP_HASH_PEPPER`
- Rotation runbook (separate story) documents both peppers + their independent schedules

### Q2 — Event-series creation flow → **Hybrid (auto-suggest + admin confirms)**

The platform auto-detects candidate series by clustering events on `venue + day_of_week + hour_of_day`, surfaces them to the admin UI as suggestions, and the admin clicks accept/reject. Confirmed series participate in `headcount_trend`; rejected suggestions are remembered so the platform doesn't re-suggest them.

**Implementation note (this is the deviation from the original draft):**

The schema needs to support the three-state lifecycle (`pending` candidate → `confirmed` series → optionally `rejected`):

```sql
CREATE TABLE event_series (
  id              TEXT PRIMARY KEY,
  venue_id        TEXT NOT NULL,
  series_name     TEXT NOT NULL,
  cadence         TEXT,
  day_of_week     INTEGER,
  hour_of_day     INTEGER,
  active_from     TEXT,
  active_until    TEXT,
  state           TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'confirmed' | 'rejected'
    CHECK (state IN ('pending', 'confirmed', 'rejected')),
  detected_at     TEXT,                            -- when auto-detector first proposed
  confirmed_at    TEXT,                            -- when admin accepted
  rejected_reason TEXT,                            -- optional admin note on rejection
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (venue_id) REFERENCES events(id)
);

CREATE INDEX idx_event_series_venue_state ON event_series(venue_id, state);
```

Auto-detector runs nightly. It looks at the last 8 weeks of events per venue, clusters by `(venue, dow, hour_of_day)` with a tolerance window (±1 hour), and emits a `pending` row for any cluster with ≥ 3 events not already covered by a `confirmed` or `rejected` series.

Admin UI presents pending suggestions with `accept` / `reject` / `edit name` actions. Auto-detector skips clusters that already match a `rejected` row to avoid re-prompting.

Only `confirmed` series are joined to `events.series_id` for SharedReport `headcount_trend`. `pending` and `rejected` rows are detection-loop bookkeeping.

**Scope impact on Session 2:** the migration is slightly more complex (lifecycle column + check constraint + index), and Session 3 gets a new sub-deliverable: the auto-detector cron worker. Net: ~1-2 additional hours of work across Sessions 2-3.

### Q3 — Return-rate window → **Lifetime (bounded by 1-year cookie TTL)**

`anon_id_returns` accumulates over the cookie's natural 1-year lifespan. The 1-year TTL bounds memory implicitly — no additional windowing needed. BEACHHEAD-ICP's "% of anon-IDs seen at prior events" is the source of truth; the cookie TTL is the upper bound.

### Q4 — Corridor baseline minimum sample size → **10 events / 30 days at (corridor × dow × hour) granularity**

Below 10 events in the rolling 30-day window for a given (corridor, day-of-week, hour-of-day) cell, `corridor_density_ratio` returns `NULL`. The SharedReport renderer surfaces: _"insufficient corridor signal — this 2-mile radius needs more events to compute density against."_ Honest about uncertainty.

This is a parameter, not architecture — easy to retune later. Initial: **10**.

### Q5 — Tier gating: materialize vs. read → **Materialize all events; gate at read time**

Cron computes SharedReport aggregates for every event regardless of tier. Tier-gating lives in the _read API response shape_: free tier gets a teaser, paid tiers get the full 6 fields. Rationale: a bar upgrading from free to House at $49/mo sees historical SharedReports immediately, not a "give us 24 hours to backfill" message. Cron cost on D1 aggregation is negligible at our scale.

**Implementation:**

- `materializeSharedReport(eventId)` runs unconditionally on every post-event cron tick
- `GET /api/v2/events/:id/shared-report` reads the materialized data, applies tier-gating at response-shape time
- Free tier response: `{ ok: true, tier: 'free', unique_gatherings: <int>, full_data_locked: true, upgrade_hint: { ... } }`
- Paid tier response: full 6-field payload

---

## Implementation deltas from the original design draft

For session-2 planning, the ratified decisions change a few things from the initial draft:

| Original draft                             | Ratified                                                | Impact                                                       |
| ------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------ |
| `event_series` table (no lifecycle column) | `event_series` table + `state` lifecycle column + index | +1 migration column, +1 index, ~30 min more work             |
| Manual-only series creation                | Hybrid auto-suggest + admin confirm                     | New cron sub-worker for auto-detection (~2hr Session 3 work) |
| Single pepper system extended              | Net-new `ANON_ID_HASH_PEPPER` secret                    | One secret to register + document                            |
| Corridor baseline min sample TBD           | 10 events / 30d at (corridor × dow × hour)              | Parameter in materialization code                            |
| Tier gating TBD                            | Materialize all, gate at read                           | Cron is unconditional; tier logic lives in read API          |

Total additional Session 2-3 work: **~3 hours** beyond the original estimate. Still single-PR per session.

---

## References

- BEACHHEAD-ICP-2026-05-14.md — defines the 6 SharedReport fields and the product SKU narrative
- ADR-001 — anonymous-identity architecture (the 2-DB separation this preserves)
- ADR-002 — static-invariant gates (the pattern the 4 gates above apply)
- OSE-272 — this story (data pipeline backend for OSE-245)
- OSE-218 — scan telemetry schema (the upstream signal this aggregates)
- OSE-246 — sponsor impression logging (already-shipped table writer, this consumes)
- OSE-245 — post-event SharedReport rendering (the downstream renderer this unblocks)
- OSE-178 — SPON-5 sponsor analytics pane (the renderer that reads the export)
- OSE-282 — partner-sponsor commerce (forward-compatible extension point)
- Migration 0006 (scan_aggregates) + 0022 (sponsor_impressions) + 0029 (events_5w_and_corridor) — existing primitives this builds on
- `src/lib/anonymous-id.ts` — anon_id contract
- `src/lib/pool-contract.ts` — regulatory pool routing

---

## Sign-off

**Design ratified 2026-05-15.** Session 2 (migrations) is unblocked. The next concrete deliverable is the migration PR with:

- Migration 0031: `anon_id_returns` table
- Migration 0032: `corridor_density_baseline` table
- Migration 0033: `event_series` table with lifecycle `state` column + index
- Migration 0034: `events.series_id` column (FK to `event_series.id`, optional)
- New Wrangler secret: `ANON_ID_HASH_PEPPER` (Doppler-managed)
- Static gates 1 + 2 from the gates section above

Open ratified design at any time during Session 2+ to amend with implementation feedback — the doc remains the source of truth for the pipeline's contract.
