/**
 * Backend Origin Resolver
 *
 * Centralizes upstream configuration validation for the Worker.
 * Ensures the Worker never runs with incomplete or missing backend configuration.
 *
 * Story 2.3: Worker Upstream Config via Single Env Var
 * Story 3.1: Worker /health/origin Endpoint
 *
 * The Worker uses Google Sheets API as its backend. This module validates
 * that all required environment variables are properly configured.
 *
 * Required configuration:
 * - SHEETS_SPREADSHEET_ID: Google Sheets spreadsheet ID
 * - GOOGLE_CLIENT_EMAIL: Service account email
 * - GOOGLE_PRIVATE_KEY: Service account private key (PEM format)
 * - UPSTREAM_WEBAPP_URL: URL to probe for upstream health (Story 3.1)
 *
 * @module resolveBackendOrigin
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for backend access
 */
export interface BackendEnv {
  /** Google Sheets spreadsheet ID */
  SHEETS_SPREADSHEET_ID?: string;
  /** Google service account email */
  GOOGLE_CLIENT_EMAIL?: string;
  /** Google service account private key (PEM format) */
  GOOGLE_PRIVATE_KEY?: string;
  /** Worker environment (development, staging, production) */
  WORKER_ENV?: string;
  /** Worker name identifier (Story 3.1) */
  WORKER_NAME?: string;
  /** Upstream webapp URL for health checks (Story 3.1) */
  UPSTREAM_WEBAPP_URL?: string;
}

/**
 * Result of backend origin resolution
 */
export interface BackendOriginResult {
  /** Whether the backend is properly configured */
  configured: boolean;
  /** The backend type (always 'sheets' for now) */
  backend: 'sheets';
  /** Error message if not configured */
  error?: string;
  /** Detailed list of missing configuration items */
  missing?: string[];
  /** Environment identifier */
  environment: string;
}

/**
 * Error response for missing configuration
 */
export interface UpstreamConfigError {
  ok: false;
  status: 500;
  code: 'UPSTREAM_NOT_CONFIGURED';
  message: string;
  missing: string[];
  environment: string;
  timestamp: string;
}

// =============================================================================
// Configuration Constants
// =============================================================================

/**
 * Names of required environment variables
 */
const REQUIRED_ENV_VARS = [
  'SHEETS_SPREADSHEET_ID',
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
] as const;

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Resolve and validate backend origin configuration
 *
 * This is the single source of truth for backend configuration validation.
 * Call this function early in request handling to ensure the Worker
 * doesn't attempt operations with incomplete configuration.
 *
 * @param env - Worker environment bindings
 * @returns BackendOriginResult with configuration status
 *
 * @example
 * const result = resolveBackendOrigin(env);
 * if (!result.configured) {
 *   return createUpstreamNotConfiguredResponse(result);
 * }
 */
export function resolveBackendOrigin(env: BackendEnv): BackendOriginResult {
  const environment = env.WORKER_ENV || 'unknown';
  const missing: string[] = [];

  // Check each required environment variable
  if (!env.SHEETS_SPREADSHEET_ID) {
    missing.push('SHEETS_SPREADSHEET_ID');
  }

  if (!env.GOOGLE_CLIENT_EMAIL) {
    missing.push('GOOGLE_CLIENT_EMAIL');
  }

  if (!env.GOOGLE_PRIVATE_KEY) {
    missing.push('GOOGLE_PRIVATE_KEY');
  }

  if (missing.length > 0) {
    return {
      configured: false,
      backend: 'sheets',
      error: `Backend not configured. Missing: ${missing.join(', ')}`,
      missing,
      environment,
    };
  }

  return {
    configured: true,
    backend: 'sheets',
    environment,
  };
}

/**
 * Check if backend origin is configured (quick check)
 *
 * Lightweight check that returns a boolean. Use this for
 * quick checks where you don't need detailed error information.
 *
 * @param env - Worker environment bindings
 * @returns true if configured, false otherwise
 */
export function isBackendConfigured(env: BackendEnv): boolean {
  return !!(
    env.SHEETS_SPREADSHEET_ID &&
    env.GOOGLE_CLIENT_EMAIL &&
    env.GOOGLE_PRIVATE_KEY
  );
}

/**
 * Create a 500 response for missing upstream configuration
 *
 * Per Story 2.3 AC: If UPSTREAM configuration is missing,
 * respond with a clear 500 + message instead of timing out or 410.
 *
 * @param result - BackendOriginResult from resolveBackendOrigin
 * @returns 500 Response with configuration error details
 */
export function createUpstreamNotConfiguredResponse(
  result: BackendOriginResult
): Response {
  const body: UpstreamConfigError = {
    ok: false,
    status: 500,
    code: 'UPSTREAM_NOT_CONFIGURED',
    message: result.error || 'Backend not configured',
    missing: result.missing || [],
    environment: result.environment,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Error-Code': 'UPSTREAM_NOT_CONFIGURED',
    },
  });
}

/**
 * Log upstream configuration error
 *
 * Logs structured error information for monitoring and debugging.
 *
 * @param result - BackendOriginResult from resolveBackendOrigin
 * @param context - Additional context information
 */
export function logUpstreamConfigError(
  result: BackendOriginResult,
  context?: Record<string, unknown>
): void {
  console.error(
    JSON.stringify({
      type: 'UPSTREAM_CONFIG_ERROR',
      message: result.error,
      missing: result.missing,
      environment: result.environment,
      timestamp: new Date().toISOString(),
      ...context,
    })
  );
}

// =============================================================================
// Upstream Health Check (Story 3.1)
// =============================================================================

/**
 * Result of upstream health check
 * @see Story 3.1 - Worker /health/origin Endpoint
 */
export interface UpstreamHealthResult {
  /** Whether the upstream is reachable and healthy */
  reachable: boolean;
  /** HTTP status code from upstream (or error code like 500) */
  status: number;
  /** Latency in milliseconds */
  latencyMs?: number;
  /** Error message if unreachable */
  error?: string;
}

/**
 * Check upstream health by probing UPSTREAM_WEBAPP_URL
 *
 * This is a lightweight probe that makes a simple GET request to the
 * upstream webapp URL. It's designed for CI/CD gates and monitoring.
 *
 * Behavior:
 * - If UPSTREAM_WEBAPP_URL is not set, returns reachable=false, status=500
 * - If upstream responds with 2xx, returns reachable=true, status=<upstream status>
 * - If upstream responds with 410, returns reachable=false, status=410
 * - If upstream responds with other errors, returns reachable=false, status=<upstream status>
 * - If fetch fails (network error), returns reachable=false, status=503
 *
 * @param env - Worker environment with UPSTREAM_WEBAPP_URL
 * @returns UpstreamHealthResult with reachability status
 *
 * @example
 * const health = await checkUpstreamHealth(env);
 * if (!health.reachable) {
 *   console.log(`Upstream unreachable: ${health.error}`);
 * }
 */
export async function checkUpstreamHealth(
  env: BackendEnv
): Promise<UpstreamHealthResult> {
  const upstreamUrl = env.UPSTREAM_WEBAPP_URL;

  // If UPSTREAM_WEBAPP_URL is not set, return error
  if (!upstreamUrl) {
    return {
      reachable: false,
      status: 500,
      error: 'UPSTREAM_WEBAPP_URL is not configured',
    };
  }

  const startTime = Date.now();

  try {
    // Make a simple GET request with a timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(upstreamUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'EventAngle-Worker-HealthCheck/1.0',
      },
    });

    clearTimeout(timeoutId);

    const latencyMs = Date.now() - startTime;
    const status = response.status;

    // 2xx is considered healthy
    if (status >= 200 && status < 300) {
      return {
        reachable: true,
        status,
        latencyMs,
      };
    }

    // 410 Gone is a special case - upstream explicitly says it's gone
    if (status === 410) {
      return {
        reachable: false,
        status: 410,
        latencyMs,
        error: 'Upstream returned 410 Gone',
      };
    }

    // Other non-2xx responses
    return {
      reachable: false,
      status,
      latencyMs,
      error: `Upstream returned ${status}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    // Handle abort/timeout
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        reachable: false,
        status: 503,
        latencyMs,
        error: 'Upstream request timed out',
      };
    }

    // Network or other fetch errors
    return {
      reachable: false,
      status: 503,
      latencyMs,
      error: error instanceof Error ? error.message : 'Unknown fetch error',
    };
  }
}
