/**
 * Story 7 - Production Events Smoke Test (Lightweight)
 *
 * Purpose:
 *   Minimal smoke test for production /events endpoint.
 *   Designed to be fast and lightweight - avoids long test runs.
 *
 * This test validates:
 *   1. /api/status returns ok:true
 *   2. /events returns HTTP 200 (not GAS HTML)
 *   3. /events API returns valid envelope with events array
 *
 * Acceptance Criteria (Story 7):
 *   - After manual approval, prod Stage-2 leg can:
 *     - Hit https://www.eventangle.com/api/status
 *     - Run lightweight /events smoke test
 *     - Fail if prod /events is broken
 *
 * Why separate from events.spec.ts?
 *   - events.spec.ts is comprehensive - validates all contract fields
 *   - This file is minimal - just validates /events is working
 *   - Production tests should be fast to minimize downtime risk
 *
 * @see tests/api/smoke/events.spec.ts - Full events contract tests
 * @see tests/api/smoke/prod-sanity.spec.ts - Full production sanity tests
 * @see .github/workflows/stage2.yml - Runs this after production deploys
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

test.describe('Story 7 - Production /events Smoke Test', () => {

  test.describe('Critical Path: API Health', () => {

    test('/api/status returns ok:true', async ({ request }) => {
      const response = await request.get(`/?p=status&brand=${BRAND}`);

      expect(response.status()).toBe(200);

      const json = await response.json();

      expect(json).toHaveProperty('ok', true);
      expect(json).toHaveProperty('buildId');
      expect(json).toHaveProperty('brandId', BRAND);

      console.log(`[PROD-EVENTS] Status: ok=${json.ok}, buildId=${json.buildId}`);
    });

  });

  test.describe('Critical Path: /events Page', () => {

    test('/events page returns HTTP 200', async ({ request }) => {
      const response = await request.get('/events');

      expect(response.status()).toBe(200);

      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('text/html');
    });

    test('/events page is Worker-served (not GAS)', async ({ request }) => {
      const response = await request.get('/events');

      // Check Worker transparency header
      const proxiedBy = response.headers()['x-proxied-by'];
      expect(proxiedBy).toBe('eventangle-worker');

      // Should NOT have Google headers
      const headers = response.headers();
      const googleHeaders = Object.keys(headers).filter(h =>
        h.toLowerCase().startsWith('x-google')
      );
      expect(googleHeaders).toHaveLength(0);
    });

    test('/events page does NOT contain GAS shell', async ({ request }) => {
      const response = await request.get('/events');
      const html = await response.text();

      // Critical check: No GAS blue banner
      expect(html).not.toContain('This application was created by a Google Apps Script user');

      // No warden scripts
      expect(html).not.toContain('wardeninit');
      expect(html).not.toContain('/warden/');
    });

  });

  test.describe('Critical Path: Events API', () => {

    test('events API returns valid envelope', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);

      expect(response.status()).toBe(200);

      const json = await response.json();

      // Envelope validation
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');

      if (json.ok === true) {
        expect(json).toHaveProperty('value');
        expect(json.value).toHaveProperty('items');
        expect(Array.isArray(json.value.items)).toBe(true);

        console.log(`[PROD-EVENTS] Events API: ok=${json.ok}, count=${json.value.items.length}`);
      }
    });

    test('events have required MVP fields', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);
      const json = await response.json();

      if (json.ok && json.value && json.value.items.length > 0) {
        const event = json.value.items[0];

        // Minimum required fields per v1.0 contract
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('slug');
        expect(event).toHaveProperty('name');
        expect(event).toHaveProperty('startDateISO');
        expect(event).toHaveProperty('venue');
        expect(event).toHaveProperty('links');

        console.log(`[PROD-EVENTS] Sample event: ${event.name} (${event.id})`);
      }
    });

  });

  test.describe('Critical Path: Route Aliases', () => {

    // Only test critical aliases to keep production tests fast
    const criticalAliases = [
      { alias: '/schedule', canonical: '/events' },
      { alias: '/manage', canonical: '/admin' },
    ];

    for (const { alias, canonical } of criticalAliases) {
      test(`${alias} (alias for ${canonical}) returns 200`, async ({ request }) => {
        const response = await request.get(alias);
        expect(response.status()).toBe(200);
      });
    }

  });

});
