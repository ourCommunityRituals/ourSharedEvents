/**
 * POST /api/v2/vote/:eventId: one vote (OSE-2128, S4a of OSE-1193; OSE ADR-040
 * decisions 4, 5 and 6).
 *
 *   request   Content-Type: application/json, Sec-Fetch-Site: same-origin
 *             {"object_id": "vobj_…", "side": "up" | "down", "pass": "vp1.…"}
 *   200       {"ok":true}      a counted vote and a duplicate, byte for byte
 *   400       {"ok":false,"code":"INVALID_VOTE"}      the body is not that shape
 *   403       {"ok":false,"code":"SAME_ORIGIN_ONLY"}  not from the voter page
 *   403       {"ok":false,"code":"PASS_REFUSED"}      scan the room's code again
 *   409       {"ok":false,"code":"NOT_OPEN"}          the object cannot take a vote now
 *   415       {"ok":false,"code":"JSON_ONLY"}         the body is not JSON
 *   503       {"ok":false,"code":"VOTE_UNAVAILABLE"}  no key here, or the database failed
 *
 * Public and anonymous, outside `/api/v2/events*`, on the `DB` side. The router
 * routes it only while VOTING_ENABLED is "on" (lib/voting-switch.ts); with the
 * switch off the path is the router's own 404, as if voting did not exist. This
 * handler asks the switch again, so it refuses whoever calls it.
 *
 * NO BROWSER ID (D3 reversed, 2026-11-18). This file and lib/vote-cast.ts read
 * no request header but Content-Type and Sec-Fetch-Site, and set no header but
 * the four below. Presence is the pass from `/q`, in the JSON body; `/q` stays
 * the only reader of the anonymous id on the vote path (AGENTS.md invariant 4).
 * T0 gate: tests/e2e/0-architecture/votes-never-who.invariant.spec.ts.
 *
 * WHAT AN ANSWER CARRIES. A fixed body per outcome: no count, no id, no time,
 * no request id. A counted vote and a duplicate get the same status, headers
 * and bytes, so the answer cannot say whether this voter had voted before.
 *
 * WHAT A LOG LINE CARRIES. Only a database failure is logged, with its class
 * (errorLabel). Never the object, the side, the event, the pass, the voter key
 * or a receipt. The cost line for this route carries no row counts
 * (lib/cost-metric.ts), since rows written differ for a counted vote and a
 * duplicate.
 *
 * NOT HERE (S4c, OSE-2134): the route limit (lib/public-read-limit.ts), the
 * route classification, the threat-ledger entry. The router wraps this handler
 * where it is routed, so the limit lands there without a change here.
 */

import { errorLabel } from '../lib/error-label';
import { castVote, isVoteSide, type CastOutcome } from '../lib/vote-cast';
import { votingEnabled, type VotingSwitchEnv } from '../lib/voting-switch';

export interface VoteEnv extends VotingSwitchEnv {
  DB?: D1Database;
  ANON_ID_HASH_PEPPER?: string;
}

/** An event id the route will look up; anything else is not open. */
const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** An object id as lib/vote-sets.ts makes it (`vobj_` and hex), with room to spare. */
const OBJECT_ID = /^[A-Za-z0-9_-]{1,80}$/;
/** A vote body is three short fields; a pass is at most 512 characters (lib/vote-pass.ts). */
const BODY_MAX = 2048;
const FIELDS = ['object_id', 'pass', 'side'];

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
} as const;

type Code =
  | 'INVALID_VOTE'
  | 'SAME_ORIGIN_ONLY'
  | 'PASS_REFUSED'
  | 'NOT_OPEN'
  | 'JSON_ONLY'
  | 'VOTE_UNAVAILABLE'
  | 'NOT_FOUND';

/** The one body for a vote that was taken, counted or not. */
const ACCEPTED_BODY = '{"ok":true}';

function accepted(): Response {
  return new Response(ACCEPTED_BODY, { status: 200, headers: HEADERS });
}

function refused(status: number, code: Code): Response {
  return new Response(`{"ok":false,"code":"${code}"}`, { status, headers: HEADERS });
}

const BY_OUTCOME: Record<Exclude<CastOutcome, 'accepted'>, [number, Code]> = {
  not_open: [409, 'NOT_OPEN'],
  pass_refused: [403, 'PASS_REFUSED'],
  unavailable: [503, 'VOTE_UNAVAILABLE'],
};

interface VoteBody {
  object_id: string;
  side: 'up' | 'down';
  pass: string;
}

/** The body, exactly three fields of the right shape, or null. */
function parseBody(text: string): VoteBody | null {
  if (text.length > BODY_MAX) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const keys = Object.keys(b).sort();
  if (keys.length !== FIELDS.length || keys.some((k, i) => k !== FIELDS[i])) return null;
  if (typeof b.object_id !== 'string' || !OBJECT_ID.test(b.object_id)) return null;
  if (!isVoteSide(b.side)) return null;
  if (typeof b.pass !== 'string' || !b.pass) return null;
  return { object_id: b.object_id, side: b.side, pass: b.pass };
}

const isJson = (request: Request) =>
  (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase() ===
  'application/json';

/** Serve one vote for the event in the path. */
export async function handleVote(
  request: Request,
  env: VoteEnv,
  eventId: string
): Promise<Response> {
  if (!votingEnabled(env) || request.method !== 'POST') return refused(404, 'NOT_FOUND');
  if (request.headers.get('Sec-Fetch-Site') !== 'same-origin')
    return refused(403, 'SAME_ORIGIN_ONLY');
  if (!isJson(request)) return refused(415, 'JSON_ONLY');
  const length = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(length) && length > BODY_MAX) return refused(400, 'INVALID_VOTE');
  const body = parseBody(await request.text());
  if (!body) return refused(400, 'INVALID_VOTE');
  if (!EVENT_ID.test(eventId)) return refused(409, 'NOT_OPEN');
  const db = env.DB;
  if (!db) return refused(503, 'VOTE_UNAVAILABLE');
  try {
    const outcome = await castVote(db, env.ANON_ID_HASH_PEPPER, {
      eventId,
      objectId: body.object_id,
      side: body.side,
      pass: body.pass,
      nowMs: Date.now(),
    });
    if (outcome === 'accepted') return accepted();
    const [status, code] = BY_OUTCOME[outcome];
    return refused(status, code);
  } catch (err) {
    console.error(JSON.stringify({ type: 'VOTE_WRITE_ERROR', error: errorLabel(err) }));
    return refused(503, 'VOTE_UNAVAILABLE');
  }
}
