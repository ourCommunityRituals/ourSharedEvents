/**
 * Anonymous ID system — privacy-first visitor correlation.
 *
 * ADMIN-6: Generates and reads a random UUID stored in an HttpOnly cookie.
 * Contains no PII. Lets the platform count one browser once without knowing
 * who it is.
 *
 * Where the value goes: the scan path stores it (main DB). The forms path does
 * NOT — it stores a per-event keyed id derived from it (lib/event-anon-key.ts),
 * so a form row cannot be joined to a scan row, or to the same browser at
 * another event. "Registered AND checked in" is still answerable inside one
 * event, where the keyed id is stable.
 *
 * Cookie: ose_anon={anon_UUID}; HttpOnly; Secure; SameSite=Lax; Max-Age=1yr
 */

const COOKIE_NAME = 'ose_anon';
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year

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

/** Read existing anonymous ID from request cookie, or generate a new one. */
export function getOrCreateAnonId(request: Request): { anonId: string; isNew: boolean } {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=(anon_[a-zA-Z0-9_-]+)`));
  if (match) {
    return { anonId: match[1], isNew: false };
  }
  return { anonId: generateAnonId(), isNew: true };
}

/** Clone a Response with the Set-Cookie header for the anonymous ID. */
export function setAnonCookie(response: Response, anonId: string): Response {
  const headers = new Headers(response.headers);
  headers.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${anonId}; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}; Path=/`
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
