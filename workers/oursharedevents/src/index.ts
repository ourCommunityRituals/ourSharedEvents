/**
 * OurSharedEvents – Cloudflare Worker entry point
 *
 * Deploy staging:    cd workers/oursharedevents && npm run deploy:staging
 * Deploy production: cd workers/oursharedevents && npm run deploy:prod
 * Local dev:         cd workers/oursharedevents && npm run dev
 */

import { route, type RouterEnv } from './router';
import { checkSchema, schemaDriftResponse, isDiagnosticPath } from './lib/schema-guard';
import { runBigQueryBackup } from './handlers/bigquery';
import { runSharedReportMaterialization } from './handlers/shared-report-materialize';
import { runSharedReportBigQueryExport } from './handlers/shared-report-export';
import { raiseSecurityAlert } from './lib/security-alert';
import {
  createCostAccumulator,
  instrumentEnvForCost,
  normalizeOperation,
  emitOperationCost,
} from './lib/cost-metric';

export type { RouterEnv as Env };

export default {
  async fetch(request: Request, env: RouterEnv, ctx: ExecutionContext): Promise<Response> {
    // COST-301 (OSE-780): aggregate-only, never-who per-operation cost metric.
    // Instrument the D1 bindings so handlers transparently accumulate rows, and
    // time the whole request at this single choke point. Emission below is
    // fail-safe and identifier-free — see src/lib/cost-metric.ts.
    // OSE-803 — schema version guard. One check per isolate. A binding behind the
    // migration this Worker was built against is refused rather than served, except
    // on the diagnostic routes so the drift stays readable.
    const drift = await checkSchema(env);
    if (drift && !isDiagnosticPath(new URL(request.url).pathname)) {
      return schemaDriftResponse(drift);
    }

    const startedAt = Date.now();
    const costAcc = createCostAccumulator();
    const costEnv = instrumentEnvForCost(env, costAcc);
    let response: Response;
    try {
      response = await route(request, costEnv, ctx);
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
    // Emit exactly one aggregate-only cost line per request. Never throws.
    emitOperationCost({
      op: normalizeOperation(request.method, new URL(request.url).pathname),
      wallMs: Date.now() - startedAt,
      acc: costAcc,
      status: response.status,
    });
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
    // runSecurityMetricsCron (OSE-SEC-1): reads DB.admin_audit_log + RATE_LIMIT_KV;
    //   writes to DB.security_metrics + DB.security_alerts. Opens Linear issues
    //   for anomalies. Off-by-default guard: skips gracefully if tables don't exist.
    ctx.waitUntil(
      Promise.all([
        runFormDataLifecycle(env),
        runBigQueryBackup(env),
        runSubscribersRetentionLifecycle(env),
        runSharedReportMaterialization(env),
        runSharedReportBigQueryExport(env),
        runSecurityMetricsCron(env),
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
    // OSE-1123. Off-by-default is deliberate — subscribers is a marketing list and
    // silent automatic deletion would break product expectations. That decision
    // stands. What was wrong is the VISIBILITY: this state means PII is retained
    // without bound, which contradicts Invariant #8 ("No PII has unbounded
    // retention"), and it was reported at console.log level — indistinguishable
    // from the routine LIFECYCLE_COMPLETE line in the same run.
    //
    // A refusal to act that nobody can see is a bug however correct the refusal is.
    // Escalated to console.error so it surfaces in alerting rather than blending
    // into normal output, and the payload now names the invariant it is out of
    // compliance with, so whoever reads it knows this is not informational.
    console.error(
      JSON.stringify({
        type: 'SUBSCRIBERS_RETENTION_UNCAPPED',
        severity: 'compliance',
        invariant: '#8 bounded_pii_retention',
        reason: 'SUBSCRIBERS_RETENTION_DAYS unset or non-positive',
        consequence: 'DB.subscribers PII is retained without bound',
        remedy: 'Set SUBSCRIBERS_RETENTION_DAYS to a positive integer, or retire /subscribe',
        tracking: 'OSE-1123',
        timestamp: now,
      })
    );
    await logSubscribersRetentionAudit(env, 'noop', 0, 0, {
      reason: 'unset',
      uncapped: true,
      invariant: '#8 bounded_pii_retention',
    });
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

// ─── Security Metrics Cron ────────────────────────────────────────────────────
//
// Runs daily alongside the data lifecycle job (same cron tick: 3 AM UTC).
// Reads from:
//   - DB.admin_audit_log  → auth failure count
//   - RATE_LIMIT_KV       → rate-limit trigger count via KV list + parse
//   - DB.admin_audit_log  → approximated 4xx/5xx via denied outcomes
// Writes:
//   - DB.security_metrics → daily snapshot row (upsert)
//   - DB.security_alerts  → one row per anomaly threshold breach
//   - Linear              → issue per alert (via raiseSecurityAlert)
//
// Alert thresholds (environment-tunable via env vars):
//   AUTH_FAILURE_THRESHOLD         default 100 / day
//   RATE_LIMIT_TRIGGER_THRESHOLD   default 1000 / day
//   ERROR_5XX_THRESHOLD_PCT        default 5 (%)
//
// The function is fully failure-isolated. Any error is logged and swallowed.

/** Environment extension for the security cron job */
interface SecurityCronEnv {
  DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
  LINEAR_API_KEY?: string;
  LINEAR_TEAM_ID?: string;
  WORKER_ENV?: string;
  AUTH_FAILURE_THRESHOLD?: string;
  RATE_LIMIT_TRIGGER_THRESHOLD?: string;
  ERROR_5XX_THRESHOLD_PCT?: string;
  // TL-018: ISO timestamp of the last FORMS_ENCRYPTION_KEY rotation.
  FORMS_KEY_ROTATED_AT?: string;
}

async function runSecurityMetricsCron(env: RouterEnv): Promise<void> {
  const now = new Date().toISOString();
  const today = now.slice(0, 10); // YYYY-MM-DD
  const workerEnv = env.WORKER_ENV ?? 'unknown';

  // Thresholds — configurable via env vars, safe integer parse
  const parseThreshold = (raw: string | undefined, def: number): number => {
    const n = parseInt(raw ?? String(def), 10);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  const secEnv = env as unknown as SecurityCronEnv;
  const AUTH_FAILURE_THRESHOLD = parseThreshold(secEnv.AUTH_FAILURE_THRESHOLD, 100);
  const RATE_LIMIT_TRIGGER_THRESHOLD = parseThreshold(secEnv.RATE_LIMIT_TRIGGER_THRESHOLD, 1000);
  const ERROR_5XX_THRESHOLD_PCT = parseThreshold(secEnv.ERROR_5XX_THRESHOLD_PCT, 5);

  const anomalyFlags: string[] = [];
  let authFailures = 0;
  let rateLimitTriggers = 0;
  let error5xx = 0;
  let error4xx = 0;
  let totalRequests = 0;

  // ── Phase 1: Auth failures from admin_audit_log ──────────────────────────
  try {
    const authRow = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt
       FROM admin_audit_log
       WHERE outcome = 'denied'
         AND created_at >= datetime('now', '-24 hours')`
    ).first<{ cnt: number }>();
    authFailures = authRow?.cnt ?? 0;
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'SECURITY_CRON_ERROR',
        phase: 'auth_failures',
        error: err instanceof Error ? err.message : String(err),
        timestamp: now,
      })
    );
  }

  // ── Phase 2: Rate-limit triggers from KV ────────────────────────────────
  // KV keys have the form ratelimit:{ip}; value = { count, resetAt }.
  // We list all keys and sum counts where count > RATE_LIMIT_MAX (60) as
  // a proxy for "this IP was rate-limited at some point today".
  // NOTE: KV list is eventually consistent; exact counts are best-effort.
  try {
    let cursor: string | undefined;
    let listed = 0;
    do {
      const result = await env.RATE_LIMIT_KV.list({
        prefix: 'ratelimit:',
        limit: 1000,
        cursor,
      });
      listed += result.keys.length;
      // Fetch values in parallel batches of 50 to avoid fan-out explosion
      const BATCH = 50;
      for (let i = 0; i < result.keys.length; i += BATCH) {
        const batch = result.keys.slice(i, i + BATCH);
        const values = await Promise.all(batch.map((k) => env.RATE_LIMIT_KV.get(k.name)));
        for (const raw of values) {
          if (!raw) continue;
          try {
            const entry = JSON.parse(raw) as { count: number; resetAt: number };
            // Count as a "trigger" if the IP has exceeded 60 requests in its window
            if (entry.count > 60) rateLimitTriggers++;
          } catch {
            // malformed entry — skip
          }
        }
      }
      cursor = result.list_complete ? undefined : (result as { cursor?: string }).cursor;
    } while (cursor);

    console.log(
      JSON.stringify({
        type: 'SECURITY_CRON_RATE_LIMIT_SCAN',
        keysScanned: listed,
        triggersFound: rateLimitTriggers,
        timestamp: now,
      })
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'SECURITY_CRON_ERROR',
        phase: 'rate_limit_kv',
        error: err instanceof Error ? err.message : String(err),
        timestamp: now,
      })
    );
  }

  // ── Phase 3: Error rate from admin_audit_log denied outcomes ─────────────
  // The admin_audit_log captures admin-layer denials; for a more complete
  // error rate we use denied counts as a lower-bound proxy. A full 5xx counter
  // requires Workers Analytics Engine or CF Logpush — left as a future upgrade.
  try {
    const totalRow = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM admin_audit_log WHERE created_at >= datetime('now', '-24 hours')`
    ).first<{ cnt: number }>();
    totalRequests = totalRow?.cnt ?? 0;

    const deniedRow = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt
       FROM admin_audit_log
       WHERE outcome = 'denied'
         AND created_at >= datetime('now', '-24 hours')`
    ).first<{ cnt: number }>();
    // Denied admin actions are 4xx-class errors in the audit log
    error4xx = deniedRow?.cnt ?? 0;

    // 5xx approximation: count lifecycle/system errors via structured log
    // (We can't query Worker logs from D1 directly — 5xx tracking requires
    //  Workers Analytics Engine. This stub returns 0 until AE is wired.)
    error5xx = 0;
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'SECURITY_CRON_ERROR',
        phase: 'error_rates',
        error: err instanceof Error ? err.message : String(err),
        timestamp: now,
      })
    );
  }

  // ── Phase 4: Threshold evaluation ───────────────────────────────────────
  const alertPromises: Promise<void>[] = [];
  const alertEnv = {
    DB: env.DB,
    LINEAR_API_KEY: env.LINEAR_API_KEY as string | undefined,
    LINEAR_TEAM_ID: env.LINEAR_TEAM_ID as string | undefined,
    WORKER_ENV: workerEnv,
  };

  // TL-018: Key rotation age check — alert before and at the 90-day window.
  // FORMS_KEY_ROTATED_AT must be updated alongside FORMS_ENCRYPTION_KEY
  // on every rotation (wrangler secret put FORMS_KEY_ROTATED_AT --env ...).
  const KEY_ROTATION_WARN_DAYS = 75;
  const KEY_ROTATION_MAX_DAYS = 90;
  const rotatedAtRaw = secEnv.FORMS_KEY_ROTATED_AT;
  if (rotatedAtRaw) {
    const rotatedMs = Date.parse(rotatedAtRaw);
    if (!Number.isNaN(rotatedMs)) {
      const ageDays = Math.floor((Date.now() - rotatedMs) / 86_400_000);
      if (ageDays >= KEY_ROTATION_MAX_DAYS) {
        anomalyFlags.push('key_rotation_overdue');
        alertPromises.push(
          raiseSecurityAlert(
            {
              type: 'key_rotation_age',
              severity: 'HIGH',
              message: `FORMS_ENCRYPTION_KEY is ${ageDays} days old — past the ${KEY_ROTATION_MAX_DAYS}-day rotation window`,
              details: { ageDays, rotatedAt: rotatedAtRaw, thresholdDays: KEY_ROTATION_MAX_DAYS },
              affectedEndpoint: 'FORMS_ENCRYPTION_KEY',
              detectedAt: now,
            },
            alertEnv
          ).then(() => undefined)
        );
      } else if (ageDays >= KEY_ROTATION_WARN_DAYS) {
        anomalyFlags.push('key_rotation_due_soon');
        alertPromises.push(
          raiseSecurityAlert(
            {
              type: 'key_rotation_age',
              severity: 'MEDIUM',
              message: `FORMS_ENCRYPTION_KEY is ${ageDays} days old — rotation due in ${KEY_ROTATION_MAX_DAYS - ageDays} days`,
              details: {
                ageDays,
                rotatedAt: rotatedAtRaw,
                thresholdDays: KEY_ROTATION_MAX_DAYS,
                daysUntilDue: KEY_ROTATION_MAX_DAYS - ageDays,
              },
              affectedEndpoint: 'FORMS_ENCRYPTION_KEY',
              detectedAt: now,
            },
            alertEnv
          ).then(() => undefined)
        );
      }
    } else {
      console.warn(
        JSON.stringify({
          type: 'SECURITY_CRON_WARN',
          phase: 'key_rotation_age',
          message: 'FORMS_KEY_ROTATED_AT is not a valid ISO date — key age cannot be checked',
          value: rotatedAtRaw,
          timestamp: now,
        })
      );
    }
  }

  if (authFailures > AUTH_FAILURE_THRESHOLD) {
    anomalyFlags.push('auth_failures_exceeded');
    alertPromises.push(
      raiseSecurityAlert(
        {
          type: 'auth_failures',
          severity: authFailures > AUTH_FAILURE_THRESHOLD * 5 ? 'CRITICAL' : 'HIGH',
          message: `Auth failures exceeded threshold: ${authFailures} failures in 24 h (threshold: ${AUTH_FAILURE_THRESHOLD})`,
          details: {
            count: authFailures,
            threshold: AUTH_FAILURE_THRESHOLD,
            window: '24h',
            date: today,
          },
          affectedEndpoint: '/api/v2/admin/*',
          detectedAt: now,
        },
        alertEnv
      ).then(() => undefined)
    );
  }

  if (rateLimitTriggers > RATE_LIMIT_TRIGGER_THRESHOLD) {
    anomalyFlags.push('rate_limit_triggers_exceeded');
    alertPromises.push(
      raiseSecurityAlert(
        {
          type: 'rate_limit_triggers',
          severity: rateLimitTriggers > RATE_LIMIT_TRIGGER_THRESHOLD * 10 ? 'CRITICAL' : 'HIGH',
          message: `Rate-limit triggers exceeded threshold: ${rateLimitTriggers} IPs rate-limited (threshold: ${RATE_LIMIT_TRIGGER_THRESHOLD})`,
          details: {
            count: rateLimitTriggers,
            threshold: RATE_LIMIT_TRIGGER_THRESHOLD,
            kvPrefix: 'ratelimit:',
            date: today,
          },
          affectedEndpoint: '/api/v2/events/:id/forms/*',
          detectedAt: now,
        },
        alertEnv
      ).then(() => undefined)
    );
  }

  if (totalRequests > 0) {
    const errorPct = Math.round((error5xx / totalRequests) * 100);
    if (errorPct > ERROR_5XX_THRESHOLD_PCT) {
      anomalyFlags.push('error_rate_5xx_exceeded');
      alertPromises.push(
        raiseSecurityAlert(
          {
            type: 'error_rate_5xx',
            severity: errorPct > ERROR_5XX_THRESHOLD_PCT * 3 ? 'CRITICAL' : 'HIGH',
            message: `5xx error rate exceeded threshold: ${errorPct}% (threshold: ${ERROR_5XX_THRESHOLD_PCT}%)`,
            details: {
              error5xx,
              totalRequests,
              errorPct,
              threshold: ERROR_5XX_THRESHOLD_PCT,
              date: today,
            },
            affectedEndpoint: 'worker-global',
            detectedAt: now,
          },
          alertEnv
        ).then(() => undefined)
      );
    }
  }

  // Wait for all alert operations (they're already best-effort internally)
  await Promise.allSettled(alertPromises);

  // ── Phase 5: Write daily security_metrics snapshot ───────────────────────
  try {
    const id = crypto.randomUUID ? crypto.randomUUID() : `sm-${Date.now()}`;
    await env.DB.prepare(
      `INSERT INTO security_metrics
         (id, date, env, auth_failures, rate_limit_triggers, error_5xx, error_4xx, total_requests, anomaly_flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (date, env) DO UPDATE SET
         auth_failures       = excluded.auth_failures,
         rate_limit_triggers = excluded.rate_limit_triggers,
         error_5xx           = excluded.error_5xx,
         error_4xx           = excluded.error_4xx,
         total_requests      = excluded.total_requests,
         anomaly_flags       = excluded.anomaly_flags,
         created_at          = datetime('now')`
    )
      .bind(
        id,
        today,
        workerEnv,
        authFailures,
        rateLimitTriggers,
        error5xx,
        error4xx,
        totalRequests,
        JSON.stringify(anomalyFlags)
      )
      .run();
  } catch (err) {
    // security_metrics table may not exist in older environments —
    // migration 0042 must be applied first.
    console.error(
      JSON.stringify({
        type: 'SECURITY_CRON_ERROR',
        phase: 'metrics_write',
        error: err instanceof Error ? err.message : String(err),
        timestamp: now,
      })
    );
  }

  console.log(
    JSON.stringify({
      type: 'SECURITY_CRON_COMPLETE',
      date: today,
      env: workerEnv,
      authFailures,
      rateLimitTriggers,
      error5xx,
      error4xx,
      totalRequests,
      anomalyFlags,
      alertsRaised: alertPromises.length,
      timestamp: now,
    })
  );
}
