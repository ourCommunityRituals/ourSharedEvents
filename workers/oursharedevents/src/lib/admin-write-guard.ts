/**
 * Admin write guard: refuse an admin change that did not come from the admin
 * site, and refuse a body that is not declared as JSON.
 *
 * WHY. A person signs in to admin through Cloudflare Access. The browser then
 * attaches the Access cookie (`CF_Authorization`) to every request to this
 * host, including one that a different site makes on the person's behalf (a
 * hidden form, an image, a `fetch` in no-cors mode). Access turns that cookie
 * into `Cf-Access-Jwt-Assertion`, and requireAdmin accepts it. Nothing checked
 * where the request came from, so the only protection was the cookie's SameSite
 * setting in Cloudflare Access, which this repo does not control.
 *
 * THE RULE, for a request whose method is not GET, HEAD or OPTIONS and whose
 * path is an admin path (isAdminPath):
 *
 *   1. If the browser says where the request came from, it must be this origin.
 *      `Sec-Fetch-Site` must be `same-origin`. When that header is absent (an
 *      older browser), `Origin` must equal this request's origin. This applies
 *      to EVERY caller: a browser sets both headers itself and page script
 *      cannot change them, so "cross-site" is never a mistake.
 *   2. If the request says nothing about where it came from, it is not a current
 *      browser. It passes only when the caller proved itself with a secret
 *      header (a `key:` actor: X-OCR-Internal or the Bearer admin key). A
 *      cross-site attack cannot add a header, and does not know the secret. A
 *      signed-in person (an email actor) with no such evidence is refused:
 *      a real browser always sends `Origin` on a write.
 *      A caller with no identity at all is left to requireAdmin, which answers
 *      401, so the route's own "denied" audit row is unchanged.
 *   3. A body from an identified caller must be `application/json` (optional
 *      charset). The one exception is the upload route, which takes multipart
 *      and checks that itself.
 *
 * WHERE. One call in router.ts, before the first admin route, so a new admin
 * write is covered without its author doing anything. The gate in
 * tests/admin-write-guard.derived.spec.ts reads every requireAdmin route out of
 * the router and proves each one is behind this guard.
 *
 * NOT COVERED. A non-browser client that streams a body with no Content-Type
 * and no Content-Length reaches the handler's own JSON parse. A browser cannot
 * send that across sites, and rule 1 or 2 has already run.
 */

import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { isJsonContentType } from './content-type';

/** Response code for a write refused by rules 1 and 2. */
export const CROSS_SITE_WRITE = 'CROSS_SITE_WRITE';
/** Response code for a body refused by rule 3 (the handlers' existing code). */
export const BAD_CONTENT_TYPE = 'BAD_CONTENT_TYPE';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Admin pages outside /api/v2/admin. Together with that prefix these are the
 * paths Cloudflare Access fronts (scripts/ci/access-protected-paths.txt), which
 * is where the Access cookie becomes an identity.
 */
const ADMIN_PAGE_PATHS: ReadonlySet<string> = new Set([
  '/admin',
  '/manage',
  '/dashboard',
  '/create',
  '/briefing',
  '/overview',
  '/summary',
]);

/** The one admin write that takes multipart instead of JSON. */
const MULTIPART_UPLOAD_PATH = /^\/api\/v2\/admin\/events\/[^/]+\/uploads$/;

export function isAdminPath(pathname: string): boolean {
  return pathname.startsWith('/api/v2/admin/') || ADMIN_PAGE_PATHS.has(pathname);
}

export type AdminWriteRefusal =
  | { kind: 'cross-site'; reason: 'sec-fetch-site' | 'origin' | 'no-origin' }
  | { kind: 'content-type'; reason: 'not-json' | 'undeclared-body' };

/** Why this request is refused, or null when it may go on. Reads headers only. */
export function adminWriteRefusal(
  request: Request,
  env: AdminEnv,
  url: URL
): AdminWriteRefusal | null {
  if (SAFE_METHODS.has(request.method)) return null;
  if (!isAdminPath(url.pathname)) return null;

  const actor = extractAdminActor(request, env);

  // Rule 1: what the browser says about where the request came from.
  const site = request.headers.get('Sec-Fetch-Site');
  const origin = request.headers.get('Origin');
  if (site !== null) {
    if (site.trim().toLowerCase() !== 'same-origin') {
      return { kind: 'cross-site', reason: 'sec-fetch-site' };
    }
  } else if (origin !== null) {
    if (origin !== url.origin) return { kind: 'cross-site', reason: 'origin' };
  } else if (actor !== null && !actor.startsWith('key:')) {
    // Rule 2: no evidence at all, and the caller is a signed-in person.
    return { kind: 'cross-site', reason: 'no-origin' };
  }

  // Rule 3: a body must be declared as JSON.
  if (actor !== null && !MULTIPART_UPLOAD_PATH.test(url.pathname)) {
    const contentType = request.headers.get('Content-Type');
    if (contentType !== null) {
      if (!isJsonContentType(contentType)) return { kind: 'content-type', reason: 'not-json' };
    } else if (Number(request.headers.get('Content-Length') ?? 0) > 0) {
      return { kind: 'content-type', reason: 'undeclared-body' };
    }
  }

  return null;
}

/** The response for a refusal. */
export function adminWriteRefusalResponse(refusal: AdminWriteRefusal, requestId: string): Response {
  const crossSite = refusal.kind === 'cross-site';
  const status = crossSite ? 403 : 400;
  return Response.json(
    {
      ok: false,
      status,
      code: crossSite ? CROSS_SITE_WRITE : BAD_CONTENT_TYPE,
      error: crossSite
        ? 'Admin changes must be sent from the admin site itself.'
        : 'Content-Type must be application/json',
      requestId,
      timestamp: new Date().toISOString(),
    },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } }
  );
}
