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

/**
 * Aggregate SharedReport access log (OSE-557).
 *
 * Upserts a daily-grain row per (event_id, role, outcome) — no IP, no
 * sub-window timestamps, no PII. Fire-and-forget; failures are swallowed.
 */
export async function logReportAccess(
  env: AuditLogEnv,
  eventId: string,
  role: string,
  outcome: 'granted' | 'denied'
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const id = crypto.randomUUID ? crypto.randomUUID() : `rpt-${Date.now()}-${Math.random()}`;
  try {
    await env.DB.prepare(
      `INSERT INTO report_access_log (id, date, event_id, role, outcome, access_count)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT (date, event_id, role, outcome) DO UPDATE SET
         access_count = access_count + 1,
         updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
      .bind(id, date, eventId, role, outcome)
      .run();
  } catch {
    console.warn(
      JSON.stringify({ type: 'REPORT_ACCESS_LOG_FAILURE', eventId, role, outcome })
    );
  }
}

/**
 * Append a row to export_manifest (OSE-556).
 *
 * Call after every D1 → OCR boundary crossing: forms CSV export, BigQuery
 * backup, R2 file upload. Fire-and-forget; failures are swallowed.
 */
export async function logExportManifest(
  env: AuditLogEnv,
  entry: {
    export_type: 'BIGQUERY' | 'UPLOAD_FILE';
    event_id: string;
    actor: string | null;
    request_id: string;
    rows_exported?: number;
    file_key?: string;
    outcome: 'success' | 'failed';
    details?: Record<string, unknown>;
  }
): Promise<void> {
  const id = crypto.randomUUID ? crypto.randomUUID() : `exp-${Date.now()}-${Math.random()}`;
  try {
    await env.DB.prepare(
      `INSERT INTO export_manifest
         (id, export_type, event_id, actor, request_id, rows_exported, file_key, outcome, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        entry.export_type,
        entry.event_id,
        entry.actor ?? null,
        entry.request_id,
        entry.rows_exported ?? null,
        entry.file_key ?? null,
        entry.outcome,
        entry.details ? JSON.stringify(entry.details) : null
      )
      .run();
  } catch {
    console.warn(
      JSON.stringify({
        type: 'EXPORT_MANIFEST_WRITE_FAILURE',
        export_type: entry.export_type,
        event_id: entry.event_id,
        request_id: entry.request_id,
      })
    );
  }
}
