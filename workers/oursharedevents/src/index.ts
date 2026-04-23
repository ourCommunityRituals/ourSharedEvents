/**
 * OurSharedEvents – Cloudflare Worker entry point
 *
 * Deploy staging:    cd workers/oursharedevents && npm run deploy:staging
 * Deploy production: cd workers/oursharedevents && npm run deploy:prod
 * Local dev:         cd workers/oursharedevents && npm run dev
 */

import { route, type RouterEnv } from './router';
import { backupEvents, isBigQueryConfigured } from './cloud/bigquery';

export type { RouterEnv as Env };

export default {
  async fetch(request: Request, env: RouterEnv, _ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      console.error(
        JSON.stringify({
          type: 'UNHANDLED_ERROR',
          error: err instanceof Error ? err.message : String(err),
          url: request.url,
          timestamp: new Date().toISOString(),
        })
      );

      return Response.json(
        { ok: false, status: 500, error: 'Internal server error' },
        { status: 500 }
      );
    }
  },

  async scheduled(_event: ScheduledEvent, env: RouterEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runFormDataLifecycle(env));
  },
};

/**
 * Safe key patterns — keys in survey responses that are behavioral/rating data
 * and are safe to keep post-scrub. ALL other string values are scrubbed.
 * This whitelist approach is safer than a PII blacklist.
 */
const SAFE_KEY_PATTERNS =
  /^(rating|score|count|number|rank|order|id|uuid|type|category|topic|session|duration|index|overall|venue|speaker|event|quality|value|level|tier|scale|stars?|thumbs?).*$/i;

/**
 * Scrub PII from survey responses JSON using whitelist approach.
 * Keeps numeric values and keys matching safe patterns (ratings, scores, etc).
 * ALL string values for non-safe keys are replaced with "[SCRUBBED]".
 */
function scrubSurveyPii(responsesJson: string): string {
  try {
    const data = JSON.parse(responsesJson) as Record<string, unknown>;
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'number' || typeof value === 'boolean') {
        scrubbed[key] = value;
      } else if (SAFE_KEY_PATTERNS.test(key)) {
        scrubbed[key] = value;
      } else if (typeof value === 'string') {
        scrubbed[key] = '[SCRUBBED]';
      } else {
        scrubbed[key] = value;
      }
    }
    return JSON.stringify(scrubbed);
  } catch {
    return '{}';
  }
}

/**
 * Scheduled data lifecycle job — runs daily via cron trigger.
 *
 * Each phase runs independently. A failure in one phase does NOT abort
 * the others. All results are logged for SRE observability.
 *
 * Phase 1: Delete registrations for ended events (expires_at passed)
 * Phase 2: Scrub PII from surveys (whitelist approach)
 * Phase 3: Delete email signups past retention window
 */
/** Write a row to the PII audit log for compliance evidence. */
async function logPiiAudit(
  db: D1Database,
  phase: string,
  recordsAffected: number,
  errors: number,
  triggeredBy = 'scheduled'
): Promise<void> {
  const id = crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`;
  try {
    await db
      .prepare(
        `INSERT INTO pii_audit_log (id, phase, triggered_by, records_affected, errors)
       VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, phase, triggeredBy, recordsAffected, errors)
      .run();
  } catch {
    // Audit log write failure must not break the lifecycle job
  }
}

async function runFormDataLifecycle(env: RouterEnv): Promise<void> {
  const now = new Date().toISOString();
  const results: Record<string, unknown> = { timestamp: now };

  // ── Phase 1: Delete expired registrations ──────────────────────────────
  try {
    const del = await env.FORMS_DB.prepare(
      'DELETE FROM form_registrations WHERE expires_at IS NOT NULL AND expires_at < ?'
    )
      .bind(now)
      .run();
    const count = del.meta?.changes ?? 0;
    results.registrationsDeleted = count;
    await logPiiAudit(env.FORMS_DB, 'registrations_delete', count, 0);
  } catch (err) {
    results.registrationsError = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        type: 'LIFECYCLE_PHASE_ERROR',
        phase: 'registrations',
        error: results.registrationsError,
        timestamp: now,
      })
    );
    await logPiiAudit(env.FORMS_DB, 'registrations_delete', 0, 1);
  }

  // ── Phase 2: Scrub PII from surveys ────────────────────────────────────
  try {
    const unscrubbed = await env.FORMS_DB.prepare(
      'SELECT id, responses_json FROM form_surveys WHERE pii_scrubbed = 0 AND created_at < ?'
    )
      .bind(now)
      .all();

    let scrubbed = 0;
    let scrubErrors = 0;
    for (const row of unscrubbed.results ?? []) {
      try {
        const cleaned = scrubSurveyPii(row.responses_json as string);
        await env.FORMS_DB.prepare(
          'UPDATE form_surveys SET responses_json = ?, pii_scrubbed = 1 WHERE id = ?'
        )
          .bind(cleaned, row.id as string)
          .run();
        scrubbed++;
      } catch {
        scrubErrors++;
      }
    }
    results.surveysScrubbed = scrubbed;
    results.surveysScrubErrors = scrubErrors;
    await logPiiAudit(env.FORMS_DB, 'surveys_scrub', scrubbed, scrubErrors);
  } catch (err) {
    results.surveysError = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        type: 'LIFECYCLE_PHASE_ERROR',
        phase: 'surveys',
        error: results.surveysError,
        timestamp: now,
      })
    );
    await logPiiAudit(env.FORMS_DB, 'surveys_scrub', 0, 1);
  }

  // ── Phase 3: Delete expired email signups ──────────────────────────────
  try {
    const del = await env.FORMS_DB.prepare(
      'DELETE FROM email_signups WHERE retention_expires_at < ?'
    )
      .bind(now)
      .run();
    const count = del.meta?.changes ?? 0;
    results.emailSignupsDeleted = count;
    await logPiiAudit(env.FORMS_DB, 'email_signups_delete', count, 0);
  } catch (err) {
    results.emailSignupsError = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        type: 'LIFECYCLE_PHASE_ERROR',
        phase: 'email_signups',
        error: results.emailSignupsError,
        timestamp: now,
      })
    );
    await logPiiAudit(env.FORMS_DB, 'email_signups_delete', 0, 1);
  }

  // ── Phase 4: BigQuery event backup ──────────────────────────────────────
  if (isBigQueryConfigured(env)) {
    try {
      const recentEvents = await env.DB.prepare(
        "SELECT * FROM events WHERE updated_at > datetime('now', '-24 hours')"
      ).all();
      const bqResult = await backupEvents(env, recentEvents.results as Record<string, unknown>[]);
      results.bqEventsBackedUp = bqResult.rowCount ?? 0;
    } catch (err) {
      results.bqBackupError = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          type: 'LIFECYCLE_PHASE_ERROR',
          phase: 'bq_backup',
          error: results.bqBackupError,
          timestamp: now,
        })
      );
    }
  }

  console.log(JSON.stringify({ type: 'LIFECYCLE_COMPLETE', ...results }));
}
