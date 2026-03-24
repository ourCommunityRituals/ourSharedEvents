/**
 * Stage-2 API Smoke Test: Fail-Fast Gates
 *
 * Story 5 - Full Testing Pipeline: Early Failure on Critical Issues
 *
 * This test suite runs FIRST and validates that the environment is healthy
 * before any other tests run. If any of these tests fail, the entire
 * test suite should abort immediately.
 *
 * Acceptance Criteria:
 * - HTTP 503 on any MVP surface aborts the test run
 * - Worker ↔ GAS misalignment detected immediately
 * - Environment returns valid responses (not error pages)
 * - All critical endpoints reachable
 *
 * @see docs/ROLLBACK.md - Recovery procedures
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// MVP Surfaces that must be accessible
const MVP_SURFACES = [
  { name: 'Public', url: `/?page=public&brand=${BRAND}` },
  { name: 'Admin', url: `/?page=admin&brand=${BRAND}` },
  { name: 'Display', url: `/?page=display&brand=${BRAND}` },
  { name: 'Poster', url: `/?page=poster&brand=${BRAND}` },
  { name: 'Report', url: `/?page=report&brand=${BRAND}` },
];

test.describe('Fail-Fast Gates - CRITICAL (Story 5)', () => {

  test.describe.configure({ mode: 'serial' });

  test.describe('503 Detection - Immediate Abort', () => {

    test('GATE: /status endpoint is not returning 503', async ({ request }) => {
      const response = await request.get('/status');

      if (response.status() === 503) {
        console.error('='.repeat(60));
        console.error('CRITICAL FAILURE: HTTP 503 detected on /status');
        console.error('This indicates GAS is not reachable or Worker misrouting.');
        console.error('ABORTING TEST RUN - Environment is unhealthy.');
        console.error('='.repeat(60));
      }

      expect(response.status(), 'CRITICAL: HTTP 503 - GAS not reachable').not.toBe(503);
      expect(response.status()).toBe(200);
    });

    test('GATE: /env-status endpoint is not returning 503', async ({ request }) => {
      const response = await request.get('/env-status');

      if (response.status() === 503) {
        console.error('='.repeat(60));
        console.error('CRITICAL FAILURE: HTTP 503 detected on /env-status');
        console.error('Worker is returning 503 - deployment may be broken.');
        console.error('ABORTING TEST RUN - Environment is unhealthy.');
        console.error('='.repeat(60));
      }

      expect(response.status(), 'CRITICAL: HTTP 503 - Worker unhealthy').not.toBe(503);
      expect(response.status()).toBe(200);
    });

    test('GATE: /whoami endpoint is not returning 503', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);

      if (response.status() === 503) {
        console.error('='.repeat(60));
        console.error('CRITICAL FAILURE: HTTP 503 detected on /whoami');
        console.error('GAS is not responding - deployment may be broken.');
        console.error('ABORTING TEST RUN - Environment is unhealthy.');
        console.error('='.repeat(60));
      }

      expect(response.status(), 'CRITICAL: HTTP 503 - GAS not reachable').not.toBe(503);
      expect(response.status()).toBe(200);
    });

  });

  test.describe('MVP Surface Accessibility - Early Failure', () => {

    for (const surface of MVP_SURFACES) {
      test(`GATE: ${surface.name} surface is accessible (no 503/500)`, async ({ request }) => {
        const response = await request.get(surface.url);

        if (response.status() === 503) {
          console.error('='.repeat(60));
          console.error(`CRITICAL FAILURE: HTTP 503 on ${surface.name} surface`);
          console.error(`URL: ${surface.url}`);
          console.error('This MVP surface is broken.');
          console.error('ABORTING TEST RUN - Surface is inaccessible.');
          console.error('='.repeat(60));
        }

        expect(response.status(), `CRITICAL: ${surface.name} returning 503`).not.toBe(503);
        expect(response.status(), `${surface.name} returning 5xx error`).toBeLessThan(500);
      });
    }

  });

  test.describe('Environment Alignment - Fail-Fast', () => {

    test('GATE: Worker and GAS deployment IDs match', async ({ request }) => {
      const [envStatusRes, whoamiRes] = await Promise.all([
        request.get('/env-status'),
        request.get(`/?page=whoami&brand=${BRAND}`)
      ]);

      // First check for 503
      expect(envStatusRes.status(), 'Worker /env-status returned 503').not.toBe(503);
      expect(whoamiRes.status(), 'GAS /whoami returned 503').not.toBe(503);

      const envStatus = await envStatusRes.json();
      const whoami = await whoamiRes.json();

      if (envStatus.deploymentId !== whoami.deploymentId) {
        console.error('='.repeat(60));
        console.error('CRITICAL FAILURE: Worker ↔ GAS Deployment Mismatch');
        console.error(`Worker deploymentId: ${envStatus.deploymentId}`);
        console.error(`GAS deploymentId: ${whoami.deploymentId}`);
        console.error('Worker is pointing to wrong GAS deployment!');
        console.error('ABORTING TEST RUN - Environment is misaligned.');
        console.error('='.repeat(60));
      }

      expect(envStatus.deploymentId).toBe(whoami.deploymentId);
    });

    test('GATE: GAS scriptId is valid (not "unknown")', async ({ request }) => {
      const response = await request.get(`/?page=whoami&brand=${BRAND}`);
      const json = await response.json();

      if (json.scriptId === 'unknown') {
        console.error('='.repeat(60));
        console.error('CRITICAL FAILURE: GAS scriptId is "unknown"');
        console.error('GAS deployment may be corrupted.');
        console.error('ABORTING TEST RUN - Environment is unhealthy.');
        console.error('='.repeat(60));
      }

      expect(json.scriptId).not.toBe('unknown');
      expect(json.scriptId.length).toBeGreaterThan(10);
    });

  });

  test.describe('Response Content Validation - Early Failure', () => {

    test('GATE: /status returns valid JSON', async ({ request }) => {
      const response = await request.get('/status');
      const contentType = response.headers()['content-type'] || '';

      expect(contentType).toContain('application/json');

      const json = await response.json();
      expect(json).toHaveProperty('ok');
      expect(json.ok).toBe(true);
    });

    test('GATE: /env-status returns valid JSON', async ({ request }) => {
      const response = await request.get('/env-status');
      const contentType = response.headers()['content-type'] || '';

      expect(contentType).toContain('application/json');

      const json = await response.json();
      expect(json).toHaveProperty('env');
      expect(json).toHaveProperty('deploymentId');
    });

    test('GATE: MVP surfaces return HTML (not error pages)', async ({ request }) => {
      for (const surface of MVP_SURFACES) {
        const response = await request.get(surface.url);
        const contentType = response.headers()['content-type'] || '';

        expect(contentType, `${surface.name} not returning HTML`).toContain('text/html');
      }
    });

  });

  test.describe('API Endpoint Reachability - Fail-Fast', () => {

    test('GATE: api_list is reachable', async ({ request }) => {
      const response = await request.get(`/?p=api&action=list&brand=${BRAND}&scope=events`);

      expect(response.status(), 'api_list returned 503').not.toBe(503);
      expect(response.status()).toBeLessThan(500);
    });

    test('GATE: status endpoints respond within 10 seconds', async ({ request }) => {
      const startTime = Date.now();
      const response = await request.get('/status');
      const endTime = Date.now();

      const responseTime = endTime - startTime;

      expect(response.ok()).toBe(true);
      // Should respond within 10 seconds (GAS cold start allowance)
      expect(responseTime, 'Response time exceeded 10 seconds').toBeLessThan(10000);
    });

  });

  test.describe('No GAS HTML Leak - Fail-Fast', () => {

    // GAS HTML shell markers - these indicate Worker is not serving HTML templates
    // and the request is falling through to raw GAS output
    const GAS_HTML_MARKERS = [
      'userCodeAppPanel',           // GAS iframe wrapper div ID
      'Google Apps Script',         // GAS error page text
      'macros/s/',                  // GAS deployment URL path segment
    ];

    test('GATE: /events does not return GAS HTML shell', async ({ request }) => {
      const response = await request.get('/events');
      const content = await response.text();

      // Check for GAS HTML shell markers
      const detectedMarkers = GAS_HTML_MARKERS.filter(marker => content.includes(marker));

      if (detectedMarkers.length > 0) {
        console.error('='.repeat(60));
        console.error('CRITICAL FAILURE: GAS HTML Shell Detected');
        console.error('URL: /events');
        console.error(`Detected markers: ${detectedMarkers.join(', ')}`);
        console.error('Worker is not serving HTML templates - routing broken.');
        console.error('ABORTING TEST RUN - GAS HTML leak detected.');
        console.error('='.repeat(60));
      }

      // Assert no GAS markers present
      for (const marker of GAS_HTML_MARKERS) {
        expect(content, `GAS marker "${marker}" found in response`).not.toContain(marker);
      }
    });

  });

});
