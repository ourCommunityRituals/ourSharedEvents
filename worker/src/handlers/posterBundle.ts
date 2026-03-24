/**
 * Poster Bundle API Handler
 *
 * Worker-native endpoint for poster/flyer surfaces.
 *
 * GET /api/events/:id/posterBundle
 *
 * Story E4: Display Safety + Rotation Guard
 * - Only ACTIVE events can be rendered on poster surfaces
 * - Returns 403 with asset state info for non-ACTIVE events
 *
 * @module handlers/posterBundle
 * @see Story E4 - Display Safety + Rotation Guard
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
  buildPublicBundleValue,
  generateContentEtag,
  DEFAULT_BRAND,
  EVENT_COL,
  type PublicEvent,
  type PublicBundleValue,
} from '../mappers/publicBundleMapper';

import {
  assertRenderable,
  type AssetState,
} from '../domain/assetState';

// =============================================================================
// Constants
// =============================================================================

const EVENTS_SHEET = 'EVENTS';
const EVENTS_RANGE = 'A:J'; // Extended range for asset state

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for poster bundle handler
 */
export interface PosterBundleEnv extends SheetsEnv {
  WORKER_ENV?: string;
}

/**
 * Poster layout configuration
 */
export interface PosterLayoutConfig {
  /** Poster orientation */
  orientation: 'portrait' | 'landscape';
  /** Show QR code on poster */
  showQR: boolean;
  /** Show sponsor strip */
  showSponsors: boolean;
  /** Show schedule */
  showSchedule: boolean;
}

/**
 * Poster bundle value shape
 */
export interface PosterBundleValue extends PublicBundleValue {
  /** Poster layout configuration */
  posterLayout: PosterLayoutConfig;
  /** Surface type for this bundle */
  surface: 'poster';
}

/**
 * Success response
 */
export interface PosterBundleResponse {
  ok: true;
  etag: string;
  value: PosterBundleValue;
}

/**
 * 304 Not Modified response
 */
export interface PosterBundleNotModifiedResponse {
  ok: true;
  notModified: true;
  etag: string;
}

/**
 * Error response shape
 */
export interface PosterBundleErrorResponse {
  ok: false;
  status: number;
  code: string;
  message: string;
  corrId?: string;
  assetState?: AssetState;
  assetStateInfo?: {
    state: AssetState;
    isRenderable: boolean;
    label: string;
  };
}

/**
 * Story E4: Error codes for poster bundle endpoint
 */
export const POSTER_BUNDLE_ERROR_CODES = {
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  ASSET_NOT_RENDERABLE: 'ASSET_NOT_RENDERABLE',
  BAD_INPUT: 'BAD_INPUT',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  INTERNAL: 'INTERNAL',
} as const;

// =============================================================================
// Default Poster Configuration
// =============================================================================

const DEFAULT_POSTER_LAYOUT: PosterLayoutConfig = {
  orientation: 'portrait',
  showQR: true,
  showSponsors: true,
  showSchedule: false,
};

// =============================================================================
// Utilities
// =============================================================================

function generateCorrId(): string {
  return `pst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
 * Build poster layout configuration from event settings
 */
function buildPosterLayout(event: PublicEvent): PosterLayoutConfig {
  const settings = (event as unknown as Record<string, unknown>).settings as Record<string, unknown> | undefined;
  const posterSettings = settings?.poster as Record<string, unknown> | undefined;

  if (!posterSettings) {
    return DEFAULT_POSTER_LAYOUT;
  }

  return {
    orientation: posterSettings.orientation === 'landscape' ? 'landscape' : 'portrait',
    showQR: posterSettings.showQR !== false,
    showSponsors: posterSettings.showSponsors !== false,
    showSchedule: posterSettings.showSchedule === true,
  };
}

// =============================================================================
// Response Factories
// =============================================================================

function createSuccessResponse(
  bundle: PosterBundleResponse,
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

function createNotModifiedResponse(etag: string): Response {
  const body: PosterBundleNotModifiedResponse = {
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

function createErrorResponse(
  code: string,
  message: string,
  status: number,
  corrId?: string
): Response {
  const body: PosterBundleErrorResponse = {
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
 * Story E4: Create error response for non-renderable assets on poster
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

  const body: PosterBundleErrorResponse = {
    ok: false,
    status: 403,
    code: POSTER_BUNDLE_ERROR_CODES.ASSET_NOT_RENDERABLE,
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
      'Cache-Control': 'private, max-age=10',
    },
  });
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle GET /api/events/:id/posterBundle
 *
 * Gets poster bundle for an event from Google Sheets.
 * Story E4: Only returns bundle for ACTIVE events.
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param eventId - Event ID or slug from URL path
 * @returns Response with poster bundle
 */
export async function handleGetPosterBundle(
  request: Request,
  env: PosterBundleEnv,
  eventId: string
): Promise<Response> {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;
  const ifNoneMatch = request.headers.get('If-None-Match') || url.searchParams.get('ifNoneMatch');

  if (!eventId || eventId.trim() === '') {
    return createErrorResponse(
      POSTER_BUNDLE_ERROR_CODES.EVENT_NOT_FOUND,
      'Missing event ID',
      404
    );
  }

  if (!isValidBrand(brandId)) {
    return createErrorResponse(POSTER_BUNDLE_ERROR_CODES.BAD_INPUT, `Invalid brand: ${brandId}`, 400);
  }

  if (!isConfigured(env)) {
    return createErrorResponse(
      POSTER_BUNDLE_ERROR_CODES.NOT_CONFIGURED,
      'Google Sheets API not configured',
      503
    );
  }

  try {
    const rows = await getSheetValues(env, EVENTS_SHEET, EVENTS_RANGE);
    const dataRows = rows.slice(1);

    if (dataRows.length === 0) {
      return createErrorResponse(
        POSTER_BUNDLE_ERROR_CODES.EVENT_NOT_FOUND,
        `Event not found: ${eventId}`,
        404
      );
    }

    let event = findEventById(dataRows, eventId, brandId);
    if (!event) {
      event = findEventBySlug(dataRows, eventId, brandId);
    }

    if (!event) {
      return createErrorResponse(
        POSTER_BUNDLE_ERROR_CODES.EVENT_NOT_FOUND,
        `Event not found: ${eventId}`,
        404
      );
    }

    // Build bundle value
    const baseValue = buildPublicBundleValue(event, brandId);

    // Story E4: Check if event is renderable on poster surface
    const renderCheck = assertRenderable(baseValue.assetState, 'poster');
    if (!renderCheck.allowed) {
      console.log(
        JSON.stringify({
          type: 'POSTER_ASSET_NOT_RENDERABLE',
          eventId,
          brandId,
          assetState: baseValue.assetState,
          reason: renderCheck.reason,
          timestamp: new Date().toISOString(),
        })
      );
      return createAssetStateErrorResponse(
        baseValue.assetState,
        renderCheck.reason || 'Event is not available for poster display'
      );
    }

    // Build poster-specific value with layout config
    const posterLayout = buildPosterLayout(event);
    const value: PosterBundleValue = {
      ...baseValue,
      posterLayout,
      surface: 'poster',
    };

    // Generate ETag
    const etag = await generateContentEtag(value);

    // Check If-None-Match for 304 response
    if (ifNoneMatch && ifNoneMatch === etag) {
      return createNotModifiedResponse(etag);
    }

    const bundle: PosterBundleResponse = {
      ok: true,
      etag,
      value,
    };

    return createSuccessResponse(bundle);
  } catch (error) {
    const corrId = generateCorrId();

    if (error instanceof SheetsError) {
      logSheetsClientError(error, { corrId, endpoint: '/api/events/:id/posterBundle' });
      return createErrorResponse(
        POSTER_BUNDLE_ERROR_CODES.INTERNAL,
        'Failed to load event data',
        500,
        corrId
      );
    } else {
      console.error(
        JSON.stringify({
          type: 'POSTER_BUNDLE_ERROR',
          corrId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString(),
        })
      );
    }

    return createErrorResponse(POSTER_BUNDLE_ERROR_CODES.INTERNAL, 'Failed to get poster bundle', 500, corrId);
  }
}

/**
 * Parse event ID from poster bundle URL path
 */
export function parsePosterEventIdFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length >= 4 && segments[0] === 'api' && segments[1] === 'events') {
    if (segments[3] === 'posterBundle') {
      return segments[2];
    }
  }
  return null;
}
