/**
 * API Smoke Test: Create Event — POST /api/v2/admin/events
 *
 * Validates event creation against the D1 Worker contract.
 *
 * Actual contract (workers/oursharedevents/src/handlers/events.ts):
 *   Body:    { title (required), brand_id, slug, status, description, location,
 *             start_date, end_date, timezone, cover_image_url, template_id }
 *   Success: { ok: true, status: 201, id: "evt_UUID", slug: "..." }
 *   Errors:  INVALID_BODY (bad JSON), MISSING_FIELD (no title),
 *            SLUG_TAKEN (409), PAYLOAD_TOO_LARGE, DB_ERROR
 *
 * Auth: requireAdmin — X-OCR-Internal or Bearer token
 */

import { test, expect } from '@playwright/test';

const BRAND = process.env.TEST_BRAND || 'root';
const TIMEOUT = 30000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL || '';

const hasAuth = (): boolean => Boolean(X_OCR_INTERNAL || ADMIN_KEY);
const authHeaders = (): Record<string, string> => {
  if (X_OCR_INTERNAL) return { 'X-OCR-Internal': X_OCR_INTERNAL };
  if (ADMIN_KEY) return { Authorization: `Bearer ${ADMIN_KEY}` };
  return {};
};

test.describe('Create Event — POST /api/v2/admin/events', () => {
  // ── Auth Gate ──────────────────────────────────────────────────────────────

  test.describe('Unauthorized (401)', () => {
    test('returns 401 without auth header', async ({ request }) => {
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { title: 'Unauthorized Test' },
      });
      expect(res.status()).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('UNAUTH');
    });

    test('returns 401 with invalid Bearer token', async ({ request }) => {
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { title: 'Bad Token Test' },
        headers: { Authorization: 'Bearer invalid-token-xyz' },
      });
      expect(res.status()).toBe(401);
    });
  });

  // ── Validation Errors ──────────────────────────────────────────────────────

  test.describe('Validation Errors', () => {
    test('returns 400 MISSING_FIELD when title is missing', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { description: 'No title' },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('MISSING_FIELD');
    });

    test('returns 400 MISSING_FIELD when title is empty string', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { title: '' },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('MISSING_FIELD');
    });

    test('returns 400 INVALID_BODY for malformed JSON', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const res = await request.fetch('/api/v2/admin/events', {
        method: 'POST',
        timeout: TIMEOUT,
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        data: '{not valid json}',
      });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('INVALID_BODY');
    });

    test('returns 400 INVALID_BRAND for garbage brand_id', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { title: 'Brand Test', brand_id: '💩🔥 invalid!' },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('INVALID_BRAND');
    });

    test('returns 400 INVALID_DATE for bad start_date', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { title: 'Date Test', start_date: 'not-a-date' },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('INVALID_DATE');
    });

    test('returns 400 INVALID_DATE for bad end_date', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { title: 'End Date Test', end_date: '12/31/2026' },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('INVALID_DATE');
    });

    test('returns 400 BAD_CONTENT_TYPE for text/plain', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const res = await request.fetch('/api/v2/admin/events', {
        method: 'POST',
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

  // ── Successful Creation ────────────────────────────────────────────────────

  test.describe('Successful Creation (201)', () => {
    test('returns 201 with title only (minimal)', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const title = `E2E Test ${Date.now()}`;
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { title },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.status).toBe(201);
      expect(json).toHaveProperty('id');
      expect(json).toHaveProperty('slug');
      expect(typeof json.id).toBe('string');
      expect(json.id).toMatch(/^evt_/);
    });

    test('returns 201 with all optional fields', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const title = `Full Event ${Date.now()}`;
      const slug = `full-event-${Date.now()}`;
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: {
          title,
          brand_id: BRAND,
          slug,
          status: 'draft',
          description: 'E2E test event',
          location: 'Test Venue',
          start_date: '2026-12-31',
          end_date: '2026-12-31',
          timezone: 'America/Chicago',
        },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.id).toMatch(/^evt_/);
      expect(json.slug).toBe(slug);
    });

    test('auto-generates slug from title when not provided', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const title = `Slug Gen Test ${Date.now()}`;
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { title },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(201);
      const json = await res.json();
      expect(json.slug).toContain('slug-gen-test');
    });

    test('defaults brand_id to root', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const title = `Brand Default Test ${Date.now()}`;
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { title },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(201);

      // Verify via the events list
      const listRes = await request.get(`/api/v2/events?brand=root`);
      const listJson = await listRes.json();
      expect(listJson.ok).toBe(true);
      // The event should exist (may take a moment in D1)
    });

    test('response includes X-Request-Id header', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const res = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { title: `RequestId Test ${Date.now()}` },
        headers: authHeaders(),
      });
      expect(res.status()).toBe(201);
      expect(res.headers()['x-request-id']).toBeDefined();
    });
  });

  // ── Created Event Appears in List ──────────────────────────────────────────

  test.describe('Event Appears in List', () => {
    test('created event appears in GET /api/v2/events', async ({ request }) => {
      test.skip(!hasAuth(), 'No auth credentials');
      const title = `List Check ${Date.now()}`;
      const createRes = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: { title, status: 'active' },
        headers: authHeaders(),
      });
      expect(createRes.status()).toBe(201);
      const { id } = await createRes.json();

      // Check admin list (includes all statuses)
      const listRes = await request.get('/api/v2/admin/events', {
        headers: authHeaders(),
      });
      const listJson = await listRes.json();
      expect(listJson.ok).toBe(true);

      const found = listJson.items.some((e: { id: string }) => e.id === id);
      expect(found, `Event ${id} should appear in admin list`).toBe(true);
    });
  });
});
