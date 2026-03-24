/**
 * Stage-2 API Smoke Test: Worker → GAS Routing Validation
 *
 * Story 3 - Validate Worker → GAS Routing With New NU Transport
 *
 * Purpose:
 *   Ensure Worker routing /api/* correctly proxies to GAS for staging with
 *   the new NU transport. Prevent mismatches between staging and prod deployments.
 *
 * Acceptance Criteria:
 *   - /api/events/list returns JSON 200 from GAS in staging
 *   - Worker never returns HTML on /api/*
 *   - CORS rules remain unchanged (same-origin iframe → safe)
 *
 * Contract: Response envelope format per ApiSchemas.gs
 *
 * @see NUSDK.html - Fetch-based RPC transport
 * @see cloudflare-proxy/worker.js - handleApiRequest()
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

test.describe('Worker → GAS Routing (NU Transport)', () => {

  test.describe('/api/events/list - Fetch-Based Endpoint', () => {

    test('returns HTTP 200 with JSON Content-Type', async ({ request }) => {
      const response = await request.post('/api/events/list', {
        data: { brandId: BRAND }
      });

      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('returns valid envelope wrapper (ok, value)', async ({ request }) => {
      const response = await request.post('/api/events/list', {
        data: { brandId: BRAND }
      });

      expect(response.ok()).toBe(true);
      const json = await response.json();

      // Envelope format validation per ApiSchemas.gs
      expect(json).toHaveProperty('ok');
      expect(typeof json.ok).toBe('boolean');

      if (json.ok === true) {
        // Success envelope must have 'value'
        expect(json).toHaveProperty('value');
      } else {
        // Error envelope must have code and message
        expect(json).toHaveProperty('code');
        expect(json).toHaveProperty('message');
      }
    });

    test('value contains items array with events', async ({ request }) => {
      const response = await request.post('/api/events/list', {
        data: { brandId: BRAND }
      });

      const json = await response.json();

      if (json.ok && json.value) {
        expect(json.value).toHaveProperty('items');
        expect(Array.isArray(json.value.items)).toBe(true);
      }
    });

    test('response does NOT contain HTML (no fallback routing)', async ({ request }) => {
      const response = await request.post('/api/events/list', {
        data: { brandId: BRAND }
      });

      const text = await response.text();

      // Worker should NEVER return HTML on /api/* routes
      // If this fails, it indicates fallback HTML routing occurred
      expect(text).not.toContain('<!DOCTYPE');
      expect(text).not.toContain('<html');
      expect(text).not.toContain('<body');
      expect(text).not.toContain('<head>');

      // Verify it parses as JSON
      expect(() => JSON.parse(text)).not.toThrow();
    });

  });

  test.describe('/api/rpc - Legacy RPC Endpoint', () => {

    test('returns HTTP 200 for api_list method', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_list',
          payload: { brandId: BRAND, scope: 'events' }
        }
      });

      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('returns valid envelope with events list', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_list',
          payload: { brandId: BRAND, scope: 'events' }
        }
      });

      const json = await response.json();

      expect(json).toHaveProperty('ok');
      if (json.ok && json.value) {
        expect(json.value).toHaveProperty('items');
        expect(Array.isArray(json.value.items)).toBe(true);
      }
    });

    test('response does NOT contain HTML', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_list',
          payload: { brandId: BRAND }
        }
      });

      const text = await response.text();

      // Worker should NEVER return HTML on /api/* routes
      expect(text).not.toContain('<!DOCTYPE');
      expect(text).not.toContain('<html');
    });

  });

  test.describe('CORS Headers Validation', () => {

    test('OPTIONS returns proper CORS headers', async ({ request }) => {
      const response = await request.fetch('/api/events/list', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://stg.eventangle.com',
          'Access-Control-Request-Method': 'POST'
        }
      });

      // Should return 204 No Content for preflight
      expect(response.status()).toBe(204);

      // Check CORS headers
      const headers = response.headers();
      expect(headers['access-control-allow-origin']).toBe('*');
      expect(headers['access-control-allow-methods']).toContain('POST');
    });

    test('POST response includes CORS headers', async ({ request }) => {
      const response = await request.post('/api/events/list', {
        data: { brandId: BRAND }
      });

      // CORS headers should be present on the response
      const headers = response.headers();
      expect(headers['access-control-allow-origin']).toBe('*');
    });

    test('X-Proxied-By header confirms Worker routing', async ({ request }) => {
      const response = await request.post('/api/events/list', {
        data: { brandId: BRAND }
      });

      const headers = response.headers();
      // Worker adds transparency headers
      expect(headers['x-proxied-by']).toBe('eventangle-worker');
      expect(headers['x-worker-version']).toBeDefined();
    });

  });

  test.describe('Error Handling (Negative Tests)', () => {

    test('returns JSON error for invalid JSON body', async ({ request }) => {
      const response = await request.post('/api/events/list', {
        data: 'not-valid-json',
        headers: { 'Content-Type': 'text/plain' }
      });

      // Should return 400 with JSON error, NOT HTML
      expect(response.status()).toBe(400);
      expect(response.headers()['content-type']).toContain('application/json');

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('BAD_INPUT');
    });

    test('returns JSON error for missing API path', async ({ request }) => {
      const response = await request.post('/api/', {
        data: {}
      });

      // Even errors should be JSON, not HTML
      const text = await response.text();
      expect(text).not.toContain('<!DOCTYPE');

      // Parse as JSON
      const json = JSON.parse(text);
      expect(json.ok).toBe(false);
    });

    test('returns JSON 404 for unknown API action', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_nonexistent_method',
          payload: {}
        }
      });

      // Should still return JSON, not HTML
      const text = await response.text();
      expect(text).not.toContain('<!DOCTYPE');
      expect(text).not.toContain('<html');
    });

    test('error response includes corrId for tracking', async ({ request }) => {
      // Request with missing required method
      const response = await request.post('/api/rpc', {
        data: { payload: { brandId: BRAND } }
      });

      // Error response should have correlation ID
      if (response.status() >= 400) {
        const json = await response.json();
        // corrId is optional but recommended
        if (json.corrId) {
          expect(typeof json.corrId).toBe('string');
          expect(json.corrId.length).toBeGreaterThan(0);
        }
      }
    });

  });

  test.describe('Worker Transparency Headers', () => {

    test('response includes X-Worker-Version header', async ({ request }) => {
      const response = await request.post('/api/events/list', {
        data: { brandId: BRAND }
      });

      const version = response.headers()['x-worker-version'];
      expect(version).toBeDefined();
      // Version should follow semver-like pattern (e.g., 1.5.0)
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('response includes X-Proxy-Duration-Ms header', async ({ request }) => {
      const response = await request.post('/api/events/list', {
        data: { brandId: BRAND }
      });

      const duration = response.headers()['x-proxy-duration-ms'];
      expect(duration).toBeDefined();
      // Duration should be a positive number
      expect(parseInt(duration)).toBeGreaterThan(0);
    });

  });

  test.describe('GAS Backend Connectivity', () => {

    test('api/status returns backend health check', async ({ request }) => {
      const response = await request.post('/api/status', {
        data: { brandId: BRAND }
      });

      expect(response.status()).toBe(200);
      const json = await response.json();

      // Status endpoint returns flat format with ok field
      expect(json.ok).toBeDefined();
    });

    test('api/getPublicBundle returns event bundle', async ({ request }) => {
      // First get an event ID
      const listResponse = await request.post('/api/events/list', {
        data: { brandId: BRAND }
      });
      const listJson = await listResponse.json();

      if (listJson.ok && listJson.value?.items?.length > 0) {
        const eventId = listJson.value.items[0].id;

        const response = await request.post('/api/getPublicBundle', {
          data: { brandId: BRAND, eventId }
        });

        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('application/json');

        const json = await response.json();
        expect(json.ok).toBe(true);
        if (json.value) {
          expect(json.value).toHaveProperty('event');
        }
      }
    });

  });

});
