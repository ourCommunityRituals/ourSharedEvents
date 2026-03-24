/**
 * Unit Tests for Story 3.1 - Worker /health/origin Endpoint
 *
 * Tests the /health/origin endpoint implementation and response format.
 * Validates:
 * - Response format matches Story 3.1 AC
 * - Always returns HTTP 200 (status reported in JSON body)
 * - checkUpstreamHealth helper function
 * - UPSTREAM_WEBAPP_URL env var support
 * - 410 handling
 * - Missing config handling
 *
 * @see worker/src/handlers/healthOrigin.ts
 * @see worker/src/resolveBackendOrigin.ts
 * @see Story 3.1 - Worker /health/origin Endpoint
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const healthOriginPath = path.join(__dirname, '../../../worker/src/handlers/healthOrigin.ts');
const resolveBackendOriginPath = path.join(__dirname, '../../../worker/src/resolveBackendOrigin.ts');
const routerPath = path.join(__dirname, '../../../worker/src/router.ts');
const wranglerTomlPath = path.join(__dirname, '../../../worker/wrangler.toml');
const indexPath = path.join(__dirname, '../../../worker/src/index.ts');

let healthOriginSource = '';
let resolveBackendOriginSource = '';
let routerSource = '';
let wranglerTomlSource = '';
let indexSource = '';

beforeAll(() => {
  try {
    healthOriginSource = fs.readFileSync(healthOriginPath, 'utf8');
    resolveBackendOriginSource = fs.readFileSync(resolveBackendOriginPath, 'utf8');
    routerSource = fs.readFileSync(routerPath, 'utf8');
    wranglerTomlSource = fs.readFileSync(wranglerTomlPath, 'utf8');
    indexSource = fs.readFileSync(indexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// checkUpstreamHealth Helper Contract Tests
// =============================================================================

describe('checkUpstreamHealth Helper (Story 3.1)', () => {

  describe('Function Export', () => {
    it('should export checkUpstreamHealth function', () => {
      expect(resolveBackendOriginSource).toContain('export async function checkUpstreamHealth(');
    });

    it('should be exported from worker index', () => {
      expect(indexSource).toContain('checkUpstreamHealth');
    });
  });

  describe('UpstreamHealthResult Type', () => {
    it('should export UpstreamHealthResult interface', () => {
      expect(resolveBackendOriginSource).toContain('export interface UpstreamHealthResult');
    });

    it('should include reachable boolean', () => {
      expect(resolveBackendOriginSource).toContain('reachable: boolean');
    });

    it('should include status number', () => {
      expect(resolveBackendOriginSource).toMatch(/status: number/);
    });

    it('should include optional latencyMs', () => {
      expect(resolveBackendOriginSource).toContain('latencyMs?: number');
    });

    it('should include optional error string', () => {
      expect(resolveBackendOriginSource).toMatch(/error\?: string/);
    });

    it('should be exported from worker index', () => {
      expect(indexSource).toContain('type UpstreamHealthResult');
    });
  });

  describe('Missing UPSTREAM_WEBAPP_URL Handling', () => {
    it('should check for UPSTREAM_WEBAPP_URL', () => {
      expect(resolveBackendOriginSource).toContain('env.UPSTREAM_WEBAPP_URL');
    });

    it('should return reachable false when URL not set', () => {
      expect(resolveBackendOriginSource).toContain('reachable: false');
      expect(resolveBackendOriginSource).toContain('status: 500');
      expect(resolveBackendOriginSource).toContain('UPSTREAM_WEBAPP_URL is not configured');
    });
  });

  describe('410 Gone Handling', () => {
    it('should specifically handle 410 status', () => {
      expect(resolveBackendOriginSource).toContain('status === 410');
    });

    it('should return reachable false for 410', () => {
      expect(resolveBackendOriginSource).toContain("error: 'Upstream returned 410 Gone'");
    });
  });

  describe('Timeout Handling', () => {
    it('should use AbortController for timeout', () => {
      expect(resolveBackendOriginSource).toContain('AbortController');
    });

    it('should set a 10 second timeout', () => {
      expect(resolveBackendOriginSource).toContain('10000'); // 10s timeout
    });

    it('should handle AbortError', () => {
      expect(resolveBackendOriginSource).toContain('AbortError');
      expect(resolveBackendOriginSource).toContain('Upstream request timed out');
    });
  });

  describe('Success Path', () => {
    it('should check for 2xx status codes', () => {
      expect(resolveBackendOriginSource).toContain('status >= 200 && status < 300');
    });

    it('should return reachable true for success', () => {
      expect(resolveBackendOriginSource).toMatch(/reachable: true,\s+status,\s+latencyMs/);
    });
  });
});

// =============================================================================
// Health Origin Handler Contract Tests
// =============================================================================

describe('Health Origin Handler Contract (Story 3.1)', () => {

  describe('Module Structure', () => {
    it('should export handleHealthOrigin function', () => {
      expect(healthOriginSource).toContain('export async function handleHealthOrigin(');
    });

    it('should export HealthOriginEnv interface', () => {
      expect(healthOriginSource).toContain('export interface HealthOriginEnv');
    });

    it('should export HealthOriginResponse interface', () => {
      expect(healthOriginSource).toContain('export interface HealthOriginResponse');
    });

    it('should reference Story 3.1', () => {
      expect(healthOriginSource).toContain('Story 3.1');
    });
  });

  describe('Response Format (Story 3.1 AC)', () => {
    it('should include ok boolean field', () => {
      expect(healthOriginSource).toContain('ok: boolean');
    });

    it('should include env string field', () => {
      expect(healthOriginSource).toContain('env: string');
    });

    it('should include worker string field', () => {
      expect(healthOriginSource).toContain('worker: string');
    });

    it('should include upstream field (string or null)', () => {
      expect(healthOriginSource).toContain('upstream: string | null');
    });

    it('should include upstreamReachable boolean field', () => {
      expect(healthOriginSource).toContain('upstreamReachable: boolean');
    });

    it('should include status number field', () => {
      expect(healthOriginSource).toMatch(/status: number/);
    });
  });

  describe('Always HTTP 200', () => {
    it('should always return HTTP 200', () => {
      expect(healthOriginSource).toContain('status: 200');
    });

    it('should document that HTTP 200 is always returned', () => {
      expect(healthOriginSource).toContain('ALWAYS return HTTP 200');
    });
  });

  describe('Uses checkUpstreamHealth', () => {
    it('should import checkUpstreamHealth', () => {
      expect(healthOriginSource).toContain('import {');
      expect(healthOriginSource).toContain('checkUpstreamHealth');
    });

    it('should call checkUpstreamHealth', () => {
      expect(healthOriginSource).toContain('checkUpstreamHealth(env)');
    });
  });

  describe('Environment Variables', () => {
    it('should read WORKER_ENV', () => {
      expect(healthOriginSource).toContain('env.WORKER_ENV');
    });

    it('should read WORKER_NAME', () => {
      expect(healthOriginSource).toContain('env.WORKER_NAME');
    });

    it('should read UPSTREAM_WEBAPP_URL', () => {
      expect(healthOriginSource).toContain('env.UPSTREAM_WEBAPP_URL');
    });
  });
});

// =============================================================================
// BackendEnv Interface Tests
// =============================================================================

describe('BackendEnv Interface (Story 3.1)', () => {

  it('should include UPSTREAM_WEBAPP_URL field', () => {
    expect(resolveBackendOriginSource).toContain('UPSTREAM_WEBAPP_URL?: string');
  });

  it('should include WORKER_NAME field', () => {
    expect(resolveBackendOriginSource).toContain('WORKER_NAME?: string');
  });
});

// =============================================================================
// Wrangler Configuration Tests
// =============================================================================

describe('Wrangler Configuration (Story 3.1)', () => {

  describe('Staging Environment', () => {
    it('should have WORKER_NAME for staging', () => {
      expect(wranglerTomlSource).toContain('WORKER_NAME = "eventangle-staging"');
    });

    it('should document UPSTREAM_WEBAPP_URL for staging', () => {
      expect(wranglerTomlSource).toContain('UPSTREAM_WEBAPP_URL');
    });
  });

  describe('Production Environment', () => {
    it('should have WORKER_NAME for production', () => {
      expect(wranglerTomlSource).toContain('WORKER_NAME = "eventangle-prod"');
    });
  });

  describe('Documentation', () => {
    it('should document Story 3.1', () => {
      expect(wranglerTomlSource).toContain('Story 3.1');
    });

    it('should document that /health/origin always returns HTTP 200', () => {
      expect(wranglerTomlSource).toContain('/health/origin always returns HTTP 200');
    });

    it('should document upstreamReachable field', () => {
      expect(wranglerTomlSource).toContain('upstreamReachable');
    });

    it('should have UPSTREAM_WEBAPP_URL in secrets list', () => {
      expect(wranglerTomlSource).toContain('wrangler secret put UPSTREAM_WEBAPP_URL');
    });
  });
});

// =============================================================================
// Story 3.1 Acceptance Criteria Validation
// =============================================================================

describe('Story 3.1 Acceptance Criteria', () => {

  describe('AC: Response includes ok, env, worker, upstream, upstreamReachable, status', () => {
    it('should include ok field', () => {
      expect(healthOriginSource).toContain('ok:');
    });

    it('should include env field', () => {
      expect(healthOriginSource).toContain('env:');
    });

    it('should include worker field', () => {
      expect(healthOriginSource).toContain('worker:');
    });

    it('should include upstream field', () => {
      expect(healthOriginSource).toContain('upstream:');
    });

    it('should include upstreamReachable field', () => {
      expect(healthOriginSource).toContain('upstreamReachable:');
    });

    it('should include status field', () => {
      expect(healthOriginSource).toContain('status:');
    });
  });

  describe('AC: If upstream 410s - ok:false, upstreamReachable:false, status:410', () => {
    it('should handle 410 specifically', () => {
      expect(resolveBackendOriginSource).toContain('status === 410');
    });

    it('should set reachable false for 410', () => {
      // The checkUpstreamHealth function sets reachable: false for 410
      expect(resolveBackendOriginSource).toContain('reachable: false');
      expect(resolveBackendOriginSource).toContain('status: 410');
    });
  });

  describe('AC: Cloudflare returns 200 for health endpoint', () => {
    it('should always return HTTP 200', () => {
      expect(healthOriginSource).toContain('status: 200');
      expect(healthOriginSource).toContain('ALWAYS return HTTP 200');
    });
  });

  describe('AC: UPSTREAM_WEBAPP_URL not set returns ok:false, status:500, upstream:null', () => {
    it('should handle missing UPSTREAM_WEBAPP_URL', () => {
      expect(resolveBackendOriginSource).toContain('!upstreamUrl');
    });

    it('should return status 500 when not configured', () => {
      expect(resolveBackendOriginSource).toContain('status: 500');
      expect(resolveBackendOriginSource).toContain('UPSTREAM_WEBAPP_URL is not configured');
    });

    it('should allow upstream to be null', () => {
      expect(healthOriginSource).toContain('upstream: string | null');
      expect(healthOriginSource).toContain('UPSTREAM_WEBAPP_URL || null');
    });
  });

  describe('AC: Add checkUpstreamHealth(env) helper', () => {
    it('should have checkUpstreamHealth function', () => {
      expect(resolveBackendOriginSource).toContain('export async function checkUpstreamHealth');
    });

    it('should be reusable (exported)', () => {
      expect(indexSource).toContain('checkUpstreamHealth');
    });
  });
});

// =============================================================================
// Integration with Router Tests
// =============================================================================

describe('Router Integration (Story 3.1)', () => {

  it('should have /health/origin route', () => {
    expect(routerSource).toContain("'/health/origin'");
  });

  it('should call handleHealthOrigin', () => {
    expect(routerSource).toContain('handleHealthOrigin');
  });

  it('should add CORS headers to health response', () => {
    expect(routerSource).toContain('addCorsHeaders');
  });
});

// =============================================================================
// HealthOriginEnv Interface Tests
// =============================================================================

describe('HealthOriginEnv Interface (Story 3.1)', () => {

  it('should extend BackendEnv', () => {
    expect(healthOriginSource).toContain('extends BackendEnv');
  });

  it('should include WORKER_ENV', () => {
    expect(healthOriginSource).toContain('WORKER_ENV?: string');
  });

  it('should include WORKER_NAME', () => {
    expect(healthOriginSource).toContain('WORKER_NAME?: string');
  });

  it('should include UPSTREAM_WEBAPP_URL', () => {
    expect(healthOriginSource).toContain('UPSTREAM_WEBAPP_URL?: string');
  });
});
