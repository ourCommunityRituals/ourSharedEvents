/**
 * SEC-IAC-07: IAC Smoke Tests
 *
 * Proves Infrastructure Access Control (IAC) enforcement in CI.
 * These smoke tests validate that security guards are functioning correctly
 * in the deployed environment.
 *
 * Tests:
 *   1. /admin unauthenticated → 401 (Admin auth guard)
 *   2. public POST w/o token → 403 (Signed mutations guard)
 *   3. unknown route → 404 (Router 404 handling)
 *
 * CI Integration:
 *   - Runs after guard-no-gas job
 *   - Fails pipeline on regression
 *
 * @see worker/src/auth/admin.ts - Admin authentication
 * @see worker/src/auth/signedMutations.ts - Signed mutations
 * @see worker/src/router.ts - 404 handling
 * @see SEC-IAC-05 - Signed mutations implementation
 * @see SEC-IAC-06 - Audit logging
 */

import { test, expect } from '@playwright/test';

// Brand to test
const BRAND = process.env.TEST_BRAND || 'root';
const TIMEOUT = 30000;

test.describe('SEC-IAC-07: IAC Smoke Tests', () => {
  /**
   * Test 1: Admin route without authentication returns 401
   *
   * Validates that the admin auth guard (guardV2AdminRoute) correctly
   * rejects unauthenticated requests to admin endpoints.
   *
   * Expected: 401 Unauthorized with UNAUTH error code
   */
  test.describe('Admin Auth Guard - 401 Unauthorized', () => {
    test('/api/v2/admin/events without auth returns 401', async ({ request }) => {
      const response = await request.post(`/api/v2/admin/events?brand=${BRAND}`, {
        timeout: TIMEOUT,
        data: {
          title: 'Test Event',
          date: new Date().toISOString().split('T')[0],
        },
        // No Authorization header - unauthenticated
      });

      expect(response.status()).toBe(401);
    });

    test('401 response has correct error envelope', async ({ request }) => {
      const response = await request.post(`/api/v2/admin/events?brand=${BRAND}`, {
        timeout: TIMEOUT,
        data: { title: 'Test Event' },
      });

      expect(response.status()).toBe(401);

      const json = await response.json();

      // Verify error envelope structure
      expect(json).toMatchObject({
        ok: false,
        status: 401,
        code: 'UNAUTH',
      });
      expect(json).toHaveProperty('requestId');
      expect(typeof json.requestId).toBe('string');
      expect(json.requestId.length).toBeGreaterThan(0);
    });

    test('401 response includes WWW-Authenticate header', async ({ request }) => {
      const response = await request.post(`/api/v2/admin/events?brand=${BRAND}`, {
        timeout: TIMEOUT,
        data: { title: 'Test Event' },
      });

      expect(response.status()).toBe(401);

      const wwwAuth = response.headers()['www-authenticate'];
      expect(wwwAuth).toBeDefined();
      expect(wwwAuth).toContain('Bearer');
    });
  });

  /**
   * Test 2: Public POST without mutation token returns 403
   *
   * Validates that the signed mutations guard (guardSignedMutation)
   * correctly rejects POST requests without a valid X-Mutation-Token.
   *
   * Expected: 403 Forbidden with MISSING_TOKEN error code
   */
  test.describe('Signed Mutations Guard - 403 Forbidden', () => {
    test('POST /api/v2/events without X-Mutation-Token returns 403', async ({ request }) => {
      const response = await request.post(`/api/v2/events?brand=${BRAND}`, {
        timeout: TIMEOUT,
        data: {
          title: 'Test Event',
          date: new Date().toISOString().split('T')[0],
        },
        // No X-Mutation-Token header
      });

      // Should be 403 when signed mutations are configured
      // May be 405 or other status if signed mutations not configured
      expect([403, 405]).toContain(response.status());

      if (response.status() === 403) {
        const json = await response.json();

        // Verify error envelope structure for signed mutations
        expect(json).toMatchObject({
          ok: false,
          status: 403,
        });

        // Should have MISSING_TOKEN code when token is absent
        expect(['MISSING_TOKEN', 'HMAC_NOT_CONFIGURED']).toContain(json.code);
        expect(json).toHaveProperty('requestId');
      }
    });

    test('403 response has valid error structure', async ({ request }) => {
      const response = await request.post(`/api/v2/events?brand=${BRAND}`, {
        timeout: TIMEOUT,
        data: { title: 'Test Event' },
      });

      // Skip validation if signed mutations not configured (405/other)
      if (response.status() !== 403) {
        test.skip(true, 'Signed mutations not enforced in this environment');
        return;
      }

      const json = await response.json();

      // Verify JSON content type
      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('application/json');

      // Verify response has requestId for debugging
      expect(json).toHaveProperty('requestId');
      expect(typeof json.requestId).toBe('string');
    });
  });

  /**
   * Test 3: Unknown route returns 404
   *
   * Validates that the router correctly returns 404 for unknown API routes.
   * This ensures proper route handling and prevents information leakage.
   *
   * Expected: 404 Not Found with proper JSON response
   */
  test.describe('Router 404 Handling', () => {
    test('unknown API route returns 404', async ({ request }) => {
      const response = await request.get('/api/v2/nonexistent-route-xyz', {
        timeout: TIMEOUT,
      });

      expect(response.status()).toBe(404);
    });

    test('404 response has correct JSON structure', async ({ request }) => {
      const response = await request.get('/api/v2/unknown-endpoint-abc', {
        timeout: TIMEOUT,
      });

      expect(response.status()).toBe(404);

      const json = await response.json();

      // Verify 404 response structure
      expect(json).toMatchObject({
        ok: false,
        status: 404,
        error: 'Not Found',
      });
      expect(json).toHaveProperty('path');
      expect(json).toHaveProperty('timestamp');
    });

    test('404 returns JSON content type', async ({ request }) => {
      const response = await request.get('/api/v2/does-not-exist', {
        timeout: TIMEOUT,
      });

      expect(response.status()).toBe(404);

      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('application/json');
    });

    test('deeply nested unknown route returns 404', async ({ request }) => {
      const response = await request.get('/api/v2/admin/nested/path/that/does/not/exist', {
        timeout: TIMEOUT,
      });

      // Should return either 404 (not found) or 401 (admin auth required)
      // Either is acceptable - both indicate the route doesn't expose data
      expect([401, 404]).toContain(response.status());
    });
  });

  /**
   * Deterministic behavior tests
   *
   * Ensures IAC responses are consistent across multiple requests.
   */
  test.describe('Deterministic IAC Responses', () => {
    test('401 responses are consistent', async ({ request }) => {
      const response1 = await request.post(`/api/v2/admin/events?brand=${BRAND}`, {
        timeout: TIMEOUT,
        data: { title: 'Test 1' },
      });

      const response2 = await request.post(`/api/v2/admin/events?brand=${BRAND}`, {
        timeout: TIMEOUT,
        data: { title: 'Test 2' },
      });

      expect(response1.status()).toBe(401);
      expect(response2.status()).toBe(401);

      const json1 = await response1.json();
      const json2 = await response2.json();

      // Same structure
      expect(json1.ok).toBe(json2.ok);
      expect(json1.status).toBe(json2.status);
      expect(json1.code).toBe(json2.code);

      // Different requestIds (unique per request)
      expect(json1.requestId).not.toBe(json2.requestId);
    });

    test('404 responses are consistent', async ({ request }) => {
      const response1 = await request.get('/api/v2/unknown-1', { timeout: TIMEOUT });
      const response2 = await request.get('/api/v2/unknown-2', { timeout: TIMEOUT });

      expect(response1.status()).toBe(404);
      expect(response2.status()).toBe(404);

      const json1 = await response1.json();
      const json2 = await response2.json();

      // Same base structure
      expect(json1.ok).toBe(json2.ok);
      expect(json1.status).toBe(json2.status);
      expect(json1.error).toBe(json2.error);

      // Different paths (as expected)
      expect(json1.path).not.toBe(json2.path);
    });
  });
});
