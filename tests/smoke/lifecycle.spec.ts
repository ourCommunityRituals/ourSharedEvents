/**
 * Story D5: Stage-2 Lifecycle Smoke Pack (Hard Gate)
 *
 * Purpose / Value:
 *   Every staging deploy proves the complete event lifecycle works end-to-end.
 *   This is a HARD GATE - if any step fails, the deploy FAILS.
 *
 * Environment: STAGING
 *
 * Required Smoke Flow (IN ORDER):
 *   1. Health check
 *   2. Create event
 *   3. Update event
 *   4. Set default
 *   5. Archive
 *   6. Verify hidden (archived event NOT in list)
 *   7. Unarchive
 *   8. Verify visible (event back in list)
 *
 * CI Gate Rule:
 *   If any step fails -> deploy FAILS
 *
 * Logging Requirements (per Story D5):
 *   - endpoint: Always logged
 *   - status: HTTP status code
 *   - error code: Error code from response body
 *   - requestId: X-Request-Id header
 *
 * Acceptance Criteria:
 *   - Stage-2 blocks broken lifecycle changes
 *   - CI logs show: endpoint, status, error code, requestId
 *
 * @see Story D5 - Stage-2 Lifecycle Smoke Pack (Hard Gate)
 */

import { test, expect } from '@playwright/test';

// =============================================================================
// Configuration
// =============================================================================

/** Base URL for staging environment */
const BASE_URL = process.env.BASE_URL || 'https://stg.eventangle.com';

/** Admin key for authorized requests (from CI secrets) */
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_KEY_STG || process.env.ADMIN_TOKEN || '';

/** Cloudflare Access Service Token headers (Story D4) */
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

/** Brand used for lifecycle test */
const BRAND = process.env.TEST_BRAND || 'root';

/** Timeout for API requests (staging cold start tolerance) */
const TIMEOUT = 30000;

/** Max length for error response logging */
const MAX_ERROR_LOG_LENGTH = 500;

/** Unique prefix for lifecycle test events */
const LIFECYCLE_EVENT_PREFIX = 'D5-Lifecycle-Gate';

// =============================================================================
// Auth Helper (Story D4: Cloudflare Access Service Token)
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
// Logging Helpers (Story D5 Requirements)
// =============================================================================

/**
 * Logs environment configuration at test start
 */
function logEnvironment(): void {
  console.log('============================================');
  console.log('Story D5: Lifecycle Smoke Pack (Hard Gate)');
  console.log('============================================');
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`Auth Method: ${CF_ACCESS_CLIENT_ID ? 'Cloudflare Access' : ADMIN_KEY ? 'Admin Key' : 'NOT CONFIGURED'}`);
  console.log(`BRAND: ${BRAND}`);
  console.log('============================================');
  console.log('');
  console.log('Required Flow (IN ORDER):');
  console.log('  1. Health check');
  console.log('  2. Create event');
  console.log('  3. Update event');
  console.log('  4. Set default');
  console.log('  5. Archive');
  console.log('  6. Verify hidden');
  console.log('  7. Unarchive');
  console.log('  8. Verify visible');
  console.log('');
  console.log('CI Gate Rule: If ANY step fails -> deploy FAILS');
  console.log('============================================');
}

/**
 * Logs step execution with endpoint info (Story D5 requirement)
 */
function logStep(stepNum: number, endpoint: string, method: string): void {
  console.log('');
  console.log(`[Step ${stepNum}] ${method} ${endpoint}`);
}

/**
 * Logs response details: endpoint, status, error code, requestId (Story D5 AC)
 */
function logResponse(
  endpoint: string,
  status: number,
  headers: { [key: string]: string },
  json: unknown,
  isFailure: boolean = false
): void {
  const requestId = headers['x-request-id'] || headers['X-Request-Id'] || 'N/A';

  if (isFailure) {
    console.log('============================================');
    console.log('FAILURE DETAILS (Story D5 CI Log Requirements)');
    console.log('============================================');
  }

  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Status: ${status}`);
  console.log(`  RequestId: ${requestId}`);

  // Extract error code if present
  if (json && typeof json === 'object' && 'code' in json) {
    console.log(`  Error Code: ${(json as { code: string }).code}`);
  }

  if (isFailure) {
    // Log response body on failure (trimmed)
    try {
      const jsonString = JSON.stringify(json, null, 2);
      const trimmed = jsonString.length > MAX_ERROR_LOG_LENGTH
        ? jsonString.substring(0, MAX_ERROR_LOG_LENGTH) + '... [trimmed]'
        : jsonString;
      console.log(`  Response Body:`);
      console.log(trimmed);
    } catch {
      console.log(`  Response Body: [unable to serialize]`);
    }
    console.log('============================================');
  }
}

/**
 * Logs step success
 */
function logSuccess(stepNum: number, message: string): void {
  console.log(`[Step ${stepNum}] SUCCESS: ${message}`);
}

// =============================================================================
// Test Suite
// =============================================================================

test.describe('Story D5: Lifecycle Smoke Pack (Hard Gate)', () => {
  // Log environment at the start of the test suite
  test.beforeAll(() => {
    logEnvironment();
  });

  /**
   * FAIL FAST: Auth must be configured
   */
  test('fails fast if auth is not configured', async () => {
    if (!hasAuth()) {
      console.log('============================================');
      console.log('FAIL FAST: No authentication configured');
      console.log('============================================');
      console.log('Required: CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET');
      console.log('      OR: ADMIN_KEY / ADMIN_KEY_STG / ADMIN_TOKEN');
      console.log('============================================');
    }

    expect(
      hasAuth(),
      'Authentication must be configured (CF Access or Admin Key)'
    ).toBe(true);
  });

  /**
   * MAIN LIFECYCLE TEST: All 8 steps IN ORDER (Hard Gate)
   *
   * Story D5 Flow:
   *   1. Health check
   *   2. Create event
   *   3. Update event
   *   4. Set default
   *   5. Archive
   *   6. Verify hidden
   *   7. Unarchive
   *   8. Verify visible
   *
   * CI Gate Rule: If ANY step fails -> deploy FAILS
   */
  test('complete lifecycle flow (hard gate)', async ({ request }) => {
    // Skip if auth not configured
    test.skip(!hasAuth(), 'Auth not configured');

    const timestamp = Date.now();
    const eventName = `${LIFECYCLE_EVENT_PREFIX}-${timestamp}`;
    const updatedEventName = `${LIFECYCLE_EVENT_PREFIX}-UPDATED-${timestamp}`;
    const uniqueSlug = `d5-lifecycle-${timestamp}`;

    const authHeaders = getAuthHeaders();

    // =========================================================================
    // Step 1: Health Check
    // =========================================================================
    const healthEndpoint = `${BASE_URL}/api/health/backend`;
    logStep(1, healthEndpoint, 'GET');

    const healthResponse = await request.get(healthEndpoint, {
      timeout: TIMEOUT,
    });

    const healthStatus = healthResponse.status();
    const healthHeaders = healthResponse.headers();
    let healthJson: unknown;

    try {
      healthJson = await healthResponse.json();
    } catch {
      healthJson = { error: 'Failed to parse response JSON' };
    }

    logResponse(healthEndpoint, healthStatus, healthHeaders, healthJson, healthStatus !== 200);

    expect(healthStatus, `Health check should return 200, got ${healthStatus}`).toBe(200);

    const healthBody = healthJson as { ok: boolean };
    expect(healthBody.ok, 'Health response should have ok=true').toBe(true);

    logSuccess(1, 'Health check passed (.ok == true)');

    // =========================================================================
    // Step 2: Create Event
    // =========================================================================
    const createEndpoint = `${BASE_URL}/api/v2/admin/events`;
    logStep(2, createEndpoint, 'POST');

    const createResponse = await request.post(createEndpoint, {
      timeout: TIMEOUT,
      data: {
        name: eventName,
        brand: BRAND,
        slug: uniqueSlug,
        startDateISO: '2025-12-01',
      },
      headers: authHeaders,
    });

    const createStatus = createResponse.status();
    const createHeaders = createResponse.headers();
    let createJson: unknown;

    try {
      createJson = await createResponse.json();
    } catch {
      createJson = { error: 'Failed to parse response JSON' };
    }

    logResponse(createEndpoint, createStatus, createHeaders, createJson, createStatus !== 201);

    expect(createStatus, `Create event should return 201, got ${createStatus}`).toBe(201);

    const createBody = createJson as { ok: boolean; item: { id: string; name: string }; requestId: string };
    expect(createBody.ok, 'Create response should have ok=true').toBe(true);
    expect(createBody.item, 'Create response should have item').toBeDefined();
    expect(createBody.requestId, 'Create response should have requestId').toBeDefined();

    const eventId = createBody.item.id;
    logSuccess(2, `Event created with id=${eventId}`);

    // =========================================================================
    // Step 3: Update Event
    // =========================================================================
    const updateEndpoint = `${BASE_URL}/api/v2/admin/events/${eventId}`;
    logStep(3, updateEndpoint, 'PUT');

    const updateResponse = await request.put(updateEndpoint, {
      timeout: TIMEOUT,
      data: {
        name: updatedEventName,
      },
      headers: authHeaders,
    });

    const updateStatus = updateResponse.status();
    const updateHeaders = updateResponse.headers();
    let updateJson: unknown;

    try {
      updateJson = await updateResponse.json();
    } catch {
      updateJson = { error: 'Failed to parse response JSON' };
    }

    logResponse(updateEndpoint, updateStatus, updateHeaders, updateJson, updateStatus !== 200);

    expect(updateStatus, `Update event should return 200, got ${updateStatus}`).toBe(200);

    const updateBody = updateJson as { ok: boolean; item: { id: string; name: string }; requestId: string };
    expect(updateBody.ok, 'Update response should have ok=true').toBe(true);
    expect(updateBody.item.name, 'Updated name should match').toBe(updatedEventName);
    expect(updateBody.requestId, 'Update response should have requestId').toBeDefined();

    logSuccess(3, `Event name updated to "${updatedEventName}"`);

    // =========================================================================
    // Step 4: Set Default
    // =========================================================================
    const defaultEndpoint = `${BASE_URL}/api/v2/admin/events/${eventId}/default`;
    logStep(4, defaultEndpoint, 'POST');

    const defaultResponse = await request.post(defaultEndpoint, {
      timeout: TIMEOUT,
      headers: authHeaders,
    });

    const defaultStatus = defaultResponse.status();
    const defaultHeaders = defaultResponse.headers();
    let defaultJson: unknown;

    try {
      defaultJson = await defaultResponse.json();
    } catch {
      defaultJson = { error: 'Failed to parse response JSON' };
    }

    logResponse(defaultEndpoint, defaultStatus, defaultHeaders, defaultJson, defaultStatus !== 200);

    expect(defaultStatus, `Set default should return 200, got ${defaultStatus}`).toBe(200);

    const defaultBody = defaultJson as { ok: boolean; item: { id: string; isDefault: boolean }; requestId: string };
    expect(defaultBody.ok, 'Default response should have ok=true').toBe(true);
    expect(defaultBody.item.isDefault, 'Event should be isDefault=true').toBe(true);
    expect(defaultBody.requestId, 'Default response should have requestId').toBeDefined();

    logSuccess(4, `Event ${eventId} set as default`);

    // =========================================================================
    // Step 5: Archive
    // =========================================================================
    const archiveEndpoint = `${BASE_URL}/api/v2/admin/events/${eventId}/archive`;
    logStep(5, archiveEndpoint, 'POST');

    const archiveResponse = await request.post(archiveEndpoint, {
      timeout: TIMEOUT,
      headers: authHeaders,
    });

    const archiveStatus = archiveResponse.status();
    const archiveHeaders = archiveResponse.headers();
    let archiveJson: unknown;

    try {
      archiveJson = await archiveResponse.json();
    } catch {
      archiveJson = { error: 'Failed to parse response JSON' };
    }

    logResponse(archiveEndpoint, archiveStatus, archiveHeaders, archiveJson, archiveStatus !== 200);

    expect(archiveStatus, `Archive event should return 200, got ${archiveStatus}`).toBe(200);

    const archiveBody = archiveJson as { ok: boolean; item: { id: string; status: string }; requestId: string };
    expect(archiveBody.ok, 'Archive response should have ok=true').toBe(true);
    expect(archiveBody.item.status, 'Archive response should have status=archived').toBe('archived');
    expect(archiveBody.requestId, 'Archive response should have requestId').toBeDefined();

    logSuccess(5, `Event ${eventId} archived`);

    // =========================================================================
    // Step 6: Verify Hidden (archived event NOT in list)
    // =========================================================================
    const listHiddenEndpoint = `${BASE_URL}/api/v2/events?brand=${BRAND}`;
    logStep(6, listHiddenEndpoint, 'GET');

    const listHiddenResponse = await request.get(listHiddenEndpoint, {
      timeout: TIMEOUT,
    });

    const listHiddenStatus = listHiddenResponse.status();
    const listHiddenHeaders = listHiddenResponse.headers();
    let listHiddenJson: unknown;

    try {
      listHiddenJson = await listHiddenResponse.json();
    } catch {
      listHiddenJson = { error: 'Failed to parse response JSON' };
    }

    logResponse(listHiddenEndpoint, listHiddenStatus, listHiddenHeaders, listHiddenJson, listHiddenStatus !== 200);

    expect(listHiddenStatus, `List events should return 200, got ${listHiddenStatus}`).toBe(200);

    const listHiddenBody = listHiddenJson as { ok: boolean; items: Array<{ id: string }> };
    expect(listHiddenBody.ok, 'List response should have ok=true').toBe(true);

    const hiddenEventInList = listHiddenBody.items.find(item => item.id === eventId);

    if (hiddenEventInList) {
      console.log('============================================');
      console.log('FAILURE: Archived event should NOT appear in list');
      console.log('============================================');
      console.log(`  Endpoint: ${listHiddenEndpoint}`);
      console.log(`  Event ID: ${eventId}`);
      console.log(`  Total events in list: ${listHiddenBody.items.length}`);
      console.log('============================================');
    }

    expect(hiddenEventInList, 'Archived event should NOT appear in public list').toBeUndefined();

    logSuccess(6, 'Archived event verified as hidden from list');

    // =========================================================================
    // Step 7: Unarchive
    // =========================================================================
    const unarchiveEndpoint = `${BASE_URL}/api/v2/admin/events/${eventId}/unarchive`;
    logStep(7, unarchiveEndpoint, 'POST');

    const unarchiveResponse = await request.post(unarchiveEndpoint, {
      timeout: TIMEOUT,
      headers: authHeaders,
    });

    const unarchiveStatus = unarchiveResponse.status();
    const unarchiveHeaders = unarchiveResponse.headers();
    let unarchiveJson: unknown;

    try {
      unarchiveJson = await unarchiveResponse.json();
    } catch {
      unarchiveJson = { error: 'Failed to parse response JSON' };
    }

    logResponse(unarchiveEndpoint, unarchiveStatus, unarchiveHeaders, unarchiveJson, unarchiveStatus !== 200);

    expect(unarchiveStatus, `Unarchive event should return 200, got ${unarchiveStatus}`).toBe(200);

    const unarchiveBody = unarchiveJson as { ok: boolean; item: { id: string; status: string }; requestId: string };
    expect(unarchiveBody.ok, 'Unarchive response should have ok=true').toBe(true);
    expect(unarchiveBody.item.status, 'Unarchive response should have status=active').toBe('active');
    expect(unarchiveBody.requestId, 'Unarchive response should have requestId').toBeDefined();

    logSuccess(7, `Event ${eventId} unarchived`);

    // =========================================================================
    // Step 8: Verify Visible (event back in list)
    // =========================================================================
    const listVisibleEndpoint = `${BASE_URL}/api/v2/events?brand=${BRAND}`;
    logStep(8, listVisibleEndpoint, 'GET');

    const listVisibleResponse = await request.get(listVisibleEndpoint, {
      timeout: TIMEOUT,
    });

    const listVisibleStatus = listVisibleResponse.status();
    const listVisibleHeaders = listVisibleResponse.headers();
    let listVisibleJson: unknown;

    try {
      listVisibleJson = await listVisibleResponse.json();
    } catch {
      listVisibleJson = { error: 'Failed to parse response JSON' };
    }

    logResponse(listVisibleEndpoint, listVisibleStatus, listVisibleHeaders, listVisibleJson, listVisibleStatus !== 200);

    expect(listVisibleStatus, `List events should return 200, got ${listVisibleStatus}`).toBe(200);

    const listVisibleBody = listVisibleJson as { ok: boolean; items: Array<{ id: string; name: string }> };
    expect(listVisibleBody.ok, 'List response should have ok=true').toBe(true);

    const visibleEventInList = listVisibleBody.items.find(item => item.id === eventId);

    if (!visibleEventInList) {
      console.log('============================================');
      console.log('FAILURE: Unarchived event should appear in list');
      console.log('============================================');
      console.log(`  Endpoint: ${listVisibleEndpoint}`);
      console.log(`  Event ID: ${eventId}`);
      console.log(`  Total events in list: ${listVisibleBody.items.length}`);
      console.log('============================================');
    }

    expect(visibleEventInList, 'Unarchived event should appear in public list').toBeDefined();
    expect(visibleEventInList!.name, 'Event name should match updated name').toBe(updatedEventName);

    logSuccess(8, `Unarchived event ${eventId} verified as visible in list`);

    // =========================================================================
    // GATE PASSED
    // =========================================================================
    console.log('');
    console.log('============================================');
    console.log('GATE PASSED: Lifecycle Smoke Pack');
    console.log('============================================');
    console.log('All 8 steps completed successfully:');
    console.log('  1. Health check - PASSED');
    console.log('  2. Create event - PASSED');
    console.log('  3. Update event - PASSED');
    console.log('  4. Set default - PASSED');
    console.log('  5. Archive - PASSED');
    console.log('  6. Verify hidden - PASSED');
    console.log('  7. Unarchive - PASSED');
    console.log('  8. Verify visible - PASSED');
    console.log('============================================');
  });
});
