/**
 * Stage-2 Smoke Tests: Story C4 Admin Update Event
 *
 * Tests the PUT /api/v2/admin/events/:id endpoint.
 * Validates event updates with partial update semantics.
 *
 * Story C4 Acceptance Criteria:
 * - Update returns 200 with updated item
 * - Not found returns 404 stable JSON
 * - Partial update allowed: unset fields remain unchanged
 *
 * Request contract:
 * {
 *   "name": "Updated Name",
 *   "brand": "root",
 *   "startDateISO": "2025-12-31",
 *   "slug": "updated-slug"
 * }
 *
 * Response contract:
 * { "ok": true, "status": 200, "item": { "id": "...", "name": "...", ... } }
 *
 * @see worker/src/handlers/v2AdminUpdateEvent.ts
 * @see Story C4 - Admin Endpoint: Update Event (Minimal)
 */

import { test, expect } from '@playwright/test';

// Brand to test
const BRAND = process.env.TEST_BRAND || 'root';
const TIMEOUT = 30000;

// Admin key for authorized requests (from environment)
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || '';

// CI/CD internal auth secret (X-OCR-Internal header)
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL || '';

/** Check if any auth credentials are configured */
const hasAuthCredentials = (): boolean => Boolean(X_OCR_INTERNAL || ADMIN_KEY);

/** Get auth headers — prefers X-OCR-Internal, falls back to Bearer */
const getAuthHeaders = (): Record<string, string> => {
  if (X_OCR_INTERNAL) return { 'X-OCR-Internal': X_OCR_INTERNAL };
  if (ADMIN_KEY) return { Authorization: `Bearer ${ADMIN_KEY}` };
  return {};
};

test.describe('Story C4: Admin Update Event - PUT /api/v2/admin/events/:id', () => {
  test.describe('Unauthorized Requests', () => {
    test('returns 401 when Authorization header is missing', async ({ request }) => {
      const response = await request.put(`/api/v2/admin/events/evt-test-12345`, {
        timeout: TIMEOUT,
        data: {
          name: 'Updated Event Name',
        },
      });

      expect(response.status()).toBe(401);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('UNAUTH');
    });

    test('returns 401 with invalid token', async ({ request }) => {
      const response = await request.put(`/api/v2/admin/events/evt-test-12345`, {
        timeout: TIMEOUT,
        data: {
          name: 'Updated Event Name',
        },
        headers: {
          Authorization: 'Bearer invalid-token-12345',
        },
      });

      expect(response.status()).toBe(401);
    });
  });

  test.describe('Not Found Handling (AC: Not found returns 404 stable JSON)', () => {
    test('returns 404 when event does not exist', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const nonExistentId = `evt-nonexistent-${Date.now()}`;

      const response = await request.put(`/api/v2/admin/events/${nonExistentId}`, {
        timeout: TIMEOUT,
        data: {
          name: 'Updated Name',
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(404);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.status).toBe(404);
      expect(json.code).toBe('NOT_FOUND');
      expect(json).toHaveProperty('message');
      expect(json).toHaveProperty('requestId');
    });

    test('404 response has stable JSON structure', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const nonExistentId = `evt-stable-404-${Date.now()}`;

      const response = await request.put(`/api/v2/admin/events/${nonExistentId}`, {
        timeout: TIMEOUT,
        data: {
          name: 'Updated Name',
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(404);

      const json = await response.json();

      // Verify stable JSON structure
      expect(json).toMatchObject({
        ok: false,
        status: 404,
        code: 'NOT_FOUND',
      });
      expect(typeof json.message).toBe('string');
      expect(typeof json.requestId).toBe('string');
    });
  });

  test.describe('Validation Errors', () => {
    test('returns 400 when name is empty string', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      // First create an event to update
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Validation Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const createJson = await createResponse.json();
      const eventId = createJson.item.id;

      // Try to update with empty name
      const response = await request.put(`/api/v2/admin/events/${eventId}`, {
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
      expect(json.code).toBe('BAD_INPUT');
    });

    test('returns 400 when startDateISO has invalid format', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      // First create an event to update
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Date Validation Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const createJson = await createResponse.json();
      const eventId = createJson.item.id;

      // Try to update with invalid date
      const response = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          startDateISO: 'not-a-date',
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('BAD_INPUT');
      expect(json.message).toContain('YYYY-MM-DD');
    });

    test('returns 400 when brand is invalid', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      // First create an event to update
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Brand Validation Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const createJson = await createResponse.json();
      const eventId = createJson.item.id;

      // Try to update with invalid brand
      const response = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
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

    test('returns 400 when Content-Type is not application/json', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const response = await request.fetch(`/api/v2/admin/events/evt-test-12345`, {
        method: 'PUT',
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

  test.describe('Successful Event Update (AC: Update returns 200 with updated item)', () => {
    test('returns 200 when updating event name', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const originalName = `Original Name ${Date.now()}`;
      const updatedName = `Updated Name ${Date.now()}`;

      // Create an event
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: originalName,
          brand: BRAND,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const createJson = await createResponse.json();
      const eventId = createJson.item.id;

      // Update the event name
      const updateResponse = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          name: updatedName,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(updateResponse.status()).toBe(200);

      const updateJson = await updateResponse.json();
      expect(updateJson.ok).toBe(true);
      expect(updateJson.status).toBe(200);
      expect(updateJson).toHaveProperty('item');
      expect(updateJson.item.id).toBe(eventId);
      expect(updateJson.item.name).toBe(updatedName);
    });

    test('returns updated item with all required fields', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      // Create an event
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Fields Test ${Date.now()}`,
          brand: BRAND,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const createJson = await createResponse.json();
      const eventId = createJson.item.id;

      // Update the event
      const updateResponse = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          name: `Fields Test Updated ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(updateResponse.status()).toBe(200);

      const updateJson = await updateResponse.json();
      const item = updateJson.item;

      // Required fields
      expect(item).toHaveProperty('id');
      expect(typeof item.id).toBe('string');
      expect(item.id).toBe(eventId);

      expect(item).toHaveProperty('name');
      expect(typeof item.name).toBe('string');

      expect(item).toHaveProperty('brand');
      expect(typeof item.brand).toBe('string');

      expect(item).toHaveProperty('slug');
      expect(typeof item.slug).toBe('string');

      expect(item).toHaveProperty('createdAt');
      expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      expect(item).toHaveProperty('updatedAt');
      expect(item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('partial update preserves unset fields', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const originalName = `Partial Update Test ${Date.now()}`;
      const originalSlug = `partial-update-slug-${Date.now()}`;
      const updatedName = `Partial Update Updated ${Date.now()}`;

      // Create an event with multiple fields
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: originalName,
          brand: BRAND,
          slug: originalSlug,
          startDateISO: '2025-06-15',
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const createJson = await createResponse.json();
      const eventId = createJson.item.id;

      // Update only the name (leave other fields unchanged)
      const updateResponse = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          name: updatedName,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(updateResponse.status()).toBe(200);

      const updateJson = await updateResponse.json();
      const item = updateJson.item;

      // Name should be updated
      expect(item.name).toBe(updatedName);

      // Other fields should be preserved
      expect(item.brand).toBe(BRAND);
      expect(item.slug).toBe(originalSlug);
      expect(item.startDateISO).toBe('2025-06-15');
    });

    test('can update multiple fields at once', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      // Create an event
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Multi-Update Test ${Date.now()}`,
          brand: BRAND,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const createJson = await createResponse.json();
      const eventId = createJson.item.id;

      const newName = `Multi-Update Complete ${Date.now()}`;
      const newSlug = `multi-update-slug-${Date.now()}`;
      const newDate = '2025-12-25';

      // Update multiple fields at once
      const updateResponse = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          name: newName,
          slug: newSlug,
          startDateISO: newDate,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(updateResponse.status()).toBe(200);

      const updateJson = await updateResponse.json();
      const item = updateJson.item;

      expect(item.name).toBe(newName);
      expect(item.slug).toBe(newSlug);
      expect(item.startDateISO).toBe(newDate);
    });

    test('updatedAt timestamp is updated', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      // Create an event
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Timestamp Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const createJson = await createResponse.json();
      const eventId = createJson.item.id;
      const originalUpdatedAt = createJson.item.updatedAt;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the event
      const updateResponse = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          name: `Timestamp Test Updated ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(updateResponse.status()).toBe(200);

      const updateJson = await updateResponse.json();
      const newUpdatedAt = updateJson.item.updatedAt;

      // updatedAt should be different (newer)
      expect(newUpdatedAt).not.toBe(originalUpdatedAt);
      expect(new Date(newUpdatedAt).getTime()).toBeGreaterThan(
        new Date(originalUpdatedAt).getTime()
      );
    });
  });

  test.describe('Integration: Create → Update → List (SDET AC)', () => {
    test('create → update name → list shows updated name', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      const originalName = `Integration Test Original ${Date.now()}`;
      const updatedName = `Integration Test Updated ${Date.now()}`;

      // Step 1: Create an event
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: originalName,
          brand: BRAND,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const createJson = await createResponse.json();
      const eventId = createJson.item.id;

      // Step 2: Update the event name
      const updateResponse = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          name: updatedName,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(updateResponse.status()).toBe(200);
      expect((await updateResponse.json()).item.name).toBe(updatedName);

      // Step 3: Fetch the events list
      const listResponse = await request.get(`/api/v2/events?brand=${BRAND}`);
      expect(listResponse.status()).toBe(200);

      const listJson = await listResponse.json();
      expect(listJson.ok).toBe(true);
      expect(Array.isArray(listJson.items)).toBe(true);

      // Step 4: Find the event and verify updated name
      const foundEvent = listJson.items.find((item: { id: string }) => item.id === eventId);
      expect(foundEvent).toBeDefined();
      expect(foundEvent.name).toBe(updatedName);
    });
  });

  test.describe('Response Headers', () => {
    test('returns X-Request-Id header on success', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      // Create an event
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Header Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const eventId = (await createResponse.json()).item.id;

      // Update the event
      const updateResponse = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          name: `Header Test Updated ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(updateResponse.status()).toBe(200);

      const headers = updateResponse.headers();
      expect(headers['x-request-id']).toBeDefined();
      expect(headers['x-request-id'].length).toBeGreaterThan(0);
    });

    test('returns application/json content type', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      // Create an event
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Content Type Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const eventId = (await createResponse.json()).item.id;

      // Update the event
      const updateResponse = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          name: `Content Type Test Updated ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(updateResponse.status()).toBe(200);

      const headers = updateResponse.headers();
      expect(headers['content-type']).toContain('application/json');
    });

    test('returns cache-control header preventing caching', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      // Create an event
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `Cache Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const eventId = (await createResponse.json()).item.id;

      // Update the event
      const updateResponse = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          name: `Cache Test Updated ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(updateResponse.status()).toBe(200);

      const headers = updateResponse.headers();
      expect(headers['cache-control']).toContain('no-cache');
    });
  });

  test.describe('CORS Support', () => {
    test('success response includes CORS headers', async ({ request }) => {
      test.skip(!hasAuthCredentials(), 'No auth credentials configured');

      // Create an event
      const createResponse = await request.post(`/api/v2/admin/events`, {
        timeout: TIMEOUT,
        data: {
          name: `CORS Test ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(createResponse.status()).toBe(201);
      const eventId = (await createResponse.json()).item.id;

      // Update the event
      const updateResponse = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          name: `CORS Test Updated ${Date.now()}`,
        },
        headers: {
          ...getAuthHeaders(),
        },
      });

      expect(updateResponse.status()).toBe(200);

      const headers = updateResponse.headers();
      expect(headers['access-control-allow-origin']).toBeDefined();
    });

    test('error response includes CORS headers', async ({ request }) => {
      const response = await request.put(`/api/v2/admin/events/evt-test-12345`, {
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
});
