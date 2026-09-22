/**
 * API Smoke Test: Health Check (/health, /api/status)
 *
 * Validates the D1-backed Cloudflare Worker health endpoint. Runs against
 * whichever environment BASE_URL resolves to (staging or production).
 *
 * Actual contract (workers/oursharedevents/src/handlers/health.ts):
 * {
 *   "ok": true,
 *   "env": "staging",
 *   "version": "stg-610e9a1-20260412",
 *   "db": "ok" | "not_configured" | "error",
 *   "timestamp": "2026-04-12T18:15:56.761Z"
 * }
 *
 * HTTP 200 when ok=true, HTTP 503 when db="error".
 */

import { test, expect } from '@playwright/test';

// Single source of truth for BASE_URL -> environment resolution, so this
// suite validates against whichever environment it's actually pointed at
// (staging or production), rather than assuming staging.
const { getEnvironment } = require('../../../config/environments');

test.describe('Health Check (/health, /api/status)', () => {
  test.describe('Success Path', () => {
    test('GET /health returns HTTP 200 when healthy', async ({ request }) => {
      const response = await request.get('/health');
      expect(response.status()).toBe(200);
    });

    test('GET /api/status returns HTTP 200 (alias for /health)', async ({ request }) => {
      const response = await request.get('/api/status');
      expect(response.status()).toBe(200);
    });

    test('returns valid JSON with required health fields', async ({ request }) => {
      const response = await request.get('/health');
      expect(response.ok()).toBe(true);

      const json = await response.json();

      // ok — boolean
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');
      expect(json.ok).toBe(true);

      // env — string (e.g. "staging", "unknown")
      expect(json).toHaveProperty('env');
      expect(typeof json.env).toBe('string');
      expect(json.env.length).toBeGreaterThan(0);

      // version — string (build version tag)
      expect(json).toHaveProperty('version');
      expect(typeof json.version).toBe('string');
      expect(json.version.length).toBeGreaterThan(0);

      // db — string enum: "ok" | "not_configured" | "error"
      expect(json).toHaveProperty('db');
      expect(['ok', 'not_configured', 'error']).toContain(json.db);

      // timestamp — ISO 8601
      expect(json).toHaveProperty('timestamp');
      expect(typeof json.timestamp).toBe('string');
      expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('timestamp is recent (within 1 minute)', async ({ request }) => {
      const response = await request.get('/health');
      const json = await response.json();

      const responseTime = new Date(json.timestamp).getTime();
      const now = Date.now();
      expect(Math.abs(now - responseTime)).toBeLessThan(60_000);
    });
  });

  test.describe('Response Headers', () => {
    test('returns application/json content-type', async ({ request }) => {
      const response = await request.get('/health');
      expect(response.headers()['content-type']).toContain('application/json');
    });
  });

  test.describe('Response Time', () => {
    test('responds within 15 seconds', async ({ request }) => {
      const start = Date.now();
      const response = await request.get('/health');
      const duration = Date.now() - start;

      expect(response.ok()).toBe(true);
      expect(duration).toBeLessThan(15_000);
    });
  });

  test.describe('Target Environment Validation', () => {
    test('env field matches the environment under test', async ({ request }) => {
      const response = await request.get('/health');
      const json = await response.json();

      const expectedEnv = getEnvironment().name.toLowerCase();
      expect(json.env).toBe(expectedEnv);
    });

    test('db is "ok" (D1 is configured and reachable)', async ({ request }) => {
      const response = await request.get('/health');
      const json = await response.json();

      expect(json.db).toBe('ok');
    });
  });

  test.describe('CI/CD Gate Validation', () => {
    test('all required fields present for CI gate decision', async ({ request }) => {
      const response = await request.get('/health');
      const json = await response.json();

      for (const field of ['ok', 'env', 'version', 'db', 'timestamp']) {
        expect(json).toHaveProperty(field);
      }
    });

    test('passes CI gate criteria (ok=true and db!="error")', async ({ request }) => {
      const response = await request.get('/health');
      const json = await response.json();

      // Gate logic matches handleHealth(): ok = db !== 'error'
      const passesGate = json.ok === true && json.db !== 'error';
      expect(passesGate).toBe(true);
    });
  });

  test.describe('Endpoint Equivalence', () => {
    test('/health and /api/status return same shape', async ({ request }) => {
      const [healthRes, statusRes] = await Promise.all([
        request.get('/health'),
        request.get('/api/status'),
      ]);

      const healthJson = await healthRes.json();
      const statusJson = await statusRes.json();

      expect(healthJson.ok).toBe(statusJson.ok);
      expect(healthJson.env).toBe(statusJson.env);
      expect(healthJson.version).toBe(statusJson.version);
      expect(healthJson.db).toBe(statusJson.db);
    });
  });
});
