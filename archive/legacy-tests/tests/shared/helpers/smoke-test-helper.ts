/**
 * Smoke Test Helper - Story 5
 *
 * Consolidated helper for Stage-2 smoke tests providing:
 * - Runtime logging of BASE_URL, first navigation URL, first API host
 * - Staging host assertion (stg.oursharedevents.com)
 * - Failure handling with requestId extraction
 * - Environment variable validation
 *
 * Usage:
 * ```typescript
 * import { SmokeTestHelper, assertStagingHost } from '../shared/helpers/smoke-test-helper';
 *
 * test.describe('My Smoke Tests', () => {
 *   let smokeHelper: SmokeTestHelper;
 *
 *   test.beforeEach(async ({ page }) => {
 *     smokeHelper = new SmokeTestHelper(page);
 *   });
 *
 *   test.afterEach(async () => {
 *     smokeHelper.printRuntimeInfo();
 *   });
 *
 *   test('staging test', async ({ page }) => {
 *     await page.goto('/events');
 *     smokeHelper.assertStagingEnvironment();
 *   });
 * });
 * ```
 *
 * @see Story 5 - Expand Playwright Smoke Coverage
 */

import { Page, APIRequestContext } from '@playwright/test';

// ===========================================================================
// CONSTANTS
// ===========================================================================

/**
 * Expected staging host pattern for Stage-2 tests
 * Tests fail if first API host does not include this value
 */
export const STAGING_HOST_PATTERN = 'stg.oursharedevents.com';

/**
 * Production host pattern
 */
export const PRODUCTION_HOST_PATTERN = 'oursharedevents.com';

/**
 * Valid staging hosts (includes legacy patterns)
 */
export const VALID_STAGING_HOSTS = [
  'stg.oursharedevents.com',
  'staging.oursharedevents.com',
  'api-stg.oursharedevents.com',
];

// ===========================================================================
// TYPES
// ===========================================================================

export interface RuntimeInfo {
  baseUrl: string;
  firstNavigationUrl: string | null;
  firstApiHost: string | null;
  firstApiUrl: string | null;
  environment: 'staging' | 'production' | 'unknown';
  timestamp: string;
}

export interface ApiCallInfo {
  url: string;
  host: string;
  pathname: string;
  method: string;
  status?: number;
  requestId?: string;
  timestamp: number;
}

export interface FailureInfo {
  url: string;
  status: number;
  requestId?: string;
  errorBody?: string;
  timestamp: number;
}

// ===========================================================================
// SMOKE TEST HELPER CLASS
// ===========================================================================

export class SmokeTestHelper {
  private page: Page;
  private baseUrl: string;
  private firstNavigationUrl: string | null = null;
  private firstApiCall: ApiCallInfo | null = null;
  private apiCalls: ApiCallInfo[] = [];
  private failures: FailureInfo[] = [];
  private isStarted: boolean = false;

  constructor(page: Page, baseUrl?: string) {
    this.page = page;
    this.baseUrl = baseUrl || process.env.BASE_URL || 'https://stg.oursharedevents.com';
    this.start();
  }

  /**
   * Start monitoring network requests
   */
  private start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    // Track first navigation
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page.mainFrame() && !this.firstNavigationUrl) {
        this.firstNavigationUrl = frame.url();
      }
    });

    // Track API calls
    this.page.on('request', (request) => {
      const url = request.url();
      if (this.isApiRequest(url)) {
        const urlObj = this.parseUrl(url);
        const info: ApiCallInfo = {
          url,
          host: urlObj?.host || 'unknown',
          pathname: urlObj?.pathname || '/',
          method: request.method(),
          timestamp: Date.now(),
        };
        this.apiCalls.push(info);
        if (!this.firstApiCall) {
          this.firstApiCall = info;
        }
      }
    });

    // Track response status and requestId
    this.page.on('response', async (response) => {
      const url = response.url();
      const apiCall = this.apiCalls.find((c) => c.url === url && !c.status);
      if (apiCall) {
        apiCall.status = response.status();
        apiCall.requestId = response.headers()['x-request-id'] || response.headers()['cf-ray'];

        // Track failures
        if (apiCall.status >= 400) {
          let errorBody: string | undefined;
          try {
            errorBody = await response.text();
            if (errorBody.length > 500) {
              errorBody = errorBody.substring(0, 500) + '...';
            }
          } catch {
            errorBody = '[Could not read response body]';
          }

          this.failures.push({
            url,
            status: apiCall.status,
            requestId: apiCall.requestId,
            errorBody,
            timestamp: apiCall.timestamp,
          });
        }
      }
    });
  }

  /**
   * Check if URL is an API request
   */
  private isApiRequest(url: string): boolean {
    const urlObj = this.parseUrl(url);
    if (!urlObj) return false;

    // API paths
    if (urlObj.pathname.startsWith('/api/') || urlObj.pathname === '/api') {
      return true;
    }

    // XHR-style requests
    if (urlObj.search.includes('page=')) {
      return true;
    }

    return false;
  }

  /**
   * Parse URL safely
   */
  private parseUrl(url: string): URL | null {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // RUNTIME INFO
  // ===========================================================================

  /**
   * Get runtime information for CI logging
   */
  getRuntimeInfo(): RuntimeInfo {
    const firstApiHost = this.firstApiCall?.host || null;
    let environment: 'staging' | 'production' | 'unknown' = 'unknown';

    if (firstApiHost) {
      if (
        VALID_STAGING_HOSTS.some((h) => firstApiHost.includes(h)) ||
        firstApiHost.includes('stg.')
      ) {
        environment = 'staging';
      } else if (
        firstApiHost.includes('oursharedevents.com') ||
        firstApiHost === 'oursharedevents.com'
      ) {
        environment = 'production';
      }
    } else {
      // Determine from baseUrl
      const baseHost = this.parseUrl(this.baseUrl)?.host;
      if (baseHost?.includes('stg.') || baseHost?.includes('staging.')) {
        environment = 'staging';
      } else if (baseHost?.includes('oursharedevents.com') && !baseHost.includes('stg.')) {
        environment = 'production';
      }
    }

    return {
      baseUrl: this.baseUrl,
      firstNavigationUrl: this.firstNavigationUrl,
      firstApiHost,
      firstApiUrl: this.firstApiCall?.url || null,
      environment,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Print runtime information to console (for CI logs)
   */
  printRuntimeInfo(): void {
    const info = this.getRuntimeInfo();

    console.log('');
    console.log('='.repeat(70));
    console.log('[SMOKE TEST] Runtime Information (Story 5)');
    console.log('='.repeat(70));
    console.log(`  BASE_URL:             ${info.baseUrl}`);
    console.log(`  First Navigation URL: ${info.firstNavigationUrl || 'N/A'}`);
    console.log(`  First API Host:       ${info.firstApiHost || 'No API calls'}`);
    console.log(`  First API URL:        ${info.firstApiUrl || 'N/A'}`);
    console.log(`  Environment:          ${info.environment.toUpperCase()}`);
    console.log(`  Timestamp:            ${info.timestamp}`);
    console.log('='.repeat(70));

    // Log failures if any
    if (this.failures.length > 0) {
      console.log('');
      console.log('API FAILURES DETECTED:');
      this.failures.forEach((f) => {
        console.log(`  - ${f.url}`);
        console.log(`    Status: ${f.status}`);
        if (f.requestId) console.log(`    Request ID: ${f.requestId}`);
        if (f.errorBody) console.log(`    Error: ${f.errorBody.substring(0, 100)}...`);
      });
    }

    console.log('');
  }

  // ===========================================================================
  // ASSERTIONS
  // ===========================================================================

  /**
   * Assert that the first API host is staging (stg.oursharedevents.com)
   * Throws error if not in staging environment
   */
  assertStagingEnvironment(): void {
    const info = this.getRuntimeInfo();

    if (info.environment !== 'staging') {
      // Check if explicitly running against production (allowed)
      if (process.env.USE_PRODUCTION === 'true') {
        console.log('[SMOKE TEST] Skipping staging assertion - USE_PRODUCTION=true');
        return;
      }

      throw new Error(
        `[STAGING ASSERTION FAILED] First API host does not include staging pattern.\n` +
          `  Expected host to include: ${STAGING_HOST_PATTERN}\n` +
          `  Actual first API host:    ${info.firstApiHost || 'N/A'}\n` +
          `  BASE_URL:                 ${info.baseUrl}\n\n` +
          `This test must run against staging (stg.oursharedevents.com).\n` +
          `Set BASE_URL=https://stg.oursharedevents.com or ensure CI secrets are configured.`
      );
    }
  }

  /**
   * Assert that first API host matches expected pattern
   */
  assertFirstApiHost(expectedHost?: string): void {
    const host = expectedHost || this.parseUrl(this.baseUrl)?.host;
    const firstApiHost = this.firstApiCall?.host;

    if (!firstApiHost) {
      // No API calls is acceptable in some tests
      return;
    }

    if (firstApiHost !== host) {
      throw new Error(
        `[API HOST ASSERTION FAILED] First API call went to wrong host.\n` +
          `  Expected: ${host}\n` +
          `  Actual:   ${firstApiHost}\n` +
          `  URL:      ${this.firstApiCall?.url}`
      );
    }
  }

  /**
   * Get all failures
   */
  getFailures(): FailureInfo[] {
    return [...this.failures];
  }

  /**
   * Get all API calls
   */
  getApiCalls(): ApiCallInfo[] {
    return [...this.apiCalls];
  }

  /**
   * Check if there were any failures
   */
  hasFailures(): boolean {
    return this.failures.length > 0;
  }
}

// ===========================================================================
// STANDALONE HELPER FUNCTIONS
// ===========================================================================

/**
 * Assert that a host string contains the staging pattern
 * Use this for quick assertions in tests
 */
export function assertStagingHost(host: string | null | undefined): void {
  if (!host) {
    throw new Error('[STAGING ASSERTION] Host is null or undefined');
  }

  const isStaging = VALID_STAGING_HOSTS.some(
    (stagingHost) => host === stagingHost || host.includes(stagingHost)
  );

  if (!isStaging && process.env.USE_PRODUCTION !== 'true') {
    throw new Error(
      `[STAGING ASSERTION FAILED] Host does not match staging pattern.\n` +
        `  Expected pattern: ${STAGING_HOST_PATTERN}\n` +
        `  Actual host:      ${host}`
    );
  }
}

/**
 * Get base URL from environment with staging default
 */
export function getBaseUrl(): string {
  return process.env.BASE_URL || 'https://stg.oursharedevents.com';
}

/**
 * Check if running in staging environment
 */
export function isStaging(): boolean {
  const baseUrl = getBaseUrl();
  try {
    const url = new URL(baseUrl);
    return VALID_STAGING_HOSTS.some((h) => url.host === h || url.host.includes(h));
  } catch {
    return false;
  }
}

/**
 * Log base URL and environment info at test start
 * Call this in test.beforeAll or test.beforeEach
 */
export function logTestEnvironment(testName?: string): void {
  const baseUrl = getBaseUrl();
  const env = isStaging()
    ? 'STAGING'
    : process.env.USE_PRODUCTION === 'true'
      ? 'PRODUCTION'
      : 'UNKNOWN';

  console.log('');
  console.log('='.repeat(70));
  console.log(`[SMOKE TEST] ${testName || 'Test Environment'}`);
  console.log('='.repeat(70));
  console.log(`  BASE_URL:    ${baseUrl}`);
  console.log(`  Environment: ${env}`);
  console.log(`  CI:          ${process.env.CI || 'false'}`);
  console.log(`  Timestamp:   ${new Date().toISOString()}`);
  console.log('='.repeat(70));
  console.log('');
}

/**
 * Create formatted failure message for CI logs
 */
export function formatFailureForCI(failure: FailureInfo): string {
  const lines = [
    '='.repeat(60),
    '[SMOKE TEST] API FAILURE',
    '='.repeat(60),
    `  URL:        ${failure.url}`,
    `  Status:     ${failure.status}`,
  ];

  if (failure.requestId) {
    lines.push(`  Request ID: ${failure.requestId}`);
  }

  if (failure.errorBody) {
    lines.push('  Error Body:');
    lines.push(`    ${failure.errorBody.split('\n').join('\n    ')}`);
  }

  lines.push('='.repeat(60));

  return lines.join('\n');
}

// ===========================================================================
// API REQUEST HELPER
// ===========================================================================

/**
 * Make an API request and return response with CI-friendly logging
 */
export async function makeApiRequest(
  request: APIRequestContext,
  path: string,
  options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    logResponse?: boolean;
  }
): Promise<{
  status: number;
  ok: boolean;
  json: any;
  requestId?: string;
  headers: Record<string, string>;
}> {
  const baseUrl = getBaseUrl();
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
  const method = options?.method || 'GET';

  console.log(`[API] ${method} ${url}`);

  const response = await request.fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...options?.headers,
    },
  });

  const headers = response.headers();
  const requestId = headers['x-request-id'] || headers['cf-ray'];
  let json: any = null;

  try {
    json = await response.json();
  } catch {
    json = { error: 'Failed to parse JSON' };
  }

  // Log response
  console.log(`  Status: ${response.status()}`);
  if (requestId) {
    console.log(`  Request ID: ${requestId}`);
  }

  if (options?.logResponse || response.status() >= 400) {
    console.log(`  Response: ${JSON.stringify(json).substring(0, 200)}`);
  }

  return {
    status: response.status(),
    ok: response.ok(),
    json,
    requestId,
    headers,
  };
}
