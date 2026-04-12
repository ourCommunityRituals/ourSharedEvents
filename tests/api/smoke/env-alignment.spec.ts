/**
 * Environment Alignment Gate — Staging
 *
 * Validates that the Worker is deployed to the correct environment
 * and returns expected metadata via /health.
 *
 * GAS backend is fully decommissioned — no GAS alignment checks.
 */

import { test, expect } from '@playwright/test';

const EXPECTED_ENV = 'staging';

test.describe('Environment Alignment Gate', () => {
  test.describe('Worker /health Environment Check', () => {
    test('returns HTTP 200 with JSON', async ({ request }) => {
      const response = await request.get('/health');

      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('env is "staging"', async ({ request }) => {
      const response = await request.get('/health');
      const json = await response.json();

      expect(json).toHaveProperty('env');
      expect(json.env).toBe(EXPECTED_ENV);
    });

    test('version is a non-empty string', async ({ request }) => {
      const response = await request.get('/health');
      const json = await response.json();

      expect(json).toHaveProperty('version');
      expect(typeof json.version).toBe('string');
      expect(json.version.length).toBeGreaterThan(0);
    });

    test('db connectivity is confirmed', async ({ request }) => {
      const response = await request.get('/health');
      const json = await response.json();

      expect(json).toHaveProperty('db');
      expect(json.db).toBe('ok');
    });
  });

  test.describe('Alignment Summary Report', () => {
    test('generates worker health report for CI artifacts', async ({ request }) => {
      const response = await request.get('/health');
      const json = await response.json();

      const report = {
        timestamp: new Date().toISOString(),
        expectedEnv: EXPECTED_ENV,
        worker: {
          env: json.env,
          version: json.version,
          db: json.db,
          ok: json.ok,
        },
        checks: {
          envMatch: json.env === EXPECTED_ENV,
          dbHealthy: json.db === 'ok',
          workerOk: json.ok === true,
        },
        verdict: 'PENDING',
      };

      report.verdict =
        report.checks.envMatch && report.checks.dbHealthy && report.checks.workerOk
          ? 'PASS'
          : 'FAIL';

      console.log('\n========== ENVIRONMENT ALIGNMENT REPORT ==========');
      console.log(JSON.stringify(report, null, 2));
      console.log('='.repeat(50));

      expect(report.verdict).toBe('PASS');
    });
  });
});
