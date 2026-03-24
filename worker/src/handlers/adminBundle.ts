/**
 * Admin Bundle API Handler
 *
 * Worker-native endpoint to get admin bundle from Google Sheets.
 *
 * GET /api/events/:id/adminBundle
 *
 * Query parameters:
 * - brand (optional): Brand ID (default: 'root')
 * - ifNoneMatch (optional): ETag for conditional GET
 *
 * Headers:
 * - Authorization: Bearer <token> (required for admin endpoints)
 * - If-None-Match: ETag for 304 response
 *
 * Response:
 * - 200: Full admin bundle with event, brandConfig, templates, diagnostics
 * - 304: Not Modified (when ETag matches)
 * - 400: Bad input (invalid brand)
 * - 401: Unauthorized (missing/invalid auth)
 * - 404: Event not found
 * - 500: Internal error
 * - 503: Sheets not configured
 *
 * @module handlers/adminBundle
 * @see Story 2.2 - Worker getAdminBundle from Sheets
 */

import {
  getSheetValues,
  isConfigured,
  SheetsError,
  logSheetsClientError,
  type SheetsEnv,
} from '../sheetsClient';

import {
  isValidBrand,
  parseEventRow,
  buildAdminBundleValue,
  generateAdminBundleEtag,
  DEFAULT_BRAND,
  EVENT_COL,
  type PublicEvent,
  type AdminBundleValue,
  type AdminBundleResponse,
  type AdminBundleNotModifiedResponse,
} from '../mappers/adminBundleMapper';

// =============================================================================
// Constants
// =============================================================================

const EVENTS_SHEET = 'EVENTS';
const EVENTS_RANGE = 'A:G';

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for admin bundle handler
 */
export interface AdminBundleEnv extends SheetsEnv {
  WORKER_ENV?: string;
  ADMIN_TOKEN?: string;
}

/**
 * Success response (full bundle)
 */
export type { AdminBundleResponse };

/**
 * Success response (not modified)
 */
export type { AdminBundleNotModifiedResponse };

/**
 * Error response shape
 */
export interface AdminBundleErrorResponse {
  ok: false;
  status: number;
  code: string;
  message: string;
  corrId?: string;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate correlation ID for error tracking
 */
function generateCorrId(): string {
  return `adm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Find event by ID from rows
 */
function findEventById(
  rows: string[][],
  eventId: string,
  brandId: string
): PublicEvent | null {
  for (const row of rows) {
    if (row[EVENT_COL.BRAND_ID] !== brandId) continue;
    if (row[EVENT_COL.ID] !== eventId) continue;

    return parseEventRow(row);
  }
  return null;
}

/**
 * Find event by slug from rows
 */
function findEventBySlug(
  rows: string[][],
  slug: string,
  brandId: string
): PublicEvent | null {
  for (const row of rows) {
    if (row[EVENT_COL.BRAND_ID] !== brandId) continue;
    if (row[EVENT_COL.SLUG] !== slug) continue;

    return parseEventRow(row);
  }
  return null;
}

/**
 * Check authorization header or token
 *
 * Supports:
 * - Bearer token: Authorization: Bearer <token>
 * - Query param: ?adminKey=<token> (legacy support)
 *
 * @param request - Incoming request
 * @param env - Worker environment with ADMIN_TOKEN
 * @returns True if authorized, false otherwise
 */
function checkAuth(request: Request, env: AdminBundleEnv): boolean {
  // If no ADMIN_TOKEN configured, allow access (dev mode)
  if (!env.ADMIN_TOKEN) {
    return true;
  }

  // Check Authorization header
  const authHeader = request.headers.get('Authorization');
  if (authHeader) {
    const [type, token] = authHeader.split(' ');
    if (type === 'Bearer' && token === env.ADMIN_TOKEN) {
      return true;
    }
  }

  // Check query param (legacy support)
  const url = new URL(request.url);
  const adminKey = url.searchParams.get('adminKey');
  if (adminKey === env.ADMIN_TOKEN) {
    return true;
  }

  return false;
}

// =============================================================================
// Response Factories
// =============================================================================

/**
 * Create success response with full bundle
 */
function createSuccessResponse(
  bundle: AdminBundleResponse,
  cache?: string
): Response {
  return new Response(JSON.stringify(bundle), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ETag: bundle.etag,
      // Admin bundles use private, no-cache since they contain sensitive data
      'Cache-Control': cache || 'private, no-cache',
    },
  });
}

/**
 * Create 304 Not Modified response
 */
function createNotModifiedResponse(etag: string): Response {
  const body: AdminBundleNotModifiedResponse = {
    ok: true,
    notModified: true,
    etag,
  };

  return new Response(JSON.stringify(body), {
    status: 304,
    headers: {
      'Content-Type': 'application/json',
      ETag: etag,
    },
  });
}

/**
 * Create error response
 */
function createErrorResponse(
  code: string,
  message: string,
  status: number,
  corrId?: string
): Response {
  const body: AdminBundleErrorResponse = {
    ok: false,
    status,
    code,
    message,
    ...(corrId ? { corrId } : {}),
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle GET /api/events/:id/adminBundle
 *
 * Gets admin bundle for an event from Google Sheets.
 * Requires authentication via Bearer token or adminKey query param.
 *
 * Response format per Story 2.2 AC:
 * - Success: { ok: true, etag: string, value: { event, brandConfig, templates, diagnostics, allSponsors, lifecyclePhase } }
 * - Not Modified: { ok: true, notModified: true, etag: string }
 * - Event Not Found: { ok: false, status: 404, code: 'EVENT_NOT_FOUND', message: string }
 * - Unauthorized: { ok: false, status: 401, code: 'UNAUTHORIZED', message: string }
 * - Error: { ok: false, status: ..., code: ..., message: ..., corrId?: string }
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param eventId - Event ID or slug from URL path
 * @returns Response with admin bundle
 */
export async function handleGetAdminBundle(
  request: Request,
  env: AdminBundleEnv,
  eventId: string
): Promise<Response> {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;
  const ifNoneMatch = request.headers.get('If-None-Match') || url.searchParams.get('ifNoneMatch');

  // Check authentication
  if (!checkAuth(request, env)) {
    return createErrorResponse(
      'UNAUTHORIZED',
      'Missing or invalid authentication',
      401
    );
  }

  // Validate eventId
  if (!eventId || eventId.trim() === '') {
    return createErrorResponse(
      'EVENT_NOT_FOUND',
      'Missing event ID',
      404
    );
  }

  // Validate brand
  if (!isValidBrand(brandId)) {
    return createErrorResponse('BAD_INPUT', `Invalid brand: ${brandId}`, 400);
  }

  // Check if Sheets is configured
  if (!isConfigured(env)) {
    return createErrorResponse(
      'NOT_CONFIGURED',
      'Google Sheets API not configured',
      503
    );
  }

  try {
    // Read all events from sheet
    const rows = await getSheetValues(env, EVENTS_SHEET, EVENTS_RANGE);

    // Skip header row
    const dataRows = rows.slice(1);

    if (dataRows.length === 0) {
      return createErrorResponse(
        'EVENT_NOT_FOUND',
        `Event not found: ${eventId}`,
        404
      );
    }

    // Try to find event by ID first, then by slug
    let event = findEventById(dataRows, eventId, brandId);
    if (!event) {
      event = findEventBySlug(dataRows, eventId, brandId);
    }

    if (!event) {
      return createErrorResponse(
        'EVENT_NOT_FOUND',
        `Event not found: ${eventId}`,
        404
      );
    }

    // Build admin bundle value
    const value: AdminBundleValue = buildAdminBundleValue(event, brandId);

    // Generate ETag
    const etag = await generateAdminBundleEtag(value);

    // Check If-None-Match for 304 response
    if (ifNoneMatch && ifNoneMatch === etag) {
      return createNotModifiedResponse(etag);
    }

    // Build full response
    const bundle: AdminBundleResponse = {
      ok: true,
      etag,
      value,
    };

    return createSuccessResponse(bundle);
  } catch (error) {
    const corrId = generateCorrId();

    // Log detailed error
    if (error instanceof SheetsError) {
      logSheetsClientError(error, { corrId, endpoint: '/api/events/:id/adminBundle' });

      // For malformed sheet data, return 500 with correlation ID
      // Frontends should show "Cannot load events. Try again." toast
      return createErrorResponse(
        'INTERNAL',
        'Failed to load event data',
        500,
        corrId
      );
    } else {
      console.error(
        JSON.stringify({
          type: 'ADMIN_BUNDLE_ERROR',
          corrId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString(),
        })
      );
    }

    return createErrorResponse('INTERNAL', 'Failed to get admin bundle', 500, corrId);
  }
}

/**
 * Parse event ID from URL path
 *
 * Supports multiple path formats:
 * - /api/events/:id/adminBundle
 * - /api/events/:id/bundle/admin
 *
 * @param pathname - URL pathname
 * @returns Event ID or null
 */
export function parseAdminEventIdFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);

  // /api/events/:id/adminBundle
  // segments: ['api', 'events', ':id', 'adminBundle']
  if (segments.length >= 4 && segments[0] === 'api' && segments[1] === 'events') {
    if (segments[3] === 'adminBundle') {
      return segments[2];
    }
    // /api/events/:id/bundle/admin
    if (segments.length >= 5 && segments[3] === 'bundle' && segments[4] === 'admin') {
      return segments[2];
    }
  }

  return null;
}
