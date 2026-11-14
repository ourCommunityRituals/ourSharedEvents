/**
 * Story C5: Create Event Smoke Gate Test
 * Story D4: Replace Admin Key with Cloudflare Access
 *
 * CI Stage-2 contract gate that validates:
 * 1. POST create event with Cloudflare Access Service Token returns 201
 * 2. GET list returns the created event
 * 3. Pipeline fails fast if either step fails
 *
 * Purpose / Value:
 *   Every staging deploy either proves the product works or it doesn't ship.
 *
 * Acceptance Criteria:
 *   Stage-2 fails fast if:
 *   - Create fails (POST /api/v2/admin/events)
 *   - List missing created event (GET /api/v2/events)
 *
 * Authentication (Story D4):
 *   Uses Cloudflare Access Service Token for CI/CD authentication.
 *   Headers: CF-Access-Client-Id, CF-Access-Client-Secret
 *
 * Environment Variables (injected by CI, never printed):
 *   BASE_URL=https://stg.oursharedevents.com
 *   CF_ACCESS_CLIENT_ID=<secret>
 *   CF_ACCESS_CLIENT_SECRET=<secret>
 *
 * @see Story C5 - CI Stage-2: Health + Create-Event Smoke Gate
 * @see Story D4 - Replace Admin Key with Cloudflare Access
 */

import { test, expect } from '@playwright/test';

// =============================================================================
// Configuration
// =============================================================================

/** Brand used for gate test */
const BRAND = 'root';

/** Timeout for API requests (staging cold start tolerance) */
const TIMEOUT = 30000;

/**
 * Cloudflare Access Service Token credentials (Story D4)
 * Used for CI/CD authentication to admin endpoints
 */
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

/**
 * Check if Cloudflare Access is configured
 * Both Client ID and Secret are required for service token auth
 */
const hasAccessCredentials = (): boolean => Boolean(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET);

/**
 * Get Cloudflare Access headers for authenticated requests
 * @returns Headers object with CF-Access-Client-Id and CF-Access-Client-Secret
 */
const getAccessHeaders = (): Record<string, string> => ({
  'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
  'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
});

/** Unique prefix for gate test events (easy to identify/cleanup) */
const GATE_EVENT_PREFIX = 'C5-Gate-Test';

// =============================================================================
// Test Suite
// =============================================================================

test.describe('Story C5: Create Event Smoke Gate', () => {
  /**
   * Main gate test: Create event and verify it appears in list
   *
   * This is the primary CI gate test. It must:
   * 1. Create an event via POST /api/v2/admin/events (with CF Access auth)
   * 2. Verify the event appears in GET /api/v2/events
   *
   * If either step fails, the staging deploy is considered invalid.
   */
  test('POST create event + GET list verification gate', async ({ request }) => {
    // Skip if CF Access credentials not configured (test will be marked as skipped, not failed)
    test.skip(
      !hasAccessCredentials(),
      'CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET not configured - cannot run gate test'
    );

    // Generate unique event name with timestamp
    const timestamp = Date.now();
    const uniqueName = `${GATE_EVENT_PREFIX}-${timestamp}`;
    const uniqueSlug = `c5-gate-test-${timestamp}`;

    // =========================================================================
    // Step 1: POST create event with Cloudflare Access Service Token
    // =========================================================================
    console.log(`[C5 Gate] Creating event: ${uniqueName}`);

    const createResponse = await request.post('/api/v2/admin/events', {
      timeout: TIMEOUT,
      data: {
        attendance_mode: 'in_person',
        location: 'Test Hall',
        title: uniqueName,
        brand_id: BRAND,
        slug: uniqueSlug,
        status: 'active',
        // OSE-1560: a new event is off the map unless asked; the gate reads the public list.
        is_published: true,
      },
      headers: getAccessHeaders(),
    });

    // Assert: Create returns 201
    expect(
      createResponse.status(),
      `Create event should return 201, got ${createResponse.status()}`
    ).toBe(201);

    const createJson = await createResponse.json();

    // Assert: Response structure — Worker returns { ok, status, id, slug }
    expect(createJson.ok, 'Create response should have ok=true').toBe(true);
    expect(createJson.id, 'Created event should have id').toBeDefined();
    expect(createJson.id).toMatch(/^evt_/);
    expect(createJson.slug, 'Created event should have slug').toBe(uniqueSlug);

    const createdEventId = createJson.id;
    console.log(`[C5 Gate] Event created: ${createdEventId}`);

    // =========================================================================
    // Step 2: GET list and assert created event appears
    // =========================================================================
    console.log(`[C5 Gate] Verifying event in list...`);

    const listResponse = await request.get(`/api/v2/events?brand=${BRAND}`, {
      timeout: TIMEOUT,
    });

    // Assert: List returns 200
    expect(
      listResponse.status(),
      `List events should return 200, got ${listResponse.status()}`
    ).toBe(200);

    const listJson = await listResponse.json();

    // Assert: List response structure
    expect(listJson.ok, 'List response should have ok=true').toBe(true);
    expect(Array.isArray(listJson.items), 'List response should have items array').toBe(true);

    // Assert: Created event appears in list
    const foundEvent = listJson.items.find((item: { id: string }) => item.id === createdEventId);

    expect(foundEvent, `Created event ${createdEventId} should appear in list`).toBeDefined();

    expect(foundEvent.title, 'Event title in list should match created title').toBe(uniqueName);

    console.log(`[C5 Gate] PASSED: Event ${createdEventId} verified in list`);
  });

  /**
   * Unauthorized request gate: Verify 401 without authentication
   *
   * Story D4: Requests without Cloudflare Access JWT should return 401.
   * This ensures the auth gate is working in staging.
   */
  test('POST without Cloudflare Access headers returns 401', async ({ request }) => {
    const response = await request.post('/api/v2/admin/events', {
      timeout: TIMEOUT,
      data: {
        attendance_mode: 'in_person',
        location: 'Test Hall',
        name: 'Unauthorized Test Event',
      },
      // No CF-Access headers - should fail auth
    });

    // Assert: Unauthorized returns 401
    expect(
      response.status(),
      `Request without auth should return 401, got ${response.status()}`
    ).toBe(401);

    const json = await response.json();
    expect(json.ok, 'Error response should have ok=false').toBe(false);
    expect(json.code, 'Error code should be UNAUTH').toBe('UNAUTH');
  });

  /**
   * Health endpoint gate: Verify /health is accessible
   *
   * Supplementary check — the health endpoint used by CI curl gate.
   */
  test('GET /health returns ok=true', async ({ request }) => {
    const response = await request.get('/health', {
      timeout: TIMEOUT,
    });

    // Assert: Health returns 200
    expect(response.status(), `Health endpoint should return 200, got ${response.status()}`).toBe(
      200
    );

    const json = await response.json();

    // Assert: ok == true and db is healthy
    expect(json.ok, 'Health response should have ok=true').toBe(true);
    expect(json.db, 'D1 should be reachable').toBe('ok');
  });
});

// =============================================================================
// Cleanup Note
// =============================================================================
// Per Story C5: Cleanup is optional for MVP.
// Gate test events are prefixed with 'C5-Gate-Test-' for easy identification.
// If cleanup is needed, implement a separate cleanup job or afterAll hook.
