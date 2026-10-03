/**
 * Health check handler.
 *
 * GET /health
 * GET /api/status
 *
 * Checks Worker liveness, D1 connectivity, and reports the active data source.
 */

import { getDataProvider, type DataProviderEnv } from '../lib/data-provider.js';
import { HARDENING_HEADERS } from '../lib/security-headers.js';

export interface HealthEnv extends DataProviderEnv {
  WORKER_BUILD_VERSION?: string;
}

// CCR-PR567 re-run item 5 (revised): the signing-secret usability boolean was
// briefly reported on /health, but the NS-3 security-regression gate requires the
// PUBLIC health endpoint to stay "boring OK" — no secret/key/token-adjacent
// fields — and it authenticates, so the field cannot be hidden from it. Exposing
// signing-config state on a public endpoint is exactly the info-disclosure NS-3
// guards against, so it was removed. Value-validity now lives where it belongs:
// set-secrets.sh length-checks at provisioning, and the T4 /sponsor journey fails
// functionally if the signing secret is unset/short (a real usability probe).

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
      // Internal DataProvider state is a staging/dev diagnostic only. Production
      // /health stays "boring OK" (NS-3): no internal-state fields on a public
      // endpoint. Fail closed: only an exact 'production' omits it, matching
      // datasetForPool's env comparison.
      ...(env.WORKER_ENV === 'production' ? {} : { _debug: { db_bound, mock_mode_forced } }),
      timestamp,
    },
    {
      status: ok ? 200 : 503,
      // /health is a public JSON endpoint the DAST scans; carry nosniff + the
      // cross-cutting hardening headers so it passes the same gate as the HTML
      // surfaces (ZAP 10021 nosniff + 90004 CORP fire on JSON too).
      headers: { 'X-Content-Type-Options': 'nosniff', ...HARDENING_HEADERS },
    }
  );
}
