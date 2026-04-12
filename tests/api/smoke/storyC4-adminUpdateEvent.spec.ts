/**
 * API Smoke Test: Update Event — PUT /api/v2/admin/events/:id
 *
 * Validates event updates against the D1 Worker contract.
 *
 * Actual contract (workers/oursharedevents/src/handlers/events.ts):
 *   Body:    { title, description, location, start_date, end_date, timezone,
 *             cover_image_url, status, template_id } — only provided fields updated
 *   Success: { ok: true, status: 200, id: "eventId" }
 *   Errors:  INVALID_BODY (bad JSON), NO_FIELDS (nothing to update),
 *            NOT_FOUND (404), PAYLOAD_TOO_LARGE, DB_ERROR
 *
 * Auth: requireAdmin — X-OCR-Internal or Bearer token
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 30000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL || '';

const hasAuth = (): boolean => Boolean(X_OCR_INTERNAL || ADMIN_KEY);
const authHeaders = (): Record<string, string> => {
  if (X_OCR_INTERNAL) return { 'X-OCR-Internal': X_OCR_INTERNAL };
  if (ADMIN_KEY) return { Authorization: `Bearer ${ADMIN_KEY}` };
  return {};
};

/** Create a test event and return its ID */
async function createTestEvent(request: any): Promise<string> {
  const res = await request.post('/api/v2/admin/events', {
    timeout: TIMEOUT,
    data: { title: `Update Test ${Date.now()}`, status: 'draft' },
    headers: authHeaders(),
  });
  const json = await res.json();
  return json.id;
}

test.describe('Update Event — PUT /api/v2/admin/events/:id', () => {
  // ── Auth Gate ──────────────────────────────────────────────────────────────

  test.describe('Unauthorized (401)', () => {
    test('returns 401 without auth header', async ({ request }) => {
      const res = await request.put('/api/v2/admin/events/evt_fake_id', {
        timeout: TIMEOUT,
        data: { title: 'Unauthorized' },
      });
      expect(res.status()).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('UNAUTH');
    });
  });

  // ── Not Found ──────────────────────────────────────────────────────────────

  test.describe('Not Found (404)', () => {
    test('returns 404 for nonexistent event ID', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const res = await request.put('/api/v2/admin/events/evt_does_not_exist', {
        timeout: TIMEOUT,
        data: { title: 'Ghost Event' },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('NOT_FOUND');
      expect(json).toHaveProperty('requestId');
    });
  });

  // ── Validation Errors ──────────────────────────────────────────────────────

  test.describe('Validation Errors', () => {
    test('returns 400 INVALID_BODY for malformed JSON', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const res = await request.fetch('/api/v2/admin/events/evt_fake', {
        method: 'PUT',
        timeout: TIMEOUT,
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        data: '{broken json',
      });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('INVALID_BODY');
    });

    test('returns 400 NO_FIELDS when body has no updatable fields', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const eventId = await createTestEvent(request);

      const res = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: { random_field: 'not a real field' },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('NO_FIELDS');
    });

    test('returns 400 INVALID_DATE for bad start_date', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const eventId = await createTestEvent(request);

      const res = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: { start_date: 'not-a-date' },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('INVALID_DATE');
    });

    test('returns 400 INVALID_DATE for bad end_date', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const eventId = await createTestEvent(request);

      const res = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: { end_date: '12/31/2026' },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('INVALID_DATE');
    });

    test('returns 400 BAD_CONTENT_TYPE for text/plain', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const res = await request.fetch('/api/v2/admin/events/evt_fake', {
        method: 'PUT',
        timeout: TIMEOUT,
        headers: { ...authHeaders(), 'Content-Type': 'text/plain' },
        data: JSON.stringify({ title: 'CT Test' }),
      });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('BAD_CONTENT_TYPE');
    });
  });

  // ── Successful Update ──────────────────────────────────────────────────────

  test.describe('Successful Update (200)', () => {
    test('returns 200 when updating title', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const eventId = await createTestEvent(request);

      const res = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: { title: `Updated Title ${Date.now()}` },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.status).toBe(200);
      expect(json.id).toBe(eventId);
    });

    test('returns 200 when updating description', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const eventId = await createTestEvent(request);

      const res = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: { description: 'Updated description via E2E' },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.id).toBe(eventId);
    });

    test('returns 200 when updating multiple fields', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const eventId = await createTestEvent(request);

      const res = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: {
          title: `Multi-Update ${Date.now()}`,
          location: 'Updated Venue',
          start_date: '2026-06-15',
          timezone: 'America/New_York',
        },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('can set a field to null', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const eventId = await createTestEvent(request);

      const res = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: { description: null },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(200);
    });

    test('can change status to archived', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const eventId = await createTestEvent(request);

      const res = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: { status: 'archived' },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(200);
    });

    test('response includes X-Request-Id header', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const eventId = await createTestEvent(request);

      const res = await request.put(`/api/v2/admin/events/${eventId}`, {
        timeout: TIMEOUT,
        data: { title: `Header Test ${Date.now()}` },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(200);
      expect(res.headers()['x-request-id']).toBeDefined();
    });
  });
});
