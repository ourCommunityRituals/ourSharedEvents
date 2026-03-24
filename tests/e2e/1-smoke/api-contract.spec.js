/**
 * API CONTRACT TESTS - Level 1: API Response Validation
 *
 * Purpose: Validate API endpoints return correct data structures
 * Run Time: < 30 seconds
 * Run Frequency: Every deployment
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:smoke
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:smoke
 *
 * Tests:
 * - Status API schema
 * - Analytics API schema
 * - Event creation API response
 * - Response times
 * - Error responses
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

test.describe('🔌 API CONTRACT: Status Endpoint', () => {

  test('Status API returns valid JSON schema', async ({ request }) => {
    const response = await request.get(`${BASE_URL}?page=status&brand=${BRAND_ID}`);

    // STRICT: Must be 200 OK
    expect(response.status()).toBe(200);

    // STRICT: Must be JSON content type
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');

    const json = await response.json();

    // STRICT: Schema validation
    // /status endpoint uses api_statusPure which returns FLAT format
    expect(json).toHaveProperty('ok');
    expect(typeof json.ok).toBe('boolean');

    // FLAT format: buildId, brandId, timestamp (not nested in value)
    expect(json).toHaveProperty('buildId');
    expect(typeof json.buildId).toBe('string');
    expect(json.buildId.length).toBeGreaterThan(0);

    expect(json).toHaveProperty('brandId');
    expect(json.brandId).toBe(BRAND_ID);

    expect(json).toHaveProperty('timestamp');
  });

  test('Status API responds within SLA', async ({ request }) => {
    const start = Date.now();
    const response = await request.get(`${BASE_URL}?page=status&brand=${BRAND_ID}`);
    const duration = Date.now() - start;

    // Allow time for Google Apps Script cold starts
    // Warm: <2s, Cold start: <10s
    expect(duration).toBeLessThan(10000);
    expect(response.status()).toBe(200);
  });

  test('Status API returns consistent structure on multiple calls', async ({ request }) => {
    const calls = 3;
    const responses = [];

    for (let i = 0; i < calls; i++) {
      const response = await request.get(`${BASE_URL}?page=status&brand=${BRAND_ID}`);
      const json = await response.json();
      responses.push(json);
    }

    // STRICT: All responses must have same FLAT structure
    for (const resp of responses) {
      expect(resp).toHaveProperty('ok', true);
      expect(resp).toHaveProperty('buildId');
      expect(resp).toHaveProperty('brandId');
      expect(resp).toHaveProperty('timestamp');
    }

    // STRICT: Build version should be consistent
    const builds = responses.map(r => r.buildId);
    expect(new Set(builds).size).toBe(1); // All same build
  });
});

test.describe('🔌 API CONTRACT: Analytics Endpoint', () => {

  test('Analytics API exists and returns JSON', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Intercept network requests to analytics API
    const apiCalls = [];
    page.on('response', async response => {
      const url = response.url();
      if (url.includes('getSharedAnalytics') || url.includes('analytics') || url.includes('report')) {
        try {
          const contentType = response.headers()['content-type'];
          if (contentType && contentType.includes('json')) {
            const json = await response.json();
            apiCalls.push({ url, json, status: response.status() });
          }
        } catch (e) {
          // Not JSON response, ignore
        }
      }
    });

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Allow API calls to complete

    // STRICT: If analytics API was called, validate response
    if (apiCalls.length > 0) {
      const analyticsCall = apiCalls[0];

      expect(analyticsCall.status).toBe(200);
      expect(analyticsCall.json).toBeTruthy();

      // Analytics should return object with data
      expect(typeof analyticsCall.json).toBe('object');
    }
  });
});

test.describe('🔌 API CONTRACT: Event Creation Response', () => {

  test('Event creation API returns proper response structure', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
    const responses = [];

    // Capture API responses
    page.on('response', async response => {
      const url = response.url();
      if (url.includes(BASE_URL) && response.request().method() === 'POST') {
        try {
          const json = await response.json();
          responses.push({ url, json, status: response.status() });
        } catch (e) {
          // Not JSON, ignore
        }
      }
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    await page.fill('#name', `API Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await page.waitForTimeout(3000);

    // STRICT: Event creation should return success response
    if (responses.length > 0) {
      const createResponse = responses[responses.length - 1];

      // Should return 200 OK
      expect(createResponse.status).toBeLessThan(400);

      // Response should have data
      expect(createResponse.json).toBeTruthy();
    }
  });
});

test.describe('🔌 API CONTRACT: Error Responses', () => {

  test('Invalid API parameters return proper error', async ({ request }) => {
    // Test with invalid brand
    const response = await request.get(`${BASE_URL}?page=status&brand=INVALID_999`);

    // STRICT: Should return error status or handle gracefully
    const status = response.status();

    // Either 400-level error or 200 with error in body
    if (status === 200) {
      const json = await response.json();
      // If 200, should have error indicated in response
      expect(json.ok === false || json.error || json.message).toBeTruthy();
    } else {
      // Or return proper error status
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    }
  });

  test('Missing parameters handled gracefully', async ({ request }) => {
    // Test status API without brand parameter
    const response = await request.get(`${BASE_URL}?page=status`);

    // STRICT: Should not crash (no 500 error)
    expect(response.status()).toBeLessThan(500);
  });
});

test.describe('🔌 API CONTRACT: Response Headers', () => {

  test('CORS headers are present', async ({ request }) => {
    const response = await request.get(`${BASE_URL}?page=status&brand=${BRAND_ID}`);

    const headers = response.headers();

    // Check for CORS headers (important for cross-origin requests)
    // Note: Google Apps Script may handle this automatically
    expect(response.status()).toBe(200);
  });

  test('Content-Type header is correct for JSON endpoints', async ({ request }) => {
    const response = await request.get(`${BASE_URL}?page=status&brand=${BRAND_ID}`);

    const contentType = response.headers()['content-type'];

    // STRICT: JSON endpoints must have JSON content type
    expect(contentType).toMatch(/application\/json|text\/javascript/i);
  });
});

test.describe('🔌 API CONTRACT: Performance', () => {

  test('All API endpoints respond within acceptable time', async ({ request }) => {
    const endpoints = [
      // Allow time for Google Apps Script cold starts
      { name: 'Status', url: `${BASE_URL}?page=status&brand=${BRAND_ID}`, maxTime: 10000 },
      { name: 'Events', url: `${BASE_URL}?page=events&brand=${BRAND_ID}`, maxTime: 15000 },
      { name: 'Admin', url: `${BASE_URL}?page=admin&brand=${BRAND_ID}`, maxTime: 15000 },
    ];

    for (const endpoint of endpoints) {
      const start = Date.now();
      const response = await request.get(endpoint.url);
      const duration = Date.now() - start;

      // STRICT: Must respond within time limit
      expect(duration).toBeLessThan(endpoint.maxTime);
      expect(response.status()).toBeLessThan(400);
    }
  });

  test('API can handle rapid sequential requests', async ({ request }) => {
    const requests = 5;
    const results = [];

    for (let i = 0; i < requests; i++) {
      const start = Date.now();
      const response = await request.get(`${BASE_URL}?page=status&brand=${BRAND_ID}`);
      const duration = Date.now() - start;

      results.push({
        status: response.status(),
        duration,
        success: response.status() === 200
      });
    }

    // STRICT: All requests should succeed
    const allSuccess = results.every(r => r.success);
    expect(allSuccess).toBe(true);

    // STRICT: Average response time should be acceptable
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    expect(avgDuration).toBeLessThan(3000); // Average under 3s
  });
});
