/**
 * Unit Tests for Story 3.3 - Analytics Writer
 *
 * Tests the analytics writer implementation.
 * Validates:
 * - Row format (12 columns with source and env)
 * - Environment detection (prod/stg/dev)
 * - Spreadsheet value sanitization
 * - Single and batch logging
 * - Convenience functions
 *
 * @see worker/src/sheets/analyticsWriter.ts
 * @see Story 3.3 - Port recordResult to Worker
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const analyticsWriterPath = path.join(__dirname, '../../../worker/src/sheets/analyticsWriter.ts');
const sheetsIndexPath = path.join(__dirname, '../../../worker/src/sheets/index.ts');
const mainIndexPath = path.join(__dirname, '../../../worker/src/index.ts');

let analyticsWriterSource = '';
let sheetsIndexSource = '';
let mainIndexSource = '';

beforeAll(() => {
  try {
    analyticsWriterSource = fs.readFileSync(analyticsWriterPath, 'utf8');
    sheetsIndexSource = fs.readFileSync(sheetsIndexPath, 'utf8');
    mainIndexSource = fs.readFileSync(mainIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Module Structure Tests
// =============================================================================

describe('Analytics Writer Structure (Story 3.3)', () => {

  describe('Function Exports', () => {
    it('should export getEnvironmentString function', () => {
      expect(analyticsWriterSource).toContain('export function getEnvironmentString(');
    });

    it('should export isValidSurface function', () => {
      expect(analyticsWriterSource).toContain('export function isValidSurface(');
    });

    it('should export isValidMetric function', () => {
      expect(analyticsWriterSource).toContain('export function isValidMetric(');
    });

    it('should export sanitizeSpreadsheetValue function', () => {
      expect(analyticsWriterSource).toContain('export function sanitizeSpreadsheetValue(');
    });

    it('should export buildAnalyticsRow function', () => {
      expect(analyticsWriterSource).toContain('export function buildAnalyticsRow(');
    });

    it('should export logAnalyticsEvent function', () => {
      expect(analyticsWriterSource).toContain('export async function logAnalyticsEvent(');
    });

    it('should export logAnalyticsEvents function', () => {
      expect(analyticsWriterSource).toContain('export async function logAnalyticsEvents(');
    });

    it('should export logResultUpdate function', () => {
      expect(analyticsWriterSource).toContain('export async function logResultUpdate(');
    });
  });

  describe('Type Exports', () => {
    it('should export AnalyticsWriterEnv interface', () => {
      expect(analyticsWriterSource).toContain('export interface AnalyticsWriterEnv');
    });

    it('should export AnalyticsLogInput interface', () => {
      expect(analyticsWriterSource).toContain('export interface AnalyticsLogInput');
    });

    it('should export AnalyticsLogResult interface', () => {
      expect(analyticsWriterSource).toContain('export interface AnalyticsLogResult');
    });

    it('should export AnalyticsBatchLogResult interface', () => {
      expect(analyticsWriterSource).toContain('export interface AnalyticsBatchLogResult');
    });

    it('should export Surface type', () => {
      expect(analyticsWriterSource).toContain('export type Surface');
    });

    it('should export Metric type', () => {
      expect(analyticsWriterSource).toContain('export type Metric');
    });
  });

  describe('Constant Exports', () => {
    it('should export ANALYTICS_COL', () => {
      expect(analyticsWriterSource).toContain('export const ANALYTICS_COL');
    });

    it('should export ANALYTICS_SOURCE', () => {
      expect(analyticsWriterSource).toContain('export const ANALYTICS_SOURCE');
    });

    it('should export ANALYTICS_ENV', () => {
      expect(analyticsWriterSource).toContain('export const ANALYTICS_ENV');
    });

    it('should export VALID_SURFACES', () => {
      expect(analyticsWriterSource).toContain('export const VALID_SURFACES');
    });

    it('should export VALID_METRICS', () => {
      expect(analyticsWriterSource).toContain('export const VALID_METRICS');
    });
  });
});

// =============================================================================
// Column Definition Tests (12 columns)
// =============================================================================

describe('Column Definitions (Story 3.3)', () => {

  it('should define TIMESTAMP column (0)', () => {
    expect(analyticsWriterSource).toContain('TIMESTAMP: 0');
  });

  it('should define EVENT_ID column (1)', () => {
    expect(analyticsWriterSource).toContain('EVENT_ID: 1');
  });

  it('should define SURFACE column (2)', () => {
    expect(analyticsWriterSource).toContain('SURFACE: 2');
  });

  it('should define METRIC column (3)', () => {
    expect(analyticsWriterSource).toContain('METRIC: 3');
  });

  it('should define SPONSOR_ID column (4)', () => {
    expect(analyticsWriterSource).toContain('SPONSOR_ID: 4');
  });

  it('should define VALUE column (5)', () => {
    expect(analyticsWriterSource).toContain('VALUE: 5');
  });

  it('should define TOKEN column (6)', () => {
    expect(analyticsWriterSource).toContain('TOKEN: 6');
  });

  it('should define USER_AGENT column (7)', () => {
    expect(analyticsWriterSource).toContain('USER_AGENT: 7');
  });

  it('should define SESSION_ID column (8)', () => {
    expect(analyticsWriterSource).toContain('SESSION_ID: 8');
  });

  it('should define VISIBLE_SPONSOR_IDS column (9)', () => {
    expect(analyticsWriterSource).toContain('VISIBLE_SPONSOR_IDS: 9');
  });

  it('should define SOURCE column (10)', () => {
    expect(analyticsWriterSource).toContain('SOURCE: 10');
  });

  it('should define ENV column (11)', () => {
    expect(analyticsWriterSource).toContain('ENV: 11');
  });
});

// =============================================================================
// Source Constants Tests
// =============================================================================

describe('Source Constants (Story 3.3)', () => {

  it('should define WORKER source', () => {
    expect(analyticsWriterSource).toContain("WORKER: 'worker'");
  });

  it('should define GAS source', () => {
    expect(analyticsWriterSource).toContain("GAS: 'gas'");
  });

  it('should define CLIENT source', () => {
    expect(analyticsWriterSource).toContain("CLIENT: 'client'");
  });
});

// =============================================================================
// Environment Constants Tests
// =============================================================================

describe('Environment Constants (Story 3.3)', () => {

  it('should define PRODUCTION environment', () => {
    expect(analyticsWriterSource).toContain("PRODUCTION: 'prod'");
  });

  it('should define STAGING environment', () => {
    expect(analyticsWriterSource).toContain("STAGING: 'stg'");
  });

  it('should define DEVELOPMENT environment', () => {
    expect(analyticsWriterSource).toContain("DEVELOPMENT: 'dev'");
  });
});

// =============================================================================
// Valid Surfaces Tests
// =============================================================================

describe('Valid Surfaces (Story 3.3)', () => {

  it('should include public surface', () => {
    expect(analyticsWriterSource).toContain("'public'");
  });

  it('should include display surface', () => {
    expect(analyticsWriterSource).toContain("'display'");
  });

  it('should include poster surface', () => {
    expect(analyticsWriterSource).toContain("'poster'");
  });

  it('should include admin surface', () => {
    expect(analyticsWriterSource).toContain("'admin'");
  });
});

// =============================================================================
// Valid Metrics Tests
// =============================================================================

describe('Valid Metrics (Story 3.3)', () => {

  it('should include impression metric', () => {
    expect(analyticsWriterSource).toContain("'impression'");
  });

  it('should include click metric', () => {
    expect(analyticsWriterSource).toContain("'click'");
  });

  it('should include scan metric', () => {
    expect(analyticsWriterSource).toContain("'scan'");
  });

  it('should include dwellSec metric', () => {
    expect(analyticsWriterSource).toContain("'dwellSec'");
  });

  it('should include result_update metric', () => {
    expect(analyticsWriterSource).toContain("'result_update'");
  });

  it('should include schedule_update metric', () => {
    expect(analyticsWriterSource).toContain("'schedule_update'");
  });

  it('should include standings_update metric', () => {
    expect(analyticsWriterSource).toContain("'standings_update'");
  });

  it('should include bracket_update metric', () => {
    expect(analyticsWriterSource).toContain("'bracket_update'");
  });
});

// =============================================================================
// Environment Detection Tests
// =============================================================================

describe('Environment Detection (Story 3.3)', () => {

  it('should detect production environment', () => {
    expect(analyticsWriterSource).toContain("workerEnv === 'production'");
    expect(analyticsWriterSource).toContain("workerEnv === 'prod'");
  });

  it('should detect staging environment', () => {
    expect(analyticsWriterSource).toContain("workerEnv === 'staging'");
    expect(analyticsWriterSource).toContain("workerEnv === 'stg'");
  });

  it('should default to development', () => {
    expect(analyticsWriterSource).toContain('return ANALYTICS_ENV.DEVELOPMENT');
  });

  it('should convert environment to lowercase', () => {
    expect(analyticsWriterSource).toContain('env.WORKER_ENV?.toLowerCase()');
  });
});

// =============================================================================
// Spreadsheet Sanitization Tests
// =============================================================================

describe('Spreadsheet Sanitization (Story 3.3)', () => {

  it('should handle empty values', () => {
    expect(analyticsWriterSource).toContain("if (!value || typeof value !== 'string')");
    expect(analyticsWriterSource).toContain("return ''");
  });

  it('should detect dangerous characters', () => {
    expect(analyticsWriterSource).toContain("['=', '+', '-', '@', '\\t', '\\r', '\\n']");
  });

  it('should prefix dangerous values with quote', () => {
    expect(analyticsWriterSource).toContain("return `'${value}`");
  });

  it('should check if value starts with dangerous character', () => {
    expect(analyticsWriterSource).toContain('value.startsWith(char)');
  });
});

// =============================================================================
// Row Building Tests
// =============================================================================

describe('Row Building (Story 3.3)', () => {

  it('should build 12-column row', () => {
    // Check that row contains all expected fields
    expect(analyticsWriterSource).toContain('now,');
    expect(analyticsWriterSource).toContain("sanitizeSpreadsheetValue(input.eventId)");
    expect(analyticsWriterSource).toContain("sanitizeSpreadsheetValue(input.surface)");
    expect(analyticsWriterSource).toContain("sanitizeSpreadsheetValue(input.metric)");
    expect(analyticsWriterSource).toContain("sanitizeSpreadsheetValue(input.sponsorId || '')");
    expect(analyticsWriterSource).toContain("Number(input.value || 0)");
    expect(analyticsWriterSource).toContain("sanitizeSpreadsheetValue(input.token || '')");
    expect(analyticsWriterSource).toContain('source,');
    expect(analyticsWriterSource).toContain('env,');
  });

  it('should truncate user agent to 200 characters', () => {
    expect(analyticsWriterSource).toContain(".slice(0, 200)");
  });

  it('should use current time if no timestamp provided', () => {
    expect(analyticsWriterSource).toContain('input.timestamp || new Date().toISOString()');
  });
});

// =============================================================================
// Single Event Logging Tests
// =============================================================================

describe('Single Event Logging (Story 3.3)', () => {

  it('should validate eventId is required', () => {
    expect(analyticsWriterSource).toContain("'Missing required field: eventId'");
  });

  it('should validate surface is required', () => {
    expect(analyticsWriterSource).toContain("'Missing required field: surface'");
  });

  it('should validate metric is required', () => {
    expect(analyticsWriterSource).toContain("'Missing required field: metric'");
  });

  it('should use WORKER source', () => {
    expect(analyticsWriterSource).toContain('const source = ANALYTICS_SOURCE.WORKER');
  });

  it('should append row to ANALYTICS sheet', () => {
    expect(analyticsWriterSource).toContain('appendRow(env, ANALYTICS_SHEET, row)');
  });

  it('should verify append succeeded', () => {
    expect(analyticsWriterSource).toContain('result.updatedRows !== 1');
    expect(analyticsWriterSource).toContain("'Analytics row was not appended correctly'");
  });

  it('should return success result', () => {
    expect(analyticsWriterSource).toContain('return { success: true }');
  });

  it('should handle errors', () => {
    expect(analyticsWriterSource).toContain("'Failed to log analytics event'");
  });
});

// =============================================================================
// Batch Logging Tests
// =============================================================================

describe('Batch Logging (Story 3.3)', () => {

  it('should handle empty input array', () => {
    expect(analyticsWriterSource).toContain('if (!inputs || inputs.length === 0)');
    expect(analyticsWriterSource).toContain('return { success: true, count: 0 }');
  });

  it('should track success count', () => {
    expect(analyticsWriterSource).toContain('let successCount = 0');
    expect(analyticsWriterSource).toContain('successCount++');
  });

  it('should collect errors', () => {
    expect(analyticsWriterSource).toContain('const errors: string[] = []');
    expect(analyticsWriterSource).toContain("errors.push(result.error || 'Unknown error')");
  });

  it('should return batch result', () => {
    expect(analyticsWriterSource).toContain('count: successCount');
    expect(analyticsWriterSource).toContain("error: errors.length > 0 ? errors.join('; ')");
  });
});

// =============================================================================
// logResultUpdate Convenience Function Tests
// =============================================================================

describe('logResultUpdate Convenience Function (Story 3.3)', () => {

  it('should accept result update metric types', () => {
    expect(analyticsWriterSource).toContain("metric: 'result_update' | 'schedule_update' | 'standings_update' | 'bracket_update'");
  });

  it('should use admin surface', () => {
    expect(analyticsWriterSource).toContain("surface: 'admin'");
  });

  it('should set value to 1', () => {
    expect(analyticsWriterSource).toContain('value: 1');
  });

  it('should pass sessionId and userAgent', () => {
    expect(analyticsWriterSource).toContain('sessionId: details?.sessionId');
    expect(analyticsWriterSource).toContain('userAgent: details?.userAgent');
  });

  it('should call logAnalyticsEvent', () => {
    expect(analyticsWriterSource).toContain('return logAnalyticsEvent(env, {');
  });
});

// =============================================================================
// AnalyticsLogInput Interface Tests
// =============================================================================

describe('AnalyticsLogInput Interface (Story 3.3)', () => {

  it('should have required eventId', () => {
    expect(analyticsWriterSource).toContain('eventId: string');
  });

  it('should have required surface', () => {
    expect(analyticsWriterSource).toContain('surface: Surface | string');
  });

  it('should have required metric', () => {
    expect(analyticsWriterSource).toContain('metric: Metric | string');
  });

  it('should have optional sponsorId', () => {
    expect(analyticsWriterSource).toContain('sponsorId?: string');
  });

  it('should have optional value', () => {
    expect(analyticsWriterSource).toContain('value?: number');
  });

  it('should have optional token', () => {
    expect(analyticsWriterSource).toContain('token?: string');
  });

  it('should have optional userAgent', () => {
    expect(analyticsWriterSource).toContain('userAgent?: string');
  });

  it('should have optional sessionId', () => {
    expect(analyticsWriterSource).toContain('sessionId?: string');
  });

  it('should have optional visibleSponsorIds', () => {
    expect(analyticsWriterSource).toContain('visibleSponsorIds?: string');
  });

  it('should have optional timestamp', () => {
    expect(analyticsWriterSource).toContain('timestamp?: string');
  });
});

// =============================================================================
// Barrel Export Tests
// =============================================================================

describe('Barrel Exports (Story 3.3)', () => {

  describe('Sheets Index Exports', () => {
    it('should export getEnvironmentString', () => {
      expect(sheetsIndexSource).toContain('getEnvironmentString');
    });

    it('should export isValidSurface', () => {
      expect(sheetsIndexSource).toContain('isValidSurface');
    });

    it('should export isValidMetric', () => {
      expect(sheetsIndexSource).toContain('isValidMetric');
    });

    it('should export sanitizeSpreadsheetValue', () => {
      expect(sheetsIndexSource).toContain('sanitizeSpreadsheetValue');
    });

    it('should export buildAnalyticsRow', () => {
      expect(sheetsIndexSource).toContain('buildAnalyticsRow');
    });

    it('should export logAnalyticsEvent', () => {
      expect(sheetsIndexSource).toContain('logAnalyticsEvent');
    });

    it('should export logAnalyticsEvents', () => {
      expect(sheetsIndexSource).toContain('logAnalyticsEvents');
    });

    it('should export logResultUpdate', () => {
      expect(sheetsIndexSource).toContain('logResultUpdate');
    });

    it('should export ANALYTICS_COL', () => {
      expect(sheetsIndexSource).toContain('ANALYTICS_COL');
    });

    it('should export ANALYTICS_SOURCE', () => {
      expect(sheetsIndexSource).toContain('ANALYTICS_SOURCE');
    });

    it('should export ANALYTICS_ENV', () => {
      expect(sheetsIndexSource).toContain('ANALYTICS_ENV');
    });
  });

  describe('Main Index Exports', () => {
    it('should export logAnalyticsEvent', () => {
      expect(mainIndexSource).toContain('logAnalyticsEvent');
    });

    it('should export logResultUpdate', () => {
      expect(mainIndexSource).toContain('logResultUpdate');
    });

    it('should export type AnalyticsWriterEnv', () => {
      expect(mainIndexSource).toContain('type AnalyticsWriterEnv');
    });

    it('should export ANALYTICS_COL', () => {
      expect(mainIndexSource).toContain('ANALYTICS_COL');
    });
  });
});

// =============================================================================
// Documentation Tests
// =============================================================================

describe('Documentation (Story 3.3)', () => {

  it('should have module-level JSDoc', () => {
    expect(analyticsWriterSource).toContain('@module sheets/analyticsWriter');
  });

  it('should reference Story 3.3', () => {
    expect(analyticsWriterSource).toContain('Story 3.3');
  });

  it('should document row format with 12 columns', () => {
    expect(analyticsWriterSource).toContain('Row format (12 columns)');
  });

  it('should document source and env columns', () => {
    expect(analyticsWriterSource).toContain('source, env');
  });
});

// =============================================================================
// Sheet Constants Tests
// =============================================================================

describe('Sheet Constants (Story 3.3)', () => {

  it('should define ANALYTICS_SHEET constant', () => {
    expect(analyticsWriterSource).toContain("ANALYTICS_SHEET = 'ANALYTICS'");
  });
});
