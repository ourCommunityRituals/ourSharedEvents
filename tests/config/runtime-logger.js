/**
 * Runtime Environment Logger (Story 1.3)
 *
 * Centralized logging for Playwright test runtime environment.
 * Provides visibility into which origins tests are hitting.
 *
 * Purpose: Make debugging 410/404/500 issues trivial by logging the actual
 * origins being used, not just the configured URLs.
 *
 * Security: Only logs origins/hosts, never secrets or full URLs with tokens.
 *
 * Usage:
 *   const { logRuntimeEnv, createRequestLogger } = require('./runtime-logger');
 *
 *   // Once per test run (in global-setup.js)
 *   logRuntimeEnv();
 *
 *   // Per-page request logging (in fixtures)
 *   const requestLogger = createRequestLogger();
 *   page.on('request', requestLogger.onRequest);
 *   page.on('response', requestLogger.onResponse);
 */

const { getBaseUrl, getEnvironment, isProduction, isStaging, isGoogleAppsScript } = require('./environments');

// Separator for visual clarity in logs
const SEPARATOR = '━'.repeat(60);
const HEADER_SEPARATOR = '═'.repeat(60);

/**
 * Extract origin (protocol + host) from URL safely
 * Never exposes query params, paths with tokens, etc.
 *
 * @param {string|URL} url - URL to extract origin from
 * @returns {string} Origin or 'unknown' if invalid
 */
function safeGetOrigin(url) {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url;
    return parsed.origin;
  } catch {
    return 'unknown';
  }
}

/**
 * Extract hostname from URL safely
 *
 * @param {string|URL} url - URL to extract host from
 * @returns {string} Hostname or 'unknown' if invalid
 */
function safeGetHost(url) {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url;
    return parsed.hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Check if URL is an API request (fetch/XHR target)
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if API-like request
 */
function isApiRequest(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();

    // API patterns to detect
    const apiPatterns = [
      '/api/',           // Standard API prefix
      '/exec',           // Google Apps Script exec endpoint
      '?p=',             // Legacy query param pattern
    ];

    // Check pathname patterns
    if (apiPatterns.some(pattern => pathname.includes(pattern))) {
      return true;
    }

    // Check query params for API indicators
    const hasApiParams = parsed.searchParams.has('p') ||
                         parsed.searchParams.has('action') ||
                         parsed.searchParams.has('page');

    return hasApiParams;
  } catch {
    return false;
  }
}

/**
 * Log runtime environment info once per test run
 * Called from global-setup.js
 *
 * Logs:
 * - Resolved BASE_URL (the actual origin tests will hit)
 * - Environment detection results
 * - CI/local indicator
 */
function logRuntimeEnv() {
  const baseUrl = getBaseUrl();
  const env = getEnvironment();
  const origin = safeGetOrigin(baseUrl);
  const host = safeGetHost(baseUrl);

  console.log('\n' + HEADER_SEPARATOR);
  console.log('  RUNTIME ENVIRONMENT (Story 1.3)');
  console.log(HEADER_SEPARATOR);
  console.log('');
  console.log(`  Resolved BASE_URL: ${origin}`);
  console.log(`  Host: ${host}`);
  console.log(`  Environment: ${env.name}`);
  console.log('');
  console.log('  Origin Detection:');
  console.log(`    Is Staging (stg.eventangle.com): ${isStaging()}`);
  console.log(`    Is Production (eventangle.com): ${isProduction()}`);
  console.log(`    Is GAS Direct (script.google.com): ${isGoogleAppsScript()}`);
  console.log('');
  console.log(`  Running in: ${process.env.CI ? 'CI' : 'Local'}`);
  console.log(HEADER_SEPARATOR + '\n');
}

/**
 * Create a request logger for per-page request tracking
 *
 * Tracks:
 * - First navigation URL
 * - First API request host
 *
 * Usage in fixtures:
 *   const logger = createRequestLogger();
 *   page.on('request', logger.onRequest);
 *   // ... after test ...
 *   logger.logSummary();
 *
 * @returns {Object} Request logger with event handlers
 */
function createRequestLogger() {
  let firstNavigation = null;
  let firstApiRequest = null;
  let hasLogged = false;

  return {
    /**
     * Handle request event
     * @param {Request} request - Playwright request object
     */
    onRequest(request) {
      const url = request.url();
      const resourceType = request.resourceType();

      // Track first document navigation
      if (!firstNavigation && resourceType === 'document') {
        firstNavigation = {
          url: safeGetOrigin(url),
          host: safeGetHost(url),
          timestamp: Date.now()
        };
      }

      // Track first API request (XHR/Fetch)
      if (!firstApiRequest && (resourceType === 'fetch' || resourceType === 'xhr')) {
        // Verify it's actually an API call, not a static resource
        if (isApiRequest(url)) {
          firstApiRequest = {
            url: safeGetOrigin(url),
            host: safeGetHost(url),
            method: request.method(),
            timestamp: Date.now()
          };
        }
      }
    },

    /**
     * Handle response event (optional - for status logging)
     * @param {Response} response - Playwright response object
     */
    onResponse(response) {
      // Could be extended to log error responses (410, 404, 500)
      const status = response.status();
      if (status >= 400 && firstApiRequest) {
        const url = response.url();
        if (isApiRequest(url)) {
          console.log(`  [Request Logger] API Error: ${status} from ${safeGetHost(url)}`);
        }
      }
    },

    /**
     * Log summary of captured requests
     * Call after navigation/API calls complete
     */
    logSummary() {
      if (hasLogged) return; // Only log once per page
      hasLogged = true;

      console.log('\n' + SEPARATOR);
      console.log('  REQUEST TRACKING (Story 1.3)');
      console.log(SEPARATOR);

      if (firstNavigation) {
        console.log(`  First Navigation URL: ${firstNavigation.url}`);
        console.log(`  Navigation Host: ${firstNavigation.host}`);
      } else {
        console.log('  First Navigation URL: (none captured)');
      }

      if (firstApiRequest) {
        console.log(`  First API Request Host: ${firstApiRequest.host}`);
        console.log(`  First API Method: ${firstApiRequest.method}`);
      } else {
        console.log('  First API Request: (none captured)');
      }

      console.log(SEPARATOR + '\n');
    },

    /**
     * Get captured data (for assertions or debugging)
     */
    getData() {
      return {
        firstNavigation,
        firstApiRequest
      };
    },

    /**
     * Reset logger state (for reuse)
     */
    reset() {
      firstNavigation = null;
      firstApiRequest = null;
      hasLogged = false;
    }
  };
}

/**
 * Log a single request's origin (for debugging)
 *
 * @param {string} label - Label for the log
 * @param {string} url - URL to log
 */
function logRequestOrigin(label, url) {
  console.log(`  [${label}] Origin: ${safeGetOrigin(url)}, Host: ${safeGetHost(url)}`);
}

module.exports = {
  // Primary exports
  logRuntimeEnv,
  createRequestLogger,
  logRequestOrigin,

  // Utility functions (for custom logging)
  safeGetOrigin,
  safeGetHost,
  isApiRequest,

  // Constants
  SEPARATOR,
  HEADER_SEPARATOR
};
