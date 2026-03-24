/**
 * Stage-2 Playwright Tests: HTML Surfaces
 *
 * Tests that all HTML surfaces load from Cloudflare Worker without GAS dependencies.
 *
 * Acceptance Criteria (Story 4.1):
 * - All surfaces load from Cloudflare without GAS fetch
 * - Network panel shows only Worker endpoints
 * - No google.script.run references in executed code
 *
 * @see Story 4.1 - Move HTML Surfaces to Cloudflare
 */

import { test, expect, type Page, type Response } from '@playwright/test';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Base URL for staging environment
 * Override with PLAYWRIGHT_BASE_URL environment variable
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8787';

/**
 * Surface definitions with their routes and expected headers
 */
const SURFACES = [
  {
    name: 'Admin',
    routes: ['/admin', '/manage', '/dashboard', '/create'],
    expectedTitle: /Admin|Manager|Dashboard/i,
  },
  {
    name: 'Public',
    routes: ['/public', '/events', '/schedule', '/calendar'],
    expectedTitle: /Events|Public|Schedule/i,
  },
  {
    name: 'Display',
    routes: ['/display', '/tv', '/kiosk', '/screen'],
    expectedTitle: /Display|TV/i,
  },
  {
    name: 'Poster',
    routes: ['/poster', '/posters', '/flyers'],
    expectedTitle: /Poster|Flyer/i,
  },
];

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Collect all network requests during page load
 */
async function collectNetworkRequests(page: Page, url: string): Promise<Response[]> {
  const responses: Response[] = [];

  page.on('response', (response) => {
    responses.push(response);
  });

  await page.goto(url, { waitUntil: 'networkidle' });

  return responses;
}

/**
 * Check if any request went to Google Apps Script
 * Uses proper URL parsing to check hostname (not substring matching)
 */
function hasGasRequest(responses: Response[]): boolean {
  const GAS_HOSTNAMES = [
    'script.google.com',
    'script.googleusercontent.com',
  ];

  return responses.some((response) => {
    try {
      const parsedUrl = new URL(response.url());
      // Check if hostname matches GAS domains
      if (GAS_HOSTNAMES.includes(parsedUrl.hostname)) {
        return true;
      }
      // Also check for macros/s/ in the pathname (GAS deployment URLs)
      if (parsedUrl.pathname.includes('/macros/s/')) {
        return true;
      }
      return false;
    } catch {
      // Invalid URL - not a GAS request
      return false;
    }
  });
}

/**
 * Check if page has google.script.run available (it should NOT)
 */
async function hasGoogleScriptRun(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    return typeof (window as any).google?.script?.run !== 'undefined';
  });
}

// =============================================================================
// Tests
// =============================================================================

test.describe('Story 4.1: HTML Surfaces on Cloudflare', () => {
  test.describe('Surface Loading', () => {
    for (const surface of SURFACES) {
      test(`${surface.name} surface loads from primary route`, async ({ page }) => {
        const primaryRoute = surface.routes[0];

        // Navigate to the surface
        const response = await page.goto(`${BASE_URL}${primaryRoute}`, {
          waitUntil: 'domcontentloaded',
        });

        // Verify response
        expect(response).not.toBeNull();
        expect(response!.status()).toBe(200);
        expect(response!.headers()['content-type']).toContain('text/html');

        // Verify served by Worker (Story 4.1 header)
        const servedBy = response!.headers()['x-served-by'];
        expect(servedBy).toBe('cloudflare-worker');

        // Verify page type header
        const pageType = response!.headers()['x-page-type'];
        expect(pageType).toBe(surface.name.toLowerCase());
      });

      test(`${surface.name} surface has correct title`, async ({ page }) => {
        const primaryRoute = surface.routes[0];

        await page.goto(`${BASE_URL}${primaryRoute}`, {
          waitUntil: 'domcontentloaded',
        });

        const title = await page.title();
        expect(title).toMatch(surface.expectedTitle);
      });
    }
  });

  test.describe('Route Aliases', () => {
    for (const surface of SURFACES) {
      for (const route of surface.routes) {
        test(`${surface.name}: ${route} returns correct surface`, async ({ page }) => {
          const response = await page.goto(`${BASE_URL}${route}`, {
            waitUntil: 'domcontentloaded',
          });

          expect(response).not.toBeNull();
          expect(response!.status()).toBe(200);
          expect(response!.headers()['x-page-type']).toBe(surface.name.toLowerCase());
        });
      }
    }
  });

  test.describe('No GAS Dependencies', () => {
    for (const surface of SURFACES) {
      test(`${surface.name} makes no GAS network requests`, async ({ page }) => {
        const primaryRoute = surface.routes[0];
        const responses = await collectNetworkRequests(page, `${BASE_URL}${primaryRoute}`);

        // Verify no requests to Google Apps Script
        const hasGas = hasGasRequest(responses);
        expect(hasGas).toBe(false);
      });

      test(`${surface.name} has no google.script.run available`, async ({ page }) => {
        const primaryRoute = surface.routes[0];

        await page.goto(`${BASE_URL}${primaryRoute}`, {
          waitUntil: 'domcontentloaded',
        });

        // google.script.run should NOT be available (we're not in GAS)
        const hasGsr = await hasGoogleScriptRun(page);
        expect(hasGsr).toBe(false);
      });
    }
  });

  test.describe('Worker Headers', () => {
    for (const surface of SURFACES) {
      test(`${surface.name} has correct Worker headers`, async ({ page }) => {
        const primaryRoute = surface.routes[0];

        const response = await page.goto(`${BASE_URL}${primaryRoute}`, {
          waitUntil: 'domcontentloaded',
        });

        expect(response).not.toBeNull();

        // Check required headers
        const headers = response!.headers();

        expect(headers['x-served-by']).toBe('cloudflare-worker');
        expect(headers['x-page-type']).toBe(surface.name.toLowerCase());
        expect(headers['x-router-version']).toBeDefined();
        expect(headers['x-request-id']).toBeDefined();
        expect(headers['content-type']).toContain('text/html');

        // Security headers
        expect(headers['x-content-type-options']).toBe('nosniff');
        expect(headers['x-frame-options']).toBe('SAMEORIGIN');
      });
    }
  });

  test.describe('Brand Support', () => {
    const BRANDS = ['abc', 'cbc', 'cbl'];

    for (const brand of BRANDS) {
      test(`${brand} brand prefix works for public surface`, async ({ page }) => {
        const response = await page.goto(`${BASE_URL}/${brand}/public`, {
          waitUntil: 'domcontentloaded',
        });

        expect(response).not.toBeNull();
        expect(response!.status()).toBe(200);
        expect(response!.headers()['x-brand']).toBe(brand);
      });
    }

    test('root brand (no prefix) defaults to "root"', async ({ page }) => {
      const response = await page.goto(`${BASE_URL}/public`, {
        waitUntil: 'domcontentloaded',
      });

      expect(response).not.toBeNull();
      expect(response!.headers()['x-brand']).toBe('root');
    });
  });

  test.describe('Error Handling', () => {
    test('invalid route returns 404', async ({ page }) => {
      const response = await page.goto(`${BASE_URL}/nonexistent-page`, {
        waitUntil: 'domcontentloaded',
      });

      expect(response).not.toBeNull();
      expect(response!.status()).toBe(404);
    });

    test('404 response is JSON from API routes', async ({ page }) => {
      const response = await page.goto(`${BASE_URL}/api/nonexistent`, {
        waitUntil: 'domcontentloaded',
      });

      expect(response).not.toBeNull();
      expect(response!.status()).toBe(404);
      expect(response!.headers()['content-type']).toContain('application/json');
    });
  });

  test.describe('API Endpoints Available', () => {
    test('/api/status endpoint works', async ({ page }) => {
      const response = await page.goto(`${BASE_URL}/api/status`, {
        waitUntil: 'domcontentloaded',
      });

      expect(response).not.toBeNull();
      expect(response!.status()).toBe(200);
      expect(response!.headers()['content-type']).toContain('application/json');

      const body = await response!.json();
      expect(body.ok).toBe(true);
      expect(body.backend).toBe('worker');
    });
  });

  test.describe('No JavaScript Errors', () => {
    for (const surface of SURFACES) {
      test(`${surface.name} surface loads without JS errors`, async ({ page }) => {
        const errors: string[] = [];

        page.on('pageerror', (error) => {
          // Filter out expected errors (e.g., if trying to call backend without setup)
          const msg = error.message;
          if (!msg.includes('google.script.run')) {
            errors.push(msg);
          }
        });

        await page.goto(`${BASE_URL}${surface.routes[0]}`, {
          waitUntil: 'networkidle',
        });

        // Allow some time for any async errors
        await page.waitForTimeout(500);

        expect(errors).toEqual([]);
      });
    }
  });
});

// =============================================================================
// Performance Tests
// =============================================================================

test.describe('Performance', () => {
  test('surfaces load within acceptable time', async ({ page }) => {
    const maxLoadTime = 3000; // 3 seconds

    for (const surface of SURFACES) {
      const startTime = Date.now();

      await page.goto(`${BASE_URL}${surface.routes[0]}`, {
        waitUntil: 'domcontentloaded',
      });

      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThan(maxLoadTime);
    }
  });
});
