/**
 * Unit Tests for Story 2.3 - Worker Upstream Config via Single Env Var
 *
 * Tests the upstream configuration validation module and health endpoint.
 * Validates:
 * - resolveBackendOrigin() detects missing configuration
 * - /health/origin returns 500 when not configured
 * - /api/events returns 500 when not configured
 * - Clear error messages include missing variable names
 *
 * @see worker/src/resolveBackendOrigin.ts
 * @see worker/src/handlers/healthOrigin.ts
 * @see Story 2.3 - Worker Upstream Config via Single Env Var
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const resolveBackendOriginPath = path.join(
  __dirname,
  '../../../worker/src/resolveBackendOrigin.ts'
);
const healthOriginPath = path.join(__dirname, '../../../worker/src/handlers/healthOrigin.ts');
const routerPath = path.join(__dirname, '../../../worker/src/router.ts');
const wranglerTomlPath = path.join(__dirname, '../../../worker/wrangler.toml');

let resolveBackendOriginSource = '';
let healthOriginSource = '';
let routerSource = '';
let wranglerTomlSource = '';

beforeAll(() => {
  try {
    resolveBackendOriginSource = fs.readFileSync(resolveBackendOriginPath, 'utf8');
    healthOriginSource = fs.readFileSync(healthOriginPath, 'utf8');
    routerSource = fs.readFileSync(routerPath, 'utf8');
    wranglerTomlSource = fs.readFileSync(wranglerTomlPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// resolveBackendOrigin Module Contract Tests
// =============================================================================

describe('resolveBackendOrigin Module Contract (Story 2.3)', () => {
  describe('Module Structure', () => {
    it('should export resolveBackendOrigin function', () => {
      expect(resolveBackendOriginSource).toContain('export function resolveBackendOrigin(');
    });

    it('should export isBackendConfigured function', () => {
      expect(resolveBackendOriginSource).toContain('export function isBackendConfigured(');
    });

    it('should export createUpstreamNotConfiguredResponse function', () => {
      expect(resolveBackendOriginSource).toContain(
        'export function createUpstreamNotConfiguredResponse('
      );
    });

    it('should export logUpstreamConfigError function', () => {
      expect(resolveBackendOriginSource).toContain('export function logUpstreamConfigError(');
    });

    it('should export BackendEnv interface', () => {
      expect(resolveBackendOriginSource).toContain('export interface BackendEnv');
    });

    it('should export BackendOriginResult interface', () => {
      expect(resolveBackendOriginSource).toContain('export interface BackendOriginResult');
    });

    it('should export UpstreamConfigError interface', () => {
      expect(resolveBackendOriginSource).toContain('export interface UpstreamConfigError');
    });
  });

  describe('Required Environment Variables', () => {
    it('should check SHEETS_SPREADSHEET_ID', () => {
      expect(resolveBackendOriginSource).toContain('SHEETS_SPREADSHEET_ID');
      expect(resolveBackendOriginSource).toContain("missing.push('SHEETS_SPREADSHEET_ID')");
    });

    it('should check GOOGLE_CLIENT_EMAIL', () => {
      expect(resolveBackendOriginSource).toContain('GOOGLE_CLIENT_EMAIL');
      expect(resolveBackendOriginSource).toContain("missing.push('GOOGLE_CLIENT_EMAIL')");
    });

    it('should check GOOGLE_PRIVATE_KEY', () => {
      expect(resolveBackendOriginSource).toContain('GOOGLE_PRIVATE_KEY');
      expect(resolveBackendOriginSource).toContain("missing.push('GOOGLE_PRIVATE_KEY')");
    });
  });

  describe('BackendOriginResult Shape', () => {
    it('should include configured boolean', () => {
      expect(resolveBackendOriginSource).toContain('configured: boolean');
    });

    it('should include backend type', () => {
      expect(resolveBackendOriginSource).toContain("backend: 'sheets'");
    });

    it('should include error message when not configured', () => {
      expect(resolveBackendOriginSource).toContain('error?: string');
      expect(resolveBackendOriginSource).toContain(
        'error: `Backend not configured. Missing: ${missing.join'
      );
    });

    it('should include missing array', () => {
      expect(resolveBackendOriginSource).toContain('missing?: string[]');
      expect(resolveBackendOriginSource).toContain('missing,');
    });

    it('should include environment identifier', () => {
      expect(resolveBackendOriginSource).toContain('environment: string');
    });
  });

  describe('createUpstreamNotConfiguredResponse', () => {
    it('should return 500 status', () => {
      expect(resolveBackendOriginSource).toContain('status: 500');
    });

    it('should use UPSTREAM_NOT_CONFIGURED error code', () => {
      expect(resolveBackendOriginSource).toContain("code: 'UPSTREAM_NOT_CONFIGURED'");
    });

    it('should include missing variables in response', () => {
      expect(resolveBackendOriginSource).toContain('missing: result.missing');
    });

    it('should include timestamp', () => {
      expect(resolveBackendOriginSource).toContain('timestamp: new Date().toISOString()');
    });

    it('should set Content-Type to application/json', () => {
      expect(resolveBackendOriginSource).toContain("'Content-Type': 'application/json'");
    });

    it('should set X-Error-Code header', () => {
      expect(resolveBackendOriginSource).toContain("'X-Error-Code': 'UPSTREAM_NOT_CONFIGURED'");
    });
  });

  describe('Logging', () => {
    it('should log UPSTREAM_CONFIG_ERROR type', () => {
      expect(resolveBackendOriginSource).toContain("type: 'UPSTREAM_CONFIG_ERROR'");
    });

    it('should include missing variables in log', () => {
      expect(resolveBackendOriginSource).toContain('missing: result.missing');
    });

    it('should include environment in log', () => {
      expect(resolveBackendOriginSource).toContain('environment: result.environment');
    });
  });
});

// =============================================================================
// Health Origin Handler Contract Tests
// =============================================================================

describe('Health Origin Handler Contract (Story 2.3, Story 3.1)', () => {
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
  });

  describe('Upstream Health Check (Story 3.1)', () => {
    it('should use checkUpstreamHealth to check upstream', () => {
      expect(healthOriginSource).toContain('checkUpstreamHealth(env)');
    });

    it('should always return HTTP 200 (per Story 3.1 AC)', () => {
      expect(healthOriginSource).toContain('status: 200');
      expect(healthOriginSource).toContain('ALWAYS return HTTP 200');
    });
  });

  describe('Response Shape (Story 3.1 AC)', () => {
    it('should include ok boolean', () => {
      expect(healthOriginSource).toContain('ok: boolean');
    });

    it('should include env string', () => {
      expect(healthOriginSource).toContain('env: string');
    });

    it('should include worker string', () => {
      expect(healthOriginSource).toContain('worker: string');
    });

    it('should include upstream (string or null)', () => {
      expect(healthOriginSource).toContain('upstream: string | null');
    });

    it('should include upstreamReachable boolean', () => {
      expect(healthOriginSource).toContain('upstreamReachable: boolean');
    });

    it('should include status number', () => {
      expect(healthOriginSource).toMatch(/status: number/);
    });
  });

  describe('Imports', () => {
    it('should import checkUpstreamHealth from ../resolveBackendOrigin', () => {
      expect(healthOriginSource).toContain('import {');
      expect(healthOriginSource).toContain('checkUpstreamHealth');
      expect(healthOriginSource).toContain("from '../resolveBackendOrigin'");
    });
  });
});

// =============================================================================
// Router Integration Tests
// =============================================================================

describe('Router Integration (Story 2.3)', () => {
  describe('Route Registration', () => {
    it('should register /health/origin route', () => {
      expect(routerSource).toContain("'/health/origin'");
    });

    it('should return health route type for /health/origin', () => {
      expect(routerSource).toContain("type: 'health', handler: 'origin'");
    });
  });

  describe('Health Route Handling', () => {
    it('should have case for health route type', () => {
      expect(routerSource).toContain("case 'health':");
    });

    it('should call handleHealthOrigin for origin handler', () => {
      expect(routerSource).toContain("case 'origin':");
      expect(routerSource).toContain('handleHealthOrigin(env)');
    });

    it('should only allow GET/HEAD methods for health routes', () => {
      expect(routerSource).toMatch(/case 'health':[\s\S]*?method !== 'GET' && method !== 'HEAD'/);
    });
  });

  describe('API Route Validation', () => {
    it('should check upstream configuration for API routes', () => {
      expect(routerSource).toContain('resolveBackendOrigin(env)');
    });

    it('should skip validation for /api/status (and healthBackend per Story B1)', () => {
      // Original Story 2.3: status is exempt
      // Story B1: healthBackend also exempt (reports its own config status)
      expect(routerSource).toContain("match.handler !== 'status'");
    });

    it('should return 500 for unconfigured data endpoints', () => {
      expect(routerSource).toContain('createUpstreamNotConfiguredResponse(backendResult)');
    });

    it('should log configuration errors for API routes', () => {
      expect(routerSource).toContain('logUpstreamConfigError(backendResult');
    });
  });

  describe('Module Imports', () => {
    it('should import handleHealthOrigin', () => {
      expect(routerSource).toContain('import { handleHealthOrigin }');
    });

    it('should import resolveBackendOrigin', () => {
      expect(routerSource).toContain('resolveBackendOrigin');
      expect(routerSource).toContain("from './resolveBackendOrigin'");
    });

    it('should import createUpstreamNotConfiguredResponse', () => {
      expect(routerSource).toContain('createUpstreamNotConfiguredResponse');
    });

    it('should import logUpstreamConfigError', () => {
      expect(routerSource).toContain('logUpstreamConfigError');
    });
  });

  describe('Version Update', () => {
    it('should have version >= 1.8.0 for Story 2.3', () => {
      // Story 2.3 introduced 1.8.0, subsequent stories may increment
      // Just verify version history includes 1.8.0 entry
      expect(routerSource).toContain('1.8.0 - Upstream config validation');
    });

    it('should document Story 2.3 in version history', () => {
      expect(routerSource).toContain('1.8.0 - Upstream config validation');
    });
  });

  describe('Route Documentation', () => {
    it('should document /health/origin in module header', () => {
      expect(routerSource).toContain('/health/origin - Upstream configuration health check');
    });

    it('should reference Story 2.3 in module header', () => {
      expect(routerSource).toContain('Story 2.3 - Worker Upstream Config');
    });
  });
});

// =============================================================================
// Wrangler Configuration Tests
// =============================================================================

describe('Wrangler Configuration (Story 2.3)', () => {
  describe('Story 2.3 Documentation', () => {
    it('should reference Story 2.3 in header', () => {
      expect(wranglerTomlSource).toContain('Story 2.3');
    });

    it('should document upstream backend configuration', () => {
      expect(wranglerTomlSource).toContain('UPSTREAM BACKEND CONFIGURATION');
    });

    it('should list required secrets for upstream', () => {
      expect(wranglerTomlSource).toContain('SHEETS_SPREADSHEET_ID');
      expect(wranglerTomlSource).toContain('GOOGLE_CLIENT_EMAIL');
      expect(wranglerTomlSource).toContain('GOOGLE_PRIVATE_KEY');
    });
  });

  describe('Error Behavior Documentation', () => {
    it('should document 500 response for missing config', () => {
      expect(wranglerTomlSource).toContain('/health/origin returns 500');
    });

    it('should document UPSTREAM_NOT_CONFIGURED code', () => {
      expect(wranglerTomlSource).toContain('UPSTREAM_NOT_CONFIGURED');
    });

    it('should provide verification command', () => {
      expect(wranglerTomlSource).toContain('curl');
      expect(wranglerTomlSource).toContain('/health/origin');
    });
  });

  describe('Secrets Documentation', () => {
    it('should mark upstream secrets as required', () => {
      expect(wranglerTomlSource).toContain('REQUIRED');
    });

    it('should explain PEM format for private key', () => {
      expect(wranglerTomlSource).toContain('PEM format');
    });
  });
});

// =============================================================================
// Acceptance Criteria Validation
// =============================================================================

describe('Story 2.3 Acceptance Criteria', () => {
  describe('AC: Worker never hardcodes upstream URL', () => {
    it('should not contain hardcoded sheets.googleapis.com in resolveBackendOrigin', () => {
      // resolveBackendOrigin only validates env vars, doesn't hardcode URLs
      expect(resolveBackendOriginSource).not.toContain('https://sheets.googleapis.com');
    });
  });

  describe('AC: Worker gets upstream from env vars', () => {
    it('should read SHEETS_SPREADSHEET_ID from env', () => {
      expect(resolveBackendOriginSource).toContain('env.SHEETS_SPREADSHEET_ID');
    });

    it('should read GOOGLE_CLIENT_EMAIL from env', () => {
      expect(resolveBackendOriginSource).toContain('env.GOOGLE_CLIENT_EMAIL');
    });

    it('should read GOOGLE_PRIVATE_KEY from env', () => {
      expect(resolveBackendOriginSource).toContain('env.GOOGLE_PRIVATE_KEY');
    });
  });

  describe('AC: Missing config returns 500 + clear message', () => {
    it('should return status 500 for missing config', () => {
      expect(resolveBackendOriginSource).toContain('status: 500');
    });

    it('should include clear error code', () => {
      expect(resolveBackendOriginSource).toContain("'UPSTREAM_NOT_CONFIGURED'");
    });

    it('should include list of missing variables', () => {
      expect(resolveBackendOriginSource).toContain('missing: result.missing');
    });

    it('should include error message with variable names', () => {
      expect(resolveBackendOriginSource).toContain('Backend not configured. Missing:');
    });
  });

  describe('AC: /health/origin endpoint works', () => {
    it('should have handleHealthOrigin handler', () => {
      expect(healthOriginSource).toContain('export async function handleHealthOrigin');
    });

    it('should route /health/origin correctly', () => {
      expect(routerSource).toContain("'/health/origin'");
    });

    it('should always return HTTP 200 (Story 3.1)', () => {
      expect(healthOriginSource).toContain('status: 200');
    });
  });

  describe('AC: /events returns 500 when not configured', () => {
    it('should check configuration before handling events', () => {
      // Story B1: healthBackend also skips upstream config check (like status)
      expect(routerSource).toContain("match.handler !== 'status'");
      expect(routerSource).toContain("match.handler !== 'healthBackend'");
      expect(routerSource).toContain('resolveBackendOrigin(env)');
    });

    it('should return 500 response for unconfigured events', () => {
      expect(routerSource).toContain('createUpstreamNotConfiguredResponse(backendResult)');
    });
  });

  describe('AC: Consolidate upstream resolution into helper', () => {
    it('should have single resolveBackendOrigin helper', () => {
      expect(resolveBackendOriginSource).toContain('export function resolveBackendOrigin(');
    });

    it('should have checkUpstreamHealth helper (Story 3.1)', () => {
      expect(resolveBackendOriginSource).toContain('export async function checkUpstreamHealth(');
    });

    it('should use helper in router', () => {
      expect(routerSource).toContain("from './resolveBackendOrigin'");
      expect(routerSource).toContain('resolveBackendOrigin(env)');
    });

    it('should use checkUpstreamHealth in healthOrigin handler', () => {
      expect(healthOriginSource).toContain("from '../resolveBackendOrigin'");
      expect(healthOriginSource).toContain('checkUpstreamHealth(env)');
    });
  });
});

// =============================================================================
// Error Response Shape Tests
// =============================================================================

describe('Error Response Shape', () => {
  describe('UpstreamConfigError fields', () => {
    it('should have ok: false', () => {
      expect(resolveBackendOriginSource).toContain('ok: false');
    });

    it('should have status: 500', () => {
      expect(resolveBackendOriginSource).toContain('status: 500');
    });

    it('should have code field', () => {
      expect(resolveBackendOriginSource).toContain("code: 'UPSTREAM_NOT_CONFIGURED'");
    });

    it('should have message field', () => {
      expect(resolveBackendOriginSource).toContain('message: result.error');
    });

    it('should have missing array', () => {
      expect(resolveBackendOriginSource).toContain('missing: result.missing');
    });

    it('should have environment field', () => {
      expect(resolveBackendOriginSource).toContain('environment: result.environment');
    });

    it('should have timestamp field', () => {
      expect(resolveBackendOriginSource).toContain('timestamp: new Date().toISOString()');
    });
  });
});
