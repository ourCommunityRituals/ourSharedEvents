/**
 * Public Read-Only Enforcement Guard
 *
 * SEC-IAC-04: Ensure all public routes are read-only unless explicitly authorized.
 *
 * Security Posture:
 * - Default: READ ONLY - All public routes allow only GET/HEAD by default
 * - Mutations (POST/PUT/DELETE/PATCH) require a signed token
 * - Unknown routes return 404 (handled by router)
 *
 * Route Classifications:
 * - ADMIN_ONLY: Routes protected by admin auth (handled by adminAuth/admin guards)
 * - READ_PUBLIC: Routes publicly accessible for reads only
 * - WRITE_PUBLIC: Routes that allow authenticated mutations
 *
 * @module auth/publicReadOnly
 * @see SEC-IAC-04 - Public Read-Only Enforcement
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Route access classification
 */
export type RouteAccessLevel = 'ADMIN_ONLY' | 'READ_PUBLIC' | 'WRITE_PUBLIC';

/**
 * HTTP methods considered as mutations (not read-only)
 */
export const MUTATION_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'] as const;
export type MutationMethod = (typeof MUTATION_METHODS)[number];

/**
 * HTTP methods considered as reads (read-only)
 */
export const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;
export type ReadMethod = (typeof READ_METHODS)[number];

/**
 * Environment bindings for public read-only guard
 */
export interface PublicReadOnlyEnv {
  /**
   * Admin API key for authorizing mutations on public routes.
   */
  ADMIN_KEY?: string;

  /**
   * Legacy admin token (fallback).
   * @deprecated Use ADMIN_KEY instead.
   */
  ADMIN_TOKEN?: string;
}

/**
 * Result of public read-only guard check
 */
export interface PublicReadOnlyResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Error response if not allowed */
  errorResponse?: Response;
  /** Classification of the route */
  classification: RouteAccessLevel;
  /** Reason for decision */
  reason: string;
}

/**
 * Public read-only error response (403)
 */
export interface PublicReadOnlyError {
  ok: false;
  status: 403;
  code: 'WRITE_DENIED';
  message: string;
  requestId: string;
}

// =============================================================================
// Route Classification
// =============================================================================

/**
 * Admin-only route patterns (already protected by other guards)
 * These are listed here for reference but protected elsewhere
 */
const ADMIN_ONLY_PATTERNS = [
  /^\/api\/v2\/admin\//i,          // V2 admin endpoints
  /^\/api\/admin\//i,               // Legacy admin endpoints
  /^\/api\/events\/[^/]+\/adminBundle$/i, // Admin bundle
  /^\/auth\//i,                     // OAuth routes
] as const;

/**
 * Public read-only route patterns
 * These routes allow GET/HEAD but deny mutations without auth
 */
const READ_PUBLIC_PATTERNS = [
  /^\/api\/status$/i,               // Status endpoint
  /^\/api\/health\/backend$/i,      // Backend health
  /^\/api\/events$/i,               // Events list
  /^\/api\/v2\/events$/i,           // V2 events list
  /^\/api\/v2\/sponsors$/i,         // Sponsors list
  /^\/api\/v2\/sponsor\/[^/]+$/i,   // Single sponsor
  /^\/api\/v2\/sponsor\/[^/]+\/monetization$/i, // Sponsor monetization
  /^\/api\/v2\/event\/[^/]+\/monetization$/i,   // Event monetization
  /^\/api\/v2\/monetization\/inert$/i,          // Monetization inert check
  /^\/api\/v2\/sharedreport$/i,     // Shared report
  /^\/api\/events\/[^/]+$/i,        // Single event
  /^\/api\/events\/[^/]+\/publicBundle$/i,   // Public bundle
  /^\/api\/events\/[^/]+\/displayBundle$/i,  // Display bundle
  /^\/api\/events\/[^/]+\/posterBundle$/i,   // Poster bundle
  /^\/health\/origin$/i,            // Health origin
] as const;

/**
 * Page routes (HTML pages - read-only)
 */
const PAGE_PATTERNS = [
  /^\/(public|events|schedule|calendar)$/i,
  /^\/(admin|manage|dashboard|create)$/i,
  /^\/(display|tv|kiosk|screen)$/i,
  /^\/(poster|posters|flyers)$/i,
  /^\/(report|analytics|reports|insights)$/i,
  /^\/(sponsor|sponsors|partnership)$/i,
  /^\/web\/shared\/[^/]+\.js$/i,    // Shared modules
  /^\/$/,                            // Root
] as const;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a method is a mutation (non-read-only)
 *
 * @param method - HTTP method
 * @returns True if method is POST, PUT, DELETE, or PATCH
 */
export function isMutationMethod(method: string): boolean {
  const upperMethod = method.toUpperCase();
  return MUTATION_METHODS.includes(upperMethod as MutationMethod);
}

/**
 * Check if a method is a read operation
 *
 * @param method - HTTP method
 * @returns True if method is GET, HEAD, or OPTIONS
 */
export function isReadMethod(method: string): boolean {
  const upperMethod = method.toUpperCase();
  return READ_METHODS.includes(upperMethod as ReadMethod);
}

/**
 * Classify a route based on its path
 *
 * @param pathname - URL pathname
 * @returns Route classification
 */
export function classifyRoute(pathname: string): RouteAccessLevel {
  // Normalize pathname (remove trailing slash for matching)
  const normalizedPath = pathname.endsWith('/') && pathname !== '/'
    ? pathname.slice(0, -1)
    : pathname;

  // Check admin-only patterns first
  for (const pattern of ADMIN_ONLY_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return 'ADMIN_ONLY';
    }
  }

  // Check read-public patterns
  for (const pattern of READ_PUBLIC_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return 'READ_PUBLIC';
    }
  }

  // Check page patterns
  for (const pattern of PAGE_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return 'READ_PUBLIC';
    }
  }

  // Unknown routes - treat as READ_PUBLIC but will 404 later
  return 'READ_PUBLIC';
}

/**
 * Extract Bearer token from Authorization header
 *
 * @param header - Authorization header value
 * @returns Token string or null if not present/invalid
 */
function extractBearerToken(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

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
 * Get admin key from environment
 *
 * @param env - Environment bindings
 * @returns Admin key or null
 */
function getAdminKey(env: PublicReadOnlyEnv): string | null {
  if (env.ADMIN_KEY && env.ADMIN_KEY.trim().length > 0) {
    return env.ADMIN_KEY.trim();
  }
  if (env.ADMIN_TOKEN && env.ADMIN_TOKEN.trim().length > 0) {
    return env.ADMIN_TOKEN.trim();
  }
  return null;
}

/**
 * Check if request has valid authorization for mutations
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @returns True if request has valid auth token
 */
function hasValidMutationAuth(request: Request, env: PublicReadOnlyEnv): boolean {
  // Check for Cloudflare Access JWT (primary auth)
  const cfAccessJwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (cfAccessJwt) {
    // Presence of CF Access JWT indicates authenticated request
    // JWT validation is handled by Cloudflare Access at the edge
    return true;
  }

  // Check for Bearer token (fallback)
  const authHeader = request.headers.get('Authorization');
  const token = extractBearerToken(authHeader);

  if (!token) {
    return false;
  }

  const adminKey = getAdminKey(env);
  if (!adminKey) {
    return false;
  }

  return constantTimeCompare(token, adminKey);
}

// =============================================================================
// Response Builders
// =============================================================================

/**
 * Create a 403 Forbidden response for unauthorized write attempt
 *
 * @param pathname - The path that was accessed
 * @param method - The HTTP method attempted
 * @param requestId - Request ID for correlation
 * @returns HTTP Response with 403 status
 */
export function createWriteDeniedResponse(
  pathname: string,
  method: string,
  requestId: string
): Response {
  const body: PublicReadOnlyError = {
    ok: false,
    status: 403,
    code: 'WRITE_DENIED',
    message: `${method} operation on ${pathname} requires authorization`,
    requestId,
  };

  return new Response(JSON.stringify(body), {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="EventAngle API"',
      'X-Request-Id': requestId,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

// =============================================================================
// Main Guard Function
// =============================================================================

/**
 * Guard public routes with read-only enforcement
 *
 * SEC-IAC-04: Enforce read-only access on public routes by default.
 *
 * Security Logic:
 * 1. ADMIN_ONLY routes are skipped (handled by other guards)
 * 2. READ_PUBLIC routes:
 *    - GET/HEAD/OPTIONS: Always allowed
 *    - POST/PUT/DELETE/PATCH: Require valid auth token
 * 3. Unknown routes: Treated as READ_PUBLIC (will 404 later in router)
 *
 * Usage:
 *   const result = guardPublicReadOnly(request, env, requestId);
 *   if (!result.allowed) {
 *     return result.errorResponse;
 *   }
 *   // ... proceed with request handling
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param requestId - Request ID for error response
 * @returns Guard result with allowed status and optional error response
 */
export function guardPublicReadOnly(
  request: Request,
  env: PublicReadOnlyEnv,
  requestId: string
): PublicReadOnlyResult {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const pathname = url.pathname;

  // Classify the route
  const classification = classifyRoute(pathname);

  // Admin-only routes are handled by other guards (adminAuth, admin)
  if (classification === 'ADMIN_ONLY') {
    return {
      allowed: true,
      classification,
      reason: 'Admin route - delegated to admin guards',
    };
  }

  // Read methods are always allowed on public routes
  if (isReadMethod(method)) {
    return {
      allowed: true,
      classification,
      reason: `Read method ${method} allowed on public route`,
    };
  }

  // Mutation methods require authorization on public routes
  if (isMutationMethod(method)) {
    if (hasValidMutationAuth(request, env)) {
      return {
        allowed: true,
        classification: 'WRITE_PUBLIC',
        reason: `Mutation ${method} authorized via token`,
      };
    }

    // Mutation without auth - deny with 403
    console.warn(`[PublicReadOnly] Denied ${method} ${pathname} - no valid authorization`);
    return {
      allowed: false,
      errorResponse: createWriteDeniedResponse(pathname, method, requestId),
      classification,
      reason: `Mutation ${method} denied - authorization required`,
    };
  }

  // Unknown method - allow (will be handled by router if unsupported)
  return {
    allowed: true,
    classification,
    reason: `Method ${method} not classified - allowing through`,
  };
}

/**
 * Check if public read-only guard should be applied to a route
 *
 * Skip admin routes as they have their own auth guards.
 *
 * @param pathname - URL pathname
 * @returns True if public read-only guard should be applied
 */
export function shouldApplyPublicReadOnlyGuard(pathname: string): boolean {
  const classification = classifyRoute(pathname);
  return classification !== 'ADMIN_ONLY';
}
