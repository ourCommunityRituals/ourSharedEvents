/**
 * OurSharedEvents – Central Router
 *
 * Route table:
 *
 *   GET /                        → landing page
 *   GET /admin                   → admin dashboard (auth required)
 *   GET /health                  → health check
 *   GET /api/status              → alias for /health
 *   GET /api/v2/events           → list active events
 *   GET /api/v2/events/:id       → single event
 *   GET /api/v2/admin/events     → admin event list (auth required)
 *   *                            → 404
 */

import { handleHealth, type HealthEnv } from './handlers/health';
import { handleListEvents, handleGetEvent, handleAdminListEvents, type EventsEnv } from './handlers/events';
import { handlePublicPage, handleAdminPage, handleLandingPage, handleSubscribe, type PagesEnv } from './handlers/pages';
import { requireAdmin, type AdminEnv } from './auth/admin';

export type RouterEnv = HealthEnv & EventsEnv & PagesEnv & AdminEnv & {
  WORKER_ENV?: string;
  WORKER_BUILD_VERSION?: string;
};

/** Origins allowed for CORS. Staging included for local dev and preview. */
const ALLOWED_ORIGINS = new Set([
  'https://oursharedevents.com',
  'https://www.oursharedevents.com',
  'https://stg.oursharedevents.com',
]);

function corsOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}

export async function route(request: Request, env: RouterEnv): Promise<Response> {
  const url = new URL(request.url);
  const { pathname, method } = { pathname: url.pathname, method: request.method };

  // ── CORS preflight ────────────────────────────────────────────────────────
  if (method === 'OPTIONS') {
    const origin = corsOrigin(request);
    return new Response(null, {
      status: 204,
      headers: {
        ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      },
    });
  }

  // ── Health ─────────────────────────────────────────────────────────────────
  if (pathname === '/health' || pathname === '/api/status') {
    return handleHealth(env);
  }

  // ── Admin routes (auth-gated) ──────────────────────────────────────────────
  if (pathname === '/admin') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleAdminPage(env);
  }

  if (pathname === '/api/v2/admin/events') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleAdminListEvents(request, env);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  if (pathname === '/api/v2/events') {
    return handleListEvents(request, env);
  }

  // /api/v2/events/:id
  const eventMatch = pathname.match(/^\/api\/v2\/events\/([^/]+)$/);
  if (eventMatch) {
    return handleGetEvent(request, env, eventMatch[1]);
  }

  // ── Subscribe (email capture) ─────────────────────────────────────────────
  if (pathname === '/subscribe' && method === 'POST') {
    return handleSubscribe(request);
  }

  // ── Landing page ──────────────────────────────────────────────────────────
  if (pathname === '/' || pathname === '/home' || pathname === '/welcome' || pathname === '/landing') {
    return handleLandingPage(env);
  }

  // ── Public pages ───────────────────────────────────────────────────────────
  if (pathname === '/events' || pathname === '/public') {
    return handlePublicPage(env);
  }

  // ── 404 ────────────────────────────────────────────────────────────────────
  return Response.json({ ok: false, status: 404, error: 'Not found', path: pathname }, { status: 404 });
}
