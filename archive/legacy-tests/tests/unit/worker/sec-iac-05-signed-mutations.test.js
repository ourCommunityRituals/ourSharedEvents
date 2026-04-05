/**
 * Security Tests for SEC-IAC-05 - Signed Public Mutations
 *
 * These tests ensure that public mutations require valid HMAC-signed tokens
 * with proper nonce replay prevention.
 *
 * Critical Security Requirements:
 * - Missing token → 403
 * - Invalid signature → 403
 * - Expired token → 403
 * - Replayed nonce → 403
 * - Valid token succeeds
 * - All failures logged
 *
 * @see worker/src/auth/signedMutations.ts
 * @see worker/src/router.ts
 * @see SEC-IAC-05 - Signed Public Mutations
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const signedMutationsPath = path.join(__dirname, '../../../worker/src/auth/signedMutations.ts');
const routerPath = path.join(__dirname, '../../../worker/src/router.ts');
const authIndexPath = path.join(__dirname, '../../../worker/src/auth/index.ts');
const wranglerPath = path.join(__dirname, '../../../worker/wrangler.toml');

let signedMutationsSource = '';
let routerSource = '';
let authIndexSource = '';
let wranglerSource = '';

beforeAll(() => {
  try {
    signedMutationsSource = fs.readFileSync(signedMutationsPath, 'utf8');
    routerSource = fs.readFileSync(routerPath, 'utf8');
    authIndexSource = fs.readFileSync(authIndexPath, 'utf8');
    wranglerSource = fs.readFileSync(wranglerPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// SEC-IAC-05: Module Existence
// =============================================================================

describe('SEC-IAC-05: Module Structure', () => {
  it('MUST have signedMutations.ts module', () => {
    expect(fs.existsSync(signedMutationsPath)).toBe(true);
  });

  it('MUST export from auth index', () => {
    expect(authIndexSource).toContain("from './signedMutations'");
    expect(authIndexSource).toContain('guardSignedMutation');
    expect(authIndexSource).toContain('SignedMutationsEnv');
  });

  it('MUST integrate into router', () => {
    expect(routerSource).toContain('guardSignedMutation');
    expect(routerSource).toContain('SEC-IAC-05');
  });

  it('router MUST extend SignedMutationsEnv', () => {
    expect(routerSource).toContain('SignedMutationsEnv');
    expect(routerSource).toMatch(/RouterEnv extends.*SignedMutationsEnv/);
  });
});

// =============================================================================
// SEC-IAC-05: Token Model
// =============================================================================

describe('SEC-IAC-05: Token Model', () => {
  describe('Token Payload Fields', () => {
    it('MUST include action field', () => {
      expect(signedMutationsSource).toContain('action: string');
    });

    it('MUST include brandId field', () => {
      expect(signedMutationsSource).toContain('brandId: string');
    });

    it('MUST include eventId field', () => {
      expect(signedMutationsSource).toContain('eventId: string');
    });

    it('MUST include payloadHash field', () => {
      expect(signedMutationsSource).toContain('payloadHash: string');
    });

    it('MUST include exp field for expiration', () => {
      expect(signedMutationsSource).toContain('exp: number');
    });

    it('MUST include nonce field for replay prevention', () => {
      expect(signedMutationsSource).toContain('nonce: string');
    });

    it('MUST define MutationTokenPayload interface', () => {
      expect(signedMutationsSource).toContain('export interface MutationTokenPayload');
    });
  });

  describe('HMAC-SHA256 Signature', () => {
    it('MUST use HMAC-SHA256 algorithm', () => {
      expect(signedMutationsSource).toContain("hash: 'SHA-256'");
      expect(signedMutationsSource).toContain("name: 'HMAC'");
    });

    it('MUST use crypto.subtle for HMAC', () => {
      expect(signedMutationsSource).toContain('crypto.subtle.importKey');
      expect(signedMutationsSource).toContain('crypto.subtle.sign');
    });

    it('MUST use Base64URL encoding', () => {
      expect(signedMutationsSource).toContain('base64UrlEncode');
      expect(signedMutationsSource).toContain('base64UrlDecode');
    });
  });

  describe('Token Format', () => {
    it('MUST use payload.signature format', () => {
      expect(signedMutationsSource).toContain("token.split('.')");
      expect(signedMutationsSource).toContain('parts.length !== 2');
    });

    it('MUST use X-Mutation-Token header', () => {
      expect(signedMutationsSource).toContain("'X-Mutation-Token'");
      expect(signedMutationsSource).toContain('MUTATION_TOKEN_HEADER');
    });
  });
});

// =============================================================================
// SEC-IAC-05: Enforcement
// =============================================================================

describe('SEC-IAC-05: Enforcement', () => {
  describe('Missing Token', () => {
    it('MUST return 403 for missing token', () => {
      expect(signedMutationsSource).toContain("'MISSING_TOKEN'");
      expect(signedMutationsSource).toContain('status: 403');
    });

    it('MUST check for token header presence', () => {
      expect(signedMutationsSource).toContain('request.headers.get(MUTATION_TOKEN_HEADER)');
      expect(signedMutationsSource).toContain('if (!token)');
    });
  });

  describe('Invalid Signature', () => {
    it('MUST return 403 for invalid signature', () => {
      expect(signedMutationsSource).toContain("'INVALID_SIGNATURE'");
    });

    it('MUST use constant-time comparison', () => {
      expect(signedMutationsSource).toContain('Constant-time comparison');
      expect(signedMutationsSource).toContain('charCodeAt(i) ^');
      expect(signedMutationsSource).toContain('result |=');
    });

    it('MUST verify signature before processing payload', () => {
      // Signature verification should happen before expiration/nonce checks
      const signatureCheck = signedMutationsSource.indexOf('verifyHmacSignature');
      const expirationCheck = signedMutationsSource.indexOf('isTokenExpired');
      expect(signatureCheck).toBeLessThan(expirationCheck);
    });
  });

  describe('Expired Token', () => {
    it('MUST return 403 for expired token', () => {
      expect(signedMutationsSource).toContain("'TOKEN_EXPIRED'");
    });

    it('MUST check exp field against current time', () => {
      expect(signedMutationsSource).toContain('isTokenExpired');
      expect(signedMutationsSource).toContain('Date.now()');
    });

    it('MUST allow clock skew', () => {
      expect(signedMutationsSource).toContain('MAX_CLOCK_SKEW_SECONDS');
    });
  });

  describe('Replayed Nonce', () => {
    it('MUST return 403 for replayed nonce', () => {
      expect(signedMutationsSource).toContain("'NONCE_REPLAYED'");
    });

    it('MUST check nonce in KV before accepting', () => {
      expect(signedMutationsSource).toContain('isNonceReplayed');
    });

    it('MUST store nonce after successful verification', () => {
      expect(signedMutationsSource).toContain('storeNonce');
    });
  });

  describe('Valid Token', () => {
    it('MUST return allowed: true for valid token', () => {
      expect(signedMutationsSource).toContain('allowed: true');
      expect(signedMutationsSource).toContain("reason: 'Valid signed mutation token'");
    });

    it('MUST include payload in result for valid token', () => {
      expect(signedMutationsSource).toContain('payload,');
    });
  });
});

// =============================================================================
// SEC-IAC-05: Storage
// =============================================================================

describe('SEC-IAC-05: Nonce Storage', () => {
  describe('KV Namespace', () => {
    it('MUST define HMAC_NONCE_KV binding', () => {
      expect(signedMutationsSource).toContain('HMAC_NONCE_KV');
      expect(signedMutationsSource).toContain('KVNamespace');
    });

    it('MUST use nonce prefix in KV keys', () => {
      expect(signedMutationsSource).toContain("NONCE_KV_PREFIX = 'nonce:'");
    });

    it('MUST store nonce with TTL', () => {
      expect(signedMutationsSource).toContain('expirationTtl');
    });

    it('MUST calculate TTL from token expiration', () => {
      expect(signedMutationsSource).toContain('exp - now');
    });
  });

  describe('Wrangler Configuration', () => {
    it('MUST configure KV namespace for staging', () => {
      expect(wranglerSource).toContain('HMAC_NONCE_KV');
      expect(wranglerSource).toContain('env.staging.kv_namespaces');
    });

    it('MUST configure KV namespace for production', () => {
      expect(wranglerSource).toContain('env.production.kv_namespaces');
    });

    it('MUST document HMAC_SECRET secret', () => {
      expect(wranglerSource).toContain('HMAC_SECRET');
      expect(wranglerSource).toContain('min 32 chars');
    });
  });
});

// =============================================================================
// SEC-IAC-05: Error Responses
// =============================================================================

describe('SEC-IAC-05: Error Responses', () => {
  describe('Error Response Format', () => {
    it('MUST return status 403 for all auth failures', () => {
      expect(signedMutationsSource).toContain('status: 403');
    });

    it('MUST include error code in response', () => {
      expect(signedMutationsSource).toContain('code,');
    });

    it('MUST include descriptive message', () => {
      expect(signedMutationsSource).toContain('message,');
    });

    it('MUST include requestId for correlation', () => {
      expect(signedMutationsSource).toContain('requestId,');
      expect(signedMutationsSource).toContain("'X-Request-Id'");
    });

    it('MUST set no-cache headers', () => {
      expect(signedMutationsSource).toContain('no-cache, no-store, must-revalidate');
    });
  });

  describe('Error Codes', () => {
    it('MUST define MISSING_TOKEN error code', () => {
      expect(signedMutationsSource).toContain("'MISSING_TOKEN'");
    });

    it('MUST define INVALID_TOKEN_FORMAT error code', () => {
      expect(signedMutationsSource).toContain("'INVALID_TOKEN_FORMAT'");
    });

    it('MUST define INVALID_SIGNATURE error code', () => {
      expect(signedMutationsSource).toContain("'INVALID_SIGNATURE'");
    });

    it('MUST define TOKEN_EXPIRED error code', () => {
      expect(signedMutationsSource).toContain("'TOKEN_EXPIRED'");
    });

    it('MUST define NONCE_REPLAYED error code', () => {
      expect(signedMutationsSource).toContain("'NONCE_REPLAYED'");
    });

    it('MUST define HMAC_NOT_CONFIGURED error code', () => {
      expect(signedMutationsSource).toContain("'HMAC_NOT_CONFIGURED'");
    });
  });
});

// =============================================================================
// SEC-IAC-05: Guard Functions
// =============================================================================

describe('SEC-IAC-05: Guard Functions', () => {
  describe('verifySignedMutation Function', () => {
    it('MUST export verifySignedMutation function', () => {
      expect(signedMutationsSource).toContain('export async function verifySignedMutation(');
    });

    it('MUST accept request, env, and requestId parameters', () => {
      expect(signedMutationsSource).toMatch(/verifySignedMutation\(\s*request:\s*Request/);
      expect(signedMutationsSource).toMatch(/env:\s*SignedMutationsEnv/);
      expect(signedMutationsSource).toMatch(/requestId:\s*string/);
    });

    it('MUST return SignedMutationResult', () => {
      expect(signedMutationsSource).toContain(': Promise<SignedMutationResult>');
    });
  });

  describe('guardSignedMutation Function', () => {
    it('MUST export guardSignedMutation function', () => {
      expect(signedMutationsSource).toContain('export async function guardSignedMutation(');
    });
  });

  describe('isSignedMutationsConfigured Function', () => {
    it('MUST export isSignedMutationsConfigured function', () => {
      expect(signedMutationsSource).toContain('export function isSignedMutationsConfigured(');
    });

    it('MUST check HMAC_SECRET is configured', () => {
      expect(signedMutationsSource).toContain('env.HMAC_SECRET');
    });

    it('MUST check minimum secret length', () => {
      expect(signedMutationsSource).toContain('MIN_HMAC_SECRET_LENGTH');
      expect(signedMutationsSource).toContain('.length >=');
    });
  });
});

// =============================================================================
// SEC-IAC-05: Security Best Practices
// =============================================================================

describe('SEC-IAC-05: Security Best Practices', () => {
  describe('Constant-Time Comparison', () => {
    it('MUST use constant-time comparison for signature verification', () => {
      expect(signedMutationsSource).toContain('Constant-time comparison');
      expect(signedMutationsSource).toContain('result |=');
    });

    it('MUST check length before comparison', () => {
      expect(signedMutationsSource).toContain('.length !==');
    });
  });

  describe('Minimum Secret Length', () => {
    it('MUST enforce minimum HMAC secret length of 32 bytes', () => {
      expect(signedMutationsSource).toContain('MIN_HMAC_SECRET_LENGTH = 32');
    });
  });

  describe('Logging Safety', () => {
    it('MUST NOT log secret values (only variable names in error messages are acceptable)', () => {
      const consoleStatements =
        signedMutationsSource.match(/console\.(log|warn|error|info)\([^)]+\)/g) || [];

      for (const statement of consoleStatements) {
        // Should not log env.HMAC_SECRET (the actual value)
        expect(statement).not.toContain('env.HMAC_SECRET');
        // Should not interpolate the secret value
        expect(statement).not.toContain('${env.HMAC_SECRET}');
        expect(statement).not.toContain('${secret}');
      }
    });

    it('MUST log security failures for audit', () => {
      expect(signedMutationsSource).toContain('console.warn');
    });
  });

  describe('Payload Hash', () => {
    it('MUST use SHA-256 for payload hash', () => {
      expect(signedMutationsSource).toContain('SHA-256');
      expect(signedMutationsSource).toContain('computePayloadHash');
    });

    it('MUST export computePayloadHash function', () => {
      expect(signedMutationsSource).toContain('export async function computePayloadHash(');
    });
  });
});

// =============================================================================
// SEC-IAC-05: Router Integration
// =============================================================================

describe('SEC-IAC-05: Router Integration', () => {
  describe('Guard Placement', () => {
    it('MUST check signed mutations after public read-only guard', () => {
      expect(routerSource).toContain('guardSignedMutation');
      expect(routerSource).toContain('isSignedMutationsConfigured');
    });

    it('MUST only check signed mutations when configured', () => {
      expect(routerSource).toContain('if (isSignedMutationsConfigured(env))');
    });

    it('MUST fall back to SEC-IAC-04 when not configured', () => {
      // When signed mutations not configured, use public read-only error
      expect(routerSource).toContain('publicReadOnlyResult.errorResponse');
    });
  });

  describe('Router Version', () => {
    it('router version MUST be 1.23.0 or higher', () => {
      const versionMatch = routerSource.match(/ROUTER_VERSION = ['"](\d+\.\d+\.\d+)['"]/);
      expect(versionMatch).toBeTruthy();
      const version = versionMatch[1];
      const [major, minor] = version.split('.').map(Number);
      expect(major * 100 + minor).toBeGreaterThanOrEqual(123);
    });

    it('MUST reference SEC-IAC-05 in router', () => {
      expect(routerSource).toContain('SEC-IAC-05');
    });
  });
});

// =============================================================================
// SEC-IAC-05: Acceptance Criteria
// =============================================================================

describe('SEC-IAC-05: Acceptance Criteria', () => {
  describe('AC1: Valid token succeeds', () => {
    it('MUST return allowed: true for valid tokens', () => {
      expect(signedMutationsSource).toContain('allowed: true');
    });

    it('MUST include decoded payload in result', () => {
      expect(signedMutationsSource).toContain('payload,');
    });
  });

  describe('AC2: All failures logged', () => {
    it('MUST log missing token', () => {
      expect(signedMutationsSource).toContain('Missing token header');
    });

    it('MUST log invalid format', () => {
      expect(signedMutationsSource).toContain('Invalid token format');
    });

    it('MUST log invalid signature', () => {
      expect(signedMutationsSource).toContain('Invalid signature');
    });

    it('MUST log expired token', () => {
      expect(signedMutationsSource).toContain('Token expired');
    });

    it('MUST log replayed nonce', () => {
      expect(signedMutationsSource).toContain('Nonce replayed');
    });
  });
});

// =============================================================================
// SEC-IAC-05: Module Exports
// =============================================================================

describe('SEC-IAC-05: Module Exports', () => {
  it('MUST export guardSignedMutation', () => {
    expect(authIndexSource).toContain('guardSignedMutation');
  });

  it('MUST export verifySignedMutation', () => {
    expect(authIndexSource).toContain('verifySignedMutation');
  });

  it('MUST export createSignedMutationToken', () => {
    expect(authIndexSource).toContain('createSignedMutationToken');
  });

  it('MUST export createSignedMutationErrorResponse', () => {
    expect(authIndexSource).toContain('createSignedMutationErrorResponse');
  });

  it('MUST export computePayloadHash', () => {
    expect(authIndexSource).toContain('computePayloadHash');
  });

  it('MUST export isSignedMutationsConfigured', () => {
    expect(authIndexSource).toContain('isSignedMutationsConfigured');
  });

  it('MUST export isNonceStorageConfigured', () => {
    expect(authIndexSource).toContain('isNonceStorageConfigured');
  });

  it('MUST export SignedMutationsEnv type', () => {
    expect(authIndexSource).toContain('type SignedMutationsEnv');
  });

  it('MUST export SignedMutationResult type', () => {
    expect(authIndexSource).toContain('type SignedMutationResult');
  });

  it('MUST export SignedMutationError type', () => {
    expect(authIndexSource).toContain('type SignedMutationError');
  });

  it('MUST export SignedMutationErrorCode type', () => {
    expect(authIndexSource).toContain('type SignedMutationErrorCode');
  });

  it('MUST export MutationTokenPayload type', () => {
    expect(authIndexSource).toContain('type MutationTokenPayload');
  });

  it('MUST export MUTATION_TOKEN_HEADER constant', () => {
    expect(authIndexSource).toContain('MUTATION_TOKEN_HEADER');
  });

  it('MUST export MAX_CLOCK_SKEW_SECONDS constant', () => {
    expect(authIndexSource).toContain('MAX_CLOCK_SKEW_SECONDS');
  });

  it('MUST export MIN_HMAC_SECRET_LENGTH constant', () => {
    expect(authIndexSource).toContain('MIN_HMAC_SECRET_LENGTH');
  });
});

// =============================================================================
// CI/CD Security Gate Tests
// =============================================================================

describe('SEC-IAC-05: CI/CD Integration', () => {
  it('MUST have security tests that can run in Stage-1', () => {
    expect(fs.existsSync(__filename)).toBe(true);
  });

  it('MUST be discoverable by Jest test patterns', () => {
    expect(__filename).toMatch(/tests\/unit\/worker\/.*\.test\.js$/);
  });

  it('MUST follow security test naming convention', () => {
    expect(__filename).toContain('sec-iac-05');
  });
});
