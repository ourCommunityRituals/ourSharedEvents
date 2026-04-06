/**
 * Test Environment Configuration
 *
 * Re-exports from the canonical config/environments.js module.
 *
 * SINGLE SOURCE OF TRUTH: config/environments.js
 * All environment URLs and brand defaults are defined there.
 *
 * BASE_URL-Aware Test Configuration
 * =================================
 * Tests can run against different environments without code changes:
 *
 * Staging (stg.oursharedevents.com) - DEFAULT for tests:
 *   npm run test:smoke
 *   BASE_URL="https://stg.oursharedevents.com" npm run test:smoke
 *
 * Production (oursharedevents.com) - ONLY via explicit test:prod or deploy-validation:
 *   npm run test:prod:smoke
 *   BASE_URL="https://oursharedevents.com" npm run test:smoke
 *
 * Default (no BASE_URL set):
 *   Uses STAGING URL (stg.oursharedevents.com) for safe testing
 *
 * Environment Variables:
 *   - BASE_URL: Primary URL override (recommended)
 *   - TEST_ENV: Environment name (production, qa, staging, local)
 *   - USE_PRODUCTION: Set to 'true' to explicitly use production URL
 */

// =============================================================================
// Re-export from canonical environment config
// =============================================================================

const envConfig = require('../../config/environments');

// Re-export everything from the canonical config
module.exports = {
  // Environment map
  ENVIRONMENTS: envConfig.ENVIRONMENTS,

  // Brand constants
  BRANDS: envConfig.BRANDS,
  DEFAULT_BRAND: envConfig.DEFAULT_BRAND,

  // URL constants
  PRODUCTION_URL: envConfig.PRODUCTION_URL,
  STAGING_URL: envConfig.STAGING_URL,
  QA_URL: envConfig.QA_URL,
  LOCAL_URL: envConfig.LOCAL_URL,

  // Primary functions
  getEnvironment: envConfig.getEnvironment,
  getBaseUrl: envConfig.getBaseUrl,
  getBrandUrl: envConfig.getBrandUrl,
  getAllBrandUrls: envConfig.getAllBrandUrls,
  getUrlWithParams: envConfig.getUrlWithParams,

  // Environment detection helpers
  isProduction: envConfig.isProduction,
  isStaging: envConfig.isStaging,
  detectEnvironmentFromUrl: envConfig.detectEnvironmentFromUrl,

  // Debugging
  printEnvironmentInfo: envConfig.printEnvironmentInfo,

  // Legacy aliases (backward compatibility)
  getCurrentEnvironment: envConfig.getEnvironment,
  APP_URL: envConfig.getBaseUrl(),
  DEFAULT_PRODUCTION_URL: envConfig.PRODUCTION_URL,
  DEFAULT_STAGING_URL: envConfig.STAGING_URL,
  CANONICAL_EVENTS_URL: `${envConfig.PRODUCTION_URL}/events`,
  CANONICAL_STAGING_URL: `${envConfig.STAGING_URL}/events`,
  isEventangle: envConfig.isProduction,
};
