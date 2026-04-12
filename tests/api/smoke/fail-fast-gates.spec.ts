/**
 * Fail-Fast Gates — Staging
 *
 * Runs FIRST in the smoke suite. Validates environment health before
 * expensive tests run. If any gate fails, the suite should abort.
 *
 * Checks:
 *   - /health returns 200 + ok:true (D1 Worker alive)
 *   - All MVP surfaces return < 500 (no deployment crash)
 *   - /health returns valid JSON (not error page)
 *   - No GAS HTML shell leak in Worker responses
 *   - Response times within threshold
 */

import { test, expect } from '@playwright/test';

const BRAND = process.env.TEST_BRAND || 'root';

// MVP Surfaces served by the Worker (actual routes from router.ts)
const MVP_SURFACES = [
  { name: 'Landing', url: '/' },
  { name: 'Public Events', url: '/events' },
  { name: 'Display', url: '/display' },
  { name: 'Poster', url: '/poster' },
];

test.describe('Fail-Fast Gates — CRITICAL', () => {
  test.describe.configure({ mode: 'serial' });

  test.describe('Health Check Gate — Immediate Abort on Failure', () => {
    test('GATE: /health is not returning 503', async ({ request }) => {
      const response = await request.get('/health');

      if (response.status() === 503) {
        console.error('='.repeat(60));
        console.error('CRITICAL: HTTP 503 on /health — D1 or Worker is down');
        console.error('ABORTING — environment is unhealthy.');
        console.error('='.repeat(60));
      }

      expect(response.status(), 'CRITICAL: /health returned 503').not.toBe(503);
      expect(response.status()).toBe(200);
    });

    test('GATE: /health returns ok:true', async ({ request }) => {
      const response = await request.get('/health');
      const json = await response.json();

      expect(json.ok, 'CRITICAL: /health ok is not true').toBe(true);
      expect(json.db, 'CRITICAL: D1 database is not ok').not.toBe('error');

      console.log(`Health: ok=${json.ok} db=${json.db} env=${json.env}`);
    });
  });

  test.describe('MVP Surface Accessibility — No 5xx', () => {
    for (const surface of MVP_SURFACES) {
      test(`GATE: ${surface.name} (${surface.url}) is not 5xx`, async ({ request }) => {
        const response = await request.get(surface.url);

        if (response.status() >= 500) {
          console.error('='.repeat(60));
          console.error(`CRITICAL: ${surface.name} returned HTTP ${response.status()}`);
          console.error(`URL: ${surface.url}`);
          console.error('='.repeat(60));
        }

        expect(response.status(), `${surface.name} returned 5xx`).toBeLessThan(500);
      });
    }
  });

  test.describe('Response Content Validation', () => {
    test('GATE: /health returns valid JSON', async ({ request }) => {
      const response = await request.get('/health');
      const ct = response.headers()['content-type'] || '';

      expect(ct).toContain('application/json');

      const json = await response.json();
      expect(json).toHaveProperty('ok');
      expect(json).toHaveProperty('db');
      expect(json).toHaveProperty('env');
      expect(json).toHaveProperty('version');
      expect(json).toHaveProperty('timestamp');
    });

    test('GATE: MVP surfaces return HTML', async ({ request }) => {
      for (const surface of MVP_SURFACES) {
        const response = await request.get(surface.url);
        const ct = response.headers()['content-type'] || '';

        expect(ct, `${surface.name} not returning HTML`).toContain('text/html');
      }
    });
  });

  test.describe('No GAS HTML Leak', () => {
    const GAS_MARKERS = ['userCodeAppPanel', 'Google Apps Script', 'macros/s/'];

    test('GATE: /events does not return GAS HTML shell', async ({ request }) => {
      const response = await request.get('/events');
      const content = await response.text();

      const detected = GAS_MARKERS.filter((m) => content.includes(m));

      if (detected.length > 0) {
        console.error('='.repeat(60));
        console.error('CRITICAL: GAS HTML Shell Detected on /events');
        console.error(`Markers: ${detected.join(', ')}`);
        console.error('='.repeat(60));
      }

      for (const marker of GAS_MARKERS) {
        expect(content, `GAS marker "${marker}" found`).not.toContain(marker);
      }
    });
  });

  test.describe('Response Time Gate', () => {
    test('GATE: /health responds within 10 seconds', async ({ request }) => {
      const start = Date.now();
      const response = await request.get('/health');
      const duration = Date.now() - start;

      expect(response.ok()).toBe(true);
      expect(duration, 'Response time exceeded 10s').toBeLessThan(10_000);
    });
  });
});
