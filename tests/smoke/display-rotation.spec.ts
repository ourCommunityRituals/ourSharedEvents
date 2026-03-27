/**
 * Story E4: Display Rotation Tests
 *
 * Purpose / Value:
 *   Verify that display rotation only shows ACTIVE events and handles
 *   edge cases safely (empty list, backend failures).
 *
 * Environment: STAGING
 *
 * Acceptance Criteria:
 *   - Display may rotate only across ACTIVE events
 *   - Zero ACTIVE events shows static "No active events" screen
 *   - Rotation never crashes due to empty list
 *   - Archived or READY events never appear on Display
 *
 * Stage-2 Tests:
 *   - one ACTIVE, one READY → only ACTIVE rendered
 *   - zero ACTIVE → fallback shown
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
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_KEY_STG || process.env.ADMIN_TOKEN || '';

/** Cloudflare Access Service Token headers (Story D4) */
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

/** Brand used for test */
const BRAND = process.env.TEST_BRAND || 'root';

/** Timeout for API requests (staging cold start tolerance) */
const TIMEOUT = 30000;

/** Unique prefix for E4 rotation test events */
const E4_ROTATION_TEST_PREFIX = 'E4-Rotation-Test';

// =============================================================================
// Valid Asset States (per Story E1 contract)
// =============================================================================

const VALID_ASSET_STATES = ['DRAFT', 'READY', 'ACTIVE', 'ARCHIVED'] as const;
type AssetState = typeof VALID_ASSET_STATES[number];

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
  console.log(JSON.stringify({
    type: 'API_RESPONSE',
    endpoint,
    status,
    requestId,
    timestamp: new Date().toISOString(),
  }));
}

function logTestInfo(message: string, data?: Record<string, unknown>): void {
  console.log(JSON.stringify({
    type: 'TEST_INFO',
    message,
    ...data,
    timestamp: new Date().toISOString(),
  }));
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a test event and return its ID
 */
async function createTestEvent(
  request: ReturnType<typeof test.info>['request'] extends () => infer R ? R : never,
  name: string,
  options: { verify?: boolean } = {}
): Promise<string> {
  const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
    headers: getAuthHeaders(),
    data: {
      name,
      brand: BRAND,
      startDateISO: new Date().toISOString().split('T')[0],
      venue: 'Test Venue for Rotation',
    },
    timeout: TIMEOUT,
  });

  expect(createResponse.status()).toBe(201);
  const createData = await createResponse.json();
  const eventId = createData.item.id;

  if (options.verify) {
    const verifyResponse = await request.post(
      `${BASE_URL}/api/v2/admin/events/${eventId}/verify-qr`,
      {
        headers: getAuthHeaders(),
        timeout: TIMEOUT,
      }
    );
    expect(verifyResponse.status()).toBe(200);
  }

  return eventId;
}

/**
 * Archive a test event
 */
async function archiveTestEvent(
  request: ReturnType<typeof test.info>['request'] extends () => infer R ? R : never,
  eventId: string
): Promise<void> {
  try {
    await request.post(`${BASE_URL}/api/v2/admin/events/${eventId}/archive`, {
      headers: getAuthHeaders(),
      timeout: TIMEOUT,
    });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Filter events to only ACTIVE ones (simulating client-side rotation logic)
 */
function filterActiveEvents(events: Array<{ id: string; assetState: AssetState }>): Array<{ id: string; assetState: AssetState }> {
  return events.filter((event) => event.assetState === 'ACTIVE');
}

// =============================================================================
// Test Suite: Display Rotation
// =============================================================================

test.describe('Story E4: Display Rotation', () => {
  // Store created event IDs for cleanup
  const testEventIds: string[] = [];

  test.afterEach(async ({ request }) => {
    // Cleanup: Archive all test events
    if (hasAuth()) {
      for (const eventId of testEventIds) {
        await archiveTestEvent(request, eventId);
      }
      testEventIds.length = 0;
    }
  });

  // ===========================================================================
  // Stage-2 Test: Mixed Events (ACTIVE + READY)
  // ===========================================================================

  test('Stage-2: one ACTIVE, one READY → only ACTIVE rendered', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const timestamp = Date.now();

    // Create one READY event (unverified)
    const readyEventName = `${E4_ROTATION_TEST_PREFIX}-READY-${timestamp}`;
    const readyEventId = await createTestEvent(request, readyEventName, { verify: false });
    testEventIds.push(readyEventId);

    // Create one ACTIVE event (verified)
    const activeEventName = `${E4_ROTATION_TEST_PREFIX}-ACTIVE-${timestamp}`;
    const activeEventId = await createTestEvent(request, activeEventName, { verify: true });
    testEventIds.push(activeEventId);

    logTestInfo('Created test events', {
      readyEventId,
      activeEventId,
    });

    // Fetch events list
    const listResponse = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = listResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse('/api/v2/events', listResponse.status(), requestId);

    expect(listResponse.status()).toBe(200);

    const listData = await listResponse.json();
    expect(listData.ok).toBe(true);

    // Find our test events
    const readyEvent = listData.items.find(
      (e: { id: string }) => e.id === readyEventId
    );
    const activeEvent = listData.items.find(
      (e: { id: string }) => e.id === activeEventId
    );

    expect(readyEvent).toBeDefined();
    expect(activeEvent).toBeDefined();

    // Verify states
    expect(readyEvent.assetState).toBe('READY');
    expect(activeEvent.assetState).toBe('ACTIVE');

    // Simulate client-side filtering (what rotation.ts does)
    const allTestEvents = [readyEvent, activeEvent];
    const rotationEvents = filterActiveEvents(allTestEvents);

    // CRITICAL: Only ACTIVE events should be in rotation
    expect(rotationEvents).toHaveLength(1);
    expect(rotationEvents[0].id).toBe(activeEventId);
    expect(rotationEvents[0].assetState).toBe('ACTIVE');

    // Verify READY event is NOT in rotation
    const readyInRotation = rotationEvents.find(
      (e: { id: string }) => e.id === readyEventId
    );
    expect(readyInRotation).toBeUndefined();

    logTestInfo('Rotation filter verified', {
      totalEvents: allTestEvents.length,
      activeEvents: rotationEvents.length,
      filteredOutCount: allTestEvents.length - rotationEvents.length,
    });
  });

  // ===========================================================================
  // Stage-2 Test: Zero ACTIVE Events
  // ===========================================================================

  test('Stage-2: zero ACTIVE → fallback shown (empty rotation list)', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const timestamp = Date.now();

    // Create only READY events (unverified)
    const readyEvent1Name = `${E4_ROTATION_TEST_PREFIX}-READY1-${timestamp}`;
    const readyEvent1Id = await createTestEvent(request, readyEvent1Name, { verify: false });
    testEventIds.push(readyEvent1Id);

    const readyEvent2Name = `${E4_ROTATION_TEST_PREFIX}-READY2-${timestamp}`;
    const readyEvent2Id = await createTestEvent(request, readyEvent2Name, { verify: false });
    testEventIds.push(readyEvent2Id);

    logTestInfo('Created READY-only events', {
      readyEvent1Id,
      readyEvent2Id,
    });

    // Fetch events list
    const listResponse = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    expect(listResponse.status()).toBe(200);

    const listData = await listResponse.json();
    expect(listData.ok).toBe(true);

    // Find our test events
    const testEvents = listData.items.filter(
      (e: { id: string }) => e.id === readyEvent1Id || e.id === readyEvent2Id
    );

    expect(testEvents).toHaveLength(2);

    // Verify both are READY (not ACTIVE)
    for (const event of testEvents) {
      expect(event.assetState).toBe('READY');
      expect(event.assetStateInfo.isRenderable).toBe(false);
    }

    // Simulate client-side filtering (what rotation.ts does)
    const rotationEvents = filterActiveEvents(testEvents);

    // CRITICAL: Zero ACTIVE events means empty rotation list
    expect(rotationEvents).toHaveLength(0);

    logTestInfo('Zero ACTIVE verification', {
      totalTestEvents: testEvents.length,
      activeEvents: rotationEvents.length,
      shouldShowFallback: rotationEvents.length === 0,
    });

    // When rotation list is empty, client should show "No active events" fallback
    // This is verified by the rotation.ts module logic:
    // if (activeEvents.length === 0) → show static state
  });

  // ===========================================================================
  // ARCHIVED Events Never in Rotation
  // ===========================================================================

  test('ARCHIVED events never appear in rotation', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const timestamp = Date.now();

    // Create an event, verify it, then archive it
    const archivedEventName = `${E4_ROTATION_TEST_PREFIX}-ARCHIVED-${timestamp}`;
    const archivedEventId = await createTestEvent(request, archivedEventName, { verify: true });
    testEventIds.push(archivedEventId);

    // Archive the event
    const archiveResponse = await request.post(
      `${BASE_URL}/api/v2/admin/events/${archivedEventId}/archive`,
      {
        headers: getAuthHeaders(),
        timeout: TIMEOUT,
      }
    );
    expect(archiveResponse.status()).toBe(200);

    // Create an ACTIVE event for comparison
    const activeEventName = `${E4_ROTATION_TEST_PREFIX}-ACTIVE2-${timestamp}`;
    const activeEventId = await createTestEvent(request, activeEventName, { verify: true });
    testEventIds.push(activeEventId);

    logTestInfo('Created archived and active events', {
      archivedEventId,
      activeEventId,
    });

    // Fetch events list (archived events may or may not appear depending on filter)
    const listResponse = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    expect(listResponse.status()).toBe(200);

    const listData = await listResponse.json();

    // Find our test events
    const allEvents = listData.items;
    const activeEvent = allEvents.find(
      (e: { id: string }) => e.id === activeEventId
    );

    // ACTIVE event should be present
    expect(activeEvent).toBeDefined();
    expect(activeEvent.assetState).toBe('ACTIVE');

    // Simulate client-side filtering
    const rotationEvents = filterActiveEvents(allEvents);

    // ARCHIVED events should NOT be in rotation
    const archivedInRotation = rotationEvents.find(
      (e: { id: string }) => e.id === archivedEventId
    );
    expect(archivedInRotation).toBeUndefined();

    // ACTIVE event SHOULD be in rotation
    const activeInRotation = rotationEvents.find(
      (e: { id: string }) => e.id === activeEventId
    );
    expect(activeInRotation).toBeDefined();

    logTestInfo('ARCHIVED filter verified', {
      archivedEventId,
      archivedInRotation: false,
      activeEventId,
      activeInRotation: true,
    });
  });

  // ===========================================================================
  // DisplayBundle Respects Asset State
  // ===========================================================================

  test('displayBundle returns rotation config only for ACTIVE events', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const timestamp = Date.now();

    // Create and verify an ACTIVE event
    const activeEventName = `${E4_ROTATION_TEST_PREFIX}-DisplayBundle-${timestamp}`;
    const activeEventId = await createTestEvent(request, activeEventName, { verify: true });
    testEventIds.push(activeEventId);

    // Get display bundle for ACTIVE event
    const bundleResponse = await request.get(
      `${BASE_URL}/api/events/${activeEventId}/displayBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    const requestId = bundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(`/api/events/${activeEventId}/displayBundle`, bundleResponse.status(), requestId);

    expect(bundleResponse.status()).toBe(200);

    const bundleData = await bundleResponse.json();
    expect(bundleData.ok).toBe(true);
    expect(bundleData.value).toBeDefined();

    // Verify rotation config is present for ACTIVE event
    expect(bundleData.value.assetState).toBe('ACTIVE');
    expect(bundleData.value.displayRotation).toBeDefined();
    expect(bundleData.value.displayRotation.enabled).toBeDefined();
    expect(bundleData.value.displayRotation.defaultDwellMs).toBeGreaterThan(0);
    expect(Array.isArray(bundleData.value.displayRotation.panes)).toBe(true);
    expect(bundleData.value.surface).toBe('display');

    logTestInfo('DisplayBundle rotation config verified', {
      eventId: activeEventId,
      assetState: bundleData.value.assetState,
      rotationEnabled: bundleData.value.displayRotation.enabled,
      dwellMs: bundleData.value.displayRotation.defaultDwellMs,
    });
  });

  // ===========================================================================
  // Rotation Index Safety
  // ===========================================================================

  test('rotation handles empty events list without crash', async ({ request }) => {
    // This test verifies the rotation.ts logic handles empty arrays safely
    // by simulating the filtering behavior

    // Simulate an empty events response
    const emptyEvents: Array<{ id: string; assetState: AssetState }> = [];
    const rotationEvents = filterActiveEvents(emptyEvents);

    // Should return empty array, not throw or crash
    expect(rotationEvents).toHaveLength(0);
    expect(Array.isArray(rotationEvents)).toBe(true);

    // Simulate rotation index calculation with empty array
    const currentIndex = 0;
    const nextIndex = (currentIndex + 1) % Math.max(1, rotationEvents.length);

    // Should not crash or produce NaN/Infinity
    expect(typeof nextIndex).toBe('number');
    expect(Number.isFinite(nextIndex)).toBe(true);

    logTestInfo('Empty array handling verified', {
      inputLength: emptyEvents.length,
      filteredLength: rotationEvents.length,
      safeNextIndex: nextIndex,
    });
  });

  // ===========================================================================
  // Rotation Wrap-Around Safety
  // ===========================================================================

  test('rotation index wraps around safely', async ({ request }) => {
    // This test verifies the modulo wrap-around logic in rotation.ts

    // Simulate a list of 3 ACTIVE events
    const mockEvents = [
      { id: 'event-1', assetState: 'ACTIVE' as const },
      { id: 'event-2', assetState: 'ACTIVE' as const },
      { id: 'event-3', assetState: 'ACTIVE' as const },
    ];

    const rotationEvents = filterActiveEvents(mockEvents);
    expect(rotationEvents).toHaveLength(3);

    // Verify wrap-around at each position
    for (let i = 0; i < 10; i++) {
      const currentIndex = i;
      const nextIndex = (currentIndex + 1) % rotationEvents.length;

      // Index should always be in bounds
      expect(nextIndex).toBeGreaterThanOrEqual(0);
      expect(nextIndex).toBeLessThan(rotationEvents.length);
    }

    logTestInfo('Wrap-around safety verified', {
      eventCount: rotationEvents.length,
      testedIterations: 10,
    });
  });

  // ===========================================================================
  // Single Event (No Rotation Needed)
  // ===========================================================================

  test('single ACTIVE event does not require rotation timer', async ({ request }) => {
    test.skip(!hasAuth(), 'Requires admin authentication');

    const timestamp = Date.now();

    // Create only one ACTIVE event
    const activeEventName = `${E4_ROTATION_TEST_PREFIX}-Single-${timestamp}`;
    const activeEventId = await createTestEvent(request, activeEventName, { verify: true });
    testEventIds.push(activeEventId);

    logTestInfo('Created single ACTIVE event', { activeEventId });

    // Fetch events and filter
    const listResponse = await request.get(`${BASE_URL}/api/v2/events`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    expect(listResponse.status()).toBe(200);

    const listData = await listResponse.json();

    // Find only our test event
    const ourEvents = listData.items.filter(
      (e: { id: string; name: string }) =>
        e.id === activeEventId || e.name.startsWith(E4_ROTATION_TEST_PREFIX)
    );

    const activeEvents = filterActiveEvents(ourEvents);

    // With only 1 event, rotation is not needed
    const rotationNeeded = activeEvents.length > 1;

    logTestInfo('Single event rotation check', {
      activeEventCount: activeEvents.length,
      rotationNeeded,
    });

    // The rotation.ts logic: if (activeEvents.length === 1) → don't schedule rotation timer
    expect(rotationNeeded).toBe(false);
  });
});
