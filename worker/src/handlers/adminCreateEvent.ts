/**
 * Admin Create Event API Handler
 *
 * Worker-native endpoint to create events via Google Sheets.
 * Replaces the GAS api_saveEvent (create mode) functionality.
 *
 * POST /api/admin/events
 *
 * @module handlers/adminCreateEvent
 * @see Story 3.2 - Port createEvent to Worker
 */

import {
  isConfigured,
  SheetsError,
  logSheetsClientError,
  type SheetsEnv,
} from '../sheetsClient';

import {
  requireAdminAuth,
  logAuthAttempt,
  checkAdminAuth,
  type AdminAuthEnv,
} from '../auth';

import {
  createEvent,
  type CreateEventInput,
  type CreatedEvent,
} from '../sheets';

// =============================================================================
// Constants
// =============================================================================

/**
 * Valid brand IDs
 */
const VALID_BRANDS = ['root', 'abc', 'cbc', 'cbl'] as const;
type BrandId = typeof VALID_BRANDS[number];

const DEFAULT_BRAND: BrandId = 'root';

/**
 * Date format regex (YYYY-MM-DD)
 */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for admin create event handler
 */
export interface AdminCreateEventEnv extends SheetsEnv, AdminAuthEnv {
  WORKER_ENV?: string;
}

/**
 * Request body for creating an event
 */
export interface CreateEventRequestBody {
  /** Event name (required) */
  name: string;
  /** Event start date in YYYY-MM-DD format (required) */
  startDateISO: string;
  /** Event venue (required) */
  venue: string;
  /** Brand ID (optional, defaults to 'root') */
  brandId?: string;
  /** Template ID (optional) */
  templateId?: string;
  /** Signup URL (optional) */
  signupUrl?: string;
}

/**
 * Success response shape
 */
export interface AdminCreateEventResponse {
  ok: true;
  status: 201;
  item: CreatedEvent;
  message: string;
}

/**
 * Error response shape
 */
export interface AdminCreateEventErrorResponse {
  ok: false;
  status: number;
  code: string;
  message: string;
  corrId?: string;
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
 * Validate request body and return errors
 */
function validateRequestBody(
  body: unknown
): { valid: true; data: CreateEventRequestBody } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const obj = body as Record<string, unknown>;

  // Validate name (required)
  if (!obj.name || typeof obj.name !== 'string' || obj.name.trim() === '') {
    return { valid: false, error: 'Missing required field: name' };
  }

  // Validate startDateISO (required)
  if (!obj.startDateISO || typeof obj.startDateISO !== 'string') {
    return { valid: false, error: 'Missing required field: startDateISO' };
  }

  if (!isValidDateFormat(obj.startDateISO)) {
    return { valid: false, error: 'Invalid date format: startDateISO must be YYYY-MM-DD' };
  }

  // Validate venue (required)
  if (!obj.venue || typeof obj.venue !== 'string' || obj.venue.trim() === '') {
    return { valid: false, error: 'Missing required field: venue' };
  }

  // Validate brandId (optional, default to 'root')
  const brandId = obj.brandId as string | undefined;
  if (brandId && !isValidBrand(brandId)) {
    return { valid: false, error: `Invalid brand: ${brandId}` };
  }

  // Validate templateId (optional)
  if (obj.templateId !== undefined && typeof obj.templateId !== 'string') {
    return { valid: false, error: 'templateId must be a string' };
  }

  // Validate signupUrl (optional)
  if (obj.signupUrl !== undefined && typeof obj.signupUrl !== 'string') {
    return { valid: false, error: 'signupUrl must be a string' };
  }

  return {
    valid: true,
    data: {
      name: obj.name.trim(),
      startDateISO: obj.startDateISO,
      venue: obj.venue.trim(),
      brandId: (brandId || DEFAULT_BRAND) as string,
      templateId: obj.templateId as string | undefined,
      signupUrl: obj.signupUrl as string | undefined,
    },
  };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate correlation ID for error tracking
 */
function generateCorrId(): string {
  return `adm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Response Factories
// =============================================================================

/**
 * Create success response (201 Created)
 */
function createSuccessResponse(
  event: CreatedEvent,
  duplicate: boolean
): Response {
  const body: AdminCreateEventResponse = {
    ok: true,
    status: 201,
    item: event,
    message: duplicate ? 'Event already exists (idempotent)' : 'Event created successfully',
  };

  return new Response(JSON.stringify(body), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * Create error response
 */
function createErrorResponse(
  code: string,
  message: string,
  status: number,
  corrId?: string
): Response {
  const body: AdminCreateEventErrorResponse = {
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

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle POST /api/admin/events
 *
 * Creates a new event with:
 * - Unique ID
 * - Unique slug (with collision handling)
 * - EventTag for tracking
 * - Idempotent behavior (same payload returns existing event)
 *
 * Request body (JSON):
 * - name (required): Event name
 * - startDateISO (required): Event date in YYYY-MM-DD format
 * - venue (required): Event venue
 * - brandId (optional): Brand ID (default: 'root')
 * - templateId (optional): Template ID
 * - signupUrl (optional): Signup URL
 *
 * Response format:
 * - Success: { ok: true, status: 201, item: {...}, message: "..." }
 * - Error: { ok: false, status: ..., code: ..., message: ..., corrId?: ... }
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @returns Response with created event or error
 */
export async function handleAdminCreateEvent(
  request: Request,
  env: AdminCreateEventEnv
): Promise<Response> {
  // Log auth attempt for auditing
  const authResult = checkAdminAuth(request, env);
  logAuthAttempt(authResult, request);

  // Check authentication
  const authError = requireAdminAuth(request, env);
  if (authError) {
    return authError;
  }

  // Validate HTTP method
  if (request.method !== 'POST') {
    return createErrorResponse(
      'METHOD_NOT_ALLOWED',
      'Only POST method is allowed',
      405
    );
  }

  // Validate Content-Type
  const contentType = request.headers.get('Content-Type');
  if (!contentType?.includes('application/json')) {
    return createErrorResponse(
      'BAD_INPUT',
      'Content-Type must be application/json',
      400
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
      400
    );
  }

  // Validate request body
  const validation = validateRequestBody(body);
  if (!validation.valid) {
    return createErrorResponse('BAD_INPUT', validation.error, 400);
  }

  // Check if Sheets is configured
  if (!isConfigured(env)) {
    return createErrorResponse(
      'NOT_CONFIGURED',
      'Google Sheets API not configured',
      503
    );
  }

  // Build event input
  const eventInput: CreateEventInput = {
    name: validation.data.name,
    startDateISO: validation.data.startDateISO,
    venue: validation.data.venue,
    brandId: validation.data.brandId || DEFAULT_BRAND,
    templateId: validation.data.templateId,
    signupUrl: validation.data.signupUrl,
  };

  try {
    // Create event
    const result = await createEvent(env, eventInput);

    if (!result.success) {
      const corrId = generateCorrId();
      console.error(
        JSON.stringify({
          type: 'CREATE_EVENT_ERROR',
          corrId,
          error: result.error,
          input: { name: eventInput.name, brandId: eventInput.brandId },
          timestamp: new Date().toISOString(),
        })
      );
      return createErrorResponse('INTERNAL', 'Failed to create event', 500, corrId);
    }

    // Return success response
    return createSuccessResponse(result.event!, result.duplicate || false);
  } catch (error) {
    const corrId = generateCorrId();

    // Log detailed error
    if (error instanceof SheetsError) {
      logSheetsClientError(error, {
        corrId,
        endpoint: '/api/admin/events',
        operation: 'createEvent',
      });
    } else {
      console.error(
        JSON.stringify({
          type: 'CREATE_EVENT_HANDLER_ERROR',
          corrId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString(),
        })
      );
    }

    return createErrorResponse('INTERNAL', 'Failed to create event', 500, corrId);
  }
}
