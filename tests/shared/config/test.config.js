/**
 * Global Test Configuration
 *
 * Shared configuration for all test types across Triangle phases
 *
 * BASE_URL-Aware Configuration
 * ============================
 * All tests respect the BASE_URL environment variable:
 *
 *   BASE_URL="https://www.eventangle.com" npm run test:smoke
 *   BASE_URL="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" npm run test:smoke
 *
 * Default: https://stg.eventangle.com (staging via Cloudflare Workers)
 *
 * For unit/contract tests that mock APIs, the BASE_URL is used for URL validation
 * but no real network calls are made.
 */

// Import centralized environment configuration
const { getBaseUrl } = require('../../config/environments');

// Environment
const ENV = process.env.NODE_ENV || 'test';
const IS_CI = process.env.CI === 'true';

// Base URL from centralized config (defaults to stg.eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

// Test configuration
const TEST_CONFIG = {
  // Timeouts
  timeouts: {
    short: 5000,      // 5 seconds - quick operations
    medium: 30000,    // 30 seconds - API calls
    long: 60000,      // 60 seconds - complex operations
    veryLong: 120000  // 2 minutes - full E2E flows
  },

  // Retries
  retries: {
    api: IS_CI ? 3 : 1,
    ui: IS_CI ? 2 : 0,
    maxBackoffMs: 16000 // 16 seconds max backoff
  },

  // Performance thresholds
  performance: {
    apiResponseTime: 2000,    // 2 seconds
    pageLoadTime: 5000,       // 5 seconds
    timeToFirstByte: 1000,    // 1 second
    domContentLoaded: 3000    // 3 seconds
  },

  // Browser configuration
  browser: {
    headless: IS_CI,
    slowMo: IS_CI ? 0 : 50,
    devtools: !IS_CI,
    viewport: {
      width: 1920,
      height: 1080
    }
  },

  // Device viewports
  devices: {
    mobile: { width: 375, height: 667, name: 'iPhone SE' },
    mobileL: { width: 414, height: 896, name: 'iPhone 12 Pro' },
    tablet: { width: 768, height: 1024, name: 'iPad' },
    desktop: { width: 1920, height: 1080, name: 'Desktop HD' },
    tv: { width: 1920, height: 1080, name: 'TV 1080p' },
    '4k': { width: 3840, height: 2160, name: 'TV 4K' }
  },

  // API configuration
  api: {
    baseUrl: BASE_URL,
    timeout: 30000,
    retries: IS_CI ? 3 : 1,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  },

  // Test data
  testData: {
    brandId: BRAND_ID,
    adminKey: ADMIN_KEY,
    defaultEventDate: '2025-12-31',
    defaultLocation: 'Test Venue'
  },

  // Triangle phase colors (for reporting)
  trianglePhases: {
    before: {
      name: 'Before Event',
      emoji: '📋',
      color: '#10b981',
      description: 'Pre-Event Preparation'
    },
    during: {
      name: 'During Event',
      emoji: '▶️',
      color: '#f59e0b',
      description: 'Live Execution'
    },
    after: {
      name: 'After Event',
      emoji: '📊',
      color: '#8b5cf6',
      description: 'Post-Event Analytics'
    },
    all: {
      name: 'All Phases',
      emoji: '⚡',
      color: '#3b82f6',
      description: 'Always Available'
    }
  },

  // Screenshots
  screenshots: {
    enabled: true,
    path: 'test-results/screenshots',
    onFailureOnly: IS_CI
  },

  // Video recording
  video: {
    enabled: IS_CI,
    path: 'test-results/videos',
    onFailureOnly: true
  },

  // Reporting
  reporting: {
    htmlReport: true,
    jsonReport: true,
    junitReport: IS_CI,
    path: 'test-results'
  }
};

// Export configuration
module.exports = {
  ENV,
  IS_CI,
  BASE_URL,
  BRAND_ID,
  ADMIN_KEY,
  TEST_CONFIG
};
