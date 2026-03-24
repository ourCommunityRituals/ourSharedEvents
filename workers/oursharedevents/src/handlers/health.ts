/**
 * Health check handler.
 *
 * GET /health
 * GET /api/status
 *
 * Checks Worker liveness and optional Sheets connectivity.
 */

import { sheetsGetValues, type SheetsEnv } from '../lib/sheets';
import { hasGoogleCredentials } from '../lib/google-auth';

export interface HealthEnv extends SheetsEnv {
  WORKER_ENV?: string;
  WORKER_BUILD_VERSION?: string;
}

export async function handleHealth(env: HealthEnv): Promise<Response> {
  const timestamp = new Date().toISOString();

  let sheetsStatus: 'ok' | 'error' | 'not_configured' = 'not_configured';
  let sheetsLatencyMs: number | undefined;
  let sheetsError: string | undefined;

  if (hasGoogleCredentials(env) && env.SHEETS_SPREADSHEET_ID) {
    const start = Date.now();
    try {
      // Lightweight check: read a single cell
      await sheetsGetValues(env, 'EVENTS!A1:A1');
      sheetsStatus = 'ok';
      sheetsLatencyMs = Date.now() - start;
    } catch (err) {
      sheetsStatus = 'error';
      sheetsLatencyMs = Date.now() - start;
      sheetsError = err instanceof Error ? err.message : 'unknown';
    }
  }

  const ok = sheetsStatus !== 'error';

  return Response.json(
    {
      ok,
      env: env.WORKER_ENV ?? 'unknown',
      version: env.WORKER_BUILD_VERSION ?? 'unknown',
      sheets: sheetsStatus,
      ...(sheetsLatencyMs !== undefined ? { sheetsLatencyMs } : {}),
      ...(sheetsError ? { sheetsError } : {}),
      timestamp,
    },
    { status: ok ? 200 : 503 }
  );
}
