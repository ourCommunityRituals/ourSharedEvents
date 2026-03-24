/**
 * System API Tests - Playwright
 * Replaces Newman system API tests with Playwright API testing
 */

import { test, expect } from '@playwright/test';
import { ApiHelpers } from './api-helpers.js';
import { getCurrentEnvironment } from '../../config/environments.js';

test.describe('System APIs', () => {
  let api;

  test.beforeEach(async ({ request }) => {
    const env = getCurrentEnvironment();
    api = new ApiHelpers(request, env.baseUrl);
  });

  test.describe('Status Endpoint', () => {
    test('returns 200 OK', async () => {
      const response = await api.getStatus('root');

      expect(response.status()).toBe(200);
      expect(response.ok()).toBe(true);
    });

    test('returns correct JSON structure', async () => {
      const response = await api.getStatus('root');
      const data = await response.json();

      // /status endpoint uses api_statusPure which returns FLAT format
      expect(data).toHaveProperty('ok');
      expect(data.ok).toBe(true);

      // FLAT format: buildId, brandId, timestamp (not nested in value)
      expect(data).toHaveProperty('buildId');
      expect(data).toHaveProperty('brandId');
      expect(data.brandId).toBe('root');
      expect(data).toHaveProperty('timestamp');
    });

    test('works for all brands', async () => {
      const brands = ['root', 'abc', 'cbc', 'cbl'];

      for (const brand of brands) {
        const response = await api.getStatus(brand);
        const data = await response.json();

        expect(response.ok()).toBe(true);
        expect(data.ok).toBe(true);
        // FLAT format: brandId not value.brand
        expect(data.brandId).toBe(brand);
      }
    });

    test('returns build information', async () => {
      const response = await api.getStatus('root');
      const data = await response.json();

      // FLAT format: buildId not value.build
      expect(data.buildId).toBeDefined();
      expect(typeof data.buildId).toBe('string');
      expect(data.buildId.length).toBeGreaterThan(0);
    });
  });

  test.describe('Diagnostics Endpoint', () => {
    test('requires authentication', async () => {
      // Without admin key - should fail or return error
      const responseNoAuth = await api.post('?action=runDiagnostics', {
        brandId: 'root'
      });

      // Should either return 401/403 or ok:false in envelope
      if (responseNoAuth.status() === 401 || responseNoAuth.status() === 403) {
        expect(responseNoAuth.ok()).toBe(false);
      } else {
        const data = await responseNoAuth.json();
        expect(data.ok).toBe(false);
      }
    });

    test('works with valid admin key', async () => {
      const adminKey = process.env.ADMIN_KEY;

      if (!adminKey) {
        test.skip('ADMIN_KEY not set');
        return;
      }

      const response = await api.runDiagnostics('root', adminKey);
      const data = await response.json();

      expect(response.ok()).toBe(true);
      expect(data.ok).toBe(true);
    });

    test('rejects invalid admin key', async () => {
      const invalidKey = 'invalid-key-12345';

      const response = await api.runDiagnostics('root', invalidKey);

      // Should fail
      if (response.ok()) {
        const data = await response.json();
        expect(data.ok).toBe(false);
        expect(data.error).toBeDefined();
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }
    });
  });

  test.describe('API Health Checks', () => {
    test('API responds within acceptable time', async () => {
      const startTime = Date.now();
      const response = await api.getStatus('root');
      const endTime = Date.now();

      const responseTime = endTime - startTime;

      expect(response.ok()).toBe(true);
      // Should respond within 5 seconds (Google Apps Script can be slow)
      expect(responseTime).toBeLessThan(5000);
    });

    test('API returns correct content-type', async () => {
      const response = await api.getStatus('root');
      const contentType = response.headers()['content-type'];

      expect(contentType).toContain('application/json');
    });

    test('API handles concurrent requests', async () => {
      // Fire 5 concurrent requests
      const promises = Array(5).fill(null).map(() => api.getStatus('root'));
      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach(response => {
        expect(response.ok()).toBe(true);
      });
    });
  });

  test.describe('Rate Limiting', () => {
    test.skip('handles rate limiting gracefully', async () => {
      // This test is skipped by default to avoid triggering rate limits
      // Enable locally if testing rate limit behavior

      // Fire many requests rapidly
      const requests = Array(50).fill(null).map(() => api.getStatus('root'));

      try {
        await Promise.all(requests);
      } catch (error) {
        // If rate limited, should get 429 response
        expect(error.message).toContain('429');
      }
    });
  });
});
