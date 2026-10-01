/**
 * Stale-draft expiry — "a draft nobody touched is noise, not an event".
 *
 * WHY. Every event starts life as a draft (handleCreateEvent defaults to
 * 'draft'). An organizer who starts the wizard and walks away leaves a row that
 * shows up in their list forever, indistinguishable from the drafts they still
 * mean to finish. Left alone, the list fills with abandoned rows and the real
 * ones get lost. This job sweeps them nightly.
 *
 * WHAT IT DOES — and, as importantly, what it does NOT do:
 *   - ARCHIVES, never deletes. `draft → archived` is a valid transition in the
 *     state machine and `archived → draft` is too, so an organizer can always
 *     get one back from the Archived filter. Nothing is destroyed.
 *   - Touches ONLY status = 'draft'. A 'ready' event has been deliberately
 *     advanced by a human and is never swept; 'active' / 'archived' are not
 *     drafts.
 *   - Keys off `updated_at`, not `created_at` — any edit resets the clock, so a
 *     draft someone is actively working on is safe no matter how old it is.
 *   - SKIPS drafts whose start_date is still in the future. A draft for next
 *     month's tournament that was set up early and then left alone is waiting,
 *     not abandoned. Only drafts with no date, or a date already past, expire.
 *
 * CONFIG. `DRAFT_EXPIRY_DAYS` (env var). Unset → DEFAULT_DRAFT_EXPIRY_DAYS (30).
 * `0` or a negative / non-numeric value → the sweep is OFF (logged as a no-op).
 * This is deliberately the opposite default from the retention jobs (which are
 * off until configured): those DELETE data and default to keeping it; this one
 * only archives, and the product owner asked for the noise to go away by
 * default.
 *
 * AUDIT. Every run writes one admin_audit_log row (action DRAFT_EXPIRY, actor
 * 'system:lifecycle') carrying the count, the window, and the ids archived, so
 * "where did my event go?" is answerable from the log. Each archived event also
 * gets its own DRAFT_EXPIRED row, attributed to the event's brand (AUD-3 B). Never-who: the row
 * carries event ids only, no operator identity beyond the system actor.
 */

export interface DraftExpiryEnv {
  DB: D1Database;
  DRAFT_EXPIRY_DAYS?: string;
}

export const DEFAULT_DRAFT_EXPIRY_DAYS = 30;

/** Upper bound on ids echoed into one audit row's details (keeps the row small). */
const AUDIT_ID_CAP = 200;

/** Drafts archived per statement (well under D1's 100 bound-parameter limit). */
const ARCHIVE_CHUNK = 90;

export interface DraftExpiryResult {
  enabled: boolean;
  days: number;
  archived: number;
  skippedFutureDated: number;
  errors: number;
}

/**
 * Resolve the configured window. Unset → default; explicit 0 / negative / junk
 * → disabled (returns 0). Exported so the spec can pin the semantics.
 */
export function resolveDraftExpiryDays(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return DEFAULT_DRAFT_EXPIRY_DAYS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export async function runDraftExpiry(env: DraftExpiryEnv): Promise<DraftExpiryResult> {
  const now = new Date().toISOString();
  const days = resolveDraftExpiryDays(env.DRAFT_EXPIRY_DAYS);
  const result: DraftExpiryResult = {
    enabled: days > 0,
    days,
    archived: 0,
    skippedFutureDated: 0,
    errors: 0,
  };

  if (!result.enabled) {
    console.log(
      JSON.stringify({
        type: 'DRAFT_EXPIRY_NOOP',
        reason: 'DRAFT_EXPIRY_DAYS is 0 / non-positive; stale drafts are never archived',
        timestamp: now,
      })
    );
    await audit(env, 'noop', result, []);
    return result;
  }

  const window = `-${days} days`;
  let ids: string[] = [];
  try {
    // Select first, then update by id: the audit row names what moved, and a
    // draft edited between the two statements (updated_at bumped) is skipped by
    // the WHERE on the UPDATE rather than swept out from under the editor.
    const stale = await env.DB.prepare(
      `SELECT id FROM events
        WHERE status = 'draft'
          AND updated_at < datetime('now', ?)
          AND (start_date IS NULL OR start_date < date('now'))
        ORDER BY updated_at ASC
        LIMIT 500`
    )
      .bind(window)
      .all<{ id: string }>();
    ids = (stale.results ?? []).map((r) => r.id);

    const future = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM events
        WHERE status = 'draft'
          AND updated_at < datetime('now', ?)
          AND start_date IS NOT NULL AND start_date >= date('now')`
    )
      .bind(window)
      .first<{ n: number }>();
    result.skippedFutureDated = Number(future?.n ?? 0);

    // Set-based, in chunks, to stay well inside D1's per-invocation query
    // budget (a 500-draft sweep is 2 statements per chunk, not 2 per draft).
    // RETURNING gives exactly the drafts this run archived; a draft edited
    // between the SELECT and here is skipped by the WHERE.
    for (let i = 0; i < ids.length; i += ARCHIVE_CHUNK) {
      const chunk = ids.slice(i, i + ARCHIVE_CHUNK);
      const marks = chunk.map(() => '?').join(', ');
      const archived = await env.DB.prepare(
        `UPDATE events
            SET status = 'archived', updated_at = datetime('now')
          WHERE id IN (${marks}) AND status = 'draft' AND updated_at < datetime('now', ?)
          RETURNING id`
      )
        .bind(...chunk, window)
        .all<{ id: string }>();
      const changed = (archived.results ?? []).map((r) => r.id);
      result.archived += changed.length;
      if (changed.length === 0) continue;
      // AUD-3 Phase B: one row per archived event, carrying that event's brand,
      // so it shows in the brand owner's audit view. One INSERT per chunk.
      try {
        await env.DB.prepare(
          `INSERT INTO admin_audit_log
             (id, action, actor, resource_type, resource_id, request_id, outcome, details, brand_id)
           SELECT lower(hex(randomblob(16))), 'DRAFT_EXPIRED', 'system:lifecycle', 'event',
                  e.id, ?, 'success', ?, e.brand_id
             FROM events e
            WHERE e.id IN (${changed.map(() => '?').join(', ')})`
        )
          .bind(`draft-expiry:${now}`, JSON.stringify({ days }), ...changed)
          .run();
      } catch {
        // Audit failures must never break the lifecycle job.
      }
    }
  } catch (err) {
    result.errors = 1;
    console.error(
      JSON.stringify({
        type: 'DRAFT_EXPIRY_ERROR',
        error: err instanceof Error ? err.message : String(err),
        days,
        timestamp: now,
      })
    );
  }

  console.log(
    JSON.stringify({
      type: 'DRAFT_EXPIRY_COMPLETE',
      days,
      archived: result.archived,
      skipped_future_dated: result.skippedFutureDated,
      errors: result.errors,
      timestamp: now,
    })
  );
  await audit(env, 'success', result, ids);
  return result;
}

async function audit(
  env: DraftExpiryEnv,
  outcomeRaw: 'success' | 'noop',
  r: DraftExpiryResult,
  ids: string[]
): Promise<void> {
  const id = crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`;
  const outcome = r.errors > 0 ? 'denied' : 'success';
  try {
    await env.DB.prepare(
      `INSERT INTO admin_audit_log
         (id, action, actor, resource_type, resource_id, request_id, outcome, ip, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        'DRAFT_EXPIRY',
        'system:lifecycle',
        'event',
        null,
        id,
        outcome,
        null,
        JSON.stringify({
          outcomeRaw,
          days: r.days,
          archived: r.archived,
          skippedFutureDated: r.skippedFutureDated,
          errors: r.errors,
          ids: ids.slice(0, AUDIT_ID_CAP),
        })
      )
      .run();
  } catch {
    // Audit failures must never break the lifecycle job.
  }
}
