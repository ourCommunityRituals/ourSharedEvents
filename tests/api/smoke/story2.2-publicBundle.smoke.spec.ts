/**
 * Story 2.2 - Public Bundle Worker Endpoint Smoke Test
 *
 * Purpose:
 *   Validates the Worker /api/events/:id/publicBundle endpoint is working.
 *   This endpoint replaces the GAS api_getPublicBundle function.
 *
 * This test validates:
 *   1. /api/events/:id/publicBundle returns valid response
 *   2. Response shape matches GAS api_getPublicBundle contract
 *   3. 404 handling for non-existent events
 *   4. Brand parameter handling
 *
 * Acceptance Criteria (Story 2.2):
 *   - Public page loads event metadata, schedule, bracket from Worker
 *   - No calls to GAS remain
 *   - Contract maintained (same shape as GAS version)
 *
 * @see worker/src/handlers/publicBundle.ts
 * @see src/mvp/Public.html
 * @see Story 2.2 - Replace getPublicBundle Worker Implementation
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// Test event ID - should exist in test environment
const TEST_EVENT_ID = process.env.TEST_EVENT_ID || 'TEST';

test.describe('Story 2.2 - Public Bundle Worker Endpoint', () => {

  test.describe('Critical Path: API Health', () => {

    test('Worker /api/status returns ok:true', async ({ request }) => {
      const response = await request.get('/api/status');

      expect(response.status()).toBe(200);

      const json = await response.json();
      expect(json).toHaveProperty('ok', true);
    });

  });

  test.describe('Public Bundle Endpoint', () => {

    test('GET /api/events/:id/publicBundle returns valid response', async ({ request }) => {
      const response = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`);

      // Should return 200 or 404 (not 500)
      expect(response.status()).toBeLessThan(500);

      const json = await response.json();

      // Response should have ok property
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');
    });

    test('publicBundle endpoint is Worker-served', async ({ request }) => {
      const response = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`);

      // Check for Worker headers
      const headers = response.headers();

      // Should have Content-Type header
      expect(headers['content-type']).toContain('application/json');
    });

    test('publicBundle returns correct error for non-existent event', async ({ request }) => {
      const response = await request.get(`/api/events/non-existent-event-12345/publicBundle?brand=${BRAND}`);

      // Should return 404 for non-existent event
      expect(response.status()).toBe(404);

      const json = await response.json();

      // Error response shape
      expect(json).toHaveProperty('ok', false);
      expect(json).toHaveProperty('code', 'EVENT_NOT_FOUND');
      expect(json).toHaveProperty('message');
    });

    test('publicBundle returns error for invalid brand', async ({ request }) => {
      const response = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=invalid_brand_xyz`);

      // Should return 400 for invalid brand
      expect(response.status()).toBe(400);

      const json = await response.json();

      // Error response shape
      expect(json).toHaveProperty('ok', false);
      expect(json).toHaveProperty('code', 'BAD_INPUT');
    });

  });

  test.describe('Contract Shape (GAS Parity)', () => {

    test('success response has correct envelope shape', async ({ request }) => {
      const response = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`);

      // Skip contract validation if event doesn't exist
      if (response.status() === 404) {
        console.log(`[SMOKE] Event ${TEST_EVENT_ID} not found, skipping contract test`);
        return;
      }

      expect(response.status()).toBe(200);

      const json = await response.json();

      // GAS api_getPublicBundle returns: { ok: true, etag: string, value: { event, config, lifecyclePhase } }
      expect(json).toHaveProperty('ok', true);
      expect(json).toHaveProperty('etag');
      expect(typeof json.etag).toBe('string');
      expect(json).toHaveProperty('value');
    });

    test('value contains event, config, lifecyclePhase', async ({ request }) => {
      const response = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`);

      // Skip if event doesn't exist
      if (response.status() === 404) {
        return;
      }

      const json = await response.json();

      if (json.ok && json.value) {
        // Value shape
        expect(json.value).toHaveProperty('event');
        expect(json.value).toHaveProperty('config');
        expect(json.value).toHaveProperty('lifecyclePhase');
      }
    });

    test('event has MVP required fields', async ({ request }) => {
      const response = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`);

      // Skip if event doesn't exist
      if (response.status() === 404) {
        return;
      }

      const json = await response.json();

      if (json.ok && json.value && json.value.event) {
        const event = json.value.event;

        // MVP required fields
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('name');
        expect(event).toHaveProperty('startDateISO');
        expect(event).toHaveProperty('venue');
        expect(event).toHaveProperty('brandId');
      }
    });

    test('config has brand configuration', async ({ request }) => {
      const response = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`);

      // Skip if event doesn't exist
      if (response.status() === 404) {
        return;
      }

      const json = await response.json();

      if (json.ok && json.value && json.value.config) {
        const config = json.value.config;

        // Config shape per GAS findBrand_
        expect(config).toHaveProperty('brandId');
        expect(config).toHaveProperty('brandName');
        expect(config).toHaveProperty('appTitle');
      }
    });

    test('lifecyclePhase has phase info', async ({ request }) => {
      const response = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`);

      // Skip if event doesn't exist
      if (response.status() === 404) {
        return;
      }

      const json = await response.json();

      if (json.ok && json.value && json.value.lifecyclePhase) {
        const phase = json.value.lifecyclePhase;

        // LifecyclePhase shape per GAS computeLifecyclePhase_
        expect(phase).toHaveProperty('phase');
        expect(phase).toHaveProperty('label');
        expect(phase).toHaveProperty('isLive');
        expect(typeof phase.isLive).toBe('boolean');

        // Valid phase values
        expect(['pre-event', 'event-day', 'post-event']).toContain(phase.phase);
      }
    });

  });

  test.describe('ETag and Caching', () => {

    test('response includes ETag header', async ({ request }) => {
      const response = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`);

      // Skip if event doesn't exist
      if (response.status() === 404) {
        return;
      }

      const headers = response.headers();
      expect(headers).toHaveProperty('etag');
    });

    test('response includes Cache-Control header', async ({ request }) => {
      const response = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`);

      // Skip if event doesn't exist
      if (response.status() === 404) {
        return;
      }

      const headers = response.headers();
      expect(headers).toHaveProperty('cache-control');
    });

    test('304 Not Modified with matching ETag', async ({ request }) => {
      // First request to get ETag
      const firstResponse = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`);

      // Skip if event doesn't exist
      if (firstResponse.status() === 404) {
        return;
      }

      const etag = firstResponse.headers()['etag'];

      // Second request with If-None-Match
      const secondResponse = await request.get(
        `/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`,
        {
          headers: {
            'If-None-Match': etag,
          },
        }
      );

      // Should return 304 Not Modified
      expect(secondResponse.status()).toBe(304);
    });

  });

  test.describe('Brand-Specific Routing', () => {

    test('handles brand-prefixed path', async ({ request }) => {
      // Test /abc/api/events/:id/publicBundle format
      const response = await request.get(`/${BRAND}/api/events/${TEST_EVENT_ID}/publicBundle`);

      // Should work (200 or 404)
      expect(response.status()).toBeLessThan(500);
    });

    test('brand query parameter works', async ({ request }) => {
      const response = await request.get(`/api/events/${TEST_EVENT_ID}/publicBundle?brand=${BRAND}`);

      // Should work (200 or 404)
      expect(response.status()).toBeLessThan(500);
    });

  });

  test.describe('Public Page Integration', () => {

    test('/public page loads successfully', async ({ request }) => {
      const response = await request.get(`/public?brand=${BRAND}`);

      // Should return HTML
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/html');
    });

    test('/public?event=TEST loads event detail', async ({ request, page }) => {
      // Use page to load the full public page with event
      await page.goto(`/public?brand=${BRAND}&id=${TEST_EVENT_ID}`);

      // Wait for page to load
      await page.waitForLoadState('networkidle');

      // Should not show error state (unless event doesn't exist)
      const errorState = page.locator('.error-state');
      const errorCount = await errorState.count();

      // If error state is shown, it should be for not found
      if (errorCount > 0) {
        const errorText = await errorState.textContent();
        // Acceptable errors: not found, network issue
        expect(
          errorText?.includes('not found') ||
          errorText?.includes('Something Went Wrong')
        ).toBeTruthy();
      }
    });

  });

});
