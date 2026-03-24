/**
 * V2 Admin Verify QR Handler
 *
 * Story E2: Verified-QR-Only Enforcement
 *
 * Provides endpoint to mark event QR codes as verified, transitioning
 * the event from READY to ACTIVE state and making it renderable on
 * public surfaces.
 *
 * POST /api/v2/admin/events/:id/verify-qr
 *
 * Contract:
 * - Only verified events can be displayed on public/display/poster surfaces
 * - Once verified, event assetState becomes ACTIVE
 * - Verification is idempotent (re-verifying is a no-op)
 *
 * @module handlers/v2AdminVerifyQr
 * @see Story E2 - Verified-QR-Only Enforcement
 */

import {
  findEventRowById,
  sheetsUpdateValues,
  SheetsWriteError,
  SHEETS_WRITE_ERROR_CODES,
  type SheetsWriteEnv,
} from '../google/sheetsWrite';

import { ASSET_STATE_COLUMN_INDEX } from '../domain/assetState';

// =============================================================================
// Constants
// =============================================================================

/** Column index for DATA_JSON (0-based) */
const DATA_JSON_COLUMN_INDEX = 3;

/** Column index for UPDATED_AT (0-based) */
const UPDATED_AT_COLUMN_INDEX = 6;

/** Error codes for QR verification */
export const VERIFY_QR_ERROR_CODES = {
  /** Missing event ID parameter */
  MISSING_EVENT_ID: 'MISSING_EVENT_ID',
  /** Event not found */
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  /** Sheets update failed */
  SHEETS_UPDATE_FAILED: 'SHEETS_UPDATE_FAILED',
} as const;

export type VerifyQrErrorCode = typeof VERIFY_QR_ERROR_CODES[keyof typeof VERIFY_QR_ERROR_CODES];

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings for QR verification handler
 */
export interface V2AdminVerifyQrEnv extends SheetsWriteEnv {
  /** Google Sheets spreadsheet ID */
  SHEETS_SPREADSHEET_ID?: string;
}

/**
 * Success response shape
 */
export interface V2VerifyQrResponse {
  ok: true;
  status: 200;
  item: {
    id: string;
    qrVerified: boolean;
    assetState: 'ACTIVE';
    verifiedAt: string;
  };
  requestId: string;
}

/**
 * Error response shape
 */
export interface V2VerifyQrErrorResponse {
  ok: false;
  status: number;
  code: VerifyQrErrorCode;
  error: string;
  requestId: string;
  timestamp: string;
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle POST /api/v2/admin/events/:id/verify-qr
 *
 * Marks an event's QR codes as verified, transitioning it to ACTIVE state.
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param eventId - Event ID from URL path
 * @returns Response with verified event or error
 *
 * @example
 * // Request
 * POST /api/v2/admin/events/evt-abc123/verify-qr
 *
 * // Response (200 OK)
 * {
 *   "ok": true,
 *   "status": 200,
 *   "item": {
 *     "id": "evt-abc123",
 *     "qrVerified": true,
 *     "assetState": "ACTIVE",
 *     "verifiedAt": "2025-01-15T12:00:00.000Z"
 *   },
 *   "requestId": "req-xyz789"
 * }
 */
export async function handleV2AdminVerifyQr(
  request: Request,
  env: V2AdminVerifyQrEnv,
  eventId: string
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // Validate event ID
  if (!eventId || eventId.trim() === '') {
    return createErrorResponse(
      400,
      VERIFY_QR_ERROR_CODES.MISSING_EVENT_ID,
      'Event ID is required',
      requestId,
      timestamp
    );
  }

  // Validate spreadsheet ID
  const spreadsheetId = env.SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    return createErrorResponse(
      503,
      VERIFY_QR_ERROR_CODES.SHEETS_UPDATE_FAILED,
      'Sheets database not configured',
      requestId,
      timestamp
    );
  }

  try {
    // Find the event row
    const findResult = await findEventRowById(
      env,
      spreadsheetId,
      'EVENTS',
      eventId
    );

    if (!findResult.found || !findResult.rowNumber || !findResult.rowData) {
      return createErrorResponse(
        404,
        VERIFY_QR_ERROR_CODES.EVENT_NOT_FOUND,
        `Event with ID '${eventId}' not found`,
        requestId,
        timestamp
      );
    }

    // Parse existing DATA_JSON
    const dataJsonStr = findResult.rowData[DATA_JSON_COLUMN_INDEX] || '{}';
    let eventData: Record<string, unknown>;
    try {
      eventData = JSON.parse(dataJsonStr);
    } catch {
      eventData = {};
    }

    // Check if already verified (idempotent operation)
    if (eventData.qrVerified === true) {
      // Already verified, return success with existing data
      console.log(JSON.stringify({
        type: 'QR_VERIFY_IDEMPOTENT',
        eventId,
        requestId,
        message: 'Event already verified',
        timestamp,
      }));

      const response: V2VerifyQrResponse = {
        ok: true,
        status: 200,
        item: {
          id: eventId,
          qrVerified: true,
          assetState: 'ACTIVE',
          verifiedAt: eventData.qrVerifiedAt as string || timestamp,
        },
        requestId,
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
      });
    }

    // Update DATA_JSON with qrVerified flag
    eventData.qrVerified = true;
    eventData.qrVerifiedAt = timestamp;
    const updatedDataJson = JSON.stringify(eventData);

    // Update the row with new DATA_JSON, assetState, and updated timestamp
    // We need to update multiple columns:
    // - Column D (index 3): DATA_JSON with qrVerified
    // - Column G (index 6): UPDATED_AT
    // - Column J (index 9): ASSET_STATE = 'ACTIVE'

    // Update DATA_JSON column
    const dataJsonRange = `EVENTS!D${findResult.rowNumber}`;
    await sheetsUpdateValues(env, spreadsheetId, dataJsonRange, [[updatedDataJson]]);

    // Update UPDATED_AT column
    const updatedAtRange = `EVENTS!G${findResult.rowNumber}`;
    await sheetsUpdateValues(env, spreadsheetId, updatedAtRange, [[timestamp]]);

    // Update ASSET_STATE column
    const assetStateRange = `EVENTS!J${findResult.rowNumber}`;
    await sheetsUpdateValues(env, spreadsheetId, assetStateRange, [['ACTIVE']]);

    // Log success
    console.log(JSON.stringify({
      type: 'QR_VERIFIED',
      eventId,
      requestId,
      timestamp,
    }));

    // Return success response
    const response: V2VerifyQrResponse = {
      ok: true,
      status: 200,
      item: {
        id: eventId,
        qrVerified: true,
        assetState: 'ACTIVE',
        verifiedAt: timestamp,
      },
      requestId,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
    });

  } catch (error) {
    // Handle Sheets errors
    if (error instanceof SheetsWriteError) {
      if (error.code === SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND) {
        return createErrorResponse(
          404,
          VERIFY_QR_ERROR_CODES.EVENT_NOT_FOUND,
          error.message,
          requestId,
          timestamp
        );
      }

      return createErrorResponse(
        503,
        VERIFY_QR_ERROR_CODES.SHEETS_UPDATE_FAILED,
        error.message,
        requestId,
        timestamp
      );
    }

    // Handle unexpected errors
    console.error(JSON.stringify({
      type: 'QR_VERIFY_ERROR',
      eventId,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId,
      timestamp,
    }));

    return createErrorResponse(
      500,
      VERIFY_QR_ERROR_CODES.SHEETS_UPDATE_FAILED,
      `Failed to verify QR: ${error instanceof Error ? error.message : 'Unknown error'}`,
      requestId,
      timestamp
    );
  }
}

/**
 * Handle POST /api/v2/admin/events/:id/unverify-qr
 *
 * Removes QR verification from an event, transitioning it back to READY state.
 * This is useful for cases where QR codes need to be regenerated.
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param eventId - Event ID from URL path
 * @returns Response with unverified event or error
 */
export async function handleV2AdminUnverifyQr(
  request: Request,
  env: V2AdminVerifyQrEnv,
  eventId: string
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // Validate event ID
  if (!eventId || eventId.trim() === '') {
    return createErrorResponse(
      400,
      VERIFY_QR_ERROR_CODES.MISSING_EVENT_ID,
      'Event ID is required',
      requestId,
      timestamp
    );
  }

  // Validate spreadsheet ID
  const spreadsheetId = env.SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    return createErrorResponse(
      503,
      VERIFY_QR_ERROR_CODES.SHEETS_UPDATE_FAILED,
      'Sheets database not configured',
      requestId,
      timestamp
    );
  }

  try {
    // Find the event row
    const findResult = await findEventRowById(
      env,
      spreadsheetId,
      'EVENTS',
      eventId
    );

    if (!findResult.found || !findResult.rowNumber || !findResult.rowData) {
      return createErrorResponse(
        404,
        VERIFY_QR_ERROR_CODES.EVENT_NOT_FOUND,
        `Event with ID '${eventId}' not found`,
        requestId,
        timestamp
      );
    }

    // Parse existing DATA_JSON
    const dataJsonStr = findResult.rowData[DATA_JSON_COLUMN_INDEX] || '{}';
    let eventData: Record<string, unknown>;
    try {
      eventData = JSON.parse(dataJsonStr);
    } catch {
      eventData = {};
    }

    // Remove qrVerified flag
    delete eventData.qrVerified;
    delete eventData.qrVerifiedAt;
    const updatedDataJson = JSON.stringify(eventData);

    // Update the row
    const dataJsonRange = `EVENTS!D${findResult.rowNumber}`;
    await sheetsUpdateValues(env, spreadsheetId, dataJsonRange, [[updatedDataJson]]);

    // Update UPDATED_AT column
    const updatedAtRange = `EVENTS!G${findResult.rowNumber}`;
    await sheetsUpdateValues(env, spreadsheetId, updatedAtRange, [[timestamp]]);

    // Update ASSET_STATE column back to READY
    const assetStateRange = `EVENTS!J${findResult.rowNumber}`;
    await sheetsUpdateValues(env, spreadsheetId, assetStateRange, [['READY']]);

    // Log success
    console.log(JSON.stringify({
      type: 'QR_UNVERIFIED',
      eventId,
      requestId,
      timestamp,
    }));

    // Return success response
    return new Response(JSON.stringify({
      ok: true,
      status: 200,
      item: {
        id: eventId,
        qrVerified: false,
        assetState: 'READY',
        unverifiedAt: timestamp,
      },
      requestId,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
    });

  } catch (error) {
    // Handle errors
    if (error instanceof SheetsWriteError) {
      if (error.code === SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND) {
        return createErrorResponse(
          404,
          VERIFY_QR_ERROR_CODES.EVENT_NOT_FOUND,
          error.message,
          requestId,
          timestamp
        );
      }

      return createErrorResponse(
        503,
        VERIFY_QR_ERROR_CODES.SHEETS_UPDATE_FAILED,
        error.message,
        requestId,
        timestamp
      );
    }

    return createErrorResponse(
      500,
      VERIFY_QR_ERROR_CODES.SHEETS_UPDATE_FAILED,
      `Failed to unverify QR: ${error instanceof Error ? error.message : 'Unknown error'}`,
      requestId,
      timestamp
    );
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a standardized error response
 */
function createErrorResponse(
  status: number,
  code: VerifyQrErrorCode,
  message: string,
  requestId: string,
  timestamp: string
): Response {
  const body: V2VerifyQrErrorResponse = {
    ok: false,
    status,
    code,
    error: message,
    requestId,
    timestamp,
  };

  // Log error for CI/CD gates
  console.error(JSON.stringify({
    type: 'QR_VERIFY_ERROR',
    code,
    status,
    requestId,
    timestamp,
  }));

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}
