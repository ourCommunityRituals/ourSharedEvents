/**
 * API Smoke Test: Events V2 (/api/v2/events)
 *
 * Validates the D1-backed events list endpoint against staging.
 *
 * Actual contract (workers/oursharedevents/src/handlers/events.ts):
 * Success: { "ok": true, "status": 200, "items": [...] }
 * Error:   { "ok": false, "status": 503, "code": "DB_ERROR", "error": "...", "requestId": "...", "timestamp": "..." }
 *
 * Items use D1 column names: id, brand_id, title, slug, status, description,
 * location, start_date, end_date, timezone, cover_image_url, created_at, updated_at
 *
 * Headers: X-Request-Id, Cache-Control (private, max-age=60, stale-while-revalidate=300)
 */

import { test, expect } from '@playwright/test';

const BRAND = process.env.TEST_BRAND || 'root';

test.describe('Events V2 API (/api/v2/events)', () => {
  test.describe('Success Path', () => {
    test('GET /api/v2/events returns HTTP 200', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      expect(response.status()).toBe(200);
    });

    test('returns valid JSON envelope { ok, status, items }', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      expect(response.ok()).toBe(true);

      const json = await response.json();

      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(true);

      expect(json).toHaveProperty('status');
      expect(json.status).toBe(200);

      expect(json).toHaveProperty('items');
      expect(Array.isArray(json.items)).toBe(true);
    });

    test('items array contains valid event objects when populated', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const json = await response.json();

      if (json.items.length > 0) {
        const item = json.items[0];

        // D1 column names
        expect(item).toHaveProperty('id');
        expect(typeof item.id).toBe('string');

        expect(item).toHaveProperty('slug');
        expect(typeof item.slug).toBe('string');

        expect(item).toHaveProperty('title');
        expect(typeof item.title).toBe('string');

        expect(item).toHaveProperty('brand_id');
        expect(typeof item.brand_id).toBe('string');

        expect(item).toHaveProperty('status');
        expect(item.status).toBe('active'); // Only active events on public endpoint
      }
    });

    test('items is always an array (empty or populated)', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const json = await response.json();
      expect(Array.isArray(json.items)).toBe(true);
    });

    test('defaults to brand=root when no brand param', async ({ request }) => {
      const response = await request.get('/api/v2/events');
      expect(response.status()).toBe(200);

      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.items)).toBe(true);
    });
  });

  test.describe('Response Headers', () => {
    test('returns application/json content-type', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('returns X-Request-Id header', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      expect(response.headers()['x-request-id']).toBeDefined();
    });

    test('returns Cache-Control with max-age for success', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      if (response.ok()) {
        const cc = response.headers()['cache-control'];
        expect(cc).toBeDefined();
        expect(cc).toContain('max-age');
      }
    });
  });

  test.describe('Single Event Endpoint', () => {
    test('GET /api/v2/events/:id returns 404 for nonexistent ID', async ({ request }) => {
      const response = await request.get('/api/v2/events/evt_nonexistent_000');
      expect(response.status()).toBe(404);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('NOT_FOUND');
      expect(json).toHaveProperty('requestId');
      expect(json).toHaveProperty('timestamp');
    });
  });

  test.describe('Response Time', () => {
    test('responds within 15 seconds', async ({ request }) => {
      const start = Date.now();
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const duration = Date.now() - start;

      expect(response.ok()).toBe(true);
      expect(duration).toBeLessThan(15_000);
    });
  });

  test.describe('CI/CD Gate Validation', () => {
    test('all required fields present for CI gate', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const json = await response.json();

      for (const field of ['ok', 'status', 'items']) {
        expect(json).toHaveProperty(field);
      }

      expect(typeof json.ok).toBe('boolean');
      expect(Array.isArray(json.items)).toBe(true);
    });

    test('passes CI gate (ok=true and items is array)', async ({ request }) => {
      const response = await request.get(`/api/v2/events?brand=${BRAND}`);
      const json = await response.json();

      expect(json.ok).toBe(true);
      expect(Array.isArray(json.items)).toBe(true);
    });
  });
});
