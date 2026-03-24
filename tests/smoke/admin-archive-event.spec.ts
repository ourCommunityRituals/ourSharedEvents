/**
 * Story D2: Archive/Unarchive Event Smoke Test (Playwright API)
 *
 * Purpose / Value:
 *   Verify POST /api/v2/admin/events/:id/archive and /unarchive work end-to-end:
 *   Worker auth -> Sheets read (find by ID) -> Sheets write (update status) -> Verify filtering
 *
 * Environment: STAGING
 *
 * Test Flow:
 *   1. POST /api/v2/admin/events (create event with ADMIN_KEY_STG)
 *   2. POST /api/v2/admin/events/:id/archive (archive event)
 *   3. GET /api/v2/events (assert archived event NOT in list)
 *   4. POST /api/v2/admin/events/:id/unarchive (unarchive event)
 *   5. GET /api/v2/events (assert event IS back in list)
 *
 * Logging Requirements (per Story D2):
 *   - BASE_URL: Always logged at test start
 *   - Response JSON on failure: Logged (trimmed to 500 chars)
 *   - requestId header: Logged if present
 *
 * Acceptance Criteria:
 *   - Archived events disappear from /api/v2/events
 *   - Unarchive restores visibility
 *   - No rows deleted
 *   - Idempotent: archiving twice returns 200
 *
 * @see Story D2 - Archive/Unarchive Event
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
const GATE_EVENT_PREFIX = 'D2-Archive-Gate';

// =============================================================================
// Logging Helpers (Story D2 Requirements)
// =============================================================================

/**
 * Logs BASE_URL at test start (Story D2 requirement)
 */
function logEnvironment(): void {
  console.log('============================================');
  console.log('Story D2: Archive/Unarchive Event Smoke Gate');
  console.log('============================================');
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`ADMIN_KEY: ${ADMIN_KEY ? '[CONFIGURED]' : '[NOT CONFIGURED]'}`);
  console.log(`BRAND: ${BRAND}`);
  console.log('============================================');
}

/**
 * Logs requestId header if present (Story D2 requirement)
 */
function logRequestId(headers: { [key: string]: string }, context: string): void {
  const requestId = headers['x-request-id'];
  if (requestId) {
    console.log(`[${context}] X-Request-Id: ${requestId}`);
  }
}

/**
 * Logs response JSON on failure, trimmed to MAX_ERROR_LOG_LENGTH (Story D2 requirement)
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
 * Logs failure details with requestId and error code (Story D2 AC)
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

test.describe('Story D2: Archive/Unarchive Event Smoke Gate', () => {
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
   * MAIN GATE TEST: Create event, archive, verify hidden, unarchive, verify visible
   *
   * Story D2 AC:
   * - Archived events disappear from /api/v2/events
   * - Unarchive restores visibility
   * - No rows deleted
   */
  test('archive/unarchive event flow verification', async ({ request }) => {
    // Skip if ADMIN_KEY not configured
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not configured');

    const timestamp = Date.now();
    const eventName = `${GATE_EVENT_PREFIX}-${timestamp}`;
    const uniqueSlug = `d2-archive-gate-${timestamp}`;

    // =========================================================================
    // Step 1: POST create event
    // =========================================================================
    console.log(`[Step 1] Creating event: ${eventName}`);

    const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      timeout: TIMEOUT,
      data: {
        name: eventName,
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

    logRequestId(createHeaders, 'POST /api/v2/admin/events');

    if (createStatus !== 201) {
      logFailure('POST /api/v2/admin/events', createStatus, createHeaders, createJson);
    }

    expect(createStatus, `Create event should return 201, got ${createStatus}`).toBe(201);

    const createBody = createJson as { ok: boolean; item: { id: string; name: string }; requestId: string };
    expect(createBody.ok, 'Create response should have ok=true').toBe(true);
    expect(createBody.item, 'Create response should have item').toBeDefined();
    expect(createBody.requestId, 'Create response should have requestId').toBeDefined();

    const createdEventId = createBody.item.id;
    console.log(`[Step 1] SUCCESS: Event created with id=${createdEventId}`);

    // =========================================================================
    // Step 2: Verify event appears in list (before archive)
    // =========================================================================
    console.log(`[Step 2] Verifying event appears in list before archive`);

    const listBeforeArchiveResponse = await request.get(`${BASE_URL}/api/v2/events?brand=${BRAND}`, {
      timeout: TIMEOUT,
    });

    const listBeforeArchiveBody = await listBeforeArchiveResponse.json() as { ok: boolean; items: Array<{ id: string }> };
    const eventInListBeforeArchive = listBeforeArchiveBody.items.find(item => item.id === createdEventId);
    expect(eventInListBeforeArchive, 'Event should appear in list before archive').toBeDefined();
    console.log(`[Step 2] SUCCESS: Event ${createdEventId} found in list before archive`);

    // =========================================================================
    // Step 3: POST archive event
    // =========================================================================
    console.log(`[Step 3] Archiving event: ${createdEventId}`);

    const archiveResponse = await request.post(`${BASE_URL}/api/v2/admin/events/${createdEventId}/archive`, {
      timeout: TIMEOUT,
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
    });

    const archiveStatus = archiveResponse.status();
    const archiveHeaders = archiveResponse.headers();
    let archiveJson: unknown;

    try {
      archiveJson = await archiveResponse.json();
    } catch {
      archiveJson = { error: 'Failed to parse response JSON' };
    }

    logRequestId(archiveHeaders, 'POST /api/v2/admin/events/:id/archive');

    if (archiveStatus !== 200) {
      logFailure('POST /api/v2/admin/events/:id/archive', archiveStatus, archiveHeaders, archiveJson);
    }

    expect(archiveStatus, `Archive event should return 200, got ${archiveStatus}`).toBe(200);

    const archiveBody = archiveJson as { ok: boolean; item: { id: string; status: string; operation: string }; requestId: string };
    expect(archiveBody.ok, 'Archive response should have ok=true').toBe(true);
    expect(archiveBody.item.status, 'Archive response should have status=archived').toBe('archived');
    expect(archiveBody.item.operation, 'Archive response should have operation=archive').toBe('archive');
    expect(archiveBody.requestId, 'Archive response should have requestId').toBeDefined();
    console.log(`[Step 3] SUCCESS: Event ${createdEventId} archived`);

    // =========================================================================
    // Step 4: Verify event does NOT appear in list (after archive)
    // =========================================================================
    console.log(`[Step 4] Verifying archived event does NOT appear in list`);

    const listAfterArchiveResponse = await request.get(`${BASE_URL}/api/v2/events?brand=${BRAND}`, {
      timeout: TIMEOUT,
    });

    const listAfterArchiveStatus = listAfterArchiveResponse.status();
    const listAfterArchiveHeaders = listAfterArchiveResponse.headers();
    let listAfterArchiveJson: unknown;

    try {
      listAfterArchiveJson = await listAfterArchiveResponse.json();
    } catch {
      listAfterArchiveJson = { error: 'Failed to parse response JSON' };
    }

    logRequestId(listAfterArchiveHeaders, 'GET /api/v2/events (after archive)');

    expect(listAfterArchiveStatus, `List events should return 200, got ${listAfterArchiveStatus}`).toBe(200);

    const listAfterArchiveBody = listAfterArchiveJson as { ok: boolean; items: Array<{ id: string; name: string }> };
    const archivedEventInList = listAfterArchiveBody.items.find(item => item.id === createdEventId);

    if (archivedEventInList) {
      console.log('============================================');
      console.log('FAILURE: Archived event still appears in list');
      console.log('============================================');
      console.log(`Event id: ${createdEventId}`);
      console.log(`Total events in list: ${listAfterArchiveBody.items.length}`);
      console.log('============================================');
    }

    expect(archivedEventInList, 'Archived event should NOT appear in list').toBeUndefined();
    console.log(`[Step 4] SUCCESS: Archived event ${createdEventId} NOT in list`);

    // =========================================================================
    // Step 5: POST unarchive event
    // =========================================================================
    console.log(`[Step 5] Unarchiving event: ${createdEventId}`);

    const unarchiveResponse = await request.post(`${BASE_URL}/api/v2/admin/events/${createdEventId}/unarchive`, {
      timeout: TIMEOUT,
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
    });

    const unarchiveStatus = unarchiveResponse.status();
    const unarchiveHeaders = unarchiveResponse.headers();
    let unarchiveJson: unknown;

    try {
      unarchiveJson = await unarchiveResponse.json();
    } catch {
      unarchiveJson = { error: 'Failed to parse response JSON' };
    }

    logRequestId(unarchiveHeaders, 'POST /api/v2/admin/events/:id/unarchive');

    if (unarchiveStatus !== 200) {
      logFailure('POST /api/v2/admin/events/:id/unarchive', unarchiveStatus, unarchiveHeaders, unarchiveJson);
    }

    expect(unarchiveStatus, `Unarchive event should return 200, got ${unarchiveStatus}`).toBe(200);

    const unarchiveBody = unarchiveJson as { ok: boolean; item: { id: string; status: string; operation: string }; requestId: string };
    expect(unarchiveBody.ok, 'Unarchive response should have ok=true').toBe(true);
    expect(unarchiveBody.item.status, 'Unarchive response should have status=active').toBe('active');
    expect(unarchiveBody.item.operation, 'Unarchive response should have operation=unarchive').toBe('unarchive');
    expect(unarchiveBody.requestId, 'Unarchive response should have requestId').toBeDefined();
    console.log(`[Step 5] SUCCESS: Event ${createdEventId} unarchived`);

    // =========================================================================
    // Step 6: Verify event IS back in list (after unarchive)
    // =========================================================================
    console.log(`[Step 6] Verifying unarchived event IS back in list`);

    const listAfterUnarchiveResponse = await request.get(`${BASE_URL}/api/v2/events?brand=${BRAND}`, {
      timeout: TIMEOUT,
    });

    const listAfterUnarchiveStatus = listAfterUnarchiveResponse.status();
    const listAfterUnarchiveHeaders = listAfterUnarchiveResponse.headers();
    let listAfterUnarchiveJson: unknown;

    try {
      listAfterUnarchiveJson = await listAfterUnarchiveResponse.json();
    } catch {
      listAfterUnarchiveJson = { error: 'Failed to parse response JSON' };
    }

    logRequestId(listAfterUnarchiveHeaders, 'GET /api/v2/events (after unarchive)');

    expect(listAfterUnarchiveStatus, `List events should return 200, got ${listAfterUnarchiveStatus}`).toBe(200);

    const listAfterUnarchiveBody = listAfterUnarchiveJson as { ok: boolean; items: Array<{ id: string; name: string }> };
    const unarchivedEventInList = listAfterUnarchiveBody.items.find(item => item.id === createdEventId);

    if (!unarchivedEventInList) {
      console.log('============================================');
      console.log('FAILURE: Unarchived event not back in list');
      console.log('============================================');
      console.log(`Event id: ${createdEventId}`);
      console.log(`Total events in list: ${listAfterUnarchiveBody.items.length}`);
      console.log('============================================');
    }

    expect(unarchivedEventInList, 'Unarchived event should appear back in list').toBeDefined();
    expect(unarchivedEventInList!.name, 'Event name should match').toBe(eventName);
    console.log(`[Step 6] SUCCESS: Unarchived event ${createdEventId} back in list`);

    console.log('============================================');
    console.log('GATE PASSED: Archive/Unarchive Event Smoke Test');
    console.log('============================================');
  });

  /**
   * IDEMPOTENT TEST: Archiving twice returns 200
   * Story D2 AC: "Idempotent (archiving twice returns 200)"
   */
  test('archiving twice is idempotent (returns 200)', async ({ request }) => {
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

    console.log(`[Idempotent Test] Testing double archive for event: ${eventId}`);

    // First archive
    const archive1Response = await request.post(`${BASE_URL}/api/v2/admin/events/${eventId}/archive`, {
      timeout: TIMEOUT,
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
    });

    expect(archive1Response.status(), 'First archive should return 200').toBe(200);
    console.log(`[Idempotent Test] First archive: 200 OK`);

    // Second archive (should also return 200)
    const archive2Response = await request.post(`${BASE_URL}/api/v2/admin/events/${eventId}/archive`, {
      timeout: TIMEOUT,
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
    });

    const archive2Status = archive2Response.status();
    const archive2Headers = archive2Response.headers();
    let archive2Json: unknown;

    try {
      archive2Json = await archive2Response.json();
    } catch {
      archive2Json = { error: 'Failed to parse response JSON' };
    }

    logRequestId(archive2Headers, 'POST /api/v2/admin/events/:id/archive (second)');

    if (archive2Status !== 200) {
      logFailure('Idempotent archive test', archive2Status, archive2Headers, archive2Json);
    }

    expect(archive2Status, 'Second archive should also return 200 (idempotent)').toBe(200);

    const archive2Body = archive2Json as { ok: boolean; item: { status: string } };
    expect(archive2Body.item.status, 'Status should remain archived').toBe('archived');

    console.log('[Idempotent Test] SUCCESS: Second archive returned 200 (idempotent)');
  });

  /**
   * NEGATIVE TEST: Archiving non-existent event returns 404
   */
  test('archiving non-existent event returns 404', async ({ request }) => {
    // Skip if ADMIN_KEY not configured
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not configured');

    const nonExistentId = `non-existent-${Date.now()}`;
    console.log(`[404 Test] Attempting to archive non-existent event: ${nonExistentId}`);

    const response = await request.post(`${BASE_URL}/api/v2/admin/events/${nonExistentId}/archive`, {
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

    logRequestId(headers, 'POST /api/v2/admin/events/:id/archive (404 test)');

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
   * NEGATIVE TEST: Unarchiving non-existent event returns 404
   */
  test('unarchiving non-existent event returns 404', async ({ request }) => {
    // Skip if ADMIN_KEY not configured
    test.skip(!ADMIN_KEY, 'ADMIN_KEY not configured');

    const nonExistentId = `non-existent-${Date.now()}`;
    console.log(`[404 Test] Attempting to unarchive non-existent event: ${nonExistentId}`);

    const response = await request.post(`${BASE_URL}/api/v2/admin/events/${nonExistentId}/unarchive`, {
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

    logRequestId(headers, 'POST /api/v2/admin/events/:id/unarchive (404 test)');

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
   * AUTH TEST: Archive without Authorization returns 401
   */
  test('archive without Authorization returns 401', async ({ request }) => {
    console.log('[Auth Gate] Testing unauthorized archive request');

    const response = await request.post(`${BASE_URL}/api/v2/admin/events/some-id/archive`, {
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

    logRequestId(headers, 'POST /api/v2/admin/events/:id/archive (no auth)');

    if (status !== 401) {
      logFailure('Auth gate test', status, headers, json);
    }

    expect(status, `Request without auth should return 401, got ${status}`).toBe(401);

    const body = json as { ok: boolean; code: string };
    expect(body.ok, 'Error response should have ok=false').toBe(false);
    expect(body.code, 'Error code should be UNAUTH').toBe('UNAUTH');

    console.log('[Auth Gate] SUCCESS: 401 returned for unauthorized request');
  });

  /**
   * AUTH TEST: Unarchive without Authorization returns 401
   */
  test('unarchive without Authorization returns 401', async ({ request }) => {
    console.log('[Auth Gate] Testing unauthorized unarchive request');

    const response = await request.post(`${BASE_URL}/api/v2/admin/events/some-id/unarchive`, {
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

    logRequestId(headers, 'POST /api/v2/admin/events/:id/unarchive (no auth)');

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
