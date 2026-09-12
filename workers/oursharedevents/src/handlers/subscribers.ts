/**
 * OSE-207 / BE-17 — Admin subscribers endpoint
 *
 * GET /api/v2/admin/subscribers
 *   ?limit=<1–100, default 50>
 *   ?cursor=<ISO timestamp — page backward past this point>
 *
 * Returns a paginated descending-by-created_at list of subscriber rows
 * (email, source, created_at). Each call writes an audit entry to the
 * admin_audit_log via OSE-212's logAdminAction so admin reads of PII
 * are tracked.
 *
 * Auth: enforced by the router via requireAdmin before this handler is
 * called. extractAdminActor is used here to attribute the audit entry.
 */

import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { logAdminAction, type AuditLogEnv } from '../lib/audit-log';
import { decryptText } from '../lib/pii';

export type SubscribersAdminEnv = AdminEnv &
  AuditLogEnv & {
    /**
     * Data-at-rest doctrine (A-5) — AES-GCM key used to decrypt
     * subscribers.email_encrypted for this admin read-back. Same secret the
     * subscribe path (handleSubscribe) encrypts with.
     */
    FORMS_ENCRYPTION_KEY?: string;
  };

interface SubscriberRow {
  email_encrypted: string;
  source: string | null;
  created_at: string;
}

/** Shape returned to the admin — email decrypted back to plaintext. */
interface SubscriberItem {
  email: string;
  source: string | null;
  created_at: string;
}

export async function handleListSubscribers(
  request: Request,
  env: SubscribersAdminEnv,
  ctx: ExecutionContext,
  requestId: string
): Promise<Response> {
  const url = new URL(request.url);

  const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
  const cursor = url.searchParams.get('cursor') ?? null;

  const where = cursor ? 'WHERE created_at < ?' : '';
  const bindings: (string | number)[] = cursor ? [cursor, limit + 1] : [limit + 1];

  // A-5: subscribers.email is stored encrypted (email_encrypted, migration
  // 0071). Select the ciphertext and decrypt it below so the response `email`
  // field is unchanged — the plaintext column no longer exists.
  const sql = `
    SELECT email_encrypted, source, created_at
    FROM   subscribers
    ${where}
    ORDER  BY created_at DESC
    LIMIT  ?`;

  let rows: SubscriberRow[] = [];
  let outcome: 'success' | 'denied' = 'success';
  try {
    const result = await env.DB.prepare(sql)
      .bind(...bindings)
      .all<SubscriberRow>();
    rows = result.results ?? [];
  } catch (err) {
    outcome = 'denied';
    console.error(
      JSON.stringify({
        type: 'LIST_SUBSCRIBERS_DB_ERROR',
        requestId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    // Fire-and-forget audit for the failure path
    ctx.waitUntil(
      logAdminAction(env, {
        action: 'LIST_SUBSCRIBERS',
        actor: extractAdminActor(request, env),
        resource_type: 'subscribers',
        request_id: requestId,
        outcome: 'denied',
        details: { limit, cursor, reason: 'db_error' },
      })
    );
    return Response.json(
      { ok: false, status: 500, code: 'DB_ERROR', requestId },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? pageRows[pageRows.length - 1].created_at : null;

  // A-5: decrypt email_encrypted back to the `email` field so the API shape is
  // unchanged. A decrypt failure (e.g. key rotation mismatch) MUST surface as a
  // non-null sentinel — never a silent null that hides key misconfiguration —
  // and must not 500 the whole list (mirrors the forms admin export, OSE-713).
  const encryptionKey = env.FORMS_ENCRYPTION_KEY;
  const items: SubscriberItem[] = await Promise.all(
    pageRows.map(async (row): Promise<SubscriberItem> => {
      let email = '[decryption-failed]';
      if (encryptionKey) {
        try {
          email = await decryptText(row.email_encrypted, encryptionKey);
        } catch (err) {
          console.error(
            JSON.stringify({
              type: 'LIST_SUBSCRIBERS_DECRYPT_ERROR',
              requestId,
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      } else {
        email = '[encryption-key-unavailable]';
      }
      return { email, source: row.source, created_at: row.created_at };
    })
  );

  // Fire-and-forget audit on success — never block the response
  ctx.waitUntil(
    logAdminAction(env, {
      action: 'LIST_SUBSCRIBERS',
      actor: extractAdminActor(request, env),
      resource_type: 'subscribers',
      request_id: requestId,
      outcome,
      details: { limit, cursor, returned: items.length, hasMore },
    })
  );

  return Response.json(
    {
      ok: true,
      items,
      pagination: { limit, hasMore, nextCursor },
    },
    { headers: { 'X-Request-Id': requestId } }
  );
}
