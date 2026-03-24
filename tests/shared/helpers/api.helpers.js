/**
 * API Helper Functions for Testing
 *
 * Shared utilities for making API requests across all test types
 *
 * BASE_URL-Aware: Automatically uses centralized environment config
 * Default: https://stg.eventangle.com (staging via Cloudflare Workers)
 */

const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to stg.eventangle.com)
const BASE_URL = getBaseUrl();
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
const BRAND_ID = process.env.BRAND_ID || 'root';

/**
 * Validate API response envelope
 */
const validateEnvelope = (response) => {
  if (typeof response !== 'object' || response === null) {
    throw new Error('Response is not an object');
  }

  if (!('ok' in response)) {
    throw new Error('Response missing "ok" property');
  }

  if (typeof response.ok !== 'boolean') {
    throw new Error('Response "ok" property is not a boolean');
  }

  if (response.ok) {
    // Success responses should have value (unless notModified)
    if (!response.notModified && !('value' in response)) {
      throw new Error('Success response missing "value" property');
    }
  } else {
    // Error responses must have code and message
    if (!('code' in response)) {
      throw new Error('Error response missing "code" property');
    }
    if (!('message' in response)) {
      throw new Error('Error response missing "message" property');
    }
  }

  return true;
};

/**
 * Build API URL with parameters
 */
const buildApiUrl = (params = {}) => {
  const url = new URL(BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });
  return url.toString();
};

/**
 * Build authenticated API URL
 */
const buildAuthApiUrl = (params = {}, adminKey = ADMIN_KEY) => {
  return buildApiUrl({
    ...params,
    adminKey,
    brand: BRAND_ID
  });
};

/**
 * Parse API error response
 */
const parseApiError = (response) => {
  if (!response || response.ok) {
    return null;
  }

  return {
    code: response.code,
    message: response.message,
    details: response.details || null
  };
};

/**
 * Check if response is success
 */
const isSuccess = (response) => {
  return response && response.ok === true;
};

/**
 * Check if response is error
 */
const isError = (response) => {
  return response && response.ok === false;
};

/**
 * Extract value from successful response
 */
const extractValue = (response) => {
  if (!isSuccess(response)) {
    throw new Error('Cannot extract value from error response');
  }
  return response.value;
};

/**
 * Wait for condition with timeout
 */
const waitForCondition = async (condition, timeoutMs = 5000, intervalMs = 100) => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
};

/**
 * Retry operation with exponential backoff
 */
const retryWithBackoff = async (operation, maxRetries = 3, baseDelayMs = 1000) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

/**
 * Mock API response for testing
 */
const createMockResponse = (value, ok = true, code = null, message = null) => {
  if (ok) {
    return { ok: true, value };
  } else {
    return { ok: false, code, message };
  }
};

/**
 * Mock API error response
 */
const createMockError = (code, message) => {
  return { ok: false, code, message };
};

/**
 * Check API availability
 */
const checkApiAvailability = async (fetch) => {
  try {
    const url = buildApiUrl({ action: 'status' });
    const response = await fetch(url);
    const json = await response.json();
    return isSuccess(json) && json.value?.db?.ok === true;
  } catch (error) {
    return false;
  }
};

/**
 * Format date for API (ISO 8601)
 */
const formatDateISO = (date = new Date()) => {
  return date.toISOString().split('T')[0];
};

/**
 * Parse ISO date from API
 */
const parseISODate = (dateStr) => {
  return new Date(dateStr);
};

/**
 * Generate unique test ID
 */
const generateTestId = (prefix = 'test') => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

module.exports = {
  // Constants
  BASE_URL,
  ADMIN_KEY,
  BRAND_ID,

  // Validation
  validateEnvelope,

  // URL building
  buildApiUrl,
  buildAuthApiUrl,

  // Response handling
  parseApiError,
  isSuccess,
  isError,
  extractValue,

  // Async utilities
  waitForCondition,
  retryWithBackoff,

  // Mocking
  createMockResponse,
  createMockError,

  // Health checks
  checkApiAvailability,

  // Date utilities
  formatDateISO,
  parseISODate,

  // Test utilities
  generateTestId
};
