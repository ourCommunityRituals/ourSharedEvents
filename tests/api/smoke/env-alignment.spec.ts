/**
 * Stage-2 API Smoke Test: Environment Alignment Gate
 *
 * Story 5 - Validate Worker ↔ GAS deployment alignment
 * Story 5.3 UPDATE - GAS backend archived; GAS-specific tests are SKIPPED.
 *
 * Purpose:
 *   Verify the Worker /env-status endpoint is healthy and returns expected
 *   environment metadata. GAS alignment checks are skipped because the GAS
 *   backend was decommissioned in Story 5.3.
 *
 * Tests still active:
 *   - Worker /env-status endpoint responds with 200 + JSON
 *   - Required fields (env, deploymentId, workerBuild) are present
 *   - Worker transparency headers are set
 *   - env matches expected environment (staging/production)
 *
 * Tests skipped (GAS archived - Story 5.3):
 *   - GAS /whoami endpoint
 *   - Worker ↔ GAS deployment ID alignment
 *   - scriptId and email checks
 *
 * @see cloudflare-proxy/worker.js - handleEnvStatusEndpoint()
 * @see docs/migration/PHASE-1-OURSHAREDEVENTS.md
 */

import { test, expect } from '@playwright/test';

// Detect if running against production using proper URL hostname validation
function isProductionUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname === 'oursharedevents.com' ||
           parsedUrl.hostname === 'oursharedevents.com';
  } catch {
    return false;
  }
}

const IS_PRODUCTION = process.env.USE_PRODUCTION === 'true' ||
  isProductionUrl(process.env.BASE_URL);

// Expected environment name based on deployment target
const EXPECTED_ENV = IS_PRODUCTION ? 'production' : 'staging';

test.describe('Environment Alignment Gate (Story 5)', () => {

  test.describe('Worker /env-status Endpoint', () => {

    test('returns HTTP 200 with JSON', async ({ request }) => {
      const response = await request.get('/env-status');

      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('returns required fields (env, deploymentId, workerBuild)', async ({ request }) => {
      const response = await request.get('/env-status');
      const json = await response.json();

      expect(json).toHaveProperty('env');
      expect(typeof json.env).toBe('string');
      expect(['staging', 'production']).toContain(json.env);

      expect(json).toHaveProperty('deploymentId');
      expect(typeof json.deploymentId).toBe('string');
      expect(json.deploymentId.length).toBeGreaterThan(10);
      expect(json.deploymentId).not.toBe('unknown');

      expect(json).toHaveProperty('workerBuild');
      expect(typeof json.workerBuild).toBe('string');
    });

    test('includes Worker transparency headers', async ({ request }) => {
      const response = await request.get('/env-status');
      const headers = response.headers();

      expect(headers['x-worker-version']).toBeDefined();
      expect(headers['cache-control']).toContain('no-cache');
    });

    test('env matches expected environment', async ({ request }) => {
      const response = await request.get('/env-status');
      const json = await response.json();

      expect(json.env).toBe(EXPECTED_ENV);
    });

  });

  // ============================================================================
  // GAS /whoami Endpoint - SKIPPED (GAS archived Story 5.3)
  // ============================================================================
  test.describe('GAS /whoami Endpoint (via Worker) [ARCHIVED]', () => {

    test.skip(true, 'GAS backend decommissioned in Story 5.3 — skipping all GAS endpoint tests');

    test('returns HTTP 200 with JSON', async ({ request }) => {
      const response = await request.get('/?page=whoami&brand=root');
      expect(response.status()).toBe(200);
    });

  });

  // ============================================================================
  // Worker ↔ GAS Alignment - SKIPPED (GAS archived Story 5.3)
  // ============================================================================
  test.describe('Worker ↔ GAS Alignment (CI Gate) [ARCHIVED]', () => {

    test.skip(true, 'GAS backend decommissioned in Story 5.3 — skipping alignment gate');

    test('deploymentId matches between Worker and GAS', async ({ request }) => {
      const response = await request.get('/env-status');
      expect(response.status()).toBe(200);
    });

  });

  // ============================================================================
  // Alignment Summary Report (Worker-only since Story 5.3)
  // ============================================================================
  test.describe('Alignment Summary Report', () => {

    test('generates worker health report for CI artifacts', async ({ request }) => {
      const envStatusRes = await request.get('/env-status');
      const envStatus = await envStatusRes.json();

      const report = {
        timestamp: new Date().toISOString(),
        environment: EXPECTED_ENV,
        worker: {
          env: envStatus.env,
          deploymentId: envStatus.deploymentId,
          workerBuild: envStatus.workerBuild,
        },
        gas: 'ARCHIVED (Story 5.3)',
        alignment: {
          envMatch: envStatus.env === EXPECTED_ENV,
          deploymentIdPresent: typeof envStatus.deploymentId === 'string' && envStatus.deploymentId.length > 10,
        },
        verdict: 'PENDING'
      };

      const allChecksPass =
        report.alignment.envMatch &&
        report.alignment.deploymentIdPresent;

      report.verdict = allChecksPass ? 'PASS' : 'FAIL';

      console.log('\n========== ENVIRONMENT ALIGNMENT REPORT ==========');
      console.log(JSON.stringify(report, null, 2));
      console.log('='.repeat(50));

      expect(report.verdict).toBe('PASS');
    });

  });

});
