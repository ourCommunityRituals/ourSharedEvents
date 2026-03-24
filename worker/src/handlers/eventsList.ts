/**
 * Events List API Handler
 *
 * Worker-native endpoint to list events from Google Sheets.
 *
 * GET /api/events
 *
 * @module handlers/eventsList
 * @see Story 1.3 - Port api_status + Simple Read-Only api_listEvents
 */

import {
  getSheetValues,
  isConfigured,
  SheetsError,
  logSheetsClientError,
  type SheetsEnv,
} from '../sheetsClient';

// =============================================================================
// Constants
// =============================================================================

const EVENTS_SHEET = 'EVENTS';
const EVENTS_RANGE = 'A:G';

// Column indices (0-based)
const COL = {
  ID: 0,
  BRAND_ID: 1,
  TEMPLATE_ID: 2,
  DATA_JSON: 3,
  CREATED_AT: 4,
  SLUG: 5,
  UPDATED_AT: 6,
} as const;

// Valid brand IDs
const VALID_BRANDS = ['root', 'abc', 'cbc', 'cbl'] as const;
type BrandId = typeof VALID_BRANDS[number];

const DEFAULT_BRAND: BrandId = 'root';

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for events handler
 */
export interface EventsEnv extends SheetsEnv {
  WORKER_ENV?: string;
}

/**
 * Event summary (returned when full=false)
 */
export interface EventSummary {
  id: string;
  slug: string;
  name: string;
  startDateISO: string;
  venue: string;
  createdAtISO: string;
  updatedAtISO: string;
}

/**
 * Full event data (returned when full=true)
 */
export interface EventFull extends EventSummary {
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
 * Success response shape per Story 1.3 acceptance criteria
 */
export interface EventsListResponse {
  ok: true;
  status: 200;
  items: (EventSummary | EventFull)[];
}

/**
 * Error response shape
 */
export interface EventsErrorResponse {
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
 * Check if a brand ID is valid
 */
function isValidBrand(brandId: string): brandId is BrandId {
  return VALID_BRANDS.includes(brandId as BrandId);
}

/**
 * Generate correlation ID for error tracking
 */
function generateCorrId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Parse event row from sheet to event object
 *
 * @param row - Sheet row data
 * @returns Parsed event or null if invalid
 */
function parseEventRow(row: string[]): EventFull | null {
  if (!row || row.length < 4) return null;

  const id = row[COL.ID];
  const dataJson = row[COL.DATA_JSON];

  if (!id || !dataJson) return null;

  try {
    const event = JSON.parse(dataJson) as EventFull;
    return {
      ...event,
      id: id, // Ensure ID from column matches
      brandId: row[COL.BRAND_ID] || event.brandId || 'root',
    };
  } catch (e) {
    console.error(`Failed to parse event ${id}:`, e);
    return null;
  }
}

/**
 * Extract summary fields from full event
 *
 * @param event - Full event data
 * @returns Event summary
 */
function toSummary(event: EventFull): EventSummary {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    startDateISO: event.startDateISO,
    venue: event.venue,
    createdAtISO: event.createdAtISO,
    updatedAtISO: event.updatedAtISO,
  };
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle GET /api/events
 *
 * Lists events for a brand from Google Sheets.
 *
 * Query parameters:
 * - brand (optional): Brand ID (default: 'root')
 * - full (optional): Include full event data (default: false)
 *
 * Response format per Story 1.3 AC:
 * - Success: { ok: true, status: 200, items: [...] }
 * - Empty: { ok: true, status: 200, items: [] }
 * - Error: { ok: false, status: ..., code: ..., message: ... }
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @returns Response with events list
 */
export async function handleListEvents(
  request: Request,
  env: EventsEnv
): Promise<Response> {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;
  const includeFull = url.searchParams.get('full') === 'true';

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

    // Skip header row, handle empty sheet
    const dataRows = rows.slice(1);

    if (dataRows.length === 0) {
      // Empty sheet - return empty array per AC
      return createSuccessResponse([]);
    }

    // Filter by brandId and parse events
    const events: (EventSummary | EventFull)[] = [];

    for (const row of dataRows) {
      // Filter by brandId
      if (row[COL.BRAND_ID] !== brandId) continue;

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

    return createSuccessResponse(events);
  } catch (error) {
    const corrId = generateCorrId();

    // Log detailed error
    if (error instanceof SheetsError) {
      logSheetsClientError(error, { corrId, endpoint: '/api/events' });
    } else {
      console.error(
        JSON.stringify({
          type: 'EVENTS_LIST_ERROR',
          corrId,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        })
      );
    }

    return createErrorResponse('INTERNAL', 'Failed to list events', 500, corrId);
  }
}

// =============================================================================
// Response Factories
// =============================================================================

/**
 * Create success response
 *
 * @param items - Array of events
 * @returns 200 Response
 */
function createSuccessResponse(
  items: (EventSummary | EventFull)[]
): Response {
  const body: EventsListResponse = {
    ok: true,
    status: 200,
    items,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
    },
  });
}

/**
 * Create error response
 *
 * @param code - Error code
 * @param message - Error message
 * @param status - HTTP status code
 * @param corrId - Optional correlation ID
 * @returns Error Response
 */
function createErrorResponse(
  code: string,
  message: string,
  status: number,
  corrId?: string
): Response {
  const body: EventsErrorResponse = {
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
