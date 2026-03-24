/**
 * Unit Tests for Story 3.3 - Admin Record Result Handler
 *
 * Tests the admin record result handler implementation.
 * Validates:
 * - Authentication requirement (admin auth)
 * - Request body validation (schedule, standings, bracket)
 * - Path parsing for event ID
 * - Response format (ok:true, status:200, item:{...})
 * - Error handling (ok:false, status:500)
 * - Analytics logging integration
 *
 * @see worker/src/handlers/adminRecordResult.ts
 * @see Story 3.3 - Port recordResult to Worker
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const adminRecordResultPath = path.join(__dirname, '../../../worker/src/handlers/adminRecordResult.ts');
const handlersIndexPath = path.join(__dirname, '../../../worker/src/handlers/index.ts');
const mainIndexPath = path.join(__dirname, '../../../worker/src/index.ts');

let adminRecordResultSource = '';
let handlersIndexSource = '';
let mainIndexSource = '';

beforeAll(() => {
  try {
    adminRecordResultSource = fs.readFileSync(adminRecordResultPath, 'utf8');
    handlersIndexSource = fs.readFileSync(handlersIndexPath, 'utf8');
    mainIndexSource = fs.readFileSync(mainIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Module Structure Tests
// =============================================================================

describe('Admin Record Result Handler Structure (Story 3.3)', () => {

  describe('Module Exports', () => {
    it('should export handleAdminRecordResult function', () => {
      expect(adminRecordResultSource).toContain('export async function handleAdminRecordResult(');
    });

    it('should export parseEventIdFromResultPath function', () => {
      expect(adminRecordResultSource).toContain('export function parseEventIdFromResultPath(');
    });
  });

  describe('Type Exports', () => {
    it('should export AdminRecordResultEnv interface', () => {
      expect(adminRecordResultSource).toContain('export interface AdminRecordResultEnv');
    });

    it('should export RecordResultRequestBody interface', () => {
      expect(adminRecordResultSource).toContain('export interface RecordResultRequestBody');
    });

    it('should export AdminRecordResultResponse interface', () => {
      expect(adminRecordResultSource).toContain('export interface AdminRecordResultResponse');
    });

    it('should export AdminRecordResultErrorResponse interface', () => {
      expect(adminRecordResultSource).toContain('export interface AdminRecordResultErrorResponse');
    });
  });
});

// =============================================================================
// Authentication Tests (AC: Admin Auth Required)
// =============================================================================

describe('Authentication (Story 3.3 AC)', () => {

  it('should import requireAdminAuth', () => {
    expect(adminRecordResultSource).toContain('requireAdminAuth');
  });

  it('should check authentication before processing', () => {
    expect(adminRecordResultSource).toContain('const authError = requireAdminAuth(request, env)');
  });

  it('should return auth error if authentication fails', () => {
    expect(adminRecordResultSource).toContain('if (authError) {\n    return authError;\n  }');
  });

  it('should log authentication attempts', () => {
    expect(adminRecordResultSource).toContain('logAuthAttempt(authResult, request)');
  });
});

// =============================================================================
// Path Parsing Tests
// =============================================================================

describe('Path Parsing (Story 3.3)', () => {

  it('should parse event ID from path pattern', () => {
    expect(adminRecordResultSource).toContain('parseEventIdFromResultPath(pathname: string)');
  });

  it('should use regex to match /api/admin/events/:id/results', () => {
    expect(adminRecordResultSource).toContain('/^\\/api\\/admin\\/events\\/([^/]+)\\/results$/i');
  });

  it('should return null for invalid paths', () => {
    expect(adminRecordResultSource).toContain('return match ? match[1] : null');
  });
});

// =============================================================================
// Request Validation Tests (AC: Required Fields)
// =============================================================================

describe('Request Validation (Story 3.3 AC)', () => {

  describe('HTTP Method', () => {
    it('should validate POST method', () => {
      expect(adminRecordResultSource).toContain("request.method !== 'POST'");
    });

    it('should return 405 for non-POST', () => {
      expect(adminRecordResultSource).toContain("'METHOD_NOT_ALLOWED'");
      expect(adminRecordResultSource).toContain('405');
    });
  });

  describe('Content-Type', () => {
    it('should validate Content-Type header', () => {
      expect(adminRecordResultSource).toContain("request.headers.get('Content-Type')");
    });

    it('should require application/json', () => {
      expect(adminRecordResultSource).toContain("'application/json'");
    });

    it('should return 400 for wrong Content-Type', () => {
      expect(adminRecordResultSource).toContain("Content-Type must be application/json");
    });
  });

  describe('At Least One Update Required', () => {
    it('should require at least one of schedule, standings, or bracket', () => {
      expect(adminRecordResultSource).toContain('At least one of schedule, standings, or bracket is required');
    });
  });

  describe('Schedule Validation', () => {
    it('should validate schedule is an array', () => {
      expect(adminRecordResultSource).toContain("'schedule must be an array'");
    });

    it('should validate schedule item has time', () => {
      expect(adminRecordResultSource).toContain('.time must be a string');
    });

    it('should validate schedule item has activity', () => {
      expect(adminRecordResultSource).toContain('.activity must be a string');
    });
  });

  describe('Standings Validation', () => {
    it('should validate standings is an array', () => {
      expect(adminRecordResultSource).toContain("'standings must be an array'");
    });

    it('should validate standings item has rank', () => {
      expect(adminRecordResultSource).toContain('.rank must be a number');
    });

    it('should validate standings item has name', () => {
      expect(adminRecordResultSource).toContain('.name must be a string');
    });

    it('should validate standings item has score', () => {
      expect(adminRecordResultSource).toContain('.score must be a number');
    });
  });

  describe('Bracket Validation', () => {
    it('should validate bracket is an object', () => {
      expect(adminRecordResultSource).toContain("'bracket must be an object'");
    });

    it('should validate bracket matches is array if present', () => {
      expect(adminRecordResultSource).toContain("'bracket.matches must be an array'");
    });

    it('should validate bracket match has id', () => {
      expect(adminRecordResultSource).toContain('.id must be a string');
    });

    it('should validate bracket match has round', () => {
      expect(adminRecordResultSource).toContain('.round must be a number');
    });

    it('should validate bracket match has position', () => {
      expect(adminRecordResultSource).toContain('.position must be a number');
    });
  });
});

// =============================================================================
// Success Response Tests (AC: {ok:true, status:200, item:{...}})
// =============================================================================

describe('Success Response (Story 3.3 AC)', () => {

  it('should return ok: true on success', () => {
    expect(adminRecordResultSource).toContain('ok: true');
  });

  it('should return status: 200 on success', () => {
    expect(adminRecordResultSource).toContain('status: 200');
  });

  it('should return item property with update result', () => {
    expect(adminRecordResultSource).toContain('item: {');
    expect(adminRecordResultSource).toContain('eventId');
    expect(adminRecordResultSource).toContain('updated');
    expect(adminRecordResultSource).toContain('updatedAtISO');
  });

  it('should return success message listing what was updated', () => {
    expect(adminRecordResultSource).toContain('Successfully updated:');
  });

  it('should set no-cache header', () => {
    expect(adminRecordResultSource).toContain("'Cache-Control': 'no-cache'");
  });
});

// =============================================================================
// Error Response Tests (AC: {ok:false, status:500})
// =============================================================================

describe('Error Response (Story 3.3 AC)', () => {

  it('should return ok: false on error', () => {
    expect(adminRecordResultSource).toContain('ok: false');
  });

  it('should return appropriate status codes', () => {
    expect(adminRecordResultSource).toContain('status,');
    expect(adminRecordResultSource).toContain('500');
    expect(adminRecordResultSource).toContain('404');
  });

  it('should return error code', () => {
    expect(adminRecordResultSource).toContain('code,');
    expect(adminRecordResultSource).toContain("'INTERNAL'");
    expect(adminRecordResultSource).toContain("'NOT_FOUND'");
  });

  it('should return error message', () => {
    expect(adminRecordResultSource).toContain('message,');
    expect(adminRecordResultSource).toContain("'Failed to record results'");
  });

  it('should include correlation ID for tracking', () => {
    expect(adminRecordResultSource).toContain('corrId');
    expect(adminRecordResultSource).toContain('generateCorrId()');
  });

  it('should return 404 for event not found', () => {
    expect(adminRecordResultSource).toContain("'Event not found'");
    expect(adminRecordResultSource).toContain("'NOT_FOUND'");
    expect(adminRecordResultSource).toContain('404');
  });
});

// =============================================================================
// Error Logging Tests
// =============================================================================

describe('Error Logging (Story 3.3)', () => {

  it('should log structured errors', () => {
    expect(adminRecordResultSource).toContain('JSON.stringify({');
  });

  it('should log RECORD_RESULT_ERROR type', () => {
    expect(adminRecordResultSource).toContain("type: 'RECORD_RESULT_ERROR'");
  });

  it('should log RECORD_RESULT_HANDLER_ERROR type', () => {
    expect(adminRecordResultSource).toContain("type: 'RECORD_RESULT_HANDLER_ERROR'");
  });

  it('should include correlation ID in logs', () => {
    expect(adminRecordResultSource).toContain('corrId,');
  });

  it('should include eventId in logs', () => {
    expect(adminRecordResultSource).toContain('eventId,');
  });

  it('should include timestamp in logs', () => {
    expect(adminRecordResultSource).toContain("timestamp: new Date().toISOString()");
  });

  it('should handle SheetsError separately', () => {
    expect(adminRecordResultSource).toContain('error instanceof SheetsError');
    expect(adminRecordResultSource).toContain('logSheetsClientError(error');
  });
});

// =============================================================================
// Analytics Logging Tests (Story 3.3 AC)
// =============================================================================

describe('Analytics Logging (Story 3.3 AC)', () => {

  it('should import logResultUpdate', () => {
    expect(adminRecordResultSource).toContain('logResultUpdate');
  });

  it('should log schedule_update to analytics', () => {
    expect(adminRecordResultSource).toContain("'schedule_update'");
  });

  it('should log standings_update to analytics', () => {
    expect(adminRecordResultSource).toContain("'standings_update'");
  });

  it('should log bracket_update to analytics', () => {
    expect(adminRecordResultSource).toContain("'bracket_update'");
  });

  it('should fire and forget analytics logging', () => {
    expect(adminRecordResultSource).toContain('Promise.all(analyticsPromises).catch');
  });

  it('should pass user agent to analytics', () => {
    expect(adminRecordResultSource).toContain("request.headers.get('User-Agent')");
  });
});

// =============================================================================
// Sheets Configuration Tests
// =============================================================================

describe('Sheets Configuration (Story 3.3)', () => {

  it('should check if Sheets is configured', () => {
    expect(adminRecordResultSource).toContain('isConfigured(env)');
  });

  it('should return 503 if not configured', () => {
    expect(adminRecordResultSource).toContain("'NOT_CONFIGURED'");
    expect(adminRecordResultSource).toContain("'Google Sheets API not configured'");
    expect(adminRecordResultSource).toContain('503');
  });
});

// =============================================================================
// Record Result Flow Tests
// =============================================================================

describe('Record Result Flow (Story 3.3)', () => {

  it('should import recordResult from sheets module', () => {
    expect(adminRecordResultSource).toContain("import {\n  recordResult,");
  });

  it('should call recordResult function', () => {
    expect(adminRecordResultSource).toContain('await recordResult(env, eventId, validation.data)');
  });

  it('should handle recordResult result', () => {
    expect(adminRecordResultSource).toContain('result.success');
  });

  it('should return success response with updated fields', () => {
    expect(adminRecordResultSource).toContain('createSuccessResponse(');
    expect(adminRecordResultSource).toContain('result.updated');
  });
});

// =============================================================================
// Request Body Interface Tests
// =============================================================================

describe('Request Body Interface (Story 3.3)', () => {

  it('should define schedule as optional', () => {
    expect(adminRecordResultSource).toContain('schedule?: ScheduleItem[]');
  });

  it('should define standings as optional', () => {
    expect(adminRecordResultSource).toContain('standings?: StandingsItem[]');
  });

  it('should define bracket as optional', () => {
    expect(adminRecordResultSource).toContain('bracket?: Bracket');
  });
});

// =============================================================================
// Barrel Export Tests
// =============================================================================

describe('Barrel Exports (Story 3.3)', () => {

  describe('Handlers Index Exports', () => {
    it('should export handleAdminRecordResult', () => {
      expect(handlersIndexSource).toContain('handleAdminRecordResult');
    });

    it('should export parseEventIdFromResultPath', () => {
      expect(handlersIndexSource).toContain('parseEventIdFromResultPath');
    });

    it('should export type AdminRecordResultEnv', () => {
      expect(handlersIndexSource).toContain('type AdminRecordResultEnv');
    });

    it('should export type RecordResultRequestBody', () => {
      expect(handlersIndexSource).toContain('type RecordResultRequestBody');
    });

    it('should export type AdminRecordResultResponse', () => {
      expect(handlersIndexSource).toContain('type AdminRecordResultResponse');
    });

    it('should include Story 3.3 reference', () => {
      expect(handlersIndexSource).toContain('Story 3.3');
    });
  });

  describe('Main Index Exports', () => {
    it('should export handleAdminRecordResult', () => {
      expect(mainIndexSource).toContain('handleAdminRecordResult');
    });

    it('should export parseEventIdFromResultPath', () => {
      expect(mainIndexSource).toContain('parseEventIdFromResultPath');
    });

    it('should export type AdminRecordResultEnv', () => {
      expect(mainIndexSource).toContain('type AdminRecordResultEnv');
    });

    it('should include Story 3.3 reference', () => {
      expect(mainIndexSource).toContain('Story 3.3');
    });
  });
});

// =============================================================================
// Documentation Tests
// =============================================================================

describe('Documentation (Story 3.3)', () => {

  it('should have module-level JSDoc', () => {
    expect(adminRecordResultSource).toContain('@module handlers/adminRecordResult');
  });

  it('should reference Story 3.3', () => {
    expect(adminRecordResultSource).toContain('Story 3.3');
  });

  it('should document endpoint path', () => {
    expect(adminRecordResultSource).toContain('POST /api/admin/events/:id/results');
  });

  it('should document request body', () => {
    expect(adminRecordResultSource).toContain('Request body (JSON)');
  });

  it('should document response format', () => {
    expect(adminRecordResultSource).toContain('Response format');
  });
});

// =============================================================================
// Environment Interface Tests
// =============================================================================

describe('Environment Interface (Story 3.3)', () => {

  it('should extend SheetsEnv', () => {
    expect(adminRecordResultSource).toContain('extends SheetsEnv');
  });

  it('should extend AdminAuthEnv', () => {
    expect(adminRecordResultSource).toContain('AdminAuthEnv');
  });

  it('should extend AnalyticsWriterEnv', () => {
    expect(adminRecordResultSource).toContain('AnalyticsWriterEnv');
  });

  it('should include WORKER_ENV', () => {
    expect(adminRecordResultSource).toContain('WORKER_ENV?: string');
  });
});
