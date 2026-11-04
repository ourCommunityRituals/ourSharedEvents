/**
 * CORS origin allowlist and header helpers.
 *
 * Used by both the router (preflight) and handlers (actual responses).
 *
 * The allowlist depends on the environment (OSE-1417). Production trusts
 * production hostnames only; the staging origin is added only when
 * WORKER_ENV === 'staging'. `route()` binds each request to its env with
 * `bindCorsEnv`, so the 60+ handler call sites keep their `(request)`
 * signature. A request that was never bound gets the production set, so a
 * missed binding narrows staging and never widens production.
 */

/** Production origins, trusted in every environment. */
const ALLOWED_ORIGINS = new Set(['https://oursharedevents.com', 'https://www.oursharedevents.com']);

/** Origins trusted only when WORKER_ENV === 'staging'. */
const STAGING_ONLY_ORIGINS = new Set([
  'https://stg.oursharedevents.com',
  'https://stg-empty.oursharedevents.com',
  'https://stg-full.oursharedevents.com',
]);

interface CorsEnv {
  WORKER_ENV?: string;
}

const requestEnv = new WeakMap<Request, CorsEnv>();

/** Record which Worker env a request is served by. Called once in route(). */
export function bindCorsEnv(request: Request, env: CorsEnv): void {
  requestEnv.set(request, env);
}

function isStaging(request: Request): boolean {
  return requestEnv.get(request)?.WORKER_ENV === 'staging';
}

/** Return the request Origin if it's in the allowlist, else null. */
export function corsOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (isStaging(request) && STAGING_ONLY_ORIGINS.has(origin)) return origin;
  return null;
}

/** CORS headers to include on actual (non-preflight) responses. */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = corsOrigin(request);
  if (origin) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  return {};
}
