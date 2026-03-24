/**
 * V2 Admin Update Event API Handler
 *
 * PUT /api/v2/admin/events/:id
 *
 * Updates an existing event with partial update semantics:
 * - Find row by id
 * - Update only provided fields (unset fields remain unchanged)
 * - Uses Sheets Write Client (Story C2)
 *
 * @module handlers/v2AdminUpdateEvent
 * @see Story C4 - Admin Endpoint: Update Event (Minimal)
 */

import {
  findEventRowById,
  sheetsUpdateValues,
  SheetsWriteError,
  SHEETS_WRITE_ERROR_CODES,
  type SheetsWriteEnv,
} from '../google/sheetsWrite';

// =============================================================================
// Constants
// =============================================================================

/** Events sheet name */
const EVENTS_SHEET = 'EVENTS';

/** Valid brands for validation */
const VALID_BRANDS = ['root', 'abc', 'cbc', 'cbl'] as const;
type BrandId = (typeof VALID_BRANDS)[number];

/** Date format regex (YYYY-MM-DD) */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Name constraints per Backend Architect */
const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 200;

/** Column indices for EVENTS sheet (0-based) */
const COL = {
  ID: 0,
  BRAND_ID: 1,
  TEMPLATE_ID: 2,
  DATA_JSON: 3,
  CREATED_AT: 4,
  SLUG: 5,
  UPDATED_AT: 6,
} as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings for V2 admin update event handler
 */
export interface V2AdminUpdateEventEnv extends SheetsWriteEnv {
  WORKER_ENV?: string;
}

/**
 * Request body for updating an event (V2)
 *
 * Per Story C4: Partial update allowed, unset fields remain unchanged
 */
export interface V2UpdateEventRequestBody {
  /** Event name (optional) */
  name?: string;
  /** Brand identifier (optional) */
  brand?: string;
  /** Event start date in YYYY-MM-DD format (optional) */
  startDateISO?: string;
  /** URL-friendly slug (optional) */
  slug?: string;
  /** Seed mode for bracket generation (optional) */
  seedMode?: string;
  /** Elimination type (optional) */
  elimType?: string;
}

/**
 * Updated event item returned in response
 */
export interface V2UpdatedEventItem {
  /** Unique event ID */
  id: string;
  /** Event name */
  name: string;
  /** Brand identifier */
  brand: string;
  /** URL-friendly slug */
  slug: string;
  /** Event start date (YYYY-MM-DD) if provided */
  startDateISO?: string;
  /** Seed mode if provided */
  seedMode?: string;
  /** Elimination type if provided */
  elimType?: string;
  /** Creation timestamp (ISO) */
  createdAt: string;
  /** Last update timestamp (ISO) */
  updatedAt: string;
}

/**
 * Success response for V2 admin update event
 */
export interface V2AdminUpdateEventResponse {
  ok: true;
  status: 200;
  item: V2UpdatedEventItem;
  requestId: string;
}

/**
 * Error response for V2 admin update event
 */
export interface V2AdminUpdateEventErrorResponse {
  ok: false;
  status: number;
  code: string;
  message: string;
  requestId: string;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Check if a brand ID is valid
 */
function isValidBrand(brandId: string): brandId is BrandId {
  return VALID_BRANDS.includes(brandId as BrandId);
}

/**
 * Validate date format (YYYY-MM-DD)
 */
function isValidDateFormat(date: string): boolean {
  return DATE_REGEX.test(date);
}

/**
 * Validation result type
 */
type ValidationResult =
  | { valid: true; data: V2UpdateEventRequestBody }
  | { valid: false; code: string; error: string };

/**
 * Check if body is empty (no updateable fields provided)
 */
function isEmptyPayload(obj: Record<string, unknown>): boolean {
  const updateableFields = ['name', 'brand', 'startDateISO', 'slug', 'seedMode', 'elimType'];
  return !updateableFields.some(field => obj[field] !== undefined);
}

/**
 * Validate request body for update
 *
 * Per Story D1:
 * - Partial update allowed
 * - Reject empty JSON (BAD_JSON)
 * - Reject invalid date format (BAD_START_DATE)
 * - All fields optional but must be valid if present
 */
function validateRequestBody(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, code: 'BAD_JSON', error: 'Request body must be a JSON object' };
  }

  const obj = body as Record<string, unknown>;

  // Per Story D1: Reject empty JSON payload
  if (isEmptyPayload(obj)) {
    return { valid: false, code: 'BAD_JSON', error: 'Request body must contain at least one updateable field' };
  }

  const data: V2UpdateEventRequestBody = {};

  // Validate name (optional but must be valid if present)
  if (obj.name !== undefined) {
    if (typeof obj.name !== 'string') {
      return { valid: false, code: 'BAD_JSON', error: 'name must be a string' };
    }
    const name = obj.name.trim();
    if (name.length < NAME_MIN_LENGTH) {
      return { valid: false, code: 'BAD_JSON', error: 'name cannot be empty' };
    }
    if (name.length > NAME_MAX_LENGTH) {
      return { valid: false, code: 'BAD_JSON', error: `name exceeds maximum length of ${NAME_MAX_LENGTH} characters` };
    }
    data.name = name;
  }

  // Validate brand (optional but must be valid if present)
  if (obj.brand !== undefined) {
    if (typeof obj.brand !== 'string') {
      return { valid: false, code: 'BAD_JSON', error: 'brand must be a string' };
    }
    if (!isValidBrand(obj.brand)) {
      return { valid: false, code: 'BAD_JSON', error: `Invalid brand: ${obj.brand}. Valid brands: ${VALID_BRANDS.join(', ')}` };
    }
    data.brand = obj.brand;
  }

  // Validate startDateISO (optional but must be YYYY-MM-DD if present)
  // Per Story D1: Invalid date format returns BAD_START_DATE
  if (obj.startDateISO !== undefined) {
    if (typeof obj.startDateISO !== 'string') {
      return { valid: false, code: 'BAD_START_DATE', error: 'startDateISO must be a string' };
    }
    if (!isValidDateFormat(obj.startDateISO)) {
      return { valid: false, code: 'BAD_START_DATE', error: 'Invalid date format: startDateISO must be YYYY-MM-DD' };
    }
    data.startDateISO = obj.startDateISO;
  }

  // Validate slug (optional string)
  if (obj.slug !== undefined) {
    if (typeof obj.slug !== 'string') {
      return { valid: false, code: 'BAD_JSON', error: 'slug must be a string' };
    }
    data.slug = obj.slug;
  }

  // Validate seedMode (optional string)
  if (obj.seedMode !== undefined) {
    if (typeof obj.seedMode !== 'string') {
      return { valid: false, code: 'BAD_JSON', error: 'seedMode must be a string' };
    }
    data.seedMode = obj.seedMode;
  }

  // Validate elimType (optional string)
  if (obj.elimType !== undefined) {
    if (typeof obj.elimType !== 'string') {
      return { valid: false, code: 'BAD_JSON', error: 'elimType must be a string' };
    }
    data.elimType = obj.elimType;
  }

  return { valid: true, data };
}

// =============================================================================
// Response Factories
// =============================================================================

/**
 * Create success response (200 OK)
 */
function createSuccessResponse(item: V2UpdatedEventItem, requestId: string): Response {
  const body: V2AdminUpdateEventResponse = {
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
  const body: V2AdminUpdateEventErrorResponse = {
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
 * Handle PUT /api/v2/admin/events/:id
 *
 * Updates an existing event with partial update semantics:
 * - Unset fields remain unchanged
 * - If event not found, returns 404 with code: NOT_FOUND
 *
 * Request body (JSON):
 * - name (optional): Event name (1-200 chars)
 * - brand (optional): Brand ID
 * - startDateISO (optional): Event date in YYYY-MM-DD format
 * - slug (optional): URL-friendly slug
 * - seedMode (optional): Bracket seed mode
 * - elimType (optional): Elimination type
 *
 * Response format:
 * - Success: { ok: true, status: 200, item: {...} }
 * - Not found: { ok: false, status: 404, code: 'NOT_FOUND', message: ..., requestId: ... }
 * - Validation error: { ok: false, status: 400, code: 'BAD_INPUT', message: ..., requestId: ... }
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param requestId - Request ID for tracing
 * @param eventId - Event ID from URL path
 * @returns Response with updated event or error
 */
export async function handleV2AdminUpdateEvent(
  request: Request,
  env: V2AdminUpdateEventEnv,
  requestId: string,
  eventId: string
): Promise<Response> {
  // Note: Auth is already handled by router's guardV2AdminRoute

  // Validate HTTP method
  if (request.method !== 'PUT') {
    return createErrorResponse(
      'METHOD_NOT_ALLOWED',
      'Only PUT method is allowed',
      405,
      requestId
    );
  }

  // Validate Content-Type
  const contentType = request.headers.get('Content-Type');
  if (!contentType?.includes('application/json')) {
    return createErrorResponse(
      'BAD_INPUT',
      'Content-Type must be application/json',
      400,
      requestId
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return createErrorResponse(
      'BAD_INPUT',
      'Invalid JSON body',
      400,
      requestId
    );
  }

  // Validate request body
  const validation = validateRequestBody(body);
  if (!validation.valid) {
    return createErrorResponse(validation.code, validation.error, 400, requestId);
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
    // Find the event row by ID
    const findResult = await findEventRowById(env, env.SHEETS_SPREADSHEET_ID!, EVENTS_SHEET, eventId);

    if (!findResult.found || !findResult.rowNumber || !findResult.rowData) {
      // Per Story C4: 404 with code: NOT_FOUND
      console.log(JSON.stringify({
        type: 'V2_UPDATE_EVENT_NOT_FOUND',
        requestId,
        eventId,
        timestamp: now,
      }));

      return createErrorResponse(
        'NOT_FOUND',
        `Event with ID '${eventId}' not found`,
        404,
        requestId
      );
    }

    // Parse existing DATA_JSON
    let existingData: Record<string, unknown> = {};
    try {
      const dataJsonStr = findResult.rowData[COL.DATA_JSON];
      if (dataJsonStr) {
        existingData = JSON.parse(dataJsonStr);
      }
    } catch {
      // If parsing fails, start with empty object
      console.warn(JSON.stringify({
        type: 'V2_UPDATE_EVENT_PARSE_WARNING',
        requestId,
        eventId,
        message: 'Failed to parse existing DATA_JSON, using empty object',
        timestamp: now,
      }));
    }

    // Merge updated fields with existing data
    // Type for the event data stored in DATA_JSON
    interface EventDataJson {
      id: string;
      name?: string;
      brand?: string;
      brandId?: string;
      slug?: string;
      startDateISO?: string;
      seedMode?: string;
      elimType?: string;
      createdAt?: string;
      updatedAt?: string;
      [key: string]: unknown;
    }

    const updatedData: EventDataJson = {
      ...existingData,
      id: eventId, // Preserve ID
      createdAt: (findResult.rowData[COL.CREATED_AT] || existingData.createdAt || now) as string,
      updatedAt: now, // Update timestamp
    };

    // Apply updates from request body
    if (validation.data.name !== undefined) {
      updatedData.name = validation.data.name;
    }
    if (validation.data.brand !== undefined) {
      updatedData.brand = validation.data.brand;
      updatedData.brandId = validation.data.brand; // Alias for compatibility
    }
    if (validation.data.startDateISO !== undefined) {
      updatedData.startDateISO = validation.data.startDateISO;
    }
    if (validation.data.slug !== undefined) {
      updatedData.slug = validation.data.slug;
    }
    if (validation.data.seedMode !== undefined) {
      updatedData.seedMode = validation.data.seedMode;
    }
    if (validation.data.elimType !== undefined) {
      updatedData.elimType = validation.data.elimType;
    }

    // Build the updated row
    // Columns: ID, BRAND_ID, TEMPLATE_ID, DATA_JSON, CREATED_AT, SLUG, UPDATED_AT
    const updatedRow: (string | null)[] = [
      eventId,                                                             // ID (unchanged)
      validation.data.brand || findResult.rowData[COL.BRAND_ID] || 'root', // BRAND_ID
      findResult.rowData[COL.TEMPLATE_ID] || null,                         // TEMPLATE_ID (unchanged)
      JSON.stringify(updatedData),                                         // DATA_JSON
      findResult.rowData[COL.CREATED_AT] || now,                           // CREATED_AT (unchanged)
      validation.data.slug || findResult.rowData[COL.SLUG] || '',          // SLUG
      now,                                                                 // UPDATED_AT
    ];

    // Update the row in Sheets
    const range = `${EVENTS_SHEET}!A${findResult.rowNumber}:G${findResult.rowNumber}`;
    const updateResult = await sheetsUpdateValues(env, env.SHEETS_SPREADSHEET_ID!, range, [updatedRow]);

    // Verify update succeeded
    if (updateResult.updatedRows !== 1) {
      console.error(JSON.stringify({
        type: 'V2_UPDATE_EVENT_UPDATE_MISMATCH',
        requestId,
        eventId,
        expected: 1,
        actual: updateResult.updatedRows,
        timestamp: now,
      }));
      return createErrorResponse(
        'INTERNAL',
        'Event row was not updated correctly',
        500,
        requestId
      );
    }

    // Build the response item
    const item: V2UpdatedEventItem = {
      id: eventId,
      name: updatedData.name as string || '',
      brand: updatedData.brand as string || 'root',
      slug: updatedData.slug as string || '',
      createdAt: updatedData.createdAt as string,
      updatedAt: now,
    };

    // Add optional fields if present
    if (updatedData.startDateISO) {
      item.startDateISO = updatedData.startDateISO as string;
    }
    if (updatedData.seedMode) {
      item.seedMode = updatedData.seedMode as string;
    }
    if (updatedData.elimType) {
      item.elimType = updatedData.elimType as string;
    }

    // Log success
    console.log(JSON.stringify({
      type: 'V2_UPDATE_EVENT_SUCCESS',
      requestId,
      eventId,
      updatedFields: Object.keys(validation.data),
      timestamp: now,
    }));

    return createSuccessResponse(item, requestId);
  } catch (error) {
    // Handle Sheets write errors
    if (error instanceof SheetsWriteError) {
      console.error(JSON.stringify({
        type: 'V2_UPDATE_EVENT_SHEETS_ERROR',
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
        'Failed to update event in Google Sheets',
        503,
        requestId
      );
    }

    // Handle unexpected errors
    console.error(JSON.stringify({
      type: 'V2_UPDATE_EVENT_ERROR',
      requestId,
      eventId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: now,
    }));

    return createErrorResponse(
      'INTERNAL',
      'Failed to update event',
      500,
      requestId
    );
  }
}
