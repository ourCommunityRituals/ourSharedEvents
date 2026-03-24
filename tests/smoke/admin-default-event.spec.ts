/**
 * Story D3: Default Event Enforcement Smoke Test (Playwright API)
 *
 * Purpose / Value:
 *   Verify POST /api/v2/admin/events/:id/default works end-to-end:
 *   Worker auth -> Sheets read (find all brand events) -> Sheets write (unset old defaults, set new default) -> Verify single default
 *
 * Environment: STAGING
 *
 * Test Flow (per Story D3 acceptance criteria):
 *   1. POST /api/v2/admin/events (create Event A with ADMIN_KEY_STG)
 *   2. POST /api/v2/admin/events (create Event B with ADMIN_KEY_STG)
 *   3. POST /api/v2/admin/events/:id/default (set A as default)
 *   4. POST /api/v2/admin/events/:id/default (set B as default)
 *   5. Assert only B is default (A is no longer default)
 *
 * Logging Requirements (per Story D3):
 *   - BASE_URL: Always logged at test start
 *   - Response JSON on failure: Logged (trimmed to 500 chars)
 *   - requestId header: Logged if present
 *
 * Acceptance Criteria:
 *   - Setting default always results in exactly one default per brand
 *   - Switching defaults works deterministically
 *   - Idempotent: setting default twice returns 200
 *
 * @see Story D3 - Default Event Enforcement
 */

import { test, expect } from '@playwright/test';

// =============================================================================
// Configuration
// =============================================================================

/** Base URL for staging environment */
const BASE_URL = process.env.BASE_URL || 'https://stg.eventangle.com';

/** Admin key for authorized requests (from CI secrets - ADMIN_KEY_STG) */
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_KEY_STG || process.env.ADMIN_TOKEN || '';

/** Brand used for gate test */
const BRAND = process.env.TEST_BRAND || 'root';

/** Timeout for API requests (staging cold start tolerance) */
const TIMEOUT = 30000;

/** Max length for error response logging */
const MAX_ERROR_LOG_LENGTH = 500;

/** Unique prefix for gate test events */
const GATE_EVENT_PREFIX = 'D3-Default-Gate';

// =============================================================================
// Logging Helpers (Story D3 Requirements)
// =============================================================================

/**
 * Logs BASE_URL at test start (Story D3 requirement)
 */
function logEnvironment(): void {
  console.log('============================================');
  console.log('Story D3: Default Event Enforcement Smoke Gate');
  console.log('============================================');
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`ADMIN_KEY: ${ADMIN_KEY ? '[CONFIGURED]' : '[NOT CONFIGURED]'}`);
  console.log(`BRAND: ${BRAND}`);
  console.log('============================================');
}

/**
 * Logs requestId header if present (Story D3 requirement)
 */
function logRequestId(headers: { [key: string]: string }, context: string): void {
  const requestId = headers['x-request-id'];
  if (requestId) {
    console.log(`[${context}] X-Request-Id: ${requestId}`);
  }
}

/**
 * Logs response JSON on failure, trimmed to MAX_ERROR_LOG_LENGTH (Story D3 requirement)
 */
function logErrorResponse(json: unknown, context: string): void {
  try {
    const jsonString = JSON.stringify(json, null, 2);
    const trimmed = jsonString.length > MAX_ERROR_LOG_LENGTH
      ? jsonString.substring(0, MAX_ERROR_LOG_LENGTH) + '... [trimmed]'
      : jsonString;
    console.log(`[${context}] Error Response (trimmed):`);
    console.log(trimmed);
  } catch {
    console.log(`[${context}] Error Response: [unable to serialize]`);
  }
}

/**
 * Logs failure details with requestId and error code (Story D3 AC)
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

test.describe('Story D3: Default Event Enforcement Smoke Gate', () => {
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

    expect(
      ADMIN_KEY,
      'ADMIN_KEY (or ADMIN_KEY_STG) must be configured in CI secrets'
    ).toBeTruthy();
  });

  /**
   * MAIN GATE TEST: Create two events, set A default, set B default, assert only B is default
   *
   * Story D3 AC:
   * - Setting default always results in exactly one default per brand
   * - Switching defaults works deterministically
   */
  test('default event switching flow verification', async ({ request }) => {
    // Skip if ADMIN_KEY not configured
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not configured');

    const timestamp = Date.now();
    const eventNameA = `${GATE_EVENT_PREFIX}-A-${timestamp}`;
    const eventNameB = `${GATE_EVENT_PREFIX}-B-${timestamp}`;

    // =========================================================================
    // Step 1: POST create Event A
    // =========================================================================
    console.log(`[Step 1] Creating Event A: ${eventNameA}`);

    const createResponseA = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      timeout: TIMEOUT,
      data: {
        name: eventNameA,
        brand: BRAND,
      },
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const createStatusA = createResponseA.status();
    const createHeadersA = createResponseA.headers();
    let createJsonA: unknown;

    try {
      createJsonA = await createResponseA.json();
    } catch {
      createJsonA = { error: 'Failed to parse response JSON' };
    }

    logRequestId(createHeadersA, 'POST /api/v2/admin/events (Event A)');

    if (createStatusA !== 201) {
      logFailure('POST /api/v2/admin/events (Event A)', createStatusA, createHeadersA, createJsonA);
    }

    expect(createStatusA, `Create Event A should return 201, got ${createStatusA}`).toBe(201);

    const createBodyA = createJsonA as { ok: boolean; item: { id: string; name: string }; requestId: string };
    expect(createBodyA.ok, 'Create response should have ok=true').toBe(true);
    expect(createBodyA.item, 'Create response should have item').toBeDefined();
    expect(createBodyA.requestId, 'Create response should have requestId').toBeDefined();

    const eventIdA = createBodyA.item.id;
    console.log(`[Step 1] SUCCESS: Event A created with id=${eventIdA}`);

    // =========================================================================
    // Step 2: POST create Event B
    // =========================================================================
    console.log(`[Step 2] Creating Event B: ${eventNameB}`);

    const createResponseB = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      timeout: TIMEOUT,
      data: {
        name: eventNameB,
        brand: BRAND,
      },
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const createStatusB = createResponseB.status();
    const createHeadersB = createResponseB.headers();
    let createJsonB: unknown;

    try {
      createJsonB = await createResponseB.json();
    } catch {
      createJsonB = { error: 'Failed to parse response JSON' };
    }

    logRequestId(createHeadersB, 'POST /api/v2/admin/events (Event B)');

    if (createStatusB !== 201) {
      logFailure('POST /api/v2/admin/events (Event B)', createStatusB, createHeadersB, createJsonB);
    }

    expect(createStatusB, `Create Event B should return 201, got ${createStatusB}`).toBe(201);

    const createBodyB = createJsonB as { ok: boolean; item: { id: string; name: string }; requestId: string };
    expect(createBodyB.ok, 'Create response should have ok=true').toBe(true);
    expect(createBodyB.item, 'Create response should have item').toBeDefined();
    expect(createBodyB.requestId, 'Create response should have requestId').toBeDefined();

    const eventIdB = createBodyB.item.id;
    console.log(`[Step 2] SUCCESS: Event B created with id=${eventIdB}`);

    // =========================================================================
    // Step 3: POST set Event A as default
    // =========================================================================
    console.log(`[Step 3] Setting Event A as default: ${eventIdA}`);

    const defaultResponseA = await request.post(`${BASE_URL}/api/v2/admin/events/${eventIdA}/default`, {
      timeout: TIMEOUT,
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
    });

    const defaultStatusA = defaultResponseA.status();
    const defaultHeadersA = defaultResponseA.headers();
    let defaultJsonA: unknown;

    try {
      defaultJsonA = await defaultResponseA.json();
    } catch {
      defaultJsonA = { error: 'Failed to parse response JSON' };
    }

    logRequestId(defaultHeadersA, 'POST /api/v2/admin/events/:id/default (Event A)');

    if (defaultStatusA !== 200) {
      logFailure('POST /api/v2/admin/events/:id/default (Event A)', defaultStatusA, defaultHeadersA, defaultJsonA);
    }

    expect(defaultStatusA, `Set Event A default should return 200, got ${defaultStatusA}`).toBe(200);

    const defaultBodyA = defaultJsonA as { ok: boolean; item: { id: string; isDefault: boolean; brand: string }; requestId: string };
    expect(defaultBodyA.ok, 'Default A response should have ok=true').toBe(true);
    expect(defaultBodyA.item.isDefault, 'Event A should be isDefault=true').toBe(true);
    expect(defaultBodyA.item.brand, `Event A brand should be ${BRAND}`).toBe(BRAND);
    expect(defaultBodyA.requestId, 'Default A response should have requestId').toBeDefined();
    console.log(`[Step 3] SUCCESS: Event A ${eventIdA} set as default`);

    // =========================================================================
    // Step 4: POST set Event B as default (this should unset A)
    // =========================================================================
    console.log(`[Step 4] Setting Event B as default: ${eventIdB}`);

    const defaultResponseB = await request.post(`${BASE_URL}/api/v2/admin/events/${eventIdB}/default`, {
      timeout: TIMEOUT,
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
    });

    const defaultStatusB = defaultResponseB.status();
    const defaultHeadersB = defaultResponseB.headers();
    let defaultJsonB: unknown;

    try {
      defaultJsonB = await defaultResponseB.json();
    } catch {
      defaultJsonB = { error: 'Failed to parse response JSON' };
    }

    logRequestId(defaultHeadersB, 'POST /api/v2/admin/events/:id/default (Event B)');

    if (defaultStatusB !== 200) {
      logFailure('POST /api/v2/admin/events/:id/default (Event B)', defaultStatusB, defaultHeadersB, defaultJsonB);
    }

    expect(defaultStatusB, `Set Event B default should return 200, got ${defaultStatusB}`).toBe(200);

    const defaultBodyB = defaultJsonB as { ok: boolean; item: { id: string; isDefault: boolean; brand: string; previousDefaults: string[] }; requestId: string };
    expect(defaultBodyB.ok, 'Default B response should have ok=true').toBe(true);
    expect(defaultBodyB.item.isDefault, 'Event B should be isDefault=true').toBe(true);
    expect(defaultBodyB.item.brand, `Event B brand should be ${BRAND}`).toBe(BRAND);
    expect(defaultBodyB.item.previousDefaults, 'Event B should list previous defaults').toBeDefined();
    expect(defaultBodyB.item.previousDefaults, 'Previous defaults should include Event A').toContain(eventIdA);
    expect(defaultBodyB.requestId, 'Default B response should have requestId').toBeDefined();
    console.log(`[Step 4] SUCCESS: Event B ${eventIdB} set as default, Event A ${eventIdA} is no longer default`);

    // =========================================================================
    // Step 5: Verify only Event B is default (checking the previousDefaults array)
    // =========================================================================
    console.log(`[Step 5] Verifying exactly ONE default event for brand ${BRAND}`);

    // The previousDefaults in step 4 already confirmed A was unset
    // Additional verification: setting B default again should show no previous defaults (A already unset)
    const verifyResponse = await request.post(`${BASE_URL}/api/v2/admin/events/${eventIdB}/default`, {
      timeout: TIMEOUT,
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
    });

    const verifyStatus = verifyResponse.status();
    const verifyHeaders = verifyResponse.headers();
    let verifyJson: unknown;

    try {
      verifyJson = await verifyResponse.json();
    } catch {
      verifyJson = { error: 'Failed to parse response JSON' };
    }

    logRequestId(verifyHeaders, 'POST /api/v2/admin/events/:id/default (Verify)');

    expect(verifyStatus, `Verify default should return 200, got ${verifyStatus}`).toBe(200);

    const verifyBody = verifyJson as { ok: boolean; item: { id: string; isDefault: boolean; previousDefaults: string[] }; requestId: string };
    expect(verifyBody.ok, 'Verify response should have ok=true').toBe(true);
    expect(verifyBody.item.isDefault, 'Event B should still be isDefault=true').toBe(true);
    // Setting B as default again should NOT list any previous defaults (since B was already default)
    expect(verifyBody.item.previousDefaults.length, 'No previous defaults when setting same event as default').toBe(0);

    console.log(`[Step 5] SUCCESS: Exactly ONE default event verified for brand ${BRAND}`);

    console.log('============================================');
    console.log('GATE PASSED: Default Event Enforcement Smoke Test');
    console.log('============================================');
  });

  /**
   * IDEMPOTENT TEST: Setting default twice returns 200
   * Story D3 AC: Idempotent behavior
   */
  test('setting default twice is idempotent (returns 200)', async ({ request }) => {
    // Skip if ADMIN_KEY not configured
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not configured');

    const timestamp = Date.now();
    const eventName = `${GATE_EVENT_PREFIX}-idempotent-${timestamp}`;

    // Create event
    const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      timeout: TIMEOUT,
      data: {
        name: eventName,
        brand: BRAND,
      },
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const createBody = await createResponse.json() as { item: { id: string } };
    const eventId = createBody.item.id;

    console.log(`[Idempotent Test] Testing double default for event: ${eventId}`);

    // First default
    const default1Response = await request.post(`${BASE_URL}/api/v2/admin/events/${eventId}/default`, {
      timeout: TIMEOUT,
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
    });

    expect(default1Response.status(), 'First default should return 200').toBe(200);
    console.log(`[Idempotent Test] First default: 200 OK`);

    // Second default (should also return 200)
    const default2Response = await request.post(`${BASE_URL}/api/v2/admin/events/${eventId}/default`, {
      timeout: TIMEOUT,
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
    });

    const default2Status = default2Response.status();
    const default2Headers = default2Response.headers();
    let default2Json: unknown;

    try {
      default2Json = await default2Response.json();
    } catch {
      default2Json = { error: 'Failed to parse response JSON' };
    }

    logRequestId(default2Headers, 'POST /api/v2/admin/events/:id/default (second)');

    if (default2Status !== 200) {
      logFailure('Idempotent default test', default2Status, default2Headers, default2Json);
    }

    expect(default2Status, 'Second default should also return 200 (idempotent)').toBe(200);

    const default2Body = default2Json as { ok: boolean; item: { isDefault: boolean; previousDefaults: string[] } };
    expect(default2Body.item.isDefault, 'Status should remain isDefault=true').toBe(true);
    expect(default2Body.item.previousDefaults.length, 'No previous defaults when same event set again').toBe(0);

    console.log('[Idempotent Test] SUCCESS: Second default returned 200 (idempotent)');
  });

  /**
   * NEGATIVE TEST: Setting default for non-existent event returns 404
   */
  test('setting default for non-existent event returns 404', async ({ request }) => {
    // Skip if ADMIN_KEY not configured
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not configured');

    const nonExistentId = `non-existent-${Date.now()}`;
    console.log(`[404 Test] Attempting to set default for non-existent event: ${nonExistentId}`);

    const response = await request.post(`${BASE_URL}/api/v2/admin/events/${nonExistentId}/default`, {
      timeout: TIMEOUT,
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
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

    logRequestId(headers, 'POST /api/v2/admin/events/:id/default (404 test)');

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
   * AUTH TEST: Set default without Authorization returns 401
   */
  test('set default without Authorization returns 401', async ({ request }) => {
    console.log('[Auth Gate] Testing unauthorized default request');

    const response = await request.post(`${BASE_URL}/api/v2/admin/events/some-id/default`, {
      timeout: TIMEOUT,
    });

    const status = response.status();
    const headers = response.headers();
    let json: unknown;

    try {
      json = await response.json();
    } catch {
      json = { error: 'Failed to parse response JSON' };
    }

    logRequestId(headers, 'POST /api/v2/admin/events/:id/default (no auth)');

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
