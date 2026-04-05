/**
 * Story E2: Verified-QR-Only Enforcement Tests
 *
 * Purpose / Value:
 *   Verify that only QR-verified events can be displayed on public surfaces.
 *   Ensures the QR verification workflow works correctly.
 *
 * Environment: STAGING
 *
 * Acceptance Criteria:
 *   - POST /api/v2/admin/events/:id/verify-qr marks event as verified
 *   - POST /api/v2/admin/events/:id/unverify-qr removes verification
 *   - Verified events have qrVerified=true and assetState=ACTIVE
 *   - Unverified events have assetState=READY or DRAFT
 *
 * @see Story E2 - Verified-QR-Only Enforcement
 */

import { test, expect } from '@playwright/test';

// =============================================================================
// Configuration
// =============================================================================

/** Base URL for staging environment */
const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';

/** Admin key for authorized requests (from CI secrets) */
const ADMIN_KEY =
  process.env.ADMIN_KEY || process.env.ADMIN_KEY_STG || process.env.ADMIN_TOKEN || '';

/** Cloudflare Access Service Token headers (Story D4) */
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

/** Brand used for test */
const BRAND = process.env.TEST_BRAND || 'root';

/** Timeout for API requests (staging cold start tolerance) */
const TIMEOUT = 30000;

/** Unique prefix for QR verification test events */
const QR_TEST_EVENT_PREFIX = 'E2-QRVerify-Test';

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
  console.log(
    JSON.stringify({
      type: 'API_RESPONSE',
      endpoint,
      status,
      requestId,
      timestamp: new Date().toISOString(),
    })
  );
}

// =============================================================================
// Test Suite: QR Verification
// =============================================================================

test.describe('Story E2: Verified-QR-Only Enforcement', () => {
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

  test('AC1: verify-qr endpoint requires authentication', async ({ request }) => {
    // Try to verify without auth
    const response = await request.post(`${BASE_URL}/api/v2/admin/events/test-event/verify-qr`, {
      headers: { 'Content-Type': 'application/json' },
      timeout: TIMEOUT,
    });

    const requestId = response.headers()['x-request-id'] || 'unknown';
    logApiResponse('/api/v2/admin/events/test-event/verify-qr', response.status(), requestId);

    // Should return 401 Unauthorized
    expect(response.status()).toBe(401);
  });

  test('AC2: verify-qr transitions event to ACTIVE state', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${QR_TEST_EVENT_PREFIX}-${Date.now()}`;

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

    // Step 2: Verify the event starts in non-ACTIVE state
    const listResponse1 = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const listData1 = await listResponse1.json();
    const event1 = listData1.items.find((e: { id: string }) => e.id === testEventId);

    expect(event1).toBeDefined();
    expect(event1.assetState).not.toBe('ACTIVE');
    expect(event1.assetStateInfo.isRenderable).toBe(false);

    // Step 3: Verify QR
    const verifyResponse = await request.post(
      `${BASE_URL}/api/v2/admin/events/${testEventId}/verify-qr`,
      {
        headers: getAuthHeaders(),
        timeout: TIMEOUT,
      }
    );

    const verifyRequestId = verifyResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(
      `/api/v2/admin/events/${testEventId}/verify-qr`,
      verifyResponse.status(),
      verifyRequestId
    );

    expect(verifyResponse.status()).toBe(200);

    const verifyData = await verifyResponse.json();
    expect(verifyData.ok).toBe(true);
    expect(verifyData.item.qrVerified).toBe(true);
    expect(verifyData.item.assetState).toBe('ACTIVE');
    expect(verifyData.item.verifiedAt).toBeDefined();

    // Step 4: Verify the event is now ACTIVE
    const listResponse2 = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const listData2 = await listResponse2.json();
    const event2 = listData2.items.find((e: { id: string }) => e.id === testEventId);

    expect(event2).toBeDefined();
    expect(event2.assetState).toBe('ACTIVE');
    expect(event2.assetStateInfo.isRenderable).toBe(true);
  });

  test('AC3: unverify-qr transitions event back to READY state', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${QR_TEST_EVENT_PREFIX}-unverify-${Date.now()}`;

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

    // Verify the event
    const verifyResponse = await request.post(
      `${BASE_URL}/api/v2/admin/events/${testEventId}/verify-qr`,
      {
        headers: getAuthHeaders(),
        timeout: TIMEOUT,
      }
    );
    expect(verifyResponse.status()).toBe(200);

    // Step 2: Unverify the event
    const unverifyResponse = await request.post(
      `${BASE_URL}/api/v2/admin/events/${testEventId}/unverify-qr`,
      {
        headers: getAuthHeaders(),
        timeout: TIMEOUT,
      }
    );

    const unverifyRequestId = unverifyResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(
      `/api/v2/admin/events/${testEventId}/unverify-qr`,
      unverifyResponse.status(),
      unverifyRequestId
    );

    expect(unverifyResponse.status()).toBe(200);

    const unverifyData = await unverifyResponse.json();
    expect(unverifyData.ok).toBe(true);
    expect(unverifyData.item.qrVerified).toBe(false);
    expect(unverifyData.item.assetState).toBe('READY');

    // Step 3: Verify the event is no longer ACTIVE
    const listResponse = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const listData = await listResponse.json();
    const event = listData.items.find((e: { id: string }) => e.id === testEventId);

    expect(event).toBeDefined();
    expect(event.assetState).toBe('READY');
    expect(event.assetStateInfo.isRenderable).toBe(false);
  });

  test('AC4: verify-qr is idempotent', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${QR_TEST_EVENT_PREFIX}-idempotent-${Date.now()}`;

    // Create an event
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

    // First verify
    const verify1Response = await request.post(
      `${BASE_URL}/api/v2/admin/events/${testEventId}/verify-qr`,
      {
        headers: getAuthHeaders(),
        timeout: TIMEOUT,
      }
    );
    expect(verify1Response.status()).toBe(200);

    const verify1Data = await verify1Response.json();
    const firstVerifiedAt = verify1Data.item.verifiedAt;

    // Second verify (should be idempotent)
    const verify2Response = await request.post(
      `${BASE_URL}/api/v2/admin/events/${testEventId}/verify-qr`,
      {
        headers: getAuthHeaders(),
        timeout: TIMEOUT,
      }
    );
    expect(verify2Response.status()).toBe(200);

    const verify2Data = await verify2Response.json();
    expect(verify2Data.ok).toBe(true);
    expect(verify2Data.item.qrVerified).toBe(true);
    expect(verify2Data.item.assetState).toBe('ACTIVE');

    // The verifiedAt should be the same (idempotent)
    expect(verify2Data.item.verifiedAt).toBe(firstVerifiedAt);
  });

  test('AC5: verify-qr returns 404 for non-existent event', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const fakeEventId = 'non-existent-event-12345';

    const response = await request.post(
      `${BASE_URL}/api/v2/admin/events/${fakeEventId}/verify-qr`,
      {
        headers: getAuthHeaders(),
        timeout: TIMEOUT,
      }
    );

    const requestId = response.headers()['x-request-id'] || 'unknown';
    logApiResponse(`/api/v2/admin/events/${fakeEventId}/verify-qr`, response.status(), requestId);

    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('EVENT_NOT_FOUND');
  });
});
