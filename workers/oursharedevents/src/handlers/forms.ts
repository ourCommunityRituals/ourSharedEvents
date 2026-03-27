/**
 * 4-Layer Form System handlers.
 *
 * All form data lives in FORMS_DB — NEVER linked to the anonymous scan system (DB).
 *
 * Container pattern: All 4 form types share validateFormRequest() for input
 * validation, logFormEvent() for observability, handleDbError() for D1 fault
 * tolerance, and jsonResponse/errorResponse for consistent error handling.
 * Each type implements its own success response shape.
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

import { type FormsDbEnv, hashEmail, bucketTimestamp, encryptEmail, generateId } from '../lib/forms-db';

export interface FormsEnv extends FormsDbEnv {
  FORMS_ENCRYPTION_KEY?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 16 * 1024;
const REGISTRATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const EMAIL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Container Pattern: Shared Infrastructure ───────────────────────────────────

type FormType = 'register' | 'checkin' | 'survey' | 'email-signup';

function requestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'X-Request-Id': requestId(),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ ok: false, status, code, error: message, timestamp: new Date().toISOString() }, status);
}

function isValidEventId(id: string): boolean {
  return id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** SDET: Structured observability log for every form event */
function logFormEvent(
  formType: FormType,
  eventId: string,
  action: 'submit' | 'admin_read' | 'lifecycle' | 'error',
  meta: Record<string, unknown> = {},
): void {
  console.log(JSON.stringify({
    type: 'FORM_EVENT',
    formType,
    eventId,
    action,
    timestamp: new Date().toISOString(),
    ...meta,
  }));
}

/** BE: Consistent D1 error handling — logs and returns 503 */
function handleDbError(formType: FormType, eventId: string, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  logFormEvent(formType, eventId, 'error', { error: message });
  return errorResponse('DB_ERROR', 'Service temporarily unavailable', 503);
}

/** Container: shared pre-processing for all public form submissions. */
async function validateFormRequest(
  request: Request,
  eventId: string,
  requireBody: boolean,
): Promise<{ body: Record<string, unknown> | null; error: Response | null }> {
  if (!isValidEventId(eventId)) {
    return { body: null, error: errorResponse('INVALID_EVENT_ID', 'Invalid event ID format', 400) };
  }
  if (!requireBody) return { body: null, error: null };
  const body = await parseJsonBody(request);
  if (!body) {
    return { body: null, error: errorResponse('INVALID_BODY', 'Request body must be valid JSON under 16KB', 400) };
  }
  return { body, error: null };
}

// ─── Public: Registration ───────────────────────────────────────────────────────

export async function handleFormRegistration(
  request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  const start = Date.now();
  const { body, error } = await validateFormRequest(request, eventId, true);
  if (error) return error;

  const name = typeof body!.name === 'string' ? body!.name.trim().slice(0, 200) : undefined;
  const email = typeof body!.email === 'string' ? body!.email.trim().slice(0, 320) : undefined;
  const sourcePlacementId = typeof body!.sourcePlacementId === 'string' ? body!.sourcePlacementId.slice(0, 128) : undefined;

  const emailHash = email ? await hashEmail(email) : undefined;
  const bucket = bucketTimestamp();
  const id = generateId();
  const expiresAt = new Date(Date.now() + REGISTRATION_TTL_MS).toISOString();

  try {
    await env.FORMS_DB.prepare(
      `INSERT INTO form_registrations (id, event_id, source_placement_id, attendee_name, attendee_email_hash, registration_bucket, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
    )
      .bind(id, eventId, sourcePlacementId ?? null, name ?? null, emailHash ?? null, bucket, expiresAt)
      .run();
  } catch (err) {
    return handleDbError('register', eventId, err);
  }

  logFormEvent('register', eventId, 'submit', { id, latencyMs: Date.now() - start });
  return jsonResponse({ ok: true, id, registrationBucket: bucket });
}

// ─── Public: Check-in ───────────────────────────────────────────────────────────

export async function handleFormCheckin(
  request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  const start = Date.now();
  const { error } = await validateFormRequest(request, eventId, false);
  if (error) return error;

  try {
    const id = generateId();
    await env.FORMS_DB.prepare(
      `INSERT INTO checkin_counts (id, event_id, total_count, updated_at)
       VALUES (?, ?, 1, datetime('now'))
       ON CONFLICT(event_id) DO UPDATE SET total_count = total_count + 1, updated_at = datetime('now')`,
    )
      .bind(id, eventId)
      .run();

    const result = await env.FORMS_DB.prepare(
      'SELECT total_count FROM checkin_counts WHERE event_id = ?',
    )
      .bind(eventId)
      .first<{ total_count: number }>();

    const count = result?.total_count ?? 1;
    logFormEvent('checkin', eventId, 'submit', { count, latencyMs: Date.now() - start });
    return jsonResponse({ ok: true, count });
  } catch (err) {
    return handleDbError('checkin', eventId, err);
  }
}

// ─── Public: Survey ─────────────────────────────────────────────────────────────

export async function handleFormSurvey(
  request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  const start = Date.now();
  const { body, error } = await validateFormRequest(request, eventId, true);
  if (error) return error;

  const responses = body!.responses;
  if (!responses || typeof responses !== 'object') {
    return errorResponse('MISSING_FIELD', 'Missing required field: responses', 400);
  }

  const id = generateId();
  const bucket = bucketTimestamp();

  try {
    await env.FORMS_DB.prepare(
      `INSERT INTO form_surveys (id, event_id, responses_json, submitted_bucket, pii_scrubbed)
       VALUES (?, ?, ?, ?, 0)`,
    )
      .bind(id, eventId, JSON.stringify(responses), bucket)
      .run();
  } catch (err) {
    return handleDbError('survey', eventId, err);
  }

  logFormEvent('survey', eventId, 'submit', { id, latencyMs: Date.now() - start });
  return jsonResponse({ ok: true, id });
}

// ─── Public: Email Signup ───────────────────────────────────────────────────────

export async function handleFormEmailSignup(
  request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  const start = Date.now();
  const { body, error } = await validateFormRequest(request, eventId, true);
  if (error) return error;

  const email = typeof body!.email === 'string' ? body!.email.trim().slice(0, 320) : '';
  if (!email) return errorResponse('MISSING_FIELD', 'Missing required field: email', 400);

  const encryptionKey = env.FORMS_ENCRYPTION_KEY;
  if (!encryptionKey) return errorResponse('CONFIG_ERROR', 'FORMS_ENCRYPTION_KEY not configured', 503);

  try {
    const emailHash = await hashEmail(email);

    const existing = await env.FORMS_DB.prepare(
      'SELECT id FROM email_signups WHERE event_id = ? AND email_hash = ?',
    )
      .bind(eventId, emailHash)
      .first();

    if (existing) {
      logFormEvent('email-signup', eventId, 'submit', { duplicate: true, latencyMs: Date.now() - start });
      return jsonResponse({ ok: true, id: existing.id as string, duplicate: true });
    }

    const encrypted = await encryptEmail(email, encryptionKey);
    const id = generateId();
    const bucket = bucketTimestamp();
    const retentionExpiresAt = new Date(Date.now() + EMAIL_RETENTION_MS).toISOString();

    await env.FORMS_DB.prepare(
      `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, eventId, emailHash, encrypted, bucket, retentionExpiresAt)
      .run();

    logFormEvent('email-signup', eventId, 'submit', { id, latencyMs: Date.now() - start });
    return jsonResponse({ ok: true, id });
  } catch (err) {
    return handleDbError('email-signup', eventId, err);
  }
}

// ─── Admin: List Registrations ──────────────────────────────────────────────────

export async function handleAdminRegistrations(
  _request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  try {
    const result = await env.FORMS_DB.prepare(
      'SELECT id, event_id, source_placement_id, attendee_name, attendee_email_hash, registration_bucket, status, created_at FROM form_registrations WHERE event_id = ? ORDER BY created_at DESC',
    )
      .bind(eventId)
      .all();

    logFormEvent('register', eventId, 'admin_read', { count: result.results.length });
    return jsonResponse({ ok: true, items: result.results, count: result.results.length });
  } catch (err) {
    return handleDbError('register', eventId, err);
  }
}

// ─── Admin: Check-in Count ──────────────────────────────────────────────────────

export async function handleAdminCheckinCount(
  _request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  try {
    const result = await env.FORMS_DB.prepare(
      'SELECT total_count FROM checkin_counts WHERE event_id = ?',
    )
      .bind(eventId)
      .first<{ total_count: number }>();

    const count = result?.total_count ?? 0;
    logFormEvent('checkin', eventId, 'admin_read', { count });
    return jsonResponse({ ok: true, count });
  } catch (err) {
    return handleDbError('checkin', eventId, err);
  }
}

// ─── Admin: List Surveys (PII-scrubbed only) ───────────────────────────────────

export async function handleAdminSurveys(
  _request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  try {
    const result = await env.FORMS_DB.prepare(
      'SELECT id, event_id, responses_json, submitted_bucket, created_at FROM form_surveys WHERE event_id = ? AND pii_scrubbed = 1 ORDER BY created_at DESC',
    )
      .bind(eventId)
      .all();

    logFormEvent('survey', eventId, 'admin_read', { count: result.results.length });
    return jsonResponse({ ok: true, items: result.results, count: result.results.length });
  } catch (err) {
    return handleDbError('survey', eventId, err);
  }
}

// ─── Admin: Email Signup Count ──────────────────────────────────────────────────

export async function handleAdminEmailSignupCount(
  _request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  try {
    const result = await env.FORMS_DB.prepare(
      'SELECT COUNT(*) as cnt FROM email_signups WHERE event_id = ?',
    )
      .bind(eventId)
      .first<{ cnt: number }>();

    const count = result?.cnt ?? 0;
    logFormEvent('email-signup', eventId, 'admin_read', { count });
    return jsonResponse({ ok: true, count });
  } catch (err) {
    return handleDbError('email-signup', eventId, err);
  }
}
