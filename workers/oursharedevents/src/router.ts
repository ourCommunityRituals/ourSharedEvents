/**
 * OurSharedEvents – Central Router
 *
 * Route table:
 *
 *   GET /                        → landing page
 *   GET /admin                   → admin dashboard (auth required)
 *   GET /ui.css                  → shared OCR stylesheet (@ocr/ui)
 *   GET /ui-preview              → component showcase for Claude Design (no auth)
 *   GET /health                  → health check
 *   GET /api/status              → alias for /health
 *   GET /api/v2/events           → list active events
 *   GET /api/v2/events/:id       → single event
 *   GET /api/v2/events/:id/shared-report     → SharedReport (signed-link auth, OSE-272 S5)
 *   POST /api/v2/events/shared-reports/batch → SharedReport batch (WKRP service token, OSE-272 S5)
 *   POST /api/v2/admin/events/:id/shared-report/mint-link → mint signed token (admin, S-3.5.1)
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
 *   GET /api/v2/uec/resolve?code=<id|label>  → UEC code resolution (OSE-320)
 *                                            — returns canonical metadata + QR data URI.
 *                                            UEC is a semantic-category contract
 *                                            for any URL: QR, shortlink, deep link.
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
 *   Poster Deployments Admin (auth required):
 *   POST   /api/v2/admin/events/:id/poster-deployments  → create deployment (with H3 tagging)
 *   GET    /api/v2/admin/events/:id/poster-deployments  → list deployments for event
 *   GET    /api/v2/admin/poster-deployments/:id         → get single deployment
 *   PUT    /api/v2/admin/poster-deployments/:id         → update (re-tags H3 when coords change)
 *   DELETE /api/v2/admin/poster-deployments/:id         → soft-delete (is_active=0)
 *   POST   /api/v2/admin/poster-deployments/backfill-h3 → backfill H3 for existing rows
 *
 *   Admin Audit Log (auth required — OSE-212):
 *   GET    /api/v2/admin/audit-log          → paginated audit entries
 *
 *   Security Monitoring (auth required — OSE-SEC-1):
 *   GET    /api/v2/admin/security/rate-limit-stats → top-10 rate-limited IPs (last hour, from KV)
 *
 *   QR Verify/Unverify (auth required — OSE-213):
 *   POST   /api/v2/admin/events/:id/verify-qr    → handleV2AdminVerifyQr (READY→ACTIVE)
 *   POST   /api/v2/admin/events/:id/unverify-qr  → handleV2AdminUnverifyQr (ACTIVE→READY)
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
 *   POST /api/v2/admin/events/:id/backup   → handleAdminBackupEvent (auth required)
 *   POST /api/v2/admin/events/:id/uploads → handleAdminUploadFile (auth required)
 *   GET  /api/v2/uploads/*key             → handleGetUploadedFile (public)
 *
 *   Data Subject Rights (OSE-203 / GDPR Art. 17 / CCPA §1798.105):
 *   POST /api/v2/admin/data-subject/erase → handleDataSubjectErase (auth required)
 *
 *   GET /.well-known/openid-configuration  → OIDC discovery (WIF)
 *   GET /.well-known/jwks.json             → WIF public key
 *
 *   *                            → 404
 */

import { serveCss } from '@ocr/ui';
import { handleHealth } from './handlers/health';
import {
  handleListEvents,
  handleGetEvent,
  handleAdminListEvents,
  handleCreateEvent,
  handleUpdateEvent,
  handleBackfillH3Cells,
  type EventsEnv,
} from './handlers/events';
import { handlePortfolioRollup } from './handlers/portfolio-rollup';
import {
  handlePublicPage,
  handlePublicEventPage,
  handleAdminPage,
  handleAdminSignInPage,
  handleLandingPage,
  handleSubscribe,
  handleDisplayPage,
  handlePosterPage,
  handleSharedReportPage,
  handleUiPreview,
  type PagesEnv,
} from './handlers/pages';
import { handleBriefingPage } from './handlers/briefing';
import { handleDemoIndex, handleDemoSite } from './handlers/demo';
import { requireAdmin, extractAdminActor, verifyCfAccessJWT, type AdminEnv } from './auth/admin';
import {
  logAdminAction,
  logReportAccess,
  logExportManifest,
  type AuditLogEnv,
} from './lib/audit-log';
import { handleListAuditLog, type AuditHandlerEnv } from './handlers/audit';
import { handleListSubscribers, type SubscribersAdminEnv } from './handlers/subscribers';
import { handleAdminGeocode, type GeocodeAdminEnv } from './handlers/geocode';
import { handleShortlinkResolve, type ShortlinkResolveEnv } from './handlers/shortlink-resolve';
import { handleUecResolve } from './handlers/uec-resolve';
import {
  handleV2AdminVerifyQr,
  handleV2AdminUnverifyQr,
  type QrVerifyEnv,
} from './handlers/qr-verify';
import {
  handleFormRegistration,
  handleSelfDeleteRegistration,
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
  handleSponsorLogo,
  type SponsorsEnv,
} from './handlers/sponsors';
import { handleAdminBackupEvent, type BigQueryHandlerEnv } from './handlers/bigquery';
import { handleCreateSponsorDraft } from './handlers/sponsors-draft';
import { handleSponsorAsset } from './handlers/sponsor-asset-route';
import { fetchStaticMapImage, type MapsEnv } from './lib/maps';
import { handleGetPosterBundle, type PosterBundleEnv } from './handlers/poster-bundle';
import {
  handleAdminCreatePosterDeployment,
  handleAdminListPosterDeployments,
  handleAdminGetPosterDeployment,
  handleAdminUpdatePosterDeployment,
  handleAdminDeletePosterDeployment,
  handleBackfillPosterH3,
  type PosterDeploymentsEnv,
} from './handlers/poster-deployments';
import { handleQrScan, type QrScanEnv } from './handlers/qr-scan';
import { corsOrigin } from './lib/cors';
import { guardPublicReadOnly } from './lib/public-readonly';
import { assertRenderable, parseEventState } from './domain/event-state';
import {
  isRateLimited,
  checkRateLimit,
  clientIp,
  rateLimitResponse,
  RATE_LIMIT_ADMIN_MAX,
  RATE_LIMIT_BATCH_MAX,
  RATE_LIMIT_MINT_MAX,
  type RateLimitEnv,
} from './lib/rate-limit';
import {
  handleAdminUploadFile,
  handleGetUploadedFile,
  handleSponsorAssetUpload,
  type UploadEnv,
} from './handlers/upload';
import { handleDataSubjectErase, type DataSubjectEnv } from './handlers/data-subject';
import {
  handleAdminMintSharedReportLink,
  handleGetSharedReport,
  handleBatchSharedReports,
  type SharedReportReadEnv,
} from './handlers/shared-report-read';

export type RouterEnv = PagesEnv &
  AdminEnv &
  FormsEnv &
  FormPagesEnv &
  SponsorsEnv &
  EventsEnv &
  AuditLogEnv &
  AuditHandlerEnv &
  QrVerifyEnv &
  MapsEnv &
  BigQueryHandlerEnv &
  PosterBundleEnv &
  PosterDeploymentsEnv &
  QrScanEnv &
  UploadEnv &
  DataSubjectEnv &
  SharedReportReadEnv &
  ShortlinkResolveEnv &
  RateLimitEnv & {
    WORKER_ENV?: string;
    WORKER_BUILD_VERSION?: string;
    // OSE-272: peppered SHA-256 input for SharedReport return-rate hashing.
    // Distinct secret from IP_HASH_PEPPER per Q1 ratified (separate peppers,
    // separate rotation cadences for independent blast radii). Read only by
    // src/lib/shared-report.ts (cron-only — Gate 4).
    ANON_ID_HASH_PEPPER?: string;
    // OSE-272 Session 5: HMAC-SHA256 signing secret for signed-link tokens
    // (bar/sponsor SharedReport read auth). Unset → all signed-link reads
    // are rejected (fail-safe).
    SHARED_REPORT_SIGNING_SECRET?: string;
    // OSE-272 Session 5: WKRP service-account bearer token for the batch
    // SharedReport endpoint. Unset → batch endpoint rejects all callers.
    WKRP_SERVICE_TOKEN?: string;
    // Security cron — Linear integration (OSE-SEC-1)
    LINEAR_API_KEY?: string;
    LINEAR_TEAM_ID?: string;
    // Security cron — tunable alert thresholds
    AUTH_FAILURE_THRESHOLD?: string;
    RATE_LIMIT_TRIGGER_THRESHOLD?: string;
    ERROR_5XX_THRESHOLD_PCT?: string;
    // TL-018: ISO timestamp of the last FORMS_ENCRYPTION_KEY rotation.
    // Set this alongside the key whenever rotating; the security cron uses it
    // to alert when the key age exceeds the 90-day rotation window.
    FORMS_KEY_ROTATED_AT?: string;
  };

export async function route(
  request: Request,
  env: RouterEnv,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname, method } = { pathname: url.pathname, method: request.method };

  // ── Audit helpers (OSE-212) ───────────────────────────────────────────────────
  const _ip = request.headers.get('CF-Connecting-IP') ?? undefined;
  const _actor = extractAdminActor(request, env);
  function _audit(
    reqId: string,
    action: string,
    outcome: 'success' | 'denied',
    resourceType?: string,
    resourceId?: string
  ): void {
    ctx.waitUntil(
      logAdminAction(env, {
        action,
        actor: _actor,
        resource_type: resourceType,
        resource_id: resourceId,
        request_id: reqId,
        outcome,
        ip: _ip,
      })
    );
  }

  // ── HTTPS redirect ──────────────────────────────────────────────────────
  // Use 308 (Permanent Redirect) to preserve the HTTP method across the upgrade.
  // 301 historically causes POST→GET downgrade; 308 guarantees method preservation.
  // Loopback hosts are exempt so `wrangler dev` (plain HTTP on localhost) is
  // reachable in a browser; this never affects production, which is never loopback.
  const isLoopbackHost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol === 'http:' && !isLoopbackHost) {
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 308);
  }

  // ── OIDC well-known endpoints (for GCP Workload Identity Federation) ──────────
  if (method === 'GET' && pathname === '/.well-known/openid-configuration') {
    const issuer =
      (env as { WIF_ISSUER?: string }).WIF_ISSUER?.trim() ?? 'https://oursharedevents.workers.dev';
    return Response.json({
      issuer,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ['id_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
    });
  }

  if (method === 'GET' && pathname === '/.well-known/jwks.json') {
    const jwks = (env as { WIF_PUBLIC_JWKS?: string }).WIF_PUBLIC_JWKS ?? '{"keys":[]}';
    return new Response(jwks, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    });
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
  // ── QR scan ingestion (OSE-625) — `/q/<qr_token>` ─────────────────────────
  // PUBLIC route. Records an anonymous scan row and 302-redirects to the
  // form page with ?deployment=<id> for attribution. qr_token starts with
  // 'qrt_' (distinguishes from /s/ shortlink codes). Set-Cookie for anon_id
  // if the visitor is new.
  if (pathname.startsWith('/q/') && method === 'GET') {
    const qrToken = pathname.slice('/q/'.length);
    return handleQrScan(request, env, qrToken);
  }

  // ── Shortlink resolver (OSE-240) — `/s/<code>` ────────────────────────────
  // PUBLIC route. NO auth. Anonymity-principle compliant: counter +
  // last_clicked_at increments only; no IP, no anon_id, no session.
  // Matched FIRST so /s/ never collides with longer prefixes downstream.
  if (pathname.startsWith('/s/') && method === 'GET') {
    const code = pathname.slice('/s/'.length);
    return handleShortlinkResolve(request, env, code);
  }

  if (pathname === '/ui.css') {
    return serveCss();
  }

  if (pathname === '/ui-preview') {
    return handleUiPreview();
  }

  // ── Demo Site — permanent reference installation (OSE-605, thin slice) ─────
  // PUBLIC, no auth. Front door + three standing tier sites rendering the same
  // mock dataset at three depths. Depth is render-side only (SR-25 respected).
  if (pathname === '/demo' && method === 'GET') {
    return handleDemoIndex();
  }
  const demoSiteMatch = pathname.match(/^\/demo\/([^/]+)$/);
  if (demoSiteMatch && method === 'GET') {
    return handleDemoSite(demoSiteMatch[1]);
  }

  if (pathname === '/health' || pathname === '/api/status') {
    return handleHealth(env);
  }

  // ── UEC code resolution (OSE-320) — public, no auth ─────────────────────
  // GET /api/v2/uec/resolve?code=<id|label> — returns canonical UEC metadata
  // + a QR data URI for the code's url_path. Reads from the OSE-consumed
  // copy of the brain UEC artifact (src/lib/uec/). Anonymity-principle
  // compliant: stateless, no tracking, deterministic.
  //
  // UEC is the semantic-category contract for ANY URL the platform emits
  // — QR codes, shortlinks, deep links, sponsor placements. This endpoint
  // resolves the code → metadata + renderable QR; future endpoints in the
  // /api/v2/uec/* family will serve shortlink-creation and other surfaces.
  if (pathname === '/api/v2/uec/resolve' && method === 'GET') {
    return handleUecResolve(request);
  }

  // ── CF Access JWT pre-flight (OSE-573) ────────────────────────────────────
  // Verify the cryptographic signature of any CF Access JWT present on the
  // request BEFORE any route handler reads its claims. This closes the gap
  // where requireAdmin decoded-without-verifying; any forged token is rejected
  // here, once, rather than per-callsite.
  //
  // Skip when CF_ACCESS_TEAM_DOMAIN is not configured (local dev / CI with
  // ALLOW_ADMIN_KEY_FALLBACK or ALLOW_OCR_INTERNAL — those paths carry no JWT).
  const _cfJwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (_cfJwt && (env as AdminEnv).CF_ACCESS_TEAM_DOMAIN) {
    const _jwtResult = await verifyCfAccessJWT(
      _cfJwt,
      (env as AdminEnv).CF_ACCESS_TEAM_DOMAIN as string
    );
    if (!_jwtResult.valid) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 401,
          code: 'INVALID_JWT',
          error: 'Token signature verification failed',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // ── Admin route rate limit pre-flight (OSE-576) ────────────────────────────
  // Rate-limit admin-path requests by CF-Ray-ID before paying the auth cost.
  // Applies to any /admin or /api/v2/admin/* request in production only — skip
  // in test/staging to avoid exhausting the limit during automated test suites.
  if (
    env.RATE_LIMIT_KV &&
    env.WORKER_ENV === 'production' &&
    (pathname.startsWith('/api/v2/admin') || pathname === '/admin' || pathname === '/manage')
  ) {
    const adminKey = `admin:${clientIp(request)}`;
    if (await checkRateLimit(adminKey, env.RATE_LIMIT_KV, RATE_LIMIT_ADMIN_MAX)) {
      return rateLimitResponse();
    }
  }

  // ── Admin routes (auth-gated) ──────────────────────────────────────────────
  //
  // R-001 fix (2026-05-15) — HTML GET /admin must return an HTML sign-in
  // page when unauthenticated, not the JSON 401 from requireAdmin. The
  // JSON dump was the literal first-touch experience for any prospect
  // clicking "Admin" from the landing nav.
  //
  // Logic: if the client accepts text/html (browsers do; API clients
  // rarely send Accept:text/html for JSON endpoints), render the HTML
  // sign-in page on auth fail. Otherwise fall through to the JSON 401
  // so machine consumers (curl, scripts, CI) still get a structured
  // response.
  //
  // EDGE-LAYER NOTE (2026-05-18, OSE-338) — On staging (and prod),
  // Cloudflare Access fronts /admin, /manage, /dashboard, /create, and
  // /api/v2/admin/* at the network edge. Unauthenticated requests are
  // redirected (302 → CF Access login at mzdano.cloudflareaccess.com)
  // BEFORE reaching the worker, so this `handleAdminSignInPage`
  // 401 path is effectively shadowed on those environments. The worker
  // remains the contract owner for local dev + any environment without
  // CF Access in front. Postman ose-pages.json OSE-R-001 tests assert
  // the unified contract — "unauthenticated request is blocked,
  // dashboard HTML is never served" — and accept either CF Access
  // 302/200 OR worker 401 as satisfying that contract.
  if (pathname === '/admin' && method === 'GET') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) {
      const accept = request.headers.get('Accept') ?? '';
      if (accept.includes('text/html')) {
        return handleAdminSignInPage(env);
      }
      return deny;
    }
    return handleAdminPage(env);
  }

  if (pathname === '/api/v2/admin/events' && method === 'GET') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleAdminListEvents(request, env);
  }

  if (pathname === '/api/v2/admin/events' && method === 'POST') {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) {
      _audit(reqId, 'CREATE_EVENT', 'denied', 'event');
      return deny;
    }
    const response = await handleCreateEvent(request, env);
    _audit(reqId, 'CREATE_EVENT', 'success', 'event');
    return response;
  }

  // POST /api/v2/admin/events/backfill-h3-cells — OSE-489 one-shot H3 backfill
  if (pathname === '/api/v2/admin/events/backfill-h3-cells' && method === 'POST') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleBackfillH3Cells(request, env);
  }

  // GET /api/v2/admin/events/portfolio-rollup — OSE-669 brand-scoped rollup strip.
  // Exact match placed BEFORE the /:id matcher so "portfolio-rollup" is never
  // parsed as an event id.
  if (pathname === '/api/v2/admin/events/portfolio-rollup' && method === 'GET') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handlePortfolioRollup(request, env);
  }

  // PUT /api/v2/admin/events/:id — update event
  const adminEventMatch = pathname.match(/^\/api\/v2\/admin\/events\/([^/]+)$/);
  if (adminEventMatch && method === 'PUT') {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) {
      _audit(reqId, 'UPDATE_EVENT', 'denied', 'event', adminEventMatch[1]);
      return deny;
    }
    const response = await handleUpdateEvent(request, env, adminEventMatch[1]);
    _audit(reqId, 'UPDATE_EVENT', 'success', 'event', adminEventMatch[1]);
    return response;
  }

  // ── QR verify/unverify (OSE-213) ────────────────────────────────────────────────

  // POST /api/v2/admin/events/:id/verify-qr
  if (method === 'POST' && /^\/api\/v2\/admin\/events\/([^/]+)\/verify-qr$/.test(pathname)) {
    const eventId = pathname.split('/')[5];
    const authRes = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (authRes) {
      _audit(crypto.randomUUID(), 'VERIFY_QR', 'denied', 'event', eventId);
      return authRes;
    }
    const res = await handleV2AdminVerifyQr(request, env, eventId);
    _audit(
      crypto.randomUUID(),
      'VERIFY_QR',
      res.status < 400 ? 'success' : 'denied',
      'event',
      eventId
    );
    return res;
  }

  // POST /api/v2/admin/events/:id/unverify-qr
  if (method === 'POST' && /^\/api\/v2\/admin\/events\/([^/]+)\/unverify-qr$/.test(pathname)) {
    const eventId = pathname.split('/')[5];
    const authRes = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (authRes) {
      _audit(crypto.randomUUID(), 'UNVERIFY_QR', 'denied', 'event', eventId);
      return authRes;
    }
    const res = await handleV2AdminUnverifyQr(request, env, eventId);
    _audit(
      crypto.randomUUID(),
      'UNVERIFY_QR',
      res.status < 400 ? 'success' : 'denied',
      'event',
      eventId
    );
    return res;
  }

  // POST /api/v2/admin/events/:id/backup — BigQuery event backup (OSE-215)
  if (method === 'POST' && /^\/api\/v2\/admin\/events\/([^/]+)\/backup$/.test(pathname)) {
    const eventId = pathname.split('/')[5];
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const authRes = await requireAdmin(request, env, reqId);
    if (authRes) {
      _audit(reqId, 'BACKUP_EVENT', 'denied', 'event', eventId);
      return authRes;
    }
    const res = await handleAdminBackupEvent(request, env, eventId);
    const backupOutcome = res.status < 400 ? 'success' : 'denied';
    _audit(reqId, 'BACKUP_EVENT', backupOutcome, 'event', eventId);
    ctx.waitUntil(
      logExportManifest(env, {
        export_type: 'BIGQUERY',
        event_id: eventId,
        actor: _actor,
        request_id: reqId,
        outcome: backupOutcome === 'success' ? 'success' : 'failed',
      })
    );
    return res;
  }

  // POST /api/v2/admin/events/:id/uploads — R2 file upload (OSE-200)
  if (method === 'POST' && /^\/api\/v2\/admin\/events\/([^/]+)\/uploads$/.test(pathname)) {
    const eventId = pathname.split('/')[5];
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const authRes = await requireAdmin(request, env, reqId);
    if (authRes) {
      _audit(reqId, 'UPLOAD_FILE', 'denied', 'event', eventId);
      return authRes;
    }
    const res = await handleAdminUploadFile(request, env, eventId);
    const uploadOutcome = res.status < 400 ? 'success' : 'denied';
    _audit(reqId, 'UPLOAD_FILE', uploadOutcome, 'event', eventId);
    ctx.waitUntil(
      logExportManifest(env, {
        export_type: 'UPLOAD_FILE',
        event_id: eventId,
        actor: _actor,
        request_id: reqId,
        outcome: uploadOutcome === 'success' ? 'success' : 'failed',
      })
    );
    return res;
  }

  // ── Admin sponsor routes (auth-gated) ──────────────────────────────────────

  if (pathname === '/api/v2/admin/sponsors' && method === 'GET') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleAdminListSponsors(request, env);
  }

  if (pathname === '/api/v2/admin/sponsors' && method === 'POST') {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) {
      _audit(reqId, 'CREATE_SPONSOR', 'denied', 'sponsor');
      return deny;
    }
    const response = await handleAdminCreateSponsor(request, env);
    _audit(reqId, 'CREATE_SPONSOR', 'success', 'sponsor');
    return response;
  }

  // PUT/GET /api/v2/admin/sponsors/:id/event-types
  const adminSponsorEventTypesMatch = pathname.match(
    /^\/api\/v2\/admin\/sponsors\/([^/]+)\/event-types$/
  );
  if (adminSponsorEventTypesMatch) {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) {
      _audit(
        reqId,
        'UPDATE_SPONSOR_EVENT_TYPES',
        'denied',
        'sponsor',
        adminSponsorEventTypesMatch[1]
      );
      return deny;
    }
    if (method === 'PUT') {
      const response = await handleSetSponsorEventTypes(
        request,
        env,
        adminSponsorEventTypesMatch[1]
      );
      _audit(
        reqId,
        'UPDATE_SPONSOR_EVENT_TYPES',
        'success',
        'sponsor',
        adminSponsorEventTypesMatch[1]
      );
      return response;
    }
    if (method === 'GET')
      return handleGetSponsorEventTypes(request, env, adminSponsorEventTypesMatch[1]);
  }

  // PUT/GET /api/v2/admin/sponsors/:id/areas
  const adminSponsorAreasMatch = pathname.match(/^\/api\/v2\/admin\/sponsors\/([^/]+)\/areas$/);
  if (adminSponsorAreasMatch) {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) {
      _audit(reqId, 'UPDATE_SPONSOR_AREAS', 'denied', 'sponsor', adminSponsorAreasMatch[1]);
      return deny;
    }
    if (method === 'PUT') {
      const response = await handleSetSponsorAreas(request, env, adminSponsorAreasMatch[1]);
      _audit(reqId, 'UPDATE_SPONSOR_AREAS', 'success', 'sponsor', adminSponsorAreasMatch[1]);
      return response;
    }
    if (method === 'GET') return handleGetSponsorAreas(request, env, adminSponsorAreasMatch[1]);
  }

  // GET/PUT/DELETE /api/v2/admin/sponsors/:id
  const adminSponsorMatch = pathname.match(/^\/api\/v2\/admin\/sponsors\/([^/]+)$/);
  if (adminSponsorMatch) {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) {
      _audit(reqId, 'SPONSOR_MUTATE', 'denied', 'sponsor', adminSponsorMatch[1]);
      return deny;
    }
    if (method === 'GET') return handleAdminGetSponsor(request, env, adminSponsorMatch[1]);
    if (method === 'PUT') {
      const response = await handleAdminUpdateSponsor(request, env, adminSponsorMatch[1]);
      _audit(reqId, 'UPDATE_SPONSOR', 'success', 'sponsor', adminSponsorMatch[1]);
      return response;
    }
    if (method === 'DELETE') {
      const response = await handleAdminDeleteSponsor(request, env, adminSponsorMatch[1]);
      _audit(reqId, 'DELETE_SPONSOR', 'success', 'sponsor', adminSponsorMatch[1]);
      return response;
    }
  }

  // ── Admin poster deployment routes (auth-gated) ────────────────────────────

  // POST/GET /api/v2/admin/events/:id/poster-deployments
  const adminPosterListMatch = pathname.match(
    /^\/api\/v2\/admin\/events\/([^/]+)\/poster-deployments$/
  );
  if (adminPosterListMatch) {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) return deny;
    if (method === 'POST')
      return handleAdminCreatePosterDeployment(request, env, adminPosterListMatch[1]);
    if (method === 'GET')
      return handleAdminListPosterDeployments(request, env, adminPosterListMatch[1]);
  }

  // POST /api/v2/admin/poster-deployments/backfill-h3 (must match before /:id)
  if (pathname === '/api/v2/admin/poster-deployments/backfill-h3' && method === 'POST') {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) return deny;
    return handleBackfillPosterH3(request, env);
  }

  // GET/PUT/DELETE /api/v2/admin/poster-deployments/:id
  const adminPosterDeploymentMatch = pathname.match(
    /^\/api\/v2\/admin\/poster-deployments\/([^/]+)$/
  );
  if (adminPosterDeploymentMatch) {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) return deny;
    if (method === 'GET')
      return handleAdminGetPosterDeployment(request, env, adminPosterDeploymentMatch[1]);
    if (method === 'PUT')
      return handleAdminUpdatePosterDeployment(request, env, adminPosterDeploymentMatch[1]);
    if (method === 'DELETE')
      return handleAdminDeletePosterDeployment(request, env, adminPosterDeploymentMatch[1]);
  }

  // ── Admin form export (auth-gated) ─────────────────────────────────────────
  const adminExportMatch = pathname.match(/^\/api\/v2\/admin\/events\/([^/]+)\/forms\/export$/);
  if (adminExportMatch && method === 'GET') {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) {
      _audit(reqId, 'EXPORT_FORMS', 'denied', 'forms-export', adminExportMatch[1]);
      return deny;
    }
    const res = await handleAdminExport(request, env, adminExportMatch[1]);
    const exportOutcome = res.status < 400 ? 'success' : 'failed';
    _audit(
      reqId,
      'EXPORT_FORMS',
      exportOutcome === 'success' ? 'success' : 'denied',
      'forms-export',
      adminExportMatch[1]
    );
    // OSE-594: log OER emission manifest for forms CSV export (invariant #17)
    ctx.waitUntil(
      logExportManifest(env, {
        export_type: 'UPLOAD_FILE',
        event_id: adminExportMatch[1],
        actor: extractAdminActor(request, env),
        request_id: reqId,
        outcome: exportOutcome,
      })
    );
    return res;
  }

  // ── Admin form endpoints (auth-gated) ──────────────────────────────────────
  const adminFormsMatch = pathname.match(
    /^\/api\/v2\/admin\/events\/([^/]+)\/forms\/(registrations|checkin-count|surveys|email-signups)$/
  );
  if (adminFormsMatch && method === 'GET') {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) {
      _audit(reqId, 'READ_FORMS_DATA', 'denied', 'forms', adminFormsMatch[1]);
      return deny;
    }
    const [, eventId, formType] = adminFormsMatch;
    const formsActionMap: Record<string, string> = {
      registrations: 'READ_REGISTRATIONS',
      'checkin-count': 'READ_CHECKIN_COUNT',
      surveys: 'READ_SURVEYS',
      'email-signups': 'READ_EMAIL_SIGNUPS',
    };
    let formsRes: Response | undefined;
    switch (formType) {
      case 'registrations':
        formsRes = await handleAdminRegistrations(request, env, eventId);
        break;
      case 'checkin-count':
        formsRes = await handleAdminCheckinCount(request, env, eventId);
        break;
      case 'surveys':
        formsRes = await handleAdminSurveys(request, env, eventId);
        break;
      case 'email-signups':
        formsRes = await handleAdminEmailSignupCount(request, env, eventId);
        break;
    }
    if (formsRes) {
      _audit(
        reqId,
        formsActionMap[formType] ?? 'READ_FORMS_DATA',
        formsRes.status < 400 ? 'success' : 'denied',
        'forms',
        eventId
      );
      return formsRes;
    }
  }

  // ── Feature Flag Admin routes (auth-gated) ─────────────────────────────────

  // Event-level flag overrides: PUT/DELETE /api/v2/admin/events/:id/flags/:key
  const eventFlagMatch = pathname.match(/^\/api\/v2\/admin\/events\/([^/]+)\/flags\/([^/]+)$/);
  if (eventFlagMatch && (method === 'PUT' || method === 'DELETE')) {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    const [, eventId, flagKey] = eventFlagMatch;
    if (deny) {
      _audit(
        reqId,
        method === 'PUT' ? 'SET_EVENT_FLAG' : 'REMOVE_EVENT_FLAG',
        'denied',
        'flag',
        `${eventId}/${flagKey}`
      );
      return deny;
    }
    if (method === 'PUT') {
      const response = await handleSetEventFlag(request, env, eventId, flagKey);
      _audit(reqId, 'SET_EVENT_FLAG', 'success', 'flag', `${eventId}/${flagKey}`);
      return response;
    }
    const response = await handleRemoveEventFlag(env, eventId, flagKey);
    _audit(reqId, 'REMOVE_EVENT_FLAG', 'success', 'flag', `${eventId}/${flagKey}`);
    return response;
  }

  if (pathname === '/api/v2/admin/flags' && method === 'GET') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleListFlags(request, env);
  }

  if (pathname === '/api/v2/admin/flags/tiers' && method === 'GET') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleListTiers();
  }

  if (pathname === '/api/v2/admin/flags/current-tier' && method === 'GET') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleGetCurrentTier(env);
  }

  if (pathname === '/api/v2/admin/flags/resolve' && method === 'GET') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleResolveFlags(request, env);
  }

  // PUT /api/v2/admin/flags/:key — toggle a global flag
  const flagKeyMatch = pathname.match(/^\/api\/v2\/admin\/flags\/([^/]+)$/);
  if (flagKeyMatch && method === 'PUT') {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) {
      _audit(reqId, 'SET_FLAG', 'denied', 'flag', flagKeyMatch[1]);
      return deny;
    }
    const response = await handleSetFlag(request, env, flagKeyMatch[1]);
    _audit(reqId, 'SET_FLAG', 'success', 'flag', flagKeyMatch[1]);
    return response;
  }

  if (pathname === '/api/v2/admin/flags/apply-tier' && method === 'POST') {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) {
      _audit(reqId, 'APPLY_TIER', 'denied', 'flag');
      return deny;
    }
    const response = await handleApplyTier(request, env);
    _audit(reqId, 'APPLY_TIER', 'success', 'flag');
    return response;
  }

  // POST /api/v2/admin/data-subject/erase — GDPR Art. 17 / CCPA erasure (OSE-203)
  if (pathname === '/api/v2/admin/data-subject/erase' && method === 'POST') {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) {
      _audit(reqId, 'DATA_SUBJECT_ERASE', 'denied', 'data-subject');
      return deny;
    }
    const response = await handleDataSubjectErase(request, env);
    _audit(
      reqId,
      'DATA_SUBJECT_ERASE',
      response.status < 400 ? 'success' : 'denied',
      'data-subject'
    );
    return response;
  }

  // ── Admin audit log (OSE-212) ──────────────────────────────────────────────
  if (pathname === '/api/v2/admin/audit-log' && method === 'GET') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleListAuditLog(request, env);
  }

  // ── Security: rate-limit visibility (OSE-SEC-1) ────────────────────────────
  // GET /api/v2/admin/security/rate-limit-stats
  // Returns top-10 rate-limited IPs in the last hour from RATE_LIMIT_KV.
  // Requires admin auth. Read-only — never modifies KV state.
  if (pathname === '/api/v2/admin/security/rate-limit-stats' && method === 'GET') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleRateLimitStats(request, env);
  }

  // ── Admin subscribers list (OSE-207) ──────────────────────────────────────
  // PII surface: emails are returned to admins. Each access is audited via
  // logAdminAction so reads of subscriber PII are traceable. Pagination
  // mirrors the audit-log endpoint (created_at-descending cursor).
  if (pathname === '/api/v2/admin/subscribers' && method === 'GET') {
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const deny = await requireAdmin(request, env, reqId);
    if (deny) return deny;
    return handleListSubscribers(request, env, ctx, reqId);
  }

  // ── Admin geocoding (OSE-238) ───────────────────────────────────────────────
  // Translates a human-readable address into { lat, lng, formatted_address }
  // via Google Geocoding API. corridor_id resolution is currently a stub
  // returning null (Option C); BE-24b will fill it in once the corridor
  // geometry source-of-truth lands.
  if (pathname === '/api/v2/admin/geocode' && method === 'POST') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
    return handleAdminGeocode(request, env);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  if (pathname === '/api/v2/events') {
    return handleListEvents(request, env);
  }

  // ── S-3.5.1: Admin mint endpoint ───────────────────────────────────────────
  // POST /api/v2/admin/events/:id/shared-report/mint-link
  // Admin-auth-gated. Generates a signed bearer token for a given role+depth.
  const mintLinkMatch = pathname.match(
    /^\/api\/v2\/admin\/events\/([^/]+)\/shared-report\/mint-link$/
  );
  if (mintLinkMatch && method === 'POST') {
    // OSE-576: rate limit mint by actor+eventId before paying auth cost
    if (env.RATE_LIMIT_KV) {
      const mintKey = `mint:${clientIp(request)}:${mintLinkMatch[1]}`;
      if (await checkRateLimit(mintKey, env.RATE_LIMIT_KV, RATE_LIMIT_MINT_MAX)) {
        return rateLimitResponse();
      }
    }
    const reqId = crypto.randomUUID?.() ?? `req-${Date.now()}`;
    const authRes = await requireAdmin(request, env, reqId);
    if (authRes) {
      _audit(reqId, 'MINT_REPORT_LINK', 'denied', 'shared-report', mintLinkMatch[1]);
      return authRes;
    }
    const res = await handleAdminMintSharedReportLink(request, env, mintLinkMatch[1]);
    _audit(
      reqId,
      'MINT_REPORT_LINK',
      res.status < 400 ? 'success' : 'denied',
      'shared-report',
      mintLinkMatch[1]
    );
    return res;
  }

  // ── OSE-272 Session 5: SharedReport read API ──────────────────────────────
  // POST /api/v2/events/shared-reports/batch
  // Service-token-authenticated batch endpoint. Placed BEFORE the
  // single-event matcher to avoid `shared-reports` being interpreted as
  // an event id.
  if (pathname === '/api/v2/events/shared-reports/batch' && method === 'POST') {
    // OSE-576: rate limit by service token identity (Authorization header hash)
    if (env.RATE_LIMIT_KV) {
      const tokenId = request.headers.get('Authorization')?.slice(-16) ?? clientIp(request);
      const batchKey = `batch:${tokenId}`;
      if (await checkRateLimit(batchKey, env.RATE_LIMIT_KV, RATE_LIMIT_BATCH_MAX)) {
        return rateLimitResponse();
      }
    }
    return handleBatchSharedReports(request, env, ctx);
  }

  // GET /api/v2/events/:id/shared-report
  // Signed-link-authenticated single-event SharedReport read.
  const sharedReportMatch = pathname.match(/^\/api\/v2\/events\/([^/]+)\/shared-report$/);
  if (sharedReportMatch && method === 'GET') {
    return handleGetSharedReport(request, env, sharedReportMatch[1], ctx);
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

  // POST /api/v2/sponsors/draft — onboarding draft capture (invite-token auth, OSE-732).
  // Public route: authorized by a signed sponsor invite token (NOT admin bearer);
  // brand scope comes from the token claim. Placed before the /:id/logo matcher so
  // the literal 'draft' segment is never mistaken for a sponsor id.
  if (pathname === '/api/v2/sponsors/draft' && method === 'POST') {
    return handleCreateSponsorDraft(request, env);
  }

  // POST /api/v2/sponsors/draft/:draftToken/asset/:format — per-format asset
  // upload for an onboarding draft (invite-token auth, R2 sponsors/ namespace, OSE-733).
  const draftAssetMatch = pathname.match(/^\/api\/v2\/sponsors\/draft\/([^/]+)\/asset\/([^/]+)$/);
  if (draftAssetMatch && method === 'POST') {
    return handleSponsorAssetUpload(request, env, draftAssetMatch[1], draftAssetMatch[2]);
  }

  // GET /api/v2/sponsors/:id/asset/:format — always-200 per-format asset serve
  // (R2 | logo proxy | UEC monogram), extends the OSE-288 pipeline (OSE-735).
  const assetMatch = pathname.match(/^\/api\/v2\/sponsors\/([^/]+)\/asset\/([^/]+)$/);
  if (assetMatch && method === 'GET') {
    return handleSponsorAsset(request, env, assetMatch[1], assetMatch[2]);
  }

  // GET /api/v2/sponsors/:id/logo — proxy external logo through worker (OSE-288).
  // Retained as a back-compat alias with its unchanged OSE-288 contract.
  const logoMatch = pathname.match(/^\/api\/v2\/sponsors\/([^/]+)\/logo$/);
  if (logoMatch && method === 'GET') {
    return handleSponsorLogo(request, env, logoMatch[1]);
  }

  // ── Google Maps venue image proxy (OSE-217) ────────────────────────────────
  // GET /api/v2/uploads/*key — serve R2 file (OSE-200)
  const uploadServeMatch = pathname.match(/^\/api\/v2\/uploads\/(.+)$/);
  if (uploadServeMatch && method === 'GET') {
    return handleGetUploadedFile(request, env, uploadServeMatch[1]);
  }

  // GET /api/v2/maps/venue-image?venue=<encoded>
  // Proxies Google Static Maps API server-side so the API key never reaches
  // the browser. Used by SharedReports to render venue map thumbnails.
  if (pathname === '/api/v2/maps/venue-image' && method === 'GET') {
    const venueParam = url.searchParams.get('venue') ?? '';
    return fetchStaticMapImage(env, venueParam);
  }

  // ── Public: self-delete a registration (OSE-659) ───────────────────────────
  // DELETE on the register path — the attendee removes their own opt-in PII
  // before TTL, authenticated only by the registered email's hash (#1 — no new
  // identity surface). Writes only to FORMS_DB.
  const selfDeleteMatch = pathname.match(/^\/api\/v2\/events\/([^/]+)\/forms\/register$/);
  if (selfDeleteMatch && method === 'DELETE') {
    if (await isRateLimited(clientIp(request), env.RATE_LIMIT_KV)) {
      return rateLimitResponse();
    }
    return handleSelfDeleteRegistration(request, env, selfDeleteMatch[1]);
  }

  // ── Public form endpoints (no auth) ────────────────────────────────────────
  const publicFormsMatch = pathname.match(
    /^\/api\/v2\/events\/([^/]+)\/forms\/(register|checkin|survey|email-signup)$/
  );
  if (publicFormsMatch && method === 'POST') {
    const [, eventId, formType] = publicFormsMatch;

    // Rate limit: 60 req/min per IP, persistent via CF KV (OSE-552).
    if (await isRateLimited(clientIp(request), env.RATE_LIMIT_KV)) {
      return rateLimitResponse();
    }

    // Event lifecycle guard: reject submissions for non-active events.
    // Only blocks if the event row explicitly exists with a non-active status;
    // unknown event IDs pass through for backward compat with un-seeded test fixtures.
    // Hoisted to outer scope so phase gate below can access legal_clearance_tier.
    let eventRow: { status: string; legal_clearance_tier: number | null } | null = null;
    if (env.DB) {
      eventRow = await env.DB.prepare(
        'SELECT status, legal_clearance_tier FROM events WHERE id = ?'
      )
        .bind(eventId)
        .first<{ status: string; legal_clearance_tier: number | null }>();
      if (eventRow) {
        const { allowed, reason } = assertRenderable(parseEventState(eventRow.status), 'public');
        if (!allowed) {
          return Response.json(
            {
              ok: false,
              status: 410,
              code: 'EVENT_NOT_ACTIVE',
              error: reason ?? 'This event is not accepting submissions',
            },
            { status: 410 }
          );
        }
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

    // Regulatory phase gate (OSE-73 / ADMIN-2):
    // Only fires when the event row exists in DB — unknown event IDs pass through
    // for backward compat with un-seeded test fixtures.
    // survey + email-signup require Phase 2 (personal data collection).
    const FORM_PHASE_REQUIREMENTS: Partial<Record<string, number>> = {
      survey: 2,
      'email-signup': 2,
    };
    const requiredPhase = FORM_PHASE_REQUIREMENTS[formType];
    if (requiredPhase && eventRow) {
      const actualPhase = eventRow.legal_clearance_tier ?? 1;
      if (actualPhase < requiredPhase) {
        return Response.json(
          {
            ok: false,
            status: 403,
            code: 'PHASE_REQUIRED',
            error: `This form requires regulatory clearance Phase ${requiredPhase}`,
          },
          { status: 403 }
        );
      }
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

  // ── Public event landing page (OSE-243a) ──────────────────────────────────
  // /events/:id renders the 5W content + venue map + anonymity affordance.
  // Recipients land here from /s/:code shortlinks (OSE-240). Phase-aware
  // dispatch: pre_event = full render, event/post_event = minimal stub.
  // MUST appear before the generic /events match below or the more-specific
  // path is shadowed.
  if (pathname.startsWith('/events/') && method === 'GET') {
    const eventId = pathname.slice('/events/'.length);
    // Reject sub-paths like /events/:id/whatever — those don't exist yet.
    if (eventId && !eventId.includes('/')) {
      return handlePublicEventPage(request, env, eventId);
    }
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
  // Same R-001 HTML-vs-JSON-aware auth pattern as /admin proper.
  if (pathname === '/manage' || pathname === '/dashboard' || pathname === '/create') {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) {
      const accept = request.headers.get('Accept') ?? '';
      if (method === 'GET' && accept.includes('text/html')) {
        return handleAdminSignInPage(env);
      }
      return deny;
    }
    return handleAdminPage(env);
  }

  // ── CEO Briefing (OSE-574 — SERVER-SIDE auth gate) ────────────────────────
  // The full confidential briefing (revenue model, IP portfolio, risk register,
  // OurWKRP entity, CEO handoff) is embedded directly in the served HTML, and
  // the embedded React PIN gate is a CLIENT-SIDE convenience only: both the PIN
  // and every section's content ship in the page payload, so an unauthenticated
  // GET could read the entire briefing straight from the HTML source. Prior code
  // served the page with no server check — a plain `curl /briefing` leaked it in
  // full. requireAdmin now runs BEFORE any HTML is produced: unauthenticated
  // requests receive the standard 401 JSON (or a CF Access 302 redirect when CF
  // Access fronts the route) and never see page content. The in-app PIN remains
  // as a secondary lock, not the sole gate.
  if (
    (pathname === '/briefing' || pathname === '/overview' || pathname === '/summary') &&
    method === 'GET'
  ) {
    const deny = await requireAdmin(request, env, crypto.randomUUID?.() ?? `req-${Date.now()}`);
    if (deny) return deny;
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
    // OSE-310: handler reads `request` to look up the format via
    // posterProductForPath() and attach data-poster-format to body.
    return handlePosterPage(env, request);
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

// ─── Rate-limit stats handler (OSE-SEC-1) ─────────────────────────────────────
//
// GET /api/v2/admin/security/rate-limit-stats
//
// Returns the top-10 rate-limited IPs from the last hour.
// "Rate-limited" means the KV entry has count > RATE_LIMIT_MAX (60).
//
// KV key format: ratelimit:{ip}
// KV value format: { count: number, resetAt: number }
//
// The resetAt field is a Unix ms timestamp. We only return entries whose
// resetAt is in the future (i.e. the window is still active) as a proxy
// for "this happened in the last minute", which is the actual rate-limit
// window. For a 1-hour view we return all active KV entries — expired keys
// have been deleted by KV TTL already.
//
// Response shape:
// {
//   ok: true,
//   generated_at: ISO string,
//   window: "1h (KV TTL)",
//   total_rate_limited_ips: number,
//   top_ips: [{ ip: string, count: number, reset_at: ISO string }]
// }

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

async function handleRateLimitStats(request: Request, env: RouterEnv): Promise<Response> {
  const corsOriginHeader = corsOrigin(request);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(corsOriginHeader ? { 'Access-Control-Allow-Origin': corsOriginHeader } : {}),
  };

  const now = Date.now();
  const ipEntries: Array<{ ip: string; count: number; resetAt: number }> = [];
  let totalRateLimited = 0;

  try {
    // Paginate through all ratelimit: keys
    let cursor: string | undefined;
    do {
      const listResult = await env.RATE_LIMIT_KV.list({
        prefix: 'ratelimit:',
        limit: 1000,
        cursor,
      });

      // Batch-fetch values in groups of 50
      const BATCH = 50;
      for (let i = 0; i < listResult.keys.length; i += BATCH) {
        const batch = listResult.keys.slice(i, i + BATCH);
        const values = await Promise.all(batch.map((k) => env.RATE_LIMIT_KV.get(k.name)));
        for (let j = 0; j < batch.length; j++) {
          const raw = values[j];
          if (!raw) continue;
          try {
            const entry = JSON.parse(raw) as RateLimitEntry;
            // Only include active (non-expired) windows
            if (entry.resetAt <= now) continue;
            // Only entries that have actually been rate-limited (count > max)
            if (entry.count <= 60) continue;
            const ip = batch[j].name.slice('ratelimit:'.length);
            ipEntries.push({ ip, count: entry.count, resetAt: entry.resetAt });
            totalRateLimited++;
          } catch {
            // malformed KV value — skip
          }
        }
      }

      cursor = listResult.list_complete
        ? undefined
        : (listResult as unknown as { cursor?: string }).cursor;
    } while (cursor);
  } catch (err) {
    return Response.json(
      {
        ok: false,
        status: 500,
        error: 'Failed to read rate-limit KV',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers }
    );
  }

  // Sort descending by count, take top 10
  ipEntries.sort((a, b) => b.count - a.count);
  const top10 = ipEntries.slice(0, 10).map((e) => ({
    ip: e.ip,
    count: e.count,
    reset_at: new Date(e.resetAt).toISOString(),
  }));

  return Response.json(
    {
      ok: true,
      generated_at: new Date(now).toISOString(),
      window: '1h (KV TTL)',
      rate_limit_max: 60,
      total_rate_limited_ips: totalRateLimited,
      top_ips: top10,
    },
    { status: 200, headers }
  );
}
