/**
 * API Version Compatibility Tests (Story 3.2)
 *
 * Compares staging and production API responses to ensure contract alignment.
 * Detects structural differences between environments that could cause issues.
 *
 * Purpose:
 * - Ensure staging truly replicates production behavior
 * - Detect contract drift before it causes production issues
 * - Verify Cloudflare worker is transparent (not modifying responses)
 * - Flag any fields present in one environment but not the other
 *
 * Acceptance Criteria (Story 3.2):
 * - Script compares staging and production API responses for critical endpoints
 * - Flags structural differences (fields present in one but not the other)
 * - Runs in CI pipeline (nightly or on-demand)
 * - Reports discrepancies to the team
 *
 * Environment Variables:
 * - RUN_API_VERSION_CHECK: Set to 'true' to run live API comparisons
 * - STAGING_BASE_URL: Override staging URL (default: api-stg.eventangle.com)
 * - PRODUCTION_BASE_URL: Override production URL (default: api.eventangle.com)
 *
 * @see tests/shared/helpers/api-version-comparator.js
 * @see API_CONTRACT.md
 */

const {
  compareResponses,
  compareStructures,
  extractStructure,
  getStructuralType,
  compareEnvironments,
  formatReport,
  formatJsonReport,
  CRITICAL_ENDPOINTS,
  IGNORED_FIELDS
} = require('../shared/helpers/api-version-comparator');

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Skip live API tests by default in CI
 * Set RUN_API_VERSION_CHECK=true to enable live comparison
 */
const RUN_LIVE_TESTS = process.env.RUN_API_VERSION_CHECK === 'true';

/**
 * Test timeout for API calls (30 seconds)
 */
const API_TIMEOUT = 30000;

// ============================================================================
// UNIT TESTS: STRUCTURAL COMPARISON LOGIC
// ============================================================================

describe('API Version Compatibility (Story 3.2)', () => {

  describe('Structural Type Detection', () => {

    it('identifies null type', () => {
      expect(getStructuralType(null)).toBe('null');
    });

    it('identifies undefined type', () => {
      expect(getStructuralType(undefined)).toBe('undefined');
    });

    it('identifies array type', () => {
      expect(getStructuralType([])).toBe('array');
      expect(getStructuralType([1, 2, 3])).toBe('array');
    });

    it('identifies object type', () => {
      expect(getStructuralType({})).toBe('object');
      expect(getStructuralType({ foo: 'bar' })).toBe('object');
    });

    it('identifies primitive types', () => {
      expect(getStructuralType('hello')).toBe('string');
      expect(getStructuralType(123)).toBe('number');
      expect(getStructuralType(true)).toBe('boolean');
    });

  });

  describe('Structure Extraction', () => {

    it('extracts primitive structure', () => {
      expect(extractStructure('hello')).toEqual({ type: 'string' });
      expect(extractStructure(42)).toEqual({ type: 'number' });
      expect(extractStructure(true)).toEqual({ type: 'boolean' });
    });

    it('extracts null structure', () => {
      expect(extractStructure(null)).toEqual({ type: 'null' });
    });

    it('extracts empty array structure', () => {
      expect(extractStructure([])).toEqual({
        type: 'array',
        itemType: 'unknown'
      });
    });

    it('extracts array with items structure', () => {
      const result = extractStructure([1, 2, 3]);
      expect(result.type).toBe('array');
      expect(result.itemType).toEqual({ type: 'number' });
    });

    it('extracts object structure', () => {
      const obj = { name: 'test', count: 5 };
      const result = extractStructure(obj);

      expect(result.type).toBe('object');
      expect(result.fields).toBeDefined();
      expect(result.fields.name).toEqual({ type: 'string' });
      expect(result.fields.count).toEqual({ type: 'number' });
    });

    it('extracts nested object structure', () => {
      const obj = {
        user: {
          name: 'test',
          settings: {
            theme: 'dark'
          }
        }
      };
      const result = extractStructure(obj);

      expect(result.type).toBe('object');
      expect(result.fields.user.type).toBe('object');
      expect(result.fields.user.fields.settings.type).toBe('object');
      expect(result.fields.user.fields.settings.fields.theme.type).toBe('string');
    });

  });

  describe('Structure Comparison', () => {

    it('detects identical structures', () => {
      const structA = extractStructure({ ok: true, value: 'test' });
      const structB = extractStructure({ ok: true, value: 'other' });

      const diffs = compareStructures(structA, structB, '', []);
      expect(diffs).toEqual([]);
    });

    it('detects type mismatch', () => {
      const structA = extractStructure({ ok: true });
      const structB = extractStructure({ ok: 'yes' });

      const diffs = compareStructures(structA, structB, '', []);
      expect(diffs.length).toBe(1);
      expect(diffs[0].type).toBe('type_mismatch');
      expect(diffs[0].path).toBe('ok');
      expect(diffs[0].staging).toBe('boolean');
      expect(diffs[0].production).toBe('string');
    });

    it('detects missing field in staging', () => {
      const structA = extractStructure({ ok: true });
      const structB = extractStructure({ ok: true, extra: 'field' });

      const diffs = compareStructures(structA, structB, '', []);
      expect(diffs.length).toBe(1);
      expect(diffs[0].type).toBe('field_missing_staging');
      expect(diffs[0].path).toBe('extra');
    });

    it('detects missing field in production', () => {
      const structA = extractStructure({ ok: true, extra: 'field' });
      const structB = extractStructure({ ok: true });

      const diffs = compareStructures(structA, structB, '', []);
      expect(diffs.length).toBe(1);
      expect(diffs[0].type).toBe('field_missing_production');
      expect(diffs[0].path).toBe('extra');
    });

    it('ignores configured fields', () => {
      const structA = extractStructure({ ok: true, time: '2024-01-01' });
      const structB = extractStructure({ ok: true });

      // Without ignore
      const diffsNoIgnore = compareStructures(structA, structB, '', []);
      expect(diffsNoIgnore.length).toBe(1);

      // With ignore
      const diffsWithIgnore = compareStructures(structA, structB, '', ['time']);
      expect(diffsWithIgnore.length).toBe(0);
    });

    it('handles nested differences', () => {
      const structA = extractStructure({
        ok: true,
        value: { name: 'test', count: 5 }
      });
      const structB = extractStructure({
        ok: true,
        value: { name: 'test', count: 'five' }
      });

      const diffs = compareStructures(structA, structB, '', []);
      expect(diffs.length).toBe(1);
      expect(diffs[0].path).toBe('value.count');
      expect(diffs[0].type).toBe('type_mismatch');
    });

  });

  describe('Response Comparison', () => {

    it('compares identical responses', () => {
      const staging = { ok: true, value: { id: 1, name: 'test' } };
      const prod = { ok: true, value: { id: 2, name: 'other' } };

      const result = compareResponses(staging, prod);
      expect(result.identical).toBe(true);
      expect(result.compatible).toBe(true);
      expect(result.differences).toEqual([]);
    });

    it('flags incompatible responses', () => {
      const staging = { ok: true, value: { id: 1, name: 'test' } };
      const prod = { ok: true, value: { id: 2, count: 5 } };

      const result = compareResponses(staging, prod);
      expect(result.identical).toBe(false);
      expect(result.differences.length).toBe(2); // name missing in prod, count missing in staging
    });

    it('provides summary statistics', () => {
      const staging = { ok: true, value: 'test' };
      const prod = { ok: true, value: 123 };

      const result = compareResponses(staging, prod);
      expect(result.summary).toBeDefined();
      expect(result.summary.total).toBe(1);
      expect(result.summary.errors).toBe(1);
      expect(result.summary.warnings).toBe(0);
    });

  });

  describe('Status Endpoint Contract (Flat Format)', () => {

    it('validates identical status responses', () => {
      const staging = {
        ok: true,
        buildId: 'stg-123',
        brandId: 'root',
        time: '2024-01-01T00:00:00.000Z'
      };
      const prod = {
        ok: true,
        buildId: 'prod-456',
        brandId: 'root',
        time: '2024-01-01T00:00:01.000Z'
      };

      const result = compareResponses(staging, prod, {
        ignoredFields: IGNORED_FIELDS,
        endpointName: 'status'
      });

      expect(result.identical).toBe(true);
      expect(result.compatible).toBe(true);
    });

    it('flags structural differences in status', () => {
      const staging = {
        ok: true,
        buildId: 'stg-123',
        brandId: 'root',
        time: '2024-01-01T00:00:00.000Z',
        db: { ok: true }
      };
      const prod = {
        ok: true,
        buildId: 'prod-456',
        brandId: 'root',
        time: '2024-01-01T00:00:01.000Z'
        // Missing db field
      };

      const result = compareResponses(staging, prod, {
        ignoredFields: IGNORED_FIELDS,
        endpointName: 'status'
      });

      expect(result.identical).toBe(false);
      expect(result.differences.length).toBeGreaterThan(0);
    });

  });

  describe('API Envelope Contract', () => {

    it('validates identical success envelopes', () => {
      const staging = {
        ok: true,
        value: { items: [{ id: '1', name: 'Event A' }] },
        etag: 'stg-etag'
      };
      const prod = {
        ok: true,
        value: { items: [{ id: '2', name: 'Event B' }] },
        etag: 'prod-etag'
      };

      const result = compareResponses(staging, prod, {
        ignoredFields: IGNORED_FIELDS
      });

      expect(result.compatible).toBe(true);
    });

    it('validates identical error envelopes', () => {
      const staging = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Resource not found',
        corrId: 'stg-123'
      };
      const prod = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Resource not found in production',
        corrId: 'prod-456'
      };

      const result = compareResponses(staging, prod, {
        ignoredFields: [...IGNORED_FIELDS, 'message']
      });

      expect(result.compatible).toBe(true);
    });

    it('detects envelope structural drift', () => {
      const staging = {
        ok: true,
        value: { items: [] }
      };
      const prod = {
        ok: true,
        data: { items: [] } // Wrong key - should be 'value'
      };

      const result = compareResponses(staging, prod);

      // Should detect structural differences
      expect(result.identical).toBe(false);

      // Missing fields are flagged as warnings (not errors)
      // This allows for gradual rollout of new fields
      const fieldDiffs = result.differences.filter(d =>
        d.type === 'field_missing_staging' || d.type === 'field_missing_production'
      );
      expect(fieldDiffs.length).toBe(2); // 'value' missing in prod, 'data' missing in staging

      // Verify specific differences detected
      const valueMissing = fieldDiffs.find(d => d.path === 'value');
      const dataMissing = fieldDiffs.find(d => d.path === 'data');
      expect(valueMissing).toBeDefined();
      expect(valueMissing.type).toBe('field_missing_production');
      expect(dataMissing).toBeDefined();
      expect(dataMissing.type).toBe('field_missing_staging');
    });

  });

  describe('Critical Endpoints Configuration', () => {

    it('has required critical endpoints configured', () => {
      expect(CRITICAL_ENDPOINTS).toBeInstanceOf(Array);
      expect(CRITICAL_ENDPOINTS.length).toBeGreaterThan(0);

      // Status endpoint should be included
      const statusEndpoint = CRITICAL_ENDPOINTS.find(e => e.name === 'status');
      expect(statusEndpoint).toBeDefined();
      expect(statusEndpoint.path).toContain('status');
    });

    it('all endpoints have required properties', () => {
      for (const endpoint of CRITICAL_ENDPOINTS) {
        expect(endpoint.name).toBeDefined();
        expect(endpoint.path).toBeDefined();
        expect(endpoint.description).toBeDefined();
      }
    });

  });

});

// ============================================================================
// LIVE API TESTS (Conditional)
// ============================================================================

/**
 * Live API comparison tests
 * Only run when RUN_API_VERSION_CHECK=true
 */
describe('Live API Version Comparison', () => {

  // Skip entire suite if live tests not enabled
  const describeOrSkip = RUN_LIVE_TESTS ? describe : describe.skip;

  describeOrSkip('Environment Comparison', () => {

    it('compares all critical endpoints between staging and production', async () => {
      const report = await compareEnvironments(CRITICAL_ENDPOINTS);

      // Log report for CI visibility
      console.log('\n' + formatReport(report) + '\n');

      // Store JSON report for artifacts
      if (process.env.CI) {
        const fs = require('fs');
        const path = require('path');
        const reportPath = path.join(process.cwd(), 'api-version-report.json');
        fs.writeFileSync(reportPath, formatJsonReport(report));
        console.log(`JSON report written to: ${reportPath}`);
      }

      // Assertions
      expect(report.status).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.results).toBeInstanceOf(Array);

      // All endpoints should be compared successfully
      expect(report.summary.failedFetches).toBe(0);

      // All contracts should be compatible (warnings OK, errors fail)
      expect(report.summary.contractMismatches).toBe(0);

      // Report overall status
      expect(['pass', 'warning']).toContain(report.status);

    }, API_TIMEOUT * CRITICAL_ENDPOINTS.length);

    it('status endpoint returns structurally identical responses', async () => {
      const { compareEndpoint } = require('../shared/helpers/api-version-comparator');

      const statusEndpoint = CRITICAL_ENDPOINTS.find(e => e.name === 'status');
      const result = await compareEndpoint(statusEndpoint);

      expect(result.staging.success).toBe(true);
      expect(result.production.success).toBe(true);
      expect(result.comparison).toBeDefined();
      expect(result.comparison.compatible).toBe(true);

    }, API_TIMEOUT);

  });

});

// ============================================================================
// REPORT FORMAT TESTS
// ============================================================================

describe('Report Formatting', () => {

  const mockReport = {
    status: 'pass',
    summary: {
      timestamp: '2024-01-01T00:00:00.000Z',
      duration: '1234ms',
      totalEndpoints: 3,
      successfulComparisons: 3,
      failedFetches: 0,
      identicalContracts: 2,
      compatibleContracts: 3,
      contractMismatches: 0
    },
    results: [
      {
        name: 'status',
        path: '/exec?p=status',
        description: 'System health',
        staging: { success: true, response: { status: 200 } },
        production: { success: true, response: { status: 200 } },
        comparison: {
          identical: true,
          compatible: true,
          differences: [],
          summary: { total: 0, errors: 0, warnings: 0 }
        }
      }
    ],
    environments: {
      staging: { name: 'Staging', baseUrl: 'https://api-stg.eventangle.com' },
      production: { name: 'Production', baseUrl: 'https://api.eventangle.com' }
    }
  };

  it('formats console report', () => {
    const report = formatReport(mockReport);

    expect(report).toContain('API VERSION COMPATIBILITY REPORT');
    expect(report).toContain('Story 3.2');
    expect(report).toContain('Status:');
    expect(report).toContain('PASS');
    expect(report).toContain('api-stg.eventangle.com');
    expect(report).toContain('api.eventangle.com');
  });

  it('formats JSON report', () => {
    const jsonStr = formatJsonReport(mockReport);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.status).toBe('pass');
    expect(parsed.summary).toBeDefined();
    expect(parsed.results).toBeInstanceOf(Array);
  });

});
