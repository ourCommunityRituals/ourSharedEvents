/**
 * BigQuery admin handlers (OSE-215 / BE-19)
 *
 * POST /api/v2/admin/events/:id/backup
 *   On-demand BigQuery backup of a single event + its sponsor count
 *   + form submission count. Admin auth required (caller guards).
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
