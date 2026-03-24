/**
 * V2 Admin Archive/Unarchive Event API Handler
 *
 * POST /api/v2/admin/events/:id/archive
 * POST /api/v2/admin/events/:id/unarchive
 *
 * Archives or unarchives an event by setting status column:
 * - archive: status = 'archived'
 * - unarchive: status = 'active'
 *
 * Per Story D2:
 * - Idempotent: archiving twice returns 200
 * - No rows deleted
 * - Uses status column (H) in EVENTS sheet
 *
 * @module handlers/v2AdminArchiveEvent
 * @see Story D2 - Archive/Unarchive Event
 */

import {
  updateEventStatus,
  SheetsWriteError,
  SHEETS_WRITE_ERROR_CODES,
  EVENT_STATUS,
  type SheetsWriteEnv,
  type EventStatus,
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
 * Environment bindings for V2 admin archive event handler
 */
export interface V2AdminArchiveEventEnv extends SheetsWriteEnv {
  WORKER_ENV?: string;
}

/**
 * Archived/Unarchived event item returned in response
 */
export interface V2ArchivedEventItem {
  /** Unique event ID */
  id: string;
  /** Event status after operation */
  status: EventStatus;
  /** Operation performed */
  operation: 'archive' | 'unarchive';
  /** Timestamp of operation (ISO) */
  updatedAt: string;
}

/**
 * Success response for V2 admin archive/unarchive event
 */
export interface V2AdminArchiveEventResponse {
  ok: true;
  status: 200;
  item: V2ArchivedEventItem;
  requestId: string;
}

/**
 * Error response for V2 admin archive/unarchive event
 */
export interface V2AdminArchiveEventErrorResponse {
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
function createSuccessResponse(item: V2ArchivedEventItem, requestId: string): Response {
  const body: V2AdminArchiveEventResponse = {
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
  const body: V2AdminArchiveEventErrorResponse = {
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
 * Handle POST /api/v2/admin/events/:id/archive
 *
 * Archives an event by setting status = 'archived'
 *
 * Per Story D2:
 * - Idempotent: archiving twice returns 200
 * - Sets status = 'archived'
 *
 * Response format:
 * - Success: { ok: true, status: 200, item: {...}, requestId: ... }
 * - Not found: { ok: false, status: 404, code: 'NOT_FOUND', message: ..., requestId: ... }
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param requestId - Request ID for tracing
 * @param eventId - Event ID from URL path
 * @returns Response with archived event or error
 */
export async function handleV2AdminArchiveEvent(
  request: Request,
  env: V2AdminArchiveEventEnv,
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
    // Update status to 'archived'
    // This is idempotent - archiving twice just sets the same value
    await updateEventStatus(env, env.SHEETS_SPREADSHEET_ID!, EVENTS_SHEET, eventId, EVENT_STATUS.ARCHIVED);

    // Build the response item
    const item: V2ArchivedEventItem = {
      id: eventId,
      status: EVENT_STATUS.ARCHIVED,
      operation: 'archive',
      updatedAt: now,
    };

    // Log success
    console.log(JSON.stringify({
      type: 'V2_ARCHIVE_EVENT_SUCCESS',
      requestId,
      eventId,
      status: EVENT_STATUS.ARCHIVED,
      timestamp: now,
    }));

    return createSuccessResponse(item, requestId);
  } catch (error) {
    // Handle Sheets write errors
    if (error instanceof SheetsWriteError) {
      console.error(JSON.stringify({
        type: 'V2_ARCHIVE_EVENT_SHEETS_ERROR',
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
        'Failed to archive event in Google Sheets',
        503,
        requestId
      );
    }

    // Handle unexpected errors
    console.error(JSON.stringify({
      type: 'V2_ARCHIVE_EVENT_ERROR',
      requestId,
      eventId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: now,
    }));

    return createErrorResponse(
      'INTERNAL',
      'Failed to archive event',
      500,
      requestId
    );
  }
}

/**
 * Handle POST /api/v2/admin/events/:id/unarchive
 *
 * Unarchives an event by setting status = 'active'
 *
 * Per Story D2:
 * - Idempotent: unarchiving twice returns 200
 * - Sets status = 'active'
 *
 * Response format:
 * - Success: { ok: true, status: 200, item: {...}, requestId: ... }
 * - Not found: { ok: false, status: 404, code: 'NOT_FOUND', message: ..., requestId: ... }
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param requestId - Request ID for tracing
 * @param eventId - Event ID from URL path
 * @returns Response with unarchived event or error
 */
export async function handleV2AdminUnarchiveEvent(
  request: Request,
  env: V2AdminArchiveEventEnv,
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
    // Update status to 'active'
    // This is idempotent - unarchiving twice just sets the same value
    await updateEventStatus(env, env.SHEETS_SPREADSHEET_ID!, EVENTS_SHEET, eventId, EVENT_STATUS.ACTIVE);

    // Build the response item
    const item: V2ArchivedEventItem = {
      id: eventId,
      status: EVENT_STATUS.ACTIVE,
      operation: 'unarchive',
      updatedAt: now,
    };

    // Log success
    console.log(JSON.stringify({
      type: 'V2_UNARCHIVE_EVENT_SUCCESS',
      requestId,
      eventId,
      status: EVENT_STATUS.ACTIVE,
      timestamp: now,
    }));

    return createSuccessResponse(item, requestId);
  } catch (error) {
    // Handle Sheets write errors
    if (error instanceof SheetsWriteError) {
      console.error(JSON.stringify({
        type: 'V2_UNARCHIVE_EVENT_SHEETS_ERROR',
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
        'Failed to unarchive event in Google Sheets',
        503,
        requestId
      );
    }

    // Handle unexpected errors
    console.error(JSON.stringify({
      type: 'V2_UNARCHIVE_EVENT_ERROR',
      requestId,
      eventId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: now,
    }));

    return createErrorResponse(
      'INTERNAL',
      'Failed to unarchive event',
      500,
      requestId
    );
  }
}
