/**
 * Feature Flags Configuration - Single Source of Truth
 *
 * Story 1.4 (PO): This module provides unified feature flag management for
 * both staging and production environments. Feature flags are read from
 * deploy-manifest.json with environment-specific defaults.
 *
 * Design Principles:
 *   - Staging: Testing features ON by default for UAT validation
 *   - Production: Testing features OFF by default for security/performance
 *   - MVP features: Always ON in both environments (parity required)
 *   - V2 features: Always OFF in both until explicitly approved
 *
 * Usage:
 *   const { isFeatureEnabled, getFeatureFlags, getEnvironmentFlags } = require('../config/feature-flags');
 *
 *   // Check a specific feature
 *   if (isFeatureEnabled('DEMO_MODE_ENABLED')) { ... }
 *
 *   // Get all flags for current environment
 *   const flags = getFeatureFlags();
 *
 * @module config/feature-flags
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// MANIFEST LOADING
// =============================================================================

/**
 * Load the deployment manifest
 * @returns {Object|null} Parsed manifest or null if not found
 */
function loadManifest() {
  try {
    const manifestPath = path.join(__dirname, '..', 'deploy-manifest.json');
    if (fs.existsSync(manifestPath)) {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
  } catch (error) {
    console.warn('Failed to load deploy-manifest.json:', error.message);
  }
  return null;
}

const manifest = loadManifest();

// =============================================================================
// ENVIRONMENT DETECTION
// =============================================================================

/**
 * Detect the current environment
 * Priority: TEST_ENV > USE_PRODUCTION > BASE_URL detection > default (staging)
 * @returns {'staging'|'production'} Current environment
 */
function detectEnvironment() {
  // Explicit environment variable
  const testEnv = process.env.TEST_ENV;
  if (testEnv === 'production' || testEnv === 'staging') {
    return testEnv;
  }

  // USE_PRODUCTION flag
  if (process.env.USE_PRODUCTION === 'true') {
    return 'production';
  }

  // Detect from BASE_URL using proper URL parsing to avoid hostname spoofing
  const baseUrl = process.env.BASE_URL || process.env.APP_URL || '';
  if (baseUrl) {
    try {
      const parsedUrl = new URL(baseUrl);
      const hostname = parsedUrl.hostname.toLowerCase();

      // Check for staging hostname (must be exact match)
      if (hostname === 'stg.eventangle.com' || hostname === 'api-stg.eventangle.com') {
        return 'staging';
      }

      // Check for production hostname (must be exact match)
      if (hostname === 'eventangle.com' || hostname === 'www.eventangle.com' || hostname === 'api.eventangle.com') {
        return 'production';
      }
    } catch {
      // Invalid URL format - fall through to default
    }
  }

  // Default to staging (safe sandbox)
  return 'staging';
}

// =============================================================================
// DEFAULT FEATURE FLAGS
// =============================================================================

/**
 * Default feature flags when manifest is not available
 * These defaults prioritize safety: staging gets testing features, production doesn't
 */
const DEFAULT_FLAGS = {
  staging: {
    mvpFeatures: {
      EVENTS: true,
      SPONSORS: true,
      ANALYTICS: true,
      FORMS: true,
      SHORTLINKS: true,
      PORTFOLIO_ANALYTICS: true
    },
    testingFeatures: {
      DEMO_MODE_ENABLED: true,
      DEBUG_PANEL: true,
      API_TIMING_LOGS: true,
      ERROR_DETAILS: true,
      SAMPLE_DATA_PREFILL: true,
      FEATURE_HIGHLIGHTING: true,
      CONSOLE_LOGGING: true
    },
    v2Features: {
      TEMPLATE_MANAGEMENT_V2: false,
      PORTFOLIO_V2: false
    },
    experimentalFeatures: {
      NEW_UI_COMPONENTS: true,
      ENHANCED_VALIDATION: true,
      PERFORMANCE_MONITORING: true
    }
  },
  production: {
    mvpFeatures: {
      EVENTS: true,
      SPONSORS: true,
      ANALYTICS: true,
      FORMS: true,
      SHORTLINKS: true,
      PORTFOLIO_ANALYTICS: true
    },
    testingFeatures: {
      DEMO_MODE_ENABLED: false,
      DEBUG_PANEL: false,
      API_TIMING_LOGS: false,
      ERROR_DETAILS: false,
      SAMPLE_DATA_PREFILL: false,
      FEATURE_HIGHLIGHTING: false,
      CONSOLE_LOGGING: false
    },
    v2Features: {
      TEMPLATE_MANAGEMENT_V2: false,
      PORTFOLIO_V2: false
    },
    experimentalFeatures: {
      NEW_UI_COMPONENTS: false,
      ENHANCED_VALIDATION: false,
      PERFORMANCE_MONITORING: false
    }
  }
};

// =============================================================================
// FEATURE FLAG ACCESS
// =============================================================================

/**
 * Get all feature flags for a specific environment
 * @param {'staging'|'production'} [env] - Environment (defaults to detected)
 * @returns {Object} All feature flags grouped by category
 */
function getFeatureFlagsForEnv(env) {
  const targetEnv = env || detectEnvironment();

  // Try to read from manifest
  if (manifest && manifest.environments && manifest.environments[targetEnv]) {
    const envConfig = manifest.environments[targetEnv];
    if (envConfig.featureFlags) {
      return envConfig.featureFlags;
    }
  }

  // Fallback to defaults
  return DEFAULT_FLAGS[targetEnv] || DEFAULT_FLAGS.staging;
}

/**
 * Get feature flags for the current environment
 * @returns {Object} Feature flags for current environment
 */
function getFeatureFlags() {
  return getFeatureFlagsForEnv(detectEnvironment());
}

/**
 * Get a flat map of all feature flags (no categories)
 * @param {'staging'|'production'} [env] - Environment (defaults to detected)
 * @returns {Object} Flat key-value map of feature flags
 */
function getFlatFeatureFlags(env) {
  const flags = getFeatureFlagsForEnv(env);
  const flat = {};

  for (const category of Object.keys(flags)) {
    if (category.startsWith('_')) continue; // Skip comments
    const categoryFlags = flags[category];
    if (typeof categoryFlags === 'object') {
      for (const [key, value] of Object.entries(categoryFlags)) {
        if (!key.startsWith('_')) {
          flat[key] = value;
        }
      }
    }
  }

  return flat;
}

/**
 * Check if a specific feature is enabled
 * @param {string} featureName - Feature name (e.g., 'DEMO_MODE_ENABLED')
 * @param {'staging'|'production'} [env] - Environment (defaults to detected)
 * @returns {boolean} True if feature is enabled
 */
function isFeatureEnabled(featureName, env) {
  const flat = getFlatFeatureFlags(env);
  return flat[featureName] === true;
}

/**
 * Check if a feature is enabled with environment variable override
 * Environment variables take precedence over manifest values
 * @param {string} featureName - Feature name
 * @returns {boolean} True if feature is enabled
 */
function isFeatureEnabledWithOverride(featureName) {
  // Check for environment variable override (FEATURE_FLAG_<NAME>=true|false)
  const envVar = process.env[`FEATURE_FLAG_${featureName}`];
  if (envVar !== undefined) {
    return envVar === 'true' || envVar === '1';
  }

  return isFeatureEnabled(featureName);
}

/**
 * Get the category of a feature flag
 * @param {string} featureName - Feature name
 * @returns {string|null} Category name or null if not found
 */
function getFeatureCategory(featureName) {
  const flags = getFeatureFlags();
  for (const category of Object.keys(flags)) {
    if (category.startsWith('_')) continue;
    const categoryFlags = flags[category];
    if (typeof categoryFlags === 'object' && featureName in categoryFlags) {
      return category;
    }
  }
  return null;
}

// =============================================================================
// ENVIRONMENT FLAG HELPERS
// =============================================================================

/**
 * Get environment-specific configuration flags
 * @param {'staging'|'production'} [env] - Environment (defaults to detected)
 * @returns {Object} Environment flags (debugLevel, enableDebugEndpoints, etc.)
 */
function getEnvironmentFlags(env) {
  const targetEnv = env || detectEnvironment();

  if (manifest && manifest.environments && manifest.environments[targetEnv]) {
    return manifest.environments[targetEnv].flags || {};
  }

  // Defaults
  return targetEnv === 'production'
    ? { workerEnv: 'production', debugLevel: 'error', enableDebugEndpoints: false }
    : { workerEnv: 'staging', debugLevel: 'debug', enableDebugEndpoints: true };
}

/**
 * Check if debug mode is enabled for current environment
 * @returns {boolean} True if debug mode is enabled
 */
function isDebugEnabled() {
  const flags = getEnvironmentFlags();
  return flags.debugLevel === 'debug' || flags.debugLevel === 'info';
}

/**
 * Check if debug endpoints are enabled
 * @returns {boolean} True if debug endpoints are enabled
 */
function areDebugEndpointsEnabled() {
  const flags = getEnvironmentFlags();
  return flags.enableDebugEndpoints === true;
}

// =============================================================================
// PARITY CHECKING
// =============================================================================

/**
 * Compare feature flags between staging and production
 * @returns {Object} Comparison result with matches, differences, and status
 */
function compareEnvironmentFlags() {
  const staging = getFlatFeatureFlags('staging');
  const production = getFlatFeatureFlags('production');

  const result = {
    matches: [],
    intentionalDifferences: [],
    unexpectedDifferences: [],
    stagingOnly: [],
    productionOnly: []
  };

  // Define which flags are expected to differ
  const expectedDifferences = new Set([
    'DEMO_MODE_ENABLED',
    'DEBUG_PANEL',
    'API_TIMING_LOGS',
    'ERROR_DETAILS',
    'SAMPLE_DATA_PREFILL',
    'FEATURE_HIGHLIGHTING',
    'CONSOLE_LOGGING',
    'NEW_UI_COMPONENTS',
    'ENHANCED_VALIDATION',
    'PERFORMANCE_MONITORING'
  ]);

  // Get all keys
  const allKeys = new Set([...Object.keys(staging), ...Object.keys(production)]);

  for (const key of allKeys) {
    const inStaging = key in staging;
    const inProduction = key in production;

    if (!inStaging) {
      result.productionOnly.push(key);
    } else if (!inProduction) {
      result.stagingOnly.push(key);
    } else if (staging[key] === production[key]) {
      result.matches.push({ key, value: staging[key] });
    } else if (expectedDifferences.has(key)) {
      result.intentionalDifferences.push({
        key,
        staging: staging[key],
        production: production[key],
        reason: 'Testing/experimental feature'
      });
    } else {
      result.unexpectedDifferences.push({
        key,
        staging: staging[key],
        production: production[key]
      });
    }
  }

  result.parityStatus = result.unexpectedDifferences.length === 0 &&
                        result.stagingOnly.length === 0 &&
                        result.productionOnly.length === 0
    ? 'PASS'
    : 'REVIEW_REQUIRED';

  return result;
}

// =============================================================================
// DEBUGGING & INSPECTION
// =============================================================================

/**
 * Print feature flag configuration to console
 */
function printFeatureFlagInfo() {
  const env = detectEnvironment();
  const flags = getFeatureFlags();
  const envFlags = getEnvironmentFlags();

  console.log('\n==============================================');
  console.log('Feature Flags Configuration (Story 1.4)');
  console.log('==============================================');
  console.log(`Environment: ${env}`);
  console.log(`Debug Level: ${envFlags.debugLevel}`);
  console.log(`Debug Endpoints: ${envFlags.enableDebugEndpoints}`);
  console.log('');

  for (const [category, categoryFlags] of Object.entries(flags)) {
    if (category.startsWith('_')) continue;
    console.log(`[${category}]`);
    if (typeof categoryFlags === 'object') {
      for (const [key, value] of Object.entries(categoryFlags)) {
        if (!key.startsWith('_')) {
          console.log(`  ${key}: ${value}`);
        }
      }
    }
    console.log('');
  }
  console.log('==============================================\n');
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Environment detection
  detectEnvironment,

  // Feature flag access
  getFeatureFlags,
  getFeatureFlagsForEnv,
  getFlatFeatureFlags,
  isFeatureEnabled,
  isFeatureEnabledWithOverride,
  getFeatureCategory,

  // Environment flags
  getEnvironmentFlags,
  isDebugEnabled,
  areDebugEndpointsEnabled,

  // Parity checking
  compareEnvironmentFlags,

  // Debugging
  printFeatureFlagInfo,

  // Constants
  DEFAULT_FLAGS
};
