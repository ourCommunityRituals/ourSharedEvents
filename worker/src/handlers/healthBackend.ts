/**
 * Backend Health Handler
 *
 * Health check endpoint that verifies Google service account authentication
 * and Sheets API reachability. This endpoint proves the Worker can authenticate
 * as a service account and communicate with Google APIs.
 *
 * GET /api/health/backend
 *
 * Per Story B1: "Health endpoint must tell us exactly why auth fails."
 * Per Story B2: Token + Sheets Read Probe - one call tells you if staging backend is usable.
 *
 * Response Contract (Story B2):
 * {
 *   "ok": true,
 *   "env": "staging",
 *   "backend": "cloudflare",
 *   "googleAuth": "service_account",
 *   "token": "ok",
 *   "sheetsProbe": { "ok": true, "status": 200 },
 *   "workerVersion": "..."
 * }
 *
 * @module handlers/healthBackend
 * @see Story B1 - Worker Service Account Auth (JWT -> OAuth Token) + Token Cache
 * @see Story B2 - Health Endpoint: /api/health/backend (Token + Sheets Read Probe)
 */

import {
  checkGoogleAuthHealth,
  GOOGLE_AUTH_ERROR_CODES,
  sheetsGetValues,
  SheetsReadError,
  type GoogleServiceAccountEnv,
  type GoogleAuthHealthResult,
} from '../google';
import {
  validateEnv,
  normalizeGoogleEnv,
  getEnvironmentName,
  type WorkerEnv,
  type EnvValidationGroups,
} from '../env';
import { isConfigured as isSheetsConfigured, SHEETS_ERROR_CODES } from '../sheetsClient';

// =============================================================================
// Constants
// =============================================================================

const HANDLER_VERSION = '2.1.0';

/**
 * Error codes per Story B2 acceptance criteria
 * These codes MUST remain stable for CI/CD gates
 */
export const HEALTH_ERROR_CODES = {
  /** Sheets read probe failed (generic) */
  SHEETS_READ_FAILED: 'SHEETS_READ_FAILED',
  /** SHEETS_SPREADSHEET_ID not configured */
  SHEETS_DB_ID_MISSING: 'SHEETS_DB_ID_MISSING',
} as const;

/** Sheets probe timeout (5 seconds) */
const SHEETS_PROBE_TIMEOUT_MS = 5000;

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings required for backend health handler
 */
export interface HealthBackendEnv extends WorkerEnv, GoogleServiceAccountEnv {
  WORKER_ENV?: string;
  WORKER_BUILD_VERSION?: string;
  SHEETS_SPREADSHEET_ID?: string;
}

/**
 * Sheets probe result
 *
 * Per Story B2: Reads a small range from Sheets to verify access
 */
export interface SheetsProbeResult {
  /** Whether probe succeeded */
  ok: boolean;
  /** HTTP status from Sheets API (200, 403, 404, etc.) */
  status: number;
  /** Latency in milliseconds */
  latencyMs?: number;
  /** Error message if probe failed */
  error?: string;
  /** Actionable hint for common errors (e.g., 403 = share sheet) */
  hint?: string;
  /** Error code for structured error handling (per Story B2) */
  code?: string;
}

/**
 * Backend health response shape - Story B2 contract
 *
 * Per Story B2 Architect spec:
 * {
 *   "ok": true,
 *   "env": "staging",
 *   "backend": "cloudflare",
 *   "googleAuth": "service_account",
 *   "token": "ok",
 *   "sheetsProbe": { "ok": true, "status": 200 },
 *   "workerVersion": "..."
 * }
 */
export interface HealthBackendResponse {
  /** Overall health status */
  ok: boolean;
  /** Environment name (staging, production, development) */
  env: string;
  /** Backend type - always "cloudflare" */
  backend: 'cloudflare';
  /** Authentication method - always "service_account" */
  googleAuth: 'service_account';
  /** Token status: "ok" or error code */
  token: 'ok' | string;
  /** Sheets probe result */
  sheetsProbe: SheetsProbeResult;
  /** Worker version */
  workerVersion: string;

  // Extended fields for debugging (not in minimal contract)
  /** Request ID for tracing */
  requestId?: string;
  /** Timestamp */
  timestamp?: string;
  /** Handler version */
  version?: string;
  /** Error code (if unhealthy) - per Story B2: SHEETS_READ_FAILED, SHEETS_DB_ID_MISSING, etc. */
  code?: string;
  /** Error message (if unhealthy) */
  error?: string;
  /** Google API status code when Sheets probe fails (e.g., 403) - per Story B2 */
  googleStatus?: number;
  /** Environment validation summary (only on failure) */
  envValidation?: EnvValidationGroups;
}

/**
 * Error response shape
 * Per Story B1: "Missing secrets returns: { ok: false, status: 503, code: '...', requestId: '...' }"
 */
export interface HealthBackendErrorResponse {
  ok: false;
  status: 503;
  code: string;
  error: string;
  requestId: string;
  timestamp: string;
  googleStatus?: number;
}

// =============================================================================
// Sheets Probe (Story B2)
// =============================================================================

/**
 * Perform a Sheets read probe using sheetsGetValues
 *
 * Per Story B2: Read a small range from Sheets to verify access
 * Per Story B3: Uses sheetsGetValues() for the actual read
 *
 * @param env - Environment with Google credentials and spreadsheet ID
 * @param serviceAccountEmail - Service account email for hint generation
 * @returns SheetsProbeResult with status and any errors
 */
async function performSheetsProbe(
  env: HealthBackendEnv,
  serviceAccountEmail: string
): Promise<SheetsProbeResult> {
  const startTime = Date.now();

  try {
    // Read a minimal range (first cell of first sheet)
    // Per Story B3: Use sheetsGetValues() with proper range
    await sheetsGetValues(
      { ...env, GOOGLE_SA_CLIENT_EMAIL: env.GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY_PEM: env.GOOGLE_SA_PRIVATE_KEY_PEM },
      env.SHEETS_SPREADSHEET_ID!,
      'A1:A1',
      { timeoutMs: SHEETS_PROBE_TIMEOUT_MS }
    );

    const latencyMs = Date.now() - startTime;

    return {
      ok: true,
      status: 200,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    // Handle SheetsReadError with googleStatus
    if (error instanceof SheetsReadError) {
      const status = error.googleStatus || 503;

      // Per Story B2: 403 = sheet not shared, include actionable hint
      if (status === 403) {
        return {
          ok: false,
          status,
          latencyMs,
          code: HEALTH_ERROR_CODES.SHEETS_READ_FAILED,
          error: 'Permission denied: spreadsheet not accessible',
          hint: `Share sheet with service account: ${serviceAccountEmail}`,
        };
      }

      // 404 = spreadsheet not found
      if (status === 404) {
        return {
          ok: false,
          status,
          latencyMs,
          code: HEALTH_ERROR_CODES.SHEETS_READ_FAILED,
          error: 'Spreadsheet not found',
          hint: 'Verify SHEETS_SPREADSHEET_ID is correct',
        };
      }

      // 401 = auth issue
      if (status === 401) {
        return {
          ok: false,
          status,
          latencyMs,
          code: HEALTH_ERROR_CODES.SHEETS_READ_FAILED,
          error: 'Authentication failed',
          hint: 'Token may have expired during request',
        };
      }

      // Check for timeout
      if (error.message.includes('timed out')) {
        return {
          ok: false,
          status: 504,
          latencyMs,
          code: HEALTH_ERROR_CODES.SHEETS_READ_FAILED,
          error: 'Sheets probe timed out',
          hint: 'Google Sheets API may be slow or unreachable',
        };
      }

      // Other SheetsReadError
      return {
        ok: false,
        status,
        latencyMs,
        code: HEALTH_ERROR_CODES.SHEETS_READ_FAILED,
        error: error.message,
      };
    }

    // Network or other error
    return {
      ok: false,
      status: 503,
      latencyMs,
      code: HEALTH_ERROR_CODES.SHEETS_READ_FAILED,
      error: `Network error: ${error instanceof Error ? error.message : 'Unknown'}`,
      hint: 'Check network connectivity to Google APIs',
    };
  }
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle GET /api/health/backend
 *
 * Per Story B2: One call that tells you if staging backend is actually usable.
 *
 * Performs:
 * 1. Token mint (or use cached)
 * 2. Read a small range from Sheets (probe)
 *
 * Per Story B1 + B2 Acceptance Criteria:
 * - Worker can mint OAuth access token successfully
 * - Token is cached; repeated requests do not mint each time
 * - Sheets probe reads actual data (not just metadata)
 * - Missing secrets returns structured error with code
 * - 403 from Sheets probe includes hint: "Share sheet with <service account email>"
 * - Logs include requestId + failure code on failure
 *
 * @param env - Worker environment
 * @param requestId - Request ID for tracing
 * @param skipSheetsCheck - Skip Sheets connectivity check (for faster response)
 * @returns Response with health status per Story B2 contract
 */
export async function handleHealthBackend(
  env: HealthBackendEnv,
  requestId: string,
  skipSheetsCheck: boolean = false
): Promise<Response> {
  const timestamp = new Date().toISOString();
  const workerEnv = getEnvironmentName(env);
  const buildVersion = env.WORKER_BUILD_VERSION || 'unknown';

  // Validate environment
  const envValidation = validateEnv(env);

  // Normalize Google credentials (support legacy naming)
  const normalizedEnv = normalizeGoogleEnv(env);
  const serviceAccountEmail = normalizedEnv.GOOGLE_SA_CLIENT_EMAIL || 'unknown';

  // Perform Google auth health check and token mint
  const authHealth: GoogleAuthHealthResult = await checkGoogleAuthHealth(normalizedEnv);

  // Determine token status for response
  // Note: sheetsGetValues (Story B3) handles token acquisition internally
  const tokenStatus: 'ok' | string = authHealth.healthy
    ? 'ok'
    : (authHealth.errorCode || 'error');

  // Perform Sheets probe if auth succeeded and not skipped
  let sheetsProbe: SheetsProbeResult;
  const sheetsConfigured = isSheetsConfigured(env as never);

  if (!authHealth.healthy) {
    // Auth failed, can't probe sheets
    sheetsProbe = {
      ok: false,
      status: 0,
      error: 'Sheets probe skipped: token mint failed',
      hint: authHealth.errorMessage,
    };
  } else if (skipSheetsCheck) {
    // Sheets check skipped by request
    sheetsProbe = {
      ok: true,
      status: 0,
      error: 'Sheets probe skipped by request',
    };
  } else if (!sheetsConfigured || !env.SHEETS_SPREADSHEET_ID) {
    // Per Story B2: Missing sheet ID var returns SHEETS_DB_ID_MISSING
    sheetsProbe = {
      ok: false,
      status: 0,
      code: HEALTH_ERROR_CODES.SHEETS_DB_ID_MISSING,
      error: 'SHEETS_SPREADSHEET_ID not configured',
      hint: 'Set SHEETS_SPREADSHEET_ID environment variable',
    };
  } else {
    // Perform actual sheets read probe using sheetsGetValues (Story B3)
    sheetsProbe = await performSheetsProbe(
      { ...normalizedEnv, SHEETS_SPREADSHEET_ID: env.SHEETS_SPREADSHEET_ID },
      serviceAccountEmail
    );
  }

  // Determine overall health
  // Per Story B2: ok=true when both token and sheets probe succeed
  const isHealthy = authHealth.healthy && (skipSheetsCheck || sheetsProbe.ok);
  const httpStatus = isHealthy ? 200 : 503;

  // Build response per Story B2 contract
  const responseBody: HealthBackendResponse = {
    ok: isHealthy,
    env: workerEnv,
    backend: 'cloudflare',
    googleAuth: 'service_account',
    token: tokenStatus,
    sheetsProbe,
    workerVersion: buildVersion,

    // Extended fields for debugging
    requestId,
    timestamp,
    version: HANDLER_VERSION,
  };

  // Add error details if unhealthy
  if (!isHealthy) {
    if (!authHealth.healthy) {
      responseBody.code = authHealth.errorCode;
      responseBody.error = authHealth.errorMessage;
    } else if (!sheetsProbe.ok) {
      // Per Story B2: Use the code from sheetsProbe (SHEETS_READ_FAILED or SHEETS_DB_ID_MISSING)
      responseBody.code = sheetsProbe.code || HEALTH_ERROR_CODES.SHEETS_READ_FAILED;
      responseBody.error = sheetsProbe.error;
      // Per Story B2: Include googleStatus for Sheets errors (e.g., 403)
      if (sheetsProbe.status > 0) {
        responseBody.googleStatus = sheetsProbe.status;
      }
    }

    // Include env validation for debugging
    responseBody.envValidation = envValidation;

    // Log failure per Story B1/B2
    console.error(JSON.stringify({
      type: 'BACKEND_HEALTH_CHECK_FAILED',
      requestId,
      code: responseBody.code,
      timestamp,
      env: workerEnv,
      sheetsProbeStatus: sheetsProbe.status,
      sheetsProbeHint: sheetsProbe.hint,
    }));
  }

  return new Response(JSON.stringify(responseBody), {
    status: httpStatus,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
      'X-Handler-Version': HANDLER_VERSION,
    },
  });
}

/**
 * Create error response for backend health failures
 *
 * Used when an exception occurs during health check.
 *
 * @param error - Error that occurred
 * @param requestId - Request ID for tracing
 * @returns 503 response with error details
 */
export function createBackendHealthErrorResponse(
  error: Error,
  requestId: string
): Response {
  const responseBody: HealthBackendErrorResponse = {
    ok: false,
    status: 503,
    code: GOOGLE_AUTH_ERROR_CODES.TOKEN_EXCHANGE_FAILED,
    error: error.message,
    requestId,
    timestamp: new Date().toISOString(),
  };

  console.error(JSON.stringify({
    type: 'BACKEND_HEALTH_CHECK_ERROR',
    requestId,
    code: responseBody.code,
    error: error.message,
    timestamp: responseBody.timestamp,
  }));

  return new Response(JSON.stringify(responseBody), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}
