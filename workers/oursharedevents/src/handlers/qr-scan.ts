/**
 * GET /q/:qr_token — QR scan ingestion endpoint. OSE-625 / BE-SCAN-1.
 *
 * Resolves a poster deployment QR token, records an anonymous scan row,
 * then 302-redirects the attendee to the appropriate form page.
 *
 * Privacy invariants:
 *   - Only scan_bucket (hour-granularity UTC) is stored — no exact timestamp.
 *   - user_agent_hash is SHA-256 truncated to 16 hex chars — not reversible.
 *   - anonymous_id from HttpOnly cookie — no PII, no IP.
 *   - country_code and region_code from Cloudflare headers (aggregated geo,
 *     not exact IP location).
 *   - No referrer logged.
 *
 * Dedup:
 *   - KV key `scan:dedup:{anonId}:{deploymentId}:{5min_bucket}` with 5-min TTL.
 *   - Same anon + same deployment + same 5-min window → no second scan row.
 *   - KV missing → still write scan (dedup is best-effort).
 *
 * Structured log (SCAN_RECORDED) contains only aggregated signals: no raw
 * anon_id, no exact timestamp, no lat/lng.
 *
 * Hot-path guard: this file MUST NOT import h3-js. Geo tagging is an
 * admin/creation-time operation (see handlers/poster-deployments.ts). Adding
 * h3-js here would silently break the SCAN_PATH invariant in h3-tagging.spec.ts.
 */

import { getOrCreateAnonId, setAnonCookie } from '../lib/anonymous-id';
import {
  readThroughResolution,
  logCacheEvent,
  deploymentCacheKey,
  type CacheResult,
} from '../lib/resolution-cache';

export interface QrScanEnv {
  DB: D1Database;
  RATE_LIMIT_KV?: KVNamespace;
  /** Optional read-cache for the deployment resolution (OSE-963). Unbound →
   * every resolve falls through to D1, exactly as before (dark-launched). */
  RESOLVE_CACHE_KV?: KVNamespace;
}

/**
 * Resolve a qr_token → active poster deployment, fronted by the KV read-cache.
 * The D1 read (the same active-only lookup this endpoint has always done) is the
 * loader, so an unbound cache behaves identically to today. Emits the never-who
 * CACHE_EVENT for hit-rate observability.
 */
export async function resolveDeploymentCached(
  env: QrScanEnv,
  qrToken: string
): Promise<CacheResult<{ id: string; event_id: string }>> {
  const db = env.DB;
  const result = await readThroughResolution(
    env.RESOLVE_CACHE_KV,
    deploymentCacheKey(qrToken),
    () =>
      db
        .prepare(
          `SELECT id, event_id FROM poster_deployments WHERE qr_token = ? AND is_active = 1 LIMIT 1`
        )
        .bind(qrToken)
        .first<{ id: string; event_id: string }>()
  );
  logCacheEvent('qr', result.outcome);
  return result;
}

/** Hour-bucketed UTC timestamp string — privacy invariant for scans.anonymous_id. */
function scanBucket(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}:00`;
}

/** 5-minute bucket index used as the KV dedup key suffix. */
function fiveMinBucket(nowMs: number): number {
  return Math.floor(nowMs / (5 * 60 * 1000));
}

/** SHA-256 of user-agent string, truncated to 16 hex chars. Not reversible. */
async function hashUserAgent(ua: string): Promise<string | null> {
  try {
    const encoded = new TextEncoder().encode(ua.slice(0, 512));
    const buf = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  } catch {
    return null;
  }
}

/** qr_token must start with 'qrt_' and be <= 128 chars to be a valid poster token. */
function isValidQrTokenShape(token: string): boolean {
  return token.startsWith('qrt_') && token.length <= 128;
}

export async function handleQrScan(
  request: Request,
  env: QrScanEnv,
  qrToken: string
): Promise<Response> {
  if (!env.DB) {
    // Infrastructure not ready — redirect to homepage rather than stranding the attendee.
    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Cache-Control': 'no-store' },
    });
  }

  if (!isValidQrTokenShape(qrToken)) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Cache-Control': 'no-store' },
    });
  }

  // Resolve poster deployment by qr_token, fronted by the KV read-cache
  // (OSE-963). Cache miss/unbound → the same active-only D1 lookup as before.
  const { value: deployment } = await resolveDeploymentCached(env, qrToken);

  if (!deployment) {
    // Unknown or inactive token — safe to redirect home rather than 404.
    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Cache-Control': 'no-store' },
    });
  }

  const { id: deploymentId, event_id: eventId } = deployment;
  const nowMs = Date.now();
  const nowDate = new Date(nowMs);

  // Anonymous ID: read from cookie or generate new one.
  const { anonId, isNew } = getOrCreateAnonId(request);

  // 5-minute dedup: same anon + same deployment in same bucket → skip write.
  let isDuplicate = false;
  if (env.RATE_LIMIT_KV) {
    const dedupKey = `scan:dedup:${anonId}:${deploymentId}:${fiveMinBucket(nowMs)}`;
    const existing = await env.RATE_LIMIT_KV.get(dedupKey);
    if (existing !== null) {
      isDuplicate = true;
    } else {
      // Mark dedup entry with 5-minute TTL.
      await env.RATE_LIMIT_KV.put(dedupKey, '1', { expirationTtl: 300 });
    }
  }

  if (!isDuplicate) {
    const bucket = scanBucket(nowDate);
    const ua = request.headers.get('User-Agent') ?? '';
    const uaHash = await hashUserAgent(ua);
    const countryCode = request.headers.get('CF-IPCountry') ?? null;
    const placementId = `spe_${crypto.randomUUID()}`;
    const returnId = `snr_${crypto.randomUUID()}`;

    try {
      // OSE-798: split write — the placement event (WHERE) and the node return
      // (WHO) go to SEPARATE tables so no durable row carries both a placement
      // id and a session-derived value (doctrine rule 6). Batched so both land
      // or neither does.
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO scan_placement_events
             (id, event_id, poster_deployment_id, scan_bucket, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`
        ).bind(placementId, eventId, deploymentId, bucket),
        env.DB.prepare(
          `INSERT INTO scan_node_returns
             (id, event_id, anonymous_id, user_agent_hash, country_code, scan_bucket, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(returnId, eventId, anonId, uaHash, countryCode, bucket),
      ]);

      console.log(
        JSON.stringify({
          type: 'SCAN_RECORDED',
          deployment_id: deploymentId,
          event_id: eventId,
          scan_bucket: bucket,
          country_code: countryCode,
          is_new_anon: isNew,
        })
      );
    } catch (err) {
      // Scan write failure must never strand the attendee. Log and continue to redirect.
      console.error(
        JSON.stringify({
          type: 'SCAN_WRITE_ERROR',
          deployment_id: deploymentId,
          event_id: eventId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  // Pass `?type=` through to the form page (e.g. ?type=checkin from the QR URL).
  // Also embed `?deployment=` so the form submission can attribute the scan.
  const url = new URL(request.url);
  const formType = url.searchParams.get('type') ?? 'register';
  const ALLOWED_TYPES = new Set(['register', 'checkin', 'survey', 'email-signup']);
  const safeType = ALLOWED_TYPES.has(formType) ? formType : 'register';

  const origin = url.origin;
  const redirectTarget = `${origin}/forms/${encodeURIComponent(eventId)}?type=${safeType}&deployment=${encodeURIComponent(deploymentId)}`;

  const redirectResponse = new Response(null, {
    status: 302,
    headers: {
      Location: redirectTarget,
      'Cache-Control': 'no-store',
    },
  });

  // Set anon_id cookie on the redirect if the visitor is new (first scan ever).
  return isNew ? setAnonCookie(redirectResponse, anonId) : redirectResponse;
}
