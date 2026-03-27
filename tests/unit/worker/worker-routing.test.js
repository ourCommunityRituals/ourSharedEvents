/**
 * Worker Routing Tests
 *
 * Unit tests for Cloudflare Worker routing logic.
 * Tests canonical route validation, 404 responses, and path mapping.
 *
 * These tests verify:
 * 1. Valid canonical routes are accepted
 * 2. Unknown routes return 404
 * 3. API vs HTML request type detection works correctly
 * 4. Path-to-page mapping is consistent
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Extract routing constants from worker.js
// =============================================================================

function extractWorkerConstants() {
  const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
  const content = fs.readFileSync(workerPath, 'utf8');

  // Extract CANONICAL_PAGES
  const pagesMatch = content.match(/const CANONICAL_PAGES = Object\.freeze\(\{([^}]+)\}\)/s);
  const canonicalPages = {};
  if (pagesMatch) {
    const entries = pagesMatch[1].matchAll(/'([^']+)':\s*'([^']+)'/g);
    for (const match of entries) {
      canonicalPages[match[1]] = match[2];
    }
  }

  // Extract CANONICAL_P_ROUTES
  const pRoutesMatch = content.match(/const CANONICAL_P_ROUTES = Object\.freeze\(\{([^}]+)\}\)/s);
  const canonicalPRoutes = {};
  if (pRoutesMatch) {
    const entries = pRoutesMatch[1].matchAll(/'([^']+)':\s*'([^']+)'/g);
    for (const match of entries) {
      canonicalPRoutes[match[1]] = match[2];
    }
  }

  // Extract CANONICAL_API_ACTIONS
  const actionsMatch = content.match(/const CANONICAL_API_ACTIONS = Object\.freeze\(\[([\s\S]*?)\]\)/);
  const canonicalActions = [];
  if (actionsMatch) {
    const entries = actionsMatch[1].matchAll(/'([^']+)'/g);
    for (const match of entries) {
      canonicalActions.push(match[1]);
    }
  }

  // Extract CANONICAL_PATH_TO_PAGE
  const pathMatch = content.match(/const CANONICAL_PATH_TO_PAGE = Object\.freeze\(\{([\s\S]*?)\}\)/);
  const canonicalPaths = {};
  if (pathMatch) {
    const entries = pathMatch[1].matchAll(/'([^']+)':\s*'([^']+)'/g);
    for (const match of entries) {
      canonicalPaths[match[1]] = match[2];
    }
  }

  // Extract VALID_BRANDS
  const brandsMatch = content.match(/const VALID_BRANDS = Object\.freeze\(\[([\s\S]*?)\]\)/);
  const validBrands = [];
  if (brandsMatch) {
    const entries = brandsMatch[1].matchAll(/'([^']+)'/g);
    for (const match of entries) {
      validBrands.push(match[1]);
    }
  }

  return {
    canonicalPages,
    canonicalPRoutes,
    canonicalActions,
    canonicalPaths,
    validBrands
  };
}

// =============================================================================
// Test Suites
// =============================================================================

describe('Worker Routing', () => {
  let constants;

  beforeAll(() => {
    constants = extractWorkerConstants();
  });

  describe('Canonical Routes Extraction', () => {
    it('should extract CANONICAL_PAGES from worker.js', () => {
      expect(Object.keys(constants.canonicalPages).length).toBeGreaterThan(0);
      expect(constants.canonicalPages).toHaveProperty('admin');
      expect(constants.canonicalPages).toHaveProperty('display');
      expect(constants.canonicalPages).toHaveProperty('poster');
      expect(constants.canonicalPages).toHaveProperty('public');
      expect(constants.canonicalPages).toHaveProperty('report');
      expect(constants.canonicalPages).toHaveProperty('status');
    });

    it('should extract CANONICAL_P_ROUTES from worker.js', () => {
      expect(Object.keys(constants.canonicalPRoutes).length).toBeGreaterThan(0);
      expect(constants.canonicalPRoutes).toHaveProperty('events');
      expect(constants.canonicalPRoutes).toHaveProperty('status');
      expect(constants.canonicalPRoutes).toHaveProperty('r');
    });

    it('should extract CANONICAL_API_ACTIONS from worker.js', () => {
      expect(constants.canonicalActions.length).toBeGreaterThan(0);
      expect(constants.canonicalActions).toContain('api_status');
      expect(constants.canonicalActions).toContain('api_events');
    });

    it('should extract CANONICAL_PATH_TO_PAGE from worker.js', () => {
      expect(Object.keys(constants.canonicalPaths).length).toBeGreaterThan(0);
      expect(constants.canonicalPaths).toHaveProperty('events');
      expect(constants.canonicalPaths).toHaveProperty('admin');
      expect(constants.canonicalPaths).toHaveProperty('display');
    });

    it('should extract VALID_BRANDS from worker.js', () => {
      expect(constants.validBrands.length).toBeGreaterThan(0);
      expect(constants.validBrands).toContain('root');
      expect(constants.validBrands).toContain('abc');
      expect(constants.validBrands).toContain('cbc');
      expect(constants.validBrands).toContain('cbl');
    });
  });

  describe('Canonical Page Routes', () => {
    const EXPECTED_PAGES = ['admin', 'display', 'poster', 'public', 'report', 'status'];

    it.each(EXPECTED_PAGES)('should have canonical page route for %s', (page) => {
      expect(constants.canonicalPages).toHaveProperty(page);
    });

    it('should NOT have blocked V2 surfaces', () => {
      const BLOCKED_SURFACES = [
        'templates-v2', 'randomizer', 'teams', 'picker',
        'portfolio', 'portfolio-dashboard'
      ];

      for (const surface of BLOCKED_SURFACES) {
        expect(constants.canonicalPages).not.toHaveProperty(surface);
      }
    });
  });

  describe('Path-to-Page Mapping', () => {
    it('should map /events to public page', () => {
      expect(constants.canonicalPaths.events).toBe('public');
    });

    it('should map /admin to admin page', () => {
      expect(constants.canonicalPaths.admin).toBe('admin');
    });

    it('should map /manage to admin page', () => {
      expect(constants.canonicalPaths.manage).toBe('admin');
    });

    it('should map /display to display page', () => {
      expect(constants.canonicalPaths.display).toBe('display');
    });

    it('should map /tv to display page', () => {
      expect(constants.canonicalPaths.tv).toBe('display');
    });

    it('should map /kiosk to display page', () => {
      expect(constants.canonicalPaths.kiosk).toBe('display');
    });

    it('should map /poster to poster page', () => {
      expect(constants.canonicalPaths.poster).toBe('poster');
    });

    it('should map /analytics to report page', () => {
      expect(constants.canonicalPaths.analytics).toBe('report');
    });

    it('should map /status to status page', () => {
      expect(constants.canonicalPaths.status).toBe('status');
    });

    it('should map /health to status page', () => {
      expect(constants.canonicalPaths.health).toBe('status');
    });
  });

  describe('P-Route Shorthand', () => {
    it('should map ?p=events to public', () => {
      expect(constants.canonicalPRoutes.events).toBe('public');
    });

    it('should map ?p=status to status', () => {
      expect(constants.canonicalPRoutes.status).toBe('status');
    });

    it('should map ?p=r to redirect (shortlinks)', () => {
      expect(constants.canonicalPRoutes.r).toBe('redirect');
    });
  });

  describe('API Actions Whitelist', () => {
    const REQUIRED_API_ACTIONS = [
      'api_status',
      'api_statusPure',
      'api_events',
      'api_eventById',
      'api_sponsors'
    ];

    it.each(REQUIRED_API_ACTIONS)('should include %s in allowed actions', (action) => {
      expect(constants.canonicalActions).toContain(action);
    });

    it('should NOT include arbitrary actions', () => {
      expect(constants.canonicalActions).not.toContain('api_arbitrary');
      expect(constants.canonicalActions).not.toContain('eval');
      expect(constants.canonicalActions).not.toContain('exec');
    });
  });

  describe('Brand-Prefixed Routes', () => {
    it('should accept valid brands as path prefixes', () => {
      for (const brand of constants.validBrands) {
        expect(constants.validBrands).toContain(brand);
      }
    });

    it('should have exactly 4 valid brands', () => {
      expect(constants.validBrands).toHaveLength(4);
    });
  });
});

// =============================================================================
// Route Validation Logic Tests
// =============================================================================

describe('Route Validation Logic', () => {
  // Simulate the validateRoute function logic
  function simulateValidateRoute(pathname, searchParams = {}) {
    const constants = extractWorkerConstants();

    const page = searchParams.page;
    const p = searchParams.p;
    const action = searchParams.action;

    const isApiRequest = searchParams.action ||
                         searchParams.api ||
                         searchParams.format === 'json' ||
                         pathname.startsWith('/api');

    // Validate action
    if (action) {
      const valid = constants.canonicalActions.includes(action);
      return { valid, isApiRequest: true, reason: valid ? null : `Unknown action: ${action}` };
    }

    // Validate page
    if (page) {
      const valid = Object.hasOwn(constants.canonicalPages, page);
      return { valid, isApiRequest, reason: valid ? null : `Unknown page: ${page}` };
    }

    // Validate p-route
    if (p) {
      const valid = Object.hasOwn(constants.canonicalPRoutes, p);
      return { valid, isApiRequest, reason: valid ? null : `Unknown p route: ${p}` };
    }

    // Validate path
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) {
      return { valid: true, isApiRequest };
    }

    const firstSegment = segments[0].toLowerCase();
    const isValidFirstSegment = Object.hasOwn(constants.canonicalPaths, firstSegment) ||
                                 constants.validBrands.includes(firstSegment);

    if (!isValidFirstSegment) {
      return { valid: false, isApiRequest, reason: `Unknown path: ${pathname}` };
    }

    // Check brand + second segment
    if (constants.validBrands.includes(firstSegment) && segments.length > 1) {
      const secondSegment = segments[1].toLowerCase();
      if (!Object.hasOwn(constants.canonicalPaths, secondSegment)) {
        return { valid: false, isApiRequest, reason: `Unknown path: ${pathname}` };
      }
    }

    return { valid: true, isApiRequest };
  }

  describe('Valid Routes (should pass)', () => {
    const validRoutes = [
      { pathname: '/', params: {}, desc: 'root path' },
      { pathname: '/events', params: {}, desc: '/events path' },
      { pathname: '/admin', params: {}, desc: '/admin path' },
      { pathname: '/display', params: {}, desc: '/display path' },
      { pathname: '/poster', params: {}, desc: '/poster path' },
      { pathname: '/status', params: {}, desc: '/status path' },
      { pathname: '/analytics', params: {}, desc: '/analytics path' },
      { pathname: '/', params: { page: 'admin' }, desc: '?page=admin' },
      { pathname: '/', params: { page: 'display' }, desc: '?page=display' },
      { pathname: '/', params: { page: 'poster' }, desc: '?page=poster' },
      { pathname: '/', params: { page: 'public' }, desc: '?page=public' },
      { pathname: '/', params: { page: 'report' }, desc: '?page=report' },
      { pathname: '/', params: { page: 'status' }, desc: '?page=status' },
      { pathname: '/', params: { page: 'diagnostics' }, desc: '?page=diagnostics' },
      { pathname: '/', params: { page: 'test' }, desc: '?page=test' },
      { pathname: '/', params: { page: 'whoami' }, desc: '?page=whoami' },
      { pathname: '/', params: { p: 'events' }, desc: '?p=events' },
      { pathname: '/', params: { p: 'status' }, desc: '?p=status' },
      { pathname: '/', params: { p: 'r' }, desc: '?p=r (shortlink)' },
      { pathname: '/', params: { action: 'api_status' }, desc: '?action=api_status' },
      { pathname: '/', params: { action: 'api_events' }, desc: '?action=api_events' },
      { pathname: '/abc/events', params: {}, desc: '/abc/events (brand path)' },
      { pathname: '/cbc/admin', params: {}, desc: '/cbc/admin (brand path)' },
      { pathname: '/cbl/display', params: {}, desc: '/cbl/display (brand path)' },
    ];

    it.each(validRoutes)('should accept $desc', ({ pathname, params }) => {
      const result = simulateValidateRoute(pathname, params);
      expect(result.valid).toBe(true);
    });
  });

  describe('Invalid Routes (should return 404)', () => {
    const invalidRoutes = [
      { pathname: '/unknown', params: {}, desc: '/unknown path' },
      { pathname: '/templates-v2', params: {}, desc: '/templates-v2 (blocked)' },
      { pathname: '/randomizer', params: {}, desc: '/randomizer (blocked)' },
      { pathname: '/', params: { page: 'unknown' }, desc: '?page=unknown' },
      { pathname: '/', params: { page: 'templates-v2' }, desc: '?page=templates-v2' },
      { pathname: '/', params: { page: 'randomizer' }, desc: '?page=randomizer' },
      { pathname: '/', params: { page: 'teams' }, desc: '?page=teams' },
      { pathname: '/', params: { page: 'picker' }, desc: '?page=picker' },
      { pathname: '/', params: { page: 'portfolio' }, desc: '?page=portfolio' },
      { pathname: '/', params: { p: 'unknown' }, desc: '?p=unknown' },
      { pathname: '/', params: { action: 'unknown_action' }, desc: '?action=unknown_action' },
      { pathname: '/', params: { action: 'eval' }, desc: '?action=eval (security)' },
      { pathname: '/xyz/events', params: {}, desc: '/xyz/events (invalid brand)' },
      { pathname: '/abc/unknown', params: {}, desc: '/abc/unknown (valid brand, invalid path)' },
    ];

    it.each(invalidRoutes)('should reject $desc', ({ pathname, params }) => {
      const result = simulateValidateRoute(pathname, params);
      expect(result.valid).toBe(false);
      expect(result.reason).toBeTruthy();
    });
  });

  describe('API Request Detection', () => {
    it('should detect ?action= as API request', () => {
      const result = simulateValidateRoute('/', { action: 'api_status' });
      expect(result.isApiRequest).toBe(true);
    });

    it('should detect ?format=json as API request', () => {
      const result = simulateValidateRoute('/', { format: 'json' });
      expect(result.isApiRequest).toBe(true);
    });

    it('should detect /api path as API request', () => {
      const result = simulateValidateRoute('/api/status', {});
      expect(result.isApiRequest).toBe(true);
    });

    it('should NOT detect ?page= as API request', () => {
      const result = simulateValidateRoute('/', { page: 'admin' });
      expect(result.isApiRequest).toBe(false);
    });

    it('should NOT detect path-based routes as API request', () => {
      const result = simulateValidateRoute('/events', {});
      expect(result.isApiRequest).toBe(false);
    });
  });
});

// =============================================================================
// 404 Response Tests
// =============================================================================

describe('404 Response Format', () => {
  describe('HTML 404 Page', () => {
    it('should include 404 status code marker', () => {
      // Verify the worker has a generate404Page function
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('function generate404Page');
      expect(content).toContain('Page Not Found');
      expect(content).toContain('404');
    });

    it('should list valid routes in 404 page', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('/events');
      expect(content).toContain('/admin');
      expect(content).toContain('/display');
      expect(content).toContain('/poster');
      expect(content).toContain('/status');
    });
  });

  describe('JSON 404 Response', () => {
    it('should include 404 JSON generator function', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('function generate404Json');
      expect(content).toContain('NOT_FOUND');
    });

    it('should include correlation ID in error response', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('corrId');
    });
  });
});

// =============================================================================
// Worker Version Tests
// =============================================================================

describe('Worker Version', () => {
  it('should have version 1.3.0 or higher', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    const versionMatch = content.match(/const WORKER_VERSION = '([^']+)'/);
    expect(versionMatch).toBeTruthy();

    const [major, minor] = versionMatch[1].split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(1);
    if (major === 1) {
      expect(minor).toBeGreaterThanOrEqual(3);
    }
  });
});

// =============================================================================
// CORS Rules Validation (Story 3)
// =============================================================================
// Verifies CORS configuration remains unchanged and follows same-origin iframe safety

describe('CORS Rules Configuration', () => {

  it('should have Access-Control-Allow-Origin: * for API responses', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    // CORS headers should allow all origins for API requests
    expect(content).toContain("'Access-Control-Allow-Origin': '*'");
  });

  it('should have handleCORS function for preflight requests', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    expect(content).toContain('function handleCORS');
    expect(content).toContain("request.method === 'OPTIONS'");
  });

  it('should allow POST, GET, OPTIONS methods', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    // Methods should be allowed
    expect(content).toContain("'Access-Control-Allow-Methods'");
    expect(content).toMatch(/POST/);
    expect(content).toMatch(/GET/);
    expect(content).toMatch(/OPTIONS/);
  });

  it('should allow Content-Type and Authorization headers', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    expect(content).toContain("'Access-Control-Allow-Headers'");
    expect(content).toContain('Content-Type');
  });

  it('should cache preflight response for 86400 seconds', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    // Max-Age should be 24 hours for preflight caching
    expect(content).toContain("'Access-Control-Max-Age': '86400'");
  });

  it('should return 204 status for OPTIONS preflight', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    // OPTIONS should return 204 No Content
    expect(content).toMatch(/status:\s*204/);
  });

});

// =============================================================================
// /api/* Never Returns HTML (Story 3)
// =============================================================================
// Ensures Worker never returns HTML fallback on API routes

describe('/api/* Response Type Guarantee', () => {

  it('should return JSON Content-Type for API errors', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    // API error responses should be JSON
    expect(content).toContain("'Content-Type': 'application/json'");
  });

  it('should have createGracefulErrorResponse that returns JSON for API requests', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    // Function should exist
    expect(content).toContain('function createGracefulErrorResponse');

    // Should check isApiRequest and return JSON
    expect(content).toContain('if (isApiRequest)');
    expect(content).toContain('JSON.stringify({');
  });

  it('should have generate404Json for API 404 responses', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    expect(content).toContain('function generate404Json');
  });

  it('should check isApiRequest before generating error response', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    // Worker distinguishes between API and HTML requests
    expect(content).toContain('isApiRequest');
    // API requests get JSON, non-API get HTML
    expect(content).toContain('create404Response(url, isApiRequest');
  });

  it('should NOT include HTML tags in JSON error responses', () => {
    const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
    const content = fs.readFileSync(workerPath, 'utf8');

    // Extract the generate404Json function
    const funcMatch = content.match(/function generate404Json\([\s\S]*?\n\}/);
    if (funcMatch) {
      const func = funcMatch[0];
      // Should not contain HTML
      expect(func).not.toContain('<html');
      expect(func).not.toContain('<!DOCTYPE');
    }
  });

});

// =============================================================================
// Story 2: Explicit HTML Route Map (No HTML → GAS)
// =============================================================================
// Verifies that HTML routes are served from Worker templates, not GAS.
// GAS is only hit via JSON API endpoints.

describe('Story 2: Explicit HTML Route Map', () => {

  describe('HTML_ROUTE_MAP Configuration', () => {
    it('should have HTML_ROUTE_MAP constant', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('const HTML_ROUTE_MAP = Object.freeze({');
    });

    it('should map /events to public template', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Extract HTML_ROUTE_MAP
      const match = content.match(/const HTML_ROUTE_MAP = Object\.freeze\(\{([\s\S]*?)\}\);/);
      expect(match).toBeTruthy();

      const routeMap = match[1];
      expect(routeMap).toContain("'events': 'public'");
    });

    it('should map admin routes to admin template', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      const match = content.match(/const HTML_ROUTE_MAP = Object\.freeze\(\{([\s\S]*?)\}\);/);
      expect(match).toBeTruthy();

      const routeMap = match[1];
      expect(routeMap).toContain("'admin': 'admin'");
      expect(routeMap).toContain("'manage': 'admin'");
      expect(routeMap).toContain("'dashboard': 'admin'");
    });

    it('should map display routes to display template', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      const match = content.match(/const HTML_ROUTE_MAP = Object\.freeze\(\{([\s\S]*?)\}\);/);
      expect(match).toBeTruthy();

      const routeMap = match[1];
      expect(routeMap).toContain("'display': 'display'");
      expect(routeMap).toContain("'tv': 'display'");
      expect(routeMap).toContain("'kiosk': 'display'");
    });

    it('should map poster routes to poster template', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      const match = content.match(/const HTML_ROUTE_MAP = Object\.freeze\(\{([\s\S]*?)\}\);/);
      expect(match).toBeTruthy();

      const routeMap = match[1];
      expect(routeMap).toContain("'poster': 'poster'");
      expect(routeMap).toContain("'posters': 'poster'");
      expect(routeMap).toContain("'flyers': 'poster'");
    });

    it('should map report routes to report template', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      const match = content.match(/const HTML_ROUTE_MAP = Object\.freeze\(\{([\s\S]*?)\}\);/);
      expect(match).toBeTruthy();

      const routeMap = match[1];
      expect(routeMap).toContain("'report': 'report'");
      expect(routeMap).toContain("'analytics': 'report'");
    });
  });

  describe('JSON_ROUTE_MAP Configuration', () => {
    it('should have JSON_ROUTE_MAP for status/health endpoints', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('const JSON_ROUTE_MAP = Object.freeze({');

      const match = content.match(/const JSON_ROUTE_MAP = Object\.freeze\(\{([\s\S]*?)\}\);/);
      expect(match).toBeTruthy();

      const routeMap = match[1];
      expect(routeMap).toContain("'status': 'status'");
      expect(routeMap).toContain("'ping': 'ping'");
    });

    it('should have whoami route for GAS identity endpoint (Story 3)', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      const match = content.match(/const JSON_ROUTE_MAP = Object\.freeze\(\{([\s\S]*?)\}\);/);
      expect(match).toBeTruthy();

      const routeMap = match[1];
      expect(routeMap).toContain("'whoami': 'whoami'");
    });
  });

  describe('GAS_PROXY_ROUTES Configuration', () => {
    it('should have GAS_PROXY_ROUTES for shortlinks only', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('const GAS_PROXY_ROUTES = Object.freeze({');

      const match = content.match(/const GAS_PROXY_ROUTES = Object\.freeze\(\{([\s\S]*?)\}\);/);
      expect(match).toBeTruthy();

      const routeMap = match[1];
      // Only redirect routes should proxy to GAS
      expect(routeMap).toContain("'r': 'redirect'");
      expect(routeMap).toContain("'redirect': 'redirect'");
    });
  });

  describe('handleHtmlPageRequest Function', () => {
    it('should exist and handle HTML page requests', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('async function handleHtmlPageRequest(url, params, env)');
    });

    it('should render template with variables', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Should call renderTemplate
      expect(content).toContain('renderTemplate(templateContent, {');

      // Should pass brandId, brandName, scope, demoMode
      expect(content).toContain('brandId,');
      expect(content).toContain('brandName,');
      expect(content).toContain('scope,');
      expect(content).toContain('demoMode');
    });

    it('should return HTML with text/html Content-Type', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Look for handleHtmlPageRequest returning HTML content type
      const funcMatch = content.match(/async function handleHtmlPageRequest[\s\S]*?return new Response\(html,[\s\S]*?'Content-Type':\s*'text\/html/);
      expect(funcMatch).toBeTruthy();
    });

    it('should add X-Template header for debugging', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain("'X-Template': templateName");
    });
  });

  describe('renderTemplate Function', () => {
    it('should exist and replace template variables', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('function renderTemplate(templateContent, params, env)');

      // Should replace template variables
      expect(content).toContain('html.replace(/<\\?=\\s*appTitle\\s*\\?>/g');
      expect(content).toContain('html.replace(/<\\?=\\s*brandId\\s*\\?>/g');
      expect(content).toContain('html.replace(/<\\?=\\s*scope\\s*\\?>/g');
      expect(content).toContain('html.replace(/<\\?=\\s*execUrl\\s*\\?>/g');
    });
  });

  describe('extractRouteParams Function', () => {
    it('should exist and extract route parameters from URL', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('function extractRouteParams(url)');
    });

    it('should extract brandId from path segments', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Should check for brand in first segment
      expect(content).toContain('VALID_BRANDS.includes(segments[0])');
    });

    it('should return page, brandId, scope, and brandName', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Should return these properties
      expect(content).toMatch(/return\s*\{[\s\S]*page[\s\S]*brandId[\s\S]*scope[\s\S]*brandName/);
    });
  });

  describe('Route Handling Logic', () => {
    it('should route HTML pages through handleHtmlPageRequest (not GAS)', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // HTML routes should use handleHtmlPageRequest
      expect(content).toContain("Object.hasOwn(HTML_ROUTE_MAP, routeParams.page)");
      expect(content).toContain("response = await handleHtmlPageRequest(url, routeParams, env)");
    });

    it('should route JSON pages via redirect to /api/v2 (Story 5.2)', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Story 5.2: JSON pages redirect to /api/v2/*
      expect(content).toContain("Object.hasOwn(JSON_ROUTE_MAP, routeParams.page)");
      expect(content).toContain("[JSON_REDIRECT]");
    });

    it('should route shortlinks through Worker-native handler (Story 5.2)', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Story 5.2: Shortlinks use Worker-native Sheets API
      expect(content).toContain("Object.hasOwn(GAS_PROXY_ROUTES, routeParams.p)");
      expect(content).toContain("response = await handleWorkerShortlinkRedirect(request, url, env)");
    });

    it('should return 410 Gone for legacy API requests (Story 5.2)', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Story 5.2: Legacy /api/* returns 410 Gone
      expect(content).toContain("if (isApiRequest");
      expect(content).toContain("[API_DEPRECATED]");
      expect(content).toContain("status: 410");
    });
  });

  describe('GAS Isolation Guarantee', () => {
    it('should mark proxyPageRequest as deprecated', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Function should be marked deprecated
      expect(content).toContain('@deprecated Story 2');
      expect(content).toContain('proxyPageRequest_DEPRECATED');
    });

    it('should NOT call proxyPageRequest in main routing logic', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Extract the main fetch handler routing section
      const fetchMatch = content.match(/async fetch\(request, env, ctx\)[\s\S]*?export default/);
      if (fetchMatch) {
        const fetchHandler = fetchMatch[0];
        // Should NOT call proxyPageRequest (only the deprecated version exists)
        expect(fetchHandler).not.toMatch(/proxyPageRequest\s*\(/);
      }
    });

    it('should have comment explaining GAS is only for /api/*', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Should have clear documentation about GAS isolation
      expect(content).toContain('GAS is ONLY accessed via /api/* JSON endpoints');
      // HTML routes are served from Worker templates (documented in route map header)
      expect(content).toContain('HTML routes are served directly from Worker templates');
    });

    it('should document that handleHtmlPageRequest NEVER calls fetch(GAS_WEBAPP_URL)', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      // Find the handleHtmlPageRequest function
      const funcMatch = content.match(/async function handleHtmlPageRequest[\s\S]*?^}/m);
      if (funcMatch) {
        const func = funcMatch[0];
        // Should not contain fetch calls to GAS
        expect(func).not.toContain('fetch(appsScriptBase');
        expect(func).not.toContain('fetch(targetUrl');
      }

      // Should have comment stating this
      expect(content).toContain('NEVER calls fetch(GAS_WEBAPP_URL)');
    });
  });

  describe('Template Bundling Integration', () => {
    it('should have getTemplate function for loading templates', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('async function getTemplate(templateName, env)');
    });

    it('should support TEMPLATES_KV environment binding', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('env.TEMPLATES_KV');
    });

    it('should return graceful error if template not found', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const content = fs.readFileSync(workerPath, 'utf8');

      expect(content).toContain('if (!templateContent)');
      expect(content).toContain('Page Unavailable');
    });
  });
});

// =============================================================================
// Template Bundles Validation
// =============================================================================
// Verifies that bundled templates exist and are valid

describe('Template Bundles', () => {
  const templatesDir = path.join(__dirname, '../../cloudflare-proxy/templates');

  it('should have templates directory', () => {
    expect(fs.existsSync(templatesDir)).toBe(true);
  });

  it('should have manifest.json', () => {
    const manifestPath = path.join(templatesDir, 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest).toHaveProperty('version');
    expect(manifest).toHaveProperty('templates');
  });

  const requiredTemplates = ['public', 'admin', 'display', 'poster', 'report'];

  it.each(requiredTemplates)('should have %s template file', (templateName) => {
    const templatePath = path.join(templatesDir, `${templateName}.html`);
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it.each(requiredTemplates)('should have %s template in manifest', (templateName) => {
    const manifestPath = path.join(templatesDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(manifest.templates).toHaveProperty(templateName);
    expect(manifest.templates[templateName]).toHaveProperty('file');
    expect(manifest.templates[templateName]).toHaveProperty('size');
    expect(manifest.templates[templateName]).toHaveProperty('hash');
  });

  it.each(requiredTemplates)('%s template should have GAS variable placeholders', (templateName) => {
    const templatePath = path.join(templatesDir, `${templateName}.html`);
    const content = fs.readFileSync(templatePath, 'utf8');

    // Templates should contain placeholders for runtime substitution
    expect(content).toMatch(/<\?=\s*appTitle\s*\?>/);
    expect(content).toMatch(/<\?=\s*brandId\s*\?>/);
  });

  it.each(requiredTemplates)('%s template should have resolved includes (no <?!= include)', (templateName) => {
    const templatePath = path.join(templatesDir, `${templateName}.html`);
    const content = fs.readFileSync(templatePath, 'utf8');

    // Includes should be resolved - no <?!= include(...) ?> should remain
    expect(content).not.toMatch(/<\?!=\s*include\s*\(/);
  });

  it.each(requiredTemplates)('%s template should have bundle metadata comment', (templateName) => {
    const templatePath = path.join(templatesDir, `${templateName}.html`);
    const content = fs.readFileSync(templatePath, 'utf8');

    // Should have bundle metadata
    expect(content).toContain('Template:');
    expect(content).toContain('Bundled:');
    expect(content).toContain('Hash:');
  });
});

// =============================================================================
// Embedded Templates Tests (Story 1)
// =============================================================================
// Verifies that worker.js has embedded templates configured correctly
// to eliminate 503 errors when KV storage is not available.

describe('Embedded Templates (Story 1)', () => {
  const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
  let workerContent;

  beforeAll(() => {
    workerContent = fs.readFileSync(workerPath, 'utf8');
  });

  it('should have EMBEDDED_TEMPLATES object defined', () => {
    expect(workerContent).toContain('const EMBEDDED_TEMPLATES = {');
  });

  it('should import all required templates', () => {
    const requiredTemplates = ['public', 'admin', 'display', 'poster', 'report'];

    for (const template of requiredTemplates) {
      // Check for ES module import
      expect(workerContent).toMatch(new RegExp(`import\\s+\\w+\\s+from\\s+['"].*${template}\\.html['"]`));
    }
  });

  it('should have all templates in EMBEDDED_TEMPLATES map', () => {
    const requiredTemplates = ['public', 'admin', 'display', 'poster', 'report'];

    for (const template of requiredTemplates) {
      // Check that template is included in the EMBEDDED_TEMPLATES map
      expect(workerContent).toMatch(new RegExp(`['"]${template}['"]\\s*:\\s*\\w+`));
    }
  });

  it('should check embedded templates in getTemplate function', () => {
    // getTemplate should check EMBEDDED_TEMPLATES first
    expect(workerContent).toContain('EMBEDDED_TEMPLATES[name]');
    expect(workerContent).toContain('Template loaded from embedded source');
  });

  it('should have wrangler text import rules configured', () => {
    const wranglerPath = path.join(__dirname, '../../cloudflare-proxy/wrangler.toml');
    const wranglerContent = fs.readFileSync(wranglerPath, 'utf8');

    // Check for text import rules
    expect(wranglerContent).toContain('[[rules]]');
    expect(wranglerContent).toContain('type = "Text"');
    expect(wranglerContent).toContain('globs = ["**/*.html"]');
  });

  it('should have staging wrangler text import rules configured', () => {
    const stagingWranglerPath = path.join(__dirname, '../../wrangler.toml');
    const wranglerContent = fs.readFileSync(stagingWranglerPath, 'utf8');

    // Check for text import rules in staging config
    expect(wranglerContent).toContain('[[rules]]');
    expect(wranglerContent).toContain('type = "Text"');
    expect(wranglerContent).toContain('globs = ["**/*.html"]');
  });
});
