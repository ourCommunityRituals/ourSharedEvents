/**
 * Environment Configuration - Single Source of Truth
 *
 * This module defines the canonical environment URLs and brand defaults for
 * dev, staging, and production environments. All Node tests, Playwright tests,
 * and contract tests should import from this module.
 *
 * Story 1.4 (PO): Configuration parity - This module now integrates with
 * deploy-manifest.json and feature-flags.js for unified configuration.
 *
 * Environment Priority:
 *   1. Environment variables (BASE_URL, TEST_ENV)
 *   2. Manifest values (deploy-manifest.json)
 *   3. Default values defined here
 *
 * Usage:
 *   const { getBaseUrl, getEnvironment, ENVIRONMENTS, isFeatureEnabled } = require('../config/environments');
 *   const BASE_URL = getBaseUrl(); // Returns current environment URL
 *   if (isFeatureEnabled('DEMO_MODE_ENABLED')) { ... }
 *
 * @module config/environments
 */

// =============================================================================
// Deployment IDs - Import from canonical source
// =============================================================================
const {
  // Staging identifiers
  STAGING_SCRIPT_ID,
  STAGING_DEPLOYMENT_ID,
  STAGING_WEB_APP_URL,
  STAGING_GAS_EDIT_URL,

  // Production identifiers
  PROD_SCRIPT_ID,
  PROD_DEPLOYMENT_ID,
  PROD_WEB_APP_URL,
  PROD_GAS_EDIT_URL,
} = require('./deployment-ids');

// Legacy aliases for backward compatibility
const PRODUCTION_DEPLOYMENT_ID = PROD_DEPLOYMENT_ID;

// =============================================================================
// Environment URLs - Single Source of Truth
// =============================================================================

/**
 * Production URL - eventangle.com via Cloudflare Workers
 * This is the customer-facing production environment.
 */
const PRODUCTION_URL = 'https://www.eventangle.com';

/**
 * Staging URL - stg.eventangle.com via Cloudflare Workers
 * DEFAULT for all test commands. Safe sandbox for testing.
 */
const STAGING_URL = 'https://stg.eventangle.com';

/**
 * OurSharedEvents staging URL - stg.oursharedevents.com via Cloudflare Workers
 */
const OUR_SHARED_EVENTS_STAGING_URL = 'https://stg.oursharedevents.com';

/**
 * OurSharedEvents production URL - oursharedevents.com via Cloudflare Workers
 */
const OUR_SHARED_EVENTS_PROD_URL = 'https://oursharedevents.com';

/**
 * QA URL - zeventbooks.com via Cloudflare Workers
 * Secondary testing environment.
 */
const QA_URL = 'https://zeventbooks.com';

/**
 * Local development URL
 */
const LOCAL_URL = 'http://localhost:3000';

// Legacy GAS URL stubs (archived — kept for backward compatibility)
const GAS_PRODUCTION_URL = '';
const GAS_STAGING_URL = '';

// =============================================================================
// Brand Configuration
// =============================================================================

/**
 * Import brand constants from centralized source of truth
 * @see config/brand-config.js
 */
const { BRANDS: VALID_BRANDS, DEFAULT_BRAND } = require('./brand-config');

// =============================================================================
// Environment Definitions
// =============================================================================

/**
 * Environment configuration map
 * Each environment includes its base URL, description, and available brands.
 */
const ENVIRONMENTS = Object.freeze({
  /**
   * Production - Customer-facing via Cloudflare
   * URL: https://www.eventangle.com
   * Deploy: CI only (git push to main)
   */
  production: {
    name: 'Production',
    baseUrl: PRODUCTION_URL,
    description: 'Production via Cloudflare Workers (eventangle.com)',
    gasUrl: GAS_PRODUCTION_URL,
    deploymentId: PRODUCTION_DEPLOYMENT_ID,
    brands: VALID_BRANDS,
    isDefault: false,
  },

  /**
   * Staging - Safe sandbox for testing (DEFAULT)
   * URL: https://stg.eventangle.com
   * Deploy: npm run deploy:staging
   */
  staging: {
    name: 'Staging',
    baseUrl: STAGING_URL,
    description: 'Staging via Cloudflare Workers (stg.eventangle.com)',
    gasUrl: GAS_STAGING_URL,
    deploymentId: STAGING_DEPLOYMENT_ID,
    brands: VALID_BRANDS,
    isDefault: true,
  },

  /**
   * OurSharedEvents Staging - stg.oursharedevents.com
   * URL: https://stg.oursharedevents.com
   */
  ourSharedEventsStaging: {
    name: 'OurSharedEvents Staging',
    baseUrl: OUR_SHARED_EVENTS_STAGING_URL,
    description: 'OurSharedEvents staging via Cloudflare Workers (stg.oursharedevents.com)',
    brands: VALID_BRANDS,
    isDefault: false,
  },

  /**
   * OurSharedEvents Production - oursharedevents.com
   * URL: https://oursharedevents.com
   */
  ourSharedEvents: {
    name: 'OurSharedEvents Production',
    baseUrl: OUR_SHARED_EVENTS_PROD_URL,
    description: 'OurSharedEvents production via Cloudflare Workers (oursharedevents.com)',
    brands: VALID_BRANDS,
    isDefault: false,
  },

  /**
   * QA - Secondary testing environment
   * URL: https://zeventbooks.com
   */
  qa: {
    name: 'QA',
    baseUrl: QA_URL,
    description: 'QA environment via Cloudflare Workers (zeventbooks.com)',
    brands: VALID_BRANDS,
    isDefault: false,
  },

  /**
   * Local - Development server
   * URL: http://localhost:3000
   */
  local: {
    name: 'Local Development',
    baseUrl: LOCAL_URL,
    description: 'Local development server',
    brands: VALID_BRANDS,
    isDefault: false,
  },
});

// =============================================================================
// Environment Detection & Helpers
// =============================================================================

/**
 * Get the default environment (staging for safety)
 * @returns {Object} Default environment configuration
 */
function getDefaultEnvironment() {
  return process.env.USE_PRODUCTION === 'true'
    ? { ...ENVIRONMENTS.production }
    : { ...ENVIRONMENTS.staging };
}

/**
 * Detect environment from a URL
 * @param {string} url - URL to analyze
 * @returns {Object|null} Matching environment or null
 */
function detectEnvironmentFromUrl(url) {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;

    if (hostname === 'stg.eventangle.com' || hostname === 'api-stg.eventangle.com') {
      return { ...ENVIRONMENTS.staging, baseUrl: url };
    }

    if (hostname === 'eventangle.com' || hostname === 'www.eventangle.com') {
      return { ...ENVIRONMENTS.production, baseUrl: url };
    }

    if (hostname === 'stg.oursharedevents.com') {
      return { ...ENVIRONMENTS.ourSharedEventsStaging, baseUrl: url };
    }

    if (hostname === 'oursharedevents.com' || hostname === 'www.oursharedevents.com') {
      return { ...ENVIRONMENTS.ourSharedEvents, baseUrl: url };
    }

    if (
      hostname === 'zeventbooks.com' ||
      hostname === 'www.zeventbooks.com' ||
      hostname === 'qa.zeventbooks.com'
    ) {
      return { ...ENVIRONMENTS.qa, baseUrl: url };
    }

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return { ...ENVIRONMENTS.local, baseUrl: url };
    }

    // Unknown URL - create custom environment
    return {
      name: 'Custom',
      baseUrl: url,
      description: 'Custom environment',
      brands: VALID_BRANDS,
      isDefault: false,
    };
  } catch (_error) {
    console.warn(`Invalid URL format: ${url}`);
    return null;
  }
}

/**
 * Get the current environment based on environment variables
 *
 * Priority:
 *   1. TEST_ENV explicitly set -> use that environment
 *   2. BASE_URL set -> detect environment from URL
 *   3. USE_PRODUCTION=true -> production
 *   4. Default -> staging (safe sandbox)
 *
 * @returns {Object} Current environment configuration
 */
function getEnvironment() {
  const testEnv = process.env.TEST_ENV;
  const baseUrl = process.env.BASE_URL || process.env.APP_URL;

  // If TEST_ENV is explicitly set, use that environment
  if (testEnv && ENVIRONMENTS[testEnv]) {
    const env = { ...ENVIRONMENTS[testEnv] };
    // Override with BASE_URL if provided
    if (baseUrl) {
      env.baseUrl = baseUrl;
    }
    return env;
  }

  // If BASE_URL is set, detect environment from it
  if (baseUrl) {
    const detected = detectEnvironmentFromUrl(baseUrl);
    if (detected) {
      return detected;
    }
  }

  // Default to staging (safe sandbox) or production if explicitly requested
  return getDefaultEnvironment();
}

/**
 * Get the base URL for the current environment
 * This is the primary function tests should use.
 *
 * @returns {string} Base URL for API requests
 */
function getBaseUrl() {
  return getEnvironment().baseUrl;
}

/**
 * Get URL for a specific brand and page using friendly URL patterns
 *
 * @param {string} brand - Brand ID (root, abc, cbc, cbl)
 * @param {string} page - Page name (status, manage, events, display, etc.)
 * @returns {string} Full URL for the brand/page
 */
function getBrandUrl(brand = 'root', page = 'status') {
  const env = getEnvironment();
  const pageAliasMap = {
    admin: 'manage',
    public: 'events',
  };
  const alias = pageAliasMap[page] || page;
  const path = brand === 'root' ? `/${alias}` : `/${brand}/${alias}`;
  return `${env.baseUrl}${path}`;
}

/**
 * Get all brand URLs for a specific page
 *
 * @param {string} page - Page name
 * @returns {Object} Map of brand ID to URL
 */
function getAllBrandUrls(page = 'status') {
  const urls = {};
  VALID_BRANDS.forEach((brand) => {
    urls[brand] = getBrandUrl(brand, page);
  });
  return urls;
}

/**
 * Check if current environment is OurSharedEvents (oursharedevents.com)
 * @returns {boolean} True if testing against oursharedevents.com
 */
function isOurSharedEvents() {
  const env = getEnvironment();
  try {
    const url = new URL(env.baseUrl);
    return (
      url.hostname === 'oursharedevents.com' ||
      url.hostname === 'www.oursharedevents.com' ||
      url.hostname === 'stg.oursharedevents.com'
    );
  } catch {
    return false;
  }
}

/**
 * Check if current environment is production (eventangle.com)
 * @returns {boolean} True if testing against production
 */
function isProduction() {
  const env = getEnvironment();
  try {
    const url = new URL(env.baseUrl);
    return url.hostname === 'eventangle.com' || url.hostname === 'www.eventangle.com';
  } catch {
    return false;
  }
}

/**
 * Check if current environment is staging
 * @returns {boolean} True if testing against staging
 */
function isStaging() {
  const env = getEnvironment();
  try {
    const url = new URL(env.baseUrl);
    return url.hostname === 'stg.eventangle.com';
  } catch {
    return false;
  }
}

/**
 * Build URL with query parameters
 *
 * @param {Object} params - Query parameters
 * @returns {string} Full URL with parameters
 */
function getUrlWithParams(params = {}) {
  const baseUrl = getBaseUrl();
  const url = new URL(baseUrl);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

/**
 * Print environment configuration (for debugging/CI logs)
 */
function printEnvironmentInfo() {
  const env = getEnvironment();
  console.log('\n==============================================');
  console.log('Environment Configuration');
  console.log('==============================================');
  console.log(`Environment: ${env.name}`);
  console.log(`Description: ${env.description}`);
  console.log(`Base URL: ${env.baseUrl}`);
  console.log(`Is Default: ${env.isDefault}`);
  console.log(`Brands: ${env.brands.join(', ')}`);
  console.log('\nBrand URLs (status page):');
  VALID_BRANDS.forEach((brand) => {
    console.log(`  ${brand}: ${getBrandUrl(brand, 'status')}`);
  });
  console.log('==============================================\n');
}

// =============================================================================
// Feature Flags Integration (Story 1.4)
// =============================================================================
// Re-export feature flags from the dedicated module for convenience

const featureFlags = require('./feature-flags');

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // Environment map
  ENVIRONMENTS,

  // Brand constants (VALID_BRANDS exported as BRANDS for backward compatibility)
  BRANDS: VALID_BRANDS,
  DEFAULT_BRAND,

  // URL constants
  PRODUCTION_URL,
  STAGING_URL,
  OUR_SHARED_EVENTS_STAGING_URL,
  OUR_SHARED_EVENTS_PROD_URL,
  QA_URL,
  LOCAL_URL,
  GAS_PRODUCTION_URL,
  GAS_STAGING_URL,

  // Deployment IDs (standardized naming)
  STAGING_SCRIPT_ID,
  STAGING_DEPLOYMENT_ID,
  STAGING_WEB_APP_URL,
  STAGING_GAS_EDIT_URL,
  PROD_SCRIPT_ID,
  PROD_DEPLOYMENT_ID,
  PROD_WEB_APP_URL,
  PROD_GAS_EDIT_URL,

  // Legacy aliases
  PRODUCTION_DEPLOYMENT_ID,

  // Primary functions for tests
  getEnvironment,
  getBaseUrl,
  getBrandUrl,
  getAllBrandUrls,
  getUrlWithParams,

  // Environment detection helpers
  isProduction,
  isStaging,
  isOurSharedEvents,
  detectEnvironmentFromUrl,

  // Debugging
  printEnvironmentInfo,

  // Legacy aliases (for backward compatibility with test code)
  getCurrentEnvironment: getEnvironment,
  APP_URL: getBaseUrl(),
  DEFAULT_GAS_URL: GAS_PRODUCTION_URL,
  DEFAULT_DEPLOYMENT_ID: PRODUCTION_DEPLOYMENT_ID,
  DEFAULT_PRODUCTION_URL: PRODUCTION_URL,
  DEFAULT_STAGING_URL: STAGING_URL,
  CANONICAL_EVENTS_URL: `${PRODUCTION_URL}/events`,
  CANONICAL_STAGING_URL: `${STAGING_URL}/events`,
  isEventangle: isProduction,

  // Feature Flags (Story 1.4) - Re-exported from feature-flags.js
  isFeatureEnabled: featureFlags.isFeatureEnabled,
  isFeatureEnabledWithOverride: featureFlags.isFeatureEnabledWithOverride,
  getFeatureFlags: featureFlags.getFeatureFlags,
  getFlatFeatureFlags: featureFlags.getFlatFeatureFlags,
  getEnvironmentFlags: featureFlags.getEnvironmentFlags,
  isDebugEnabled: featureFlags.isDebugEnabled,
  areDebugEndpointsEnabled: featureFlags.areDebugEndpointsEnabled,
  compareEnvironmentFlags: featureFlags.compareEnvironmentFlags,
};
