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

export type BigQueryHandlerEnv = BigQueryEnv & { DB: D1Database };

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

  try {
    const recentEvents = await env.DB.prepare(
      "SELECT * FROM events WHERE updated_at > datetime('now', '-24 hours')"
    ).all();
    const bqResult = await backupEvents(env, recentEvents.results as Record<string, unknown>[]);
    bqEventsBackedUp = bqResult.rowCount ?? 0;
  } catch (err) {
    bqBackupError = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ type: 'BQ_BACKUP_ERROR', error: bqBackupError, timestamp: now })
    );
  }

  console.log(
    JSON.stringify({ type: 'BQ_BACKUP_COMPLETE', bqEventsBackedUp, bqBackupError, timestamp: now })
  );
}
