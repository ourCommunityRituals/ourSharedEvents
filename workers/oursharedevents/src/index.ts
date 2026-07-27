/**
 * OurSharedEvents – Cloudflare Worker entry point
 *
 * Deploy staging:    cd workers/oursharedevents && npm run deploy:staging
 * Deploy production: cd workers/oursharedevents && npm run deploy:prod
 * Local dev:         cd workers/oursharedevents && npm run dev
 */

import { route, type RouterEnv } from './router';
import { runBigQueryBackup } from './handlers/bigquery';
import { runSharedReportMaterialization } from './handlers/shared-report-materialize';
import { runSharedReportBigQueryExport } from './handlers/shared-report-export';

export type { RouterEnv as Env };

export default {
  async fetch(request: Request, env: RouterEnv, ctx: ExecutionContext): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env, ctx);
    } catch (err) {
      console.error(
        JSON.stringify({
          type: 'UNHANDLED_ERROR',
          error: err instanceof Error ? err.message : String(err),
          url: request.url,
          timestamp: new Date().toISOString(),
        })
      );
      response = Response.json(
        { ok: false, status: 500, error: 'Internal server error' },
        { status: 500 }
      );
    }
    // Invariant #6 — Inert Monetization Hooks: every HTTP response carries
    // this header to assert no billing logic executed during the request.
    // Pre-revenue by contract, not by choice.
    const patched = new Response(response.body, response);
    patched.headers.set('X-Monetization-Inert', 'true');
    return patched;
  },

  async scheduled(_event: ScheduledEvent, env: RouterEnv, ctx: ExecutionContext): Promise<void> {
    // runFormDataLifecycle is FORMS_DB-only (PII scrub + retention) — see forms-security S4.
    // runBigQueryBackup reads from the main DB and is kept separate for isolation.
    // runSubscribersRetentionLifecycle (OSE-207) touches DB.subscribers ONLY;
    //   off by default (env.SUBSCRIBERS_RETENTION_DAYS unset → no-op). When set,
    //   deletes subscribers older than the window. Audits to DB.admin_audit_log.
    // runSharedReportMaterialization (OSE-272 Session 3) reads DB only;
    //   off by default (env.ANON_ID_HASH_PEPPER unset → Phase 1 no-ops with
    //   structured warning). Phases 2 + 3 (corridor baseline + event-series
    //   detector) run regardless — they don't need the pepper.
    // runSharedReportBigQueryExport (OSE-272 Session 4) reads main DB only
    //   AND streams to BigQuery; off by default (BQ config unset → no-op).
    //   Same cron tick as materialization (S4-Q1 ratified). Per-phase
    //   failure-isolated (S4-Q4); materialization never blocks on export.
    ctx.waitUntil(
      Promise.all([
        runFormDataLifecycle(env),
        runBigQueryBackup(env),
        runSubscribersRetentionLifecycle(env),
        runSharedReportMaterialization(env),
        runSharedReportBigQueryExport(env),
      ])
    );
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

  console.log(JSON.stringify({ type: 'LIFECYCLE_COMPLETE', ...results }));
}

/**
 * BigQuery event backup — runs daily alongside the lifecycle job.
 *
 * Kept separate from runFormDataLifecycle so that function remains
 * FORMS_DB-only (required by the forms-security isolation gate).
 * This function reads from the main DB (events table) and writes to BigQuery.
 */

/**
 * Subscribers retention lifecycle — OSE-207 / BE-17.
 *
 * Touches DB.subscribers ONLY. Lives outside runFormDataLifecycle so the
 * forms-security S4 isolation gate stays intact (that gate is now precisely
 * scoped to runFormDataLifecycle's function body, not the whole file).
 *
 * Off-by-default by design:
 *   - subscribers is a marketing list; silent automatic deletion would break
 *     product expectations.
 *   - env.SUBSCRIBERS_RETENTION_DAYS is the documented knob. Unset → no-op
 *     with a structured log line (so ops sees the retention is uncapped).
 *   - When set to a positive integer N, deletes rows whose created_at is
 *     older than N days from now. Bounded retention is the GDPR-aligned
 *     posture once you set the knob; the data-subject erase Phase C
 *     handler covers ad-hoc right-to-be-forgotten requests independently.
 *
 * Every run writes an admin_audit_log row (action=SUBSCRIBERS_RETENTION,
 * actor=system:lifecycle) so ops can audit retention activity over time.
 */
async function runSubscribersRetentionLifecycle(env: RouterEnv): Promise<void> {
  const now = new Date().toISOString();
  const raw = env.SUBSCRIBERS_RETENTION_DAYS;
  const days = raw != null ? parseInt(String(raw), 10) : NaN;

  if (!Number.isFinite(days) || days <= 0) {
    console.log(
      JSON.stringify({
        type: 'SUBSCRIBERS_RETENTION_NOOP',
        reason: 'SUBSCRIBERS_RETENTION_DAYS unset or non-positive; retention is uncapped',
        timestamp: now,
      })
    );
    await logSubscribersRetentionAudit(env, 'noop', 0, 0, { reason: 'unset' });
    return;
  }

  let deleted = 0;
  let errors = 0;
  try {
    const res = await env.DB.prepare(
      "DELETE FROM subscribers WHERE created_at < datetime('now', ?)"
    )
      .bind(`-${days} days`)
      .run();
    deleted = res.meta?.changes ?? 0;
  } catch (err) {
    errors = 1;
    console.error(
      JSON.stringify({
        type: 'SUBSCRIBERS_RETENTION_ERROR',
        error: err instanceof Error ? err.message : String(err),
        days,
        timestamp: now,
      })
    );
  }

  console.log(
    JSON.stringify({
      type: 'SUBSCRIBERS_RETENTION_COMPLETE',
      days,
      deleted,
      errors,
      timestamp: now,
    })
  );
  await logSubscribersRetentionAudit(env, 'success', deleted, errors, { days });
}

/**
 * Write the retention run to admin_audit_log so retention activity has a
 * durable trail alongside admin reads (OSE-212 audit log pattern).
 */
async function logSubscribersRetentionAudit(
  env: RouterEnv,
  outcomeRaw: 'success' | 'noop',
  deleted: number,
  errors: number,
  details: Record<string, unknown>
): Promise<void> {
  const id = crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`;
  // Map our two non-failure outcomes to OSE-212's audit-outcome column:
  // 'success' for an executed run (including 0-deleted), 'success' for noop
  // (informational — not a failure). 'denied' is reserved for real failures.
  const outcome = errors > 0 ? 'denied' : 'success';
  try {
    await env.DB.prepare(
      `INSERT INTO admin_audit_log
         (id, action, actor, resource_type, resource_id, request_id, outcome, ip, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        'SUBSCRIBERS_RETENTION',
        'system:lifecycle',
        'subscribers',
        null,
        id, // request_id = audit row id for scheduled jobs (no inbound request)
        outcome,
        null,
        JSON.stringify({ ...details, deleted, errors, outcomeRaw })
      )
      .run();
  } catch {
    // Audit failures must never break the lifecycle job.
  }
}
