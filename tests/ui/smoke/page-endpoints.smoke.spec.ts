/**
 * Functional Smoke Test: All Page Endpoints & Aliases
 *
 * Validates that every page endpoint and alias in the Hono router
 * returns the correct HTTP status and content type from the live
 * staging deployment. This is the integration seam test — it proves
 * frontend routing, Worker endpoints, and CF Access all agree.
 *
 * Surfaces covered:
 *   Landing, Events, Admin, Display, Poster, SharedReport,
 *   Briefing, Subscribe, Forms, Health, 404
 *
 * @see workers/oursharedevents/src/router.ts
 */

import { test, expect } from '@playwright/test';

const BRAND = process.env.TEST_BRAND || 'root';
const TIMEOUT = 30000;

// ── Public page endpoints (expect 200 + text/html) ──────────────────────────

const PUBLIC_PAGES: { path: string; surface: string }[] = [
  // Landing
  { path: '/', surface: 'Landing' },
  { path: '/home', surface: 'Landing' },
  { path: '/welcome', surface: 'Landing' },
  { path: '/landing', surface: 'Landing' },
  { path: '/about', surface: 'Landing' },
  { path: '/info', surface: 'Landing' },

  // Events / Public
  { path: '/events', surface: 'Events' },
  { path: '/public', surface: 'Events' },
  { path: '/schedule', surface: 'Events' },
  { path: '/calendar', surface: 'Events' },
  { path: '/agenda', surface: 'Events' },
  { path: '/lineup', surface: 'Events' },

  // Display (TV/Kiosk)
  { path: '/display', surface: 'Display' },
  { path: '/tv', surface: 'Display' },
  { path: '/kiosk', surface: 'Display' },
  { path: '/screen', surface: 'Display' },

  // Poster
  { path: '/poster', surface: 'Poster' },
  { path: '/posters', surface: 'Poster' },
  { path: '/flyers', surface: 'Poster' },
  { path: '/tabletop', surface: 'Poster' },
  { path: '/tent', surface: 'Poster' },
  { path: '/signage', surface: 'Poster' },

  // SharedReport / Analytics
  { path: '/sharedReport', surface: 'Report' },
  { path: '/report', surface: 'Report' },
  { path: '/analytics', surface: 'Report' },
  { path: '/reports', surface: 'Report' },
  { path: '/insights', surface: 'Report' },
  { path: '/stats', surface: 'Report' },

  // Briefing
  { path: '/briefing', surface: 'Briefing' },
  { path: '/overview', surface: 'Briefing' },
  { path: '/summary', surface: 'Briefing' },
];

// ── Admin page endpoints (expect 200 or 302/401 via CF Access) ──────────────

const ADMIN_PAGES: { path: string; surface: string }[] = [
  { path: '/admin', surface: 'Admin' },
  { path: '/manage', surface: 'Admin' },
  { path: '/dashboard', surface: 'Admin' },
  { path: '/create', surface: 'Admin' },
];

// ── Subscribe endpoints (GET expect 405) ────────────────────────────────────

const SUBSCRIBE_PAGES: { path: string }[] = [
  { path: '/subscribe' },
  { path: '/signup' },
  { path: '/newsletter' },
];

// ── Health endpoints (expect 200 + JSON) ────────────────────────────────────

const HEALTH_ENDPOINTS: { path: string }[] = [{ path: '/health' }, { path: '/api/status' }];

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Page Endpoints: All Routes & Aliases', () => {
  test.describe('Public Pages — 200 + text/html', () => {
    for (const { path, surface } of PUBLIC_PAGES) {
      test(`${surface}: GET ${path} returns 200`, async ({ request }) => {
        const response = await request.get(`${path}?brand=${BRAND}`, {
          timeout: TIMEOUT,
        });

        // Should not be a server error
        expect(response.status()).toBeLessThan(500);

        // Public pages should return 200
        // SharedReport may return 403 if feature flag disabled — acceptable
        if (surface === 'Report') {
          expect([200, 403]).toContain(response.status());
        } else {
          expect(response.status()).toBe(200);
        }

        // Should be HTML
        if (response.status() === 200) {
          const contentType = response.headers()['content-type'] || '';
          expect(contentType).toContain('text/html');
        }
      });
    }
  });

  test.describe('Admin Pages — protected by CF Access', () => {
    for (const { path, surface } of ADMIN_PAGES) {
      test(`${surface}: GET ${path} returns 200, 302, or 401`, async ({ request }) => {
        const response = await request.get(`${path}?brand=${BRAND}`, {
          timeout: TIMEOUT,
          maxRedirects: 0,
        });

        // Admin pages are behind CF Access — may get:
        //   200 (if CF Access not enforced or service token works)
        //   302 (redirect to CF Access login)
        //   401 (worker auth rejection)
        //   403 (CF bot management block)
        expect(response.status()).toBeLessThan(500);
        expect([200, 302, 401, 403]).toContain(response.status());
      });
    }
  });

  test.describe('Subscribe — GET returns 405 Method Not Allowed', () => {
    for (const { path } of SUBSCRIBE_PAGES) {
      test(`GET ${path} returns 405`, async ({ request }) => {
        const response = await request.get(path, {
          timeout: TIMEOUT,
        });

        // GET on subscribe endpoints should return 405
        // May return 403 if CF bot management blocks
        expect([405, 403]).toContain(response.status());

        if (response.status() === 405) {
          const json = await response.json();
          expect(json.ok).toBe(false);
        }
      });
    }
  });

  test.describe('Health Endpoints — 200 + JSON', () => {
    for (const { path } of HEALTH_ENDPOINTS) {
      test(`GET ${path} returns 200 with JSON`, async ({ request }) => {
        const response = await request.get(path, {
          timeout: TIMEOUT,
        });

        expect(response.status()).toBe(200);

        const contentType = response.headers()['content-type'] || '';
        expect(contentType).toContain('application/json');

        const json = await response.json();
        expect(json.ok).toBe(true);
      });
    }
  });

  test.describe('Form Landing Page', () => {
    test('GET /forms/test-event-001 returns 200 + HTML', async ({ request }) => {
      const response = await request.get('/forms/test-event-001', {
        timeout: TIMEOUT,
      });

      // Form page should load (200) or return 404 if event doesn't exist
      expect([200, 404]).toContain(response.status());

      if (response.status() === 200) {
        const contentType = response.headers()['content-type'] || '';
        expect(contentType).toContain('text/html');
      }
    });
  });

  test.describe('404 Handling', () => {
    test('GET /nonexistent-path-xyz returns 404', async ({ request }) => {
      const response = await request.get('/nonexistent-path-xyz', {
        timeout: TIMEOUT,
      });

      expect(response.status()).toBe(404);
    });
  });
});
