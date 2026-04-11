/**
 * Stage-2 Smoke Tests: Story C3 Admin Create Event
 *
 * Tests the POST /api/v2/admin/events endpoint.
 * Validates event creation with simplified validation (name only required).
 *
 * Story C3 Acceptance Criteria:
 * - Authorized create returns 201
 * - New event appears in /api/v2/events?brand=root within the same run
 * - Unauthorized create returns 401
 *
 * Request contract:
 * {
 *   "brand": "root",
 *   "name": "My Event",
 *   "startDateISO": "2025-12-31",
 *   "slug": "my-event",
 *   "seedMode": "random",
 *   "elimType": "single"
 * }
 *
 * Response contract:
 * { "ok": true, "status": 201, "item": { "id": "...", "name": "...", ... } }
 *
 * @see worker/src/handlers/v2AdminCreateEvent.ts
 * @see Story C3 - Admin Endpoint: Create Event
 */

import { test, expect } from '@playwright/test';

// Brand to test
const BRAND = process.env.TEST_BRAND || 'root';
const TIMEOUT = 30000;

// Admin key for authorized requests (from environment)
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || '';

// CI/CD internal auth secret (X-OCR-Internal header)
const OCR_INTERNAL_SECRET = process.env.OCR_INTERNAL_SECRET || '';

/** Check if any auth credentials are configured */
const hasAuthCredentials = (): boolean => Boolean(OCR_INTERNAL_SECRET || ADMIN_KEY);

/** Get auth headers — prefers X-OCR-Internal, falls back to Bearer */
const getAuthHeaders = (): Record<string, string> => {
  if (OCR_INTERNAL_SECRET) return { 'X-OCR-Internal': OCR_INTERNAL_SECRET };
  if (ADMIN_KEY) return { Authorization: `Bearer ${ADMIN_KEY}` };
  return {};
};

test.describe('Story C3: Admin Create Event - POST /api/v2/admin/events', () => {
  test.describe('Unauthorized Requests (AC: Unauthorized create returns 401)', () => {
    test('returns 401 when Authorization header is missing', async ({ request }) => {
      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: 'Test Event',
        },
      });

      expect(response.status()).toBe(401);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('UNAUTH');
    });

    test('returns 401 with invalid token', async ({ request }) => {
      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: 'Test Event',
        },
        headers: {
          Authorization: 'Bearer invalid-token-12345',
        },
      });

      expect(response.status()).toBe(401);
    });
  });

  test.describe('Validation Errors', () => {
    test('returns 400 when name is missing', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          brand: BRAND,
          startDateISO: '2025-12-31',
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('NAME_REQUIRED');
      expect(json.message).toContain('name');
    });

    test('returns 400 when name is empty string', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: '',
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('NAME_REQUIRED');
    });

    test('returns 400 when startDateISO has invalid format', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: 'Test Event',
          startDateISO: 'not-a-date',
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('BAD_START_DATE');
      expect(json.message).toContain('YYYY-MM-DD');
    });

    test('returns 400 when brand is invalid', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: 'Test Event',
          brand: 'invalid-brand-xyz',
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('BAD_INPUT');
      expect(json.message).toContain('Invalid brand');
    });

    test('returns 400 with BAD_JSON for invalid JSON body', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      // Use fetch directly to send raw invalid JSON
      const response = await request.fetch(`/api/v2/admin/events`, {
        method: 'POST',
        timeout: TIMEOUT,
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        data: '{not valid json}',
      });

      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('BAD_JSON');
    });

    test('returns 400 when Content-Type is not application/json', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const response = await request.fetch(`/api/v2/admin/events`, {
        method: 'POST',
        timeout: TIMEOUT,
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'text/plain',
        },
        data: JSON.stringify({ name: 'Test Event' }),
      });

      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json.code).toBe('BAD_INPUT');
      expect(json.message).toContain('Content-Type');
    });
  });

  test.describe('Successful Event Creation (AC: Authorized create returns 201)', () => {
    test('returns 201 with valid name only (minimal request)', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const uniqueName = `Test Event ${Date.now()}`;

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: uniqueName,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(201);

      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(json.status).toBe(201);
      expect(json).toHaveProperty('item');
    });

    test('returns created event with all required fields', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const uniqueName = `Test Event Fields ${Date.now()}`;

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: uniqueName,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(201);

      const json = await response.json();
      const item = json.item;

      // Required fields per Story C3 contract
      expect(item).toHaveProperty('id');
      expect(typeof item.id).toBe('string');
      expect(item.id).toMatch(/^evt-/);

      expect(item).toHaveProperty('name');
      expect(item.name).toBe(uniqueName);

      expect(item).toHaveProperty('brand');
      expect(typeof item.brand).toBe('string');

      expect(item).toHaveProperty('slug');
      expect(typeof item.slug).toBe('string');

      expect(item).toHaveProperty('createdAt');
      expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      expect(item).toHaveProperty('updatedAt');
      expect(item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('returns 201 with all optional fields provided', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const uniqueName = `Full Event ${Date.now()}`;

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: uniqueName,
          brand: BRAND,
          startDateISO: '2025-12-31',
          slug: `full-event-${Date.now()}`,
          seedMode: 'random',
          elimType: 'single',
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(201);

      const json = await response.json();
      const item = json.item;

      expect(item.name).toBe(uniqueName);
      expect(item.brand).toBe(BRAND);
      expect(item.startDateISO).toBe('2025-12-31');
      expect(item.seedMode).toBe('random');
      expect(item.elimType).toBe('single');
    });

    test('defaults brand to root when not provided', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const uniqueName = `Default Brand Event ${Date.now()}`;

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: uniqueName,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(201);

      const json = await response.json();
      expect(json.item.brand).toBe('root');
    });

    test('generates slug from name when not provided', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const uniqueName = `Slug Test Event ${Date.now()}`;

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: uniqueName,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(201);

      const json = await response.json();
      expect(json.item.slug).toContain('slug-test-event');
    });

    test('uses provided slug when specified', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const uniqueName = `Custom Slug Event ${Date.now()}`;
      const customSlug = `my-custom-slug-${Date.now()}`;

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: uniqueName,
          slug: customSlug,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(201);

      const json = await response.json();
      expect(json.item.slug).toBe(customSlug);
    });

    test('success response includes requestId in body', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const uniqueName = `RequestId Body Test ${Date.now()}`;

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: uniqueName,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(201);

      const json = await response.json();
      expect(json).toHaveProperty('requestId');
      expect(typeof json.requestId).toBe('string');
      expect(json.requestId.length).toBeGreaterThan(0);
    });
  });

  test.describe('Event Appears in List (AC: New event appears in /api/v2/events)', () => {
    test('created event appears in /api/v2/events list', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const uniqueName = `List Test Event ${Date.now()}`;

      // Create the event
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: uniqueName,
          brand: BRAND,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);

      const createJson = await createResponse.json();
      const createdEventId = createJson.item.id;

      // Fetch the events list
      const listResponse = await request.get(`/api/v2/events?brand=${BRAND}`);
      expect(listResponse.status()).toBe(200);

      const listJson = await listResponse.json();
      expect(listJson.ok).toBe(true);
      expect(Array.isArray(listJson.items)).toBe(true);

      // Find the created event in the list
      const foundEvent = listJson.items.find((item: { id: string }) => item.id === createdEventId);
      expect(foundEvent).toBeDefined();
      expect(foundEvent.name).toBe(uniqueName);
    });

    test('created event with full data appears correctly in list', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const uniqueName = `Full List Test Event ${Date.now()}`;

      // Create the event with all fields
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: uniqueName,
          brand: BRAND,
          startDateISO: '2025-12-31',
          slug: `full-list-test-${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);

      const createJson = await createResponse.json();
      const createdEventId = createJson.item.id;
      const createdSlug = createJson.item.slug;

      // Fetch the events list with full data
      const listResponse = await request.get(`/api/v2/events?brand=${BRAND}&full=true`);
      expect(listResponse.status()).toBe(200);

      const listJson = await listResponse.json();

      // Find the created event
      const foundEvent = listJson.items.find((item: { id: string }) => item.id === createdEventId);
      expect(foundEvent).toBeDefined();
      expect(foundEvent.slug).toBe(createdSlug);
    });
  });

  test.describe('Response Headers', () => {
    test('returns X-Request-Id header on success', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Header Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(201);

      const headers = response.headers();
      expect(headers['x-request-id']).toBeDefined();
      expect(headers['x-request-id'].length).toBeGreaterThan(0);
    });

    test('returns application/json content type', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Content Type Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(201);

      const headers = response.headers();
      expect(headers['content-type']).toContain('application/json');
    });

    test('returns cache-control header preventing caching', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Cache Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(201);

      const headers = response.headers();
      expect(headers['cache-control']).toContain('no-cache');
    });
  });

  test.describe('CORS Support', () => {
    test('success response includes CORS headers', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `CORS Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(201);

      const headers = response.headers();
      expect(headers['access-control-allow-origin']).toBeDefined();
    });

    test('error response includes CORS headers', async ({ request }) => {
      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: 'CORS Error Test',
        },
        // No auth header
      });

      expect(response.status()).toBe(401);

      const headers = response.headers();
      expect(headers['access-control-allow-origin']).toBeDefined();
    });
  });

  test.describe('Error Response Shape', () => {
    test('error responses include requestId', async ({ request }) => {
      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: 'Error Shape Test',
        },
      });

      expect(response.status()).toBe(401);

      const json = await response.json();
      expect(json).toHaveProperty('requestId');
      expect(typeof json.requestId).toBe('string');
    });

    test('validation error includes descriptive message', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const response = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {},
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json).toHaveProperty('message');
      expect(json.message.length).toBeGreaterThan(0);
    });
  });
});
