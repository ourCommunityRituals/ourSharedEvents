/**
 * Events V2 API Handler
 *
 * Worker-native endpoint to list events from Google Sheets using
 * the sheetsGetValues() client from Story B3.
 *
 * GET /api/v2/events
 *
 * @module handlers/eventsV2
 * @see Story B3 - Sheets Client Read sheetsGetValues() (Structured Failures)
 * @see Story B4 - Implement GET /api/v2/events?brand=root (Read Path)
 */

import {
  sheetsGetValues,
  SheetsReadError,
  type SheetsEnv,
} from '../google/sheets';

import {
  resolveAssetState,
  parseAssetState,
  ASSET_STATE_COLUMN_INDEX,
  type AssetState,
  type AssetStateInfo,
} from '../domain/assetState';

// =============================================================================
// Constants
// =============================================================================

const HANDLER_VERSION = '1.1.0';
const EVENTS_SHEET = 'EVENTS';

/**
 * Default range for reading events from the sheet.
 *
 * Per Story B4:
 * - Uses A2:K to skip header row (starts at row 2)
 * - Reads columns A through K (11 columns)
 *
 * Can be overridden via environment variable EVENTS_RANGE if needed.
 */
const EVENTS_RANGE = 'A2:K';

/**
 * Error codes per Story B5 acceptance criteria
 * These codes MUST remain stable for CI/CD gates
 */
export const EVENTS_V2_ERROR_CODES = {
  /** SHEETS_SPREADSHEET_ID not configured */
  SHEETS_DB_ID_MISSING: 'SHEETS_DB_ID_MISSING',
  /** Generic sheets read failure */
  SHEETS_READ_FAILED: 'SHEETS_READ_FAILED',
  /** Invalid brand parameter */
  INVALID_BRAND: 'INVALID_BRAND',
} as const;

export type EventsV2ErrorCode = typeof EVENTS_V2_ERROR_CODES[keyof typeof EVENTS_V2_ERROR_CODES];

/**
 * Column indices (0-based) mapping to sheet columns.
 *
 * Per Story B4 Backend Architect requirement:
 * Document mapping between sheet columns and event fields.
 *
 * Sheet Column Layout (EVENTS sheet):
 * | Col | Index | Field        | Description                               |
 * |-----|-------|--------------|-------------------------------------------|
 * | A   | 0     | ID           | Unique event ID (evt_xxxx format)         |
 * | B   | 1     | BRAND_ID     | Brand identifier (root, abc, cbc, cbl)    |
 * | C   | 2     | TEMPLATE_ID  | Template reference (optional)             |
 * | D   | 3     | DATA_JSON    | Complete event data as JSON string        |
 * | E   | 4     | CREATED_AT   | ISO timestamp of creation                 |
 * | F   | 5     | SLUG         | URL-friendly slug for routing             |
 * | G   | 6     | UPDATED_AT   | ISO timestamp of last update              |
 * | H   | 7     | STATUS       | Event status (active, archived) - Story D2|
 * | I   | 8     | IS_DEFAULT   | Whether this is the default event - D3    |
 * | J   | 9     | ASSET_STATE  | Asset lifecycle state - Story E1          |
 * | K   | 10    | (reserved)   | Future: additional data                   |
 *
 * Notes:
 * - Column K is reserved for future expansion
 * - DATA_JSON (col D) contains the full event payload as JSON
 * - ID is authoritative; DATA_JSON.id is overridden by column A
 * - BRAND_ID filters which events are returned per brand
 * - STATUS (col H) filters archived events from listings (Story D2)
 * - ASSET_STATE (col J) controls rendering eligibility - Story E1
 */
const COL = {
  ID: 0,
  BRAND_ID: 1,
  TEMPLATE_ID: 2,
  DATA_JSON: 3,
  CREATED_AT: 4,
  SLUG: 5,
  UPDATED_AT: 6,
  STATUS: 7, // Story D2: status column (active | archived)
  IS_DEFAULT: 8, // Story D3: default event flag
  ASSET_STATE: 9, // Story E1: asset lifecycle state
} as const;

/**
 * Event status values per Story D2
 * Events without status are treated as 'active'
 */
const EVENT_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;

// Valid brand IDs
const VALID_BRANDS = ['root', 'abc', 'cbc', 'cbl'] as const;
type BrandId = (typeof VALID_BRANDS)[number];

const DEFAULT_BRAND: BrandId = 'root';

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for events V2 handler
 */
export interface EventsV2Env extends SheetsEnv {
  WORKER_ENV?: string;
  WORKER_BUILD_VERSION?: string;
}

/**
 * Event summary (returned when full=false)
 */
export interface EventV2Summary {
  id: string;
  slug: string;
  name: string;
  startDateISO: string;
  venue: string;
  createdAtISO: string;
  updatedAtISO: string;
  /** Asset lifecycle state - Story E1 */
  assetState: AssetState;
  /** Asset state info including renderability - Story E1 */
  assetStateInfo: AssetStateInfo;
}

/**
 * Full event data (returned when full=true)
 */
export interface EventV2Full extends EventV2Summary {
  brandId: string;
  templateId?: string;
  links?: {
    publicUrl: string;
    displayUrl: string;
    posterUrl: string;
    signupUrl: string;
  };
  qr?: {
    public: string;
    signup: string;
  };
  /** Whether QR codes have been verified - Story E1 */
  qrVerified?: boolean;
  schedule?: unknown[];
  standings?: unknown[];
  bracket?: unknown;
  ctas?: {
    primary: { label: string; url: string };
    secondary?: { label: string; url: string };
  };
  sponsors?: unknown[];
  media?: {
    videoUrl?: string;
    mapUrl?: string;
    gallery?: unknown[];
  };
  settings?: {
    showSchedule: boolean;
    showStandings: boolean;
    showBracket: boolean;
    showSponsors?: boolean;
    showVideo?: boolean;
    showMap?: boolean;
    showGallery?: boolean;
    showSponsorBanner?: boolean;
    showSponsorStrip?: boolean;
    showLeagueStrip?: boolean;
    showQRSection?: boolean;
  };
}

/**
 * Success response shape per Story B5 acceptance criteria
 *
 * Contract: { "ok": true, "status": 200, "items": [...] }
 */
export interface EventsV2ListResponse {
  ok: true;
  status: 200;
  items: (EventV2Summary | EventV2Full)[];
}

/**
 * Error response shape per Story B5 acceptance criteria
 *
 * 503s return { ok: false, code, requestId }
 */
export interface EventsV2ErrorResponse {
  ok: false;
  status: number;
  code: EventsV2ErrorCode;
  error: string;
  requestId: string;
  timestamp: string;
  googleStatus?: number;
  googleBody?: string;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Check if a brand ID is valid
 */
function isValidBrand(brandId: string): brandId is BrandId {
  return VALID_BRANDS.includes(brandId as BrandId);
}

/**
 * Check if an event row is active (not archived)
 *
 * Per Story D2: Archived events are filtered from /api/v2/events
 * Events without status or with status 'active' are considered active
 *
 * @param row - Sheet row data
 * @returns true if event is active (should be returned in list)
 */
function isEventActive(row: string[]): boolean {
  const status = row[COL.STATUS];
  // Empty status or 'active' status means event is active
  // Only 'archived' status should hide the event
  return !status || status === EVENT_STATUS.ACTIVE;
}

/**
 * Parse event row from sheet to event object
 *
 * Per Story B5: Normalize rows safely (no crashes on missing columns)
 * Per Story E1: Includes assetState resolution
 *
 * @param row - Sheet row data
 * @returns Parsed event or null if invalid
 */
function parseEventRow(row: string[]): EventV2Full | null {
  // Safe handling of missing columns
  if (!row || row.length < 4) return null;

  const id = row[COL.ID];
  const dataJson = row[COL.DATA_JSON];

  // Skip rows without ID or data
  if (!id || !dataJson) return null;

  try {
    const event = JSON.parse(dataJson) as EventV2Full;
    const brandId = row[COL.BRAND_ID] || event.brandId || 'root';
    const status = row[COL.STATUS] || 'active';
    const rawAssetState = row[COL.ASSET_STATE];

    // Story E1: Resolve asset state
    const assetStateInfo = resolveAssetState({
      id,
      name: event.name,
      startDateISO: event.startDateISO,
      venue: event.venue,
      assetState: parseAssetState(rawAssetState),
      status: status as 'active' | 'archived',
      qrVerified: event.qrVerified,
      qr: event.qr,
    });

    return {
      ...event,
      id: id, // Ensure ID from column matches
      brandId,
      assetState: assetStateInfo.state,
      assetStateInfo,
    };
  } catch (e) {
    // Per Story B5: no crashes on invalid data
    console.error(JSON.stringify({
      type: 'EVENT_PARSE_ERROR',
      eventId: id,
      error: e instanceof Error ? e.message : 'Parse failed',
      timestamp: new Date().toISOString(),
    }));
    return null;
  }
}

/**
 * Extract summary fields from full event
 *
 * @param event - Full event data
 * @returns Event summary
 */
function toSummary(event: EventV2Full): EventV2Summary {
  return {
    id: event.id,
    slug: event.slug || '',
    name: event.name || '',
    startDateISO: event.startDateISO || '',
    venue: event.venue || '',
    createdAtISO: event.createdAtISO || '',
    updatedAtISO: event.updatedAtISO || '',
    // Story E1: Include asset state in summary
    assetState: event.assetState,
    assetStateInfo: event.assetStateInfo,
  };
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle GET /api/v2/events
 *
 * Lists events for a brand from Google Sheets using sheetsGetValues().
 *
 * Per Story B5 Acceptance Criteria:
 * - GET /api/v2/events?brand=root returns 200 with items[]
 * - No calls to Google origins from browser
 * - 503s return { ok:false, code, requestId }
 *
 * Query parameters:
 * - brand (optional): Brand ID (default: 'root')
 * - full (optional): Include full event data (default: false)
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param requestId - Request ID for tracing
 * @returns Response with events list
 */
export async function handleEventsV2(
  request: Request,
  env: EventsV2Env,
  requestId: string
): Promise<Response> {
  const timestamp = new Date().toISOString();
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;
  const includeFull = url.searchParams.get('full') === 'true';

  // Validate brand
  if (!isValidBrand(brandId)) {
    return createErrorResponse(
      EVENTS_V2_ERROR_CODES.INVALID_BRAND,
      `Invalid brand: ${brandId}`,
      400,
      requestId,
      timestamp
    );
  }

  // Check if Sheets is configured
  // Per Story B5: Missing sheet ID → deterministic SHEETS_DB_ID_MISSING
  if (!env.SHEETS_SPREADSHEET_ID) {
    console.error(JSON.stringify({
      type: 'EVENTS_V2_ERROR',
      code: EVENTS_V2_ERROR_CODES.SHEETS_DB_ID_MISSING,
      requestId,
      timestamp,
    }));

    return createErrorResponse(
      EVENTS_V2_ERROR_CODES.SHEETS_DB_ID_MISSING,
      'SHEETS_SPREADSHEET_ID not configured',
      503,
      requestId,
      timestamp
    );
  }

  try {
    // Read all events from sheet using sheetsGetValues (Story B3)
    // Per Story B4: Range A2:K already skips header row (starts at row 2)
    const result = await sheetsGetValues(env, env.SHEETS_SPREADSHEET_ID!, `${EVENTS_SHEET}!${EVENTS_RANGE}`);

    // Get data rows directly (no header to skip - range starts at A2)
    const dataRows = result.values;

    if (dataRows.length === 0) {
      // Empty sheet - return empty array per AC
      return createSuccessResponse([], requestId);
    }

    // Filter by brandId and status, then parse events
    // Per Story D2: Only return events where status === 'active' (or empty)
    const events: (EventV2Summary | EventV2Full)[] = [];

    for (const row of dataRows) {
      // Filter by brandId
      if (row[COL.BRAND_ID] !== brandId) continue;

      // Per Story D2: Filter out archived events
      if (!isEventActive(row)) continue;

      const event = parseEventRow(row);
      if (!event) continue;

      if (includeFull) {
        events.push(event);
      } else {
        events.push(toSummary(event));
      }
    }

    // Sort by date descending (most recent first)
    events.sort((a, b) => {
      const dateA = a.startDateISO || '';
      const dateB = b.startDateISO || '';
      return dateB.localeCompare(dateA);
    });

    return createSuccessResponse(events, requestId);
  } catch (error) {
    // Per Story B5: 403 from Google → SHEETS_READ_FAILED + status
    if (error instanceof SheetsReadError) {
      console.error(JSON.stringify({
        type: 'EVENTS_V2_SHEETS_ERROR',
        code: EVENTS_V2_ERROR_CODES.SHEETS_READ_FAILED,
        googleStatus: error.googleStatus,
        requestId,
        timestamp,
      }));

      return createErrorResponse(
        EVENTS_V2_ERROR_CODES.SHEETS_READ_FAILED,
        error.message,
        503,
        requestId,
        timestamp,
        error.googleStatus,
        error.googleBody
      );
    }

    // Other errors
    console.error(JSON.stringify({
      type: 'EVENTS_V2_ERROR',
      code: EVENTS_V2_ERROR_CODES.SHEETS_READ_FAILED,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId,
      timestamp,
    }));

    return createErrorResponse(
      EVENTS_V2_ERROR_CODES.SHEETS_READ_FAILED,
      error instanceof Error ? error.message : 'Failed to list events',
      503,
      requestId,
      timestamp
    );
  }
}

// =============================================================================
// Response Factories
// =============================================================================

/**
 * Create success response
 *
 * Per Story B5 contract: { "ok": true, "status": 200, "items": [...] }
 *
 * @param items - Array of events
 * @param requestId - Request ID for tracing
 * @returns 200 Response
 */
function createSuccessResponse(
  items: (EventV2Summary | EventV2Full)[],
  requestId: string
): Response {
  const body: EventsV2ListResponse = {
    ok: true,
    status: 200,
    items,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      'X-Request-Id': requestId,
      'X-Handler-Version': HANDLER_VERSION,
    },
  });
}

/**
 * Create error response
 *
 * Per Story B5: 503s return { ok:false, code, requestId }
 *
 * @param code - Error code
 * @param message - Error message
 * @param status - HTTP status code
 * @param requestId - Request ID for tracing
 * @param timestamp - ISO timestamp
 * @param googleStatus - Optional Google API status
 * @param googleBody - Optional Google API response snippet
 * @returns Error Response
 */
function createErrorResponse(
  code: EventsV2ErrorCode,
  message: string,
  status: number,
  requestId: string,
  timestamp: string,
  googleStatus?: number,
  googleBody?: string
): Response {
  const body: EventsV2ErrorResponse = {
    ok: false,
    status,
    code,
    error: message,
    requestId,
    timestamp,
    ...(googleStatus !== undefined ? { googleStatus } : {}),
    ...(googleBody ? { googleBody } : {}),
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
      'X-Handler-Version': HANDLER_VERSION,
    },
  });
}
