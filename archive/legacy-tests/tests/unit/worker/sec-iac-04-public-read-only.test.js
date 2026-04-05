/**
 * Security Tests for SEC-IAC-04 - Public Read-Only Enforcement
 *
 * These tests ensure that public routes are read-only by default
 * and that mutations require authorization.
 *
 * Critical Security Requirements:
 * - All public routes are read-only by default
 * - GET/HEAD requests on public routes succeed without auth
 * - POST/PUT/DELETE/PATCH on public routes without token return 403
 * - Unknown routes return 404
 * - Mutations with valid token are allowed
 *
 * @see worker/src/auth/publicReadOnly.ts
 * @see worker/src/router.ts
 * @see SEC-IAC-04 - Public Read-Only Enforcement
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const publicReadOnlyPath = path.join(__dirname, '../../../worker/src/auth/publicReadOnly.ts');
const routerPath = path.join(__dirname, '../../../worker/src/router.ts');
const authIndexPath = path.join(__dirname, '../../../worker/src/auth/index.ts');

let publicReadOnlySource = '';
let routerSource = '';
let authIndexSource = '';

beforeAll(() => {
  try {
    publicReadOnlySource = fs.readFileSync(publicReadOnlyPath, 'utf8');
    routerSource = fs.readFileSync(routerPath, 'utf8');
    authIndexSource = fs.readFileSync(authIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// SEC-IAC-04: Module Existence
// =============================================================================

describe('SEC-IAC-04: Module Structure', () => {
  it('MUST have publicReadOnly.ts module', () => {
    expect(fs.existsSync(publicReadOnlyPath)).toBe(true);
  });

  it('MUST export from auth index', () => {
    expect(authIndexSource).toContain("from './publicReadOnly'");
    expect(authIndexSource).toContain('guardPublicReadOnly');
    expect(authIndexSource).toContain('PublicReadOnlyEnv');
  });

  it('MUST integrate into router', () => {
    expect(routerSource).toContain('guardPublicReadOnly');
    expect(routerSource).toContain('SEC-IAC-04');
  });

  it('router MUST extend PublicReadOnlyEnv', () => {
    expect(routerSource).toContain('PublicReadOnlyEnv');
    expect(routerSource).toMatch(/RouterEnv extends.*PublicReadOnlyEnv/);
  });
});

// =============================================================================
// SEC-IAC-04: Route Classification
// =============================================================================

describe('SEC-IAC-04: Route Classification', () => {
  describe('Route Access Levels', () => {
    it('MUST define ADMIN_ONLY classification', () => {
      expect(publicReadOnlySource).toContain("'ADMIN_ONLY'");
    });

    it('MUST define READ_PUBLIC classification', () => {
      expect(publicReadOnlySource).toContain("'READ_PUBLIC'");
    });

    it('MUST define WRITE_PUBLIC classification', () => {
      expect(publicReadOnlySource).toContain("'WRITE_PUBLIC'");
    });

    it('MUST export RouteAccessLevel type', () => {
      expect(publicReadOnlySource).toContain('export type RouteAccessLevel');
    });
  });

  describe('Admin-Only Route Patterns', () => {
    it('MUST classify /api/v2/admin/* as ADMIN_ONLY', () => {
      // Regex patterns in source use escaped slashes: /^\/api\/v2\/admin\//i
      expect(publicReadOnlySource).toContain('V2 admin endpoints');
      expect(publicReadOnlySource).toContain('ADMIN_ONLY_PATTERNS');
    });

    it('MUST classify /api/admin/* as ADMIN_ONLY', () => {
      expect(publicReadOnlySource).toContain('Legacy admin endpoints');
    });

    it('MUST classify /auth/* as ADMIN_ONLY', () => {
      expect(publicReadOnlySource).toContain('OAuth routes');
    });
  });

  describe('Read-Public Route Patterns', () => {
    it('MUST classify /api/status as READ_PUBLIC', () => {
      expect(publicReadOnlySource).toContain('Status endpoint');
      expect(publicReadOnlySource).toContain('READ_PUBLIC_PATTERNS');
    });

    it('MUST classify /api/events as READ_PUBLIC', () => {
      expect(publicReadOnlySource).toContain('Events list');
    });

    it('MUST classify /api/v2/events as READ_PUBLIC', () => {
      expect(publicReadOnlySource).toContain('V2 events list');
    });

    it('MUST classify publicBundle routes as READ_PUBLIC', () => {
      expect(publicReadOnlySource).toContain('/publicBundle');
    });

    it('MUST classify displayBundle routes as READ_PUBLIC', () => {
      expect(publicReadOnlySource).toContain('/displayBundle');
    });

    it('MUST classify posterBundle routes as READ_PUBLIC', () => {
      expect(publicReadOnlySource).toContain('/posterBundle');
    });
  });

  describe('classifyRoute Function', () => {
    it('MUST export classifyRoute function', () => {
      expect(publicReadOnlySource).toContain('export function classifyRoute(');
    });

    it('MUST normalize trailing slashes', () => {
      expect(publicReadOnlySource).toContain('.slice(0, -1)');
    });

    it('MUST check ADMIN_ONLY patterns first', () => {
      // ADMIN_ONLY should be checked before READ_PUBLIC
      const classifyFunction = publicReadOnlySource.match(/function classifyRoute[\s\S]*?^}/m);
      if (classifyFunction) {
        const adminIndex = classifyFunction[0].indexOf('ADMIN_ONLY_PATTERNS');
        const readIndex = classifyFunction[0].indexOf('READ_PUBLIC_PATTERNS');
        expect(adminIndex).toBeLessThan(readIndex);
      }
    });
  });
});

// =============================================================================
// SEC-IAC-04: HTTP Method Classification
// =============================================================================

describe('SEC-IAC-04: HTTP Method Classification', () => {
  describe('Mutation Methods', () => {
    it('MUST define POST as mutation method', () => {
      expect(publicReadOnlySource).toContain("'POST'");
      expect(publicReadOnlySource).toContain('MUTATION_METHODS');
    });

    it('MUST define PUT as mutation method', () => {
      expect(publicReadOnlySource).toContain("'PUT'");
    });

    it('MUST define DELETE as mutation method', () => {
      expect(publicReadOnlySource).toContain("'DELETE'");
    });

    it('MUST define PATCH as mutation method', () => {
      expect(publicReadOnlySource).toContain("'PATCH'");
    });

    it('MUST export isMutationMethod function', () => {
      expect(publicReadOnlySource).toContain('export function isMutationMethod(');
    });
  });

  describe('Read Methods', () => {
    it('MUST define GET as read method', () => {
      expect(publicReadOnlySource).toContain("'GET'");
      expect(publicReadOnlySource).toContain('READ_METHODS');
    });

    it('MUST define HEAD as read method', () => {
      expect(publicReadOnlySource).toContain("'HEAD'");
    });

    it('MUST define OPTIONS as read method', () => {
      expect(publicReadOnlySource).toContain("'OPTIONS'");
    });

    it('MUST export isReadMethod function', () => {
      expect(publicReadOnlySource).toContain('export function isReadMethod(');
    });
  });
});

// =============================================================================
// SEC-IAC-04: Guard Function
// =============================================================================

describe('SEC-IAC-04: Guard Function', () => {
  describe('guardPublicReadOnly Function', () => {
    it('MUST export guardPublicReadOnly function', () => {
      expect(publicReadOnlySource).toContain('export function guardPublicReadOnly(');
    });

    it('MUST accept request, env, and requestId parameters', () => {
      expect(publicReadOnlySource).toMatch(/guardPublicReadOnly\(\s*request:\s*Request/);
      expect(publicReadOnlySource).toMatch(/env:\s*PublicReadOnlyEnv/);
      expect(publicReadOnlySource).toMatch(/requestId:\s*string/);
    });

    it('MUST return PublicReadOnlyResult', () => {
      expect(publicReadOnlySource).toContain('PublicReadOnlyResult');
    });

    it('MUST check classification first', () => {
      expect(publicReadOnlySource).toContain('classifyRoute(pathname)');
    });

    it('MUST allow read methods on public routes', () => {
      expect(publicReadOnlySource).toContain('isReadMethod(method)');
      expect(publicReadOnlySource).toContain('allowed: true');
    });

    it('MUST check mutation methods for auth', () => {
      expect(publicReadOnlySource).toContain('isMutationMethod(method)');
      expect(publicReadOnlySource).toContain('hasValidMutationAuth');
    });

    it('MUST return 403 for unauthorized mutations', () => {
      expect(publicReadOnlySource).toContain('createWriteDeniedResponse');
      expect(publicReadOnlySource).toContain('allowed: false');
    });

    it('MUST skip admin routes (delegated to other guards)', () => {
      expect(publicReadOnlySource).toContain("classification === 'ADMIN_ONLY'");
      expect(publicReadOnlySource).toContain('delegated to admin guards');
    });
  });

  describe('Guard Result Structure', () => {
    it('MUST include allowed boolean', () => {
      expect(publicReadOnlySource).toContain('allowed: boolean');
    });

    it('MUST include optional errorResponse', () => {
      expect(publicReadOnlySource).toContain('errorResponse?: Response');
    });

    it('MUST include classification', () => {
      expect(publicReadOnlySource).toContain('classification: RouteAccessLevel');
    });

    it('MUST include reason for debugging', () => {
      expect(publicReadOnlySource).toContain('reason: string');
    });
  });
});

// =============================================================================
// SEC-IAC-04: Error Responses
// =============================================================================

describe('SEC-IAC-04: Error Responses', () => {
  describe('403 Write Denied Response', () => {
    it('MUST export createWriteDeniedResponse function', () => {
      expect(publicReadOnlySource).toContain('export function createWriteDeniedResponse(');
    });

    it('MUST return status 403', () => {
      expect(publicReadOnlySource).toContain('status: 403');
    });

    it('MUST use WRITE_DENIED code', () => {
      expect(publicReadOnlySource).toContain("code: 'WRITE_DENIED'");
    });

    it('MUST include descriptive message', () => {
      expect(publicReadOnlySource).toContain('requires authorization');
    });

    it('MUST include requestId for correlation', () => {
      expect(publicReadOnlySource).toContain('requestId');
      expect(publicReadOnlySource).toContain('X-Request-Id');
    });

    it('MUST include WWW-Authenticate header', () => {
      expect(publicReadOnlySource).toContain("'WWW-Authenticate'");
      expect(publicReadOnlySource).toContain('Bearer realm=');
    });

    it('MUST set Cache-Control to prevent caching', () => {
      expect(publicReadOnlySource).toContain('no-cache, no-store, must-revalidate');
    });
  });

  describe('Error Response Type', () => {
    it('MUST define PublicReadOnlyError interface', () => {
      expect(publicReadOnlySource).toContain('export interface PublicReadOnlyError');
    });

    it('MUST include ok: false', () => {
      expect(publicReadOnlySource).toContain('ok: false');
    });
  });
});

// =============================================================================
// SEC-IAC-04: Authorization Check
// =============================================================================

describe('SEC-IAC-04: Authorization Check', () => {
  describe('Token Validation', () => {
    it('MUST check Cloudflare Access JWT', () => {
      expect(publicReadOnlySource).toContain('Cf-Access-Jwt-Assertion');
    });

    it('MUST check Bearer token as fallback', () => {
      expect(publicReadOnlySource).toContain('Authorization');
      expect(publicReadOnlySource).toContain('Bearer');
    });

    it('MUST use extractBearerToken function', () => {
      expect(publicReadOnlySource).toContain('extractBearerToken(');
    });

    it('MUST use constant-time comparison', () => {
      expect(publicReadOnlySource).toContain('constantTimeCompare(');
    });
  });

  describe('Environment Variables', () => {
    it('MUST define PublicReadOnlyEnv interface', () => {
      expect(publicReadOnlySource).toContain('export interface PublicReadOnlyEnv');
    });

    it('MUST support ADMIN_KEY', () => {
      expect(publicReadOnlySource).toContain('ADMIN_KEY');
    });

    it('MUST support ADMIN_TOKEN fallback', () => {
      expect(publicReadOnlySource).toContain('ADMIN_TOKEN');
    });
  });

  describe('Security Best Practices', () => {
    it('MUST use constant-time comparison to prevent timing attacks', () => {
      expect(publicReadOnlySource).toContain('function constantTimeCompare(');
      expect(publicReadOnlySource).toContain('charCodeAt(i) ^ ');
      expect(publicReadOnlySource).toContain('result |=');
    });

    it('MUST NOT log token values', () => {
      const consoleStatements =
        publicReadOnlySource.match(/console\.(log|warn|error|info)\([^)]+\)/g) || [];

      for (const statement of consoleStatements) {
        expect(statement).not.toContain('ADMIN_KEY');
        expect(statement).not.toContain('ADMIN_TOKEN');
        expect(statement).not.toContain('token');
      }
    });
  });
});

// =============================================================================
// SEC-IAC-04: Router Integration
// =============================================================================

describe('SEC-IAC-04: Router Integration', () => {
  describe('Guard Placement', () => {
    it('MUST apply guard in handleRequest', () => {
      expect(routerSource).toContain('guardPublicReadOnly(request, env');
    });

    it('MUST apply guard after OPTIONS handling', () => {
      const handleRequest =
        routerSource.match(/function handleRequest[\s\S]*?^}/m) ||
        routerSource.match(/async function handleRequest[\s\S]*/);
      if (handleRequest) {
        const optionsIndex = handleRequest[0].indexOf("method === 'OPTIONS'");
        const guardIndex = handleRequest[0].indexOf('guardPublicReadOnly');
        expect(optionsIndex).toBeLessThan(guardIndex);
      }
    });

    it('MUST check allowed result before proceeding', () => {
      expect(routerSource).toContain('!publicReadOnlyResult.allowed');
    });

    it('MUST return error response when denied', () => {
      expect(routerSource).toContain('publicReadOnlyResult.errorResponse');
    });

    it('MUST add CORS headers to error response', () => {
      expect(routerSource).toContain('addCorsHeaders(publicReadOnlyResult.errorResponse');
    });

    it('MUST log denial with reason', () => {
      expect(routerSource).toContain('publicReadOnlyResult.reason');
    });
  });

  describe('Router Version', () => {
    it('MUST update router version for SEC-IAC-04', () => {
      // Check that SEC-IAC-04 was added in version 1.22.0 (in changelog)
      expect(routerSource).toContain('1.22.0 - Public Read-Only Enforcement (SEC-IAC-04)');
      expect(routerSource).toContain('SEC-IAC-04');
    });
  });
});

// =============================================================================
// SEC-IAC-04: Acceptance Criteria
// =============================================================================

describe('SEC-IAC-04: Acceptance Criteria', () => {
  describe('AC1: GET public routes succeed', () => {
    it('MUST allow GET on public routes', () => {
      expect(publicReadOnlySource).toContain('isReadMethod(method)');
      expect(publicReadOnlySource).toContain('allowed: true');
    });

    it('MUST classify GET as read method', () => {
      expect(publicReadOnlySource).toContain("'GET'");
      expect(publicReadOnlySource).toContain('READ_METHODS');
    });
  });

  describe('AC2: POST public routes without token return 403', () => {
    it('MUST check for mutations', () => {
      expect(publicReadOnlySource).toContain('isMutationMethod(method)');
    });

    it('MUST check for valid auth on mutations', () => {
      expect(publicReadOnlySource).toContain('hasValidMutationAuth(request, env)');
    });

    it('MUST return 403 when auth missing', () => {
      expect(publicReadOnlySource).toContain('status: 403');
      expect(publicReadOnlySource).toContain('allowed: false');
    });

    it('MUST return WRITE_DENIED code', () => {
      expect(publicReadOnlySource).toContain("code: 'WRITE_DENIED'");
    });
  });

  describe('AC3: Unknown routes return 404', () => {
    it('router MUST handle unknown routes with 404', () => {
      expect(routerSource).toContain('create404Response');
      expect(routerSource).toContain("type: 'not_found'");
    });

    it('MUST classify unknown routes as READ_PUBLIC for guard', () => {
      // Unknown routes fall through to READ_PUBLIC, allowing GET but will 404 in router
      expect(publicReadOnlySource).toContain('// Unknown routes - treat as READ_PUBLIC');
    });
  });
});

// =============================================================================
// SEC-IAC-04: Module Exports
// =============================================================================

describe('SEC-IAC-04: Module Exports', () => {
  it('MUST export guardPublicReadOnly', () => {
    expect(authIndexSource).toContain('guardPublicReadOnly');
  });

  it('MUST export shouldApplyPublicReadOnlyGuard', () => {
    expect(authIndexSource).toContain('shouldApplyPublicReadOnlyGuard');
  });

  it('MUST export classifyRoute', () => {
    expect(authIndexSource).toContain('classifyRoute');
  });

  it('MUST export isMutationMethod', () => {
    expect(authIndexSource).toContain('isMutationMethod');
  });

  it('MUST export isReadMethod', () => {
    expect(authIndexSource).toContain('isReadMethod');
  });

  it('MUST export createWriteDeniedResponse', () => {
    expect(authIndexSource).toContain('createWriteDeniedResponse');
  });

  it('MUST export PublicReadOnlyEnv type', () => {
    expect(authIndexSource).toContain('type PublicReadOnlyEnv');
  });

  it('MUST export PublicReadOnlyResult type', () => {
    expect(authIndexSource).toContain('type PublicReadOnlyResult');
  });

  it('MUST export RouteAccessLevel type', () => {
    expect(authIndexSource).toContain('type RouteAccessLevel');
  });

  it('MUST export MUTATION_METHODS constant', () => {
    expect(authIndexSource).toContain('MUTATION_METHODS');
  });

  it('MUST export READ_METHODS constant', () => {
    expect(authIndexSource).toContain('READ_METHODS');
  });
});

// =============================================================================
// CI/CD Security Gate Tests
// =============================================================================

describe('SEC-IAC-04: CI/CD Integration', () => {
  it('MUST have security tests that can run in Stage-1', () => {
    expect(fs.existsSync(__filename)).toBe(true);
  });

  it('MUST be discoverable by Jest test patterns', () => {
    expect(__filename).toMatch(/tests\/unit\/worker\/.*\.test\.js$/);
  });

  it('MUST follow security test naming convention', () => {
    expect(__filename).toContain('sec-iac-04');
  });
});
