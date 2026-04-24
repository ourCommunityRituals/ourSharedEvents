/**
 * OSE-212 / SEC-6 — Admin audit log helpers
 *
 * Fire-and-forget: always call via ctx.waitUntil() so writes never block the response.
 *
 * Write failures are swallowed and logged to console only. CF Access + Cloudflare
 * request logs are the primary audit trail; this D1 log is an operational layer.
 */

export interface AuditLogEnv {
  DB: D1Database;
}

export interface AuditEntry {
  /** Short uppercase verb, e.g. CREATE_EVENT, DELETE_SPONSOR, APPLY_TIER */
  action: string;
  /** Email (CF Access), 'key:admin' (ADMIN_KEY), 'key:ocr-internal', or null */
  actor: string | null;
  resource_type?: string;
  resource_id?: string;
  request_id: string;
  outcome: 'success' | 'denied';
  ip?: string;
  details?: Record<string, unknown>;
}

export async function logAdminAction(env: AuditLogEnv, entry: AuditEntry): Promise<void> {
  const id = crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}-${Math.random()}`;
  try {
    await env.DB.prepare(
      `INSERT INTO admin_audit_log
         (id, action, actor, resource_type, resource_id, request_id, outcome, ip, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        entry.action,
        entry.actor ?? null,
        entry.resource_type ?? null,
        entry.resource_id ?? null,
        entry.request_id,
        entry.outcome,
        entry.ip ?? null,
        entry.details ? JSON.stringify(entry.details) : null
      )
      .run();
  } catch {
    // Must never propagate — audit failures must not break admin operations
    console.warn(
      JSON.stringify({
        type: 'AUDIT_LOG_WRITE_FAILURE',
        action: entry.action,
        request_id: entry.request_id,
      })
    );
  }
}
