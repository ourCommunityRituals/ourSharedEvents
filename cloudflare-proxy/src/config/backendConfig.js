/**
 * Backend Configuration Module (Story 0.1, updated Story 5.2)
 *
 * Provides versioned backend routing configuration for GAS → Worker migration.
 *
 * BACKEND_MODE values:
 *   - 'gas'    : All routes use GAS backend (DEPRECATED - for emergency rollback only)
 *   - 'worker' : All routes use Worker-native backend (DEFAULT for all environments)
 *   - 'mixed'  : Per-route selection (DEPRECATED - no longer needed)
 *
 * Environment Variables:
 *   - BACKEND_MODE: 'gas' | 'worker' | 'mixed' (default: 'worker')
 *
 * Story 5.2 Status - Full DNS Cutover:
 *   - Both staging AND production use BACKEND_MODE='worker'
 *   - ALL routes now use Worker-native implementations
 *   - Shortlinks (/r, /redirect) use Worker-native Sheets API
 *   - NO script.google.com backend calls exist anywhere
 *   - GAS mode is DEPRECATED and kept only for emergency rollback
 *
 * @module backendConfig
 * @see Story 0.1 - Introduce Versioned Backend Routing
 * @see Story 5.2 - DNS Cutover (stg + prod fully to Cloudflare)
 * @see Story 6.1 - Confirm Prod Worker Parity
 * @see docs/DNS_CUTOVER.md - Cutover documentation
 */

// =============================================================================
// BACKEND MODES
// =============================================================================

/**
 * Valid backend mode values
 * @type {Object}
 */
export const BACKEND_MODES = Object.freeze({
  GAS: 'gas',
  WORKER: 'worker',
  MIXED: 'mixed'
});

/**
 * Default backend mode
 * Story 5.2: Changed from GAS to WORKER - full DNS cutover complete
 * @type {string}
 */
export const DEFAULT_BACKEND_MODE = BACKEND_MODES.WORKER;

// =============================================================================
// ROUTE-LEVEL BACKEND MAPPING (for MIXED mode)
// =============================================================================

/**
 * Per-route backend configuration for MIXED mode (DEPRECATED).
 *
 * Story 5.2: This map is now DEPRECATED. All routes use Worker backend.
 * The map is kept for reference and potential emergency rollback only.
 *
 * ALL routes now use Worker-native implementations:
 *   - API endpoints: Worker-native /api/v2/* endpoints
 *   - HTML pages: Worker templates
 *   - Shortlinks: Worker-native Sheets API
 *   - Legacy RPC: Deprecated (use /api/v2/* instead)
 *
 * Migration Complete (Story 5.2):
 *   - Production: BACKEND_MODE='worker'
 *   - Staging: BACKEND_MODE='worker'
 *   - No GAS backend calls exist anywhere
 *
 * @type {Object<string, string>}
 * @deprecated Use BACKEND_MODE='worker' instead
 */
export const BACKEND_ROUTE_MAP = Object.freeze({
  // =========================================================================
  // API Endpoints - ALL Worker-native
  // =========================================================================
  '/api/status': 'worker',
  '/api/v2/status': 'worker',
  '/api/v2/ping': 'worker',
  '/api/ping': 'worker',

  '/api/v2/events': 'worker',
  '/api/v2/events/:id': 'worker',
  '/api/v2/events/:id/bundle/public': 'worker',
  '/api/v2/events/:id/bundle/display': 'worker',
  '/api/v2/events/:id/bundle/poster': 'worker',
  '/api/v2/events/:id/bundle/admin': 'worker',

  // Legacy API - DEPRECATED, returns 410 Gone
  '/api': 'worker',
  '/api/rpc': 'worker',

  // =========================================================================
  // Page Requests (HTML) - Worker templates
  // =========================================================================
  '/events': 'worker',
  '/admin': 'worker',
  '/display': 'worker',
  '/poster': 'worker',
  '/report': 'worker',

  // =========================================================================
  // Shortlinks - Worker-native Sheets API (Story 5.2)
  // =========================================================================
  '/r': 'worker',
  '/redirect': 'worker'
});

// =============================================================================
// CONFIGURATION FUNCTIONS
// =============================================================================

/**
 * Get the current backend mode from environment.
 *
 * @param {Object} env - Worker environment
 * @returns {string} Backend mode ('gas', 'worker', or 'mixed')
 */
export function getBackendMode(env) {
  const mode = (env.BACKEND_MODE || DEFAULT_BACKEND_MODE).toLowerCase();

  // Validate mode
  if (Object.values(BACKEND_MODES).includes(mode)) {
    return mode;
  }

  // Log warning for invalid mode, fall back to default
  console.warn(`[BACKEND_CONFIG] Invalid BACKEND_MODE: ${mode}, using default: ${DEFAULT_BACKEND_MODE}`);
  return DEFAULT_BACKEND_MODE;
}

/**
 * Check if query param backend override is allowed.
 * Only allowed in staging environment.
 *
 * @param {Object} env - Worker environment
 * @returns {boolean}
 */
export function isBackendOverrideAllowed(env) {
  // Only allow in staging
  const workerEnv = (env.WORKER_ENV || '').toLowerCase();
  const isStaging = workerEnv === 'staging' || env.ENABLE_DEBUG_ENDPOINTS === 'true';
  return isStaging;
}

/**
 * Get the backend for a specific route.
 *
 * Priority:
 *   1. Query param override (?backend=gas|worker) - staging only
 *   2. Route-specific config (in MIXED mode)
 *   3. Global BACKEND_MODE setting
 *
 * @param {string} pathname - Request pathname (e.g., '/api/status')
 * @param {URLSearchParams} searchParams - Query parameters
 * @param {Object} env - Worker environment
 * @returns {{ backend: string, source: string }} Backend and how it was determined
 */
export function getBackendForRoute(pathname, searchParams, env) {
  const mode = getBackendMode(env);

  // 1. Check for query param override (staging only)
  if (isBackendOverrideAllowed(env)) {
    const backendOverride = searchParams.get('backend');
    if (backendOverride) {
      const override = backendOverride.toLowerCase();
      if (override === 'gas' || override === 'worker') {
        return {
          backend: override,
          source: 'query_override'
        };
      }
    }
  }

  // 2. In MIXED mode, check route-specific config
  if (mode === BACKEND_MODES.MIXED) {
    // Normalize pathname
    const normalizedPath = normalizePath(pathname);

    // Check exact match first
    if (normalizedPath in BACKEND_ROUTE_MAP) {
      return {
        backend: BACKEND_ROUTE_MAP[normalizedPath],
        source: 'route_config'
      };
    }

    // Check pattern match (e.g., /api/v2/events/:id)
    const patternMatch = findMatchingRoutePattern(normalizedPath);
    if (patternMatch) {
      return {
        backend: BACKEND_ROUTE_MAP[patternMatch],
        source: 'route_pattern'
      };
    }

    // Fall back to GAS for unlisted routes in mixed mode
    return {
      backend: BACKEND_MODES.GAS,
      source: 'mixed_default'
    };
  }

  // 3. Use global mode
  return {
    backend: mode,
    source: 'global_mode'
  };
}

/**
 * Normalize pathname for route matching.
 *
 * @param {string} pathname - Original pathname
 * @returns {string} Normalized pathname
 */
function normalizePath(pathname) {
  // Remove trailing slash (except for root)
  let normalized = pathname.endsWith('/') && pathname !== '/'
    ? pathname.slice(0, -1)
    : pathname;

  // Ensure leading slash
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  return normalized.toLowerCase();
}

/**
 * Find a matching route pattern for a pathname.
 * Supports :param style wildcards.
 *
 * @param {string} pathname - Normalized pathname
 * @returns {string|null} Matching pattern or null
 */
function findMatchingRoutePattern(pathname) {
  const patterns = Object.keys(BACKEND_ROUTE_MAP);

  for (const pattern of patterns) {
    if (matchRoutePattern(pattern, pathname)) {
      return pattern;
    }
  }

  return null;
}

/**
 * Escape special regex characters in a string.
 * This prevents regex injection attacks.
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for use in RegExp
 */
function escapeRegex(str) {
  // Escape all regex special characters: \ ^ $ . | ? * + ( ) [ ] { }
  return str.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

/**
 * Match a route pattern against a pathname.
 *
 * @param {string} pattern - Route pattern (e.g., '/api/v2/events/:id')
 * @param {string} pathname - Request pathname
 * @returns {boolean}
 */
function matchRoutePattern(pattern, pathname) {
  // Convert pattern to regex safely:
  // 1. First, replace :param placeholders with a temporary marker
  // 2. Escape all regex special characters in the remaining string
  // 3. Replace the temporary marker with the actual regex pattern
  // 4. Replace escaped forward slashes back (they're path separators)

  const PARAM_MARKER = '\x00PARAM\x00';

  // Step 1: Replace :param with temporary marker
  const withMarkers = pattern.replace(/:[^/]+/g, PARAM_MARKER);

  // Step 2: Escape all regex special characters
  const escaped = escapeRegex(withMarkers);

  // Step 3: Replace markers with regex pattern for path segments
  const regexPattern = escaped.replace(new RegExp(escapeRegex(PARAM_MARKER), 'g'), '[^/]+');

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(pathname);
}

// =============================================================================
// BACKEND ERROR HANDLING
// =============================================================================

/**
 * Standard error code for backend failures
 * @type {string}
 */
export const BACKEND_ERROR_CODE = 'BACKEND_ERROR';

/**
 * Create a structured error response for backend failures.
 * This ensures no half-rendered pages - always returns clean JSON.
 *
 * @param {number} status - HTTP status code
 * @param {string} code - Error code (default: BACKEND_ERROR)
 * @param {string} message - Human-readable error message
 * @param {Object} [details] - Additional error details
 * @returns {Response}
 */
export function createBackendErrorResponse(status, code, message, details = null) {
  const body = {
    ok: false,
    status: status,
    code: code || BACKEND_ERROR_CODE,
    message: message,
    timestamp: new Date().toISOString()
  };

  if (details) {
    body.details = details;
  }

  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      'X-Backend-Error': 'true',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

/**
 * Create a 500 backend error response.
 *
 * @param {string} message - Error message
 * @param {Object} [details] - Additional details
 * @returns {Response}
 */
export function createBackendError500(message, details = null) {
  return createBackendErrorResponse(500, BACKEND_ERROR_CODE, message, details);
}

// =============================================================================
// LOGGING HELPERS
// =============================================================================

/**
 * Log backend routing decision (structured logging).
 *
 * @param {string} pathname - Request pathname
 * @param {string} backend - Selected backend
 * @param {string} source - How backend was determined
 * @param {Object} env - Worker environment
 */
export function logBackendDecision(pathname, backend, source, env) {
  const debugLevel = (env.DEBUG_LEVEL || 'error').toLowerCase();

  if (debugLevel === 'debug') {
    console.log(JSON.stringify({
      type: 'BACKEND_ROUTE',
      pathname: pathname,
      backend: backend,
      source: source,
      mode: getBackendMode(env),
      timestamp: new Date().toISOString()
    }));
  }
}

// =============================================================================
// EXPORTS SUMMARY
// =============================================================================

export default {
  BACKEND_MODES,
  DEFAULT_BACKEND_MODE,
  BACKEND_ROUTE_MAP,
  BACKEND_ERROR_CODE,
  getBackendMode,
  getBackendForRoute,
  isBackendOverrideAllowed,
  createBackendErrorResponse,
  createBackendError500,
  logBackendDecision
};
