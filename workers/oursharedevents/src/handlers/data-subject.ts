/**
 * Data Subject Rights endpoint — GDPR Art. 17 / CCPA §1798.105 / 13 US state laws.
 *
 * POST /api/v2/admin/data-subject/erase
 *   Accepts { email }, hashes it, deletes matching rows from email_signups and
 *   form_registrations, writes an audit record to pii_audit_log, and returns
 *   deletion counts.
 *
 *   Neither the raw email nor its hash is written to any log, audit row or
 *   response; only deletion counts and a job id leave the handler.
 *
 *   Decision (2026-10-07): an erasure is identified by a random job id, not by
 *   a second hash under an audit-only key. Any hash of the email, whatever its
 *   key, would still let its holder test whether an address was a subject, and
 *   would outlive the erasure. The job id is the `pii_audit_log` row id; the
 *   response and the DATA_SUBJECT_ERASE log line carry the same value, so an
 *   operator can show that an erasure ran without anything that names the person.
 *   Admin-only: caller must pass requireAdmin before this handler is invoked.
 *
 * OSE-1350 — anon-ID-linked scan/report rows.
 *   Before OSE-1350, erasure never touched `scan_node_returns` or
 *   `anon_id_returns`: those tables are keyed by the pseudonymous `anon_id`
 *   cookie, not by email, so a request-by-email erasure had no path to them.
 *   `form_registrations.anonymous_id` / `email_signups.anonymous_id` are the
 *   ONLY place the platform records "this email and this anon_id belong to
 *   the same visit" — captured at submission time (OSE-ADMIN-6). This handler
 *   delegates the identity-column lookup to `lib/erasure-anon-lookup.ts` (the
 *   single sanctioned "who ↔ anon_id" correlation seam — see that file's
 *   header) BEFORE deleting the email-keyed rows, then uses the returned
 *   anon_id(s) to also purge, in THIS file (which never itself reads a
 *   FORMS_DB identity column, preserving the P5 never-who static gate):
 *     - `scan_node_returns` (keyed scan id match, OSE-1659; raw match too for
 *       rows written before migration 0095)
 *     - `anon_id_returns`   (peppered anon_id_hash match — same pepper +
 *       normalization `shared-report.ts` uses at write time)
 *   A visitor who never submitted a form (scan-only, no email ever given) has
 *   no email-to-anon_id link recorded anywhere, so this cannot reach their
 *   scan rows. Since #860 (forms migration 0016) that holds for every visitor:
 *   FORMS_DB stores only per-event keyed ids, so the lookup finds a cookie value
 *   only in a legacy row. Those scan rows are bounded by the retention window
 *   (`SCAN_RETURNS_RETENTION_DAYS`, OSE-1351/OSE-1659) instead; ADR-001 records
 *   why erasure by email does not need to reach them.
 */

import { type FormsDbEnv, hashEmail, assertPepperConfigured } from '../lib/forms-db';
import { hashAnonIdForReturns } from '../lib/anon-id-hash';
import { scanNodeKey } from '../lib/scan-node-key';
import { findAnonIdsLinkedToEmailHash } from '../lib/erasure-anon-lookup';

/**
 * OSE-207 — subscribers table erase support.
 *
 * Data-at-rest doctrine (A-5): subscribers.email is no longer plaintext
 * (migration 0071). The row is keyed by a peppered HMAC-SHA256 `email_hash`
 * (the UNIQUE dedup + lookup key) alongside an AES-GCM `email_encrypted`. Erase
 * deletes by `email_hash` — computed with the SAME normalization the subscribe
 * path uses, so the hashes line up. Neither the raw email nor its emailHash is
 * logged, written to pii_audit_log, or returned (log redaction): the hash is a
 * stable pseudonym of the person being erased. Only counts leave this handler.
 */
export type DataSubjectEnv = FormsDbEnv & {
  /** Main DB binding — host of `scan_node_returns` and `anon_id_returns`. */
  DB: D1Database;
  // OSE-598: must match FORMS_HASH_PEPPER used at write time so deletion
  // lookups produce the same hash value as the stored email_hash columns.
  FORMS_HASH_PEPPER?: string;
  // OSE-1350: must match ANON_ID_HASH_PEPPER used at write time (shared-report.ts)
  // so the anon_id_returns lookup produces the same anon_id_hash value. If unset,
  // the anon_id_returns purge is skipped with a warning (see Phase E below), and
  // the scan_node_returns purge (Phase D) can match only raw values. OSE-1659:
  // the same pepper keys scan_node_returns.anonymous_id (lib/scan-node-key.ts).
  ANON_ID_HASH_PEPPER?: string;
};

export async function handleDataSubjectErase(
  request: Request,
  env: DataSubjectEnv
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { ok: false, status: 400, code: 'INVALID_BODY', error: 'Request body must be valid JSON' },
      { status: 400 }
    );
  }

  const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
  // Length is checked BEFORE the regex (OSE-1410, CodeQL js/polynomial-redos):
  // the pattern is polynomial on inputs like '!@!.' + '!.'.repeat(n), so an
  // unbounded string must never reach it. 320 = RFC 5321 max address length.
  if (!rawEmail || rawEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return Response.json(
      { ok: false, status: 400, code: 'INVALID_EMAIL', error: 'Valid email address is required' },
      { status: 400 }
    );
  }

  // OSE-712 (BLOCKER): the pepper MUST be provisioned on the erasure path.
  // A missing/rotated pepper would silently degrade to bare SHA-256, produce a
  // hash that cannot match rows written WITH a pepper, delete zero rows, and
  // return ok:true — a GDPR Art.17 / CCPA erasure that never happened, reported
  // as success. Fail loudly instead so the caller sees a real error.
  try {
    assertPepperConfigured(env.FORMS_HASH_PEPPER);
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DATA_SUBJECT_ERASE_PREFLIGHT_FAILED',
        reason: 'FORMS_HASH_PEPPER_MISSING',
        timestamp: new Date().toISOString(),
      })
    );
    return Response.json(
      {
        ok: false,
        status: 503,
        code: 'PEPPER_NOT_CONFIGURED',
        error:
          'Erasure is unavailable: the email-hash pepper is not provisioned. ' +
          'Refusing to run so a missing pepper cannot silently no-op an erasure.',
      },
      { status: 503 }
    );
  }

  const emailHash = await hashEmail(rawEmail, env.FORMS_HASH_PEPPER, { requirePepper: true });
  const now = new Date().toISOString();
  // Random, so it says nothing about the person: two erasures of one email get
  // two different ids.
  const jobId = crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`;
  let signupsDeleted = 0;
  let registrationsDeleted = 0;
  let subscribersDeleted = 0;
  let scanReturnsDeleted = 0;
  let anonIdReturnsDeleted = 0;
  let errors = 0;

  // OSE-1350: collect anon_id(s) linked to this email BEFORE deleting the rows
  // that carry the link (email_signups.anonymous_id / form_registrations.anonymous_id
  // — the only place email and anon_id are ever recorded together). Delegated to
  // lib/erasure-anon-lookup.ts, the single sanctioned "who ↔ anon_id" correlation
  // seam (see that file's header) — this keeps data-subject.ts itself free of any
  // FORMS_DB identity-column SELECT, so the P5 never-who static gate
  // (tests/anti-logging-proof.spec.ts) never treats this file as a cross-DB join
  // risk even though it also deletes from the main-DB scan tables below.
  // Best-effort: a lookup failure must not abort the core email-keyed erasure.
  let anonIds = new Set<string>();
  try {
    anonIds = await findAnonIdsLinkedToEmailHash(env, emailHash);
  } catch {
    errors++;
  }

  // Phase A: delete email signups by hash (independent — failure does not abort B)
  try {
    const res = await env.FORMS_DB.prepare('DELETE FROM email_signups WHERE email_hash = ?')
      .bind(emailHash)
      .run();
    signupsDeleted = res.meta?.changes ?? 0;
  } catch {
    errors++;
  }

  // Phase B: delete form registrations by email hash
  try {
    const res = await env.FORMS_DB.prepare(
      'DELETE FROM form_registrations WHERE attendee_email_hash = ?'
    )
      .bind(emailHash)
      .run();
    registrationsDeleted = res.meta?.changes ?? 0;
  } catch {
    errors++;
  }

  // Phase C (OSE-207): delete subscribers by peppered email_hash (A-5,
  // migration 0071). Lives in FORMS_DB since OSE-1661 (forms migration 0017).
  // The same emailHash computed above matches subscribers.email_hash because
  // both derive from the identical trim+lowercase+HMAC normalization. Never
  // touches raw email.
  try {
    const res = await env.FORMS_DB.prepare('DELETE FROM subscribers WHERE email_hash = ?')
      .bind(emailHash)
      .run();
    subscribersDeleted = res.meta?.changes ?? 0;
  } catch {
    errors++;
  }

  // Phase D (OSE-1350, OSE-1659): purge scan_node_returns rows for any anon_id
  // discovered above. The column holds the keyed scan id (lib/scan-node-key.ts),
  // so the id is keyed the same way first; the raw value is matched too, for a
  // row written before migration 0095 cleared raw values. Without
  // ANON_ID_HASH_PEPPER only the raw match can run.
  //
  // Phase E (OSE-1350): purge anon_id_returns rows. They hash the keyed scan id
  // (or, before OSE-1659, the raw id), so both hashes are deleted. A missing
  // pepper skips this phase with a warning rather than failing the request.
  //
  // In practice the set is empty since forms migration 0016 (#860): FORMS_DB
  // no longer holds a cookie value, so no stored record links an email to a scan
  // row. Those rows are bounded by SCAN_RETURNS_RETENTION_DAYS instead (ADR-001).
  if (anonIds.size > 0 && !env.ANON_ID_HASH_PEPPER) {
    console.warn(
      JSON.stringify({
        type: 'ANON_ID_HASH_PEPPER_MISSING',
        note: 'OSE-1350 erasure: only raw scan_node_returns values can be matched and the anon_id_returns purge is skipped. Set the ANON_ID_HASH_PEPPER secret.',
      })
    );
  }
  for (const anonId of anonIds) {
    let scanKey: string | null = null;
    try {
      scanKey = await scanNodeKey(anonId, env.ANON_ID_HASH_PEPPER);
      const res = await env.DB.prepare(
        'DELETE FROM scan_node_returns WHERE anonymous_id = ? OR anonymous_id = ?'
      )
        .bind(anonId, scanKey ?? anonId)
        .run();
      scanReturnsDeleted += res.meta?.changes ?? 0;
    } catch {
      errors++;
    }

    if (!env.ANON_ID_HASH_PEPPER) continue;
    try {
      const hashes = [
        await hashAnonIdForReturns(anonId, env.ANON_ID_HASH_PEPPER),
        scanKey ? await hashAnonIdForReturns(scanKey, env.ANON_ID_HASH_PEPPER) : null,
      ].filter((h): h is string => h !== null);
      if (hashes.length === 0) continue;
      const res = await env.DB.prepare(
        `DELETE FROM anon_id_returns WHERE anon_id_hash IN (${hashes.map(() => '?').join(', ')})`
      )
        .bind(...hashes)
        .run();
      anonIdReturnsDeleted += res.meta?.changes ?? 0;
    } catch {
      errors++;
    }
  }

  // Audit — write failure is non-fatal and must never abort the erasure response
  try {
    await env.FORMS_DB.prepare(
      `INSERT INTO pii_audit_log (id, phase, triggered_by, records_affected, errors, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        jobId,
        'data_subject_erase',
        'admin_api',
        signupsDeleted +
          registrationsDeleted +
          subscribersDeleted +
          scanReturnsDeleted +
          anonIdReturnsDeleted,
        errors,
        JSON.stringify({
          signupsDeleted,
          registrationsDeleted,
          subscribersDeleted,
          scanReturnsDeleted,
          anonIdReturnsDeleted,
          anonIdsLinked: anonIds.size,
        })
      )
      .run();
  } catch {
    // intentionally swallowed
  }

  console.log(
    JSON.stringify({
      type: 'DATA_SUBJECT_ERASE',
      jobId,
      signupsDeleted,
      registrationsDeleted,
      subscribersDeleted,
      scanReturnsDeleted,
      anonIdReturnsDeleted,
      errors,
      timestamp: now,
    })
  );

  return Response.json({
    ok: true,
    jobId,
    signupsDeleted,
    registrationsDeleted,
    subscribersDeleted,
    scanReturnsDeleted,
    anonIdReturnsDeleted,
    erasedAt: now,
  });
}
