/**
 * Status API Handler
 *
 * Worker-native health check endpoint that verifies:
 * - Worker is running
 * - Google Sheets API is accessible (if configured)
 *
 * GET /api/status
 *
 * @module handlers/status
 * @see Story 1.3 - Port api_status + Simple Read-Only api_listEvents
 */

import { healthCheck, isConfigured, type SheetsEnv } from '../sheetsClient';

// =============================================================================
// Constants
// =============================================================================

const WORKER_VERSION = '1.3.0';

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for status handler
 */
export interface StatusEnv extends Partial<SheetsEnv> {
  WORKER_ENV?: string;
  WORKER_BUILD_VERSION?: string;
}

/**
 * Status response shape per Story 1.3 acceptance criteria
 */
export interface StatusResponse {
  ok: boolean;
  status: number;
  version: string;
  backend: 'worker';
  sheets: 'ok' | 'error' | 'not_configured';
  timestamp?: string;
  buildVersion?: string;
  sheetsLatencyMs?: number;
  sheetsError?: string;
}

/**
 * Error response shape
 */
export interface StatusErrorResponse {
  ok: false;
  status: number;
  backend: 'worker';
  sheets: 'error';
  error: string;
  timestamp: string;
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle GET /api/status
 *
 * Returns health check information for the Worker and connected services.
 *
 * Response format per Story 1.3 AC:
 * - Success: { ok: true, status: 200, version: "...", backend: "worker", sheets: "ok" }
 * - Sheets down: { ok: false, status: 503, ... }
 *
 * @param env - Worker environment
 * @returns Response with status information
 */
export async function handleStatus(env: StatusEnv): Promise<Response> {
  const timestamp = new Date().toISOString();

  // Check Sheets connectivity
  let sheetsStatus: 'ok' | 'error' | 'not_configured' = 'not_configured';
  let sheetsLatencyMs: number | undefined;
  let sheetsError: string | undefined;

  if (isConfigured(env as SheetsEnv)) {
    const sheetsHealth = await healthCheck(env as SheetsEnv);

    if (sheetsHealth.connected) {
      sheetsStatus = 'ok';
      sheetsLatencyMs = sheetsHealth.latencyMs;
    } else {
      sheetsStatus = 'error';
      sheetsError = sheetsHealth.error;
      sheetsLatencyMs = sheetsHealth.latencyMs;
    }
  }

  // Determine overall health
  // Sheets must be connected if configured, otherwise fail
  const isHealthy = sheetsStatus !== 'error';
  const httpStatus = isHealthy ? 200 : 503;

  const responseBody: StatusResponse = {
    ok: isHealthy,
    status: httpStatus,
    version: WORKER_VERSION,
    backend: 'worker',
    sheets: sheetsStatus,
    timestamp,
    buildVersion: env.WORKER_BUILD_VERSION || 'unknown',
  };

  // Include latency if we checked sheets
  if (sheetsLatencyMs !== undefined) {
    responseBody.sheetsLatencyMs = sheetsLatencyMs;
  }

  // Include error message if sheets failed
  if (sheetsError) {
    responseBody.sheetsError = sheetsError;
  }

  return new Response(JSON.stringify(responseBody), {
    status: httpStatus,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Worker-Version': WORKER_VERSION,
    },
  });
}

/**
 * Create a status response for when Sheets is down
 *
 * @param error - Error message
 * @param env - Worker environment
 * @returns 503 response
 */
export function createSheetsDownResponse(
  error: string,
  env: StatusEnv
): Response {
  const responseBody: StatusErrorResponse = {
    ok: false,
    status: 503,
    backend: 'worker',
    sheets: 'error',
    error,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(responseBody), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Worker-Version': WORKER_VERSION,
    },
  });
}
