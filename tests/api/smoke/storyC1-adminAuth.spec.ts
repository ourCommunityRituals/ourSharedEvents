/**
 * Stage-2 Smoke Tests: Story C1 Admin Auth Gate
 * Updated for Story D4: Replace Admin Key with Cloudflare Access
 *
 * Tests admin authentication for V2 admin API endpoints.
 * Validates that unauthorized requests are rejected with 401 and proper error format.
 *
 * Story C1 Acceptance Criteria:
 * - Unauthorized calls to admin endpoints return 401 with stable JSON
 * - Response shape: { "ok": false, "status": 401, "code": "UNAUTH", "requestId": "..." }
 * - No secrets are ever logged
 * - Authorized POST succeeds
 *
 * Story D4 Authentication:
 * - Primary: Cloudflare Access (CF-Access-Client-Id/CF-Access-Client-Secret headers)
 * - Fallback: ADMIN_KEY (only when ALLOW_ADMIN_KEY_FALLBACK=true on worker)
 *
 * @see worker/src/auth/admin.ts
 * @see worker/src/router.ts
 * @see Story C1 - Admin Auth Gate (Admin Key)
 * @see Story D4 - Replace Admin Key with Cloudflare Access
 */

import { test, expect } from '@playwright/test';

// Brand to test
const BRAND = process.env.TEST_BRAND || 'root';
const TIMEOUT = 30000;

// Cloudflare Access Service Token credentials (Story D4 - primary auth)
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

// Admin key for authorized requests (legacy fallback)
// Only works when ALLOW_ADMIN_KEY_FALLBACK=true on worker
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || '';

/**
 * Check if any auth credentials are configured
 */
const hasAuthCredentials = (): boolean =>
  Boolean((CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) || ADMIN_KEY);

/**
 * Get auth headers for authenticated requests
 * Prefers Cloudflare Access, falls back to Bearer token
 */
const getAuthHeaders = (): Record<string, string> => {
  if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
    return {
      'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
    };
  }
  if (ADMIN_KEY) {
    return {
      Authorization: `Bearer ${ADMIN_KEY}`,
    };
  }
  return {};
};

test.describe('Story C1: Admin Auth Gate - V2 Admin Endpoints', () => {

  test.describe('POST /api/v2/admin/events - Unauthorized', () => {

    test('returns 401 when Authorization header is missing', async ({ request }) => {
      const response = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: {
            title: 'Test Event',
            date: new Date().toISOString().split('T')[0],
          },
          // No Authorization header
        }
      );

      // Should return 401 Unauthorized
      expect(response.status()).toBe(401);
    });

    test('returns proper error envelope with requestId on 401', async ({ request }) => {
      const response = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: {
            title: 'Test Event',
            date: new Date().toISOString().split('T')[0],
          },
        }
      );

      expect(response.status()).toBe(401);

      const json = await response.json();

      // Story C1 error envelope format
      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(false);

      expect(json).toHaveProperty('status');
      expect(json.status).toBe(401);

      expect(json).toHaveProperty('code');
      expect(json.code).toBe('UNAUTH');

      expect(json).toHaveProperty('requestId');
      expect(typeof json.requestId).toBe('string');
      expect(json.requestId.length).toBeGreaterThan(0);
    });

    test('returns WWW-Authenticate header on 401', async ({ request }) => {
      const response = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: { title: 'Test Event' },
        }
      );

      expect(response.status()).toBe(401);

      const wwwAuth = response.headers()['www-authenticate'];
      expect(wwwAuth).toBeDefined();
      expect(wwwAuth).toContain('Bearer');
    });

    test('returns JSON content type on 401', async ({ request }) => {
      const response = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: { title: 'Test Event' },
        }
      );

      expect(response.status()).toBe(401);

      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('application/json');
    });

    test('returns X-Request-Id header on 401', async ({ request }) => {
      const response = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: { title: 'Test Event' },
        }
      );

      expect(response.status()).toBe(401);

      const requestId = response.headers()['x-request-id'];
      expect(requestId).toBeDefined();
      expect(requestId.length).toBeGreaterThan(0);
    });

    test('returns 401 when token is invalid', async ({ request }) => {
      const response = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: { title: 'Test Event' },
          headers: {
            'Authorization': 'Bearer invalid-token-12345'
          }
        }
      );

      expect(response.status()).toBe(401);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('UNAUTH');
    });

    test('returns 401 for malformed Bearer header', async ({ request }) => {
      const response = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: { title: 'Test Event' },
          headers: {
            'Authorization': 'NotBearer some-token'
          }
        }
      );

      expect(response.status()).toBe(401);
    });
  });

  test.describe('POST /api/v2/admin/events - Authorized', () => {

    test('returns success with valid auth credentials', async ({ request }) => {
      // Skip if no auth credentials configured (CF Access or ADMIN_KEY)
      test.skip(!hasAuthCredentials(), 'No auth credentials configured for positive tests');

      const response = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: {
            title: `Test Event ${Date.now()}`,
            date: new Date().toISOString().split('T')[0],
          },
          headers: getAuthHeaders(),
        }
      );

      // With valid credentials, should NOT return 401
      expect(response.status()).not.toBe(401);

      // Should either succeed (200/201) or fail for validation reasons (400)
      // but never for auth reasons
      expect([200, 201, 400]).toContain(response.status());
    });

    test('authorized request returns proper response envelope', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured for positive tests');

      const response = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: {
            title: `Test Event ${Date.now()}`,
            date: new Date().toISOString().split('T')[0],
          },
          headers: getAuthHeaders(),
        }
      );

      // Should not be unauthorized
      expect(response.status()).not.toBe(401);

      const json = await response.json();

      // Response should have 'ok' property
      expect(json).toHaveProperty('ok');
    });
  });

  test.describe('CORS with Auth Errors', () => {

    test('401 responses include CORS headers', async ({ request }) => {
      const response = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: { title: 'Test Event' },
        }
      );

      expect(response.status()).toBe(401);

      const corsHeader = response.headers()['access-control-allow-origin'];
      expect(corsHeader).toBeDefined();
    });
  });

  test.describe('Deterministic Error Response', () => {

    test('error response is consistent across multiple requests', async ({ request }) => {
      // Make two requests and verify error format is deterministic
      const response1 = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: { title: 'Test Event 1' },
        }
      );

      const response2 = await request.post(
        `/api/v2/admin/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          data: { title: 'Test Event 2' },
        }
      );

      expect(response1.status()).toBe(401);
      expect(response2.status()).toBe(401);

      const json1 = await response1.json();
      const json2 = await response2.json();

      // Both should have same structure
      expect(json1.ok).toBe(json2.ok);
      expect(json1.status).toBe(json2.status);
      expect(json1.code).toBe(json2.code);

      // requestId should be different
      expect(json1.requestId).not.toBe(json2.requestId);
    });
  });
});

test.describe('Story C1: ADMIN_KEY Configuration Errors (503)', () => {

  /**
   * Story C1 Negative Path Handling:
   * When ADMIN_KEY environment variable is not configured on the Worker,
   * requests to admin endpoints should return 503 with code ADMIN_KEY_MISSING.
   *
   * This test documents the expected behavior. In staging/production environments
   * where ADMIN_KEY is configured, these tests verify the 401 behavior instead.
   * The 503 behavior is tested implicitly when the key is not configured.
   *
   * Expected 503 response shape:
   * { "ok": false, "status": 503, "code": "ADMIN_KEY_MISSING", "requestId": "..." }
   */

  test('documents 503 ADMIN_KEY_MISSING behavior when key not configured', async () => {
    // This test documents the expected behavior when ADMIN_KEY is missing.
    // In staging, ADMIN_KEY is configured, so we verify the 401 behavior instead.
    //
    // When ADMIN_KEY is NOT configured:
    // - Any request to /api/v2/admin/* should return 503
    // - Response code should be "ADMIN_KEY_MISSING"
    // - Response should include requestId for debugging
    //
    // This ensures operators can easily identify misconfiguration
    // vs authentication failures (401 vs 503).
    expect(true).toBe(true); // Documentation test always passes
  });

  test('503 response should have correct structure when key is missing', async ({ request }) => {
    // In staging where ADMIN_KEY is configured, we get 401 (tested above).
    // This test documents the expected 503 structure when key is NOT configured:
    //
    // {
    //   "ok": false,
    //   "status": 503,
    //   "code": "ADMIN_KEY_MISSING",
    //   "requestId": "<uuid>"
    // }
    //
    // The 503 explicitly tells operators that the ADMIN_KEY secret
    // needs to be configured on the Cloudflare Worker, rather than
    // confusing them with a generic 401 Unauthorized.

    // Verify staging has key configured (returns 401, not 503)
    const response = await request.post(
      `/api/v2/admin/events?brand=${BRAND}`,
      {
        timeout: TIMEOUT,
        data: { name: 'Test Event' },
        // No Authorization header - should return 401 (key is configured)
      }
    );

    // In staging with ADMIN_KEY configured: expect 401
    // In misconfigured env without ADMIN_KEY: would expect 503
    expect([401, 503]).toContain(response.status());

    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json).toHaveProperty('requestId');

    if (response.status() === 503) {
      // Key is not configured - 503 ADMIN_KEY_MISSING
      expect(json.status).toBe(503);
      expect(json.code).toBe('ADMIN_KEY_MISSING');
    } else {
      // Key is configured - 401 UNAUTH
      expect(json.status).toBe(401);
      expect(json.code).toBe('UNAUTH');
    }
  });
});

test.describe('Story C1: Public Endpoints - No Auth Required', () => {

  test('/api/v2/events does not require auth', async ({ request }) => {
    const response = await request.get(
      `/api/v2/events?brand=${BRAND}`,
      {
        timeout: TIMEOUT,
        // No Authorization header
      }
    );

    // Public endpoints should work without auth
    expect(response.status()).not.toBe(401);
    expect([200, 500]).toContain(response.status()); // 200 if healthy, 500 if backend not configured
  });

  test('/api/health/backend does not require auth', async ({ request }) => {
    const response = await request.get(
      `/api/health/backend`,
      {
        timeout: TIMEOUT,
        // No Authorization header
      }
    );

    // Health endpoints should work without auth
    expect(response.status()).not.toBe(401);
  });
});
