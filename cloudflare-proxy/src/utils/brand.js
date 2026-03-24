/**
 * Brand Configuration Utilities
 *
 * Centralized brand configuration for multi-tenant support.
 * Matches the brand configuration in GAS Config.gs.
 */

/**
 * Brand configuration map
 */
export const BRAND_CONFIG = Object.freeze({
  root: {
    brandId: 'root',
    brandName: 'ZEventBooks',
    appTitle: 'Events',
    scope: 'events',
    logoUrl: null,
    primaryColor: '#2563eb', // Blue
    secondaryColor: '#1e40af',
    features: {
      sponsors: true,
      analytics: true,
      templates: true
    }
  },
  abc: {
    brandId: 'abc',
    brandName: 'American Bocce Co',
    appTitle: 'ABC Events',
    scope: 'events',
    logoUrl: null,
    primaryColor: '#dc2626', // Red
    secondaryColor: '#991b1b',
    features: {
      sponsors: true,
      analytics: true,
      templates: true
    }
  },
  cbc: {
    brandId: 'cbc',
    brandName: 'Chicago Bocce Club',
    appTitle: 'CBC Events',
    scope: 'events',
    logoUrl: null,
    primaryColor: '#059669', // Green
    secondaryColor: '#047857',
    features: {
      sponsors: true,
      analytics: true,
      templates: true
    }
  },
  cbl: {
    brandId: 'cbl',
    brandName: 'Chicago Bocce League',
    appTitle: 'CBL Leagues',
    scope: 'leagues',
    logoUrl: null,
    primaryColor: '#7c3aed', // Purple
    secondaryColor: '#6d28d9',
    features: {
      sponsors: true,
      analytics: true,
      templates: true
    }
  }
});

/**
 * List of valid brand IDs
 */
export const VALID_BRANDS = Object.keys(BRAND_CONFIG);

/**
 * Default brand ID
 */
export const DEFAULT_BRAND = 'root';

/**
 * Check if a brand ID is valid
 * @param {string} brandId - Brand ID to check
 * @returns {boolean}
 */
export function isValidBrand(brandId) {
  return VALID_BRANDS.includes(brandId);
}

/**
 * Get brand configuration
 * @param {string} brandId - Brand ID
 * @returns {Object} Brand configuration
 */
export function getBrandConfig(brandId) {
  if (!brandId || !isValidBrand(brandId)) {
    return BRAND_CONFIG[DEFAULT_BRAND];
  }
  return BRAND_CONFIG[brandId];
}

/**
 * Get brand config for API response (subset of full config)
 * @param {string} brandId - Brand ID
 * @returns {Object} Brand config for API response
 */
export function getBrandConfigForApi(brandId) {
  const config = getBrandConfig(brandId);
  return {
    brandId: config.brandId,
    brandName: config.brandName,
    appTitle: config.appTitle,
    logoUrl: config.logoUrl,
    primaryColor: config.primaryColor,
    secondaryColor: config.secondaryColor,
    features: config.features
  };
}

/**
 * Extract brand ID from URL pathname
 * @param {string} pathname - URL pathname
 * @returns {string} Brand ID or default
 */
export function extractBrandFromPath(pathname) {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length > 0 && isValidBrand(segments[0])) {
    return segments[0];
  }

  return DEFAULT_BRAND;
}

/**
 * Generate event URLs for a brand
 * @param {string} brandId - Brand ID
 * @param {string} eventSlug - Event slug
 * @param {Object} env - Worker environment (for base URL)
 * @returns {Object} Event URLs
 */
export function generateEventUrls(brandId, eventSlug, env) {
  // Determine base URL from environment
  // Story 5.3: Default base path is /manage
  let baseUrl = 'https://zeventbooks.io/manage';

  if (env.WORKER_ENV === 'staging') {
    baseUrl = 'https://stg.zeventbooks.io/manage';
  }

  const brandPrefix = brandId === 'root' ? '' : `/${brandId}`;

  return {
    publicUrl: `${baseUrl}${brandPrefix}/events?id=${eventSlug}`,
    displayUrl: `${baseUrl}${brandPrefix}/display?id=${eventSlug}`,
    posterUrl: `${baseUrl}${brandPrefix}/poster?id=${eventSlug}`,
    signupUrl: '' // Set by event data or form integration
  };
}
