/**
 * Admin OAuth Guard
 *
 * Guards admin routes requiring OAuth session + allowlist validation.
 * Combines session validation with allowlist checking.
 *
 * @module auth/adminOAuthGuard
 * @see SEC-IAC-03 - Admin OAuth & Allowlist
 */

import {
  OAuthSessionEnv,
  getSessionFromRequest,
  SessionData,
} from './oauthSession';
import {
  AdminAllowlistEnv,
  guardAdminAllowlist,
  checkAllowlist,
  isAllowlistConfigured,
} from './adminAllowlist';

// =============================================================================
// Types
// =============================================================================

/**
 * Combined environment for OAuth guard
 */
export interface AdminOAuthEnv extends OAuthSessionEnv, AdminAllowlistEnv {}

/**
 * Result of OAuth guard check
 */
export interface OAuthGuardResult {
  /** Whether user is authenticated and authorized */
  authorized: boolean;
  /** Authenticated user's email (if authorized) */
  email?: string;
  /** Session data (if authorized) */
  session?: SessionData;
  /** Error response to return (if not authorized) */
  errorResponse?: Response;
  /** Reason for denial */
  reason?: 'no_session' | 'invalid_session' | 'expired_session' | 'not_allowlisted' | 'allowlist_not_configured';
}

// =============================================================================
// Guard Functions
// =============================================================================

/**
 * Guard admin route with OAuth session + allowlist
 *
 * Flow:
 * 1. Check for valid session cookie
 * 2. Verify session not expired
 * 3. Check email against allowlist
 * 4. Return authorized or error response
 *
 * Usage:
 *   const result = await guardAdminOAuth(request, env, requestId);
 *   if (!result.authorized) {
 *     return result.errorResponse;
 *   }
 *   // Proceed with authorized request, user email in result.email
 *
 * @param request - Incoming request
 * @param env - Environment with session secret and allowlist
 * @param requestId - Request ID for error responses
 * @returns Guard result with authorized status and email or error response
 */
export async function guardAdminOAuth(
  request: Request,
  env: AdminOAuthEnv,
  requestId: string
): Promise<OAuthGuardResult> {
  // Check for session cookie
  const sessionResult = await getSessionFromRequest(request, env.SESSION_SECRET);

  if (!sessionResult.valid || !sessionResult.session) {
    console.log(`[AdminOAuthGuard] No valid session: ${sessionResult.error}`);

    // Determine if it's missing or invalid/expired
    const reason = sessionResult.error === 'No session cookie'
      ? 'no_session'
      : sessionResult.error === 'Session expired'
        ? 'expired_session'
        : 'invalid_session';

    return {
      authorized: false,
      reason,
      errorResponse: createUnauthorizedRedirect(request, requestId),
    };
  }

  const email = sessionResult.session.email;

  // Check allowlist configuration
  if (!isAllowlistConfigured(env)) {
    console.warn('[AdminOAuthGuard] Allowlist not configured');
    return {
      authorized: false,
      reason: 'allowlist_not_configured',
      errorResponse: createServerErrorResponse(
        'Admin allowlist not configured',
        requestId
      ),
    };
  }

  // Check email against allowlist
  const allowlistResult = checkAllowlist(email, env);

  if (!allowlistResult.allowed) {
    console.warn(`[AdminOAuthGuard] User ${email} not in allowlist`);
    return {
      authorized: false,
      email,
      session: sessionResult.session,
      reason: 'not_allowlisted',
      errorResponse: createForbiddenResponse(email, requestId),
    };
  }

  console.log(
    `[AdminOAuthGuard] Authorized: ${email} via ${allowlistResult.reason}`
  );

  return {
    authorized: true,
    email,
    session: sessionResult.session,
  };
}

/**
 * Check if OAuth-based admin auth is enabled
 *
 * OAuth auth is enabled when SESSION_SECRET is configured.
 * When not configured, falls back to existing auth methods.
 *
 * @param env - Environment to check
 * @returns True if OAuth admin auth is enabled
 */
export function isOAuthAdminEnabled(env: Partial<AdminOAuthEnv>): boolean {
  return !!env.SESSION_SECRET && env.SESSION_SECRET.length > 0;
}

// =============================================================================
// Response Builders
// =============================================================================

/**
 * Create redirect to login page for unauthenticated requests
 */
function createUnauthorizedRedirect(request: Request, requestId: string): Response {
  const url = new URL(request.url);

  // For API requests, return JSON 401
  if (url.pathname.startsWith('/api/')) {
    return new Response(
      JSON.stringify({
        ok: false,
        status: 401,
        code: 'UNAUTH',
        message: 'Authentication required',
        requestId,
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="EventAngle Admin"',
          'X-Request-Id': requestId,
        },
      }
    );
  }

  // For page requests, redirect to login
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/auth/login',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}

/**
 * Create 403 Forbidden response
 */
function createForbiddenResponse(email: string, requestId: string): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: `User ${email} is not authorized for admin access`,
      requestId,
    }),
    {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    }
  );
}

/**
 * Create 503 server error response
 */
function createServerErrorResponse(message: string, requestId: string): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message,
      requestId,
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    }
  );
}
