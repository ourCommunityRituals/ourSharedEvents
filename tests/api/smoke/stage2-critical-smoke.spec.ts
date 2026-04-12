/**
 * Critical Smoke Tests — Staging CI/CD Gate
 *
 * Validates critical endpoints against the D1-backed Cloudflare Worker on staging.
 * If any test here fails, the pipeline should abort — environment is unhealthy.
 *
 * Critical Endpoints:
 *   /health           — Worker + D1 health check
 *   /api/v2/events    — Events list endpoint (D1)
 *   /events           — Public events page (Worker-served HTML)
 *   /display          — Kiosk/TV display page
 *   /poster           — Printable poster page
 *   /                 — Landing page
 */

import { test, expect } from '@playwright/test';
import { getBaseUrl, logTestEnvironment } from '../../shared/helpers/smoke-test-helper';

const BRAND = process.env.TEST_BRAND || 'root';
const BASE_URL = getBaseUrl();

test.beforeAll(() => {
  logTestEnvironment('Critical Smoke Tests — Staging');
});

// ===========================================================================
// STAGING ENVIRONMENT VERIFICATION
// ===========================================================================

test.describe('Staging Environment Gate', () => {
  test('BASE_URL points to staging', () => {
    expect(BASE_URL).toBeDefined();
    expect(BASE_URL.length).toBeGreaterThan(0);
    expect(BASE_URL.startsWith('https://')).toBe(true);

    const url = new URL(BASE_URL);
    const isStaging = url.host.includes('stg.') || url.host.includes('staging.');
    expect(isStaging, `Expected staging host, got: ${url.host}`).toBe(true);
  });

  test('first API call resolves to staging host', async ({ request }) => {
    const response = await request.get('/health');
    const url = new URL(response.url());

    expect(
      url.host.includes('stg.') || url.host.includes('staging.'),
      `Expected staging host, got: ${url.host}`
    ).toBe(true);
  });
});

// ===========================================================================
// /health — D1 Worker Health Check
// ===========================================================================

test.describe('/health — Worker Health', () => {
  test('returns HTTP 200 and ok:true', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.status(), 'Health endpoint must return 200').toBe(200);

    const json = await response.json();
    expect(json.ok, 'Health check must return ok:true').toBe(true);
  });

  test('D1 database is reachable (db:"ok")', async ({ request }) => {
    const response = await request.get('/health');
    const json = await response.json();

    expect(json.db, 'D1 must be reachable on staging').toBe('ok');
    console.log(`env=${json.env} version=${json.version} db=${json.db}`);
  });
});

// ===========================================================================
// /api/v2/events — Events API
// ===========================================================================

test.describe('/api/v2/events — Events API', () => {
  test('returns HTTP 200 and ok:true', async ({ request }) => {
    const response = await request.get(`/api/v2/events?brand=${BRAND}`);
    expect(response.status(), 'Events endpoint must return 200').toBe(200);

    const json = await response.json();
    expect(json.ok, 'Events must return ok:true').toBe(true);
    expect(Array.isArray(json.items)).toBe(true);

    console.log(`Events items: ${json.items.length}`);
  });

  test('includes X-Request-Id for tracing', async ({ request }) => {
    const response = await request.get(`/api/v2/events?brand=${BRAND}`);
    expect(response.headers()['x-request-id']).toBeDefined();
  });
});

// ===========================================================================
// MVP Surface Accessibility (Worker-served HTML pages)
// ===========================================================================

test.describe('MVP Surfaces — No 5xx Errors', () => {
  const SURFACES = [
    { name: 'Public Events', url: '/events' },
    { name: 'Display/Kiosk', url: '/display' },
    { name: 'Poster', url: '/poster' },
    { name: 'Landing', url: '/' },
  ];

  for (const surface of SURFACES) {
    test(`${surface.name} (${surface.url}) loads without 5xx`, async ({ request }) => {
      const response = await request.get(surface.url);

      expect(response.status(), `${surface.name} returned 503`).not.toBe(503);
      expect(response.status(), `${surface.name} returned 5xx`).toBeLessThan(500);

      const ct = response.headers()['content-type'] || '';
      expect(ct, `${surface.name} not returning HTML`).toContain('text/html');

      console.log(`${surface.name}: HTTP ${response.status()}`);
    });
  }
});

// ===========================================================================
// No GAS HTML Leak
// ===========================================================================

test.describe('No GAS HTML Leak', () => {
  const GAS_MARKERS = ['userCodeAppPanel', 'Google Apps Script', 'macros/s/', 'script.google.com'];

  test('/events page has no GAS markers', async ({ request }) => {
    const response = await request.get('/events');
    const content = await response.text();

    for (const marker of GAS_MARKERS) {
      expect(content, `GAS marker "${marker}" found`).not.toContain(marker);
    }
  });
});

// ===========================================================================
// Response Time Gate
// ===========================================================================

test.describe('Response Time Gate', () => {
  test('/health responds within 15s', async ({ request }) => {
    const start = Date.now();
    const response = await request.get('/health');
    expect(response.ok()).toBe(true);
    expect(Date.now() - start).toBeLessThan(15_000);
  });

  test('/api/v2/events responds within 15s', async ({ request }) => {
    const start = Date.now();
    const response = await request.get(`/api/v2/events?brand=${BRAND}`);
    expect(response.ok()).toBe(true);
    expect(Date.now() - start).toBeLessThan(15_000);
  });
});
