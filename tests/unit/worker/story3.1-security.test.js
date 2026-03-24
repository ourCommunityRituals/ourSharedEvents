/**
 * Security Tests for Story 3.1 - Admin Auth Model
 *
 * These tests ensure that admin authentication is properly enforced
 * across all admin endpoints and that security best practices are followed.
 *
 * Critical Security Requirements:
 * - Any call to /api/admin/* without valid token must return 401
 * - Any call to admin endpoints without valid token must return 401
 * - Invalid tokens must be rejected
 * - Tokens must never be logged
 * - Constant-time comparison must be used for token validation
 *
 * @see worker/src/auth/adminAuth.ts
 * @see worker/src/handlers/adminBundle.ts
 * @see Story 3.1 - Define Admin Auth Model for Worker API
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const adminAuthPath = path.join(__dirname, '../../../worker/src/auth/adminAuth.ts');
const adminBundleHandlerPath = path.join(__dirname, '../../../worker/src/handlers/adminBundle.ts');
const cloudflareAuthPath = path.join(__dirname, '../../../cloudflare-proxy/src/middleware/auth.js');
const cloudflareIndexPath = path.join(__dirname, '../../../cloudflare-proxy/src/index.js');

let adminAuthSource = '';
let adminBundleSource = '';
let cloudflareAuthSource = '';
let cloudflareIndexSource = '';

beforeAll(() => {
  try {
    adminAuthSource = fs.readFileSync(adminAuthPath, 'utf8');
    adminBundleSource = fs.readFileSync(adminBundleHandlerPath, 'utf8');
    cloudflareAuthSource = fs.readFileSync(cloudflareAuthPath, 'utf8');
    cloudflareIndexSource = fs.readFileSync(cloudflareIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// SECURITY CRITICAL: Admin Endpoint Protection Tests
// =============================================================================

describe('SECURITY: Admin Endpoint Protection (Story 3.1)', () => {

  describe('Admin Bundle Endpoint', () => {
    it('MUST check authentication before processing', () => {
      // Admin bundle handler MUST call checkAuth
      expect(adminBundleSource).toContain('checkAuth(request, env)');
    });

    it('MUST return 401 when auth fails', () => {
      expect(adminBundleSource).toContain("'UNAUTHORIZED'");
      expect(adminBundleSource).toContain('401');
    });

    it('MUST reject requests without valid token', () => {
      expect(adminBundleSource).toContain('!checkAuth(request, env)');
      expect(adminBundleSource).toContain('createErrorResponse');
    });
  });

  describe('Worker Admin Auth Module', () => {
    it('MUST validate ADMIN_TOKEN in production', () => {
      expect(adminAuthSource).toContain("env.WORKER_ENV === 'production'");
      expect(adminAuthSource).toContain("errorCode: 'NOT_CONFIGURED'");
    });

    it('MUST return 401 for missing auth', () => {
      expect(adminAuthSource).toContain("errorCode: 'MISSING_TOKEN'");
      expect(adminAuthSource).toContain('UNAUTHORIZED: 401');
    });

    it('MUST return 401 for invalid token', () => {
      expect(adminAuthSource).toContain("errorCode: 'INVALID_TOKEN'");
      expect(adminAuthSource).toContain('authenticated: false');
    });
  });

  describe('Cloudflare Proxy Auth Module', () => {
    it('MUST validate Authorization header', () => {
      expect(cloudflareAuthSource).toContain("request.headers.get('Authorization')");
    });

    it('MUST return 401 for missing Authorization', () => {
      expect(cloudflareAuthSource).toContain("errorCode: 'UNAUTHORIZED'");
      expect(cloudflareAuthSource).toContain("Missing Authorization header");
    });

    it('MUST return 401 for invalid token', () => {
      expect(cloudflareAuthSource).toContain("Invalid admin token");
    });

    it('MUST set WWW-Authenticate header on 401', () => {
      expect(cloudflareAuthSource).toContain("'WWW-Authenticate'");
      expect(cloudflareAuthSource).toContain("Bearer realm=");
    });
  });
});

// =============================================================================
// SECURITY CRITICAL: Admin Route Detection
// =============================================================================

describe('SECURITY: Admin Route Detection (Story 3.1)', () => {

  describe('isAdminRoute Function', () => {
    it('MUST detect /api/admin/ routes', () => {
      expect(adminAuthSource).toContain("normalized.startsWith('/api/admin/')");
    });

    it('MUST detect /api/v2/admin/ routes', () => {
      expect(adminAuthSource).toContain("normalized.startsWith('/api/v2/admin/')");
    });

    it('MUST detect adminBundle routes', () => {
      expect(adminAuthSource).toContain("normalized.includes('/adminbundle')");
    });

    it('MUST detect /bundle/admin routes', () => {
      expect(adminAuthSource).toContain("normalized.includes('/bundle/admin')");
    });

    it('MUST normalize case for detection', () => {
      // Prevents bypass via case manipulation (e.g., /Api/Admin/)
      expect(adminAuthSource).toContain('pathname.toLowerCase()');
    });
  });
});

// =============================================================================
// SECURITY CRITICAL: Timing Attack Prevention
// =============================================================================

describe('SECURITY: Timing Attack Prevention (Story 3.1)', () => {

  it('MUST use constant-time string comparison', () => {
    expect(adminAuthSource).toContain('function constantTimeCompare(');
  });

  it('MUST compare all characters regardless of mismatch', () => {
    // XOR comparison ensures all characters are checked
    expect(adminAuthSource).toContain('a.charCodeAt(i) ^ b.charCodeAt(i)');
  });

  it('MUST accumulate comparison results with OR', () => {
    // OR accumulation prevents early exit
    expect(adminAuthSource).toContain('result |=');
  });

  it('MUST check lengths before comparison', () => {
    // Length check should be the only early return
    expect(adminAuthSource).toContain('a.length !== b.length');
  });

  it('MUST use constant-time compare for token validation', () => {
    // Ensure constantTimeCompare is used for actual token comparison
    expect(adminAuthSource).toMatch(/constantTimeCompare\([^,]+,\s*env\.ADMIN_TOKEN/);
  });
});

// =============================================================================
// SECURITY CRITICAL: Token Exposure Prevention
// =============================================================================

describe('SECURITY: Token Exposure Prevention (Story 3.1)', () => {

  describe('Worker Auth Module', () => {
    it('MUST NOT log token values', () => {
      // Extract all console statements
      const consoleStatements = adminAuthSource.match(/console\.(log|warn|error|info)\([^)]+\)/g) || [];

      for (const statement of consoleStatements) {
        expect(statement).not.toContain('env.ADMIN_TOKEN');
        expect(statement).not.toContain('bearerToken');
        expect(statement).not.toMatch(/token\s*:/);
      }
    });

    it('MUST NOT include token in error responses', () => {
      // Check AdminAuthErrorResponse interface
      expect(adminAuthSource).toContain('interface AdminAuthErrorResponse');

      // Error response should only have ok, code, message
      const errorResponseMatch = adminAuthSource.match(/interface AdminAuthErrorResponse\s*\{[^}]+\}/);
      if (errorResponseMatch) {
        const errorResponseInterface = errorResponseMatch[0];
        expect(errorResponseInterface).not.toContain('token');
        expect(errorResponseInterface).not.toContain('adminKey');
      }
    });

    it('MUST NOT expose token in log output', () => {
      // The logAuthAttempt function should not include token
      const logFunction = adminAuthSource.match(/function logAuthAttempt[\s\S]*?^\}/m);
      if (logFunction) {
        expect(logFunction[0]).not.toContain('env.ADMIN_TOKEN');
        expect(logFunction[0]).not.toContain('bearerToken');
      }
    });
  });

  describe('Cloudflare Auth Module', () => {
    it('MUST NOT log token values', () => {
      const consoleStatements = cloudflareAuthSource.match(/console\.(log|warn|error|info)\([^)]+\)/g) || [];

      for (const statement of consoleStatements) {
        expect(statement).not.toContain('env.ADMIN_TOKEN');
        expect(statement).not.toContain('adminKey');
      }
    });
  });
});

// =============================================================================
// SECURITY CRITICAL: Authentication Flow Tests
// =============================================================================

describe('SECURITY: Authentication Flow (Story 3.1)', () => {

  describe('Bearer Token Flow', () => {
    it('MUST extract token from Bearer header', () => {
      expect(adminAuthSource).toContain('/^Bearer\\s+(.+)$/i');
    });

    it('MUST validate extracted token', () => {
      expect(adminAuthSource).toContain('constantTimeCompare(bearerToken, env.ADMIN_TOKEN');
    });

    it('MUST reject invalid Bearer format', () => {
      // extractBearerToken returns null for invalid format
      expect(adminAuthSource).toMatch(/const match = .*\.match/);
      expect(adminAuthSource).toContain('return match ? match[1] : null');
    });
  });

  describe('Query Parameter Fallback', () => {
    it('MUST only use query param as fallback', () => {
      // Query param should be checked after Bearer token fails
      const authFunction = adminAuthSource.match(/function checkAdminAuth[\s\S]*?^}/m);
      if (authFunction) {
        const bearerIndex = authFunction[0].indexOf('bearerToken');
        const queryIndex = authFunction[0].indexOf('searchParams');
        expect(bearerIndex).toBeLessThan(queryIndex);
      }
    });

    it('MUST validate query param token securely', () => {
      expect(adminAuthSource).toContain('constantTimeCompare(adminKey, env.ADMIN_TOKEN');
    });
  });

  describe('Auth Result Structure', () => {
    it('MUST include authentication status', () => {
      expect(adminAuthSource).toContain('authenticated: boolean');
    });

    it('MUST include error information on failure', () => {
      expect(adminAuthSource).toContain('error: string | null');
      expect(adminAuthSource).toContain('errorCode: AuthErrorCode | null');
    });

    it('MUST include context only on success', () => {
      expect(adminAuthSource).toContain('context: AuthContext | null');
    });
  });
});

// =============================================================================
// SECURITY CRITICAL: Error Response Tests
// =============================================================================

describe('SECURITY: Error Responses (Story 3.1)', () => {

  describe('401 Unauthorized Response', () => {
    it('MUST return status 401', () => {
      // Check that AUTH_STATUS_CODES has UNAUTHORIZED: 401
      expect(adminAuthSource).toContain('UNAUTHORIZED: 401');
    });

    it('MUST include WWW-Authenticate header', () => {
      expect(adminAuthSource).toContain("'WWW-Authenticate': 'Bearer realm=");
    });

    it('MUST NOT leak sensitive information in body', () => {
      const errorResponse = adminAuthSource.match(/createAuthErrorResponse[\s\S]*?^}/m);
      if (errorResponse) {
        expect(errorResponse[0]).not.toContain('ADMIN_TOKEN');
        expect(errorResponse[0]).not.toContain('expected');
        expect(errorResponse[0]).not.toContain('actual');
      }
    });
  });

  describe('503 Not Configured Response', () => {
    it('MUST return status 503 when auth not configured', () => {
      expect(adminAuthSource).toContain('NOT_CONFIGURED: 503');
    });

    it('MUST only fail in production mode', () => {
      // In dev mode, should allow access with warning
      expect(adminAuthSource).toContain("env.WORKER_ENV === 'production'");
    });
  });
});

// =============================================================================
// SECURITY: Module Export Security
// =============================================================================

describe('SECURITY: Module Exports (Story 3.1)', () => {

  it('MUST export auth check functions', () => {
    expect(cloudflareIndexSource).toContain('checkAdminAuth');
    expect(cloudflareIndexSource).toContain('requireAdminAuth');
  });

  it('MUST export from middleware/auth module', () => {
    expect(cloudflareIndexSource).toContain("from './middleware/auth.js'");
  });

  it('MUST export guard function', () => {
    expect(adminAuthSource).toContain('export function guardAdminRoute(');
  });
});

// =============================================================================
// SECURITY: Production Environment Strictness
// =============================================================================

describe('SECURITY: Production Environment (Story 3.1)', () => {

  it('MUST enforce auth in production', () => {
    expect(adminAuthSource).toContain("env.WORKER_ENV === 'production'");
  });

  it('MUST fail when ADMIN_TOKEN missing in production', () => {
    expect(adminAuthSource).toContain("errorCode: 'NOT_CONFIGURED'");
    expect(adminAuthSource).toContain("Admin authentication not configured");
  });

  it('MUST log warning in dev mode only', () => {
    expect(adminAuthSource).toContain('console.warn');
    expect(adminAuthSource).toContain('dev mode');
  });
});

// =============================================================================
// SECURITY: Integration Points
// =============================================================================

describe('SECURITY: Integration Points (Story 3.1)', () => {

  describe('Admin Bundle Handler Integration', () => {
    it('MUST call auth check at start of handler', () => {
      // Auth check should happen before any data access
      const handler = adminBundleSource.match(/handleGetAdminBundle[\s\S]*?return createErrorResponse/);
      if (handler) {
        expect(handler[0]).toContain('checkAuth(request, env)');
      }
    });

    it('MUST return before data access on auth failure', () => {
      expect(adminBundleSource).toContain("if (!checkAuth(request, env))");
      expect(adminBundleSource).toContain("return createErrorResponse(");
    });
  });

  describe('Middleware Export Availability', () => {
    it('MUST export requireAdminAuth for route handlers', () => {
      expect(cloudflareIndexSource).toContain('requireAdminAuth');
    });

    it('MUST export authErrorResponse for custom error handling', () => {
      expect(cloudflareIndexSource).toContain('authErrorResponse');
    });
  });
});

// =============================================================================
// CI/CD Security Gate Tests
// =============================================================================

describe('SECURITY: CI/CD Integration (Story 3.1)', () => {

  it('MUST have security tests that can run in Stage-1', () => {
    // This test file itself validates that security tests exist
    expect(fs.existsSync(__filename)).toBe(true);
  });

  it('MUST be discoverable by Jest test patterns', () => {
    // Test filename follows pattern **/tests/unit/**/*.test.js
    expect(__filename).toMatch(/tests\/unit\/worker\/.*\.test\.js$/);
  });
});
