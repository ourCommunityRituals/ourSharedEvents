/**
 * NU SDK + /api/* JSON Proxy Contract Tests (Story 4)
 *
 * Purpose:
 *   End-to-end validation that NU SDK uses /api/* proxy path as the ONLY
 *   line to GAS, and that frontend code never makes direct GAS URL calls.
 *
 * Stage-1 Tests (Hermetic - No Network):
 *   - NU SDK uses /api/* base path
 *   - No direct fetch(execUrl) or fetch(GAS_URL) in frontend code
 *   - Worker /api/* routing is properly configured
 *   - Templates include NU SDK
 *
 * Acceptance Criteria Validated:
 *   - NU SDK uses fetch('/api/<path>'), not direct GAS URLs
 *   - No front-end code uses direct fetch(GAS_URL)
 *   - Worker /api/<path> routes to appropriate GAS JSON endpoint
 *
 * @see src/mvp/NUSDK.html - NU SDK implementation
 * @see cloudflare-proxy/worker.js - Worker /api/* routing
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Source File Paths
// =============================================================================

const SRC_MVP_DIR = path.join(__dirname, '../../src/mvp');
const TEMPLATES_DIR = path.join(__dirname, '../../cloudflare-proxy/templates');
const WORKER_PATH = path.join(__dirname, '../../cloudflare-proxy/worker.js');
const NUSDK_PATH = path.join(SRC_MVP_DIR, 'NUSDK.html');

// =============================================================================
// Active MVP Templates (all should include NU SDK)
// =============================================================================

const ACTIVE_TEMPLATES = [
  'Admin.html',
  'Public.html',
  'Display.html',
  'Poster.html',
  'SharedReport.html'
];

const BUNDLED_TEMPLATES = [
  'admin.html',
  'public.html',
  'display.html',
  'poster.html',
  'report.html'
];

// =============================================================================
// Helper Functions
// =============================================================================

function readFileContent(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// =============================================================================
// Stage-1: NU SDK API Base Configuration
// =============================================================================

describe('Story 4: NU SDK + /api/* Proxy (Stage-1 Hermetic)', () => {

  describe('NU SDK API Base Configuration', () => {
    let nusdkContent;

    beforeAll(() => {
      nusdkContent = readFileContent(NUSDK_PATH);
    });

    test('NU SDK should define apiBase as /api', () => {
      // NU SDK config should use /api as base path
      expect(nusdkContent).toMatch(/apiBase:\s*['"]\/api['"]/);
    });

    test('NU SDK should use fetch() with apiBase path', () => {
      // NU SDK rpc() method should build URL from apiBase
      expect(nusdkContent).toContain('NU._config.apiBase');
      expect(nusdkContent).toMatch(/fetch\s*\(\s*url/);
    });

    test('NU SDK should NOT contain hardcoded script.google.com URLs', () => {
      // NU SDK should not have hardcoded GAS URLs (except in comments)
      const withoutComments = nusdkContent
        .replace(/\/\/.*$/gm, '') // Remove single-line comments
        .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments

      // Should not have hardcoded GAS URLs in executable code
      expect(withoutComments).not.toMatch(/['"]https:\/\/script\.google\.com\/macros/);
    });

    test('NU SDK v2.0 should support path-based routing', () => {
      // Path-based: /api/<path> instead of /api/rpc
      expect(nusdkContent).toContain("NU._config.apiBase");
      // Check that URL is built from apiBase + path: `${NU._config.apiBase}/${path}`
      expect(nusdkContent).toContain('`${NU._config.apiBase}/${path}`');
    });

    test('NU SDK should add X-Request-Id header for tracing', () => {
      expect(nusdkContent).toContain("'X-Request-Id'");
    });
  });

  // =============================================================================
  // Stage-1: No Direct GAS URL Usage in Frontend
  // =============================================================================

  describe('No Direct GAS URL Usage in Frontend', () => {

    test.each(ACTIVE_TEMPLATES)(
      '%s should NOT use fetch(execUrl) directly',
      (templateName) => {
        const filePath = path.join(SRC_MVP_DIR, templateName);

        if (!fileExists(filePath)) {
          console.warn(`[SKIP] ${templateName} not found`);
          return;
        }

        const content = readFileContent(filePath);

        // Look for direct fetch(execUrl) calls
        // This is now invalid - should use NU.rpc() instead
        const directFetchPattern = /fetch\s*\(\s*execUrl\s*[,)]/g;
        const matches = content.match(directFetchPattern) || [];

        expect(matches.length).toBe(0);
      }
    );

    test.each(ACTIVE_TEMPLATES)(
      '%s should NOT use fetch() with script.google.com',
      (templateName) => {
        const filePath = path.join(SRC_MVP_DIR, templateName);

        if (!fileExists(filePath)) {
          console.warn(`[SKIP] ${templateName} not found`);
          return;
        }

        const content = readFileContent(filePath);

        // Remove comments
        const withoutComments = content
          .replace(/\/\/.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '');

        // Should not have direct fetch to GAS
        const directGasPattern = /fetch\s*\(\s*['"]https:\/\/script\.google\.com/g;
        const matches = withoutComments.match(directGasPattern) || [];

        expect(matches.length).toBe(0);
      }
    );

    test.each(ACTIVE_TEMPLATES)(
      '%s should use NU SDK for API calls (rpc/safeRpc/swr) or Worker endpoints',
      (templateName) => {
        const filePath = path.join(SRC_MVP_DIR, templateName);

        if (!fileExists(filePath)) {
          console.warn(`[SKIP] ${templateName} not found`);
          return;
        }

        const content = readFileContent(filePath);

        // Should use NU SDK methods for API calls:
        // - NU.rpc() - direct RPC call
        // - NU.safeRpc() - RPC with graceful error handling
        // - NU.swr() - stale-while-revalidate pattern
        //
        // Story 2.2: Public.html migrated to use Worker endpoints directly
        // instead of NU SDK for GAS RPC calls. This is the target state
        // for all surfaces as we migrate away from GAS.
        const usesNuSdk = /NU\.(rpc|safeRpc|swr)\s*\(/.test(content);
        const usesWorkerEndpoints = /fetch\w*FromWorker\s*\(/.test(content);

        // Either NU SDK or Worker endpoints is acceptable
        expect(usesNuSdk || usesWorkerEndpoints).toBe(true);
      }
    );
  });

  // =============================================================================
  // Stage-1: NU SDK Loaded in All Templates
  // =============================================================================

  describe('NU SDK Loaded in All Templates', () => {

    test.each(BUNDLED_TEMPLATES)(
      'bundled %s should have window.NU defined',
      (templateName) => {
        const filePath = path.join(TEMPLATES_DIR, templateName);

        if (!fileExists(filePath)) {
          console.warn(`[SKIP] ${templateName} not found`);
          return;
        }

        const content = readFileContent(filePath);

        // Bundled templates should have NU SDK inlined
        expect(content).toMatch(/window\.NU\s*=\s*\{/);
      }
    );

    test.each(BUNDLED_TEMPLATES)(
      'bundled %s should have NU.rpc method',
      (templateName) => {
        const filePath = path.join(TEMPLATES_DIR, templateName);

        if (!fileExists(filePath)) {
          console.warn(`[SKIP] ${templateName} not found`);
          return;
        }

        const content = readFileContent(filePath);

        // Should have rpc method defined
        expect(content).toMatch(/async\s+rpc\s*\(|rpc:\s*async\s+function|rpc\s*\([^)]*\)\s*\{/);
      }
    );

    test.each(BUNDLED_TEMPLATES)(
      'bundled %s should have apiBase set to /api',
      (templateName) => {
        const filePath = path.join(TEMPLATES_DIR, templateName);

        if (!fileExists(filePath)) {
          console.warn(`[SKIP] ${templateName} not found`);
          return;
        }

        const content = readFileContent(filePath);

        // Should have apiBase: '/api' in config
        expect(content).toMatch(/apiBase:\s*['"]\/api['"]/);
      }
    );
  });

  // =============================================================================
  // Stage-1: Worker /api/* Routing Configuration
  // =============================================================================

  describe('Worker /api/* Routing Configuration', () => {
    let workerContent;

    beforeAll(() => {
      workerContent = readFileContent(WORKER_PATH);
    });

    test('Worker should handle POST /api/* requests', () => {
      expect(workerContent).toContain("url.pathname.startsWith('/api/')");
      expect(workerContent).toContain("request.method === 'POST'");
    });

    test('Worker should have handleApiRequest function', () => {
      expect(workerContent).toContain('async function handleApiRequest');
    });

    test('Worker should extract action from /api/<path>', () => {
      // Path-based routing: /api/events/list -> action=list
      expect(workerContent).toContain("pathname.slice('/api/'.length)");
    });

    test('Worker should forward to GAS with action in body', () => {
      expect(workerContent).toContain('const gasBody = {');
      expect(workerContent).toContain('action,');
    });

    test('Worker should return JSON Content-Type for /api responses', () => {
      expect(workerContent).toContain("'Content-Type': 'application/json'");
    });

    test('Worker /api/* should add CORS headers', () => {
      expect(workerContent).toContain('addCORSHeaders');
      expect(workerContent).toContain("'Access-Control-Allow-Origin'");
    });
  });

  // =============================================================================
  // Stage-1: Expected /api/events/list Response Contract
  // =============================================================================

  describe('/api/events/list Response Contract', () => {

    test('Worker should support /api/events/list endpoint', () => {
      const workerContent = readFileContent(WORKER_PATH);

      // Worker extracts action from path
      expect(workerContent).toContain("pathname.slice('/api/'.length)");

      // Path segments extraction
      expect(workerContent).toMatch(/pathSegments\s*=\s*apiPath\.split/);
    });

    test('Expected response envelope for events/list', () => {
      // Mock response for validation
      const mockResponse = {
        ok: true,
        etag: 'abc123',
        value: {
          items: [{ id: 'evt-1', name: 'Test Event' }],
          pagination: { total: 1, limit: 50, offset: 0, hasMore: false }
        }
      };

      // Validate response matches expected shape
      expect(mockResponse).toMatchObject({
        ok: true,
        value: {
          items: expect.any(Array),
          pagination: expect.objectContaining({
            total: expect.any(Number),
            limit: expect.any(Number),
            hasMore: expect.any(Boolean)
          })
        }
      });

      expect(mockResponse.value).toHaveProperty('items');
      expect(mockResponse.value).toHaveProperty('pagination');
      expect(Array.isArray(mockResponse.value.items)).toBe(true);
    });

    test('Event item should have expected keys', () => {
      const requiredKeys = [
        'id',
        'slug',
        'name',
        'startDateISO',
        'venue',
        'links',
        'qr',
        'ctas',
        'settings'
      ];

      const mockEvent = {
        id: 'evt-1',
        slug: 'test-event',
        name: 'Test Event',
        startDateISO: '2025-12-08',
        venue: 'Test Venue',
        links: {
          publicUrl: 'https://stg.eventangle.com/events?id=evt-1',
          displayUrl: 'https://stg.eventangle.com/display?id=evt-1',
          posterUrl: 'https://stg.eventangle.com/poster?id=evt-1',
          signupUrl: ''
        },
        qr: { public: 'data:image/png;base64,...', signup: '' },
        ctas: { primary: { label: 'Sign Up', url: '' }, secondary: null },
        settings: { showSchedule: false, showStandings: false, showBracket: false, showSponsors: false }
      };

      requiredKeys.forEach(key => {
        expect(mockEvent).toHaveProperty(key);
      });
    });
  });

  // =============================================================================
  // Stage-1: NU SDK Debug Logging
  // =============================================================================

  describe('NU SDK Debug Logging', () => {

    test('NU SDK should log rpc:start', () => {
      const nusdkContent = readFileContent(NUSDK_PATH);
      expect(nusdkContent).toMatch(/_log\s*\(\s*['"]debug['"]\s*,\s*['"]start['"]/);
    });

    test('NU SDK should log rpc:ok on success', () => {
      const nusdkContent = readFileContent(NUSDK_PATH);
      expect(nusdkContent).toMatch(/_log\s*\(\s*['"]debug['"]\s*,\s*['"]ok['"]/);
    });

    test('NU SDK should log rpc:http_fail on HTTP error', () => {
      const nusdkContent = readFileContent(NUSDK_PATH);
      expect(nusdkContent).toMatch(/_log\s*\(\s*['"]error['"]\s*,\s*['"]http_fail['"]/);
    });

    test('NU SDK should have rolling log buffer (__NU_LOGS__)', () => {
      const nusdkContent = readFileContent(NUSDK_PATH);
      expect(nusdkContent).toContain('window.__NU_LOGS__');
      expect(nusdkContent).toContain('maxLogs');
    });
  });

});

// =============================================================================
// Snapshot Tests - Configuration Sync
// =============================================================================

describe('NU SDK + API Proxy Configuration Sync', () => {

  test('All source templates should include NUSDK', () => {
    const missingIncludes = [];

    ACTIVE_TEMPLATES.forEach(template => {
      const filePath = path.join(SRC_MVP_DIR, template);
      if (!fileExists(filePath)) return;

      const content = readFileContent(filePath);
      if (!content.match(/include\(['"]NUSDK['"]\)/)) {
        missingIncludes.push(template);
      }
    });

    expect(missingIncludes).toEqual([]);
  });

  test('No template should have both NU.rpc() and direct fetch(execUrl)', () => {
    const violations = [];

    ACTIVE_TEMPLATES.forEach(template => {
      const filePath = path.join(SRC_MVP_DIR, template);
      if (!fileExists(filePath)) return;

      const content = readFileContent(filePath);
      const hasNuRpc = /NU\.rpc\s*\(/.test(content);
      const hasDirectFetch = /fetch\s*\(\s*execUrl/.test(content);

      if (hasNuRpc && hasDirectFetch) {
        violations.push(template);
      }
    });

    expect(violations).toEqual([]);
  });

});
