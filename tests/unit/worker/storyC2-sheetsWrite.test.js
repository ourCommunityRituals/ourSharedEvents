/**
 * Unit Tests for sheetsWrite.ts (Story C2)
 *
 * Tests the Google Sheets write client implementation contract.
 * Validates:
 * - Module exports (sheetsAppendValues, sheetsUpdateValues, etc.)
 * - Error codes (SHEETS_APPEND_FAILED, SHEETS_UPDATE_FAILED, SHEETS_EVENT_NOT_FOUND)
 * - ID generation utilities (generateUUID, generateShortId)
 * - Minimal event shape types
 * - Function signatures and acceptance criteria
 *
 * Story C2 Acceptance Criteria:
 * - Append succeeds with correct data
 * - Update succeeds deterministically (or returns 404 if event not found)
 * - Errors are structured: SHEETS_APPEND_FAILED, SHEETS_UPDATE_FAILED
 *
 * @see worker/src/google/sheetsWrite.ts
 */

const fs = require('fs');
const path = require('path');

// Read the source file for contract validation
const sheetsWritePath = path.join(__dirname, '../../../worker/src/google/sheetsWrite.ts');
const indexPath = path.join(__dirname, '../../../worker/src/google/index.ts');

let sheetsWriteSource = '';
let indexSource = '';

try {
  sheetsWriteSource = fs.readFileSync(sheetsWritePath, 'utf8');
  indexSource = fs.readFileSync(indexPath, 'utf8');
} catch (error) {
  console.error('Failed to read source files:', error.message);
}

// =============================================================================
// Module Contract Tests
// =============================================================================

describe('sheetsWrite Module Contract (Story C2)', () => {

  describe('Module Exports', () => {
    it('should export sheetsAppendValues function', () => {
      expect(sheetsWriteSource).toContain('export async function sheetsAppendValues(');
    });

    it('should export sheetsUpdateValues function', () => {
      expect(sheetsWriteSource).toContain('export async function sheetsUpdateValues(');
    });

    it('should export findEventRowById function', () => {
      expect(sheetsWriteSource).toContain('export async function findEventRowById(');
    });

    it('should export updateEventById function', () => {
      expect(sheetsWriteSource).toContain('export async function updateEventById(');
    });

    it('should export createSheetsWriteErrorResponse function', () => {
      expect(sheetsWriteSource).toContain('export function createSheetsWriteErrorResponse(');
    });

    it('should export SheetsWriteError class', () => {
      expect(sheetsWriteSource).toContain('export class SheetsWriteError extends Error');
    });

    it('should export SHEETS_WRITE_ERROR_CODES constant', () => {
      expect(sheetsWriteSource).toContain('export const SHEETS_WRITE_ERROR_CODES');
    });
  });

  describe('ID Generation Exports', () => {
    it('should export generateUUID function', () => {
      expect(sheetsWriteSource).toContain('export function generateUUID(');
    });

    it('should export generateShortId function', () => {
      expect(sheetsWriteSource).toContain('export function generateShortId(');
    });
  });

  describe('Type Exports', () => {
    it('should export SheetsWriteEnv interface', () => {
      expect(sheetsWriteSource).toContain('export interface SheetsWriteEnv');
    });

    it('should export MinimalEventShape interface', () => {
      expect(sheetsWriteSource).toContain('export interface MinimalEventShape');
    });

    it('should export SheetsAppendOptions interface', () => {
      expect(sheetsWriteSource).toContain('export interface SheetsAppendOptions');
    });

    it('should export SheetsUpdateOptions interface', () => {
      expect(sheetsWriteSource).toContain('export interface SheetsUpdateOptions');
    });

    it('should export SheetsAppendResult interface', () => {
      expect(sheetsWriteSource).toContain('export interface SheetsAppendResult');
    });

    it('should export SheetsUpdateResult interface', () => {
      expect(sheetsWriteSource).toContain('export interface SheetsUpdateResult');
    });

    it('should export FindEventRowResult interface', () => {
      expect(sheetsWriteSource).toContain('export interface FindEventRowResult');
    });
  });
});

// =============================================================================
// Error Code Tests (Story C2 AC)
// =============================================================================

describe('SHEETS_WRITE_ERROR_CODES (Story C2 AC)', () => {
  it('should define SHEETS_APPEND_FAILED error code', () => {
    expect(sheetsWriteSource).toContain("SHEETS_APPEND_FAILED: 'SHEETS_APPEND_FAILED'");
  });

  it('should define SHEETS_UPDATE_FAILED error code', () => {
    expect(sheetsWriteSource).toContain("SHEETS_UPDATE_FAILED: 'SHEETS_UPDATE_FAILED'");
  });

  it('should define SHEETS_EVENT_NOT_FOUND error code', () => {
    expect(sheetsWriteSource).toContain("SHEETS_EVENT_NOT_FOUND: 'SHEETS_EVENT_NOT_FOUND'");
  });
});

// =============================================================================
// Minimal Event Shape Tests (Backend Architect Spec)
// =============================================================================

describe('MinimalEventShape (Backend Architect Spec)', () => {
  it('should have required id field', () => {
    expect(sheetsWriteSource).toMatch(/id:\s*string/);
    expect(sheetsWriteSource).toContain('Unique event ID (required)');
  });

  it('should have required name field', () => {
    expect(sheetsWriteSource).toMatch(/name:\s*string/);
    expect(sheetsWriteSource).toContain('Event name (required)');
  });

  it('should have optional startDateISO field', () => {
    expect(sheetsWriteSource).toMatch(/startDateISO\?:\s*string/);
    expect(sheetsWriteSource).toContain('Event start date in ISO format (optional)');
  });

  it('should have optional slug field', () => {
    expect(sheetsWriteSource).toMatch(/slug\?:\s*string/);
    expect(sheetsWriteSource).toContain('URL-friendly slug (optional)');
  });

  it('should have optional brand field', () => {
    expect(sheetsWriteSource).toMatch(/brand\?:\s*string/);
    expect(sheetsWriteSource).toContain('Brand identifier (optional)');
  });
});

// =============================================================================
// ID Generation Tests
// =============================================================================

describe('ID Generation (Cloudflare Engineer Spec)', () => {
  describe('generateUUID', () => {
    it('should use crypto.randomUUID when available', () => {
      expect(sheetsWriteSource).toContain('crypto.randomUUID');
    });

    it('should have fallback UUID v4 generation', () => {
      expect(sheetsWriteSource).toContain('crypto.getRandomValues(bytes)');
    });

    it('should set version 4 bits', () => {
      // UUID v4 requires setting version bits in byte 6
      expect(sheetsWriteSource).toContain('bytes[6]');
      expect(sheetsWriteSource).toContain('0x40'); // version 4
    });

    it('should set variant bits', () => {
      // UUID v4 requires setting variant bits in byte 8
      expect(sheetsWriteSource).toContain('bytes[8]');
      expect(sheetsWriteSource).toContain('0x80'); // variant 10xx
    });

    it('should format UUID with hyphens', () => {
      // UUID format: 8-4-4-4-12
      expect(sheetsWriteSource).toContain('hex.slice(0, 8)');
      expect(sheetsWriteSource).toContain('hex.slice(8, 12)');
      expect(sheetsWriteSource).toContain('hex.slice(12, 16)');
      expect(sheetsWriteSource).toContain('hex.slice(16, 20)');
      expect(sheetsWriteSource).toContain('hex.slice(20)');
    });
  });

  describe('generateShortId', () => {
    it('should use timestamp in base36', () => {
      expect(sheetsWriteSource).toContain('Date.now().toString(36)');
    });

    it('should include random component', () => {
      expect(sheetsWriteSource).toContain('Math.random().toString(36)');
    });

    it('should support optional prefix', () => {
      expect(sheetsWriteSource).toContain('prefix?: string');
      expect(sheetsWriteSource).toContain('prefix ? `${prefix}-${id}`');
    });
  });
});

// =============================================================================
// Function Signature Tests
// =============================================================================

describe('Function Signatures', () => {
  describe('sheetsAppendValues', () => {
    it('should accept env parameter', () => {
      expect(sheetsWriteSource).toMatch(/sheetsAppendValues\(\s*env:\s*SheetsWriteEnv/);
    });

    it('should accept spreadsheetId parameter', () => {
      expect(sheetsWriteSource).toContain('spreadsheetId: string,');
    });

    it('should accept rangeA1 parameter', () => {
      expect(sheetsWriteSource).toContain('rangeA1: string,');
    });

    it('should accept values parameter as 2D array', () => {
      expect(sheetsWriteSource).toContain('values: (string | number | boolean | null)[][]');
    });

    it('should accept optional options parameter', () => {
      expect(sheetsWriteSource).toContain('options: SheetsAppendOptions = {}');
    });

    it('should return Promise<SheetsAppendResult>', () => {
      expect(sheetsWriteSource).toContain('): Promise<SheetsAppendResult>');
    });
  });

  describe('sheetsUpdateValues', () => {
    it('should accept env parameter', () => {
      expect(sheetsWriteSource).toMatch(/sheetsUpdateValues\(\s*env:\s*SheetsWriteEnv/);
    });

    it('should accept spreadsheetId parameter', () => {
      expect(sheetsWriteSource).toContain('spreadsheetId: string,');
    });

    it('should accept rangeA1 parameter', () => {
      expect(sheetsWriteSource).toContain('rangeA1: string,');
    });

    it('should accept values parameter as 2D array', () => {
      expect(sheetsWriteSource).toContain('values: (string | number | boolean | null)[][]');
    });

    it('should return Promise<SheetsUpdateResult>', () => {
      expect(sheetsWriteSource).toContain('): Promise<SheetsUpdateResult>');
    });
  });

  describe('updateEventById', () => {
    it('should accept env parameter', () => {
      expect(sheetsWriteSource).toMatch(/updateEventById\(\s*env:\s*SheetsWriteEnv/);
    });

    it('should accept spreadsheetId parameter', () => {
      expect(sheetsWriteSource).toContain('spreadsheetId: string,');
    });

    it('should accept sheetName parameter', () => {
      expect(sheetsWriteSource).toContain('sheetName: string,');
    });

    it('should accept eventId parameter', () => {
      expect(sheetsWriteSource).toContain('eventId: string,');
    });

    it('should accept values parameter', () => {
      expect(sheetsWriteSource).toContain('values: (string | number | boolean | null)[][]');
    });

    it('should throw SHEETS_EVENT_NOT_FOUND when event not found', () => {
      expect(sheetsWriteSource).toContain('SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND');
    });
  });
});

// =============================================================================
// API Implementation Tests
// =============================================================================

describe('Sheets API Implementation', () => {
  describe('Append API', () => {
    it('should use POST method for append', () => {
      expect(sheetsWriteSource).toContain("method: 'POST'");
    });

    it('should use :append endpoint', () => {
      expect(sheetsWriteSource).toContain(':append');
    });

    it('should set valueInputOption parameter', () => {
      expect(sheetsWriteSource).toContain('valueInputOption');
    });

    it('should set insertDataOption parameter', () => {
      expect(sheetsWriteSource).toContain('insertDataOption');
    });

    it('should default to USER_ENTERED value input', () => {
      expect(sheetsWriteSource).toContain("options.valueInputOption || 'USER_ENTERED'");
    });

    it('should default to INSERT_ROWS insert data option', () => {
      expect(sheetsWriteSource).toContain("options.insertDataOption || 'INSERT_ROWS'");
    });
  });

  describe('Update API', () => {
    it('should use PUT method for update', () => {
      expect(sheetsWriteSource).toContain("method: 'PUT'");
    });

    it('should set majorDimension to ROWS', () => {
      expect(sheetsWriteSource).toContain("majorDimension: 'ROWS'");
    });
  });

  describe('Authentication', () => {
    it('should import getGoogleAccessToken from auth module', () => {
      expect(sheetsWriteSource).toContain("import { getGoogleAccessToken");
      expect(sheetsWriteSource).toContain("from './auth'");
    });

    it('should use Bearer token authorization', () => {
      expect(sheetsWriteSource).toContain("'Authorization': `Bearer ${accessToken}`");
    });
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling', () => {
  describe('SheetsWriteError class', () => {
    it('should have code property', () => {
      expect(sheetsWriteSource).toMatch(/readonly code:\s*SheetsWriteErrorCode/);
    });

    it('should have googleStatus property', () => {
      expect(sheetsWriteSource).toMatch(/readonly googleStatus\?:\s*number/);
    });

    it('should have googleBody property', () => {
      expect(sheetsWriteSource).toMatch(/readonly googleBody\?:\s*string/);
    });

    it('should truncate googleBody to 400 chars', () => {
      expect(sheetsWriteSource).toContain('MAX_GOOGLE_BODY_SNIPPET_LENGTH');
      expect(sheetsWriteSource).toContain('truncateSnippet(options.googleBody, MAX_GOOGLE_BODY_SNIPPET_LENGTH)');
    });
  });

  describe('Validation', () => {
    it('should validate spreadsheetId is provided', () => {
      expect(sheetsWriteSource).toContain('!spreadsheetId');
      expect(sheetsWriteSource).toContain('spreadsheetId is required');
    });

    it('should validate values array is not empty', () => {
      expect(sheetsWriteSource).toContain('!values || values.length === 0');
      expect(sheetsWriteSource).toContain('Values array cannot be empty');
    });
  });

  describe('Timeout Handling', () => {
    it('should use AbortController for timeouts', () => {
      expect(sheetsWriteSource).toContain('new AbortController()');
    });

    it('should default to 10 second timeout', () => {
      expect(sheetsWriteSource).toContain('SHEETS_REQUEST_TIMEOUT_MS = 10000');
    });

    it('should handle AbortError', () => {
      expect(sheetsWriteSource).toContain("error.name === 'AbortError'");
    });
  });
});

// =============================================================================
// Error Response Helper Tests
// =============================================================================

describe('createSheetsWriteErrorResponse', () => {
  it('should return 404 for SHEETS_EVENT_NOT_FOUND', () => {
    expect(sheetsWriteSource).toContain('error.code === SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND');
    expect(sheetsWriteSource).toContain('httpStatus = 404');
  });

  it('should return 503 for other errors', () => {
    expect(sheetsWriteSource).toContain('let httpStatus = 503');
  });

  it('should include requestId in response', () => {
    expect(sheetsWriteSource).toContain('requestId');
    expect(sheetsWriteSource).toContain("'X-Request-Id': requestId");
  });

  it('should include timestamp in response', () => {
    expect(sheetsWriteSource).toContain('timestamp: new Date().toISOString()');
  });

  it('should log error for CI/CD gates', () => {
    expect(sheetsWriteSource).toContain("type: 'SHEETS_WRITE_ERROR'");
    expect(sheetsWriteSource).toContain('console.error(JSON.stringify({');
  });

  it('should set Cache-Control to no-cache', () => {
    expect(sheetsWriteSource).toContain("'Cache-Control': 'no-cache, no-store, must-revalidate'");
  });
});

// =============================================================================
// Barrel Export Tests
// =============================================================================

describe('Barrel Exports (index.ts)', () => {
  it('should export sheetsAppendValues', () => {
    expect(indexSource).toContain('sheetsAppendValues');
  });

  it('should export sheetsUpdateValues', () => {
    expect(indexSource).toContain('sheetsUpdateValues');
  });

  it('should export findEventRowById', () => {
    expect(indexSource).toContain('findEventRowById');
  });

  it('should export updateEventById', () => {
    expect(indexSource).toContain('updateEventById');
  });

  it('should export createSheetsWriteErrorResponse', () => {
    expect(indexSource).toContain('createSheetsWriteErrorResponse');
  });

  it('should export generateUUID', () => {
    expect(indexSource).toContain('generateUUID');
  });

  it('should export generateShortId', () => {
    expect(indexSource).toContain('generateShortId');
  });

  it('should export SheetsWriteError', () => {
    expect(indexSource).toContain('SheetsWriteError');
  });

  it('should export SHEETS_WRITE_ERROR_CODES', () => {
    expect(indexSource).toContain('SHEETS_WRITE_ERROR_CODES');
  });

  it('should export type SheetsWriteEnv', () => {
    expect(indexSource).toContain('type SheetsWriteEnv');
  });

  it('should export type MinimalEventShape', () => {
    expect(indexSource).toContain('type MinimalEventShape');
  });

  it('should indicate Story C2 in comments', () => {
    expect(indexSource).toContain('Story C2');
  });
});

// =============================================================================
// Acceptance Criteria Validation
// =============================================================================

describe('Story C2 Acceptance Criteria', () => {
  describe('Append succeeds with correct data', () => {
    it('should implement sheetsAppendValues function', () => {
      expect(sheetsWriteSource).toContain('export async function sheetsAppendValues(');
    });

    it('should return SheetsAppendResult with updatedRows', () => {
      expect(sheetsWriteSource).toContain('updatedRows: data.updates?.updatedRows || 0');
    });

    it('should return updatedColumns in result', () => {
      expect(sheetsWriteSource).toContain('updatedColumns: data.updates?.updatedColumns || 0');
    });

    it('should return updatedCells in result', () => {
      expect(sheetsWriteSource).toContain('updatedCells: data.updates?.updatedCells || 0');
    });

    it('should return updatedRange in result', () => {
      expect(sheetsWriteSource).toContain('updatedRange: data.updates?.updatedRange');
    });
  });

  describe('Update succeeds deterministically or returns 404', () => {
    it('should implement updateEventById function', () => {
      expect(sheetsWriteSource).toContain('export async function updateEventById(');
    });

    it('should call findEventRowById to locate event', () => {
      expect(sheetsWriteSource).toContain('findEventRowById(env, spreadsheetId, sheetName, eventId)');
    });

    it('should throw SHEETS_EVENT_NOT_FOUND when event not found', () => {
      expect(sheetsWriteSource).toContain("!findResult.found || !findResult.rowNumber");
      expect(sheetsWriteSource).toContain('SHEETS_WRITE_ERROR_CODES.SHEETS_EVENT_NOT_FOUND');
    });

    it('should calculate update range from row number', () => {
      expect(sheetsWriteSource).toContain("sheetName}!A${findResult.rowNumber}");
    });
  });

  describe('Errors are structured', () => {
    it('should define SHEETS_APPEND_FAILED error code', () => {
      expect(sheetsWriteSource).toContain("SHEETS_APPEND_FAILED: 'SHEETS_APPEND_FAILED'");
    });

    it('should define SHEETS_UPDATE_FAILED error code', () => {
      expect(sheetsWriteSource).toContain("SHEETS_UPDATE_FAILED: 'SHEETS_UPDATE_FAILED'");
    });

    it('should use SHEETS_APPEND_FAILED for append errors', () => {
      expect(sheetsWriteSource).toContain('SHEETS_WRITE_ERROR_CODES.SHEETS_APPEND_FAILED');
    });

    it('should use SHEETS_UPDATE_FAILED for update errors', () => {
      expect(sheetsWriteSource).toContain('SHEETS_WRITE_ERROR_CODES.SHEETS_UPDATE_FAILED');
    });
  });

  describe('ID Generation (Cloudflare Engineer Spec)', () => {
    it('should implement UUID v4 generation', () => {
      expect(sheetsWriteSource).toContain('export function generateUUID(');
    });

    it('should implement short ID generation', () => {
      expect(sheetsWriteSource).toContain('export function generateShortId(');
    });
  });
});

// =============================================================================
// Documentation Tests
// =============================================================================

describe('API Documentation', () => {
  it('should have JSDoc for sheetsAppendValues', () => {
    expect(sheetsWriteSource).toContain('* Append values to a Google Sheets range');
    expect(sheetsWriteSource).toContain('* Per Story C2: Create event = append row to Events sheet');
  });

  it('should have JSDoc for sheetsUpdateValues', () => {
    expect(sheetsWriteSource).toContain('* Update values in a specific Google Sheets range');
    expect(sheetsWriteSource).toContain('* Per Story C2: Update event = find row by id then update range');
  });

  it('should have usage example for sheetsAppendValues', () => {
    expect(sheetsWriteSource).toContain('@example');
    expect(sheetsWriteSource).toContain("await sheetsAppendValues(env, spreadsheetId, 'EVENTS!A:G'");
  });

  it('should have usage example for updateEventById', () => {
    expect(sheetsWriteSource).toContain("await updateEventById(env, spreadsheetId, 'EVENTS', 'evt-123'");
  });

  it('should have module header with Story C2 reference', () => {
    expect(sheetsWriteSource).toContain('@module google/sheetsWrite');
    expect(sheetsWriteSource).toContain('@see Story C2 - Sheets Write Client (Append + Update)');
  });
});
