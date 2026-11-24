/**
 * OSE-2216: weekly corridor flow export to BigQuery (the NCR layers' history).
 *
 * Contract: OCR-docs `docs/architecture/OCR_ARCHITECTURE_oerAggregationBoundary.md`
 * section 4.1.2 (approved and merged by the PO, OCR-docs #185, 2026-11-24).
 *
 * One row per week × source corridor × destination corridor × event type:
 * scans on posters hung in one res-7 corridor for events in another (or the
 * same) res-7 corridor. ourEventRings reads rows of exactly this shape to draw
 * the Node, Corridor and Ring layers (OSE-2215).
 *
 * The rules this file keeps (numbers are the section 4.1.2 rules):
 *
 *   1. Fields: week, source_cell, destination_cell, uec_code, scans, plus the
 *      pool tags every OER row carries (pool-contract.ts). corridor_id is the
 *      source cell and venue_id the 'corridor-aggregate' sentinel, so the tags
 *      add no information.
 *   2. Corridor grain on both ends: both cells are res-7, and every row passes
 *      assertCorridorGrainRow, which throws on anything finer (the run then
 *      fails closed).
 *   3. Scans on posters only: the source is scan_placement_events (a poster id
 *      and an hour). No phone id, cookie, user agent or return is read.
 *      corridor_density_baseline and the returns export are not inputs.
 *   4. Floored from published parts (OSE ADR-026 rule B): a part is one poster
 *      in one hour, as on the admin corridor dashboard (OSE-1656). Each part is
 *      floored before any sum (floorTotalOfParts), a row under 5 is withheld,
 *      and every scans value is rounded down to a multiple of 5.
 *   5. Append only: a week is sent once, after it has ended, and never again.
 *      A week marker row says the week was processed even when it holds no
 *      flow, so OER can tell an empty week from a missing one.
 *
 * Production events only (data_class = 'production'): test and demo traffic
 * never reaches the research dataset.
 *
 * Cron-only: called from runSharedReportBigQueryExport, never from a route.
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
import { floorTotalOfParts } from './count-floor';
import { assertCorridorGrainRow, isCorridorId, UNKNOWN_CORRIDOR } from './export-geography';
import { scanHourSql } from './scan-cells';
import { errorLabel } from './error-label';

export type CorridorFlowExportEnv = BigQueryEnv & { DB: D1Database };

/** The BigQuery table, one per pool dataset (bigquery/corridor_flow_export.schema.json). */
export const BQ_TABLE_CORRIDOR_FLOW = 'corridor_flow_export';

/**
 * Export-state row: last_exported_at holds the Monday (UTC, "YYYY-MM-DD") of the
 * last week sent. The epoch value means no week has been sent yet.
 */
export const CORRIDOR_FLOW_STATE = 'corridor_flow_week';

const EPOCH = '1970-01-01T00:00:00.000Z';

/** Weeks sent in one night at most, so a first run over a long history is bounded. */
export const CORRIDOR_FLOW_MAX_WEEKS_PER_RUN = 8;

/**
 * Parts (poster × hour × corridor pair × type) read for one week at most. A
 * week holding more fails closed: nothing of it is sent, and it is retried.
 */
export const CORRIDOR_FLOW_MAX_PARTS = 50_000;

/** BigQuery tabledata.insertAll rows per request (cloud/bigquery.ts MAX_ROWS_PER_BATCH). */
const BQ_INSERT_CHUNK = 500;

/** A uec_code as migration 0024 writes it (CLUSTER-TYPE-NNN, e.g. REC-BOCCE-001). */
const UEC_CODE = /^[A-Z]{3}-[A-Z0-9]+-\d{3}$/;

const DAY_MS = 86_400_000;

export interface CorridorFlowExportResult {
  phase: 'corridor_flows';
  rowsRead: number;
  rowsExported: number;
  rowsSkipped: number;
  errors: number;
  perPool: Record<RegulatoryPool, number>;
  durationMs: number;
  ran?: boolean;
  corridorIdPresent?: number;
  corridorIdUnknown?: number;
  /** Weeks completed this run (each with its markers sent). */
  weeksExported?: number;
}

/** The Monday (UTC) that starts the week holding `d`, as "YYYY-MM-DD". */
export function weekStartOf(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return new Date(day.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

interface FlowPart {
  source_cell: string | null;
  destination_cell: string | null;
  uec_code: string | null;
  legal_clearance_tier: number | null;
  scans: number;
}

function emptyResult(): CorridorFlowExportResult {
  return {
    phase: 'corridor_flows',
    rowsRead: 0,
    rowsExported: 0,
    rowsSkipped: 0,
    errors: 0,
    perPool: Object.fromEntries(REGULATORY_POOLS.map((p) => [p, 0])) as Record<
      RegulatoryPool,
      number
    >,
    durationMs: 0,
  };
}

/** Thrown when another invocation claimed the same week first. */
class WeekClaimLost extends Error {
  constructor() {
    super('corridor flow week already claimed by another run');
  }
}

async function readState(db: D1Database): Promise<string> {
  const row = await db
    .prepare(`SELECT last_exported_at FROM bigquery_export_state WHERE table_name = ?`)
    .bind(CORRIDOR_FLOW_STATE)
    .first<{ last_exported_at: string }>();
  if (row) return row.last_exported_at;
  await db
    .prepare(
      `INSERT OR IGNORE INTO bigquery_export_state
         (table_name, last_exported_at, last_export_status, last_run_at, updated_at)
       VALUES (?, ?, 'success', datetime('now'), datetime('now'))`
    )
    .bind(CORRIDOR_FLOW_STATE, EPOCH)
    .run();
  return EPOCH;
}

/** Compare-and-set the state row from `from` to `to`; false when it was not `from`. */
async function casState(db: D1Database, from: string, to: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE bigquery_export_state
          SET last_exported_at = ?1, last_run_at = datetime('now'), updated_at = datetime('now')
        WHERE table_name = ?2 AND last_exported_at = ?3`
    )
    .bind(to, CORRIDOR_FLOW_STATE, from)
    .run();
  return (res.meta?.changes ?? 0) === 1;
}

async function markState(
  db: D1Database,
  status: 'success' | 'failed',
  rows: number,
  error: string | null
): Promise<void> {
  await db
    .prepare(
      `UPDATE bigquery_export_state
          SET last_export_status = ?1,
              last_error = ?2,
              rows_exported_lifetime = rows_exported_lifetime + ?3,
              last_run_at = datetime('now'),
              updated_at = datetime('now')
        WHERE table_name = ?4`
    )
    .bind(status, error ? error.slice(0, 1000) : null, rows, CORRIDOR_FLOW_STATE)
    .run();
}

/**
 * The flow parts of one week: one row per poster, hour, corridor pair, event
 * type and clearance tier. A poster has one event, so one destination, type
 * and tier; the poster and the hour are grouped on and never selected, so no
 * placement reference leaves this query.
 */
const WEEK_PARTS_SQL = `SELECT LOWER(pd.h3_res7) AS source_cell,
            LOWER(e.h3_res7) AS destination_cell,
            etr.uec_code AS uec_code,
            e.legal_clearance_tier AS legal_clearance_tier,
            COUNT(*) AS scans
       FROM scan_placement_events s
       JOIN events e ON e.id = s.event_id
       JOIN poster_deployments pd ON pd.id = s.poster_deployment_id
       LEFT JOIN event_type_registry etr ON etr.id = e.event_type_id
      WHERE e.data_class = 'production'
        AND pd.h3_res7 IS NOT NULL
        AND e.h3_res7 IS NOT NULL
        AND s.scan_bucket >= ?1
        AND s.scan_bucket < ?2
      GROUP BY s.poster_deployment_id, ${scanHourSql('s')}, 1, 2, 3, 4
      LIMIT ?3`;

/** The first day any production poster scan was kept, or null when there is none. */
async function firstScanDay(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MIN(substr(s.scan_bucket, 1, 10)) AS d
         FROM scan_placement_events s
         JOIN events e ON e.id = s.event_id
        WHERE e.data_class = 'production'`
    )
    .first<{ d: string | null }>();
  return row?.d ?? null;
}

/** Build the rows of one week, per pool. Pure apart from logging. */
export function buildWeekRows(
  week: string,
  parts: readonly FlowPart[],
  computedAt: string,
  result: CorridorFlowExportResult
): Record<RegulatoryPool, Record<string, unknown>[]> {
  const groups = new Map<
    string,
    {
      pool: RegulatoryPool;
      source: string;
      destination: string;
      uec: string;
      parts: number[];
    }
  >();
  for (const p of parts) {
    let pool: RegulatoryPool;
    try {
      pool = phaseToPool(p.legal_clearance_tier);
    } catch (e) {
      if (!(e instanceof PoolRoutingError)) throw e;
      // Fail closed (OSE-380): a part that cannot be classified is withheld
      // from every pool, never sent to the least protected one.
      result.rowsSkipped++;
      continue;
    }
    // Both ends must be real corridors, and the type a real event type: a row
    // keyed 'unknown' would merge unrelated traffic under one key.
    if (
      !isCorridorId(p.source_cell) ||
      !isCorridorId(p.destination_cell) ||
      typeof p.uec_code !== 'string' ||
      !UEC_CODE.test(p.uec_code)
    ) {
      result.rowsSkipped++;
      continue;
    }
    const source = p.source_cell as string;
    const destination = p.destination_cell as string;
    const key = `${pool}|${source}|${destination}|${p.uec_code}`;
    const g = groups.get(key) ?? { pool, source, destination, uec: p.uec_code, parts: [] };
    g.parts.push(Number(p.scans) || 0);
    groups.set(key, g);
  }

  const byPool = Object.fromEntries(REGULATORY_POOLS.map((p) => [p, []])) as unknown as Record<
    RegulatoryPool,
    Record<string, unknown>[]
  >;
  const sorted = [...groups.values()].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.destination.localeCompare(b.destination) ||
      a.uec.localeCompare(b.uec)
  );
  for (const g of sorted) {
    // ADR-026 rule B: each poster-hour is floored before the sum, the sum is
    // floored again, and the published value is rounded down to 5.
    const scans = floorTotalOfParts(g.parts);
    if (scans.count === null) {
      // A flow under the floor is left out entirely: even listing the pair
      // would say someone scanned from that corridor to that one.
      result.rowsSkipped++;
      continue;
    }
    const tags = {
      corridor_id: g.source,
      venue_id: 'corridor-aggregate',
      event_type: g.uec,
      uec_code: g.uec,
      regulatory_pool: g.pool,
      product_id: PRODUCT_ID,
    };
    assertRequiredTags(tags);
    const row = {
      ...tags,
      row_type: 'flow',
      week,
      source_cell: g.source,
      destination_cell: g.destination,
      scans: scans.count,
      computed_at: computedAt,
      exported_at: computedAt,
    };
    assertCorridorGrainRow(row);
    result.corridorIdPresent = (result.corridorIdPresent ?? 0) + 1;
    byPool[g.pool].push(row);
  }
  return byPool;
}

function weekMarker(
  week: string,
  pool: RegulatoryPool,
  flows: number,
  computedAt: string
): Record<string, unknown> {
  const tags = {
    corridor_id: UNKNOWN_CORRIDOR,
    venue_id: 'corridor-aggregate',
    event_type: 'week',
    uec_code: 'week',
    regulatory_pool: pool,
    product_id: PRODUCT_ID,
  };
  assertRequiredTags(tags);
  const marker = {
    ...tags,
    row_type: 'week',
    week,
    flows_in_week: flows,
    computed_at: computedAt,
    exported_at: computedAt,
  };
  assertCorridorGrainRow(marker);
  return marker;
}

/**
 * Send every complete week not yet sent, oldest first, at most
 * CORRIDOR_FLOW_MAX_WEEKS_PER_RUN a night. A week is complete once its Sunday
 * has ended (UTC), so the week just ended goes out on Monday's run.
 *
 * Each week is claimed (compare-and-set on the state row) before its first
 * insert, so two overlapping invocations never both send it. If sending fails
 * the claim is handed back, and the next night sends the same week again with
 * the same insertIds (BigQuery de-duplicates retries within its window;
 * readers de-duplicate on week, cells, type and pool).
 */
export async function exportCorridorFlows(
  env: CorridorFlowExportEnv,
  // Test seam only: the clock and the bounds. Production uses the defaults.
  opts: { now?: Date; maxWeeks?: number; maxParts?: number } = {}
): Promise<CorridorFlowExportResult> {
  const start = Date.now();
  const result = emptyResult();
  if (!isBigQueryConfigured(env)) {
    result.durationMs = Date.now() - start;
    return result;
  }
  result.ran = true;
  result.weeksExported = 0;
  const now = opts.now ?? new Date();
  const maxWeeks = opts.maxWeeks ?? CORRIDOR_FLOW_MAX_WEEKS_PER_RUN;
  const maxParts = opts.maxParts ?? CORRIDOR_FLOW_MAX_PARTS;
  const thisWeek = weekStartOf(now);

  let claimedWeek: string | null = null;
  let previous: string | null = null;
  try {
    let last = await readState(env.DB);
    let next: string;
    if (last === EPOCH) {
      const first = await firstScanDay(env.DB);
      if (first === null) {
        result.durationMs = Date.now() - start;
        return result;
      }
      next = weekStartOf(new Date(`${first}T00:00:00.000Z`));
    } else {
      next = addDays(last, 7);
    }

    for (let i = 0; i < maxWeeks && next < thisWeek; i++) {
      const week = next;
      const end = addDays(week, 7);
      const rows = await env.DB.prepare(WEEK_PARTS_SQL)
        .bind(week, end, maxParts + 1)
        .all<FlowPart>();
      const parts = rows.results ?? [];
      if (parts.length > maxParts) {
        throw new Error(`week ${week} holds more than ${maxParts} flow parts; nothing sent`);
      }
      result.rowsRead += parts.length;
      const computedAt = new Date(now.getTime()).toISOString();
      const byPool = buildWeekRows(week, parts, computedAt, result);

      // Claim the week before anything of it can reach BigQuery.
      if (!(await casState(env.DB, last, week))) throw new WeekClaimLost();
      claimedWeek = week;
      previous = last;

      for (const pool of REGULATORY_POOLS) {
        const batch = byPool[pool];
        const dataset = datasetForPool(pool, env.WORKER_ENV);
        const insertId = (row: Record<string, unknown>): string =>
          `cf-${week}-${String(row.source_cell)}-${String(row.destination_cell)}-${String(row.uec_code)}-${pool}`;
        for (let j = 0; j < batch.length; j += BQ_INSERT_CHUNK) {
          const res = await bigQueryInsertRowsToDataset(
            env,
            dataset,
            BQ_TABLE_CORRIDOR_FLOW,
            batch.slice(j, j + BQ_INSERT_CHUNK),
            insertId
          );
          result.rowsExported += res.rowCount;
          result.perPool[pool] += res.rowCount;
        }
        // The marker goes last: a week with a marker is complete.
        await bigQueryInsertRowsToDataset(
          env,
          dataset,
          BQ_TABLE_CORRIDOR_FLOW,
          [weekMarker(week, pool, batch.length, computedAt)],
          () => `cf-${week}-week-${pool}`
        );
        result.corridorIdUnknown = (result.corridorIdUnknown ?? 0) + 1;
      }

      claimedWeek = null;
      previous = null;
      result.weeksExported++;
      last = week;
      next = end;
    }
    await markState(env.DB, 'success', result.rowsExported, null);
  } catch (err) {
    if (err instanceof WeekClaimLost) {
      // Another invocation is sending this week. This run sent nothing of it.
      result.durationMs = Date.now() - start;
      return result;
    }
    result.errors++;
    console.error(
      JSON.stringify({
        type: 'SHARED_REPORT_EXPORT_ERROR',
        phase: 'corridor_flows',
        error: errorLabel(err),
      })
    );
    try {
      // Hand the claim back so the next night sends the week again.
      if (claimedWeek !== null && previous !== null) {
        await casState(env.DB, claimedWeek, previous);
      }
      await markState(
        env.DB,
        'failed',
        result.rowsExported,
        err instanceof Error ? err.message : String(err)
      );
    } catch {
      // Nothing more to do: the next run reads whatever state was kept.
    }
  }
  result.durationMs = Date.now() - start;
  return result;
}
