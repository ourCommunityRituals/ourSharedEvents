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
 *   GET /display                  → TV/kiosk live event display
 *   GET /poster                   → printable poster with QR codes
 *   GET /sharedReport             → shareable analytics dashboard
 *
 *   Sponsor Admin (auth required):
 *   GET    /api/v2/admin/sponsors              → list all sponsors
 *   GET    /api/v2/admin/sponsors/:id          → get sponsor
 *   POST   /api/v2/admin/sponsors              → create sponsor
 *   PUT    /api/v2/admin/sponsors/:id          → update sponsor
 *   DELETE /api/v2/admin/sponsors/:id          → soft delete
 *   PUT    /api/v2/admin/sponsors/:id/event-types  → set event type associations
 *   GET    /api/v2/admin/sponsors/:id/event-types  → get event type associations
 *   PUT    /api/v2/admin/sponsors/:id/areas    → set service areas
 *   GET    /api/v2/admin/sponsors/:id/areas    → get service areas
 *
 *   Sponsor Public (no auth):
 *   GET    /api/v2/events/:id/sponsors         → resolved sponsors for event
 *   GET    /api/v2/events/:id/sponsor-bundle   → sponsor bundle (surface filtering)
 *   POST   /api/v2/events/:id/sponsors/:sid/impression → log impression
 *   POST   /api/v2/events/:id/sponsors/:sid/click      → log click
 *   GET    /api/v2/events/:id/poster-bundle    → poster bundle (QR data URIs + form links)
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

import { handleHealth } from './handlers/health';
import {
  handleListEvents,
  handleGetEvent,
  handleAdminListEvents,
  handleCreateEvent,
  handleUpdateEvent,
  type EventsEnv,
} from './handlers/events';
import {
  handlePublicPage,
  handleAdminPage,
  handleLandingPage,
  handleSubscribe,
  handleDisplayPage,
  handlePosterPage,
  handleSharedReportPage,
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
  handleAdminExport,
  type FormsEnv,
} from './handlers/forms';
import { handleFormPage, type FormPagesEnv } from './handlers/form-pages';
import { handlePrivacyPage } from './handlers/privacy';
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
import {
  handleAdminListSponsors,
  handleAdminGetSponsor,
  handleAdminCreateSponsor,
  handleAdminUpdateSponsor,
  handleAdminDeleteSponsor,
  handleSetSponsorEventTypes,
  handleGetSponsorEventTypes,
  handleSetSponsorAreas,
  handleGetSponsorAreas,
  handleGetSponsorsForEvent,
  handleGetSponsorBundle,
  handleLogImpression,
  handleLogClick,
  type SponsorsEnv,
} from './handlers/sponsors';
import { handleGetPosterBundle, type PosterBundleEnv } from './handlers/poster-bundle';
import { corsOrigin } from './lib/cors';
import { guardPublicReadOnly } from './lib/public-readonly';

export type RouterEnv = PagesEnv &
  AdminEnv &
  FormsEnv &
  FormPagesEnv &
  SponsorsEnv &
  EventsEnv &
  PosterBundleEnv & {
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

  // ── Public read-only guard (OSE-214) ─────────────────────────────────────
  const readOnlyBlock = guardPublicReadOnly(method, pathname);
  if (readOnlyBlock) return readOnlyBlock;

  // ── CORS preflight ────────────────────────────────────────────────────────
  if (method === 'OPTIONS') {
    const origin = corsOrigin(request);
    return new Response(null, {
      status: 204,
      headers: {
        ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

  if (pathname === '/api/v2/admin/events' && method === 'GET') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleAdminListEvents(request, env);
  }

  if (pathname === '/api/v2/admin/events' && method === 'POST') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleCreateEvent(request, env);
  }

  // PUT /api/v2/admin/events/:id — update event
  const adminEventMatch = pathname.match(/^\/api\/v2\/admin\/events\/([^/]+)$/);
  if (adminEventMatch && method === 'PUT') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleUpdateEvent(request, env, adminEventMatch[1]);
  }

  // ── Admin sponsor routes (auth-gated) ──────────────────────────────────────

  if (pathname === '/api/v2/admin/sponsors' && method === 'GET') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleAdminListSponsors(request, env);
  }

  if (pathname === '/api/v2/admin/sponsors' && method === 'POST') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleAdminCreateSponsor(request, env);
  }

  // PUT/DELETE /api/v2/admin/sponsors/:id/event-types
  const adminSponsorEventTypesMatch = pathname.match(
    /^\/api\/v2\/admin\/sponsors\/([^/]+)\/event-types$/
  );
  if (adminSponsorEventTypesMatch) {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    if (method === 'PUT')
      return handleSetSponsorEventTypes(request, env, adminSponsorEventTypesMatch[1]);
    if (method === 'GET')
      return handleGetSponsorEventTypes(request, env, adminSponsorEventTypesMatch[1]);
  }

  // PUT/GET /api/v2/admin/sponsors/:id/areas
  const adminSponsorAreasMatch = pathname.match(/^\/api\/v2\/admin\/sponsors\/([^/]+)\/areas$/);
  if (adminSponsorAreasMatch) {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    if (method === 'PUT') return handleSetSponsorAreas(request, env, adminSponsorAreasMatch[1]);
    if (method === 'GET') return handleGetSponsorAreas(request, env, adminSponsorAreasMatch[1]);
  }

  // GET/PUT/DELETE /api/v2/admin/sponsors/:id
  const adminSponsorMatch = pathname.match(/^\/api\/v2\/admin\/sponsors\/([^/]+)$/);
  if (adminSponsorMatch) {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    if (method === 'GET') return handleAdminGetSponsor(request, env, adminSponsorMatch[1]);
    if (method === 'PUT') return handleAdminUpdateSponsor(request, env, adminSponsorMatch[1]);
    if (method === 'DELETE') return handleAdminDeleteSponsor(request, env, adminSponsorMatch[1]);
  }

  // ── Admin form export (auth-gated) ─────────────────────────────────────────
  const adminExportMatch = pathname.match(/^\/api\/v2\/admin\/events\/([^/]+)\/forms\/export$/);
  if (adminExportMatch && method === 'GET') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleAdminExport(request, env, adminExportMatch[1]);
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

  // ── Public sponsor endpoints (no auth) ─────────────────────────────────────

  // GET /api/v2/events/:id/sponsors
  const eventSponsorsMatch = pathname.match(/^\/api\/v2\/events\/([^/]+)\/sponsors$/);
  if (eventSponsorsMatch && method === 'GET') {
    return handleGetSponsorsForEvent(request, env, eventSponsorsMatch[1]);
  }

  // GET /api/v2/events/:id/sponsor-bundle
  const sponsorBundleMatch = pathname.match(/^\/api\/v2\/events\/([^/]+)\/sponsor-bundle$/);
  if (sponsorBundleMatch && method === 'GET') {
    return handleGetSponsorBundle(request, env, sponsorBundleMatch[1]);
  }

  // GET /api/v2/events/:id/poster-bundle
  const posterBundleMatch = pathname.match(/^\/api\/v2\/events\/([^/]+)\/poster-bundle$/);
  if (posterBundleMatch && method === 'GET') {
    return handleGetPosterBundle(request, env, posterBundleMatch[1]);
  }

  // POST /api/v2/events/:id/sponsors/:sid/impression
  const impressionMatch = pathname.match(
    /^\/api\/v2\/events\/([^/]+)\/sponsors\/([^/]+)\/impression$/
  );
  if (impressionMatch && method === 'POST') {
    return handleLogImpression(request, env, impressionMatch[1], impressionMatch[2]);
  }

  // POST /api/v2/events/:id/sponsors/:sid/click
  const clickMatch = pathname.match(/^\/api\/v2\/events\/([^/]+)\/sponsors\/([^/]+)\/click$/);
  if (clickMatch && method === 'POST') {
    return handleLogClick(request, env, clickMatch[1], clickMatch[2]);
  }

  // ── Public form endpoints (no auth) ────────────────────────────────────────
  const publicFormsMatch = pathname.match(
    /^\/api\/v2\/events\/([^/]+)\/forms\/(register|checkin|survey|email-signup)$/
  );
  if (publicFormsMatch && method === 'POST') {
    const [, eventId, formType] = publicFormsMatch;

    // Event lifecycle guard: reject submissions for non-active events.
    // Only blocks if the event row explicitly exists with a non-active status;
    // unknown event IDs pass through for backward compat with un-seeded test fixtures.
    if (env.DB) {
      const eventRow = await env.DB.prepare('SELECT status FROM events WHERE id = ?')
        .bind(eventId)
        .first<{ status: string }>();
      if (eventRow && eventRow.status !== 'active') {
        return Response.json(
          {
            ok: false,
            status: 410,
            code: 'EVENT_ARCHIVED',
            error: 'This event is no longer accepting submissions',
          },
          { status: 410 }
        );
      }
    }

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
  if (pathname === '/subscribe' || pathname === '/signup' || pathname === '/newsletter') {
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
    pathname === '/landing' ||
    pathname === '/about' ||
    pathname === '/info'
  ) {
    return handleLandingPage(env);
  }

  // ── Public pages ───────────────────────────────────────────────────────────
  if (
    pathname === '/events' ||
    pathname === '/public' ||
    pathname === '/schedule' ||
    pathname === '/calendar' ||
    pathname === '/agenda' ||
    pathname === '/lineup'
  ) {
    return handlePublicPage(env);
  }

  // ── Admin aliases ─────────────────────────────────────────────────────────
  if (pathname === '/manage' || pathname === '/dashboard' || pathname === '/create') {
    const deny = requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleAdminPage(env);
  }

  // ── CEO Briefing ───────────────────────────────────────────────────────────
  if (
    (pathname === '/briefing' || pathname === '/overview' || pathname === '/summary') &&
    method === 'GET'
  ) {
    return handleBriefingPage();
  }

  // ── MVP surfaces (display, poster, shared report) ─────────────────────────
  if (
    pathname === '/display' ||
    pathname === '/tv' ||
    pathname === '/kiosk' ||
    pathname === '/screen'
  ) {
    return handleDisplayPage(env);
  }

  if (
    pathname === '/poster' ||
    pathname === '/posters' ||
    pathname === '/flyers' ||
    pathname === '/tabletop' ||
    pathname === '/tent' ||
    pathname === '/signage'
  ) {
    return handlePosterPage(env);
  }

  if (
    pathname === '/sharedReport' ||
    pathname === '/report' ||
    pathname === '/analytics' ||
    pathname === '/reports' ||
    pathname === '/insights' ||
    pathname === '/stats'
  ) {
    const reportEnabled = await isFeatureEnabled(env.FORMS_DB, 'analytics.shared-report');
    if (!reportEnabled) {
      return Response.json(
        {
          ok: false,
          status: 403,
          code: 'REPORT_DISABLED',
          error: 'Shared reports are not enabled for this tier',
        },
        { status: 403 }
      );
    }
    return handleSharedReportPage(env);
  }

  // ── Privacy policy (BE-10) ─────────────────────────────────────────────────
  if ((pathname === '/privacy' || pathname === '/privacy-policy') && method === 'GET') {
    return handlePrivacyPage();
  }

  // ── 404 ────────────────────────────────────────────────────────────────────
  return Response.json({ ok: false, status: 404, error: 'Not found' }, { status: 404 });
}
