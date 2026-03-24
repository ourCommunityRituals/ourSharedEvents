/**
 * SharedReport Handler
 *
 * Story F6: SharedAnalytics Bundle Contract (Event + Sponsor + Customer)
 *
 * Purpose: Provide a single, trustworthy "post-event summary" payload
 * that supports SharedReport and can be emailed/shared later.
 *
 * GET /api/v2/sharedreport?eventId=...
 *
 * Error Codes:
 *   - 404 NOT_FOUND: Invalid eventId
 *   - 503 ANALYTICS_UNAVAILABLE: Analytics service unavailable
 *   - 200 with integrity.complete=false: Bundle incomplete but usable
 *
 * System Impacts:
 *   - Upstream: relies on event + sponsor analytics sources
 *   - Downstream: SharedReport becomes canonical single report surface
 *
 * @module handlers/sharedReport
 * @see Story F6 - SharedAnalytics Bundle Contract (Event + Sponsor + Customer)
 */

import {
  sheetsGetValues,
  type SheetsEnv,
} from '../google/sheets';

import {
  type SharedAnalyticsBundle,
  type SharedAnalyticsEvent,
  type SharedAnalyticsSponsor,
  type SharedAnalyticsCustomer,
  type SharedAnalyticsIntegrity,
  type SharedAnalyticsSponsorPlacement,
  SHARED_ANALYTICS_CONTRACT_VERSION,
  SHARED_ANALYTICS_ERROR_CODES,
  buildSharedAnalyticsBundle,
  buildSharedAnalyticsEvent,
  buildSharedAnalyticsSponsor,
  buildSharedAnalyticsCustomer,
  buildSharedAnalyticsIntegrity,
  buildSharedAnalyticsResponse,
  buildSharedAnalyticsErrorResponse,
  logSharedAnalyticsBundleGeneration,
  logSharedAnalyticsAccess,
  DEFAULT_INTEGRITY,
} from '../domain/sharedAnalytics';

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
 * Error codes for shared report handler
 */
export const SHARED_REPORT_ERROR_CODES = {
  /** SHEETS_SPREADSHEET_ID not configured */
  SHEETS_DB_ID_MISSING: 'SHEETS_DB_ID_MISSING',
  /** Sheets read operation failed */
  SHEETS_READ_FAILED: 'SHEETS_READ_FAILED',
  /** Missing eventId parameter */
  MISSING_EVENT_ID: 'MISSING_EVENT_ID',
  /** Event not found */
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
} as const;

export type SharedReportErrorCode = typeof SHARED_REPORT_ERROR_CODES[keyof typeof SHARED_REPORT_ERROR_CODES];

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

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for shared report handler
 */
export interface SharedReportEnv extends SheetsEnv {
  WORKER_ENV?: string;
  WORKER_BUILD_VERSION?: string;
}

/**
 * Event row from sheets
 */
interface EventRow {
  eventId: string;
  brandId: string;
  templateId: string;
  dataJson: Record<string, unknown> | null;
  createdAt: string;
  slug: string;
  updatedAt: string;
  status: string;
  isDefault: boolean;
  assetState: AssetState;
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

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse event row from sheet data
 */
function parseEventRow(row: unknown[]): EventRow | null {
  const eventId = String(row[EVENT_COL.ID] ?? '').trim();

  if (!eventId) {
    return null;
  }

  // Parse data JSON
  let dataJson: Record<string, unknown> | null = null;
  const dataJsonStr = String(row[EVENT_COL.DATA_JSON] ?? '').trim();
  if (dataJsonStr) {
    try {
      dataJson = JSON.parse(dataJsonStr);
    } catch {
      // Ignore JSON parse errors
    }
  }

  return {
    eventId,
    brandId: String(row[EVENT_COL.BRAND_ID] ?? '').trim(),
    templateId: String(row[EVENT_COL.TEMPLATE_ID] ?? '').trim(),
    dataJson,
    createdAt: String(row[EVENT_COL.CREATED_AT] ?? '').trim(),
    slug: String(row[EVENT_COL.SLUG] ?? '').trim(),
    updatedAt: String(row[EVENT_COL.UPDATED_AT] ?? '').trim(),
    status: String(row[EVENT_COL.STATUS] ?? 'active').trim().toLowerCase(),
    isDefault: String(row[EVENT_COL.IS_DEFAULT] ?? '').toLowerCase() === 'true',
    assetState: parseAssetState(row[EVENT_COL.ASSET_STATE]),
  };
}

/**
 * Parse sponsor row from sheet data
 */
function parseSponsorRow(row: unknown[]): SponsorRow | null {
  const sponsorId = String(row[SPONSOR_COL.SPONSOR_ID] ?? '').trim();
  const name = String(row[SPONSOR_COL.NAME] ?? '').trim();

  if (!sponsorId || !name) {
    return null;
  }

  // Parse event IDs
  const eventIdsStr = String(row[SPONSOR_COL.EVENT_IDS] ?? '').trim();
  const eventIds = eventIdsStr
    ? eventIdsStr.split(',').map((id) => id.trim()).filter(Boolean)
    : [];

  // Parse data JSON
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
 * Build event section from event row and data
 */
function buildEventSection(
  eventRow: EventRow
): { event: SharedAnalyticsEvent; complete: boolean } {
  const dataJson = eventRow.dataJson || {};
  const eventName = String(dataJson.name || dataJson.title || eventRow.eventId);

  // Extract metrics from data (if available)
  const metrics = dataJson.metrics as Record<string, unknown> | undefined;
  const signups = metrics?.signups as number | undefined;
  const matches = metrics?.matches as number | undefined;
  const durationMinutes = metrics?.durationMinutes as number | undefined;
  const pageViews = metrics?.pageViews as number | undefined;
  const uniqueVisitors = metrics?.uniqueVisitors as number | undefined;
  const qrScans = metrics?.qrScans as number | undefined;

  // QR data is only shown if verified (Story E2 invariant)
  const isQrVerified = eventRow.assetState === 'ACTIVE';

  const event = buildSharedAnalyticsEvent(
    eventRow.eventId,
    eventName,
    {
      signups: signups ?? 0,
      matches: matches ?? 0,
      durationMinutes: durationMinutes ?? 0,
    },
    {
      pageViews: pageViews ?? 0,
      uniqueVisitors: uniqueVisitors ?? 0,
    },
    {
      scans: isQrVerified ? (qrScans ?? 0) : 0,
      verifiedOnly: true,
    }
  );

  // Event is complete if we have the basic data
  const complete = Boolean(eventRow.eventId && eventName);

  return { event, complete };
}

/**
 * Build sponsor section from sponsors associated with event
 */
function buildSponsorSection(
  eventId: string,
  sponsors: SponsorRow[]
): { sponsor: SharedAnalyticsSponsor; complete: boolean } {
  // Find sponsors associated with this event
  const eventSponsors = sponsors.filter((s) =>
    s.eventIds.includes(eventId)
  );

  if (eventSponsors.length === 0) {
    // No sponsors - return empty but complete section
    return {
      sponsor: buildSharedAnalyticsSponsor(
        'none',
        'No Sponsor',
        { impressions: 0, qrScans: 0, costPerScan: 0 },
        []
      ),
      complete: true,
    };
  }

  // Use the first sponsor for primary display
  const primarySponsor = eventSponsors[0];

  // Aggregate metrics across all sponsors (for summary)
  let totalImpressions = 0;
  let totalQrScans = 0;
  const placements: SharedAnalyticsSponsorPlacement[] = [];

  for (const sponsor of eventSponsors) {
    const dataJson = sponsor.dataJson || {};
    const metrics = dataJson.metrics as Record<string, unknown> | undefined;

    totalImpressions += (metrics?.impressions as number) || 0;
    totalQrScans += (metrics?.qrScans as number) || 0;

    // Extract placements
    const sponsorPlacements = dataJson.placements as Record<string, boolean> | undefined;
    if (sponsorPlacements) {
      if (sponsorPlacements.posterTop) {
        const existing = placements.find((p) => p.surface === 'poster');
        if (existing) {
          existing.count++;
        } else {
          placements.push({ surface: 'poster', count: 1 });
        }
      }
      if (sponsorPlacements.mobileBanner) {
        const existing = placements.find((p) => p.surface === 'public');
        if (existing) {
          existing.count++;
        } else {
          placements.push({ surface: 'public', count: 1 });
        }
      }
      if (sponsorPlacements.tvTop || sponsorPlacements.tvSide) {
        const existing = placements.find((p) => p.surface === 'display');
        if (existing) {
          existing.count++;
        } else {
          placements.push({ surface: 'display', count: 1 });
        }
      }
    }
  }

  const sponsor = buildSharedAnalyticsSponsor(
    primarySponsor.sponsorId,
    primarySponsor.name,
    {
      impressions: totalImpressions,
      qrScans: totalQrScans,
      costPerScan: 0.0, // Billing not active in MVP
    },
    placements
  );

  return { sponsor, complete: true };
}

/**
 * Build customer section (aggregate only - no PII)
 *
 * INVARIANT: Customer data must be aggregate-only.
 * - No PII
 * - No device IDs
 * - No raw IPs
 */
function buildCustomerSection(
  eventRow: EventRow
): { customer: SharedAnalyticsCustomer; complete: boolean } {
  const dataJson = eventRow.dataJson || {};
  const customerMetrics = dataJson.customerMetrics as Record<string, unknown> | undefined;

  // Extract aggregate-only metrics
  const uniquePeople = (customerMetrics?.uniquePeople as number) || 0;
  const returningRate = (customerMetrics?.returningRate as number) || 0;
  const peakHourLocal = (customerMetrics?.peakHourLocal as string) || '00:00';
  const topZip3 = (customerMetrics?.topZip3 as string[]) || [];
  const rsvpToAttendRate = (customerMetrics?.rsvpToAttendRate as number) || 0;
  const scanToSignupRate = (customerMetrics?.scanToSignupRate as number) || 0;

  const customer = buildSharedAnalyticsCustomer(
    {
      uniquePeople,
      returningRate: Math.min(1, Math.max(0, returningRate)),
      peakHourLocal,
      geo: { topZip3: topZip3.slice(0, 3) },
    },
    {
      rsvpToAttendRate: Math.min(1, Math.max(0, rsvpToAttendRate)),
      scanToSignupRate: Math.min(1, Math.max(0, scanToSignupRate)),
    }
  );

  // Customer section is complete if we have basic data
  const complete = uniquePeople > 0;

  return { customer, complete };
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
      'X-Contract-Version': SHARED_ANALYTICS_CONTRACT_VERSION,
      'X-Request-Id': requestId,
    },
  });
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Handle SharedReport request
 *
 * GET /api/v2/sharedreport?eventId=...
 *
 * Returns the SharedAnalytics bundle for the specified event.
 * Bundle includes integrity metadata and can be rendered even if
 * some sections are incomplete.
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param requestId - Request ID for tracing
 * @returns Response with SharedAnalytics bundle
 */
export async function handleSharedReport(
  request: Request,
  env: SharedReportEnv,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');

  // Validate eventId
  if (!eventId || !eventId.trim()) {
    logSharedAnalyticsAccess('', requestId, false, SHARED_ANALYTICS_ERROR_CODES.INVALID_EVENT_ID);
    return createJsonResponse(
      buildSharedAnalyticsErrorResponse(
        400,
        SHARED_ANALYTICS_ERROR_CODES.INVALID_EVENT_ID,
        'eventId query parameter is required',
        requestId
      ),
      400,
      requestId
    );
  }

  // Validate environment
  if (!env.SHEETS_SPREADSHEET_ID) {
    console.error('[SharedReport] SHEETS_SPREADSHEET_ID not configured');
    logSharedAnalyticsAccess(eventId, requestId, false, SHARED_ANALYTICS_ERROR_CODES.ANALYTICS_UNAVAILABLE);
    return createJsonResponse(
      buildSharedAnalyticsErrorResponse(
        503,
        SHARED_ANALYTICS_ERROR_CODES.ANALYTICS_UNAVAILABLE,
        'Analytics service not configured',
        requestId,
        DEFAULT_INTEGRITY
      ),
      503,
      requestId
    );
  }

  try {
    // Read events and sponsors in parallel
    const [eventsResult, sponsorsResult] = await Promise.all([
      sheetsGetValues(env, EVENTS_SHEET, EVENTS_RANGE),
      sheetsGetValues(env, SPONSORS_SHEET, SPONSORS_RANGE),
    ]);

    // Check if we can read sheets
    if (!eventsResult.ok) {
      console.error('[SharedReport] Failed to read events sheet:', eventsResult.error);
      logSharedAnalyticsAccess(eventId, requestId, false, SHARED_ANALYTICS_ERROR_CODES.ANALYTICS_UNAVAILABLE);
      return createJsonResponse(
        buildSharedAnalyticsErrorResponse(
          503,
          SHARED_ANALYTICS_ERROR_CODES.ANALYTICS_UNAVAILABLE,
          'Failed to read event data',
          requestId,
          { complete: false, stale: false, notes: ['Event data unavailable'] }
        ),
        503,
        requestId
      );
    }

    // Parse events to find the requested one
    const eventRows = eventsResult.values ?? [];
    let targetEvent: EventRow | null = null;

    for (const row of eventRows) {
      const parsed = parseEventRow(row);
      if (parsed && parsed.eventId === eventId) {
        targetEvent = parsed;
        break;
      }
    }

    if (!targetEvent) {
      logSharedAnalyticsAccess(eventId, requestId, false, SHARED_ANALYTICS_ERROR_CODES.NOT_FOUND);
      return createJsonResponse(
        buildSharedAnalyticsErrorResponse(
          404,
          SHARED_ANALYTICS_ERROR_CODES.NOT_FOUND,
          `Event not found: ${eventId}`,
          requestId
        ),
        404,
        requestId
      );
    }

    // Parse sponsors (optional - we can still render without)
    const sponsors: SponsorRow[] = [];
    if (sponsorsResult.ok && sponsorsResult.values) {
      for (const row of sponsorsResult.values) {
        const parsed = parseSponsorRow(row);
        if (parsed) {
          sponsors.push(parsed);
        }
      }
    }

    // Build sections
    const { event, complete: eventComplete } = buildEventSection(targetEvent);
    const { sponsor, complete: sponsorComplete } = buildSponsorSection(eventId, sponsors);
    const { customer, complete: customerComplete } = buildCustomerSection(targetEvent);

    // Build integrity metadata
    const integrity = buildSharedAnalyticsIntegrity(
      eventComplete,
      sponsorComplete,
      customerComplete,
      false // not stale for now
    );

    // Calculate window (use event dates or default to last 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const windowStart = thirtyDaysAgo.toISOString().split('T')[0];
    const windowEnd = now.toISOString().split('T')[0];

    // Build the bundle
    const bundle = buildSharedAnalyticsBundle(
      windowStart,
      windowEnd,
      event,
      sponsor,
      customer,
      integrity
    );

    // Log for audit
    logSharedAnalyticsBundleGeneration(eventId, bundle, requestId);
    logSharedAnalyticsAccess(eventId, requestId, true);

    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      type: 'SHARED_REPORT_REQUEST',
      eventId,
      integrityComplete: integrity.complete,
      sponsorCount: sponsors.filter((s) => s.eventIds.includes(eventId)).length,
      durationMs,
      requestId,
    }));

    // Build and return response
    const response = buildSharedAnalyticsResponse(bundle, requestId);
    return createJsonResponse(response, 200, requestId);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[SharedReport] Unexpected error:', errorMessage);
    logSharedAnalyticsAccess(eventId, requestId, false, SHARED_ANALYTICS_ERROR_CODES.ANALYTICS_UNAVAILABLE);

    return createJsonResponse(
      buildSharedAnalyticsErrorResponse(
        503,
        SHARED_ANALYTICS_ERROR_CODES.ANALYTICS_UNAVAILABLE,
        'An error occurred while generating the report',
        requestId,
        { complete: false, stale: false, notes: ['Internal error'] }
      ),
      503,
      requestId
    );
  }
}
