/**
 * Health check handler.
 *
 * GET /health
 * GET /api/status
 *
 * Checks Worker liveness.
 */

export interface HealthEnv {
  WORKER_ENV?: string;
  WORKER_BUILD_VERSION?: string;
}

export async function handleHealth(env: HealthEnv): Promise<Response> {
  const timestamp = new Date().toISOString();

  return Response.json(
    {
      ok: true,
      env: env.WORKER_ENV ?? 'unknown',
      version: env.WORKER_BUILD_VERSION ?? 'unknown',
      timestamp,
    },
    { status: 200 }
  );
}
