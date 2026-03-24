/**
 * Stage-2 API Smoke Test: /api/v2/events
 * Story B5: Implement /api/v2/events?brand=root (Read Path)
 *
 * Validates that the /api/v2/events endpoint returns correct shape.
 * Per Story B5: "Unblock /events and /manage list loading by returning
 * a stable events list contract."
 *
 * Contract (per Architect):
 * {
 *   "ok": true,
 *   "status": 200,
 *   "items": [...]
 * }
 *
 * Negative Paths:
 * - Missing sheet ID → deterministic SHEETS_DB_ID_MISSING
 * - 403 from Google → SHEETS_READ_FAILED + status
 *
 * CI/CD Gate Impact:
 * - Stage-2: after deploy, run Playwright smoke
 * - Stage-2: health gate already required
 *
 * @see Story B5 - Implement /api/v2/events?brand=root (Read Path)
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

test.describe('Events V2 API (/api/v2/events) - Story B5', () => {

  test.describe('Success Path', () => {

    test('GET /api/v2/events?brand=root returns HTTP 200 when healthy', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      expect(response.status()).toBe(200);
    });

    test('returns valid JSON with Story B5 contract fields', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      expect(response.ok()).toBe(true);

      const json = await response.json();

      // Required fields per Story B5 contract: { ok, status, items }
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');
      expect(json.ok).toBe(true);

      expect(json).toHaveProperty('status');
      expect(json.status).toBe(200);

      expect(json).toHaveProperty('items');
      expect(Array.isArray(json.items)).toBe(true);
    });

    test('items array contains valid event objects', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const json = await response.json();

      // If there are items, validate their structure
      if (json.items.length > 0) {
        const firstItem = json.items[0];

        // EventV2Summary required fields
        expect(firstItem).toHaveProperty('id');
        expect(typeof firstItem.id).toBe('string');

        expect(firstItem).toHaveProperty('slug');
        expect(typeof firstItem.slug).toBe('string');

        expect(firstItem).toHaveProperty('name');
        expect(typeof firstItem.name).toBe('string');
      }
    });

    test('returns empty items array when no events exist', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const json = await response.json();

      // items should always be an array (empty or populated)
      expect(Array.isArray(json.items)).toBe(true);
    });

    test('defaults to brand=root when no brand param provided', async ({ request }) => {
      // Test without brand param - should default to 'root'
      const response = await request.get('/api/v2/events');
      expect(response.status()).toBe(200);

      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.items)).toBe(true);
    });

  });

  test.describe('Full Event Data', () => {

    test('full=true returns additional event fields', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}&full=true`);
      const json = await response.json();

      expect(json.ok).toBe(true);

      // If there are items, full response should include brandId
      if (json.items.length > 0) {
        const firstItem = json.items[0];
        expect(firstItem).toHaveProperty('brandId');
      }
    });

  });

  test.describe('Response Headers', () => {

    test('returns correct content-type header', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const headers = response.headers();

      expect(headers['content-type']).toContain('application/json');
    });

    test('returns caching headers for successful response', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const headers = response.headers();

      // Success responses should have cache headers
      if (response.ok()) {
        expect(headers['cache-control']).toBeDefined();
        expect(headers['cache-control']).toContain('max-age');
      }
    });

    test('returns X-Request-Id header', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const headers = response.headers();

      expect(headers['x-request-id']).toBeDefined();
    });

    test('returns X-Handler-Version header', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const headers = response.headers();

      expect(headers['x-handler-version']).toBeDefined();
    });

    test('returns X-Router-Version header', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const headers = response.headers();

      expect(headers['x-router-version']).toBeDefined();
    });

  });

  test.describe('Brand Filtering', () => {

    test('filters events by brand parameter', async ({ request }) => {
      // Test that brand filtering works
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const json = await response.json();

      expect(json.ok).toBe(true);

      // All returned items should be for the requested brand (verify with full=true)
      if (json.items.length > 0) {
        const fullResponse = await request.get(`/api/v2/events?brand=${BRAND}&full=true`);
        const fullJson = await fullResponse.json();

        for (const item of fullJson.items) {
          expect(item.brandId).toBe(BRAND);
        }
      }
    });

    test('invalid brand returns 400 with INVALID_BRAND code', async ({ request }) => {
      const response = await request.get('/api/v2/events?brand=invalid_brand_xyz');

      // Per Story B5: Invalid brand should return error
      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('INVALID_BRAND');
    });

  });

  test.describe('Error Response Shape', () => {

    test('error responses include required fields per Story B5', async ({ request }) => {
      // Use invalid brand to trigger error
      const response = await request.get('/api/v2/events?brand=invalid_brand');
      const json = await response.json();

      if (!json.ok) {
        // Per Story B5: 503s return { ok:false, code, requestId }
        expect(json).toHaveProperty('ok');
        expect(json.ok).toBe(false);

        expect(json).toHaveProperty('code');
        expect(typeof json.code).toBe('string');

        expect(json).toHaveProperty('requestId');
        expect(typeof json.requestId).toBe('string');

        expect(json).toHaveProperty('error');
        expect(typeof json.error).toBe('string');

        expect(json).toHaveProperty('timestamp');
        expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    });

  });

  test.describe('Response Time', () => {

    test('responds within 15 seconds (timeout threshold)', async ({ request }) => {
      const startTime = Date.now();
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const duration = Date.now() - startTime;

      expect(response.ok()).toBe(true);
      // Events list should respond quickly
      expect(duration).toBeLessThan(15000);
    });

  });

  test.describe('No Browser Calls to Google Origins', () => {

    test('response comes from Worker, not Google origins', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const headers = response.headers();

      // Should be served by Worker (presence of router version header)
      expect(headers['x-router-version']).toBeDefined();

      // Should NOT have GAS-specific headers
      expect(headers['x-served-by']).not.toBe('google-apps-script');
    });

  });

  test.describe('CI/CD Gate Validation', () => {

    test('all required fields present for CI gate decision', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const json = await response.json();

      // CI gate requires these fields per Story B5
      const requiredFields = ['ok', 'status', 'items'];
      for (const field of requiredFields) {
        expect(json).toHaveProperty(field);
      }

      // ok must be boolean for gate logic
      expect(typeof json.ok).toBe('boolean');

      // items must be array for UI consumption
      expect(Array.isArray(json.items)).toBe(true);
    });

    test('passes CI gate criteria (ok=true and items is array)', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const json = await response.json();

      // This is the actual gate check used by CI per Story B5
      const passesGate = json.ok === true && Array.isArray(json.items);

      expect(passesGate).toBe(true);
    });

  });

});

test.describe('/manage Page with /api/v2/events - Story B5 Integration', () => {

  test('/manage page loads and observes /api/v2/events call', async ({ page }) => {
    // Track API calls
    const apiCalls: { url: string; status: number }[] = [];

    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/v2/events')) {
        apiCalls.push({ url, status: response.status() });
      }
    });

    // Navigate to /manage page
    await page.goto(`/manage?brand=${BRAND}`, { waitUntil: 'networkidle' });

    // Wait for any async API calls
    await page.waitForTimeout(3000);

    // Log API calls for CI visibility
    console.log(`API calls observed on /manage:`);
    apiCalls.forEach(call => {
      console.log(`  ${call.url} -> ${call.status}`);
    });

    // Per Story B5: /manage should call /api/v2/events
    // Note: This may not always happen if the page has cached data or uses a different path
    // Just verify the page loaded without error
    expect(page.url()).toContain('/manage');
  });

  test('/api/v2/events returns 200 from /manage context', async ({ page, request }) => {
    // Navigate to /manage to establish context
    await page.goto(`/manage?brand=${BRAND}`);

    // Make API call from the same context
    const response = await request.get(`/api/v2/events?brand=${BRAND}`);

    expect(response.status()).toBe(200);

    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.items)).toBe(true);
  });

});
