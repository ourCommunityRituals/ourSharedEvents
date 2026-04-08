/**
 * Anonymous ID system — privacy-first visitor correlation.
 *
 * ADMIN-6: Generates and reads a random UUID stored in an HttpOnly cookie.
 * Contains no PII. Correlates a visitor across scans and form submissions
 * so we can answer "how many unique visitors registered AND checked in"
 * without knowing who they are.
 *
 * Cookie: ose_anon={anon_UUID}; HttpOnly; Secure; SameSite=Lax; Max-Age=1yr
 */

const COOKIE_NAME = 'ose_anon';
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year

/** Generate a new anonymous ID. */
export function generateAnonId(): string {
  const uuid = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `anon_${uuid}`;
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
