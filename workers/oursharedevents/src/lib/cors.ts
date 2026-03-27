/**
 * CORS origin allowlist and header helpers.
 *
 * Used by both the router (preflight) and handlers (actual responses).
 */

/** Origins allowed for CORS. Staging included for local dev and preview. */
const ALLOWED_ORIGINS = new Set([
  'https://oursharedevents.com',
  'https://www.oursharedevents.com',
  'https://stg.oursharedevents.com',
]);

/** Return the request Origin if it's in the allowlist, else null. */
export function corsOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}

/** CORS headers to include on actual (non-preflight) responses. */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = corsOrigin(request);
  if (origin) return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
  return {};
}
