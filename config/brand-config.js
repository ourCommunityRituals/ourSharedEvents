/**
 * Centralized Brand Configuration - Single Source of Truth
 *
 * This module defines ALL brand metadata for the multi-tenant system.
 * All other files (tests, workers, etc.) should import from here.
 *
 * ARCHITECTURE:
 *   - Brand metadata (id, name, type) → Defined HERE (config)
 *   - Secrets (adminKey, spreadsheetId) → Environment variables (runtime)
 *   - Backend implementation → src/mvp/Config.gs (must stay in sync)
 *
 * HOW TO ADD A NEW BRAND:
 *   1. Add brand object to BRAND_METADATA below
 *   2. Update src/mvp/Config.gs BRANDS array to match
 *   3. Update cloudflare-proxy/worker.js VALID_BRANDS if needed
 *   4. Set environment variables: ADMIN_KEY_{BRAND}, SPREADSHEET_ID_{BRAND}
 *   5. Run validation tests: npm run test -- tests/unit/brand-config.test.js
 *
 * @module config/brand-config
 */

// =============================================================================
// Brand Metadata - Single Source of Truth
// =============================================================================

/**
 * Complete brand metadata definitions
 *
 * Each brand must have:
 *   - id: Unique lowercase identifier (used in URLs, env vars, API)
 *   - name: Human-readable display name
 *   - type: 'standalone' | 'parent' | 'child'
 *   - parentBrand: (optional) Parent brand ID for child brands
 *   - childBrands: (optional) Array of child brand IDs for parent brands
 */
const BRAND_METADATA = Object.freeze({
  root: {
    id: 'root',
    name: 'Zeventbook',
    type: 'standalone',
    description: 'Default platform brand',
    // Feature flags - Dark Launch / Kill Switch for non-critical features
    features: {
      sharedReportEnabled: true,     // SharedReport analytics page
      sponsorAnalyticsEnabled: true  // Sponsor-specific analytics APIs
    }
  },
  abc: {
    id: 'abc',
    name: 'American Bocce Co.',
    type: 'parent',
    childBrands: ['cbc', 'cbl'],
    description: 'Parent organization for bocce brands',
    features: {
      sharedReportEnabled: true,
      sponsorAnalyticsEnabled: true
    }
  },
  cbc: {
    id: 'cbc',
    name: 'Chicago Bocce Club',
    type: 'child',
    parentBrand: 'abc',
    includeInPortfolioReports: true,
    description: 'Community bocce club in Chicago',
    features: {
      sharedReportEnabled: true,
      sponsorAnalyticsEnabled: true
    }
  },
  cbl: {
    id: 'cbl',
    name: 'Chicago Bocce League',
    type: 'child',
    parentBrand: 'abc',
    includeInPortfolioReports: true,
    description: 'Competitive bocce league in Chicago',
    features: {
      sharedReportEnabled: true,
      sponsorAnalyticsEnabled: true
    }
  }
});

/**
 * All valid brand IDs - derived from BRAND_METADATA
 * This is THE canonical list used throughout the application.
 * Note: Named VALID_BRANDS internally to avoid ESLint global conflict
 */
const VALID_BRANDS = Object.freeze(Object.keys(BRAND_METADATA));

/**
 * Default brand for the platform
 */
const DEFAULT_BRAND = 'root';

/**
 * Default spreadsheet ID (matches Config.gs DEFAULT_SPREADSHEET_ID)
 * Used when no brand-specific or shared spreadsheet is configured
 */
const DEFAULT_SPREADSHEET_ID = '1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ';

// =============================================================================
// Environment Variable Helpers
// =============================================================================

/**
 * Get the environment variable name for a brand's admin key
 * @param {string} brandId - Brand identifier
 * @returns {string} Environment variable name (e.g., 'ADMIN_KEY_ROOT')
 */
function getAdminKeyEnvVar(brandId) {
  return `ADMIN_KEY_${brandId.toUpperCase()}`;
}

/**
 * Get the environment variable name for a brand's spreadsheet ID
 * @param {string} brandId - Brand identifier
 * @returns {string} Environment variable name (e.g., 'SPREADSHEET_ID_ROOT')
 */
function getSpreadsheetIdEnvVar(brandId) {
  return `SPREADSHEET_ID_${brandId.toUpperCase()}`;
}

// =============================================================================
// Brand Configuration Getters
// =============================================================================

/**
 * Check if a brand ID is valid
 * @param {string} brandId - Brand identifier to check
 * @returns {boolean} True if brand exists in BRAND_METADATA
 */
function isValidBrand(brandId) {
  return Boolean(brandId && VALID_BRANDS.includes(brandId));
}

/**
 * Get metadata for a specific brand
 * @param {string} brandId - Brand identifier
 * @returns {Object|null} Brand metadata or null if not found
 */
function getBrandMetadata(brandId) {
  if (!isValidBrand(brandId)) {
    return null;
  }
  return { ...BRAND_METADATA[brandId] };
}

/**
 * Get human-readable name for a brand
 * @param {string} brandId - Brand identifier
 * @returns {string} Brand name or brandId if not found
 */
function getBrandName(brandId) {
  const metadata = getBrandMetadata(brandId);
  return metadata?.name || brandId;
}

/**
 * Get all brand metadata as an object
 * @returns {Object} Map of brandId to metadata
 */
function getAllBrandMetadata() {
  const result = {};
  VALID_BRANDS.forEach(brandId => {
    result[brandId] = getBrandMetadata(brandId);
  });
  return result;
}

/**
 * Get child brands for a parent brand
 * @param {string} parentBrandId - Parent brand identifier
 * @returns {string[]} Array of child brand IDs
 */
function getChildBrands(parentBrandId) {
  const metadata = getBrandMetadata(parentBrandId);
  return metadata?.childBrands || [];
}

/**
 * Get parent brand for a child brand
 * @param {string} childBrandId - Child brand identifier
 * @returns {string|null} Parent brand ID or null
 */
function getParentBrand(childBrandId) {
  const metadata = getBrandMetadata(childBrandId);
  return metadata?.parentBrand || null;
}

/**
 * Get brands by type
 * @param {string} type - Brand type ('standalone' | 'parent' | 'child')
 * @returns {string[]} Array of brand IDs matching the type
 */
function getBrandsByType(type) {
  return VALID_BRANDS.filter(brandId => BRAND_METADATA[brandId].type === type);
}

// =============================================================================
// Feature Flag Helpers (Dark Launch / Kill Switch)
// =============================================================================

/**
 * Default feature flags - used when brand doesn't specify a feature
 * All features enabled by default for backward compatibility
 */
const DEFAULT_FEATURES = Object.freeze({
  sharedReportEnabled: true,
  sponsorAnalyticsEnabled: true
});

/**
 * Get feature flags for a brand
 * @param {string} brandId - Brand identifier
 * @returns {Object} Feature flags with defaults applied
 */
function getBrandFeatures(brandId) {
  const metadata = getBrandMetadata(brandId);
  if (!metadata) {
    return { ...DEFAULT_FEATURES };
  }
  return {
    ...DEFAULT_FEATURES,
    ...(metadata.features || {})
  };
}

/**
 * Check if a specific feature is enabled for a brand
 * @param {string} brandId - Brand identifier
 * @param {string} featureName - Feature name (e.g., 'sharedReportEnabled')
 * @returns {boolean} True if feature is enabled
 */
function isBrandFeatureEnabled(brandId, featureName) {
  const features = getBrandFeatures(brandId);
  // Return true if not explicitly set to false (opt-out model)
  return features[featureName] !== false;
}

// =============================================================================
// Runtime Configuration (Environment-Based)
// =============================================================================

/**
 * Get full runtime configuration for a brand
 * Combines static metadata with environment-based secrets
 *
 * @param {string} brandId - Brand identifier
 * @returns {Object} Complete brand configuration
 */
function getBrandConfig(brandId) {
  // Default to root if invalid
  if (!isValidBrand(brandId)) {
    brandId = DEFAULT_BRAND;
  }

  const metadata = getBrandMetadata(brandId);
  const upperBrand = brandId.toUpperCase();

  // Get spreadsheet ID with priority: brand-specific > shared > default
  const spreadsheetId =
    process.env[`SPREADSHEET_ID_${upperBrand}`] ||
    process.env.SPREADSHEET_ID ||
    DEFAULT_SPREADSHEET_ID;

  // Get admin key with priority: brand-specific > shared
  const adminKey =
    process.env[`ADMIN_KEY_${upperBrand}`] ||
    process.env.ADMIN_KEY ||
    null;

  return {
    // Static metadata
    brandId: metadata.id,
    brandName: metadata.name,
    brandType: metadata.type,
    parentBrand: metadata.parentBrand || null,
    childBrands: metadata.childBrands || [],
    includeInPortfolioReports: metadata.includeInPortfolioReports || false,

    // Feature flags (Dark Launch / Kill Switch)
    features: getBrandFeatures(brandId),

    // Runtime configuration (from env)
    spreadsheetId,
    adminKey,

    // Derived flags
    hasAdminKey: !!adminKey,
    hasDedicatedSpreadsheet: !!process.env[`SPREADSHEET_ID_${upperBrand}`],
    isConfigured: !!adminKey && !!spreadsheetId
  };
}

/**
 * Get configurations for all brands
 * @returns {Object} Map of brand ID to full configuration
 */
function getAllBrandConfigs() {
  const configs = {};
  VALID_BRANDS.forEach(brandId => {
    configs[brandId] = getBrandConfig(brandId);
  });
  return configs;
}

/**
 * Get list of brands that are fully configured (have admin key)
 * @returns {string[]} Array of configured brand IDs
 */
function getConfiguredBrands() {
  return VALID_BRANDS.filter(brandId => getBrandConfig(brandId).hasAdminKey);
}

/**
 * Get list of brands with dedicated spreadsheets
 * @returns {string[]} Array of brand IDs with dedicated spreadsheets
 */
function getBrandsWithDedicatedSpreadsheets() {
  return VALID_BRANDS.filter(brandId => getBrandConfig(brandId).hasDedicatedSpreadsheet);
}

/**
 * Check if a brand is configured for testing (has admin key)
 * @param {string} brandId - Brand ID to check
 * @returns {boolean} True if brand has admin key configured
 */
function isBrandConfigured(brandId) {
  return getBrandConfig(brandId).hasAdminKey;
}

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create test matrix for Jest describe.each or it.each
 * @param {Object} options - Options
 * @param {boolean} options.onlyConfigured - Only include configured brands
 * @returns {Array} Array of [brandId, config] tuples for .each()
 */
function createBrandTestMatrix(options = {}) {
  const { onlyConfigured = false } = options;

  let brandsToTest = [...VALID_BRANDS];

  if (onlyConfigured) {
    brandsToTest = brandsToTest.filter(brandId =>
      getBrandConfig(brandId).hasAdminKey
    );
  }

  return brandsToTest.map(brandId => [brandId, getBrandConfig(brandId)]);
}

/**
 * Run a test function for each brand
 * @param {Function} testFn - Test function(brandConfig) to run
 * @param {Object} options - Options
 * @param {boolean} options.onlyConfigured - Only run for brands with admin keys
 * @param {string[]} options.brands - Specific brands to run for
 * @returns {Array} Array of test descriptors
 */
function forEachBrand(testFn, options = {}) {
  const { onlyConfigured = false, brands = null } = options;

  let brandsToTest = brands || [...VALID_BRANDS];

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

// =============================================================================
// Debug Utilities
// =============================================================================

/**
 * Print brand configuration summary (for debugging)
 */
function printBrandConfigSummary() {
  console.log('\n=== Brand Configuration Summary ===\n');

  console.log('Registered Brands:');
  VALID_BRANDS.forEach(brandId => {
    const metadata = getBrandMetadata(brandId);
    const config = getBrandConfig(brandId);
    const typeLabel = metadata.type === 'child'
      ? `child of ${metadata.parentBrand}`
      : metadata.type;

    console.log(`  ${brandId.toUpperCase()} - ${metadata.name}`);
    console.log(`    Type: ${typeLabel}`);
    console.log(`    Admin Key: ${config.hasAdminKey ? 'configured' : '(not set)'}`);
    console.log(`    Spreadsheet: ${config.hasDedicatedSpreadsheet ? 'dedicated' : 'shared'}`);
  });

  console.log('\nEnvironment Variables:');
  console.log(`  SPREADSHEET_ID (shared): ${process.env.SPREADSHEET_ID || '(not set)'}`);
  console.log(`  ADMIN_KEY (shared): ${process.env.ADMIN_KEY ? '****' : '(not set)'}`);

  console.log('\nConfigured brands:', getConfiguredBrands().join(', ') || 'none');
  console.log('Brands with dedicated spreadsheets:', getBrandsWithDedicatedSpreadsheets().join(', ') || 'none');
  console.log('\n=== End Summary ===\n');
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // Core constants - Single Source of Truth
  // Note: VALID_BRANDS exported as BRANDS for backward compatibility
  BRANDS: VALID_BRANDS,
  BRAND_METADATA,
  DEFAULT_BRAND,
  DEFAULT_SPREADSHEET_ID,

  // Validation
  isValidBrand,

  // Metadata getters (static)
  getBrandMetadata,
  getBrandName,
  getAllBrandMetadata,
  getChildBrands,
  getParentBrand,
  getBrandsByType,

  // Environment variable helpers
  getAdminKeyEnvVar,
  getSpreadsheetIdEnvVar,

  // Runtime configuration (includes env vars)
  getBrandConfig,
  getAllBrandConfigs,
  getConfiguredBrands,
  getBrandsWithDedicatedSpreadsheets,
  isBrandConfigured,

  // Feature flags (Dark Launch / Kill Switch)
  DEFAULT_FEATURES,
  getBrandFeatures,
  isBrandFeatureEnabled,

  // Test utilities
  createBrandTestMatrix,
  forEachBrand,

  // Debug
  printBrandConfigSummary
};
