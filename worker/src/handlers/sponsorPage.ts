/**
 * Sponsor Page Handler
 *
 * Story F3: Sponsor Page Gating (Trust-First Display)
 *
 * Purpose: Sponsors should never see broken, partial, or misleading pages.
 * This handler enforces backend-decided gating logic for sponsor page access.
 *
 * GET /api/v2/sponsor/:sponsorId
 *
 * Page States:
 *   ACTIVE   - At least one associated event is ACTIVE → metrics visible
 *   PENDING  - Has events but none are ACTIVE yet → data accumulating message
 *   INACTIVE - No events OR all events ARCHIVED → no active events message
 *
 * System Impacts:
 *   - Frontend: Must honor backend trust signals
 *   - Backend: Controls visibility
 *   - UX: Transparency over optimism
 *
 * @module handlers/sponsorPage
 * @see Story F3 - Sponsor Page Gating (Trust-First Display)
 */

import {
  sheetsGetValues,
  SheetsReadError,
  type SheetsEnv,
} from '../google/sheets';

import {
  type SponsorContract,
  type LegacySponsor,
  normalizeSponsor,
  SPONSOR_CONTRACT_VERSION,
} from '../domain/sponsor';

import {
  type EventStateInfo,
  type SponsorPageEligibility,
  resolveSponsorPageStatus,
  buildSponsorPageResponse,
  buildSponsorPageErrorResponse,
  logSponsorPageStatus,
  SPONSOR_PAGE_STATUS,
} from '../domain/sponsor';

import {
  resolveAssetState,
  parseAssetState,
  type AssetState,
} from '../domain/assetState';

// =============================================================================
// Constants
// =============================================================================

const HANDLER_VERSION = '1.0.0';
const EVENTS_SHEET = 'EVENTS';
const SPONSORS_SHEET = 'SPONSORS';

/**
 * Default ranges for reading from sheets
 */
const EVENTS_RANGE = 'A2:K';
const SPONSORS_RANGE = 'A2:G';

/**
 * Error codes for sponsor page handler
 * These codes MUST remain stable for CI/CD gates
 */
export const SPONSOR_PAGE_ERROR_CODES = {
  /** SHEETS_SPREADSHEET_ID not configured */
  SHEETS_DB_ID_MISSING: 'SHEETS_DB_ID_MISSING',
  /** Sheets read operation failed */
  SHEETS_READ_FAILED: 'SHEETS_READ_FAILED',
  /** Missing sponsorId parameter */
  MISSING_SPONSOR_ID: 'MISSING_SPONSOR_ID',
  /** Sponsor not found */
  SPONSOR_NOT_FOUND: 'SPONSOR_NOT_FOUND',
  /** Invalid sponsor data */
  INVALID_SPONSOR_DATA: 'INVALID_SPONSOR_DATA',
} as const;

export type SponsorPageErrorCode = typeof SPONSOR_PAGE_ERROR_CODES[keyof typeof SPONSOR_PAGE_ERROR_CODES];

/**
 * Column indices for SPONSORS sheet (0-based)
 *
 * Sheet Column Layout (SPONSORS sheet):
 * | Col | Index | Field       | Description                          |
 * |-----|-------|-------------|--------------------------------------|
 * | A   | 0     | SPONSOR_ID  | Unique sponsor identifier            |
 * | B   | 1     | NAME        | Display name                         |
 * | C   | 2     | TIER        | Sponsorship tier                     |
 * | D   | 3     | LOGO_URL    | URL to sponsor logo                  |
 * | E   | 4     | LINK_URL    | Click-through URL                    |
 * | F   | 5     | EVENT_IDS   | Comma-separated event IDs            |
 * | G   | 6     | DATA_JSON   | Extended data (placements, etc.)     |
 */
const SPONSOR_COL = {
  SPONSOR_ID: 0,
  NAME: 1,
  TIER: 2,
  LOGO_URL: 3,
  LINK_URL: 4,
  EVENT_IDS: 5,
  DATA_JSON: 6,
} as const;

/**
 * Column indices for EVENTS sheet (0-based)
 */
const EVENT_COL = {
  ID: 0,
  BRAND_ID: 1,
  TEMPLATE_ID: 2,
  DATA_JSON: 3,
  CREATED_AT: 4,
  SLUG: 5,
  UPDATED_AT: 6,
  STATUS: 7,
  IS_DEFAULT: 8,
  ASSET_STATE: 9,
} as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for sponsor page handler
 */
export interface SponsorPageEnv extends SheetsEnv {
  WORKER_ENV?: string;
  WORKER_BUILD_VERSION?: string;
}

/**
 * Sponsor row from sheets
 */
interface SponsorRow {
  sponsorId: string;
  name: string;
  tier: string | null;
  logoUrl: string | null;
  linkUrl: string | null;
  eventIds: string[];
  dataJson: Record<string, unknown> | null;
}

/**
 * Event state row (minimal data for eligibility check)
 */
interface EventStateRow {
  eventId: string;
  status: string;
  assetState: AssetState;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse sponsor row from sheet data
 */
function parseSponsorRow(row: unknown[]): SponsorRow | null {
  const sponsorId = String(row[SPONSOR_COL.SPONSOR_ID] ?? '').trim();
  const name = String(row[SPONSOR_COL.NAME] ?? '').trim();

  // Skip empty rows
  if (!sponsorId || !name) {
    return null;
  }

  // Parse event IDs (comma-separated)
  const eventIdsStr = String(row[SPONSOR_COL.EVENT_IDS] ?? '').trim();
  const eventIds = eventIdsStr
    ? eventIdsStr.split(',').map((id) => id.trim()).filter(Boolean)
    : [];

  // Parse extended data JSON
  let dataJson: Record<string, unknown> | null = null;
  const dataJsonStr = String(row[SPONSOR_COL.DATA_JSON] ?? '').trim();
  if (dataJsonStr) {
    try {
      dataJson = JSON.parse(dataJsonStr);
    } catch {
      // Ignore JSON parse errors
    }
  }

  return {
    sponsorId,
    name,
    tier: row[SPONSOR_COL.TIER] ? String(row[SPONSOR_COL.TIER]).trim() : null,
    logoUrl: row[SPONSOR_COL.LOGO_URL] ? String(row[SPONSOR_COL.LOGO_URL]).trim() : null,
    linkUrl: row[SPONSOR_COL.LINK_URL] ? String(row[SPONSOR_COL.LINK_URL]).trim() : null,
    eventIds,
    dataJson,
  };
}

/**
 * Parse event state row from sheet data
 */
function parseEventStateRow(row: unknown[]): EventStateRow | null {
  const eventId = String(row[EVENT_COL.ID] ?? '').trim();

  if (!eventId) {
    return null;
  }

  const status = String(row[EVENT_COL.STATUS] ?? 'active').trim().toLowerCase();
  const assetStateRaw = row[EVENT_COL.ASSET_STATE];

  // Parse asset state using domain logic
  const assetState = parseAssetState(assetStateRaw);

  return {
    eventId,
    status,
    assetState,
  };
}

/**
 * Convert SponsorRow to LegacySponsor for normalization
 */
function toSponsorContract(row: SponsorRow, eventStates: EventStateRow[]): SponsorContract {
  const legacy: LegacySponsor = {
    id: row.sponsorId,
    name: row.name,
    tier: row.tier ?? undefined,
    logoUrl: row.logoUrl ?? undefined,
    linkUrl: row.linkUrl ?? undefined,
    placements: row.dataJson?.placements as SponsorContract['placements'] ?? undefined,
  };

  // Normalize to contract shape
  return normalizeSponsor(legacy, row.eventIds);
}

/**
 * Create JSON response with standard headers
 */
function createJsonResponse(
  body: unknown,
  status: number,
  requestId: string
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Handler-Version': HANDLER_VERSION,
      'X-Request-Id': requestId,
    },
  });
}

/**
 * Create error response
 */
function createErrorResponse(
  code: SponsorPageErrorCode,
  message: string,
  status: number,
  requestId: string
): Response {
  const body = buildSponsorPageErrorResponse(code, message);
  return createJsonResponse(body, status, requestId);
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Handle sponsor page request
 *
 * GET /api/v2/sponsor/:sponsorId
 *
 * Returns sponsor data with page eligibility status based on associated
 * event states. Frontend MUST honor the pageStatus to render appropriately.
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param requestId - Request ID for tracing
 * @param sponsorId - Sponsor ID from URL path
 * @returns Response with sponsor data and page status
 */
export async function handleSponsorPage(
  request: Request,
  env: SponsorPageEnv,
  requestId: string,
  sponsorId: string
): Promise<Response> {
  const startTime = Date.now();

  // Validate sponsorId
  if (!sponsorId || !sponsorId.trim()) {
    return createErrorResponse(
      SPONSOR_PAGE_ERROR_CODES.MISSING_SPONSOR_ID,
      'Sponsor ID is required',
      400,
      requestId
    );
  }

  // Validate environment
  if (!env.SHEETS_SPREADSHEET_ID) {
    console.error('[SponsorPage] SHEETS_SPREADSHEET_ID not configured');
    return createErrorResponse(
      SPONSOR_PAGE_ERROR_CODES.SHEETS_DB_ID_MISSING,
      'Database not configured',
      500,
      requestId
    );
  }

  try {
    // Step 1: Read sponsors from sheet
    const sponsorsResult = await sheetsGetValues(
      env,
      SPONSORS_SHEET,
      SPONSORS_RANGE
    );

    if (!sponsorsResult.ok) {
      console.error('[SponsorPage] Failed to read sponsors sheet:', sponsorsResult.error);
      return createErrorResponse(
        SPONSOR_PAGE_ERROR_CODES.SHEETS_READ_FAILED,
        'Failed to read sponsor data',
        500,
        requestId
      );
    }

    // Find the requested sponsor
    const sponsorRows = sponsorsResult.values ?? [];
    let sponsorRow: SponsorRow | null = null;

    for (const row of sponsorRows) {
      const parsed = parseSponsorRow(row);
      if (parsed && parsed.sponsorId === sponsorId) {
        sponsorRow = parsed;
        break;
      }
    }

    if (!sponsorRow) {
      return createErrorResponse(
        SPONSOR_PAGE_ERROR_CODES.SPONSOR_NOT_FOUND,
        `Sponsor not found: ${sponsorId}`,
        404,
        requestId
      );
    }

    // Step 2: Read events to get asset states
    const eventsResult = await sheetsGetValues(
      env,
      EVENTS_SHEET,
      EVENTS_RANGE
    );

    if (!eventsResult.ok) {
      console.error('[SponsorPage] Failed to read events sheet:', eventsResult.error);
      return createErrorResponse(
        SPONSOR_PAGE_ERROR_CODES.SHEETS_READ_FAILED,
        'Failed to read event data',
        500,
        requestId
      );
    }

    // Parse event states for associated events
    const eventRows = eventsResult.values ?? [];
    const eventStatesMap = new Map<string, EventStateRow>();

    for (const row of eventRows) {
      const parsed = parseEventStateRow(row);
      if (parsed) {
        eventStatesMap.set(parsed.eventId, parsed);
      }
    }

    // Step 3: Build event state info for eligibility check
    const eventStates: EventStateInfo[] = [];
    for (const eventId of sponsorRow.eventIds) {
      const eventState = eventStatesMap.get(eventId);
      if (eventState) {
        // Map to EventStateInfo format
        eventStates.push({
          eventId: eventState.eventId,
          assetState: eventState.assetState,
        });
      }
      // Events not found in sheet are ignored (orphaned references)
    }

    // Step 4: Resolve page eligibility
    const eligibility = resolveSponsorPageStatus(eventStates);

    // Log for audit trail
    logSponsorPageStatus(sponsorId, eligibility);

    // Step 5: Build sponsor contract
    const eventStateRows = sponsorRow.eventIds
      .map((id) => eventStatesMap.get(id))
      .filter((row): row is EventStateRow => row !== undefined);

    const sponsorContract = toSponsorContract(sponsorRow, eventStateRows);

    // Step 6: Build response
    const response = buildSponsorPageResponse(sponsorContract, eligibility);

    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      type: 'SPONSOR_PAGE_REQUEST',
      sponsorId,
      pageStatus: eligibility.status,
      metricsVisible: eligibility.metricsVisible,
      eventCount: eventStates.length,
      activeEventCount: eligibility.activeEventCount,
      durationMs,
      requestId,
    }));

    return createJsonResponse(response, 200, requestId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[SponsorPage] Unexpected error:', errorMessage);

    return createErrorResponse(
      SPONSOR_PAGE_ERROR_CODES.SHEETS_READ_FAILED,
      'An error occurred while loading sponsor data',
      500,
      requestId
    );
  }
}

/**
 * Handle sponsor page list request
 *
 * GET /api/v2/sponsors
 *
 * Returns list of all sponsors with their page eligibility status.
 * This is useful for admin views or sponsor listings.
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param requestId - Request ID for tracing
 * @returns Response with sponsors list
 */
export async function handleSponsorsPage(
  request: Request,
  env: SponsorPageEnv,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();

  // Validate environment
  if (!env.SHEETS_SPREADSHEET_ID) {
    console.error('[SponsorsPage] SHEETS_SPREADSHEET_ID not configured');
    return createErrorResponse(
      SPONSOR_PAGE_ERROR_CODES.SHEETS_DB_ID_MISSING,
      'Database not configured',
      500,
      requestId
    );
  }

  try {
    // Read sponsors and events in parallel
    const [sponsorsResult, eventsResult] = await Promise.all([
      sheetsGetValues(env, SPONSORS_SHEET, SPONSORS_RANGE),
      sheetsGetValues(env, EVENTS_SHEET, EVENTS_RANGE),
    ]);

    if (!sponsorsResult.ok) {
      console.error('[SponsorsPage] Failed to read sponsors sheet:', sponsorsResult.error);
      return createErrorResponse(
        SPONSOR_PAGE_ERROR_CODES.SHEETS_READ_FAILED,
        'Failed to read sponsor data',
        500,
        requestId
      );
    }

    if (!eventsResult.ok) {
      console.error('[SponsorsPage] Failed to read events sheet:', eventsResult.error);
      return createErrorResponse(
        SPONSOR_PAGE_ERROR_CODES.SHEETS_READ_FAILED,
        'Failed to read event data',
        500,
        requestId
      );
    }

    // Build event states map
    const eventRows = eventsResult.values ?? [];
    const eventStatesMap = new Map<string, EventStateRow>();

    for (const row of eventRows) {
      const parsed = parseEventStateRow(row);
      if (parsed) {
        eventStatesMap.set(parsed.eventId, parsed);
      }
    }

    // Process all sponsors
    const sponsorRows = sponsorsResult.values ?? [];
    const sponsors: Array<{
      sponsor: SponsorContract;
      pageStatus: SponsorPageEligibility;
    }> = [];

    for (const row of sponsorRows) {
      const sponsorRow = parseSponsorRow(row);
      if (!sponsorRow) continue;

      // Build event state info for eligibility check
      const eventStates: EventStateInfo[] = [];
      for (const eventId of sponsorRow.eventIds) {
        const eventState = eventStatesMap.get(eventId);
        if (eventState) {
          eventStates.push({
            eventId: eventState.eventId,
            assetState: eventState.assetState,
          });
        }
      }

      // Resolve page eligibility
      const eligibility = resolveSponsorPageStatus(eventStates);

      // Build sponsor contract
      const eventStateRows = sponsorRow.eventIds
        .map((id) => eventStatesMap.get(id))
        .filter((r): r is EventStateRow => r !== undefined);

      const sponsorContract = toSponsorContract(sponsorRow, eventStateRows);

      sponsors.push({
        sponsor: sponsorContract,
        pageStatus: eligibility,
      });
    }

    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      type: 'SPONSORS_PAGE_REQUEST',
      sponsorCount: sponsors.length,
      durationMs,
      requestId,
    }));

    const response = {
      ok: true,
      sponsors,
      count: sponsors.length,
      _contractVersion: SPONSOR_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
    };

    return createJsonResponse(response, 200, requestId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[SponsorsPage] Unexpected error:', errorMessage);

    return createErrorResponse(
      SPONSOR_PAGE_ERROR_CODES.SHEETS_READ_FAILED,
      'An error occurred while loading sponsors data',
      500,
      requestId
    );
  }
}
