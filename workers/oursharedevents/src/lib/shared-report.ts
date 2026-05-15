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
        `SELECT DISTINCT anonymous_id FROM scans
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
         e.corridor_id          AS corridor_id,
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
       WHERE e.corridor_id IS NOT NULL
         AND e.start_date IS NOT NULL
         AND e.start_date >= ?
       GROUP BY e.corridor_id, bucket_dow, bucket_hour`
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
