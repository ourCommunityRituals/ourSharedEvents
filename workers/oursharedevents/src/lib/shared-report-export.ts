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
 *     aggregates through; Phase 1 aggregates per-person return rows into
 *     k-floored corridor counts first, so no per-person row ever leaves
 *     (OSE-1460).
 *
 * Library shape:
 *
 *   exportAnonIdReturns(env)             — Phase 1 of the export tick.
 *     When anon_id_returns changed past the watermark, snapshots return
 *     COUNTS per corridor × event type × pool over RETURNS_WINDOW_DAYS,
 *     k-floored at RETURNS_MIN_COUNT (OSE-1460: no per-person row, no
 *     anon_id_hash, no venue leaves); streams to per-pool dataset.
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

import { pepperEpoch } from './anon-id-hash';
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
import { CORRIDOR_BASELINE_MIN_SAMPLE, CORRIDOR_MAP_MIN_COUNT } from './shared-report';
import { floorNestedCounts } from './count-floor';
import {
  assertCorridorGrainRow,
  canonicalCorridorId,
  isCorridorId,
  UNKNOWN_CORRIDOR,
} from './export-geography';

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
  /**
   * OSE-1460: snapshot marker rows written (one per pool per run). Not counted
   * in rowsExported: a marker is not data, it tells OER which snapshot is current.
   */
  snapshotMarkers?: number;
  /** Returns phase only: false when no weekly snapshot was due this run. */
  snapshotDue?: boolean;
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
/** OSE-1460: counts per corridor; replaces the old per-person returns table. */
const BQ_TABLE_CORRIDOR_RETURNS = 'corridor_returns_export';
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
        reason: e.message,
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

// ── Phase 1 — exportAnonIdReturns (corridor return counts) ─────────────────
//
// OSE-1460 (PO decision 2026-10-01): no per-person row crosses to OER. Before,
// this phase sent one row per (anon_id_hash, venue) with first/last seen and
// a visit count: a pseudonymous longitudinal record, against the aggregate-only
// boundary (OCR_ARCHITECTURE_oerAggregationBoundary.md: never emit anon_id;
// corridor-level location only). It now sends counts per corridor, event type
// and pool over a rolling window, and nothing below RETURNS_MIN_COUNT.
//
// One person is counted once per (corridor, event type, pool): tiers that share
// a pool are one group. A return means they were seen at 2+ distinct events. The venue never
// leaves: venue_id carries the 'corridor-aggregate' sentinel, the same one the
// corridor baseline uses, so the required-tag contract is unchanged.

/** Rolling window the return counts cover, in days. */
export const RETURNS_WINDOW_DAYS = 90;
/** A group, or a count inside it, below this is never exported (k-floor). */
export const RETURNS_MIN_COUNT = CORRIDOR_MAP_MIN_COUNT;
/**
 * Every published count is rounded down to a multiple of this before the
 * floors apply (PO decision 2026-10-01). A snapshot is compared with the last
 * one, so an exact count would show a one-person change between them (12 then
 * 13); rounded, small changes disappear inside a step of 5, and a change that
 * crosses a step never says how many people moved.
 */
export const PUBLISH_ROUNDING = CORRIDOR_MAP_MIN_COUNT;
/** A count rounded down to a multiple of PUBLISH_ROUNDING. */
export function roundForPublish(n: number): number {
  const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return v - (v % PUBLISH_ROUNDING);
}
/**
 * The returns snapshot is weekly, not nightly (PO decision 2026-10-01): fewer
 * snapshots to compare. A run takes one only when the last successful snapshot
 * is at least this old; the 12-hour slack keeps a daily cron from slipping a
 * day on a few minutes of jitter, and a failed run is retried the next night.
 */
export const RETURNS_SNAPSHOT_INTERVAL_MS = 7 * 86_400_000 - 12 * 3_600_000;
/** Export-state row that records when the last returns snapshot succeeded. */
export const RETURNS_SNAPSHOT_STATE = 'corridor_returns_snapshot';
/**
 * Export-state row that records when a returns snapshot last began publishing.
 * It is written before the first BigQuery insert of a run, so a run that fails
 * after sending some rows (or whose success write fails) still uses up its week:
 * the next night must not publish a second snapshot a day after the first.
 */
export const RETURNS_SNAPSHOT_CLAIM_STATE = 'corridor_returns_snapshot_claim';
/** Groups read per page of the snapshot query. */
export const RETURNS_PAGE_SIZE = 500;
/** Page bound: a snapshot larger than this fails closed (no marker) rather than run unbounded. */
export const RETURNS_MAX_PAGES = 200;

/**
 * The pool a clearance tier exports to, in SQL, so the floor applies per pool
 * and not per tier: tiers that share a pool are one group (OSE-1460 review).
 * Mirrors phaseToPool() (pool-contract.ts): NULL and 1–3 are 'general'. Any
 * other tier keeps its own key, and resolvePoolFailClosed quarantines it.
 * tests/shared-report-bigquery-export.spec.ts pins the two against each other.
 */
export const RETURNS_POOL_KEY_SQL = `CASE WHEN e.legal_clearance_tier IS NULL
            OR e.legal_clearance_tier IN (1, 2, 3) THEN 'general'
          ELSE 'tier-' || e.legal_clearance_tier END`;

interface CorridorReturnsRow {
  corridor_id: string | null;
  legal_clearance_tier: number | null;
  uec_code: string | null;
  people: number;
  returned_2plus: number;
  returned_3plus: number;
  returned_5plus: number;
}

/** Thrown when another invocation won the weekly snapshot claim first. */
class SnapshotClaimLost extends Error {
  constructor() {
    super('returns snapshot already claimed by another run');
  }
}

export async function exportAnonIdReturns(
  env: SharedReportExportEnv,
  // Test seam only: paging limits and the clock. Production uses the defaults.
  limits: { pageSize?: number; maxPages?: number; now?: Date } = {}
): Promise<ExportResult> {
  const pageSize = limits.pageSize ?? RETURNS_PAGE_SIZE;
  const maxPages = limits.maxPages ?? RETURNS_MAX_PAGES;
  const start = Date.now();
  const prep = await prepareExport(env, 'anon_id_returns', 'anon_id_returns');
  if (!prep) {
    return {
      phase: 'anon_id_returns',
      rowsRead: 0,
      rowsExported: 0,
      rowsSkipped: 0,
      errors: 0,
      perPool: makeEmptyPerPool(),
      durationMs: Date.now() - start,
    };
  }
  const { watermark, result } = prep;

  // Weekly cadence: a run that is not due changes nothing, not even the source
  // watermark, so the next due run sees exactly what this one would have.
  const now = limits.now ?? new Date();
  // The week starts at the later of the last complete snapshot and the last run
  // that began publishing, finished or not (RETURNS_SNAPSHOT_CLAIM_STATE).
  const lastSnapshot = await getWatermark(env.DB, RETURNS_SNAPSHOT_STATE);
  const lastClaim = await getWatermark(env.DB, RETURNS_SNAPSHOT_CLAIM_STATE);
  const sinceLast = now.getTime() - Math.max(Date.parse(lastSnapshot), Date.parse(lastClaim));
  result.snapshotDue = !(sinceLast >= 0 && sinceLast < RETURNS_SNAPSHOT_INTERVAL_MS);
  if (!result.snapshotDue) {
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    // A rolling window changes as rows age out even when nothing new was
    // materialized, so every due run (weekly, above) takes a whole snapshot
    // with its own computed_at. OER reads the latest marked snapshot; a group
    // missing from it has fallen out of the window or under the floor.
    // The watermark only records how far the source has been seen.
    const changed = await env.DB.prepare(
      `SELECT COUNT(*) AS n, MAX(computed_at) AS max_computed_at
         FROM anon_id_returns WHERE computed_at > ?`
    )
      .bind(watermark)
      .first<{ n: number; max_computed_at: string | null }>();
    result.rowsRead = changed?.n ?? 0;
    const nextWatermark = changed?.max_computed_at ?? watermark;

    // One pepper only (migration 0091): after a rotation the same browser has a
    // second hash, so mixing peppers would count one person twice and could lift
    // a group of fewer than five people over the floor. Rows of an older or
    // unknown pepper are not counted; with no pepper configured, nothing is.
    const epoch = await pepperEpoch(env.ANON_ID_HASH_PEPPER);
    // The window's first day, whole: the last_seen_at pre-filter starts at that
    // day's midnight, so a row materialized early on the floor day is not dropped.
    const floorDay = new Date(now.getTime() - RETURNS_WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    // And no later than today: an event rescheduled into the future keeps its
    // earlier rows, but it has not happened in the window, so it is not counted.
    const todayDay = now.toISOString().slice(0, 10);
    // The window is the event's own day (COALESCE(end_date, start_date), as the
    // materializer reads it), not last_seen_at: last_seen_at is when the cron
    // materialized the row, hours after the event and later again on a re-run.
    // The last_seen_at bound stays because it can only be later than the event
    // day, so it is a safe, indexed pre-filter (0090) and never drops a row.
    // A return is a person seen at 2+ distinct events in the corridor. This
    // counts events, not visit_count: the materializer bumps visit_count on
    // every re-run over the same scans, so it is not a return signal.
    // Each run is its own snapshot, identified by its full timestamp: the
    // window moves continuously, so two runs never describe the same data.
    // Retries inside one run reuse this value, so their insertIds dedupe.
    const computedAt = now.toISOString();
    const insertIdFor =
      (pool: RegulatoryPool) =>
      (row: Record<string, unknown>): string =>
        `cr-${String(row.computed_at)}-${String(row.corridor_id)}-${String(row.uec_code)}-${pool}`;
    const groupsInSnapshot: Record<RegulatoryPool, number> = { general: 0 };
    // Claim the week before the first row can reach BigQuery. Lazy, so a run
    // that fails on its D1 reads (nothing sent) is retried the next night; once
    // anything may have been sent, a failure waits for the next week.
    // The claim is a compare-and-set on the value the due check read: of two
    // overlapping invocations that both found the snapshot due, only the one
    // whose UPDATE changes the row publishes; the other stops, having sent nothing.
    let claimed = false;
    const claimSnapshot = async (): Promise<void> => {
      if (claimed) return;
      const res = await env.DB.prepare(
        `UPDATE bigquery_export_state
            SET last_exported_at = ?1, last_run_at = datetime('now'), updated_at = datetime('now')
          WHERE table_name = ?2 AND last_exported_at = ?3`
      )
        .bind(computedAt, RETURNS_SNAPSHOT_CLAIM_STATE, lastClaim)
        .run();
      if ((res.meta?.changes ?? 0) !== 1) throw new SnapshotClaimLost();
      claimed = true;
    };

    // The groups are read a page at a time by a stable key (corridor, pool,
    // type), so neither the D1 result nor this Worker ever holds the whole
    // snapshot, however many corridors and types there are. The page key is
    // applied inside the aggregation, so a later page groups only the keys
    // after the cursor; each page still reads the indexed window. A run that dies
    // part-way has written no marker, so OER keeps reading the last complete
    // snapshot.
    let after: [string, string, string] = ['', '', ''];
    let first = true;
    for (let page = 0; ; page++) {
      const rows = await env.DB.prepare(
        `SELECT * FROM (
           SELECT corridor_id, pool_key, MIN(legal_clearance_tier) AS legal_clearance_tier, uec_code,
                  COALESCE(corridor_id, '') AS k_corridor, COALESCE(uec_code, '') AS k_type,
                  COUNT(*)                                          AS people,
                  SUM(CASE WHEN events_seen >= 2 THEN 1 ELSE 0 END) AS returned_2plus,
                  SUM(CASE WHEN events_seen >= 3 THEN 1 ELSE 0 END) AS returned_3plus,
                  SUM(CASE WHEN events_seen >= 5 THEN 1 ELSE 0 END) AS returned_5plus
             FROM (
               SELECT air.anon_id_hash,
                      -- Lower-cased before grouping: H3 cells are case-insensitive, and
                      -- one cell stored in two cases must be one group under the floor.
                      COALESCE(LOWER(e.h3_res7), e.corridor_id) AS corridor_id,
                      ${RETURNS_POOL_KEY_SQL} AS pool_key,
                      MIN(e.legal_clearance_tier) AS legal_clearance_tier,
                      etr.uec_code,
                      COUNT(DISTINCT air.venue_id) AS events_seen
                 FROM anon_id_returns air
                 JOIN events e ON e.id = air.venue_id
                 LEFT JOIN event_type_registry etr ON etr.id = e.event_type_id
                WHERE air.last_seen_at >= ?1
                  AND substr(COALESCE(e.end_date, e.start_date), 1, 10) >= ?2
                  AND substr(COALESCE(e.end_date, e.start_date), 1, 10) <= ?3
                  AND air.pepper_epoch = ?4
                  -- The page key, applied before both GROUP BYs so each page
                  -- only aggregates the groups still ahead of the cursor.
                  AND (?5 = 1 OR (
                        COALESCE(COALESCE(LOWER(e.h3_res7), e.corridor_id), ''),
                        ${RETURNS_POOL_KEY_SQL},
                        COALESCE(etr.uec_code, '')
                      ) > (?6, ?7, ?8))
                GROUP BY air.anon_id_hash, 2, 3, 5
             )
            GROUP BY corridor_id, pool_key, uec_code
         )
         ORDER BY k_corridor, pool_key, k_type
         LIMIT ?9`
      )
        .bind(
          `${floorDay}T00:00:00.000Z`,
          floorDay,
          todayDay,
          epoch ?? '',
          first ? 1 : 0,
          after[0],
          after[1],
          after[2],
          pageSize
        )
        .all<CorridorReturnsRow & { pool_key: string; k_corridor: string; k_type: string }>();
      const results = rows.results ?? [];
      if (results.length === 0) break;
      // Checked after the fetch, so a snapshot of exactly the cap passes: only
      // a page that actually holds rows beyond the cap fails the run closed.
      if (page >= maxPages) {
        throw new Error(
          `returns snapshot exceeds ${maxPages * pageSize} groups; no marker written`
        );
      }
      const last = results[results.length - 1];
      after = [last.k_corridor, last.pool_key, last.k_type];
      first = false;

      const byPool: Record<RegulatoryPool, Record<string, unknown>[]> = { general: [] };
      for (const r of results) {
        const pool = resolvePoolFailClosed(r.legal_clearance_tier, r.corridor_id, result);
        if (pool === null) continue; // fail closed: withhold unclassifiable groups
        // A group with no real corridor is withheld, never exported as 'unknown'
        // (several would collide on one key), and so is any group under the floor.
        const corridorId = canonicalCorridorId(r.corridor_id);
        if (corridorId === UNKNOWN_CORRIDOR || r.people < RETURNS_MIN_COUNT) {
          result.rowsSkipped++;
          continue;
        }
        // people ⊇ 2+ ⊇ 3+ ⊇ 5+: floored as one chain, so no subtraction of two
        // published counts reveals a group under the floor (people 12, 2+ 9
        // would say 3 came once). The group floor above already holds people.
        // Rounded first, so every published value is a multiple of 5.
        const [peopleOut, ret2, ret3, ret5] = floorNestedCounts(
          [r.people, r.returned_2plus, r.returned_3plus, r.returned_5plus].map(roundForPublish),
          RETURNS_MIN_COUNT,
          RETURNS_MIN_COUNT
        );
        const uec = r.uec_code ?? 'unknown';
        const tags = {
          corridor_id: corridorId,
          venue_id: 'corridor-aggregate',
          event_type: uec,
          uec_code: uec,
          regulatory_pool: pool,
          product_id: PRODUCT_ID,
        };
        assertRequiredTags(tags);
        emitRow(
          byPool[pool],
          {
            ...tags,
            row_type: 'group',
            window_days: RETURNS_WINDOW_DAYS,
            people_count: peopleOut,
            returned_2plus: ret2,
            returned_3plus: ret3,
            returned_5plus: ret5,
            computed_at: computedAt,
            exported_at: now.toISOString(),
          },
          result
        );
      }

      for (const pool of REGULATORY_POOLS) {
        const batch = byPool[pool];
        groupsInSnapshot[pool] += batch.length;
        for (let i = 0; i < batch.length; i += BQ_INSERT_CHUNK) {
          await claimSnapshot();
          const res = await bigQueryInsertRowsToDataset(
            env,
            datasetForPool(pool, env.WORKER_ENV),
            BQ_TABLE_CORRIDOR_RETURNS,
            batch.slice(i, i + BQ_INSERT_CHUNK),
            insertIdFor(pool)
          );
          result.rowsExported += res.rowCount;
          result.perPool[pool] += res.rowCount;
        }
      }
      if (results.length < pageSize) break;
    }

    // One marker per pool per run, written after the groups, so OER can tell
    // which snapshot is current even when it is empty: without it, a run in
    // which every group aged out or fell under the floor would write nothing,
    // and OER would keep reading the previous snapshot as current.
    for (const pool of REGULATORY_POOLS) {
      const markerTags = {
        corridor_id: UNKNOWN_CORRIDOR,
        venue_id: 'corridor-aggregate',
        event_type: 'snapshot',
        uec_code: 'snapshot',
        regulatory_pool: pool,
        product_id: PRODUCT_ID,
      };
      assertRequiredTags(markerTags);
      const marker = {
        ...markerTags,
        row_type: 'snapshot',
        window_days: RETURNS_WINDOW_DAYS,
        groups_in_snapshot: groupsInSnapshot[pool],
        computed_at: computedAt,
        exported_at: now.toISOString(),
      };
      assertCorridorGrainRow(marker);
      await claimSnapshot();
      await bigQueryInsertRowsToDataset(
        env,
        datasetForPool(pool, env.WORKER_ENV),
        BQ_TABLE_CORRIDOR_RETURNS,
        [marker],
        () => `cr-${computedAt}-snapshot-${pool}`
      );
      result.snapshotMarkers = (result.snapshotMarkers ?? 0) + 1;
    }

    await advanceWatermark(env.DB, 'anon_id_returns', nextWatermark, result.rowsExported);
    // Only a complete snapshot (groups and markers sent) starts the next week.
    await advanceWatermark(env.DB, RETURNS_SNAPSHOT_STATE, computedAt, 0);
  } catch (err) {
    if (err instanceof SnapshotClaimLost) {
      // Another invocation claimed this week first and is publishing it. This
      // run sent nothing, so it is not a failure; it is simply not due.
      result.snapshotDue = false;
      result.durationMs = Date.now() - start;
      return result;
    }
    result.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_EXPORT_ERROR',
        phase: 'anon_id_returns',
        error: msg,
      })
    );
    try {
      await markFailed(env.DB, 'anon_id_returns', msg);
    } catch {
      // markFailed itself failed — nothing more we can do.
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}

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
      // The counts are distinct people. Publish them on the read path's rule
      // (a window under CORRIDOR_BASELINE_MIN_SAMPLE is suppressed), and as a
      // chain (90d ⊇ 30d), so 90d − 30d never names a group under K. A row
      // with nothing left to say is withheld.
      const [w90, w30] = floorNestedCounts(
        [r.window_90d_count, r.window_30d_count].map(roundForPublish),
        CORRIDOR_BASELINE_MIN_SAMPLE,
        CORRIDOR_MAP_MIN_COUNT
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
        error: msg,
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
        error: msg,
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
