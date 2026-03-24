/**
 * Admin Authentication Module
 *
 * Centralized authentication for admin API endpoints.
 * Replaces GAS's "execute as user" permission model with explicit API auth.
 *
 * Phase 1: Shared admin API token (ADMIN_TOKEN in Cloudflare secrets)
 * Phase 2 (future): Scoped keys, per-venue keys, JWT tokens, role-based access
 *
 * Usage:
 *   1. Configure ADMIN_TOKEN as a Cloudflare secret:
 *      wrangler secret put ADMIN_TOKEN
 *
 *   2. Clients send token via Authorization header:
 *      Authorization: Bearer <ADMIN_TOKEN>
 *
 *   3. Use requireAdminAuth() middleware in admin handlers
 *
 * Security Notes:
 *   - Token is validated using constant-time comparison to prevent timing attacks
 *   - All admin endpoints MUST use this middleware
 *   - Token should be rotated periodically
 *   - Never log tokens (even in error messages)
 *
 * @module auth/adminAuth
 * @see Story 3.1 - Define Admin Auth Model for Worker API
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for admin authentication
 */
export interface AdminAuthEnv {
  /**
   * Admin API token configured as Cloudflare secret.
   * Required for production; optional for dev mode.
   */
  ADMIN_TOKEN?: string;

  /**
   * Worker environment (staging/production).
   * Used to determine strictness of auth requirements.
   */
  WORKER_ENV?: string;
}

/**
 * Authentication result with context
 */
export interface AuthResult {
  /** Whether authentication succeeded */
  authenticated: boolean;
  /** Error message if failed (null if success) */
  error: string | null;
  /** Machine-readable error code if failed */
  errorCode: AuthErrorCode | null;
  /** Auth context if succeeded (null if failed) */
  context: AuthContext | null;
}

/**
 * Authentication context for successful auth
 */
export interface AuthContext {
  /** Role of the authenticated user */
  role: 'admin';
  /** Method used for authentication */
  authMethod: 'bearer_token' | 'query_param';
  /** Timestamp of authentication */
  authenticatedAt: string;
}

/**
 * Error codes for authentication failures
 */
export type AuthErrorCode =
  | 'UNAUTHORIZED'
  | 'NOT_CONFIGURED'
  | 'INVALID_TOKEN'
  | 'MISSING_TOKEN';

/**
 * Admin authentication error response shape
 */
export interface AdminAuthErrorResponse {
  ok: false;
  code: AuthErrorCode;
  message: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Error messages for authentication failures
 */
export const AUTH_ERROR_MESSAGES = {
  UNAUTHORIZED: 'Missing or invalid authentication',
  NOT_CONFIGURED: 'Admin authentication not configured',
  INVALID_TOKEN: 'Invalid admin token',
  MISSING_TOKEN: 'Missing Authorization header or adminKey parameter',
} as const;

/**
 * HTTP status codes for auth responses
 */
export const AUTH_STATUS_CODES = {
  UNAUTHORIZED: 401,
  NOT_CONFIGURED: 503,
} as const;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Constant-time string comparison to prevent timing attacks
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Extract Bearer token from Authorization header
 *
 * @param header - Authorization header value
 * @returns Token string or null if invalid format
 */
function extractBearerToken(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

// =============================================================================
// Authentication Functions
// =============================================================================

/**
 * Check if admin authentication is configured
 *
 * @param env - Worker environment
 * @returns True if ADMIN_TOKEN is set
 */
export function isAuthConfigured(env: AdminAuthEnv): boolean {
  return Boolean(env.ADMIN_TOKEN && env.ADMIN_TOKEN.trim().length > 0);
}

/**
 * Check if request has valid admin authentication
 *
 * Supports two authentication methods:
 * 1. Bearer token: Authorization: Bearer <ADMIN_TOKEN>
 * 2. Query param: ?adminKey=<ADMIN_TOKEN> (legacy, for backward compatibility)
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @returns Authentication result
 */
export function checkAdminAuth(request: Request, env: AdminAuthEnv): AuthResult {
  // Check if admin token is configured
  if (!isAuthConfigured(env)) {
    // In development mode (no token configured), allow access with warning
    // In production, this should fail
    if (env.WORKER_ENV === 'production') {
      return {
        authenticated: false,
        error: AUTH_ERROR_MESSAGES.NOT_CONFIGURED,
        errorCode: 'NOT_CONFIGURED',
        context: null,
      };
    }

    // Dev mode: allow access but log warning
    console.warn('[AdminAuth] ADMIN_TOKEN not configured - allowing dev mode access');
    return {
      authenticated: true,
      error: null,
      errorCode: null,
      context: {
        role: 'admin',
        authMethod: 'bearer_token',
        authenticatedAt: new Date().toISOString(),
      },
    };
  }

  // Try Bearer token first (preferred method)
  const authHeader = request.headers.get('Authorization');
  const bearerToken = extractBearerToken(authHeader);

  if (bearerToken) {
    if (constantTimeCompare(bearerToken, env.ADMIN_TOKEN!)) {
      return {
        authenticated: true,
        error: null,
        errorCode: null,
        context: {
          role: 'admin',
          authMethod: 'bearer_token',
          authenticatedAt: new Date().toISOString(),
        },
      };
    } else {
      return {
        authenticated: false,
        error: AUTH_ERROR_MESSAGES.INVALID_TOKEN,
        errorCode: 'INVALID_TOKEN',
        context: null,
      };
    }
  }

  // Fall back to query param (legacy support)
  const url = new URL(request.url);
  const adminKey = url.searchParams.get('adminKey');

  if (adminKey) {
    if (constantTimeCompare(adminKey, env.ADMIN_TOKEN!)) {
      return {
        authenticated: true,
        error: null,
        errorCode: null,
        context: {
          role: 'admin',
          authMethod: 'query_param',
          authenticatedAt: new Date().toISOString(),
        },
      };
    } else {
      return {
        authenticated: false,
        error: AUTH_ERROR_MESSAGES.INVALID_TOKEN,
        errorCode: 'INVALID_TOKEN',
        context: null,
      };
    }
  }

  // No authentication provided
  return {
    authenticated: false,
    error: AUTH_ERROR_MESSAGES.MISSING_TOKEN,
    errorCode: 'MISSING_TOKEN',
    context: null,
  };
}

/**
 * Create error response for authentication failure
 *
 * @param result - Authentication result (must be failed)
 * @returns HTTP Response with appropriate status and headers
 */
export function createAuthErrorResponse(result: AuthResult): Response {
  const status =
    result.errorCode === 'NOT_CONFIGURED'
      ? AUTH_STATUS_CODES.NOT_CONFIGURED
      : AUTH_STATUS_CODES.UNAUTHORIZED;

  const body: AdminAuthErrorResponse = {
    ok: false,
    code: result.errorCode!,
    message: result.error!,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="EventAngle Admin API"',
    },
  });
}

/**
 * Require admin authentication middleware
 *
 * Use this in admin handlers to enforce authentication.
 * Returns null if auth succeeds, or an error Response if it fails.
 *
 * Example usage:
 *   const authError = requireAdminAuth(request, env);
 *   if (authError) return authError;
 *   // ... handle authenticated request
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @returns Error Response if auth fails, null if auth succeeds
 */
export function requireAdminAuth(
  request: Request,
  env: AdminAuthEnv
): Response | null {
  const result = checkAdminAuth(request, env);

  if (!result.authenticated) {
    return createAuthErrorResponse(result);
  }

  return null;
}

/**
 * Guard function for admin route protection
 *
 * Checks if a pathname matches an admin route pattern.
 * Use with requireAdminAuth to protect all admin endpoints.
 *
 * Admin routes:
 *   - /api/admin/*
 *   - /api/v2/admin/*
 *   - /api/events/:id/adminBundle
 *
 * @param pathname - URL pathname to check
 * @returns True if path requires admin authentication
 */
export function isAdminRoute(pathname: string): boolean {
  // Normalize pathname
  const normalized = pathname.toLowerCase();

  // Check for /api/admin/* pattern
  if (normalized.startsWith('/api/admin/')) {
    return true;
  }

  // Check for /api/v2/admin/* pattern
  if (normalized.startsWith('/api/v2/admin/')) {
    return true;
  }

  // Check for adminBundle endpoints
  if (normalized.includes('/adminbundle')) {
    return true;
  }

  // Check for /bundle/admin pattern
  if (normalized.includes('/bundle/admin')) {
    return true;
  }

  return false;
}

/**
 * Full admin auth guard for route handling
 *
 * Combines route detection with auth check.
 * Returns error Response if admin route without valid auth.
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @returns Error Response if unauthorized admin access, null otherwise
 */
export function guardAdminRoute(
  request: Request,
  env: AdminAuthEnv
): Response | null {
  const url = new URL(request.url);

  if (isAdminRoute(url.pathname)) {
    return requireAdminAuth(request, env);
  }

  return null;
}

// =============================================================================
// Logging Utilities
// =============================================================================

/**
 * Log authentication attempt (without exposing token)
 *
 * @param result - Authentication result
 * @param request - Original request
 */
export function logAuthAttempt(result: AuthResult, request: Request): void {
  const url = new URL(request.url);
  const hasAuthHeader = Boolean(request.headers.get('Authorization'));
  const hasQueryParam = url.searchParams.has('adminKey');

  console.log(
    JSON.stringify({
      type: 'AUTH_ATTEMPT',
      authenticated: result.authenticated,
      errorCode: result.errorCode,
      authMethod: result.context?.authMethod || null,
      hasAuthHeader,
      hasQueryParam,
      path: url.pathname,
      timestamp: new Date().toISOString(),
    })
  );
}
