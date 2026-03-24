/**
 * Test Environment Configuration
 *
 * This module re-exports from the canonical config/environments.js module
 * and adds test-specific functionality.
 *
 * SINGLE SOURCE OF TRUTH: config/environments.js
 * All environment URLs and brand defaults are defined there.
 *
 * BASE_URL-Aware Test Configuration
 * =================================
 * Tests can run against different environments without code changes:
 *
 * Staging (stg.eventangle.com) - DEFAULT for tests:
 *   npm run test:smoke
 *   BASE_URL="https://stg.eventangle.com" npm run test:smoke
 *
 * Production (eventangle.com) - ONLY via explicit test:prod or deploy-validation:
 *   npm run test:prod:smoke
 *   BASE_URL="https://www.eventangle.com" npm run test:smoke
 *
 * GAS Webapp (direct - for debugging):
 *   BASE_URL="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" npm run test:smoke
 *
 * Default (no BASE_URL set):
 *   Uses STAGING URL (stg.eventangle.com) for safe testing
 *
 * Environment Variables:
 *   - BASE_URL: Primary URL override (recommended)
 *   - APP_URL: Alias for BASE_URL (deprecated, use BASE_URL)
 *   - TEST_ENV: Environment name (production, googleAppsScript, qa, staging, local)
 *   - GOOGLE_SCRIPT_URL: Direct GAS URL override
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
  GAS_PRODUCTION_URL: envConfig.GAS_PRODUCTION_URL,
  GAS_STAGING_URL: envConfig.GAS_STAGING_URL,

  // Deployment IDs
  PRODUCTION_DEPLOYMENT_ID: envConfig.PRODUCTION_DEPLOYMENT_ID,
  STAGING_DEPLOYMENT_ID: envConfig.STAGING_DEPLOYMENT_ID,

  // Primary functions
  getEnvironment: envConfig.getEnvironment,
  getBaseUrl: envConfig.getBaseUrl,
  getBrandUrl: envConfig.getBrandUrl,
  getAllBrandUrls: envConfig.getAllBrandUrls,
  getUrlWithParams: envConfig.getUrlWithParams,

  // Environment detection helpers
  isGoogleAppsScript: envConfig.isGoogleAppsScript,
  isProduction: envConfig.isProduction,
  isStaging: envConfig.isStaging,
  detectEnvironmentFromUrl: envConfig.detectEnvironmentFromUrl,

  // Debugging
  printEnvironmentInfo: envConfig.printEnvironmentInfo,

  // Legacy aliases (backward compatibility)
  getCurrentEnvironment: envConfig.getEnvironment,
  APP_URL: envConfig.getBaseUrl(),
  DEFAULT_GAS_URL: envConfig.GAS_PRODUCTION_URL,
  DEFAULT_DEPLOYMENT_ID: envConfig.PRODUCTION_DEPLOYMENT_ID,
  DEFAULT_PRODUCTION_URL: envConfig.PRODUCTION_URL,
  DEFAULT_STAGING_URL: envConfig.STAGING_URL,
  STAGING_GAS_URL: envConfig.GAS_STAGING_URL,
  CANONICAL_EVENTS_URL: `${envConfig.PRODUCTION_URL}/events`,
  CANONICAL_STAGING_URL: `${envConfig.STAGING_URL}/events`,
  isEventangle: envConfig.isProduction
};
