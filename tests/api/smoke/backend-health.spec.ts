/**
 * Stage-2 API Smoke Test: /api/health/backend
 * Story B2: Health Endpoint (Token + Sheets Read Probe)
 *
 * Validates that the /api/health/backend endpoint returns correct shape.
 * Per Story B2: "One call that tells you if staging backend is actually usable."
 *
 * Contract (per Architect):
 * {
 *   "ok": true,
 *   "env": "staging",
 *   "backend": "cloudflare",
 *   "googleAuth": "service_account",
 *   "token": "ok",
 *   "sheetsProbe": { "ok": true, "status": 200 },
 *   "workerVersion": "..."
 * }
 *
 * Negative Paths:
 * - 403 from Sheets probe includes hint: "Share sheet with <service account email>"
 *
 * CI/CD Gate Impact:
 * - Stage-2 hard gate: deploy fails if health not green
 */

import { test, expect } from '@playwright/test';

test.describe('Backend Health Check (/api/health/backend) - Story B2', () => {

  test.describe('Success Path', () => {

    test('GET /api/health/backend returns HTTP 200 when healthy', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      expect(response.status()).toBe(200);
    });

    test('returns valid JSON with Story B2 contract fields', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      expect(response.ok()).toBe(true);

      const json = await response.json();

      // Required fields per Story B2 contract
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');
      expect(json.ok).toBe(true);

      expect(json).toHaveProperty('env');
      expect(typeof json.env).toBe('string');

      expect(json).toHaveProperty('backend');
      expect(json.backend).toBe('cloudflare');

      expect(json).toHaveProperty('googleAuth');
      expect(json.googleAuth).toBe('service_account');

      expect(json).toHaveProperty('token');
      expect(json.token).toBe('ok');

      expect(json).toHaveProperty('sheetsProbe');
      expect(typeof json.sheetsProbe).toBe('object');

      expect(json).toHaveProperty('workerVersion');
      expect(typeof json.workerVersion).toBe('string');
    });

    test('sheetsProbe contains required fields when healthy', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const json = await response.json();

      // sheetsProbe must have ok and status
      expect(json.sheetsProbe).toHaveProperty('ok');
      expect(typeof json.sheetsProbe.ok).toBe('boolean');

      expect(json.sheetsProbe).toHaveProperty('status');
      expect(typeof json.sheetsProbe.status).toBe('number');

      // When healthy, ok should be true and status should be 200
      if (json.ok === true) {
        expect(json.sheetsProbe.ok).toBe(true);
        expect(json.sheetsProbe.status).toBe(200);
      }
    });

    test('includes latencyMs in sheetsProbe when successful', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const json = await response.json();

      // When sheetsProbe is successful, latencyMs should be present
      if (json.sheetsProbe.ok === true && json.sheetsProbe.status === 200) {
        expect(json.sheetsProbe).toHaveProperty('latencyMs');
        expect(typeof json.sheetsProbe.latencyMs).toBe('number');
        expect(json.sheetsProbe.latencyMs).toBeGreaterThan(0);
      }
    });

  });

  test.describe('Response Headers', () => {

    test('returns correct content-type header', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const headers = response.headers();

      expect(headers['content-type']).toContain('application/json');
    });

    test('returns no-cache headers for health endpoint', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const headers = response.headers();

      // Health checks should never be cached
      expect(headers['cache-control']).toContain('no-cache');
    });

    test('returns X-Request-Id header', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const headers = response.headers();

      expect(headers['x-request-id']).toBeDefined();
    });

    test('returns X-Handler-Version header', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const headers = response.headers();

      expect(headers['x-handler-version']).toBeDefined();
    });

  });

  test.describe('Extended Response Fields', () => {

    test('includes requestId for tracing', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const json = await response.json();

      expect(json).toHaveProperty('requestId');
      expect(typeof json.requestId).toBe('string');
    });

    test('includes timestamp', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const json = await response.json();

      expect(json).toHaveProperty('timestamp');
      expect(typeof json.timestamp).toBe('string');
      // ISO 8601 format
      expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('includes handler version', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const json = await response.json();

      expect(json).toHaveProperty('version');
      expect(typeof json.version).toBe('string');
    });

  });

  test.describe('CI/CD Gate Validation', () => {

    test('all required fields present for CI gate decision', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const json = await response.json();

      // CI gate requires these fields per Story B2
      const requiredFields = ['ok', 'env', 'backend', 'googleAuth', 'token', 'sheetsProbe', 'workerVersion'];
      for (const field of requiredFields) {
        expect(json).toHaveProperty(field);
      }

      // ok must be boolean for gate logic
      expect(typeof json.ok).toBe('boolean');

      // sheetsProbe must contain ok for gate logic
      expect(json.sheetsProbe).toHaveProperty('ok');
      expect(typeof json.sheetsProbe.ok).toBe('boolean');
    });

    test('passes CI gate criteria (ok=true and sheetsProbe.ok=true)', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const json = await response.json();

      // This is the actual gate check used by CI per Story B2
      const passesGate = json.ok === true && json.sheetsProbe?.ok === true;

      expect(passesGate).toBe(true);
    });

    test('token status is "ok" when healthy', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const json = await response.json();

      if (json.ok === true) {
        expect(json.token).toBe('ok');
      }
    });

  });

  test.describe('Response Time', () => {

    test('responds within 15 seconds (timeout threshold)', async ({ request }) => {
      const startTime = Date.now();
      const response = await request.get('/api/health/backend');
      const duration = Date.now() - startTime;

      expect(response.ok()).toBe(true);
      // Backend health checks involve token + sheets probe, should still be fast
      expect(duration).toBeLessThan(15000);
    });

  });

  test.describe('Error Response Shape', () => {

    // Note: These tests validate the error response structure when failures occur
    // In a properly configured environment, these paths may not be exercised

    test('error response includes code and error fields', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const json = await response.json();

      // If unhealthy, should include error details
      if (json.ok === false) {
        expect(json).toHaveProperty('code');
        expect(typeof json.code).toBe('string');

        expect(json).toHaveProperty('error');
        expect(typeof json.error).toBe('string');
      }
    });

    test('sheetsProbe includes hint when error is actionable', async ({ request }) => {
      const response = await request.get('/api/health/backend');
      const json = await response.json();

      // Per Story B2: 403 errors should include hint about sharing sheet
      if (json.sheetsProbe?.ok === false && json.sheetsProbe?.status === 403) {
        expect(json.sheetsProbe).toHaveProperty('hint');
        expect(typeof json.sheetsProbe.hint).toBe('string');
        expect(json.sheetsProbe.hint).toContain('Share sheet with');
      }
    });

  });

});
