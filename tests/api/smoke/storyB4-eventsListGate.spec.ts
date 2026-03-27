/**
 * Story B4: Events List Smoke Gate Test
 *
 * Stage-2 smoke test that validates:
 * - GET /api/v2/events?brand=root returns 200
 * - Response has .ok == true
 * - Response has .items array
 *
 * Purpose / Value:
 *   Restore /events and /manage read dependency: listing events must work
 *   reliably from Worker -> Sheets.
 *
 * Acceptance Criteria:
 *   Stage-2 fails fast if:
 *   - /api/v2/events?brand=root returns non-200
 *   - Response .ok != true
 *   - Response missing .items array
 *
 * Negative Path Validation:
 *   - Invalid brand returns 400 with INVALID_BRAND code
 *
 * Environment Variables (injected by CI):
 *   BASE_URL=https://stg.oursharedevents.com
 *
 * @see Story B4 - Implement GET /api/v2/events?brand=root (Read Path)
 */

import { test, expect } from '@playwright/test';

// =============================================================================
// Configuration
// =============================================================================

/** Default brand for testing */
const DEFAULT_BRAND = 'root';

/** Timeout for API requests (staging cold start tolerance) */
const TIMEOUT = 30000;

/** Valid brands per Story B4 */
const VALID_BRANDS = ['root', 'abc', 'cbc', 'cbl'];

// =============================================================================
// Test Suite
// =============================================================================

test.describe('Story B4: Events List Smoke Gate', () => {
  /**
   * Primary gate test: GET /api/v2/events returns ok=true
   *
   * This is the main CI gate test per Story B4 acceptance criteria:
   * "GET /api/v2/events?brand=root returns 200 with .items array"
   */
  test('GET /api/v2/events?brand=root returns 200 with ok=true', async ({ request }) => {
    console.log('[B4 Gate] Testing /api/v2/events?brand=root');

    const response = await request.get(`/api/v2/events?brand=${DEFAULT_BRAND}`, {
      timeout: TIMEOUT,
    });

    // Assert: HTTP 200
    expect(
      response.status(),
      `Events endpoint should return 200, got ${response.status()}`
    ).toBe(200);

    const json = await response.json();

    // Assert: ok == true (per jq -e '.ok == true' requirement)
    expect(
      json.ok,
      'Response should have ok=true'
    ).toBe(true);

    // Assert: status == 200
    expect(
      json.status,
      'Response should have status=200'
    ).toBe(200);

    // Assert: items is array (per Story B4 response shape contract)
    expect(
      Array.isArray(json.items),
      'Response should have items array'
    ).toBe(true);

    console.log(`[B4 Gate] PASSED: Received ${json.items.length} events`);
  });

  /**
   * Test: Default brand is 'root' when missing
   *
   * Per Story B4: "Default brand=root when missing"
   */
  test('GET /api/v2/events without brand defaults to root', async ({ request }) => {
    console.log('[B4 Gate] Testing /api/v2/events without brand param');

    const response = await request.get('/api/v2/events', {
      timeout: TIMEOUT,
    });

    // Assert: HTTP 200
    expect(
      response.status(),
      `Events endpoint without brand should return 200, got ${response.status()}`
    ).toBe(200);

    const json = await response.json();

    // Assert: ok == true
    expect(json.ok, 'Response should have ok=true').toBe(true);

    // Assert: items array exists
    expect(
      Array.isArray(json.items),
      'Response should have items array'
    ).toBe(true);

    console.log('[B4 Gate] PASSED: Default brand=root works');
  });

  /**
   * Test all valid brands
   *
   * Ensures the endpoint works for all configured brands.
   */
  for (const brand of VALID_BRANDS) {
    test(`GET /api/v2/events?brand=${brand} returns ok=true`, async ({ request }) => {
      console.log(`[B4 Gate] Testing /api/v2/events?brand=${brand}`);

      const response = await request.get(`/api/v2/events?brand=${brand}`, {
        timeout: TIMEOUT,
      });

      // Assert: HTTP 200
      expect(
        response.status(),
        `Events endpoint for brand=${brand} should return 200`
      ).toBe(200);

      const json = await response.json();

      // Assert: ok == true
      expect(json.ok, `Response for brand=${brand} should have ok=true`).toBe(true);

      // Assert: items array
      expect(
        Array.isArray(json.items),
        `Response for brand=${brand} should have items array`
      ).toBe(true);

      console.log(`[B4 Gate] PASSED: brand=${brand} returned ${json.items.length} events`);
    });
  }

  /**
   * Negative path: Invalid brand returns 400
   *
   * Per Story B4 acceptance criteria: Invalid brand -> INVALID_BRAND error
   */
  test('GET /api/v2/events with invalid brand returns 400', async ({ request }) => {
    console.log('[B4 Gate] Testing invalid brand');

    const response = await request.get('/api/v2/events?brand=invalid_brand_xyz', {
      timeout: TIMEOUT,
    });

    // Assert: HTTP 400 (bad request)
    expect(
      response.status(),
      `Invalid brand should return 400, got ${response.status()}`
    ).toBe(400);

    const json = await response.json();

    // Assert: ok == false
    expect(json.ok, 'Error response should have ok=false').toBe(false);

    // Assert: error code is INVALID_BRAND
    expect(
      json.code,
      'Error code should be INVALID_BRAND'
    ).toBe('INVALID_BRAND');

    console.log('[B4 Gate] PASSED: Invalid brand rejected with INVALID_BRAND');
  });

  /**
   * Response shape validation: Verify contract structure
   *
   * Per Story B4: "Confirms response shape: { ok: true, status: 200, items: [...] }"
   */
  test('Response shape matches contract specification', async ({ request }) => {
    console.log('[B4 Gate] Validating response shape contract');

    const response = await request.get(`/api/v2/events?brand=${DEFAULT_BRAND}`, {
      timeout: TIMEOUT,
    });

    expect(response.status()).toBe(200);

    const json = await response.json();

    // Validate top-level shape
    expect(json).toHaveProperty('ok', true);
    expect(json).toHaveProperty('status', 200);
    expect(json).toHaveProperty('items');
    expect(Array.isArray(json.items)).toBe(true);

    // If we have events, validate item shape (summary fields)
    if (json.items.length > 0) {
      const firstItem = json.items[0];

      // Summary fields per Story B4 contract
      expect(firstItem).toHaveProperty('id');
      expect(firstItem).toHaveProperty('slug');
      expect(firstItem).toHaveProperty('name');

      console.log(`[B4 Gate] PASSED: Contract validated with ${json.items.length} events`);
      console.log(`[B4 Gate] Sample event: ${firstItem.name} (${firstItem.id})`);
    } else {
      console.log('[B4 Gate] PASSED: Contract validated (empty items array)');
    }
  });

  /**
   * Headers validation: Check required response headers
   */
  test('Response includes required headers', async ({ request }) => {
    const response = await request.get(`/api/v2/events?brand=${DEFAULT_BRAND}`, {
      timeout: TIMEOUT,
    });

    expect(response.status()).toBe(200);

    // Check content type
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');

    // Check request ID header for tracing
    const requestId = response.headers()['x-request-id'];
    expect(requestId, 'Response should include X-Request-Id header').toBeDefined();

    console.log(`[B4 Gate] PASSED: Headers validated (requestId: ${requestId})`);
  });
});
