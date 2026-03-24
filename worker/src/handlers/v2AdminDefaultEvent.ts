/**
 * V2 Admin Default Event API Handler
 *
 * POST /api/v2/admin/events/:id/default
 *
 * Sets an event as the default for its brand.
 *
 * Per Story D3 - Default Event Enforcement:
 * - Exactly ONE default event per brand
 * - Find all events for brand
 * - Unset existing defaults
 * - Set target event as default
 * - Ensure no double-default state possible
 *
 * @module handlers/v2AdminDefaultEvent
 * @see Story D3 - Default Event Enforcement
 */

import {
  setEventAsDefault,
  SheetsWriteError,
  SHEETS_WRITE_ERROR_CODES,
  type SheetsWriteEnv,
  type SetDefaultEventResult,
} from '../google/sheetsWrite';

// =============================================================================
// Constants
// =============================================================================

/** Events sheet name */
const EVENTS_SHEET = 'EVENTS';

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings for V2 admin default event handler
 */
export interface V2AdminDefaultEventEnv extends SheetsWriteEnv {
  WORKER_ENV?: string;
}

/**
 * Default event item returned in response
 */
export interface V2DefaultEventItem {
  /** Unique event ID that was set as default */
  id: string;
  /** Brand for which this event is now the default */
  brand: string;
  /** Whether this event is now the default */
  isDefault: true;
  /** IDs of events that were previously default (now unset) */
  previousDefaults: string[];
  /** Timestamp of operation (ISO) */
  updatedAt: string;
}

/**
 * Success response for V2 admin default event
 */
export interface V2AdminDefaultEventResponse {
  ok: true;
  status: 200;
  item: V2DefaultEventItem;
  requestId: string;
}

/**
 * Error response for V2 admin default event
 */
export interface V2AdminDefaultEventErrorResponse {
  ok: false;
  status: number;
  code: string;
  message: string;
  requestId: string;
}

// =============================================================================
// Response Factories
// =============================================================================

/**
 * Create success response (200 OK)
 */
function createSuccessResponse(item: V2DefaultEventItem, requestId: string): Response {
  const body: V2AdminDefaultEventResponse = {
    ok: true,
    status: 200,
    item,
    requestId,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}

/**
 * Create error response with standard format
 */
function createErrorResponse(
  code: string,
  message: string,
  status: number,
  requestId: string
): Response {
  const body: V2AdminDefaultEventErrorResponse = {
    ok: false,
    status,
    code,
    message,
    requestId,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle POST /api/v2/admin/events/:id/default
 *
 * Sets an event as the default for its brand.
 *
 * Per Story D3:
 * - Exactly ONE default event per brand
 * - Finds all events for brand
 * - Unsets existing defaults
 * - Sets target event as default
 * - Idempotent: setting default twice returns 200
 *
 * Response format:
 * - Success: { ok: true, status: 200, item: {...}, requestId: ... }
 * - Not found: { ok: false, status: 404, code: 'NOT_FOUND', message: ..., requestId: ... }
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param requestId - Request ID for tracing
 * @param eventId - Event ID from URL path
 * @returns Response with default event or error
 */
export async function handleV2AdminDefaultEvent(
  request: Request,
  env: V2AdminDefaultEventEnv,
  requestId: string,
  eventId: string
): Promise<Response> {
  // Note: Auth is already handled by router's guardV2AdminRoute

  // Validate HTTP method
  if (request.method !== 'POST') {
    return createErrorResponse(
      'METHOD_NOT_ALLOWED',
      'Only POST method is allowed',
      405,
      requestId
    );
  }

  // Check if Sheets is configured
  if (!env.SHEETS_SPREADSHEET_ID) {
    return createErrorResponse(
      'NOT_CONFIGURED',
      'Google Sheets not configured',
      503,
      requestId
    );
  }

  const now = new Date().toISOString();

  try {
    // Set the event as default for its brand
    // This operation:
    // 1. Finds all events for the brand
    // 2. Unsets existing defaults
    // 3. Sets target event as default
    const result: SetDefaultEventResult = await setEventAsDefault(
      env,
      env.SHEETS_SPREADSHEET_ID!,
      EVENTS_SHEET,
      eventId
    );

    // Build the response item
    const item: V2DefaultEventItem = {
      id: eventId,
      brand: result.brand,
      isDefault: true,
      previousDefaults: result.previousDefaults,
      updatedAt: now,
    };

    // Log success
    console.log(JSON.stringify({
      type: 'V2_DEFAULT_EVENT_SUCCESS',
      requestId,
      eventId,
      brand: result.brand,
      previousDefaults: result.previousDefaults,
      timestamp: now,
    }));

    return createSuccessResponse(item, requestId);
  } catch (error) {
    // Handle Sheets write errors
    if (error instanceof SheetsWriteError) {
      console.error(JSON.stringify({
        type: 'V2_DEFAULT_EVENT_SHEETS_ERROR',
        requestId,
        eventId,
        code: error.code,
        message: error.message,
        googleStatus: error.googleStatus,
        timestamp: now,
      }));

      // Check for NOT_FOUND error code
      if (error.code === SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND) {
        return createErrorResponse(
          'NOT_FOUND',
          `Event with ID '${eventId}' not found`,
          404,
          requestId
        );
      }

      return createErrorResponse(
        'SHEETS_ERROR',
        'Failed to set default event in Google Sheets',
        503,
        requestId
      );
    }

    // Handle unexpected errors
    console.error(JSON.stringify({
      type: 'V2_DEFAULT_EVENT_ERROR',
      requestId,
      eventId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: now,
    }));

    return createErrorResponse(
      'INTERNAL',
      'Failed to set default event',
      500,
      requestId
    );
  }
}
