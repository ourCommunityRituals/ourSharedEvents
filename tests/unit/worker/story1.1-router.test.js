/**
 * Unit Tests for Story 1.1 - Worker Central Router
 *
 * Source-reading tests that validate the router module structure,
 * route coverage, auth gating, CORS handling, and error responses.
 *
 * These are infrastructure-as-code tests — they verify that security
 * patterns exist in the source code. The "back validates the front."
 *
 * @see workers/oursharedevents/src/router.ts
 * @see workers/oursharedevents/src/index.ts
 * @see workers/oursharedevents/wrangler.toml
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const routerPath = path.join(__dirname, '../../../workers/oursharedevents/src/router.ts');
const indexPath = path.join(__dirname, '../../../workers/oursharedevents/src/index.ts');
const wranglerTomlPath = path.join(__dirname, '../../../workers/oursharedevents/wrangler.toml');

let routerSource = '';
let indexSource = '';
let wranglerTomlSource = '';

beforeAll(() => {
  try {
    routerSource = fs.readFileSync(routerPath, 'utf8');
    indexSource = fs.readFileSync(indexPath, 'utf8');
    wranglerTomlSource = fs.readFileSync(wranglerTomlPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Module Structure
// =============================================================================

describe('Router Module Structure (Story 1.1)', () => {
  describe('Source Files Exist', () => {
    it('router.ts exists', () => {
      expect(routerSource.length).toBeGreaterThan(0);
    });

    it('index.ts exists', () => {
      expect(indexSource.length).toBeGreaterThan(0);
    });

    it('wrangler.toml exists', () => {
      expect(wranglerTomlSource.length).toBeGreaterThan(0);
    });
  });

  describe('Module Exports', () => {
    it('should export route function', () => {
      expect(routerSource).toContain('export async function route(');
    });

    it('should export RouterEnv type', () => {
      expect(routerSource).toContain('export type RouterEnv');
    });

    it('RouterEnv should compose PagesEnv, AdminEnv, FormsEnv, FormPagesEnv', () => {
      expect(routerSource).toContain('PagesEnv');
      expect(routerSource).toContain('AdminEnv');
      expect(routerSource).toContain('FormsEnv');
      expect(routerSource).toContain('FormPagesEnv');
    });

    it('RouterEnv should include WORKER_ENV and WORKER_BUILD_VERSION', () => {
      expect(routerSource).toContain('WORKER_ENV?: string');
      expect(routerSource).toContain('WORKER_BUILD_VERSION?: string');
    });
  });

  describe('Module Imports', () => {
    it('should import handleHealth from handlers/health', () => {
      expect(routerSource).toContain("import { handleHealth } from './handlers/health'");
    });

    it('should import event handlers from handlers/events', () => {
      expect(routerSource).toContain('handleListEvents');
      expect(routerSource).toContain('handleGetEvent');
      expect(routerSource).toContain('handleAdminListEvents');
    });

    it('should import page handlers from handlers/pages', () => {
      expect(routerSource).toContain('handlePublicPage');
      expect(routerSource).toContain('handleAdminPage');
      expect(routerSource).toContain('handleLandingPage');
      expect(routerSource).toContain('handleDisplayPage');
      expect(routerSource).toContain('handlePosterPage');
      expect(routerSource).toContain('handleSharedReportPage');
      expect(routerSource).toContain('handleSubscribe');
    });

    it('should import requireAdmin from auth/admin', () => {
      expect(routerSource).toContain('requireAdmin');
      expect(routerSource).toContain("from './auth/admin'");
    });

    it('should import form handlers from handlers/forms', () => {
      expect(routerSource).toContain('handleFormRegistration');
      expect(routerSource).toContain('handleFormCheckin');
      expect(routerSource).toContain('handleFormSurvey');
      expect(routerSource).toContain('handleFormEmailSignup');
      expect(routerSource).toContain('handleAdminRegistrations');
      expect(routerSource).toContain('handleAdminCheckinCount');
      expect(routerSource).toContain('handleAdminSurveys');
      expect(routerSource).toContain('handleAdminEmailSignupCount');
    });

    it('should import handleFormPage from handlers/form-pages', () => {
      expect(routerSource).toContain('handleFormPage');
      expect(routerSource).toContain("from './handlers/form-pages'");
    });

    it('should import isFeatureEnabled from lib/feature-flags', () => {
      expect(routerSource).toContain('isFeatureEnabled');
      expect(routerSource).toContain("from './lib/feature-flags'");
    });

    it('should import feature flag handlers', () => {
      expect(routerSource).toContain('handleListFlags');
      expect(routerSource).toContain('handleListTiers');
      expect(routerSource).toContain('handleGetCurrentTier');
      expect(routerSource).toContain('handleResolveFlags');
      expect(routerSource).toContain('handleSetFlag');
      expect(routerSource).toContain('handleApplyTier');
      expect(routerSource).toContain('handleSetEventFlag');
      expect(routerSource).toContain('handleRemoveEventFlag');
    });

    it('should import corsOrigin from lib/cors', () => {
      expect(routerSource).toContain('corsOrigin');
      expect(routerSource).toContain("from './lib/cors'");
    });

    it('should import handleBriefingPage from handlers/briefing', () => {
      expect(routerSource).toContain('handleBriefingPage');
      expect(routerSource).toContain("from './handlers/briefing'");
    });
  });
});

// =============================================================================
// Route Coverage
// =============================================================================

describe('Route Coverage (Story 1.1)', () => {
  describe('Health / Status Routes', () => {
    it('should route /health to handleHealth', () => {
      expect(routerSource).toContain("pathname === '/health'");
      expect(routerSource).toContain('handleHealth(env)');
    });

    it('should route /api/status as alias for health', () => {
      expect(routerSource).toContain("pathname === '/api/status'");
    });
  });

  describe('Public API Routes', () => {
    it('should route /api/v2/events to handleListEvents', () => {
      expect(routerSource).toContain("pathname === '/api/v2/events'");
      expect(routerSource).toContain('handleListEvents(request, env)');
    });

    it('should route /api/v2/events/:id to handleGetEvent', () => {
      expect(routerSource).toContain('/api/v2/events/');
      expect(routerSource).toContain('handleGetEvent(request, env,');
    });
  });

  describe('Admin Routes (Auth-Gated)', () => {
    it('should route /admin to handleAdminPage with auth', () => {
      expect(routerSource).toContain("pathname === '/admin'");
      expect(routerSource).toContain('handleAdminPage(env)');
    });

    it('should route /api/v2/admin/events with auth', () => {
      expect(routerSource).toContain("pathname === '/api/v2/admin/events'");
      expect(routerSource).toContain('handleAdminListEvents(request, env)');
    });

    it('should gate all admin routes with requireAdmin', () => {
      // Count requireAdmin calls — should be at every admin route
      const adminCalls = (routerSource.match(/requireAdmin\(request, env/g) || []).length;
      // At least: /admin, /api/v2/admin/events, admin forms, 6 flag endpoints
      expect(adminCalls).toBeGreaterThanOrEqual(8);
    });
  });

  describe('Public Form Routes', () => {
    it('should match public form submit pattern', () => {
      expect(routerSource).toContain('/api/v2/events/');
      expect(routerSource).toContain('register');
      expect(routerSource).toContain('checkin');
      expect(routerSource).toContain('survey');
      expect(routerSource).toContain('email-signup');
    });

    it('should require POST for form submissions', () => {
      expect(routerSource).toContain("method === 'POST'");
    });

    it('should check feature flags before form submission', () => {
      expect(routerSource).toContain('isFeatureEnabled');
      expect(routerSource).toContain('FORM_DISABLED');
    });

    it('should route each form type to its handler', () => {
      expect(routerSource).toContain("case 'register':");
      expect(routerSource).toContain('handleFormRegistration(request, env, eventId)');
      expect(routerSource).toContain("case 'checkin':");
      expect(routerSource).toContain('handleFormCheckin(request, env, eventId)');
      expect(routerSource).toContain("case 'survey':");
      expect(routerSource).toContain('handleFormSurvey(request, env, eventId)');
      expect(routerSource).toContain("case 'email-signup':");
      expect(routerSource).toContain('handleFormEmailSignup(request, env, eventId)');
    });
  });

  describe('Admin Form Routes (Auth-Gated)', () => {
    it('should match admin form endpoints', () => {
      expect(routerSource).toContain("'registrations'");
      expect(routerSource).toContain("'checkin-count'");
      expect(routerSource).toContain("'surveys'");
      expect(routerSource).toContain("'email-signups'");
    });

    it('should route admin form types to handlers', () => {
      expect(routerSource).toContain('handleAdminRegistrations(request, env, eventId)');
      expect(routerSource).toContain('handleAdminCheckinCount(request, env, eventId)');
      expect(routerSource).toContain('handleAdminSurveys(request, env, eventId)');
      expect(routerSource).toContain('handleAdminEmailSignupCount(request, env, eventId)');
    });
  });

  describe('Feature Flag Admin Routes', () => {
    it('should route flag listing endpoints', () => {
      expect(routerSource).toContain("'/api/v2/admin/flags'");
      expect(routerSource).toContain("'/api/v2/admin/flags/tiers'");
      expect(routerSource).toContain("'/api/v2/admin/flags/current-tier'");
      expect(routerSource).toContain("'/api/v2/admin/flags/resolve'");
    });

    it('should route flag mutation endpoints', () => {
      expect(routerSource).toContain("'/api/v2/admin/flags/apply-tier'");
      expect(routerSource).toContain('handleSetFlag(request, env,');
      expect(routerSource).toContain('handleSetEventFlag(request, env,');
      expect(routerSource).toContain('handleRemoveEventFlag(env,');
    });
  });

  describe('Form Page Routes (QR Landing)', () => {
    it('should route /forms/:eventId to handleFormPage', () => {
      expect(routerSource).toContain('/forms/');
      expect(routerSource).toContain('handleFormPage(request, env,');
    });
  });

  describe('MVP Surface Routes', () => {
    it('should route /display to handleDisplayPage', () => {
      expect(routerSource).toContain("pathname === '/display'");
      expect(routerSource).toContain('handleDisplayPage(env)');
    });

    it('should route /poster to handlePosterPage', () => {
      expect(routerSource).toContain("pathname === '/poster'");
      // OSE-310: handler now also takes the request so it can look
      // up the format from the path. Match the function-call prefix
      // so future signature additions don't re-break this assertion.
      expect(routerSource).toMatch(/handlePosterPage\(env\b/);
    });

    it('should route /sharedReport to handleSharedReportPage', () => {
      expect(routerSource).toContain("pathname === '/sharedReport'");
      expect(routerSource).toContain('handleSharedReportPage(env)');
    });
  });

  describe('Landing and Public Pages', () => {
    it('should route / to handleLandingPage', () => {
      expect(routerSource).toContain("pathname === '/'");
      expect(routerSource).toContain('handleLandingPage(env)');
    });

    it('should route /events and /public to handlePublicPage', () => {
      expect(routerSource).toContain("pathname === '/events'");
      expect(routerSource).toContain("pathname === '/public'");
      expect(routerSource).toContain('handlePublicPage(env)');
    });

    it('should route /briefing to handleBriefingPage', () => {
      expect(routerSource).toContain("pathname === '/briefing'");
      expect(routerSource).toContain('handleBriefingPage()');
    });

    it('should route /subscribe POST to handleSubscribe', () => {
      expect(routerSource).toContain("pathname === '/subscribe'");
      expect(routerSource).toContain('handleSubscribe(request, env)');
    });
  });
});

// =============================================================================
// Security Properties
// =============================================================================

describe('Security Properties (Story 1.1)', () => {
  describe('CORS Preflight', () => {
    it('should handle OPTIONS method', () => {
      expect(routerSource).toContain("method === 'OPTIONS'");
    });

    it('should return 204 for preflight', () => {
      expect(routerSource).toContain('status: 204');
    });

    it('should use corsOrigin for origin validation', () => {
      expect(routerSource).toContain('corsOrigin(request)');
    });

    it('should set CORS headers on preflight', () => {
      expect(routerSource).toContain('Access-Control-Allow-Methods');
      expect(routerSource).toContain('Access-Control-Allow-Headers');
      expect(routerSource).toContain('Access-Control-Max-Age');
      expect(routerSource).toContain('Vary');
    });
  });

  describe('HTTPS Redirect', () => {
    it('should redirect HTTP to HTTPS', () => {
      expect(routerSource).toContain("url.protocol === 'http:'");
      expect(routerSource).toContain("url.protocol = 'https:'");
      expect(routerSource).toContain('Response.redirect');
      expect(routerSource).toContain('301');
    });
  });

  describe('Auth Gating', () => {
    it('should use requireAdmin for all admin routes', () => {
      expect(routerSource).toContain('requireAdmin(request, env,');
    });

    it('should generate request IDs for auth', () => {
      expect(routerSource).toContain('crypto.randomUUID');
    });

    it('should return deny response if auth fails', () => {
      expect(routerSource).toContain('if (deny) return deny');
    });
  });

  describe('Feature Flag Gating', () => {
    it('should check feature flags on public form submissions', () => {
      expect(routerSource).toContain('isFeatureEnabled(env.FORMS_DB, flagKey, eventId)');
    });

    it('should return 403 FORM_DISABLED when flag is off', () => {
      expect(routerSource).toContain("code: 'FORM_DISABLED'");
      expect(routerSource).toContain('status: 403');
    });
  });

  describe('404 Handling', () => {
    it('should return 404 JSON for unknown routes', () => {
      expect(routerSource).toContain("error: 'Not found'");
      expect(routerSource).toContain('status: 404');
    });
  });

  describe('Subscribe Method Enforcement', () => {
    it('should return 405 for non-POST /subscribe', () => {
      expect(routerSource).toContain("error: 'Method not allowed'");
      expect(routerSource).toContain('status: 405');
      expect(routerSource).toContain("Allow: 'POST'");
    });
  });
});

// =============================================================================
// Index Entry Point
// =============================================================================

describe('Index Entry Point (Story 1.1)', () => {
  it('should import route from router', () => {
    expect(indexSource).toContain('import { route');
    expect(indexSource).toContain("from './router'");
  });

  it('should export RouterEnv as Env', () => {
    expect(indexSource).toContain('export type { RouterEnv as Env }');
  });

  it('should export default fetch handler', () => {
    expect(indexSource).toContain('async fetch(request: Request, env: RouterEnv');
  });

  it('should call route() in fetch handler', () => {
    expect(indexSource).toContain('return await route(request, env, ctx)');
  });

  it('should catch unhandled errors', () => {
    expect(indexSource).toContain('} catch (err)');
    expect(indexSource).toContain("type: 'UNHANDLED_ERROR'");
    expect(indexSource).toContain('status: 500');
  });

  it('should export scheduled handler for cron', () => {
    expect(indexSource).toContain('async scheduled(');
    expect(indexSource).toContain('runFormDataLifecycle(env)');
  });

  it('should implement PII lifecycle phases', () => {
    expect(indexSource).toContain('LIFECYCLE_COMPLETE');
    expect(indexSource).toContain('registrationsDeleted');
    expect(indexSource).toContain('surveysScrubbed');
    expect(indexSource).toContain('emailSignupsDeleted');
  });

  it('should use whitelist approach for PII scrubbing', () => {
    expect(indexSource).toContain('SAFE_KEY_PATTERNS');
    expect(indexSource).toContain('[SCRUBBED]');
  });
});

// =============================================================================
// Wrangler Configuration
// =============================================================================

describe('Wrangler Configuration (Story 1.1)', () => {
  it('should set main entry point to src/index.ts', () => {
    expect(wranglerTomlSource).toContain('main = "src/index.ts"');
  });

  it('should set worker name', () => {
    expect(wranglerTomlSource).toContain('name = "oursharedevents"');
  });

  it('should configure staging environment', () => {
    expect(wranglerTomlSource).toContain('[env.staging]');
    expect(wranglerTomlSource).toContain('stg.oursharedevents.com');
  });

  it('should configure production environment', () => {
    expect(wranglerTomlSource).toContain('[env.production]');
    expect(wranglerTomlSource).toContain('oursharedevents.com/*');
  });

  it('should configure D1 bindings for main DB and forms DB', () => {
    expect(wranglerTomlSource).toContain('binding = "DB"');
    expect(wranglerTomlSource).toContain('binding = "FORMS_DB"');
  });

  it('should configure cron trigger for lifecycle job', () => {
    expect(wranglerTomlSource).toContain('[triggers]');
    expect(wranglerTomlSource).toContain('crons = ["0 3 * * *"]');
  });

  it('should set WORKER_ENV per environment', () => {
    expect(wranglerTomlSource).toContain('WORKER_ENV = "development"');
    expect(wranglerTomlSource).toContain('WORKER_ENV = "staging"');
    expect(wranglerTomlSource).toContain('WORKER_ENV = "production"');
  });

  it('should document required secrets', () => {
    expect(wranglerTomlSource).toContain('ADMIN_KEY');
    expect(wranglerTomlSource).toContain('FORMS_ENCRYPTION_KEY');
  });
});
