/**
 * Display Bundle API Handler
 *
 * Worker-native endpoint for display/TV/kiosk surfaces.
 *
 * GET /api/events/:id/displayBundle
 *
 * Story E4: Display Safety + Rotation Guard
 * - Only ACTIVE events can be rendered on display surfaces
 * - Returns 403 with asset state info for non-ACTIVE events
 * - Includes rotation configuration for ACTIVE events
 *
 * @module handlers/displayBundle
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
 * Environment bindings required for display bundle handler
 */
export interface DisplayBundleEnv extends SheetsEnv {
  WORKER_ENV?: string;
}

/**
 * Rotation pane configuration
 */
export interface RotationPane {
  type: 'public' | 'schedule' | 'standings' | 'sponsors' | 'custom';
  dwellMs?: number;
  title?: string;
  url?: string;
}

/**
 * Display rotation configuration
 */
export interface DisplayRotationConfig {
  enabled: boolean;
  defaultDwellMs: number;
  panes: RotationPane[];
  paneTypes: Record<string, { defaultDwellMs: number }>;
}

/**
 * Display bundle value shape
 */
export interface DisplayBundleValue extends PublicBundleValue {
  /** Display rotation configuration */
  displayRotation: DisplayRotationConfig;
  /** Surface type for this bundle */
  surface: 'display';
}

/**
 * Success response
 */
export interface DisplayBundleResponse {
  ok: true;
  etag: string;
  value: DisplayBundleValue;
}

/**
 * 304 Not Modified response
 */
export interface DisplayBundleNotModifiedResponse {
  ok: true;
  notModified: true;
  etag: string;
}

/**
 * Error response shape
 */
export interface DisplayBundleErrorResponse {
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
 * Story E4: Error codes for display bundle endpoint
 */
export const DISPLAY_BUNDLE_ERROR_CODES = {
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  ASSET_NOT_RENDERABLE: 'ASSET_NOT_RENDERABLE',
  BAD_INPUT: 'BAD_INPUT',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  INTERNAL: 'INTERNAL',
} as const;

// =============================================================================
// Default Rotation Configuration
// =============================================================================

/**
 * Default rotation pane types with dwell times
 */
const DEFAULT_PANE_TYPES: Record<string, { defaultDwellMs: number }> = {
  public: { defaultDwellMs: 30000 },
  schedule: { defaultDwellMs: 15000 },
  standings: { defaultDwellMs: 15000 },
  sponsors: { defaultDwellMs: 20000 },
  custom: { defaultDwellMs: 20000 },
};

/**
 * Default rotation configuration
 */
const DEFAULT_ROTATION_CONFIG: DisplayRotationConfig = {
  enabled: false,
  defaultDwellMs: 15000,
  panes: [
    { type: 'public', dwellMs: 30000 },
  ],
  paneTypes: DEFAULT_PANE_TYPES,
};

// =============================================================================
// Utilities
// =============================================================================

function generateCorrId(): string {
  return `dsp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
 * Build rotation configuration from event settings
 */
function buildRotationConfig(event: PublicEvent): DisplayRotationConfig {
  const settings = (event as unknown as Record<string, unknown>).settings as Record<string, unknown> | undefined;
  const displayRotation = settings?.displayRotation as Record<string, unknown> | undefined;

  if (!displayRotation) {
    return DEFAULT_ROTATION_CONFIG;
  }

  const panes = Array.isArray(displayRotation.panes)
    ? (displayRotation.panes as RotationPane[])
    : DEFAULT_ROTATION_CONFIG.panes;

  return {
    enabled: displayRotation.enabled === true || panes.length > 1,
    defaultDwellMs: typeof displayRotation.defaultDwellMs === 'number'
      ? displayRotation.defaultDwellMs
      : DEFAULT_ROTATION_CONFIG.defaultDwellMs,
    panes,
    paneTypes: DEFAULT_PANE_TYPES,
  };
}

// =============================================================================
// Response Factories
// =============================================================================

function createSuccessResponse(
  bundle: DisplayBundleResponse,
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
  const body: DisplayBundleNotModifiedResponse = {
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
  const body: DisplayBundleErrorResponse = {
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
 * Story E4: Create error response for non-renderable assets on display
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

  const body: DisplayBundleErrorResponse = {
    ok: false,
    status: 403,
    code: DISPLAY_BUNDLE_ERROR_CODES.ASSET_NOT_RENDERABLE,
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
 * Handle GET /api/events/:id/displayBundle
 *
 * Gets display bundle for an event from Google Sheets.
 * Story E4: Only returns bundle for ACTIVE events.
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param eventId - Event ID or slug from URL path
 * @returns Response with display bundle
 */
export async function handleGetDisplayBundle(
  request: Request,
  env: DisplayBundleEnv,
  eventId: string
): Promise<Response> {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;
  const ifNoneMatch = request.headers.get('If-None-Match') || url.searchParams.get('ifNoneMatch');

  if (!eventId || eventId.trim() === '') {
    return createErrorResponse(
      DISPLAY_BUNDLE_ERROR_CODES.EVENT_NOT_FOUND,
      'Missing event ID',
      404
    );
  }

  if (!isValidBrand(brandId)) {
    return createErrorResponse(DISPLAY_BUNDLE_ERROR_CODES.BAD_INPUT, `Invalid brand: ${brandId}`, 400);
  }

  if (!isConfigured(env)) {
    return createErrorResponse(
      DISPLAY_BUNDLE_ERROR_CODES.NOT_CONFIGURED,
      'Google Sheets API not configured',
      503
    );
  }

  try {
    const rows = await getSheetValues(env, EVENTS_SHEET, EVENTS_RANGE);
    const dataRows = rows.slice(1);

    if (dataRows.length === 0) {
      return createErrorResponse(
        DISPLAY_BUNDLE_ERROR_CODES.EVENT_NOT_FOUND,
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
        DISPLAY_BUNDLE_ERROR_CODES.EVENT_NOT_FOUND,
        `Event not found: ${eventId}`,
        404
      );
    }

    // Build bundle value
    const baseValue = buildPublicBundleValue(event, brandId);

    // Story E4: Check if event is renderable on display surface
    const renderCheck = assertRenderable(baseValue.assetState, 'display');
    if (!renderCheck.allowed) {
      console.log(
        JSON.stringify({
          type: 'DISPLAY_ASSET_NOT_RENDERABLE',
          eventId,
          brandId,
          assetState: baseValue.assetState,
          reason: renderCheck.reason,
          timestamp: new Date().toISOString(),
        })
      );
      return createAssetStateErrorResponse(
        baseValue.assetState,
        renderCheck.reason || 'Event is not available for display'
      );
    }

    // Build display-specific value with rotation config
    const rotationConfig = buildRotationConfig(event);
    const value: DisplayBundleValue = {
      ...baseValue,
      displayRotation: rotationConfig,
      surface: 'display',
    };

    // Generate ETag
    const etag = await generateContentEtag(value);

    // Check If-None-Match for 304 response
    if (ifNoneMatch && ifNoneMatch === etag) {
      return createNotModifiedResponse(etag);
    }

    const bundle: DisplayBundleResponse = {
      ok: true,
      etag,
      value,
    };

    return createSuccessResponse(bundle);
  } catch (error) {
    const corrId = generateCorrId();

    if (error instanceof SheetsError) {
      logSheetsClientError(error, { corrId, endpoint: '/api/events/:id/displayBundle' });
      return createErrorResponse(
        DISPLAY_BUNDLE_ERROR_CODES.INTERNAL,
        'Failed to load event data',
        500,
        corrId
      );
    } else {
      console.error(
        JSON.stringify({
          type: 'DISPLAY_BUNDLE_ERROR',
          corrId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString(),
        })
      );
    }

    return createErrorResponse(DISPLAY_BUNDLE_ERROR_CODES.INTERNAL, 'Failed to get display bundle', 500, corrId);
  }
}

/**
 * Parse event ID from display bundle URL path
 */
export function parseDisplayEventIdFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length >= 4 && segments[0] === 'api' && segments[1] === 'events') {
    if (segments[3] === 'displayBundle') {
      return segments[2];
    }
  }
  return null;
}
