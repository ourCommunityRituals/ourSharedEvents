/**
 * Health check handler.
 *
 * GET /health
 * GET /api/status
 *
 * Checks Worker liveness and D1 connectivity.
 */

export interface HealthEnv {
  WORKER_ENV?: string;
  WORKER_BUILD_VERSION?: string;
  DB?: D1Database;
}

export async function handleHealth(env: HealthEnv): Promise<Response> {
  const timestamp = new Date().toISOString();

  // D1 connectivity check
  let db: 'ok' | 'not_configured' | 'error' = 'not_configured';
  if (env.DB) {
    try {
      await env.DB.prepare('SELECT 1').first();
      db = 'ok';
    } catch {
      db = 'error';
    }
  }

  const ok = db !== 'error';

  return Response.json(
    {
      ok,
      env: env.WORKER_ENV ?? 'unknown',
      version: env.WORKER_BUILD_VERSION ?? 'unknown',
      db,
      timestamp,
    },
    { status: ok ? 200 : 503 }
  );
}
