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

import { backupEvents, isBigQueryConfigured, type BigQueryEnv } from '../cloud/bigquery';
import { logExportManifest } from '../lib/audit-log';
import { extractAdminActor, type AdminEnv } from '../auth/admin';

// Intersect AdminEnv so the on-demand handler can resolve the operator identity
// (CF Access email / key fallback) the same way the rest of the admin surface
// does — the route caller already guards admin auth, so these fields are present
// at runtime; the intersection just makes that available to the type checker.
export type BigQueryHandlerEnv = BigQueryEnv & { DB: D1Database } & AdminEnv;

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

  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?')
    .bind(eventId)
    .first<Record<string, unknown>>();
  if (!event) {
    return Response.json({ ok: false, code: 'EVENT_NOT_FOUND' }, { status: 404 });
  }

  const result = await backupEvents(env, [event]);
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
    rows_exported: result.rowCount ?? 1,
    outcome: 'success',
  });
  return Response.json({ ok: true, eventId, rowCount: result.rowCount });
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
  let bqBackupError: string | undefined;

  const cronReqId = crypto.randomUUID ? crypto.randomUUID() : `cron-bq-${Date.now()}`;
  try {
    const recentEvents = await env.DB.prepare(
      "SELECT * FROM events WHERE updated_at > datetime('now', '-24 hours')"
    ).all();
    const bqResult = await backupEvents(env, recentEvents.results as Record<string, unknown>[]);
    bqEventsBackedUp = bqResult.rowCount ?? 0;

    // OSE-594: log OER emission manifest for cron backup (invariant #17).
    // No ctx.waitUntil in scheduled handlers — this is a direct await.
    // Fire-and-forget semantics: if this throws, the backup already succeeded;
    // we log the error but do not fail the cron job.
    await logExportManifest(env, {
      export_type: 'BIGQUERY',
      event_id: 'cron:batch',
      actor: 'cron:scheduler',
      request_id: cronReqId,
      rows_exported: bqEventsBackedUp,
      outcome: 'success',
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
    JSON.stringify({ type: 'BQ_BACKUP_COMPLETE', bqEventsBackedUp, bqBackupError, timestamp: now })
  );
}
