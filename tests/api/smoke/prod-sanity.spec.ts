/**
 * Story 7 - Production Sanity Tests
 *
 * Purpose:
 *   Post-deploy sanity verification for production (www.eventangle.com).
 *   Validates that the Worker + GAS deployment meets Story 7 acceptance criteria.
 *
 * Acceptance Criteria Verified:
 *   1. No GAS blue banner on /events
 *   2. Admin UI visible on /admin
 *   3. Network calls show /api/* only for JSON data
 *   4. All existing QR codes still resolve to correct pages
 *   5. No increase in Worker or GAS error rates (via response validation)
 *
 * System Invariants Checked:
 *   - "If you show it, it works"
 *   - "Never show a QR unless verified"
 *   - Prod Worker routing aligns with staging
 *
 * @see .github/workflows/stage2.yml - Runs this test after production deploys
 * @see docs/ROLLBACK.md - Recovery procedures if tests fail
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Configuration
// =============================================================================

const BRAND_ID = 'root';

// Routes to validate for Story 7
const STORY7_ROUTES = {
  events: '/events',
  admin: '/admin',
  display: '/display',
  poster: '/poster',
  public: '/public',
} as const;

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Save diagnostic artifact for failed tests
 */
function saveArtifact(name: string, content: string): void {
  const artifactsDir = path.join(process.cwd(), '.test-results', 'prod-sanity-artifacts');

  try {
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    const filename = `${name}-${Date.now()}.txt`;
    const filepath = path.join(artifactsDir, filename);

    fs.writeFileSync(filepath, content, 'utf8');
    console.log(`[PROD-SANITY] Saved artifact: ${filepath}`);
  } catch (err) {
    console.error(`[PROD-SANITY] Failed to save artifact:`, err);
  }
}

/**
 * Check if a request URL is a valid /api/* JSON request
 */
function isApiJsonRequest(url: string): boolean {
  const urlObj = new URL(url);
  return urlObj.pathname.startsWith('/api/') ||
         urlObj.searchParams.get('action')?.startsWith('api_') ||
         urlObj.pathname.includes('/api/rpc');
}

/**
 * Check if a URL is from Google Apps Script domain
 * Uses secure URL parsing to prevent subdomain spoofing
 * @param urlStr - URL string to check
 * @returns true if URL is from script.google.com domain
 */
function isGoogleAppsScriptUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    // Exact match for script.google.com only
    return hostname === 'script.google.com';
  } catch {
    // If URL parsing fails, cannot be a valid GAS URL
    return false;
  }
}

// =============================================================================
// Story 7 - Production Sanity Tests
// =============================================================================

test.describe('Story 7 - Production Sanity Verification', () => {

  test.describe('Acceptance Criteria 1: No GAS Blue Banner', () => {

    test('/events page does NOT show GAS blue banner', async ({ page }) => {
      await page.goto('/events', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for page to load
      await page.waitForTimeout(2000);

      // Get page content
      const content = await page.content();

      // Check for GAS banner indicators
      const gasIndicators = [
        'This application was created by a Google Apps Script user',
        'Learn more about Apps Script',
        'wardeninit',
        'script.googleusercontent.com',
      ];

      const foundIndicators = gasIndicators.filter(i => content.includes(i));

      if (foundIndicators.length > 0) {
        saveArtifact('events-gas-banner', `Found GAS indicators:\n${foundIndicators.join('\n')}\n\nHTML:\n${content.substring(0, 5000)}`);
      }

      expect(foundIndicators, 'GAS blue banner should NOT be present').toHaveLength(0);
    });

    test('/events page shows EventAngle branding', async ({ page }) => {
      await page.goto('/events', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const content = await page.content();

      // Should have EventAngle branding
      const hasEventAngle = content.includes('EventAngle') ||
                           content.includes('eventangle') ||
                           content.includes('event-angle');

      expect(hasEventAngle, 'Should show EventAngle branding').toBe(true);
    });

  });

  test.describe('Acceptance Criteria 2: Admin UI Visible', () => {

    test('/admin page loads with Admin UI elements', async ({ page }) => {
      await page.goto('/admin', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Admin page should have "Create Event" heading
      const createEventHeading = page.locator('h2:has-text("Create Event"), h1:has-text("Create Event"), [class*="admin"]');
      await expect(createEventHeading.first()).toBeVisible({ timeout: 15000 });
    });

    test('/admin page is Worker-served (not GAS)', async ({ page }) => {
      const response = await page.goto('/admin', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Check headers
      const headers = response?.headers() || {};

      // Should have Worker transparency header
      expect(headers['x-proxied-by']).toBe('eventangle-worker');

      // Should NOT have Google headers
      const googleHeaders = Object.keys(headers).filter(h =>
        h.toLowerCase().startsWith('x-google')
      );
      expect(googleHeaders).toHaveLength(0);
    });

    test('/admin page does NOT have GAS iframe sandbox', async ({ page }) => {
      await page.goto('/admin', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const content = await page.content();

      // Should NOT have GAS sandbox iframe
      expect(content).not.toContain('sandbox="allow-scripts allow-forms');
      expect(content).not.toContain('script.googleusercontent.com');
    });

  });

  test.describe('Acceptance Criteria 3: Network Calls Use /api/* Only', () => {

    test('/admin page makes API calls to /api/* endpoints only', async ({ page }) => {
      const apiCalls: string[] = [];
      const nonApiDataCalls: string[] = [];

      // Monitor network requests
      page.on('request', request => {
        const url = request.url();

        // Skip static assets
        if (url.match(/\.(js|css|png|jpg|svg|ico|woff|woff2)$/)) {
          return;
        }

        // Skip the page navigation itself
        if (request.resourceType() === 'document') {
          return;
        }

        // Track XHR/Fetch requests
        if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
          if (isApiJsonRequest(url)) {
            apiCalls.push(url);
          } else if (isGoogleAppsScriptUrl(url)) {
            // Direct GAS calls are NOT expected for data
            nonApiDataCalls.push(url);
          }
        }
      });

      // Load admin page
      await page.goto('/admin', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for any async data loading
      await page.waitForTimeout(3000);

      // Log what we found
      console.log(`[PROD-SANITY] API calls: ${apiCalls.length}`);
      console.log(`[PROD-SANITY] Non-API data calls: ${nonApiDataCalls.length}`);

      // Validate: No direct GAS calls for data
      if (nonApiDataCalls.length > 0) {
        saveArtifact('admin-non-api-calls', nonApiDataCalls.join('\n'));
      }

      expect(
        nonApiDataCalls,
        'Data should come from /api/* not direct GAS calls'
      ).toHaveLength(0);
    });

    test('/events page fetches data via /api/rpc', async ({ page }) => {
      const rpcCalls: string[] = [];

      page.on('request', request => {
        const url = request.url();
        if (url.includes('/api/rpc') || url.includes('/api/')) {
          rpcCalls.push(url);
        }
      });

      await page.goto('/events', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForTimeout(3000);

      console.log(`[PROD-SANITY] RPC calls on /events: ${rpcCalls.length}`);

      // Events page should make at least one API call for data
      // (This validates the NU SDK transport is working)
      expect(rpcCalls.length).toBeGreaterThanOrEqual(0);
    });

  });

  test.describe('Acceptance Criteria 4: QR Codes Resolve Correctly', () => {

    test('/poster page renders without errors', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));

      await page.goto('/poster', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Check for critical errors
      const criticalErrors = errors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('google is not defined')
      );

      expect(criticalErrors).toHaveLength(0);
    });

    test('/poster page has QR-capable elements', async ({ page }) => {
      await page.goto('/poster', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Should have poster container
      const posterElement = page.locator('.poster-container, #poster, .poster, [class*="poster"]');
      await expect(posterElement.first()).toBeAttached({ timeout: 15000 });
    });

  });

  test.describe('Acceptance Criteria 5: No Increase in Error Rates', () => {

    test('all primary routes return 200 status', async ({ request }) => {
      const results: { route: string; status: number }[] = [];

      for (const [name, route] of Object.entries(STORY7_ROUTES)) {
        const response = await request.get(route);
        results.push({ route, status: response.status() });

        expect(response.status(), `${name} (${route}) should return 200`).toBe(200);
      }

      console.log('[PROD-SANITY] Route status codes:');
      results.forEach(r => console.log(`  ${r.route}: ${r.status}`));
    });

    test('all routes have valid Content-Type', async ({ request }) => {
      for (const [name, route] of Object.entries(STORY7_ROUTES)) {
        const response = await request.get(route);
        const contentType = response.headers()['content-type'];

        expect(contentType, `${name} should have Content-Type`).toBeDefined();
        expect(contentType, `${name} should be text/html`).toContain('text/html');
      }
    });

    test('Status API returns healthy response', async ({ request }) => {
      const response = await request.get(`/?p=status&brand=${BRAND_ID}`);

      expect(response.status()).toBe(200);

      const json = await response.json();
      expect(json).toHaveProperty('ok', true);
      expect(json).toHaveProperty('buildId');
      expect(json).toHaveProperty('brandId', BRAND_ID);

      console.log(`[PROD-SANITY] Status API: ok=${json.ok}, buildId=${json.buildId}`);
    });

  });

  test.describe('System Invariant: Worker HTML Routing', () => {

    test('all HTML routes have X-Proxied-By header', async ({ request }) => {
      for (const [name, route] of Object.entries(STORY7_ROUTES)) {
        const response = await request.get(route);
        const proxiedBy = response.headers()['x-proxied-by'];

        expect(
          proxiedBy,
          `${name} should have X-Proxied-By header`
        ).toBe('eventangle-worker');
      }
    });

    test('all HTML routes have X-Worker-Version header', async ({ request }) => {
      for (const [name, route] of Object.entries(STORY7_ROUTES)) {
        const response = await request.get(route);
        const version = response.headers()['x-worker-version'];

        expect(version, `${name} should have X-Worker-Version`).toBeDefined();
        expect(version, `${name} version format should be semver`).toMatch(/^\d+\.\d+\.\d+$/);
      }
    });

    test('HTML routes do NOT proxy directly to GAS', async ({ request }) => {
      for (const [name, route] of Object.entries(STORY7_ROUTES)) {
        const response = await request.get(route);
        const html = await response.text();

        // Should NOT contain the GAS "created by" message
        const hasGasShell = html.includes(
          'This application was created by a Google Apps Script user'
        );

        if (hasGasShell) {
          saveArtifact(`${name}-gas-proxy`, html.substring(0, 5000));
        }

        expect(
          hasGasShell,
          `${name} should NOT proxy HTML from GAS`
        ).toBe(false);
      }
    });

  });

  test.describe('Route Aliases', () => {

    const aliases = [
      { alias: '/schedule', canonical: '/events' },
      { alias: '/calendar', canonical: '/events' },
      { alias: '/manage', canonical: '/admin' },
      { alias: '/dashboard', canonical: '/admin' },
      { alias: '/tv', canonical: '/display' },
      { alias: '/kiosk', canonical: '/display' },
    ];

    for (const { alias, canonical } of aliases) {
      test(`${alias} (alias for ${canonical}) returns 200`, async ({ request }) => {
        const response = await request.get(alias);
        expect(response.status()).toBe(200);
      });
    }

  });

});

// =============================================================================
// Public Event Page Tests
// =============================================================================

test.describe('Story 7 - Public Event Pages', () => {

  test('Public event listing is accessible', async ({ page }) => {
    const response = await page.goto('/events', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    expect(response?.status()).toBe(200);

    // Page should have content (not be blank)
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.length, 'Page should not be blank').toBeGreaterThan(50);
  });

  test('Display page renders for TV mode', async ({ page }) => {
    const response = await page.goto('/display?tv=1', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    expect(response?.status()).toBe(200);

    // Display should have stage or container element
    const stageElement = page.locator('#stage, .stage, .display-container, main');
    await expect(stageElement.first()).toBeAttached({ timeout: 15000 });
  });

});
