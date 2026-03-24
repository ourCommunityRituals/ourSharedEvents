/**
 * Status API Handler
 *
 * Worker-native health check endpoint that verifies:
 * - Worker is running
 * - Google Sheets API is accessible (if configured)
 *
 * GET /api/status
 */

import { healthCheck, isConfigured } from '../sheets/client.js';

const WORKER_VERSION = '3.0.0';

/**
 * Get environment identifier
 * @param {Object} env - Worker environment
 * @returns {string}
 */
function getEnvId(env) {
  if (env.WORKER_ENV) {
    const workerEnv = env.WORKER_ENV.toLowerCase();
    if (workerEnv === 'staging' || workerEnv === 'stg') return 'staging';
    if (workerEnv === 'production' || workerEnv === 'prod') return 'production';
  }
  return env.ENABLE_DEBUG_ENDPOINTS === 'true' ? 'staging' : 'production';
}

/**
 * Handle GET /api/status
 *
 * Returns health check information for the Worker and connected services.
 *
 * @param {Request} request - Incoming request
 * @param {Object} env - Worker environment
 * @returns {Promise<Response>}
 */
export async function handleStatusRequest(request, env) {
  const startTime = Date.now();

  // Worker info
  const workerStatus = {
    version: WORKER_VERSION,
    env: getEnvId(env),
    timestamp: new Date().toISOString(),
    buildVersion: env.WORKER_BUILD_VERSION || 'unknown'
  };

  // Sheets health check
  let sheetsStatus = {
    configured: false,
    connected: false,
    latencyMs: 0
  };

  if (isConfigured(env)) {
    sheetsStatus.configured = true;
    const sheetsHealth = await healthCheck(env);
    sheetsStatus.connected = sheetsHealth.connected;
    sheetsStatus.latencyMs = sheetsHealth.latencyMs;

    if (sheetsHealth.error) {
      sheetsStatus.error = sheetsHealth.error;
    }
  }

  // Overall health determination
  // Worker is healthy if running; Sheets connection is optional during migration
  const isHealthy = true; // Worker running = healthy
  const isSheetsHealthy = !sheetsStatus.configured || sheetsStatus.connected;

  const responseBody = {
    ok: true,
    worker: workerStatus,
    sheets: sheetsStatus,
    health: {
      worker: 'healthy',
      sheets: isSheetsHealthy ? 'healthy' : 'degraded',
      overall: isSheetsHealthy ? 'healthy' : 'degraded'
    },
    latencyMs: Date.now() - startTime
  };

  return new Response(JSON.stringify(responseBody, null, 2), {
    status: isHealthy ? 200 : 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

/**
 * Handle GET /api/status/sheets
 *
 * Detailed Sheets API health check (requires Sheets to be configured).
 *
 * @param {Request} request - Incoming request
 * @param {Object} env - Worker environment
 * @returns {Promise<Response>}
 */
export async function handleSheetsStatusRequest(request, env) {
  if (!isConfigured(env)) {
    return new Response(JSON.stringify({
      ok: false,
      code: 'NOT_CONFIGURED',
      message: 'Google Sheets API not configured'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const sheetsHealth = await healthCheck(env);

  return new Response(JSON.stringify({
    ok: sheetsHealth.connected,
    sheets: {
      connected: sheetsHealth.connected,
      latencyMs: sheetsHealth.latencyMs,
      error: sheetsHealth.error || null
    }
  }), {
    status: sheetsHealth.connected ? 200 : 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

/**
 * Handle GET /api/ping
 *
 * Minimal health check - just confirms Worker is responding.
 *
 * @returns {Response}
 */
export function handlePingRequest() {
  return new Response(JSON.stringify({
    ok: true,
    pong: true,
    timestamp: new Date().toISOString()
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    }
  });
}

/**
 * Handle GET /api/health/backend
 *
 * Backend health check endpoint for CI/CD Stage-2 validation.
 * Verifies Google Sheets API authentication and connectivity.
 *
 * Story B2 Contract:
 * - Returns ok:true when backend is healthy
 * - Includes googleAuth, token, sheetsProbe status
 * - Includes requestId for tracing
 *
 * @param {Request} request - Incoming request
 * @param {Object} env - Worker environment
 * @returns {Promise<Response>}
 */
export async function handleBackendHealthRequest(request, env) {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const envId = getEnvId(env);

  // Check if Sheets is configured
  const sheetsConfigured = isConfigured(env);

  // Initialize response fields
  let googleAuth = 'not_configured';
  let token = 'not_minted';
  let sheetsProbe = { ok: false, status: 503 };

  if (sheetsConfigured) {
    googleAuth = 'configured';

    // Attempt to verify Sheets connectivity
    try {
      const sheetsHealth = await healthCheck(env);

      if (sheetsHealth.connected) {
        token = 'minted';
        sheetsProbe = {
          ok: true,
          status: 200,
          latencyMs: sheetsHealth.latencyMs
        };
      } else {
        token = sheetsHealth.error?.includes('token') ? 'mint_failed' : 'not_minted';
        sheetsProbe = {
          ok: false,
          status: 503,
          error: sheetsHealth.error || 'Connection failed'
        };
      }
    } catch (error) {
      token = 'mint_failed';
      sheetsProbe = {
        ok: false,
        status: 503,
        error: error.message
      };
    }
  }

  // Overall health - ok if Sheets probe succeeded OR if Sheets not configured (graceful degradation)
  const isHealthy = sheetsProbe.ok || !sheetsConfigured;

  const responseBody = {
    ok: isHealthy,
    env: envId,
    backend: 'worker',
    googleAuth: googleAuth,
    token: token,
    sheetsProbe: sheetsProbe,
    workerVersion: WORKER_VERSION,
    requestId: requestId,
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - startTime
  };

  return new Response(JSON.stringify(responseBody, null, 2), {
    status: isHealthy ? 200 : 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId
    }
  });
}
