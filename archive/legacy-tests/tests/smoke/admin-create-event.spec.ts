/**
 * Story C4: Stage-2 Gate - Create-Event Smoke Test (Playwright API)
 *
 * Purpose / Value:
 *   Every staging deploy proves the system works end-to-end:
 *   Worker auth -> Sheets write -> Sheets read
 *
 * Environment: STAGING
 *
 * Test Flow:
 *   1. POST /api/v2/admin/events (create event with ADMIN_KEY_STG)
 *   2. GET /api/v2/events (list events)
 *   3. Assert created event exists in list
 *
 * Logging Requirements (per Story C4):
 *   - BASE_URL: Always logged at test start
 *   - Response JSON on failure: Logged (trimmed to 500 chars)
 *   - requestId header: Logged if present
 *
 * Acceptance Criteria:
 *   Stage-2 fails if:
 *   - Health fails
 *   - Create fails
 *   - List missing created event
 *   - CI log contains requestId + error code when failing
 *
 * Negative Path Handling:
 *   - Secrets missing in CI: test fails fast with clear message
 *
 * @see Story C4 - Stage-2 Gate: Create-Event Smoke (Playwright API) + Log Evidence
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
const GATE_EVENT_PREFIX = 'C4-Smoke-Gate';

// =============================================================================
// Logging Helpers (Story C4 Requirements)
// =============================================================================

/**
 * Logs BASE_URL at test start (Story C4 requirement)
 */
function logEnvironment(): void {
  console.log('============================================');
  console.log('Story C4: Create-Event Smoke Gate');
  console.log('============================================');
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`ADMIN_KEY: ${ADMIN_KEY ? '[CONFIGURED]' : '[NOT CONFIGURED]'}`);
  console.log(`BRAND: ${BRAND}`);
  console.log('============================================');
}

/**
 * Logs requestId header if present (Story C4 requirement)
 */
function logRequestId(headers: { [key: string]: string }, context: string): void {
  const requestId = headers['x-request-id'];
  if (requestId) {
    console.log(`[${context}] X-Request-Id: ${requestId}`);
  }
}

/**
 * Logs response JSON on failure, trimmed to MAX_ERROR_LOG_LENGTH (Story C4 requirement)
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
 * Logs failure details with requestId and error code (Story C4 AC)
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

test.describe('Story C4: Create-Event Smoke Gate', () => {
  // Log environment at the start of the test suite
  test.beforeAll(() => {
    logEnvironment();
  });

  /**
   * NEGATIVE PATH: Fail fast if ADMIN_KEY is not configured
   * Story C4 AC: "Secrets missing in CI: test fails fast with clear message"
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
   * MAIN GATE TEST: Create event and verify it appears in list
   *
   * Story C4 AC:
   * - Stage-2 fails if create fails
   * - Stage-2 fails if list missing created event
   * - CI log contains requestId + error code when failing
   */
  test('POST create event + GET list verification gate', async ({ request }) => {
    // Skip if ADMIN_KEY not configured (previous test should catch this)
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not configured');

    const timestamp = Date.now();
    const uniqueName = `${GATE_EVENT_PREFIX}-${timestamp}`;
    const uniqueSlug = `c4-smoke-gate-${timestamp}`;

    // =========================================================================
    // Step 1: POST create event with Authorization header
    // =========================================================================
    console.log(`[Step 1] Creating event: ${uniqueName}`);

    const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      timeout: TIMEOUT,
      data: {
        name: uniqueName,
        brand: BRAND,
        slug: uniqueSlug,
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

    // Log requestId for all responses (Story C4 requirement)
    logRequestId(createHeaders, 'POST /api/v2/admin/events');

    // Gate check: Create must return 201
    if (createStatus !== 201) {
      logFailure('POST /api/v2/admin/events', createStatus, createHeaders, createJson);
    }

    expect(createStatus, `Create event should return 201, got ${createStatus}`).toBe(201);

    // Validate response structure
    const createBody = createJson as { ok: boolean; item: { id: string; name: string } };
    expect(createBody.ok, 'Create response should have ok=true').toBe(true);
    expect(createBody.item, 'Create response should have item').toBeDefined();
    expect(createBody.item.id, 'Created event should have id').toBeDefined();
    expect(createBody.item.name, 'Created event name mismatch').toBe(uniqueName);

    const createdEventId = createBody.item.id;
    console.log(`[Step 1] SUCCESS: Event created with id=${createdEventId}`);

    // =========================================================================
    // Step 2: GET list and assert created event appears
    // =========================================================================
    console.log(`[Step 2] Fetching events list for brand=${BRAND}`);

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

    // Log requestId for all responses (Story C4 requirement)
    logRequestId(listHeaders, 'GET /api/v2/events');

    // Gate check: List must return 200
    if (listStatus !== 200) {
      logFailure('GET /api/v2/events', listStatus, listHeaders, listJson);
    }

    expect(listStatus, `List events should return 200, got ${listStatus}`).toBe(200);

    // Validate response structure
    const listBody = listJson as { ok: boolean; items: Array<{ id: string; name: string }> };
    expect(listBody.ok, 'List response should have ok=true').toBe(true);
    expect(Array.isArray(listBody.items), 'List response should have items array').toBe(true);

    // Gate check: Created event must appear in list
    const foundEvent = listBody.items.find((item) => item.id === createdEventId);

    if (!foundEvent) {
      console.log('============================================');
      console.log('FAILURE: Created event not found in list');
      console.log('============================================');
      console.log(`Expected event id: ${createdEventId}`);
      console.log(`Expected event name: ${uniqueName}`);
      console.log(`Total events in list: ${listBody.items.length}`);
      logRequestId(listHeaders, 'GET /api/v2/events');
      console.log('============================================');
    }

    expect(foundEvent, `Created event ${createdEventId} should appear in list`).toBeDefined();

    expect(foundEvent!.name, 'Event name in list should match created name').toBe(uniqueName);

    console.log(`[Step 2] SUCCESS: Event ${createdEventId} found in list`);
    console.log('============================================');
    console.log('GATE PASSED: Create-Event Smoke Test');
    console.log('============================================');
  });

  /**
   * SUPPLEMENTARY: Verify 401 without Authorization header
   * Ensures the auth gate is working in staging
   */
  test('POST without Authorization returns 401', async ({ request }) => {
    console.log('[Auth Gate] Testing unauthorized request');

    const response = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      timeout: TIMEOUT,
      data: {
        name: 'Unauthorized Test Event',
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

    // Log requestId even for expected failures
    logRequestId(headers, 'POST /api/v2/admin/events (no auth)');

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
