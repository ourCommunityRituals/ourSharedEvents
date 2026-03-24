/**
 * Unit Tests for Story 2.2 - Replace getPublicBundle (Worker Implementation)
 *
 * Tests the router wiring and frontend integration for publicBundle.
 * Validates:
 * - Router dispatches to actual handleGetPublicBundle handler
 * - Router dispatches to actual handleGetAdminBundle handler
 * - Public.html uses Worker endpoint instead of GAS
 * - Contract shape matches GAS api_getPublicBundle output
 *
 * @see worker/src/router.ts
 * @see src/mvp/Public.html
 * @see Story 2.2 - Replace getPublicBundle Worker Implementation
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const routerPath = path.join(__dirname, '../../../worker/src/router.ts');
const publicHtmlPath = path.join(__dirname, '../../../src/mvp/Public.html');
const publicBundleHandlerPath = path.join(__dirname, '../../../worker/src/handlers/publicBundle.ts');
const adminBundleHandlerPath = path.join(__dirname, '../../../worker/src/handlers/adminBundle.ts');
const publicBundleMapperPath = path.join(__dirname, '../../../worker/src/mappers/publicBundleMapper.ts');

let routerSource = '';
let publicHtmlSource = '';
let publicBundleHandlerSource = '';
let adminBundleHandlerSource = '';
let publicBundleMapperSource = '';

beforeAll(() => {
  try {
    routerSource = fs.readFileSync(routerPath, 'utf8');
    publicHtmlSource = fs.readFileSync(publicHtmlPath, 'utf8');
    publicBundleHandlerSource = fs.readFileSync(publicBundleHandlerPath, 'utf8');
    adminBundleHandlerSource = fs.readFileSync(adminBundleHandlerPath, 'utf8');
    publicBundleMapperSource = fs.readFileSync(publicBundleMapperPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Router Wiring Tests (Story 2.2 - Handler Integration)
// =============================================================================

describe('Router Handler Wiring (Story 2.2)', () => {

  describe('Handler Imports', () => {
    it('should import handleGetPublicBundle from handlers', () => {
      expect(routerSource).toContain("import { handleGetPublicBundle }");
      expect(routerSource).toContain("from './handlers/publicBundle'");
    });

    it('should import handleGetAdminBundle from handlers', () => {
      expect(routerSource).toContain("import { handleGetAdminBundle }");
      expect(routerSource).toContain("from './handlers/adminBundle'");
    });
  });

  describe('publicBundle Route Dispatch', () => {
    it('should have dedicated handleApiPublicBundle function', () => {
      expect(routerSource).toContain('async function handleApiPublicBundle(');
    });

    it('should call handleGetPublicBundle in dispatch function', () => {
      expect(routerSource).toContain('handleGetPublicBundle(modifiedRequest, env, eventId)');
    });

    it('should dispatch publicBundle case to handleApiPublicBundle', () => {
      expect(routerSource).toContain("case 'publicBundle':");
      expect(routerSource).toContain('await handleApiPublicBundle(');
    });

    it('should log publicBundle requests with timing', () => {
      expect(routerSource).toContain('bundleType: \'publicBundle\'');
    });
  });

  describe('adminBundle Route Dispatch', () => {
    it('should have dedicated handleApiAdminBundle function', () => {
      expect(routerSource).toContain('async function handleApiAdminBundle(');
    });

    it('should call handleGetAdminBundle in dispatch function', () => {
      expect(routerSource).toContain('handleGetAdminBundle(modifiedRequest, env, eventId)');
    });

    it('should dispatch adminBundle case to handleApiAdminBundle', () => {
      expect(routerSource).toContain("case 'adminBundle':");
      expect(routerSource).toContain('await handleApiAdminBundle(');
    });

    it('should log adminBundle requests with timing', () => {
      expect(routerSource).toContain('bundleType: \'adminBundle\'');
    });
  });

  describe('display/poster Bundle Placeholders', () => {
    it('should have placeholder for display and poster bundles', () => {
      expect(routerSource).toContain("case 'displayBundle':");
      expect(routerSource).toContain("case 'posterBundle':");
      expect(routerSource).toContain('handleApiDisplayPosterBundle');
    });

    it('should reference Story E4 for display/poster implementation', () => {
      // Story E4 replaced the placeholder with actual handlers
      expect(routerSource).toContain('Story E4');
    });
  });

  describe('Brand Parameter Handling', () => {
    it('should add brand parameter to request URL', () => {
      expect(routerSource).toContain("url.searchParams.set('brand', brand)");
    });

    it('should check if brand already in URL before adding', () => {
      expect(routerSource).toContain("url.searchParams.has('brand')");
    });
  });

  describe('Router Version', () => {
    it('should be at least version 1.2.0 for Story 2.2+', () => {
      // Story 2.2 introduced version 1.2.0, Story 2.3 bumped to 1.3.0
      const versionMatch = routerSource.match(/export const ROUTER_VERSION = '(\d+)\.(\d+)\.(\d+)'/);
      expect(versionMatch).not.toBeNull();
      const [, major, minor] = versionMatch;
      expect(Number(major)).toBeGreaterThanOrEqual(1);
      expect(Number(minor)).toBeGreaterThanOrEqual(2);
    });

    it('should document Story 2.2 in version history', () => {
      expect(routerSource).toContain('1.2.0 - Wired up publicBundle and adminBundle handlers (Story 2.2)');
    });
  });
});

// =============================================================================
// Public.html Frontend Tests (Story 2.2 - No GAS Calls)
// =============================================================================

describe('Public.html Worker Integration (Story 2.2)', () => {

  describe('Worker Endpoint Configuration', () => {
    it('should have Story 2.2 comment documenting the change', () => {
      expect(publicHtmlSource).toContain('Story 2.2: Worker Endpoint Configuration');
    });

    it('should define getWorkerBaseUrl function', () => {
      expect(publicHtmlSource).toContain('function getWorkerBaseUrl()');
    });

    it('should use window.location.origin for Worker base URL', () => {
      expect(publicHtmlSource).toContain('window.location.origin');
    });
  });

  describe('fetchPublicBundleFromWorker Function', () => {
    it('should define fetchPublicBundleFromWorker async function', () => {
      expect(publicHtmlSource).toContain('async function fetchPublicBundleFromWorker(');
    });

    it('should construct correct Worker endpoint URL', () => {
      // Story 5.3: Updated to v2 API endpoints
      expect(publicHtmlSource).toContain('/api/v2/events/');
      expect(publicHtmlSource).toContain('/bundle/public');
    });

    it('should use GET method for Worker endpoint', () => {
      expect(publicHtmlSource).toContain("method: 'GET'");
    });

    it('should set brand query parameter', () => {
      expect(publicHtmlSource).toContain("url.searchParams.set('brand', brandId)");
    });

    it('should support If-None-Match header for conditional requests', () => {
      expect(publicHtmlSource).toContain("headers['If-None-Match']");
    });

    it('should handle 304 Not Modified response', () => {
      expect(publicHtmlSource).toContain('response.status === 304');
      expect(publicHtmlSource).toContain('notModified: true');
    });

    it('should return standard error shape on network failure', () => {
      expect(publicHtmlSource).toContain("code: 'NETWORK_ERROR'");
    });
  });

  describe('No GAS Calls for Public Bundle', () => {
    it('should use fetchPublicBundleFromWorker for detail view', () => {
      expect(publicHtmlSource).toContain('const res = await fetchPublicBundleFromWorker(ID, BRAND)');
    });

    it('should NOT use NU.safeRpc for api_getPublicBundle in detail view', () => {
      // Count occurrences of api_getPublicBundle - should NOT be called in detail view
      // Note: It may still exist in comments, but not as an actual call
      const detailViewSection = publicHtmlSource.substring(
        publicHtmlSource.indexOf('// Load event data'),
        publicHtmlSource.indexOf('} else {', publicHtmlSource.indexOf('// Load event data'))
      );
      expect(detailViewSection).not.toContain("NU.safeRpc('api_getPublicBundle'");
    });

    it('should comment that Worker is now used instead of GAS', () => {
      expect(publicHtmlSource).toContain('Story 2.2: Fetch from Worker endpoint (no GAS calls)');
    });
  });

  describe('No GAS Calls for Events List', () => {
    it('should define fetchEventsListFromWorker function', () => {
      expect(publicHtmlSource).toContain('async function fetchEventsListFromWorker(');
    });

    it('should use fetchEventsListFromWorker for list view', () => {
      expect(publicHtmlSource).toContain('const res = await fetchEventsListFromWorker(BRAND)');
    });

    it('should NOT use NU.safeRpc for api_list', () => {
      // There should be NO NU.safeRpc or NU.rpc calls in Public.html
      expect(publicHtmlSource).not.toContain("NU.safeRpc('api_list'");
      expect(publicHtmlSource).not.toContain("NU.rpc('api_list'");
    });

    it('should call Worker /api/v2/events endpoint', () => {
      // Story 5.3: Updated to v2 API endpoints
      expect(publicHtmlSource).toContain('/api/v2/events');
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors from Worker', () => {
      expect(publicHtmlSource).toContain('if (!res.ok)');
      expect(publicHtmlSource).toContain('showError(res)');
    });

    it('should handle empty response from Worker', () => {
      expect(publicHtmlSource).toContain("showError('nodata')");
    });

    it('should handle not found from Worker', () => {
      expect(publicHtmlSource).toContain("showError('notfound')");
    });
  });
});

// =============================================================================
// Contract Comparison Tests (GAS vs Worker Output Shape)
// =============================================================================

describe('Contract Comparison - GAS vs Worker Shape (Story 2.2)', () => {

  describe('Success Response Envelope', () => {
    it('should return ok: true in success response', () => {
      expect(publicBundleHandlerSource).toContain('ok: true');
    });

    it('should return etag string in success response', () => {
      expect(publicBundleHandlerSource).toContain('etag');
      expect(publicBundleMapperSource).toContain('etag: string');
    });

    it('should return value object containing bundle data', () => {
      expect(publicBundleMapperSource).toContain('value: PublicBundleValue');
    });
  });

  describe('PublicBundleValue Shape (GAS Parity)', () => {
    it('should include event field (full canonical event shape)', () => {
      expect(publicBundleMapperSource).toContain('event: PublicEvent');
    });

    it('should include config field (brand configuration)', () => {
      expect(publicBundleMapperSource).toContain('config: BrandConfigForApi');
    });

    it('should include lifecyclePhase field (computed from startDateISO)', () => {
      expect(publicBundleMapperSource).toContain('lifecyclePhase: LifecyclePhaseInfo');
    });
  });

  describe('Config Shape (matches GAS findBrand_ output)', () => {
    it('should include appTitle (GAS: brand.appTitle || brand.name)', () => {
      expect(publicBundleMapperSource).toContain('appTitle:');
    });

    it('should include brandId', () => {
      expect(publicBundleMapperSource).toContain('brandId:');
    });

    it('should include brandName', () => {
      expect(publicBundleMapperSource).toContain('brandName:');
    });
  });

  describe('LifecyclePhase Shape (matches GAS computeLifecyclePhase_)', () => {
    it('should include phase field', () => {
      expect(publicBundleMapperSource).toContain('phase: LifecyclePhaseValue');
    });

    it('should include label field', () => {
      expect(publicBundleMapperSource).toContain('label: string');
    });

    it('should include isLive boolean', () => {
      expect(publicBundleMapperSource).toContain('isLive: boolean');
    });

    it('should use same lifecycle phase values as GAS', () => {
      expect(publicBundleMapperSource).toContain("'pre-event'");
      expect(publicBundleMapperSource).toContain("'event-day'");
      expect(publicBundleMapperSource).toContain("'post-event'");
    });
  });

  describe('304 Not Modified Response', () => {
    it('should return ok: true for not modified', () => {
      expect(publicBundleHandlerSource).toContain('ok: true');
    });

    it('should return notModified: true', () => {
      expect(publicBundleHandlerSource).toContain('notModified: true');
    });

    it('should return etag', () => {
      expect(publicBundleHandlerSource).toContain('etag');
    });
  });

  describe('Error Response Shape', () => {
    it('should return ok: false for errors', () => {
      expect(publicBundleHandlerSource).toContain('ok: false');
    });

    it('should return status code', () => {
      expect(publicBundleHandlerSource).toContain('status:');
    });

    it('should return error code', () => {
      expect(publicBundleHandlerSource).toContain('code:');
    });

    it('should return message', () => {
      expect(publicBundleHandlerSource).toContain('message:');
    });
  });
});

// =============================================================================
// Acceptance Criteria Verification (Story 2.2)
// =============================================================================

describe('Acceptance Criteria (Story 2.2)', () => {

  describe('AC: Public page loads event metadata, schedule, bracket from Worker', () => {
    it('should fetch from Worker /api/v2/events/:id/bundle/public endpoint', () => {
      // Story 5.3: Updated to v2 API endpoints
      expect(publicHtmlSource).toContain('/api/v2/events/');
      expect(publicHtmlSource).toContain('/bundle/public');
    });

    it('should render event details from Worker response', () => {
      expect(publicHtmlSource).toContain('renderDetail(bundle.event, bundle.config, bundle.lifecyclePhase)');
    });
  });

  describe('AC: No calls to GAS remain for publicBundle', () => {
    it('should use fetchPublicBundleFromWorker function', () => {
      expect(publicHtmlSource).toContain('fetchPublicBundleFromWorker(');
    });

    it('should NOT call api_getPublicBundle via NUSDK for event detail', () => {
      // The safeRpc call should be replaced with fetchPublicBundleFromWorker
      // for the detail view (when ID is present)
      const loadEventSection = publicHtmlSource.substring(
        publicHtmlSource.indexOf('// Load event data'),
        publicHtmlSource.indexOf('} else {', publicHtmlSource.indexOf('// Load event data'))
      );
      expect(loadEventSection).toContain('fetchPublicBundleFromWorker');
      expect(loadEventSection).not.toContain("safeRpc('api_getPublicBundle'");
    });
  });

  describe('AC: Contract maintained (same shape as GAS version)', () => {
    it('should return { ok, etag, value: { event, config, lifecyclePhase } }', () => {
      // Verify the response interface matches GAS
      expect(publicBundleMapperSource).toContain('export interface PublicBundleResponse');
      expect(publicBundleMapperSource).toContain('ok: true');
      expect(publicBundleMapperSource).toContain('etag: string');
      expect(publicBundleMapperSource).toContain('value: PublicBundleValue');

      // Verify value shape
      expect(publicBundleMapperSource).toContain('export interface PublicBundleValue');
      expect(publicBundleMapperSource).toContain('event: PublicEvent');
      expect(publicBundleMapperSource).toContain('config: BrandConfigForApi');
      expect(publicBundleMapperSource).toContain('lifecyclePhase: LifecyclePhaseInfo');
    });
  });
});

// =============================================================================
// Stage-2 Smoke Test Reference
// =============================================================================

describe('Stage-2 Smoke Test Reference (Story 2.2)', () => {
  /**
   * These tests document what the smoke test should verify.
   * Actual smoke tests should run against a deployed Worker.
   */

  describe('Smoke Test: GET /public?event=TEST', () => {
    it('should document the public page route', () => {
      expect(routerSource).toContain("'/public': 'public'");
    });

    it('should document the API endpoint for public bundle', () => {
      expect(routerSource).toContain('/publicBundle');
    });
  });

  describe('Expected Smoke Test Scenarios', () => {
    it('documents: should return 200 for valid event', () => {
      // Worker returns 200 with { ok: true, value: {...} }
      expect(publicBundleHandlerSource).toContain('status: 200');
    });

    it('documents: should return 404 for non-existent event', () => {
      // Worker returns 404 with { ok: false, code: 'EVENT_NOT_FOUND' }
      expect(publicBundleHandlerSource).toContain("'EVENT_NOT_FOUND'");
      expect(publicBundleHandlerSource).toContain('404');
    });

    it('documents: should return 400 for invalid brand', () => {
      // Worker returns 400 with { ok: false, code: 'BAD_INPUT' }
      expect(publicBundleHandlerSource).toContain("'BAD_INPUT'");
      expect(publicBundleHandlerSource).toContain('400');
    });
  });
});
