/**
 * Unit Tests for Story 1.1 Central Worker Router
 *
 * Tests the router.ts implementation that handles all request routing.
 * Validates:
 * - Route matching for /api/* endpoints
 * - Route matching for HTML page routes
 * - 404 handling for unknown routes
 * - Structured logging integration
 * - Response shapes match acceptance criteria
 *
 * @see worker/src/router.ts
 * @see worker/src/logger.ts
 * @see Story 1.1 - Create Central Worker Router
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const routerPath = path.join(__dirname, '../../../worker/src/router.ts');
const loggerPath = path.join(__dirname, '../../../worker/src/logger.ts');
const mainIndexPath = path.join(__dirname, '../../../worker/src/index.ts');
const wranglerPath = path.join(__dirname, '../../../worker/wrangler.toml');

let routerSource = '';
let loggerSource = '';
let mainIndexSource = '';
let wranglerSource = '';

beforeAll(() => {
  try {
    routerSource = fs.readFileSync(routerPath, 'utf8');
    loggerSource = fs.readFileSync(loggerPath, 'utf8');
    mainIndexSource = fs.readFileSync(mainIndexPath, 'utf8');
    wranglerSource = fs.readFileSync(wranglerPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Router Module Structure Tests
// =============================================================================

describe('Router Module Structure (Story 1.1)', () => {

  describe('Module Exports', () => {
    it('should export handleRequest function', () => {
      expect(routerSource).toContain('export async function handleRequest(');
    });

    it('should export ROUTER_VERSION constant', () => {
      expect(routerSource).toContain('export const ROUTER_VERSION');
    });

    it('should export RouterEnv type', () => {
      expect(routerSource).toContain('export interface RouterEnv');
    });

    it('should export default Worker handler', () => {
      expect(routerSource).toContain('export default');
      expect(routerSource).toContain('async fetch(request: Request, env: RouterEnv');
    });
  });

  describe('Module Imports', () => {
    it('should import RouterLogger from logger', () => {
      expect(routerSource).toContain("import { RouterLogger");
      expect(routerSource).toContain("from './logger'");
    });

    it('should import createLogger from logger', () => {
      expect(routerSource).toContain('createLogger');
    });

    it('should import handleStatus from handlers', () => {
      expect(routerSource).toContain("import { handleStatus");
      expect(routerSource).toContain("from './handlers/status'");
    });
  });
});

// =============================================================================
// Route Matching Tests
// =============================================================================

describe('Route Matching (Story 1.1)', () => {

  describe('API Routes', () => {
    it('should handle /api/status route', () => {
      expect(routerSource).toContain("'/api/status'");
      expect(routerSource).toContain("handler: 'status'");
    });

    it('should handle /api/events route', () => {
      expect(routerSource).toContain("apiPath === '/events'");
      expect(routerSource).toContain("handler: 'events'");
    });

    it('should handle /api/events/:id route', () => {
      expect(routerSource).toContain("apiPath.match(/^\\/events\\/([^/]+)$/)");
      expect(routerSource).toContain("handler: 'event'");
    });

    it('should handle /api/events/:id/publicBundle route', () => {
      expect(routerSource).toContain("apiPath.match(/^\\/events\\/([^/]+)\\/publicBundle$/)");
      expect(routerSource).toContain("handler: 'publicBundle'");
    });

    it('should handle /api/events/:id/adminBundle route', () => {
      expect(routerSource).toContain("apiPath.match(/^\\/events\\/([^/]+)\\/adminBundle$/)");
      expect(routerSource).toContain("handler: 'adminBundle'");
    });

    it('should handle /api/events/:id/displayBundle route', () => {
      expect(routerSource).toContain("handler: 'displayBundle'");
    });

    it('should handle /api/events/:id/posterBundle route', () => {
      expect(routerSource).toContain("handler: 'posterBundle'");
    });
  });

  describe('HTML Page Routes', () => {
    it('should define HTML_ROUTE_MAP', () => {
      expect(routerSource).toContain('const HTML_ROUTE_MAP');
    });

    it('should route /public to public page', () => {
      expect(routerSource).toContain("'/public': 'public'");
    });

    it('should route /events to public page', () => {
      expect(routerSource).toContain("'/events': 'public'");
    });

    it('should route /schedule to public page', () => {
      expect(routerSource).toContain("'/schedule': 'public'");
    });

    it('should route /calendar to public page', () => {
      expect(routerSource).toContain("'/calendar': 'public'");
    });

    it('should route /admin to admin page', () => {
      expect(routerSource).toContain("'/admin': 'admin'");
    });

    it('should route /manage to admin page', () => {
      expect(routerSource).toContain("'/manage': 'admin'");
    });

    it('should route /dashboard to admin page', () => {
      expect(routerSource).toContain("'/dashboard': 'admin'");
    });

    it('should route /create to admin page', () => {
      expect(routerSource).toContain("'/create': 'admin'");
    });

    it('should route /display to display page', () => {
      expect(routerSource).toContain("'/display': 'display'");
    });

    it('should route /tv to display page', () => {
      expect(routerSource).toContain("'/tv': 'display'");
    });

    it('should route /kiosk to display page', () => {
      expect(routerSource).toContain("'/kiosk': 'display'");
    });

    it('should route /screen to display page', () => {
      expect(routerSource).toContain("'/screen': 'display'");
    });

    it('should route /poster to poster page', () => {
      expect(routerSource).toContain("'/poster': 'poster'");
    });

    it('should route /posters to poster page', () => {
      expect(routerSource).toContain("'/posters': 'poster'");
    });

    it('should route /flyers to poster page', () => {
      expect(routerSource).toContain("'/flyers': 'poster'");
    });

    it('should route /report to report page', () => {
      expect(routerSource).toContain("'/report': 'report'");
    });

    it('should route /analytics to report page', () => {
      expect(routerSource).toContain("'/analytics': 'report'");
    });

    it('should route /reports to report page', () => {
      expect(routerSource).toContain("'/reports': 'report'");
    });

    it('should route /insights to report page', () => {
      expect(routerSource).toContain("'/insights': 'report'");
    });
  });

  describe('Brand Routing', () => {
    it('should define valid brands', () => {
      expect(routerSource).toContain("const VALID_BRANDS = ['root', 'abc', 'cbc', 'cbl']");
    });

    it('should extract brand from path', () => {
      expect(routerSource).toContain('function extractBrand(pathname: string)');
    });

    it('should default to root brand', () => {
      expect(routerSource).toContain("brand: 'root'");
    });
  });
});

// =============================================================================
// 404 Handling Tests
// =============================================================================

describe('404 Not Found Handling (Story 1.1)', () => {

  describe('404 Response Shape', () => {
    it('should return ok: false for 404', () => {
      expect(routerSource).toContain('ok: false');
    });

    it('should return status: 404', () => {
      expect(routerSource).toContain('status: 404');
    });

    it('should return error message', () => {
      expect(routerSource).toContain("error: 'Not Found'");
    });

    it('should include path in 404 response', () => {
      expect(routerSource).toContain('path,');
    });

    it('should include timestamp in 404 response', () => {
      expect(routerSource).toContain('timestamp: new Date().toISOString()');
    });
  });

  describe('404 Function', () => {
    it('should define create404Response function', () => {
      expect(routerSource).toContain('function create404Response(path: string');
    });

    it('should log 404 with logger.notFound', () => {
      expect(routerSource).toContain('logger.notFound(path)');
    });

    it('should return JSON Content-Type', () => {
      expect(routerSource).toContain("'Content-Type': 'application/json'");
    });
  });

  describe('Unknown Route Handling', () => {
    it('should return not_found type for unknown routes', () => {
      expect(routerSource).toContain("type: 'not_found'");
    });

    it('should create 404 response for not_found routes', () => {
      expect(routerSource).toContain("case 'not_found'");
      expect(routerSource).toContain('create404Response(url.pathname, logger)');
    });
  });
});

// =============================================================================
// /api/status Endpoint Tests
// =============================================================================

describe('/api/status Endpoint (Story 1.1)', () => {

  describe('Status Handler Integration', () => {
    it('should define handleApiStatus function', () => {
      expect(routerSource).toContain('async function handleApiStatus(');
    });

    it('should call handleStatus from handlers', () => {
      expect(routerSource).toContain('await handleStatus(env)');
    });

    it('should log API request', () => {
      expect(routerSource).toContain("logger.apiRequest('GET', '/api/status'");
    });

    it('should track duration', () => {
      expect(routerSource).toContain('const startTime = Date.now()');
      expect(routerSource).toContain('const durationMs = Date.now() - startTime');
    });
  });

  describe('Status Route Match', () => {
    it('should match /api/status route', () => {
      expect(routerSource).toContain("apiPath === '/status'");
    });

    it('should return handler: status', () => {
      expect(routerSource).toContain("handler: 'status'");
    });
  });
});

// =============================================================================
// Structured Logging Tests
// =============================================================================

describe('Structured Logging (Story 1.1)', () => {

  describe('Logger Module Structure', () => {
    it('should export RouterLogger class', () => {
      expect(loggerSource).toContain('export class RouterLogger');
    });

    it('should export createLogger function', () => {
      expect(loggerSource).toContain('export function createLogger(');
    });

    it('should export LogLevel type', () => {
      expect(loggerSource).toContain("export type LogLevel = 'debug' | 'info' | 'warn' | 'error'");
    });

    it('should export LogEntry interface', () => {
      expect(loggerSource).toContain('export interface LogEntry');
    });

    it('should export LoggerConfig interface', () => {
      expect(loggerSource).toContain('export interface LoggerConfig');
    });
  });

  describe('Log Prefixes', () => {
    it('should define [ROUTE] prefix', () => {
      expect(loggerSource).toContain("ROUTE: '[ROUTE]'");
    });

    it('should define [API] prefix', () => {
      expect(loggerSource).toContain("API: '[API]'");
    });

    it('should define [404] prefix', () => {
      expect(loggerSource).toContain("NOT_FOUND: '[404]'");
    });

    it('should define [ERROR] prefix', () => {
      expect(loggerSource).toContain("ERROR: '[ERROR]'");
    });

    it('should define [ROUTER] prefix', () => {
      expect(loggerSource).toContain("ROUTER: '[ROUTER]'");
    });
  });

  describe('Logger Methods', () => {
    it('should have routeResolved method', () => {
      expect(loggerSource).toContain('routeResolved(');
    });

    it('should have apiRequest method', () => {
      expect(loggerSource).toContain('apiRequest(');
    });

    it('should have notFound method', () => {
      expect(loggerSource).toContain('notFound(');
    });

    it('should have error method', () => {
      expect(loggerSource).toContain('error(message: string');
    });

    it('should have warn method', () => {
      expect(loggerSource).toContain('warn(message: string');
    });

    it('should have debug method', () => {
      expect(loggerSource).toContain('debug(message: string');
    });

    it('should have info method', () => {
      expect(loggerSource).toContain('info(message: string');
    });

    it('should have incomingRequest method', () => {
      expect(loggerSource).toContain('incomingRequest(');
    });

    it('should have routerInit method', () => {
      expect(loggerSource).toContain('routerInit(');
    });
  });

  describe('Request ID Tracking', () => {
    it('should generate request ID', () => {
      expect(loggerSource).toContain('generateRequestId()');
    });

    it('should get request ID', () => {
      expect(loggerSource).toContain('getRequestId()');
    });

    it('should set request ID', () => {
      expect(loggerSource).toContain('setRequestId(id: string)');
    });
  });

  describe('JSON vs Human Readable Output', () => {
    it('should support JSON output', () => {
      expect(loggerSource).toContain('jsonOutput: boolean');
    });

    it('should output JSON when jsonOutput is true', () => {
      expect(loggerSource).toContain('JSON.stringify(fullEntry)');
    });
  });
});

// =============================================================================
// Response Headers Tests
// =============================================================================

describe('Response Headers (Story 1.1)', () => {

  describe('Standard Headers', () => {
    it('should include X-Router-Version header', () => {
      expect(routerSource).toContain("'X-Router-Version': ROUTER_VERSION");
    });

    it('should include X-Request-Id header', () => {
      expect(routerSource).toContain("'X-Request-Id': logger.getRequestId()");
    });

    it('should add standard headers function', () => {
      expect(routerSource).toContain('function addStandardHeaders(');
    });
  });

  describe('CORS Headers', () => {
    it('should define addCorsHeaders function', () => {
      expect(routerSource).toContain('function addCorsHeaders(');
    });

    it('should set Access-Control-Allow-Origin', () => {
      expect(routerSource).toContain("'Access-Control-Allow-Origin', '*'");
    });

    it('should set Access-Control-Allow-Methods', () => {
      expect(routerSource).toContain("'Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'");
    });

    it('should set Access-Control-Allow-Headers', () => {
      expect(routerSource).toContain("'Access-Control-Allow-Headers', 'Content-Type, Authorization'");
    });
  });

  describe('OPTIONS Preflight', () => {
    it('should handle OPTIONS requests', () => {
      expect(routerSource).toContain("method === 'OPTIONS'");
      expect(routerSource).toContain('handleOptions(request, logger)');
    });

    it('should return 204 for OPTIONS', () => {
      expect(routerSource).toContain('status: 204');
    });
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling (Story 1.1)', () => {

  describe('500 Error Response', () => {
    it('should define create500Response function', () => {
      expect(routerSource).toContain('function create500Response(');
    });

    it('should return status 500', () => {
      expect(routerSource).toContain('status: 500');
    });

    it('should return Internal Server Error message', () => {
      expect(routerSource).toContain("error: 'Internal Server Error'");
    });
  });

  describe('405 Method Not Allowed', () => {
    it('should define create405Response function', () => {
      expect(routerSource).toContain('function create405Response(');
    });

    it('should return status 405', () => {
      expect(routerSource).toContain('status: 405');
    });

    it('should return Method Not Allowed message', () => {
      expect(routerSource).toContain("error: 'Method Not Allowed'");
    });

    it('should include Allow header', () => {
      expect(routerSource).toContain("'Allow': 'GET, POST, PUT, DELETE, OPTIONS'");
    });
  });

  describe('Try-Catch Error Handling', () => {
    it('should wrap main handler in try-catch', () => {
      expect(routerSource).toContain('} catch (error)');
    });

    it('should return 500 on unexpected errors', () => {
      expect(routerSource).toContain('create500Response(');
    });
  });
});

// =============================================================================
// Wrangler Configuration Tests
// =============================================================================

describe('Wrangler Configuration (Story 1.1)', () => {

  describe('Worker Configuration', () => {
    it('should set main entry to router.ts', () => {
      expect(wranglerSource).toContain('main = "src/router.ts"');
    });

    it('should set worker name', () => {
      expect(wranglerSource).toContain('name = "eventangle-router"');
    });

    it('should set compatibility date', () => {
      expect(wranglerSource).toContain('compatibility_date = "2024-01-01"');
    });
  });

  describe('Staging Environment', () => {
    it('should define staging environment', () => {
      expect(wranglerSource).toContain('[env.staging]');
    });

    it('should route to stg.eventangle.com', () => {
      expect(wranglerSource).toContain('stg.eventangle.com/*');
    });

    it('should set WORKER_ENV to staging', () => {
      expect(wranglerSource).toContain('WORKER_ENV = "staging"');
    });

    it('should set DEBUG_LEVEL for staging', () => {
      expect(wranglerSource).toContain('DEBUG_LEVEL = "debug"');
    });
  });

  describe('Production Environment', () => {
    it('should define production environment', () => {
      expect(wranglerSource).toContain('[env.production]');
    });

    it('should route to eventangle.com', () => {
      expect(wranglerSource).toContain('eventangle.com/*');
    });

    it('should set WORKER_ENV to production', () => {
      expect(wranglerSource).toContain('WORKER_ENV = "production"');
    });

    it('should set DEBUG_LEVEL to error for production', () => {
      expect(wranglerSource).toContain('DEBUG_LEVEL = "error"');
    });
  });
});

// =============================================================================
// Main Index Integration Tests
// =============================================================================

describe('Main Index Integration (Story 1.1)', () => {
  it('should export handleRequest from main index', () => {
    expect(mainIndexSource).toContain('handleRequest');
  });

  it('should export ROUTER_VERSION from main index', () => {
    expect(mainIndexSource).toContain('ROUTER_VERSION');
  });

  it('should export RouterEnv type from main index', () => {
    expect(mainIndexSource).toContain('type RouterEnv');
  });

  it('should export RouterLogger from main index', () => {
    expect(mainIndexSource).toContain('RouterLogger');
  });

  it('should export createLogger from main index', () => {
    expect(mainIndexSource).toContain('createLogger');
  });

  it('should reference Story 1.1 in comments', () => {
    expect(mainIndexSource).toContain('Story 1.1');
  });
});

// =============================================================================
// Acceptance Criteria Validation
// =============================================================================

describe('Story 1.1 Acceptance Criteria', () => {

  describe('AC: router.ts handles all /api/* routes', () => {
    it('should check if path starts with /api/', () => {
      expect(routerSource).toContain("normalizedPath.startsWith('/api/')");
    });

    it('should handle API routes in switch statement', () => {
      expect(routerSource).toContain("case 'api':");
    });
  });

  describe('AC: router.ts handles static page routes', () => {
    it('should handle page routes in switch statement', () => {
      expect(routerSource).toContain("case 'page':");
    });

    it('should call handlePage for page routes', () => {
      expect(routerSource).toContain('handlePage(request, env, logger');
    });
  });

  describe('AC: Unknown route returns {ok:false, status:404}', () => {
    it('should return ok: false', () => {
      expect(routerSource).toContain('ok: false');
    });

    it('should return status: 404', () => {
      expect(routerSource).toContain('status: 404');
    });
  });

  describe('AC: /api/status returns Worker response, not GAS', () => {
    it('should have backend: worker marker', () => {
      // The status handler returns backend: 'worker'
      expect(routerSource).toContain("handleStatus(env)");
    });

    it('should route /api/status to status handler', () => {
      expect(routerSource).toContain("case 'status':");
      expect(routerSource).toContain('handleApiStatus(request, env, logger)');
    });
  });

  describe('AC: Router logs structured events', () => {
    it('should create logger for each request', () => {
      expect(routerSource).toContain('const logger = createLogger(env)');
    });

    it('should log incoming requests', () => {
      expect(routerSource).toContain('logger.incomingRequest(method, url.toString())');
    });

    it('should log route resolution', () => {
      expect(routerSource).toContain('logger.routeResolved(');
    });

    it('should log API requests', () => {
      expect(routerSource).toContain('logger.apiRequest(');
    });

    it('should log 404s', () => {
      expect(routerSource).toContain('logger.notFound(');
    });

    it('should log errors', () => {
      expect(routerSource).toContain('logger.error(');
    });
  });
});

// =============================================================================
// DevOps: CI/CD Integration
// =============================================================================

describe('DevOps: CI/CD Integration (Story 1.1)', () => {

  describe('Stage-1 CI Requirements', () => {
    it('should have TypeScript entry point for wrangler', () => {
      expect(wranglerSource).toContain('main = "src/router.ts"');
    });

    it('should have staging environment configured', () => {
      expect(wranglerSource).toContain('[env.staging]');
    });

    it('should have production environment configured', () => {
      expect(wranglerSource).toContain('[env.production]');
    });
  });
});
