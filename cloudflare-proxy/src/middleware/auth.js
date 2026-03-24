/**
 * Authentication Middleware
 *
 * Handles admin authentication for protected endpoints.
 *
 * Phase 1: Shared admin API token
 * Header: Authorization: Bearer <ADMIN_TOKEN>
 *
 * Phase 2 (future): Per-venue keys, JWT tokens, role-based access
 */

/**
 * Authentication result
 * @typedef {Object} AuthResult
 * @property {boolean} authenticated - Whether authentication succeeded
 * @property {string|null} error - Error message if failed
 * @property {string|null} errorCode - Error code if failed
 * @property {Object|null} context - Auth context if succeeded
 */

/**
 * Check if request has valid admin authentication
 *
 * @param {Request} request - Incoming request
 * @param {Object} env - Worker environment
 * @returns {AuthResult}
 */
export function checkAdminAuth(request, env) {
  // Check if admin token is configured
  if (!env.ADMIN_TOKEN) {
    return {
      authenticated: false,
      error: 'Admin authentication not configured',
      errorCode: 'NOT_CONFIGURED',
      context: null
    };
  }

  // Get Authorization header
  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return {
      authenticated: false,
      error: 'Missing Authorization header',
      errorCode: 'UNAUTHORIZED',
      context: null
    };
  }

  // Parse Bearer token
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return {
      authenticated: false,
      error: 'Invalid Authorization header format. Expected: Bearer <token>',
      errorCode: 'UNAUTHORIZED',
      context: null
    };
  }

  const token = match[1];

  // Validate token
  if (token !== env.ADMIN_TOKEN) {
    return {
      authenticated: false,
      error: 'Invalid admin token',
      errorCode: 'UNAUTHORIZED',
      context: null
    };
  }

  // Success
  return {
    authenticated: true,
    error: null,
    errorCode: null,
    context: {
      role: 'admin',
      authMethod: 'bearer_token'
    }
  };
}

/**
 * Check if request has valid brand-specific admin key
 * (Legacy compatibility with existing adminKey pattern)
 *
 * @param {Request} request - Incoming request
 * @param {Object} env - Worker environment
 * @param {Object} body - Request body (already parsed)
 * @returns {AuthResult}
 */
export function checkAdminKey(request, env, body) {
  // Check for adminKey in request body
  const adminKey = body?.adminKey;

  if (!adminKey) {
    return {
      authenticated: false,
      error: 'Missing adminKey in request body',
      errorCode: 'UNAUTHORIZED',
      context: null
    };
  }

  // Check against environment admin key
  if (!env.ADMIN_TOKEN || adminKey !== env.ADMIN_TOKEN) {
    return {
      authenticated: false,
      error: 'Invalid adminKey',
      errorCode: 'UNAUTHORIZED',
      context: null
    };
  }

  return {
    authenticated: true,
    error: null,
    errorCode: null,
    context: {
      role: 'admin',
      authMethod: 'admin_key'
    }
  };
}

/**
 * Require admin authentication
 * Returns an error response if authentication fails
 *
 * @param {Request} request - Incoming request
 * @param {Object} env - Worker environment
 * @param {Object} [body] - Optional request body for adminKey auth
 * @returns {Response|null} Error response if auth fails, null if success
 */
export function requireAdminAuth(request, env, body = null) {
  // Try Bearer token first
  let authResult = checkAdminAuth(request, env);

  // Fall back to adminKey in body
  if (!authResult.authenticated && body) {
    authResult = checkAdminKey(request, env, body);
  }

  if (!authResult.authenticated) {
    return new Response(JSON.stringify({
      ok: false,
      code: authResult.errorCode,
      message: authResult.error
    }), {
      status: authResult.errorCode === 'NOT_CONFIGURED' ? 503 : 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="EventAngle Admin"'
      }
    });
  }

  return null; // Auth succeeded
}

/**
 * Create authentication error response
 *
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {number} status - HTTP status code
 * @returns {Response}
 */
export function authErrorResponse(code, message, status = 401) {
  return new Response(JSON.stringify({
    ok: false,
    code,
    message
  }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="EventAngle Admin"'
    }
  });
}
