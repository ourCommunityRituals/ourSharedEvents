/**
 * Anonymous ID system — privacy-first visitor correlation.
 *
 * ADMIN-6: Generates and reads a random UUID stored in an HttpOnly cookie.
 * Contains no PII. Lets the platform count one browser once without knowing
 * who it is.
 *
 * Where the value goes: the scan path stores a keyed id derived from it
 * (lib/scan-node-key.ts). The forms path stores a per-event keyed id derived
 * from it (lib/event-anon-key.ts), so a form row cannot be joined to a scan
 * row, or to the same browser at another event. "Registered AND checked in" is
 * still answerable inside one event, where the keyed id is stable.
 *
 * SIGNED (OSE-1496; owner decision 2026-11-23). The cookie used to be accepted
 * when it merely looked like `anon_…`, so a client could mint any number of
 * "people" by sending made-up values. Now the server signs what it issues:
 *
 *   ose_anon = anon_<uuid>_s1_<HMAC-SHA256, base64url, 43 chars>
 *
 * Only a value whose signature verifies is read back as the same visitor. An
 * unsigned, tampered, over-long or otherwise odd value is ignored and a fresh
 * signed id is issued, exactly as for a browser that sent no cookie. The
 * signature covers only the id part, and the id part (`anon_<uuid>`) is what
 * every caller receives, so the keyed ids derived from it do not change.
 *
 * KEY. No new secret: HKDF-SHA256 turns `ANON_ID_HASH_PEPPER` into a sub-key
 * bound to `ANON_COOKIE_SIGN_CONTEXT`, the same pattern as scan-node-key.ts.
 * Different HKDF `info`, so the signature is never equal to a stored scan key.
 * `s1` names the key version: a future rotation adds `s2` and stops accepting
 * `s1`, which reads every old cookie as a new visitor (the same break a pepper
 * rotation already makes for scan keys).
 *
 * NO PEPPER. Without `ANON_ID_HASH_PEPPER` nothing can be signed. The cookie is
 * then read as before (any `anon_` value up to `MAX_LEGACY_LEN`) and issued
 * unsigned. That loses nothing a forger could use: without the pepper the scan
 * path stores no browser id at all (scan-node-key.ts returns null and the scan
 * counts by browser-name hash), and the forms path refuses to write
 * (FORMS_HASH_PEPPER is checked separately). prod-preflight requires the pepper.
 *
 * Cookie: ose_anon=<value>; HttpOnly; Secure; SameSite=Lax; Max-Age=1yr
 */

const COOKIE_NAME = 'ose_anon';

/** The cookie's name, for notices that tell people about it (privacy page, form notice). */
export const ANON_COOKIE_NAME: string = COOKIE_NAME;
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year

/** HKDF `info` — names this one use of ANON_ID_HASH_PEPPER. Change = new signatures. */
export const ANON_COOKIE_SIGN_CONTEXT = 'ose:anon-cookie:sign:v1';

/** Separates the id from its signature; every character stays in [A-Za-z0-9_-]. */
const SIG_MARK = '_s1_';

/** Fixed, public HKDF salt (RFC 5869 allows a non-secret salt). */
const HKDF_SALT = new TextEncoder().encode('oursharedevents:anon-cookie');

/** The longest unsigned value read when no pepper is configured. */
export const MAX_LEGACY_LEN = 64;

// The id part: what generateAnonId mints (a UUID), or any short value without
// an underscore, so `_s1_` splits it unambiguously. Its shape is not what makes
// it trusted; the signature is. The whole value is at most 100 characters.
const ID_PART = 'anon_[A-Za-z0-9-]{1,48}';
const SIGNED_RE = new RegExp(`^(${ID_PART})${SIG_MARK}([A-Za-z0-9_-]{43})$`);
const LEGACY_RE = /^anon_[a-zA-Z0-9_-]+$/;
const COOKIE_RE = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;\\s]*)`);

/**
 * The full ose_anon cookie value. Branded so that only a value from
 * getOrCreateAnonId can be set: passing the bare id to setAnonCookie fails to
 * compile, which is how a call site that would set an unsigned cookie is caught.
 */
export type AnonCookieValue = string & { readonly __anonCookie: unique symbol };

/** What a request's visitor is, and the cookie to set when `isNew`. */
export interface AnonVisitor {
  /** `anon_<uuid>`: what callers derive keyed ids from. Never stored raw. */
  anonId: string;
  /** True when no valid cookie came in: the response must set `cookieValue`. */
  isNew: boolean;
  /** The full cookie value (signed when a pepper is configured). */
  cookieValue: AnonCookieValue;
}

/**
 * Generate a new anonymous ID.
 *
 * Always crypto.randomUUID() (present in every Workers runtime). There is
 * deliberately NO fallback: the old `Date.now()` + `Math.random()` branch was
 * dead on Workers but would have minted predictable, time-ordered ids — the
 * linkability the non-correlation tests forbid (OSE-1410, CodeQL
 * js/insecure-randomness). If randomUUID is ever missing, fail loudly.
 */
export function generateAnonId(): string {
  return `anon_${crypto.randomUUID()}`;
}

// One derivation per isolate per pepper; the CryptoKey is non-extractable. A
// failed derivation is evicted, never cached (same policy as scan-node-key.ts).
const subKeys = new Map<string, Promise<CryptoKey>>();

function subKeyFor(pepper: string): Promise<CryptoKey> {
  let key = subKeys.get(pepper);
  if (!key) {
    key = deriveSubKey(pepper);
    subKeys.set(pepper, key);
    key.catch(() => subKeys.delete(pepper));
  }
  return key;
}

async function deriveSubKey(pepper: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    'HKDF',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_SALT,
      info: new TextEncoder().encode(ANON_COOKIE_SIGN_CONTEXT),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify']
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | null {
  try {
    const bin = atob(
      s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
    );
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * The signed cookie value for `anonId`. Exported so tests can present a real
 * returning visitor; the runtime calls it only through getOrCreateAnonId.
 */
export async function signAnonId(anonId: string, pepper: string): Promise<string> {
  const key = await subKeyFor(pepper);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(anonId));
  return `${anonId}${SIG_MARK}${toBase64Url(new Uint8Array(sig))}`;
}

/** The id inside a signed value whose signature verifies; null for anything else. */
export async function verifyAnonCookie(value: string, pepper: string): Promise<string | null> {
  const m = SIGNED_RE.exec(value);
  if (!m) return null;
  const sig = fromBase64Url(m[2]);
  if (!sig || sig.length !== 32) return null;
  const key = await subKeyFor(pepper);
  // subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(m[1]));
  return ok ? m[1] : null;
}

/**
 * Read the visitor from the request cookie, or mint a new one.
 *
 * @param pepper `env.ANON_ID_HASH_PEPPER`: signs and verifies the cookie
 */
export async function getOrCreateAnonId(
  request: Request,
  pepper: string | undefined
): Promise<AnonVisitor> {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(COOKIE_RE);
  const raw = match ? match[1] : '';

  if (pepper) {
    const known = raw ? await verifyAnonCookie(raw, pepper) : null;
    if (known) return { anonId: known, isNew: false, cookieValue: raw as AnonCookieValue };
    const anonId = generateAnonId();
    return {
      anonId,
      isNew: true,
      cookieValue: (await signAnonId(anonId, pepper)) as AnonCookieValue,
    };
  }

  if (raw && raw.length <= MAX_LEGACY_LEN && LEGACY_RE.test(raw)) {
    return { anonId: raw, isNew: false, cookieValue: raw as AnonCookieValue };
  }
  const anonId = generateAnonId();
  return { anonId, isNew: true, cookieValue: anonId as AnonCookieValue };
}

/** Clone a Response with the Set-Cookie header for this visitor's cookie value. */
export function setAnonCookie(response: Response, cookieValue: AnonCookieValue): Response {
  const headers = new Headers(response.headers);
  headers.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}; Path=/`
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
