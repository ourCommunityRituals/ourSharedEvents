/**
 * Centralized E2E Test Configuration
 *
 * BASE_URL-Aware Configuration
 * ============================
 * All E2E tests respect the BASE_URL environment variable:
 *
 *   BASE_URL="https://www.eventangle.com" npm run test:smoke
 *   BASE_URL="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" npm run test:smoke
 *
 * Default: https://stg.eventangle.com (staging via Cloudflare Workers)
 *
 * Sustainability: Single source of truth for all test settings
 * Easy to understand: All configuration in one place
 * Mobile support: Device-specific URLs and settings
 */

const { getCurrentEnvironment, getBaseUrl, isGoogleAppsScript, isEventangle } = require('../config/environments');

// Get environment configuration
const env = getCurrentEnvironment();

// Validate environment variables (warnings only - allows read-only tests to run)
if (!process.env.ADMIN_KEY) {
  console.warn('⚠️  ADMIN_KEY not set. Admin operations will be skipped.');
}

export const config = {
  // Deployment settings - use centralized BASE_URL
  baseUrl: getBaseUrl(),
  adminKey: process.env.ADMIN_KEY,
  brandId: process.env.BRAND_ID || 'root',

  // Environment detection helpers
  isGoogleAppsScript: isGoogleAppsScript(),
  isEventangle: isEventangle(),

  // Timeouts (mobile may need longer)
  timeout: {
    default: 30000,      // 30s for most actions
    navigation: 60000,   // 60s for page loads (slower on mobile)
    api: 10000,          // 10s for API calls
  },

  // Mobile-specific settings
  mobile: {
    slowMo: 100,         // Slow down actions for mobile (stability)
    viewport: {
      width: 390,        // iPhone 12 Pro width
      height: 844,       // iPhone 12 Pro height
    },
  },

  // Test data
  testData: {
    event: {
      name: () => `Test Event ${Date.now()}`,
      date: '2025-12-31',
      description: 'Automated test event',
    },
    sponsor: {
      name: () => `Test Sponsor ${Date.now()}`,
      url: 'https://example.com',
      logoUrl: 'https://via.placeholder.com/150',
    },
  },

  // Selectors strategy
  selectors: {
    // Prefer data-testid, fallback to accessible roles
    strategy: 'data-testid-first',
  },
};

/**
 * Get page URL with query parameters
 * @param {string} page - Page name (admin, display, events, etc.)
 * @param {object} params - Additional query parameters
 * @returns {string} Full URL
 */
export function getPageUrl(page, params = {}) {
  const url = new URL(config.baseUrl);
  url.searchParams.set('page', page);
  url.searchParams.set('brand', config.brandId);

  // Add any additional parameters
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

/**
 * Determine if running on mobile device
 * @param {object} page - Playwright page object
 * @returns {boolean} True if mobile viewport
 */
export function isMobile(page) {
  const viewport = page.viewportSize();
  return viewport.width < 768; // Standard mobile breakpoint
}
