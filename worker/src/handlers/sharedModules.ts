/**
 * Shared Modules Handler
 *
 * Serves shared JavaScript modules from the Worker.
 * These modules are imported at build time and served with proper caching.
 *
 * @module handlers/sharedModules
 * @see Story 4.2 - Shared API Client Module
 */

// Import modules at build time (via wrangler text rules)
import apiClientModule from '../../../web/shared/apiClient.js';
import assetStateModule from '../../../web/shared/assetState.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported module names
 * Story E1: Added assetState module
 */
export type ModuleName = 'apiClient' | 'assetState';

/**
 * Environment bindings for shared modules handler
 */
export interface SharedModulesEnv {
  /** Worker environment (staging, production) */
  WORKER_ENV?: string;
}

// =============================================================================
// Module Registry
// =============================================================================

/**
 * Map of module names to their content
 * Story E1: Added assetState module
 */
const MODULES: Record<ModuleName, string> = {
  apiClient: apiClientModule,
  assetState: assetStateModule,
};

/**
 * Content types for modules
 */
const CONTENT_TYPES: Record<ModuleName, string> = {
  apiClient: 'application/javascript; charset=utf-8',
  assetState: 'application/javascript; charset=utf-8',
};

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle shared module request
 *
 * Serves JavaScript modules with proper caching headers.
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param moduleName - Name of the module to serve
 * @returns Response with module content
 *
 * @example
 * // Serve the API client module
 * const response = await handleSharedModule(request, env, 'apiClient');
 */
export async function handleSharedModule(
  request: Request,
  env: SharedModulesEnv,
  moduleName: ModuleName
): Promise<Response> {
  // Get module content
  const content = MODULES[moduleName];
  if (!content) {
    return new Response('Module not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Get content type
  const contentType = CONTENT_TYPES[moduleName] || 'application/javascript; charset=utf-8';

  // Determine cache headers based on environment
  const isProduction = env.WORKER_ENV === 'production';
  const cacheControl = isProduction
    ? 'public, max-age=3600, stale-while-revalidate=86400' // 1 hour cache in prod
    : 'no-cache, no-store, must-revalidate'; // No cache in dev/staging

  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      // Story 4.2: Indicate this is the shared API client
      'X-Module-Name': moduleName,
      'X-Served-By': 'cloudflare-worker',
    },
  });
}

/**
 * Check if a module exists
 */
export function hasModule(moduleName: ModuleName): boolean {
  return moduleName in MODULES;
}

/**
 * Get list of available modules
 */
export function getAvailableModules(): ModuleName[] {
  return Object.keys(MODULES) as ModuleName[];
}
