/**
 * OSE-204 / BE-15 — Form validation container.
 *
 * Extracted from the inline pattern that lived inside `src/handlers/forms.ts`.
 * Centralizes the pre-processing that EVERY public form submission needs:
 *
 *   - Event ID format guard (regex)
 *   - Request body size limits (Content-Length header + post-read length)
 *   - JSON parse with payload-too-large vs malformed-JSON distinction
 *   - Consistent D1 error handling
 *   - Field-level truncation helper (`trimStr`)
 *
 * Why a separate lib instead of inline helpers:
 *
 *   1. The L1 static invariant gate (tests/form-validation-invariant.spec.ts)
 *      can assert that `forms.ts` imports from this lib AND that every public
 *      form handler calls `validateFormRequest`. A pattern inlined inside one
 *      file is easy to drift away from; a pattern imported from a lib is
 *      gate-enforceable across future handlers too.
 *
 *   2. PAYLOAD_TOO_LARGE -> 413 was previously conflated with INVALID_BODY ->
 *      400. The discriminated `ParseBodyResult` lets callers map size
 *      violations to the correct HTTP status.
 *
 *   3. `trimStr` replaces 4 inline copies of `.trim().slice(0, N)` in the
 *      handler. One canonical truncation utility now exists for every
 *      string-bounded field (name, email, sourcePlacementId, etc).
 *
 * Related: this is the same architectural pattern as the cursor-pagination
 * envelope (OSE-206) and the PII no-raw-IP invariant (OSE-207) — extract
 * the contract into a lib + add a static gate that asserts every handler
 * uses it.
 */

import { corsHeaders } from './cors';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Hard cap on every public form body. Applied at the Content-Length header
 * AND after reading body text (because clients can lie). 16 KB is large
 * enough for survey responses with multiple fields, small enough that we
 * never have to think about JSON parser DoS.
 */
export const MAX_BODY_BYTES = 16 * 1024;

/**
 * Event IDs are constrained to URL-safe characters and bounded length.
 * Matches the format the admin event creation endpoint produces
 * (`evt_` + UUID). Loose enough to let dev/test fixtures use simple IDs.
 */
const EVENT_ID_RE = /^[a-zA-Z0-9_\-]+$/;
const EVENT_ID_MAX = 128;

// ─── Pure validators ──────────────────────────────────────────────────────────

export function isValidEventId(id: string): boolean {
  return id.length > 0 && id.length <= EVENT_ID_MAX && EVENT_ID_RE.test(id);
}

/** What a copied link most often drags along: sentence punctuation, a bracket, a space. */
const TRAILING_SLIP = /[\s.,;:!?)\]}'"]+$/;
/**
 * Longest segment worth repairing: a valid id plus a little junk, even
 * percent-encoded. The trailing-junk regex backtracks on a long run of junk,
 * and /forms/<id> has no rate limit, so a longer segment is refused unread.
 */
const REPAIR_MAX = 160;

/**
 * The event id a fat-fingered form link meant, or null (OSE-1754).
 *
 * A link pasted out of a sentence ("register at .../forms/evt_123.") or with a
 * space typed after it arrives with junk on the end. Only the END is repaired,
 * and only when what is left is a valid id; anything else stays refused, so a
 * hostile value can never be "repaired" into running code.
 */
export function repairEventIdTypo(raw: string): string | null {
  if (raw.length > REPAIR_MAX) return null;
  let typed: string;
  try {
    typed = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const id = typed.trim().replace(TRAILING_SLIP, '');
  return id !== raw && isValidEventId(id) ? id : null;
}

/**
 * A poster deployment id as it arrives in `?deployment=` (a `pd_` id from a
 * /q scan). Same shape and cap as an event id. The event page and the form
 * page both read the parameter; a value of any other shape is dropped, never
 * written into the page (OSE-1754).
 */
export function isValidDeploymentId(id: string | null | undefined): id is string {
  return typeof id === 'string' && isValidEventId(id);
}

/**
 * Truncate a user-supplied string after trimming. Returns `undefined` for
 * non-string inputs so callers can pass any unknown JSON field safely.
 *
 * Used wherever a handler accepts a bounded text field (name, sourceId,
 * email-before-validation, etc.).
 */
export function trimStr(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const out = value.trim().slice(0, max);
  // slice() cuts by UTF-16 code unit, so a truncation boundary can land inside
  // a surrogate pair and leave a lone high surrogate behind — a host
  // fat-fingering an emoji into the event name gets a mangled record, and at
  // compatibility_date >= 2026-02-24 (text_decoder_replace_surrogates) that
  // orphan decodes to U+FFFD. Drop it rather than emit it.
  // Found by tests/fat-finger.property.spec.ts (counterexample: "\u{10000}", 1).
  const last = out.charCodeAt(out.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out;
}

// ─── Body parsing with discriminated result ───────────────────────────────────

export type ParseBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: 'PAYLOAD_TOO_LARGE' }
  | { ok: false; reason: 'INVALID_BODY' };

/**
 * Read the request body as JSON, enforcing the 16 KB cap at two layers:
 *   1. Content-Length header (cheap, declarative)
 *   2. Post-read byte length (authoritative)
 *
 * Distinguishes the failure modes so the caller can return 413 for
 * payload-too-large vs 400 for invalid JSON.
 */
export async function parseJsonBody(request: Request): Promise<ParseBodyResult> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength) {
    const declared = parseInt(contentLength, 10);
    if (!isNaN(declared) && declared > MAX_BODY_BYTES) {
      return { ok: false, reason: 'PAYLOAD_TOO_LARGE' };
    }
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: 'INVALID_BODY' };
  }
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, reason: 'PAYLOAD_TOO_LARGE' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'INVALID_BODY' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'INVALID_BODY' };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function requestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

/**
 * Standard JSON response with consistent CORS + request-id headers. Mirrors
 * the implementation in `forms.ts` so callers can either use this directly
 * or pass a custom builder.
 */
export function jsonResponse(
  body: Record<string, unknown>,
  request: Request,
  status = 200
): Response {
  return Response.json(body, {
    status,
    headers: {
      'X-Request-Id': requestId(),
      ...corsHeaders(request),
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  request: Request
): Response {
  return jsonResponse(
    { ok: false, status, code, error: message, timestamp: new Date().toISOString() },
    request,
    status
  );
}

// ─── Container ────────────────────────────────────────────────────────────────

export type ValidateResult =
  { body: Record<string, unknown> | null; error: null } | { body: null; error: Response };

/**
 * Pre-process every public form submission identically:
 *   - Validate the event ID format -> 400 INVALID_EVENT_ID on failure
 *   - If body is required, parse JSON with size cap -> 413 PAYLOAD_TOO_LARGE
 *     or 400 INVALID_BODY on failure
 *
 * Returns either `{ body, error: null }` on success (body is the parsed JSON
 * object, or `null` if `requireBody=false`), or `{ body: null, error: Response }`
 * with the appropriate error response already built.
 *
 * Callers MUST early-return on `error !== null` to short-circuit downstream
 * work. The L1 static invariant gate asserts every public form handler
 * follows this pattern.
 */
export async function validateFormRequest(
  request: Request,
  eventId: string,
  requireBody: boolean
): Promise<ValidateResult> {
  if (!isValidEventId(eventId)) {
    return {
      body: null,
      error: errorResponse('INVALID_EVENT_ID', 'Invalid event ID format', 400, request),
    };
  }
  if (!requireBody) {
    return { body: null, error: null };
  }
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    if (parsed.reason === 'PAYLOAD_TOO_LARGE') {
      return {
        body: null,
        error: errorResponse(
          'PAYLOAD_TOO_LARGE',
          `Request body exceeds ${MAX_BODY_BYTES}-byte limit`,
          413,
          request
        ),
      };
    }
    return {
      body: null,
      error: errorResponse(
        'INVALID_BODY',
        'Request body must be valid JSON under 16KB',
        400,
        request
      ),
    };
  }
  return { body: parsed.body, error: null };
}

// ─── D1 error handler ─────────────────────────────────────────────────────────

/** Form types currently using this container. Kept as a string union (vs an
 *  open string) so the static gate can verify every member is wired. */
export type FormType = 'register' | 'checkin' | 'survey' | 'email-signup';

/**
 * Log + map a D1 error to a consistent 503. Every form handler should funnel
 * caught DB exceptions through this so:
 *   - The log shape is identical across handlers (greppable by ops)
 *   - The HTTP response shape is identical across handlers (consumers see
 *     503 + DB_ERROR code + structured timestamp regardless of which form
 *     they hit)
 */
export function handleDbError(
  formType: FormType,
  eventId: string,
  error: string,
  request: Request
): Response {
  console.log(
    JSON.stringify({
      type: 'FORM_EVENT',
      formType,
      eventId,
      action: 'error',
      error,
      timestamp: new Date().toISOString(),
    })
  );
  return errorResponse('DB_ERROR', 'Service temporarily unavailable', 503, request);
}
