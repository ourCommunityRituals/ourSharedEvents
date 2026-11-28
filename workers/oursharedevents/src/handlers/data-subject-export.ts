/**
 * Data Subject access and portability — GDPR Art. 15 / Art. 20.
 *
 * POST /api/v2/admin/data-subject/export
 *   Accepts { email }, hashes it the same way the erase path does, and returns
 *   every forms-database row held for that address, with names and emails
 *   decrypted, so an operator can answer an access request. The sibling of
 *   POST /api/v2/admin/data-subject/erase (handlers/data-subject.ts).
 *
 *   POST, not GET, so the address never sits in a URL or an access log.
 *   Platform-only, like erase: the router runs requireAdmin and _platformOnly
 *   before this handler.
 *
 *   What leaves the handler: the rows, for the operator to send to the person.
 *   What never leaves it: the email hash (the same rule as erase,
 *   tests/data-subject-erase-no-lookup-hash.spec.ts), the raw anonymous id and
 *   any keyed id. The audit row and the log line carry a random job id and
 *   counts only.
 *
 *   FORMS_DB only. This file never reads the main database: the anonymous scan
 *   tables are keyed by a cookie, not by an email, and no stored record links
 *   the two (ADR-001, lib/erasure-anon-lookup.ts). The response says so, so the
 *   person learns why scan history is not in the file.
 */

import { assertPepperConfigured, decryptText, hashEmail, type FormsDbEnv } from '../lib/forms-db';

export type DataSubjectExportEnv = FormsDbEnv & {
  FORMS_HASH_PEPPER?: string;
};

type Row = Record<string, unknown>;

async function decryptOrNote(value: unknown, key: string | undefined): Promise<string | null> {
  if (typeof value !== 'string' || value === '') return null;
  if (!key) return '[encrypted: key not configured]';
  try {
    return await decryptText(value, key);
  } catch {
    return '[encrypted: could not be read]';
  }
}

export async function handleDataSubjectExport(
  request: Request,
  env: DataSubjectExportEnv
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
  // Length before the regex, as in erase (OSE-1410, polynomial regex).
  if (!rawEmail || rawEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return Response.json(
      { ok: false, status: 400, code: 'INVALID_EMAIL', error: 'Valid email address is required' },
      { status: 400 }
    );
  }

  // Without the pepper the hash cannot match stored rows, and an empty export
  // would be reported as "we hold nothing". Refuse instead (same as erase).
  try {
    assertPepperConfigured(env.FORMS_HASH_PEPPER);
  } catch {
    return Response.json(
      {
        ok: false,
        status: 503,
        code: 'PEPPER_NOT_CONFIGURED',
        error: 'Export is unavailable: the email-hash pepper is not provisioned.',
      },
      { status: 503 }
    );
  }

  const emailHash = await hashEmail(rawEmail, env.FORMS_HASH_PEPPER, { requirePepper: true });
  const key = env.FORMS_ENCRYPTION_KEY;
  const jobId = crypto.randomUUID ? crypto.randomUUID() : `export-${Date.now()}`;
  const now = new Date().toISOString();
  let errors = 0;

  const registrations: Row[] = [];
  try {
    const res = await env.FORMS_DB.prepare(
      `SELECT event_id, attendee_name_encrypted, attendee_email_encrypted, status,
              consent_type, consent_given_at, created_at, expires_at
         FROM form_registrations WHERE attendee_email_hash = ? ORDER BY created_at, id`
    )
      .bind(emailHash)
      .all<Row>();
    for (const r of res.results ?? []) {
      registrations.push({
        event_id: r.event_id,
        name: await decryptOrNote(r.attendee_name_encrypted, key),
        email: await decryptOrNote(r.attendee_email_encrypted, key),
        status: r.status,
        consent_type: r.consent_type,
        consent_given_at: r.consent_given_at,
        registered_at: r.created_at,
        deleted_by: r.expires_at,
      });
    }
  } catch {
    errors++;
  }

  const eventSignups: Row[] = [];
  try {
    const res = await env.FORMS_DB.prepare(
      `SELECT event_id, email_encrypted, consent_given_at, created_at, retention_expires_at
         FROM email_signups WHERE email_hash = ? ORDER BY created_at, id`
    )
      .bind(emailHash)
      .all<Row>();
    for (const r of res.results ?? []) {
      eventSignups.push({
        event_id: r.event_id,
        email: await decryptOrNote(r.email_encrypted, key),
        consent_given_at: r.consent_given_at,
        signed_up_at: r.created_at,
        deleted_by: r.retention_expires_at,
      });
    }
  } catch {
    errors++;
  }

  const updatesList: Row[] = [];
  try {
    const res = await env.FORMS_DB.prepare(
      `SELECT email_encrypted, source, created_at
         FROM subscribers WHERE email_hash = ? ORDER BY created_at, id`
    )
      .bind(emailHash)
      .all<Row>();
    for (const r of res.results ?? []) {
      updatesList.push({
        email: await decryptOrNote(r.email_encrypted, key),
        source: r.source,
        joined_at: r.created_at,
      });
    }
  } catch {
    errors++;
  }

  const found = registrations.length + eventSignups.length + updatesList.length;

  try {
    await env.FORMS_DB.prepare(
      `INSERT INTO pii_audit_log (id, phase, triggered_by, records_affected, errors, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        jobId,
        'data_subject_export',
        'admin_api',
        found,
        errors,
        JSON.stringify({
          registrations: registrations.length,
          eventSignups: eventSignups.length,
          updatesList: updatesList.length,
        })
      )
      .run();
  } catch {
    // intentionally swallowed: an audit failure must not block an access request
  }

  console.log(
    JSON.stringify({ type: 'DATA_SUBJECT_EXPORT', jobId, found, errors, timestamp: now })
  );

  const res = Response.json({
    ok: true,
    jobId,
    exportedAt: now,
    errors,
    data: {
      registrations,
      event_email_signups: eventSignups,
      updates_list: updatesList,
    },
    not_included:
      'Anonymous counts, scans and votes are kept under a random cookie id, never under a ' +
      'name or email, so they cannot be found by email. Survey comments are scrubbed of ' +
      'personal details within 24 hours.',
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
