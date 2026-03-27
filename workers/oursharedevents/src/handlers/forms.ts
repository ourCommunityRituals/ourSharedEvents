/**
 * 4-Layer Form System handlers.
 *
 * All form data lives in FORMS_DB — NEVER linked to the anonymous scan system (DB).
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

/** Maximum request body size: 16 KB — forms are small payloads */
const MAX_BODY_BYTES = 16 * 1024;

/** Default registration expiry: 90 days from submission */
const REGISTRATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Email signup retention: 30 days from submission */
const EMAIL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────────────────

function requestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'X-Request-Id': requestId() },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ ok: false, status, code, error: message, timestamp: new Date().toISOString() }, status);
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  // Enforce body size limit — reject before parsing
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return null;
  }

  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Validate event_id format: non-empty, reasonable length, no injection chars */
function isValidEventId(id: string): boolean {
  return id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
}

// ─── Public: Registration ───────────────────────────────────────────────────────

export async function handleFormRegistration(
  request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  if (!isValidEventId(eventId)) return errorResponse('INVALID_EVENT_ID', 'Invalid event ID format', 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse('INVALID_BODY', 'Request body must be valid JSON under 16KB', 400);

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : undefined;
  const email = typeof body.email === 'string' ? body.email.trim().slice(0, 320) : undefined;
  const sourcePlacementId = typeof body.sourcePlacementId === 'string' ? body.sourcePlacementId.slice(0, 128) : undefined;

  const emailHash = email ? await hashEmail(email) : undefined;
  const bucket = bucketTimestamp();
  const id = generateId();

  // Server-computed expiry — client NEVER controls when data is destroyed
  const expiresAt = new Date(Date.now() + REGISTRATION_TTL_MS).toISOString();

  await env.FORMS_DB.prepare(
    `INSERT INTO form_registrations (id, event_id, source_placement_id, attendee_name, attendee_email_hash, registration_bucket, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
  )
    .bind(id, eventId, sourcePlacementId ?? null, name ?? null, emailHash ?? null, bucket, expiresAt)
    .run();

  return jsonResponse({ ok: true, id, registrationBucket: bucket });
}

// ─── Public: Check-in ───────────────────────────────────────────────────────────

export async function handleFormCheckin(
  _request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  if (!isValidEventId(eventId)) return errorResponse('INVALID_EVENT_ID', 'Invalid event ID format', 400);

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

  return jsonResponse({ ok: true, count: result?.total_count ?? 1 });
}

// ─── Public: Survey ─────────────────────────────────────────────────────────────

export async function handleFormSurvey(
  request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  if (!isValidEventId(eventId)) return errorResponse('INVALID_EVENT_ID', 'Invalid event ID format', 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse('INVALID_BODY', 'Request body must be valid JSON under 16KB', 400);

  const responses = body.responses;
  if (!responses || typeof responses !== 'object') {
    return errorResponse('MISSING_FIELD', 'Missing required field: responses', 400);
  }

  const id = generateId();
  const bucket = bucketTimestamp();

  await env.FORMS_DB.prepare(
    `INSERT INTO form_surveys (id, event_id, responses_json, submitted_bucket, pii_scrubbed)
     VALUES (?, ?, ?, ?, 0)`,
  )
    .bind(id, eventId, JSON.stringify(responses), bucket)
    .run();

  return jsonResponse({ ok: true, id });
}

// ─── Public: Email Signup ───────────────────────────────────────────────────────

export async function handleFormEmailSignup(
  request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  if (!isValidEventId(eventId)) return errorResponse('INVALID_EVENT_ID', 'Invalid event ID format', 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse('INVALID_BODY', 'Request body must be valid JSON under 16KB', 400);

  const email = typeof body.email === 'string' ? body.email.trim().slice(0, 320) : '';
  if (!email) return errorResponse('MISSING_FIELD', 'Missing required field: email', 400);

  const encryptionKey = env.FORMS_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return errorResponse('CONFIG_ERROR', 'FORMS_ENCRYPTION_KEY not configured', 503);
  }

  const emailHash = await hashEmail(email);

  // Dedup: check if this email already signed up for this event
  const existing = await env.FORMS_DB.prepare(
    'SELECT id FROM email_signups WHERE event_id = ? AND email_hash = ?',
  )
    .bind(eventId, emailHash)
    .first();

  if (existing) {
    return jsonResponse({ ok: true, id: existing.id as string, duplicate: true });
  }

  const encrypted = await encryptEmail(email, encryptionKey);
  const id = generateId();
  const bucket = bucketTimestamp();

  // Server-computed retention — client NEVER controls retention window
  const retentionExpiresAt = new Date(Date.now() + EMAIL_RETENTION_MS).toISOString();

  await env.FORMS_DB.prepare(
    `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, eventId, emailHash, encrypted, bucket, retentionExpiresAt)
    .run();

  return jsonResponse({ ok: true, id });
}

// ─── Admin: List Registrations ──────────────────────────────────────────────────

export async function handleAdminRegistrations(
  _request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  const result = await env.FORMS_DB.prepare(
    'SELECT id, event_id, source_placement_id, attendee_name, attendee_email_hash, registration_bucket, status, created_at FROM form_registrations WHERE event_id = ? ORDER BY created_at DESC',
  )
    .bind(eventId)
    .all();

  return jsonResponse({ ok: true, items: result.results, count: result.results.length });
}

// ─── Admin: Check-in Count ──────────────────────────────────────────────────────

export async function handleAdminCheckinCount(
  _request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  const result = await env.FORMS_DB.prepare(
    'SELECT total_count FROM checkin_counts WHERE event_id = ?',
  )
    .bind(eventId)
    .first<{ total_count: number }>();

  return jsonResponse({ ok: true, count: result?.total_count ?? 0 });
}

// ─── Admin: List Surveys (PII-scrubbed only) ───────────────────────────────────

export async function handleAdminSurveys(
  _request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  const result = await env.FORMS_DB.prepare(
    'SELECT id, event_id, responses_json, submitted_bucket, created_at FROM form_surveys WHERE event_id = ? AND pii_scrubbed = 1 ORDER BY created_at DESC',
  )
    .bind(eventId)
    .all();

  return jsonResponse({ ok: true, items: result.results, count: result.results.length });
}

// ─── Admin: Email Signup Count ──────────────────────────────────────────────────

export async function handleAdminEmailSignupCount(
  _request: Request,
  env: FormsEnv,
  eventId: string,
): Promise<Response> {
  const result = await env.FORMS_DB.prepare(
    'SELECT COUNT(*) as cnt FROM email_signups WHERE event_id = ?',
  )
    .bind(eventId)
    .first<{ cnt: number }>();

  return jsonResponse({ ok: true, count: result?.cnt ?? 0 });
}
