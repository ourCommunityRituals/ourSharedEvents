// ─── Admin registrations list — bounded page + opaque cursor ───────────────────
//
// `GET /api/v2/admin/events/:id/forms/registrations` used to SELECT every row of
// an event and decrypt every attendee name in one request. That is unbounded in
// both D1 reads and AES-GCM work, and it was the root cause of the staging T2
// latency (the list took seconds on a populated event).
//
// Now one page per request, newest first, ordered by (created_at DESC, id DESC)
// so the order is total even when many rows share a second. The cursor is the
// last row's position in that ordering: `r1.` + base64url(JSON {c, i}). It is
// opaque to the client; anything that does not decode to exactly that shape is
// refused (400 INVALID_CURSOR), never guessed at. Values reach SQL as bound
// parameters only.

export const REGISTRATIONS_CURSOR_PREFIX = 'r1.';
export const REGISTRATIONS_DEFAULT_LIMIT = 100;
export const REGISTRATIONS_MAX_LIMIT = 500;

const MAX_CURSOR_LEN = 512;

export interface RegistrationsCursor {
  /** created_at of the last row on the previous page. */
  c: string;
  /** id of the last row on the previous page. */
  i: string;
}

function b64urlEncode(s: string): string {
  let bin = '';
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
    Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  );
}

export function encodeRegistrationsCursor(row: { created_at?: unknown; id?: unknown }): string {
  const c: RegistrationsCursor = { c: String(row.created_at ?? ''), i: String(row.id ?? '') };
  return REGISTRATIONS_CURSOR_PREFIX + b64urlEncode(JSON.stringify(c));
}

/** Decode a cursor, or null when it is not exactly the shape this module mints. */
export function decodeRegistrationsCursor(raw: string): RegistrationsCursor | null {
  if (!raw || raw.length > MAX_CURSOR_LEN || !raw.startsWith(REGISTRATIONS_CURSOR_PREFIX)) {
    return null;
  }
  let v: unknown;
  try {
    v = JSON.parse(b64urlDecode(raw.slice(REGISTRATIONS_CURSOR_PREFIX.length)));
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== 'c,i') return null;
  if (typeof o.c !== 'string' || typeof o.i !== 'string') return null;
  if (o.c.length === 0 || o.c.length > 64 || o.i.length === 0 || o.i.length > 128) return null;
  return { c: o.c, i: o.i };
}

export type PagingParams =
  | { ok: true; limit: number; after: RegistrationsCursor | null }
  | { ok: false; code: 'INVALID_LIMIT' | 'INVALID_CURSOR'; message: string };

/** Validate `?limit=` and `?cursor=`. Absent limit = default; out of range = refused, not clamped. */
export function parsePagingParams(url: URL): PagingParams {
  const rawLimit = url.searchParams.get('limit');
  let limit = REGISTRATIONS_DEFAULT_LIMIT;
  if (rawLimit !== null) {
    if (!/^\d{1,4}$/.test(rawLimit)) {
      return { ok: false, code: 'INVALID_LIMIT', message: 'limit must be a whole number' };
    }
    limit = Number(rawLimit);
    if (limit < 1 || limit > REGISTRATIONS_MAX_LIMIT) {
      return {
        ok: false,
        code: 'INVALID_LIMIT',
        message: `limit must be between 1 and ${REGISTRATIONS_MAX_LIMIT}`,
      };
    }
  }
  const rawCursor = url.searchParams.get('cursor');
  if (rawCursor === null || rawCursor === '') return { ok: true, limit, after: null };
  const after = decodeRegistrationsCursor(rawCursor);
  if (!after) return { ok: false, code: 'INVALID_CURSOR', message: 'cursor is not valid' };
  return { ok: true, limit, after };
}
