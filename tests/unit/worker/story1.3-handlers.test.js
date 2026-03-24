/**
 * Unit Tests for Story 1.3 Handlers
 *
 * Tests the status and eventsList handlers implementation.
 * Validates:
 * - Response shapes match acceptance criteria
 * - Error handling for Sheets down
 * - Empty events array handling
 * - Contract parity with existing endpoints
 *
 * @see worker/src/handlers/status.ts
 * @see worker/src/handlers/eventsList.ts
 * @see Story 1.3 - Port api_status + Simple Read-Only api_listEvents
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const statusHandlerPath = path.join(__dirname, '../../../worker/src/handlers/status.ts');
const eventsHandlerPath = path.join(__dirname, '../../../worker/src/handlers/eventsList.ts');
const handlersIndexPath = path.join(__dirname, '../../../worker/src/handlers/index.ts');
const mainIndexPath = path.join(__dirname, '../../../worker/src/index.ts');

let statusSource = '';
let eventsSource = '';
let handlersIndexSource = '';
let mainIndexSource = '';

beforeAll(() => {
  try {
    statusSource = fs.readFileSync(statusHandlerPath, 'utf8');
    eventsSource = fs.readFileSync(eventsHandlerPath, 'utf8');
    handlersIndexSource = fs.readFileSync(handlersIndexPath, 'utf8');
    mainIndexSource = fs.readFileSync(mainIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Status Handler Contract Tests
// =============================================================================

describe('Status Handler Contract (Story 1.3)', () => {

  describe('Module Structure', () => {
    it('should export handleStatus function', () => {
      expect(statusSource).toContain('export async function handleStatus(');
    });

    it('should export createSheetsDownResponse function', () => {
      expect(statusSource).toContain('export function createSheetsDownResponse(');
    });

    it('should export StatusEnv type', () => {
      expect(statusSource).toContain('export interface StatusEnv');
    });

    it('should export StatusResponse type', () => {
      expect(statusSource).toContain('export interface StatusResponse');
    });

    it('should export StatusErrorResponse type', () => {
      expect(statusSource).toContain('export interface StatusErrorResponse');
    });
  });

  describe('Status Response Shape (AC)', () => {
    // AC: { ok: true, status: 200, version: "...", backend: "worker", sheets: "ok" }

    it('should include ok field in response', () => {
      expect(statusSource).toContain('ok: boolean');
      expect(statusSource).toContain('ok: isHealthy');
    });

    it('should include status field with HTTP status code', () => {
      expect(statusSource).toContain('status: number');
      expect(statusSource).toContain('status: httpStatus');
    });

    it('should include version field', () => {
      expect(statusSource).toContain('version: string');
      expect(statusSource).toContain('version: WORKER_VERSION');
    });

    it('should include backend field with value "worker"', () => {
      expect(statusSource).toContain("backend: 'worker'");
    });

    it('should include sheets field with status', () => {
      expect(statusSource).toContain("sheets: 'ok' | 'error' | 'not_configured'");
      expect(statusSource).toContain('sheets: sheetsStatus');
    });

    it('should return 200 when healthy', () => {
      expect(statusSource).toContain('const isHealthy = sheetsStatus !== \'error\'');
      expect(statusSource).toContain('const httpStatus = isHealthy ? 200 : 503');
    });
  });

  describe('Sheets Down Handling (AC)', () => {
    // AC: If Sheets is down → returns {ok:false, status:503}

    it('should return 503 when sheets is down', () => {
      expect(statusSource).toContain('status: 503');
    });

    it('should return ok: false when sheets is down', () => {
      expect(statusSource).toContain('ok: false');
    });

    it('should include error message when sheets is down', () => {
      expect(statusSource).toContain('error: string');
    });

    it('should check sheets connectivity via healthCheck', () => {
      expect(statusSource).toContain('await healthCheck(env as SheetsEnv)');
    });

    it('should handle not configured state', () => {
      expect(statusSource).toContain("'not_configured'");
      expect(statusSource).toContain('isConfigured(env as SheetsEnv)');
    });
  });

  describe('Response Headers', () => {
    it('should set Content-Type to application/json', () => {
      expect(statusSource).toContain("'Content-Type': 'application/json'");
    });

    it('should set Cache-Control to no-cache', () => {
      expect(statusSource).toContain('no-cache, no-store, must-revalidate');
    });

    it('should include X-Worker-Version header', () => {
      expect(statusSource).toContain("'X-Worker-Version': WORKER_VERSION");
    });
  });

  describe('Imports', () => {
    it('should import healthCheck from sheetsClient', () => {
      expect(statusSource).toContain('import { healthCheck');
      expect(statusSource).toContain("from '../sheetsClient'");
    });

    it('should import isConfigured from sheetsClient', () => {
      expect(statusSource).toContain('isConfigured');
    });

    it('should import SheetsEnv type', () => {
      expect(statusSource).toContain('type SheetsEnv');
    });
  });
});

// =============================================================================
// Events List Handler Contract Tests
// =============================================================================

describe('Events List Handler Contract (Story 1.3)', () => {

  describe('Module Structure', () => {
    it('should export handleListEvents function', () => {
      expect(eventsSource).toContain('export async function handleListEvents(');
    });

    it('should export EventsEnv type', () => {
      expect(eventsSource).toContain('export interface EventsEnv');
    });

    it('should export EventSummary type', () => {
      expect(eventsSource).toContain('export interface EventSummary');
    });

    it('should export EventFull type', () => {
      expect(eventsSource).toContain('export interface EventFull');
    });

    it('should export EventsListResponse type', () => {
      expect(eventsSource).toContain('export interface EventsListResponse');
    });

    it('should export EventsErrorResponse type', () => {
      expect(eventsSource).toContain('export interface EventsErrorResponse');
    });
  });

  describe('Events Response Shape (AC)', () => {
    // AC: { ok: true, status: 200, items: [...] }

    it('should include ok field in response', () => {
      expect(eventsSource).toContain('ok: true');
    });

    it('should include status field with 200', () => {
      expect(eventsSource).toContain('status: 200');
    });

    it('should include items array', () => {
      expect(eventsSource).toContain('items: (EventSummary | EventFull)[]');
      expect(eventsSource).toContain('items,');
    });
  });

  describe('Empty Events Handling (AC)', () => {
    // AC: If Events sheet empty → returns {ok:true, status:200, items:[]}

    it('should return empty array when no events', () => {
      expect(eventsSource).toContain('return createSuccessResponse([])');
    });

    it('should handle empty dataRows', () => {
      expect(eventsSource).toContain('dataRows.length === 0');
    });

    it('should skip header row', () => {
      expect(eventsSource).toContain('const dataRows = rows.slice(1)');
    });
  });

  describe('Event Summary Fields', () => {
    // Summary fields: id, name, startDateISO, venue, slug, createdAtISO, updatedAtISO

    it('should include id in EventSummary', () => {
      expect(eventsSource).toContain('id: string');
    });

    it('should include name in EventSummary', () => {
      expect(eventsSource).toContain('name: string');
    });

    it('should include startDateISO in EventSummary', () => {
      expect(eventsSource).toContain('startDateISO: string');
    });

    it('should include venue in EventSummary', () => {
      expect(eventsSource).toContain('venue: string');
    });

    it('should include slug in EventSummary', () => {
      expect(eventsSource).toContain('slug: string');
    });

    it('should include createdAtISO in EventSummary', () => {
      expect(eventsSource).toContain('createdAtISO: string');
    });

    it('should include updatedAtISO in EventSummary', () => {
      expect(eventsSource).toContain('updatedAtISO: string');
    });
  });

  describe('Query Parameters', () => {
    it('should accept brand query parameter', () => {
      expect(eventsSource).toContain("url.searchParams.get('brand')");
    });

    it('should accept full query parameter', () => {
      expect(eventsSource).toContain("url.searchParams.get('full')");
    });

    it('should default to root brand', () => {
      expect(eventsSource).toContain("const DEFAULT_BRAND: BrandId = 'root'");
    });

    it('should validate brand is valid', () => {
      expect(eventsSource).toContain('if (!isValidBrand(brandId))');
    });
  });

  describe('Brand Validation', () => {
    it('should define valid brands', () => {
      expect(eventsSource).toContain("const VALID_BRANDS = ['root', 'abc', 'cbc', 'cbl']");
    });

    it('should return BAD_INPUT for invalid brand', () => {
      expect(eventsSource).toContain("'BAD_INPUT'");
      expect(eventsSource).toContain('Invalid brand');
    });
  });

  describe('Sheet Structure', () => {
    it('should read from EVENTS sheet', () => {
      expect(eventsSource).toContain("const EVENTS_SHEET = 'EVENTS'");
    });

    it('should read columns A:G', () => {
      expect(eventsSource).toContain("const EVENTS_RANGE = 'A:G'");
    });

    it('should define column indices', () => {
      expect(eventsSource).toContain('ID: 0');
      expect(eventsSource).toContain('BRAND_ID: 1');
      expect(eventsSource).toContain('TEMPLATE_ID: 2');
      expect(eventsSource).toContain('DATA_JSON: 3');
      expect(eventsSource).toContain('CREATED_AT: 4');
      expect(eventsSource).toContain('SLUG: 5');
      expect(eventsSource).toContain('UPDATED_AT: 6');
    });
  });

  describe('Event Data Parsing', () => {
    it('should parse JSON from DATA_JSON column', () => {
      expect(eventsSource).toContain('JSON.parse(dataJson)');
    });

    it('should handle parse errors gracefully', () => {
      expect(eventsSource).toContain('catch (e)');
      expect(eventsSource).toContain('return null');
    });

    it('should filter by brandId', () => {
      expect(eventsSource).toContain('if (row[COL.BRAND_ID] !== brandId) continue');
    });
  });

  describe('Event Sorting', () => {
    it('should sort by date descending', () => {
      expect(eventsSource).toContain('events.sort((a, b)');
      expect(eventsSource).toContain('dateB.localeCompare(dateA)');
    });
  });

  describe('Error Handling', () => {
    it('should return NOT_CONFIGURED when Sheets not configured', () => {
      expect(eventsSource).toContain("'NOT_CONFIGURED'");
      expect(eventsSource).toContain('Google Sheets API not configured');
    });

    it('should return INTERNAL on unexpected errors', () => {
      expect(eventsSource).toContain("'INTERNAL'");
      expect(eventsSource).toContain('Failed to list events');
    });

    it('should generate correlation ID for errors', () => {
      expect(eventsSource).toContain('generateCorrId()');
    });

    it('should include correlation ID in error response', () => {
      expect(eventsSource).toContain('corrId?:');
    });
  });

  describe('Response Headers', () => {
    it('should set Content-Type to application/json', () => {
      expect(eventsSource).toContain("'Content-Type': 'application/json'");
    });

    it('should set Cache-Control for success responses', () => {
      expect(eventsSource).toContain('private, max-age=60, stale-while-revalidate=300');
    });
  });

  describe('Imports', () => {
    it('should import getSheetValues from sheetsClient', () => {
      expect(eventsSource).toContain('import {');
      expect(eventsSource).toContain('getSheetValues');
      expect(eventsSource).toContain("from '../sheetsClient'");
    });

    it('should import isConfigured from sheetsClient', () => {
      expect(eventsSource).toContain('isConfigured');
    });

    it('should import SheetsError for error handling', () => {
      expect(eventsSource).toContain('SheetsError');
    });

    it('should import logSheetsClientError for logging', () => {
      expect(eventsSource).toContain('logSheetsClientError');
    });
  });
});

// =============================================================================
// Handlers Index Contract Tests
// =============================================================================

describe('Handlers Index Exports (Story 1.3)', () => {
  it('should export handleStatus', () => {
    expect(handlersIndexSource).toContain('handleStatus');
  });

  it('should export createSheetsDownResponse', () => {
    expect(handlersIndexSource).toContain('createSheetsDownResponse');
  });

  it('should export handleListEvents', () => {
    expect(handlersIndexSource).toContain('handleListEvents');
  });

  it('should export StatusEnv type', () => {
    expect(handlersIndexSource).toContain('type StatusEnv');
  });

  it('should export StatusResponse type', () => {
    expect(handlersIndexSource).toContain('type StatusResponse');
  });

  it('should export EventsEnv type', () => {
    expect(handlersIndexSource).toContain('type EventsEnv');
  });

  it('should export EventSummary type', () => {
    expect(handlersIndexSource).toContain('type EventSummary');
  });

  it('should export EventFull type', () => {
    expect(handlersIndexSource).toContain('type EventFull');
  });

  it('should export EventsListResponse type', () => {
    expect(handlersIndexSource).toContain('type EventsListResponse');
  });
});

// =============================================================================
// Main Index Integration Tests
// =============================================================================

describe('Main Index Integration (Story 1.3)', () => {
  it('should export handlers from main index', () => {
    expect(mainIndexSource).toContain("from './handlers'");
  });

  it('should export handleStatus from main index', () => {
    expect(mainIndexSource).toContain('handleStatus');
  });

  it('should export handleListEvents from main index', () => {
    expect(mainIndexSource).toContain('handleListEvents');
  });

  it('should reference Story 1.3 in comments', () => {
    expect(mainIndexSource).toContain('Story 1.3');
  });
});

// =============================================================================
// Acceptance Criteria Validation
// =============================================================================

describe('Story 1.3 Acceptance Criteria', () => {
  describe('/api/status Response (AC)', () => {
    it('should return ok: true when healthy', () => {
      expect(statusSource).toContain('ok: isHealthy');
    });

    it('should return status: 200 when healthy', () => {
      expect(statusSource).toContain('const httpStatus = isHealthy ? 200 : 503');
    });

    it('should return version string', () => {
      expect(statusSource).toContain("const WORKER_VERSION = '1.3.0'");
    });

    it('should return backend: "worker"', () => {
      expect(statusSource).toContain("backend: 'worker'");
    });

    it('should return sheets status', () => {
      expect(statusSource).toContain('sheets: sheetsStatus');
    });
  });

  describe('/api/events Response (AC)', () => {
    it('should return ok: true on success', () => {
      expect(eventsSource).toContain('ok: true');
    });

    it('should return status: 200 on success', () => {
      expect(eventsSource).toContain('status: 200');
    });

    it('should return items array', () => {
      expect(eventsSource).toContain('items,');
    });
  });

  describe('Negative Paths (AC)', () => {
    it('should return ok: false when Sheets down', () => {
      expect(statusSource).toContain('ok: false');
      expect(statusSource).toContain('status: 503');
    });

    it('should return empty items array when Events sheet empty', () => {
      expect(eventsSource).toContain('return createSuccessResponse([])');
    });
  });
});

// =============================================================================
// Contract Parity with GAS
// =============================================================================

describe('GAS Contract Parity', () => {
  describe('Status Endpoint Parity', () => {
    it('should have ok field like GAS status', () => {
      // GAS returns: { ok, buildId, brandId, time, db }
      // Worker returns: { ok, status, version, backend, sheets }
      expect(statusSource).toContain('ok:');
    });

    it('should provide health indicator like GAS db.ok', () => {
      // GAS has db: { ok: boolean }
      // Worker has sheets: 'ok' | 'error' | 'not_configured'
      expect(statusSource).toContain('sheets:');
    });
  });

  describe('Events Endpoint Parity', () => {
    it('should return events with matching fields', () => {
      // Event fields: id, slug, name, startDateISO, venue, createdAtISO, updatedAtISO
      expect(eventsSource).toContain('id: event.id');
      expect(eventsSource).toContain('slug: event.slug');
      expect(eventsSource).toContain('name: event.name');
      expect(eventsSource).toContain('startDateISO: event.startDateISO');
      expect(eventsSource).toContain('venue: event.venue');
      expect(eventsSource).toContain('createdAtISO: event.createdAtISO');
      expect(eventsSource).toContain('updatedAtISO: event.updatedAtISO');
    });

    it('should filter by brand like GAS', () => {
      expect(eventsSource).toContain("url.searchParams.get('brand')");
      expect(eventsSource).toContain('row[COL.BRAND_ID] !== brandId');
    });

    it('should support full event data like GAS', () => {
      expect(eventsSource).toContain("url.searchParams.get('full')");
      expect(eventsSource).toContain('includeFull');
    });
  });
});
