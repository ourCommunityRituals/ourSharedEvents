/**
 * Health check handler.
 *
 * GET /health
 * GET /api/status
 *
 * Checks Worker liveness, D1 connectivity, and reports the active data source.
 */

import { getDataProvider, type DataProviderEnv } from '../lib/data-provider.js';

export interface HealthEnv extends DataProviderEnv {
  WORKER_BUILD_VERSION?: string;
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

  // DataProvider summary — source and mock-mode state
  const dp = getDataProvider(env);
  const { db_bound, mock_mode_forced, effective_source } = dp.healthSummary();

  // Probe the CF cache for a well-known key to surface live cacheAge
  let cacheAge: number | null = null;
  try {
    const { readCfCache, makeCacheKey } = await import('@ocr/data-provider');
    const probe = await readCfCache(makeCacheKey('health/probe'));
    cacheAge = probe ? probe.age : null;
  } catch {
    // CF cache unavailable in this environment — leave null
  }

  return Response.json(
    {
      ok,
      env: env.WORKER_ENV ?? 'unknown',
      version: env.WORKER_BUILD_VERSION ?? 'unknown',
      db,
      dataSource: effective_source,
      cacheAge,
      _debug: { db_bound, mock_mode_forced },
      timestamp,
    },
    { status: ok ? 200 : 503 }
  );
}
