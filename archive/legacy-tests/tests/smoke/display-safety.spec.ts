/**
 * Story E4: Display Safety + Rotation Guard Tests
 *
 * Purpose / Value:
 *   Verify that display and poster surfaces enforce asset state checks.
 *   Only ACTIVE events can be rendered on display/poster surfaces.
 *
 * Environment: STAGING
 *
 * Acceptance Criteria:
 *   - Display bundle returns 403 for non-ACTIVE events
 *   - Poster bundle returns 403 for non-ACTIVE events
 *   - ACTIVE events return full bundles with rotation/layout config
 *   - Error responses include asset state information
 *
 * @see Story E4 - Display Safety + Rotation Guard
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

/** Unique prefix for E4 test events */
const E4_TEST_EVENT_PREFIX = 'E4-DisplaySafety-Test';

// =============================================================================
// Auth Helper
// =============================================================================

/**
 * Returns authorization headers based on available credentials.
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
// Test Suite: Display Safety + Rotation Guard
// =============================================================================

test.describe('Story E4: Display Safety + Rotation Guard', () => {
  let testEventId: string | null = null;

  test.afterEach(async ({ request }) => {
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

  // ===========================================================================
  // Display Bundle Tests
  // ===========================================================================

  test('AC1: displayBundle returns 403 ASSET_NOT_RENDERABLE for unverified event', async ({
    request,
  }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${E4_TEST_EVENT_PREFIX}-display-unverified-${Date.now()}`;

    // Create an unverified event (READY state)
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

    // Try to get display bundle
    const bundleResponse = await request.get(
      `${BASE_URL}/api/events/${testEventId}/displayBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    const requestId = bundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(`/api/events/${testEventId}/displayBundle`, bundleResponse.status(), requestId);

    // Should return 403
    expect(bundleResponse.status()).toBe(403);

    const data = await bundleResponse.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('ASSET_NOT_RENDERABLE');
    expect(data.assetState).toBeDefined();
    expect(data.assetStateInfo).toBeDefined();
    expect(data.assetStateInfo.isRenderable).toBe(false);
  });

  test('AC2: displayBundle returns 200 with rotation config for verified event', async ({
    request,
  }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${E4_TEST_EVENT_PREFIX}-display-verified-${Date.now()}`;

    // Create and verify an event
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

    // Get display bundle
    const bundleResponse = await request.get(
      `${BASE_URL}/api/events/${testEventId}/displayBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    const requestId = bundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(`/api/events/${testEventId}/displayBundle`, bundleResponse.status(), requestId);

    // Should return 200
    expect(bundleResponse.status()).toBe(200);

    const data = await bundleResponse.json();
    expect(data.ok).toBe(true);
    expect(data.etag).toBeDefined();
    expect(data.value).toBeDefined();
    expect(data.value.event).toBeDefined();
    expect(data.value.assetState).toBe('ACTIVE');
    expect(data.value.assetStateInfo.isRenderable).toBe(true);

    // Should include display-specific config
    expect(data.value.displayRotation).toBeDefined();
    expect(data.value.displayRotation.enabled).toBeDefined();
    expect(data.value.displayRotation.defaultDwellMs).toBeGreaterThan(0);
    expect(Array.isArray(data.value.displayRotation.panes)).toBe(true);
    expect(data.value.surface).toBe('display');
  });

  // ===========================================================================
  // Poster Bundle Tests
  // ===========================================================================

  test('AC3: posterBundle returns 403 ASSET_NOT_RENDERABLE for unverified event', async ({
    request,
  }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${E4_TEST_EVENT_PREFIX}-poster-unverified-${Date.now()}`;

    // Create an unverified event
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

    // Try to get poster bundle
    const bundleResponse = await request.get(`${BASE_URL}/api/events/${testEventId}/posterBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = bundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(`/api/events/${testEventId}/posterBundle`, bundleResponse.status(), requestId);

    // Should return 403
    expect(bundleResponse.status()).toBe(403);

    const data = await bundleResponse.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('ASSET_NOT_RENDERABLE');
    expect(data.assetState).toBeDefined();
    expect(data.assetStateInfo.isRenderable).toBe(false);
  });

  test('AC4: posterBundle returns 200 with layout config for verified event', async ({
    request,
  }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${E4_TEST_EVENT_PREFIX}-poster-verified-${Date.now()}`;

    // Create and verify an event
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

    // Get poster bundle
    const bundleResponse = await request.get(`${BASE_URL}/api/events/${testEventId}/posterBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = bundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(`/api/events/${testEventId}/posterBundle`, bundleResponse.status(), requestId);

    // Should return 200
    expect(bundleResponse.status()).toBe(200);

    const data = await bundleResponse.json();
    expect(data.ok).toBe(true);
    expect(data.etag).toBeDefined();
    expect(data.value).toBeDefined();
    expect(data.value.event).toBeDefined();
    expect(data.value.assetState).toBe('ACTIVE');

    // Should include poster-specific config
    expect(data.value.posterLayout).toBeDefined();
    expect(data.value.posterLayout.orientation).toMatch(/portrait|landscape/);
    expect(typeof data.value.posterLayout.showQR).toBe('boolean');
    expect(typeof data.value.posterLayout.showSponsors).toBe('boolean');
    expect(data.value.surface).toBe('poster');
  });

  // ===========================================================================
  // Archived Event Tests
  // ===========================================================================

  test('AC5: displayBundle returns 403 for archived event', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${E4_TEST_EVENT_PREFIX}-display-archived-${Date.now()}`;

    // Create and verify an event
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

    // Verify then archive
    await request.post(`${BASE_URL}/api/v2/admin/events/${testEventId}/verify-qr`, {
      headers: getAuthHeaders(),
      timeout: TIMEOUT,
    });

    await request.post(`${BASE_URL}/api/v2/admin/events/${testEventId}/archive`, {
      headers: getAuthHeaders(),
      timeout: TIMEOUT,
    });

    // Try to get display bundle
    const bundleResponse = await request.get(
      `${BASE_URL}/api/events/${testEventId}/displayBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    expect(bundleResponse.status()).toBe(403);

    const data = await bundleResponse.json();
    expect(data.code).toBe('ASSET_NOT_RENDERABLE');
    expect(data.assetState).toBe('ARCHIVED');

    // Clear testEventId since it's already archived
    testEventId = null;
  });

  // ===========================================================================
  // Non-existent Event Tests
  // ===========================================================================

  test('AC6: displayBundle returns 404 for non-existent event', async ({ request }) => {
    const fakeEventId = 'non-existent-event-e4-display-12345';

    const bundleResponse = await request.get(
      `${BASE_URL}/api/events/${fakeEventId}/displayBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    expect(bundleResponse.status()).toBe(404);

    const data = await bundleResponse.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('EVENT_NOT_FOUND');
  });

  test('AC7: posterBundle returns 404 for non-existent event', async ({ request }) => {
    const fakeEventId = 'non-existent-event-e4-poster-12345';

    const bundleResponse = await request.get(`${BASE_URL}/api/events/${fakeEventId}/posterBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    expect(bundleResponse.status()).toBe(404);

    const data = await bundleResponse.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('EVENT_NOT_FOUND');
  });
});
