/**
 * Story E3: Public Failure States Tests (Never Blank / Never Broken)
 *
 * Purpose / Value:
 *   Verify that public surfaces never show blank or broken pages.
 *   Non-ACTIVE events return proper error responses with state information.
 *
 * Environment: STAGING
 *
 * Acceptance Criteria:
 *   - Public bundle returns 403 with ASSET_NOT_RENDERABLE for non-ACTIVE events
 *   - Error response includes assetState and assetStateInfo
 *   - ACTIVE events still return 200 with full bundle
 *   - Error response includes reason explaining why event can't be displayed
 *
 * @see Story E3 - Public Failure States (Never Blank / Never Broken)
 */

import { test, expect } from '@playwright/test';

// =============================================================================
// Configuration
// =============================================================================

/** Base URL for staging environment */
const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';

/** Admin key for authorized requests (from CI secrets) */
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_KEY_STG || process.env.ADMIN_TOKEN || '';

/** Cloudflare Access Service Token headers (Story D4) */
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

/** Brand used for test */
const BRAND = process.env.TEST_BRAND || 'root';

/** Timeout for API requests (staging cold start tolerance) */
const TIMEOUT = 30000;

/** Unique prefix for E3 test events */
const E3_TEST_EVENT_PREFIX = 'E3-PublicFailure-Test';

// =============================================================================
// Auth Helper
// =============================================================================

/**
 * Returns authorization headers based on available credentials.
 * Priority: Cloudflare Access Service Token > Admin Key
 */
function getAuthHeaders(): Record<string, string> {
  if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
    return {
      'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
      'Content-Type': 'application/json',
    };
  }
  if (ADMIN_KEY) {
    return {
      Authorization: `Bearer ${ADMIN_KEY}`,
      'Content-Type': 'application/json',
    };
  }
  return {
    'Content-Type': 'application/json',
  };
}

/**
 * Checks if any auth method is configured
 */
function hasAuth(): boolean {
  return !!(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) || !!ADMIN_KEY;
}

// =============================================================================
// Logging Helpers
// =============================================================================

function logApiResponse(endpoint: string, status: number, requestId: string): void {
  console.log(JSON.stringify({
    type: 'API_RESPONSE',
    endpoint,
    status,
    requestId,
    timestamp: new Date().toISOString(),
  }));
}

// =============================================================================
// Test Suite: Public Failure States
// =============================================================================

test.describe('Story E3: Public Failure States (Never Blank / Never Broken)', () => {
  // Store created event ID for cleanup
  let testEventId: string | null = null;

  test.afterEach(async ({ request }) => {
    // Cleanup: Archive test event if created
    if (testEventId && hasAuth()) {
      try {
        await request.post(`${BASE_URL}/api/v2/admin/events/${testEventId}/archive`, {
          headers: getAuthHeaders(),
          timeout: TIMEOUT,
        });
      } catch {
        // Ignore cleanup errors
      }
      testEventId = null;
    }
  });

  test('AC1: Unverified event returns 403 ASSET_NOT_RENDERABLE on publicBundle', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${E3_TEST_EVENT_PREFIX}-unverified-${Date.now()}`;

    // Step 1: Create a new event (will be in READY state, not ACTIVE)
    const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      headers: getAuthHeaders(),
      data: {
        name: uniqueName,
        brand: BRAND,
        startDateISO: new Date().toISOString().split('T')[0],
        venue: 'Test Venue',
      },
      timeout: TIMEOUT,
    });

    expect(createResponse.status()).toBe(201);
    const createData = await createResponse.json();
    testEventId = createData.item.id;

    // Verify event is NOT ACTIVE
    expect(createData.item.assetState).not.toBe('ACTIVE');

    // Step 2: Try to get public bundle for unverified event
    const bundleResponse = await request.get(`${BASE_URL}/api/events/${testEventId}/publicBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = bundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(`/api/events/${testEventId}/publicBundle`, bundleResponse.status(), requestId);

    // Should return 403 Forbidden
    expect(bundleResponse.status()).toBe(403);

    const data = await bundleResponse.json();

    // Verify error response shape
    expect(data.ok).toBe(false);
    expect(data.code).toBe('ASSET_NOT_RENDERABLE');
    expect(data.status).toBe(403);
    expect(data.message).toBeDefined();

    // Verify asset state info is included
    expect(data.assetState).toBeDefined();
    expect(data.assetStateInfo).toBeDefined();
    expect(data.assetStateInfo.state).toBeDefined();
    expect(data.assetStateInfo.isRenderable).toBe(false);
    expect(data.assetStateInfo.label).toBeDefined();
  });

  test('AC2: Verified event returns 200 with full bundle', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${E3_TEST_EVENT_PREFIX}-verified-${Date.now()}`;

    // Step 1: Create a new event
    const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      headers: getAuthHeaders(),
      data: {
        name: uniqueName,
        brand: BRAND,
        startDateISO: new Date().toISOString().split('T')[0],
        venue: 'Test Venue',
      },
      timeout: TIMEOUT,
    });

    expect(createResponse.status()).toBe(201);
    const createData = await createResponse.json();
    testEventId = createData.item.id;

    // Step 2: Verify the event (makes it ACTIVE)
    const verifyResponse = await request.post(`${BASE_URL}/api/v2/admin/events/${testEventId}/verify-qr`, {
      headers: getAuthHeaders(),
      timeout: TIMEOUT,
    });
    expect(verifyResponse.status()).toBe(200);

    // Step 3: Get public bundle (should succeed)
    const bundleResponse = await request.get(`${BASE_URL}/api/events/${testEventId}/publicBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = bundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(`/api/events/${testEventId}/publicBundle`, bundleResponse.status(), requestId);

    // Should return 200 OK
    expect(bundleResponse.status()).toBe(200);

    const data = await bundleResponse.json();

    // Verify success response
    expect(data.ok).toBe(true);
    expect(data.etag).toBeDefined();
    expect(data.value).toBeDefined();
    expect(data.value.event).toBeDefined();
    expect(data.value.assetState).toBe('ACTIVE');
    expect(data.value.assetStateInfo.isRenderable).toBe(true);
  });

  test('AC3: Archived event returns 403 ASSET_NOT_RENDERABLE', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${E3_TEST_EVENT_PREFIX}-archived-${Date.now()}`;

    // Step 1: Create and verify an event
    const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      headers: getAuthHeaders(),
      data: {
        name: uniqueName,
        brand: BRAND,
        startDateISO: new Date().toISOString().split('T')[0],
        venue: 'Test Venue',
      },
      timeout: TIMEOUT,
    });

    expect(createResponse.status()).toBe(201);
    const createData = await createResponse.json();
    testEventId = createData.item.id;

    // Verify to make ACTIVE
    await request.post(`${BASE_URL}/api/v2/admin/events/${testEventId}/verify-qr`, {
      headers: getAuthHeaders(),
      timeout: TIMEOUT,
    });

    // Step 2: Archive the event
    const archiveResponse = await request.post(`${BASE_URL}/api/v2/admin/events/${testEventId}/archive`, {
      headers: getAuthHeaders(),
      timeout: TIMEOUT,
    });
    expect(archiveResponse.status()).toBe(200);

    // Step 3: Try to get public bundle for archived event
    const bundleResponse = await request.get(`${BASE_URL}/api/events/${testEventId}/publicBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = bundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(`/api/events/${testEventId}/publicBundle`, bundleResponse.status(), requestId);

    // Should return 403 Forbidden
    expect(bundleResponse.status()).toBe(403);

    const data = await bundleResponse.json();

    // Verify error response
    expect(data.ok).toBe(false);
    expect(data.code).toBe('ASSET_NOT_RENDERABLE');
    expect(data.assetState).toBe('ARCHIVED');
    expect(data.assetStateInfo.isRenderable).toBe(false);

    // Clear testEventId since it's already archived
    testEventId = null;
  });

  test('AC4: Error response includes actionable message', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${E3_TEST_EVENT_PREFIX}-message-${Date.now()}`;

    // Create unverified event
    const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      headers: getAuthHeaders(),
      data: {
        name: uniqueName,
        brand: BRAND,
        startDateISO: new Date().toISOString().split('T')[0],
        venue: 'Test Venue',
      },
      timeout: TIMEOUT,
    });

    expect(createResponse.status()).toBe(201);
    const createData = await createResponse.json();
    testEventId = createData.item.id;

    // Get public bundle
    const bundleResponse = await request.get(`${BASE_URL}/api/events/${testEventId}/publicBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    expect(bundleResponse.status()).toBe(403);

    const data = await bundleResponse.json();

    // The message should be actionable - explaining why it can't be displayed
    expect(data.message).toBeDefined();
    expect(typeof data.message).toBe('string');
    expect(data.message.length).toBeGreaterThan(10);

    // Log the message for debugging
    console.log(JSON.stringify({
      type: 'TEST_INFO',
      testCase: 'AC4',
      errorMessage: data.message,
      assetState: data.assetState,
      timestamp: new Date().toISOString(),
    }));
  });

  test('AC5: Non-existent event still returns 404 (not 403)', async ({ request }) => {
    const fakeEventId = 'non-existent-event-e3-12345';

    const bundleResponse = await request.get(`${BASE_URL}/api/events/${fakeEventId}/publicBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = bundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(`/api/events/${fakeEventId}/publicBundle`, bundleResponse.status(), requestId);

    // Non-existent events should return 404, not 403
    expect(bundleResponse.status()).toBe(404);

    const data = await bundleResponse.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('EVENT_NOT_FOUND');
  });

  test('AC6: assetState.js module includes guardRender function', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/web/shared/assetState.js`, {
      timeout: TIMEOUT,
    });

    expect(response.status()).toBe(200);

    const body = await response.text();

    // Verify E3-specific exports
    expect(body).toContain('guardRender');
    expect(body).toContain('createAssetStateError');
    expect(body).toContain('validateApiResponse');
    expect(body).toContain('ERROR_TYPE');
    expect(body).toContain('asset_not_renderable');
  });
});
