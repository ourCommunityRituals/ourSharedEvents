/**
 * Scan/report return-signal retention (OSE-1351, follow-up to OSE-1350).
 *
 * WHY. `scan_node_returns.anonymous_id` (a keyed scan id since OSE-1659; the raw
 * cookie value before it) and `anon_id_returns.anon_id_hash` (peppered) are the two tables that make cross-event correlation of one
 * pseudonymous visitor possible (see `.claude/sync/LINEAR-MAP.md`, "Known
 * residual: cross-event anon-ID correlation"). OSE-1350 (PR #621) closed the
 * on-request erasure path for any visitor who ever linked an email to their
 * anon_id via a form. It did NOT add a background retention window — rows for
 * every visitor (including scan-only visitors with no erasure path at all)
 * persist indefinitely absent that fix.
 *
 * A prior, ALREADY-RATIFIED decision (Q3, 2026-05-15 — see comment in
 * `migrations/0031_create_anon_id_returns.sql`) intentionally left
 * `anon_id_returns` unwindowed at the table level, reasoning that the 1-year
 * `ose_anon` cookie naturally bounds how long a given pseudonym can accrue
 * NEW correlated visits. That reasoning does not, however, bound how long an
 * ALREADY-WRITTEN row survives — which is exactly the gap OSE-1351 tracks.
 *
 * In code it stays OFF BY DEFAULT (unset env knob → no-op with a structured log
 * line), like OSE-207's subscribers retention. The ruling came with OSE-1659
 * (2026-10-09): `wrangler.toml` sets `SCAN_RETURNS_RETENTION_DAYS = "365"` in
 * every env, the `ose_anon` cookie lifetime that Q3 already treats as the bound
 * on one pseudonym. `tests/scan-returns-retention-config.spec.ts` fails if any
 * env drops it or sets it below 180 days.
 *
 * WHAT IT DOES:
 *   - `scan_node_returns`: DELETE rows whose `scan_bucket` (the scan's hour) is
 *     older than N days. Keyed on the bucket, not `created_at`, because neither
 *     split table keeps a time finer than the hour (OSE-923, migration 0100).
 *   - `anon_id_returns`: DELETE rows whose `last_seen_at` is older than N days
 *     — keyed off the most recent return, not the first sighting, so a
 *     pseudonym that keeps returning within the window never ages out even if
 *     `first_seen_at` is old.
 *   - Both DELETEs are independent and failure-isolated (one table's error
 *     never blocks the other), matching the per-phase isolation convention
 *     used by `lib/shared-report.ts` and `runSharedReportMaterialization`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: change the `ose_anon` cookie's `Max-Age`.
 * That is a separate, still-open product/UX decision tracked in OSE-1351 —
 * shortening it is a behavior change for every visitor's browser, not an
 * ops-side data lifecycle knob, and shouldn't be bundled into a retention-job
 * PR without its own ruling.
 *
 * AUDIT. Every run writes one `admin_audit_log` row (action
 * `SCAN_RETURNS_RETENTION`, actor `system:lifecycle`) with counts and the
 * configured window — never-who: no anon_id or hash is ever logged, only
 * aggregate counts, mirroring OSE-207 / `draft-expiry.ts`.
 */

import { errorLabel } from './error-label';

export interface ScanReturnsRetentionEnv {
  DB: D1Database;
  SCAN_RETURNS_RETENTION_DAYS?: string;
}

export interface ScanReturnsRetentionResult {
  enabled: boolean;
  days: number;
  scanReturnsDeleted: number;
  anonIdReturnsDeleted: number;
  errors: number;
}

/**
 * Resolve the configured window. Unset / blank / non-positive → disabled (0),
 * matching OSE-207's subscribers-retention default (off until an explicit
 * ruling sets the knob) rather than draft-expiry's default-on 30 days — this
 * job DELETES pseudonymous correlation signal, not archives an event.
 */
export function resolveScanReturnsRetentionDays(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 0;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export async function runScanReturnsRetention(
  env: ScanReturnsRetentionEnv
): Promise<ScanReturnsRetentionResult> {
  const now = new Date().toISOString();
  const days = resolveScanReturnsRetentionDays(env.SCAN_RETURNS_RETENTION_DAYS);
  const result: ScanReturnsRetentionResult = {
    enabled: days > 0,
    days,
    scanReturnsDeleted: 0,
    anonIdReturnsDeleted: 0,
    errors: 0,
  };

  if (!result.enabled) {
    console.log(
      JSON.stringify({
        type: 'SCAN_RETURNS_RETENTION_NOOP',
        reason:
          'SCAN_RETURNS_RETENTION_DAYS unset or non-positive; scan_node_returns/anon_id_returns retention is uncapped (wrangler.toml sets 365 in every env, OSE-1659)',
        timestamp: now,
      })
    );
    await audit(env, 'noop', result);
    return result;
  }

  const window = `-${days} days`;

  try {
    const res = await env.DB.prepare(
      "DELETE FROM scan_node_returns WHERE scan_bucket < strftime('%Y-%m-%dT%H:00', 'now', ?)"
    )
      .bind(window)
      .run();
    result.scanReturnsDeleted = res.meta?.changes ?? 0;
  } catch (err) {
    result.errors++;
    console.error(
      JSON.stringify({
        type: 'SCAN_RETURNS_RETENTION_ERROR',
        table: 'scan_node_returns',
        error: errorLabel(err),
        days,
        timestamp: now,
      })
    );
  }

  try {
    const res = await env.DB.prepare(
      "DELETE FROM anon_id_returns WHERE last_seen_at < datetime('now', ?)"
    )
      .bind(window)
      .run();
    result.anonIdReturnsDeleted = res.meta?.changes ?? 0;
  } catch (err) {
    result.errors++;
    console.error(
      JSON.stringify({
        type: 'SCAN_RETURNS_RETENTION_ERROR',
        table: 'anon_id_returns',
        error: errorLabel(err),
        days,
        timestamp: now,
      })
    );
  }

  console.log(
    JSON.stringify({
      type: 'SCAN_RETURNS_RETENTION_COMPLETE',
      days,
      scanReturnsDeleted: result.scanReturnsDeleted,
      anonIdReturnsDeleted: result.anonIdReturnsDeleted,
      errors: result.errors,
      timestamp: now,
    })
  );
  await audit(env, 'success', result);
  return result;
}

async function audit(
  env: ScanReturnsRetentionEnv,
  outcomeRaw: 'success' | 'noop',
  r: ScanReturnsRetentionResult
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
        'SCAN_RETURNS_RETENTION',
        'system:lifecycle',
        'scan_node_returns',
        null,
        id,
        outcome,
        null,
        JSON.stringify({
          outcomeRaw,
          days: r.days,
          scanReturnsDeleted: r.scanReturnsDeleted,
          anonIdReturnsDeleted: r.anonIdReturnsDeleted,
          errors: r.errors,
        })
      )
      .run();
  } catch {
    // Audit failures must never break the lifecycle job.
  }
}
