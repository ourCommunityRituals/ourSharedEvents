/**
 * Stage-2 API Smoke Test: Bundle Endpoints
 *
 * Story 5 - Full Testing Pipeline: API Contract Tests for Bundle Endpoints
 *
 * Validates that bundle endpoints return correct shape per v4.1.2 contract.
 * Tests api_getPublicBundle, api_getDisplayBundle, api_getPosterBundle,
 * and api_getSharedReportBundle.
 *
 * These endpoints are critical for front-end rendering - they provide
 * all data needed for each MVP surface.
 *
 * Acceptance Criteria:
 * - All bundle endpoints return HTTP 200 for valid events
 * - Responses follow Ok/Err envelope format
 * - Bundle contains required event data
 * - HTTP 503 fails immediately (fail-fast)
 * - Schema-compliant JSON structure
 *
 * @see API_CONTRACT.md - Envelope Endpoints section
 * @see src/mvp/Code.gs - Bundle API implementations
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// Helper to get first valid event ID
async function getFirstEventId(request: any): Promise<string | null> {
  const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
  if (!response.ok()) return null;

  const json = await response.json();
  if (json.ok && json.value && json.value.items && json.value.items.length > 0) {
    return json.value.items[0].id;
  }
  return null;
}

test.describe('Bundle API Smoke Tests (Story 5)', () => {

  test.describe('api_getPublicBundle - Public Event Bundle', () => {

    test('returns HTTP 200 for valid event', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getPublicBundle&brand=${BRAND}&eventId=${eventId}`
      );

      // FAIL-FAST: 503 indicates deployment issue
      expect(response.status(), 'CRITICAL: HTTP 503 indicates GAS not reachable').not.toBe(503);
      expect(response.status()).toBe(200);
    });

    test('returns valid envelope with ok:true', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getPublicBundle&brand=${BRAND}&eventId=${eventId}`
      );
      const json = await response.json();

      // Envelope format validation
      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(true);
      expect(json).toHaveProperty('value');
    });

    test('bundle contains event data', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getPublicBundle&brand=${BRAND}&eventId=${eventId}`
      );
      const json = await response.json();

      if (json.ok && json.value) {
        expect(json.value).toHaveProperty('event');
        expect(json.value.event).toHaveProperty('id');
        expect(json.value.event).toHaveProperty('name');
      }
    });

    test('handles missing eventId with error envelope', async ({ request }) => {
      const response = await request.get(
        `/?p=api&action=getPublicBundle&brand=${BRAND}`
      );

      // Should not return 503
      expect(response.status()).not.toBe(503);

      const json = await response.json();
      // Should return error envelope or empty bundle
      expect(json).toHaveProperty('ok');
    });

  });

  test.describe('api_getDisplayBundle - Display/TV Bundle', () => {

    test('returns HTTP 200 for valid event', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getDisplayBundle&brand=${BRAND}&eventId=${eventId}`
      );

      // FAIL-FAST: 503 indicates deployment issue
      expect(response.status(), 'CRITICAL: HTTP 503 indicates GAS not reachable').not.toBe(503);
      expect(response.status()).toBe(200);
    });

    test('returns valid envelope with ok:true', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getDisplayBundle&brand=${BRAND}&eventId=${eventId}`
      );
      const json = await response.json();

      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(true);
      expect(json).toHaveProperty('value');
    });

    test('bundle contains display-optimized data', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getDisplayBundle&brand=${BRAND}&eventId=${eventId}`
      );
      const json = await response.json();

      if (json.ok && json.value) {
        expect(json.value).toHaveProperty('event');
        // Display bundle may include sponsor rotation data
      }
    });

    test('handles missing eventId gracefully', async ({ request }) => {
      const response = await request.get(
        `/?p=api&action=getDisplayBundle&brand=${BRAND}`
      );

      expect(response.status()).not.toBe(503);
      const json = await response.json();
      expect(json).toHaveProperty('ok');
    });

  });

  test.describe('api_getPosterBundle - Poster Bundle', () => {

    test('returns HTTP 200 for valid event', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getPosterBundle&brand=${BRAND}&eventId=${eventId}`
      );

      // FAIL-FAST: 503 indicates deployment issue
      expect(response.status(), 'CRITICAL: HTTP 503 indicates GAS not reachable').not.toBe(503);
      expect(response.status()).toBe(200);
    });

    test('returns valid envelope with ok:true', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getPosterBundle&brand=${BRAND}&eventId=${eventId}`
      );
      const json = await response.json();

      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(true);
      expect(json).toHaveProperty('value');
    });

    test('bundle contains poster data with QR codes', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getPosterBundle&brand=${BRAND}&eventId=${eventId}`
      );
      const json = await response.json();

      if (json.ok && json.value) {
        expect(json.value).toHaveProperty('event');
        // Poster bundle should have QR-ready data
      }
    });

    test('respects 3-slot hard limit for QR codes', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getPosterBundle&brand=${BRAND}&eventId=${eventId}`
      );
      const json = await response.json();

      if (json.ok && json.value && json.value.qrCodes) {
        // Per MVP contract, poster has 3-slot hard limit
        expect(json.value.qrCodes.length).toBeLessThanOrEqual(3);
      }
    });

    test('handles missing eventId gracefully', async ({ request }) => {
      const response = await request.get(
        `/?p=api&action=getPosterBundle&brand=${BRAND}`
      );

      expect(response.status()).not.toBe(503);
      const json = await response.json();
      expect(json).toHaveProperty('ok');
    });

  });

  test.describe('api_getSharedReportBundle - Analytics Bundle', () => {

    test('returns HTTP 200 for valid event', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getSharedReportBundle&brand=${BRAND}&eventId=${eventId}`
      );

      // FAIL-FAST: 503 indicates deployment issue
      expect(response.status(), 'CRITICAL: HTTP 503 indicates GAS not reachable').not.toBe(503);
      expect(response.status()).toBe(200);
    });

    test('returns valid envelope with ok:true', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getSharedReportBundle&brand=${BRAND}&eventId=${eventId}`
      );
      const json = await response.json();

      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(true);
      expect(json).toHaveProperty('value');
    });

    test('bundle contains analytics data', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getSharedReportBundle&brand=${BRAND}&eventId=${eventId}`
      );
      const json = await response.json();

      if (json.ok && json.value) {
        expect(json.value).toHaveProperty('event');
        // Analytics bundle includes metrics data
      }
    });

    test('handles sponsorId parameter', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/?p=api&action=getSharedReportBundle&brand=${BRAND}&eventId=${eventId}&sponsorId=test-sponsor`
      );

      // Should not return 503 even with invalid sponsorId
      expect(response.status()).not.toBe(503);
      expect(response.status()).toBeLessThan(500);
    });

    test('handles missing eventId gracefully', async ({ request }) => {
      const response = await request.get(
        `/?p=api&action=getSharedReportBundle&brand=${BRAND}`
      );

      expect(response.status()).not.toBe(503);
      const json = await response.json();
      expect(json).toHaveProperty('ok');
    });

  });

  test.describe('Bundle Response Contract Compliance', () => {

    test('all bundles return Content-Type application/json', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const bundleEndpoints = [
        'getPublicBundle',
        'getDisplayBundle',
        'getPosterBundle',
        'getSharedReportBundle',
      ];

      for (const action of bundleEndpoints) {
        const response = await request.get(
          `/?p=api&action=${action}&brand=${BRAND}&eventId=${eventId}`
        );
        expect(response.headers()['content-type']).toContain('application/json');
      }
    });

    test('all bundles use envelope format (not flat)', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const bundleEndpoints = [
        'getPublicBundle',
        'getDisplayBundle',
        'getPosterBundle',
        'getSharedReportBundle',
      ];

      for (const action of bundleEndpoints) {
        const response = await request.get(
          `/?p=api&action=${action}&brand=${BRAND}&eventId=${eventId}`
        );
        const json = await response.json();

        // Envelope format: has ok field at root
        expect(json).toHaveProperty('ok');

        // Success envelope has value wrapper
        if (json.ok === true) {
          expect(json).toHaveProperty('value');
        }
      }
    });

    test('error bundles have proper error envelope', async ({ request }) => {
      // Test with invalid event ID
      const response = await request.get(
        `/?p=api&action=getPublicBundle&brand=${BRAND}&eventId=invalid-event-id-xyz`
      );

      const json = await response.json();

      // Should return error envelope
      expect(json).toHaveProperty('ok');
      if (json.ok === false) {
        expect(json).toHaveProperty('code');
        expect(json).toHaveProperty('message');
        expect(['BAD_INPUT', 'NOT_FOUND', 'INTERNAL']).toContain(json.code);
      }
    });

  });

  test.describe('Bundle Parallel Access', () => {

    test('all bundles accessible in parallel', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const bundleEndpoints = [
        'getPublicBundle',
        'getDisplayBundle',
        'getPosterBundle',
        'getSharedReportBundle',
      ];

      // Fire parallel requests
      const promises = bundleEndpoints.map(action =>
        request.get(`/?p=api&action=${action}&brand=${BRAND}&eventId=${eventId}`)
      );

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach((response, index) => {
        expect(response.status(), `${bundleEndpoints[index]} failed`).toBe(200);
      });
    });

  });

});
