/**
 * OSE-272 — SharedReport materialization library
 *
 * Pure aggregation functions that compute the 6 SharedReport data primitives
 * from the upstream signal in `scans`, `sponsor_displays`, and `events`.
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

import { hashAnonIdForReturns, pepperEpoch } from './anon-id-hash';
import { phaseTimesFor } from './event-datetime';
import { isH3Cell } from './export-geography';
import { errorLabel } from './error-label';

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

// Q4 ratified — corridor baseline minimum sample size.
//
// UNITS, GRAIN AND DIRECTION, because this comment used to get all three wrong
// and a governance artifact was ratified on the strength of it (OSE-1242,
// CCR Loop 9, 2026-09-05). It said "10 events / 30d". It is not events, it is
// not corridor-wide, and it is not forward-looking:
//
//   unit       distinct anonymous attendees — COUNT(DISTINCT anon_id_hash),
//              see refreshCorridorDensityBaseline below and migration 0032:44
//              ("rolling 30-day distinct anon_id_hash count")
//   grain      per (corridor_id, bucket_dow, bucket_hour) — a time-of-week
//              cell, not a whole corridor
//   direction  TRAILING — what already happened
//   purpose    the floor below which a density RATIO is not publishable;
//              it is not a readiness or eligibility gate for any surface
//
// Do not reuse this as a threshold for whether something should be SHOWN. A
// trailing attendee count cannot answer a question about a forward window, and
// a per-time-bucket floor cannot answer one about a corridor.
//
// Callers of the SharedReport read API enforce it at render time; here we just
// materialize the count so the API can decide.
export const CORRIDOR_BASELINE_MIN_SAMPLE = 10;

// OSE-597 (rank-10 finding): single source of truth for the corridor-map
// render suppression floor. Previously corridor-map.ts defaulted to 5 as a
// magic number; callers who omitted minCount silently used a different floor
// than the one documented in the privacy spec. Export here so shared-report-
// builder.ts, corridor-map.ts, and any future consumer share one constant.
export const CORRIDOR_MAP_MIN_COUNT = 5;

/**
 * ADR-026 rule B (OSE-1946): a corridor group is built only from events whose
 * own people count is published. The SharedReport publishes an event's count
 * exactly from K up (`sample_size`, `this_event_count`: distinct anon_id_hash
 * per venue_id, every row). If a group also held an event under K, that exact
 * count beside the rounded group would name the other: 11 published, a group
 * of 15, so the other event had 4. An event whose own count is withheld
 * therefore adds nothing to any group: not to the corridor baseline, not to the
 * corridor returns export, and no one becomes a returner through it.
 *
 * The gate must count the same rows its consumer sums for the event. Here that
 * is every row, as in the report and in `refreshCorridorBaselines`. The returns
 * export sums only current-pepper rows seen in its window, so it gates on those
 * (inline in `exportAnonIdReturns`). A subset at K or more implies the report
 * publishes the event too.
 *
 * Use as `venue_id IN (${PUBLISHED_EVENT_IDS_SQL})`. Uncorrelated, so SQLite
 * evaluates it once per statement; it reads the (venue_id, …) index.
 */
export const PUBLISHED_EVENT_IDS_SQL = `SELECT venue_id FROM anon_id_returns
       GROUP BY venue_id HAVING COUNT(DISTINCT anon_id_hash) >= ${CORRIDOR_MAP_MIN_COUNT}`;

// Auto-detector clustering window: look back 8 weeks of events per venue.
const SERIES_DETECTOR_LOOKBACK_DAYS = 56;

// Materialization lookback window for post-event aggregation:
// events whose end_date is between 2 hours and 26 hours ago.
// The 2h floor avoids materializing while attendees are still arriving. The
// cron is nightly (03:00 UTC), so the 26h ceiling covers the day since the
// last run plus a 2h overlap; a whole missed night is not caught up.
const MATERIALIZATION_FLOOR_HOURS = 2;
const MATERIALIZATION_CEILING_HOURS = 26;

/**
 * Phase 1 — materialize anon_id_returns for events that recently ended.
 *
 * For each candidate event:
 *   1. Read distinct `anonymous_id` from `scan_node_returns` for the event
 *   2. Hash each with ANON_ID_HASH_PEPPER (skip if pepper missing → null hash)
 *   3. Upsert `anon_id_returns(anon_id_hash, venue_id=event_id, ...)`:
 *      - INSERT a new row on first sight
 *      - UPDATE last_seen_at + return_count on repeat
 *
 * The (anon_id_hash, venue_id) PK ensures one row per (anon, event). Each run
 * re-reads the event's distinct ids, so return_count counts runs, not scans:
 * nothing may read it as a visit count (the export counts distinct events).
 */
/** Old-pepper rows deleted per statement, and the most statements per run. */
const PEPPER_PURGE_CHUNK = 1000;
const PEPPER_PURGE_MAX_CHUNKS = 50;

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

  // Migration 0091: every row records which pepper hashed it. Rows of an older
  // or unknown pepper are deleted here: the export never counts them, and after
  // a rotation erasure (data-subject.ts) can only re-derive the current hash, so
  // it could never find them. A rotation is a reset, not a second identity.
  // This is the bounded safety net (PEPPER_PURGE_CHUNK x PEPPER_PURGE_MAX_CHUNKS
  // rows a run, then ANON_ID_RETURNS_PEPPER_PURGE_INCOMPLETE); the complete
  // purge is the rotation step in docs/runbooks/RUNBOOK-DEPLOYMENT.md.
  const epoch = await pepperEpoch(env.ANON_ID_HASH_PEPPER);
  try {
    let purged = 0;
    let complete = false;
    for (let i = 0; i < PEPPER_PURGE_MAX_CHUNKS; i++) {
      const res = await env.DB.prepare(
        `DELETE FROM anon_id_returns WHERE rowid IN (
           SELECT rowid FROM anon_id_returns
            WHERE pepper_epoch IS NULL OR pepper_epoch < ?1 OR pepper_epoch > ?1
            LIMIT ${PEPPER_PURGE_CHUNK})`
      )
        .bind(epoch)
        .run();
      const n = res.meta?.changes ?? 0;
      purged += n;
      if (n < PEPPER_PURGE_CHUNK) {
        complete = true;
        break;
      }
    }
    if (purged > 0) {
      console.log(JSON.stringify({ type: 'ANON_ID_RETURNS_PEPPER_PURGE', rows: purged }));
    }
    if (!complete) {
      // Every chunk came back full: rows may remain, or the last chunk took the
      // last of them. Look before raising the alert.
      const left = await env.DB.prepare(
        `SELECT 1 FROM anon_id_returns
          WHERE pepper_epoch IS NULL OR pepper_epoch < ?1 OR pepper_epoch > ?1 LIMIT 1`
      )
        .bind(epoch)
        .first();
      complete = left === null;
    }
    if (!complete) {
      // Rows erasure cannot reach are still there; the next run continues. The
      // rotation runbook purges the table in full, so this is the safety net.
      console.error(
        JSON.stringify({
          type: 'ANON_ID_RETURNS_PEPPER_PURGE_INCOMPLETE',
          rows_deleted: purged,
          note: 'Old-pepper anon_id_returns rows remain. Run the full purge in RUNBOOK-DEPLOYMENT.md.',
        })
      );
    }
  } catch (err) {
    result.errors++;
    console.error(
      JSON.stringify({
        type: 'ANON_ID_RETURNS_PEPPER_PURGE_ERROR',
        error: errorLabel(err),
      })
    );
  }

  // Find events that ended in the materialization window.
  const nowMs = Date.now();
  const floorMs = nowMs - MATERIALIZATION_CEILING_HOURS * 60 * 60 * 1000;
  const ceilingMs = nowMs - MATERIALIZATION_FLOOR_HOURS * 60 * 60 * 1000;

  // OSE-616: events.end_date is a CALENDAR DAY ("YYYY-MM-DD", the API's only
  // accepted shape) that ends at local 23:59:59.999 in the event's zone — not
  // an instant. Comparing the raw string against ISO instants only ever caught
  // a date-only event on the one cron tick where the string happened to sort
  // inside the window. Select by calendar day (padded two days each side, so
  // every zone is covered), then keep only events whose real end instant
  // (phaseTimesFor — the same rule the public event page uses) is in window.
  // A date-only event may have no end_date at all: it ends with its start
  // day, so the prefilter reads COALESCE(end_date, start_date).
  const dayPad = 2 * 86_400_000;
  const fromDay = new Date(floorMs - dayPad).toISOString().slice(0, 10);
  const toDay = new Date(ceilingMs + dayPad).toISOString().slice(0, 10);
  const dayRows = await env.DB.prepare(
    `SELECT id, start_date, end_date, starts_at, timezone FROM events
       WHERE status = 'active'
         AND COALESCE(end_date, start_date) IS NOT NULL
         AND substr(COALESCE(end_date, start_date), 1, 10) BETWEEN ? AND ?`
  )
    .bind(fromDay, toDay)
    .all<{
      id: string;
      start_date: string | null;
      end_date: string | null;
      starts_at: string | null;
      timezone: string | null;
    }>();
  const candidates = {
    results: (dayRows.results ?? []).filter((e) => {
      const endIso = phaseTimesFor(e).end_date;
      const endMs = endIso ? Date.parse(endIso) : NaN;
      return Number.isFinite(endMs) && endMs >= floorMs && endMs <= ceilingMs;
    }),
  };

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
        // UPSERT — bump return_count + last_seen_at on conflict.
        // Note: venue_id is set to the event_id where this scan happened.
        // The "return rate" read-API query in Session 5 will aggregate
        // these per-event rows back up to (venue or corridor) scope.
        const nowIso = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO anon_id_returns
             (anon_id_hash, venue_id, first_seen_at, last_seen_at, return_count, computed_at,
              pepper_epoch)
           VALUES (?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(anon_id_hash, venue_id) DO UPDATE SET
             last_seen_at = excluded.last_seen_at,
             return_count  = return_count + 1,
             computed_at  = excluded.computed_at,
             pepper_epoch = excluded.pepper_epoch`
        )
          .bind(hash, row.id, nowIso, nowIso, nowIso, epoch)
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
          error: errorLabel(err),
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
  // The corridor key is the res7 cell, lowercased (ADR-011 / OSE-616): H3 is
  // case-insensitive but this key is not, so one cell stored in two spellings
  // must group into ONE baseline row, never two that collide at export.
  // We use the SQLite-friendly strftime to extract day-of-week + hour.
  // SQLite's `strftime('%w', ts)` returns 0-6 (Sunday=0); `strftime('%H', ts)`
  // returns 00-23. Both match the schema's bucket_dow/bucket_hour expectations.
  try {
    const cells = await env.DB.prepare(
      `SELECT
         COALESCE(LOWER(e.h3_res7), e.corridor_id) AS corridor_id,
         CAST(strftime('%w', e.start_date) AS INTEGER) AS bucket_dow,
         CAST(strftime('%H', e.start_date) AS INTEGER) AS bucket_hour,
         COUNT(DISTINCT
           CASE WHEN e.start_date >= ? THEN air.anon_id_hash END
         ) AS window_30d_count,
         COUNT(DISTINCT
           CASE WHEN e.start_date >= ? THEN air.anon_id_hash END
         ) AS window_90d_count
       FROM events e
       -- ADR-026 rule B: an event whose own count is withheld adds no one.
       LEFT JOIN anon_id_returns air ON air.venue_id = e.id
         AND air.venue_id IN (${PUBLISHED_EVENT_IDS_SQL})
       WHERE (e.h3_res7 IS NOT NULL OR e.corridor_id IS NOT NULL)
         AND e.start_date IS NOT NULL
         AND e.start_date >= ?
       GROUP BY COALESCE(LOWER(e.h3_res7), e.corridor_id), bucket_dow, bucket_hour`
    )
      .bind(floor30dIso, floor90dIso, floor90dIso)
      .all<{
        corridor_id: string;
        bucket_dow: number;
        bucket_hour: number;
        window_30d_count: number;
        window_90d_count: number;
      }>();

    // Reconcile: drop baseline rows stored under a non-lowercase spelling of
    // an H3 cell. This run re-derives them under the lowercase key above, so
    // nothing is lost and the export never sees two spellings of one corridor.
    // Only keys proven to be real cells (isH3Cell) are touched: a legacy or
    // malformed key that merely looks H3-shaped is left for the export to
    // withhold or fail on, never silently deleted here.
    const caseVariants = await env.DB.prepare(
      `SELECT DISTINCT corridor_id FROM corridor_density_baseline
         WHERE length(corridor_id) = 15
           AND corridor_id <> LOWER(corridor_id)`
    ).all<{ corridor_id: string }>();
    for (const { corridor_id } of caseVariants.results ?? []) {
      if (!isH3Cell(corridor_id)) continue;
      await env.DB.prepare(`DELETE FROM corridor_density_baseline WHERE corridor_id = ?`)
        .bind(corridor_id)
        .run();
    }

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
              error: errorLabel(snapErr),
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
            error: errorLabel(err),
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
        error: errorLabel(err),
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
 * Clusters events from the last 8 weeks by (brand, venue location, day-of-week,
 * hour-of-day ±1hr tolerance). Never across brands (OSE-1421, owner ruling). Emits a `pending` row in event_series for
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
    // Group recent events by (brand, location, dow, hour). location is the venue
    // proxy in v1 (no separate venues table). Q2 hybrid auto-detector spec.
    // Part of OSE-1421 (owner ruling 2026-10-01): a series never groups events
    // across brands, so brand_id is part of the cluster key — two brands that
    // happen to share a venue string, weekday and hour are two clusters, and
    // each one's anchor (MIN(id)) is an event of its own brand.
    const clusters = await env.DB.prepare(
      `SELECT
         MIN(id)                                AS anchor_event_id,
         brand_id                                AS brand_id,
         location                                AS venue_location,
         CAST(strftime('%w', start_date) AS INTEGER) AS day_of_week,
         CAST(strftime('%H', start_date) AS INTEGER) AS hour_of_day,
         COUNT(*)                                AS event_count
       FROM events
       WHERE start_date IS NOT NULL
         AND start_date >= ?
         AND location IS NOT NULL
         AND status IN ('active', 'archived')
       GROUP BY brand_id, venue_location, day_of_week, hour_of_day
       HAVING event_count >= ?`
    )
      .bind(lookbackIso, SERIES_CLUSTER_MIN_EVENTS)
      .all<{
        anchor_event_id: string;
        brand_id: string;
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
               AND venue_id IN (SELECT id FROM events WHERE location = ? AND brand_id = ?)
             LIMIT 1`
        )
          .bind(
            c.day_of_week,
            c.hour_of_day - SERIES_HOUR_TOLERANCE,
            c.hour_of_day + SERIES_HOUR_TOLERANCE,
            c.venue_location,
            c.brand_id
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
               AND venue_id IN (SELECT id FROM events WHERE location = ? AND brand_id = ?)
             LIMIT 1`
        )
          .bind(c.day_of_week, c.hour_of_day, c.venue_location, c.brand_id)
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
            error: errorLabel(err),
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
        error: errorLabel(err),
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
 *   - distinct_agent_hashes = COUNT(DISTINCT COALESCE(anonymous_id, user_agent_hash))
 *   - top_country   = always NULL (OSE-1460: the visitor's country is not recorded)
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
    // OSE-1460: the visitor's country is never held. Migration 0089 cleared it,
    // but a Worker version still reading the header can write one in the deploy
    // window after that migration ran; this roll-up clears any such row.
    await env.DB.prepare(
      `UPDATE scan_node_returns SET country_code = NULL WHERE country_code IS NOT NULL`
    ).run();

    // Aggregate totals per (event_id, bucket_date, bucket_hour).
    // scan_bucket format: YYYY-MM-DDTHH:00 → date = first 10 chars, hour = chars 12-13.
    const buckets = await env.DB.prepare(
      `SELECT
         event_id,
         substr(scan_bucket, 1, 10)             AS bucket_date,
         CAST(substr(scan_bucket, 12, 2) AS INTEGER) AS bucket_hour,
         COUNT(*)                               AS total_scans,
         COUNT(DISTINCT COALESCE(anonymous_id, user_agent_hash)) AS distinct_agent_hashes
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
        distinct_agent_hashes: number;
      }>();

    const seenEvents = new Set<string>();

    for (const b of buckets.results ?? []) {
      seenEvents.add(b.event_id);
      const id = `agg_${b.event_id}_${b.bucket_date}_${b.bucket_hour}`;

      try {
        await env.DB.prepare(
          `INSERT OR REPLACE INTO scan_aggregates
             (id, event_id, bucket_date, bucket_hour,
              total_scans, distinct_agent_hashes, top_country, computed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            b.event_id,
            b.bucket_date,
            b.bucket_hour,
            b.total_scans,
            b.distinct_agent_hashes,
            null, // top_country: OSE-1460, a visitor's IP country is not recorded
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
            error: errorLabel(err),
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
        error: errorLabel(err),
      })
    );
  }

  await aggregateScanCells(env, floor90dIso, nowIso, result);

  result.durationMs = Date.now() - start;
  return result;
}

/**
 * OSE-1459 / ADR-011 — scans counted at the poster's own res9 cell.
 *
 * Every scan comes in through a poster (GET /q/:qr_token), so a scan's place
 * is its poster's placement cell: the venue's cell for a poster at the venue,
 * the poster's own cell for one across town. Counted from the placement side
 * only (scan_placement_events × poster_deployments): doctrine rule 6 keeps any
 * session-derived value out, so this is a SCAN count, and no poster id is
 * stored — the cell is the place.
 *
 * Only poster-hours with at least CORRIDOR_MAP_MIN_COUNT scans are counted:
 * dedup is per person per poster per hour, so a floored poster-hour is K
 * people, while a cell summed from raw scans could be one person at K posters.
 * A cell-hour whose poster-hours are all under the floor is stored as 0.
 *
 * Recomputed from scratch for every event in the 90-day window and swapped in
 * with one atomic batch (DELETE the window, INSERT the fresh rows), so a
 * poster whose location was corrected never leaves its scans counted in two
 * cells. Scans at a poster with no cell yet are skipped (rowsSkipped) and
 * counted on a later run, once the poster is geocoded.
 */
async function aggregateScanCells(
  env: SharedReportMaterializeEnv,
  floor90dIso: string,
  nowIso: string,
  result: MaterializationResult
): Promise<void> {
  // events.start_date is usually a bare 'YYYY-MM-DD'; compared as text with an
  // ISO timestamp it would drop every event on the cutoff day. Bind the
  // cutoff as a date so all three statements use the same inclusive window.
  const floorDate = floor90dIso.slice(0, 10);
  try {
    const uncelled = await env.DB.prepare(
      `SELECT COUNT(*) AS n
         FROM scan_placement_events spe
         JOIN poster_deployments pd ON pd.id = spe.poster_deployment_id
        WHERE pd.h3_res9 IS NULL
          AND spe.event_id IN (SELECT id FROM events WHERE start_date >= ?)`
    )
      .bind(floorDate)
      .first<{ n: number }>();
    result.rowsSkipped += uncelled?.n ?? 0;

    // Two statements, however busy the window: D1 counts every batched
    // statement toward the per-invocation query limit, so the rollup is one
    // INSERT ... SELECT ... GROUP BY rather than one INSERT per row.
    //
    // The K-floor is applied per poster-hour BEFORE poster-hours are summed
    // into their cell. /q/ dedup is one scan per person per poster per hour,
    // so a poster-hour of >= K scans is >= K people; a cell-hour summed from
    // raw scans is not (one person scanning K posters in one cell is K
    // scans). A sub-K poster-hour adds 0, so a cell-hour with activity but no
    // poster-hour at the floor is kept as a 0 row: the report then reads the
    // map as 'suppressed' (activity withheld), not as 'no scans'.
    //
    // Rows are keyed by the res9 cell alone (the id has no res7), so the outer
    // GROUP BY must be too: poster_deployments.h3_res7 is nullable, and grouping
    // by it would split one cell into two rows with the same id and fail the
    // whole batch. The res7 is the cell's parent, so MAX keeps whichever poster
    // has it.
    const [, inserted] = await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM scan_cell_aggregates
           WHERE event_id IN (SELECT id FROM events WHERE start_date >= ?)`
      ).bind(floorDate),
      env.DB.prepare(
        `INSERT INTO scan_cell_aggregates
           (id, event_id, bucket_date, bucket_hour, h3_res9, h3_res7, scan_count, computed_at)
         SELECT 'cell_' || ph.event_id || '_' || ph.bucket_date || '_' ||
                  ph.bucket_hour || '_' || ph.h3_res9,
                ph.event_id,
                ph.bucket_date,
                ph.bucket_hour,
                ph.h3_res9,
                MAX(ph.h3_res7),
                SUM(CASE WHEN ph.scans >= ? THEN ph.scans ELSE 0 END),
                ?
           FROM (SELECT spe.event_id AS event_id,
                        substr(spe.scan_bucket, 1, 10) AS bucket_date,
                        CAST(substr(spe.scan_bucket, 12, 2) AS INTEGER) AS bucket_hour,
                        LOWER(pd.h3_res9) AS h3_res9,
                        LOWER(pd.h3_res7) AS h3_res7,
                        COUNT(*) AS scans
                   FROM scan_placement_events spe
                   JOIN poster_deployments pd ON pd.id = spe.poster_deployment_id
                  WHERE pd.h3_res9 IS NOT NULL
                    AND spe.event_id IN (SELECT id FROM events WHERE start_date >= ?)
                  GROUP BY spe.event_id, substr(spe.scan_bucket, 1, 13), spe.poster_deployment_id) ph
          GROUP BY ph.event_id, ph.bucket_date, ph.bucket_hour, ph.h3_res9`
      ).bind(CORRIDOR_MAP_MIN_COUNT, nowIso, floorDate),
    ]);
    result.rowsUpserted += inserted?.meta?.changes ?? 0;
  } catch (err) {
    result.errors++;
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_MATERIALIZE_ERROR',
        phase: 'scan_aggregation',
        step: 'scan_cell_aggregates',
        error: errorLabel(err),
      })
    );
  }
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
        error: errorLabel(err),
      })
    );
  }

  result.durationMs = Date.now() - start;
  return result;
}
