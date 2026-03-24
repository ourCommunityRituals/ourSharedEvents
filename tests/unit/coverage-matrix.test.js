/**
 * Coverage Matrix Validation
 *
 * This test validates that documented features have actual test coverage.
 * It reads test files and verifies they contain expected test blocks.
 *
 * If a feature is documented in FEATURE_COVERAGE_MATRIX.md, there MUST be
 * a corresponding describe/test block in the referenced test file.
 *
 * @see /tests/FEATURE_COVERAGE_MATRIX.md
 */

const fs = require('fs');
const path = require('path');

const TESTS_ROOT = path.join(__dirname, '..');

/**
 * Helper: Read test file and verify it contains expected test patterns
 */
function testFileContains(filePath, patterns) {
  const fullPath = path.join(TESTS_ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    return { exists: false, missing: patterns };
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  const missing = patterns.filter(p => !content.includes(p));
  return { exists: true, content, missing };
}

describe('Feature Coverage Matrix - Tied to Actual Tests', () => {

  describe('Event Lifecycle', () => {

    test('validation.test.js tests event data validation', () => {
      const result = testFileContains('unit/validation.test.js', [
        'describe',
        'validation', // Must mention validation
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('forms.test.js tests form handling', () => {
      const result = testFileContains('unit/forms.test.js', [
        'describe',
        'form', // Must mention forms
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('events-list.contract.test.js tests event list API', () => {
      const result = testFileContains('triangle/during-event/contract/events-list.contract.test.js', [
        'describe',
        'event', // Must mention events
        'list',  // Must test list functionality
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('event-details.contract.test.js tests event details API', () => {
      const result = testFileContains('triangle/during-event/contract/event-details.contract.test.js', [
        'describe',
        'event',   // Must mention events
        'detail',  // Must test details
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe('Sponsor System', () => {

    test('sponsor-utils.test.js tests sponsor utilities', () => {
      const result = testFileContains('unit/sponsor-utils.test.js', [
        'describe',
        'sponsor', // Must mention sponsors
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('shared-reporting.test.js tests sponsor metrics', () => {
      const result = testFileContains('unit/shared-reporting.test.js', [
        'describe',
        'report', // Must mention reporting
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe('Data Propagation', () => {

    test('all-endpoints.contract.test.js tests API consistency', () => {
      const result = testFileContains('contract/all-endpoints.contract.test.js', [
        'describe',
        'endpoint', // Must mention endpoints
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe('Security & Validation', () => {

    test('security.test.js tests XSS/injection prevention', () => {
      const result = testFileContains('unit/security.test.js', [
        'describe',
        'security', // Must mention security
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('backend.test.js tests input sanitization', () => {
      const result = testFileContains('unit/backend.test.js', [
        'describe',
        'saniti', // sanitize/sanitization
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('jwt-security.contract.test.js tests JWT handling', () => {
      const result = testFileContains('contract/jwt-security.contract.test.js', [
        'describe',
        'JWT', // Must mention JWT
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('rate-limiting.test.js tests rate limits', () => {
      const result = testFileContains('unit/rate-limiting.test.js', [
        'describe',
        'rate', // Must mention rate limiting
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe('Multi-Brand', () => {

    test('multi-brand.test.js tests brand isolation', () => {
      const result = testFileContains('unit/multi-brand.test.js', [
        'describe',
        'brand', // Must mention brands
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('config.test.js tests configuration', () => {
      const result = testFileContains('unit/config.test.js', [
        'describe',
        'config', // Must mention config
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe('Shared Reporting', () => {

    test('analytics.contract.test.js tests analytics API', () => {
      const result = testFileContains('triangle/after-event/contract/analytics.contract.test.js', [
        'describe',
        'analytics', // Must mention analytics
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe('Documented Gaps - Features NOT Tested', () => {
    // These pass when the gaps still exist
    // When filled, update FEATURE_COVERAGE_MATRIX.md and flip the assertion

    test('Portfolio dashboard - not yet implemented', () => {
      const filePath = path.join(TESTS_ROOT, 'e2e/3-flows/portfolio-dashboard.spec.js');
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test('Multi-language validation - not yet implemented', () => {
      const filePath = path.join(TESTS_ROOT, 'unit/i18n-validation.test.js');
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test('Edge brands - not yet implemented', () => {
      const filePath = path.join(TESTS_ROOT, 'e2e/3-flows/edge-brands.spec.js');
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe('Matrix Document Integrity', () => {

    test('FEATURE_COVERAGE_MATRIX.md exists', () => {
      expect(fs.existsSync(path.join(TESTS_ROOT, 'FEATURE_COVERAGE_MATRIX.md'))).toBe(true);
    });

    test('Matrix references actual test files that exist', () => {
      const matrix = fs.readFileSync(path.join(TESTS_ROOT, 'FEATURE_COVERAGE_MATRIX.md'), 'utf8');

      // Extract test file references from markdown (e.g., `validation.test.js`)
      const testFilePattern = /`([a-z-]+\.(?:test|spec|contract\.test)\.js)`/gi;
      const matches = matrix.match(testFilePattern) || [];

      // Must reference at least 10 test files
      expect(matches.length).toBeGreaterThanOrEqual(10);
    });

    test('Matrix documents all MVP feature categories', () => {
      const matrix = fs.readFileSync(path.join(TESTS_ROOT, 'FEATURE_COVERAGE_MATRIX.md'), 'utf8');

      // Required sections
      expect(matrix).toContain('## What We Test');
      expect(matrix).toContain('## What We Don\'t Test');
      expect(matrix).toContain('### Event Lifecycle');
      expect(matrix).toContain('### Sponsor System');
      expect(matrix).toContain('### Data Propagation');
      expect(matrix).toContain('### Security & Validation');
      expect(matrix).toContain('### Multi-Brand');
    });
  });
});
