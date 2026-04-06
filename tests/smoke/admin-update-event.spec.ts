/**
 * Story D1: Update Event Endpoint Smoke Test (Playwright API)
 *
 * Purpose / Value:
 *   Verify PUT /api/v2/admin/events/:id works end-to-end:
 *   Worker auth -> Sheets read (find by ID) -> Sheets write (update) -> Verify
 *
 * Environment: STAGING
 *
 * Test Flow:
 *   1. POST /api/v2/admin/events (create event with ADMIN_KEY_STG)
 *   2. PUT /api/v2/admin/events/:id (update name)
 *   3. GET /api/v2/events (list events)
 *   4. Assert name changed
 *
 * Logging Requirements (per Story D1):
 *   - BASE_URL: Always logged at test start
 *   - Response JSON on failure: Logged (trimmed to 500 chars)
 *   - requestId header: Logged if present
 *
 * Acceptance Criteria:
 *   - Updating one field does not overwrite others
 *   - Updating non-existent ID returns 404
 *   - All responses include requestId
 *
 * @see Story D1 - Update Event Endpoint
 */

import { test, expect } from '@playwright/test';

// =============================================================================
// Configuration
// =============================================================================

/** Base URL for staging environment */
const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';

/** Admin key for authorized requests (from CI secrets - ADMIN_KEY_STG) */
const ADMIN_KEY =
  process.env.ADMIN_KEY || process.env.ADMIN_KEY_STG || process.env.ADMIN_TOKEN || '';

/** Brand used for gate test */
const BRAND = process.env.TEST_BRAND || 'root';

/** Timeout for API requests (staging cold start tolerance) */
const TIMEOUT = 30000;

/** Max length for error response logging */
const MAX_ERROR_LOG_LENGTH = 500;

/** Unique prefix for gate test events */
const GATE_EVENT_PREFIX = 'D1-Update-Gate';

// =============================================================================
// Logging Helpers (Story D1 Requirements)
// =============================================================================

/**
 * Logs BASE_URL at test start (Story D1 requirement)
 */
function logEnvironment(): void {
  console.log('============================================');
  console.log('Story D1: Update-Event Smoke Gate');
  console.log('============================================');
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`ADMIN_KEY: ${ADMIN_KEY ? '[CONFIGURED]' : '[NOT CONFIGURED]'}`);
  console.log(`BRAND: ${BRAND}`);
  console.log('============================================');
}

/**
 * Logs requestId header if present (Story D1 requirement)
 */
function logRequestId(headers: { [key: string]: string }, context: string): void {
  const requestId = headers['x-request-id'];
  if (requestId) {
    console.log(`[${context}] X-Request-Id: ${requestId}`);
  }
}

/**
 * Logs response JSON on failure, trimmed to MAX_ERROR_LOG_LENGTH (Story D1 requirement)
 */
function logErrorResponse(json: unknown, context: string): void {
  try {
    const jsonString = JSON.stringify(json, null, 2);
    const trimmed =
      jsonString.length > MAX_ERROR_LOG_LENGTH
        ? jsonString.substring(0, MAX_ERROR_LOG_LENGTH) + '... [trimmed]'
        : jsonString;
    console.log(`[${context}] Error Response (trimmed):`);
    console.log(trimmed);
  } catch {
    console.log(`[${context}] Error Response: [unable to serialize]`);
  }
}

/**
 * Logs failure details with requestId and error code (Story D1 AC)
 */
function logFailure(
  context: string,
  status: number,
  headers: { [key: string]: string },
  json: unknown
): void {
  console.log('============================================');
  console.log(`FAILURE: ${context}`);
  console.log('============================================');
  console.log(`HTTP Status: ${status}`);
  logRequestId(headers, context);

  // Extract error code if present
  if (json && typeof json === 'object' && 'code' in json) {
    console.log(`Error Code: ${(json as { code: string }).code}`);
  }

  logErrorResponse(json, context);
  console.log('============================================');
}

// =============================================================================
// Test Suite
// =============================================================================

test.describe('Story D1: Update-Event Smoke Gate', () => {
  // Log environment at the start of the test suite
  test.beforeAll(() => {
    logEnvironment();
  });

  /**
   * NEGATIVE PATH: Fail fast if ADMIN_KEY is not configured
   */
  test('fails fast if ADMIN_KEY secret is not configured', async () => {
    if (!ADMIN_KEY) {
      console.log('============================================');
      console.log('FAIL FAST: ADMIN_KEY secret not configured');
      console.log('============================================');
      console.log('Required environment variable: ADMIN_KEY or ADMIN_KEY_STG');
      console.log('Ensure secrets.ADMIN_KEY_STG is set in CI workflow');
      console.log('============================================');
    }

    expect(ADMIN_KEY, 'ADMIN_KEY (or ADMIN_KEY_STG) must be configured in CI secrets').toBeTruthy();
  });

  /**
   * MAIN GATE TEST: Create event, update name, verify change in list
   *
   * Story D1 AC:
   * - Updating one field does not overwrite others
   * - All responses include requestId
   */
  test('PUT update event name + GET list verification gate', async ({ request }) => {
    // Skip if ADMIN_KEY not configured
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not configured');

    const timestamp = Date.now();
    const originalName = `${GATE_EVENT_PREFIX}-${timestamp}`;
    const updatedName = `${GATE_EVENT_PREFIX}-UPDATED-${timestamp}`;
    const uniqueSlug = `d1-update-gate-${timestamp}`;

    // =========================================================================
    // Step 1: POST create event
    // =========================================================================
    console.log(`[Step 1] Creating event: ${originalName}`);

    const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      timeout: TIMEOUT,
      data: {
        name: originalName,
        brand: BRAND,
        slug: uniqueSlug,
        startDateISO: '2025-12-01',
      },
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const createStatus = createResponse.status();
    const createHeaders = createResponse.headers();
    let createJson: unknown;

    try {
      createJson = await createResponse.json();
    } catch {
      createJson = { error: 'Failed to parse response JSON' };
    }

    logRequestId(createHeaders, 'POST /api/v2/admin/events');

    if (createStatus !== 201) {
      logFailure('POST /api/v2/admin/events', createStatus, createHeaders, createJson);
    }

    expect(createStatus, `Create event should return 201, got ${createStatus}`).toBe(201);

    const createBody = createJson as {
      ok: boolean;
      item: { id: string; name: string; slug: string; brand: string; startDateISO?: string };
      requestId: string;
    };
    expect(createBody.ok, 'Create response should have ok=true').toBe(true);
    expect(createBody.item, 'Create response should have item').toBeDefined();
    expect(createBody.requestId, 'Create response should have requestId').toBeDefined();

    const createdEventId = createBody.item.id;
    const originalSlug = createBody.item.slug;
    const originalBrand = createBody.item.brand;
    console.log(`[Step 1] SUCCESS: Event created with id=${createdEventId}, slug=${originalSlug}`);

    // =========================================================================
    // Step 2: PUT update event name only
    // =========================================================================
    console.log(`[Step 2] Updating event name to: ${updatedName}`);

    const updateResponse = await request.put(`${BASE_URL}/api/v2/admin/events/${createdEventId}`, {
      timeout: TIMEOUT,
      data: {
        name: updatedName,
      },
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const updateStatus = updateResponse.status();
    const updateHeaders = updateResponse.headers();
    let updateJson: unknown;

    try {
      updateJson = await updateResponse.json();
    } catch {
      updateJson = { error: 'Failed to parse response JSON' };
    }

    logRequestId(updateHeaders, 'PUT /api/v2/admin/events/:id');

    if (updateStatus !== 200) {
      logFailure('PUT /api/v2/admin/events/:id', updateStatus, updateHeaders, updateJson);
    }

    expect(updateStatus, `Update event should return 200, got ${updateStatus}`).toBe(200);

    const updateBody = updateJson as {
      ok: boolean;
      item: { id: string; name: string; slug: string; brand: string; startDateISO?: string };
      requestId: string;
    };
    expect(updateBody.ok, 'Update response should have ok=true').toBe(true);
    expect(updateBody.item, 'Update response should have item').toBeDefined();
    expect(updateBody.requestId, 'Update response should have requestId').toBeDefined();

    // Verify name was updated
    expect(updateBody.item.name, 'Updated event name should match').toBe(updatedName);

    // Verify other fields were NOT overwritten (Story D1 AC: "Updating one field does not overwrite others")
    expect(updateBody.item.slug, 'Slug should remain unchanged').toBe(originalSlug);
    expect(updateBody.item.brand, 'Brand should remain unchanged').toBe(originalBrand);
    // Note: startDateISO is optional in response, checking if it's preserved
    if (updateBody.item.startDateISO) {
      expect(updateBody.item.startDateISO, 'startDateISO should remain unchanged').toBe(
        '2025-12-01'
      );
    }

    console.log(
      `[Step 2] SUCCESS: Event updated, name=${updateBody.item.name}, slug=${updateBody.item.slug}`
    );

    // =========================================================================
    // Step 3: GET list and verify updated name
    // =========================================================================
    console.log(`[Step 3] Fetching events list for brand=${BRAND}`);

    const listResponse = await request.get(`${BASE_URL}/api/v2/events?brand=${BRAND}`, {
      timeout: TIMEOUT,
    });

    const listStatus = listResponse.status();
    const listHeaders = listResponse.headers();
    let listJson: unknown;

    try {
      listJson = await listResponse.json();
    } catch {
      listJson = { error: 'Failed to parse response JSON' };
    }

    logRequestId(listHeaders, 'GET /api/v2/events');

    if (listStatus !== 200) {
      logFailure('GET /api/v2/events', listStatus, listHeaders, listJson);
    }

    expect(listStatus, `List events should return 200, got ${listStatus}`).toBe(200);

    const listBody = listJson as {
      ok: boolean;
      items: Array<{ id: string; name: string }>;
      requestId?: string;
    };
    expect(listBody.ok, 'List response should have ok=true').toBe(true);
    expect(Array.isArray(listBody.items), 'List response should have items array').toBe(true);

    // Find the updated event in the list
    const foundEvent = listBody.items.find((item) => item.id === createdEventId);

    if (!foundEvent) {
      console.log('============================================');
      console.log('FAILURE: Updated event not found in list');
      console.log('============================================');
      console.log(`Expected event id: ${createdEventId}`);
      console.log(`Total events in list: ${listBody.items.length}`);
      logRequestId(listHeaders, 'GET /api/v2/events');
      console.log('============================================');
    }

    expect(foundEvent, `Updated event ${createdEventId} should appear in list`).toBeDefined();
    expect(foundEvent!.name, 'Event name in list should be the updated name').toBe(updatedName);

    console.log(`[Step 3] SUCCESS: Event ${createdEventId} found in list with updated name`);
    console.log('============================================');
    console.log('GATE PASSED: Update-Event Smoke Test');
    console.log('============================================');
  });

  /**
   * NEGATIVE TEST: Updating non-existent ID returns 404
   * Story D1 AC: "Updating non-existent ID returns 404"
   */
  test('PUT non-existent event ID returns 404 with NOT_FOUND code', async ({ request }) => {
    // Skip if ADMIN_KEY not configured
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not configured');

    const nonExistentId = `non-existent-${Date.now()}`;
    console.log(`[404 Test] Attempting to update non-existent event: ${nonExistentId}`);

    const response = await request.put(`${BASE_URL}/api/v2/admin/events/${nonExistentId}`, {
      timeout: TIMEOUT,
      data: {
        name: 'Should Not Update',
      },
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const status = response.status();
    const headers = response.headers();
    let json: unknown;

    try {
      json = await response.json();
    } catch {
      json = { error: 'Failed to parse response JSON' };
    }

    logRequestId(headers, 'PUT /api/v2/admin/events/:id (404 test)');

    if (status !== 404) {
      logFailure('404 test', status, headers, json);
    }

    expect(status, `Request with non-existent ID should return 404, got ${status}`).toBe(404);

    const body = json as { ok: boolean; code: string; requestId?: string };
    expect(body.ok, 'Error response should have ok=false').toBe(false);
    expect(body.code, 'Error code should be NOT_FOUND').toBe('NOT_FOUND');
    expect(body.requestId, 'Error response should have requestId').toBeDefined();

    console.log('[404 Test] SUCCESS: 404 returned for non-existent event ID');
  });

  /**
   * NEGATIVE TEST: Empty JSON body returns BAD_JSON
   * Story D1 AC: "Reject empty JSON"
   */
  test('PUT with empty JSON body returns 400 with BAD_JSON code', async ({ request }) => {
    // Skip if ADMIN_KEY not configured
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not configured');

    // First create an event to have a valid ID
    const timestamp = Date.now();
    const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      timeout: TIMEOUT,
      data: {
        name: `BAD_JSON-Test-${timestamp}`,
        brand: BRAND,
      },
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const createBody = (await createResponse.json()) as { item: { id: string } };
    const eventId = createBody.item.id;

    console.log(`[BAD_JSON Test] Testing empty body update for event: ${eventId}`);

    const response = await request.put(`${BASE_URL}/api/v2/admin/events/${eventId}`, {
      timeout: TIMEOUT,
      data: {},
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const status = response.status();
    const headers = response.headers();
    let json: unknown;

    try {
      json = await response.json();
    } catch {
      json = { error: 'Failed to parse response JSON' };
    }

    logRequestId(headers, 'PUT /api/v2/admin/events/:id (empty body)');

    if (status !== 400) {
      logFailure('BAD_JSON test', status, headers, json);
    }

    expect(status, `Request with empty body should return 400, got ${status}`).toBe(400);

    const body = json as { ok: boolean; code: string; requestId?: string };
    expect(body.ok, 'Error response should have ok=false').toBe(false);
    expect(body.code, 'Error code should be BAD_JSON').toBe('BAD_JSON');
    expect(body.requestId, 'Error response should have requestId').toBeDefined();

    console.log('[BAD_JSON Test] SUCCESS: 400 with BAD_JSON returned for empty body');
  });

  /**
   * NEGATIVE TEST: Invalid date format returns BAD_START_DATE
   * Story D1 AC: "Reject invalid date format"
   */
  test('PUT with invalid date format returns 400 with BAD_START_DATE code', async ({ request }) => {
    // Skip if ADMIN_KEY not configured
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not configured');

    // First create an event to have a valid ID
    const timestamp = Date.now();
    const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      timeout: TIMEOUT,
      data: {
        name: `BAD_DATE-Test-${timestamp}`,
        brand: BRAND,
      },
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const createBody = (await createResponse.json()) as { item: { id: string } };
    const eventId = createBody.item.id;

    console.log(`[BAD_START_DATE Test] Testing invalid date update for event: ${eventId}`);

    const response = await request.put(`${BASE_URL}/api/v2/admin/events/${eventId}`, {
      timeout: TIMEOUT,
      data: {
        startDateISO: 'not-a-valid-date',
      },
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const status = response.status();
    const headers = response.headers();
    let json: unknown;

    try {
      json = await response.json();
    } catch {
      json = { error: 'Failed to parse response JSON' };
    }

    logRequestId(headers, 'PUT /api/v2/admin/events/:id (invalid date)');

    if (status !== 400) {
      logFailure('BAD_START_DATE test', status, headers, json);
    }

    expect(status, `Request with invalid date should return 400, got ${status}`).toBe(400);

    const body = json as { ok: boolean; code: string; requestId?: string };
    expect(body.ok, 'Error response should have ok=false').toBe(false);
    expect(body.code, 'Error code should be BAD_START_DATE').toBe('BAD_START_DATE');
    expect(body.requestId, 'Error response should have requestId').toBeDefined();

    console.log('[BAD_START_DATE Test] SUCCESS: 400 with BAD_START_DATE returned for invalid date');
  });

  /**
   * SUPPLEMENTARY: Verify 401 without Authorization header
   */
  test('PUT without Authorization returns 401', async ({ request }) => {
    console.log('[Auth Gate] Testing unauthorized request');

    const response = await request.put(`${BASE_URL}/api/v2/admin/events/some-id`, {
      timeout: TIMEOUT,
      data: {
        name: 'Unauthorized Update',
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const status = response.status();
    const headers = response.headers();
    let json: unknown;

    try {
      json = await response.json();
    } catch {
      json = { error: 'Failed to parse response JSON' };
    }

    logRequestId(headers, 'PUT /api/v2/admin/events/:id (no auth)');

    if (status !== 401) {
      logFailure('Auth gate test', status, headers, json);
    }

    expect(status, `Request without auth should return 401, got ${status}`).toBe(401);

    const body = json as { ok: boolean; code: string };
    expect(body.ok, 'Error response should have ok=false').toBe(false);
    expect(body.code, 'Error code should be UNAUTH').toBe('UNAUTH');

    console.log('[Auth Gate] SUCCESS: 401 returned for unauthorized request');
  });
});
