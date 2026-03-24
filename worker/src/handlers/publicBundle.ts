/**
 * Public Bundle API Handler
 *
 * Worker-native endpoint to get public bundle from Google Sheets.
 *
 * GET /api/events/:id/publicBundle
 *
 * Query parameters:
 * - brand (optional): Brand ID (default: 'root')
 * - ifNoneMatch (optional): ETag for conditional GET
 *
 * @module handlers/publicBundle
 * @see Story 2.1 - Worker getPublicBundle from Sheets
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
  getBrandConfigForApi,
  parseEventRow,
  buildPublicBundleValue,
  generateContentEtag,
  DEFAULT_BRAND,
  EVENT_COL,
  type PublicEvent,
  type PublicBundleValue,
  type PublicBundleResponse,
  type PublicBundleNotModifiedResponse,
} from '../mappers/publicBundleMapper';

import {
  assertRenderable,
  type AssetState,
} from '../domain/assetState';

// =============================================================================
// Constants
// =============================================================================

const EVENTS_SHEET = 'EVENTS';
/**
 * Story E3: Extended range to include asset state column (J)
 * Columns: ID, BRAND_ID, TEMPLATE_ID, DATA_JSON, CREATED_AT, SLUG, UPDATED_AT, STATUS, IS_DEFAULT, ASSET_STATE
 */
const EVENTS_RANGE = 'A:J';

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for public bundle handler
 */
export interface PublicBundleEnv extends SheetsEnv {
  WORKER_ENV?: string;
}

/**
 * Success response (full bundle)
 */
export type { PublicBundleResponse };

/**
 * Success response (not modified)
 */
export type { PublicBundleNotModifiedResponse };

/**
 * Error response shape
 */
export interface PublicBundleErrorResponse {
  ok: false;
  status: number;
  code: string;
  message: string;
  corrId?: string;
  /** Asset state when error is ASSET_NOT_RENDERABLE (Story E3) */
  assetState?: AssetState;
  /** Human-readable state info (Story E3) */
  assetStateInfo?: {
    state: AssetState;
    isRenderable: boolean;
    label: string;
  };
}

/**
 * Story E3: Error codes for public bundle endpoint
 */
export const PUBLIC_BUNDLE_ERROR_CODES = {
  /** Event not found in sheet */
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  /** Event exists but not renderable on public surface */
  ASSET_NOT_RENDERABLE: 'ASSET_NOT_RENDERABLE',
  /** Invalid brand ID */
  BAD_INPUT: 'BAD_INPUT',
  /** Google Sheets not configured */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  /** Internal server error */
  INTERNAL: 'INTERNAL',
} as const;

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate correlation ID for error tracking
 */
function generateCorrId(): string {
  return `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

// =============================================================================
// Response Factories
// =============================================================================

/**
 * Create success response with full bundle
 */
function createSuccessResponse(
  bundle: PublicBundleResponse,
  cache?: string
): Response {
  return new Response(JSON.stringify(bundle), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ETag: bundle.etag,
      'Cache-Control': cache || 'private, max-age=60, stale-while-revalidate=300',
    },
  });
}

/**
 * Create 304 Not Modified response
 */
function createNotModifiedResponse(etag: string): Response {
  const body: PublicBundleNotModifiedResponse = {
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
  const body: PublicBundleErrorResponse = {
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

/**
 * Story E3: Create error response for non-renderable assets
 *
 * Returns a 403 Forbidden response with asset state information.
 * Frontends should use this to show an appropriate blocked state.
 */
function createAssetStateErrorResponse(
  assetState: AssetState,
  reason: string
): Response {
  const labels: Record<AssetState, string> = {
    DRAFT: 'Draft',
    READY: 'Ready for Verification',
    ACTIVE: 'Active',
    ARCHIVED: 'Archived',
  };

  const body: PublicBundleErrorResponse = {
    ok: false,
    status: 403,
    code: PUBLIC_BUNDLE_ERROR_CODES.ASSET_NOT_RENDERABLE,
    message: reason,
    assetState,
    assetStateInfo: {
      state: assetState,
      isRenderable: false,
      label: labels[assetState] || 'Unknown',
    },
  };

  return new Response(JSON.stringify(body), {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      // Story E3: Add cache header to prevent hammering backend
      'Cache-Control': 'private, max-age=10',
    },
  });
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle GET /api/events/:id/publicBundle
 *
 * Gets public bundle for an event from Google Sheets.
 *
 * Response format per Story 2.1 AC:
 * - Success: { ok: true, etag: string, value: { event, config, lifecyclePhase } }
 * - Not Modified: { ok: true, notModified: true, etag: string }
 * - Event Not Found: { ok: false, status: 404, code: 'EVENT_NOT_FOUND', message: string }
 * - Error: { ok: false, status: ..., code: ..., message: ..., corrId?: string }
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param eventId - Event ID or slug from URL path
 * @returns Response with public bundle
 */
export async function handleGetPublicBundle(
  request: Request,
  env: PublicBundleEnv,
  eventId: string
): Promise<Response> {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;
  const ifNoneMatch = request.headers.get('If-None-Match') || url.searchParams.get('ifNoneMatch');

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

    // Build bundle value
    const value: PublicBundleValue = buildPublicBundleValue(event, brandId);

    // Story E3: Check if event is renderable on public surface
    // INVARIANT: Only ACTIVE events can be rendered on public surfaces
    const renderCheck = assertRenderable(value.assetState, 'public');
    if (!renderCheck.allowed) {
      console.log(
        JSON.stringify({
          type: 'ASSET_NOT_RENDERABLE',
          eventId,
          brandId,
          assetState: value.assetState,
          reason: renderCheck.reason,
          timestamp: new Date().toISOString(),
        })
      );
      return createAssetStateErrorResponse(
        value.assetState,
        renderCheck.reason || 'Event is not available for public display'
      );
    }

    // Generate ETag
    const etag = await generateContentEtag(value);

    // Check If-None-Match for 304 response
    if (ifNoneMatch && ifNoneMatch === etag) {
      return createNotModifiedResponse(etag);
    }

    // Build full response
    const bundle: PublicBundleResponse = {
      ok: true,
      etag,
      value,
    };

    return createSuccessResponse(bundle);
  } catch (error) {
    const corrId = generateCorrId();

    // Log detailed error
    if (error instanceof SheetsError) {
      logSheetsClientError(error, { corrId, endpoint: '/api/events/:id/publicBundle' });

      // For malformed sheet data, return 500 with correlation ID
      // Frontends should show "Temporarily unavailable" state
      return createErrorResponse(
        'INTERNAL',
        'Failed to load event data',
        500,
        corrId
      );
    } else {
      console.error(
        JSON.stringify({
          type: 'PUBLIC_BUNDLE_ERROR',
          corrId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString(),
        })
      );
    }

    return createErrorResponse('INTERNAL', 'Failed to get public bundle', 500, corrId);
  }
}

/**
 * Parse event ID from URL path
 *
 * Supports multiple path formats:
 * - /api/events/:id/publicBundle
 * - /api/events/:id/bundle/public
 *
 * @param pathname - URL pathname
 * @returns Event ID or null
 */
export function parseEventIdFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);

  // /api/events/:id/publicBundle
  // segments: ['api', 'events', ':id', 'publicBundle']
  if (segments.length >= 4 && segments[0] === 'api' && segments[1] === 'events') {
    if (segments[3] === 'publicBundle') {
      return segments[2];
    }
    // /api/events/:id/bundle/public
    if (segments.length >= 5 && segments[3] === 'bundle' && segments[4] === 'public') {
      return segments[2];
    }
  }

  return null;
}
