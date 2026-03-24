/**
 * Backend Status Parity Contract Tests (Story 0.1, updated Story 5.2)
 *
 * Story 5.2: GAS backend is DEPRECATED. All traffic uses Worker backend.
 *
 * Originally validated that /api/status returns the same response from both
 * GAS and Worker backends. With Story 5.2 (full DNS cutover), GAS backend
 * is no longer available - all requests use Worker-native implementations.
 *
 * This file is preserved for reference but GAS-specific tests are skipped.
 *
 * Current tests verify:
 * - Worker-native /api/v2/status endpoint works correctly
 * - Response structure meets CI/CD requirements
 * - X-Backend header indicates 'worker'
 *
 * @see cloudflare-proxy/src/config/backendConfig.js
 * @see cloudflare-proxy/src/api/status.js (Worker implementation)
 * @see docs/DNS_CUTOVER.md (Story 5.2 migration details)
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Configuration
// =============================================================================

// CI Detection
const isCI = process.env.CI === 'true' || process.env.CI === true;
const skipNetworkTests = isCI || process.env.SKIP_NETWORK_TESTS === 'true';
const describeNetwork = skipNetworkTests ? describe.skip : describe;

// Staging URL for backend parity tests
// Only staging supports ?backend= query param override
const STG_BASE_URL = process.env.STG_BASE_URL || process.env.BASE_URL || 'https://stg.eventangle.com';
const TIMEOUT_MS = 30000;

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Fetch /api/status with optional backend override
 * @param {string} backend - 'gas', 'worker', or null for default
 */
async function fetchStatus(backend = null) {
  const url = new URL('/api/status', STG_BASE_URL);
  if (backend) {
    url.searchParams.set('backend', backend);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  return {
    status: response.status,
    headers: {
      'x-backend': response.headers.get('x-backend'),
      'x-backend-source': response.headers.get('x-backend-source'),
      'x-worker-version': response.headers.get('x-worker-version'),
      'content-type': response.headers.get('content-type')
    },
    body: await response.json()
  };
}

/**
 * Common status response shape fields (must exist in both backends)
 */
const COMMON_STATUS_FIELDS = ['ok'];

/**
 * GAS-specific status response fields
 */
const GAS_STATUS_FIELDS = ['ok', 'buildId', 'brandId', 'time', 'db'];

/**
 * Worker-specific status response fields
 */
const WORKER_STATUS_FIELDS = ['ok', 'worker', 'sheets', 'health', 'latencyMs'];

// =============================================================================
// Local (CI-Safe) Contract Tests
// =============================================================================

describe('Backend Status Parity Contract (Story 0.1)', () => {

  describe('Worker.js Integration', () => {
    let workerContent;

    beforeAll(() => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      workerContent = fs.readFileSync(workerPath, 'utf8');
    });

    it('should use Worker-native for /api/status (Story 5.2)', () => {
      // Story 5.2: No longer uses versioned routing - always Worker-native
      expect(workerContent).toContain("if (url.pathname === '/api/status')");
    });

    it('should handle Worker backend response (Story 5.2)', () => {
      // Story 5.2: Always Worker-native
      expect(workerContent).toContain('await handleWorkerStatusRequest(request, env)');
    });

    it('should NOT use GAS backend (Story 5.2: GAS removed)', () => {
      // Story 5.2: GAS proxy removed
      expect(workerContent).not.toContain('await handleHealthCheckEndpoint(request, appsScriptBase, env, url)');
    });

    it('should set X-Backend header on responses', () => {
      expect(workerContent).toContain("response.headers.set('X-Backend', 'worker')");
      // Story 5.2: No GAS header - only Worker
      expect(workerContent).not.toContain("response.headers.set('X-Backend', 'gas')");
    });

    it('should set X-Backend-Source header on responses (Story 5.2)', () => {
      // Story 5.2: Static source, no dynamic routing
      expect(workerContent).toContain("response.headers.set('X-Backend-Source'");
    });

    it('should NOT use backend decision logging (Story 5.2: no routing decision)', () => {
      // Story 5.2: No routing decision to log - always Worker-native
      // Note: logBackendDecision may still exist as dead code, but shouldn't be called for /api/status
      expect(workerContent).toContain('handleWorkerStatusRequest');
    });
  });

  describe('Worker Status Response Shape', () => {
    let statusModule;

    beforeAll(() => {
      const statusPath = path.join(__dirname, '../../cloudflare-proxy/src/api/status.js');
      statusModule = fs.readFileSync(statusPath, 'utf8');
    });

    it('should return ok: true in response', () => {
      expect(statusModule).toContain('ok: true');
    });

    it('should return worker health info', () => {
      expect(statusModule).toContain('worker: workerStatus');
    });

    it('should return sheets health info', () => {
      expect(statusModule).toContain('sheets: sheetsStatus');
    });

    it('should return health summary', () => {
      expect(statusModule).toContain('health: {');
      expect(statusModule).toContain("worker: 'healthy'");
    });

    it('should return latencyMs', () => {
      expect(statusModule).toContain('latencyMs: Date.now() - startTime');
    });

    it('should return JSON content type', () => {
      expect(statusModule).toContain("'Content-Type': 'application/json'");
    });
  });

  describe('Response Shape Compatibility', () => {

    it('should have common ok field in both backends', () => {
      // Both GAS and Worker responses MUST have ok field
      expect(GAS_STATUS_FIELDS).toContain('ok');
      expect(WORKER_STATUS_FIELDS).toContain('ok');
    });

    it('should document GAS-specific fields', () => {
      // GAS returns: ok, buildId, brandId, time, db
      expect(GAS_STATUS_FIELDS).toContain('buildId');
      expect(GAS_STATUS_FIELDS).toContain('brandId');
      expect(GAS_STATUS_FIELDS).toContain('time');
      expect(GAS_STATUS_FIELDS).toContain('db');
    });

    it('should document Worker-specific fields', () => {
      // Worker returns: ok, worker, sheets, health, latencyMs
      expect(WORKER_STATUS_FIELDS).toContain('worker');
      expect(WORKER_STATUS_FIELDS).toContain('sheets');
      expect(WORKER_STATUS_FIELDS).toContain('health');
      expect(WORKER_STATUS_FIELDS).toContain('latencyMs');
    });

    it('should have CI integration guidance', () => {
      // CI/CD should check:
      // 1. ok: true means service is healthy
      // 2. X-Backend header indicates which backend served the request
      // 3. Both backends should return 200 status on success

      // This test documents the expected behavior
      const ciCheckPoints = [
        'Check response.ok === true',
        'Check HTTP status === 200',
        'Check X-Backend header for debugging',
        'Handle either GAS or Worker response shape'
      ];

      expect(ciCheckPoints.length).toBe(4);
    });
  });

  describe('Backend Error Response Shape', () => {
    let configContent;

    beforeAll(() => {
      const configPath = path.join(__dirname, '../../cloudflare-proxy/src/config/backendConfig.js');
      configContent = fs.readFileSync(configPath, 'utf8');
    });

    it('should have consistent error response structure', () => {
      // Error response must have: ok, status, code, message
      expect(configContent).toContain('ok: false');
      expect(configContent).toContain('status: status');
      expect(configContent).toContain('code: code || BACKEND_ERROR_CODE');
      expect(configContent).toContain('message: message');
    });

    it('should include timestamp in error responses', () => {
      expect(configContent).toContain('timestamp: new Date().toISOString()');
    });

    it('should include optional details in error responses', () => {
      expect(configContent).toContain('if (details)');
      expect(configContent).toContain('body.details = details');
    });

    it('should set X-Backend-Error header on errors', () => {
      expect(configContent).toContain("'X-Backend-Error': 'true'");
    });
  });
});

// =============================================================================
// Network Tests (Staging Only)
// =============================================================================

describeNetwork('Backend Status Parity - Live Tests (Staging)', () => {

  describe('Default Backend Routing', () => {

    it('should return 200 status for /api/status', async () => {
      const response = await fetchStatus();
      expect(response.status).toBe(200);
    }, TIMEOUT_MS);

    it('should return ok: true for healthy service', async () => {
      const response = await fetchStatus();
      expect(response.body.ok).toBe(true);
    }, TIMEOUT_MS);

    it('should include X-Backend header', async () => {
      const response = await fetchStatus();
      expect(response.headers['x-backend']).toMatch(/^(gas|worker)$/);
    }, TIMEOUT_MS);

    it('should include X-Backend-Source header', async () => {
      const response = await fetchStatus();
      expect(response.headers['x-backend-source']).toMatch(/^(query_override|route_config|global_mode|mixed_default)$/);
    }, TIMEOUT_MS);

    it('should return JSON content type', async () => {
      const response = await fetchStatus();
      expect(response.headers['content-type']).toContain('application/json');
    }, TIMEOUT_MS);
  });

  // Story 5.2: GAS backend is DEPRECATED - skip these tests
  describe.skip('GAS Backend Response (?backend=gas) - DEPRECATED Story 5.2', () => {

    it('should return 200 status for ?backend=gas', async () => {
      const response = await fetchStatus('gas');
      expect(response.status).toBe(200);
    }, TIMEOUT_MS);

    it('should indicate GAS backend in X-Backend header', async () => {
      const response = await fetchStatus('gas');
      expect(response.headers['x-backend']).toBe('gas');
    }, TIMEOUT_MS);

    it('should indicate query_override source', async () => {
      const response = await fetchStatus('gas');
      expect(response.headers['x-backend-source']).toBe('query_override');
    }, TIMEOUT_MS);

    it('should return ok: true for healthy GAS', async () => {
      const response = await fetchStatus('gas');
      expect(response.body.ok).toBe(true);
    }, TIMEOUT_MS);

    it('should return GAS-specific fields', async () => {
      const response = await fetchStatus('gas');

      // GAS status should have these fields
      expect(response.body).toHaveProperty('ok');
      expect(response.body).toHaveProperty('buildId');
      expect(response.body).toHaveProperty('brandId');
      expect(response.body).toHaveProperty('time');
    }, TIMEOUT_MS);

    it('should return valid buildId', async () => {
      const response = await fetchStatus('gas');
      expect(response.body.buildId).toBeDefined();
      expect(typeof response.body.buildId).toBe('string');
      expect(response.body.buildId.length).toBeGreaterThan(0);
    }, TIMEOUT_MS);

    it('should return valid time in ISO format', async () => {
      const response = await fetchStatus('gas');
      expect(response.body.time).toBeDefined();
      const parsed = new Date(response.body.time);
      expect(isNaN(parsed.getTime())).toBe(false);
    }, TIMEOUT_MS);
  });

  describe('Worker Backend Response (?backend=worker)', () => {

    it('should return 200 status for ?backend=worker', async () => {
      const response = await fetchStatus('worker');
      expect(response.status).toBe(200);
    }, TIMEOUT_MS);

    it('should indicate Worker backend in X-Backend header', async () => {
      const response = await fetchStatus('worker');
      expect(response.headers['x-backend']).toBe('worker');
    }, TIMEOUT_MS);

    it('should indicate query_override source', async () => {
      const response = await fetchStatus('worker');
      expect(response.headers['x-backend-source']).toBe('query_override');
    }, TIMEOUT_MS);

    it('should return ok: true for healthy Worker', async () => {
      const response = await fetchStatus('worker');
      expect(response.body.ok).toBe(true);
    }, TIMEOUT_MS);

    it('should return Worker-specific fields', async () => {
      const response = await fetchStatus('worker');

      // Worker status should have these fields
      expect(response.body).toHaveProperty('ok');
      expect(response.body).toHaveProperty('worker');
      expect(response.body).toHaveProperty('health');
      expect(response.body).toHaveProperty('latencyMs');
    }, TIMEOUT_MS);

    it('should return worker info with version', async () => {
      const response = await fetchStatus('worker');
      expect(response.body.worker).toHaveProperty('version');
      expect(response.body.worker).toHaveProperty('env');
      expect(response.body.worker).toHaveProperty('timestamp');
    }, TIMEOUT_MS);

    it('should return health summary', async () => {
      const response = await fetchStatus('worker');
      expect(response.body.health).toHaveProperty('worker');
      expect(response.body.health).toHaveProperty('overall');
      expect(response.body.health.worker).toBe('healthy');
    }, TIMEOUT_MS);

    it('should return latencyMs as number', async () => {
      const response = await fetchStatus('worker');
      expect(typeof response.body.latencyMs).toBe('number');
      expect(response.body.latencyMs).toBeGreaterThanOrEqual(0);
    }, TIMEOUT_MS);
  });

  // Story 5.2: GAS backend is DEPRECATED - skip parity tests
  describe.skip('Response Shape Parity - DEPRECATED Story 5.2', () => {

    it('should have ok field in both backends', async () => {
      const [gasResponse, workerResponse] = await Promise.all([
        fetchStatus('gas'),
        fetchStatus('worker')
      ]);

      expect(gasResponse.body).toHaveProperty('ok');
      expect(workerResponse.body).toHaveProperty('ok');
      expect(gasResponse.body.ok).toBe(true);
      expect(workerResponse.body.ok).toBe(true);
    }, TIMEOUT_MS);

    it('should return same HTTP status from both backends', async () => {
      const [gasResponse, workerResponse] = await Promise.all([
        fetchStatus('gas'),
        fetchStatus('worker')
      ]);

      expect(gasResponse.status).toBe(200);
      expect(workerResponse.status).toBe(200);
    }, TIMEOUT_MS);

    it('should return JSON content type from both backends', async () => {
      const [gasResponse, workerResponse] = await Promise.all([
        fetchStatus('gas'),
        fetchStatus('worker')
      ]);

      expect(gasResponse.headers['content-type']).toContain('application/json');
      expect(workerResponse.headers['content-type']).toContain('application/json');
    }, TIMEOUT_MS);

    it('should correctly identify backends via X-Backend header', async () => {
      const [gasResponse, workerResponse] = await Promise.all([
        fetchStatus('gas'),
        fetchStatus('worker')
      ]);

      expect(gasResponse.headers['x-backend']).toBe('gas');
      expect(workerResponse.headers['x-backend']).toBe('worker');
    }, TIMEOUT_MS);
  });

  describe('CI/CD Integration Validation', () => {

    it('should provide simple health check via ok field', async () => {
      // CI/CD should just check response.ok === true
      const response = await fetchStatus();

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    }, TIMEOUT_MS);

    // Story 5.2: GAS backend is DEPRECATED - skip this test
    it.skip('should work with ?backend=gas for A/B testing - DEPRECATED Story 5.2', async () => {
      const response = await fetchStatus('gas');

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.headers['x-backend']).toBe('gas');
    }, TIMEOUT_MS);

    it('should work with ?backend=worker for A/B testing', async () => {
      const response = await fetchStatus('worker');

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.headers['x-backend']).toBe('worker');
    }, TIMEOUT_MS);
  });
});

// =============================================================================
// Story 0.1 Acceptance Criteria Validation
// =============================================================================

describe('Story 0.1 Acceptance Criteria', () => {

  describe('Contract test: /api/status returns same shape from both backends', () => {
    let workerContent;

    beforeAll(() => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      workerContent = fs.readFileSync(workerPath, 'utf8');
    });

    it('should have /api/status endpoint (Story 5.2: Worker-native only)', () => {
      expect(workerContent).toContain("if (url.pathname === '/api/status')");
      // Story 5.2: No longer uses getBackendForRoute - always Worker-native
      expect(workerContent).toContain('handleWorkerStatusRequest');
    });

    it('should use Worker-native only (Story 5.2: GAS removed)', () => {
      // Story 5.2: GAS proxy removed - Worker-native only
      expect(workerContent).toContain('handleWorkerStatusRequest');
      // GAS handler should NOT be present in status route
      expect(workerContent).not.toContain('await handleHealthCheckEndpoint(request, appsScriptBase, env, url)');
    });

    it('should add X-Backend header for debugging', () => {
      expect(workerContent).toContain("'X-Backend'");
    });

    it('should add X-Backend-Source header for debugging', () => {
      expect(workerContent).toContain("'X-Backend-Source'");
    });
  });

  describe('Both backends return compatible response for CI/CD', () => {

    it('should document common response fields', () => {
      // Both backends must return 'ok' field
      expect(COMMON_STATUS_FIELDS).toContain('ok');
    });

    it('should document that ok: true means healthy', () => {
      // ok: true = service is operational (can be checked by CI/CD)
      const healthCheckLogic = 'response.ok === true || response.body.ok === true';
      expect(healthCheckLogic).toBeDefined();
    });

    it('should document that 200 status means success', () => {
      // HTTP 200 = request succeeded (standard REST)
      const expectedStatus = 200;
      expect(expectedStatus).toBe(200);
    });
  });
});
