/**
 * Static Asset Handler
 *
 * Serves HTML surfaces directly from the Worker without GAS dependencies.
 * Templates are embedded at build time and served with proper caching headers.
 *
 * @module handlers/staticAssets
 * @see Story 4.1 - Move HTML Surfaces to Cloudflare
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Page types that can be served
 */
export type PageType = 'public' | 'admin' | 'display' | 'poster' | 'report' | 'sponsor' | 'landing';

/**
 * Template variables for runtime substitution
 */
export interface TemplateVariables {
  /** Page title (e.g., "EventAngle · events") */
  appTitle: string;
  /** Brand identifier from URL */
  brandId: string;
  /** Scope (default: 'events') */
  scope: string;
  /** API base URL for frontend calls */
  apiBase: string;
  /** Demo mode flag */
  demoMode?: boolean;
}

/**
 * Environment bindings for static asset handler
 */
export interface StaticAssetEnv {
  /** Worker environment (staging, production) */
  WORKER_ENV?: string;
}

// =============================================================================
// Embedded Templates
// =============================================================================

/**
 * Template content is imported at build time.
 * These are the bundled templates from cloudflare-proxy/templates/
 *
 * Note: Templates use <?= variable ?> syntax for runtime substitution.
 * We convert these to actual values when serving.
 */

// Template imports (embedded as text at build time via wrangler rules)
import adminTemplate from '../../templates/admin.html';
import publicTemplate from '../../templates/public.html';
import displayTemplate from '../../templates/display.html';
import posterTemplate from '../../templates/poster.html';
import reportTemplate from '../../templates/report.html';
import sponsorTemplate from '../../templates/sponsor.html';
import landingTemplate from '../../templates/landing.html';

/**
 * Template map for quick lookup
 */
const TEMPLATES: Record<PageType, string> = {
  admin: adminTemplate,
  public: publicTemplate,
  display: displayTemplate,
  poster: posterTemplate,
  report: reportTemplate,
  sponsor: sponsorTemplate,
  landing: landingTemplate,
};

// =============================================================================
// Template Processing
// =============================================================================

/**
 * Get default API base URL based on environment
 */
function getApiBase(env: StaticAssetEnv, request: Request): string {
  const url = new URL(request.url);

  // Use same origin for API calls (Worker handles /api/* routes)
  return `${url.protocol}//${url.host}/api`;
}

/**
 * Substitute template variables
 *
 * Replaces <?= variable ?> with actual values
 */
function substituteVariables(template: string, variables: TemplateVariables): string {
  return template
    .replace(/<\?=\s*appTitle\s*\?>/g, escapeHtml(variables.appTitle))
    .replace(/<\?=\s*brandId\s*\?>/g, escapeHtml(variables.brandId))
    .replace(/<\?=\s*scope\s*\?>/g, escapeHtml(variables.scope))
    .replace(/<\?=\s*execUrl\s*\?>/g, escapeHtml(variables.apiBase))
    .replace(/<\?=\s*demoMode\s*\?>/g, variables.demoMode ? 'true' : 'false');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] || char);
}

/**
 * Extract brand and scope from URL
 */
function extractBrandAndScope(url: URL): { brandId: string; scope: string } {
  const segments = url.pathname.split('/').filter(Boolean);

  // Check for brand prefix (abc, cbc, cbl)
  const validBrands = ['abc', 'cbc', 'cbl'];
  let brandId = 'root';
  let scope = 'events';

  if (segments.length > 0 && validBrands.includes(segments[0])) {
    brandId = segments[0];
  }

  // Check for scope in query params
  const scopeParam = url.searchParams.get('scope');
  if (scopeParam) {
    scope = scopeParam;
  }

  return { brandId, scope };
}

/**
 * Generate page title based on brand and page type
 */
function generateTitle(brandId: string, scope: string, pageType: PageType): string {
  const pageTitles: Record<PageType, string> = {
    public: 'Events',
    admin: 'Event Manager',
    display: 'TV Display',
    poster: 'Poster Generator',
    report: 'Event Report',
    sponsor: 'Sponsor Dashboard',
    landing: 'Home',
  };

  const brandNames: Record<string, string> = {
    root: 'EventAngle',
    abc: 'ABC Events',
    cbc: 'CBC Events',
    cbl: 'CBL Events',
  };

  const brandName = brandNames[brandId] || 'EventAngle';
  const pageTitle = pageTitles[pageType];

  return `${brandName} · ${pageTitle}`;
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle static asset request
 *
 * Serves HTML templates with runtime variable substitution.
 * All templates are served from the Worker - no GAS fetch required.
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param pageType - Type of page to serve
 * @returns Response with HTML content
 *
 * @example
 * // Serve admin page
 * const response = await handleStaticAsset(request, env, 'admin');
 */
export async function handleStaticAsset(
  request: Request,
  env: StaticAssetEnv,
  pageType: PageType
): Promise<Response> {
  // Get template
  const template = TEMPLATES[pageType];
  if (!template) {
    return new Response('Template not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Extract variables from request
  const url = new URL(request.url);
  const { brandId, scope } = extractBrandAndScope(url);

  // Build variables
  const variables: TemplateVariables = {
    appTitle: generateTitle(brandId, scope, pageType),
    brandId,
    scope,
    apiBase: getApiBase(env, request),
    demoMode: url.searchParams.has('demo'),
  };

  // Substitute variables
  const html = substituteVariables(template, variables);

  // Determine cache headers based on environment
  const isProduction = env.WORKER_ENV === 'production';
  const cacheControl = isProduction
    ? 'public, max-age=300, stale-while-revalidate=600' // 5 min cache in prod
    : 'no-cache, no-store, must-revalidate'; // No cache in dev/staging

  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Page-Type': pageType,
    'X-Brand': brandId,
    // Story 4.1: Indicate this is served from Worker, not GAS
    'X-Served-By': 'cloudflare-worker',
  };

  // Add CSP header for landing page
  if (pageType === 'landing') {
    headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'";
  }

  return new Response(html, { status: 200, headers });
}

/**
 * Check if a template exists
 */
export function hasTemplate(pageType: PageType): boolean {
  return pageType in TEMPLATES;
}

/**
 * Get list of available page types
 */
export function getAvailablePageTypes(): PageType[] {
  return Object.keys(TEMPLATES) as PageType[];
}
