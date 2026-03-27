/**
 * OurSharedEvents – Central Router
 *
 * Route table:
 *
 *   GET /                        → public events page
 *   GET /admin                   → admin dashboard (auth required)
 *   GET /health                  → health check
 *   GET /api/status              → alias for /health
 *   GET /api/v2/events           → list active events
 *   GET /api/v2/events/:id       → single event
 *   GET /api/v2/admin/events     → admin event list (auth required)
 *
 *   POST /api/v2/events/:id/forms/register      → submit registration (public)
 *   POST /api/v2/events/:id/forms/checkin        → increment check-in (public)
 *   POST /api/v2/events/:id/forms/survey         → submit survey (public)
 *   POST /api/v2/events/:id/forms/email-signup   → email signup (public)
 *   GET  /api/v2/admin/events/:id/forms/registrations  → list registrations (admin)
 *   GET  /api/v2/admin/events/:id/forms/checkin-count  → check-in count (admin)
 *   GET  /api/v2/admin/events/:id/forms/surveys        → surveys, PII-scrubbed (admin)
 *   GET  /api/v2/admin/events/:id/forms/email-signups  → email signup count (admin)
 *   *                            → 404
 */

import { handleHealth, type HealthEnv } from './handlers/health';
import { handleListEvents, handleGetEvent, handleAdminListEvents, type EventsEnv } from './handlers/events';
import { handlePublicPage, handleAdminPage, type PagesEnv } from './handlers/pages';
import { requireAdmin, type AdminEnv } from './auth/admin';
import {
  handleFormRegistration,
  handleFormCheckin,
  handleFormSurvey,
  handleFormEmailSignup,
  handleAdminRegistrations,
  handleAdminCheckinCount,
  handleAdminSurveys,
  handleAdminEmailSignupCount,
  type FormsEnv,
} from './handlers/forms';

export type RouterEnv = HealthEnv & EventsEnv & PagesEnv & AdminEnv & FormsEnv & {
  WORKER_ENV?: string;
  WORKER_BUILD_VERSION?: string;
};

export async function route(request: Request, env: RouterEnv): Promise<Response> {
  const url = new URL(request.url);
  const { pathname, method } = { pathname: url.pathname, method: request.method };

  // ── CORS preflight ────────────────────────────────────────────────────────
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
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

  // ── Admin form endpoints (auth-gated) ──────────────────────────────────────
  const adminFormsMatch = pathname.match(
    /^\/api\/v2\/admin\/events\/([^/]+)\/forms\/(registrations|checkin-count|surveys|email-signups)$/,
  );
  if (adminFormsMatch && method === 'GET') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    const [, eventId, formType] = adminFormsMatch;
    switch (formType) {
      case 'registrations':
        return handleAdminRegistrations(request, env, eventId);
      case 'checkin-count':
        return handleAdminCheckinCount(request, env, eventId);
      case 'surveys':
        return handleAdminSurveys(request, env, eventId);
      case 'email-signups':
        return handleAdminEmailSignupCount(request, env, eventId);
    }
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

  // ── Public form endpoints (no auth) ────────────────────────────────────────
  const publicFormsMatch = pathname.match(
    /^\/api\/v2\/events\/([^/]+)\/forms\/(register|checkin|survey|email-signup)$/,
  );
  if (publicFormsMatch && method === 'POST') {
    const [, eventId, formType] = publicFormsMatch;
    switch (formType) {
      case 'register':
        return handleFormRegistration(request, env, eventId);
      case 'checkin':
        return handleFormCheckin(request, env, eventId);
      case 'survey':
        return handleFormSurvey(request, env, eventId);
      case 'email-signup':
        return handleFormEmailSignup(request, env, eventId);
    }
  }

  // ── Public pages ───────────────────────────────────────────────────────────
  if (pathname === '/' || pathname === '/events' || pathname === '/public') {
    return handlePublicPage(env);
  }

  // ── 404 ────────────────────────────────────────────────────────────────────
  return Response.json({ ok: false, status: 404, error: 'Not found', path: pathname }, { status: 404 });
}
