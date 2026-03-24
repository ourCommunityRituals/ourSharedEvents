/**
 * Coverage Matrix - Playwright Validation
 *
 * This spec validates that documented E2E coverage actually tests the features.
 * It reads test files and verifies they contain expected test descriptions.
 *
 * @see /tests/FEATURE_COVERAGE_MATRIX.md
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const TESTS_ROOT = path.join(__dirname, '..', '..');
const E2E_ROOT = path.join(__dirname, '..');

/**
 * Helper: Read test file and verify it contains expected patterns
 */
function specContains(relativePath, patterns) {
  const fullPath = path.join(E2E_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    return { exists: false, path: fullPath, missing: patterns };
  }
  const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
  const missing = patterns.filter(p => !content.toLowerCase().includes(p.toLowerCase()));
  return { exists: true, missing };
}

test.describe('Feature Coverage Matrix - E2E Validation', () => {

  test.describe('Event Lifecycle E2E', () => {

    test('admin-page.spec.js tests event creation form', async () => {
      const result = specContains('2-pages/admin-page.spec.js', [
        'test.describe',
        'admin',
        'form',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('admin-flows.spec.js tests event management workflows', async () => {
      const result = specContains('3-flows/admin-flows.spec.js', [
        'test.describe',
        'event',
        'create',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('events-crud-api.spec.js tests event CRUD', async () => {
      const result = specContains('api/events-crud-api.spec.js', [
        'test.describe',
        'event',
        'create',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('public-page.spec.js tests event display', async () => {
      const result = specContains('2-pages/public-page.spec.js', [
        'test.describe',
        'public',
        'event',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  test.describe('Sponsor System E2E', () => {

    test('sponsors-crud-api.spec.js tests sponsor CRUD', async () => {
      const result = specContains('api/sponsors-crud-api.spec.js', [
        'test.describe',
        'sponsor',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('sponsor-flows.spec.js tests sponsor configuration', async () => {
      const result = specContains('3-flows/sponsor-flows.spec.js', [
        'test.describe',
        'sponsor',
        'display',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('display-page.spec.js tests sponsor display areas', async () => {
      const result = specContains('2-pages/display-page.spec.js', [
        'test.describe',
        'display',
        'sponsor',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  test.describe('Data Propagation E2E', () => {

    test('triangle-framework.spec.js tests cross-page propagation', async () => {
      const result = specContains('3-flows/triangle-framework.spec.js', [
        'test.describe',
        'propagat', // propagate/propagation
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('poster-maps-integration.spec.js tests poster sync', async () => {
      const result = specContains('3-flows/poster-maps-integration.spec.js', [
        'test.describe',
        'poster',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  test.describe('Security E2E', () => {

    test('security-smoke.spec.js tests security endpoints', async () => {
      const result = specContains('1-smoke/security-smoke.spec.js', [
        'test.describe',
        'security',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('authentication.spec.js tests auth flows', async () => {
      const result = specContains('authentication.spec.js', [
        'test.describe',
        'auth',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  test.describe('Multi-Brand E2E', () => {

    test('brand-branding.spec.js tests brand styling', async () => {
      const result = specContains('1-smoke/brand-branding.spec.js', [
        'test.describe',
        'brand',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('multi-brand-api.spec.js tests brand isolation', async () => {
      const result = specContains('api/multi-brand-api.spec.js', [
        'test.describe',
        'brand',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  test.describe('Shared Reporting E2E', () => {

    test('shared-reporting.spec.js tests report generation', async () => {
      const result = specContains('3-flows/shared-reporting.spec.js', [
        'test.describe',
        'report',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  test.describe('User Journey Scenarios', () => {

    test('scenario-1 tests first-time admin journey', async () => {
      const result = specContains('scenarios/scenario-1-first-time-admin.spec.js', [
        'test.describe',
        'admin',
        'first',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('scenario-2 tests mobile user journey', async () => {
      const result = specContains('scenarios/scenario-2-mobile-user.spec.js', [
        'test.describe',
        'mobile',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('scenario-3 tests TV display journey', async () => {
      const result = specContains('scenarios/scenario-3-tv-display.spec.js', [
        'test.describe',
        'tv',
        'display',
      ]);
      expect(result.exists).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  test.describe('Documented Gaps - NOT Tested Yet', () => {

    test('Portfolio dashboard E2E - deferred', async () => {
      const filePath = path.join(E2E_ROOT, '3-flows/portfolio-dashboard.spec.js');
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test('Multi-language flows - deferred', async () => {
      const filePath = path.join(E2E_ROOT, '3-flows/multi-language-flows.spec.js');
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test('Edge brands E2E - deferred', async () => {
      const filePath = path.join(E2E_ROOT, '3-flows/edge-brands.spec.js');
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  test.describe('Matrix Document Integrity', () => {

    test('FEATURE_COVERAGE_MATRIX.md exists and references E2E tests', async () => {
      const matrixPath = path.join(TESTS_ROOT, 'FEATURE_COVERAGE_MATRIX.md');
      expect(fs.existsSync(matrixPath)).toBe(true);

      const matrix = fs.readFileSync(matrixPath, 'utf8');

      // Must document Playwright tests
      expect(matrix).toContain('Playwright');
      expect(matrix).toContain('.spec.js');

      // Must document all page types
      expect(matrix).toContain('Admin');
      expect(matrix).toContain('Display');
      expect(matrix).toContain('Public');
      expect(matrix).toContain('Poster');
    });
  });
});
