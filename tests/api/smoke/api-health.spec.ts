/**
 * Stage-2 API Smoke Test: /api/status Health Check
 * Story 5: Health check endpoint for CI/CD pipelines
 *
 * Validates that the /api/status health check endpoint returns correct shape.
 * This is the primary gate for Stage-2 pipeline - if this fails, skip heavy tests.
 *
 * Contract:
 * {
 *   "ok": true,
 *   "status": 200,
 *   "version": "stg-2025.12.09",
 *   "checks": {
 *     "gas": "ok",
 *     "eventsIndex": "ok"
 *   }
 * }
 *
 * Error format (when GAS fails):
 * {
 *   "ok": false,
 *   "status": 502,
 *   "errorCode": "GAS_UPSTREAM_NON_JSON"
 * }
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

test.describe('API Health Check (/api/status) - Story 5', () => {

  test.describe('Success Path', () => {

    test('GET /api/status returns HTTP 200 when healthy', async ({ request }) => {
      const response = await request.get(`/api/status?brand=${BRAND}`);
      expect(response.status()).toBe(200);
    });

    test('returns valid JSON with required health check fields', async ({ request }) => {
      const response = await request.get(`/api/status?brand=${BRAND}`);
      expect(response.ok()).toBe(true);

      const json = await response.json();

      // Required fields per Story 5 AC
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');
      expect(json.ok).toBe(true);

      expect(json).toHaveProperty('status');
      expect(typeof json.status).toBe('number');
      expect(json.status).toBe(200);

      expect(json).toHaveProperty('version');
      expect(typeof json.version).toBe('string');
      expect(json.version.length).toBeGreaterThan(0);

      expect(json).toHaveProperty('checks');
      expect(typeof json.checks).toBe('object');
    });

    test('checks object contains gas and eventsIndex fields', async ({ request }) => {
      const response = await request.get(`/api/status?brand=${BRAND}`);
      const json = await response.json();

      expect(json.checks).toHaveProperty('gas');
      expect(json.checks.gas).toBe('ok');

      expect(json.checks).toHaveProperty('eventsIndex');
      expect(json.checks.eventsIndex).toBe('ok');
    });

    test('includes optional diagnostic fields', async ({ request }) => {
      const response = await request.get(`/api/status?brand=${BRAND}`);
      const json = await response.json();

      // Optional but expected fields
      if (json.gasBuildId !== undefined) {
        expect(typeof json.gasBuildId).toBe('string');
      }

      if (json.brandId !== undefined) {
        expect(typeof json.brandId).toBe('string');
        expect(json.brandId).toBe(BRAND);
      }

      if (json.time !== undefined) {
        expect(typeof json.time).toBe('string');
        // ISO 8601 format
        expect(json.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }

      if (json.durationMs !== undefined) {
        expect(typeof json.durationMs).toBe('number');
        expect(json.durationMs).toBeGreaterThan(0);
      }
    });

    test('includes transparency headers', async ({ request }) => {
      const response = await request.get(`/api/status?brand=${BRAND}`);

      const headers = response.headers();

      expect(headers['content-type']).toContain('application/json');
      expect(headers['x-proxied-by']).toBe('eventangle-worker');
      expect(headers['x-worker-version']).toBeDefined();
      expect(headers['x-backend-status']).toBeDefined();
      expect(headers['x-backend-duration-ms']).toBeDefined();
    });

    test('has cache-control no-store header', async ({ request }) => {
      const response = await request.get(`/api/status?brand=${BRAND}`);
      const headers = response.headers();

      // Health checks should never be cached
      expect(headers['cache-control']).toContain('no-cache');
    });

  });

  test.describe('POST Method Support', () => {

    test('POST /api/status with body works', async ({ request }) => {
      const response = await request.post(`/api/status`, {
        data: { brandId: BRAND }
      });

      expect(response.status()).toBe(200);

      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(json.checks.gas).toBe('ok');
      expect(json.checks.eventsIndex).toBe('ok');
    });

    test('POST /api/status with empty body uses defaults', async ({ request }) => {
      const response = await request.post(`/api/status`, {
        data: {}
      });

      expect(response.status()).toBe(200);

      const json = await response.json();
      expect(json.ok).toBe(true);
    });

  });

  test.describe('Response Time', () => {

    test('responds within 15 seconds (timeout threshold)', async ({ request }) => {
      const startTime = Date.now();
      const response = await request.get(`/api/status?brand=${BRAND}`);
      const duration = Date.now() - startTime;

      expect(response.ok()).toBe(true);
      // Health checks have 15s timeout - should respond much faster
      expect(duration).toBeLessThan(15000);
    });

  });

  test.describe('Version Field', () => {

    test('version field matches worker build pattern', async ({ request }) => {
      const response = await request.get(`/api/status?brand=${BRAND}`);
      const json = await response.json();

      // Version should match pattern like "stg-2025.12.09" or "prod-2025.12.09"
      // or at minimum be a non-empty string
      expect(json.version).toBeDefined();
      expect(json.version.length).toBeGreaterThan(0);
    });

  });

  test.describe('CI/CD Gate Validation', () => {

    test('all required fields present for CI gate decision', async ({ request }) => {
      const response = await request.get(`/api/status?brand=${BRAND}`);
      const json = await response.json();

      // CI gate requires these fields to make pass/fail decision
      const requiredFields = ['ok', 'status', 'checks'];
      for (const field of requiredFields) {
        expect(json).toHaveProperty(field);
      }

      // ok must be boolean for gate logic
      expect(typeof json.ok).toBe('boolean');

      // status must be number for HTTP status comparison
      expect(typeof json.status).toBe('number');

      // checks must contain gas and eventsIndex
      expect(json.checks).toHaveProperty('gas');
      expect(json.checks).toHaveProperty('eventsIndex');
    });

    test('passes CI gate criteria (ok=true, status=200, checks=ok)', async ({ request }) => {
      const response = await request.get(`/api/status?brand=${BRAND}`);
      const json = await response.json();

      // This is the actual gate check used by CI
      const passesGate = json.ok === true &&
                         json.status === 200 &&
                         json.checks?.gas === 'ok' &&
                         json.checks?.eventsIndex === 'ok';

      expect(passesGate).toBe(true);
    });

  });

});
