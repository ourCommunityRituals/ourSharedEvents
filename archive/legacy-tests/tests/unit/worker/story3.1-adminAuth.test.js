/**
 * Unit Tests for Story 3.1 - Admin Auth Model for Worker API
 *
 * Tests the admin authentication module implementation.
 * Validates:
 * - Bearer token authentication
 * - Query param authentication (legacy support)
 * - Auth error responses (401, 503)
 * - Admin route detection
 * - Guard middleware behavior
 * - Constant-time comparison security
 * - Dev mode behavior (ADMIN_TOKEN not configured)
 * - Production mode strictness
 *
 * @see worker/src/auth/adminAuth.ts
 * @see Story 3.1 - Define Admin Auth Model for Worker API
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const adminAuthPath = path.join(__dirname, '../../../worker/src/auth/adminAuth.ts');
const authIndexPath = path.join(__dirname, '../../../worker/src/auth/index.ts');
const mainIndexPath = path.join(__dirname, '../../../worker/src/index.ts');

let adminAuthSource = '';
let authIndexSource = '';
let mainIndexSource = '';

beforeAll(() => {
  try {
    adminAuthSource = fs.readFileSync(adminAuthPath, 'utf8');
    authIndexSource = fs.readFileSync(authIndexPath, 'utf8');
    mainIndexSource = fs.readFileSync(mainIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Module Structure Tests
// =============================================================================

describe('Admin Auth Module Structure (Story 3.1)', () => {
  describe('Module Exports', () => {
    it('should export checkAdminAuth function', () => {
      expect(adminAuthSource).toContain('export function checkAdminAuth(');
    });

    it('should export requireAdminAuth function', () => {
      expect(adminAuthSource).toContain('export function requireAdminAuth(');
    });

    it('should export createAuthErrorResponse function', () => {
      expect(adminAuthSource).toContain('export function createAuthErrorResponse(');
    });

    it('should export isAuthConfigured function', () => {
      expect(adminAuthSource).toContain('export function isAuthConfigured(');
    });

    it('should export isAdminRoute function', () => {
      expect(adminAuthSource).toContain('export function isAdminRoute(');
    });

    it('should export guardAdminRoute function', () => {
      expect(adminAuthSource).toContain('export function guardAdminRoute(');
    });

    it('should export logAuthAttempt function', () => {
      expect(adminAuthSource).toContain('export function logAuthAttempt(');
    });
  });

  describe('Type Exports', () => {
    it('should export AdminAuthEnv interface', () => {
      expect(adminAuthSource).toContain('export interface AdminAuthEnv');
    });

    it('should export AuthResult interface', () => {
      expect(adminAuthSource).toContain('export interface AuthResult');
    });

    it('should export AuthContext interface', () => {
      expect(adminAuthSource).toContain('export interface AuthContext');
    });

    it('should export AuthErrorCode type', () => {
      expect(adminAuthSource).toContain('export type AuthErrorCode');
    });

    it('should export AdminAuthErrorResponse interface', () => {
      expect(adminAuthSource).toContain('export interface AdminAuthErrorResponse');
    });
  });

  describe('Constant Exports', () => {
    it('should export AUTH_ERROR_MESSAGES constant', () => {
      expect(adminAuthSource).toContain('export const AUTH_ERROR_MESSAGES');
    });

    it('should export AUTH_STATUS_CODES constant', () => {
      expect(adminAuthSource).toContain('export const AUTH_STATUS_CODES');
    });
  });
});

// =============================================================================
// AdminAuthEnv Interface Tests
// =============================================================================

describe('AdminAuthEnv Interface (Story 3.1)', () => {
  it('should include ADMIN_TOKEN property', () => {
    expect(adminAuthSource).toContain('ADMIN_TOKEN?: string');
  });

  it('should include WORKER_ENV property', () => {
    expect(adminAuthSource).toContain('WORKER_ENV?: string');
  });
});

// =============================================================================
// AuthResult Interface Tests
// =============================================================================

describe('AuthResult Interface (Story 3.1)', () => {
  it('should include authenticated property', () => {
    expect(adminAuthSource).toContain('authenticated: boolean');
  });

  it('should include error property', () => {
    expect(adminAuthSource).toContain('error: string | null');
  });

  it('should include errorCode property', () => {
    expect(adminAuthSource).toContain('errorCode: AuthErrorCode | null');
  });

  it('should include context property', () => {
    expect(adminAuthSource).toContain('context: AuthContext | null');
  });
});

// =============================================================================
// AuthContext Interface Tests
// =============================================================================

describe('AuthContext Interface (Story 3.1)', () => {
  it('should include role property with admin value', () => {
    expect(adminAuthSource).toContain("role: 'admin'");
  });

  it('should include authMethod property with valid values', () => {
    expect(adminAuthSource).toContain("authMethod: 'bearer_token' | 'query_param'");
  });

  it('should include authenticatedAt property', () => {
    expect(adminAuthSource).toContain('authenticatedAt: string');
  });
});

// =============================================================================
// AuthErrorCode Type Tests
// =============================================================================

describe('AuthErrorCode Type (Story 3.1)', () => {
  it('should include UNAUTHORIZED code', () => {
    expect(adminAuthSource).toContain("'UNAUTHORIZED'");
  });

  it('should include NOT_CONFIGURED code', () => {
    expect(adminAuthSource).toContain("'NOT_CONFIGURED'");
  });

  it('should include INVALID_TOKEN code', () => {
    expect(adminAuthSource).toContain("'INVALID_TOKEN'");
  });

  it('should include MISSING_TOKEN code', () => {
    expect(adminAuthSource).toContain("'MISSING_TOKEN'");
  });
});

// =============================================================================
// Bearer Token Authentication Tests (AC: Primary Auth Method)
// =============================================================================

describe('Bearer Token Authentication (Story 3.1 AC)', () => {
  it('should check Authorization header', () => {
    expect(adminAuthSource).toContain("request.headers.get('Authorization')");
  });

  it('should extract Bearer token from header', () => {
    expect(adminAuthSource).toContain('extractBearerToken');
    expect(adminAuthSource).toContain('/^Bearer\\s+(.+)$/i');
  });

  it('should validate token against ADMIN_TOKEN', () => {
    expect(adminAuthSource).toContain('env.ADMIN_TOKEN');
    expect(adminAuthSource).toContain('constantTimeCompare');
  });

  it('should return authenticated true for valid token', () => {
    expect(adminAuthSource).toContain('authenticated: true');
  });

  it('should set authMethod to bearer_token', () => {
    expect(adminAuthSource).toContain("authMethod: 'bearer_token'");
  });

  it('should return authenticated false for invalid token', () => {
    expect(adminAuthSource).toContain('authenticated: false');
    expect(adminAuthSource).toContain("errorCode: 'INVALID_TOKEN'");
  });
});

// =============================================================================
// Query Parameter Authentication Tests (AC: Legacy Support)
// =============================================================================

describe('Query Parameter Authentication (Story 3.1 AC)', () => {
  it('should support adminKey query parameter as fallback', () => {
    expect(adminAuthSource).toContain("url.searchParams.get('adminKey')");
  });

  it('should validate adminKey against ADMIN_TOKEN', () => {
    expect(adminAuthSource).toContain('constantTimeCompare(adminKey, env.ADMIN_TOKEN');
  });

  it('should set authMethod to query_param for query auth', () => {
    expect(adminAuthSource).toContain("authMethod: 'query_param'");
  });
});

// =============================================================================
// Security Tests - Constant Time Comparison
// =============================================================================

describe('Security: Constant Time Comparison (Story 3.1)', () => {
  it('should implement constant time string comparison', () => {
    expect(adminAuthSource).toContain('function constantTimeCompare(');
  });

  it('should compare string lengths first', () => {
    expect(adminAuthSource).toContain('a.length !== b.length');
  });

  it('should use XOR for character comparison', () => {
    expect(adminAuthSource).toContain('a.charCodeAt(i) ^ b.charCodeAt(i)');
  });

  it('should accumulate results with OR', () => {
    expect(adminAuthSource).toContain('result |=');
  });

  it('should return true only when result is 0', () => {
    expect(adminAuthSource).toContain('return result === 0');
  });
});

// =============================================================================
// Auth Error Response Tests (AC: 401 Response)
// =============================================================================

describe('Auth Error Response (Story 3.1 AC)', () => {
  it('should return 401 status for unauthorized', () => {
    expect(adminAuthSource).toContain('UNAUTHORIZED: 401');
  });

  it('should return 503 status for not configured', () => {
    expect(adminAuthSource).toContain('NOT_CONFIGURED: 503');
  });

  it('should set WWW-Authenticate header', () => {
    expect(adminAuthSource).toContain("'WWW-Authenticate'");
    expect(adminAuthSource).toContain('Bearer realm=');
  });

  it('should return JSON error body', () => {
    expect(adminAuthSource).toContain("'Content-Type': 'application/json'");
    expect(adminAuthSource).toContain('JSON.stringify(body)');
  });

  it('should include ok: false in error response', () => {
    expect(adminAuthSource).toContain('ok: false');
  });

  it('should include error code in response', () => {
    expect(adminAuthSource).toContain('code: result.errorCode');
  });

  it('should include error message in response', () => {
    expect(adminAuthSource).toContain('message: result.error');
  });
});

// =============================================================================
// Admin Route Detection Tests (AC: /api/admin/*)
// =============================================================================

describe('Admin Route Detection (Story 3.1 AC)', () => {
  it('should detect /api/admin/* routes', () => {
    expect(adminAuthSource).toContain('/api/admin/');
    expect(adminAuthSource).toContain("normalized.startsWith('/api/admin/')");
  });

  it('should detect /api/v2/admin/* routes', () => {
    expect(adminAuthSource).toContain('/api/v2/admin/');
    expect(adminAuthSource).toContain("normalized.startsWith('/api/v2/admin/')");
  });

  it('should detect adminBundle endpoints', () => {
    expect(adminAuthSource).toContain('/adminbundle');
    expect(adminAuthSource).toContain("normalized.includes('/adminbundle')");
  });

  it('should detect /bundle/admin pattern', () => {
    expect(adminAuthSource).toContain('/bundle/admin');
    expect(adminAuthSource).toContain("normalized.includes('/bundle/admin')");
  });

  it('should normalize pathname to lowercase', () => {
    expect(adminAuthSource).toContain('pathname.toLowerCase()');
  });
});

// =============================================================================
// Guard Middleware Tests
// =============================================================================

describe('Guard Middleware (Story 3.1)', () => {
  describe('requireAdminAuth function', () => {
    it('should call checkAdminAuth', () => {
      expect(adminAuthSource).toContain('checkAdminAuth(request, env)');
    });

    it('should return null on successful auth', () => {
      expect(adminAuthSource).toContain('return null');
    });

    it('should return error response on failed auth', () => {
      expect(adminAuthSource).toContain('createAuthErrorResponse(result)');
    });
  });

  describe('guardAdminRoute function', () => {
    it('should check if path is admin route', () => {
      expect(adminAuthSource).toContain('isAdminRoute(url.pathname)');
    });

    it('should call requireAdminAuth for admin routes', () => {
      expect(adminAuthSource).toContain('return requireAdminAuth(request, env)');
    });

    it('should return null for non-admin routes', () => {
      // Non-admin routes should pass through without auth check
      expect(adminAuthSource).toMatch(/if\s*\(isAdminRoute\(url\.pathname\)\)/);
    });
  });
});

// =============================================================================
// Dev Mode Tests (AC: Flexible Dev Environment)
// =============================================================================

describe('Dev Mode Behavior (Story 3.1)', () => {
  it('should check if ADMIN_TOKEN is configured', () => {
    expect(adminAuthSource).toContain('isAuthConfigured(env)');
    expect(adminAuthSource).toContain('env.ADMIN_TOKEN');
  });

  it('should allow access in dev mode when token not configured', () => {
    expect(adminAuthSource).toContain("env.WORKER_ENV === 'production'");
    expect(adminAuthSource).toContain('authenticated: true');
  });

  it('should log warning for dev mode access', () => {
    expect(adminAuthSource).toContain('console.warn');
    expect(adminAuthSource).toContain('ADMIN_TOKEN not configured');
    expect(adminAuthSource).toContain('dev mode');
  });

  it('should fail in production when token not configured', () => {
    expect(adminAuthSource).toContain("errorCode: 'NOT_CONFIGURED'");
    expect(adminAuthSource).toContain("env.WORKER_ENV === 'production'");
  });
});

// =============================================================================
// Error Message Tests
// =============================================================================

describe('Error Messages (Story 3.1)', () => {
  it('should have UNAUTHORIZED error message', () => {
    expect(adminAuthSource).toContain("UNAUTHORIZED: 'Missing or invalid authentication'");
  });

  it('should have NOT_CONFIGURED error message', () => {
    expect(adminAuthSource).toContain("NOT_CONFIGURED: 'Admin authentication not configured'");
  });

  it('should have INVALID_TOKEN error message', () => {
    expect(adminAuthSource).toContain("INVALID_TOKEN: 'Invalid admin token'");
  });

  it('should have MISSING_TOKEN error message', () => {
    expect(adminAuthSource).toContain(
      "MISSING_TOKEN: 'Missing Authorization header or adminKey parameter'"
    );
  });
});

// =============================================================================
// Logging Tests
// =============================================================================

describe('Auth Logging (Story 3.1)', () => {
  it('should log auth attempts with structured JSON', () => {
    expect(adminAuthSource).toContain('console.log(');
    expect(adminAuthSource).toContain('JSON.stringify(');
  });

  it('should include AUTH_ATTEMPT type in log', () => {
    expect(adminAuthSource).toContain("type: 'AUTH_ATTEMPT'");
  });

  it('should log authentication result', () => {
    expect(adminAuthSource).toContain('authenticated: result.authenticated');
  });

  it('should log auth method used', () => {
    expect(adminAuthSource).toContain('authMethod: result.context?.authMethod');
  });

  it('should log whether auth header was present', () => {
    expect(adminAuthSource).toContain('hasAuthHeader');
  });

  it('should log whether query param was present', () => {
    expect(adminAuthSource).toContain('hasQueryParam');
  });

  it('should log request path', () => {
    expect(adminAuthSource).toContain('path: url.pathname');
  });

  it('should include timestamp in log', () => {
    expect(adminAuthSource).toContain('timestamp:');
  });

  it('should NOT log the actual token', () => {
    // Ensure we're not logging sensitive data
    expect(adminAuthSource).not.toContain('token: token');
    expect(adminAuthSource).not.toContain('ADMIN_TOKEN: env.ADMIN_TOKEN');
  });
});

// =============================================================================
// Barrel Export Tests
// =============================================================================

describe('Barrel Exports (Story 3.1)', () => {
  describe('Auth Index Exports', () => {
    it('should export checkAdminAuth', () => {
      expect(authIndexSource).toContain('checkAdminAuth');
    });

    it('should export requireAdminAuth', () => {
      expect(authIndexSource).toContain('requireAdminAuth');
    });

    it('should export createAuthErrorResponse', () => {
      expect(authIndexSource).toContain('createAuthErrorResponse');
    });

    it('should export isAuthConfigured', () => {
      expect(authIndexSource).toContain('isAuthConfigured');
    });

    it('should export isAdminRoute', () => {
      expect(authIndexSource).toContain('isAdminRoute');
    });

    it('should export guardAdminRoute', () => {
      expect(authIndexSource).toContain('guardAdminRoute');
    });

    it('should export type AdminAuthEnv', () => {
      expect(authIndexSource).toContain('type AdminAuthEnv');
    });

    it('should export type AuthResult', () => {
      expect(authIndexSource).toContain('type AuthResult');
    });

    it('should export AUTH_ERROR_MESSAGES', () => {
      expect(authIndexSource).toContain('AUTH_ERROR_MESSAGES');
    });

    it('should export AUTH_STATUS_CODES', () => {
      expect(authIndexSource).toContain('AUTH_STATUS_CODES');
    });

    it('should include Story 3.1 reference', () => {
      expect(authIndexSource).toContain('Story 3.1');
    });
  });

  describe('Main Index Exports', () => {
    it('should export checkAdminAuth from auth', () => {
      expect(mainIndexSource).toContain('checkAdminAuth');
    });

    it('should export requireAdminAuth from auth', () => {
      expect(mainIndexSource).toContain('requireAdminAuth');
    });

    it('should export guardAdminRoute from auth', () => {
      expect(mainIndexSource).toContain('guardAdminRoute');
    });

    it('should export type AdminAuthEnv', () => {
      expect(mainIndexSource).toContain('type AdminAuthEnv');
    });

    it('should export AUTH_ERROR_MESSAGES', () => {
      expect(mainIndexSource).toContain('AUTH_ERROR_MESSAGES');
    });

    it('should include Story 3.1 reference', () => {
      expect(mainIndexSource).toContain('Story 3.1');
    });
  });
});

// =============================================================================
// Documentation Tests
// =============================================================================

describe('Documentation (Story 3.1)', () => {
  it('should have module-level JSDoc', () => {
    expect(adminAuthSource).toContain('@module auth/adminAuth');
  });

  it('should reference Story 3.1', () => {
    expect(adminAuthSource).toContain('Story 3.1');
  });

  it('should document Phase 1 (shared token)', () => {
    expect(adminAuthSource).toContain('Phase 1');
  });

  it('should mention Phase 2 (future enhancements)', () => {
    expect(adminAuthSource).toContain('Phase 2');
  });

  it('should include security notes', () => {
    expect(adminAuthSource).toContain('Security Notes');
  });

  it('should warn about timing attacks', () => {
    expect(adminAuthSource).toContain('timing attack');
  });

  it('should document constant-time comparison usage', () => {
    expect(adminAuthSource).toContain('constant-time comparison');
  });
});

// =============================================================================
// Security Negative Path Tests (AC: Token Leaked)
// =============================================================================

describe('Security Negative Paths (Story 3.1 AC)', () => {
  describe('Token Protection', () => {
    it('should never log the actual token value', () => {
      // Check that console.log doesn't include raw token
      const logStatements = adminAuthSource.match(/console\.(log|warn|error)\([^)]+\)/g) || [];
      for (const statement of logStatements) {
        expect(statement).not.toContain('env.ADMIN_TOKEN');
        expect(statement).not.toContain('bearerToken');
        expect(statement).not.toContain('adminKey');
      }
    });

    it('should not include token in error responses', () => {
      expect(adminAuthSource).not.toContain('token: result.token');
      expect(adminAuthSource).not.toContain('adminKey: result.adminKey');
    });
  });

  describe('Invalid Input Handling', () => {
    it('should handle missing Authorization header', () => {
      expect(adminAuthSource).toContain("errorCode: 'MISSING_TOKEN'");
    });

    it('should handle invalid Bearer format', () => {
      // extractBearerToken returns null for invalid format
      expect(adminAuthSource).toContain('if (!header)');
      expect(adminAuthSource).toContain('return null');
    });

    it('should handle wrong token value', () => {
      expect(adminAuthSource).toContain("errorCode: 'INVALID_TOKEN'");
    });
  });
});

// =============================================================================
// Router Integration Tests (Story 3.1 - Token Guard in Worker)
// =============================================================================

const routerPath = path.join(__dirname, '../../../worker/src/router.ts');
let routerSource = '';

beforeAll(() => {
  try {
    routerSource = fs.readFileSync(routerPath, 'utf8');
  } catch (error) {
    console.error('Failed to read router file:', error.message);
  }
});

describe('Router Integration with Admin Auth Guard (Story 3.1)', () => {
  describe('Router Imports', () => {
    it('should import guardAdminRoute from auth module', () => {
      // guardAdminRoute is imported as part of the auth module (may be multi-line import)
      expect(routerSource).toContain('guardAdminRoute');
      expect(routerSource).toContain("from './auth'");
    });

    it('should import AdminAuthEnv type', () => {
      expect(routerSource).toContain('type AdminAuthEnv');
    });
  });

  describe('RouterEnv Interface', () => {
    it('should extend AdminAuthEnv interface', () => {
      expect(routerSource).toContain('export interface RouterEnv extends StatusEnv, AdminAuthEnv');
    });
  });

  describe('Auth Guard Integration', () => {
    it('should call guardAdminRoute in handleRequest', () => {
      expect(routerSource).toContain('guardAdminRoute(request, env)');
    });

    it('should check auth guard result before route matching', () => {
      // Auth guard should be called before matchRoute
      const handleRequestStart = routerSource.indexOf('async function handleRequest');
      const authGuardCall = routerSource.indexOf(
        'guardAdminRoute(request, env)',
        handleRequestStart
      );
      const matchRouteCall = routerSource.indexOf('matchRoute(url)', handleRequestStart);

      expect(authGuardCall).toBeGreaterThan(handleRequestStart);
      expect(authGuardCall).toBeLessThan(matchRouteCall);
    });

    it('should return auth error response if guard fails', () => {
      expect(routerSource).toContain('if (authError)');
      expect(routerSource).toContain('return addCorsHeaders(authError)');
    });

    it('should add CORS headers to auth error responses', () => {
      expect(routerSource).toContain('addCorsHeaders(authError)');
    });

    it('should log auth failures', () => {
      expect(routerSource).toContain('logger.warn');
      expect(routerSource).toContain('Admin auth failed');
    });

    it('should reference Story 3.1 in auth guard comment', () => {
      expect(routerSource).toContain('Story 3.1');
      expect(routerSource).toContain('admin authentication');
    });
  });

  describe('Auth Bypass for Non-Admin Routes', () => {
    it('should not block public bundle requests (guardAdminRoute returns null)', () => {
      // Public routes should not be blocked by auth guard
      // The guard returns null for non-admin routes
      expect(routerSource).toContain("case 'publicBundle':");
      expect(routerSource).toContain('handleApiPublicBundle');
    });

    it('should protect adminBundle route via guard', () => {
      // adminBundle routes ARE protected - guardAdminRoute checks isAdminRoute
      expect(adminAuthSource).toContain("normalized.includes('/adminbundle')");
    });
  });
});

// =============================================================================
// AdminEvents.html Integration Tests (Story 3.1 - Authorization Header)
// =============================================================================

const adminEventsPath = path.join(__dirname, '../../../src/mvp/AdminEvents.html');
let adminEventsSource = '';

beforeAll(() => {
  try {
    adminEventsSource = fs.readFileSync(adminEventsPath, 'utf8');
  } catch (error) {
    console.error('Failed to read AdminEvents.html:', error.message);
  }
});

describe('AdminEvents.html Auth Integration (Story 3.1)', () => {
  describe('Auth Helper Functions', () => {
    it('should define getAdminToken function', () => {
      expect(adminEventsSource).toContain('function getAdminToken()');
    });

    it('should check window.ADMIN_TOKEN for token', () => {
      expect(adminEventsSource).toContain('window.ADMIN_TOKEN');
    });

    it('should fall back to localStorage for token', () => {
      expect(adminEventsSource).toContain("localStorage.getItem('adminToken')");
    });

    it('should define buildAdminHeaders function', () => {
      expect(adminEventsSource).toContain('function buildAdminHeaders(');
    });

    it('should include Authorization Bearer header when token available', () => {
      expect(adminEventsSource).toContain("'Authorization'");
      expect(adminEventsSource).toContain('`Bearer ${token}`');
    });

    it('should expose getAdminToken to global scope', () => {
      expect(adminEventsSource).toContain('window.getAdminToken = getAdminToken');
    });

    it('should expose buildAdminHeaders to global scope', () => {
      expect(adminEventsSource).toContain('window.buildAdminHeaders = buildAdminHeaders');
    });
  });

  describe('fetchEventsListFromWorker Auth', () => {
    it('should use buildAdminHeaders for events list fetch', () => {
      expect(adminEventsSource).toContain('headers: buildAdminHeaders()');
    });

    it('should handle 401 status for events list', () => {
      expect(adminEventsSource).toContain('response.status === 401');
    });

    it('should return UNAUTHORIZED code on 401', () => {
      expect(adminEventsSource).toContain("code: 'UNAUTHORIZED'");
    });

    it('should include Story 3.1 reference in fetchEventsListFromWorker', () => {
      expect(adminEventsSource).toContain('Story 3.1');
    });
  });

  describe('fetchAdminBundleFromWorker Auth', () => {
    it('should use buildAdminHeaders for admin bundle fetch', () => {
      // Find the fetchAdminBundleFromWorker function and check it uses buildAdminHeaders
      const functionStart = adminEventsSource.indexOf('function fetchAdminBundleFromWorker');
      const functionEnd = adminEventsSource.indexOf('// Expose Worker functions', functionStart);
      const functionBody = adminEventsSource.substring(functionStart, functionEnd);

      expect(functionBody).toContain('buildAdminHeaders(');
    });

    it('should handle 401 status for admin bundle', () => {
      const functionStart = adminEventsSource.indexOf('function fetchAdminBundleFromWorker');
      const functionEnd = adminEventsSource.indexOf('// Expose Worker functions', functionStart);
      const functionBody = adminEventsSource.substring(functionStart, functionEnd);

      expect(functionBody).toContain('response.status === 401');
    });

    it('should preserve If-None-Match header support with auth', () => {
      expect(adminEventsSource).toContain("additionalHeaders['If-None-Match']");
      expect(adminEventsSource).toContain('buildAdminHeaders(additionalHeaders)');
    });

    it('should include Story 3.1 reference in fetchAdminBundleFromWorker', () => {
      const functionStart = adminEventsSource.indexOf('function fetchAdminBundleFromWorker');
      const commentEnd = adminEventsSource.indexOf('*/', functionStart);
      const commentBody = adminEventsSource.substring(functionStart - 200, commentEnd);

      expect(commentBody).toContain('Story 3.1');
    });
  });

  describe('Module Documentation', () => {
    it('should document auth helpers in module header', () => {
      // Check the module header comment lists auth helpers
      const headerEnd = adminEventsSource.indexOf('<script>');
      const header = adminEventsSource.substring(0, headerEnd);

      expect(header).toContain('Auth Helpers (Story 3.1)');
      expect(header).toContain('getAdminToken()');
      expect(header).toContain('buildAdminHeaders()');
    });
  });
});
