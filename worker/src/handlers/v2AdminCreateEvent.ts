/**
 * V2 Admin Create Event API Handler
 *
 * POST /api/v2/admin/events
 *
 * Creates a new event with simplified validation:
 * - name is required (everything else optional)
 * - startDateISO optional but if present must be YYYY-MM-DD
 * - Uses new Sheets Write Client (Story C2)
 *
 * @module handlers/v2AdminCreateEvent
 * @see Story C3 - Admin Endpoint: Create Event
 */

import {
  sheetsAppendValues,
  generateShortId,
  SheetsWriteError,
  createSheetsWriteErrorResponse,
  type SheetsWriteEnv,
} from '../google/sheetsWrite';

// =============================================================================
// Constants
// =============================================================================

/** Events sheet name */
const EVENTS_SHEET = 'EVENTS';

/** Events sheet range (7 columns: ID, BRAND_ID, TEMPLATE_ID, DATA_JSON, CREATED_AT, SLUG, UPDATED_AT) */
const EVENTS_RANGE = `${EVENTS_SHEET}!A:G`;

/** Valid brands for validation */
const VALID_BRANDS = ['root', 'abc', 'cbc', 'cbl'] as const;
type BrandId = (typeof VALID_BRANDS)[number];

/** Default brand when not specified */
const DEFAULT_BRAND: BrandId = 'root';

/** Date format regex (YYYY-MM-DD) */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Name constraints per Backend Architect */
const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 200;

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings for V2 admin create event handler
 */
export interface V2AdminCreateEventEnv extends SheetsWriteEnv {
  WORKER_ENV?: string;
}

/**
 * Request body for creating an event (V2)
 *
 * Per PO: name is required, everything else optional
 */
export interface V2CreateEventRequestBody {
  /** Event name (required) */
  name: string;
  /** Brand identifier (optional, defaults to 'root') */
  brand?: string;
  /** Event start date in YYYY-MM-DD format (optional) */
  startDateISO?: string;
  /** URL-friendly slug (optional, generated if not provided) */
  slug?: string;
  /** Seed mode for bracket generation (optional) */
  seedMode?: string;
  /** Elimination type (optional) */
  elimType?: string;
}

/**
 * Created event item returned in response
 */
export interface V2CreatedEventItem {
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
 * Success response for V2 admin create event
 */
export interface V2AdminCreateEventResponse {
  ok: true;
  status: 201;
  item: V2CreatedEventItem;
  requestId: string;
}

/**
 * Error response for V2 admin create event
 */
export interface V2AdminCreateEventErrorResponse {
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
  | { valid: true; data: V2CreateEventRequestBody }
  | { valid: false; code: string; error: string };

/**
 * Validate request body and return errors
 *
 * Per Story C3:
 * - name is required with length constraints
 * - startDateISO optional but must be YYYY-MM-DD if present
 * - brand optional but must be valid if present
 */
function validateRequestBody(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, code: 'BAD_JSON', error: 'Request body must be a JSON object' };
  }

  const obj = body as Record<string, unknown>;

  // Validate name (required)
  if (!obj.name || typeof obj.name !== 'string') {
    return { valid: false, code: 'NAME_REQUIRED', error: 'Missing required field: name' };
  }

  const name = obj.name.trim();
  if (name.length < NAME_MIN_LENGTH) {
    return { valid: false, code: 'NAME_REQUIRED', error: 'name cannot be empty' };
  }
  if (name.length > NAME_MAX_LENGTH) {
    return { valid: false, code: 'NAME_REQUIRED', error: `name exceeds maximum length of ${NAME_MAX_LENGTH} characters` };
  }

  // Validate brand (optional but must be valid if present)
  const brand = obj.brand as string | undefined;
  if (brand !== undefined) {
    if (typeof brand !== 'string') {
      return { valid: false, code: 'BAD_INPUT', error: 'brand must be a string' };
    }
    if (!isValidBrand(brand)) {
      return { valid: false, code: 'BAD_INPUT', error: `Invalid brand: ${brand}. Valid brands: ${VALID_BRANDS.join(', ')}` };
    }
  }

  // Validate startDateISO (optional but must be YYYY-MM-DD if present)
  const startDateISO = obj.startDateISO as string | undefined;
  if (startDateISO !== undefined) {
    if (typeof startDateISO !== 'string') {
      return { valid: false, code: 'BAD_START_DATE', error: 'startDateISO must be a string' };
    }
    if (!isValidDateFormat(startDateISO)) {
      return { valid: false, code: 'BAD_START_DATE', error: 'Invalid date format: startDateISO must be YYYY-MM-DD' };
    }
  }

  // Validate slug (optional string)
  const slug = obj.slug as string | undefined;
  if (slug !== undefined && typeof slug !== 'string') {
    return { valid: false, code: 'BAD_INPUT', error: 'slug must be a string' };
  }

  // Validate seedMode (optional string)
  const seedMode = obj.seedMode as string | undefined;
  if (seedMode !== undefined && typeof seedMode !== 'string') {
    return { valid: false, code: 'BAD_INPUT', error: 'seedMode must be a string' };
  }

  // Validate elimType (optional string)
  const elimType = obj.elimType as string | undefined;
  if (elimType !== undefined && typeof elimType !== 'string') {
    return { valid: false, code: 'BAD_INPUT', error: 'elimType must be a string' };
  }

  return {
    valid: true,
    data: {
      name,
      brand: brand || DEFAULT_BRAND,
      startDateISO,
      slug,
      seedMode,
      elimType,
    },
  };
}

// =============================================================================
// Slug Generation
// =============================================================================

/**
 * Convert a string to a URL-friendly slug
 *
 * - Converts to lowercase
 * - Replaces non-alphanumeric characters with hyphens
 * - Removes leading/trailing hyphens
 * - Truncates to 50 characters
 */
function toSlug(text: string): string {
  if (!text || typeof text !== 'string') {
    return 'event';
  }

  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

  if (!slug) {
    slug = 'event';
  }

  return slug;
}

// =============================================================================
// Response Factories
// =============================================================================

/**
 * Create success response (201 Created)
 */
function createSuccessResponse(item: V2CreatedEventItem, requestId: string): Response {
  const body: V2AdminCreateEventResponse = {
    ok: true,
    status: 201,
    item,
    requestId,
  };

  return new Response(JSON.stringify(body), {
    status: 201,
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
  const body: V2AdminCreateEventErrorResponse = {
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
 * Handle POST /api/v2/admin/events
 *
 * Creates a new event with simplified validation:
 * - name is required (everything else optional)
 * - startDateISO optional but if present must be YYYY-MM-DD
 * - Uses new Sheets Write Client (Story C2)
 *
 * Request body (JSON):
 * - name (required): Event name (1-200 chars)
 * - brand (optional): Brand ID (default: 'root')
 * - startDateISO (optional): Event date in YYYY-MM-DD format
 * - slug (optional): URL-friendly slug (generated from name if not provided)
 * - seedMode (optional): Bracket seed mode
 * - elimType (optional): Elimination type
 *
 * Response format:
 * - Success: { ok: true, status: 201, item: {...} }
 * - Error: { ok: false, status: ..., code: ..., message: ..., requestId: ... }
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param requestId - Request ID for tracing
 * @returns Response with created event or error
 */
export async function handleV2AdminCreateEvent(
  request: Request,
  env: V2AdminCreateEventEnv,
  requestId: string
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
      'BAD_JSON',
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

  // Generate event fields
  const now = new Date().toISOString();
  const id = generateShortId('evt');
  const slug = validation.data.slug || toSlug(validation.data.name);

  // Build the event item for response
  const item: V2CreatedEventItem = {
    id,
    name: validation.data.name,
    brand: validation.data.brand || DEFAULT_BRAND,
    slug,
    createdAt: now,
    updatedAt: now,
  };

  // Add optional fields if provided
  if (validation.data.startDateISO) {
    item.startDateISO = validation.data.startDateISO;
  }
  if (validation.data.seedMode) {
    item.seedMode = validation.data.seedMode;
  }
  if (validation.data.elimType) {
    item.elimType = validation.data.elimType;
  }

  // Build the data JSON for storage (includes all event data)
  const dataJson = JSON.stringify({
    ...item,
    // Add any additional fields that might be useful
    brandId: item.brand, // Alias for compatibility
  });

  // Build the row for the EVENTS sheet
  // Columns: ID, BRAND_ID, TEMPLATE_ID, DATA_JSON, CREATED_AT, SLUG, UPDATED_AT
  const row: (string | null)[] = [
    id,                           // ID
    item.brand,                   // BRAND_ID
    null,                         // TEMPLATE_ID (not used in V2)
    dataJson,                     // DATA_JSON
    now,                          // CREATED_AT
    slug,                         // SLUG
    now,                          // UPDATED_AT
  ];

  try {
    // Append to Events sheet using new Sheets Write Client
    const result = await sheetsAppendValues(env, env.SHEETS_SPREADSHEET_ID!, EVENTS_RANGE, [row]);

    // Verify append succeeded
    if (result.updatedRows !== 1) {
      console.error(JSON.stringify({
        type: 'V2_CREATE_EVENT_APPEND_MISMATCH',
        requestId,
        expected: 1,
        actual: result.updatedRows,
        timestamp: now,
      }));
      return createErrorResponse(
        'INTERNAL',
        'Event row was not appended correctly',
        500,
        requestId
      );
    }

    // Log success
    console.log(JSON.stringify({
      type: 'V2_CREATE_EVENT_SUCCESS',
      requestId,
      eventId: id,
      brand: item.brand,
      timestamp: now,
    }));

    return createSuccessResponse(item, requestId);
  } catch (error) {
    // Handle Sheets write errors
    if (error instanceof SheetsWriteError) {
      console.error(JSON.stringify({
        type: 'V2_CREATE_EVENT_SHEETS_ERROR',
        requestId,
        code: error.code,
        message: error.message,
        googleStatus: error.googleStatus,
        timestamp: now,
      }));
      return createSheetsWriteErrorResponse(error, requestId);
    }

    // Handle unexpected errors
    console.error(JSON.stringify({
      type: 'V2_CREATE_EVENT_ERROR',
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: now,
    }));

    return createErrorResponse(
      'INTERNAL',
      'Failed to create event',
      500,
      requestId
    );
  }
}
