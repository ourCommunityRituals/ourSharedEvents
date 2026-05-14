/**
 * 4-Layer Form System handlers.
 *
 * All form data lives in FORMS_DB — NEVER linked to the anonymous scan system (DB).
 *
 * Container pattern (OSE-204): All 4 public form handlers share the
 * `validateFormRequest()` / `handleDbError()` / `trimStr()` container from
 * `src/lib/form-validation.ts`. The L1 static invariant gate
 * (`tests/form-validation-invariant.spec.ts`) asserts every public form
 * handler imports + uses this container — any drift fails CI.
 *
 * Feature flags: Callers can pass ?disabled=register,survey to disable specific
 * form types per event. The router reads event config and passes enabled types.
 *
 * Public (no auth):
 *   POST /api/v2/events/:id/forms/register      → submit registration
 *   POST /api/v2/events/:id/forms/checkin        → increment check-in count
 *   POST /api/v2/events/:id/forms/survey         → submit survey response
 *   POST /api/v2/events/:id/forms/email-signup   → submit email signup
 *
 * Admin (auth required):
 *   GET /api/v2/admin/events/:id/forms/registrations  → list registrations
 *   GET /api/v2/admin/events/:id/forms/checkin-count  → get check-in count
 *   GET /api/v2/admin/events/:id/forms/surveys        → list surveys (PII-scrubbed only)
 *   GET /api/v2/admin/events/:id/forms/email-signups  → list email signups (count only)
 */

import {
  type FormsDbEnv,
  hashEmail,
  bucketTimestamp,
  encryptEmail,
  decryptEmail,
  generateId,
} from '../lib/forms-db';
import { corsHeaders } from '../lib/cors';
import { getOrCreateAnonId, setAnonCookie } from '../lib/anonymous-id';
import {
  validateFormRequest,
  handleDbError,
  errorResponse,
  jsonResponse,
  trimStr,
  type FormType,
} from '../lib/form-validation';

export interface FormsEnv extends FormsDbEnv {
  FORMS_ENCRYPTION_KEY?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const REGISTRATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const EMAIL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

/** SDET: Structured observability log for every form event */
function logFormEvent(
  formType: FormType,
  eventId: string,
  action: 'submit' | 'admin_read' | 'lifecycle' | 'error',
  meta: Record<string, unknown> = {}
): void {
  console.log(
    JSON.stringify({
      type: 'FORM_EVENT',
      formType,
      eventId,
      action,
      timestamp: new Date().toISOString(),
      ...meta,
    })
  );
}

// ─── Public: Registration ───────────────────────────────────────────────────────

export async function handleFormRegistration(
  request: Request,
  env: FormsEnv,
  eventId: string
): Promise<Response> {
  const start = Date.now();
  const { body, error } = await validateFormRequest(request, eventId, true);
  if (error) return error;

  const { anonId, isNew } = getOrCreateAnonId(request);
  const name = trimStr(body!.name, 200);
  const rawEmail = trimStr(body!.email, 320);
  if (rawEmail && !isValidEmail(rawEmail)) {
    return errorResponse('INVALID_EMAIL', 'Invalid email format', 400, request);
  }
  const email = rawEmail;
  // sourcePlacementId is not trimmed for whitespace — IDs MAY contain
  // significant leading/trailing chars. Just bound the length.
  const sourcePlacementId =
    typeof body!.sourcePlacementId === 'string' ? body!.sourcePlacementId.slice(0, 128) : undefined;

  const emailHash = email ? await hashEmail(email) : undefined;
  const bucket = bucketTimestamp();
  const id = generateId();
  const expiresAt = new Date(Date.now() + REGISTRATION_TTL_MS).toISOString();

  try {
    await env.FORMS_DB.prepare(
      `INSERT INTO form_registrations (id, event_id, source_placement_id, attendee_name, attendee_email_hash, registration_bucket, status, expires_at, anonymous_id, consent_given_at)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`
    )
      .bind(
        id,
        eventId,
        sourcePlacementId ?? null,
        name ?? null,
        emailHash ?? null,
        bucket,
        expiresAt,
        anonId,
        new Date().toISOString()
      )
      .run();
  } catch (err) {
    return handleDbError('register', eventId, err, request);
  }

  logFormEvent('register', eventId, 'submit', { id, anonId, isNew, latencyMs: Date.now() - start });
  const res = jsonResponse({ ok: true, id, registrationBucket: bucket }, request);
  return isNew ? setAnonCookie(res, anonId) : res;
}

// ─── Public: Check-in ───────────────────────────────────────────────────────────

export async function handleFormCheckin(
  request: Request,
  env: FormsEnv,
  eventId: string
): Promise<Response> {
  const start = Date.now();
  const { error } = await validateFormRequest(request, eventId, false);
  if (error) return error;

  const { anonId, isNew } = getOrCreateAnonId(request);

  try {
    const id = generateId();
    await env.FORMS_DB.prepare(
      `INSERT INTO checkin_counts (id, event_id, total_count, updated_at, last_anonymous_id)
       VALUES (?, ?, 1, datetime('now'), ?)
       ON CONFLICT(event_id) DO UPDATE SET total_count = total_count + 1, updated_at = datetime('now'), last_anonymous_id = ?`
    )
      .bind(id, eventId, anonId, anonId)
      .run();

    const result = await env.FORMS_DB.prepare(
      'SELECT total_count FROM checkin_counts WHERE event_id = ?'
    )
      .bind(eventId)
      .first<{ total_count: number }>();

    const count = result?.total_count ?? 1;
    logFormEvent('checkin', eventId, 'submit', {
      count,
      anonId,
      isNew,
      latencyMs: Date.now() - start,
    });
    const res = jsonResponse({ ok: true, count }, request);
    return isNew ? setAnonCookie(res, anonId) : res;
  } catch (err) {
    return handleDbError('checkin', eventId, err, request);
  }
}

// ─── Public: Survey ─────────────────────────────────────────────────────────────

export async function handleFormSurvey(
  request: Request,
  env: FormsEnv,
  eventId: string
): Promise<Response> {
  const start = Date.now();
  const { body, error } = await validateFormRequest(request, eventId, true);
  if (error) return error;

  const { anonId, isNew } = getOrCreateAnonId(request);
  const responses = body!.responses;
  if (!responses || typeof responses !== 'object') {
    return errorResponse('MISSING_FIELD', 'Missing required field: responses', 400, request);
  }

  const id = generateId();
  const bucket = bucketTimestamp();

  try {
    await env.FORMS_DB.prepare(
      `INSERT INTO form_surveys (id, event_id, responses_json, submitted_bucket, pii_scrubbed, anonymous_id, consent_given_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    )
      .bind(id, eventId, JSON.stringify(responses), bucket, anonId, new Date().toISOString())
      .run();
  } catch (err) {
    return handleDbError('survey', eventId, err, request);
  }

  logFormEvent('survey', eventId, 'submit', { id, anonId, isNew, latencyMs: Date.now() - start });
  const res = jsonResponse({ ok: true, id }, request);
  return isNew ? setAnonCookie(res, anonId) : res;
}

// ─── Public: Email Signup ───────────────────────────────────────────────────────

export async function handleFormEmailSignup(
  request: Request,
  env: FormsEnv,
  eventId: string
): Promise<Response> {
  const start = Date.now();
  const { body, error } = await validateFormRequest(request, eventId, true);
  if (error) return error;

  const { anonId, isNew } = getOrCreateAnonId(request);
  const email = trimStr(body!.email, 320) ?? '';
  if (!email) return errorResponse('MISSING_FIELD', 'Missing required field: email', 400, request);
  if (!isValidEmail(email))
    return errorResponse('INVALID_EMAIL', 'Invalid email format', 400, request);

  const encryptionKey = env.FORMS_ENCRYPTION_KEY;
  if (!encryptionKey)
    return errorResponse('CONFIG_ERROR', 'FORMS_ENCRYPTION_KEY not configured', 503, request);

  try {
    const emailHash = await hashEmail(email);

    const existing = await env.FORMS_DB.prepare(
      'SELECT id FROM email_signups WHERE event_id = ? AND email_hash = ?'
    )
      .bind(eventId, emailHash)
      .first();

    if (existing) {
      logFormEvent('email-signup', eventId, 'submit', {
        duplicate: true,
        anonId,
        latencyMs: Date.now() - start,
      });
      const res = jsonResponse({ ok: true, id: existing.id as string, duplicate: true }, request);
      return isNew ? setAnonCookie(res, anonId) : res;
    }

    const encrypted = await encryptEmail(email, encryptionKey);
    const id = generateId();
    const bucket = bucketTimestamp();
    const retentionExpiresAt = new Date(Date.now() + EMAIL_RETENTION_MS).toISOString();

    await env.FORMS_DB.prepare(
      `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at, anonymous_id, consent_given_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        eventId,
        emailHash,
        encrypted,
        bucket,
        retentionExpiresAt,
        anonId,
        new Date().toISOString()
      )
      .run();

    logFormEvent('email-signup', eventId, 'submit', {
      id,
      anonId,
      isNew,
      latencyMs: Date.now() - start,
    });
    const res = jsonResponse({ ok: true, id }, request);
    return isNew ? setAnonCookie(res, anonId) : res;
  } catch (err) {
    return handleDbError('email-signup', eventId, err, request);
  }
}

// ─── Admin: List Registrations ──────────────────────────────────────────────────

export async function handleAdminRegistrations(
  request: Request,
  env: FormsEnv,
  eventId: string
): Promise<Response> {
  try {
    const result = await env.FORMS_DB.prepare(
      'SELECT id, event_id, source_placement_id, attendee_name, attendee_email_hash, registration_bucket, status, created_at FROM form_registrations WHERE event_id = ? ORDER BY created_at DESC'
    )
      .bind(eventId)
      .all();

    logFormEvent('register', eventId, 'admin_read', { count: result.results.length });
    return jsonResponse({ ok: true, items: result.results, count: result.results.length }, request);
  } catch (err) {
    return handleDbError('register', eventId, err, request);
  }
}

// ─── Admin: Check-in Count ──────────────────────────────────────────────────────

export async function handleAdminCheckinCount(
  request: Request,
  env: FormsEnv,
  eventId: string
): Promise<Response> {
  try {
    const result = await env.FORMS_DB.prepare(
      'SELECT total_count FROM checkin_counts WHERE event_id = ?'
    )
      .bind(eventId)
      .first<{ total_count: number }>();

    const count = result?.total_count ?? 0;
    logFormEvent('checkin', eventId, 'admin_read', { count });
    return jsonResponse({ ok: true, count }, request);
  } catch (err) {
    return handleDbError('checkin', eventId, err, request);
  }
}

// ─── Admin: List Surveys (PII-scrubbed only) ───────────────────────────────────

export async function handleAdminSurveys(
  request: Request,
  env: FormsEnv,
  eventId: string
): Promise<Response> {
  try {
    const result = await env.FORMS_DB.prepare(
      'SELECT id, event_id, responses_json, submitted_bucket, created_at FROM form_surveys WHERE event_id = ? AND pii_scrubbed = 1 ORDER BY created_at DESC'
    )
      .bind(eventId)
      .all();

    logFormEvent('survey', eventId, 'admin_read', { count: result.results.length });
    return jsonResponse({ ok: true, items: result.results, count: result.results.length }, request);
  } catch (err) {
    return handleDbError('survey', eventId, err, request);
  }
}

// ─── Admin: Email Signup Count ──────────────────────────────────────────────────

export async function handleAdminEmailSignupCount(
  request: Request,
  env: FormsEnv,
  eventId: string
): Promise<Response> {
  try {
    const result = await env.FORMS_DB.prepare(
      'SELECT COUNT(*) as cnt FROM email_signups WHERE event_id = ?'
    )
      .bind(eventId)
      .first<{ cnt: number }>();

    const count = result?.cnt ?? 0;
    logFormEvent('email-signup', eventId, 'admin_read', { count });
    return jsonResponse({ ok: true, count }, request);
  } catch (err) {
    return handleDbError('email-signup', eventId, err, request);
  }
}

// ─── Admin: Export Form Data ──────────────────────────────────────────────────

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join(
    '\n'
  );
}

/**
 * GET /api/v2/admin/events/:id/forms/export?type=registrations|surveys|email-signups&format=csv|json
 *
 * Exports form data. Surveys only include PII-scrubbed rows.
 * Default format: json. CSV returns a downloadable file.
 */
export async function handleAdminExport(
  request: Request,
  env: FormsEnv,
  eventId: string
): Promise<Response> {
  const url = new URL(request.url);
  const dataType = url.searchParams.get('type') ?? 'registrations';
  const format = url.searchParams.get('format') ?? 'json';

  let query: string;
  switch (dataType) {
    case 'registrations':
      query =
        'SELECT id, event_id, attendee_name, registration_bucket, status, created_at FROM form_registrations WHERE event_id = ? ORDER BY created_at DESC';
      break;
    case 'surveys':
      query =
        'SELECT id, event_id, responses_json, submitted_bucket, created_at FROM form_surveys WHERE event_id = ? AND pii_scrubbed = 1 ORDER BY created_at DESC';
      break;
    case 'email-signups':
      query =
        'SELECT id, event_id, email_encrypted, signup_bucket, consent_given_at, created_at FROM email_signups WHERE event_id = ? ORDER BY created_at DESC';
      break;
    default:
      return errorResponse('INVALID_TYPE', `Unknown export type: ${dataType}`, 400, request);
  }

  try {
    const result = await env.FORMS_DB.prepare(query).bind(eventId).all();
    let rows = (result.results ?? []) as Record<string, unknown>[];

    // Decrypt email addresses for admin export — never expose raw ciphertext
    if (dataType === 'email-signups' && env.FORMS_ENCRYPTION_KEY) {
      const key = env.FORMS_ENCRYPTION_KEY;
      rows = await Promise.all(
        rows.map(async (row) => {
          const { email_encrypted, ...rest } = row;
          if (typeof email_encrypted === 'string') {
            try {
              return { ...rest, email: await decryptEmail(email_encrypted, key) };
            } catch {
              return { ...rest, email: null };
            }
          }
          return rest;
        })
      );
    }

    logFormEvent(dataType as FormType, eventId, 'admin_read', { count: rows.length, format });

    if (format === 'csv') {
      const csv = toCsv(rows);
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${eventId}-${dataType}.csv"`,
          ...corsHeaders(request),
        },
      });
    }

    return jsonResponse({ ok: true, items: rows, count: rows.length }, request);
  } catch (err) {
    return handleDbError(dataType as FormType, eventId, err, request);
  }
}
