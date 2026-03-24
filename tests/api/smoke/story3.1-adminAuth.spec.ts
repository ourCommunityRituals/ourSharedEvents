/**
 * Stage-2 Smoke Tests: Story 3.1 Admin Authentication
 *
 * Tests admin authentication (Token Guard in Worker).
 * Validates that unauthorized requests are rejected with 401.
 *
 * Story 3.1 Acceptance Criteria:
 * - Unauthorized request (missing header) → 401
 * - Unauthorized request (invalid token) → 401
 * - Authorized request (valid token) → normal flow
 *
 * @see worker/src/auth/adminAuth.ts
 * @see worker/src/router.ts
 * @see Story 3.1 - Implement Admin Auth (Token Guard in Worker)
 */

import { test, expect } from '@playwright/test';

// Brand to test
const BRAND = process.env.TEST_BRAND || 'root';
const TIMEOUT = 30000;

// Admin token for authorized requests (from environment)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// Helper to get first valid event ID
async function getFirstEventId(request: any): Promise<string | null> {
  const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });
  if (!response.ok()) return null;

  const json = await response.json();
  if (json.ok && json.items && json.items.length > 0) {
    return json.items[0].id;
  }
  return null;
}

test.describe('Story 3.1: Admin Auth - Negative Tests (Unauthorized)', () => {

  test.describe('Admin Bundle Endpoint - Missing Authorization Header', () => {

    test('returns 401 when Authorization header is missing', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/api/events/${eventId}/adminBundle?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          // No Authorization header
        }
      );

      // Should return 401 Unauthorized
      expect(response.status()).toBe(401);
    });

    test('returns proper error envelope on 401', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/api/events/${eventId}/adminBundle?brand=${BRAND}`,
        { timeout: TIMEOUT }
      );

      const json = await response.json();

      // Error envelope format
      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(false);
      expect(json).toHaveProperty('code');
      expect(['MISSING_TOKEN', 'UNAUTHORIZED']).toContain(json.code);
      expect(json).toHaveProperty('message');
    });

    test('returns WWW-Authenticate header on 401', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/api/events/${eventId}/adminBundle?brand=${BRAND}`,
        { timeout: TIMEOUT }
      );

      if (response.status() === 401) {
        const wwwAuth = response.headers()['www-authenticate'];
        expect(wwwAuth).toContain('Bearer');
      }
    });

    test('returns JSON content type on 401', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/api/events/${eventId}/adminBundle?brand=${BRAND}`,
        { timeout: TIMEOUT }
      );

      if (response.status() === 401) {
        const contentType = response.headers()['content-type'];
        expect(contentType).toContain('application/json');
      }
    });
  });

  test.describe('Admin Bundle Endpoint - Invalid Authorization Token', () => {

    test('returns 401 when token is invalid', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/api/events/${eventId}/adminBundle?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          headers: {
            'Authorization': 'Bearer invalid-token-12345'
          }
        }
      );

      // Should return 401 Unauthorized
      expect(response.status()).toBe(401);
    });

    test('returns INVALID_TOKEN code for wrong token', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/api/events/${eventId}/adminBundle?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          headers: {
            'Authorization': 'Bearer wrong-token-value'
          }
        }
      );

      if (response.status() === 401) {
        const json = await response.json();
        expect(json.code).toBe('INVALID_TOKEN');
      }
    });

    test('returns 401 for malformed Bearer header', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/api/events/${eventId}/adminBundle?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          headers: {
            'Authorization': 'NotBearer some-token'
          }
        }
      );

      // Should return 401 for malformed header
      expect(response.status()).toBe(401);
    });
  });

  test.describe('Public Endpoints - No Auth Required', () => {

    test('public bundle does not require auth', async ({ request }) => {
      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/api/events/${eventId}/publicBundle?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          // No Authorization header
        }
      );

      // Public endpoints should work without auth
      // Should be 200 or 404 (if event not found), but NOT 401
      expect(response.status()).not.toBe(401);
    });

    test('events list does not require auth', async ({ request }) => {
      const response = await request.get(
        `/api/events?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          // No Authorization header
        }
      );

      // Events list should work without auth
      expect(response.status()).not.toBe(401);
      expect(response.status()).toBe(200);
    });

    test('status endpoint does not require auth', async ({ request }) => {
      const response = await request.get('/api/status', {
        timeout: TIMEOUT,
        // No Authorization header
      });

      // Status should work without auth
      expect(response.status()).not.toBe(401);
      expect(response.status()).toBe(200);
    });
  });
});

test.describe('Story 3.1: Admin Auth - Positive Tests (Authorized)', () => {

  test.describe('Admin Bundle with Valid Token', () => {

    test('returns 200 with valid Authorization header', async ({ request }) => {
      // Skip if no admin token configured
      test.skip(!ADMIN_TOKEN, 'ADMIN_TOKEN not configured for positive tests');

      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/api/events/${eventId}/adminBundle?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          headers: {
            'Authorization': `Bearer ${ADMIN_TOKEN}`
          }
        }
      );

      // With valid token, should return 200
      expect(response.status()).toBe(200);
    });

    test('returns valid admin bundle with auth', async ({ request }) => {
      test.skip(!ADMIN_TOKEN, 'ADMIN_TOKEN not configured for positive tests');

      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/api/events/${eventId}/adminBundle?brand=${BRAND}`,
        {
          timeout: TIMEOUT,
          headers: {
            'Authorization': `Bearer ${ADMIN_TOKEN}`
          }
        }
      );

      const json = await response.json();

      // Should return success envelope with admin bundle
      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(true);
      expect(json).toHaveProperty('value');
      expect(json.value).toHaveProperty('event');
    });
  });

  test.describe('Query Parameter Auth (Legacy Support)', () => {

    test('accepts adminKey query parameter', async ({ request }) => {
      test.skip(!ADMIN_TOKEN, 'ADMIN_TOKEN not configured for positive tests');

      const eventId = await getFirstEventId(request);
      test.skip(!eventId, 'No events available for testing');

      const response = await request.get(
        `/api/events/${eventId}/adminBundle?brand=${BRAND}&adminKey=${ADMIN_TOKEN}`,
        { timeout: TIMEOUT }
      );

      // Query param auth should work
      expect(response.status()).toBe(200);
    });
  });
});

test.describe('Story 3.1: CORS with Auth Errors', () => {

  test('401 responses include CORS headers', async ({ request }) => {
    const eventId = await getFirstEventId(request);
    test.skip(!eventId, 'No events available for testing');

    const response = await request.get(
      `/api/events/${eventId}/adminBundle?brand=${BRAND}`,
      { timeout: TIMEOUT }
    );

    if (response.status() === 401) {
      const corsHeader = response.headers()['access-control-allow-origin'];
      // CORS should be set even on error responses
      expect(corsHeader).toBeDefined();
    }
  });
});
