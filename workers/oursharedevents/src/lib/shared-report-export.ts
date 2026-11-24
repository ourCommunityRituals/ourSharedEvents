/**
 * OSE-272 Session 4 — SharedReport BigQuery export library
 *
 * Pure-ish functions that incrementally export the three Session 3
 * materialization primitives to BigQuery, routed by regulatory pool.
 *
 * Design contract (ratified 2026-05-15):
 *   docs/features/SHARED-REPORT-BIGQUERY-EXPORT.md
 *
 * Ratified design decisions:
 *   S4-Q1: same cron tick as materialization
 *   S4-Q2: incremental export with watermark per table   ← bigquery_export_state
 *   S4-Q3: split by regulatory pool                       ← phaseToPool() routing
 *   S4-Q4: failure-isolated, no block on materialization  ← per-phase try/catch
 *
 * Architectural commitments (enforced via Gate 5 in
 * tests/shared-report-pipeline-invariants.spec.ts):
 *
 *   - This file MUST NOT be invoked by any user-facing route — only the
 *     scheduled() handler.
 *   - This file MUST NOT read the forms database (Gate 1 carries over).
 *   - No re-hashing, no enrichment. Phases 2 and 3 pass anonymity-clean
 *     aggregates through. Phase 1, the corridor returns export, is retired
 *     (OSE-2214).
 *
 * Library shape:
 *
 *   exportAnonIdReturns — retired by OSE-2214 (it counted phones seen again).
 *
 *   exportCorridorDensityBaseline(env)   — Phase 2 of the export tick.
 *     Reads new/changed rows from corridor_density_baseline; routes to
 *     `general` pool (corridor baselines are cross-event aggregates,
 *     v1 simplification).
 *
 *   exportEventSeries(env)               — Phase 3 of the export tick.
 *     Reads `confirmed` rows from event_series past the watermark; joins
 *     to events for pool routing; streams to per-pool dataset.
 */

import {
  bigQueryInsertRowsToDataset,
  isBigQueryConfigured,
  type BigQueryEnv,
} from '../cloud/bigquery';
import {
  PRODUCT_ID,
  REGULATORY_POOLS,
  PoolRoutingError,
  assertRequiredTags,
  datasetForPool,
  phaseToPool,
  type RegulatoryPool,
} from './pool-contract';
import { PUBLISH_ROUNDING, floorCorridorBaseline, roundForPublish } from './count-floor';
import {
  assertCorridorGrainRow,
  canonicalCorridorId,
  isCorridorId,
  UNKNOWN_CORRIDOR,
} from './export-geography';
import { errorLabel } from './error-label';

export type SharedReportExportEnv = BigQueryEnv & {
  DB: D1Database;
  /** Migration 0091: the returns export counts only rows hashed under this pepper. */
  ANON_ID_HASH_PEPPER?: string;
};

export interface ExportResult {
  phase: string;
  rowsRead: number;
  rowsExported: number;
  rowsSkipped: number;
  errors: number;
  perPool: Record<RegulatoryPool, number>;
  durationMs: number;
  /** OSE-616: rows whose corridor_id is a real H3 res7 (or coarser) node. */
  corridorIdPresent?: number;
  /** OSE-616: rows exported with corridor_id 'unknown' (event has no res7 node). */
  corridorIdUnknown?: number;
  /**
   * OSE-616: true when the phase actually ran against BigQuery (configured),
   * even if nothing was past the watermark. A configured zero-row run still
   * gets a manifest row, so "ran, nothing new" is distinguishable from "did
   * not run".
   */
  ran?: boolean;
}

/**
 * Hand one row to its BigQuery batch. OSE-616: the row is checked at corridor
 * grain first (throws on any sub-corridor geography — the phase then fails
 * closed and the watermark does not move), and its corridor coverage is counted
 * for the export manifest.
 */
function emitRow(
  target: Record<string, unknown>[],
  row: Record<string, unknown>,
  result: ExportResult
): void {
  assertCorridorGrainRow(row);
  if (isCorridorId(row.corridor_id)) {
    result.corridorIdPresent = (result.corridorIdPresent ?? 0) + 1;
  } else {
    result.corridorIdUnknown = (result.corridorIdUnknown ?? 0) + 1;
  }
  target.push(row);
}

// BigQuery insertAll max batch size — must align with the platform limit
// enforced inside bigQueryInsertRowsToDataset. We chunk our queries to
// match. Smaller than the limit (200 vs 500) leaves headroom for retries
// and keeps individual batches under ~256KB serialized.
const EXPORT_BATCH_SIZE = 200;
/** BigQuery tabledata.insertAll rows per request (cloud/bigquery.ts MAX_ROWS_PER_BATCH). */
const BQ_INSERT_CHUNK = 500;

// BQ table names per source. Names are stable across pool datasets —
// each pool's dataset has its own copy of these tables.
const BQ_TABLE_CORRIDOR_DENSITY = 'corridor_density_baseline_export';
const BQ_TABLE_EVENT_SERIES = 'event_series_export';

// Watermark sentinel for first-run sweeps. Per design doc: epoch ISO so
// every existing row qualifies on first tick.
const EPOCH_WATERMARK = '1970-01-01T00:00:00.000Z';

function makeEmptyPerPool(): Record<RegulatoryPool, number> {
  return Object.fromEntries(REGULATORY_POOLS.map((p) => [p, 0])) as Record<RegulatoryPool, number>;
}

/**
 * Resolve the regulatory pool for a row, failing CLOSED (OSE-380 / Invariant #4).
 *
 * A row whose `legal_clearance_tier` cannot be classified is WITHHELD from every
 * pool — including 'general' — rather than leaked to the least-protected dataset.
 * The row is counted in `rowsSkipped` and a structured `POOL_ROUTING_QUARANTINE`
 * warning is emitted so the misconfiguration is auditable, not silent.
 *
 * NOTE: the caller advances the watermark across all read rows, so a quarantined
 * row is not re-read on the next tick — it stays withheld until the source event
 * is corrected and back-filled. Withholding (never leaking) is the safe direction.
 *
 * Returns null when the row must be skipped.
 */
function resolvePoolFailClosed(
  legalClearanceTier: number | null | undefined,
  rowLocator: string | null,
  result: ExportResult
): RegulatoryPool | null {
  try {
    return phaseToPool(legalClearanceTier);
  } catch (e) {
    if (!(e instanceof PoolRoutingError)) throw e;
    result.rowsSkipped++;
    console.warn(
      JSON.stringify({
        event: 'POOL_ROUTING_QUARANTINE',
        product_id: PRODUCT_ID,
        row_locator: rowLocator,
        legal_clearance_tier: legalClearanceTier ?? null,
        reason: errorLabel(e),
      })
    );
    return null;
  }
}

/**
 * Read the current watermark for a table. INSERTs an epoch row if missing
 * so callers always get a string back. Idempotent.
 */
async function getWatermark(db: D1Database, tableName: string): Promise<string> {
  const row = await db
    .prepare(`SELECT last_exported_at FROM bigquery_export_state WHERE table_name = ?`)
    .bind(tableName)
    .first<{ last_exported_at: string }>();
  if (row) return row.last_exported_at;

  await db
    .prepare(
      `INSERT INTO bigquery_export_state
         (table_name, last_exported_at, last_export_status, last_run_at, updated_at)
       VALUES (?, ?, 'success', datetime('now'), datetime('now'))`
    )
    .bind(tableName, EPOCH_WATERMARK)
    .run();
  return EPOCH_WATERMARK;
}

/**
 * Advance the watermark to a new ISO timestamp and bump the lifetime counter.
 * Called only on successful export of a row (or batch ending). Per design,
 * watermark advances per ROW after that row is confirmed in BQ — but for
 * batch-streaming we advance to the MAX(computed_at) of the successfully
 * inserted batch. Failure paths skip this call entirely.
 */
async function advanceWatermark(
  db: D1Database,
  tableName: string,
  newWatermark: string,
  rowsAdded: number
): Promise<void> {
  await db
    .prepare(
      `UPDATE bigquery_export_state
         SET last_exported_at = ?,
             last_export_status = 'success',
             last_error = NULL,
             rows_exported_lifetime = rows_exported_lifetime + ?,
             last_run_at = datetime('now'),
             updated_at = datetime('now')
       WHERE table_name = ?`
    )
    .bind(newWatermark, rowsAdded, tableName)
    .run();
}

/**
 * Mark the export state as failed. Watermark is NOT advanced — next tick
 * retries from the unchanged watermark.
 */
async function markFailed(db: D1Database, tableName: string, error: string): Promise<void> {
  await db
    .prepare(
      `UPDATE bigquery_export_state
         SET last_export_status = 'failed',
             last_error = ?,
             last_run_at = datetime('now'),
             updated_at = datetime('now')
       WHERE table_name = ?`
    )
    .bind(error.slice(0, 1000), tableName)
    .run();
}

/**
 * Common pre-flight: BQ configured + watermark fetched.
 * Returns null if BQ is not configured (graceful no-op).
 */
async function prepareExport(
  env: SharedReportExportEnv,
  tableName: string,
  phaseLabel: string
): Promise<{ watermark: string; result: ExportResult } | null> {
  if (!isBigQueryConfigured(env)) {
    // Same fail-safe as the existing runBigQueryBackup — no-op when BQ is
    // not configured. The materialization phases (Session 3) always run.
    return null;
  }
  const watermark = await getWatermark(env.DB, tableName);
  return {
    watermark,
    result: {
      ran: true,
      phase: phaseLabel,
      rowsRead: 0,
      rowsExported: 0,
      rowsSkipped: 0,
      errors: 0,
      perPool: makeEmptyPerPool(),
      durationMs: 0,
    },
  };
}

// ── Phase 1 — retired ───────────────────────────────────────────────────────
//
// OSE-2214 (owner, 2026-11-23): the corridor returns export (OSE-1460) is
// gone. It counted phones seen at 2+ events, and OSE counts scans of the code,
// never people. The BigQuery table corridor_returns_export receives nothing
// more; the rounding primitives stay re-exported for the export specs.
export { PUBLISH_ROUNDING, roundForPublish };

// ── Phase 2 — exportCorridorDensityBaseline ────────────────────────────────

interface CorridorBaselineRow {
  corridor_id: string;
  bucket_dow: number;
  bucket_hour: number;
  window_30d_count: number;
  window_90d_count: number;
  computed_at: string;
}

export async function exportCorridorDensityBaseline(
  env: SharedReportExportEnv
): Promise<ExportResult> {
  const start = Date.now();
  const prep = await prepareExport(env, 'corridor_density_baseline', 'corridor_density_baseline');
  if (!prep) {
    return {
      phase: 'corridor_density_baseline',
      rowsRead: 0,
      rowsExported: 0,
      rowsSkipped: 0,
      errors: 0,
      perPool: makeEmptyPerPool(),
      durationMs: Date.now() - start,
    };
  }
  const { watermark, result } = prep;

  try {
    // Read WHOLE computed_at groups (OSE-616). refreshCorridorBaselines stamps
    // every row of a run with one timestamp, and the watermark is that
    // timestamp alone, so a plain LIMIT that cut a group would advance past
    // the unread rest of it — those rows were never exported, and the
    // duplicate-key check below could not see them. Take at least
    // EXPORT_BATCH_SIZE rows, extended to the end of the last timestamp
    // group they reach; the insert below is chunked to BigQuery's batch limit.
    const rows = await env.DB.prepare(
      `SELECT corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at
       FROM corridor_density_baseline
       WHERE computed_at > ?1
         AND computed_at <= COALESCE(
           (SELECT computed_at FROM corridor_density_baseline
             WHERE computed_at > ?1
             ORDER BY computed_at ASC
             LIMIT 1 OFFSET ?2),
           '9999-12-31T23:59:59.999Z')
       ORDER BY computed_at ASC`
    )
      .bind(watermark, EXPORT_BATCH_SIZE - 1)
      .all<CorridorBaselineRow>();

    const sourceRows = rows.results ?? [];
    result.rowsRead = sourceRows.length;
    if (sourceRows.length === 0) {
      await advanceWatermark(env.DB, 'corridor_density_baseline', watermark, 0);
      result.durationMs = Date.now() - start;
      return result;
    }

    // Per design doc S4-Q3 v1 simplification: corridor baselines route to
    // the 'general' pool because they're cross-event aggregates not tied
    // to any individual event's regulatory phase. Documented for revisit
    // if a HIPAA/COPPA corridor surfaces a routing issue.
    const pool: RegulatoryPool = 'general';
    const dataset = datasetForPool(pool, env.WORKER_ENV);

    let maxComputedAt = watermark;
    const batch: Record<string, unknown>[] = [];
    for (const r of sourceRows) {
      if (r.computed_at > maxComputedAt) maxComputedAt = r.computed_at;
      // ADR-011: a corridor baseline is keyed by the corridor, the res7 node.
      // A row keyed by anything that is not H3-shaped (a legacy named
      // corridors.id) is not a corridor baseline. Withhold it, never export
      // it as 'unknown': several such rows in one bucket would all become
      // 'unknown' with the same computed_at, collide on insertId and be
      // silently deduplicated by BigQuery while counted here as exported.
      // An H3-shaped key still goes through, so the row guard judges it.
      const corridorId = canonicalCorridorId(r.corridor_id);
      if (corridorId === UNKNOWN_CORRIDOR) {
        result.rowsSkipped++;
        continue;
      }
      // The counts are sums of published poster figures (OSE-1784; distinct
      // people before 2026-11-23). The read path publishes them through
      // this same call (OSE-1751): a window under CORRIDOR_BASELINE_MIN_SAMPLE is
      // suppressed, and the pair is a chain (90d ⊇ 30d), so 90d − 30d never names
      // a group under K. A row with nothing left to say is withheld.
      const { window_90d: w90, window_30d: w30 } = floorCorridorBaseline(
        r.window_90d_count,
        r.window_30d_count
      );
      if (w90 === null && w30 === null) {
        result.rowsSkipped++;
        continue;
      }
      const tags = {
        // Sentinel values for required tags that don't apply to corridor
        // aggregates. assertRequiredTags accepts any non-empty string.
        corridor_id: corridorId,
        venue_id: 'corridor-aggregate',
        event_type: 'corridor-aggregate',
        uec_code: 'corridor-aggregate',
        regulatory_pool: pool,
        product_id: PRODUCT_ID,
      };
      assertRequiredTags(tags);
      emitRow(
        batch,
        {
          ...tags,
          bucket_dow: r.bucket_dow,
          bucket_hour: r.bucket_hour,
          window_30d_count: w30,
          window_90d_count: w90,
          computed_at: r.computed_at,
          exported_at: new Date().toISOString(),
        },
        result
      );
    }

    if (batch.length > 0) {
      const insertIdFn = (row: Record<string, unknown>): string =>
        `cdb-${String(row.computed_at)}-${String(row.corridor_id)}-${String(row.bucket_dow)}-${String(row.bucket_hour)}`;
      // Two source rows that canonicalize to one corridor (e.g. a legacy
      // uppercase spelling beside the lowercase key) would share an insertId,
      // and BigQuery would keep one while this phase counted both. Fail the
      // phase closed instead (no watermark advance). The next baseline refresh
      // regroups by the lowercased cell and deletes the other spelling.
      const seen = new Set<string>();
      for (const row of batch) {
        const id = insertIdFn(row);
        if (seen.has(id)) {
          throw new Error(
            `duplicate canonical corridor baseline key ${id}: two source rows map to one corridor`
          );
        }
        seen.add(id);
      }
      // A whole timestamp group can exceed one insertAll call, so chunk it.
      // Delivery is AT-LEAST-ONCE: after a mid-group failure the watermark is
      // held and the next run re-sends the whole group. insertIds are
      // content-derived, but BigQuery's insertId de-duplication is best-effort
      // (about a minute), so a later retry can land duplicate rows. Readers
      // dedupe on the natural key (corridor_id, bucket_dow, bucket_hour,
      // computed_at); exactly-once delivery is a separate story (OSE-1462).
      let exported = 0;
      for (let i = 0; i < batch.length; i += BQ_INSERT_CHUNK) {
        const res = await bigQueryInsertRowsToDataset(
          env,
          dataset,
          BQ_TABLE_CORRIDOR_DENSITY,
          batch.slice(i, i + BQ_INSERT_CHUNK),
          insertIdFn
        );
        exported += res.rowCount;
      }
      result.rowsExported = exported;
      result.perPool[pool] = exported;
    }

    await advanceWatermark(env.DB, 'corridor_density_baseline', maxComputedAt, result.rowsExported);
  } catch (err) {
    result.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_EXPORT_ERROR',
        phase: 'corridor_density_baseline',
        error: errorLabel(err),
      })
    );
    try {
      await markFailed(env.DB, 'corridor_density_baseline', msg);
    } catch {
      // ignore
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ── Phase 3 — exportEventSeries ────────────────────────────────────────────

interface EventSeriesJoinRow {
  id: string;
  venue_id: string;
  series_name: string;
  cadence: string | null;
  day_of_week: number | null;
  hour_of_day: number | null;
  state: string;
  confirmed_at: string | null;
  updated_at: string;
  legal_clearance_tier: number | null;
  corridor_id: string | null;
  event_type_id: string | null;
  uec_code: string | null;
}

export async function exportEventSeries(env: SharedReportExportEnv): Promise<ExportResult> {
  const start = Date.now();
  const prep = await prepareExport(env, 'event_series', 'event_series');
  if (!prep) {
    return {
      phase: 'event_series',
      rowsRead: 0,
      rowsExported: 0,
      rowsSkipped: 0,
      errors: 0,
      perPool: makeEmptyPerPool(),
      durationMs: Date.now() - start,
    };
  }
  const { watermark, result } = prep;

  try {
    // Only `confirmed` rows are useful for analytics. `pending` and
    // `rejected` are internal-to-OSE governance and don't export.
    const rows = await env.DB.prepare(
      `SELECT
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
       LIMIT ?`
    )
      .bind(watermark, EXPORT_BATCH_SIZE)
      .all<EventSeriesJoinRow>();

    const sourceRows = rows.results ?? [];
    result.rowsRead = sourceRows.length;
    if (sourceRows.length === 0) {
      await advanceWatermark(env.DB, 'event_series', watermark, 0);
      result.durationMs = Date.now() - start;
      return result;
    }

    // Only the 'general' pool exists — HIPAA/COPPA are declined (OSE-1220).
    const byPool: Record<RegulatoryPool, Record<string, unknown>[]> = {
      general: [],
    };
    let maxUpdatedAt = watermark;
    for (const r of sourceRows) {
      if (r.updated_at > maxUpdatedAt) maxUpdatedAt = r.updated_at;
      const pool = resolvePoolFailClosed(r.legal_clearance_tier, r.id ?? null, result);
      if (pool === null) continue; // fail closed: withhold unclassifiable rows
      const tags = {
        corridor_id: canonicalCorridorId(r.corridor_id),
        venue_id: r.venue_id,
        event_type: r.uec_code ?? 'unknown',
        uec_code: r.uec_code ?? 'unknown',
        regulatory_pool: pool,
        product_id: PRODUCT_ID,
      };
      assertRequiredTags(tags);
      emitRow(
        byPool[pool],
        {
          ...tags,
          id: r.id,
          series_name: r.series_name,
          cadence: r.cadence,
          day_of_week: r.day_of_week,
          hour_of_day: r.hour_of_day,
          state: r.state,
          confirmed_at: r.confirmed_at,
          updated_at: r.updated_at,
          exported_at: new Date().toISOString(),
        },
        result
      );
    }

    for (const pool of REGULATORY_POOLS) {
      const batch = byPool[pool];
      if (batch.length === 0) continue;
      const insertIdFn = (row: Record<string, unknown>): string =>
        `es-${String(row.updated_at)}-${String(row.id)}`;
      const res = await bigQueryInsertRowsToDataset(
        env,
        datasetForPool(pool, env.WORKER_ENV),
        BQ_TABLE_EVENT_SERIES,
        batch,
        insertIdFn
      );
      result.rowsExported += res.rowCount;
      result.perPool[pool] = res.rowCount;
    }

    await advanceWatermark(env.DB, 'event_series', maxUpdatedAt, result.rowsExported);
  } catch (err) {
    result.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_EXPORT_ERROR',
        phase: 'event_series',
        error: errorLabel(err),
      })
    );
    try {
      await markFailed(env.DB, 'event_series', msg);
    } catch {
      // ignore
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}
