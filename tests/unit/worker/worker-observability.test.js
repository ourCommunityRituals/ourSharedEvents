/**
 * Worker Observability Tests - Story 5
 *
 * Tests for routing error observability and logging.
 * Validates that:
 * 1. Structured route logs are generated for HTML routes
 * 2. 404 responses don't silently proxy to GAS
 * 3. Bogus routes like /not-a-page return clean 404
 * 4. No HTML routes are ever proxied to GAS
 *
 * Acceptance Criteria (Story 5):
 * - Worker logs show: [ROUTE] /events -> template=Admin env=stg
 * - No Worker log line ever says "/events proxied to GAS"
 * - Bogus route /not-a-page returns clean 404, not redirect to GAS
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Source File Paths
// =============================================================================

const WORKER_PATH = path.join(__dirname, '../../cloudflare-proxy/worker.js');
const WRANGLER_PATH = path.join(__dirname, '../../cloudflare-proxy/wrangler.toml');
const NUSDK_PATH = path.join(__dirname, '../../src/mvp/NUSDK.html');

// =============================================================================
// Helper Functions
// =============================================================================

function readFileContent(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// =============================================================================
// Test Suites
// =============================================================================

describe('Story 5: Worker Observability & Logging', () => {
  let workerContent;

  beforeAll(() => {
    workerContent = readFileContent(WORKER_PATH);
  });

  describe('Structured Route Logging', () => {
    it('should have logRouteResolution function', () => {
      expect(workerContent).toContain('function logRouteResolution(path, templateName, env)');
    });

    it('should log routes with [ROUTE] prefix', () => {
      expect(workerContent).toContain('[ROUTE]');
      // Format: [ROUTE] /path -> template=X env=Y
      expect(workerContent).toMatch(/\[ROUTE\].*template=.*env=/);
    });

    it('should include template name in route logs', () => {
      expect(workerContent).toContain('template=${templateName}');
    });

    it('should include environment identifier in route logs', () => {
      expect(workerContent).toContain('env=${envId}');
    });

    it('should call logRouteResolution in handleHtmlPageRequest', () => {
      // Find handleHtmlPageRequest function and check it calls logRouteResolution
      const funcMatch = workerContent.match(/async function handleHtmlPageRequest[\s\S]*?^}/m);
      expect(funcMatch).toBeTruthy();
      expect(funcMatch[0]).toContain('logRouteResolution(');
    });
  });

  describe('Environment Detection', () => {
    it('should have getEnvironmentId function', () => {
      expect(workerContent).toContain('function getEnvironmentId(env)');
    });

    it('should detect staging from ENABLE_DEBUG_ENDPOINTS', () => {
      expect(workerContent).toContain("ENABLE_DEBUG_ENDPOINTS === 'true'");
    });

    it('should return stg for staging environment', () => {
      expect(workerContent).toContain("return 'stg'");
    });

    it('should return prod for production environment', () => {
      expect(workerContent).toContain("return 'prod'");
    });
  });

  describe('404 Logging', () => {
    it('should have log404Response function', () => {
      expect(workerContent).toContain('function log404Response(path, reason, env)');
    });

    it('should log 404s with [404] prefix', () => {
      expect(workerContent).toContain('[404]');
    });

    it('should include reason in 404 logs', () => {
      expect(workerContent).toContain('reason=');
    });

    it('should call log404Response for invalid routes', () => {
      expect(workerContent).toContain('log404Response(url.pathname + url.search, validation.reason, env)');
    });
  });

  describe('GAS Proxy Logging (DEPRECATED - Story 5.2)', () => {
    // Story 5.2: GAS proxy is deprecated. All routes use Worker-native implementations.
    // These tests verify the legacy logging functions still exist but are no longer called.

    it('should have logGasProxy function (kept for reference)', () => {
      expect(workerContent).toContain('function logGasProxy(proxyType, path, env)');
    });

    it('should log GAS proxy with [GAS_PROXY] prefix (function exists)', () => {
      expect(workerContent).toContain('[GAS_PROXY]');
    });

    it('should include proxy type in GAS proxy logs (function format)', () => {
      expect(workerContent).toContain('type=${proxyType}');
    });

    // Story 5.2: These routes no longer call logGasProxy
    it('should NOT log API requests as GAS proxy (Story 5.2: deprecated, returns 410)', () => {
      // Legacy API now returns 410 Gone, not proxied to GAS
      expect(workerContent).toContain('[API_DEPRECATED]');
    });

    it('should NOT log shortlinks as GAS proxy (Story 5.2: Worker-native)', () => {
      // Shortlinks now use Worker-native Sheets API
      expect(workerContent).toContain('[SHORTLINK] Worker-native resolution');
    });

    it('should NOT log JSON pages as GAS proxy (Story 5.2: redirects to /api/v2)', () => {
      // JSON pages now redirect to /api/v2/*
      expect(workerContent).toContain('[JSON_REDIRECT]');
    });
  });

  describe('HTML Routes Never Proxy to GAS', () => {
    it('should NOT call logGasProxy for HTML routes', () => {
      // Extract the routing logic section
      const routingMatch = workerContent.match(/else if \(routeParams\.page && Object\.hasOwn\(HTML_ROUTE_MAP[\s\S]*?handleHtmlPageRequest\(url, routeParams, env\)/);
      expect(routingMatch).toBeTruthy();

      // The HTML route section should NOT have logGasProxy
      expect(routingMatch[0]).not.toContain('logGasProxy');
    });

    it('should document that NO routes call GAS (Story 5.2)', () => {
      // Story 5.2: NO routes proxy to GAS - all Worker-native
      expect(workerContent).toContain('NO routes proxy to GAS');
    });

    it('should have Story 5 comment in HTML route section', () => {
      expect(workerContent).toContain('Story 5: HTML routes are logged via logRouteResolution');
    });
  });
});

describe('Story 5: Bogus Route 404 Handling', () => {
  let workerContent;

  beforeAll(() => {
    workerContent = readFileContent(WORKER_PATH);
  });

  // Simulate validateRoute for testing
  function simulateValidateRoute(pathname, searchParams = {}) {
    // Extract canonical routes from worker
    const pagesMatch = workerContent.match(/const CANONICAL_PAGES = Object\.freeze\(\{([^}]+)\}\)/s);
    const canonicalPages = {};
    if (pagesMatch) {
      const entries = pagesMatch[1].matchAll(/'([^']+)':\s*'([^']+)'/g);
      for (const match of entries) {
        canonicalPages[match[1]] = match[2];
      }
    }

    const pathMatch = workerContent.match(/const CANONICAL_PATH_TO_PAGE = Object\.freeze\(\{([\s\S]*?)\}\)/);
    const canonicalPaths = {};
    if (pathMatch) {
      const entries = pathMatch[1].matchAll(/'([^']+)':\s*'([^']+)'/g);
      for (const match of entries) {
        canonicalPaths[match[1]] = match[2];
      }
    }

    const brandsMatch = workerContent.match(/const VALID_BRANDS = Object\.freeze\(\[([\s\S]*?)\]\)/);
    const validBrands = [];
    if (brandsMatch) {
      const entries = brandsMatch[1].matchAll(/'([^']+)'/g);
      for (const match of entries) {
        validBrands.push(match[1]);
      }
    }

    const page = searchParams.page;
    const isApiRequest = pathname.startsWith('/api');

    // Validate page
    if (page) {
      const valid = Object.hasOwn(canonicalPages, page);
      return { valid, reason: valid ? null : `Unknown page: ${page}` };
    }

    // Validate path
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) {
      return { valid: true };
    }

    const firstSegment = segments[0].toLowerCase();
    const isValidFirstSegment = Object.hasOwn(canonicalPaths, firstSegment) ||
                                 validBrands.includes(firstSegment);

    if (!isValidFirstSegment) {
      return { valid: false, reason: `Unknown path: ${pathname}` };
    }

    return { valid: true };
  }

  describe('Bogus Routes Return 404', () => {
    const bogusRoutes = [
      { pathname: '/not-a-page', desc: '/not-a-page' },
      { pathname: '/unknown-route', desc: '/unknown-route' },
      { pathname: '/random', desc: '/random' },
      { pathname: '/foo', desc: '/foo' },
      { pathname: '/bar', desc: '/bar' },
      { pathname: '/test123', desc: '/test123' },
      { pathname: '/some-fake-page', desc: '/some-fake-page' },
    ];

    it.each(bogusRoutes)('should return 404 for $desc', ({ pathname }) => {
      const result = simulateValidateRoute(pathname);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unknown path');
    });

    it('should return 404 for ?page=not-a-page', () => {
      const result = simulateValidateRoute('/', { page: 'not-a-page' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unknown page');
    });

    it('should return 404 for ?page=bogus', () => {
      const result = simulateValidateRoute('/', { page: 'bogus' });
      expect(result.valid).toBe(false);
    });
  });

  describe('Valid Routes Pass Validation', () => {
    const validRoutes = [
      { pathname: '/events', desc: '/events' },
      { pathname: '/admin', desc: '/admin' },
      { pathname: '/display', desc: '/display' },
      { pathname: '/poster', desc: '/poster' },
      { pathname: '/status', desc: '/status' },
      { pathname: '/', desc: '/' },
    ];

    it.each(validRoutes)('should accept $desc', ({ pathname }) => {
      const result = simulateValidateRoute(pathname);
      expect(result.valid).toBe(true);
    });
  });

  describe('404 Response Content', () => {
    it('should have generate404Page function', () => {
      expect(workerContent).toContain('function generate404Page');
    });

    it('should include valid routes list in 404 page', () => {
      expect(workerContent).toContain('/events');
      expect(workerContent).toContain('/admin');
      expect(workerContent).toContain('/display');
      expect(workerContent).toContain('/poster');
      expect(workerContent).toContain('/status');
    });

    it('should include error code 404 in response', () => {
      expect(workerContent).toContain('status: 404');
    });

    it('should never redirect bogus routes to GAS', () => {
      // The 404 handler should NOT proxy to GAS
      const func404Match = workerContent.match(/function create404Response[\s\S]*?^}/m);
      expect(func404Match).toBeTruthy();
      expect(func404Match[0]).not.toContain('fetch(appsScriptBase');
      expect(func404Match[0]).not.toContain('proxyToAppsScript');
    });
  });
});

describe('Story 5: NU SDK Logging Configuration', () => {
  let nusdkContent;

  beforeAll(() => {
    nusdkContent = readFileContent(NUSDK_PATH);
  });

  describe('Log Level Auto-Detection', () => {
    it('should have logLevel configuration', () => {
      expect(nusdkContent).toContain("logLevel:");
    });

    it('should auto-detect staging environment', () => {
      expect(nusdkContent).toContain('stg.eventangle.com');
      expect(nusdkContent).toContain('localhost');
    });

    it('should set debug level for staging', () => {
      expect(nusdkContent).toContain("NU._config.logLevel = 'debug'");
    });

    it('should set error level for production', () => {
      expect(nusdkContent).toContain("NU._config.logLevel = 'error'");
    });

    it('should have LOG_LEVELS constant', () => {
      expect(nusdkContent).toContain('_LOG_LEVELS:');
      expect(nusdkContent).toContain("none: 0");
      expect(nusdkContent).toContain("error: 1");
      expect(nusdkContent).toContain("debug: 2");
    });
  });

  describe('RPC Logging', () => {
    it('should log RPC start events', () => {
      expect(nusdkContent).toContain("NU._log('debug', 'start'");
    });

    it('should log RPC success events', () => {
      expect(nusdkContent).toContain("NU._log('debug', 'ok'");
    });

    it('should log RPC error events', () => {
      expect(nusdkContent).toContain("NU._log('error'");
    });

    it('should log network failures', () => {
      expect(nusdkContent).toContain("'network_fail'");
    });

    it('should log HTTP failures', () => {
      expect(nusdkContent).toContain("'http_fail'");
    });

    it('should log JSON parse failures', () => {
      expect(nusdkContent).toContain("'json_fail'");
    });
  });

  describe('Rolling Log Buffer', () => {
    it('should have __NU_LOGS__ buffer', () => {
      expect(nusdkContent).toContain('window.__NU_LOGS__');
    });

    it('should limit buffer size', () => {
      expect(nusdkContent).toContain('maxLogs: 100');
    });

    it('should push entries to buffer', () => {
      expect(nusdkContent).toContain('window.__NU_LOGS__.push(entry)');
    });
  });
});

describe('Story 5: Wrangler Configuration', () => {
  let wranglerContent;

  beforeAll(() => {
    wranglerContent = readFileContent(WRANGLER_PATH);
  });

  describe('Staging Debug Configuration', () => {
    it('should have DEBUG_LEVEL in staging vars', () => {
      expect(wranglerContent).toContain('DEBUG_LEVEL = "debug"');
    });

    it('should have ENABLE_DEBUG_ENDPOINTS in staging', () => {
      expect(wranglerContent).toContain('ENABLE_DEBUG_ENDPOINTS = "true"');
    });

    it('should have Story 5 comment for DEBUG_LEVEL', () => {
      expect(wranglerContent).toContain('Story 5: Debug level for observability');
    });
  });

  describe('Production Should NOT Have Debug Enabled', () => {
    it('should NOT have ENABLE_DEBUG_ENDPOINTS in production section', () => {
      // Extract production section
      const prodMatch = wranglerContent.match(/\[env\.production\.vars\]([\s\S]*?)(?=\[env\.|$)/);
      if (prodMatch) {
        expect(prodMatch[1]).not.toContain('ENABLE_DEBUG_ENDPOINTS');
      }
    });
  });
});

describe('Story 5: Log Aggregation Alerting', () => {
  let workerContent;

  beforeAll(() => {
    workerContent = readFileContent(WORKER_PATH);
  });

  describe('Alertable Log Patterns', () => {
    it('should have distinct log prefixes for filtering', () => {
      // These prefixes allow log aggregation tools to create alerts
      expect(workerContent).toContain('[ROUTE]');
      expect(workerContent).toContain('[404]');
      // Story 5.2: GAS_PROXY still exists for legacy reference
      expect(workerContent).toContain('[GAS_PROXY]');
      // Story 5.2: New log prefixes for Worker-native routes
      expect(workerContent).toContain('[SHORTLINK]');
      expect(workerContent).toContain('[API_DEPRECATED]');
    });

    it('should NOT have "proxied to GAS" for HTML routes', () => {
      // DevOps requirement: No log should say HTML was proxied to GAS
      // Story 5.2: NO routes proxy to GAS anymore - all Worker-native

      // Extract handleHtmlPageRequest and verify no GAS proxy logging
      const htmlHandlerMatch = workerContent.match(/async function handleHtmlPageRequest[\s\S]*?return new Response\(html/);
      expect(htmlHandlerMatch).toBeTruthy();
      expect(htmlHandlerMatch[0]).not.toContain('proxied to GAS');
      expect(htmlHandlerMatch[0]).not.toContain('logGasProxy');
    });

    it('should log template name for audit trail', () => {
      expect(workerContent).toContain('template=${templateName}');
    });
  });
});

describe('Story 5: Worker Version', () => {
  let workerContent;

  beforeAll(() => {
    workerContent = readFileContent(WORKER_PATH);
  });

  it('should have version 2.2.0 or higher (Story 5 changes)', () => {
    const versionMatch = workerContent.match(/const WORKER_VERSION = '([^']+)'/);
    expect(versionMatch).toBeTruthy();

    const [major, minor] = versionMatch[1].split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(2);
    if (major === 2) {
      expect(minor).toBeGreaterThanOrEqual(2);
    }
  });
});
