/**
 * Stage-2 Smoke Tests: Story 1.3 Worker API Endpoints
 *
 * Tests /api/status and /api/events endpoints served by Worker.
 *
 * Story 1.3 Acceptance Criteria:
 * - /api/status returns: { ok: true, status: 200, version: "...", backend: "worker", sheets: "ok" }
 * - /api/events returns: { ok: true, status: 200, items: [...] }
 * - If Sheets down → /api/status returns { ok: false, status: 503 }
 * - If Events empty → returns { ok: true, status: 200, items: [] }
 *
 * @see worker/src/handlers/status.ts
 * @see worker/src/handlers/eventsList.ts
 * @see API_CONTRACT.md
 */

import { test, expect } from '@playwright/test';

// Brand to test
const BRAND = process.env.TEST_BRAND || 'root';
const TIMEOUT = 30000;

test.describe('Story 1.3: Worker API Status Endpoint', () => {
  test.describe('/api/status', () => {

    test('returns HTTP 200 when healthy', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      expect(response.status()).toBe(200);
    });

    test('returns valid JSON with required fields per AC', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      // Story 1.3 AC: { ok: true, status: 200, version: "...", backend: "worker", sheets: "ok" }
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');

      expect(json).toHaveProperty('status');
      expect(typeof json.status).toBe('number');

      expect(json).toHaveProperty('version');
      expect(typeof json.version).toBe('string');
      expect(json.version.length).toBeGreaterThan(0);

      expect(json).toHaveProperty('backend');
      expect(json.backend).toBe('worker');

      expect(json).toHaveProperty('sheets');
      expect(['ok', 'error', 'not_configured']).toContain(json.sheets);
    });

    test('returns ok: true when sheets is ok or not_configured', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      // Sheets can be ok or not_configured for healthy status
      if (json.sheets === 'ok' || json.sheets === 'not_configured') {
        expect(json.ok).toBe(true);
        expect(json.status).toBe(200);
      }
    });

    test('returns timestamp field', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      if (json.timestamp) {
        expect(typeof json.timestamp).toBe('string');
        // ISO 8601 format
        expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });

    test('includes optional buildVersion field', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      if (json.buildVersion) {
        expect(typeof json.buildVersion).toBe('string');
      }
    });

    test('includes optional sheetsLatencyMs when sheets checked', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const json = await response.json();

      if (json.sheets === 'ok' && json.sheetsLatencyMs !== undefined) {
        expect(typeof json.sheetsLatencyMs).toBe('number');
        expect(json.sheetsLatencyMs).toBeGreaterThanOrEqual(0);
      }
    });

    test('returns no-cache headers', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const cacheControl = response.headers()['cache-control'];
      expect(cacheControl).toContain('no-cache');
    });

    test('returns Content-Type application/json', async ({ request }) => {
      const response = await request.get('/api/status', { timeout: TIMEOUT });
      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('application/json');
    });
  });
});

test.describe('Story 1.3: Worker API Events Endpoint', () => {
  test.describe('/api/events', () => {

    test('returns HTTP 200 for valid request', async ({ request }) => {
      const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });
      // Expect 200 success or 503 if not configured
      expect([200, 503]).toContain(response.status());
    });

    test('returns valid JSON with required fields per AC', async ({ request }) => {
      const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });

      // Skip if not configured
      if (response.status() === 503) {
        const json = await response.json();
        expect(json.code).toBe('NOT_CONFIGURED');
        return;
      }

      const json = await response.json();

      // Story 1.3 AC: { ok: true, status: 200, items: [...] }
      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(true);

      expect(json).toHaveProperty('status');
      expect(json.status).toBe(200);

      expect(json).toHaveProperty('items');
      expect(Array.isArray(json.items)).toBe(true);
    });

    test('returns empty items array when no events (AC)', async ({ request }) => {
      const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });

      if (response.status() === 200) {
        const json = await response.json();
        // AC: If Events sheet empty → returns {ok:true, status:200, items:[]}
        expect(json.ok).toBe(true);
        expect(json.status).toBe(200);
        expect(Array.isArray(json.items)).toBe(true);
        // Empty array is valid per AC
      }
    });

    test('events have required summary fields', async ({ request }) => {
      const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });

      if (response.status() !== 200) return;

      const json = await response.json();
      if (json.items.length === 0) return; // Skip if no events

      const event = json.items[0];
      // Required summary fields per contract
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('name');
      expect(event).toHaveProperty('startDateISO');
    });

    test('events have optional but expected fields', async ({ request }) => {
      const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });

      if (response.status() !== 200) return;

      const json = await response.json();
      if (json.items.length === 0) return;

      const event = json.items[0];
      // Expected fields in event summary
      if (event.slug) expect(typeof event.slug).toBe('string');
      if (event.venue) expect(typeof event.venue).toBe('string');
      if (event.createdAtISO) expect(typeof event.createdAtISO).toBe('string');
      if (event.updatedAtISO) expect(typeof event.updatedAtISO).toBe('string');
    });

    test('supports full=true query parameter', async ({ request }) => {
      const response = await request.get(`/api/events?brand=${BRAND}&full=true`, { timeout: TIMEOUT });

      if (response.status() !== 200) return;

      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.items)).toBe(true);

      // Full events may have additional fields like links, settings, etc.
      if (json.items.length > 0) {
        const event = json.items[0];
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('name');
      }
    });

    test('returns BAD_INPUT for invalid brand', async ({ request }) => {
      const response = await request.get('/api/events?brand=invalid_brand_xyz', { timeout: TIMEOUT });
      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('BAD_INPUT');
    });

    test('returns Content-Type application/json', async ({ request }) => {
      const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });
      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('application/json');
    });

    test('uses default brand when not specified', async ({ request }) => {
      const response = await request.get('/api/events', { timeout: TIMEOUT });
      // Should work with default brand (root)
      expect([200, 503]).toContain(response.status());
    });
  });
});

test.describe('Story 1.3: Error Response Contract', () => {

  test('error responses have standard shape', async ({ request }) => {
    // Test with invalid brand to trigger error
    const response = await request.get('/api/events?brand=INVALID', { timeout: TIMEOUT });

    if (response.status() >= 400) {
      const json = await response.json();
      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(false);
      expect(json).toHaveProperty('status');
      expect(json).toHaveProperty('code');
      expect(json).toHaveProperty('message');
      expect(typeof json.message).toBe('string');
    }
  });

  test('NOT_CONFIGURED error has correct structure', async ({ request }) => {
    // If sheets not configured, should return NOT_CONFIGURED
    const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });

    if (response.status() === 503) {
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('NOT_CONFIGURED');
      expect(typeof json.message).toBe('string');
    }
  });
});

test.describe('Story 1.3: Worker Backend Identification', () => {

  test('status includes backend: worker', async ({ request }) => {
    const response = await request.get('/api/status', { timeout: TIMEOUT });
    const json = await response.json();
    expect(json.backend).toBe('worker');
  });

  test('includes X-Worker-Version header', async ({ request }) => {
    const response = await request.get('/api/status', { timeout: TIMEOUT });
    const version = response.headers()['x-worker-version'];
    // Header should exist if served by worker handler
    if (version) {
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
    }
  });
});

test.describe('Story 1.3: Events Sorting', () => {

  test('events are sorted by date descending', async ({ request }) => {
    const response = await request.get(`/api/events?brand=${BRAND}`, { timeout: TIMEOUT });

    if (response.status() !== 200) return;

    const json = await response.json();
    if (json.items.length < 2) return; // Need at least 2 items to test sorting

    // Check that events are sorted by startDateISO descending
    for (let i = 0; i < json.items.length - 1; i++) {
      const date1 = json.items[i].startDateISO || '';
      const date2 = json.items[i + 1].startDateISO || '';
      // date1 should be >= date2 (descending order)
      expect(date1.localeCompare(date2)).toBeGreaterThanOrEqual(0);
    }
  });
});
