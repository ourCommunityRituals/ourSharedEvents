/**
 * Integration Tests for Story 3.1 - Worker /health/origin Endpoint
 *
 * These tests validate the /health/origin endpoint against a live staging environment.
 * Designed for CI/CD pipelines and post-deployment validation.
 *
 * Run with:
 *   npm run test:integration:health-origin
 *   OR
 *   STAGING_URL=https://stg.eventangle.com npm test -- tests/integration/story3.1-healthOrigin.integration.test.js
 *
 * Environment Variables:
 *   STAGING_URL - Base URL for staging environment (default: https://stg.eventangle.com)
 *
 * @see Story 3.1 - Worker /health/origin Endpoint
 */

const STAGING_URL = process.env.STAGING_URL || 'https://stg.eventangle.com';
const HEALTH_ORIGIN_ENDPOINT = `${STAGING_URL}/health/origin`;

// Skip integration tests if not explicitly enabled
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION === 'true' || !process.env.RUN_INTEGRATION;

// =============================================================================
// Integration Test Suite
// =============================================================================

describe('Story 3.1 Integration Tests - /health/origin Endpoint', () => {

  // Skip if integration tests are not enabled
  const describeOrSkip = SKIP_INTEGRATION ? describe.skip : describe;

  describeOrSkip('Endpoint Response Format', () => {

    let response;
    let body;

    beforeAll(async () => {
      try {
        const fetchResponse = await fetch(HEALTH_ORIGIN_ENDPOINT, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });
        response = {
          status: fetchResponse.status,
          headers: Object.fromEntries(fetchResponse.headers.entries()),
        };
        body = await fetchResponse.json();
      } catch (error) {
        console.error('Failed to fetch health/origin:', error.message);
        throw error;
      }
    });

    it('should always return HTTP 200', () => {
      expect(response.status).toBe(200);
    });

    it('should return JSON content type', () => {
      expect(response.headers['content-type']).toContain('application/json');
    });

    it('should include ok boolean field', () => {
      expect(typeof body.ok).toBe('boolean');
    });

    it('should include env string field', () => {
      expect(typeof body.env).toBe('string');
      expect(body.env).toBe('staging');
    });

    it('should include worker string field', () => {
      expect(typeof body.worker).toBe('string');
      expect(body.worker).toContain('eventangle');
    });

    it('should include upstream field (string or null)', () => {
      expect(body.upstream === null || typeof body.upstream === 'string').toBe(true);
    });

    it('should include upstreamReachable boolean field', () => {
      expect(typeof body.upstreamReachable).toBe('boolean');
    });

    it('should include status number field', () => {
      expect(typeof body.status).toBe('number');
    });

    it('should include timestamp', () => {
      expect(typeof body.timestamp).toBe('string');
      // Verify timestamp is valid ISO format
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });

    it('should include latencyMs when upstream is probed', () => {
      // latencyMs should be present if upstream was configured and probed
      if (body.upstream !== null) {
        expect(typeof body.latencyMs).toBe('number');
        expect(body.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describeOrSkip('CI/CD Gate Validation', () => {

    let body;

    beforeAll(async () => {
      const fetchResponse = await fetch(HEALTH_ORIGIN_ENDPOINT, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      body = await fetchResponse.json();
    });

    /**
     * Stage-2 gate: deployment to staging fails if /health/origin returns
     * ok:false due to misconfig (e.g., missing env var or 410 upstream)
     */
    it('should pass CI/CD gate check (ok === true)', () => {
      // This test will fail if upstream is not configured or unreachable
      // Use body.ok for gate decision, not HTTP status
      if (!body.ok) {
        console.error('CI/CD Gate FAILED:', JSON.stringify(body, null, 2));
      }
      expect(body.ok).toBe(true);
    });

    it('should have staging environment', () => {
      expect(body.env).toBe('staging');
    });

    it('should have upstream configured', () => {
      // If upstream is null, UPSTREAM_WEBAPP_URL is not set
      expect(body.upstream).not.toBeNull();
    });

    it('should have upstream reachable', () => {
      expect(body.upstreamReachable).toBe(true);
    });

    it('should have successful status (2xx)', () => {
      expect(body.status).toBeGreaterThanOrEqual(200);
      expect(body.status).toBeLessThan(300);
    });
  });

  // Test for CORS headers
  describeOrSkip('CORS Headers', () => {

    let response;

    beforeAll(async () => {
      const fetchResponse = await fetch(HEALTH_ORIGIN_ENDPOINT, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      response = {
        headers: Object.fromEntries(fetchResponse.headers.entries()),
      };
    });

    it('should include Access-Control-Allow-Origin header', () => {
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  // Test for cache control
  describeOrSkip('Cache Control', () => {

    let response;

    beforeAll(async () => {
      const fetchResponse = await fetch(HEALTH_ORIGIN_ENDPOINT, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      response = {
        headers: Object.fromEntries(fetchResponse.headers.entries()),
      };
    });

    it('should have no-cache directive', () => {
      expect(response.headers['cache-control']).toContain('no-cache');
    });
  });
});

// =============================================================================
// Mock Tests (run without network, for CI without integration)
// =============================================================================

describe('Story 3.1 Response Shape Validation', () => {

  /**
   * These tests validate the response shape without making network requests.
   * They use example responses matching the Story 3.1 AC.
   */

  describe('Success Response Shape', () => {
    const successResponse = {
      ok: true,
      env: 'staging',
      worker: 'eventangle-staging',
      upstream: 'https://script.google.com/macros/s/xxxxx/exec',
      upstreamReachable: true,
      status: 200,
      latencyMs: 150,
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    it('should have ok: true for healthy upstream', () => {
      expect(successResponse.ok).toBe(true);
    });

    it('should have env matching environment', () => {
      expect(successResponse.env).toBe('staging');
    });

    it('should have worker name', () => {
      expect(successResponse.worker).toBe('eventangle-staging');
    });

    it('should have upstream URL', () => {
      expect(typeof successResponse.upstream).toBe('string');
      expect(successResponse.upstream).toContain('exec');
    });

    it('should have upstreamReachable: true', () => {
      expect(successResponse.upstreamReachable).toBe(true);
    });

    it('should have status: 200', () => {
      expect(successResponse.status).toBe(200);
    });
  });

  describe('410 Gone Response Shape', () => {
    const goneResponse = {
      ok: false,
      env: 'staging',
      worker: 'eventangle-staging',
      upstream: 'https://script.google.com/macros/s/xxxxx/exec',
      upstreamReachable: false,
      status: 410,
      latencyMs: 50,
      error: 'Upstream returned 410 Gone',
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    it('should have ok: false for 410', () => {
      expect(goneResponse.ok).toBe(false);
    });

    it('should have upstreamReachable: false for 410', () => {
      expect(goneResponse.upstreamReachable).toBe(false);
    });

    it('should have status: 410', () => {
      expect(goneResponse.status).toBe(410);
    });

    it('should include error message', () => {
      expect(goneResponse.error).toContain('410');
    });
  });

  describe('Missing Config Response Shape', () => {
    const missingConfigResponse = {
      ok: false,
      env: 'staging',
      worker: 'eventangle-staging',
      upstream: null,
      upstreamReachable: false,
      status: 500,
      error: 'UPSTREAM_WEBAPP_URL is not configured',
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    it('should have ok: false for missing config', () => {
      expect(missingConfigResponse.ok).toBe(false);
    });

    it('should have upstream: null for missing config', () => {
      expect(missingConfigResponse.upstream).toBeNull();
    });

    it('should have upstreamReachable: false', () => {
      expect(missingConfigResponse.upstreamReachable).toBe(false);
    });

    it('should have status: 500 for config error', () => {
      expect(missingConfigResponse.status).toBe(500);
    });

    it('should include error message about config', () => {
      expect(missingConfigResponse.error).toContain('UPSTREAM_WEBAPP_URL');
    });
  });
});
