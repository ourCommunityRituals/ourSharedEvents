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
  encryptText,
  decryptText,
  generateId,
} from '../lib/forms-db';
import { corsHeaders } from '../lib/cors';
import { applyCountFloor } from '../lib/count-floor';
import { getOrCreateAnonId, setAnonCookie } from '../lib/anonymous-id';
import {
  validateFormRequest,
  handleDbError,
  errorResponse,
  jsonResponse,
  trimStr,
  type FormType,
} from '../lib/form-validation';
import { guardTurnstile } from '../lib/turnstile';

export interface FormsEnv extends FormsDbEnv {
  FORMS_ENCRYPTION_KEY?: string;
  // OSE-598: HMAC-SHA256 pepper for email hashing. Without this, bare SHA-256
  // is rainbow-table-precomputable. Production MUST set this via Wrangler secret.
  FORMS_HASH_PEPPER?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const REGISTRATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const EMAIL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Rate limiter (per-isolate, sliding window) ─────────────────────────────
// Keys: `${ip}:${eventId}` — different eventIds have independent limits.
// Matches the pattern in pages.ts handleSubscribe.

const FORM_RATE_WINDOW_MS = 60_000; // 1 minute
const FORM_RATE_MAX = 10; // 10 submissions per IP per eventId per minute
const FORM_RATE_MAX_BUCKETS = 50_000;
const FORM_RATE_EVICT_BATCH = 200;
const formRateBuckets = new Map<string, number[]>();
let formRateEvictCursor: string | undefined;

function isFormRateLimited(ip: string, eventId: string): boolean {
  const key = `${ip}:${eventId}`;
  const now = Date.now();
  const timestamps = formRateBuckets.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < FORM_RATE_WINDOW_MS);

  if (recent.length >= FORM_RATE_MAX) {
    formRateBuckets.set(key, recent);
    return true;
  }

  recent.push(now);
  formRateBuckets.set(key, recent);

  if (formRateBuckets.size > FORM_RATE_MAX_BUCKETS) {
    let evicted = 0;
    let started = false;
    for (const [k, ts] of formRateBuckets) {
      if (formRateEvictCursor && !started) {
        if (k === formRateEvictCursor) started = true;
        else continue;
      }
      const active = ts.filter((t) => now - t < FORM_RATE_WINDOW_MS);
      if (active.length === 0) {
        formRateBuckets.delete(k);
      } else {
        formRateBuckets.set(k, active);
      }
      evicted++;
      if (evicted >= FORM_RATE_EVICT_BATCH) {
        formRateEvictCursor = k;
        return false;
      }
    }
    formRateEvictCursor = undefined;
  }

  return false;
}

function formRateLimitedResponse(request: Request): Response {
  return Response.json(
    {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      error: 'Too many requests. Please try again later.',
      timestamp: new Date().toISOString(),
    },
    { status: 429, headers: { 'Retry-After': '60', ...corsHeaders(request) } }
  );
}

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

/**
 * DE-01 / A-5: turn stored registration rows into the response shape where
 * `attendee_name` is the DECRYPTED name. Decrypts `attendee_name_encrypted`
 * (AES-GCM), falling back to the legacy cleartext `attendee_name` for
 * pre-existing rows, and drops the encrypted column from the output. A
 * decryption failure surfaces a non-null sentinel (never a silent null that
 * would hide key-rotation data loss — mirrors the email-signup export policy).
 */
async function decryptAttendeeNames(
  rows: Record<string, unknown>[],
  env: FormsEnv,
  eventId: string
): Promise<Record<string, unknown>[]> {
  const key = env.FORMS_ENCRYPTION_KEY;
  return Promise.all(
    rows.map(async (row) => {
      const { attendee_name_encrypted, attendee_name, ...rest } = row;
      if (typeof attendee_name_encrypted === 'string' && attendee_name_encrypted.length > 0) {
        if (!key) {
          logFormEvent('register', String(rest.event_id ?? eventId), 'error', {
            decrypt_error: true,
            reason: 'no_encryption_key',
            row_id: typeof rest.id === 'string' ? rest.id : undefined,
          });
          return { ...rest, attendee_name: '[decryption-failed]' };
        }
        try {
          return { ...rest, attendee_name: await decryptText(attendee_name_encrypted, key) };
        } catch (err) {
          logFormEvent('register', String(rest.event_id ?? eventId), 'error', {
            decrypt_error: true,
            row_id: typeof rest.id === 'string' ? rest.id : undefined,
          });
          return {
            ...rest,
            attendee_name: '[decryption-failed]',
            attendee_name_error: err instanceof Error ? err.message : 'decryption failed',
          };
        }
      }
      // Legacy pre-encryption row (or no name): fall back to the cleartext column.
      return { ...rest, attendee_name: attendee_name ?? null };
    })
  );
}

// ─── Public: Registration ───────────────────────────────────────────────────────

export async function handleFormRegistration(
  request: Request,
  env: FormsEnv,
  eventId: string
): Promise<Response> {
  // Rate limit by CF edge IP only — null means local dev or test; skip limiting.
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp && isFormRateLimited(clientIp, eventId)) return formRateLimitedResponse(request);
  const start = Date.now();
  const { body, error } = await validateFormRequest(request, eventId, true);
  if (error) return error;

  // L4 (OSE-1378): dark by default — no-op unless TURNSTILE_ENABLED === 'true'.
  const turnstileDeny = await guardTurnstile(
    request,
    env,
    'register',
    body!['cf-turnstile-response']
  );
  if (turnstileDeny) return turnstileDeny;

  const { anonId, isNew } = getOrCreateAnonId(request);
  const name = trimStr(body!.name, 200);
  if (typeof body!.email === 'string' && body!.email.length > 320) {
    return errorResponse('INVALID_EMAIL', 'Invalid email format', 400, request);
  }
  const rawEmail = trimStr(body!.email, 320);
  if (rawEmail && !isValidEmail(rawEmail)) {
    return errorResponse('INVALID_EMAIL', 'Invalid email format', 400, request);
  }
  const email = rawEmail;
  // sourcePlacementId is not trimmed for whitespace — IDs MAY contain
  // significant leading/trailing chars. Just bound the length.
  const sourcePlacementId =
    typeof body!.sourcePlacementId === 'string' ? body!.sourcePlacementId.slice(0, 128) : undefined;

  // DE-01 / A-5: a supplied attendee name is personal data and MUST be encrypted
  // at rest. Require FORMS_ENCRYPTION_KEY when a name is present (mirror the
  // email-signup 503 guard) and store AES-GCM ciphertext in
  // attendee_name_encrypted; the legacy cleartext attendee_name column is left
  // NULL on the write path. encryptText (NOT encryptEmail) preserves the name's
  // exact case/whitespace.
  if (name && !env.FORMS_ENCRYPTION_KEY) {
    return errorResponse('CONFIG_ERROR', 'FORMS_ENCRYPTION_KEY not configured', 503, request);
  }
  // DE-06 / OSE-1343: the write path hashes the email with a REQUIRED pepper
  // (hashEmail(..., { requirePepper: true }) below). Guard it explicitly, like
  // the key above, so a missing FORMS_HASH_PEPPER surfaces as a clear
  // CONFIG_ERROR instead of a masked DB_ERROR from the caught throw.
  if (email && !env.FORMS_HASH_PEPPER) {
    return errorResponse('CONFIG_ERROR', 'FORMS_HASH_PEPPER not configured', 503, request);
  }

  let emailHash: string | undefined;
  let nameEncrypted: string | undefined;
  try {
    // DE-06: WRITE paths must not silently degrade to bare (unpeppered) SHA-256.
    // requirePepper:true makes a missing FORMS_HASH_PEPPER throw; caught below
    // and surfaced as a clean 503 (never a raw 500 leak).
    emailHash = email
      ? await hashEmail(email, env.FORMS_HASH_PEPPER, { requirePepper: true })
      : undefined;
    nameEncrypted =
      name && env.FORMS_ENCRYPTION_KEY
        ? await encryptText(name, env.FORMS_ENCRYPTION_KEY)
        : undefined;
  } catch (err) {
    return handleDbError('register', eventId, err, request);
  }

  const bucket = bucketTimestamp();
  const id = generateId();
  const expiresAt = new Date(Date.now() + REGISTRATION_TTL_MS).toISOString();

  try {
    await env.FORMS_DB.prepare(
      `INSERT INTO form_registrations (id, event_id, source_placement_id, attendee_name, attendee_name_encrypted, attendee_email_hash, registration_bucket, status, expires_at, anonymous_id, consent_given_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`
    )
      .bind(
        id,
        eventId,
        sourcePlacementId ?? null,
        null, // legacy cleartext column — never populated on the write path (DE-01)
        nameEncrypted ?? null,
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

// ─── Public: Self-delete a registration (OSE-659) ───────────────────────────────
//
// "Destroyed by architecture" includes the person's own right to remove their
// opt-in PII before the TTL expires. The deleter is authenticated by KNOWING the
// email they registered with (its peppered hash must match) — NOT by any new
// credential or identity surface (#1: no new login, no cross-linking). Writes
// ONLY to FORMS_DB; never touches the scan DB, never joins registration↔scan.
export async function handleSelfDeleteRegistration(
  request: Request,
  env: FormsEnv,
  eventId: string
): Promise<Response> {
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp && isFormRateLimited(clientIp, eventId)) return formRateLimitedResponse(request);

  let body: { email?: unknown } | null = null;
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return errorResponse('INVALID_BODY', 'Expected a JSON body with an email', 400, request);
  }

  // Self-delete requires the registered email — the hash match is the proof of
  // ownership. A registration made without an email cannot be self-deleted (it
  // is destroyed by the TTL instead); we do not accept name-only deletion (a
  // name is not a secret and would let anyone remove another attendee).
  const rawEmail = typeof body?.email === 'string' ? trimStr(body.email, 320) : '';
  if (!rawEmail || !isValidEmail(rawEmail)) {
    return errorResponse(
      'INVALID_EMAIL',
      'A valid email (the one you registered with) is required to remove your registration.',
      400,
      request
    );
  }

  try {
    const emailHash = await hashEmail(rawEmail, env.FORMS_HASH_PEPPER);
    const result = await env.FORMS_DB.prepare(
      'DELETE FROM form_registrations WHERE event_id = ? AND attendee_email_hash = ?'
    )
      .bind(eventId, emailHash)
      .run();
    const deleted = result.meta?.changes ?? 0;
    logFormEvent('register', eventId, 'lifecycle', { op: 'self_delete', deleted });
    // Do not reveal whether a registration existed — always ok, report count.
    return jsonResponse({ ok: true, deleted }, request);
  } catch (err) {
    return handleDbError('register', eventId, err, request);
  }
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

  // L4 (OSE-1378): bodyless handler — token arrives via the cf-turnstile-response header.
  const turnstileDeny = await guardTurnstile(request, env, 'checkin');
  if (turnstileDeny) return turnstileDeny;

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

  const turnstileDeny = await guardTurnstile(
    request,
    env,
    'survey',
    body!['cf-turnstile-response']
  );
  if (turnstileDeny) return turnstileDeny;

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
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp && isFormRateLimited(clientIp, eventId)) return formRateLimitedResponse(request);
  const start = Date.now();
  const { body, error } = await validateFormRequest(request, eventId, true);
  if (error) return error;

  const turnstileDeny = await guardTurnstile(
    request,
    env,
    'email-signup',
    body!['cf-turnstile-response']
  );
  if (turnstileDeny) return turnstileDeny;

  const { anonId, isNew } = getOrCreateAnonId(request);
  const email = trimStr(body!.email, 320) ?? '';
  if (!email) return errorResponse('MISSING_FIELD', 'Missing required field: email', 400, request);
  if (!isValidEmail(email))
    return errorResponse('INVALID_EMAIL', 'Invalid email format', 400, request);

  const encryptionKey = env.FORMS_ENCRYPTION_KEY;
  if (!encryptionKey)
    return errorResponse('CONFIG_ERROR', 'FORMS_ENCRYPTION_KEY not configured', 503, request);
  // DE-06 / OSE-1343: the pepper is required by hashEmail below; guard it
  // explicitly so a missing FORMS_HASH_PEPPER is a clear CONFIG_ERROR, not a
  // masked DB_ERROR from the caught throw.
  if (!env.FORMS_HASH_PEPPER)
    return errorResponse('CONFIG_ERROR', 'FORMS_HASH_PEPPER not configured', 503, request);

  try {
    // DE-06: WRITE path — never silently degrade to bare SHA-256. A missing
    // pepper throws here and is caught below → clean 503 (handleDbError).
    const emailHash = await hashEmail(email, env.FORMS_HASH_PEPPER, { requirePepper: true });

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
      'SELECT id, event_id, source_placement_id, attendee_name, attendee_name_encrypted, attendee_email_hash, registration_bucket, status, created_at FROM form_registrations WHERE event_id = ? ORDER BY created_at DESC'
    )
      .bind(eventId)
      .all();

    // DE-01 / A-5: attendee_name is now stored encrypted. Decrypt for the
    // organizer's first-party list (keep the response field named attendee_name),
    // falling back to the legacy cleartext column for pre-existing rows. The
    // encrypted column is never surfaced in the response.
    const items = await decryptAttendeeNames(
      result.results as Record<string, unknown>[],
      env,
      eventId
    );

    logFormEvent('register', eventId, 'admin_read', { count: items.length });
    // OSE-665: the aggregate `count` is floored uniformly (same K as the
    // SharedReport surface) so every viewer sees the same representation of a
    // sub-5 cohort. `items` remains the organizer's first-party operational
    // list (#1/#8), exact — running the event needs the actual attendees.
    const floored = applyCountFloor(items.length);
    return jsonResponse(
      {
        ok: true,
        items,
        count: floored.count,
        suppressed: floored.suppressed,
        floor: floored.floor,
      },
      request
    );
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
    // OSE-665: uniform count floor (count-only endpoint — a true suppression).
    const floored = applyCountFloor(count);
    return jsonResponse(
      { ok: true, count: floored.count, suppressed: floored.suppressed, floor: floored.floor },
      request
    );
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
    // OSE-665: aggregate `count` floored uniformly; `items` stays first-party
    // (PII-scrubbed survey rows the organizer owns).
    const floored = applyCountFloor(result.results.length);
    return jsonResponse(
      {
        ok: true,
        items: result.results,
        count: floored.count,
        suppressed: floored.suppressed,
        floor: floored.floor,
      },
      request
    );
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
    // OSE-665: uniform count floor (count-only endpoint — a true suppression).
    const floored = applyCountFloor(count);
    return jsonResponse(
      { ok: true, count: floored.count, suppressed: floored.suppressed, floor: floored.floor },
      request
    );
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
      // DE-01 / A-5: select the encrypted name column; decrypted below into the
      // `attendee_name` output field (never expose raw ciphertext).
      query =
        'SELECT id, event_id, attendee_name, attendee_name_encrypted, registration_bucket, status, created_at FROM form_registrations WHERE event_id = ? ORDER BY created_at DESC';
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

    // DE-01 / A-5: decrypt attendee names for the export (CSV or JSON), never
    // expose raw ciphertext. Reuses the same decrypt + legacy-fallback policy as
    // the admin list; drops attendee_name_encrypted from the output.
    if (dataType === 'registrations') {
      rows = await decryptAttendeeNames(rows, env, eventId);
    }

    // Decrypt email addresses for admin export — never expose raw ciphertext
    if (dataType === 'email-signups' && env.FORMS_ENCRYPTION_KEY) {
      const key = env.FORMS_ENCRYPTION_KEY;
      rows = await Promise.all(
        rows.map(async (row) => {
          const { email_encrypted, ...rest } = row;
          if (typeof email_encrypted === 'string') {
            try {
              return { ...rest, email: await decryptEmail(email_encrypted, key) };
            } catch (err) {
              // OSE-713: a decryption failure (e.g. key-rotation mismatch — the
              // ciphertext was encrypted under a key no longer present in
              // FORMS_ENCRYPTION_KEY) MUST surface as an explicit error marker,
              // never a silent `email: null`. A null is indistinguishable from a
              // legitimately-absent email and would hide data loss / key
              // misconfiguration from the operator. Emit a non-null sentinel plus
              // a machine-readable error field, and log the egress fault.
              logFormEvent('email-signup', String(rest.event_id ?? eventId), 'error', {
                decrypt_error: true,
                row_id: typeof rest.id === 'string' ? rest.id : undefined,
              });
              return {
                ...rest,
                email: '[decryption-failed]',
                email_error: err instanceof Error ? err.message : 'decryption failed',
              };
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
