/**
 * Health Origin Handler
 *
 * Endpoint to verify upstream configuration and reachability.
 * Always returns HTTP 200 - reports upstream status in JSON body.
 *
 * GET /health/origin
 *
 * @module handlers/healthOrigin
 * @see Story 2.3 - Worker Upstream Config via Single Env Var
 * @see Story 3.1 - Worker /health/origin Endpoint
 */

import {
  checkUpstreamHealth,
  type BackendEnv,
  type UpstreamHealthResult,
} from '../resolveBackendOrigin';

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for health/origin handler
 */
export interface HealthOriginEnv extends BackendEnv {
  WORKER_ENV?: string;
  WORKER_NAME?: string;
  WORKER_BUILD_VERSION?: string;
  UPSTREAM_WEBAPP_URL?: string;
}

/**
 * Response for /health/origin endpoint
 * @see Story 3.1 Acceptance Criteria
 */
export interface HealthOriginResponse {
  /** Overall health status (true if upstream is reachable and healthy) */
  ok: boolean;
  /** Environment name (staging, production, etc.) */
  env: string;
  /** Worker name identifier */
  worker: string;
  /** Upstream URL being probed (null if not configured) */
  upstream: string | null;
  /** Whether the upstream responded successfully */
  upstreamReachable: boolean;
  /** HTTP status from upstream (500 if not configured, 503 if network error) */
  status: number;
  /** Latency in milliseconds (if upstream was probed) */
  latencyMs?: number;
  /** Error message (if any) */
  error?: string;
  /** Timestamp of health check */
  timestamp?: string;
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle GET /health/origin
 *
 * Validates that the upstream webapp is properly configured and reachable.
 * This endpoint is designed for CI/CD pipelines and monitoring.
 *
 * IMPORTANT: This endpoint ALWAYS returns HTTP 200.
 * The actual health status is reported in the JSON body.
 * This ensures the health check itself doesn't look like a Worker outage.
 *
 * Response body:
 * - ok: true if upstream is reachable and returned 2xx
 * - ok: false if upstream is not configured, returned error, or is unreachable
 *
 * @param env - Worker environment
 * @returns Response with upstream health status (always HTTP 200)
 */
export async function handleHealthOrigin(
  env: HealthOriginEnv
): Promise<Response> {
  const timestamp = new Date().toISOString();
  const workerEnv = env.WORKER_ENV || 'unknown';
  const workerName = env.WORKER_NAME || 'eventangle-worker';
  const upstreamUrl = env.UPSTREAM_WEBAPP_URL || null;

  // Perform upstream health check
  const healthResult: UpstreamHealthResult = await checkUpstreamHealth(env);

  // Build response body per Story 3.1 AC
  const responseBody: HealthOriginResponse = {
    ok: healthResult.reachable,
    env: workerEnv,
    worker: workerName,
    upstream: upstreamUrl,
    upstreamReachable: healthResult.reachable,
    status: healthResult.status,
    timestamp,
  };

  // Include latency if available
  if (healthResult.latencyMs !== undefined) {
    responseBody.latencyMs = healthResult.latencyMs;
  }

  // Include error message if present
  if (healthResult.error) {
    responseBody.error = healthResult.error;
  }

  // ALWAYS return HTTP 200 per Story 3.1 AC
  // The health status is reported in the JSON body, not the HTTP status
  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
