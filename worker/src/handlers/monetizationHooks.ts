/**
 * Monetization Hooks Handler
 *
 * Story F4: Monetization Readiness Hooks (No Billing Yet)
 *
 * Purpose: Prepare monetization without coupling billing logic to product logic.
 * These endpoints expose billable units and billing windows in READ-ONLY mode.
 *
 * INVARIANTS:
 *   - NO billing logic is executed
 *   - NO payment processing
 *   - NO user-visible billing UI
 *   - Fields are INERT (no side effects)
 *
 * Endpoints:
 *   GET /api/v2/sponsor/:sponsorId/monetization - Sponsor monetization hooks
 *   GET /api/v2/event/:eventId/monetization - Event monetization hooks
 *
 * @module handlers/monetizationHooks
 * @see Story F4 - Monetization Readiness Hooks (No Billing Yet)
 */

import {
  sheetsGetValues,
  SheetsReadError,
  type SheetsEnv,
} from '../google/sheets';

import {
  type SponsorContract,
  type LegacySponsor,
  type MonetizationHooks,
  type SponsorPageEligibility,
  type EventStateInfo,
  normalizeSponsor,
  buildMonetizationHooks,
  buildSponsorMonetizationResponse,
  buildMonetizationErrorResponse,
  resolveSponsorPageStatus,
  checkMonetizationHooksInert,
  logMonetizationHooksAccess,
  SPONSOR_CONTRACT_VERSION,
} from '../domain/sponsor';

import {
  type EventMonetizationHooks,
  type AnalyticsIntegrityMetadata,
  buildEventMonetizationHooks,
  buildEventMonetizationResponse,
  checkEventMonetizationHooksInert,
  logEventMonetizationAccess,
  buildIntegrityMetadata,
  DEFAULT_EVENT_METRICS,
  ANALYTICS_DATA_SOURCES,
} from '../domain/analytics';

import {
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
 * Error codes for monetization hooks handler
 */
export const MONETIZATION_ERROR_CODES = {
  /** SHEETS_SPREADSHEET_ID not configured */
  SHEETS_DB_ID_MISSING: 'SHEETS_DB_ID_MISSING',
  /** Sheets read operation failed */
  SHEETS_READ_FAILED: 'SHEETS_READ_FAILED',
  /** Missing entity ID parameter */
  MISSING_ID: 'MISSING_ID',
  /** Entity not found */
  NOT_FOUND: 'NOT_FOUND',
  /** Internal error */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type MonetizationErrorCode = typeof MONETIZATION_ERROR_CODES[keyof typeof MONETIZATION_ERROR_CODES];

/**
 * Column indices for SPONSORS sheet (0-based)
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
 * Environment bindings required for monetization hooks handler
 */
export interface MonetizationEnv extends SheetsEnv {
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
 * Event row from sheets
 */
interface EventRow {
  eventId: string;
  name: string;
  status: string;
  assetState: AssetState;
  dataJson: Record<string, unknown> | null;
  createdAt: string | null;
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

  if (!sponsorId || !name) {
    return null;
  }

  const eventIdsStr = String(row[SPONSOR_COL.EVENT_IDS] ?? '').trim();
  const eventIds = eventIdsStr
    ? eventIdsStr.split(',').map((id) => id.trim()).filter(Boolean)
    : [];

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
 * Parse event row from sheet data
 */
function parseEventRow(row: unknown[]): EventRow | null {
  const eventId = String(row[EVENT_COL.ID] ?? '').trim();

  if (!eventId) {
    return null;
  }

  let dataJson: Record<string, unknown> | null = null;
  const dataJsonStr = String(row[EVENT_COL.DATA_JSON] ?? '').trim();
  if (dataJsonStr) {
    try {
      dataJson = JSON.parse(dataJsonStr);
    } catch {
      // Ignore JSON parse errors
    }
  }

  const name = dataJson?.name ? String(dataJson.name) : eventId;
  const status = String(row[EVENT_COL.STATUS] ?? 'active').trim().toLowerCase();
  const assetState = parseAssetState(row[EVENT_COL.ASSET_STATE]);
  const createdAt = row[EVENT_COL.CREATED_AT] ? String(row[EVENT_COL.CREATED_AT]) : null;

  return {
    eventId,
    name,
    status,
    assetState,
    dataJson,
    createdAt,
  };
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
      'X-Monetization-Inert': 'true', // Story F4: Billing hooks are inert
    },
  });
}

/**
 * Create error response for monetization endpoint
 */
function createErrorResponse(
  code: MonetizationErrorCode,
  message: string,
  status: number,
  requestId: string
): Response {
  const body = buildMonetizationErrorResponse(code, message);
  return createJsonResponse(body, status, requestId);
}

/**
 * Get current billing window (last 30 days by default)
 */
function getCurrentBillingWindow(): { windowStart: string; windowEnd: string } {
  const now = new Date();
  const windowEnd = now.toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const windowStart = thirtyDaysAgo.toISOString();
  return { windowStart, windowEnd };
}

// =============================================================================
// Sponsor Monetization Handler
// =============================================================================

/**
 * Handle sponsor monetization hooks request
 *
 * GET /api/v2/sponsor/:sponsorId/monetization
 *
 * Returns sponsor monetization hooks (billableUnits, billingWindow) in read-only mode.
 * NO billing logic is executed. NO payment processing.
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param requestId - Request ID for tracing
 * @param sponsorId - Sponsor ID from URL path
 * @returns Response with monetization hooks
 */
export async function handleSponsorMonetization(
  request: Request,
  env: MonetizationEnv,
  requestId: string,
  sponsorId: string
): Promise<Response> {
  const startTime = Date.now();

  // Verify monetization hooks are inert (CI/CD gate)
  const inertCheck = checkMonetizationHooksInert();
  if (!inertCheck.inert) {
    // This should never happen - contract violation
    console.error('[MonetizationHooks] CRITICAL: Monetization hooks are not inert!');
    return createErrorResponse(
      MONETIZATION_ERROR_CODES.INTERNAL_ERROR,
      'Monetization hooks are not inert - contract violation',
      500,
      requestId
    );
  }

  // Validate sponsorId
  if (!sponsorId || !sponsorId.trim()) {
    return createErrorResponse(
      MONETIZATION_ERROR_CODES.MISSING_ID,
      'Sponsor ID is required',
      400,
      requestId
    );
  }

  // Validate environment
  if (!env.SHEETS_SPREADSHEET_ID) {
    console.error('[MonetizationHooks] SHEETS_SPREADSHEET_ID not configured');
    return createErrorResponse(
      MONETIZATION_ERROR_CODES.SHEETS_DB_ID_MISSING,
      'Database not configured',
      500,
      requestId
    );
  }

  try {
    // Read sponsors and events in parallel
    // sheetsGetValues throws SheetsReadError on failure
    const [sponsorsResult, eventsResult] = await Promise.all([
      sheetsGetValues(env, env.SHEETS_SPREADSHEET_ID!, `${SPONSORS_SHEET}!${SPONSORS_RANGE}`),
      sheetsGetValues(env, env.SHEETS_SPREADSHEET_ID!, `${EVENTS_SHEET}!${EVENTS_RANGE}`),
    ]);

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
        MONETIZATION_ERROR_CODES.NOT_FOUND,
        `Sponsor not found: ${sponsorId}`,
        404,
        requestId
      );
    }

    // Parse event states for associated events
    const eventRows = eventsResult.values ?? [];
    const eventStatesMap = new Map<string, EventRow>();

    for (const row of eventRows) {
      const parsed = parseEventRow(row);
      if (parsed) {
        eventStatesMap.set(parsed.eventId, parsed);
      }
    }

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
    const legacy: LegacySponsor = {
      id: sponsorRow.sponsorId,
      name: sponsorRow.name,
      tier: sponsorRow.tier ?? undefined,
      logoUrl: sponsorRow.logoUrl ?? undefined,
      linkUrl: sponsorRow.linkUrl ?? undefined,
      placements: sponsorRow.dataJson?.placements as SponsorContract['placements'] ?? undefined,
    };
    const sponsorContract = normalizeSponsor(legacy, sponsorRow.eventIds);

    // Get billing window
    const { windowStart, windowEnd } = getCurrentBillingWindow();

    // Determine data availability based on eligibility
    const dataAvailable = eligibility.metricsVisible;

    // Build monetization hooks (INERT - no billing logic)
    const monetization = buildMonetizationHooks(
      sponsorContract,
      windowStart,
      windowEnd,
      dataAvailable
    );

    // Log for audit trail
    logMonetizationHooksAccess(sponsorId, monetization);

    // Build response
    const response = buildSponsorMonetizationResponse(
      sponsorContract,
      monetization,
      eligibility
    );

    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      type: 'SPONSOR_MONETIZATION_REQUEST',
      sponsorId,
      billableUnits: monetization.billableUnits,
      dataAvailable,
      durationMs,
      requestId,
      invariant: 'F4_MONETIZATION_HOOKS',
    }));

    return createJsonResponse(response, 200, requestId);
  } catch (error) {
    // Handle SheetsReadError separately
    if (error instanceof SheetsReadError) {
      console.error('[MonetizationHooks] Sheets read error:', error.message);
      return createErrorResponse(
        MONETIZATION_ERROR_CODES.SHEETS_READ_FAILED,
        'Failed to read data from database',
        503,
        requestId
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[MonetizationHooks] Unexpected error:', errorMessage);

    return createErrorResponse(
      MONETIZATION_ERROR_CODES.INTERNAL_ERROR,
      'An error occurred while loading monetization data',
      500,
      requestId
    );
  }
}

// =============================================================================
// Event Monetization Handler
// =============================================================================

/**
 * Handle event monetization hooks request
 *
 * GET /api/v2/event/:eventId/monetization
 *
 * Returns event monetization hooks (billableUnits, billingWindow) in read-only mode.
 * NO billing logic is executed. NO payment processing.
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param requestId - Request ID for tracing
 * @param eventId - Event ID from URL path
 * @returns Response with monetization hooks
 */
export async function handleEventMonetization(
  request: Request,
  env: MonetizationEnv,
  requestId: string,
  eventId: string
): Promise<Response> {
  const startTime = Date.now();

  // Verify monetization hooks are inert (CI/CD gate)
  const inertCheck = checkEventMonetizationHooksInert();
  if (!inertCheck.inert) {
    // This should never happen - contract violation
    console.error('[MonetizationHooks] CRITICAL: Event monetization hooks are not inert!');
    return createErrorResponse(
      MONETIZATION_ERROR_CODES.INTERNAL_ERROR,
      'Monetization hooks are not inert - contract violation',
      500,
      requestId
    );
  }

  // Validate eventId
  if (!eventId || !eventId.trim()) {
    return createErrorResponse(
      MONETIZATION_ERROR_CODES.MISSING_ID,
      'Event ID is required',
      400,
      requestId
    );
  }

  // Validate environment
  if (!env.SHEETS_SPREADSHEET_ID) {
    console.error('[MonetizationHooks] SHEETS_SPREADSHEET_ID not configured');
    return createErrorResponse(
      MONETIZATION_ERROR_CODES.SHEETS_DB_ID_MISSING,
      'Database not configured',
      500,
      requestId
    );
  }

  try {
    // Read events and sponsors sheets
    // sheetsGetValues throws SheetsReadError on failure
    const [eventsResult, sponsorsResult] = await Promise.all([
      sheetsGetValues(env, env.SHEETS_SPREADSHEET_ID!, `${EVENTS_SHEET}!${EVENTS_RANGE}`),
      sheetsGetValues(env, env.SHEETS_SPREADSHEET_ID!, `${SPONSORS_SHEET}!${SPONSORS_RANGE}`),
    ]);

    // Find the requested event
    const eventRows = eventsResult.values ?? [];
    let eventRow: EventRow | null = null;

    for (const row of eventRows) {
      const parsed = parseEventRow(row);
      if (parsed && parsed.eventId === eventId) {
        eventRow = parsed;
        break;
      }
    }

    if (!eventRow) {
      return createErrorResponse(
        MONETIZATION_ERROR_CODES.NOT_FOUND,
        `Event not found: ${eventId}`,
        404,
        requestId
      );
    }

    // Count sponsors for this event
    let sponsorCount = 0;
    const sponsorRows = sponsorsResult.values ?? [];
    for (const row of sponsorRows) {
      const parsed = parseSponsorRow(row);
      if (parsed && parsed.eventIds.includes(eventId)) {
        sponsorCount++;
      }
    }

    // Get billing window
    const { windowStart, windowEnd } = getCurrentBillingWindow();

    // Build integrity metadata
    // Note: In real implementation, this would query actual analytics sources
    const availableSources = ['sheets_data']; // Only sheets data available currently
    const integrity = buildIntegrityMetadata(
      windowStart,
      windowEnd,
      availableSources,
      [...ANALYTICS_DATA_SOURCES]
    );

    // Build event monetization hooks (INERT - no billing logic)
    // Note: Using default metrics since we don't have real analytics yet
    const monetization = buildEventMonetizationHooks(
      DEFAULT_EVENT_METRICS,
      sponsorCount,
      integrity
    );

    // Log for audit trail
    logEventMonetizationAccess(eventId, monetization);

    // Build response
    const response = buildEventMonetizationResponse(
      eventId,
      eventRow.name,
      monetization,
      integrity
    );

    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      type: 'EVENT_MONETIZATION_REQUEST',
      eventId,
      billableUnits: monetization.billableUnits,
      dataAvailable: monetization.dataAvailable,
      durationMs,
      requestId,
      invariant: 'F4_MONETIZATION_HOOKS',
    }));

    return createJsonResponse(response, 200, requestId);
  } catch (error) {
    // Handle SheetsReadError separately
    if (error instanceof SheetsReadError) {
      console.error('[MonetizationHooks] Sheets read error:', error.message);
      return createErrorResponse(
        MONETIZATION_ERROR_CODES.SHEETS_READ_FAILED,
        'Failed to read data from database',
        503,
        requestId
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[MonetizationHooks] Unexpected error:', errorMessage);

    return createErrorResponse(
      MONETIZATION_ERROR_CODES.INTERNAL_ERROR,
      'An error occurred while loading monetization data',
      500,
      requestId
    );
  }
}

/**
 * Handle monetization inertness check
 *
 * GET /api/v2/monetization/inert
 *
 * Returns the inertness status of monetization hooks.
 * Used by CI/CD to verify billing hooks stay inert.
 *
 * @param request - Incoming request
 * @param requestId - Request ID for tracing
 * @returns Response with inertness status
 */
export async function handleMonetizationInertCheck(
  request: Request,
  requestId: string
): Promise<Response> {
  const sponsorInertCheck = checkMonetizationHooksInert();
  const eventInertCheck = checkEventMonetizationHooksInert();

  const response = {
    ok: true,
    sponsor: sponsorInertCheck,
    event: eventInertCheck,
    allInert: sponsorInertCheck.inert && eventInertCheck.inert,
    _contractVersion: SPONSOR_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    _invariant: 'F4_MONETIZATION_HOOKS' as const,
  };

  return createJsonResponse(response, 200, requestId);
}
