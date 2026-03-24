/**
 * Admin Record Result API Handler
 *
 * Worker-native endpoint to record event results via Google Sheets.
 * Updates schedule, standings, and bracket data with analytics logging.
 *
 * POST /api/admin/events/:id/results
 *
 * @module handlers/adminRecordResult
 * @see Story 3.3 - Port recordResult to Worker
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
  recordResult,
  type RecordResultInput,
  type ScheduleItem,
  type StandingsItem,
  type Bracket,
} from '../sheets/resultWriter';

import {
  logResultUpdate,
  type AnalyticsWriterEnv,
} from '../sheets/analyticsWriter';

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for admin record result handler
 */
export interface AdminRecordResultEnv extends SheetsEnv, AdminAuthEnv, AnalyticsWriterEnv {
  WORKER_ENV?: string;
}

/**
 * Request body for recording results
 */
export interface RecordResultRequestBody {
  /** Schedule items (optional) */
  schedule?: ScheduleItem[];
  /** Standings items (optional) */
  standings?: StandingsItem[];
  /** Bracket data (optional) */
  bracket?: Bracket;
}

/**
 * Success response shape
 */
export interface AdminRecordResultResponse {
  ok: true;
  status: 200;
  item: {
    eventId: string;
    updated: {
      schedule?: boolean;
      standings?: boolean;
      bracket?: boolean;
    };
    updatedAtISO: string;
  };
  message: string;
}

/**
 * Error response shape
 */
export interface AdminRecordResultErrorResponse {
  ok: false;
  status: number;
  code: string;
  message: string;
  corrId?: string;
}

// =============================================================================
// Path Parsing
// =============================================================================

/**
 * Parse event ID from path
 *
 * Expected path format: /api/admin/events/:id/results
 *
 * @param pathname - URL pathname
 * @returns Event ID or null if not found
 */
export function parseEventIdFromResultPath(pathname: string): string | null {
  // Match /api/admin/events/{id}/results
  const match = pathname.match(/^\/api\/admin\/events\/([^/]+)\/results$/i);
  return match ? match[1] : null;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate schedule items
 */
function validateSchedule(schedule: unknown): { valid: true; data: ScheduleItem[] } | { valid: false; error: string } {
  if (!Array.isArray(schedule)) {
    return { valid: false, error: 'schedule must be an array' };
  }

  for (let i = 0; i < schedule.length; i++) {
    const item = schedule[i];
    if (!item || typeof item !== 'object') {
      return { valid: false, error: `schedule[${i}] must be an object` };
    }

    if (typeof item.time !== 'string') {
      return { valid: false, error: `schedule[${i}].time must be a string` };
    }

    if (typeof item.activity !== 'string') {
      return { valid: false, error: `schedule[${i}].activity must be a string` };
    }
  }

  return { valid: true, data: schedule as ScheduleItem[] };
}

/**
 * Validate standings items
 */
function validateStandings(standings: unknown): { valid: true; data: StandingsItem[] } | { valid: false; error: string } {
  if (!Array.isArray(standings)) {
    return { valid: false, error: 'standings must be an array' };
  }

  for (let i = 0; i < standings.length; i++) {
    const item = standings[i];
    if (!item || typeof item !== 'object') {
      return { valid: false, error: `standings[${i}] must be an object` };
    }

    if (typeof item.rank !== 'number') {
      return { valid: false, error: `standings[${i}].rank must be a number` };
    }

    if (typeof item.name !== 'string') {
      return { valid: false, error: `standings[${i}].name must be a string` };
    }

    if (typeof item.score !== 'number') {
      return { valid: false, error: `standings[${i}].score must be a number` };
    }
  }

  return { valid: true, data: standings as StandingsItem[] };
}

/**
 * Validate bracket data
 */
function validateBracket(bracket: unknown): { valid: true; data: Bracket } | { valid: false; error: string } {
  if (!bracket || typeof bracket !== 'object') {
    return { valid: false, error: 'bracket must be an object' };
  }

  const b = bracket as Record<string, unknown>;

  // Type is optional but must be string if present
  if (b.type !== undefined && typeof b.type !== 'string') {
    return { valid: false, error: 'bracket.type must be a string' };
  }

  // Rounds is optional but must be number if present
  if (b.rounds !== undefined && typeof b.rounds !== 'number') {
    return { valid: false, error: 'bracket.rounds must be a number' };
  }

  // Matches is optional but must be array if present
  if (b.matches !== undefined) {
    if (!Array.isArray(b.matches)) {
      return { valid: false, error: 'bracket.matches must be an array' };
    }

    for (let i = 0; i < b.matches.length; i++) {
      const match = b.matches[i];
      if (!match || typeof match !== 'object') {
        return { valid: false, error: `bracket.matches[${i}] must be an object` };
      }

      if (typeof match.id !== 'string') {
        return { valid: false, error: `bracket.matches[${i}].id must be a string` };
      }

      if (typeof match.round !== 'number') {
        return { valid: false, error: `bracket.matches[${i}].round must be a number` };
      }

      if (typeof match.position !== 'number') {
        return { valid: false, error: `bracket.matches[${i}].position must be a number` };
      }
    }
  }

  return { valid: true, data: bracket as Bracket };
}

/**
 * Validate request body and return errors
 */
function validateRequestBody(
  body: unknown
): { valid: true; data: RecordResultInput } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const obj = body as Record<string, unknown>;
  const data: RecordResultInput = {};

  // Check that at least one update field is provided
  const hasSchedule = obj.schedule !== undefined;
  const hasStandings = obj.standings !== undefined;
  const hasBracket = obj.bracket !== undefined;

  if (!hasSchedule && !hasStandings && !hasBracket) {
    return { valid: false, error: 'At least one of schedule, standings, or bracket is required' };
  }

  // Validate schedule if provided
  if (hasSchedule) {
    const scheduleValidation = validateSchedule(obj.schedule);
    if (!scheduleValidation.valid) {
      return scheduleValidation;
    }
    data.schedule = scheduleValidation.data;
  }

  // Validate standings if provided
  if (hasStandings) {
    const standingsValidation = validateStandings(obj.standings);
    if (!standingsValidation.valid) {
      return standingsValidation;
    }
    data.standings = standingsValidation.data;
  }

  // Validate bracket if provided
  if (hasBracket) {
    const bracketValidation = validateBracket(obj.bracket);
    if (!bracketValidation.valid) {
      return bracketValidation;
    }
    data.bracket = bracketValidation.data;
  }

  return { valid: true, data };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate correlation ID for error tracking
 */
function generateCorrId(): string {
  return `rr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Response Factories
// =============================================================================

/**
 * Create success response (200 OK)
 */
function createSuccessResponse(
  eventId: string,
  updated: { schedule?: boolean; standings?: boolean; bracket?: boolean },
  updatedAtISO: string
): Response {
  const updates: string[] = [];
  if (updated.schedule) updates.push('schedule');
  if (updated.standings) updates.push('standings');
  if (updated.bracket) updates.push('bracket');

  const body: AdminRecordResultResponse = {
    ok: true,
    status: 200,
    item: {
      eventId,
      updated,
      updatedAtISO,
    },
    message: `Successfully updated: ${updates.join(', ')}`,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
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
  const body: AdminRecordResultErrorResponse = {
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
 * Handle POST /api/admin/events/:id/results
 *
 * Records results for an event with:
 * - Schedule updates
 * - Standings updates
 * - Bracket updates
 * - Analytics logging (source=worker, env=stg/prod)
 *
 * Request body (JSON):
 * - schedule (optional): Array of schedule items [{time, activity, notes?}]
 * - standings (optional): Array of standings items [{rank, name, score, stats?}]
 * - bracket (optional): Bracket data {type?, rounds?, matches?[]}
 *
 * At least one of schedule, standings, or bracket is required.
 *
 * Response format:
 * - Success: { ok: true, status: 200, item: {...}, message: "..." }
 * - Error: { ok: false, status: ..., code: ..., message: ..., corrId?: ... }
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @returns Response with update result or error
 */
export async function handleAdminRecordResult(
  request: Request,
  env: AdminRecordResultEnv
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

  // Parse event ID from path
  const url = new URL(request.url);
  const eventId = parseEventIdFromResultPath(url.pathname);

  if (!eventId) {
    return createErrorResponse(
      'BAD_INPUT',
      'Invalid path: expected /api/admin/events/:id/results',
      400
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

  try {
    // Record results using load-merge-save pattern
    const result = await recordResult(env, eventId, validation.data);

    if (!result.success) {
      // Check for not found error
      if (result.error?.includes('not found')) {
        return createErrorResponse('NOT_FOUND', 'Event not found', 404);
      }

      const corrId = generateCorrId();
      console.error(
        JSON.stringify({
          type: 'RECORD_RESULT_ERROR',
          corrId,
          error: result.error,
          eventId,
          timestamp: new Date().toISOString(),
        })
      );
      return createErrorResponse('INTERNAL', 'Failed to record results', 500, corrId);
    }

    // Log analytics for each update type
    const analyticsPromises: Promise<unknown>[] = [];

    if (result.updated?.schedule) {
      analyticsPromises.push(
        logResultUpdate(env, eventId, 'schedule_update', {
          userAgent: request.headers.get('User-Agent') || undefined,
        })
      );
    }

    if (result.updated?.standings) {
      analyticsPromises.push(
        logResultUpdate(env, eventId, 'standings_update', {
          userAgent: request.headers.get('User-Agent') || undefined,
        })
      );
    }

    if (result.updated?.bracket) {
      analyticsPromises.push(
        logResultUpdate(env, eventId, 'bracket_update', {
          userAgent: request.headers.get('User-Agent') || undefined,
        })
      );
    }

    // Fire and forget analytics logging (don't block response)
    Promise.all(analyticsPromises).catch(err => {
      console.warn('Analytics logging failed:', err);
    });

    // Return success response
    return createSuccessResponse(
      eventId,
      result.updated || {},
      result.event?.updatedAtISO || new Date().toISOString()
    );
  } catch (error) {
    const corrId = generateCorrId();

    // Log detailed error
    if (error instanceof SheetsError) {
      logSheetsClientError(error, {
        corrId,
        endpoint: `/api/admin/events/${eventId}/results`,
        operation: 'recordResult',
      });
    } else {
      console.error(
        JSON.stringify({
          type: 'RECORD_RESULT_HANDLER_ERROR',
          corrId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          eventId,
          timestamp: new Date().toISOString(),
        })
      );
    }

    return createErrorResponse('INTERNAL', 'Failed to record results', 500, corrId);
  }
}
