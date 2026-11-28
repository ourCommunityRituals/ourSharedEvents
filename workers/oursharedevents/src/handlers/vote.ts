/**
 * POST /api/v2/vote/:eventId: one vote (OSE-2128, S4a of OSE-1193; OSE
 * ADR-040 decisions 1 to 6 and 9).
 *
 *   body   {"object_id": "vob_…", "side": "up" | "down", "pass": "vp1.…"}, and
 *          nothing else: a body with another field is refused (400)
 *   200    {"ok": true}                       counted, or already counted
 *   4xx    {"ok": false, "code": "…", "error": "…"}
 *
 * Public and anonymous, for the voter page (S4b). It sits outside
 * `/api/v2/events*`, on the `DB` side. The router routes it only for POST and
 * only while `VOTING_ENABLED` is on (lib/voting-switch.ts); off, the path does
 * not exist.
 *
 * IT READS NO BROWSER STATE. The voter is known only by the pass `/q` minted
 * (lib/vote-pass.ts), carried in the body. This file names no request header
 * but Content-Type, Sec-Fetch-Site and Origin, and sets no header but the
 * answer's own. The T0 gate (votes-never-who, rule 10) holds that it never
 * reads the anonymous token.
 *
 * THE CHECKS, IN ORDER:
 *   1. the body is JSON, and the request is same-origin: `Sec-Fetch-Site:
 *      same-origin`, or, from a browser too old to send it, an `Origin` equal
 *      to this site's (the admin write guard's rule);
 *   2. the pepper is set (no unkeyed fallback);
 *   3. the pass: its seal (constant time), its shape, its expiry, the epoch
 *      running now, and this event (openVotePass);
 *   4. the object and its set, inside the write (lib/vote-cast.ts).
 * A refused vote writes nothing. When the refusal is the set's own epoch, the
 * set is marked void (decision 6).
 *
 * THE ANSWER CARRIES NO COUNT. Counted and duplicate get the same bytes, and
 * this file cannot tell them apart: castVote returns `accepted` for both. No
 * answer says how many, which side, or whether this voter voted before. No log
 * line carries the object, the side, the event, the pass, k or a receipt; a
 * failure logs its type and an error label only.
 */

import { pepperEpoch } from '../lib/anon-id-hash';
import { errorLabel } from '../lib/error-label';
import { openCrowdPass, openVotePass } from '../lib/vote-pass';
import { castVote, VOTE_SIDES, type VoteSide } from '../lib/vote-cast';
import { voidOnEpochChange } from '../lib/vote-sets';
import { accessPassUsable } from '../lib/vote-access-pass';
import { castCrowdVote } from '../lib/vote-crowd';
import { guardTurnstile, ONLINE_PICK_TURNSTILE_ACTION, type TurnstileEnv } from '../lib/turnstile';

export interface VoteEnv extends TurnstileEnv {
  DB?: D1Database;
  ANON_ID_HASH_PEPPER?: string;
}

/** A body longer than this is not a vote. */
const MAX_BODY = 2048;
const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const OBJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** The body's only fields. Another field is refused, never ignored. */
const BODY_FIELDS: ReadonlySet<string> = new Set(['object_id', 'side', 'pass']);

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
} as const;

/** The one answer for a vote that counts, now or before. */
const COUNTED = '{"ok":true}';

function answer(status: number, code: string, error: string): Response {
  return new Response(JSON.stringify({ ok: false, code, error }), {
    status,
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
  });
}

const SCAN_AGAIN = 'Scan the code on the screen again.';
const OPEN_AGAIN = 'Open the Online Pick from the event page again.';

/** Same-origin, by Sec-Fetch-Site, or by Origin when a browser sends no Sec-Fetch-Site. */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null) return site.trim().toLowerCase() === 'same-origin';
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function isJson(request: Request): boolean {
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

interface VoteBody {
  object_id: string;
  side: VoteSide;
  pass: string;
}

async function readBody(request: Request): Promise<VoteBody | null> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > MAX_BODY) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  // Exactly the three fields the voter page sends; anything more is not a vote.
  if (Object.keys(b).some((key) => !BODY_FIELDS.has(key))) return null;
  if (typeof b.object_id !== 'string' || !OBJECT_ID.test(b.object_id)) return null;
  if (typeof b.side !== 'string' || !(VOTE_SIDES as readonly string[]).includes(b.side))
    return null;
  if (typeof b.pass !== 'string' || !b.pass) return null;
  return { object_id: b.object_id, side: b.side as VoteSide, pass: b.pass };
}

export async function handleVote(
  request: Request,
  env: VoteEnv,
  eventId: string,
  nowMs: number = Date.now()
): Promise<Response> {
  if (request.method !== 'POST') return answer(405, 'METHOD_NOT_ALLOWED', 'Votes are POSTed');
  if (!isJson(request)) return answer(415, 'JSON_ONLY', 'A vote is sent as JSON');
  if (!sameOrigin(request))
    return answer(403, 'SAME_ORIGIN_ONLY', 'A vote comes from the vote page');
  if (!EVENT_ID.test(eventId)) return answer(403, 'VOTE_PASS_INVALID', SCAN_AGAIN);
  const db = env.DB;
  const pepper = env.ANON_ID_HASH_PEPPER;
  const epoch = await pepperEpoch(pepper);
  if (!db || !pepper || !epoch)
    return answer(503, 'VOTING_UNAVAILABLE', 'Voting is not available right now');
  const body = await readBody(request);
  if (!body) return answer(400, 'INVALID_VOTE', 'A vote names an object, a side and a pass');
  const claims = await openVotePass(pepper, body.pass, nowMs, eventId);
  if (!claims) return answer(403, 'VOTE_PASS_INVALID', SCAN_AGAIN);
  try {
    // ADR-040 decision 13: a pass redeemed from an Access Pass votes only while
    // that Access Pass is not revoked, so a revoke stops it at once. The vote
    // itself is counted exactly like any other: nothing below knows.
    if (claims.access_id && !(await accessPassUsable(db, eventId, claims.access_id)))
      return answer(403, 'VOTE_PASS_INVALID', SCAN_AGAIN);
    const outcome = await castVote(db, pepper, {
      eventId,
      objectId: body.object_id,
      side: body.side,
      k: claims.k,
      epoch,
      nowMs,
      accessId: claims.access_id ?? null,
    });
    if (outcome === null)
      return answer(503, 'VOTING_UNAVAILABLE', 'Voting is not available right now');
    if (outcome === 'closed') {
      await voidOnEpochChange(db, eventId, epoch);
      return answer(409, 'VOTE_CLOSED', 'Voting on this is closed');
    }
    return new Response(COUNTED, {
      status: 200,
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleVote',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return answer(503, 'VOTING_UNAVAILABLE', 'Voting is not available right now');
  }
}

/**
 * POST /api/v2/vote/:eventId/crowd: one Online Pick vote (ADR-040 decision 13).
 * The room route's checks, in the same order, with the crowd's own pass
 * (openCrowdPass: another prefix, another seal) and the crowd's own write
 * (lib/vote-crowd.ts). A room pass is refused here and a crowd pass is refused
 * by the room route, so neither channel can vote in the other.
 */
export async function handleCrowdVote(
  request: Request,
  env: VoteEnv,
  eventId: string,
  nowMs: number = Date.now()
): Promise<Response> {
  if (request.method !== 'POST') return answer(405, 'METHOD_NOT_ALLOWED', 'Votes are POSTed');
  if (!isJson(request)) return answer(415, 'JSON_ONLY', 'A vote is sent as JSON');
  if (!sameOrigin(request))
    return answer(403, 'SAME_ORIGIN_ONLY', 'A vote comes from the vote page');
  if (!EVENT_ID.test(eventId)) return answer(403, 'VOTE_PASS_INVALID', OPEN_AGAIN);
  const db = env.DB;
  const pepper = env.ANON_ID_HASH_PEPPER;
  const epoch = await pepperEpoch(pepper);
  if (!db || !pepper || !epoch)
    return answer(503, 'VOTING_UNAVAILABLE', 'Voting is not available right now');
  const body = await readBody(request);
  if (!body) return answer(400, 'INVALID_VOTE', 'A vote names an object, a side and a pass');
  const claims = await openCrowdPass(pepper, body.pass, nowMs, eventId);
  if (!claims) return answer(403, 'VOTE_PASS_INVALID', OPEN_AGAIN);
  // The bot check (owner, 2026-11-28, ADR-040 decision 13, D3): after the pass,
  // so a forged pass never costs a siteverify call, and before any write. The
  // token rides in the cf-turnstile-response header, so the body stays exactly
  // three fields on both routes. Off while TURNSTILE_ENABLED is not "true".
  const botDeny = await guardTurnstile(request, env, ONLINE_PICK_TURNSTILE_ACTION);
  if (botDeny) return botDeny;
  try {
    const outcome = await castCrowdVote(db, pepper, {
      eventId,
      objectId: body.object_id,
      side: body.side,
      k: claims.k,
      epoch,
      nowMs,
    });
    if (outcome === null)
      return answer(503, 'VOTING_UNAVAILABLE', 'Voting is not available right now');
    if (outcome === 'closed') return answer(409, 'VOTE_CLOSED', 'Voting on this is closed');
    return new Response(COUNTED, {
      status: 200,
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleCrowdVote',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return answer(503, 'VOTING_UNAVAILABLE', 'Voting is not available right now');
  }
}
