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
  SHARED_REPORT_SIGNING_SECRET?: string;
}

/**
 * CCR-PR567 re-run item 5 — is the HMAC signing secret genuinely usable?
 *
 * The deploy-time gate can only check that SHARED_REPORT_SIGNING_SECRET is
 * PRESENT (`wrangler secret list` never exposes the value), so an empty /
 * whitespace / too-short value lists as present yet leaves the /sponsor +
 * /sharedReport signing corner fail-closed (silently inert). This reports
 * usability — present AND >= 32 chars after trimming — as a boolean, NEVER the
 * value, so the post-deploy health step can assert real validity, not presence.
 */
export function isSigningSecretConfigured(secret: string | undefined | null): boolean {
  return typeof secret === 'string' && secret.trim().length >= 32;
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
      // signingSecretConfigured is a usability boolean (present + >=32 chars),
      // NEVER the value — the post-deploy CI health step asserts it so a
      // fail-closed-inert /sponsor + /sharedReport corner can't ship green
      // (CCR-PR567 re-run item 5).
      _debug: {
        db_bound,
        mock_mode_forced,
        signingSecretConfigured: isSigningSecretConfigured(env.SHARED_REPORT_SIGNING_SECRET),
      },
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
