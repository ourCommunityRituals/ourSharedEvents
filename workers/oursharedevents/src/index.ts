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
import { runDraftExpiry } from './lib/draft-expiry';
import { runCorridorLatch } from './lib/corridor-latch';
import { runScanReturnsRetention } from './lib/scan-returns-retention';
import { runEventPlaceBackfill } from './lib/event-place';
import { afterAllSettle, runSpineKeyCheck } from './lib/spine-keys-store';
import {
  FORMS_RETENTION_CEILING_DAYS,
  REGISTRATION_TTL_DAYS,
  SUBSCRIBER_RETENTION_DAYS,
} from './lib/retention-windows';
import { handleScanBatch, type ScanMessage } from './lib/scan-buffer';
import {
  createCostAccumulator,
  instrumentEnvForCost,
  normalizeOperation,
  emitOperationCost,
} from './lib/cost-metric';
import { isBucketTripped, scanRateLimitBuckets } from './lib/rate-limit';
import { summarizeUnhandledError } from './lib/unhandled-error-log';

import { errorLabel } from './lib/error-label';
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
      // The route pattern, the error class and what the error said, never the
      // URL: a signed link is a credential (lib/unhandled-error-log.ts).
      const failure = summarizeUnhandledError(err, request);
      // The same id on the line and on the answer (header and body): with the
      // code it is what a failure toast shows, so the line can be found later.
      const requestId = crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
      console.error(
        JSON.stringify({
          type: 'UNHANDLED_ERROR',
          errorClass: failure.errorClass,
          error: failure.error,
          op: failure.op,
          requestId,
          timestamp: new Date().toISOString(),
        })
      );
      response = Response.json(
        { ok: false, status: 500, code: 'INTERNAL', error: 'Internal server error', requestId },
        { status: 500, headers: { 'X-Request-Id': requestId } }
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
    // runRegistrationContactClear (owner 2026-10-11) clears a registrant's name
    //   and email the day after the event's last date: it reads event dates
    //   from DB and writes only FORMS_DB; only event ids pass between them.
    // runBigQueryBackup reads from the main DB and is kept separate for isolation.
    //   Its Phase 4 deletes email-list rows (subscribers, FORMS_DB since
    //   OSE-1661) older than subscriberRetentionDays(): 1 to 90 days, default
    //   90 (owner 2026-10-11). Audited to pii_audit_log like the other phases.
    // runSharedReportMaterialization (OSE-272 Session 3) reads DB only;
    //   off by default (env.ANON_ID_HASH_PEPPER unset → Phase 1 no-ops with
    //   structured warning). Phases 2 + 3 (corridor baseline + event-series
    //   detector) run regardless — they don't need the pepper.
    // runSharedReportBigQueryExport (OSE-272 Session 4) reads main DB only
    //   AND streams to BigQuery; off by default (BQ config unset → no-op).
    //   Same cron tick as materialization (S4-Q1 ratified), but SEQUENCED
    //   after it (runSharedReportPipeline, OSE-616): a refresh stamps all its
    //   baseline rows with one computed_at and writes them one by one, so an
    //   export reading mid-refresh would ship part of the group and advance its
    //   timestamp-only watermark past the rest for good. Per-phase
    //   failure-isolated (S4-Q4); the export still runs if materialization
    //   throws.
    // runSecurityMetricsCron (OSE-SEC-1): reads DB.admin_audit_log + RATE_LIMIT_KV;
    //   writes to DB.security_metrics + DB.security_alerts. Opens Linear issues
    //   for anomalies. Off-by-default guard: skips gracefully if tables don't exist.
    // runDraftExpiry (lib/draft-expiry.ts) touches DB.events ONLY: archives
    //   (never deletes) drafts untouched for DRAFT_EXPIRY_DAYS (default 30;
    //   0 = off). Future-dated drafts are left alone. Audits to admin_audit_log.
    // runCorridorLatch (lib/corridor-latch.ts, VISION §6.2b) reads DB.events and
    //   INSERT OR IGNOREs DB.corridor_readiness_latch: one row per (brand, res-7
    //   corridor) the first night it holds ≥ 5 upcoming published events. A
    //   one-way door; carries no identity. Never throws.
    // runScanReturnsRetention (lib/scan-returns-retention.ts, OSE-1351) reads
    //   DB.scan_node_returns + DB.anon_id_returns ONLY; on in every env since
    //   OSE-1659 (wrangler.toml SCAN_RETURNS_RETENTION_DAYS = "365"; unset →
    //   no-op). Deletes rows older than the window from both tables
    //   independently. Does NOT touch the ose_anon cookie
    //   lifetime — that remains a separate open decision. Audits to
    //   admin_audit_log.
    // runEventPlaceBackfill (lib/event-place.ts, owner report 2026-10-11) looks
    //   up the place of at most PLACE_BACKFILL_MAX (25) events a night that were
    //   saved before saves looked places up: not archived, not over, no
    //   coordinates, never looked up. DB.events only; a no-op without the Maps
    //   key. At most 25 billed Geocoding requests a night.
    // runSpineKeyCheck (lib/spine-keys-store.ts, OSE-1615) reads every event,
    //   computes its two spine keys again and writes them where they differ from
    //   what is stored: rows saved before migration 0104, rows whose keys could
    //   not be stored at save time, and rows some other writer left stale. One
    //   read per 500 events, at most 5,000 events, 200 writes and 10 seconds a
    //   night, from a start that moves each day. DB.events only; it calls no
    //   other service. It runs AFTER every job above has settled, failed ones
    //   included: computing keys costs CPU, and it must not compete with the
    //   retention jobs for the invocation's allowance. If one of them never
    //   settles the check does not run that night, and logs nothing.
    const jobs = [
      runFormDataLifecycle(env),
      runRegistrationContactClear(env),
      runBigQueryBackup(env),
      runSharedReportPipeline(env),
      runSecurityMetricsCron(env),
      runDraftExpiry(env),
      runCorridorLatch(env),
      runScanReturnsRetention(env),
      runEventPlaceBackfill(env),
    ];
    ctx.waitUntil(Promise.all(jobs));
    ctx.waitUntil(afterAllSettle(jobs, () => runSpineKeyCheck(env)));
  },

  // Scan write-buffer consumer (OSE — engine-hardening #1). Drains SCAN_QUEUE
  // and writes the scan rows in one batched D1 call per queue batch, keeping the
  // /q/ hot path shed of writes during a spike. Dark-launched: no-op until the
  // queue is provisioned and bound. See lib/scan-buffer.ts.
  async queue(
    batch: MessageBatch<ScanMessage>,
    env: RouterEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    await handleScanBatch(batch, env);
  },
};

/**
 * Materialize, THEN export (OSE-616). Never concurrently: the export's
 * timestamp-only watermark would otherwise advance past rows of a refresh
 * group that were not yet written. `finally` keeps the export running when
 * materialization throws (it then ships what is already complete); the
 * materialization error still propagates to the scheduler.
 */
async function runSharedReportPipeline(env: RouterEnv): Promise<void> {
  try {
    await runSharedReportMaterialization(env);
  } finally {
    await runSharedReportBigQueryExport(env);
  }
}

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

/**
 * Registrant contact clearing (owner 2026-10-11).
 *
 * A registrant may leave a name and an email so the organizer can reach them
 * if the event moves or is cancelled. Once the event is over there is nothing
 * left to tell them, so the night after the day after its last date (end date,
 * else start date), name and email are cleared. The row and its email hash
 * stay until the row's own expiry, so counts and erasure by email still work.
 *
 * The event's date lives in DB and the contact in FORMS_DB, so this runs
 * outside runFormDataLifecycle (forms-security S4 keeps that FORMS_DB-only).
 * Only event ids pass between the two: FORMS_DB names which events still hold
 * contacts, DB says which of those have ended, FORMS_DB clears those. A
 * rescheduled event is read at its new date. An event id with no event row
 * has nothing to tell anyone about, so it is cleared too. Bounded per night
 * (CONTACT_CLEAR_MAX_PAGES pages of CONTACT_CLEAR_PAGE event ids); audited
 * to pii_audit_log as 'registrations_contact_clear'.
 */
// D1 allows at most 100 bound values in one statement, so event ids go in
// pages of 90. Pages walk event ids in order, so a night with many open events
// still reaches the ended ones after them.
const CONTACT_CLEAR_PAGE = 90;
const CONTACT_CLEAR_MAX_PAGES = 50;

const HOLDS_CONTACT_SQL = `(attendee_email_encrypted IS NOT NULL
       OR attendee_name_encrypted IS NOT NULL
       OR attendee_name IS NOT NULL)`;

async function runRegistrationContactClear(env: RouterEnv): Promise<void> {
  let cleared = 0;
  let errors = 0;
  try {
    let after = '';
    for (let page = 0; page < CONTACT_CLEAR_MAX_PAGES; page++) {
      const held = await env.FORMS_DB.prepare(
        `SELECT DISTINCT event_id FROM form_registrations
          WHERE event_id > ? AND ${HOLDS_CONTACT_SQL}
          ORDER BY event_id
          LIMIT ?`
      )
        .bind(after, CONTACT_CLEAR_PAGE)
        .all<{ event_id: string }>();
      const ids = (held.results ?? []).map((r) => r.event_id).filter(Boolean);
      if (!ids.length) break;
      after = ids[ids.length - 1];
      const marks = ids.map(() => '?').join(', ');
      // An event still open, or that ended yesterday or later, keeps its contacts.
      const open = await env.DB.prepare(
        `SELECT id FROM events
          WHERE id IN (${marks})
            AND substr(COALESCE(end_date, start_date, ''), 1, 10) >= date('now', '-1 day')`
      )
        .bind(...ids)
        .all<{ id: string }>();
      const keep = new Set((open.results ?? []).map((r) => r.id));
      const done = ids.filter((id) => !keep.has(id));
      if (done.length) {
        const res = await env.FORMS_DB.prepare(
          `UPDATE form_registrations
              SET attendee_name = NULL, attendee_name_encrypted = NULL, attendee_email_encrypted = NULL
            WHERE event_id IN (${done.map(() => '?').join(', ')})
              AND ${HOLDS_CONTACT_SQL}`
        )
          .bind(...done)
          .run();
        cleared += res.meta?.changes ?? 0;
      }
      if (ids.length < CONTACT_CLEAR_PAGE) break;
    }
  } catch (err) {
    errors = 1;
    console.error(
      JSON.stringify({
        type: 'LIFECYCLE_PHASE_ERROR',
        phase: 'registrations_contact_clear',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
  }
  await logPiiAudit(env.FORMS_DB, 'registrations_contact_clear', cleared, errors);
}

/**
 * How many days an email-list row is kept (OSE-207). SUBSCRIBERS_RETENTION_DAYS
 * may shorten the window; anything that is not a whole number from 1 to the
 * forms ceiling (90, owner 2026-10-11) falls back to SUBSCRIBER_RETENTION_DAYS,
 * so a setting can neither switch the sweep off nor keep emails past 90 days.
 */
export function subscriberRetentionDays(raw: string | undefined): number {
  const n = raw == null ? NaN : Number(String(raw).trim());
  return Number.isInteger(n) && n >= 1 && n <= FORMS_RETENTION_CEILING_DAYS
    ? n
    : SUBSCRIBER_RETENTION_DAYS;
}

async function runFormDataLifecycle(env: RouterEnv): Promise<void> {
  const now = new Date().toISOString();
  const results: Record<string, unknown> = { timestamp: now };

  // ── Phase 1: Delete expired registrations ──────────────────────────────
  // A row with no expires_at ages out REGISTRATION_TTL_DAYS after it was made,
  // so no registration is kept for ever (OSE-1685, owner 2026-10-11).
  try {
    const del = await env.FORMS_DB.prepare(
      `DELETE FROM form_registrations
        WHERE (expires_at IS NOT NULL AND expires_at < ?)
           OR (expires_at IS NULL AND created_at < datetime('now', ?))`
    )
      .bind(now, `-${REGISTRATION_TTL_DAYS} days`)
      .run();
    const count = del.meta?.changes ?? 0;
    results.registrationsDeleted = count;
    await logPiiAudit(env.FORMS_DB, 'registrations_delete', count, 0);
  } catch (err) {
    results.registrationsError = errorLabel(err);
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
    results.surveysError = errorLabel(err);
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
    results.emailSignupsError = errorLabel(err);
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

  // ── Phase 4: Delete email-list rows past their window (OSE-207, OSE-1661) ─
  // The landing-page list (subscribers) moved to FORMS_DB in OSE-1661 and is
  // swept here with the other forms tables, so it is audited the same way.
  try {
    const days = subscriberRetentionDays(env.SUBSCRIBERS_RETENTION_DAYS);
    const del = await env.FORMS_DB.prepare(
      "DELETE FROM subscribers WHERE created_at < datetime('now', ?)"
    )
      .bind(`-${days} days`)
      .run();
    const count = del.meta?.changes ?? 0;
    results.subscribersDeleted = count;
    results.subscriberRetentionDays = days;
    await logPiiAudit(env.FORMS_DB, 'subscribers_delete', count, 0);
  } catch (err) {
    results.subscribersError = errorLabel(err);
    console.error(
      JSON.stringify({
        type: 'LIFECYCLE_PHASE_ERROR',
        phase: 'subscribers',
        error: results.subscribersError,
        timestamp: now,
      })
    );
    await logPiiAudit(env.FORMS_DB, 'subscribers_delete', 0, 1);
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

// ─── Security Metrics Cron ────────────────────────────────────────────────────
//
// Runs daily alongside the data lifecycle job (same cron tick: 3 AM UTC).
// Reads from:
//   - DB.admin_audit_log  → auth failure count
//   - RATE_LIMIT_KV       → buckets tripped at cron time (a snapshot of the
//                           active 60 s windows, NOT a daily total)
//   - DB.admin_audit_log  → approximated 4xx/5xx via denied outcomes
// Writes:
//   - DB.security_metrics → daily snapshot row (upsert)
//   - DB.security_alerts  → one row per anomaly threshold breach
//   - Linear              → issue per alert (via raiseSecurityAlert)
//
// Alert thresholds (environment-tunable via env vars):
//   AUTH_FAILURE_THRESHOLD         default 100 / day
//   RATE_LIMIT_TRIGGER_THRESHOLD   default 1000 tripped buckets at cron time
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
        error: errorLabel(err),
        timestamp: now,
      })
    );
  }

  // ── Phase 2: Rate-limit triggers from KV ────────────────────────────────
  // A bucket counts when it has tripped its own stored limit (isBucketTripped).
  // Buckets live 60 s, so this is a snapshot of who is blocked right now, not
  // a count for the day. KV list is eventually consistent; best-effort.
  try {
    let listed = 0;
    for await (const { entry } of scanRateLimitBuckets(env.RATE_LIMIT_KV)) {
      listed++;
      if (isBucketTripped(entry)) rateLimitTriggers++;
    }

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
        error: errorLabel(err),
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
        error: errorLabel(err),
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
          message: `Rate-limit triggers exceeded threshold: ${rateLimitTriggers} rate-limit buckets tripped across all scopes at cron time (threshold: ${RATE_LIMIT_TRIGGER_THRESHOLD})`,
          details: {
            count: rateLimitTriggers,
            threshold: RATE_LIMIT_TRIGGER_THRESHOLD,
            kvPrefix: 'ratelimit:',
            date: today,
          },
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
        error: errorLabel(err),
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
