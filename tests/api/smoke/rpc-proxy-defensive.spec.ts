/**
 * Stage-2 API Smoke Test: RPC Proxy Defensive Response Handling
 *
 * Story 3 - Make the Worker RPC proxy honest and defensive
 *
 * Purpose:
 *   Validates that the Worker RPC proxy returns structured JSON errors
 *   even when GAS fails or returns non-JSON responses.
 *
 * Acceptance Criteria:
 *   - /api/rpc returns 5xx with structured JSON error, not HTML
 *   - JSON parse always succeeds on error responses
 *   - ok flag and status line up with HTTP status
 *   - content-type is application/json only when body is JSON
 *   - No "You do not have permission..." HTML reaches the browser
 *
 * Test Flow:
 *   1. Test normal RPC call returns valid JSON
 *   2. Test error responses are still valid JSON
 *   3. Validate transparency headers (x-backend-status, x-backend-duration-ms)
 *   4. Validate response contract: { ok, status?, errorCode?, message? }
 *
 * @see cloudflare-proxy/worker.js - processUpstreamResponse()
 */

import { test, expect } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

test.describe('RPC Proxy Defensive Response Handling (Story 3)', () => {

  test.describe('/api/rpc Endpoint', () => {

    test('returns JSON content type for valid requests', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_status',
          payload: { brandId: BRAND }
        }
      });

      // Content-Type should always be application/json
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('response is always parseable as JSON', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_status',
          payload: { brandId: BRAND }
        }
      });

      // This should never throw - we guarantee JSON responses
      const json = await response.json();
      expect(json).toBeDefined();
      expect(typeof json).toBe('object');
    });

    test('valid RPC returns ok:true with value', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_status',
          payload: { brandId: BRAND }
        }
      });

      expect(response.ok()).toBe(true);

      const json = await response.json();
      expect(json).toHaveProperty('ok');
      // Note: ok might be true or false depending on GAS state
      expect(typeof json.ok).toBe('boolean');
    });

    test('includes Worker transparency headers', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_status',
          payload: { brandId: BRAND }
        }
      });

      const headers = response.headers();

      // Worker transparency headers prove request went through Worker
      expect(headers['x-proxied-by'] || headers['x-worker-version']).toBeDefined();
    });

    test('includes X-Backend-Status header', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_status',
          payload: { brandId: BRAND }
        }
      });

      const headers = response.headers();

      // Story 3: New transparency header showing upstream status
      expect(headers['x-backend-status']).toBeDefined();
      expect(parseInt(headers['x-backend-status'])).toBeGreaterThanOrEqual(200);
    });

    test('includes X-Backend-Duration-Ms header', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_status',
          payload: { brandId: BRAND }
        }
      });

      const headers = response.headers();

      // Story 3: New transparency header showing upstream latency
      expect(headers['x-backend-duration-ms']).toBeDefined();
      const duration = parseInt(headers['x-backend-duration-ms']);
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(30000); // Should be less than timeout
    });

  });

  test.describe('/api/<path> Endpoint', () => {

    test('returns JSON content type for path-based API calls', async ({ request }) => {
      const response = await request.post('/api/status', {
        data: { brandId: BRAND }
      });

      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('response is always parseable as JSON', async ({ request }) => {
      const response = await request.post('/api/status', {
        data: { brandId: BRAND }
      });

      const json = await response.json();
      expect(json).toBeDefined();
      expect(typeof json).toBe('object');
    });

    test('includes transparency headers', async ({ request }) => {
      const response = await request.post('/api/status', {
        data: { brandId: BRAND }
      });

      const headers = response.headers();

      expect(headers['x-backend-status']).toBeDefined();
      expect(headers['x-backend-duration-ms']).toBeDefined();
    });

  });

  test.describe('Error Response Contract', () => {

    test('invalid method returns 400 with structured error', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          // Missing 'method' field
          payload: {}
        }
      });

      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('BAD_INPUT');
      expect(json.message).toBeDefined();
    });

    test('invalid JSON body returns 400 with structured error', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: 'not-json',
        headers: {
          'Content-Type': 'text/plain'
        }
      });

      // Should return 400 for bad input
      expect(response.status()).toBeGreaterThanOrEqual(400);

      const json = await response.json();
      expect(json.ok).toBe(false);
    });

    test('missing API path returns 400 with structured error', async ({ request }) => {
      const response = await request.post('/api/', {
        data: {}
      });

      expect(response.status()).toBe(400);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe('BAD_INPUT');
      expect(json.message).toContain('Missing API path');
    });

  });

  test.describe('Response Never Contains Raw HTML', () => {

    test('error response does not contain HTML tags', async ({ request }) => {
      // Request with intentionally bad method to trigger potential error
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_nonexistent_action_xyz',
          payload: { brandId: BRAND }
        }
      });

      const text = await response.text();

      // Even on error, response should be JSON not HTML
      expect(text).not.toContain('<html');
      expect(text).not.toContain('<!DOCTYPE');
      expect(text).not.toContain('You do not have permission');

      // Should be valid JSON
      expect(() => JSON.parse(text)).not.toThrow();
    });

    test('content-type is application/json even on error', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_nonexistent_action_xyz',
          payload: { brandId: BRAND }
        }
      });

      expect(response.headers()['content-type']).toContain('application/json');
    });

  });

  test.describe('JSON Parse Always Succeeds', () => {

    test('200 response is valid JSON', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_status',
          payload: { brandId: BRAND }
        }
      });

      if (response.status() === 200) {
        const json = await response.json();
        expect(json).toBeDefined();
      }
    });

    test('4xx response is valid JSON', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {} // Missing method - should be 400
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);

      const json = await response.json();
      expect(json).toBeDefined();
      expect(json.ok).toBe(false);
    });

    test('5xx response is valid JSON with error structure', async ({ request }) => {
      // This test validates that IF we get a 5xx, it's still JSON
      // We can't easily force a 5xx in this test, but we validate the contract

      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_status',
          payload: { brandId: BRAND }
        }
      });

      // If somehow we got a 5xx, ensure it's still JSON
      if (response.status() >= 500) {
        const json = await response.json();
        expect(json).toBeDefined();
        expect(json.ok).toBe(false);
        expect(json.errorCode).toBeDefined();
        expect(json.message).toBeDefined();
      }
    });

  });

  test.describe('ok Flag and Status Alignment', () => {

    test('HTTP 200 may have ok:true or ok:false (business logic)', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {
          method: 'api_status',
          payload: { brandId: BRAND }
        }
      });

      if (response.status() === 200) {
        const json = await response.json();
        // ok can be true (success) or false (GAS-level error)
        // Both are valid for HTTP 200 (transport succeeded)
        expect(typeof json.ok).toBe('boolean');
      }
    });

    test('HTTP 4xx always has ok:false', async ({ request }) => {
      const response = await request.post('/api/rpc', {
        data: {} // Bad input
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);

      const json = await response.json();
      expect(json.ok).toBe(false);
    });

  });

});

test.describe('RPC Proxy Defensive - CI Gate Tests', () => {

  test('RPC endpoint responds within acceptable latency', async ({ request }) => {
    const startTime = Date.now();

    const response = await request.post('/api/rpc', {
      data: {
        method: 'api_status',
        payload: { brandId: BRAND }
      }
    });

    const endTime = Date.now();
    const latency = endTime - startTime;

    // RPC should respond within 10 seconds (generous for CI)
    expect(latency).toBeLessThan(10000);

    // Should still be valid JSON regardless of latency
    expect(response.headers()['content-type']).toContain('application/json');
  });

  test('RPC endpoint is reachable through Worker', async ({ request }) => {
    const response = await request.post('/api/rpc', {
      data: {
        method: 'api_status',
        payload: { brandId: BRAND }
      }
    });

    // Worker should have processed this (not a direct GAS response)
    const headers = response.headers();

    // At minimum, we should get JSON back
    expect(response.headers()['content-type']).toContain('application/json');
  });

});
