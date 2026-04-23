/**
 * OSE-212 / SEC-6 — Admin audit log read handler
 *
 * GET /api/v2/admin/audit-log
 *   ?limit=<1–100, default 50>
 *   ?cursor=<ISO timestamp — page backward past this point>
 *   ?action=<exact action filter, e.g. CREATE_EVENT>
 *   ?actor=<exact actor filter, e.g. admin@example.com>
 *   ?outcome=success|denied
 *   ?resource_type=<event|sponsor|flag|…>
 */

import type { AuditLogEnv } from '../lib/audit-log';

export type AuditHandlerEnv = AuditLogEnv;

interface AuditRow {
  id: string;
  created_at: string;
  action: string;
  actor: string | null;
  resource_type: string | null;
  resource_id: string | null;
  request_id: string;
  outcome: string;
  ip: string | null;
  details: string | null;
}

export async function handleListAuditLog(
  request: Request,
  env: AuditHandlerEnv
): Promise<Response> {
  const url = new URL(request.url);

  const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
  const cursor = url.searchParams.get('cursor') ?? null;
  const filterAction = url.searchParams.get('action') ?? null;
  const filterActor = url.searchParams.get('actor') ?? null;
  const filterOutcome = url.searchParams.get('outcome') ?? null;
  const filterResourceType = url.searchParams.get('resource_type') ?? null;

  const conditions: string[] = [];
  const bindings: (string | number | null)[] = [];

  if (cursor) {
    conditions.push('created_at < ?');
    bindings.push(cursor);
  }
  if (filterAction) {
    conditions.push('action = ?');
    bindings.push(filterAction);
  }
  if (filterActor) {
    conditions.push('actor = ?');
    bindings.push(filterActor);
  }
  if (filterOutcome === 'success' || filterOutcome === 'denied') {
    conditions.push('outcome = ?');
    bindings.push(filterOutcome);
  }
  if (filterResourceType) {
    conditions.push('resource_type = ?');
    bindings.push(filterResourceType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  bindings.push(limit + 1); // +1 to detect next page

  const sql = `
    SELECT id, created_at, action, actor, resource_type, resource_id,
           request_id, outcome, ip, details
    FROM   admin_audit_log
    ${where}
    ORDER  BY created_at DESC
    LIMIT  ?`;

  const result = await env.DB.prepare(sql)
    .bind(...bindings)
    .all<AuditRow>();

  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].created_at : null;

  // Parse details JSON if present
  const entries = page.map((row) => ({
    ...row,
    details: row.details
      ? (() => {
          try {
            return JSON.parse(row.details!);
          } catch {
            return null;
          }
        })()
      : null,
  }));

  return Response.json({
    ok: true,
    entries,
    pagination: { limit, hasMore, nextCursor },
  });
}
