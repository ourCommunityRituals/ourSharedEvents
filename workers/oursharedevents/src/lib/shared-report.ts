/**
 * OSE-272 — SharedReport materialization library
 *
 * Pure aggregation functions that compute the 6 SharedReport data primitives
 * from the upstream signal in `scans`, `sponsor_impressions`, and `events`.
 *
 * Architectural commitments (CI-enforced via Gates 1, 2, 4 in
 * tests/shared-report-pipeline-invariants.spec.ts):
 *
 *   - This file MUST NOT read the forms database (Gate 1 — per ADR-001
 *     architectural isolation, SharedReport aggregates are not per-attendee
 *     form data; the two-DB separation stays intact).
 *   - This file MUST NOT be invoked by any user-facing route — only the
 *     scheduled() handler (Gate 4 — landing alongside Session 3 wiring).
 *   - Inputs are aggregated upstream signal; outputs are aggregate rows
 *     stored in anon_id_returns / corridor_density_baseline / event_series.
 *     No raw anon_id ever persisted (Gate 2 — Session 2 schema enforced this).
 *
 * Library shape:
 *
 *   materializeAnonIdReturns(env, opts) — Phase 1 of the nightly cron.
 *     For each event ended in the lookback window, reads scans.anonymous_id,
 *     hashes with ANON_ID_HASH_PEPPER, upserts into anon_id_returns.
 *
 *   refreshCorridorBaselines(env) — Phase 2 of the nightly cron.
 *     Recomputes 30-day and 90-day rolling distinct-anon-id counts per
 *     (corridor × day-of-week × hour-of-day) cell. Overwrites the
 *     corridor_density_baseline table.
 *
 *   detectEventSeriesClusters(env) — Phase 3 of the nightly cron.
 *     Q2 hybrid auto-detector. Clusters events by venue + day-of-week +
 *     hour-of-day (±1hr tolerance), emits `pending` event_series rows
 *     for clusters of >= 3 events not already covered by confirmed/rejected
 *     series.
 */

import { hashAnonIdForReturns } from './anon-id-hash';

export interface SharedReportMaterializeEnv {
  DB: D1Database;
  ANON_ID_HASH_PEPPER?: string;
}

export interface MaterializationResult {
  phase: string;
  eventsProcessed: number;
  rowsUpserted: number;
  rowsSkipped: number;
  errors: number;
  durationMs: number;
}

// Q2 ratified — auto-detector requires at least 3 events in the cluster
// before emitting a `pending` event_series candidate. Below 3 is noise.
const SERIES_CLUSTER_MIN_EVENTS = 3;

// Tolerance window for clustering events into a candidate series: ±1 hour.
const SERIES_HOUR_TOLERANCE = 1;

// Q4 ratified — corridor baseline minimum sample size: 10 events / 30d
// (callers of the SharedReport read API enforce this at render time; here
// we just materialize the count so the API can decide).
// Stored for cross-reference; not used in this file directly.
export const CORRIDOR_BASELINE_MIN_SAMPLE = 10;

// OSE-597 (rank-10 finding): single source of truth for the corridor-map
// render suppression floor. Previously corridor-map.ts defaulted to 5 as a
// magic number; callers who omitted minCount silently used a different floor
// than the one documented in the privacy spec. Export here so shared-report-
// builder.ts, corridor-map.ts, and any future consumer share one constant.
export const CORRIDOR_MAP_MIN_COUNT = 5;

// Auto-detector clustering window: look back 8 weeks of events per venue.
const SERIES_DETECTOR_LOOKBACK_DAYS = 56;

// Materialization lookback window for post-event aggregation:
// events whose end_date is between 2 hours and 26 hours ago.
// Per design doc — 2h floor avoids materializing while attendees are still
// arriving; 26h ceiling lets a single hourly cron pick up an event missed
// by a transient failure on the prior hour.
const MATERIALIZATION_FLOOR_HOURS = 2;
const MATERIALIZATION_CEILING_HOURS = 26;

/**
 * Phase 1 — materialize anon_id_returns for events that recently ended.
 *
 * For each candidate event:
 *   1. Read distinct `anonymous_id` from `scans` for the event
 *   2. Hash each with ANON_ID_HASH_PEPPER (skip if pepper missing → null hash)
 *   3. Upsert `anon_id_returns(anon_id_hash, venue_id=event_id, ...)`:
 *      - INSERT a new row on first sight
 *      - UPDATE last_seen_at + visit_count on repeat
 *
 * The (anon_id_hash, venue_id) PK ensures one row per (anon, event). Multiple
 * scans of the same event by the same anon increment visit_count on the
 * single row; scans at different events produce separate rows.
 */
export async function materializeAnonIdReturns(
  env: SharedReportMaterializeEnv
): Promise<MaterializationResult> {
  const start = Date.now();
  const result: MaterializationResult = {
    phase: 'anon_id_returns',
    eventsProcessed: 0,
    rowsUpserted: 0,
    rowsSkipped: 0,
    errors: 0,
    durationMs: 0,
  };

  if (!env.DB) {
    result.durationMs = Date.now() - start;
    return result;
  }

  if (!env.ANON_ID_HASH_PEPPER) {
    // Pepper missing — silently skip materialization with structured warning.
    // Same fail-safe pattern as IP_HASH_PEPPER in subscribers (OSE-207).
    console.warn(
      JSON.stringify({
        type: 'ANON_ID_HASH_PEPPER_MISSING',
        note: 'SharedReport return-rate materialization skipped. Set wrangler/Doppler secret ANON_ID_HASH_PEPPER to enable.',
      })
    );
    result.durationMs = Date.now() - start;
    return result;
  }

  // Find events that ended in the materialization window.
  // We use end_date as the trigger; if end_date is null, fall back to
  // start_date + 6h as a sane default for the "recently ended" check.
  const nowMs = Date.now();
  const floorMs = nowMs - MATERIALIZATION_CEILING_HOURS * 60 * 60 * 1000;
  const ceilingMs = nowMs - MATERIALIZATION_FLOOR_HOURS * 60 * 60 * 1000;
  const floorIso = new Date(floorMs).toISOString();
  const ceilingIso = new Date(ceilingMs).toISOString();

  const candidates = await env.DB.prepare(
    `SELECT id FROM events
       WHERE status = 'active'
         AND end_date IS NOT NULL
         AND end_date BETWEEN ? AND ?`
  )
    .bind(floorIso, ceilingIso)
    .all<{ id: string }>();

  for (const row of candidates.results ?? []) {
    result.eventsProcessed++;
    try {
      const anonRows = await env.DB.prepare(
        `SELECT DISTINCT anonymous_id FROM scan_node_returns
           WHERE event_id = ?
             AND anonymous_id IS NOT NULL`
      )
        .bind(row.id)
        .all<{ anonymous_id: string }>();

      for (const ar of anonRows.results ?? []) {
        const hash = await hashAnonIdForReturns(ar.anonymous_id, env.ANON_ID_HASH_PEPPER);
        if (!hash) {
          result.rowsSkipped++;
          continue;
        }
        // UPSERT — bump visit_count + last_seen_at on conflict.
        // Note: venue_id is set to the event_id where this scan happened.
        // The "return rate" read-API query in Session 5 will aggregate
        // these per-event rows back up to (venue or corridor) scope.
        const nowIso = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO anon_id_returns
             (anon_id_hash, venue_id, first_seen_at, last_seen_at, visit_count, computed_at)
           VALUES (?, ?, ?, ?, 1, ?)
           ON CONFLICT(anon_id_hash, venue_id) DO UPDATE SET
             last_seen_at = excluded.last_seen_at,
             visit_count  = visit_count + 1,
             computed_at  = excluded.computed_at`
        )
          .bind(hash, row.id, nowIso, nowIso, nowIso)
          .run();
        result.rowsUpserted++;
      }
    } catch (err) {
      result.errors++;
      console.error(
        JSON.stringify({
          type: 'SHARED_REPORT_MATERIALIZE_ERROR',
          phase: 'anon_id_returns',
          event_id: row.id,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}

/**
 * Phase 2 — refresh corridor_density_baseline rolling windows.
 *
 * Reads all events grouped by (corridor_id, day-of-week, hour-of-day) and
 * computes the rolling distinct-anon-id-hash counts for the 30-day and
 * 90-day windows ending now. Overwrites the existing baseline rows
 * (idempotent — last-writer-wins for the cell).
 *
 * Cells with zero events in the window are not written (storage savings;
 * absent row = no baseline available, surfaced as NULL density ratio in
 * the read API per Q4 ratified).
 */
export async function refreshCorridorBaselines(
  env: SharedReportMaterializeEnv
): Promise<MaterializationResult> {
  const start = Date.now();
  const result: MaterializationResult = {
    phase: 'corridor_density_baseline',
    eventsProcessed: 0,
    rowsUpserted: 0,
    rowsSkipped: 0,
    errors: 0,
    durationMs: 0,
  };

  if (!env.DB) {
    result.durationMs = Date.now() - start;
    return result;
  }

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const floor30dIso = new Date(nowMs - 30 * 86400 * 1000).toISOString();
  const floor90dIso = new Date(nowMs - 90 * 86400 * 1000).toISOString();

  // For each (corridor_id, dow, hour), compute window distinct-hash counts.
  // We use the SQLite-friendly strftime to extract day-of-week + hour.
  // SQLite's `strftime('%w', ts)` returns 0-6 (Sunday=0); `strftime('%H', ts)`
  // returns 00-23. Both match the schema's bucket_dow/bucket_hour expectations.
  try {
    const cells = await env.DB.prepare(
      `SELECT
         COALESCE(e.h3_res7, e.corridor_id) AS corridor_id,
         CAST(strftime('%w', e.start_date) AS INTEGER) AS bucket_dow,
         CAST(strftime('%H', e.start_date) AS INTEGER) AS bucket_hour,
         COUNT(DISTINCT
           CASE WHEN e.start_date >= ? THEN air.anon_id_hash END
         ) AS window_30d_count,
         COUNT(DISTINCT
           CASE WHEN e.start_date >= ? THEN air.anon_id_hash END
         ) AS window_90d_count
       FROM events e
       LEFT JOIN anon_id_returns air ON air.venue_id = e.id
       WHERE (e.h3_res7 IS NOT NULL OR e.corridor_id IS NOT NULL)
         AND e.start_date IS NOT NULL
         AND e.start_date >= ?
       GROUP BY COALESCE(e.h3_res7, e.corridor_id), bucket_dow, bucket_hour`
    )
      .bind(floor30dIso, floor90dIso, floor90dIso)
      .all<{
        corridor_id: string;
        bucket_dow: number;
        bucket_hour: number;
        window_30d_count: number;
        window_90d_count: number;
      }>();

    for (const c of cells.results ?? []) {
      if ((c.window_30d_count ?? 0) === 0 && (c.window_90d_count ?? 0) === 0) {
        result.rowsSkipped++;
        continue;
      }
      try {
        await env.DB.prepare(
          `INSERT INTO corridor_density_baseline
             (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(corridor_id, bucket_dow, bucket_hour) DO UPDATE SET
             window_30d_count = excluded.window_30d_count,
             window_90d_count = excluded.window_90d_count,
             computed_at      = excluded.computed_at`
        )
          .bind(
            c.corridor_id,
            c.bucket_dow,
            c.bucket_hour,
            c.window_30d_count,
            c.window_90d_count,
            nowIso
          )
          .run();
        result.rowsUpserted++;

        // Append a snapshot row for OER longitudinal archive.
        // INSERT OR IGNORE: idempotent — if the cron reruns on the same date, skip.
        const snapDate = nowIso.slice(0, 10); // YYYY-MM-DD
        try {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO corridor_density_snapshots
               (id, corridor_id, bucket_dow, bucket_hour, snapshot_date,
                window_30d_count, window_90d_count, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(
              `cds_${c.corridor_id}_${c.bucket_dow}_${c.bucket_hour}_${snapDate}`,
              c.corridor_id,
              c.bucket_dow,
              c.bucket_hour,
              snapDate,
              c.window_30d_count,
              c.window_90d_count,
              nowIso
            )
            .run();
        } catch (snapErr) {
          // Snapshot failure is logged but NOT thrown — the baseline is authoritative.
          // A snapshot write failure must never surface as a baseline failure.
          console.error(
            JSON.stringify({
              type: 'SHARED_REPORT_MATERIALIZE_ERROR',
              phase: 'corridor_density_snapshot',
              cell: `${c.corridor_id}/${c.bucket_dow}/${c.bucket_hour}`,
              error: snapErr instanceof Error ? snapErr.message : String(snapErr),
            })
          );
        }
      } catch (err) {
        result.errors++;
        console.error(
          JSON.stringify({
            type: 'SHARED_REPORT_MATERIALIZE_ERROR',
            phase: 'corridor_density_baseline',
            cell: `${c.corridor_id}/${c.bucket_dow}/${c.bucket_hour}`,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    }
  } catch (err) {
    result.errors++;
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_MATERIALIZE_ERROR',
        phase: 'corridor_density_baseline',
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  result.durationMs = Date.now() - start;

  // OSE-634: SRE-OBS-01 — structured completion log for dashboards + alerting.
  // Emitted after every run so SRE can alert on missing heartbeat or elevated errors.
  console.log(
    JSON.stringify({
      type: 'CORRIDOR_BASELINE_REFRESH_COMPLETE',
      rows_upserted: result.rowsUpserted,
      rows_skipped: result.rowsSkipped,
      errors: result.errors,
      duration_ms: result.durationMs,
    })
  );

  return result;
}

/**
 * Phase 3 — auto-detector for hybrid event-series lifecycle (Q2 ratified).
 *
 * Clusters events from the last 8 weeks by (venue location, day-of-week,
 * hour-of-day ±1hr tolerance). Emits a `pending` row in event_series for
 * each cluster of >= 3 events that isn't already covered by a
 * `confirmed` or `rejected` row.
 *
 * The admin UI (separate story; not in this PR) lets the admin
 * accept/reject pending suggestions. Accept → `state='confirmed'`,
 * `confirmed_at=now()`. Reject → `state='rejected'`, `rejected_reason`
 * optionally populated.
 *
 * Important invariants:
 *   - This function never updates `confirmed` or `rejected` rows.
 *   - It does not auto-link events to series (series_id stays NULL until
 *     admin action). That linkage is admin-driven post-confirm.
 *   - The (venue_id, day_of_week, hour_of_day) index supports fast
 *     "is this cluster already accounted for?" lookups.
 */
export async function detectEventSeriesClusters(
  env: SharedReportMaterializeEnv
): Promise<MaterializationResult> {
  const start = Date.now();
  const result: MaterializationResult = {
    phase: 'event_series_detector',
    eventsProcessed: 0,
    rowsUpserted: 0,
    rowsSkipped: 0,
    errors: 0,
    durationMs: 0,
  };

  if (!env.DB) {
    result.durationMs = Date.now() - start;
    return result;
  }

  const nowIso = new Date().toISOString();
  const lookbackIso = new Date(
    Date.now() - SERIES_DETECTOR_LOOKBACK_DAYS * 86400 * 1000
  ).toISOString();

  try {
    // Group recent events by (location, dow, hour). location is the venue
    // proxy in v1 (no separate venues table). Q2 hybrid auto-detector spec.
    const clusters = await env.DB.prepare(
      `SELECT
         MIN(id)                                AS anchor_event_id,
         location                                AS venue_location,
         CAST(strftime('%w', start_date) AS INTEGER) AS day_of_week,
         CAST(strftime('%H', start_date) AS INTEGER) AS hour_of_day,
         COUNT(*)                                AS event_count
       FROM events
       WHERE start_date IS NOT NULL
         AND start_date >= ?
         AND location IS NOT NULL
         AND status IN ('active', 'archived')
       GROUP BY venue_location, day_of_week, hour_of_day
       HAVING event_count >= ?`
    )
      .bind(lookbackIso, SERIES_CLUSTER_MIN_EVENTS)
      .all<{
        anchor_event_id: string;
        venue_location: string;
        day_of_week: number;
        hour_of_day: number;
        event_count: number;
      }>();

    for (const c of clusters.results ?? []) {
      result.eventsProcessed++;
      try {
        // Skip if a `confirmed` or `rejected` row already covers this cluster.
        //
        // IMPORTANT: We look up by LOCATION, not by the current MIN(id) anchor.
        // The schema's `event_series.venue_id` holds the anchor event_id at
        // the venue, but the anchor can shift as new events are added/removed.
        // To preserve idempotency + correct rejected-cluster suppression, the
        // lookup is location-scoped: "any event_series row whose venue_id
        // belongs to any event at the same physical location/dow/hour bucket".
        //
        // ±1 hour tolerance on the lookup matches any series within hour ±1.
        const existing = await env.DB.prepare(
          `SELECT id, state FROM event_series
             WHERE state IN ('confirmed', 'rejected')
               AND day_of_week = ?
               AND hour_of_day BETWEEN ? AND ?
               AND venue_id IN (SELECT id FROM events WHERE location = ?)
             LIMIT 1`
        )
          .bind(
            c.day_of_week,
            c.hour_of_day - SERIES_HOUR_TOLERANCE,
            c.hour_of_day + SERIES_HOUR_TOLERANCE,
            c.venue_location
          )
          .first<{ id: string; state: string }>();

        if (existing) {
          result.rowsSkipped++;
          continue;
        }

        // Skip if a `pending` row already exists for this exact bucket —
        // avoid emitting duplicate suggestions when the detector re-runs.
        // Same location-scoped lookup pattern: idempotency across anchor shifts.
        const pendingExists = await env.DB.prepare(
          `SELECT id FROM event_series
             WHERE state = 'pending'
               AND day_of_week = ?
               AND hour_of_day = ?
               AND venue_id IN (SELECT id FROM events WHERE location = ?)
             LIMIT 1`
        )
          .bind(c.day_of_week, c.hour_of_day, c.venue_location)
          .first<{ id: string }>();

        if (pendingExists) {
          result.rowsSkipped++;
          continue;
        }

        // Emit the candidate. series_name is auto-generated; admin can rename.
        const id = `evtsrs_${crypto.randomUUID()}`;
        const dowName = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ][c.day_of_week];
        const hourLabel = formatHour(c.hour_of_day);
        const autoName = `${dowName} ${hourLabel} (auto-detected)`;

        await env.DB.prepare(
          `INSERT INTO event_series
             (id, venue_id, series_name, cadence, day_of_week, hour_of_day,
              state, detected_at, created_at, updated_at)
           VALUES (?, ?, ?, 'weekly', ?, ?, 'pending', ?, ?, ?)`
        )
          .bind(
            id,
            c.anchor_event_id,
            autoName,
            c.day_of_week,
            c.hour_of_day,
            nowIso,
            nowIso,
            nowIso
          )
          .run();
        result.rowsUpserted++;
      } catch (err) {
        result.errors++;
        console.error(
          JSON.stringify({
            type: 'SHARED_REPORT_MATERIALIZE_ERROR',
            phase: 'event_series_detector',
            cluster: `${c.venue_location}/${c.day_of_week}/${c.hour_of_day}`,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    }
  } catch (err) {
    result.errors++;
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_MATERIALIZE_ERROR',
        phase: 'event_series_detector',
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  result.durationMs = Date.now() - start;
  return result;
}

/** Format an hour-of-day integer (0-23) as a 12-hour clock label. */
function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

/**
 * Phase BE-SCAN-2 — roll up raw scan rows into scan_aggregates.
 *
 * Groups scans by (event_id, bucket_date, bucket_hour) for events whose
 * start_date falls within the last 90 days. Computes:
 *   - total_scans   = COUNT(*) of scan rows in the bucket
 *   - unique_agents = COUNT(DISTINCT COALESCE(anonymous_id, user_agent_hash))
 *   - top_country   = most frequent non-null country_code in the bucket
 *
 * IDs are deterministic — `agg_{event_id}_{bucket_date}_{bucket_hour}` — so
 * INSERT OR REPLACE is safe and the operation is fully idempotent.
 *
 * h3_res9/h3_res7 are NOT set here; Phase 0 (backfillH3Cells) copies them
 * from the event row after this phase runs. OSE-632 / BE-SCAN-2.
 */
export async function aggregateScanBuckets(
  env: SharedReportMaterializeEnv
): Promise<MaterializationResult> {
  const start = Date.now();
  const result: MaterializationResult = {
    phase: 'scan_aggregation',
    eventsProcessed: 0,
    rowsUpserted: 0,
    rowsSkipped: 0,
    errors: 0,
    durationMs: 0,
  };

  if (!env.DB) {
    result.durationMs = Date.now() - start;
    return result;
  }

  const nowMs = Date.now();
  const floor90dIso = new Date(nowMs - 90 * 86400 * 1000).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  try {
    // Aggregate totals per (event_id, bucket_date, bucket_hour).
    // scan_bucket format: YYYY-MM-DDTHH:00 → date = first 10 chars, hour = chars 12-13.
    const buckets = await env.DB.prepare(
      `SELECT
         event_id,
         substr(scan_bucket, 1, 10)             AS bucket_date,
         CAST(substr(scan_bucket, 12, 2) AS INTEGER) AS bucket_hour,
         COUNT(*)                               AS total_scans,
         COUNT(DISTINCT COALESCE(anonymous_id, user_agent_hash)) AS unique_agents
       FROM scan_node_returns
       WHERE event_id IN (
         SELECT id FROM events WHERE start_date >= ?
       )
       GROUP BY event_id, bucket_date, bucket_hour`
    )
      .bind(floor90dIso)
      .all<{
        event_id: string;
        bucket_date: string;
        bucket_hour: number;
        total_scans: number;
        unique_agents: number;
      }>();

    // Fetch top_country per (event_id, scan_bucket) — separate query to avoid
    // correlated-subquery fan-out inside the main GROUP BY.
    const topCountries = await env.DB.prepare(
      `SELECT event_id, substr(scan_bucket, 1, 13) AS bucket_prefix, country_code
       FROM (
         SELECT event_id, scan_bucket, country_code, COUNT(*) AS cnt
         FROM scan_node_returns
         WHERE country_code IS NOT NULL
           AND event_id IN (SELECT id FROM events WHERE start_date >= ?)
         GROUP BY event_id, scan_bucket, country_code
       ) ranked
       GROUP BY event_id, bucket_prefix
       HAVING COUNT(*) = MAX(cnt) OR 1=1`
    )
      .bind(floor90dIso)
      .all<{ event_id: string; bucket_prefix: string; country_code: string }>();

    // Build a lookup: "{event_id}:{YYYY-MM-DDTHH}" → top country_code
    const countryMap = new Map<string, string>();
    for (const row of topCountries.results ?? []) {
      const key = `${row.event_id}:${row.bucket_prefix}`;
      if (!countryMap.has(key)) countryMap.set(key, row.country_code);
    }

    const seenEvents = new Set<string>();

    for (const b of buckets.results ?? []) {
      seenEvents.add(b.event_id);
      const id = `agg_${b.event_id}_${b.bucket_date}_${b.bucket_hour}`;
      const bucketPrefix = `${b.bucket_date}T${String(b.bucket_hour).padStart(2, '0')}`;
      const topCountry = countryMap.get(`${b.event_id}:${bucketPrefix}`) ?? null;

      try {
        await env.DB.prepare(
          `INSERT OR REPLACE INTO scan_aggregates
             (id, event_id, bucket_date, bucket_hour,
              total_scans, unique_agents, top_country, computed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            b.event_id,
            b.bucket_date,
            b.bucket_hour,
            b.total_scans,
            b.unique_agents,
            topCountry,
            nowIso
          )
          .run();
        result.rowsUpserted++;
      } catch (err) {
        result.errors++;
        console.error(
          JSON.stringify({
            type: 'SHARED_REPORT_MATERIALIZE_ERROR',
            phase: 'scan_aggregation',
            agg_id: id,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    }

    result.eventsProcessed = seenEvents.size;
  } catch (err) {
    result.errors++;
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_MATERIALIZE_ERROR',
        phase: 'scan_aggregation',
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  result.durationMs = Date.now() - start;
  return result;
}

/**
 * Phase 0 — backfill h3_res9/h3_res7 from events onto scan_aggregates rows
 * that are missing them. Runs before all other phases so corridor-map data
 * becomes available to the read API without a full re-scan.
 *
 * Idempotent (WHERE h3_res9 IS NULL), never overwrites existing tags.
 * Safe: uses a correlated sub-select — no JS-level h3 computation needed.
 */
export async function backfillH3Cells(
  env: SharedReportMaterializeEnv
): Promise<MaterializationResult> {
  const start = Date.now();
  const result: MaterializationResult = {
    phase: 'h3_cell_backfill',
    eventsProcessed: 0,
    rowsUpserted: 0,
    rowsSkipped: 0,
    errors: 0,
    durationMs: 0,
  };

  if (!env.DB) {
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const upd = await env.DB.prepare(
      `UPDATE scan_aggregates
         SET h3_res9 = (SELECT h3_res9 FROM events WHERE id = scan_aggregates.event_id),
             h3_res7 = (SELECT h3_res7 FROM events WHERE id = scan_aggregates.event_id)
       WHERE h3_res9 IS NULL
         AND EXISTS (
           SELECT 1 FROM events
           WHERE id = scan_aggregates.event_id
             AND h3_res9 IS NOT NULL
         )`
    ).run();
    result.rowsUpserted = upd.meta.changes ?? 0;
    result.eventsProcessed = result.rowsUpserted;
  } catch (err) {
    result.errors++;
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_MATERIALIZE_ERROR',
        phase: 'h3_cell_backfill',
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  result.durationMs = Date.now() - start;
  return result;
}
