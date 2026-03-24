/**
 * CORS Middleware
 *
 * Handles Cross-Origin Resource Sharing headers for API requests.
 */

/**
 * Allowed origins for CORS
 */
const ALLOWED_ORIGINS = [
  'https://zeventbooks.io',
  'https://www.zeventbooks.io',
  'https://stg.zeventbooks.io',
  'https://api.zeventbooks.io',
  'https://api-stg.zeventbooks.io'
];

// Development origins
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8787',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8787'
];

/**
 * Check if origin is allowed
 *
 * @param {string} origin - Request origin
 * @param {Object} env - Worker environment
 * @returns {boolean}
 */
function isAllowedOrigin(origin, env) {
  if (!origin) return true; // Same-origin requests

  // Always allow production origins
  if (ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }

  // Allow dev origins in staging
  if (env.WORKER_ENV === 'staging' || env.ENABLE_DEBUG_ENDPOINTS === 'true') {
    if (DEV_ORIGINS.includes(origin)) {
      return true;
    }
  }

  // Allow *.workers.dev domains for testing
  if (origin.includes('.workers.dev')) {
    return true;
  }

  return false;
}

/**
 * Get CORS headers for a request
 *
 * @param {Request} request - Incoming request
 * @param {Object} env - Worker environment
 * @returns {Object} CORS headers
 */
export function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin');

  // Determine allowed origin
  let allowedOrigin = '*';
  if (origin && isAllowedOrigin(origin, env)) {
    allowedOrigin = origin;
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag, X-Worker-Version, X-Request-Id',
    'Access-Control-Max-Age': '86400'
  };
}

/**
 * Handle CORS preflight request
 *
 * @param {Request} request - Incoming OPTIONS request
 * @param {Object} env - Worker environment
 * @returns {Response}
 */
export function handleCorsPreflightRequest(request, env) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, env)
  });
}

/**
 * Add CORS headers to response
 *
 * @param {Response} response - Original response
 * @param {Request} request - Incoming request
 * @param {Object} env - Worker environment
 * @returns {Response}
 */
export function addCorsHeaders(response, request, env) {
  const corsHeaders = getCorsHeaders(request, env);

  // Clone response with new headers
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}
