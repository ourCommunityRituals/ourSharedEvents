/**
 * Stage-2 API Smoke Test: Whoami Endpoint
 *
 * Story 5 - Full Testing Pipeline: API Contract Tests for Whoami Endpoint
 *
 * Validates the api_whoami endpoint returns correct deployment information.
 * This endpoint is critical for Story 4 environment alignment verification.
 *
 * Acceptance Criteria:
 * - Returns HTTP 200 with JSON
 * - Returns scriptId, deploymentId, email, buildId
 * - Script ID matches expected staging/production Script ID
 * - Account email contains "zeventbook"
 * - HTTP 503 fails immediately (fail-fast)
 * - Supports all brands
 *
 * @see src/mvp/Code.gs - api_whoami()
 * @see tests/api/smoke/env-alignment.spec.ts - Environment alignment tests
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// All brands to test
const BRANDS = ['root', 'abc', 'cbc', 'cbl'];

// Expected Script IDs for each environment
const EXPECTED_SCRIPT_IDS = {
  staging: '1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ',
  production: '1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'
};

// Detect if running against production using proper URL hostname validation
function isProductionUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname === 'www.eventangle.com' ||
           parsedUrl.hostname === 'eventangle.com';
  } catch {
    return false;
  }
}

const IS_PRODUCTION = process.env.USE_PRODUCTION === 'true' ||
  isProductionUrl(process.env.BASE_URL);

const EXPECTED_SCRIPT_ID = IS_PRODUCTION
  ? EXPECTED_SCRIPT_IDS.production
  : EXPECTED_SCRIPT_IDS.staging;

test.describe('Whoami API Smoke Tests (Story 5)', () => {

  test.describe('api_whoami - Basic Response', () => {

    test('returns HTTP 200', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);

      // FAIL-FAST: 503 indicates GAS not reachable
      expect(response.status(), 'CRITICAL: HTTP 503 indicates GAS not reachable').not.toBe(503);
      expect(response.status()).toBe(200);
    });

    test('returns Content-Type application/json', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);

      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('returns valid JSON structure', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      // Should be valid JSON (parsing didn't throw)
      expect(json).toBeDefined();
      expect(typeof json).toBe('object');
    });

  });

  test.describe('api_whoami - Required Fields', () => {

    test('returns scriptId', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      expect(json).toHaveProperty('scriptId');
      expect(typeof json.scriptId).toBe('string');
      expect(json.scriptId.length).toBeGreaterThan(10);
      expect(json.scriptId).not.toBe('unknown');
    });

    test('returns deploymentId', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      expect(json).toHaveProperty('deploymentId');
      expect(typeof json.deploymentId).toBe('string');
      expect(json.deploymentId.length).toBeGreaterThan(10);
      expect(json.deploymentId).not.toBe('unknown');
      // Deployment IDs start with AKfycb
      expect(json.deploymentId).toMatch(/^AKfycb/);
    });

    test('returns email', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      expect(json).toHaveProperty('email');
      expect(typeof json.email).toBe('string');
      expect(json.email).toContain('@');
    });

    test('returns buildId', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      expect(json).toHaveProperty('buildId');
      expect(typeof json.buildId).toBe('string');
    });

    test('returns brand matching request', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      expect(json).toHaveProperty('brand');
      expect(json.brand).toBe(BRAND);
    });

    test('returns time in ISO 8601 format', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      expect(json).toHaveProperty('time');
      expect(typeof json.time).toBe('string');
      // ISO 8601 format validation
      expect(json.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // Should be parseable as a date
      const date = new Date(json.time);
      expect(date.toString()).not.toBe('Invalid Date');
    });

  });

  test.describe('api_whoami - Environment Validation', () => {

    test('scriptId matches expected Script ID', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      expect(json.scriptId).toBe(EXPECTED_SCRIPT_ID);
    });

    test('account email contains "zeventbook"', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      // Account should be zeventbook@gmail.com or similar
      expect(json.email.toLowerCase()).toContain('zeventbook');
    });

    test('time is recent (within last hour)', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      const date = new Date(json.time);
      const now = Date.now();
      const responseTime = date.getTime();

      // Should be within the last hour
      expect(Math.abs(now - responseTime)).toBeLessThan(3600000);
    });

  });

  test.describe('api_whoami - All Brands', () => {

    for (const brand of BRANDS) {
      test(`returns correct data for ${brand} brand`, async ({ request }) => {
        const response = await request.get(`/?page=whoami&brand=${brand}`);

        // FAIL-FAST: 503 indicates GAS not reachable
        expect(response.status(), `CRITICAL: HTTP 503 for brand ${brand}`).not.toBe(503);
        expect(response.status()).toBe(200);

        const json = await response.json();

        // Should have all required fields
        expect(json).toHaveProperty('scriptId');
        expect(json).toHaveProperty('deploymentId');
        expect(json).toHaveProperty('email');
        expect(json).toHaveProperty('brand');
        expect(json.brand).toBe(brand);
      });
    }

  });

  test.describe('api_whoami - Consistency Checks', () => {

    test('multiple requests return consistent scriptId', async ({ request }) => {
      const promises = Array(3).fill(null).map(() =>
        request.get(`/?page=whoami&brand=${BRAND}`)
      );

      const responses = await Promise.all(promises);
      const scriptIds = await Promise.all(
        responses.map(async r => (await r.json()).scriptId)
      );

      // All should return the same scriptId
      expect(new Set(scriptIds).size).toBe(1);
    });

    test('multiple requests return consistent deploymentId', async ({ request }) => {
      const promises = Array(3).fill(null).map(() =>
        request.get(`/?page=whoami&brand=${BRAND}`)
      );

      const responses = await Promise.all(promises);
      const deploymentIds = await Promise.all(
        responses.map(async r => (await r.json()).deploymentId)
      );

      // All should return the same deploymentId
      expect(new Set(deploymentIds).size).toBe(1);
    });

    test('deploymentId matches across all brands', async ({ request }) => {
      const promises = BRANDS.map(brand =>
        request.get(`/?page=whoami&brand=${brand}`)
      );

      const responses = await Promise.all(promises);
      const deploymentIds = await Promise.all(
        responses.map(async r => (await r.json()).deploymentId)
      );

      // All brands should return the same deploymentId (same GAS deployment)
      expect(new Set(deploymentIds).size).toBe(1);
    });

  });

  test.describe('api_whoami - Error Handling', () => {

    test('handles invalid brand gracefully', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=invalid-brand-xyz`);

      // Should not return 503
      expect(response.status()).not.toBe(503);

      // Should either return data with default brand or error
      expect(response.status()).toBeLessThan(500);
    });

    test('handles missing brand parameter', async ({ request }) => {
      const response = await request.get(`/?page=whoami`);

      // Should not return 503
      expect(response.status()).not.toBe(503);
      expect(response.status()).toBeLessThan(500);
    });

  });

  test.describe('api_whoami - Integration with /env-status', () => {

    test('deploymentId matches Worker /env-status', async ({ request }) => {
      // Fetch both endpoints
      const [whoamiRes, envStatusRes] = await Promise.all([
        request.get(`/?page=whoami&brand=${BRAND}`),
        request.get('/env-status')
      ]);

      const whoami = await whoamiRes.json();
      const envStatus = await envStatusRes.json();

      // CRITICAL: Deployment IDs MUST match (Story 4 alignment)
      expect(whoami.deploymentId).toBe(envStatus.deploymentId);
    });

  });

});
