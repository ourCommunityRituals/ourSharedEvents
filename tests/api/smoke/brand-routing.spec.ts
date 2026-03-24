/**
 * Stage-2 API Smoke Test: Brand-Specific URL Routing
 *
 * Story 5 - Full Testing Pipeline: Brand URL Variations
 *
 * Validates that brand-specific URL patterns work correctly for all MVP surfaces.
 * Tests both root brand and child brand URLs to ensure routing is correct.
 *
 * Acceptance Criteria:
 * - Root brand URLs (e.g., /events, /manage, /display) work correctly
 * - Child brand URLs (e.g., /abc/events, /cbc/manage) work correctly
 * - All 5 MVP surfaces accessible via brand-prefixed URLs
 * - HTTP 503 fails immediately (fail-fast)
 * - Brand parameter is correctly passed to GAS
 *
 * @see config/brand-config.js - Brand registry
 * @see cloudflare-proxy/worker.js - URL routing
 */

import { test, expect } from '@playwright/test';

// All brands to test (root + child brands)
const BRANDS = ['root', 'abc', 'cbc', 'cbl'];

// MVP Surfaces and their friendly URL aliases
const SURFACES = [
  { page: 'public', aliases: ['/events', '/schedule'] },
  { page: 'admin', aliases: ['/manage', '/admin'] },
  { page: 'display', aliases: ['/display', '/tv'] },
  { page: 'poster', aliases: ['/poster', '/posters'] },
  { page: 'report', aliases: ['/analytics', '/reports'] },
];

test.describe('Brand-Specific URL Routing (Story 5)', () => {

  test.describe('Root Brand URL Routing', () => {

    for (const surface of SURFACES) {
      test(`root brand: ${surface.page} page loads via ?page= parameter`, async ({ request }) => {
        const response = await request.get(`/?page=${surface.page}&brand=root`);

        // FAIL-FAST: 503 indicates deployment issue
        expect(response.status(), `CRITICAL: HTTP 503 for ${surface.page}`).not.toBe(503);
        expect(response.status()).toBeLessThan(500);
        expect(response.ok() || response.status() === 302).toBe(true);
      });

      test(`root brand: ${surface.page} page loads via friendly URL ${surface.aliases[0]}`, async ({ request }) => {
        const response = await request.get(surface.aliases[0]);

        // FAIL-FAST: 503 indicates deployment issue
        expect(response.status(), `CRITICAL: HTTP 503 for ${surface.aliases[0]}`).not.toBe(503);
        expect(response.status()).toBeLessThan(500);
      });
    }

  });

  test.describe('Child Brand URL Routing (abc)', () => {
    const CHILD_BRAND = 'abc';

    for (const surface of SURFACES) {
      test(`${CHILD_BRAND} brand: ${surface.page} page loads via ?page= parameter`, async ({ request }) => {
        const response = await request.get(`/?page=${surface.page}&brand=${CHILD_BRAND}`);

        // FAIL-FAST: 503 indicates deployment issue
        expect(response.status(), `CRITICAL: HTTP 503 for ${surface.page}`).not.toBe(503);
        expect(response.status()).toBeLessThan(500);
        expect(response.ok() || response.status() === 302).toBe(true);
      });

      test(`${CHILD_BRAND} brand: ${surface.page} page loads via brand-prefixed URL /${CHILD_BRAND}${surface.aliases[0]}`, async ({ request }) => {
        const response = await request.get(`/${CHILD_BRAND}${surface.aliases[0]}`);

        // FAIL-FAST: 503 indicates deployment issue
        expect(response.status(), `CRITICAL: HTTP 503 for /${CHILD_BRAND}${surface.aliases[0]}`).not.toBe(503);
        expect(response.status()).toBeLessThan(500);
      });
    }

  });

  test.describe('All Brands Status Endpoint', () => {

    for (const brand of BRANDS) {
      test(`${brand} brand: /status endpoint returns 200`, async ({ request }) => {
        const statusUrl = brand === 'root' ? '/status' : `/${brand}/status`;
        const response = await request.get(statusUrl);

        // FAIL-FAST: 503 indicates GAS not reachable
        expect(response.status(), `CRITICAL: HTTP 503 for ${statusUrl}`).not.toBe(503);
        expect(response.status()).toBe(200);

        const json = await response.json();
        expect(json.ok).toBe(true);
        expect(json.brandId).toBe(brand);
      });
    }

  });

  test.describe('Brand URL Resolution Correctness', () => {

    test('root brand events page returns correct content-type', async ({ request }) => {
      const response = await request.get('/events');

      expect(response.headers()['content-type']).toContain('text/html');
    });

    test('child brand (abc) events page returns correct content-type', async ({ request }) => {
      const response = await request.get('/abc/events');

      expect(response.headers()['content-type']).toContain('text/html');
    });

    test('status endpoint returns JSON for all brands', async ({ request }) => {
      for (const brand of BRANDS) {
        const statusUrl = brand === 'root' ? '/status' : `/${brand}/status`;
        const response = await request.get(statusUrl);

        expect(response.headers()['content-type']).toContain('application/json');
      }
    });

  });

  test.describe('Brand Parameter Validation', () => {

    test('invalid brand returns appropriate response', async ({ request }) => {
      const response = await request.get('/?page=public&brand=invalid-brand-xyz');

      // Should either return error or fallback gracefully
      // Should NOT return 503 (deployment issue)
      expect(response.status(), 'CRITICAL: HTTP 503 for invalid brand').not.toBe(503);

      // Can be 200 (with fallback) or 4xx error
      expect(response.status()).toBeLessThan(500);
    });

    test('missing brand parameter defaults correctly', async ({ request }) => {
      const response = await request.get('/?page=public');

      // Should default to root brand
      expect(response.status()).not.toBe(503);
      expect(response.status()).toBeLessThan(500);
    });

  });

  test.describe('Multi-Brand Parallel Access', () => {

    test('all brands accessible in parallel', async ({ request }) => {
      // Fire parallel requests to all brands
      const promises = BRANDS.map(brand => {
        const statusUrl = brand === 'root' ? '/status' : `/${brand}/status`;
        return request.get(statusUrl);
      });

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach((response, index) => {
        expect(response.status(), `Brand ${BRANDS[index]} failed`).toBe(200);
      });

      // Verify each returned the correct brand
      for (let i = 0; i < responses.length; i++) {
        const json = await responses[i].json();
        expect(json.brandId).toBe(BRANDS[i]);
      }
    });

  });

  test.describe('Friendly URL Aliases', () => {

    const ROOT_ALIASES = [
      { url: '/events', expectedPage: 'public' },
      { url: '/schedule', expectedPage: 'public' },
      { url: '/manage', expectedPage: 'admin' },
      { url: '/display', expectedPage: 'display' },
      { url: '/tv', expectedPage: 'display' },
      { url: '/poster', expectedPage: 'poster' },
      { url: '/analytics', expectedPage: 'report' },
    ];

    for (const alias of ROOT_ALIASES) {
      test(`friendly URL ${alias.url} resolves correctly`, async ({ request }) => {
        const response = await request.get(alias.url);

        // FAIL-FAST on 503
        expect(response.status(), `CRITICAL: HTTP 503 for ${alias.url}`).not.toBe(503);
        expect(response.status()).toBeLessThan(500);
      });
    }

  });

  test.describe('Brand Custom Aliases', () => {

    // ABC brand has custom aliases like /tournaments, /leagues
    const ABC_CUSTOM_ALIASES = [
      '/abc/tournaments',
      '/abc/leagues',
    ];

    for (const url of ABC_CUSTOM_ALIASES) {
      test(`ABC custom alias ${url} resolves`, async ({ request }) => {
        const response = await request.get(url);

        // Custom aliases should either work or gracefully fail
        expect(response.status(), `CRITICAL: HTTP 503 for ${url}`).not.toBe(503);
        // May return 200 or 404 depending on configuration
        expect(response.status()).toBeLessThan(500);
      });
    }

  });

});
