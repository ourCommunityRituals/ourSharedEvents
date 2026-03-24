/**
 * Cloudflare Worker - ZEventBooks API & UI Server
 *
 * Story 5.2: Full DNS Cutover Complete
 * This worker serves ALL zeventbooks.io traffic directly - no GAS proxy.
 *
 * ARCHITECTURE (Story 5.2):
 * - ALL requests handled by Worker-native implementations
 * - NO script.google.com backend calls exist anywhere
 * - HTML pages served from embedded Worker templates
 * - API endpoints use Worker-native Google Sheets API
 * - Shortlinks resolved via Worker-native Sheets API
 *
 * Request routing:
 * - HTML pages: /events, /admin, /display, /poster, /report → Worker templates
 * - API v2: /api/v2/* → Worker-native (Sheets API)
 * - Shortlinks: /r, /redirect → Worker-native Sheets API
 * - Legacy API: /api/* → Returns 410 Gone (deprecated)
 *
 * Deployment environments (see wrangler.toml):
 * - env.production: zeventbooks.io/* (BACKEND_MODE=worker)
 * - env.staging: stg.zeventbooks.io/* (BACKEND_MODE=worker)
 * - env.api-only: api.zeventbooks.io/* (BACKEND_MODE=worker)
 *
 * Key Features:
 * - Custom domain support (zeventbooks.io, stg.zeventbooks.io)
 * - CORS headers for API cross-origin requests
 * - Friendly URL routing (/events → public page)
 * - Transparency headers (X-Proxied-By, X-Worker-Version)
 * - Graceful error handling
 *
 * DEPRECATED (Story 5.2):
 * - GAS proxy functionality (proxyToAppsScript, handleShortlinkRedirect)
 * - BACKEND_MODE=gas and BACKEND_MODE=mixed
 * - Legacy /api/* endpoints (use /api/v2/* instead)
 *
 * See docs/DNS_CUTOVER.md for migration details.
 */

// =============================================================================
// EMBEDDED TEMPLATES - Story 1 Implementation
// =============================================================================
// Import HTML templates directly into the Worker bundle.
// This eliminates the need for KV storage and ensures templates are always
// available, fixing 503 errors on staging routes.
//
// Templates are imported as text strings via wrangler's text import rules.
// See wrangler.toml [[rules]] configuration.
import publicHtml from './templates/public.html';
import adminHtml from './templates/admin.html';
import displayHtml from './templates/display.html';
import posterHtml from './templates/poster.html';
import reportHtml from './templates/report.html';

// =============================================================================
// WORKER-NATIVE API MODULES - Story 6: Cloudflare Worker Migration
// =============================================================================
// These modules implement the new Worker-native API endpoints that talk
// directly to Google Sheets, bypassing GAS.
//
// Feature flag USE_WORKER_API controls whether to use these endpoints.
// Routes: /api/v2/* for new endpoints, /api/* for legacy GAS proxy
import {
  handleStatusRequest as handleWorkerStatusRequest,
  handleSheetsStatusRequest,
  handlePingRequest as handleWorkerPingRequest,
  handleBackendHealthRequest
} from './src/api/status.js';
import {
  routeEventsApi,
  handleListEvents,
  handleGetEvent,
  handleCreateEvent,
  handleUpdateEvent
} from './src/api/events.js';
import {
  routeBundlesApi,
  handlePublicBundle,
  handleDisplayBundle,
  handlePosterBundle,
  handleAdminBundle
} from './src/api/bundles.js';
import {
  requireAdminAuth
} from './src/middleware/auth.js';
import {
  addCorsHeaders as addWorkerCorsHeaders,
  handleCorsPreflightRequest
} from './src/middleware/cors.js';
import {
  isSheetsConfigured
} from './src/sheets/client.js';

// =============================================================================
// STORY 5.2: WORKER-NATIVE SHORTLINK HANDLER
// =============================================================================
// Shortlinks are now resolved directly via Google Sheets API,
// eliminating the GAS proxy dependency.
import {
  handleShortlinkRedirect as handleWorkerShortlinkRedirect,
  isShortlinkRequest
} from './src/api/shortlinks.js';

// =============================================================================
// STORY 0.1: VERSIONED BACKEND ROUTING
// =============================================================================
// Configuration module for routing requests to GAS or Worker-native backends.
// Supports per-route configuration and query param override for staging.
import {
  getBackendForRoute,
  createBackendError500,
  logBackendDecision,
  BACKEND_MODES
} from './src/config/backendConfig.js';

/**
 * Embedded templates map - templates bundled directly with the Worker.
 * These are the primary source for HTML templates, eliminating KV dependency.
 */
const EMBEDDED_TEMPLATES = {
  'public': publicHtml,
  'admin': adminHtml,
  'display': displayHtml,
  'poster': posterHtml,
  'report': reportHtml
};

// Worker version - used for transparency headers and debugging
// Story 1: Embedded templates to fix 503 errors on staging routes
// Story 2: Updated for staging env vars and versioning support
// Story 3: Defensive upstream response handling - honest JSON or structured errors
// Story 5: Add /api/status health check endpoint for CI/CD pipelines
// Story 5.2: Full DNS cutover - all routes Worker-native, GAS proxy removed
// Story 6: Cloudflare Worker Migration - direct Sheets API access
const WORKER_VERSION = '4.0.0';

// =============================================================================
// OBSERVABILITY & LOGGING - Story 5 Implementation
// =============================================================================
// Structured logging for route resolution and error tracking.
// Logs use consistent prefixes for easy filtering and alerting.

/**
 * Log Prefixes:
 * - [ROUTE] - Route resolution logs (HTML routes)
 * - [API] - API request logs
 * - [404] - Not found logs
 * - [ERROR] - Error logs
 * - [GAS_PROXY] - Routes that legitimately proxy to GAS (shortlinks, JSON pages)
 */

/**
 * Get environment identifier from env object
 * Story 2: Updated to prioritize explicit WORKER_ENV for consistent detection
 * @param {Object} env - Worker environment
 * @returns {string} Environment identifier (prod, stg, dev)
 */
function getEnvironmentId(env) {
  // Story 2: Prioritize explicit WORKER_ENV setting
  if (env.WORKER_ENV) {
    const workerEnv = env.WORKER_ENV.toLowerCase();
    if (workerEnv === 'staging' || workerEnv === 'stg') {
      return 'stg';
    }
    if (workerEnv === 'production' || workerEnv === 'prod') {
      return 'prod';
    }
    if (workerEnv === 'development' || workerEnv === 'dev') {
      return 'dev';
    }
  }
  // Fallback: Check for staging indicators
  if (env.ENABLE_DEBUG_ENDPOINTS === 'true') {
    return 'stg';
  }
  // Fallback: Check if staging-specific variables are set (standardized naming)
  if (env.STAGING_DEPLOYMENT_ID || env.STAGING_WEB_APP_URL) {
    return 'stg';
  }
  // Fallback: Check deployment ID pattern (legacy detection)
  const deploymentId = env.STAGING_DEPLOYMENT_ID || env.DEPLOYMENT_ID || '';
  if (deploymentId.includes('xx2nN-zkU') || deploymentId.includes('wwi0ta5')) {
    return 'stg'; // Staging deployment ID patterns
  }
  // Fallback: Check GAS URL for staging (standardized or legacy)
  const gasUrl = env.STAGING_WEB_APP_URL || env.GAS_DEPLOYMENT_BASE_URL || '';
  if (gasUrl.includes('stg') || gasUrl.includes('staging')) {
    return 'stg';
  }
  // Default to prod
  return 'prod';
}

/**
 * Get GAS (Google Apps Script) URL based on environment
 * Story 2: Environment-aware URL resolution for consistent behavior
 * @param {Object} env - Worker environment
 * @returns {string} GAS base URL for the current environment
 */
function getGasUrl(env) {
  const envId = getEnvironmentId(env);

  if (envId === 'stg') {
    // Staging: prefer STAGING_ prefixed vars, then legacy aliases
    return env.STAGING_WEB_APP_URL || env.GAS_DEPLOYMENT_BASE_URL ||
      `https://script.google.com/macros/s/${env.STAGING_DEPLOYMENT_ID || env.DEPLOYMENT_ID || 'unknown'}/exec`;
  }

  // Production (and other): prefer PROD_ prefixed vars, then legacy aliases
  return env.PROD_WEB_APP_URL || env.GAS_DEPLOYMENT_BASE_URL ||
    `https://script.google.com/macros/s/${env.PROD_DEPLOYMENT_ID || env.DEPLOYMENT_ID || 'unknown'}/exec`;
}

/**
 * Get deployment ID based on environment
 * Story 2: Environment-aware deployment ID resolution
 * @param {Object} env - Worker environment
 * @returns {string} Deployment ID for the current environment
 */
function getDeploymentId(env) {
  const envId = getEnvironmentId(env);

  if (envId === 'stg') {
    return env.STAGING_DEPLOYMENT_ID || env.DEPLOYMENT_ID || 'unknown';
  }

  return env.PROD_DEPLOYMENT_ID || env.DEPLOYMENT_ID || 'unknown';
}

/**
 * Log route resolution for HTML pages
 * Format: [ROUTE] /path -> template=X env=Y
 * @param {string} path - Request path
 * @param {string} templateName - Resolved template name
 * @param {Object} env - Worker environment
 */
function logRouteResolution(path, templateName, env) {
  const envId = getEnvironmentId(env);
  console.log(`[ROUTE] ${path} -> template=${templateName} env=${envId}`);
}

/**
 * Log 404 not found responses
 * Format: [404] /path reason=X env=Y
 * @param {string} path - Request path
 * @param {string} reason - Reason for 404
 * @param {Object} env - Worker environment
 */
function log404Response(path, reason, env) {
  const envId = getEnvironmentId(env);
  console.log(`[404] ${path} reason="${reason}" env=${envId}`);
}

/**
 * Log GAS proxy requests (for legitimate GAS-proxied routes only)
 * Format: [GAS_PROXY] type=X path=Y env=Z
 * @param {string} proxyType - Type of proxy (shortlink, json_page, api)
 * @param {string} path - Request path
 * @param {Object} env - Worker environment
 */
function logGasProxy(proxyType, path, env) {
  const envId = getEnvironmentId(env);
  console.log(`[GAS_PROXY] type=${proxyType} path=${path} env=${envId}`);
}

// =============================================================================
// EXPLICIT HTML ROUTE MAP - Story 2 Implementation
// =============================================================================
// HTML routes are served directly from Worker templates.
// GAS is ONLY accessed via /api/* JSON endpoints.
// This eliminates the "leaky" routing where HTML could come from GAS.

/**
 * HTML Route Map - Maps page types to template names
 * Each route explicitly defines which template to render
 */
const HTML_ROUTE_MAP = Object.freeze({
  // Public-facing routes
  'public': 'public',
  'events': 'public',      // Alias for public
  'schedule': 'public',    // Alias for public
  'calendar': 'public',    // Alias for public

  // Admin routes
  'admin': 'admin',
  'manage': 'admin',       // Alias for admin
  'dashboard': 'admin',    // Alias for admin
  'create': 'admin',       // Alias for admin
  'docs': 'admin',         // Alias for admin

  // Display/TV routes
  'display': 'display',
  'tv': 'display',         // Alias for display
  'kiosk': 'display',      // Alias for display
  'screen': 'display',     // Alias for display

  // Poster routes
  'poster': 'poster',
  'posters': 'poster',     // Alias for poster
  'flyers': 'poster',      // Alias for poster

  // Report/Analytics routes
  'report': 'report',
  'analytics': 'report',   // Alias for report
  'reports': 'report',     // Alias for report
  'insights': 'report',    // Alias for report
  'stats': 'report'        // Alias for report
});

/**
 * JSON-only routes - These return JSON, not HTML
 * Handled separately from HTML routes
 */
const JSON_ROUTE_MAP = Object.freeze({
  'status': 'status',
  'health': 'status',
  'ping': 'ping',
  'diagnostics': 'diagnostics',
  'test': 'test',
  'whoami': 'whoami'      // Story 3: GAS identity/deployment info for CI
});

/**
 * Routes that were previously GAS-proxied (DEPRECATED)
 * Story 5.2: These routes now use Worker-native implementations.
 * Shortlinks are resolved via Worker-native Sheets API.
 * @deprecated Use Worker-native shortlink handler instead
 */
const GAS_PROXY_ROUTES = Object.freeze({
  'r': 'redirect',         // Now handled by Worker-native shortlinks
  'redirect': 'redirect'   // Now handled by Worker-native shortlinks
});

// =============================================================================
// TEMPLATE RENDERING SYSTEM
// =============================================================================
// Templates are bundled at build time from GAS templates.
// See: scripts/bundle-worker-templates.js

/**
 * Brand configuration for template rendering
 */
const BRAND_CONFIG = Object.freeze({
  'root': { name: 'ZEventBooks', scope: 'events' },
  'abc': { name: 'ABC Events', scope: 'events' },
  'cbc': { name: 'CBC Events', scope: 'events' },
  'cbl': { name: 'CBL Events', scope: 'leagues' }
});

/**
 * Get brand configuration from brand ID
 */
function getBrandConfig(brandId) {
  return BRAND_CONFIG[brandId] || BRAND_CONFIG['root'];
}

/**
 * Extract routing parameters from URL
 * @param {URL} url - Request URL
 * @returns {Object} Routing parameters
 */
function extractRouteParams(url) {
  const pathname = url.pathname;
  const searchParams = url.searchParams;

  // Extract from query params first
  let page = searchParams.get('page');
  let p = searchParams.get('p');
  let brandId = searchParams.get('brand') || 'root';
  let scope = searchParams.get('scope');

  // Parse path segments
  const segments = pathname.split('/').filter(Boolean);

  // Check if first segment is a brand
  if (segments.length > 0 && VALID_BRANDS.includes(segments[0])) {
    brandId = segments[0];
    segments.shift(); // Remove brand from segments
  }

  // Get page from path if not in query
  if (!page && !p && segments.length > 0) {
    const firstSegment = segments[0].toLowerCase();
    if (Object.hasOwn(HTML_ROUTE_MAP, firstSegment)) {
      page = firstSegment;
    } else if (Object.hasOwn(JSON_ROUTE_MAP, firstSegment)) {
      page = firstSegment;
    } else if (Object.hasOwn(GAS_PROXY_ROUTES, firstSegment)) {
      p = firstSegment;
    }
  }

  // Resolve p-route to page if needed
  if (p && !page) {
    if (p === 'events') {
      page = 'public';
    } else if (Object.hasOwn(GAS_PROXY_ROUTES, p)) {
      // Keep p for redirect handling
    } else {
      page = p;
    }
  }

  // Default to public page
  if (!page && !p) {
    page = 'public';
  }

  // Get brand config
  const brandConfig = getBrandConfig(brandId);

  // Build scope
  if (!scope) {
    scope = brandConfig.scope || 'events';
  }

  return {
    page,
    p,
    brandId,
    scope,
    brandName: brandConfig.name,
    segments,
    searchParams
  };
}

/**
 * Render HTML template with variable substitution
 *
 * Variables replaced:
 * - <?= appTitle ?> - Page title (brand name + scope)
 * - <?= brandId ?> - Brand identifier
 * - <?= scope ?> - Scope (events, leagues, etc.)
 * - <?= execUrl ?> - API endpoint URL (GAS or Worker)
 * - <?= demoMode ?> - Demo mode flag
 *
 * @param {string} templateName - Template name (public, admin, display, poster, report)
 * @param {Object} params - Template parameters
 * @param {Object} env - Worker environment
 * @returns {string} Rendered HTML
 */
function renderTemplate(templateContent, params, env) {
  const {
    brandId = 'root',
    brandName = 'ZEventBooks',
    scope = 'events',
    demoMode = false
  } = params;

  // Story 5.3: GAS retired - DO NOT populate execUrl
  // This forces NUSDK to use Worker proxy transport instead of direct GAS transport
  // When execUrl is empty, NUSDK._directTransport.enabled stays false (default)
  // and all RPC calls go through the Worker's /api/* endpoints
  const execUrl = ''; // Empty = use Worker proxy

  // Build app title
  const appTitle = `${brandName} · ${scope}`;

  // Replace template variables
  let html = templateContent;

  // Replace <?= variable ?> patterns
  html = html.replace(/<\?=\s*appTitle\s*\?>/g, escapeHtml(appTitle));
  html = html.replace(/<\?=\s*brandId\s*\?>/g, escapeHtml(brandId));
  html = html.replace(/<\?=\s*scope\s*\?>/g, escapeHtml(scope));
  // Story 5.3: execUrl is empty to force Worker proxy transport
  html = html.replace(/<\?=\s*execUrl\s*\?>/g, escapeHtml(execUrl));
  html = html.replace(/<\?=\s*demoMode\s*\?>/g, demoMode ? 'true' : 'false');

  return html;
}

// =============================================================================
// TEMPLATE REGISTRY - Story 3 Implementation
// =============================================================================
// Template sanity helpers to guarantee Worker has all templates it needs.
// If a template is missing or empty, these functions throw descriptive errors.

/**
 * Valid template names - the ONLY valid template identifiers
 */
const VALID_TEMPLATE_NAMES = Object.freeze(['admin', 'public', 'display', 'poster', 'report']);

/**
 * Check if a template name is valid
 * @param {string} name - Template name to check
 * @returns {boolean} True if valid
 */
function isValidTemplateName(name) {
  return name && VALID_TEMPLATE_NAMES.includes(name.toLowerCase());
}

/**
 * TemplateError class for template-related errors
 */
class TemplateError extends Error {
  constructor(templateName, reason) {
    super(`Template '${templateName}' error: ${reason}`);
    this.name = 'TemplateError';
    this.templateName = templateName;
    this.reason = reason;
  }
}

/**
 * Validate template content
 *
 * Throws TemplateError if:
 * - Template name is not valid
 * - Content is null, undefined, or not a string
 * - Content is empty or whitespace-only
 * - Content doesn't look like HTML (basic sanity check)
 *
 * @param {string} templateName - Template name
 * @param {*} content - Template content to validate
 * @throws {TemplateError} If validation fails
 * @returns {string} The validated content
 */
function validateTemplate(templateName, content) {
  // Validate template name
  if (!isValidTemplateName(templateName)) {
    throw new TemplateError(templateName, `Invalid template name. Valid names: ${VALID_TEMPLATE_NAMES.join(', ')}`);
  }

  // Check for null/undefined
  if (content == null) {
    throw new TemplateError(templateName, 'Template content is null or undefined');
  }

  // Check for string type
  if (typeof content !== 'string') {
    throw new TemplateError(templateName, `Template content must be string, got ${typeof content}`);
  }

  // Check for empty content
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new TemplateError(templateName, 'Template content is empty');
  }

  // Basic HTML sanity check - should contain doctype or html tag
  const lowerContent = trimmed.toLowerCase();
  if (!lowerContent.includes('<!doctype html') && !lowerContent.includes('<html')) {
    throw new TemplateError(templateName, 'Template content does not appear to be valid HTML');
  }

  // Check minimum length (HTML templates should be reasonably sized)
  const MIN_TEMPLATE_SIZE = 100; // bytes
  if (trimmed.length < MIN_TEMPLATE_SIZE) {
    throw new TemplateError(templateName, `Template content too small (${trimmed.length} bytes, min ${MIN_TEMPLATE_SIZE})`);
  }

  return content;
}

/**
 * Get template content with validation
 *
 * Story 1: Updated to use embedded templates as primary source.
 * Story 3: Enhanced version that throws if template is missing or empty.
 *
 * Template source priority:
 * 1. EMBEDDED_TEMPLATES (bundled with Worker - always available)
 * 2. KV storage (TEMPLATES_KV binding - optional fallback)
 *
 * @param {string} templateName - Template name (admin, public, display, poster, report)
 * @param {Object} env - Worker environment with optional TEMPLATES_KV binding
 * @throws {TemplateError} If template is missing, empty, or invalid
 * @returns {Promise<string>} Template HTML content
 */
async function getTemplate(templateName, env) {
  const name = templateName?.toLowerCase();

  // Validate template name first
  if (!isValidTemplateName(name)) {
    throw new TemplateError(templateName, `Invalid template name. Valid names: ${VALID_TEMPLATE_NAMES.join(', ')}`);
  }

  const templateFile = `${name}.html`;

  // Story 1: Try embedded templates first (bundled with Worker)
  // This is the primary source and eliminates KV dependency
  if (EMBEDDED_TEMPLATES[name]) {
    const content = EMBEDDED_TEMPLATES[name];
    if (content && typeof content === 'string' && content.trim().length > 0) {
      console.log(`[ZEventBooks] Template loaded from embedded source: ${name}`);
      return validateTemplate(name, content);
    }
  }

  // Fallback: Try KV storage (for deployments with KV configured)
  if (env?.TEMPLATES_KV) {
    try {
      const content = await env.TEMPLATES_KV.get(templateFile);

      if (content) {
        console.log(`[ZEventBooks] Template loaded from KV: ${name}`);
        return validateTemplate(name, content);
      }

      // Content was null - template not in KV
      throw new TemplateError(name, `Template file '${templateFile}' not found in KV storage`);
    } catch (e) {
      // Re-throw TemplateError, wrap others
      if (e instanceof TemplateError) {
        throw e;
      }
      throw new TemplateError(name, `KV fetch error: ${e.message}`);
    }
  }

  // No embedded template and no KV binding - this shouldn't happen with proper bundling
  console.error(`[ZEventBooks] Template not found (no embedded, no KV): ${templateFile}`);
  return null;
}

/**
 * Validate all required templates are available
 *
 * Story 1: Updated to report template source (embedded vs KV).
 *
 * @param {Object} env - Worker environment with optional TEMPLATES_KV binding
 * @returns {Promise<Object>} Validation result with status and details
 */
async function validateAllTemplates(env) {
  const result = {
    valid: true,
    templates: {},
    errors: [],
    timestamp: new Date().toISOString(),
    source: 'embedded' // Default source indicator
  };

  for (const name of VALID_TEMPLATE_NAMES) {
    try {
      // Check if embedded template exists
      const hasEmbedded = EMBEDDED_TEMPLATES[name] && typeof EMBEDDED_TEMPLATES[name] === 'string';
      const content = await getTemplate(name, env);
      result.templates[name] = {
        valid: true,
        size: content ? content.length : 0,
        hasDoctype: content ? content.toLowerCase().includes('<!doctype html') : false,
        source: hasEmbedded ? 'embedded' : 'kv'
      };
    } catch (e) {
      result.valid = false;
      result.templates[name] = {
        valid: false,
        error: e.message
      };
      result.errors.push(`${name}: ${e.message}`);
    }
  }

  return result;
}

/**
 * Get template manifest from KV storage
 *
 * @param {Object} env - Worker environment with TEMPLATES_KV binding
 * @returns {Promise<Object|null>} Manifest object or null if not found
 */
async function getManifest(env) {
  if (!env?.TEMPLATES_KV) {
    return null;
  }

  try {
    const manifestStr = await env.TEMPLATES_KV.get('manifest.json');
    if (manifestStr) {
      return JSON.parse(manifestStr);
    }
  } catch (e) {
    console.error('[ZEventBooks] Failed to load template manifest:', e.message);
  }

  return null;
}

// =============================================================================
// ENV STATUS ENDPOINT - Story 3 Implementation
// =============================================================================
// Public endpoint returning worker and GAS deployment information.
// No authentication required - designed for CI consumption.

/**
 * Handle /env-status endpoint (no auth required)
 * Returns worker and GAS deployment information for CI consumption.
 *
 * Accessible via:
 * - GET /env-status
 * - GET /?page=env-status
 *
 * @param {URL} url - Request URL
 * @param {Object} env - Worker environment
 * @returns {Response|null} JSON response if matched, null otherwise
 */
function handleEnvStatusEndpoint(url, env) {
  const pathname = url.pathname;
  const page = url.searchParams.get('page');

  // Match /env-status path or ?page=env-status query
  if (pathname !== '/env-status' && page !== 'env-status') {
    return null;
  }

  // Determine environment
  const envId = getEnvironmentId(env);
  const envName = envId === 'stg' ? 'staging' : 'production';

  // Story 2: Use environment-aware URL and deployment ID resolution
  const gasBase = getGasUrl(env);
  const deploymentId = getDeploymentId(env);

  // Get worker build version
  const workerBuild = env.WORKER_BUILD_VERSION || 'unknown';

  const responseBody = {
    env: envName,
    gasBase: gasBase,
    deploymentId: deploymentId,
    workerBuild: workerBuild
  };

  return new Response(JSON.stringify(responseBody, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Proxied-By': 'zeventbooks-worker',
      'X-Worker-Version': WORKER_VERSION
    }
  });
}

// =============================================================================
// DEBUG ENDPOINTS - Story 3 Implementation
// =============================================================================
// Staging-only debug endpoints for template inspection.
// Guarded by ENABLE_DEBUG_ENDPOINTS env flag (should NEVER be enabled in prod).

/**
 * Handle debug endpoint requests
 *
 * Debug endpoints (staging only):
 * - /__debug/template/admin → returns Admin HTML directly
 * - /__debug/template/public → returns Public HTML directly
 * - /__debug/template/display → returns Display HTML directly
 * - /__debug/template/poster → returns Poster HTML directly
 * - /__debug/template/report → returns Report HTML directly
 * - /__debug/templates/manifest → returns template manifest
 * - /__debug/templates/validate → validates all templates
 *
 * @param {URL} url - Request URL
 * @param {Object} env - Worker environment
 * @returns {Promise<Response|null>} Response if handled, null otherwise
 */
async function handleDebugEndpoint(url, env) {
  const pathname = url.pathname;

  // Only handle /__debug/* paths
  if (!pathname.startsWith('/__debug/')) {
    return null;
  }

  // Check if debug endpoints are enabled
  if (env.ENABLE_DEBUG_ENDPOINTS !== 'true') {
    return new Response(JSON.stringify({
      ok: false,
      code: 'DEBUG_DISABLED',
      message: 'Debug endpoints are disabled in this environment'
    }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        'X-Proxied-By': 'zeventbooks-worker',
        'X-Worker-Version': WORKER_VERSION
      }
    });
  }

  // /__debug/template/<name> - Get raw template HTML
  const templateMatch = pathname.match(/^\/__debug\/template\/([a-z]+)$/);
  if (templateMatch) {
    const templateName = templateMatch[1];

    if (!isValidTemplateName(templateName)) {
      return new Response(JSON.stringify({
        ok: false,
        code: 'INVALID_TEMPLATE',
        message: `Invalid template name: ${templateName}`,
        validTemplates: VALID_TEMPLATE_NAMES
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'X-Proxied-By': 'zeventbooks-worker',
          'X-Worker-Version': WORKER_VERSION
        }
      });
    }

    try {
      const content = await getTemplate(templateName, env);

      if (!content) {
        return new Response(JSON.stringify({
          ok: false,
          code: 'TEMPLATE_NOT_FOUND',
          message: `Template '${templateName}' not found in KV storage`
        }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'X-Proxied-By': 'zeventbooks-worker',
            'X-Worker-Version': WORKER_VERSION
          }
        });
      }

      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Proxied-By': 'zeventbooks-worker',
          'X-Worker-Version': WORKER_VERSION,
          'X-Template': templateName,
          'X-Template-Size': String(content.length),
          'X-Debug-Endpoint': 'true',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    } catch (e) {
      return new Response(JSON.stringify({
        ok: false,
        code: 'TEMPLATE_ERROR',
        message: e.message,
        templateName
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Proxied-By': 'zeventbooks-worker',
          'X-Worker-Version': WORKER_VERSION
        }
      });
    }
  }

  // /__debug/templates/manifest - Get template manifest
  if (pathname === '/__debug/templates/manifest') {
    const manifest = await getManifest(env);

    if (!manifest) {
      return new Response(JSON.stringify({
        ok: false,
        code: 'MANIFEST_NOT_FOUND',
        message: 'Template manifest not found in KV storage'
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'X-Proxied-By': 'zeventbooks-worker',
          'X-Worker-Version': WORKER_VERSION
        }
      });
    }

    return new Response(JSON.stringify(manifest, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Proxied-By': 'zeventbooks-worker',
        'X-Worker-Version': WORKER_VERSION,
        'X-Debug-Endpoint': 'true',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }

  // /__debug/templates/validate - Validate all templates
  if (pathname === '/__debug/templates/validate') {
    const result = await validateAllTemplates(env);

    return new Response(JSON.stringify(result, null, 2), {
      status: result.valid ? 200 : 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Proxied-By': 'zeventbooks-worker',
        'X-Worker-Version': WORKER_VERSION,
        'X-Debug-Endpoint': 'true',
        'X-Templates-Valid': String(result.valid),
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }

  // /__debug/templates - List available debug endpoints
  if (pathname === '/__debug/templates') {
    return new Response(JSON.stringify({
      ok: true,
      debugEndpoints: {
        'GET /__debug/template/<name>': 'Get raw template HTML (admin, public, display, poster, report)',
        'GET /__debug/templates/manifest': 'Get template manifest',
        'GET /__debug/templates/validate': 'Validate all templates are present and valid'
      },
      validTemplates: VALID_TEMPLATE_NAMES,
      workerVersion: WORKER_VERSION
    }, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Proxied-By': 'zeventbooks-worker',
        'X-Worker-Version': WORKER_VERSION,
        'X-Debug-Endpoint': 'true'
      }
    });
  }

  // Unknown debug endpoint
  return new Response(JSON.stringify({
    ok: false,
    code: 'UNKNOWN_DEBUG_ENDPOINT',
    message: `Unknown debug endpoint: ${pathname}`,
    help: 'GET /__debug/templates for available endpoints'
  }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
      'X-Proxied-By': 'zeventbooks-worker',
      'X-Worker-Version': WORKER_VERSION
    }
  });
}

/**
 * Handle HTML page request by rendering template
 *
 * This function serves HTML pages directly from Worker templates.
 * It NEVER calls fetch(GAS_WEBAPP_URL) for HTML routes.
 *
 * @param {URL} url - Request URL
 * @param {Object} params - Route parameters
 * @param {Object} env - Worker environment
 * @returns {Promise<Response>} HTML response
 */
async function handleHtmlPageRequest(url, params, env) {
  const { page, brandId, brandName, scope, searchParams } = params;

  // Resolve template name from route map
  const templateName = HTML_ROUTE_MAP[page];

  if (!templateName) {
    // Should not happen if validation passed, but safety check
    const corrId = generateCorrId();
    log404Response(url.pathname, `No template for page=${page}`, env);
    return create404Response(url, false, corrId);
  }

  // Story 5: Log route resolution with structured format
  // This helps track which template is being served for each route
  logRouteResolution(url.pathname, templateName, env);

  // Check for demo mode
  const demoMode = searchParams.get('demo') === 'true' ||
                   searchParams.get('test') === 'true';

  // Get template content
  const templateContent = await getTemplate(templateName, env);

  if (!templateContent) {
    // Template not found - return error page
    const corrId = generateCorrId();
    console.error(`[ZEventBooks] Template not found: ${templateName}`);

    const html = generateErrorPage({
      title: 'Page Unavailable',
      message: 'This page is temporarily unavailable.',
      hint: 'Please try again in a moment or contact support if the issue persists.',
      corrId,
      pageType: page,
      statusCode: 503
    });

    return new Response(html, {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Proxied-By': 'zeventbooks-worker',
        'X-Worker-Version': WORKER_VERSION,
        'X-Error-CorrId': corrId,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }

  // Render template with variables
  const html = renderTemplate(templateContent, {
    brandId,
    brandName,
    scope,
    demoMode
  }, env);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Proxied-By': 'zeventbooks-worker',
      'X-Worker-Version': WORKER_VERSION,
      'X-Template': templateName,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

/**
 * Handle JSON page request (status, ping, etc.)
 *
 * These routes return JSON responses, not HTML.
 * They proxy to GAS for actual status data.
 *
 * @param {Request} request - Original request
 * @param {URL} url - Request URL
 * @param {Object} params - Route parameters
 * @param {string} appsScriptBase - GAS base URL
 * @param {Object} env - Worker environment
 * @returns {Promise<Response>} JSON response
 */
async function handleJsonPageRequest(request, url, params, appsScriptBase, env) {
  const { page, brandId } = params;

  // Build API URL for status/ping endpoints
  const apiParams = new URLSearchParams();
  apiParams.set('page', page);
  if (brandId) {
    apiParams.set('brand', brandId);
  }

  const targetUrl = `${appsScriptBase}?${apiParams.toString()}`;

  console.log(`[ZEventBooks] JSON page request: ${page} -> ${targetUrl}`);

  // Create timeout controller
  const controller = new AbortController();
  const timeoutMs = env.UPSTREAM_TIMEOUT_MS ? parseInt(env.UPSTREAM_TIMEOUT_MS) : UPSTREAM_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: buildHeaders(request),
      redirect: 'follow',
      signal: controller.signal
    });

    // Return JSON response with CORS headers
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Content-Type', 'application/json');
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('X-Proxied-By', 'zeventbooks-worker');
    newResponse.headers.set('X-Worker-Version', WORKER_VERSION);

    return newResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Handle shortlink redirect request
 *
 * Shortlinks (?p=r&t=...) require GAS to resolve the token.
 * This is one of the FEW routes that proxies to GAS.
 *
 * @param {Request} request - Original request
 * @param {URL} url - Request URL
 * @param {string} appsScriptBase - GAS base URL
 * @param {Object} env - Worker environment
 * @returns {Promise<Response>} Redirect response
 */
async function handleShortlinkRedirect(request, url, appsScriptBase, env) {
  const token = url.searchParams.get('t') || url.searchParams.get('token') || '';

  // Build redirect URL
  const redirectParams = new URLSearchParams();
  redirectParams.set('p', 'r');
  if (token) {
    redirectParams.set('t', token);
  }

  const targetUrl = `${appsScriptBase}?${redirectParams.toString()}`;

  console.log(`[ZEventBooks] Shortlink redirect: ${token ? token.slice(0, 8) + '...' : 'no-token'}`);

  // Create timeout controller
  const controller = new AbortController();
  const timeoutMs = env.UPSTREAM_TIMEOUT_MS ? parseInt(env.UPSTREAM_TIMEOUT_MS) : UPSTREAM_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: buildHeaders(request),
      redirect: 'follow',
      signal: controller.signal
    });

    // Return response as-is (GAS handles the redirect)
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-Proxied-By', 'zeventbooks-worker');
    newResponse.headers.set('X-Worker-Version', WORKER_VERSION);

    return newResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Timeout for upstream requests (ms)
const UPSTREAM_TIMEOUT_MS = 30000;

// =============================================================================
// DEFENSIVE UPSTREAM RESPONSE HANDLING - Story 3 Implementation
// =============================================================================
// Guarantees that:
// - If GAS fails or responds with non-JSON, the Worker surfaces a 5xx + structured error JSON
// - Only real JSON from GAS is ever labeled application/json
// - Frontend can reliably distinguish transient outage (503), misconfig (502), bad input (4xx)

/**
 * GAS Upstream Error Codes
 * Used to distinguish different failure modes for the frontend
 */
const GAS_ERROR_CODES = Object.freeze({
  NON_JSON_RESPONSE: 'GAS_UPSTREAM_NON_JSON',
  PARSE_ERROR: 'GAS_UPSTREAM_PARSE_ERROR',
  INVALID_SHAPE: 'GAS_UPSTREAM_INVALID_SHAPE',
  HTTP_ERROR: 'GAS_UPSTREAM_HTTP_ERROR',
  TIMEOUT: 'TIMEOUT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  NETWORK_ERROR: 'NETWORK_ERROR'
});

/**
 * Check if DEBUG_LEVEL is enabled for verbose logging
 * @param {Object} env - Worker environment
 * @returns {boolean} True if debug logging is enabled
 */
function isDebugEnabled(env) {
  return env.DEBUG_LEVEL === 'debug' || env.DEBUG_LEVEL === 'verbose';
}

/**
 * Log debug information (only when DEBUG_LEVEL=debug)
 * @param {string} message - Log message
 * @param {Object} data - Optional data to log
 * @param {Object} env - Worker environment
 */
function debugLog(message, data, env) {
  if (isDebugEnabled(env)) {
    if (data) {
      console.log(`[DEBUG] ${message}`, JSON.stringify(data, null, 2));
    } else {
      console.log(`[DEBUG] ${message}`);
    }
  }
}

/**
 * Extract first N characters of body for logging (truncates HTML/long responses)
 * @param {string} body - Response body
 * @param {number} maxLength - Maximum length (default 500)
 * @returns {string} Truncated body
 */
function truncateForLog(body, maxLength = 500) {
  if (!body) return '(empty)';
  if (body.length <= maxLength) return body;
  return body.slice(0, maxLength) + '... (truncated)';
}

/**
 * Create a structured error response for API failures
 *
 * @param {number} status - HTTP status code (502, 503, etc.)
 * @param {string} errorCode - One of GAS_ERROR_CODES
 * @param {string} message - Human-readable error message
 * @param {Object} options - Additional options
 * @param {string} options.corrId - Correlation ID
 * @param {number} options.backendStatus - Upstream HTTP status (optional)
 * @param {number} options.backendDurationMs - Upstream request duration (optional)
 * @returns {Response} JSON error response
 */
function createStructuredErrorResponse(status, errorCode, message, options = {}) {
  const { corrId, backendStatus, backendDurationMs } = options;

  const body = {
    ok: false,
    status,
    errorCode,
    message,
    ...(corrId ? { corrId } : {}),
    workerVersion: WORKER_VERSION
  };

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'X-Proxied-By': 'zeventbooks-worker',
    'X-Worker-Version': WORKER_VERSION,
    ...(corrId ? { 'X-Error-CorrId': corrId } : {}),
    ...(backendStatus !== undefined ? { 'X-Backend-Status': String(backendStatus) } : {}),
    ...(backendDurationMs !== undefined ? { 'X-Backend-Duration-Ms': String(backendDurationMs) } : {}),
    'Retry-After': status === 503 ? '15' : '30'
  };

  return new Response(JSON.stringify(body), { status, headers });
}

// =============================================================================
// HEALTH CHECK ENDPOINT - Story 5 Implementation
// =============================================================================
// Lightweight health check endpoint for CI/CD pipelines.
// Returns structured JSON with GAS backend and eventsIndex health status.

/**
 * Health check timeout (shorter than normal API timeout for fast fail)
 * @constant {number}
 */
const HEALTH_CHECK_TIMEOUT_MS = 15000; // 15 seconds

/**
 * Create a structured health check error response
 *
 * @param {number} status - HTTP status code (502, 503, 504)
 * @param {string} errorCode - One of GAS_ERROR_CODES
 * @param {string} message - Human-readable error message
 * @param {Object} options - Additional options
 * @param {string} options.corrId - Correlation ID
 * @param {number} options.backendDurationMs - Upstream request duration (optional)
 * @param {Object} options.env - Worker environment
 * @returns {Response} JSON error response in health check format
 */
function createHealthCheckErrorResponse(status, errorCode, message, options = {}) {
  const { corrId, backendDurationMs, env = {} } = options;
  const workerBuild = env.WORKER_BUILD_VERSION || 'unknown';

  const body = {
    ok: false,
    status,
    errorCode,
    message,
    version: workerBuild,
    checks: {
      gas: 'error',
      eventsIndex: 'error'
    },
    ...(corrId ? { corrId } : {}),
    workerVersion: WORKER_VERSION
  };

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'X-Proxied-By': 'zeventbooks-worker',
    'X-Worker-Version': WORKER_VERSION,
    ...(corrId ? { 'X-Error-CorrId': corrId } : {}),
    ...(backendDurationMs !== undefined ? { 'X-Backend-Duration-Ms': String(backendDurationMs) } : {}),
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  };

  return new Response(JSON.stringify(body, null, 2), { status, headers });
}

/**
 * Handle health check endpoint request
 *
 * Story 5 AC:
 * - GET /api/status returns health check JSON
 * - POST /api/status with { "method": "status" } also works
 * - Response format:
 *   {
 *     "ok": true,
 *     "status": 200,
 *     "version": "stg-2025.12.09",
 *     "checks": {
 *       "gas": "ok",
 *       "eventsIndex": "ok"
 *     }
 *   }
 * - When GAS fails, returns 502 with ok:false and errorCode
 * - Has strict timeout (15s) and cannot hang indefinitely
 *
 * @param {Request} request - The incoming request
 * @param {string} appsScriptBase - GAS exec URL
 * @param {Object} env - Worker environment
 * @param {URL} url - Parsed request URL
 * @returns {Response} Health check JSON response
 */
async function handleHealthCheckEndpoint(request, appsScriptBase, env, url) {
  const origin = url.origin;
  const workerBuild = env.WORKER_BUILD_VERSION || 'unknown';
  const corrId = generateCorrId();

  console.log(`[HEALTH] Health check request: ${request.method} ${url.pathname}`);

  // Parse brandId from query params or body
  let brandId = url.searchParams.get('brand') || url.searchParams.get('brandId') || 'root';

  // For POST requests, check body for brandId
  if (request.method === 'POST') {
    try {
      const bodyText = await request.clone().text();
      if (bodyText) {
        const body = JSON.parse(bodyText);
        brandId = body.brandId || body.brand || brandId;
      }
    } catch (e) {
      // Ignore parse errors, use default brandId
    }
  }

  // Create AbortController for strict timeout
  const controller = new AbortController();
  const timeoutMs = Math.min(
    env.HEALTH_CHECK_TIMEOUT_MS ? parseInt(env.HEALTH_CHECK_TIMEOUT_MS) : HEALTH_CHECK_TIMEOUT_MS,
    HEALTH_CHECK_TIMEOUT_MS // Never exceed 15s for health checks
  );
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const fetchStartTime = Date.now();

  try {
    // Call GAS health endpoint
    const gasBody = {
      action: 'health',
      brandId
    };

    const response = await fetch(appsScriptBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': origin || 'https://zeventbooks.io',
        'User-Agent': 'ZEventBooks-Worker-HealthCheck',
        'X-Request-Id': corrId
      },
      body: JSON.stringify(gasBody),
      redirect: 'follow',
      signal: controller.signal
    });

    const backendDurationMs = Date.now() - fetchStartTime;
    console.log(`[HEALTH] GAS response: ${response.status} in ${backendDurationMs}ms`);

    const responseText = await response.text();

    // Check for non-JSON response (GAS error page, permission denied, etc.)
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html') || response.status >= 400) {
      console.log(`[HEALTH] GAS returned non-JSON or error: status=${response.status}, contentType=${contentType}`);
      return createHealthCheckErrorResponse(
        502,
        GAS_ERROR_CODES.NON_JSON_RESPONSE,
        'GAS health check returned non-JSON response. Backend may be misconfigured or unavailable.',
        { corrId, backendDurationMs, env }
      );
    }

    // Parse JSON response
    let gasResult;
    try {
      gasResult = JSON.parse(responseText);
    } catch (e) {
      console.log(`[HEALTH] Failed to parse GAS response: ${e.message}`);
      return createHealthCheckErrorResponse(
        502,
        GAS_ERROR_CODES.PARSE_ERROR,
        'Failed to parse GAS health check response as JSON.',
        { corrId, backendDurationMs, env }
      );
    }

    // Build the final health check response
    const healthResponse = {
      ok: gasResult.ok === true,
      status: gasResult.ok === true ? 200 : 502,
      version: workerBuild,
      gasBuildId: gasResult.gasBuildId || 'unknown',
      brandId: gasResult.brandId || brandId,
      time: gasResult.time || new Date().toISOString(),
      checks: {
        gas: gasResult.checks?.gas || (gasResult.ok ? 'ok' : 'error'),
        eventsIndex: gasResult.checks?.eventsIndex || 'error'
      },
      durationMs: backendDurationMs,
      corrId
    };

    // Include errors from GAS if present
    if (gasResult.errors && gasResult.errors.length > 0) {
      healthResponse.errors = gasResult.errors;
    }

    // Return with appropriate HTTP status
    const httpStatus = healthResponse.ok ? 200 : 502;

    return new Response(JSON.stringify(healthResponse, null, 2), {
      status: httpStatus,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Proxied-By': 'zeventbooks-worker',
        'X-Worker-Version': WORKER_VERSION,
        'X-Backend-Status': String(response.status),
        'X-Backend-Duration-Ms': String(backendDurationMs),
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch (error) {
    const backendDurationMs = Date.now() - fetchStartTime;
    const isTimeout = error.name === 'AbortError';

    console.log(`[HEALTH] Fetch error: ${error.message}, isTimeout=${isTimeout}`);

    if (isTimeout) {
      return createHealthCheckErrorResponse(
        503,
        GAS_ERROR_CODES.TIMEOUT,
        `Health check timed out after ${timeoutMs}ms. GAS backend may be slow or unavailable.`,
        { corrId, backendDurationMs, env }
      );
    }

    return createHealthCheckErrorResponse(
      503,
      GAS_ERROR_CODES.NETWORK_ERROR,
      `Health check failed to connect to GAS backend: ${error.message}`,
      { corrId, backendDurationMs, env }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Process upstream GAS response with defensive validation
 *
 * Story 3 AC:
 * - Inspect upstream HTTP status and content-type from GAS
 * - Try to parse JSON
 * - If parse succeeds and response shape matches contract → return 200 + JSON
 * - If parse fails or content-type is not JSON → return 502 with structured error
 * - Add x-backend-status and x-backend-duration-ms headers
 * - Only set content-type: application/json when body actually is JSON
 *
 * @param {Response} upstreamResponse - Raw response from GAS
 * @param {string} responseText - Response body as text
 * @param {Object} options - Processing options
 * @param {number} options.startTime - Request start timestamp (for duration calc)
 * @param {string} options.action - The API action being called (for logging)
 * @param {Object} options.env - Worker environment (for debug logging)
 * @returns {Response} Validated JSON response or structured error
 */
function processUpstreamResponse(upstreamResponse, responseText, options = {}) {
  const { startTime, action, env = {} } = options;
  const backendDurationMs = startTime ? Date.now() - startTime : undefined;
  const backendStatus = upstreamResponse.status;
  const contentType = upstreamResponse.headers.get('content-type') || '';
  const corrId = generateCorrId();

  // Debug logging for staging
  debugLog(`Upstream response for action=${action}`, {
    status: backendStatus,
    contentType,
    bodyLength: responseText?.length,
    bodyPreview: truncateForLog(responseText, 200)
  }, env);

  // Check if upstream returned an error status
  if (backendStatus >= 400) {
    console.log(`[API_ERROR] Upstream returned HTTP ${backendStatus} for action=${action}`);
    debugLog('Upstream error response body', { body: truncateForLog(responseText) }, env);

    // Try to parse error response as JSON
    try {
      const errorData = JSON.parse(responseText);
      // If it's valid JSON, pass it through with the original status
      return new Response(JSON.stringify(errorData), {
        status: backendStatus,
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Status': String(backendStatus),
          ...(backendDurationMs !== undefined ? { 'X-Backend-Duration-Ms': String(backendDurationMs) } : {})
        }
      });
    } catch {
      // Not JSON - return structured error
      return createStructuredErrorResponse(
        backendStatus >= 500 ? 502 : backendStatus,
        GAS_ERROR_CODES.HTTP_ERROR,
        `Upstream returned HTTP ${backendStatus}`,
        { corrId, backendStatus, backendDurationMs }
      );
    }
  }

  // Check content-type - if it's explicitly HTML, this is an error (e.g., permission page)
  if (contentType.includes('text/html')) {
    console.log(`[API_ERROR] Upstream returned HTML instead of JSON for action=${action}, corrId=${corrId}`);
    debugLog('HTML response body', { body: truncateForLog(responseText) }, env);

    // Detect common GAS error patterns
    let message = 'Upstream Apps Script returned non-JSON response.';
    if (responseText.includes('You do not have permission') ||
        responseText.includes('requires access') ||
        responseText.includes('Sign in')) {
      message = 'Upstream Apps Script returned permission error (misconfiguration or auth required).';
    } else if (responseText.includes('Error') || responseText.includes('error')) {
      message = 'Upstream Apps Script returned an error page.';
    }

    return createStructuredErrorResponse(
      502,
      GAS_ERROR_CODES.NON_JSON_RESPONSE,
      message,
      { corrId, backendStatus, backendDurationMs }
    );
  }

  // Try to parse JSON
  let parsedJson;
  try {
    parsedJson = JSON.parse(responseText);
  } catch (parseError) {
    console.log(`[API_ERROR] Failed to parse upstream response as JSON for action=${action}, corrId=${corrId}`);
    debugLog('Parse error details', {
      error: parseError.message,
      body: truncateForLog(responseText)
    }, env);

    return createStructuredErrorResponse(
      502,
      GAS_ERROR_CODES.PARSE_ERROR,
      'Upstream Apps Script returned invalid JSON.',
      { corrId, backendStatus, backendDurationMs }
    );
  }

  // Validate response shape - must have 'ok' field (our contract)
  // Note: We're lenient here - we just check for basic validity
  // The actual contract validation can be done by the frontend
  if (typeof parsedJson !== 'object' || parsedJson === null) {
    console.log(`[API_ERROR] Upstream response is not a JSON object for action=${action}, corrId=${corrId}`);
    debugLog('Invalid shape', { parsed: parsedJson }, env);

    return createStructuredErrorResponse(
      502,
      GAS_ERROR_CODES.INVALID_SHAPE,
      'Upstream Apps Script returned non-object JSON.',
      { corrId, backendStatus, backendDurationMs }
    );
  }

  // Valid JSON response - return with transparency headers
  debugLog(`Valid JSON response for action=${action}`, { ok: parsedJson.ok }, env);

  return new Response(JSON.stringify(parsedJson), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Backend-Status': String(backendStatus),
      ...(backendDurationMs !== undefined ? { 'X-Backend-Duration-Ms': String(backendDurationMs) } : {})
    }
  });
}

/**
 * Handle upstream fetch errors (timeouts, network errors)
 *
 * @param {Error} error - The caught error
 * @param {string} action - The API action being called
 * @param {number} startTime - Request start timestamp
 * @param {Object} env - Worker environment
 * @returns {Response} Structured error response
 */
function handleUpstreamFetchError(error, action, startTime, env = {}) {
  const backendDurationMs = startTime ? Date.now() - startTime : undefined;
  const corrId = generateCorrId();
  const isTimeout = error.name === 'AbortError';

  console.log(`[API_ERROR] Upstream fetch failed for action=${action}: ${error.message}, corrId=${corrId}`);
  debugLog('Fetch error details', {
    name: error.name,
    message: error.message,
    isTimeout
  }, env);

  if (isTimeout) {
    return createStructuredErrorResponse(
      504,
      GAS_ERROR_CODES.TIMEOUT,
      'Upstream Apps Script request timed out.',
      { corrId, backendDurationMs }
    );
  }

  return createStructuredErrorResponse(
    503,
    GAS_ERROR_CODES.NETWORK_ERROR,
    'Failed to connect to upstream Apps Script.',
    { corrId, backendDurationMs }
  );
}

// =============================================================================
// CANONICAL ROUTES - Single Source of Truth
// =============================================================================
// Only these routes are supported externally. Unknown routes return 404.
// This prevents mis-routing and ensures predictable behavior.

/**
 * Canonical page routes (?page=X or path-based)
 * Maps to HTML pages served by Google Apps Script
 */
const CANONICAL_PAGES = Object.freeze({
  'admin': 'admin',
  'display': 'display',
  'poster': 'poster',
  'public': 'public',
  'report': 'report',
  'status': 'status',
  'ping': 'ping',
  'diagnostics': 'diagnostics',
  'shared-report': 'report',  // Alias
  'test': 'test',             // Test page
  'env-status': 'env-status', // Story 3: Environment status for CI
  'whoami': 'whoami'          // Story 4: GAS deployment/account info for CI
});

/**
 * Canonical shorthand routes (?p=X)
 * Short aliases for common operations
 */
const CANONICAL_P_ROUTES = Object.freeze({
  'events': 'public',    // ?p=events -> public page
  'status': 'status',    // ?p=status -> status JSON
  'r': 'redirect',       // ?p=r -> shortlink redirect (handled by GAS)
  'redirect': 'redirect', // ?p=redirect -> shortlink redirect
  'api': 'api'           // ?p=api -> API request (legacy format)
});

/**
 * Canonical API actions (?action=X)
 * Whitelisted API endpoints
 */
const CANONICAL_API_ACTIONS = Object.freeze([
  // Public API endpoints
  'api_status',
  'api_statusPure',
  'health',        // Story 5: CI/CD health check endpoint
  'api_events',
  'api_eventById',
  'api_sponsors',
  // Admin API endpoints (require auth)
  'api_createEvent',
  'api_updateEvent',
  'api_deleteEvent',
  'api_uploadImage',
  // Display/Kiosk API
  'api_displayData',
  'api_nextEvent',
  // Poster API
  'api_posterData',
  // Report API
  'api_reportData',
  'api_analytics',
  // Legacy action names (used by smoke tests and older clients)
  // These map to api_* functions in the GAS backend
  'list',              // -> api_list (events, sponsors)
  'getPublicBundle',   // -> api_getPublicBundle
  'getSponsorReportQr', // -> api_getSponsorReportQr
  'getSharedAnalytics', // -> api_getSharedAnalytics
  'getSharedReportBundle' // -> api_getSharedReportBundle
]);

/**
 * Canonical friendly URL path segments
 * Maps first path segment to page parameter
 */
const CANONICAL_PATH_TO_PAGE = Object.freeze({
  // Public page aliases
  'events': 'public',
  'schedule': 'public',
  'calendar': 'public',
  // Admin page aliases
  'manage': 'admin',
  'admin': 'admin',
  'dashboard': 'admin',
  'create': 'admin',
  'docs': 'admin',
  // Display page aliases
  'display': 'display',
  'tv': 'display',
  'kiosk': 'display',
  'screen': 'display',
  // Poster page aliases
  'poster': 'poster',
  'posters': 'poster',
  'flyers': 'poster',
  // Report page aliases
  'analytics': 'report',
  'reports': 'report',
  'insights': 'report',
  'stats': 'report',
  // Status/health aliases
  'status': 'status',
  'health': 'status',
  'ping': 'ping',
  // Story 3: Environment status for CI
  'env-status': 'env-status',
  // Story 4: GAS deployment/account info for CI
  'whoami': 'whoami',
  // API path
  'api': 'api'
});

/**
 * Valid brands (path prefixes like /abc/events)
 */
const VALID_BRANDS = Object.freeze(['root', 'abc', 'cbc', 'cbl']);

/**
 * Check if a page parameter is valid
 */
function isValidPage(page) {
  return page && Object.hasOwn(CANONICAL_PAGES, page);
}

/**
 * Check if a ?p= shorthand is valid
 */
function isValidPRoute(p) {
  return p && Object.hasOwn(CANONICAL_P_ROUTES, p);
}

/**
 * Check if an action parameter is valid
 */
function isValidAction(action) {
  return action && CANONICAL_API_ACTIONS.includes(action);
}

/**
 * Check if a path segment maps to a known page
 */
function isValidPathSegment(segment) {
  return segment && (
    Object.hasOwn(CANONICAL_PATH_TO_PAGE, segment) ||
    VALID_BRANDS.includes(segment)
  );
}

// Error tracking endpoint (optional - set via env variable)
// Falls back to console.error if not configured

// Configuration - Updated by CI/CD or set in wrangler.toml
// This is the production deployment ID (PROD_DEPLOYMENT_ID)
const DEFAULT_DEPLOYMENT_ID = 'AKfycbz-RVTCdsQsI913wN3TkPtUP8F8EhSjyFAlWIpLVRgzV6WJ-isDyG-ntaV1VjBNaWZLdw';

/**
 * Generate a correlation ID for error tracking
 * Format: err_YYYYMMDDHHMMSS_RAND
 */
function generateCorrId() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `err_${timestamp}_${rand}`;
}

// =============================================================================
// FRIENDLY OFFLINE PAGE - Story 7 Implementation
// =============================================================================
// Minimal, human-readable error page for when staging is offline or redeploying.
// Returns simple HTML instead of a white screen for better UX.

/**
 * Generate minimal friendly offline page for staging deployments
 *
 * Story 7 AC:
 * - No white-screen
 * - Human-readable error
 * - Message: "Staging temporarily offline; build redeploying."
 *
 * @param {Object} options - Offline page options
 * @param {string} options.corrId - Correlation ID for support
 * @param {boolean} options.isStaging - Whether this is a staging environment
 * @returns {string} Minimal HTML string
 */
function generateOfflinePage(options = {}) {
  const {
    corrId = '',
    isStaging = true
  } = options;

  const envLabel = isStaging ? 'Staging' : 'Service';
  const message = isStaging
    ? 'Staging temporarily offline; build redeploying.'
    : 'Service temporarily unavailable.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZEventBooks - Offline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      line-height: 1.6;
    }
    .offline-container {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 48px 40px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      backdrop-filter: blur(10px);
    }
    .offline-icon {
      font-size: 56px;
      margin-bottom: 20px;
      animation: spin 3s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    h1 {
      font-size: 1.5rem;
      color: #f59e0b;
      margin-bottom: 12px;
      font-weight: 600;
    }
    .message {
      font-size: 1.1rem;
      color: #cbd5e1;
      margin-bottom: 24px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #fbbf24;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 0.875rem;
      font-weight: 500;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      background: #fbbf24;
      border-radius: 50%;
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.8); }
    }
    .auto-refresh {
      margin-top: 24px;
      font-size: 0.875rem;
      color: #64748b;
    }
    .countdown {
      color: #f59e0b;
      font-weight: 600;
    }
    .corr-id {
      margin-top: 20px;
      font-size: 0.7rem;
      color: #475569;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="offline-container" role="alert" aria-live="polite">
    <div class="offline-icon" aria-hidden="true">⚙️</div>
    <h1>${envLabel} Offline</h1>
    <p class="message">${message}</p>
    <div class="status-badge">
      <span class="pulse-dot" aria-hidden="true"></span>
      <span>Redeploying...</span>
    </div>
    <p class="auto-refresh">Page will refresh in <span class="countdown" id="countdown">15</span>s</p>
    ${corrId ? `<p class="corr-id">Reference: ${corrId}</p>` : ''}
  </div>
  <script>
    // Auto-refresh with countdown
    let seconds = 15;
    const countdownEl = document.getElementById('countdown');
    const interval = setInterval(() => {
      seconds--;
      if (countdownEl) countdownEl.textContent = seconds;
      if (seconds <= 0) {
        clearInterval(interval);
        location.reload();
      }
    }, 1000);
  </script>
</body>
</html>`;
}

/**
 * Generate branded HTML error page for graceful degradation
 * @param {Object} options - Error page options
 * @param {string} options.title - Error title
 * @param {string} options.message - User-friendly error message
 * @param {string} options.hint - Additional hint/instruction
 * @param {string} options.corrId - Correlation ID for support
 * @param {string} options.pageType - Page type (admin, public, display, poster)
 * @param {number} options.statusCode - HTTP status code
 * @returns {string} HTML string
 */
function generateErrorPage(options) {
  const {
    title = 'Temporary Issue',
    message = 'We\'re experiencing a temporary problem loading this page.',
    hint = 'Please refresh the page or try again in a minute.',
    corrId = '',
    pageType = 'public',
    statusCode = 503
  } = options;

  // Page-specific styling based on context
  const isTV = pageType === 'display';
  const bgColor = isTV ? '#111' : '#f8fafc';
  const textColor = isTV ? '#f0f0f0' : '#1e293b';
  const mutedColor = isTV ? '#9ca3af' : '#64748b';
  const accentColor = '#f59e0b'; // Warning yellow
  const cardBg = isTV ? '#1a1a1a' : '#ffffff';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZEventBooks - ${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${bgColor};
      color: ${textColor};
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      line-height: 1.6;
    }
    .error-container {
      background: ${cardBg};
      border-radius: 16px;
      padding: 48px;
      max-width: 520px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,${isTV ? '0.4' : '0.1'});
      ${isTV ? 'border: 1px solid #333;' : ''}
    }
    .error-icon {
      font-size: ${isTV ? '80px' : '64px'};
      margin-bottom: 24px;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.8; transform: scale(1.05); }
    }
    h1 {
      font-size: ${isTV ? '2rem' : '1.75rem'};
      color: ${accentColor};
      margin-bottom: 16px;
      font-weight: 600;
    }
    .message {
      font-size: ${isTV ? '1.25rem' : '1.1rem'};
      color: ${textColor};
      margin-bottom: 12px;
    }
    .hint {
      font-size: ${isTV ? '1rem' : '0.95rem'};
      color: ${mutedColor};
      margin-bottom: 24px;
    }
    .btn-retry {
      display: inline-block;
      background: ${accentColor};
      color: #000;
      padding: 14px 32px;
      border-radius: 8px;
      font-size: ${isTV ? '1.1rem' : '1rem'};
      font-weight: 600;
      text-decoration: none;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn-retry:hover {
      background: #d97706;
      transform: translateY(-2px);
    }
    .btn-retry:active {
      transform: translateY(0);
    }
    .corr-id {
      margin-top: 24px;
      font-size: 0.75rem;
      color: ${mutedColor};
      font-family: monospace;
      opacity: 0.7;
    }
    .auto-refresh {
      margin-top: 16px;
      font-size: 0.85rem;
      color: ${mutedColor};
    }
    .countdown {
      font-weight: 600;
      color: ${accentColor};
    }
  </style>
</head>
<body>
  <div class="error-container" role="alert">
    <div class="error-icon">⚠️</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="message">${escapeHtml(message)}</p>
    <p class="hint">${escapeHtml(hint)}</p>
    <button class="btn-retry" onclick="location.reload()">🔄 Try Again</button>
    ${isTV ? '<p class="auto-refresh">Auto-refreshing in <span class="countdown" id="countdown">30</span>s</p>' : ''}
    ${corrId ? `<p class="corr-id">Reference: ${escapeHtml(corrId)}</p>` : ''}
  </div>
  ${isTV ? `
  <script>
    // Auto-refresh for TV displays
    let seconds = 30;
    const countdownEl = document.getElementById('countdown');
    setInterval(() => {
      seconds--;
      if (countdownEl) countdownEl.textContent = seconds;
      if (seconds <= 0) location.reload();
    }, 1000);
  </script>
  ` : ''}
</body>
</html>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate 404 Not Found HTML page
 * @param {Object} options - Error page options
 * @param {string} options.path - The requested path
 * @param {string} options.corrId - Correlation ID for support
 * @returns {string} HTML string
 */
function generate404Page(options) {
  const { path = '/', corrId = '' } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZEventBooks - Page Not Found</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc;
      color: #1e293b;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      line-height: 1.6;
    }
    .error-container {
      background: #ffffff;
      border-radius: 16px;
      padding: 48px;
      max-width: 520px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
    }
    .error-code {
      font-size: 96px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 1.75rem;
      color: #1e293b;
      margin-bottom: 16px;
      font-weight: 600;
    }
    .message {
      font-size: 1.1rem;
      color: #64748b;
      margin-bottom: 12px;
    }
    .path {
      font-family: monospace;
      background: #f1f5f9;
      padding: 8px 16px;
      border-radius: 8px;
      color: #475569;
      margin: 16px 0;
      word-break: break-all;
    }
    .hint {
      font-size: 0.95rem;
      color: #94a3b8;
      margin-bottom: 24px;
    }
    .btn-home {
      display: inline-block;
      background: #3b82f6;
      color: #fff;
      padding: 14px 32px;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s ease;
    }
    .btn-home:hover {
      background: #2563eb;
      transform: translateY(-2px);
    }
    .corr-id {
      margin-top: 24px;
      font-size: 0.75rem;
      color: #94a3b8;
      font-family: monospace;
      opacity: 0.7;
    }
    .valid-routes {
      text-align: left;
      margin: 24px 0;
      padding: 16px;
      background: #f8fafc;
      border-radius: 8px;
    }
    .valid-routes h3 {
      font-size: 0.9rem;
      color: #64748b;
      margin-bottom: 8px;
    }
    .valid-routes ul {
      list-style: none;
      font-size: 0.85rem;
      color: #475569;
    }
    .valid-routes li {
      padding: 4px 0;
    }
    .valid-routes code {
      background: #e2e8f0;
      padding: 2px 6px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="error-container" role="alert">
    <div class="error-code">404</div>
    <h1>Page Not Found</h1>
    <p class="message">The page you're looking for doesn't exist or has been moved.</p>
    <div class="path">${escapeHtml(path)}</div>
    <div class="valid-routes">
      <h3>Valid pages:</h3>
      <ul>
        <li><code>/events</code> - Public events</li>
        <li><code>/admin</code> - Event management</li>
        <li><code>/display</code> - TV/Kiosk display</li>
        <li><code>/poster</code> - Poster generator</li>
        <li><code>/status</code> - Health check</li>
      </ul>
    </div>
    <a href="/events" class="btn-home">Go to Events</a>
    ${corrId ? `<p class="corr-id">Reference: ${escapeHtml(corrId)}</p>` : ''}
  </div>
</body>
</html>`;
}

/**
 * Generate 404 JSON error response for API requests
 * @param {Object} options - Error options
 * @param {string} options.path - The requested path
 * @param {string} options.action - The invalid action requested
 * @param {string} options.corrId - Correlation ID
 * @returns {Object} JSON object
 */
function generate404Json(options) {
  const { path = '/', action = null, corrId = '' } = options;

  return {
    ok: false,
    code: 'NOT_FOUND',
    message: action
      ? `Unknown API action: ${action}`
      : `Route not found: ${path}`,
    corrId,
    workerVersion: WORKER_VERSION,
    validActions: action ? CANONICAL_API_ACTIONS.slice(0, 5).concat(['...']) : undefined
  };
}

/**
 * Create 404 response based on request type
 * @param {URL} url - The request URL
 * @param {boolean} isApiRequest - Whether this is an API request
 * @param {string} corrId - Correlation ID
 * @returns {Response} 404 response
 */
function create404Response(url, isApiRequest, corrId) {
  const path = url.pathname + url.search;

  if (isApiRequest) {
    const action = url.searchParams.get('action');
    const json = generate404Json({ path, action, corrId });

    return new Response(JSON.stringify(json), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Proxied-By': 'zeventbooks-worker',
        'X-Worker-Version': WORKER_VERSION,
        'X-Error-CorrId': corrId,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }

  const html = generate404Page({ path, corrId });

  return new Response(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Proxied-By': 'zeventbooks-worker',
      'X-Worker-Version': WORKER_VERSION,
      'X-Error-CorrId': corrId,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

/**
 * Validate the incoming request and return validation result
 * @param {URL} url - The request URL
 * @returns {Object} { valid: boolean, reason?: string, isApiRequest: boolean }
 */
function validateRoute(url) {
  const page = url.searchParams.get('page');
  const p = url.searchParams.get('p');
  const action = url.searchParams.get('action');
  const pathname = url.pathname;

  // Check for API request indicators
  const isApiRequest = url.searchParams.has('action') ||
                       url.searchParams.has('api') ||
                       url.searchParams.get('format') === 'json' ||
                       pathname.startsWith('/api');

  // If ?action= is present, validate it
  if (action) {
    if (!isValidAction(action)) {
      return { valid: false, reason: `Unknown action: ${action}`, isApiRequest: true };
    }
    return { valid: true, isApiRequest: true };
  }

  // If ?page= is present, validate it
  if (page) {
    if (!isValidPage(page)) {
      return { valid: false, reason: `Unknown page: ${page}`, isApiRequest };
    }
    return { valid: true, isApiRequest };
  }

  // If ?p= is present, validate it
  if (p) {
    if (!isValidPRoute(p)) {
      return { valid: false, reason: `Unknown p route: ${p}`, isApiRequest };
    }
    return { valid: true, isApiRequest };
  }

  // Validate path-based routing
  const segments = pathname.split('/').filter(Boolean);

  // Empty path or root - defaults to events (public)
  if (segments.length === 0) {
    return { valid: true, isApiRequest };
  }

  const firstSegment = segments[0].toLowerCase();

  // Check if first segment is valid
  if (!isValidPathSegment(firstSegment)) {
    return { valid: false, reason: `Unknown path: ${pathname}`, isApiRequest };
  }

  // If first segment is a brand, validate second segment (if present)
  if (VALID_BRANDS.includes(firstSegment) && segments.length > 1) {
    const secondSegment = segments[1].toLowerCase();
    if (!Object.hasOwn(CANONICAL_PATH_TO_PAGE, secondSegment)) {
      return { valid: false, reason: `Unknown path: ${pathname}`, isApiRequest };
    }
  }

  return { valid: true, isApiRequest };
}

/**
 * Log error details for diagnostics
 * @param {Object} env - Worker environment
 * @param {Object} errorDetails - Error information to log
 */
async function logError(env, errorDetails) {
  // Always log to console for Cloudflare dashboard
  console.error('[ZEventBooks Error]', JSON.stringify(errorDetails));

  // If DIAG endpoint is configured, send error there
  // This allows integration with external monitoring (e.g., logging to GAS DIAG sheet)
  if (env.ERROR_LOG_ENDPOINT) {
    try {
      await fetch(env.ERROR_LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'cloudflare-worker',
          version: WORKER_VERSION,
          ...errorDetails,
          timestamp: new Date().toISOString()
        })
      });
    } catch (logErr) {
      console.error('[ZEventBooks] Failed to send error to logging endpoint:', logErr.message);
    }
  }
}

/**
 * Determine page type from URL for error page styling
 */
function getPageType(url) {
  const pathname = url.pathname.toLowerCase();
  const page = url.searchParams.get('page');

  if (page) {
    if (['display', 'tv', 'kiosk'].includes(page)) return 'display';
    if (['admin', 'manage'].includes(page)) return 'admin';
    if (['poster', 'flyer'].includes(page)) return 'poster';
    if (['report', 'analytics'].includes(page)) return 'report';
    return 'public';
  }

  if (pathname.includes('/display') || pathname.includes('/tv') || pathname.includes('/kiosk')) return 'display';
  if (pathname.includes('/admin') || pathname.includes('/manage')) return 'admin';
  if (pathname.includes('/poster') || pathname.includes('/flyer')) return 'poster';
  if (pathname.includes('/report') || pathname.includes('/analytics')) return 'report';

  return 'public';
}

/**
 * Create graceful degradation response for upstream failures
 *
 * Story 7: For staging environments experiencing 503 errors (non-timeout),
 * returns a friendly offline page instead of generic error.
 *
 * @param {Error|Object} error - Error object or {status, message}
 * @param {URL} url - Request URL
 * @param {boolean} isApiRequest - Whether this is an API request
 * @param {string} corrId - Correlation ID
 * @param {Object} env - Worker environment (for staging detection)
 */
function createGracefulErrorResponse(error, url, isApiRequest, corrId, env = {}) {
  const pageType = getPageType(url);
  const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout');
  const is503 = error.status === 503 || (!isTimeout && !error.name);
  const isStaging = getEnvironmentId(env) === 'stg';

  if (isApiRequest) {
    // API requests get JSON error response
    // Story 7: Include staging-specific message for 503
    const apiMessage = isTimeout
      ? 'The request took too long to complete. Please try again.'
      : isStaging && is503
        ? 'Staging temporarily offline; build redeploying.'
        : 'We\'re experiencing a temporary issue. Please try again in a moment.';

    return new Response(JSON.stringify({
      ok: false,
      code: isTimeout ? 'TIMEOUT' : 'SERVICE_UNAVAILABLE',
      message: apiMessage,
      corrId,
      workerVersion: WORKER_VERSION,
      ...(isStaging && is503 ? { redeploying: true } : {})
    }), {
      status: isTimeout ? 504 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Proxied-By': 'zeventbooks-worker',
        'X-Worker-Version': WORKER_VERSION,
        'X-Error-CorrId': corrId,
        'Retry-After': isStaging && is503 ? '15' : '30'
      }
    });
  }

  // Story 7: For staging 503 errors, use the friendly offline page
  if (isStaging && is503 && !isTimeout) {
    const html = generateOfflinePage({
      corrId,
      isStaging: true
    });

    return new Response(html, {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Proxied-By': 'zeventbooks-worker',
        'X-Worker-Version': WORKER_VERSION,
        'X-Error-CorrId': corrId,
        'Retry-After': '15',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }

  // HTML page requests get branded error page (non-staging or timeout)
  const html = generateErrorPage({
    title: isTimeout ? 'Taking Too Long' : 'Temporary Issue',
    message: isTimeout
      ? 'The page is taking longer than expected to load.'
      : 'We\'re experiencing a temporary problem loading this page.',
    hint: 'Please refresh or try again in a minute. If the problem persists, contact support.',
    corrId,
    pageType,
    statusCode: isTimeout ? 504 : 503
  });

  return new Response(html, {
    status: isTimeout ? 504 : 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Proxied-By': 'zeventbooks-worker',
      'X-Worker-Version': WORKER_VERSION,
      'X-Error-CorrId': corrId,
      'Retry-After': '30',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();

    // Story 5.2: GAS URL no longer needed - all routes use Worker-native
    // const appsScriptBase = getGasUrl(env); // REMOVED

    const url = new URL(request.url);

    // Redirect Google's static assets to script.google.com
    // These cannot be proxied - must redirect to Google's CDN
    if (url.pathname.startsWith('/static/')) {
      const staticUrl = `https://script.google.com${url.pathname}${url.search}`;
      return Response.redirect(staticUrl, 302);
    }

    // Handle Google's internal endpoints (warden, jserror, etc.)
    // These are Google's security/analytics endpoints used for bot detection and error reporting.
    // When proxying through a custom domain, Google's client-side scripts
    // validate that the posting URI is a Google domain. Since we're on a custom
    // domain, we return a stub success response to prevent errors.
    // This is safe because these are for Google's internal telemetry, not user authentication.
    if (url.pathname.startsWith('/wardeninit') ||
        url.pathname.startsWith('/warden') ||
        url.pathname.startsWith('/jserror') ||
        url.pathname.startsWith('/_/')) {
      // Return a minimal success response that satisfies the warden client
      // The warden system expects a response but doesn't require specific data
      // when the main application doesn't need bot detection features
      return new Response(')]}\'\n[]', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Proxied-By': 'zeventbooks-worker',
          'X-Worker-Version': WORKER_VERSION,
        },
      });
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      const corsResponse = handleCORS();
      // Add transparency headers to CORS response
      corsResponse.headers.set('X-Proxied-By', 'zeventbooks-worker');
      corsResponse.headers.set('X-Worker-Version', WORKER_VERSION);
      return corsResponse;
    }

    // ==========================================================================
    // DEBUG ENDPOINTS - Story 3 Implementation
    // ==========================================================================
    // Staging-only debug endpoints for template inspection.
    // Returns early if handled; null response means continue to normal routing.
    const debugResponse = await handleDebugEndpoint(url, env);
    if (debugResponse) {
      return addTransparencyHeaders(debugResponse, startTime, env);
    }

    // ==========================================================================
    // ENV STATUS ENDPOINT - Story 3 Implementation
    // ==========================================================================
    // Public /env-status endpoint for CI consumption.
    // No authentication required - returns worker and GAS deployment info.
    const envStatusResponse = handleEnvStatusEndpoint(url, env);
    if (envStatusResponse) {
      return addTransparencyHeaders(envStatusResponse, startTime, env);
    }

    // ==========================================================================
    // WORKER-NATIVE API V2 ENDPOINTS - Story 6 Implementation
    // ==========================================================================
    // New Worker-native API endpoints that talk directly to Google Sheets.
    // These bypass GAS entirely and are the future of the API.
    //
    // Routes:
    //   GET  /api/v2/status           - Worker health check (no GAS)
    //   GET  /api/v2/status/sheets    - Sheets connection check
    //   GET  /api/v2/ping             - Simple ping
    //   GET  /api/v2/events           - List events
    //   GET  /api/v2/events/:id       - Get single event
    //   POST /api/v2/events           - Create event (requires auth)
    //   PUT  /api/v2/events/:id       - Update event (requires auth)
    //   GET  /api/v2/events/:id/bundle/public  - Public bundle
    //   GET  /api/v2/events/:id/bundle/display - Display bundle
    //   GET  /api/v2/events/:id/bundle/poster  - Poster bundle
    //   GET  /api/v2/events/:id/bundle/admin   - Admin bundle (requires auth)
    //
    if (url.pathname.startsWith('/api/v2/')) {
      try {
        const v2Path = url.pathname.slice('/api/v2/'.length);
        const pathSegments = v2Path.split('/').filter(Boolean);
        let response;

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
          response = handleCorsPreflightRequest(request, env);
          return addTransparencyHeaders(response, startTime, env);
        }

        // Route: GET /api/v2/status
        if (v2Path === 'status' && request.method === 'GET') {
          response = await handleWorkerStatusRequest(request, env);
        }
        // Route: GET /api/v2/status/sheets
        else if (v2Path === 'status/sheets' && request.method === 'GET') {
          response = await handleSheetsStatusRequest(request, env);
        }
        // Route: GET /api/v2/ping
        else if (v2Path === 'ping' && request.method === 'GET') {
          response = handleWorkerPingRequest();
        }
        // Route: /api/v2/events/...
        else if (pathSegments[0] === 'events') {
          // Check if this is a bundle request: /api/v2/events/:id/bundle/:type
          if (pathSegments.length >= 4 && pathSegments[2] === 'bundle') {
            const eventId = pathSegments[1];
            const bundleType = pathSegments[3];

            // Admin bundle requires auth
            if (bundleType === 'admin') {
              const authError = requireAdminAuth(request, env);
              if (authError) {
                response = authError;
              } else {
                response = await routeBundlesApi(request, env, eventId, bundleType);
              }
            } else {
              response = await routeBundlesApi(request, env, eventId, bundleType);
            }
          }
          // Route: /api/v2/events or /api/v2/events/:id
          else {
            const eventId = pathSegments[1] || null;

            // Create/Update/Delete require auth
            if (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE') {
              const authError = requireAdminAuth(request, env);
              if (authError) {
                response = authError;
              } else {
                response = await routeEventsApi(request, env, eventId);
              }
            } else {
              response = await routeEventsApi(request, env, eventId);
            }
          }
        }
        // Unknown v2 route
        else {
          response = new Response(JSON.stringify({
            ok: false,
            code: 'NOT_FOUND',
            message: `API v2 endpoint not found: ${v2Path}`
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Add CORS headers and return
        response = addWorkerCorsHeaders(response, request, env);
        return addTransparencyHeaders(response, startTime, env);

      } catch (error) {
        const corrId = generateCorrId();
        console.error(`[API_V2_ERROR] ${corrId}:`, error);

        ctx.waitUntil(logError(env, {
          corrId,
          type: 'api_v2_error',
          error: error.message,
          stack: error.stack?.slice(0, 500),
          url: url.pathname,
          duration: Date.now() - startTime
        }));

        const errorResponse = new Response(JSON.stringify({
          ok: false,
          code: 'INTERNAL',
          message: 'An internal error occurred',
          corrId
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });

        return addTransparencyHeaders(
          addWorkerCorsHeaders(errorResponse, request, env),
          startTime,
          env
        );
      }
    }

    // ==========================================================================
    // HEALTH CHECK ENDPOINTS - Story 5.2 / Story B2
    // ==========================================================================
    // GET /api/status - Lightweight health check for CI/CD pipelines
    // GET /api/health/backend - Backend auth health check (Story B2)
    //
    // Story 5.2: Always uses Worker-native (GAS removed)
    if (url.pathname === '/api/health/backend') {
      try {
        let response = await handleBackendHealthRequest(request, env);
        response = new Response(response.body, {
          status: response.status,
          headers: response.headers
        });
        response.headers.set('X-Backend', 'worker');
        return addTransparencyHeaders(addCORSHeaders(response), startTime, env);
      } catch (error) {
        const corrId = generateCorrId();
        ctx.waitUntil(logError(env, {
          corrId,
          type: 'backend_health_check_error',
          error: error.message,
          stack: error.stack?.slice(0, 500),
          url: url.pathname,
          duration: Date.now() - startTime
        }));
        const errorResponse = createBackendError500(
          'Backend health check failed unexpectedly',
          { corrId, backend: 'worker' }
        );
        return addTransparencyHeaders(addCORSHeaders(errorResponse), startTime, env);
      }
    }

    if (url.pathname === '/api/status') {
      try {
        // Worker-native implementation
        let response = await handleWorkerStatusRequest(request, env);

        // Add backend header for debugging
        response = new Response(response.body, {
          status: response.status,
          headers: response.headers
        });
        response.headers.set('X-Backend', 'worker');
        response.headers.set('X-Backend-Source', 'story-5.2-worker-native');

        return addTransparencyHeaders(addCORSHeaders(response), startTime, env);

      } catch (error) {
        const corrId = generateCorrId();
        ctx.waitUntil(logError(env, {
          corrId,
          type: 'health_check_error',
          error: error.message,
          stack: error.stack?.slice(0, 500),
          url: url.pathname,
          duration: Date.now() - startTime
        }));

        const errorResponse = createBackendError500(
          'Health check failed unexpectedly',
          { corrId, backend: 'worker' }
        );
        return addTransparencyHeaders(addCORSHeaders(errorResponse), startTime, env);
      }
    }

    // ==========================================================================
    // /api/* - Legacy GAS API endpoints (DEPRECATED - Story 5.2)
    // ==========================================================================
    // Story 5.2: Full DNS cutover - all API traffic uses Worker-native /api/v2/*
    // Legacy /api/* endpoints return 410 Gone with migration guidance.
    //
    // Migration path:
    // - POST /api/rpc -> Use /api/v2/* REST endpoints
    // - POST /api/events/* -> Use /api/v2/events
    //
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/v2/') && request.method === 'POST') {
      console.log(`[API_DEPRECATED] Legacy POST to ${url.pathname} - returning 410`);
      const response = new Response(JSON.stringify({
        ok: false,
        code: 'DEPRECATED',
        message: 'Legacy API endpoint is deprecated. Use /api/v2/* endpoints instead.',
        migration: {
          events: 'POST/PUT/DELETE /api/v2/events',
          bundles: 'GET /api/v2/events/:id/bundle/:type',
          status: 'GET /api/v2/status'
        },
        documentation: 'https://www.zeventbooks.io/docs/api'
      }), {
        status: 410,
        headers: {
          'Content-Type': 'application/json',
          'X-Deprecated': 'true',
          'X-Migration-Path': '/api/v2/*'
        }
      });
      return addTransparencyHeaders(addCORSHeaders(response), startTime, env);
    }

    // ==========================================================================
    // ROUTE VALIDATION - Reject unknown routes with 404
    // ==========================================================================
    const validation = validateRoute(url);

    if (!validation.valid) {
      const corrId = generateCorrId();

      // Story 5: Structured 404 logging - never silently proxy to GAS
      log404Response(url.pathname + url.search, validation.reason, env);

      // Log the invalid route attempt for error tracking
      ctx.waitUntil(logError(env, {
        corrId,
        type: 'invalid_route',
        reason: validation.reason,
        url: url.pathname + url.search,
        isApiRequest: validation.isApiRequest
      }));

      return create404Response(url, validation.isApiRequest, corrId);
    }

    // ==========================================================================
    // EXPLICIT ROUTE HANDLING - Story 2 Implementation
    // ==========================================================================
    // Story 5.2: Full DNS Cutover - All routes use Worker-native implementations
    // ==========================================================================
    // Routes are handled explicitly:
    // - API v2 requests: /api/v2/* → Worker-native (handled above)
    // - Legacy API: /api/* → DEPRECATED, returns 410 Gone
    // - HTML pages: /events, /admin, etc. → Worker templates
    // - Shortlinks: /r, /redirect → Worker-native Sheets API
    // - NO routes proxy to GAS anymore

    const isApiRequest = validation.isApiRequest;
    const routeParams = extractRouteParams(url);

    try {
      let response;

      // Story 5.2: Check for shortlink requests FIRST (before API check)
      // Shortlinks can come as /r?t=xxx or ?p=r&t=xxx
      if (isShortlinkRequest(url) || (routeParams.p && Object.hasOwn(GAS_PROXY_ROUTES, routeParams.p))) {
        // Worker-native shortlink resolution via Sheets API
        console.log(`[SHORTLINK] Worker-native resolution: ${url.pathname}${url.search}`);
        response = await handleWorkerShortlinkRedirect(request, url, env);
      } else if (isApiRequest && !url.pathname.startsWith('/api/v2/')) {
        // Story 5.2: Legacy /api/* endpoint - return deprecation notice
        // Use /api/v2/* instead
        console.log(`[API_DEPRECATED] Legacy API request: ${url.pathname}`);
        response = new Response(JSON.stringify({
          ok: false,
          code: 'DEPRECATED',
          message: 'Legacy API endpoint is deprecated. Use /api/v2/* endpoints instead.',
          migration: {
            events: '/api/v2/events',
            status: '/api/v2/status',
            bundles: '/api/v2/events/:id/bundle/:type'
          },
          documentation: 'https://www.zeventbooks.io/docs/api'
        }), {
          status: 410,
          headers: {
            'Content-Type': 'application/json',
            'X-Deprecated': 'true',
            'X-Migration-Path': '/api/v2/*'
          }
        });
      } else if (routeParams.page && Object.hasOwn(JSON_ROUTE_MAP, routeParams.page)) {
        // JSON page (status, ping, etc.): handled by Worker-native /api/v2/status
        // Redirect to new endpoint
        console.log(`[JSON_REDIRECT] Redirecting ${routeParams.page} to /api/v2/${routeParams.page}`);
        response = Response.redirect(`${url.origin}/api/v2/${routeParams.page}`, 301);
      } else if (routeParams.page && Object.hasOwn(HTML_ROUTE_MAP, routeParams.page)) {
        // HTML page: render from Worker template
        // Story 5: HTML routes are logged via logRouteResolution in handleHtmlPageRequest
        response = await handleHtmlPageRequest(url, routeParams, env);
      } else {
        // Default to public page (HTML)
        routeParams.page = 'public';
        // Story 5: Default routes also get structured logging
        response = await handleHtmlPageRequest(url, routeParams, env);
      }

      // Check for upstream 5xx errors and provide graceful degradation
      if (response.status >= 500) {
        const corrId = generateCorrId();

        // Log the upstream error
        ctx.waitUntil(logError(env, {
          corrId,
          type: 'upstream_5xx',
          status: response.status,
          statusText: response.statusText,
          url: url.pathname + url.search,
          isApiRequest,
          duration: Date.now() - startTime
        }));

        // Return graceful error response instead of raw 5xx
        return createGracefulErrorResponse(
          { status: response.status, message: `Upstream returned ${response.status}` },
          url,
          isApiRequest,
          corrId,
          env
        );
      }

      // Success path: add CORS headers for API requests and transparency headers
      if (isApiRequest) {
        response = addCORSHeaders(response);
      }
      return addTransparencyHeaders(response, startTime, env);

    } catch (error) {
      const corrId = generateCorrId();
      const isTimeout = error.name === 'AbortError';

      // Log the error with context
      ctx.waitUntil(logError(env, {
        corrId,
        type: isTimeout ? 'timeout' : 'proxy_error',
        error: error.message,
        stack: error.stack?.slice(0, 500),
        url: url.pathname + url.search,
        isApiRequest,
        duration: Date.now() - startTime
      }));

      // Return graceful degradation response
      return createGracefulErrorResponse(error, url, isApiRequest, corrId, env);
    }
  },
};

/**
 * @deprecated Story 2 - This function is NO LONGER USED for HTML routes.
 *
 * HTML routes are now served directly from Worker templates via handleHtmlPageRequest().
 * This function is kept for reference and potential emergency rollback only.
 *
 * MIGRATION (Story 2):
 * - HTML pages: handleHtmlPageRequest() - renders from Worker templates
 * - JSON pages: handleJsonPageRequest() - proxies to GAS for data
 * - Shortlinks: handleShortlinkRedirect() - proxies to GAS for redirect resolution
 * - API calls: proxyToAppsScript() - proxies to GAS (unchanged)
 *
 * The only paths that now touch GAS directly are:
 * - /api/* JSON RPC
 * - /status, /ping JSON endpoints
 * - ?p=r&t=... shortlink redirects
 *
 * See: HTML_ROUTE_MAP, JSON_ROUTE_MAP, GAS_PROXY_ROUTES
 *
 * ORIGINAL DOCUMENTATION:
 * Proxy HTML page request to Google Apps Script
 *
 * This function fetches HTML pages from Apps Script and returns them directly.
 * Unlike API requests, page requests don't get CORS headers (they're not cross-origin).
 * The HTML is returned as-is, keeping the user on zeventbooks.io.
 *
 * Supported page parameters:
 * - ?page=admin → Admin.html (event management)
 * - ?page=public → Public.html (public event listing)
 * - ?page=display → Display.html (TV/kiosk display)
 * - ?page=poster → Poster.html (printable poster)
 * - ?page=report → Report.html (analytics report)
 * - ?page=status → Status JSON (health check)
 *
 * Path-to-page mapping for friendly URLs:
 * - /events, /manage, /admin → page=admin
 * - /display, /tv, /kiosk → page=display
 * - /status, /health → page=status
 */
async function proxyPageRequest_DEPRECATED(request, appsScriptBase, url, env) {
  // Get path and strip known prefixes
  let path = url.pathname;
  const knownPrefixes = [
    '/events', '/manage', '/admin', '/display', '/tv', '/kiosk',
    '/screen', '/posters', '/poster', '/flyers', '/schedule',
    '/calendar', '/dashboard', '/create', '/analytics', '/reports',
    '/insights', '/stats', '/status', '/health', '/ping', '/docs'
  ];

  for (const prefix of knownPrefixes) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      path = path.slice(prefix.length);
      break;
    }
  }
  if (path.startsWith('/')) {
    path = path.slice(1);
  }

  // Build query params, adding page= if not present
  const params = new URLSearchParams(url.search);
  if (!params.has('page')) {
    // Use canonical path-to-page mapping (defined at top of file)
    const firstSegment = url.pathname.split('/').filter(Boolean)[0] || 'events';
    const mappedPage = CANONICAL_PATH_TO_PAGE[firstSegment];
    if (mappedPage && mappedPage !== 'api') {
      params.set('page', mappedPage);
    }
  }

  // Build target URL
  const queryString = params.toString() ? `?${params.toString()}` : '';
  const targetUrl = path
    ? `${appsScriptBase}/${path}${queryString}`
    : `${appsScriptBase}${queryString}`;

  console.log(`[ZEventBooks] Proxying page to: ${targetUrl}`);

  // Create AbortController for timeout handling
  const controller = new AbortController();
  const timeoutMs = env.UPSTREAM_TIMEOUT_MS ? parseInt(env.UPSTREAM_TIMEOUT_MS) : UPSTREAM_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Fetch from Apps Script (follow redirects) with timeout
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: buildHeaders(request),
      redirect: 'follow',
      signal: controller.signal
    });

    console.log(`[ZEventBooks] Page response: ${response.status} ${response.statusText}`);

    // Return response with cache headers for HTML pages
    const newResponse = new Response(response.body, response);
    if (!newResponse.headers.has('Cache-Control')) {
      newResponse.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    return newResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Proxy API request to Google Apps Script
 *
 * This function forwards the request to Apps Script, supporting both:
 * 1. Path-based routing (friendly URLs): /events/manage → exec/manage
 * 2. Query-param routing: ?page=admin → exec?page=admin
 *
 * Path handling:
 * - Strips '/events' prefix if present (for env.events deployment)
 * - Preserves remaining path for Apps Script's e.pathInfo
 * - Preserves query string
 *
 * Examples (env.events - /events* route):
 *   /events → exec (pathInfo: [])
 *   /events/manage → exec/manage (pathInfo: ['manage'])
 *   /events/abc/events → exec/abc/events (pathInfo: ['abc', 'events'])
 *   /events?page=admin → exec?page=admin (pathInfo: [], params: {page:'admin'})
 *
 * Examples (env.production - /* route):
 *   /manage → exec/manage (pathInfo: ['manage'])
 *   /abc/events → exec/abc/events (pathInfo: ['abc', 'events'])
 */
async function proxyToAppsScript(request, appsScriptBase, env) {
  const url = new URL(request.url);

  // Get path and strip '/events' prefix if present (for env.events route)
  let path = url.pathname;
  if (path.startsWith('/events')) {
    path = path.slice('/events'.length); // Remove '/events' prefix
  }
  // Ensure path doesn't start with double slash
  if (path.startsWith('/')) {
    path = path.slice(1);
  }

  // Build target URL: base + path + query
  // Apps Script receives path via e.pathInfo array
  const targetUrl = path
    ? `${appsScriptBase}/${path}${url.search}`
    : `${appsScriptBase}${url.search}`;

  console.log(`[ZEventBooks] Proxying to: ${targetUrl}`);

  // Create AbortController for timeout handling
  const controller = new AbortController();
  const timeoutMs = env.UPSTREAM_TIMEOUT_MS ? parseInt(env.UPSTREAM_TIMEOUT_MS) : UPSTREAM_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Build fetch options
    const fetchOptions = {
      method: request.method,
      headers: buildHeaders(request),
      redirect: 'follow',
      signal: controller.signal
    };

    // Add body for POST/PUT requests
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = await request.text();
    }

    // Make request to Apps Script
    const response = await fetch(targetUrl, fetchOptions);

    console.log(`[ZEventBooks] Response: ${response.status} ${response.statusText}`);

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Handle API request from frontend (unified handler)
 *
 * Supports two patterns:
 * 1. Legacy RPC: POST /api/rpc with { method: 'api_list', payload: {...} }
 * 2. Path-based: POST /api/<path> with {...payload}
 *
 * @param {Request} request - The incoming request
 * @param {string} appsScriptBase - GAS exec URL
 * @param {object} env - Worker environment
 * @param {URL} url - Parsed request URL
 * @returns {Response} JSON response from GAS
 */
async function handleApiRequest(request, appsScriptBase, env, url) {
  const pathname = url.pathname;
  const origin = url.origin;

  // Check if this is the legacy /api/rpc endpoint
  if (pathname === '/api/rpc') {
    return handleRpcRequest(request, appsScriptBase, env, origin);
  }

  // Path-based routing: /api/<path> -> action=<path>
  // Examples:
  //   /api/events/list -> action=list
  //   /api/getPublicBundle -> action=getPublicBundle
  //   /api/status -> action=status

  // Parse the path after /api/
  const apiPath = pathname.slice('/api/'.length);

  if (!apiPath) {
    return new Response(JSON.stringify({
      ok: false,
      code: 'BAD_INPUT',
      message: 'Missing API path'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Parse request body as payload
  let payload = {};
  try {
    const bodyText = await request.text();
    if (bodyText) {
      payload = JSON.parse(bodyText);
    }
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      code: 'BAD_INPUT',
      message: 'Invalid JSON in request body'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Convert path to action
  // 'events/list' -> 'list' (last segment)
  // 'getPublicBundle' -> 'getPublicBundle' (single segment)
  const pathSegments = apiPath.split('/').filter(Boolean);
  const action = pathSegments[pathSegments.length - 1] || apiPath;

  // Build the GAS request body
  const gasBody = {
    action,
    ...payload
  };

  // Add request ID header if present
  const requestId = request.headers.get('X-Request-Id');

  console.log(`[ZEventBooks] API: ${pathname} -> action=${action}${requestId ? ` (${requestId})` : ''}`);

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutMs = env.UPSTREAM_TIMEOUT_MS ? parseInt(env.UPSTREAM_TIMEOUT_MS) : UPSTREAM_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Track request start time for duration headers
  const fetchStartTime = Date.now();

  try {
    // Forward to GAS doPost
    const response = await fetch(appsScriptBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': origin || 'https://zeventbooks.io',
        'User-Agent': request.headers.get('user-agent') || 'ZEventBooks-Worker',
        ...(requestId ? { 'X-Request-Id': requestId } : {})
      },
      body: JSON.stringify(gasBody),
      redirect: 'follow',
      signal: controller.signal
    });

    console.log(`[ZEventBooks] API response: ${response.status}`);

    const responseText = await response.text();

    // Story 3: Use defensive response processing
    // Validates JSON, adds transparency headers, returns structured errors for non-JSON
    return processUpstreamResponse(response, responseText, {
      startTime: fetchStartTime,
      action,
      env
    });
  } catch (error) {
    // Story 3: Handle fetch errors (timeout, network) with structured responses
    return handleUpstreamFetchError(error, action, fetchStartTime, env);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Handle RPC request from frontend (legacy endpoint)
 *
 * This replaces google.script.run for API calls, enabling friendly URLs.
 * The frontend sends: { method: 'api_list', payload: { brandId: 'root', ... } }
 * We forward to GAS doPost as: { action: 'list', brandId: 'root', ... }
 *
 * @param {Request} request - The incoming request
 * @param {string} appsScriptBase - GAS exec URL
 * @param {object} env - Worker environment
 * @param {string} origin - Request origin for CORS
 * @returns {Response} JSON response from GAS
 */
async function handleRpcRequest(request, appsScriptBase, env, origin) {
  // Parse the RPC request body
  const rpcBody = await request.json();
  const { method, payload = {} } = rpcBody;

  if (!method) {
    return new Response(JSON.stringify({
      ok: false,
      code: 'BAD_INPUT',
      message: 'Missing method in RPC request'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Convert method name to action (strip api_ prefix for REST compatibility)
  // api_list -> list, api_getPublicBundle -> getPublicBundle
  const action = method.startsWith('api_') ? method.slice(4) : method;

  // Build the GAS request body
  const gasBody = {
    action,
    ...payload
  };

  console.log(`[ZEventBooks] RPC: ${method} -> action=${action}`);

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutMs = env.UPSTREAM_TIMEOUT_MS ? parseInt(env.UPSTREAM_TIMEOUT_MS) : UPSTREAM_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Track request start time for duration headers
  const fetchStartTime = Date.now();

  try {
    // Forward to GAS doPost
    const response = await fetch(appsScriptBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        // Pass through origin for CORS validation in GAS
        'Origin': origin || 'https://zeventbooks.io',
        // Forward user-agent for analytics
        'User-Agent': request.headers.get('user-agent') || 'ZEventBooks-Worker'
      },
      body: JSON.stringify(gasBody),
      redirect: 'follow',
      signal: controller.signal
    });

    console.log(`[ZEventBooks] RPC response: ${response.status}`);

    // Story 3: Use defensive response processing
    // Validates JSON, adds transparency headers, returns structured errors for non-JSON
    const responseText = await response.text();

    return processUpstreamResponse(response, responseText, {
      startTime: fetchStartTime,
      action,
      env
    });
  } catch (error) {
    // Story 3: Handle fetch errors (timeout, network) with structured responses
    return handleUpstreamFetchError(error, action, fetchStartTime, env);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Build headers for Apps Script request
 */
function buildHeaders(request) {
  const headers = new Headers();

  // Forward relevant headers
  const forwardHeaders = [
    'content-type',
    'accept',
    'accept-language',
    'user-agent',
  ];

  forwardHeaders.forEach(header => {
    const value = request.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  });

  // Set default content-type for POST
  if (request.method === 'POST' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return headers;
}

/**
 * Handle CORS preflight requests
 */
function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Add CORS headers to response
 */
function addCORSHeaders(response) {
  const newResponse = new Response(response.body, response);

  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Add cache control for API responses
  if (!newResponse.headers.has('Cache-Control')) {
    newResponse.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }

  return newResponse;
}

/**
 * Add transparency headers to response
 * These headers help with debugging and monitoring without modifying response body
 * Story 2: Added build version header for deployment tracking
 */
function addTransparencyHeaders(response, startTime, env) {
  const newResponse = new Response(response.body, response);

  // Transparency headers for debugging
  newResponse.headers.set('X-Proxied-By', 'zeventbooks-worker');
  newResponse.headers.set('X-Worker-Version', WORKER_VERSION);

  // Story 2: Build version from env for deployment tracking
  if (env?.WORKER_BUILD_VERSION) {
    newResponse.headers.set('X-Worker-Build-Version', env.WORKER_BUILD_VERSION);
  }

  // Environment identifier
  if (env?.WORKER_ENV) {
    newResponse.headers.set('X-Worker-Env', env.WORKER_ENV);
  }

  // Timing header (if start time provided)
  if (startTime) {
    const duration = Date.now() - startTime;
    newResponse.headers.set('X-Proxy-Duration-Ms', duration.toString());
  }

  return newResponse;
}

// Note: errorResponse replaced by createGracefulErrorResponse for better UX
