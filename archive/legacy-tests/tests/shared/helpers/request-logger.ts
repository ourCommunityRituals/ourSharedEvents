/**
 * Playwright Request Logger Utility - Story A2
 *
 * Provides comprehensive request/response logging for Playwright tests.
 * Supports observability features for CI/CD debugging.
 *
 * Features:
 * - Logs all network requests with timing
 * - Captures API failure details (status, requestId, error body)
 * - Asserts against banned origins (Google origins)
 * - Provides human-readable failure summaries for CI
 *
 * @example
 * ```typescript
 * import { RequestLogger, BANNED_ORIGINS } from '../shared/helpers/request-logger';
 *
 * test('my test', async ({ page }) => {
 *   const logger = new RequestLogger(page);
 *   logger.start();
 *
 *   await page.goto('/manage');
 *
 *   // Assert no banned origins were called
 *   logger.assertNoBannedOrigins();
 *
 *   // Get summary for CI logs
 *   logger.printSummary();
 * });
 * ```
 */

import { Page, Request, Response } from '@playwright/test';

// ===========================================================================
// BANNED ORIGINS (Story A2 - Origin Safety)
// ===========================================================================

/**
 * Origins that should NEVER be called from the browser.
 * If any of these are detected, tests MUST fail.
 */
export const BANNED_ORIGINS = [
  'script.google.com',
  'script.googleusercontent.com',
  'www.gstatic.com/script',
  'apis.google.com',
];

/**
 * Pattern matchers for banned origins (supports subdomains)
 * Uses lookahead assertion (?=[:/?#]|$) to ensure hostname terminates properly
 * and doesn't match subdomains of untrusted hosts (e.g., script.google.com.evil.com)
 */
export const BANNED_ORIGIN_PATTERNS = [
  /^https?:\/\/([\w-]+\.)?script\.google\.com(?=[:/?#]|$)/i,
  /^https?:\/\/([\w-]+\.)?script\.googleusercontent\.com(?=[:/?#]|$)/i,
  /^https?:\/\/([\w-]+\.)?googleapis\.com\/.*macros/i,
  /\/macros\/s\/[A-Za-z0-9_-]+\/exec(?=\?|$)/i, // GAS deployment URL pattern
];

// ===========================================================================
// TYPES
// ===========================================================================

export interface RequestLogEntry {
  url: string;
  method: string;
  host: string;
  pathname: string;
  timestamp: number;
  resourceType: string;
  isAPI: boolean;
  isBannedOrigin: boolean;
  // Response fields (populated after response)
  status?: number;
  statusText?: string;
  requestId?: string;
  duration?: number;
  errorBody?: string;
  responseHeaders?: Record<string, string>;
}

export interface APIFailure {
  url: string;
  method: string;
  status: number;
  statusText: string;
  requestId?: string;
  errorBody?: string;
  timestamp: number;
}

export interface RequestLoggerSummary {
  baseUrl: string;
  firstNavigationUrl: string | null;
  firstApiHost: string | null;
  totalRequests: number;
  apiRequests: number;
  bannedOriginCalls: RequestLogEntry[];
  apiFailures: APIFailure[];
  allHosts: string[];
}

// ===========================================================================
// REQUEST LOGGER CLASS
// ===========================================================================

export class RequestLogger {
  private page: Page;
  private entries: RequestLogEntry[] = [];
  private apiFailures: APIFailure[] = [];
  private baseUrl: string;
  private isStarted: boolean = false;
  private firstNavigationUrl: string | null = null;
  private requestTimestamps: Map<string, number> = new Map();

  constructor(page: Page, baseUrl?: string) {
    this.page = page;
    this.baseUrl = baseUrl || process.env.BASE_URL || 'https://stg.oursharedevents.com';
  }

  /**
   * Start logging requests and responses
   */
  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    // Log request start
    this.page.on('request', this.handleRequest.bind(this));

    // Log response
    this.page.on('response', this.handleResponse.bind(this));

    // Log request failures
    this.page.on('requestfailed', this.handleRequestFailed.bind(this));

    // Track first navigation
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page.mainFrame() && !this.firstNavigationUrl) {
        this.firstNavigationUrl = frame.url();
      }
    });
  }

  /**
   * Handle outgoing request
   */
  private handleRequest(request: Request): void {
    const url = request.url();
    const urlObj = this.parseUrl(url);
    const isBanned = this.isBannedOrigin(url);
    const isAPI = this.isAPIRequest(url);

    const entry: RequestLogEntry = {
      url,
      method: request.method(),
      host: urlObj?.host || 'unknown',
      pathname: urlObj?.pathname || '/',
      timestamp: Date.now(),
      resourceType: request.resourceType(),
      isAPI,
      isBannedOrigin: isBanned,
    };

    this.entries.push(entry);
    this.requestTimestamps.set(url, entry.timestamp);

    // Immediately log banned origin calls (critical)
    if (isBanned) {
      console.error(`[REQUEST LOGGER] BANNED ORIGIN DETECTED: ${url}`);
    }
  }

  /**
   * Handle response
   */
  private async handleResponse(response: Response): Promise<void> {
    const url = response.url();
    const entry = this.entries.find((e) => e.url === url && !e.status);
    if (!entry) return;

    const startTime = this.requestTimestamps.get(url);
    const headers = response.headers();

    entry.status = response.status();
    entry.statusText = response.statusText();
    entry.duration = startTime ? Date.now() - startTime : undefined;
    entry.requestId = headers['x-request-id'] || headers['cf-ray'] || undefined;
    entry.responseHeaders = headers;

    // Log API failures with details
    if (entry.isAPI && entry.status >= 400) {
      let errorBody: string | undefined;
      try {
        const body = await response.text();
        // Truncate for logging
        errorBody = body.length > 500 ? body.substring(0, 500) + '...' : body;
      } catch {
        errorBody = '[Could not read response body]';
      }

      entry.errorBody = errorBody;

      const failure: APIFailure = {
        url,
        method: entry.method,
        status: entry.status,
        statusText: entry.statusText,
        requestId: entry.requestId,
        errorBody,
        timestamp: entry.timestamp,
      };

      this.apiFailures.push(failure);

      // Log immediately for CI visibility
      this.logAPIFailure(failure);
    }
  }

  /**
   * Handle failed requests (network errors)
   */
  private handleRequestFailed(request: Request): void {
    const url = request.url();
    const entry = this.entries.find((e) => e.url === url && !e.status);
    if (!entry) return;

    const failure = request.failure();
    entry.status = 0;
    entry.statusText = failure?.errorText || 'Request failed';
    entry.errorBody = failure?.errorText;

    if (entry.isAPI) {
      this.apiFailures.push({
        url,
        method: entry.method,
        status: 0,
        statusText: failure?.errorText || 'Network error',
        timestamp: entry.timestamp,
      });

      console.error(`[REQUEST LOGGER] API REQUEST FAILED: ${url}`);
      console.error(`  Error: ${failure?.errorText || 'Unknown'}`);
    }
  }

  /**
   * Log API failure details for CI visibility
   */
  private logAPIFailure(failure: APIFailure): void {
    console.error('');
    console.error('='.repeat(60));
    console.error('[REQUEST LOGGER] API FAILURE DETECTED');
    console.error('='.repeat(60));
    console.error(`  URL:        ${failure.url}`);
    console.error(`  Method:     ${failure.method}`);
    console.error(`  Status:     ${failure.status} ${failure.statusText}`);
    if (failure.requestId) {
      console.error(`  Request ID: ${failure.requestId}`);
    }
    if (failure.errorBody) {
      console.error('  Error Body:');
      console.error(`    ${failure.errorBody.split('\n').join('\n    ')}`);
    }
    console.error('='.repeat(60));
    console.error('');
  }

  /**
   * Check if URL is a banned origin
   */
  private isBannedOrigin(url: string): boolean {
    // Check direct hostname matches
    const urlObj = this.parseUrl(url);
    if (urlObj) {
      for (const banned of BANNED_ORIGINS) {
        if (urlObj.host === banned || urlObj.host.endsWith('.' + banned)) {
          return true;
        }
      }
    }

    // Check pattern matches
    for (const pattern of BANNED_ORIGIN_PATTERNS) {
      if (pattern.test(url)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if request is an API request
   */
  private isAPIRequest(url: string): boolean {
    const urlObj = this.parseUrl(url);
    if (!urlObj) return false;

    // Check for API paths
    if (urlObj.pathname.startsWith('/api/') || urlObj.pathname === '/api') {
      return true;
    }

    // Check for XHR to same origin
    if (urlObj.pathname.includes('page=') || urlObj.search.includes('page=')) {
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
  // ASSERTION METHODS
  // ===========================================================================

  /**
   * Assert that no banned origins were called.
   * Throws an error with detailed information if violations found.
   */
  assertNoBannedOrigins(): void {
    const violations = this.entries.filter((e) => e.isBannedOrigin);

    if (violations.length > 0) {
      const violationList = violations.map((v) => `  - ${v.method} ${v.url}`).join('\n');
      throw new Error(
        `[ORIGIN VIOLATION] Browser made ${violations.length} request(s) to banned Google origins:\n${violationList}\n\n` +
          `This violates the "same-origin only" browser rule (Story A2).\n` +
          `All API calls must go through the Cloudflare Worker at ${this.baseUrl}.`
      );
    }
  }

  /**
   * Assert that the first API host matches the expected origin.
   */
  assertFirstApiHost(expectedHost?: string): void {
    const host = expectedHost || new URL(this.baseUrl).host;
    const firstApiRequest = this.entries.find((e) => e.isAPI);

    if (!firstApiRequest) {
      // No API calls is acceptable
      return;
    }

    if (firstApiRequest.host !== host) {
      throw new Error(
        `[ORIGIN VIOLATION] First API request went to wrong host.\n` +
          `  Expected: ${host}\n` +
          `  Actual:   ${firstApiRequest.host}\n` +
          `  URL:      ${firstApiRequest.url}`
      );
    }
  }

  /**
   * Check if there were any API failures
   */
  hasAPIFailures(): boolean {
    return this.apiFailures.length > 0;
  }

  /**
   * Get all API failures
   */
  getAPIFailures(): APIFailure[] {
    return [...this.apiFailures];
  }

  // ===========================================================================
  // SUMMARY AND LOGGING
  // ===========================================================================

  /**
   * Get a summary of all logged requests
   */
  getSummary(): RequestLoggerSummary {
    const allHosts = [...new Set(this.entries.map((e) => e.host))];
    const apiRequests = this.entries.filter((e) => e.isAPI);
    const firstApiHost = apiRequests.length > 0 ? apiRequests[0].host : null;

    return {
      baseUrl: this.baseUrl,
      firstNavigationUrl: this.firstNavigationUrl,
      firstApiHost,
      totalRequests: this.entries.length,
      apiRequests: apiRequests.length,
      bannedOriginCalls: this.entries.filter((e) => e.isBannedOrigin),
      apiFailures: this.apiFailures,
      allHosts,
    };
  }

  /**
   * Print summary to console (useful for CI logs)
   */
  printSummary(): void {
    const summary = this.getSummary();

    console.log('');
    console.log('='.repeat(60));
    console.log('[REQUEST LOGGER] TEST SUMMARY (Story A2)');
    console.log('='.repeat(60));
    console.log(`  BASE_URL:             ${summary.baseUrl}`);
    console.log(`  First Navigation:     ${summary.firstNavigationUrl || 'N/A'}`);
    console.log(`  First API Host:       ${summary.firstApiHost || 'No API calls'}`);
    console.log(`  Total Requests:       ${summary.totalRequests}`);
    console.log(`  API Requests:         ${summary.apiRequests}`);
    console.log(`  Banned Origin Calls:  ${summary.bannedOriginCalls.length}`);
    console.log(`  API Failures:         ${summary.apiFailures.length}`);
    console.log('');
    console.log('  Hosts contacted:');
    summary.allHosts.forEach((host) => {
      console.log(`    - ${host}`);
    });
    console.log('='.repeat(60));
    console.log('');

    // Log any failures again for easy CI scanning
    if (summary.bannedOriginCalls.length > 0) {
      console.error('');
      console.error('CRITICAL: Banned origins were called!');
      summary.bannedOriginCalls.forEach((call) => {
        console.error(`  - ${call.method} ${call.url}`);
      });
      console.error('');
    }

    if (summary.apiFailures.length > 0) {
      console.error('');
      console.error('API Failures:');
      summary.apiFailures.forEach((failure) => {
        console.error(`  - ${failure.method} ${failure.url}`);
        console.error(`    Status: ${failure.status} ${failure.statusText}`);
        if (failure.requestId) {
          console.error(`    Request ID: ${failure.requestId}`);
        }
      });
      console.error('');
    }
  }

  /**
   * Clear all logged data
   */
  clear(): void {
    this.entries = [];
    this.apiFailures = [];
    this.firstNavigationUrl = null;
    this.requestTimestamps.clear();
  }

  /**
   * Get all entries (for debugging)
   */
  getEntries(): RequestLogEntry[] {
    return [...this.entries];
  }
}

// ===========================================================================
// HELPER FUNCTIONS
// ===========================================================================

/**
 * Create a request logger for a page with automatic summary on test end
 */
export function createRequestLogger(page: Page, baseUrl?: string): RequestLogger {
  const logger = new RequestLogger(page, baseUrl);
  logger.start();
  return logger;
}

/**
 * Check if a URL is a banned Google origin
 */
export function isBannedGoogleOrigin(url: string): boolean {
  try {
    const urlObj = new URL(url);
    for (const banned of BANNED_ORIGINS) {
      if (urlObj.host === banned || urlObj.host.endsWith('.' + banned)) {
        return true;
      }
    }
    for (const pattern of BANNED_ORIGIN_PATTERNS) {
      if (pattern.test(url)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
