/**
 * Central Worker Router
 *
 * Unified Cloudflare Worker router that handles all request routing,
 * eliminating GAS doGet as the router. This is the new source of truth
 * for all request handling.
 *
 * Routes:
 * - /api/* - API endpoints (JSON responses)
 * - /health/origin - Upstream configuration health check (Story 2.3)
 * - /public, /events, /schedule, /calendar - Public page
 * - /admin, /manage, /dashboard, /create - Admin page
 * - /display, /tv, /kiosk, /screen - Display page
 * - /poster, /posters, /flyers - Poster page
 * - /report, /analytics, /reports, /insights - Report page
 * - /web/shared/apiClient.js - Shared API client module (Story 4.2)
 * - /web/shared/assetState.js - Asset state validation module (Story E1)
 * - Unknown routes - 404 JSON response
 *
 * @module router
 * @see Story 1.1 - Create Central Worker Router
 * @see Story 2.2 - Replace getPublicBundle Worker Implementation
 * @see Story 2.3 - Worker Upstream Config via Single Env Var
 * @see Story 4.1 - Move HTML Surfaces to Cloudflare
 * @see Story 4.2 - Shared API Client Module
 */

import { RouterLogger, createLogger } from './logger';
import { handleStatus, type StatusEnv } from './handlers/status';
import { handleListEvents } from './handlers/eventsList';
import { handleGetPublicBundle } from './handlers/publicBundle';
import { handleGetAdminBundle } from './handlers/adminBundle';
import { handleAdminCreateEvent } from './handlers/adminCreateEvent';
import { handleV2AdminCreateEvent } from './handlers/v2AdminCreateEvent';
import { handleV2AdminUpdateEvent } from './handlers/v2AdminUpdateEvent';
import { handleV2AdminArchiveEvent, handleV2AdminUnarchiveEvent } from './handlers/v2AdminArchiveEvent';
import { handleV2AdminDefaultEvent } from './handlers/v2AdminDefaultEvent';
import { handleV2AdminVerifyQr, handleV2AdminUnverifyQr } from './handlers/v2AdminVerifyQr';
import { handleV2AdminUploadFile, handleV2GetUploadedFile } from './handlers/v2AdminUploadFile';
import { handleGetDisplayBundle } from './handlers/displayBundle';
import { handleGetPosterBundle } from './handlers/posterBundle';
import { handleAdminRecordResult } from './handlers/adminRecordResult';
import { handleHealthOrigin } from './handlers/healthOrigin';
import {
  handleHealthBackend,
  createBackendHealthErrorResponse,
} from './handlers/healthBackend';
import { handleEventsV2 } from './handlers/eventsV2';
import {
  guardAdminRoute,
  guardV2AdminRoute,
  guardAdminOAuth,
  isOAuthAdminEnabled,
  guardPublicReadOnly,
  guardSignedMutation,
  isSignedMutationsConfigured,
  type AdminAuthEnv,
  type AdminKeyEnv,
  type AdminOAuthEnv,
  type PublicReadOnlyEnv,
  type SignedMutationsEnv,
} from './auth';
import {
  handleAuthLogin,
  handleAuthCallback,
  handleAuthLogout,
  type AuthRoutesEnv,
} from './handlers/authRoutes';
import {
  handleStaticAsset,
  type PageType as StaticPageType,
  type StaticAssetEnv,
} from './handlers/staticAssets';
import {
  handleSharedModule,
  type ModuleName,
  type SharedModulesEnv,
} from './handlers/sharedModules';
import {
  resolveBackendOrigin,
  createUpstreamNotConfiguredResponse,
  logUpstreamConfigError,
  type BackendEnv,
} from './resolveBackendOrigin';
import {
  handleSponsorPage,
  handleSponsorsPage,
} from './handlers/sponsorPage';
import {
  handleSponsorMonetization,
  handleEventMonetization,
  handleMonetizationInertCheck,
} from './handlers/monetizationHooks';
import { handleSharedReport } from './handlers/sharedReport';
import {
  logAdminAction,
  logDeniedAccess,
  createAuditContext,
  type AuditLoggerEnv,
} from './audit';

// =============================================================================
// Constants
// =============================================================================

/**
 * Router version - incremented with each significant change
 * 1.1.0 - Initial router (Story 1.1)
 * 1.2.0 - Wired up publicBundle and adminBundle handlers (Story 2.2)
 * 1.3.0 - Wired up events list handler for Admin migration (Story 2.3)
 * 1.4.0 - Added admin createEvent endpoint (Story 3.2)
 * 1.5.0 - Added admin recordResult endpoint (Story 3.3)
 * 1.6.0 - Static HTML serving from Worker (Story 4.1)
 * 1.7.0 - Shared API client module (Story 4.2)
 * 1.8.0 - Upstream config validation and /health/origin endpoint (Story 2.3)
 * 1.9.0 - Backend health endpoint /api/health/backend (Story B1)
 * 1.10.0 - Events V2 endpoint /api/v2/events (Story B5)
 * 1.11.0 - Admin create event V2 endpoint /api/v2/admin/events (Story C3)
 * 1.12.0 - Admin update event V2 endpoint PUT /api/v2/admin/events/:id (Story C4)
 * 1.13.0 - Admin archive/unarchive event V2 endpoints (Story D2)
 * 1.14.0 - Admin default event V2 endpoint POST /api/v2/admin/events/:id/default (Story D3)
 * 1.15.0 - Admin verify/unverify QR endpoints POST /api/v2/admin/events/:id/verify-qr (Story E2)
 * 1.16.0 - Public bundle returns 403 for non-ACTIVE events (Story E3)
 * 1.17.0 - Display/poster bundle handlers with asset state enforcement (Story E4)
 * 1.18.0 - Sponsor page gating endpoints (Story F3)
 * 1.19.0 - Monetization hooks endpoints (Story F4)
 * 1.20.0 - SharedAnalytics bundle endpoint (Story F6)
 * 1.21.0 - Admin OAuth with Google + Allowlist (SEC-IAC-03)
 * 1.22.0 - Public Read-Only Enforcement (SEC-IAC-04)
 * 1.23.0 - Signed Public Mutations (SEC-IAC-05)
 * 1.24.0 - Audit Logging (SEC-IAC-06)
 * 1.25.0 - Phone storage file upload via R2 (POST /api/v2/admin/events/:id/uploads)
 */
export const ROUTER_VERSION = '1.25.0';

/**
 * Valid brands for routing
 */
const VALID_BRANDS = ['root', 'abc', 'cbc', 'cbl'] as const;
type Brand = (typeof VALID_BRANDS)[number];

/**
 * HTML page types that the router can serve
 */
type PageType = 'public' | 'admin' | 'display' | 'poster' | 'report' | 'sponsor' | 'landing';

/**
 * Route aliases mapping paths to page types
 */
const HTML_ROUTE_MAP: Record<string, PageType> = {
  // Public page aliases
  '/public': 'public',
  '/events': 'public',
  '/schedule': 'public',
  '/calendar': 'public',

  // Admin page aliases
  '/admin': 'admin',
  '/manage': 'admin',
  '/dashboard': 'admin',
  '/create': 'admin',

  // Display page aliases
  '/display': 'display',
  '/tv': 'display',
  '/kiosk': 'display',
  '/screen': 'display',

  // Poster page aliases
  '/poster': 'poster',
  '/posters': 'poster',
  '/flyers': 'poster',

  // Report page aliases
  '/report': 'report',
  '/analytics': 'report',
  '/reports': 'report',
  '/insights': 'report',

  // Sponsor page aliases (Story F3)
  '/sponsor': 'sponsor',
  '/sponsors': 'sponsor',
  '/partnership': 'sponsor',

  // Landing page aliases
  '/home': 'landing',
  '/welcome': 'landing',
  '/landing': 'landing',
};

// =============================================================================
// Types
// =============================================================================

/**
 * Worker environment bindings
 */
export interface RouterEnv extends StatusEnv, AdminAuthEnv, AdminKeyEnv, StaticAssetEnv, SharedModulesEnv, AuthRoutesEnv, PublicReadOnlyEnv, SignedMutationsEnv, AuditLoggerEnv {
  /** Worker environment (staging, production) */
  WORKER_ENV?: string;
  /** Build version for tracking */
  WORKER_BUILD_VERSION?: string;
  /** Debug level (debug, info, warn, error) */
  DEBUG_LEVEL?: string;
  /** Google Sheets spreadsheet ID */
  SHEETS_SPREADSHEET_ID?: string;
  /** Google service account email */
  GOOGLE_CLIENT_EMAIL?: string;
  /** Google service account private key */
  GOOGLE_PRIVATE_KEY?: string;

  // OAuth Admin Authentication (SEC-IAC-03)
  /** Google OAuth 2.0 Client ID */
  GOOGLE_CLIENT_ID?: string;
  /** Google OAuth 2.0 Client Secret */
  GOOGLE_CLIENT_SECRET?: string;
  /** OAuth redirect URI */
  OAUTH_REDIRECT_URI?: string;
  /** Session signing secret */
  SESSION_SECRET?: string;
  /** Comma-separated list of allowed admin emails */
  ALLOWED_ADMIN_EMAILS?: string;
  /** Comma-separated list of allowed admin domains (optional) */
  ALLOWED_ADMIN_DOMAINS?: string;
  /** R2 bucket for file uploads */
  UPLOADS_BUCKET?: R2Bucket;
}

/**
 * Route match result
 */
interface RouteMatch {
  type: 'api' | 'health' | 'page' | 'module' | 'auth' | 'not_found';
  handler?: string;
  pageType?: PageType;
  moduleName?: ModuleName;
  brand?: Brand;
  eventId?: string;
  params?: Record<string, string>;
}

/**
 * Standard API error response
 */
interface ApiErrorResponse {
  ok: false;
  status: number;
  error: string;
  path?: string;
  timestamp: string;
}

// =============================================================================
// Route Matching
// =============================================================================

/**
 * Extract brand from path (e.g., /abc/events -> 'abc')
 */
function extractBrand(pathname: string): { brand: Brand; remainingPath: string } {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length > 0 && VALID_BRANDS.includes(segments[0] as Brand)) {
    return {
      brand: segments[0] as Brand,
      remainingPath: '/' + segments.slice(1).join('/'),
    };
  }

  return {
    brand: 'root',
    remainingPath: pathname,
  };
}

/**
 * Match a request URL to a route
 */
function matchRoute(url: URL): RouteMatch {
  const { brand, remainingPath } = extractBrand(url.pathname);

  // Normalize path (remove trailing slash, handle empty path)
  const normalizedPath = remainingPath === '' ? '/' : remainingPath.replace(/\/$/, '');

  // Check for auth routes (SEC-IAC-03)
  // /auth/login - Initiate OAuth flow
  if (normalizedPath === '/auth/login' || normalizedPath === '/auth/login/') {
    return { type: 'auth', handler: 'login', brand };
  }
  // /auth/callback - Handle OAuth callback
  if (normalizedPath === '/auth/callback' || normalizedPath === '/auth/callback/') {
    return { type: 'auth', handler: 'callback', brand };
  }
  // /auth/logout - Clear session
  if (normalizedPath === '/auth/logout' || normalizedPath === '/auth/logout/') {
    return { type: 'auth', handler: 'logout', brand };
  }

  // Check for health routes (Story 2.3)
  // /health/origin - Upstream configuration check
  if (normalizedPath === '/health/origin' || normalizedPath === '/health/origin/') {
    return { type: 'health', handler: 'origin', brand };
  }

  // Check for API routes
  if (normalizedPath.startsWith('/api/')) {
    const apiPath = normalizedPath.slice(4); // Remove '/api' prefix

    // /api/status - health check endpoint
    if (apiPath === '/status' || apiPath === '/status/') {
      return { type: 'api', handler: 'status', brand };
    }

    // /api/health/backend - backend auth health check (Story B1)
    if (apiPath === '/health/backend' || apiPath === '/health/backend/') {
      return { type: 'api', handler: 'healthBackend', brand };
    }

    // /api/v2/uploads/events/:eventId/:filename - serve uploaded files (public)
    const v2UploadedFileMatch = apiPath.match(/^\/v2\/uploads\/(events\/[^/]+\/.+)$/);
    if (v2UploadedFileMatch) {
      return { type: 'api', handler: 'v2GetUploadedFile', brand, params: { key: v2UploadedFileMatch[1] } };
    }

    // /api/v2/events - events list V2 using sheetsGetValues (Story B5)
    if (apiPath === '/v2/events' || apiPath === '/v2/events/') {
      return { type: 'api', handler: 'eventsV2', brand };
    }

    // /api/v2/sponsors - sponsors list (Story F3)
    if (apiPath === '/v2/sponsors' || apiPath === '/v2/sponsors/') {
      return { type: 'api', handler: 'sponsorsPage', brand };
    }

    // /api/v2/sponsor/:sponsorId - single sponsor with page status (Story F3)
    const sponsorPageMatch = apiPath.match(/^\/v2\/sponsor\/([^/]+)$/);
    if (sponsorPageMatch) {
      return { type: 'api', handler: 'sponsorPage', brand, params: { sponsorId: sponsorPageMatch[1] } };
    }

    // /api/v2/sponsor/:sponsorId/monetization - sponsor monetization hooks (Story F4)
    const sponsorMonetizationMatch = apiPath.match(/^\/v2\/sponsor\/([^/]+)\/monetization$/);
    if (sponsorMonetizationMatch) {
      return { type: 'api', handler: 'sponsorMonetization', brand, params: { sponsorId: sponsorMonetizationMatch[1] } };
    }

    // /api/v2/event/:eventId/monetization - event monetization hooks (Story F4)
    const eventMonetizationMatch = apiPath.match(/^\/v2\/event\/([^/]+)\/monetization$/);
    if (eventMonetizationMatch) {
      return { type: 'api', handler: 'eventMonetization', brand, params: { eventId: eventMonetizationMatch[1] } };
    }

    // /api/v2/monetization/inert - monetization inertness check (Story F4 CI/CD gate)
    if (apiPath === '/v2/monetization/inert' || apiPath === '/v2/monetization/inert/') {
      return { type: 'api', handler: 'monetizationInertCheck', brand };
    }

    // /api/v2/sharedreport - SharedAnalytics bundle (Story F6)
    if (apiPath === '/v2/sharedreport' || apiPath === '/v2/sharedreport/') {
      return { type: 'api', handler: 'sharedReport', brand };
    }

    // /api/events - events list (legacy)
    if (apiPath === '/events' || apiPath === '/events/') {
      return { type: 'api', handler: 'events', brand };
    }

    // /api/events/:id - single event
    const eventMatch = apiPath.match(/^\/events\/([^/]+)$/);
    if (eventMatch) {
      return { type: 'api', handler: 'event', brand, eventId: eventMatch[1] };
    }

    // /api/events/:id/publicBundle - public bundle
    const publicBundleMatch = apiPath.match(/^\/events\/([^/]+)\/publicBundle$/);
    if (publicBundleMatch) {
      return { type: 'api', handler: 'publicBundle', brand, eventId: publicBundleMatch[1] };
    }

    // /api/events/:id/adminBundle - admin bundle
    const adminBundleMatch = apiPath.match(/^\/events\/([^/]+)\/adminBundle$/);
    if (adminBundleMatch) {
      return { type: 'api', handler: 'adminBundle', brand, eventId: adminBundleMatch[1] };
    }

    // /api/events/:id/displayBundle - display bundle
    const displayBundleMatch = apiPath.match(/^\/events\/([^/]+)\/displayBundle$/);
    if (displayBundleMatch) {
      return { type: 'api', handler: 'displayBundle', brand, eventId: displayBundleMatch[1] };
    }

    // /api/events/:id/posterBundle - poster bundle
    const posterBundleMatch = apiPath.match(/^\/events\/([^/]+)\/posterBundle$/);
    if (posterBundleMatch) {
      return { type: 'api', handler: 'posterBundle', brand, eventId: posterBundleMatch[1] };
    }

    // /api/v2/admin/events/:id/uploads - file upload from phone storage
    const v2AdminUploadFileMatch = apiPath.match(/^\/v2\/admin\/events\/([^/]+)\/uploads$/);
    if (v2AdminUploadFileMatch) {
      return { type: 'api', handler: 'v2AdminUploadFile', brand, eventId: v2AdminUploadFileMatch[1] };
    }

    // /api/v2/admin/events/:id/default - set default event (Story D3)
    const v2AdminDefaultEventMatch = apiPath.match(/^\/v2\/admin\/events\/([^/]+)\/default$/);
    if (v2AdminDefaultEventMatch) {
      return { type: 'api', handler: 'v2AdminDefaultEvent', brand, eventId: v2AdminDefaultEventMatch[1] };
    }

    // /api/v2/admin/events/:id/verify-qr - verify QR codes (Story E2)
    const v2AdminVerifyQrMatch = apiPath.match(/^\/v2\/admin\/events\/([^/]+)\/verify-qr$/);
    if (v2AdminVerifyQrMatch) {
      return { type: 'api', handler: 'v2AdminVerifyQr', brand, eventId: v2AdminVerifyQrMatch[1] };
    }

    // /api/v2/admin/events/:id/unverify-qr - remove QR verification (Story E2)
    const v2AdminUnverifyQrMatch = apiPath.match(/^\/v2\/admin\/events\/([^/]+)\/unverify-qr$/);
    if (v2AdminUnverifyQrMatch) {
      return { type: 'api', handler: 'v2AdminUnverifyQr', brand, eventId: v2AdminUnverifyQrMatch[1] };
    }

    // /api/v2/admin/events/:id/archive - archive event (Story D2)
    const v2AdminArchiveEventMatch = apiPath.match(/^\/v2\/admin\/events\/([^/]+)\/archive$/);
    if (v2AdminArchiveEventMatch) {
      return { type: 'api', handler: 'v2AdminArchiveEvent', brand, eventId: v2AdminArchiveEventMatch[1] };
    }

    // /api/v2/admin/events/:id/unarchive - unarchive event (Story D2)
    const v2AdminUnarchiveEventMatch = apiPath.match(/^\/v2\/admin\/events\/([^/]+)\/unarchive$/);
    if (v2AdminUnarchiveEventMatch) {
      return { type: 'api', handler: 'v2AdminUnarchiveEvent', brand, eventId: v2AdminUnarchiveEventMatch[1] };
    }

    // /api/v2/admin/events/:id - update event (Story C4)
    const v2AdminUpdateEventMatch = apiPath.match(/^\/v2\/admin\/events\/([^/]+)$/);
    if (v2AdminUpdateEventMatch) {
      return { type: 'api', handler: 'v2AdminUpdateEvent', brand, eventId: v2AdminUpdateEventMatch[1] };
    }

    // /api/v2/admin/events - create event (Story C3)
    if (apiPath === '/v2/admin/events' || apiPath === '/v2/admin/events/') {
      return { type: 'api', handler: 'v2AdminCreateEvent', brand };
    }

    // /api/admin/events - create event (Story 3.2)
    if (apiPath === '/admin/events' || apiPath === '/admin/events/') {
      return { type: 'api', handler: 'adminCreateEvent', brand };
    }

    // /api/admin/events/:id/results - record result (Story 3.3)
    const adminResultsMatch = apiPath.match(/^\/admin\/events\/([^/]+)\/results$/);
    if (adminResultsMatch) {
      return { type: 'api', handler: 'adminRecordResult', brand, eventId: adminResultsMatch[1] };
    }

    // Unknown API route - return 404
    return { type: 'not_found', brand };
  }

  // Check for HTML page routes
  const pageType = HTML_ROUTE_MAP[normalizedPath];
  if (pageType) {
    return { type: 'page', pageType, brand };
  }

  // Root path - serve landing page
  if (normalizedPath === '/') {
    return { type: 'page', pageType: 'landing', brand };
  }

  // Check for shared module routes (Story 4.2)
  // /web/shared/apiClient.js - Shared API client module
  if (normalizedPath === '/web/shared/apiClient.js') {
    return { type: 'module', moduleName: 'apiClient', brand };
  }

  // Story E1: Asset State module
  // /web/shared/assetState.js - Asset state validation module
  if (normalizedPath === '/web/shared/assetState.js') {
    return { type: 'module', moduleName: 'assetState', brand };
  }

  // Unknown route
  return { type: 'not_found', brand };
}

// =============================================================================
// Response Builders
// =============================================================================

/**
 * Create a standard 404 response
 */
function create404Response(path: string, logger: RouterLogger): Response {
  logger.notFound(path);

  const body: ApiErrorResponse = {
    ok: false,
    status: 404,
    error: 'Not Found',
    path,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Router-Version': ROUTER_VERSION,
      'X-Request-Id': logger.getRequestId(),
    },
  });
}

/**
 * Create a 500 error response
 */
function create500Response(error: Error, logger: RouterLogger): Response {
  logger.error('Internal server error', error);

  const body: ApiErrorResponse = {
    ok: false,
    status: 500,
    error: 'Internal Server Error',
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Router-Version': ROUTER_VERSION,
      'X-Request-Id': logger.getRequestId(),
    },
  });
}

/**
 * Create a 405 Method Not Allowed response
 */
function create405Response(method: string, path: string, logger: RouterLogger): Response {
  logger.warn(`Method not allowed: ${method} ${path}`);

  const body: ApiErrorResponse = {
    ok: false,
    status: 405,
    error: 'Method Not Allowed',
    path,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Allow': 'GET, POST, PUT, DELETE, OPTIONS',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Router-Version': ROUTER_VERSION,
      'X-Request-Id': logger.getRequestId(),
    },
  });
}

/**
 * Add standard response headers
 */
function addStandardHeaders(response: Response, logger: RouterLogger): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Router-Version', ROUTER_VERSION);
  headers.set('X-Request-Id', logger.getRequestId());

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Add CORS headers for API responses
 */
function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// =============================================================================
// API Handlers
// =============================================================================

/**
 * Handle /api/status endpoint
 */
async function handleApiStatus(
  _request: Request,
  env: RouterEnv,
  logger: RouterLogger
): Promise<Response> {
  const startTime = Date.now();

  try {
    const response = await handleStatus(env);
    const durationMs = Date.now() - startTime;

    logger.apiRequest('GET', '/api/status', response.status, durationMs);

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle /api/status', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle events list request
 * @see Story 1.3 - Port api_status + Simple Read-Only api_listEvents
 * @see Story 2.3 - Admin UI reads events from Worker
 */
async function handleApiEvents(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  brand: Brand
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Add brand to URL if not already present
    const url = new URL(request.url);
    if (!url.searchParams.has('brand')) {
      url.searchParams.set('brand', brand);
    }

    // Create modified request with brand param
    const modifiedRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
    });

    const response = await handleListEvents(modifiedRequest, env);
    const durationMs = Date.now() - startTime;

    logger.apiRequest('GET', '/api/events', response.status, durationMs, { brand });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle events list', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle events list V2 request using sheetsGetValues
 * @see Story B5 - Implement /api/v2/events?brand=root (Read Path)
 */
async function handleApiEventsV2(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  brand: Brand
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Add brand to URL if not already present
    const url = new URL(request.url);
    if (!url.searchParams.has('brand')) {
      url.searchParams.set('brand', brand);
    }

    // Create modified request with brand param
    const modifiedRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
    });

    const response = await handleEventsV2(modifiedRequest, env, logger.getRequestId());
    const durationMs = Date.now() - startTime;

    logger.apiRequest('GET', '/api/v2/events', response.status, durationMs, { brand });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle events V2 list', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Placeholder for single event handler
 */
async function handleApiEvent(
  _request: Request,
  _env: RouterEnv,
  logger: RouterLogger,
  brand: Brand,
  eventId: string
): Promise<Response> {
  // TODO: Implement event fetch
  const body = {
    ok: true,
    status: 200,
    backend: 'worker',
    brand,
    eventId,
    event: null,
    message: 'Event endpoint placeholder',
    timestamp: new Date().toISOString(),
  };

  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  logger.apiRequest('GET', `/api/events/${eventId}`, 200, undefined, { brand, eventId });

  return addStandardHeaders(response, logger);
}

/**
 * Handle public bundle request
 * @see Story 2.1 - Worker getPublicBundle from Sheets
 */
async function handleApiPublicBundle(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  brand: Brand,
  eventId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Add brand to URL if not already present
    const url = new URL(request.url);
    if (!url.searchParams.has('brand')) {
      url.searchParams.set('brand', brand);
    }

    // Create modified request with brand param
    const modifiedRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
    });

    const response = await handleGetPublicBundle(modifiedRequest, env, eventId);
    const durationMs = Date.now() - startTime;

    logger.apiRequest('GET', `/api/events/${eventId}/publicBundle`, response.status, durationMs, {
      brand,
      eventId,
      bundleType: 'publicBundle',
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle publicBundle', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle admin bundle request
 * @see Story 2.2 - Worker getAdminBundle from Sheets
 */
async function handleApiAdminBundle(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  brand: Brand,
  eventId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Add brand to URL if not already present
    const url = new URL(request.url);
    if (!url.searchParams.has('brand')) {
      url.searchParams.set('brand', brand);
    }

    // Create modified request with brand param
    const modifiedRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
    });

    const response = await handleGetAdminBundle(modifiedRequest, env, eventId);
    const durationMs = Date.now() - startTime;

    logger.apiRequest('GET', `/api/events/${eventId}/adminBundle`, response.status, durationMs, {
      brand,
      eventId,
      bundleType: 'adminBundle',
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle adminBundle', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle display/poster bundle requests
 * Story E4: Display Safety + Rotation Guard
 * @see Story E4 - Display/poster bundles with asset state enforcement
 */
async function handleApiDisplayPosterBundle(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  brand: Brand,
  eventId: string,
  bundleType: string
): Promise<Response> {
  try {
    let response: Response;

    if (bundleType === 'displayBundle') {
      response = await handleGetDisplayBundle(request, env, eventId);
      logger.apiRequest('GET', `/api/events/${eventId}/displayBundle`, response.status, undefined, {
        brand,
        eventId,
      });
    } else if (bundleType === 'posterBundle') {
      response = await handleGetPosterBundle(request, env, eventId);
      logger.apiRequest('GET', `/api/events/${eventId}/posterBundle`, response.status, undefined, {
        brand,
        eventId,
      });
    } else {
      // Unknown bundle type
      const body = {
        ok: false,
        status: 400,
        code: 'BAD_REQUEST',
        message: `Unknown bundle type: ${bundleType}`,
      };
      response = new Response(JSON.stringify(body), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      logger.apiRequest('GET', `/api/events/${eventId}/${bundleType}`, 400, undefined, {
        brand,
        eventId,
        bundleType,
      });
    }

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error(`Failed to handle ${bundleType}`, error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle admin create event request
 * POST /api/admin/events
 * @see Story 3.2 - Port createEvent to Worker
 */
async function handleApiAdminCreateEvent(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  brand: Brand
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Add brand to URL if not already present (for handler to extract)
    const url = new URL(request.url);
    if (!url.searchParams.has('brand')) {
      url.searchParams.set('brand', brand);
    }

    // Create modified request with brand param
    const modifiedRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    const response = await handleAdminCreateEvent(modifiedRequest, env);
    const durationMs = Date.now() - startTime;

    logger.apiRequest(request.method, '/api/admin/events', response.status, durationMs, {
      brand,
      operation: 'createEvent',
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle admin createEvent', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle V2 admin create event request
 * POST /api/v2/admin/events
 * @see Story C3 - Admin Endpoint: Create Event
 */
async function handleApiV2AdminCreateEvent(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger
): Promise<Response> {
  const startTime = Date.now();

  try {
    const response = await handleV2AdminCreateEvent(request, env, logger.getRequestId());
    const durationMs = Date.now() - startTime;

    logger.apiRequest(request.method, '/api/v2/admin/events', response.status, durationMs, {
      operation: 'v2CreateEvent',
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle V2 admin createEvent', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle V2 admin update event request
 * PUT /api/v2/admin/events/:id
 * @see Story C4 - Admin Endpoint: Update Event (Minimal)
 */
async function handleApiV2AdminUpdateEvent(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  eventId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const response = await handleV2AdminUpdateEvent(request, env, logger.getRequestId(), eventId);
    const durationMs = Date.now() - startTime;

    logger.apiRequest(request.method, `/api/v2/admin/events/${eventId}`, response.status, durationMs, {
      operation: 'v2UpdateEvent',
      eventId,
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle V2 admin updateEvent', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle V2 admin archive event request
 * POST /api/v2/admin/events/:id/archive
 * @see Story D2 - Archive/Unarchive Event
 */
async function handleApiV2AdminArchiveEvent(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  eventId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const response = await handleV2AdminArchiveEvent(request, env, logger.getRequestId(), eventId);
    const durationMs = Date.now() - startTime;

    logger.apiRequest(request.method, `/api/v2/admin/events/${eventId}/archive`, response.status, durationMs, {
      operation: 'v2ArchiveEvent',
      eventId,
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle V2 admin archiveEvent', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle V2 admin unarchive event request
 * POST /api/v2/admin/events/:id/unarchive
 * @see Story D2 - Archive/Unarchive Event
 */
async function handleApiV2AdminUnarchiveEvent(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  eventId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const response = await handleV2AdminUnarchiveEvent(request, env, logger.getRequestId(), eventId);
    const durationMs = Date.now() - startTime;

    logger.apiRequest(request.method, `/api/v2/admin/events/${eventId}/unarchive`, response.status, durationMs, {
      operation: 'v2UnarchiveEvent',
      eventId,
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle V2 admin unarchiveEvent', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle V2 admin default event request
 * POST /api/v2/admin/events/:id/default
 * @see Story D3 - Default Event Enforcement
 */
async function handleApiV2AdminDefaultEvent(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  eventId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const response = await handleV2AdminDefaultEvent(request, env, logger.getRequestId(), eventId);
    const durationMs = Date.now() - startTime;

    logger.apiRequest(request.method, `/api/v2/admin/events/${eventId}/default`, response.status, durationMs, {
      operation: 'v2DefaultEvent',
      eventId,
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle V2 admin defaultEvent', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle V2 admin verify QR request
 * POST /api/v2/admin/events/:id/verify-qr
 * @see Story E2 - Verified-QR-Only Enforcement
 */
async function handleApiV2AdminVerifyQr(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  eventId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const response = await handleV2AdminVerifyQr(request, env, eventId);
    const durationMs = Date.now() - startTime;

    logger.apiRequest(request.method, `/api/v2/admin/events/${eventId}/verify-qr`, response.status, durationMs, {
      operation: 'v2VerifyQr',
      eventId,
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle V2 admin verifyQr', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle V2 admin unverify QR request
 * POST /api/v2/admin/events/:id/unverify-qr
 * @see Story E2 - Verified-QR-Only Enforcement
 */
async function handleApiV2AdminUnverifyQr(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  eventId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const response = await handleV2AdminUnverifyQr(request, env, eventId);
    const durationMs = Date.now() - startTime;

    logger.apiRequest(request.method, `/api/v2/admin/events/${eventId}/unverify-qr`, response.status, durationMs, {
      operation: 'v2UnverifyQr',
      eventId,
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle V2 admin unverifyQr', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle V2 admin upload file request
 * POST /api/v2/admin/events/:id/uploads
 */
async function handleApiV2AdminUploadFile(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  eventId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const response = await handleV2AdminUploadFile(request, env, logger.getRequestId(), eventId);
    const durationMs = Date.now() - startTime;

    logger.apiRequest(request.method, `/api/v2/admin/events/${eventId}/uploads`, response.status, durationMs, {
      operation: 'v2UploadFile',
      eventId,
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle V2 admin uploadFile', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle GET /api/v2/uploads/* - serve uploaded files
 */
async function handleApiV2GetUploadedFile(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  key: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const response = await handleV2GetUploadedFile(request, env, logger.getRequestId(), key);
    const durationMs = Date.now() - startTime;

    logger.apiRequest(request.method, `/api/v2/uploads/${key}`, response.status, durationMs, {
      operation: 'v2GetUploadedFile',
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle V2 getUploadedFile', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

/**
 * Handle admin record result request
 * POST /api/admin/events/:id/results
 * @see Story 3.3 - Port recordResult to Worker
 */
async function handleApiAdminRecordResult(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  brand: Brand,
  eventId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Add brand to URL if not already present (for handler to extract)
    const url = new URL(request.url);
    if (!url.searchParams.has('brand')) {
      url.searchParams.set('brand', brand);
    }

    // Create modified request with brand param
    const modifiedRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    const response = await handleAdminRecordResult(modifiedRequest, env);
    const durationMs = Date.now() - startTime;

    logger.apiRequest(request.method, `/api/admin/events/${eventId}/results`, response.status, durationMs, {
      brand,
      eventId,
      operation: 'recordResult',
    });

    return addStandardHeaders(response, logger);
  } catch (error) {
    logger.error('Failed to handle admin recordResult', error);
    return create500Response(error instanceof Error ? error : new Error(String(error)), logger);
  }
}

// =============================================================================
// Page Handlers
// =============================================================================

/**
 * Handle HTML page requests
 *
 * Serves static HTML templates from embedded Worker bundle.
 * All templates are served directly from Cloudflare - no GAS fetch required.
 *
 * @see Story 4.1 - Move HTML Surfaces to Cloudflare
 */
async function handlePage(
  request: Request,
  env: RouterEnv,
  logger: RouterLogger,
  pageType: PageType,
  brand: Brand
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Story 4.1: Serve HTML from Worker-embedded templates (no GAS)
    const response = await handleStaticAsset(request, env, pageType as StaticPageType);
    const durationMs = Date.now() - startTime;

    logger.routeResolved(`/${pageType}`, pageType, response.status, durationMs, { brand });

    // Add router headers to response
    const headers = new Headers(response.headers);
    headers.set('X-Router-Version', ROUTER_VERSION);
    headers.set('X-Request-Id', logger.getRequestId());

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    logger.error(`Failed to serve ${pageType} page`, error);

    // Return error page
    const errorBody = `<!DOCTYPE html>
<html>
<head>
  <title>Error - EventAngle</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    h1 { color: #dc2626; }
    .details { background: #f3f4f6; padding: 16px; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Page Load Error</h1>
  <p>Unable to load the ${pageType} page. Please try again.</p>
  <div class="details">
    <p><strong>Page:</strong> ${pageType}</p>
    <p><strong>Brand:</strong> ${brand}</p>
    <p><strong>Router:</strong> ${ROUTER_VERSION}</p>
  </div>
</body>
</html>`;

    return new Response(errorBody, {
      status: 500,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Router-Version': ROUTER_VERSION,
        'X-Request-Id': logger.getRequestId(),
        'X-Page-Type': pageType,
        'X-Brand': brand,
      },
    });
  }
}

// =============================================================================
// Main Router
// =============================================================================

/**
 * Handle OPTIONS preflight requests
 */
function handleOptions(request: Request, logger: RouterLogger): Response {
  const url = new URL(request.url);
  logger.debug(`CORS preflight: ${url.pathname}`);

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      'X-Router-Version': ROUTER_VERSION,
      'X-Request-Id': logger.getRequestId(),
    },
  });
}

/**
 * Main request handler - the central router entry point
 *
 * This function is the new source of truth for all request routing,
 * replacing GAS doGet as the router.
 */
export async function handleRequest(
  request: Request,
  env: RouterEnv
): Promise<Response> {
  // Create logger for this request
  const logger = createLogger(env);

  // Use CF-Ray header as request ID if available
  const cfRay = request.headers.get('cf-ray');
  if (cfRay) {
    logger.setRequestId(cfRay);
  }

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  logger.incomingRequest(method, url.toString());

  try {
    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return handleOptions(request, logger);
    }

    // SEC-IAC-04: Public Read-Only Enforcement
    // Block mutation methods (POST/PUT/DELETE/PATCH) on public routes without auth
    const publicReadOnlyResult = guardPublicReadOnly(request, env, logger.getRequestId());
    if (!publicReadOnlyResult.allowed) {
      // SEC-IAC-05: Check for signed mutation token as alternative authorization
      if (isSignedMutationsConfigured(env)) {
        const signedMutationResult = await guardSignedMutation(request, env, logger.getRequestId());
        if (!signedMutationResult.allowed) {
          logger.warn(`Signed mutation denied ${method} ${url.pathname}: ${signedMutationResult.reason}`);
          // SEC-IAC-06: Log denied access attempt
          const auditCtx = createAuditContext(request, logger.getRequestId());
          logDeniedAccess(env, auditCtx, `${method}:signed_mutation`, url.pathname, signedMutationResult.reason);
          return addCorsHeaders(signedMutationResult.errorResponse!);
        }
        // Signed mutation authorized - continue processing
        logger.debug(`Mutation authorized via signed token for action: ${signedMutationResult.payload?.action}`);
      } else {
        // No signed mutations configured - use SEC-IAC-04 behavior
        logger.warn(`Public read-only guard denied ${method} ${url.pathname}: ${publicReadOnlyResult.reason}`);
        // SEC-IAC-06: Log denied access attempt
        const auditCtx = createAuditContext(request, logger.getRequestId());
        logDeniedAccess(env, auditCtx, `${method}:public_read_only`, url.pathname, publicReadOnlyResult.reason);
        return addCorsHeaders(publicReadOnlyResult.errorResponse!);
      }
    }

    // Story C1: Check V2 admin authentication (ADMIN_KEY) for /api/v2/admin/* routes
    // Uses new error format with requestId
    const v2AuthError = guardV2AdminRoute(request, env, logger.getRequestId());
    if (v2AuthError) {
      logger.warn(`V2 Admin auth failed for ${url.pathname}`);
      // SEC-IAC-06: Log denied access attempt
      const auditCtx = createAuditContext(request, logger.getRequestId());
      logDeniedAccess(env, auditCtx, `${method}:v2_admin_auth`, url.pathname, 'ADMIN_KEY_INVALID');
      return addCorsHeaders(v2AuthError);
    }

    // Story 3.1: Check admin authentication for protected routes
    // This guards all admin endpoints (/api/admin/*, /api/events/:id/adminBundle, etc.)
    const authError = guardAdminRoute(request, env);
    if (authError) {
      logger.warn(`Admin auth failed for ${url.pathname}`);
      // SEC-IAC-06: Log denied access attempt
      const auditCtx = createAuditContext(request, logger.getRequestId());
      logDeniedAccess(env, auditCtx, `${method}:legacy_admin_auth`, url.pathname, 'ADMIN_TOKEN_INVALID');
      return addCorsHeaders(authError);
    }

    // Match the route
    const match = matchRoute(url);
    const startTime = Date.now();

    // Handle based on route type
    switch (match.type) {
      case 'api': {
        // API routes - return JSON
        let response: Response;

        // Story 2.3: Check upstream configuration for data endpoints
        // Skip validation for /api/status and /api/health/backend which report config status themselves
        if (match.handler !== 'status' && match.handler !== 'healthBackend') {
          const backendResult = resolveBackendOrigin(env);
          if (!backendResult.configured) {
            logUpstreamConfigError(backendResult, {
              endpoint: url.pathname,
              handler: match.handler,
            });
            // Return 500 with clear message per Story 2.3 AC
            return addCorsHeaders(createUpstreamNotConfiguredResponse(backendResult));
          }
        }

        switch (match.handler) {
          case 'status':
            response = await handleApiStatus(request, env, logger);
            break;

          case 'healthBackend':
            // Story B1: Backend auth health check - no upstream validation needed
            try {
              response = await handleHealthBackend(env, logger.getRequestId());
            } catch (error) {
              response = createBackendHealthErrorResponse(
                error instanceof Error ? error : new Error(String(error)),
                logger.getRequestId()
              );
            }
            break;

          case 'events':
            response = await handleApiEvents(request, env, logger, match.brand || 'root');
            break;

          case 'eventsV2':
            // Story B5: /api/v2/events using sheetsGetValues()
            response = await handleApiEventsV2(request, env, logger, match.brand || 'root');
            break;

          case 'v2GetUploadedFile':
            // Serve uploaded files from R2 (public, no auth)
            response = await handleApiV2GetUploadedFile(request, env, logger, match.params?.key || '');
            break;

          case 'sponsorsPage':
            // Story F3: /api/v2/sponsors - list all sponsors with page status
            response = await handleSponsorsPage(request, env, logger.getRequestId());
            logger.apiRequest('GET', '/api/v2/sponsors', response.status);
            break;

          case 'sponsorPage':
            // Story F3: /api/v2/sponsor/:sponsorId - single sponsor with page status
            response = await handleSponsorPage(
              request,
              env,
              logger.getRequestId(),
              match.params?.sponsorId || ''
            );
            logger.apiRequest('GET', `/api/v2/sponsor/${match.params?.sponsorId}`, response.status);
            break;

          case 'sponsorMonetization':
            // Story F4: /api/v2/sponsor/:sponsorId/monetization - sponsor monetization hooks
            response = await handleSponsorMonetization(
              request,
              env,
              logger.getRequestId(),
              match.params?.sponsorId || ''
            );
            logger.apiRequest('GET', `/api/v2/sponsor/${match.params?.sponsorId}/monetization`, response.status);
            break;

          case 'eventMonetization':
            // Story F4: /api/v2/event/:eventId/monetization - event monetization hooks
            response = await handleEventMonetization(
              request,
              env,
              logger.getRequestId(),
              match.params?.eventId || ''
            );
            logger.apiRequest('GET', `/api/v2/event/${match.params?.eventId}/monetization`, response.status);
            break;

          case 'monetizationInertCheck':
            // Story F4: /api/v2/monetization/inert - CI/CD gate to verify billing hooks are inert
            response = await handleMonetizationInertCheck(request, logger.getRequestId());
            logger.apiRequest('GET', '/api/v2/monetization/inert', response.status);
            break;

          case 'sharedReport':
            // Story F6: /api/v2/sharedreport?eventId=... - SharedAnalytics bundle
            response = await handleSharedReport(request, env, logger.getRequestId());
            logger.apiRequest('GET', '/api/v2/sharedreport', response.status);
            break;

          case 'event':
            response = await handleApiEvent(
              request,
              env,
              logger,
              match.brand || 'root',
              match.eventId!
            );
            break;

          case 'publicBundle':
            response = await handleApiPublicBundle(
              request,
              env,
              logger,
              match.brand || 'root',
              match.eventId!
            );
            break;

          case 'adminBundle':
            response = await handleApiAdminBundle(
              request,
              env,
              logger,
              match.brand || 'root',
              match.eventId!
            );
            break;

          case 'displayBundle':
          case 'posterBundle':
            response = await handleApiDisplayPosterBundle(
              request,
              env,
              logger,
              match.brand || 'root',
              match.eventId!,
              match.handler
            );
            break;

          case 'v2AdminCreateEvent':
            // Story C3: V2 admin create event (uses ADMIN_KEY auth)
            // New V2 handler with simplified validation (name only required)
            response = await handleApiV2AdminCreateEvent(
              request,
              env,
              logger
            );
            // SEC-IAC-06: Log admin action
            if (response.status >= 200 && response.status < 300) {
              const auditCtx = createAuditContext(request, logger.getRequestId());
              logAdminAction(env, auditCtx, 'v2_create_event', '/api/v2/admin/events');
            }
            break;

          case 'v2AdminUpdateEvent':
            // Story C4: V2 admin update event (uses ADMIN_KEY auth)
            // Partial update semantics: unset fields remain unchanged
            response = await handleApiV2AdminUpdateEvent(
              request,
              env,
              logger,
              match.eventId!
            );
            // SEC-IAC-06: Log admin action
            if (response.status >= 200 && response.status < 300) {
              const auditCtx = createAuditContext(request, logger.getRequestId());
              logAdminAction(env, auditCtx, 'v2_update_event', `/api/v2/admin/events/${match.eventId}`);
            }
            break;

          case 'v2AdminArchiveEvent':
            // Story D2: V2 admin archive event (uses ADMIN_KEY auth)
            // Sets status = 'archived', idempotent
            response = await handleApiV2AdminArchiveEvent(
              request,
              env,
              logger,
              match.eventId!
            );
            // SEC-IAC-06: Log admin action
            if (response.status >= 200 && response.status < 300) {
              const auditCtx = createAuditContext(request, logger.getRequestId());
              logAdminAction(env, auditCtx, 'v2_archive_event', `/api/v2/admin/events/${match.eventId}/archive`);
            }
            break;

          case 'v2AdminUnarchiveEvent':
            // Story D2: V2 admin unarchive event (uses ADMIN_KEY auth)
            // Sets status = 'active', idempotent
            response = await handleApiV2AdminUnarchiveEvent(
              request,
              env,
              logger,
              match.eventId!
            );
            // SEC-IAC-06: Log admin action
            if (response.status >= 200 && response.status < 300) {
              const auditCtx = createAuditContext(request, logger.getRequestId());
              logAdminAction(env, auditCtx, 'v2_unarchive_event', `/api/v2/admin/events/${match.eventId}/unarchive`);
            }
            break;

          case 'v2AdminDefaultEvent':
            // Story D3: V2 admin default event (uses ADMIN_KEY auth)
            // Sets isDefault = true, ensures exactly ONE default per brand
            response = await handleApiV2AdminDefaultEvent(
              request,
              env,
              logger,
              match.eventId!
            );
            // SEC-IAC-06: Log admin action
            if (response.status >= 200 && response.status < 300) {
              const auditCtx = createAuditContext(request, logger.getRequestId());
              logAdminAction(env, auditCtx, 'v2_set_default_event', `/api/v2/admin/events/${match.eventId}/default`);
            }
            break;

          case 'v2AdminVerifyQr':
            // Story E2: V2 admin verify QR (uses ADMIN_KEY auth)
            // Sets qrVerified = true, transitions to ACTIVE state
            response = await handleApiV2AdminVerifyQr(
              request,
              env,
              logger,
              match.eventId!
            );
            // SEC-IAC-06: Log admin action
            if (response.status >= 200 && response.status < 300) {
              const auditCtx = createAuditContext(request, logger.getRequestId());
              logAdminAction(env, auditCtx, 'v2_verify_qr', `/api/v2/admin/events/${match.eventId}/verify-qr`);
            }
            break;

          case 'v2AdminUnverifyQr':
            // Story E2: V2 admin unverify QR (uses ADMIN_KEY auth)
            // Sets qrVerified = false, transitions to READY state
            response = await handleApiV2AdminUnverifyQr(
              request,
              env,
              logger,
              match.eventId!
            );
            // SEC-IAC-06: Log admin action
            if (response.status >= 200 && response.status < 300) {
              const auditCtx = createAuditContext(request, logger.getRequestId());
              logAdminAction(env, auditCtx, 'v2_unverify_qr', `/api/v2/admin/events/${match.eventId}/unverify-qr`);
            }
            break;

          case 'v2AdminUploadFile':
            // Phone storage file upload to R2
            response = await handleApiV2AdminUploadFile(
              request,
              env,
              logger,
              match.eventId!
            );
            // SEC-IAC-06: Log admin action
            if (response.status >= 200 && response.status < 300) {
              const auditCtx = createAuditContext(request, logger.getRequestId());
              logAdminAction(env, auditCtx, 'v2_upload_file', `/api/v2/admin/events/${match.eventId}/uploads`);
            }
            break;

          case 'adminCreateEvent':
            response = await handleApiAdminCreateEvent(
              request,
              env,
              logger,
              match.brand || 'root'
            );
            // SEC-IAC-06: Log admin action
            if (response.status >= 200 && response.status < 300) {
              const auditCtx = createAuditContext(request, logger.getRequestId());
              logAdminAction(env, auditCtx, 'create_event', '/api/admin/events');
            }
            break;

          case 'adminRecordResult':
            response = await handleApiAdminRecordResult(
              request,
              env,
              logger,
              match.brand || 'root',
              match.eventId!
            );
            // SEC-IAC-06: Log admin action
            if (response.status >= 200 && response.status < 300) {
              const auditCtx = createAuditContext(request, logger.getRequestId());
              logAdminAction(env, auditCtx, 'record_result', `/api/admin/events/${match.eventId}/results`);
            }
            break;

          default:
            response = create404Response(url.pathname, logger);
        }

        return addCorsHeaders(response);
      }

      case 'health': {
        // Health check routes (Story 2.3)
        if (method !== 'GET' && method !== 'HEAD') {
          return addCorsHeaders(create405Response(method, url.pathname, logger));
        }

        const startTimeHealth = Date.now();
        let response: Response;

        switch (match.handler) {
          case 'origin':
            response = await handleHealthOrigin(env);
            break;
          default:
            response = create404Response(url.pathname, logger);
        }

        const durationMs = Date.now() - startTimeHealth;
        logger.apiRequest('GET', '/health/origin', response.status, durationMs);

        return addCorsHeaders(addStandardHeaders(response, logger));
      }

      case 'auth': {
        // OAuth authentication routes (SEC-IAC-03)
        const requestId = logger.getRequestId();

        switch (match.handler) {
          case 'login':
            // GET /auth/login - Initiate OAuth flow
            if (method !== 'GET') {
              return create405Response(method, url.pathname, logger);
            }
            return handleAuthLogin(request, env, requestId);

          case 'callback':
            // GET /auth/callback - Handle OAuth callback from Google
            if (method !== 'GET') {
              return create405Response(method, url.pathname, logger);
            }
            return handleAuthCallback(request, env, requestId);

          case 'logout':
            // POST /auth/logout - Clear session (also allow GET for convenience)
            if (method !== 'POST' && method !== 'GET') {
              return create405Response(method, url.pathname, logger);
            }
            return handleAuthLogout(request, env, requestId);

          default:
            return create404Response(url.pathname, logger);
        }
      }

      case 'page': {
        // HTML page routes
        if (method !== 'GET' && method !== 'HEAD') {
          return create405Response(method, url.pathname, logger);
        }

        // SEC-IAC-03: Guard admin page with OAuth when enabled
        if (match.pageType === 'admin' && isOAuthAdminEnabled(env)) {
          const oauthResult = await guardAdminOAuth(
            request,
            env as AdminOAuthEnv,
            logger.getRequestId()
          );
          if (!oauthResult.authorized) {
            logger.warn(`Admin OAuth guard failed for ${url.pathname}`);
            // SEC-IAC-06: Log denied access attempt
            const auditCtx = createAuditContext(request, logger.getRequestId(), oauthResult.email);
            logDeniedAccess(env, auditCtx, `${method}:oauth_admin`, url.pathname, oauthResult.reason || 'OAUTH_UNAUTHORIZED');
            return oauthResult.errorResponse!;
          }
          logger.debug(`Admin OAuth authorized: ${oauthResult.email}`);
        }

        return handlePage(request, env, logger, match.pageType!, match.brand || 'root');
      }

      case 'module': {
        // Shared JavaScript module routes (Story 4.2)
        if (method !== 'GET' && method !== 'HEAD') {
          return create405Response(method, url.pathname, logger);
        }

        const startTimeModule = Date.now();
        const response = await handleSharedModule(request, env, match.moduleName!);
        const durationMs = Date.now() - startTimeModule;

        logger.debug(`Served module: ${match.moduleName} (${durationMs}ms)`);

        return addStandardHeaders(response, logger);
      }

      case 'not_found':
      default: {
        return addCorsHeaders(create404Response(url.pathname, logger));
      }
    }
  } catch (error) {
    return addCorsHeaders(
      create500Response(error instanceof Error ? error : new Error(String(error)), logger)
    );
  }
}

// =============================================================================
// Worker Export
// =============================================================================

/**
 * Cloudflare Worker fetch handler
 *
 * This is the main entry point for the Worker.
 */
export default {
  async fetch(request: Request, env: RouterEnv, _ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },
};
