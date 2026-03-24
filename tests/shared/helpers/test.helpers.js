/**
 * Centralized Test Helpers
 *
 * DRY utilities shared across all test types
 * - Envelope validation
 * - Common assertions
 * - Test data factories
 */

// Import brand configuration from centralized source
const { BRANDS } = require('../../../config/brand-config');

// Helper to safely check if object has own property (ESLint no-prototype-builtins)
const hasOwn = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);

/**
 * Validates API response envelope structure
 * Ensures all responses follow Ok/Err pattern
 *
 * @param {Object} response - API response object
 */
const validateEnvelope = (response) => {
  expect(response).toHaveProperty('ok');
  expect(typeof response.ok).toBe('boolean');

  if (response.ok) {
    // notModified responses don't have value property
    if (!response.notModified) {
      expect(response).toHaveProperty('value');
    }
  } else {
    expect(response).toHaveProperty('code');
    expect(response).toHaveProperty('message');
  }
};

/**
 * Validates success response envelope
 *
 * @param {Object} response - API response object
 */
const validateSuccessEnvelope = (response) => {
  validateEnvelope(response);
  expect(response.ok).toBe(true);
  if (!response.notModified) {
    expect(response).toHaveProperty('value');
  }
};

/**
 * Validates error response envelope
 *
 * @param {Object} response - API response object
 * @param {string} expectedCode - Expected error code
 */
const validateErrorEnvelope = (response, expectedCode = null) => {
  validateEnvelope(response);
  expect(response.ok).toBe(false);
  expect(response).toHaveProperty('code');
  expect(response).toHaveProperty('message');

  if (expectedCode) {
    expect(response.code).toBe(expectedCode);
  }
};

// ============================================================================
// ENVELOPE BOUNDARY VALIDATORS (API_CONTRACT.md compliance)
// ============================================================================

/**
 * List of endpoints that return FLAT responses (no envelope wrapper)
 * All other endpoints must return envelope-wrapped responses.
 * @see API_CONTRACT.md
 */
const FLAT_ENDPOINTS = Object.freeze(['status', 'statusmvp']);

/**
 * Validates flat response structure (for status/health endpoints)
 * Flat responses have `ok` field but NO `value` wrapper.
 *
 * @see API_CONTRACT.md - Flat Endpoints section
 * @param {Object} response - API response object
 * @param {Object} options - Validation options
 * @param {string[]} options.requiredFields - Additional required fields beyond ok
 */
const validateFlatResponse = (response, options = {}) => {
  // Must have ok field
  expect(response).toHaveProperty('ok');
  expect(typeof response.ok).toBe('boolean');

  // Must NOT have value wrapper (that would make it an envelope)
  expect(response).not.toHaveProperty('value');

  // For success flat responses, must NOT have code/message (error envelope fields)
  if (response.ok) {
    expect(response).not.toHaveProperty('code');
  }

  // Check additional required fields if specified
  if (options.requiredFields) {
    for (const field of options.requiredFields) {
      expect(response).toHaveProperty(field);
    }
  }
};

/**
 * Validates flat status response structure
 * For api_statusPure endpoint.
 *
 * @see API_CONTRACT.md - status.schema.json
 * @param {Object} response - Status response object
 */
const validateFlatStatusResponse = (response) => {
  validateFlatResponse(response, {
    requiredFields: ['buildId', 'brandId', 'time']
  });

  // Validate field types
  expect(typeof response.buildId).toBe('string');
  expect(typeof response.brandId).toBe('string');
  expect(typeof response.time).toBe('string');

  // Optional db field if present
  if (response.db) {
    expect(response.db).toHaveProperty('ok');
    expect(typeof response.db.ok).toBe('boolean');
  }
};

/**
 * Validates flat MVP status response structure
 * For api_statusMvp endpoint.
 *
 * @see API_CONTRACT.md - status-mvp.schema.json
 * @param {Object} response - MVP status response object
 */
const validateFlatMvpStatusResponse = (response) => {
  validateFlatResponse(response, {
    requiredFields: ['buildId', 'brandId', 'time', 'analyticsSheetHealthy', 'sharedAnalyticsContractOk']
  });

  // Validate field types
  expect(typeof response.buildId).toBe('string');
  expect(typeof response.brandId).toBe('string');
  expect(typeof response.time).toBe('string');
  expect(typeof response.analyticsSheetHealthy).toBe('boolean');
  expect(typeof response.sharedAnalyticsContractOk).toBe('boolean');
};

/**
 * Asserts that a response IS an envelope (has value wrapper when ok=true)
 * Use this to enforce envelope boundary for non-flat endpoints.
 *
 * @see API_CONTRACT.md - Rule 2
 * @param {Object} response - API response object
 * @throws {Error} If response is flat (no value wrapper)
 */
const assertIsEnvelope = (response) => {
  expect(response).toHaveProperty('ok');

  if (response.ok === true) {
    // Success envelopes MUST have value (unless notModified)
    if (!response.notModified) {
      expect(response).toHaveProperty('value');
      // Additional check: response should not have flat endpoint fields at root
      expect(response).not.toHaveProperty('buildId');
      expect(response).not.toHaveProperty('brandId');
    }
  } else if (response.ok === false) {
    // Error envelopes MUST have code and message
    expect(response).toHaveProperty('code');
    expect(response).toHaveProperty('message');
  }
};

/**
 * Asserts that a response is NOT an envelope (flat format)
 * Use this to enforce flat boundary for status/health endpoints.
 *
 * @see API_CONTRACT.md - Rule 1
 * @param {Object} response - API response object
 * @throws {Error} If response has envelope wrapper
 */
const assertNotEnvelope = (response) => {
  expect(response).toHaveProperty('ok');

  // Flat responses must NOT have value wrapper
  expect(response).not.toHaveProperty('value');

  // If it's a success, should have flat status fields at root
  if (response.ok === true) {
    // These fields should be at root level, not wrapped
    expect(response).toHaveProperty('buildId');
    expect(response).toHaveProperty('brandId');
    expect(response).toHaveProperty('time');
  }
};

/**
 * Checks if a response looks like an envelope (has value wrapper)
 * Non-throwing version for conditional logic.
 *
 * @param {Object} response - API response object
 * @returns {boolean} True if response appears to be envelope-wrapped
 */
const isEnvelope = (response) => {
  if (!response || typeof response !== 'object') return false;
  if (typeof response.ok !== 'boolean') return false;

  // If ok=true and has value, it's an envelope
  if (response.ok === true && hasOwn(response, 'value')) return true;

  // If ok=false and has code+message, it's an envelope error
  if (response.ok === false && hasOwn(response, 'code') && hasOwn(response, 'message')) {
    // But flat errors also have message - check for 'code' which is envelope-specific
    return true;
  }

  return false;
};

/**
 * Checks if a response looks like a flat status response
 * Non-throwing version for conditional logic.
 *
 * @param {Object} response - API response object
 * @returns {boolean} True if response appears to be flat status format
 */
const isFlatResponse = (response) => {
  if (!response || typeof response !== 'object') return false;
  if (typeof response.ok !== 'boolean') return false;

  // Flat responses don't have value wrapper
  if (hasOwn(response, 'value')) return false;

  // Flat success responses have buildId, brandId, time at root
  if (response.ok === true) {
    return hasOwn(response, 'buildId') &&
           hasOwn(response, 'brandId') &&
           hasOwn(response, 'time');
  }

  // Flat error responses have message but no code (or code is different pattern)
  return hasOwn(response, 'message') && hasOwn(response, 'buildId');
};

/**
 * Validates event object structure (legacy format)
 *
 * @param {Object} event - Event object
 */
const validateEventStructure = (event) => {
  expect(event).toHaveProperty('id');
  expect(event).toHaveProperty('brandId');
  expect(event).toHaveProperty('templateId');
  expect(event).toHaveProperty('data');
  expect(event).toHaveProperty('createdAt');
  expect(event).toHaveProperty('slug');
};

/**
 * Validates EVENT_CONTRACT.md v1.0 canonical event shape
 *
 * @param {Object} event - Event object in canonical format
 */
const validateEventContractV1 = (event) => {
  // Required envelope fields
  expect(event).toHaveProperty('id');
  expect(event).toHaveProperty('brandId');
  expect(event).toHaveProperty('templateId');
  expect(event).toHaveProperty('name');
  expect(event).toHaveProperty('status');
  expect(event).toHaveProperty('createdAt');
  expect(event).toHaveProperty('slug');
  expect(event).toHaveProperty('links');

  // Validate status is one of valid values
  expect(['draft', 'published', 'cancelled', 'completed']).toContain(event.status);

  // Validate links
  expect(event.links).toHaveProperty('publicUrl');
  expect(event.links).toHaveProperty('posterUrl');
  expect(event.links).toHaveProperty('displayUrl');
  expect(event.links).toHaveProperty('reportUrl');
};

/**
 * Validates SectionConfig format per EVENT_CONTRACT.md
 *
 * @param {Object} section - Section config object
 */
const validateSectionConfig = (section) => {
  expect(section).toHaveProperty('enabled');
  expect(section).toHaveProperty('title');
  expect(section).toHaveProperty('content');
  expect(typeof section.enabled).toBe('boolean');
};

/**
 * Validates CTALabel format per EVENT_CONTRACT.md
 *
 * @param {Object} cta - CTA label object
 */
const validateCTALabel = (cta) => {
  expect(cta).toHaveProperty('key');
  expect(cta).toHaveProperty('label');
  expect(cta).toHaveProperty('url');
  expect(typeof cta.key).toBe('string');
  expect(typeof cta.label).toBe('string');
};

/**
 * Validates Sponsor format (hydrated) per EVENT_CONTRACT.md
 *
 * @param {Object} sponsor - Sponsor object
 */
const validateSponsor = (sponsor) => {
  expect(sponsor).toHaveProperty('id');
  expect(sponsor).toHaveProperty('name');
  expect(typeof sponsor.id).toBe('string');
  expect(typeof sponsor.name).toBe('string');
};

/**
 * Validates event links
 *
 * @param {Object} links - Links object
 */
const validateEventLinks = (links) => {
  expect(links).toHaveProperty('publicUrl');
  expect(links).toHaveProperty('posterUrl');
  expect(links).toHaveProperty('displayUrl');

  // Validate all are valid URLs
  Object.values(links).forEach(url => {
    expect(typeof url).toBe('string');
    expect(url).toMatch(/^https?:\/\//);
  });
};

/**
 * Validates analytics structure
 *
 * @param {Object} analytics - Analytics object
 */
const validateAnalyticsStructure = (analytics) => {
  expect(analytics).toHaveProperty('totals');
  expect(analytics).toHaveProperty('bySurface');
  expect(analytics).toHaveProperty('bySponsor');
  expect(analytics).toHaveProperty('byToken');

  // Validate totals
  expect(analytics.totals).toHaveProperty('impressions');
  expect(analytics.totals).toHaveProperty('clicks');
  expect(analytics.totals).toHaveProperty('dwellSec');
};

/**
 * Error code constants (matching Code.gs)
 */
const ERROR_CODES = Object.freeze({
  BAD_INPUT: 'BAD_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  CONTRACT: 'CONTRACT',
  FEATURE_DISABLED: 'FEATURE_DISABLED'  // Dark Launch / Kill Switch
});

/**
 * Validates all error codes are defined
 */
const validateErrorCodes = () => {
  const codes = Object.keys(ERROR_CODES);
  codes.forEach(code => {
    expect(ERROR_CODES[code]).toBe(code);
  });
};

/**
 * Creates a mock success response
 *
 * @param {*} value - Response value
 * @param {Object} options - Additional options (etag, notModified)
 */
const createMockSuccessResponse = (value, options = {}) => ({
  ok: true,
  value,
  ...options
});

/**
 * Creates a mock error response
 *
 * @param {string} code - Error code
 * @param {string} message - Error message
 */
const createMockErrorResponse = (code, message) => ({
  ok: false,
  code,
  message
});

/**
 * Sleep utility for async tests
 *
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry function with exponential backoff
 *
 * @param {Function} fn - Function to retry
 * @param {number} maxAttempts - Maximum retry attempts
 * @param {number} initialDelay - Initial delay in ms
 */
const retryWithBackoff = async (fn, maxAttempts = 3, initialDelay = 100) => {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError;
};

/**
 * Generate unique test ID
 */
const generateTestId = () => {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Date helpers
 */
const dateHelpers = {
  /**
   * Get ISO date string for N days from now
   */
  daysFromNow: (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  },

  /**
   * Get ISO date string for N days ago
   */
  daysAgo: (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  },

  /**
   * Get current ISO date string
   */
  today: () => {
    return new Date().toISOString().split('T')[0];
  },

  /**
   * Get tomorrow's ISO date string
   */
  tomorrow: () => {
    return dateHelpers.daysFromNow(1);
  },

  /**
   * Get yesterday's ISO date string
   */
  yesterday: () => {
    return dateHelpers.daysAgo(1);
  }
};

/**
 * Multi-brand test helpers
 *
 * BRANDS is imported from config/brand-config.js (single source of truth)
 */
const brandHelpers = {
  /**
   * Valid brand IDs from centralized config
   * @see config/brand-config.js
   */
  BRANDS,

  /**
   * Get a random brand ID
   */
  randomBrand: () => {
    return BRANDS[Math.floor(Math.random() * BRANDS.length)];
  },

  /**
   * Get a different brand ID (for cross-brand tests)
   */
  differentBrand: (currentBrand) => {
    const others = BRANDS.filter(t => t !== currentBrand);
    return others[Math.floor(Math.random() * others.length)];
  },

  /**
   * Get brand configuration (spreadsheetId, adminKey, etc.)
   * Delegates to brand-config.js for full per-brand support
   */
  getBrandConfig: (brandId) => {
    try {
      const { getBrandConfig } = require('../config/brand-config');
      return getBrandConfig(brandId);
    } catch {
      // Fallback if brand-config not available
      return {
        brandId: brandId || 'root',
        spreadsheetId: process.env.SPREADSHEET_ID || '1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ',
        adminKey: process.env.ADMIN_KEY || null,
        baseUrl: process.env.BASE_URL || 'https://stg.eventangle.com',
        hasAdminKey: !!process.env.ADMIN_KEY,
        hasDedicatedSpreadsheet: false,
        isConfigured: !!process.env.ADMIN_KEY
      };
    }
  },

  /**
   * Get configured brands (those with admin keys)
   */
  getConfiguredBrands: () => {
    try {
      const { getConfiguredBrands } = require('../config/brand-config');
      return getConfiguredBrands();
    } catch {
      return process.env.ADMIN_KEY ? ['root'] : [];
    }
  },

  /**
   * Create test matrix for parameterized brand tests
   * Usage: describe.each(brandHelpers.createTestMatrix())('Brand: %s', (brandId, config) => { ... })
   */
  createTestMatrix: (options = {}) => {
    try {
      const { createBrandTestMatrix } = require('../config/brand-config');
      return createBrandTestMatrix(options);
    } catch {
      // Fallback: just root brand
      return [['root', brandHelpers.getBrandConfig('root')]];
    }
  }
};

module.exports = {
  // Envelope validation
  validateEnvelope,
  validateSuccessEnvelope,
  validateErrorEnvelope,

  // Envelope boundary validators (API_CONTRACT.md compliance)
  FLAT_ENDPOINTS,
  validateFlatResponse,
  validateFlatStatusResponse,
  validateFlatMvpStatusResponse,
  assertIsEnvelope,
  assertNotEnvelope,
  isEnvelope,
  isFlatResponse,

  // Structure validation (legacy)
  validateEventStructure,
  validateEventLinks,
  validateAnalyticsStructure,

  // EVENT_CONTRACT.md v1.0 validation
  validateEventContractV1,
  validateSectionConfig,
  validateCTALabel,
  validateSponsor,

  // Error codes
  ERROR_CODES,
  validateErrorCodes,

  // Mock responses
  createMockSuccessResponse,
  createMockErrorResponse,

  // Async utilities
  sleep,
  retryWithBackoff,

  // ID generation
  generateTestId,

  // Date helpers
  dateHelpers,

  // Brand helpers
  brandHelpers
};
