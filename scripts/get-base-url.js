#!/usr/bin/env node
/**
 * Get Canonical Base URL for CI/CD
 *
 * This script provides the canonical base URL for tests and CI pipelines.
 * It mirrors the getBaseUrl() function in Config.gs.
 *
 * Usage in CI:
 *   BASE_URL=$(node scripts/get-base-url.js)
 *   npm run test:smoke
 *
 * Usage in Node.js:
 *   const { value, eventsUrl } = require('./scripts/get-base-url');
 */

// Canonical production URL (sync with Config.gs FRIENDLY_BASE_URL)
const CANONICAL_BASE_URL = 'https://www.eventangle.com';

// Canonical events page URL (for CI logs and marketing)
const CANONICAL_EVENTS_URL = `${CANONICAL_BASE_URL}/events`;

// Export for programmatic use
module.exports = {
  // Base domain for URL construction (tests append /status, /manage, etc.)
  value: CANONICAL_BASE_URL,

  // Canonical events URL (shown in CI logs, marketing materials)
  eventsUrl: CANONICAL_EVENTS_URL,

  // Helper to construct surface URLs
  getSurfaceUrl: (surface = 'events') => `${CANONICAL_BASE_URL}/${surface}`,

  // Helper for branded URLs
  getBrandUrl: (brand = 'root', surface = 'events') => {
    const path = brand === 'root' ? `/${surface}` : `/${brand}/${surface}`;
    return `${CANONICAL_BASE_URL}${path}`;
  }
};

// When run directly, output the canonical events URL
if (require.main === module) {
  // Output canonical events URL for CI logs
  console.log(CANONICAL_EVENTS_URL);
}
