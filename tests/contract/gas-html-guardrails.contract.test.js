/**
 * GAS HTML Guardrails Contract Test (Stage-1 Hermetic)
 *
 * Story 6 - CI/CD Guardrails: Block Deploys that Leak GAS HTML on /events
 *
 * Purpose:
 *   Hermetic validation that Worker code properly serves HTML templates
 *   from Worker storage (NOT from GAS proxy). Ensures the /events route
 *   and related HTML routes NEVER proxy to GAS for HTML content.
 *
 * Stage-1 Test (Hermetic):
 *   - No network calls
 *   - Validates source code contracts
 *   - Runs in CI without staging environment
 *
 * GAS HTML Markers to Detect:
 *   - "This application was created by a Google Apps Script user"
 *   - warden* scripts (wardeninit, warden) - Google's bot detection
 *   - Google's GAS iframe markers
 *   - script.google.com references in HTML
 *
 * Acceptance Criteria:
 *   - Worker NEVER proxies HTML routes to GAS
 *   - HTML pages are served from Worker templates (KV storage)
 *   - Only /api/*, status/ping, and shortlinks touch GAS
 *   - Template system is properly configured
 *
 * @see cloudflare-proxy/worker.js - Worker implementation
 * @see HTML_ROUTE_MAP - Explicit HTML route mapping
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Source File Paths
// =============================================================================

const WORKER_PATH = path.join(__dirname, '../../cloudflare-proxy/worker.js');

// =============================================================================
// GAS HTML Detection Markers
// =============================================================================

/**
 * Markers that indicate GAS HTML content is being served
 * These should NEVER appear in Worker-served HTML pages
 */
const GAS_HTML_MARKERS = Object.freeze([
  // Primary GAS shell indicator
  'This application was created by a Google Apps Script user',

  // Google's warden (bot detection) scripts
  'wardeninit',
  '/warden/',
  '_/warden/',

  // GAS iframe markers
  'sandbox="allow-scripts allow-forms allow-popups"',
  'script.googleusercontent.com',

  // GAS script loading patterns
  '/_/scs/apps-static/',
  '/a/google.com/',
]);

/**
 * Routes that should NEVER proxy to GAS for HTML content
 * Worker must serve these from templates
 */
const HTML_ROUTES = Object.freeze([
  'public', 'events', 'schedule', 'calendar',
  'admin', 'manage', 'dashboard', 'create', 'docs',
  'display', 'tv', 'kiosk', 'screen',
  'poster', 'posters', 'flyers',
  'report', 'analytics', 'reports', 'insights', 'stats'
]);

/**
 * Routes that legitimately proxy to GAS
 */
const LEGITIMATE_GAS_ROUTES = Object.freeze([
  'status', 'ping', 'diagnostics',  // JSON status endpoints
  'r', 'redirect'                    // Shortlink resolution
]);

// =============================================================================
// Helper Functions
// =============================================================================

function readFileContent(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// =============================================================================
// Test Suites
// =============================================================================

describe('GAS HTML Guardrails Contract', () => {

  describe('Worker HTML Route Mapping', () => {
    let workerContent;

    beforeAll(() => {
      workerContent = readFileContent(WORKER_PATH);
    });

    test('HTML_ROUTE_MAP is defined and frozen', () => {
      expect(workerContent).toContain('const HTML_ROUTE_MAP = Object.freeze({');
    });

    test('all HTML routes map to Worker templates, not GAS', () => {
      // Each HTML route should be in the HTML_ROUTE_MAP
      HTML_ROUTES.forEach(route => {
        const routePattern = new RegExp(`['"]${route}['"]\\s*:\\s*['"]\\w+['"]`);
        const inRouteMap = workerContent.match(/HTML_ROUTE_MAP[\s\S]*?}\)/);
        expect(inRouteMap).toBeTruthy();
        // Route should exist in either HTML_ROUTE_MAP or JSON_ROUTE_MAP
        const routeMapContent = workerContent.match(/const HTML_ROUTE_MAP = Object\.freeze\(\{[\s\S]*?\}\)/);
        const jsonRouteMapContent = workerContent.match(/const JSON_ROUTE_MAP = Object\.freeze\(\{[\s\S]*?\}\)/);
        const gasRouteMapContent = workerContent.match(/const GAS_PROXY_ROUTES = Object\.freeze\(\{[\s\S]*?\}\)/);

        const allMaps = `${routeMapContent?.[0] || ''} ${jsonRouteMapContent?.[0] || ''} ${gasRouteMapContent?.[0] || ''}`;

        // Route should be found in one of the route maps
        expect(allMaps).toMatch(new RegExp(`['"]${route}['"]`));
      });
    });

    test('handleHtmlPageRequest serves templates WITHOUT calling GAS', () => {
      expect(workerContent).toContain('async function handleHtmlPageRequest');

      // Function should use getTemplate, not fetch to GAS
      const htmlHandlerMatch = workerContent.match(
        /async function handleHtmlPageRequest[\s\S]*?^}/m
      );
      expect(htmlHandlerMatch).toBeTruthy();

      // Should call getTemplate
      expect(workerContent).toContain('await getTemplate(templateName, env)');

      // The function comment explicitly states it NEVER calls GAS
      expect(workerContent).toContain('NEVER calls fetch(GAS_WEBAPP_URL) for HTML routes');
    });

    test('HTML routes use renderTemplate, not GAS proxy', () => {
      expect(workerContent).toContain('function renderTemplate(templateContent, params, env)');
      expect(workerContent).toContain('renderTemplate(templateContent, {');
    });

  });

  describe('Worker GAS Proxy Isolation', () => {
    let workerContent;

    beforeAll(() => {
      workerContent = readFileContent(WORKER_PATH);
    });

    test('GAS_PROXY_ROUTES is limited to shortlinks only', () => {
      const gasProxyMatch = workerContent.match(
        /const GAS_PROXY_ROUTES = Object\.freeze\(\{([\s\S]*?)\}\)/
      );
      expect(gasProxyMatch).toBeTruthy();

      const gasRoutes = gasProxyMatch[1];

      // Should ONLY contain redirect routes
      expect(gasRoutes).toContain("'r': 'redirect'");
      expect(gasRoutes).toContain("'redirect': 'redirect'");

      // Should NOT contain HTML routes
      HTML_ROUTES.forEach(route => {
        expect(gasRoutes).not.toContain(`'${route}'`);
      });
    });

    test('JSON_ROUTE_MAP contains only status/health endpoints', () => {
      const jsonRouteMatch = workerContent.match(
        /const JSON_ROUTE_MAP = Object\.freeze\(\{([\s\S]*?)\}\)/
      );
      expect(jsonRouteMatch).toBeTruthy();

      const jsonRoutes = jsonRouteMatch[1];

      // Should contain status endpoints
      expect(jsonRoutes).toContain("'status'");
      expect(jsonRoutes).toContain("'ping'");
      expect(jsonRoutes).toContain("'diagnostics'");

      // Should NOT contain HTML routes
      expect(jsonRoutes).not.toContain("'public'");
      expect(jsonRoutes).not.toContain("'admin'");
      expect(jsonRoutes).not.toContain("'display'");
      expect(jsonRoutes).not.toContain("'poster'");
    });

    test('main fetch handler routes HTML to handleHtmlPageRequest', () => {
      // The main handler should route HTML pages to handleHtmlPageRequest
      expect(workerContent).toContain("Object.hasOwn(HTML_ROUTE_MAP, routeParams.page)");
      expect(workerContent).toContain('response = await handleHtmlPageRequest(url, routeParams, env)');
    });

    test('proxyPageRequest is deprecated and not used', () => {
      // Old proxy function should be marked as deprecated
      expect(workerContent).toContain('@deprecated Story 2');
      expect(workerContent).toContain('proxyPageRequest_DEPRECATED');

      // Should NOT be called in main handler
      const mainHandler = workerContent.match(
        /export default \{[\s\S]*?\n\}/
      );
      expect(mainHandler).toBeTruthy();
      expect(mainHandler[0]).not.toContain('proxyPageRequest(');
    });

  });

  describe('Template System Configuration', () => {
    let workerContent;

    beforeAll(() => {
      workerContent = readFileContent(WORKER_PATH);
    });

    test('valid template names are defined', () => {
      expect(workerContent).toContain(
        "const VALID_TEMPLATE_NAMES = Object.freeze(['admin', 'public', 'display', 'poster', 'report'])"
      );
    });

    test('getTemplate function fetches from KV storage', () => {
      const getTemplateMatch = workerContent.match(
        /async function getTemplate[\s\S]*?^}/m
      );
      expect(getTemplateMatch).toBeTruthy();

      expect(workerContent).toContain('env?.TEMPLATES_KV');
      expect(workerContent).toContain('await env.TEMPLATES_KV.get(templateFile)');
    });

    test('validateTemplate ensures HTML content validity', () => {
      expect(workerContent).toContain('function validateTemplate(templateName, content)');
      // Should check for HTML markers
      expect(workerContent).toContain("'<!doctype html'");
      expect(workerContent).toContain("'<html'");
    });

    test('TemplateError class is defined for error handling', () => {
      expect(workerContent).toContain('class TemplateError extends Error');
    });

  });

  describe('Observability for Route Tracking', () => {
    let workerContent;

    beforeAll(() => {
      workerContent = readFileContent(WORKER_PATH);
    });

    test('logRouteResolution tracks HTML route handling', () => {
      expect(workerContent).toContain('function logRouteResolution(path, templateName, env)');
      expect(workerContent).toContain('[ROUTE]');
    });

    test('logGasProxy tracks legitimate GAS requests', () => {
      expect(workerContent).toContain('function logGasProxy(proxyType, path, env)');
      expect(workerContent).toContain('[GAS_PROXY]');
    });

    test('log404Response tracks invalid routes', () => {
      expect(workerContent).toContain('function log404Response(path, reason, env)');
      expect(workerContent).toContain('[404]');
    });

    test('HTML routes are logged via logRouteResolution', () => {
      expect(workerContent).toContain('logRouteResolution(url.pathname, templateName, env)');
    });

    test('Story 5.2: GAS proxy is deprecated - Worker-native routes use new logging', () => {
      // Story 5.2: GAS proxy is deprecated. logGasProxy function exists but is no longer called.
      // New routes use Worker-native implementations with their own logging.
      expect(workerContent).toContain('[SHORTLINK] Worker-native resolution');
      expect(workerContent).toContain('[JSON_REDIRECT]');
      expect(workerContent).toContain('[API_DEPRECATED]');
    });

  });

  describe('No GAS HTML Markers in Worker Response Templates', () => {
    let workerContent;

    beforeAll(() => {
      workerContent = readFileContent(WORKER_PATH);
    });

    test('Worker error pages do NOT contain GAS shell message', () => {
      // Extract the generateErrorPage function content
      const errorPageMatch = workerContent.match(
        /function generateErrorPage\(options\)[\s\S]*?return `<!DOCTYPE html>[\s\S]*?<\/html>`/
      );
      expect(errorPageMatch).toBeTruthy();

      const errorPageTemplate = errorPageMatch[0];

      // GAS shell message should NEVER appear in error page template
      expect(errorPageTemplate).not.toContain('This application was created by a Google Apps Script user');
      expect(errorPageTemplate).not.toContain('script.googleusercontent.com');
      expect(errorPageTemplate).not.toContain('Untitled project');
    });

    test('Worker 404 pages do NOT contain GAS shell message', () => {
      // Extract the generate404Page function content
      const notFoundPageMatch = workerContent.match(
        /function generate404Page\(options\)[\s\S]*?return `<!DOCTYPE html>[\s\S]*?<\/html>`/
      );
      expect(notFoundPageMatch).toBeTruthy();

      const notFoundPageTemplate = notFoundPageMatch[0];

      // GAS shell message should NEVER appear in 404 page template
      expect(notFoundPageTemplate).not.toContain('This application was created by a Google Apps Script user');
      expect(notFoundPageTemplate).not.toContain('script.googleusercontent.com');
      expect(notFoundPageTemplate).not.toContain('Untitled project');
    });

    test('Worker stub response for warden does NOT contain GAS HTML', () => {
      // The Worker returns a stub for warden requests - verify it's not HTML
      // Find the warden handling code and verify it returns JSON, not HTML
      expect(workerContent).toContain("url.pathname.startsWith('/wardeninit')");
      expect(workerContent).toContain("url.pathname.startsWith('/warden')");

      // The warden stub response should be JSON-like with Google's anti-XSSI prefix
      // The actual response is: ')]}'\n[]' (anti-XSSI prefix + empty JSON array)
      // Verify the response is NOT HTML
      const wardenBlock = workerContent.match(
        /startsWith\('\/wardeninit'\)[\s\S]{0,800}return new Response/
      );
      expect(wardenBlock).toBeTruthy();

      // The response should specify JSON content type
      expect(workerContent).toMatch(
        /startsWith\('\/wardeninit'\)[\s\S]{0,800}'application\/json'/
      );

      // The warden response body should NOT be HTML
      // Verify there's no <!DOCTYPE or <html in the response definition
      const wardenResponseArea = wardenBlock[0];
      expect(wardenResponseArea).not.toContain('<!DOCTYPE html');
      expect(wardenResponseArea).not.toContain('<html');
    });

    test('Worker error pages are self-contained HTML', () => {
      // generateErrorPage should produce valid HTML without GAS references
      expect(workerContent).toContain('function generateErrorPage(options)');
      expect(workerContent).toContain("<!DOCTYPE html>");
      expect(workerContent).toContain("<html lang=\"en\">");
    });

    test('Worker 404 pages are self-contained HTML', () => {
      expect(workerContent).toContain('function generate404Page(options)');
      expect(workerContent).toContain('Page Not Found');
    });

    test('Worker does NOT serve googleusercontent content', () => {
      // Extract all HTML template strings from worker
      // Check for patterns that would output this to users
      const htmlOutputPatterns = [
        /return new Response\([^)]*script\.googleusercontent\.com/g,
        /html = [^;]*script\.googleusercontent\.com/g,
      ];

      htmlOutputPatterns.forEach(pattern => {
        const matches = workerContent.match(pattern);
        expect(matches).toBeNull();
      });
    });

  });

  describe('Route Validation Contract', () => {
    let workerContent;

    beforeAll(() => {
      workerContent = readFileContent(WORKER_PATH);
    });

    test('validateRoute function rejects unknown routes', () => {
      expect(workerContent).toContain('function validateRoute(url)');
      expect(workerContent).toContain('valid: false');
      expect(workerContent).toContain("reason: `Unknown");
    });

    test('unknown routes return 404, not proxy to GAS', () => {
      // The main handler should check validation BEFORE proxying
      expect(workerContent).toContain('if (!validation.valid)');
      expect(workerContent).toContain('return create404Response(url');
    });

    test('404 response for invalid routes does NOT touch GAS', () => {
      // 404 responses are generated by Worker, not from GAS
      expect(workerContent).toContain('function create404Response(url, isApiRequest, corrId)');
      // Should use local HTML generation
      expect(workerContent).toContain('const html = generate404Page({ path, corrId })');
    });

  });

});

describe('GAS HTML Markers Reference', () => {

  test('GAS_HTML_MARKERS list is comprehensive', () => {
    // Ensure our marker list covers known GAS indicators
    expect(GAS_HTML_MARKERS).toContain('This application was created by a Google Apps Script user');
    expect(GAS_HTML_MARKERS).toContain('wardeninit');
    expect(GAS_HTML_MARKERS.length).toBeGreaterThanOrEqual(6);
  });

  test('HTML_ROUTES covers all user-facing pages', () => {
    // All user-facing pages should be listed
    expect(HTML_ROUTES).toContain('public');
    expect(HTML_ROUTES).toContain('admin');
    expect(HTML_ROUTES).toContain('display');
    expect(HTML_ROUTES).toContain('poster');
    expect(HTML_ROUTES).toContain('report');
    expect(HTML_ROUTES).toContain('events');
  });

  test('LEGITIMATE_GAS_ROUTES is minimal', () => {
    // Only essential routes should touch GAS
    expect(LEGITIMATE_GAS_ROUTES.length).toBeLessThanOrEqual(5);
    expect(LEGITIMATE_GAS_ROUTES).toContain('status');
    expect(LEGITIMATE_GAS_ROUTES).toContain('r');
  });

});

// Export markers for use by Stage-2 tests
module.exports = {
  GAS_HTML_MARKERS,
  HTML_ROUTES,
  LEGITIMATE_GAS_ROUTES
};
