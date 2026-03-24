/**
 * Jest Configuration for Unit and Contract Tests
 *
 * These tests DO NOT require BASE_URL environment variable:
 * - Unit tests use mocks and test logic in isolation
 * - Contract tests validate response structures using mock data
 * - All tests can run with default configuration values
 *
 * For E2E/API tests that require BASE_URL, see playwright.config.js
 */

module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    '*.gs',
    '!node_modules/**',
    '!coverage/**',
    '!tests/**',
    '!jest.config.js',
    '!playwright.config.js'
  ],
  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/contract/**/*.test.js',
    '**/tests/triangle/**/contract/**/*.test.js',
    '**/tests/triangle/**/integration/**/*.test.js',
    '**/tests/api/**/*.test.js',
    '**/tests/api-contracts/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/e2e/',
    '/tests/smoke/'
  ],
  reporters: [
    'default',
    './tests/shared/jest-history-reporter.js'
  ],
  // Coverage thresholds enforced (Story 2.3: >= 80% threshold)
  // Mock Google Apps Script APIs in tests to achieve coverage
  // Pipeline fails if coverage drops below threshold
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  // Generate coverage reports in multiple formats for CI
  coverageReporters: [
    'text',
    'text-summary',
    'lcov',
    'json',
    'html'
  ]
};
