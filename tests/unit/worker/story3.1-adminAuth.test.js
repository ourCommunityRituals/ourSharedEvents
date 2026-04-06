/**
 * Unit Tests for Story 3.1 - Admin Authentication
 *
 * Source-reading tests that validate the admin auth module structure,
 * CF Access JWT support, Bearer token fallback, constant-time comparison,
 * and 401 response format.
 *
 * @see workers/oursharedevents/src/auth/admin.ts
 * @see workers/oursharedevents/src/router.ts (auth integration)
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const adminAuthPath = path.join(__dirname, '../../../workers/oursharedevents/src/auth/admin.ts');
const routerPath = path.join(__dirname, '../../../workers/oursharedevents/src/router.ts');

let adminAuthSource = '';
let routerSource = '';

beforeAll(() => {
  try {
    adminAuthSource = fs.readFileSync(adminAuthPath, 'utf8');
    routerSource = fs.readFileSync(routerPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Module Structure
// =============================================================================

describe('Admin Auth Module Structure (Story 3.1)', () => {
  describe('Source File Exists', () => {
    it('auth/admin.ts exists and has content', () => {
      expect(adminAuthSource.length).toBeGreaterThan(0);
    });
  });

  describe('Module Exports', () => {
    it('should export requireAdmin function', () => {
      expect(adminAuthSource).toContain('export function requireAdmin(');
    });

    it('should export AdminEnv interface', () => {
      expect(adminAuthSource).toContain('export interface AdminEnv');
    });

    it('requireAdmin should accept request, env, requestId', () => {
      expect(adminAuthSource).toContain('request: Request');
      expect(adminAuthSource).toContain('env: AdminEnv');
      expect(adminAuthSource).toContain('requestId: string');
    });

    it('requireAdmin should return Response | null', () => {
      expect(adminAuthSource).toContain('Response | null');
    });
  });

  describe('AdminEnv Interface', () => {
    it('should include ADMIN_KEY', () => {
      expect(adminAuthSource).toContain('ADMIN_KEY?: string');
    });

    it('should include ADMIN_TOKEN as legacy alias', () => {
      expect(adminAuthSource).toContain('ADMIN_TOKEN?: string');
      expect(adminAuthSource).toContain('legacy alias');
    });

    it('should include ALLOW_ADMIN_KEY_FALLBACK', () => {
      expect(adminAuthSource).toContain('ALLOW_ADMIN_KEY_FALLBACK?: string');
    });
  });
});

// =============================================================================
// Authentication Methods
// =============================================================================

describe('Authentication Methods (Story 3.1)', () => {
  describe('Method 1: Cloudflare Access JWT', () => {
    it('should check Cf-Access-Jwt-Assertion header', () => {
      expect(adminAuthSource).toContain("'Cf-Access-Jwt-Assertion'");
    });

    it('should decode JWT with decodeCfAccessJwt', () => {
      expect(adminAuthSource).toContain('decodeCfAccessJwt');
    });

    it('should validate 3-part JWT structure', () => {
      expect(adminAuthSource).toContain("jwt.split('.')");
      expect(adminAuthSource).toContain('parts.length !== 3');
    });

    it('should check expiration (exp > now)', () => {
      expect(adminAuthSource).toContain('payload.exp');
      expect(adminAuthSource).toContain('Math.floor(Date.now() / 1000)');
    });

    it('should handle base64url decoding', () => {
      expect(adminAuthSource).toContain('atob');
      expect(adminAuthSource).toContain("replace(/-/g, '+')");
      expect(adminAuthSource).toContain("replace(/_/g, '/')");
    });

    it('should return null (allow) on valid JWT', () => {
      expect(adminAuthSource).toContain('if (cfJwt && decodeCfAccessJwt(cfJwt)) return null');
    });
  });

  describe('Method 2: Bearer Token Fallback', () => {
    it('should only allow fallback when ALLOW_ADMIN_KEY_FALLBACK is true', () => {
      expect(adminAuthSource).toContain("env.ALLOW_ADMIN_KEY_FALLBACK === 'true'");
    });

    it('should extract Bearer token from Authorization header', () => {
      expect(adminAuthSource).toContain('extractBearer');
      expect(adminAuthSource).toContain("'Authorization'");
    });

    it('should use regex to extract Bearer token', () => {
      expect(adminAuthSource).toContain('/^Bearer\\s+(.+)$/i');
    });

    it('should get admin key with legacy alias support', () => {
      expect(adminAuthSource).toContain('getAdminKey(env)');
      expect(adminAuthSource).toContain('env.ADMIN_KEY?.trim()');
      expect(adminAuthSource).toContain('env.ADMIN_TOKEN?.trim()');
    });

    it('should return null (allow) on valid token match', () => {
      expect(adminAuthSource).toContain(
        'if (key && token && constantTimeEqual(token, key)) return null'
      );
    });
  });
});

// =============================================================================
// Security Properties
// =============================================================================

describe('Security Properties (Story 3.1)', () => {
  describe('Constant-Time Comparison', () => {
    it('should implement constantTimeEqual function', () => {
      expect(adminAuthSource).toContain('function constantTimeEqual(');
    });

    it('should check length equality first', () => {
      expect(adminAuthSource).toContain('a.length !== b.length');
    });

    it('should use XOR for byte comparison', () => {
      expect(adminAuthSource).toContain('a.charCodeAt(i) ^ b.charCodeAt(i)');
    });

    it('should use OR accumulator to prevent timing leaks', () => {
      expect(adminAuthSource).toContain('diff |=');
    });

    it('should compare accumulated diff to zero', () => {
      expect(adminAuthSource).toContain('return diff === 0');
    });
  });

  describe('401 Response Format', () => {
    it('should return HTTP 401 status', () => {
      expect(adminAuthSource).toContain('status: 401');
    });

    it('should include UNAUTH error code', () => {
      expect(adminAuthSource).toContain("code: 'UNAUTH'");
    });

    it('should include requestId in response body', () => {
      expect(adminAuthSource).toContain('requestId }');
    });

    it('should set WWW-Authenticate header with Bearer realm', () => {
      expect(adminAuthSource).toContain(
        "'WWW-Authenticate': 'Bearer realm=\"OurSharedEvents Admin\"'"
      );
    });

    it('should set Content-Type to application/json', () => {
      expect(adminAuthSource).toContain("'Content-Type': 'application/json'");
    });

    it('should set X-Request-Id header', () => {
      expect(adminAuthSource).toContain("'X-Request-Id': requestId");
    });

    it('should return ok: false in response body', () => {
      expect(adminAuthSource).toContain('ok: false');
    });
  });

  describe('JWT Error Handling', () => {
    it('should catch JWT decode errors gracefully', () => {
      expect(adminAuthSource).toContain('} catch {');
      expect(adminAuthSource).toContain('return false');
    });

    it('should reject JWTs without exp or iat claims', () => {
      expect(adminAuthSource).toContain('!payload.exp');
      expect(adminAuthSource).toContain('!payload.iat');
    });
  });
});

// =============================================================================
// Router Integration
// =============================================================================

describe('Router Integration (Story 3.1)', () => {
  it('router should import requireAdmin from auth/admin', () => {
    expect(routerSource).toContain('requireAdmin');
    expect(routerSource).toContain("from './auth/admin'");
  });

  it('router should import AdminEnv type', () => {
    expect(routerSource).toContain('type AdminEnv');
  });

  it('RouterEnv should include AdminEnv', () => {
    expect(routerSource).toContain('AdminEnv');
    expect(routerSource).toContain('export type RouterEnv');
  });

  it('admin routes should call requireAdmin before handler', () => {
    const adminBlock = routerSource.indexOf("pathname === '/admin'");
    const requireAdminAfter = routerSource.indexOf('requireAdmin(request, env,', adminBlock);
    const handleAdminAfter = routerSource.indexOf('handleAdminPage(env)', adminBlock);
    expect(requireAdminAfter).toBeLessThan(handleAdminAfter);
  });

  it('should generate request IDs for auth calls', () => {
    expect(routerSource).toContain('crypto.randomUUID');
  });

  it('should return deny response when auth fails', () => {
    expect(routerSource).toContain('if (deny) return deny');
  });
});
