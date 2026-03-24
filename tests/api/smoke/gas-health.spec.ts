/**
 * Stage-2 API Smoke Test: GAS Reachability Health Check
 *
 * Story 6 - Validate GAS is reachable through Worker proxy
 *
 * Purpose:
 *   Simple health check to ensure GAS backend is accessible before release.
 *   Prevents staging outages by catching GAS connectivity issues early.
 *
 * Acceptance Criteria:
 *   - Worker /ping endpoint returns HTTP 200
 *   - GAS /ping (proxied through Worker) returns HTTP 200
 *   - PR cannot merge if GAS is unreachable
 *   - Prevents outage on staging before release
 *
 * Test Flow:
 *   1. Hit Worker -> /ping (Worker routes to GAS via handleJsonPageRequest)
 *   2. Assert 200 OK response
 *   3. Validate response contains expected health data
 *
 * @see cloudflare-proxy/worker.js - JSON_ROUTE_MAP, handleJsonPageRequest()
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

test.describe('GAS Reachability Health Check (Story 6)', () => {

  test.describe('Worker /ping Endpoint', () => {

    test('returns HTTP 200 OK', async ({ request }) => {
      const response = await request.get(`/ping?brand=${BRAND}`);

      // CRITICAL: If this fails, GAS is unreachable
      expect(response.status()).toBe(200);
    });

    test('returns JSON content type', async ({ request }) => {
      const response = await request.get(`/ping?brand=${BRAND}`);

      expect(response.ok()).toBe(true);
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('includes Worker transparency headers', async ({ request }) => {
      const response = await request.get(`/ping?brand=${BRAND}`);

      const headers = response.headers();

      // Worker transparency headers prove request went through Worker
      expect(headers['x-proxied-by']).toBe('eventangle-worker');
      expect(headers['x-worker-version']).toBeDefined();
    });

  });

  test.describe('Worker /status Endpoint (GAS Proxied)', () => {

    test('returns HTTP 200 OK', async ({ request }) => {
      const response = await request.get(`/status?brand=${BRAND}`);

      // CRITICAL: If this fails, GAS backend is down or unreachable
      expect(response.status()).toBe(200);
    });

    test('returns valid JSON with health indicators', async ({ request }) => {
      const response = await request.get(`/status?brand=${BRAND}`);

      expect(response.ok()).toBe(true);

      const json = await response.json();

      // Basic health indicators from GAS status endpoint
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');

      // buildId confirms GAS is serving real responses
      expect(json).toHaveProperty('buildId');
      expect(typeof json.buildId).toBe('string');
      expect(json.buildId.length).toBeGreaterThan(0);
    });

    test('includes Worker proxy headers (proves GAS routing works)', async ({ request }) => {
      const response = await request.get(`/status?brand=${BRAND}`);

      const headers = response.headers();

      // Worker adds these headers when proxying to GAS
      expect(headers['x-proxied-by']).toBe('eventangle-worker');
      expect(headers['x-worker-version']).toBeDefined();
    });

  });

  test.describe('GAS Backend Reachability (CI Gate)', () => {

    test('GAS responds within acceptable latency', async ({ request }) => {
      const startTime = Date.now();

      const response = await request.get(`/status?brand=${BRAND}`);

      const latencyMs = Date.now() - startTime;

      // GAS should respond within 10 seconds (generous for cold starts)
      expect(latencyMs).toBeLessThan(10000);

      // Should still be successful
      expect(response.status()).toBe(200);

      console.log(`[GAS Health] /status latency: ${latencyMs}ms`);
    });

    test('Multiple ping requests succeed (stability check)', async ({ request }) => {
      // Send 3 quick pings to verify stability (not just a lucky response)
      const results = await Promise.all([
        request.get(`/ping?brand=${BRAND}`),
        request.get(`/status?brand=${BRAND}`),
        request.get(`/ping?brand=${BRAND}`),
      ]);

      // All requests should succeed
      for (const response of results) {
        expect(response.status()).toBe(200);
      }
    });

  });

  test.describe('Reachability Summary Report', () => {

    test('generates health report for CI artifacts', async ({ request }) => {
      const startTime = Date.now();

      // Fetch both health endpoints
      const [pingRes, statusRes] = await Promise.all([
        request.get(`/ping?brand=${BRAND}`),
        request.get(`/status?brand=${BRAND}`)
      ]);

      const totalLatencyMs = Date.now() - startTime;

      const pingOk = pingRes.status() === 200;
      const statusOk = statusRes.status() === 200;

      let statusJson = null;
      if (statusOk) {
        try {
          statusJson = await statusRes.json();
        } catch {
          // JSON parse failed
        }
      }

      // Build health report
      const healthReport = {
        timestamp: new Date().toISOString(),
        brand: BRAND,
        endpoints: {
          ping: {
            url: '/ping',
            status: pingRes.status(),
            ok: pingOk,
            workerVersion: pingRes.headers()['x-worker-version'] || 'unknown'
          },
          status: {
            url: '/status',
            status: statusRes.status(),
            ok: statusOk,
            buildId: statusJson?.buildId || 'unknown',
            gasOk: statusJson?.ok ?? false
          }
        },
        latencyMs: totalLatencyMs,
        workerReachable: pingOk,
        gasReachable: statusOk && (statusJson?.ok === true),
        verdict: 'PENDING'
      };

      // Determine overall verdict
      const allChecksPass = healthReport.workerReachable && healthReport.gasReachable;
      healthReport.verdict = allChecksPass ? 'PASS' : 'FAIL';

      // Log report for CI visibility
      console.log('\n========== GAS REACHABILITY REPORT (Story 6) ==========');
      console.log(JSON.stringify(healthReport, null, 2));
      console.log('='.repeat(55));

      // Final assertion - all checks must pass
      expect(healthReport.verdict).toBe('PASS');

      // Explicit assertions for clear failure messages
      expect(healthReport.workerReachable).toBe(true);
      expect(healthReport.gasReachable).toBe(true);
    });

  });

});
