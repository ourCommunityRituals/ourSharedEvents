/**
 * Per-Brand Test Configuration
 *
 * Re-exports brand configuration from the centralized source of truth.
 * This file provides test-specific utilities and maintains backward compatibility.
 *
 * Centralized Source: config/brand-config.js
 *
 * Environment Variables:
 *   SPREADSHEET_ID       - Shared spreadsheet for all brands (fallback)
 *   SPREADSHEET_ID_ROOT  - Dedicated spreadsheet for root brand
 *   SPREADSHEET_ID_ABC   - Dedicated spreadsheet for ABC brand
 *   SPREADSHEET_ID_CBC   - Dedicated spreadsheet for CBC brand
 *   SPREADSHEET_ID_CBL   - Dedicated spreadsheet for CBL brand
 *
 *   ADMIN_KEY            - Shared admin key for all brands (fallback)
 *   ADMIN_KEY_ROOT       - Dedicated admin key for root brand
 *   ADMIN_KEY_ABC        - Dedicated admin key for ABC brand
 *   ADMIN_KEY_CBC        - Dedicated admin key for CBC brand
 *   ADMIN_KEY_CBL        - Dedicated admin key for CBL brand
 *
 * Priority: Brand-specific > Shared > Default
 */

// Import from centralized source of truth
const centralConfig = require('../../../config/brand-config');
const { getEnvironment } = require('../../../config/environments');

// Re-export core constants from centralized config
const { BRANDS, DEFAULT_SPREADSHEET_ID } = centralConfig;

/**
 * Get configuration for a specific brand (test-enhanced version)
 *
 * Adds baseUrl from environment config on top of central brand config.
 *
 * @param {string} brandId - Brand ID (root, abc, cbc, cbl)
 * @returns {Object} Brand configuration with baseUrl
 */
function getBrandConfig(brandId) {
  const config = centralConfig.getBrandConfig(brandId);

  // Add baseUrl from environment config
  let baseUrl;
  try {
    const env = getEnvironment();
    baseUrl = env?.baseUrl || process.env.BASE_URL || 'https://stg.eventangle.com';
  } catch {
    baseUrl = process.env.BASE_URL || 'https://stg.eventangle.com';
  }

  return {
    ...config,
    baseUrl
  };
}

/**
 * Get configurations for all brands (test-enhanced version)
 *
 * @returns {Object} Map of brand ID to configuration
 */
function getAllBrandConfigs() {
  const configs = {};
  BRANDS.forEach(brandId => {
    configs[brandId] = getBrandConfig(brandId);
  });
  return configs;
}

/**
 * Get list of brands that are fully configured (have admin key)
 *
 * @returns {string[]} Array of configured brand IDs
 */
function getConfiguredBrands() {
  return BRANDS.filter(brandId => getBrandConfig(brandId).hasAdminKey);
}

/**
 * Get list of brands with dedicated spreadsheets
 *
 * @returns {string[]} Array of brand IDs with dedicated spreadsheets
 */
function getBrandsWithDedicatedSpreadsheets() {
  return BRANDS.filter(brandId => getBrandConfig(brandId).hasDedicatedSpreadsheet);
}

/**
 * Check if a brand is configured for testing
 *
 * @param {string} brandId - Brand ID to check
 * @returns {boolean} True if brand has admin key configured
 */
function isBrandConfigured(brandId) {
  return getBrandConfig(brandId).hasAdminKey;
}

/**
 * Run a test function for each brand
 * Useful for parameterized testing across all brands
 *
 * @param {Function} testFn - Test function(brandConfig) to run
 * @param {Object} options - Options
 * @param {boolean} options.onlyConfigured - Only run for brands with admin keys
 * @param {string[]} options.brands - Specific brands to run for
 */
function forEachBrand(testFn, options = {}) {
  const { onlyConfigured = false, brands = null } = options;

  let brandsToTest = brands || [...BRANDS];

  if (onlyConfigured) {
    brandsToTest = brandsToTest.filter(brandId =>
      getBrandConfig(brandId).hasAdminKey
    );
  }

  return brandsToTest.map(brandId => ({
    brandId,
    config: getBrandConfig(brandId),
    run: () => testFn(getBrandConfig(brandId))
  }));
}

/**
 * Create test matrix for Jest describe.each or it.each
 *
 * @param {Object} options - Options
 * @param {boolean} options.onlyConfigured - Only include configured brands
 * @returns {Array} Array of [brandId, config] tuples for .each()
 */
function createBrandTestMatrix(options = {}) {
  const { onlyConfigured = false } = options;

  let brandsToTest = [...BRANDS];

  if (onlyConfigured) {
    brandsToTest = brandsToTest.filter(brandId =>
      getBrandConfig(brandId).hasAdminKey
    );
  }

  return brandsToTest.map(brandId => [brandId, getBrandConfig(brandId)]);
}

/**
 * Print brand configuration summary (for debugging)
 */
function printBrandConfigSummary() {
  console.log('\n=== Brand Test Configuration ===\n');

  console.log('Environment:');
  console.log(`  BASE_URL: ${process.env.BASE_URL || '(not set)'}`);
  console.log(`  SPREADSHEET_ID (shared): ${process.env.SPREADSHEET_ID || '(not set)'}`);
  console.log(`  ADMIN_KEY (shared): ${process.env.ADMIN_KEY ? '****' : '(not set)'}`);
  console.log('');

  console.log('Per-Brand Configuration:');
  BRANDS.forEach(brandId => {
    const config = getBrandConfig(brandId);
    const spreadsheetStatus = config.hasDedicatedSpreadsheet ? 'dedicated' : 'shared';
    const adminStatus = config.hasAdminKey ? '****' : '(not set)';
    console.log(`  ${brandId.toUpperCase()} (${config.brandName}):`);
    console.log(`    Spreadsheet: ${config.spreadsheetId.substring(0, 20)}... (${spreadsheetStatus})`);
    console.log(`    Admin Key: ${adminStatus}`);
  });

  console.log('');
  console.log(`Configured brands: ${getConfiguredBrands().join(', ') || 'none'}`);
  console.log(`Brands with dedicated spreadsheets: ${getBrandsWithDedicatedSpreadsheets().join(', ') || 'none'}`);
  console.log('\n=== End Configuration ===\n');
}

module.exports = {
  // Constants (from centralized source)
  BRANDS,
  DEFAULT_SPREADSHEET_ID,

  // Centralized metadata access
  BRAND_METADATA: centralConfig.BRAND_METADATA,
  getBrandMetadata: centralConfig.getBrandMetadata,
  getBrandName: centralConfig.getBrandName,
  isValidBrand: centralConfig.isValidBrand,

  // Configuration getters (test-enhanced with baseUrl)
  getBrandConfig,
  getAllBrandConfigs,
  getConfiguredBrands,
  getBrandsWithDedicatedSpreadsheets,
  isBrandConfigured,

  // Test utilities
  forEachBrand,
  createBrandTestMatrix,

  // Debug
  printBrandConfigSummary
};
