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
 *
 *   POST /api/v2/events/:id/forms/register      → submit registration (public)
 *   POST /api/v2/events/:id/forms/checkin        → increment check-in (public)
 *   POST /api/v2/events/:id/forms/survey         → submit survey (public)
 *   POST /api/v2/events/:id/forms/email-signup   → email signup (public)
 *   GET  /api/v2/admin/events/:id/forms/registrations  → list registrations (admin)
 *   GET  /api/v2/admin/events/:id/forms/checkin-count  → check-in count (admin)
 *   GET  /api/v2/admin/events/:id/forms/surveys        → surveys, PII-scrubbed (admin)
 *   GET  /api/v2/admin/events/:id/forms/email-signups  → email signup count (admin)
 *   GET  /forms/:eventId?type=register|checkin|survey|email  → public form page (QR landing)
 *   POST /subscribe              → email capture
 *
 *   Feature Flag Admin (auth required):
 *   GET    /api/v2/admin/flags              → list all flags
 *   GET    /api/v2/admin/flags/tiers        → list tier presets
 *   GET    /api/v2/admin/flags/current-tier → detect active tier
 *   GET    /api/v2/admin/flags/resolve      → resolved flags (?eventId=)
 *   PUT    /api/v2/admin/flags/:key         → toggle a global flag
 *   POST   /api/v2/admin/flags/apply-tier   → apply tier preset
 *   PUT    /api/v2/admin/events/:id/flags/:key    → set event override
 *   DELETE /api/v2/admin/events/:id/flags/:key    → remove event override
 *
 *   *                            → 404
 */

import { handleHealth, type HealthEnv } from './handlers/health';
import {
  handleListEvents,
  handleGetEvent,
  handleAdminListEvents,
  type EventsEnv,
} from './handlers/events';
import {
  handlePublicPage,
  handleAdminPage,
  handleLandingPage,
  handleSubscribe,
  type PagesEnv,
} from './handlers/pages';
import { handleBriefingPage } from './handlers/briefing';
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
import { handleFormPage, type FormPagesEnv } from './handlers/form-pages';
import { isFeatureEnabled, type FeatureFlagEnv } from './lib/feature-flags';
import {
  handleListFlags,
  handleListTiers,
  handleGetCurrentTier,
  handleResolveFlags,
  handleSetFlag,
  handleApplyTier,
  handleSetEventFlag,
  handleRemoveEventFlag,
} from './handlers/feature-flags';
import { corsOrigin } from './lib/cors';

export type RouterEnv = HealthEnv &
  EventsEnv &
  PagesEnv &
  AdminEnv &
  FormsEnv &
  FormPagesEnv & {
    WORKER_ENV?: string;
    WORKER_BUILD_VERSION?: string;
  };

export async function route(request: Request, env: RouterEnv): Promise<Response> {
  const url = new URL(request.url);
  const { pathname, method } = { pathname: url.pathname, method: request.method };

  // ── HTTPS redirect ──────────────────────────────────────────────────────
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }

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
        Vary: 'Origin',
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
    /^\/api\/v2\/admin\/events\/([^/]+)\/forms\/(registrations|checkin-count|surveys|email-signups)$/
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

  // ── Feature Flag Admin routes (auth-gated) ─────────────────────────────────

  // Event-level flag overrides: PUT/DELETE /api/v2/admin/events/:id/flags/:key
  const eventFlagMatch = pathname.match(/^\/api\/v2\/admin\/events\/([^/]+)\/flags\/([^/]+)$/);
  if (eventFlagMatch && (method === 'PUT' || method === 'DELETE')) {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    const [, eventId, flagKey] = eventFlagMatch;
    if (method === 'PUT') return handleSetEventFlag(request, env, eventId, flagKey);
    return handleRemoveEventFlag(env, eventId, flagKey);
  }

  if (pathname === '/api/v2/admin/flags' && method === 'GET') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleListFlags(request, env);
  }

  if (pathname === '/api/v2/admin/flags/tiers' && method === 'GET') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleListTiers();
  }

  if (pathname === '/api/v2/admin/flags/current-tier' && method === 'GET') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleGetCurrentTier(env);
  }

  if (pathname === '/api/v2/admin/flags/resolve' && method === 'GET') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleResolveFlags(request, env);
  }

  // PUT /api/v2/admin/flags/:key — toggle a global flag
  const flagKeyMatch = pathname.match(/^\/api\/v2\/admin\/flags\/([^/]+)$/);
  if (flagKeyMatch && method === 'PUT') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleSetFlag(request, env, flagKeyMatch[1]);
  }

  if (pathname === '/api/v2/admin/flags/apply-tier' && method === 'POST') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleApplyTier(request, env);
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
    /^\/api\/v2\/events\/([^/]+)\/forms\/(register|checkin|survey|email-signup)$/
  );
  if (publicFormsMatch && method === 'POST') {
    const [, eventId, formType] = publicFormsMatch;

    // Feature flag check: is this form type enabled for this event?
    const flagKey = `forms.${formType}`;
    const enabled = await isFeatureEnabled(env.FORMS_DB, flagKey, eventId);
    if (!enabled) {
      return Response.json(
        {
          ok: false,
          status: 403,
          code: 'FORM_DISABLED',
          error: `${formType} is not enabled for this event`,
        },
        { status: 403 }
      );
    }

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

  // ── Public form pages (QR→form landing) ───────────────────────────────────
  const formPageMatch = pathname.match(/^\/forms\/([^/]+)$/);
  if (formPageMatch && method === 'GET') {
    return handleFormPage(request, env, formPageMatch[1]);
  }

  // ── Subscribe (email capture) ─────────────────────────────────────────────
  if (pathname === '/subscribe') {
    if (method === 'POST') return handleSubscribe(request, env);
    return Response.json(
      { ok: false, error: 'Method not allowed' },
      { status: 405, headers: { Allow: 'POST' } }
    );
  }

  // ── Landing page ──────────────────────────────────────────────────────────
  if (
    pathname === '/' ||
    pathname === '/home' ||
    pathname === '/welcome' ||
    pathname === '/landing'
  ) {
    return handleLandingPage(env);
  }

  // ── Public pages ───────────────────────────────────────────────────────────
  if (pathname === '/events' || pathname === '/public') {
    return handlePublicPage(env);
  }

  // ── CEO Briefing ───────────────────────────────────────────────────────────
  if (pathname === '/briefing' && method === 'GET') {
    return handleBriefingPage();
  }

  // ── 404 ────────────────────────────────────────────────────────────────────
  return Response.json({ ok: false, status: 404, error: 'Not found' }, { status: 404 });
}
