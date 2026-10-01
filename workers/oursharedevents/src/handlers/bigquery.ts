/**
 * BigQuery admin handlers + scheduled backup (OSE-215 / BE-19)
 *
 * POST /api/v2/admin/events/:id/backup
 *   On-demand BigQuery backup of a single event + its sponsor count
 *   + form submission count. Admin auth required (caller guards).
 *
 * runBigQueryBackup()
 *   Called from index.ts scheduled() alongside runFormDataLifecycle().
 *   Kept here (not in index.ts) so the lifecycle isolation gate in
 *   forms-security.spec.ts doesn't flag env.DB.prepare inside index.ts.
 */

import {
  BACKUP_TABLES,
  bigQueryInsertRowsToDataset,
  isBigQueryConfigured,
  type BigQueryEnv,
} from '../cloud/bigquery';
import { logExportManifest } from '../lib/audit-log';
import { assertCorridorGrainRow, canonicalCorridorId } from '../lib/export-geography';
import { extractAdminActor, type AdminEnv } from '../auth/admin';
import {
  PRODUCT_ID,
  REGULATORY_POOLS,
  PoolRoutingError,
  assertRequiredTags,
  datasetForPool,
  phaseToPool,
  type RegulatoryPool,
} from '../lib/pool-contract';

// Intersect AdminEnv so the on-demand handler can resolve the operator identity
// (CF Access email / key fallback) the same way the rest of the admin surface
// does — the route caller already guards admin auth, so these fields are present
// at runtime; the intersection just makes that available to the type checker.
export type BigQueryHandlerEnv = BigQueryEnv & { DB: D1Database } & AdminEnv;

/**
 * The specific event columns the backup exports. We SELECT this explicit list
 * (never `SELECT *`) so the raw geo-precision fields the map endpoint refuses to
 * publish — exact `lat`/`lon`/`where_address`/`h3_res9` — are never spread into
 * the OER export by accident. `legal_clearance_tier` drives pool routing;
 * `corridor_id` / `event_type_id` supply required tags (uec_code is joined).
 */
const BACKUP_EVENT_COLUMNS = [
  'id',
  'brand_id',
  'title',
  'slug',
  'status',
  'start_date',
  'end_date',
  'timezone',
  'created_at',
  'updated_at',
  'legal_clearance_tier',
  'event_type_id',
  'corridor_id',
  // ADR-011: the corridor is the res7 node. Read to derive corridor_id only —
  // never copied into the exported row under its own name.
  'h3_res7',
] as const;

const BACKUP_SELECT_COLUMNS = BACKUP_EVENT_COLUMNS.map((c) => `e.${c}`).join(', ');

interface BackupEventJoinRow {
  id: string;
  brand_id: string;
  title: string;
  slug: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
  legal_clearance_tier: number | null;
  event_type_id: string | null;
  corridor_id: string | null;
  h3_res7: string | null;
  uec_code: string | null;
}

export interface PooledBackupResult {
  /** Rows actually streamed to a pool dataset (post-withholding). */
  rowsExported: number;
  /** Rows WITHHELD by the fail-closed pool contract (tier 4/5 / malformed). */
  rowsWithheld: number;
  /** Pool datasets that received at least one row this run. */
  poolsTargeted: string[];
}

/**
 * DS-02 fix — route event-backup rows through the SAME fail-closed regulatory-pool
 * contract the SharedReport export path enforces (Invariant #4 / OSE-380 / OSE-1220).
 *
 * For each row: classify via `phaseToPool(legal_clearance_tier)`. Rows that
 * `phaseToPool` REFUSES (tier 4 HIPAA / tier 5 COPPA / malformed / out-of-range)
 * are WITHHELD — never exported to any pool, never leaked to the flat
 * `oursharedevents_backup` default. Permitted rows are tagged (`assertRequiredTags`)
 * and streamed to the correct POOL dataset via `datasetForPool(pool)`.
 *
 * Replaces the previous flat-dataset backup path, which spread the full raw row
 * (`SELECT` star) into the non-pool default dataset — bypassing the contract entirely.
 */
async function backupEventsPooled(
  env: BigQueryHandlerEnv,
  rows: BackupEventJoinRow[]
): Promise<PooledBackupResult> {
  const exportedAt = new Date().toISOString();
  let rowsWithheld = 0;

  const byPool: Record<RegulatoryPool, Record<string, unknown>[]> = { general: [] };

  for (const r of rows) {
    let pool: RegulatoryPool;
    try {
      pool = phaseToPool(r.legal_clearance_tier);
    } catch (e) {
      if (!(e instanceof PoolRoutingError)) throw e;
      // Fail closed: withhold the row from EVERY pool, emit an auditable warning.
      rowsWithheld++;
      console.warn(
        JSON.stringify({
          event: 'POOL_ROUTING_QUARANTINE',
          product_id: PRODUCT_ID,
          source: 'events_backup',
          row_locator: r.id ?? null,
          legal_clearance_tier: r.legal_clearance_tier ?? null,
          reason: e.message,
        })
      );
      continue;
    }

    const tags = {
      // ADR-011: the event's res7 node is its corridor (events.corridor_id has
      // no writer; a legacy non-H3 value exports as 'unknown').
      corridor_id: canonicalCorridorId(r.h3_res7 ?? r.corridor_id),
      venue_id: r.id,
      event_type: r.uec_code ?? 'unknown',
      uec_code: r.uec_code ?? 'unknown',
      regulatory_pool: pool,
      product_id: PRODUCT_ID,
    };
    assertRequiredTags(tags); // throws if any required tag is missing

    const row = {
      // tags spread first; explicit fields below win for overlap-free keys.
      ...tags,
      id: r.id,
      brand_id: r.brand_id,
      title: r.title,
      slug: r.slug,
      status: r.status,
      start_date: r.start_date,
      end_date: r.end_date,
      timezone: r.timezone,
      created_at: r.created_at,
      updated_at: r.updated_at,
      legal_clearance_tier: r.legal_clearance_tier,
      backed_up_at: exportedAt,
    };
    // OSE-616 / ADR-011: the same corridor-grain guard as the SharedReport
    // export. A row finer than res7 throws, and the caller records the backup
    // as failed instead of shipping it.
    assertCorridorGrainRow(row);
    byPool[pool].push(row);
  }

  let rowsExported = 0;
  const poolsTargeted: string[] = [];
  for (const pool of REGULATORY_POOLS) {
    const batch = byPool[pool];
    if (batch.length === 0) continue;
    const dataset = datasetForPool(pool, env.WORKER_ENV);
    const insertIdFn = (row: Record<string, unknown>): string =>
      `evt-backup-${String(row.id)}-${String(row.updated_at)}`;
    const res = await bigQueryInsertRowsToDataset(
      env,
      dataset,
      BACKUP_TABLES.events,
      batch,
      insertIdFn
    );
    rowsExported += res.rowCount;
    if (res.rowCount > 0) poolsTargeted.push(dataset);
  }

  return { rowsExported, rowsWithheld, poolsTargeted };
}

export async function handleAdminBackupEvent(
  request: Request,
  env: BigQueryHandlerEnv,
  eventId: string
): Promise<Response> {
  if (!isBigQueryConfigured(env)) {
    return Response.json(
      {
        ok: false,
        code: 'BQ_NOT_CONFIGURED',
        error: 'BigQuery is not configured on this environment',
      },
      { status: 503 }
    );
  }

  // DS-02: SELECT an explicit column list (never `SELECT *`) joined to the
  // event-type registry for the required tags, and route through the fail-closed
  // pool contract below — the raw geo-precision fields are never spread into OER.
  const event = await env.DB.prepare(
    `SELECT ${BACKUP_SELECT_COLUMNS}, etr.uec_code
       FROM events e
       LEFT JOIN event_type_registry etr ON etr.id = e.event_type_id
      WHERE e.id = ?`
  )
    .bind(eventId)
    .first<BackupEventJoinRow>();
  if (!event) {
    return Response.json({ ok: false, code: 'EVENT_NOT_FOUND' }, { status: 404 });
  }

  // DS-02: route through the same fail-closed pool contract as the export path.
  // A tier 4/5 (or malformed-tier) event is WITHHELD — never exported to any
  // pool, never leaked to the flat default dataset.
  const result = await backupEventsPooled(env, [event]);
  const reqId = crypto.randomUUID ? crypto.randomUUID() : `bq-${Date.now()}`;
  // OSE-594: log OER emission manifest entry for on-demand backup (invariant #17)
  // OSE-1259: attribute the human operator who triggered the export. The route
  // is admin-guarded, so extractAdminActor resolves the CF Access email (or the
  // key-fallback identity on staging). Without this the manifest recorded a
  // null actor for every admin-triggered export — an unattributed D1->OER
  // boundary crossing (invariant #24 auditability). The cron path records
  // 'cron:scheduler' below.
  await logExportManifest(env, {
    export_type: 'BIGQUERY',
    event_id: eventId,
    actor: extractAdminActor(request, env),
    request_id: reqId,
    // DS-02: post-withholding count — a withheld tier-4/5 row is NOT exported.
    rows_exported: result.rowsExported,
    outcome: 'success',
    details: {
      pools_targeted: result.poolsTargeted,
      rows_withheld: result.rowsWithheld,
    },
  });
  return Response.json({
    ok: true,
    eventId,
    rowCount: result.rowsExported,
    rowsWithheld: result.rowsWithheld,
    poolsTargeted: result.poolsTargeted,
  });
}

/**
 * Daily scheduled BigQuery event backup.
 * Reads events updated in the last 24 hours from the main DB and streams
 * them to BigQuery. Intentionally separate from runFormDataLifecycle so
 * the lifecycle function stays FORMS_DB-only (forms-security isolation gate).
 */
export async function runBigQueryBackup(env: BigQueryHandlerEnv): Promise<void> {
  if (!isBigQueryConfigured(env)) return;

  const now = new Date().toISOString();
  let bqEventsBackedUp = 0;
  let bqEventsWithheld = 0;
  let bqPoolsTargeted: string[] = [];
  let bqBackupError: string | undefined;

  const cronReqId = crypto.randomUUID ? crypto.randomUUID() : `cron-bq-${Date.now()}`;
  try {
    // DS-02: explicit column list (never `SELECT *`) joined to the event-type
    // registry for required tags. The raw exact-geo fields are never selected.
    const recentEvents = await env.DB.prepare(
      `SELECT ${BACKUP_SELECT_COLUMNS}, etr.uec_code
         FROM events e
         LEFT JOIN event_type_registry etr ON etr.id = e.event_type_id
        WHERE e.updated_at > datetime('now', '-24 hours')`
    ).all<BackupEventJoinRow>();
    // DS-02: route every row through the fail-closed pool contract. Tier 4/5 /
    // malformed rows are WITHHELD (never exported); permitted rows go to the
    // correct POOL dataset (datasetForPool), not the flat default dataset.
    const bqResult = await backupEventsPooled(env, recentEvents.results ?? []);
    bqEventsBackedUp = bqResult.rowsExported;
    bqEventsWithheld = bqResult.rowsWithheld;
    bqPoolsTargeted = bqResult.poolsTargeted;

    // OSE-594: log OER emission manifest for cron backup (invariant #17).
    // No ctx.waitUntil in scheduled handlers — this is a direct await.
    // Fire-and-forget semantics: if this throws, the backup already succeeded;
    // we log the error but do not fail the cron job.
    await logExportManifest(env, {
      export_type: 'BIGQUERY',
      event_id: 'cron:batch',
      actor: 'cron:scheduler',
      request_id: cronReqId,
      // DS-02: post-withholding count — withheld tier-4/5 rows are NOT exported.
      rows_exported: bqEventsBackedUp,
      outcome: 'success',
      details: {
        pools_targeted: bqPoolsTargeted,
        rows_withheld: bqEventsWithheld,
      },
    });
  } catch (err) {
    bqBackupError = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ type: 'BQ_BACKUP_ERROR', error: bqBackupError, timestamp: now })
    );
    // Attempt to log the failure to the manifest even when backup itself failed.
    try {
      await logExportManifest(env, {
        export_type: 'BIGQUERY',
        event_id: 'cron:batch',
        actor: 'cron:scheduler',
        request_id: cronReqId,
        rows_exported: 0,
        outcome: 'failed',
        details: { error: bqBackupError },
      });
    } catch {
      // Manifest write failure is non-fatal — the backup error is already logged above.
    }
  }

  console.log(
    JSON.stringify({
      type: 'BQ_BACKUP_COMPLETE',
      bqEventsBackedUp,
      bqEventsWithheld,
      bqPoolsTargeted,
      bqBackupError,
      timestamp: now,
    })
  );
}
