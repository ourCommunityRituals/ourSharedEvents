/**
 * Unit Tests for Story 3.2 - Admin Create Event Handler
 *
 * Tests the admin create event handler implementation.
 * Validates:
 * - Authentication requirement (admin auth)
 * - Request body validation
 * - Response format (ok:true, status:201, item:{...})
 * - Error handling (ok:false, status:500)
 * - Idempotent behavior
 *
 * @see worker/src/handlers/adminCreateEvent.ts
 * @see Story 3.2 - Port createEvent to Worker
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const adminCreateEventPath = path.join(__dirname, '../../../worker/src/handlers/adminCreateEvent.ts');
const handlersIndexPath = path.join(__dirname, '../../../worker/src/handlers/index.ts');
const mainIndexPath = path.join(__dirname, '../../../worker/src/index.ts');

let adminCreateEventSource = '';
let handlersIndexSource = '';
let mainIndexSource = '';

beforeAll(() => {
  try {
    adminCreateEventSource = fs.readFileSync(adminCreateEventPath, 'utf8');
    handlersIndexSource = fs.readFileSync(handlersIndexPath, 'utf8');
    mainIndexSource = fs.readFileSync(mainIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Module Structure Tests
// =============================================================================

describe('Admin Create Event Handler Structure (Story 3.2)', () => {

  describe('Module Exports', () => {
    it('should export handleAdminCreateEvent function', () => {
      expect(adminCreateEventSource).toContain('export async function handleAdminCreateEvent(');
    });
  });

  describe('Type Exports', () => {
    it('should export AdminCreateEventEnv interface', () => {
      expect(adminCreateEventSource).toContain('export interface AdminCreateEventEnv');
    });

    it('should export CreateEventRequestBody interface', () => {
      expect(adminCreateEventSource).toContain('export interface CreateEventRequestBody');
    });

    it('should export AdminCreateEventResponse interface', () => {
      expect(adminCreateEventSource).toContain('export interface AdminCreateEventResponse');
    });

    it('should export AdminCreateEventErrorResponse interface', () => {
      expect(adminCreateEventSource).toContain('export interface AdminCreateEventErrorResponse');
    });
  });
});

// =============================================================================
// Authentication Tests (AC: Admin Auth Required)
// =============================================================================

describe('Authentication (Story 3.2 AC)', () => {

  it('should import requireAdminAuth', () => {
    expect(adminCreateEventSource).toContain('requireAdminAuth');
  });

  it('should check authentication before processing', () => {
    expect(adminCreateEventSource).toContain('const authError = requireAdminAuth(request, env)');
  });

  it('should return auth error if authentication fails', () => {
    expect(adminCreateEventSource).toContain('if (authError) {\n    return authError;\n  }');
  });

  it('should log authentication attempts', () => {
    expect(adminCreateEventSource).toContain('logAuthAttempt(authResult, request)');
  });
});

// =============================================================================
// Request Validation Tests (AC: Required Fields)
// =============================================================================

describe('Request Validation (Story 3.2 AC)', () => {

  describe('HTTP Method', () => {
    it('should validate POST method', () => {
      expect(adminCreateEventSource).toContain("request.method !== 'POST'");
    });

    it('should return 405 for non-POST', () => {
      expect(adminCreateEventSource).toContain("'METHOD_NOT_ALLOWED'");
      expect(adminCreateEventSource).toContain('405');
    });
  });

  describe('Content-Type', () => {
    it('should validate Content-Type header', () => {
      expect(adminCreateEventSource).toContain("request.headers.get('Content-Type')");
    });

    it('should require application/json', () => {
      expect(adminCreateEventSource).toContain("'application/json'");
    });

    it('should return 400 for wrong Content-Type', () => {
      expect(adminCreateEventSource).toContain("Content-Type must be application/json");
    });
  });

  describe('Required Fields', () => {
    it('should validate name is required', () => {
      expect(adminCreateEventSource).toContain("'Missing required field: name'");
    });

    it('should validate startDateISO is required', () => {
      expect(adminCreateEventSource).toContain("'Missing required field: startDateISO'");
    });

    it('should validate venue is required', () => {
      expect(adminCreateEventSource).toContain("'Missing required field: venue'");
    });
  });

  describe('Date Format', () => {
    it('should validate date format with regex', () => {
      expect(adminCreateEventSource).toContain('DATE_REGEX');
      expect(adminCreateEventSource).toContain('/^\\d{4}-\\d{2}-\\d{2}$/');
    });

    it('should return error for invalid date format', () => {
      expect(adminCreateEventSource).toContain('Invalid date format: startDateISO must be YYYY-MM-DD');
    });
  });

  describe('Brand Validation', () => {
    it('should define valid brands', () => {
      expect(adminCreateEventSource).toContain("VALID_BRANDS = ['root', 'abc', 'cbc', 'cbl']");
    });

    it('should validate brandId if provided', () => {
      expect(adminCreateEventSource).toContain('isValidBrand(brandId)');
    });

    it('should default to root brand', () => {
      expect(adminCreateEventSource).toContain("DEFAULT_BRAND: BrandId = 'root'");
    });
  });
});

// =============================================================================
// Success Response Tests (AC: {ok:true, status:201, item:{...}})
// =============================================================================

describe('Success Response (Story 3.2 AC)', () => {

  it('should return ok: true on success', () => {
    expect(adminCreateEventSource).toContain('ok: true');
  });

  it('should return status: 201 on success', () => {
    expect(adminCreateEventSource).toContain('status: 201');
  });

  it('should return item property with event data', () => {
    expect(adminCreateEventSource).toContain('item: event');
  });

  it('should return success message', () => {
    expect(adminCreateEventSource).toContain("Event created successfully");
  });

  it('should return idempotent message for duplicates', () => {
    expect(adminCreateEventSource).toContain("'Event already exists (idempotent)'");
  });

  it('should set no-cache header', () => {
    expect(adminCreateEventSource).toContain("'Cache-Control': 'no-cache'");
  });
});

// =============================================================================
// Error Response Tests (AC: {ok:false, status:500})
// =============================================================================

describe('Error Response (Story 3.2 AC)', () => {

  it('should return ok: false on error', () => {
    expect(adminCreateEventSource).toContain('ok: false');
  });

  it('should return appropriate status codes', () => {
    expect(adminCreateEventSource).toContain('status,');
    expect(adminCreateEventSource).toContain('500');
  });

  it('should return error code', () => {
    expect(adminCreateEventSource).toContain('code,');
    expect(adminCreateEventSource).toContain("'INTERNAL'");
  });

  it('should return error message', () => {
    expect(adminCreateEventSource).toContain('message,');
    expect(adminCreateEventSource).toContain("'Failed to create event'");
  });

  it('should include correlation ID for tracking', () => {
    expect(adminCreateEventSource).toContain('corrId');
    expect(adminCreateEventSource).toContain('generateCorrId()');
  });
});

// =============================================================================
// Error Logging Tests
// =============================================================================

describe('Error Logging (Story 3.2)', () => {

  it('should log structured errors', () => {
    expect(adminCreateEventSource).toContain('JSON.stringify({');
  });

  it('should log CREATE_EVENT_ERROR type', () => {
    expect(adminCreateEventSource).toContain("type: 'CREATE_EVENT_ERROR'");
  });

  it('should log CREATE_EVENT_HANDLER_ERROR type', () => {
    expect(adminCreateEventSource).toContain("type: 'CREATE_EVENT_HANDLER_ERROR'");
  });

  it('should include correlation ID in logs', () => {
    expect(adminCreateEventSource).toContain('corrId,');
  });

  it('should include timestamp in logs', () => {
    expect(adminCreateEventSource).toContain("timestamp: new Date().toISOString()");
  });

  it('should handle SheetsError separately', () => {
    expect(adminCreateEventSource).toContain('error instanceof SheetsError');
    expect(adminCreateEventSource).toContain('logSheetsClientError(error');
  });
});

// =============================================================================
// Sheets Configuration Tests
// =============================================================================

describe('Sheets Configuration (Story 3.2)', () => {

  it('should check if Sheets is configured', () => {
    expect(adminCreateEventSource).toContain('isConfigured(env)');
  });

  it('should return 503 if not configured', () => {
    expect(adminCreateEventSource).toContain("'NOT_CONFIGURED'");
    expect(adminCreateEventSource).toContain("'Google Sheets API not configured'");
    expect(adminCreateEventSource).toContain('503');
  });
});

// =============================================================================
// Event Creation Flow Tests
// =============================================================================

describe('Event Creation Flow (Story 3.2)', () => {

  it('should import createEvent from sheets module', () => {
    expect(adminCreateEventSource).toContain("import {\n  createEvent,");
  });

  it('should build event input from request body', () => {
    expect(adminCreateEventSource).toContain('const eventInput: CreateEventInput = {');
  });

  it('should call createEvent function', () => {
    expect(adminCreateEventSource).toContain('await createEvent(env, eventInput)');
  });

  it('should handle createEvent result', () => {
    expect(adminCreateEventSource).toContain('result.success');
  });

  it('should return created event on success', () => {
    expect(adminCreateEventSource).toContain('createSuccessResponse(result.event!');
  });
});

// =============================================================================
// Request Body Interface Tests
// =============================================================================

describe('Request Body Interface (Story 3.2)', () => {

  it('should define name as required string', () => {
    expect(adminCreateEventSource).toContain('name: string');
  });

  it('should define startDateISO as required string', () => {
    expect(adminCreateEventSource).toContain('startDateISO: string');
  });

  it('should define venue as required string', () => {
    expect(adminCreateEventSource).toContain('venue: string');
  });

  it('should define brandId as optional', () => {
    expect(adminCreateEventSource).toContain('brandId?: string');
  });

  it('should define templateId as optional', () => {
    expect(adminCreateEventSource).toContain('templateId?: string');
  });

  it('should define signupUrl as optional', () => {
    expect(adminCreateEventSource).toContain('signupUrl?: string');
  });
});

// =============================================================================
// Barrel Export Tests
// =============================================================================

describe('Barrel Exports (Story 3.2)', () => {

  describe('Handlers Index Exports', () => {
    it('should export handleAdminCreateEvent', () => {
      expect(handlersIndexSource).toContain('handleAdminCreateEvent');
    });

    it('should export type AdminCreateEventEnv', () => {
      expect(handlersIndexSource).toContain('type AdminCreateEventEnv');
    });

    it('should export type CreateEventRequestBody', () => {
      expect(handlersIndexSource).toContain('type CreateEventRequestBody');
    });

    it('should export type AdminCreateEventResponse', () => {
      expect(handlersIndexSource).toContain('type AdminCreateEventResponse');
    });

    it('should include Story 3.2 reference', () => {
      expect(handlersIndexSource).toContain('Story 3.2');
    });
  });

  describe('Main Index Exports', () => {
    it('should export handleAdminCreateEvent', () => {
      expect(mainIndexSource).toContain('handleAdminCreateEvent');
    });

    it('should export type AdminCreateEventEnv', () => {
      expect(mainIndexSource).toContain('type AdminCreateEventEnv');
    });

    it('should include Story 3.2 reference', () => {
      expect(mainIndexSource).toContain('Story 3.2');
    });
  });
});

// =============================================================================
// Documentation Tests
// =============================================================================

describe('Documentation (Story 3.2)', () => {

  it('should have module-level JSDoc', () => {
    expect(adminCreateEventSource).toContain('@module handlers/adminCreateEvent');
  });

  it('should reference Story 3.2', () => {
    expect(adminCreateEventSource).toContain('Story 3.2');
  });

  it('should document endpoint path', () => {
    expect(adminCreateEventSource).toContain('POST /api/admin/events');
  });

  it('should document request body', () => {
    expect(adminCreateEventSource).toContain('Request body (JSON)');
  });

  it('should document response format', () => {
    expect(adminCreateEventSource).toContain('Response format');
  });
});

// =============================================================================
// Environment Interface Tests
// =============================================================================

describe('Environment Interface (Story 3.2)', () => {

  it('should extend SheetsEnv', () => {
    expect(adminCreateEventSource).toContain('extends SheetsEnv');
  });

  it('should extend AdminAuthEnv', () => {
    expect(adminCreateEventSource).toContain('AdminAuthEnv');
  });

  it('should include WORKER_ENV', () => {
    expect(adminCreateEventSource).toContain('WORKER_ENV?: string');
  });
});
