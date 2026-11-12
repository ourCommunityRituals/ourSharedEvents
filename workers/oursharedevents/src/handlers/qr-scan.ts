/**
 * GET /q/:qr_token — QR scan ingestion endpoint. OSE-625 / BE-SCAN-1.
 *
 * Resolves a poster deployment QR token, records an anonymous scan row,
 * then 302-redirects the attendee to the event page with enough query context
 * for the event-page CTA to continue to the appropriate attributed form.
 *
 * Privacy invariants:
 *   - Only scan_bucket (hour-granularity UTC) is stored — no exact timestamp.
 *   - user_agent_hash is written only when the scan has no keyed id
 *     (ANON_ID_HASH_PEPPER unset), as the visitor-count fallback (TL-078). It is
 *     an unsalted SHA-256 truncated to 16 hex chars, so it is a device trait, not
 *     a secret; production refuses to deploy without the pepper.
 *   - anonymous_id is a keyed scan id derived from the HttpOnly cookie
 *     (lib/scan-node-key.ts, OSE-1659) — never the cookie value, no PII, no IP.
 *   - No visitor location: the Cloudflare country header is never read, so country_code stays
 *     NULL (OSE-1460). Place comes only from the poster's corridor.
 *   - No referrer logged.
 *
 * Dedup:
 *   - KV key `scan:dedup:{scanKey}:{deploymentId}:{hour_bucket}`, 1-hour TTL
 *     (the cookie value only when ANON_ID_HASH_PEPPER is unset).
 *   - Same anon + same deployment + same hour bucket → no second scan row.
 *     One person counts once per poster per hour, so an hourly poster count is
 *     a count of people (OSE-1459): the K-floor on poster cells and on
 *     poster_attribution then means "at least K people", not "K requests".
 *   - KV missing, or a KV get/put error → still write scan (dedup is best-effort).
 *
 * Backend blips (OSE-1988): no D1 or KV error becomes a 500. The deployment
 * lookup is retried once, then the visitor is sent home (no cookie, no scan);
 * a KV error skips dedup; a scan write error is logged and the redirect stands.
 *
 * Structured log (SCAN_RECORDED) contains only aggregated signals: no raw
 * anon_id, no exact timestamp, no lat/lng.
 *
 * Hot-path guard: this file MUST NOT import h3-js. Geo tagging is an
 * admin/creation-time operation (see handlers/poster-deployments.ts). Adding
 * h3-js here would silently break the SCAN_PATH invariant in h3-tagging.spec.ts.
 */

import { getOrCreateAnonId, setAnonCookie } from '../lib/anonymous-id';
import { enqueueOrWriteScan, scanDedupKey, type ScanMessage } from '../lib/scan-buffer';
import { scanNodeKey } from '../lib/scan-node-key';

import { errorLabel } from '../lib/error-label';
// One warning per isolate, not one per scan: the missing secret is a config
// fact, and the line names no visitor.
let scanPepperWarned = false;
function warnScanPepperMissing(): void {
  if (scanPepperWarned) return;
  scanPepperWarned = true;
  console.warn(
    JSON.stringify({
      type: 'ANON_ID_HASH_PEPPER_MISSING',
      note: 'OSE-1659: scans are stored with no id, so returning visitors are not counted and distinct counts are coarser. Set the ANON_ID_HASH_PEPPER secret.',
    })
  );
}

export interface QrScanEnv {
  DB: D1Database;
  // OSE-1659: keys the scan id stored in scan_node_returns (lib/scan-node-key.ts).
  // Unset → the scan is stored with no id; the cookie value is never stored.
  ANON_ID_HASH_PEPPER?: string;
  RATE_LIMIT_KV?: KVNamespace;
  // Optional scan write-buffer. Bound → the hot path enqueues and returns;
  // unbound → the direct D1 batch (dark-launch parity). See lib/scan-buffer.ts.
  SCAN_QUEUE?: Queue<ScanMessage>;
}

/** Hour-bucketed UTC timestamp string — privacy invariant for scan_node_returns.anonymous_id. */
function scanBucket(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}:00`;
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

const SCAN_FORM_TYPES = new Set(['register', 'checkin', 'survey', 'email-signup']);

/**
 * Where a poster scan lands: the event page, carrying the form type and the
 * deployment id so the page's CTA keeps sourcePlacementId attribution.
 * Exported as the ONE definition — the admin poster card shows this target
 * (via the poster-deployments list response, OSE-1357) and must never drift
 * from what /q/ actually does.
 */
export function qrScanTarget(
  origin: string,
  eventId: string,
  deploymentId: string,
  formType?: string | null
): string {
  const safeType = formType && SCAN_FORM_TYPES.has(formType) ? formType : 'register';
  return `${origin}/events/${encodeURIComponent(eventId)}?type=${safeType}&deployment=${encodeURIComponent(deploymentId)}`;
}

/** qr_token must start with 'qrt_' and be <= 128 chars to be a valid poster token. */
function isValidQrTokenShape(token: string): boolean {
  return token.startsWith('qrt_') && token.length <= 128;
}

export async function handleQrScan(
  request: Request,
  env: QrScanEnv,
  qrToken: string,
  countable: boolean = true
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

  // Resolve poster deployment by qr_token unique index. A read is safe to
  // retry, so a D1 blip gets one more try (OSE-1988). The event is known only
  // from this row, so if both tries fail the visitor gets the same answer as
  // "infrastructure not ready" above: home, not a 500. No anon id is minted and
  // no cookie set on that path, and the log names the failure, not the token.
  const lookupDeployment = () =>
    env.DB.prepare(
      `SELECT id, event_id FROM poster_deployments WHERE qr_token = ? AND is_active = 1 LIMIT 1`
    )
      .bind(qrToken)
      .first<{ id: string; event_id: string }>();
  let deployment: { id: string; event_id: string } | null;
  try {
    deployment = await lookupDeployment().catch(() => lookupDeployment());
  } catch (err) {
    console.error(JSON.stringify({ type: 'SCAN_LOOKUP_ERROR', error: errorLabel(err) }));
    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Cache-Control': 'no-store' },
    });
  }

  if (!deployment) {
    // Unknown or inactive token — safe to redirect home rather than 404.
    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Cache-Control': 'no-store' },
    });
  }

  const { id: deploymentId, event_id: eventId } = deployment;

  // Past the caller's limit (OSE-1496): send the visitor on, count nothing. No
  // row, no dedup marker and no new anonymous id, so a flood from one client
  // adds no scans and no "people". The route decides; see publicCountLimited.
  if (!countable) {
    console.log(JSON.stringify({ type: 'SCAN_NOT_COUNTED', reason: 'rate_limited' }));
    const here = new URL(request.url);
    return new Response(null, {
      status: 302,
      headers: {
        Location: qrScanTarget(here.origin, eventId, deploymentId, here.searchParams.get('type')),
        'Cache-Control': 'no-store',
      },
    });
  }

  const nowMs = Date.now();
  const nowDate = new Date(nowMs);

  // Anonymous ID: read from cookie or generate new one.
  const { anonId, isNew } = getOrCreateAnonId(request);
  // OSE-1659: what is stored and queued is the keyed scan id, never the cookie
  // value. Null without the pepper: the scan still counts, with no id.
  const scanKey = await scanNodeKey(anonId, env.ANON_ID_HASH_PEPPER);
  if (!scanKey) warnScanPepperMissing();

  // Hour dedup (OSE-1459): same anon + same deployment in the same hour bucket
  // the scan is stored under → skip write. One person, one poster, one hour.
  let isDuplicate = false;
  let dedupKey: string | null = null;
  if (env.RATE_LIMIT_KV) {
    const key = scanDedupKey(scanKey ?? anonId, deploymentId, scanBucket(nowDate));
    try {
      const existing = await env.RATE_LIMIT_KV.get(key);
      if (existing !== null) {
        isDuplicate = true;
      } else {
        // The key names its hour, so a 1-hour TTL always outlives that hour.
        await env.RATE_LIMIT_KV.put(key, '1', { expirationTtl: 3600 });
        dedupKey = key;
      }
    } catch (err) {
      // OSE-1988: dedup is best-effort, as when KV is unbound. A KV blip skips
      // it and the scan is written; no marker is held, so none is released.
      console.warn(
        JSON.stringify({
          type: 'SCAN_DEDUP_SKIPPED',
          deployment_id: deploymentId,
          error: errorLabel(err),
        })
      );
    }
  }

  if (!isDuplicate) {
    const bucket = scanBucket(nowDate);
    // TL-078: the browser-name hash is only the fallback for a scan with no
    // keyed id. With the id, the browser name is not read at all.
    const uaHash = scanKey ? null : await hashUserAgent(request.headers.get('User-Agent') ?? '');

    try {
      // OSE-798: the placement event (WHERE) and the node return (WHO) are
      // written to SEPARATE tables so no durable row carries both a placement id
      // and a session-derived value (doctrine rule 6). The write is buffered
      // through SCAN_QUEUE when bound so a scan spike can't throttle the hot
      // path; unbound or on a queue outage it falls straight to the direct D1
      // batch, so counts are never lost. Row-building + the direct write live in
      // lib/scan-buffer.ts, shared with the queue() consumer in index.ts.
      const outcome = await enqueueOrWriteScan(env, {
        placement_row_id: `spe_${crypto.randomUUID()}`,
        return_row_id: `snr_${crypto.randomUUID()}`,
        event_id: eventId,
        deployment_id: deploymentId,
        anon_id: scanKey,
        ua_hash: uaHash,
        country: null, // rollback-safe wire field; never a real country (OSE-1460)
        scan_bucket: bucket,
      });

      console.log(
        JSON.stringify({
          type: outcome === 'enqueued' ? 'SCAN_ENQUEUED' : 'SCAN_RECORDED',
          deployment_id: deploymentId,
          event_id: eventId,
          scan_bucket: bucket,
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
          error: errorLabel(err),
        })
      );
      // Nothing was stored, so release this hour's dedup marker: a retry in the
      // same hour must be able to record the scan, not be taken as a repeat.
      if (dedupKey && env.RATE_LIMIT_KV) {
        await env.RATE_LIMIT_KV.delete(dedupKey).catch(() => {});
      }
    }
  }

  // Pass `?type=` through to the event page (e.g. ?type=checkin from the QR URL).
  // Also embed `?deployment=` so the event-page CTA can continue to the form
  // without losing sourcePlacementId attribution.
  const url = new URL(request.url);
  const redirectTarget = qrScanTarget(
    url.origin,
    eventId,
    deploymentId,
    url.searchParams.get('type')
  );

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
