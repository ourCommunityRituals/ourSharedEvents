/**
 * Admin Authentication Guard for V2 API
 *
 * Pure helper function for protecting admin endpoints.
 * Primary: Cloudflare Access JWT (Cf-Access-Jwt-Assertion header)
 * Fallback: ADMIN_KEY (only when ALLOW_ADMIN_KEY_FALLBACK=true)
 *
 * Story D4 - Replace Admin Key with Cloudflare Access
 *
 * Authentication Methods:
 * 1. Cloudflare Access JWT: Header Cf-Access-Jwt-Assertion
 *    - Validates header exists and token decodes
 *    - No signature verification needed (Access already validated)
 *
 * 2. Admin Key (fallback): Authorization: Bearer <ADMIN_KEY>
 *    - Only allowed when ALLOW_ADMIN_KEY_FALLBACK=true
 *    - For CI/CD and legacy support
 *
 * Response shapes:
 *
 * 401 Unauthorized (invalid/missing token):
 * { "ok": false, "status": 401, "code": "UNAUTH", "requestId": "..." }
 *
 * @module auth/admin
 * @see Story D4 - Replace Admin Key with Cloudflare Access
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings for admin authentication
 */
export interface AdminKeyEnv {
  /**
   * Admin API key configured as Cloudflare secret.
   * Fallback for CI/CD when Cloudflare Access is not available.
   * Only used when ALLOW_ADMIN_KEY_FALLBACK=true.
   */
  ADMIN_KEY?: string;

  /**
   * Legacy admin token (fallback for backward compatibility).
   * @deprecated Use ADMIN_KEY instead.
   */
  ADMIN_TOKEN?: string;

  /**
   * Feature flag to allow ADMIN_KEY fallback.
   * Set to "true" to enable admin key authentication.
   * Required for CI/CD pipelines using service tokens.
   */
  ALLOW_ADMIN_KEY_FALLBACK?: string;

  /**
   * Cloudflare Access Service Token Client ID (for CI/CD).
   * Used with CF_ACCESS_CLIENT_SECRET for service token auth.
   */
  CF_ACCESS_CLIENT_ID?: string;

  /**
   * Cloudflare Access Service Token Secret (for CI/CD).
   * Used with CF_ACCESS_CLIENT_ID for service token auth.
   */
  CF_ACCESS_CLIENT_SECRET?: string;
}

/**
 * Admin auth error response matching Story C1 spec
 */
export interface AdminAuthError {
  ok: false;
  status: 401;
  code: 'UNAUTH';
  requestId: string;
}

/**
 * Admin key missing error response (503)
 * @deprecated No longer used - Cloudflare Access is the primary auth method.
 * Kept for backward compatibility with existing tests.
 */
export interface AdminKeyMissingError {
  ok: false;
  status: 503;
  code: 'ADMIN_KEY_MISSING';
  requestId: string;
}

// =============================================================================
// Cloudflare Access JWT Types
// =============================================================================

/**
 * Decoded Cloudflare Access JWT payload
 * We only decode to verify structure, not cryptographic validity
 * (Cloudflare Access already validated the signature)
 */
export interface CloudflareAccessJwtPayload {
  /** Audience - the Access application AUD tag */
  aud?: string[];
  /** Email of the authenticated user */
  email?: string;
  /** Expiration timestamp */
  exp?: number;
  /** Issued at timestamp */
  iat?: number;
  /** Issuer - the Access team domain */
  iss?: string;
  /** Nonce for request binding */
  nonce?: string;
  /** Subject - user identifier */
  sub?: string;
  /** Identity nonce */
  identity_nonce?: string;
  /** Common name (for service tokens) */
  common_name?: string;
  /** Service token client ID (for service tokens) */
  service_token_id?: string;
  /** Type of token (app, etc.) */
  type?: string;
}

/**
 * Result of JWT decoding attempt
 */
export interface JwtDecodeResult {
  ok: boolean;
  payload?: CloudflareAccessJwtPayload;
  error?: string;
}

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
 * Base64URL decode (JWT uses base64url encoding)
 *
 * @param str - Base64URL encoded string
 * @returns Decoded string
 */
function base64UrlDecode(str: string): string {
  // Add padding if needed
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;

  // Decode from base64
  const binaryStr = atob(base64);
  return binaryStr;
}

/**
 * Decode a Cloudflare Access JWT to extract payload
 * Note: This only decodes the JWT, it does NOT verify the signature.
 * Signature verification is handled by Cloudflare Access at the edge.
 *
 * @param jwt - The JWT string from Cf-Access-Jwt-Assertion header
 * @returns Decode result with payload or error
 */
export function decodeCloudflareAccessJwt(jwt: string): JwtDecodeResult {
  try {
    // JWT format: header.payload.signature
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      return { ok: false, error: 'Invalid JWT format: expected 3 parts' };
    }

    // Decode the payload (second part)
    const payloadJson = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadJson) as CloudflareAccessJwtPayload;

    // Basic validation - check for required fields
    if (!payload.exp || !payload.iat) {
      return { ok: false, error: 'Invalid JWT payload: missing exp or iat' };
    }

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return { ok: false, error: 'JWT expired' };
    }

    return { ok: true, payload };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: `Failed to decode JWT: ${error}` };
  }
}

/**
 * Extract and validate Cloudflare Access JWT from request
 *
 * @param request - Incoming request
 * @returns Decoded JWT payload or null if invalid/missing
 */
function extractCloudflareAccessJwt(request: Request): CloudflareAccessJwtPayload | null {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');

  if (!jwt) {
    return null;
  }

  const result = decodeCloudflareAccessJwt(jwt);

  if (!result.ok || !result.payload) {
    console.warn('[AdminAuth] Invalid Cloudflare Access JWT:', result.error);
    return null;
  }

  return result.payload;
}

/**
 * Check if admin key fallback is enabled
 *
 * @param env - Worker environment
 * @returns True if ALLOW_ADMIN_KEY_FALLBACK is "true"
 */
function isAdminKeyFallbackEnabled(env: AdminKeyEnv): boolean {
  return env.ALLOW_ADMIN_KEY_FALLBACK === 'true';
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

/**
 * Get the admin key from environment
 * Prefers ADMIN_KEY, falls back to ADMIN_TOKEN for compatibility
 *
 * @param env - Worker environment
 * @returns Admin key or null if not configured
 */
function getAdminKey(env: AdminKeyEnv): string | null {
  // Prefer ADMIN_KEY (Story C1)
  if (env.ADMIN_KEY && env.ADMIN_KEY.trim().length > 0) {
    return env.ADMIN_KEY.trim();
  }

  // Fallback to ADMIN_TOKEN for backward compatibility
  if (env.ADMIN_TOKEN && env.ADMIN_TOKEN.trim().length > 0) {
    return env.ADMIN_TOKEN.trim();
  }

  return null;
}

/**
 * Check if admin key is configured
 *
 * @param env - Worker environment
 * @returns True if ADMIN_KEY or ADMIN_TOKEN is set
 */
export function isAdminKeyConfigured(env: AdminKeyEnv): boolean {
  return getAdminKey(env) !== null;
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Create a 401 Unauthorized response with Story C1 format
 *
 * @param requestId - Request ID for correlation
 * @returns HTTP Response with 401 status
 */
export function createUnauthorizedResponse(requestId: string): Response {
  const body: AdminAuthError = {
    ok: false,
    status: 401,
    code: 'UNAUTH',
    requestId,
  };

  return new Response(JSON.stringify(body), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="EventAngle Admin API"',
      'X-Request-Id': requestId,
    },
  });
}

/**
 * Create a 503 Service Unavailable response for missing ADMIN_KEY
 *
 * @deprecated No longer used - Cloudflare Access is the primary auth method.
 * Kept for backward compatibility with existing tests.
 *
 * @param requestId - Request ID for correlation
 * @returns HTTP Response with 503 status
 */
export function createAdminKeyMissingResponse(requestId: string): Response {
  const body: AdminKeyMissingError = {
    ok: false,
    status: 503,
    code: 'ADMIN_KEY_MISSING',
    requestId,
  };

  return new Response(JSON.stringify(body), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

/**
 * Require admin authentication for a request
 *
 * Story D4 - Replace Admin Key with Cloudflare Access
 *
 * Authentication flow:
 * 1. Check for Cloudflare Access JWT (Cf-Access-Jwt-Assertion header)
 *    - If valid, auth succeeds
 * 2. If Cloudflare Access fails and ALLOW_ADMIN_KEY_FALLBACK=true:
 *    - Check for Bearer token (Authorization header)
 *    - Validate against ADMIN_KEY
 * 3. If all methods fail, return 401 Unauthorized
 *
 * Usage:
 *   const authError = requireAdmin(request, env, requestId);
 *   if (authError) return authError;
 *   // ... handle authenticated request
 *
 * Security:
 * - Uses constant-time comparison for admin key validation
 * - Never logs token values
 * - JWT decode only (signature verified by Cloudflare Access)
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param requestId - Request ID for error response
 * @returns Error Response if auth fails, null if auth succeeds
 */
export function requireAdmin(
  request: Request,
  env: AdminKeyEnv,
  requestId: string
): Response | null {
  // Method 1: Cloudflare Access JWT (primary)
  const accessPayload = extractCloudflareAccessJwt(request);
  if (accessPayload) {
    // Valid Cloudflare Access JWT - auth succeeds
    console.log('[AdminAuth] Authenticated via Cloudflare Access', {
      email: accessPayload.email,
      serviceTokenId: accessPayload.service_token_id,
    });
    return null;
  }

  // Method 2: Admin Key fallback (only if enabled)
  if (isAdminKeyFallbackEnabled(env)) {
    const adminKey = getAdminKey(env);

    if (adminKey) {
      // Extract Bearer token from Authorization header
      const authHeader = request.headers.get('Authorization');
      const token = extractBearerToken(authHeader);

      if (token && constantTimeCompare(token, adminKey)) {
        // Valid admin key - auth succeeds
        console.log('[AdminAuth] Authenticated via ADMIN_KEY fallback');
        return null;
      }
    }
  }

  // No valid authentication found
  console.warn('[AdminAuth] Authentication failed - no valid credentials');
  return createUnauthorizedResponse(requestId);
}

/**
 * Check if a pathname is a V2 admin route
 *
 * V2 admin routes:
 *   - /api/v2/admin/*
 *
 * @param pathname - URL pathname to check
 * @returns True if path requires admin authentication
 */
export function isV2AdminRoute(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return normalized.startsWith('/api/v2/admin/');
}

/**
 * Guard V2 admin routes with admin authentication
 *
 * Combines route detection with auth check for V2 admin API.
 * Returns error Response if admin route without valid auth.
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param requestId - Request ID for error response
 * @returns Error Response if unauthorized V2 admin access, null otherwise
 */
export function guardV2AdminRoute(
  request: Request,
  env: AdminKeyEnv,
  requestId: string
): Response | null {
  const url = new URL(request.url);

  if (isV2AdminRoute(url.pathname)) {
    return requireAdmin(request, env, requestId);
  }

  return null;
}
