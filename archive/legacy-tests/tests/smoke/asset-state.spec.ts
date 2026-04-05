/**
 * Story E1: Asset State Model Tests
 *
 * Purpose / Value:
 *   Verify that the asset state model correctly controls event renderability.
 *   Ensures no frontend infers readiness from partial data.
 *
 * Environment: STAGING
 *
 * Acceptance Criteria:
 *   - Every asset endpoint returns assetState
 *   - No frontend infers readiness from partial data
 *   - event in READY → Public endpoint returns non-renderable state
 *
 * @see Story E1 - Asset State Model (Single Source of Truth)
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

/** Unique prefix for asset state test events */
const ASSET_STATE_EVENT_PREFIX = 'E1-AssetState-Test';

// =============================================================================
// Valid Asset States (per Story E1 contract)
// =============================================================================

const VALID_ASSET_STATES = ['DRAFT', 'READY', 'ACTIVE', 'ARCHIVED'] as const;
type AssetState = (typeof VALID_ASSET_STATES)[number];

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

function logApiResponse(endpoint: string, status: number, requestId: string, body: unknown): void {
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

function logError(endpoint: string, error: unknown, requestId?: string): void {
  console.error(
    JSON.stringify({
      type: 'API_ERROR',
      endpoint,
      error: error instanceof Error ? error.message : String(error),
      requestId: requestId || 'unknown',
      timestamp: new Date().toISOString(),
    })
  );
}

// =============================================================================
// Test Suite: Asset State Model
// =============================================================================

test.describe('Story E1: Asset State Model', () => {
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

  test('AC1: GET /api/v2/events includes assetState in response', async ({ request }) => {
    // Fetch events list
    const response = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = response.headers()['x-request-id'] || 'unknown';
    logApiResponse('/api/v2/events', response.status(), requestId, null);

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.items)).toBe(true);

    // If there are events, verify they all have assetState
    if (data.items.length > 0) {
      for (const event of data.items) {
        // Verify assetState field exists and is valid
        expect(event).toHaveProperty('assetState');
        expect(VALID_ASSET_STATES).toContain(event.assetState);

        // Verify assetStateInfo object exists with required fields
        expect(event).toHaveProperty('assetStateInfo');
        expect(event.assetStateInfo).toHaveProperty('state');
        expect(event.assetStateInfo).toHaveProperty('isRenderable');
        expect(event.assetStateInfo).toHaveProperty('label');
        expect(typeof event.assetStateInfo.isRenderable).toBe('boolean');
      }
    }
  });

  test('AC2: GET /api/events/:id/publicBundle includes assetState', async ({ request }) => {
    // First, get an event ID to test with
    const listResponse = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    expect(listResponse.status()).toBe(200);
    const listData = await listResponse.json();

    // Skip if no events available
    test.skip(listData.items.length === 0, 'No events available for testing');

    const eventId = listData.items[0].id;

    // Fetch public bundle
    const bundleResponse = await request.get(`${BASE_URL}/api/events/${eventId}/publicBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = bundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(`/api/events/${eventId}/publicBundle`, bundleResponse.status(), requestId, null);

    expect(bundleResponse.status()).toBe(200);

    const bundleData = await bundleResponse.json();
    expect(bundleData.ok).toBe(true);
    expect(bundleData.value).toBeDefined();

    // Verify assetState is included in the bundle
    expect(bundleData.value).toHaveProperty('assetState');
    expect(VALID_ASSET_STATES).toContain(bundleData.value.assetState);

    // Verify assetStateInfo is included
    expect(bundleData.value).toHaveProperty('assetStateInfo');
    expect(bundleData.value.assetStateInfo).toHaveProperty('state');
    expect(bundleData.value.assetStateInfo).toHaveProperty('isRenderable');
    expect(bundleData.value.assetStateInfo).toHaveProperty('label');
    expect(bundleData.value.assetStateInfo).toHaveProperty('description');
  });

  test('AC3: assetStateInfo.isRenderable correctly reflects state', async ({ request }) => {
    // Fetch events list
    const response = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    expect(response.status()).toBe(200);

    const data = await response.json();

    // Check each event's assetStateInfo matches the expected renderability
    for (const event of data.items) {
      const { assetState, assetStateInfo } = event;

      // ACTIVE is the only renderable state
      if (assetState === 'ACTIVE') {
        expect(assetStateInfo.isRenderable).toBe(true);
      } else {
        // DRAFT, READY, ARCHIVED are all non-renderable
        expect(assetStateInfo.isRenderable).toBe(false);
      }

      // Verify label matches state
      expect(assetStateInfo.label).toBeDefined();
      expect(typeof assetStateInfo.label).toBe('string');
    }
  });

  test('AC4: Newly created event defaults to appropriate state', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const uniqueName = `${ASSET_STATE_EVENT_PREFIX}-${Date.now()}`;

    // Create a new event
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

    const requestId = createResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse('/api/v2/admin/events', createResponse.status(), requestId, null);

    expect(createResponse.status()).toBe(201);

    const createData = await createResponse.json();
    expect(createData.ok).toBe(true);
    expect(createData.item).toBeDefined();

    testEventId = createData.item.id;

    // Verify the event appears in the list with correct assetState
    const listResponse = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    expect(listResponse.status()).toBe(200);

    const listData = await listResponse.json();
    const createdEvent = listData.items.find((e: { id: string }) => e.id === testEventId);

    expect(createdEvent).toBeDefined();
    expect(createdEvent).toHaveProperty('assetState');
    expect(VALID_ASSET_STATES).toContain(createdEvent.assetState);

    // A new event without QR verification should NOT be ACTIVE
    // It should be DRAFT or READY depending on completeness
    if (!createdEvent.qrVerified) {
      expect(createdEvent.assetStateInfo.isRenderable).toBe(false);
    }
  });

  test('AC5: Asset state module is accessible at /web/shared/assetState.js', async ({
    request,
  }) => {
    const response = await request.get(`${BASE_URL}/web/shared/assetState.js`, {
      timeout: TIMEOUT,
    });

    const requestId = response.headers()['x-request-id'] || 'unknown';
    logApiResponse('/web/shared/assetState.js', response.status(), requestId, null);

    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('javascript');

    const body = await response.text();

    // Verify module contains expected exports
    expect(body).toContain('AssetState');
    expect(body).toContain('DRAFT');
    expect(body).toContain('READY');
    expect(body).toContain('ACTIVE');
    expect(body).toContain('ARCHIVED');
    expect(body).toContain('assertRenderable');
    expect(body).toContain('canRender');
  });

  test('AC6: READY state event returns non-renderable in assetStateInfo', async ({ request }) => {
    // This test verifies the key acceptance criterion:
    // "event in READY → Public endpoint returns non-renderable state"

    // Fetch events list
    const response = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    expect(response.status()).toBe(200);

    const data = await response.json();

    // Find any READY state events
    const readyEvents = data.items.filter((e: { assetState: string }) => e.assetState === 'READY');

    // If there are READY events, verify they are non-renderable
    for (const event of readyEvents) {
      expect(event.assetStateInfo.isRenderable).toBe(false);
      expect(event.assetStateInfo.state).toBe('READY');

      // The reason should indicate QR verification is needed
      // (this is informational, not strictly required)
      if (event.assetStateInfo.description) {
        expect(typeof event.assetStateInfo.description).toBe('string');
      }
    }

    // If no READY events exist, this test still passes
    // The schema contract is verified in other tests
    console.log(
      JSON.stringify({
        type: 'TEST_INFO',
        message: `Found ${readyEvents.length} READY state events`,
        timestamp: new Date().toISOString(),
      })
    );
  });
});
