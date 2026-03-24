/**
 * Stage-2 Smoke Test: GAS HTML Integrity Check
 *
 * Story 6 - CI/CD Guardrails: Block Deploys that Leak GAS HTML on /events
 *
 * Purpose:
 *   Validates that the live staging/production environment NEVER returns
 *   Google Apps Script shell HTML on user-facing routes. Any regression
 *   where Worker routes /events back to GAS will fail this test.
 *
 * Stage-2 Test (Live Environment):
 *   - Fetches actual HTML from deployed Worker
 *   - Validates content does NOT contain GAS markers
 *   - Captures HTML snippet for debugging on failure
 *   - Blocks promotion to prod on failure
 *
 * GAS HTML Markers Detected:
 *   - "This application was created by a Google Apps Script user"
 *   - warden* scripts (Google's bot detection)
 *   - Google's GAS iframe markers
 *   - script.google.com references in HTML
 *
 * Acceptance Criteria:
 *   - Any regression where Worker routes /events back to GAS:
 *     - Fails CI
 *     - Blocks promotion to prod
 *   - CI job artifacts include HTML snippet for debugging
 *
 * @see cloudflare-proxy/worker.js - Worker HTML routing
 * @see tests/contract/gas-html-guardrails.contract.test.js - Stage-1 contract
 */

import { test, expect, Page, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// GAS HTML Detection Markers
// =============================================================================

/**
 * Markers that indicate GAS HTML content is being served
 * These should NEVER appear in Worker-served HTML pages
 */
const GAS_HTML_MARKERS = [
  // Primary GAS shell indicator - CRITICAL
  'This application was created by a Google Apps Script user',

  // Google's warden (bot detection) scripts
  'wardeninit',
  '/warden/',
  '_/warden/',

  // GAS sandbox iframe markers
  'sandbox="allow-scripts allow-forms allow-popups"',
  'script.googleusercontent.com',

  // GAS script loading patterns
  '/_/scs/apps-static/',
  '/a/google.com/',

  // GAS default page title
  '<title>Untitled project</title>',
] as const;

/**
 * Routes to validate - all user-facing HTML pages
 */
const HTML_ROUTES_TO_CHECK = [
  '/events',
  '/admin',
  '/display',
  '/poster',
  '/public',
] as const;

/**
 * Optional public event display routes (may need eventId)
 */
const PUBLIC_DISPLAY_ROUTES = [
  '/public/{eventId}/display',
] as const;

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Check HTML content for GAS markers
 * Returns array of found markers
 */
function findGasMarkers(html: string): string[] {
  const foundMarkers: string[] = [];

  for (const marker of GAS_HTML_MARKERS) {
    if (html.includes(marker)) {
      foundMarkers.push(marker);
    }
  }

  return foundMarkers;
}

/**
 * Save HTML snippet to artifacts directory for debugging
 */
function saveHtmlArtifact(route: string, html: string, markers: string[]): void {
  const artifactsDir = path.join(process.cwd(), '.test-results', 'gas-html-artifacts');

  try {
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    const sanitizedRoute = route.replace(/\//g, '_').replace(/^_/, '');
    const filename = `gas-leak-${sanitizedRoute}-${Date.now()}.html`;
    const filepath = path.join(artifactsDir, filename);

    // Create diagnostic content
    const diagnostic = `
<!-- GAS HTML LEAK DIAGNOSTIC -->
<!-- Route: ${route} -->
<!-- Timestamp: ${new Date().toISOString()} -->
<!-- Found markers: ${markers.join(', ')} -->
<!-- ================================ -->

${html.substring(0, 10000)}

<!-- ... truncated at 10KB ... -->
`;

    fs.writeFileSync(filepath, diagnostic, 'utf8');
    console.log(`[GAS-INTEGRITY] Saved artifact: ${filepath}`);
  } catch (err) {
    console.error(`[GAS-INTEGRITY] Failed to save artifact:`, err);
  }
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('GAS HTML Integrity Check (Stage-2)', () => {

  test.describe('Primary Routes - Must Not Leak GAS HTML', () => {

    for (const route of HTML_ROUTES_TO_CHECK) {
      test(`${route} does NOT contain GAS HTML markers`, async ({ request }) => {
        // Fetch the route
        const response = await request.get(route, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml'
          }
        });

        // Should return 200
        expect(response.status()).toBe(200);

        // Get HTML content
        const html = await response.text();

        // Check for GAS markers
        const foundMarkers = findGasMarkers(html);

        // If markers found, save artifact for debugging
        if (foundMarkers.length > 0) {
          saveHtmlArtifact(route, html, foundMarkers);

          // Log detailed error info
          console.error(`
========================================
GAS HTML LEAK DETECTED ON ${route}
========================================
Found markers:
${foundMarkers.map(m => `  - "${m}"`).join('\n')}

HTML snippet (first 500 chars):
${html.substring(0, 500)}
========================================
`);
        }

        // CRITICAL ASSERTION: No GAS markers should be found
        expect(foundMarkers, `Route ${route} leaked GAS HTML! Found: ${foundMarkers.join(', ')}`).toHaveLength(0);
      });

      test(`${route} contains valid HTML structure`, async ({ request }) => {
        const response = await request.get(route, {
          headers: {
            'Accept': 'text/html'
          }
        });

        const html = await response.text();

        // Should have proper HTML structure
        expect(html.toLowerCase()).toContain('<!doctype html');
        expect(html.toLowerCase()).toContain('<html');
        expect(html.toLowerCase()).toContain('<head');
        expect(html.toLowerCase()).toContain('<body');

        // Should have charset declaration
        expect(html).toMatch(/charset=["']?utf-8["']?/i);
      });

      test(`${route} has correct Content-Type header`, async ({ request }) => {
        const response = await request.get(route);

        const contentType = response.headers()['content-type'];
        expect(contentType).toContain('text/html');
      });

      test(`${route} has X-Proxied-By header (Worker served)`, async ({ request }) => {
        const response = await request.get(route);

        // Worker should add transparency header
        const proxiedBy = response.headers()['x-proxied-by'];
        expect(proxiedBy).toBe('eventangle-worker');
      });

    }

  });

  test.describe('/events Route - Critical Path', () => {

    test('/events does NOT contain primary GAS shell message', async ({ request }) => {
      const response = await request.get('/events');
      const html = await response.text();

      // This is the MOST CRITICAL check
      const containsGasMessage = html.includes(
        'This application was created by a Google Apps Script user'
      );

      if (containsGasMessage) {
        saveHtmlArtifact('/events', html, ['GAS shell message']);
      }

      expect(containsGasMessage).toBe(false);
    });

    test('/events does NOT contain warden scripts', async ({ request }) => {
      const response = await request.get('/events');
      const html = await response.text();

      // Check for warden (Google's bot detection)
      const wardenMarkers = [
        'wardeninit',
        '/warden/',
        '_/warden/',
      ];

      const foundWarden = wardenMarkers.filter(m => html.includes(m));

      if (foundWarden.length > 0) {
        saveHtmlArtifact('/events-warden', html, foundWarden);
      }

      expect(foundWarden).toHaveLength(0);
    });

    test('/events does NOT contain Google script references', async ({ request }) => {
      const response = await request.get('/events');
      const html = await response.text();

      // Check for Google script loading patterns
      const googleScriptPatterns = [
        'script.googleusercontent.com',
        '/_/scs/apps-static/',
        '/a/google.com/',
      ];

      const foundPatterns = googleScriptPatterns.filter(p => html.includes(p));

      if (foundPatterns.length > 0) {
        saveHtmlArtifact('/events-google-scripts', html, foundPatterns);
      }

      expect(foundPatterns).toHaveLength(0);
    });

    test('/events contains EventAngle branding', async ({ request }) => {
      const response = await request.get('/events');
      const html = await response.text();

      // Should contain our branding, not GAS default
      expect(html).not.toContain('<title>Untitled project</title>');

      // Should contain EventAngle references
      const hasEventAngle = html.includes('EventAngle') ||
                           html.includes('eventangle') ||
                           html.includes('event-angle');

      expect(hasEventAngle).toBe(true);
    });

  });

  test.describe('Route Aliases - Same Integrity Requirements', () => {

    const routeAliases = [
      { alias: '/schedule', canonical: '/events' },
      { alias: '/calendar', canonical: '/events' },
      { alias: '/manage', canonical: '/admin' },
      { alias: '/dashboard', canonical: '/admin' },
      { alias: '/tv', canonical: '/display' },
      { alias: '/kiosk', canonical: '/display' },
      { alias: '/posters', canonical: '/poster' },
    ];

    for (const { alias, canonical } of routeAliases) {
      test(`${alias} (alias for ${canonical}) does NOT contain GAS markers`, async ({ request }) => {
        const response = await request.get(alias);

        // Should return 200
        expect(response.status()).toBe(200);

        const html = await response.text();
        const foundMarkers = findGasMarkers(html);

        if (foundMarkers.length > 0) {
          saveHtmlArtifact(alias, html, foundMarkers);
        }

        expect(foundMarkers).toHaveLength(0);
      });
    }

  });

  test.describe('Query Parameter Routes', () => {

    const queryParamRoutes = [
      { path: '/', params: { page: 'public' } },
      { path: '/', params: { page: 'admin' } },
      { path: '/', params: { page: 'display' } },
      { path: '/', params: { page: 'poster' } },
      { path: '/events', params: { brand: 'root' } },
    ];

    for (const { path, params } of queryParamRoutes) {
      const queryString = new URLSearchParams(params).toString();
      const fullPath = `${path}?${queryString}`;

      test(`${fullPath} does NOT contain GAS markers`, async ({ request }) => {
        const response = await request.get(fullPath);

        // Accept either 200 or redirect (some routes may redirect)
        expect([200, 301, 302, 307, 308]).toContain(response.status());

        if (response.status() === 200) {
          const html = await response.text();
          const foundMarkers = findGasMarkers(html);

          if (foundMarkers.length > 0) {
            saveHtmlArtifact(fullPath, html, foundMarkers);
          }

          expect(foundMarkers).toHaveLength(0);
        }
      });
    }

  });

  test.describe('Error Pages - Must Be Worker-Generated', () => {

    test('404 page is Worker-generated, not GAS', async ({ request }) => {
      const response = await request.get('/nonexistent-route-12345');

      // Should return 404
      expect(response.status()).toBe(404);

      const html = await response.text();

      // Should NOT contain GAS markers
      const foundMarkers = findGasMarkers(html);
      expect(foundMarkers).toHaveLength(0);

      // Should contain Worker-generated 404 content
      expect(html).toContain('404');
      expect(html).toContain('Not Found');
    });

    test('404 page has X-Proxied-By header', async ({ request }) => {
      const response = await request.get('/nonexistent-route-12345');

      // Worker should handle 404, not proxy to GAS
      const proxiedBy = response.headers()['x-proxied-by'];
      expect(proxiedBy).toBe('eventangle-worker');
    });

  });

  test.describe('Response Headers Validation', () => {

    test('all HTML routes have X-Worker-Version header', async ({ request }) => {
      for (const route of HTML_ROUTES_TO_CHECK) {
        const response = await request.get(route);
        const version = response.headers()['x-worker-version'];

        expect(version).toBeDefined();
        expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      }
    });

    test('HTML routes do NOT have X-Google-* headers', async ({ request }) => {
      for (const route of HTML_ROUTES_TO_CHECK) {
        const response = await request.get(route);
        const headers = response.headers();

        // Google headers would indicate GAS response
        const googleHeaders = Object.keys(headers).filter(
          h => h.toLowerCase().startsWith('x-google')
        );

        expect(googleHeaders).toHaveLength(0);
      }
    });

  });

});

// =============================================================================
// Comprehensive GAS Marker Scan
// =============================================================================

test.describe('Comprehensive GAS Marker Scan', () => {

  test('full scan of /events for all known GAS markers', async ({ request }) => {
    const response = await request.get('/events');
    const html = await response.text();

    // Extended marker list for comprehensive check
    const extendedMarkers = [
      // GAS shell
      'This application was created by a Google Apps Script user',
      'Google Apps Script',
      // Warden
      'wardeninit',
      '/warden/',
      '_/warden/',
      'wardenhandshake',
      // Google URLs
      'script.google.com',
      'script.googleusercontent.com',
      'googleapis.com',
      '/_/scs/apps-static/',
      // GAS iframe
      'sandbox="allow-scripts allow-forms',
      // GAS default
      '<title>Untitled project</title>',
      'Untitled project',
    ];

    const foundMarkers = extendedMarkers.filter(m => html.includes(m));

    if (foundMarkers.length > 0) {
      saveHtmlArtifact('/events-full-scan', html, foundMarkers);

      console.error(`
========================================
COMPREHENSIVE GAS SCAN FAILED
========================================
Found ${foundMarkers.length} GAS markers in /events:
${foundMarkers.map(m => `  - "${m}"`).join('\n')}
========================================
HTML artifact saved for debugging.
`);
    }

    expect(foundMarkers, 'GAS markers found in /events response').toHaveLength(0);
  });

});
