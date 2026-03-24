const { defineConfig, devices } = require('@playwright/test');
const { getCurrentEnvironment } = require('./tests/config/environments');

// Get the current environment configuration
const env = getCurrentEnvironment();

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,

  // CI: Allow 2 retries for transient network failures (Google Apps Script cold starts, redirects)
  // Local: No retries to expose real failures immediately
  retries: process.env.CI ? 2 : 0,

  workers: process.env.CI ? 1 : undefined,

  // Default timeout for tests (30 seconds to handle Google Apps Script cold starts)
  timeout: 30000,

  // Global expect timeout (10 seconds for element visibility checks)
  expect: {
    timeout: 10000,
  },

  reporter: process.env.CI ? [
    // CI: Verbose output to see console logs after every test
    ['html', {
      outputFolder: process.env.PLAYWRIGHT_HTML_REPORT || 'playwright-report',
      open: 'never',
    }],
    ['json', { outputFile: '.test-results/playwright-results.json' }],
    ['junit', { outputFile: '.test-results/junit.xml' }],
    ['./tests/shared/history-reporter.js'],
    ['line'],  // Line reporter shows output in real-time including console.log
  ] : [
    // Local: Standard reporters
    ['html', {
      outputFolder: process.env.PLAYWRIGHT_HTML_REPORT || 'playwright-report',
      open: 'never',
    }],
    ['json', { outputFile: '.test-results/playwright-results.json' }],
    ['junit', { outputFile: '.test-results/junit.xml' }],
    ['./tests/shared/history-reporter.js'],
    ['list']
  ],

  use: {
    // Use environment-aware base URL
    // Defaults to staging (stg.eventangle.com), can be overridden with BASE_URL or USE_PRODUCTION=true
    baseURL: env.baseUrl,

    // Enable traces on all retries for better debugging in CI
    trace: 'retain-on-failure',
    screenshot: 'on',  // Capture screenshots for all tests (helps track failures across retries)
    video: process.env.CI ? 'retain-on-failure' : 'off',  // Video only in CI on failure

    // Navigation timeout (20 seconds for Google Apps Script)
    navigationTimeout: 20000,

    // Action timeout (10 seconds for clicks, fills, etc.)
    actionTimeout: 10000,

    // Extra HTTP headers
    extraHTTPHeaders: {
      'Accept': 'text/html,application/json',
    },

    // Bypass bot detection with realistic user agent
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',

    // Ignore HTTPS errors for QA/staging environments
    ignoreHTTPSErrors: true,
  },

  // Global setup - print environment info before tests, initialize tracking (Story 3.5)
  globalSetup: require.resolve('./tests/config/global-setup.js'),

  // Global teardown - cleanup test data after tests complete (Story 3.5)
  globalTeardown: require.resolve('./tests/config/global-teardown.js'),

  // CI and Local now use the same browser matrix for consistent coverage
  // Both chromium (Chrome/Edge) and webkit (Safari/iOS) are tested
  projects: process.env.CI ? [
    // CI: Chromium + WebKit for cross-browser coverage
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'iPhone 14 Pro',
      use: { ...devices['iPhone 14 Pro'] },
    },
  ] : [
    // Local: Both mobile and desktop for comprehensive testing
    // Mobile: Safari iPhone 14 Pro (represents latest iOS/Safari)
    {
      name: 'iPhone 14 Pro',
      use: { ...devices['iPhone 14 Pro'] },
    },
    // Desktop: Chromium (most common browser, Chrome/Edge base)
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Full device matrix for local/manual testing only
  // Uncomment these when running comprehensive device testing locally
  // NOTE: Running all 11 devices in CI/CD is expensive!
  //
  // projects: [
  //   // MOBILE-FIRST: Test mobile devices FIRST (priority)
  //   {
  //     name: 'iPhone 14',
  //     use: { ...devices['iPhone 14'] },
  //   },
  //   {
  //     name: 'iPhone 14 Pro',
  //     use: { ...devices['iPhone 14 Pro'] },
  //   },
  //   {
  //     name: 'Pixel 7',
  //     use: { ...devices['Pixel 7'] },
  //   },
  //   {
  //     name: 'Samsung Galaxy S21',
  //     use: { ...devices['Galaxy S21'] },
  //   },
  //   {
  //     name: 'iPad Pro',
  //     use: { ...devices['iPad Pro'] },
  //   },
  //   {
  //     name: 'Mobile 3G (Slow Network)',
  //     use: {
  //       ...devices['Pixel 5'],
  //       launchOptions: {
  //         // Throttle to simulate 3G
  //         slowMo: 100,
  //       },
  //     },
  //   },
  //   // DESKTOP: Test desktop browsers (secondary)
  //   {
  //     name: 'chromium',
  //     use: { ...devices['Desktop Chrome'] },
  //   },
  //   {
  //     name: 'firefox',
  //     use: { ...devices['Desktop Firefox'] },
  //   },
  //   {
  //     name: 'webkit',
  //     use: { ...devices['Desktop Safari'] },
  //   },
  //   // DISPLAY: TV/Large Screen Testing
  //   {
  //     name: 'TV Display (1080p)',
  //     use: {
  //       ...devices['Desktop Chrome'],
  //       viewport: { width: 1920, height: 1080 },
  //     },
  //   },
  //   {
  //     name: 'TV Display (4K)',
  //     use: {
  //       ...devices['Desktop Chrome'],
  //       viewport: { width: 3840, height: 2160 },
  //     },
  //   },
  // ],

  // No webServer needed - we test deployed URLs directly (Google Apps Script via Cloudflare Workers)
});
