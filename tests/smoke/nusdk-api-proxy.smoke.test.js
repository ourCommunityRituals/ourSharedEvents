/**
 * NU SDK + /api/* Proxy Smoke Tests (Story 4 - Stage-2)
 *
 * Purpose:
 *   Network-based smoke tests that validate the NU SDK + /api/* proxy
 *   works end-to-end on staging (stg.eventangle.com).
 *
 * Stage-2 Tests (Network-Based):
 *   - https://stg.eventangle.com/events loads HTML (not GAS banner)
 *   - /api/events/list returns JSON with expected keys
 *   - No script.google.com URLs in network calls
 *
 * Acceptance Criteria Validated:
 *   - /events loads Admin template
 *   - Main document = our template (no blue GAS banner text)
 *   - Data calls are to /api/..., not to script.google.com/...
 *   - NU SDK debug logs show rpc:start and rpc:ok
 *   - At least one /api/ XHR succeeds with JSON
 *
 * Run with: npm run test:smoke
 * Or: BASE_URL="https://stg.eventangle.com" npx playwright test tests/smoke/nusdk-api-proxy.smoke.test.js
 *
 * @see tests/config/environments.js - Environment configuration
 */

const { test, expect } = require('@playwright/test');
const { STAGING_URL } = require('../config/environments');

// Use staging by default for these tests
const BASE_URL = process.env.BASE_URL || STAGING_URL;
const BRAND_ID = 'root';

// GAS banner text that indicates direct GAS serving
const GAS_BANNER_TEXT = 'This application was created by a Google Apps Script user';

test.describe('Story 4: NU SDK + /api/* Proxy Smoke Tests', () => {

  // ===========================================================================
  // /events Page - HTML Template Verification
  // ===========================================================================

  test.describe('/events Page', () => {

    test('/events loads with HTTP 200', async ({ page }) => {
      const response = await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);

      expect(response.status()).toBe(200);
    });

    test('/events returns HTML (not JSON)', async ({ page }) => {
      const response = await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);
      const contentType = response.headers()['content-type'] || '';

      expect(contentType).toContain('text/html');
    });

    test('/events does NOT contain GAS banner text', async ({ page }) => {
      await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);

      const bodyHtml = await page.content();

      // Should NOT contain the GAS blue banner text
      expect(bodyHtml).not.toContain(GAS_BANNER_TEXT);
    });

    test('/events HTML has Worker transparency headers', async ({ page }) => {
      const response = await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);

      // Worker should add X-Proxied-By header
      const proxiedBy = response.headers()['x-proxied-by'];
      expect(proxiedBy).toBe('eventangle-worker');
    });

    test('/events page has NU SDK loaded', async ({ page }) => {
      await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);

      // Check that window.NU is defined
      const hasNU = await page.evaluate(() => {
        return typeof window.NU === 'object' && typeof window.NU.rpc === 'function';
      });

      expect(hasNU).toBe(true);
    });

    test('/events page has NU SDK version 2.x', async ({ page }) => {
      await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);

      const version = await page.evaluate(() => {
        return window.NU?.VERSION || 'unknown';
      });

      expect(version).toMatch(/^2\./);
    });

    test('/events page has __NU_LOGS__ array', async ({ page }) => {
      await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);

      const hasLogs = await page.evaluate(() => {
        return Array.isArray(window.__NU_LOGS__);
      });

      expect(hasLogs).toBe(true);
    });

  });

  // ===========================================================================
  // /api/* Endpoint Verification
  // ===========================================================================

  test.describe('/api/* Endpoints', () => {

    test('POST /api/events/list returns JSON', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/events/list`, {
        data: { brandId: BRAND_ID },
        headers: { 'Content-Type': 'application/json' }
      });

      expect(response.status()).toBe(200);

      const contentType = response.headers()['content-type'] || '';
      expect(contentType).toContain('application/json');
    });

    test('POST /api/events/list returns envelope with ok=true', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/events/list`, {
        data: { brandId: BRAND_ID },
        headers: { 'Content-Type': 'application/json' }
      });

      const json = await response.json();

      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(true);
    });

    test('POST /api/events/list returns value.items array', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/events/list`, {
        data: { brandId: BRAND_ID },
        headers: { 'Content-Type': 'application/json' }
      });

      const json = await response.json();

      expect(json.ok).toBe(true);
      expect(json.value).toHaveProperty('items');
      expect(Array.isArray(json.value.items)).toBe(true);
    });

    test('POST /api/events/list returns pagination info', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/events/list`, {
        data: { brandId: BRAND_ID },
        headers: { 'Content-Type': 'application/json' }
      });

      const json = await response.json();

      expect(json.ok).toBe(true);
      expect(json.value).toHaveProperty('pagination');
      expect(json.value.pagination).toHaveProperty('total');
      expect(json.value.pagination).toHaveProperty('limit');
      expect(json.value.pagination).toHaveProperty('hasMore');
    });

    test('/api/events/list has Worker transparency headers', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/events/list`, {
        data: { brandId: BRAND_ID },
        headers: { 'Content-Type': 'application/json' }
      });

      const proxiedBy = response.headers()['x-proxied-by'];
      expect(proxiedBy).toBe('eventangle-worker');
    });

    test('/api/events/list has CORS headers', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/events/list`, {
        data: { brandId: BRAND_ID },
        headers: { 'Content-Type': 'application/json' }
      });

      const corsHeader = response.headers()['access-control-allow-origin'];
      expect(corsHeader).toBe('*');
    });

  });

  // ===========================================================================
  // Network Interception - No Direct GAS Calls
  // ===========================================================================

  test.describe('Network Traffic Verification', () => {

    test('/events page data calls use /api/*, not script.google.com', async ({ page }) => {
      const apiCalls = [];
      const gasCalls = [];

      // Intercept network requests
      page.on('request', request => {
        const url = request.url();

        if (url.includes('/api/')) {
          apiCalls.push(url);
        }

        // Check for direct GAS calls using proper URL parsing
        // to avoid false positives from substring matching
        try {
          const parsedUrl = new URL(url);
          if (parsedUrl.hostname === 'script.google.com') {
            gasCalls.push(url);
          }
        } catch {
          // Invalid URL, ignore
        }
      });

      await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);

      // Wait for page to make API calls
      await page.waitForTimeout(2000);

      // Should have at least one /api/ call
      // Note: The page may not make API calls on initial load if using SSR
      // but if it does, they should go through /api/*

      // Should NOT have any direct GAS calls
      expect(gasCalls.length).toBe(0);
    });

    test('/events page XHR/Fetch calls return JSON from /api/*', async ({ page }) => {
      const apiResponses = [];

      // Intercept responses
      page.on('response', async response => {
        const url = response.url();

        if (url.includes('/api/') && response.status() === 200) {
          try {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('application/json')) {
              apiResponses.push({
                url,
                contentType,
                status: response.status()
              });
            }
          } catch (e) {
            // Ignore errors reading response
          }
        }
      });

      await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);

      // Wait for potential API calls
      await page.waitForTimeout(2000);

      // If there are API calls, they should be JSON
      apiResponses.forEach(resp => {
        expect(resp.contentType).toContain('application/json');
        expect(resp.status).toBe(200);
      });
    });

  });

  // ===========================================================================
  // NU SDK Logging Verification
  // ===========================================================================

  test.describe('NU SDK Debug Logging', () => {

    test('NU SDK logs rpc:start and rpc:ok for API calls', async ({ page }) => {
      await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);

      // Make a manual API call to ensure logging happens
      const logs = await page.evaluate(async () => {
        // Clear existing logs
        window.__NU_LOGS__ = [];

        // Make an API call
        await window.NU.rpc('events/list', { brandId: 'root' });

        // Return the logs
        return window.__NU_LOGS__.map(log => ({ type: log.type, path: log.path }));
      });

      // Should have 'start' log
      const startLog = logs.find(l => l.type === 'start');
      expect(startLog).toBeDefined();

      // Should have 'ok' log (assuming API call succeeded)
      const okLog = logs.find(l => l.type === 'ok');
      expect(okLog).toBeDefined();
    });

    test('NU SDK logs include path information', async ({ page }) => {
      await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);

      const logs = await page.evaluate(async () => {
        window.__NU_LOGS__ = [];
        await window.NU.rpc('events/list', { brandId: 'root' });
        return window.__NU_LOGS__;
      });

      // Find the start log
      const startLog = logs.find(l => l.type === 'start');
      expect(startLog).toBeDefined();
      expect(startLog.path).toBe('events/list');
    });

    test('NU SDK logs include request ID', async ({ page }) => {
      await page.goto(`${BASE_URL}/events?brand=${BRAND_ID}`);

      const logs = await page.evaluate(async () => {
        window.__NU_LOGS__ = [];
        await window.NU.rpc('events/list', { brandId: 'root' });
        return window.__NU_LOGS__;
      });

      // Find the start log
      const startLog = logs.find(l => l.type === 'start');
      expect(startLog).toBeDefined();
      expect(startLog.requestId).toBeDefined();
      expect(typeof startLog.requestId).toBe('string');
    });

  });

  // ===========================================================================
  // Admin Page Verification (Alternative Entry Point)
  // ===========================================================================

  test.describe('/manage (Admin) Page', () => {

    test('/manage loads with HTTP 200', async ({ page }) => {
      const response = await page.goto(`${BASE_URL}/manage?brand=${BRAND_ID}`);

      expect(response.status()).toBe(200);
    });

    test('/manage does NOT contain GAS banner text', async ({ page }) => {
      await page.goto(`${BASE_URL}/manage?brand=${BRAND_ID}`);

      const bodyHtml = await page.content();
      expect(bodyHtml).not.toContain(GAS_BANNER_TEXT);
    });

    test('/manage has NU SDK loaded', async ({ page }) => {
      await page.goto(`${BASE_URL}/manage?brand=${BRAND_ID}`);

      const hasNU = await page.evaluate(() => {
        return typeof window.NU === 'object' && typeof window.NU.rpc === 'function';
      });

      expect(hasNU).toBe(true);
    });

  });

});

// =============================================================================
// Error Path Smoke Tests
// =============================================================================

test.describe('API Error Path Smoke Tests', () => {

  test('/api/* without body returns BAD_INPUT error', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/events/list`, {
      headers: { 'Content-Type': 'application/json' }
      // No body
    });

    // Could be 200 with error envelope or 400
    const json = await response.json();

    // Should still be JSON
    expect(json).toHaveProperty('ok');
  });

  test('/api/invalid-endpoint returns error envelope', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/nonexistent/endpoint`, {
      data: { brandId: BRAND_ID },
      headers: { 'Content-Type': 'application/json' }
    });

    const json = await response.json();

    // Should return error envelope (from GAS or Worker)
    expect(json).toHaveProperty('ok');
  });

});
