/**
 * Data Subject Rights endpoint — GDPR Art. 17 / CCPA §1798.105 / 13 US state laws.
 *
 * POST /api/v2/admin/data-subject/erase
 *   Accepts { email }, hashes it, deletes matching rows from email_signups and
 *   form_registrations, writes an audit record to pii_audit_log, and returns
 *   deletion counts.
 *
 *   Raw email is never written to any log or response — only the SHA-256 hash.
 *   Admin-only: caller must pass requireAdmin before this handler is invoked.
 */

import { type FormsDbEnv, hashEmail } from '../lib/forms-db';

export type DataSubjectEnv = FormsDbEnv;

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
  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) || rawEmail.length > 320) {
    return Response.json(
      { ok: false, status: 400, code: 'INVALID_EMAIL', error: 'Valid email address is required' },
      { status: 400 }
    );
  }

  const emailHash = await hashEmail(rawEmail);
  const now = new Date().toISOString();
  let signupsDeleted = 0;
  let registrationsDeleted = 0;
  let errors = 0;

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

  // Audit — write failure is non-fatal and must never abort the erasure response
  try {
    const auditId = crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`;
    await env.FORMS_DB.prepare(
      `INSERT INTO pii_audit_log (id, phase, triggered_by, records_affected, errors, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        auditId,
        'data_subject_erase',
        'admin_api',
        signupsDeleted + registrationsDeleted,
        errors,
        JSON.stringify({ emailHash, signupsDeleted, registrationsDeleted })
      )
      .run();
  } catch {
    // intentionally swallowed
  }

  console.log(
    JSON.stringify({
      type: 'DATA_SUBJECT_ERASE',
      emailHash,
      signupsDeleted,
      registrationsDeleted,
      errors,
      timestamp: now,
    })
  );

  return Response.json({
    ok: true,
    emailHash,
    signupsDeleted,
    registrationsDeleted,
    erasedAt: now,
  });
}
