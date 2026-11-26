/**
 * GET /q/:qr_token — QR scan ingestion endpoint. OSE-625 / BE-SCAN-1.
 *
 * Resolves a poster deployment QR token, records an anonymous scan row,
 * then 302-redirects the attendee to the event page with enough query context
 * for the event-page CTA to continue to the appropriate attributed form.
 *
 * OSE counts traffic on the code, never the phone (OSE-2214, owner 2026-11-23;
 * ADR-024 option C for scans). A poster code:
 *   - neither reads nor sets the ose_anon cookie;
 *   - keeps no per-phone marker: every scan counts, up to POSTER_HOUR_CAP per
 *     poster per hour (OSE-1496, lib/poster-hour-cap.ts), the only guard
 *     (this retires the per-phone hourly dedup of OSE-1459);
 *   - stores no phone id and reads no browser name (closes TL-078);
 *   - stores only the hour bucket, no exact time; no visitor location (the
 *     Cloudflare country header is never read, OSE-1460); no referrer.
 *
 * Backend blips (OSE-1988): no D1 or KV error becomes a 500. The deployment
 * lookup is retried once, then the visitor is sent home (no scan); a cap
 * read error counts the scan (lib/poster-hour-cap.ts); a scan write error is
 * logged and the redirect stands.
 *
 * Structured log (SCAN_RECORDED) contains only aggregated signals: no raw
 * anon_id, no exact timestamp, no lat/lng.
 *
 * Vote codes (OSE-2133, OSE ADR-040 decision 6): `/q/<token>?type=vote`. When
 * the scan was stored or was a duplicate of one stored, the voting switch is
 * on (votingEnabled), the pepper is set, the token is the event's own vote code
 * (OSE-2140), the event's vote set is open and the event is Published
 * (OSE-2142), the visitor goes to
 * `/events/<id>/vote#t=<pass>` (lib/vote-pass.ts). The pass is only in the
 * fragment. A failed write, a missing pepper, an ordinary poster code, a closed set, an event that is not Published, or the switch off
 * mint none, and the code keeps today's redirect. This is
 * still the only place the cookie is read on the vote path (invariant 4). The
 * vote code alone keeps the cookie and a one-hour keyed marker (ADR-040), so a
 * repeat scan keeps its pass; its scans are never a published count.
 * Each pass minted counts toward the event's flood alarm (OSE-2234,
 * lib/vote-flood.ts): past a full room's minute the vote set is flagged, and
 * nothing is blocked.
 * NO LOG LINE names the redirect's Location, the pass or the voter key
 * (tests/e2e/0-architecture/votes-never-who.invariant.spec.ts).
 *
 * Hot-path guard: this file MUST NOT import h3-js. Geo tagging is an
 * admin/creation-time operation (see handlers/poster-deployments.ts). Adding
 * h3-js here would silently break the SCAN_PATH invariant in h3-tagging.spec.ts.
 */

import { eventLiveSql } from '../domain/event-state';
import { isValidQrTokenShape } from '../lib/qr-token';
import { getOrCreateAnonId, setAnonCookie, type AnonCookieValue } from '../lib/anonymous-id';
import { scanHourOf, takePosterHourPlace } from '../lib/poster-hour-cap';
import { enqueueOrWriteScan, scanDedupKey, type ScanMessage } from '../lib/scan-buffer';
import { scanNodeKey } from '../lib/scan-node-key';
import { issueVotePass, mintCrowdPass, votePageTarget, VOTE_CODE_TYPE } from '../lib/vote-pass';
import { onlinePickMayMint } from '../lib/vote-crowd';
import { votingEnabled } from '../lib/voting-switch';
import type { VotingSwitchEnv } from '../lib/voting-switch';
import { noteVotePassMinted, type VoteFloodLimiter } from '../lib/vote-flood';
import { voteCodeStampOk } from '../lib/vote-code-window';

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

export interface QrScanEnv extends VotingSwitchEnv {
  DB: D1Database;
  // OSE-1659: keys the scan id stored in scan_node_returns (lib/scan-node-key.ts).
  // Unset → the scan is stored with no id; the cookie value is never stored.
  ANON_ID_HASH_PEPPER?: string;
  RATE_LIMIT_KV?: KVNamespace;
  // Optional scan write-buffer. Bound → the hot path enqueues and returns;
  // unbound → the direct D1 batch (dark-launch parity). See lib/scan-buffer.ts.
  SCAN_QUEUE?: Queue<ScanMessage>;
  // OSE-2234: counts minted vote passes per event per minute, to flag a flood
  // (lib/vote-flood.ts). Detection only; unbound → nothing is flagged.
  VOTE_FLOOD_LIMITER?: VoteFloodLimiter;
  // OSE-2133: the voting switch comes from VotingSwitchEnv (lib/voting-switch.ts,
  // S3c). Only votingEnabled reads it; on, a vote code may mint a pass.
}

/** Hour-bucketed UTC timestamp string: the only time a scan row keeps. */
function scanBucket(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}:00`;
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

export async function handleQrScan(
  request: Request,
  env: QrScanEnv,
  qrToken: string,
  countable: boolean = true,
  // OSE-2234: with a context, flood detection runs after the answer is sent
  // (waitUntil), so it can never slow a vote redirect.
  ctx?: Pick<ExecutionContext, 'waitUntil'>
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
  // OSE-2144: a code on an event that is not live (draft, ready, archived) is
  // not found here, so it is answered as an unknown code below: home, no count,
  // no cookie, and no event id in the Location (eventLiveSql, the shared test).
  const lookupDeployment = () =>
    env.DB.prepare(
      `SELECT pd.id AS id, pd.event_id AS event_id, pd.is_vote_code AS is_vote_code
         FROM poster_deployments pd
         JOIN events e ON e.id = pd.event_id
        WHERE pd.qr_token = ? AND pd.is_active = 1 AND ${eventLiveSql('e')} LIMIT 1`
    )
      .bind(qrToken)
      .first<{ id: string; event_id: string; is_vote_code: number | null }>();
  let deployment: { id: string; event_id: string; is_vote_code: number | null } | null;
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
  const bucket = scanBucket(nowDate);
  const url = new URL(request.url);
  const isVoteCode = deployment.is_vote_code === 1;

  // OSE-2214 (owner, 2026-11-23; ADR-024 option C for scans): OSE counts the
  // traffic on the code, never the phone. A poster code neither reads nor sets
  // the ose_anon cookie, keeps no per-phone marker and stores no phone id:
  // every scan counts, up to POSTER_HOUR_CAP per poster per hour (OSE-1496),
  // which is the only guard. The room's vote code is the exception (ADR-040):
  // its pass still needs the cookie, and its scans are never a published count.
  let voterId: string | null = null;
  // The cookie to set: only on the vote code, and only for a browser without one.
  let newCookie: AnonCookieValue | null = null;
  let isDuplicate = false;
  let dedupKey: string | null = null;
  if (isVoteCode) {
    const { anonId, isNew, cookieValue } = await getOrCreateAnonId(
      request,
      env.ANON_ID_HASH_PEPPER
    );
    voterId = anonId;
    newCookie = isNew ? cookieValue : null;
    // The vote pass is one per voter: a repeat scan of the vote code in the
    // same hour is not written again, and keeps its pass (OSE-2133). The marker
    // is keyed, never the cookie value, and lives one hour.
    const scanKey = await scanNodeKey(anonId, env.ANON_ID_HASH_PEPPER);
    if (!scanKey) warnScanPepperMissing();
    if (env.RATE_LIMIT_KV) {
      const key = scanDedupKey(scanKey ?? anonId, deploymentId, bucket);
      try {
        if ((await env.RATE_LIMIT_KV.get(key)) !== null) {
          isDuplicate = true;
        } else {
          await env.RATE_LIMIT_KV.put(key, '1', { expirationTtl: 3600 });
          dedupKey = key;
        }
      } catch (err) {
        // The vote code is written without the check (OSE-1784, "keep voting
        // working"): its scans are never a published count.
        console.warn(
          JSON.stringify({
            type: 'SCAN_DEDUP_UNAVAILABLE',
            deployment_id: deploymentId,
            error: errorLabel(err),
          })
        );
      }
    }
  }

  // OSE-2133: a vote pass needs a stored scan; a duplicate is one.
  let scanStored = isDuplicate;

  // OSE-1496: at most POSTER_HOUR_CAP scans per poster per hour are counted.
  // Past the cap the visitor is sent on as usual and nothing is stored. The
  // room's vote code is not capped (lib/poster-hour-cap.ts).
  let overCap = false;
  if (!isVoteCode) {
    overCap = !(await takePosterHourPlace(env.DB, deploymentId, scanHourOf(bucket)));
    if (overCap) {
      console.log(JSON.stringify({ type: 'SCAN_NOT_COUNTED', reason: 'poster_hour_cap' }));
    }
  }

  if (!isDuplicate && !overCap) {
    try {
      // OSE-798: the placement event (WHERE) and the event-hour row are written
      // to SEPARATE tables. The write is buffered through SCAN_QUEUE when bound
      // so a scan spike can't throttle the hot path; unbound or on a queue
      // outage it falls straight to the direct D1 batch, so counts are never
      // lost (lib/scan-buffer.ts). OSE-2214: no phone id and no browser-name
      // hash ride in the message; the browser name is not read at all.
      const outcome = await enqueueOrWriteScan(env, {
        placement_row_id: `spe_${crypto.randomUUID()}`,
        return_row_id: `snr_${crypto.randomUUID()}`,
        event_id: eventId,
        deployment_id: deploymentId,
        anon_id: null,
        ua_hash: null,
        country: null, // rollback-safe wire field; never a real country (OSE-1460)
        scan_bucket: bucket,
      });
      scanStored = true;

      console.log(
        JSON.stringify({
          type: outcome === 'enqueued' ? 'SCAN_ENQUEUED' : 'SCAN_RECORDED',
          deployment_id: deploymentId,
          event_id: eventId,
          scan_bucket: bucket,
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
      // Nothing was stored, so release the vote code's hour marker: a retry in
      // the same hour must be able to record the scan and get its pass.
      if (dedupKey && env.RATE_LIMIT_KV) {
        await env.RATE_LIMIT_KV.delete(dedupKey).catch(() => {});
      }
    }
  }

  // Pass `?type=` through to the event page (e.g. ?type=checkin from the QR URL).
  // Also embed `?deployment=` so the event-page CTA can continue to the form
  // without losing sourcePlacementId attribution.
  let redirectTarget = qrScanTarget(
    url.origin,
    eventId,
    deploymentId,
    url.searchParams.get('type')
  );

  // OSE-2133: a vote code whose scan stands may carry a pass, in the fragment
  // only. A failure here (a D1 blip reading the set) mints none and the
  // visitor keeps today's redirect; the line names the failure, nothing else.
  // The rotating code (lib/vote-code-window.ts): a pass needs this minute's
  // stamp, or the last minute's, from the room screen. A photo of the code goes
  // stale within two minutes; a stale or missing stamp mints no pass, and the
  // scan stands as any other code's.
  if (
    voterId &&
    scanStored &&
    url.searchParams.get('type') === VOTE_CODE_TYPE &&
    (await voteCodeStampOk(env.ANON_ID_HASH_PEPPER, qrToken, url.searchParams.get('w'), nowMs))
  ) {
    let pass: string | null = null;
    try {
      pass = await issueVotePass(env, voterId, eventId, deploymentId, nowMs);
    } catch (err) {
      console.warn(JSON.stringify({ type: 'VOTE_PASS_SKIPPED', error: errorLabel(err) }));
    }
    if (pass) {
      redirectTarget = votePageTarget(url.origin, eventId, pass);
      // OSE-2234: count the pass toward the event's flood alarm. Detection
      // only: it never throws and never changes this answer. With a context it
      // runs after the answer, so a slow binding or D1 never delays the vote.
      const noted = noteVotePassMinted(env, eventId).then((wrote) => {
        // The one flood line: the event id and nothing else (OSE-2234).
        if (wrote) console.warn(JSON.stringify({ type: 'VOTE_FLOOD_SEEN', event_id: eventId }));
      });
      if (ctx) ctx.waitUntil(noted);
      else await noted;
    }
  }

  const redirectResponse = new Response(null, {
    status: 302,
    headers: {
      Location: redirectTarget,
      'Cache-Control': 'no-store',
    },
  });

  // Only the vote code sets the cookie, and only for a browser without one.
  if (newCookie) return setAnonCookie(redirectResponse, newCookie);
  return redirectResponse;
}

/**
 * GET /q/crowd/<eventId>: the way into the Online Pick (OSE ADR-040 decision
 * 13). The event page's "Vote in the Online Pick" link lands here, so the
 * anonymous cookie is still read only inside /q (AGENTS.md invariant 4).
 *
 * With voting on, the pepper set and the Online Pick open (onlinePickMayMint),
 * it mints a CROWD pass (lib/vote-pass.ts, mintCrowdPass: the crowd's own key
 * and seal, never a room pass) and sends the browser to
 * `/events/<id>/online-pick#t=<pass>`, the pass in the fragment only.
 * Otherwise it sends the browser to the event page, with no pass. It stores
 * no scan: an Online Pick visit is not a scan of anything, and is in no count.
 * It sets the cookie only for a browser without one, as the vote code does.
 * No log line names the event, the pass, the key or the Location.
 *
 * Dedup is one Online Pick vote per entry per browser. That is weak on purpose
 * and the page says so: anyone can open it many times from many browsers. The
 * Room Pick never reads anything this makes.
 */
export async function handleCrowdEntry(
  request: Request,
  env: QrScanEnv,
  eventId: string,
  nowMs: number = Date.now()
): Promise<Response> {
  const url = new URL(request.url);
  const home = (to: string) =>
    new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store' } });
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) return home('/events');
  const eventPage = `${url.origin}/events/${encodeURIComponent(eventId)}`;
  if (!env.DB || !votingEnabled(env) || !env.ANON_ID_HASH_PEPPER) return home(eventPage);
  let may = false;
  try {
    may = await onlinePickMayMint(env.DB, eventId);
  } catch (err) {
    console.warn(JSON.stringify({ type: 'CROWD_PASS_SKIPPED', error: errorLabel(err) }));
  }
  if (!may) return home(eventPage);
  const { anonId, isNew, cookieValue } = await getOrCreateAnonId(request, env.ANON_ID_HASH_PEPPER);
  const pass = await mintCrowdPass(env.ANON_ID_HASH_PEPPER, anonId, eventId, nowMs);
  const res = home(
    pass ? `${url.origin}/events/${encodeURIComponent(eventId)}/online-pick#t=${pass}` : eventPage
  );
  return isNew ? setAnonCookie(res, cookieValue) : res;
}
