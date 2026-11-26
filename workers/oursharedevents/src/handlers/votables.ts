/**
 * The admin side of voting (OSE-2127, S3 of OSE-1193; OSE ADR-040 decisions 3,
 * 4 and 10): a host makes the event's vote set, adds what can be voted on, and
 * opens, closes and reopens them.
 *
 *   GET  /api/v2/admin/events/:id/votables                        the set, its objects, whether
 *                                                                 the event is live, the vote code
 *   POST /api/v2/admin/events/:id/votables                        make the set { played_by }
 *   POST /api/v2/admin/events/:id/votables/code                   make the room's vote code, or
 *                                                                 return the one in use (OSE-2140)
 *   POST /api/v2/admin/events/:id/votables/code/replace           retire it and make a new token
 *   POST /api/v2/admin/events/:id/votables/open                   first open { room_size } (stamps the epoch, draws T and V, fixes the room size)
 *   POST /api/v2/admin/events/:id/votables/reopen                 reopen a closed set
 *   POST /api/v2/admin/events/:id/votables/close                  close the set
 *   POST /api/v2/admin/events/:id/votables/finalize               compute the night's result and make
 *                                                                 the set final (a closed set, or one
 *                                                                 that never opened; OSE-2130)
 *   POST /api/v2/admin/events/:id/votables/objects                add an object { kind, label, ... }
 *   PUT  /api/v2/admin/events/:id/votables/objects/:oid           change an object
 *   POST /api/v2/admin/events/:id/votables/objects/:oid/open      open it { window_seconds? }
 *   POST /api/v2/admin/events/:id/votables/objects/:oid/reopen    reopen it { window_seconds? }
 *   POST /api/v2/admin/events/:id/votables/objects/:oid/close     close it
 *   GET  /api/v2/admin/events/:id/votables/access-passes          the Access Passes given, and how
 *                                                                 many remain (decision 13)
 *   POST /api/v2/admin/events/:id/votables/access-passes          give one; its link is shown once
 *   POST /api/v2/admin/events/:id/votables/access-passes/:pid/revoke  revoke one, for good
 *   POST /api/v2/admin/events/:id/votables/online-pick            { on: true | false } (decision 13)
 *
 * THE BRAND WALL. Every route is under /api/v2/admin/events/:id, so the
 * router's guardAdminObjectScope has proved the event is in the caller's brand
 * scope, and the admin write guard has checked each write. An object is read
 * and written only with the path event bound (`WHERE id = ? AND event_id = ?`),
 * so an object of another event answers the same 404 as one that does not
 * exist. The router audits every write against the event.
 *
 * WHAT AN ANSWER CARRIES. The set: id, event, state, play mode, whether it has
 * opened, whether it is final. An object: id, kind, label, booth, team, state,
 * closes_at, open_now, sort. Never a counter, T, V, the epoch, the void flag, a
 * receipt or a marker (lib/vote-sets.ts projects them; tests/vote-set-admin.spec.ts
 * reads every answer for a guarded key). No log line here carries any of them.
 * The list also says `event_live` (OSE-2142: the card greys out Open on an
 * event that is not Published) and `code`, the room's vote code: its placement
 * id, its URL and a QR of it, or null (OSE-2140, lib/vote-code.ts). The code's
 * URL is for the admin only: no public answer carries it.
 *
 * NOT SWITCHED. None of these routes reads VOTING_ENABLED: a host sets a night
 * up while voting is off (owner, 2026-11-18), and nothing here counts or shows
 * a vote.
 */

import { corsHeaders } from '../lib/cors';
import { makeVoteCode, readVoteCode, replaceVoteCode } from '../lib/vote-code';
import { errorLabel } from '../lib/error-label';
import { giveAccessPass, listAccessPasses, revokeAccessPass } from '../lib/vote-access-pass';
import { readOnlinePick, setOnlinePick } from '../lib/vote-crowd';
import {
  adminFinalizeVoteSet,
  closeVoteSet,
  createVotable,
  createVoteSet,
  listVotables,
  moveVotable,
  openVoteSet,
  parseVotableCreate,
  parseVotableUpdate,
  parseWindow,
  reopenVoteSet,
  updateVotable,
  votableKind,
  NO_OBJECT,
  type ObjectMove,
  type VoteFail,
  type VoteResult,
} from '../lib/vote-sets';

export interface VotablesEnv {
  DB?: D1Database;
  ANON_ID_HASH_PEPPER?: string;
}

/** One admin votables route: what it does, and the audit action for a write. */
export interface VotablesRoute {
  op:
    | 'list'
    | 'create-set'
    | 'create-code'
    | 'replace-code'
    | 'open-set'
    | 'reopen-set'
    | 'close-set'
    | 'finalize-set'
    | 'create-object'
    | 'update-object'
    | 'open-object'
    | 'reopen-object'
    | 'close-object'
    | 'list-access'
    | 'give-access'
    | 'revoke-access'
    | 'online-pick';
  objectId?: string;
  /** null for a read, which is not audited. */
  action: string | null;
}

const SET_OPS: Record<string, VotablesRoute['op']> = {
  open: 'open-set',
  reopen: 'reopen-set',
  close: 'close-set',
  finalize: 'finalize-set',
};
const OBJECT_OPS: Record<string, VotablesRoute['op']> = {
  open: 'open-object',
  reopen: 'reopen-object',
  close: 'close-object',
};
const ACTIONS: Record<VotablesRoute['op'], string | null> = {
  list: null,
  'create-set': 'VOTE_SET_CREATE',
  'create-code': 'VOTE_CODE_CREATE',
  'replace-code': 'VOTE_CODE_REPLACE',
  'open-set': 'VOTE_SET_OPEN',
  'reopen-set': 'VOTE_SET_REOPEN',
  'close-set': 'VOTE_SET_CLOSE',
  'finalize-set': 'VOTE_SET_FINALIZE',
  'create-object': 'VOTABLE_CREATE',
  'update-object': 'VOTABLE_UPDATE',
  'open-object': 'VOTABLE_OPEN',
  'reopen-object': 'VOTABLE_REOPEN',
  'close-object': 'VOTABLE_CLOSE',
  // ADR-040 decision 13: each give and revoke is in the audit log with the
  // admin's identity and the hour. Never the recipient: there is none to write.
  'list-access': null,
  'give-access': 'VOTE_ACCESS_PASS_GIVE',
  'revoke-access': 'VOTE_ACCESS_PASS_REVOKE',
  'online-pick': 'VOTE_ONLINE_PICK_SET',
};

/**
 * Which route `method` and the path after `/votables` name. Pure, so the router
 * can audit by it. Null: no such route (the router answers its own 404).
 */
export function matchVotablesRoute(method: string, rest: string): VotablesRoute | null {
  const parts = rest.split('/').filter(Boolean);
  const make = (op: VotablesRoute['op'], objectId?: string): VotablesRoute => ({
    op,
    objectId,
    action: ACTIONS[op],
  });
  if (parts.length === 0) {
    if (method === 'GET') return make('list');
    if (method === 'POST') return make('create-set');
    return null;
  }
  if (parts.length === 1 && parts[0] === 'access-passes') {
    if (method === 'GET') return make('list-access');
    if (method === 'POST') return make('give-access');
    return null;
  }
  if (parts.length === 3 && parts[0] === 'access-passes' && parts[2] === 'revoke')
    return method === 'POST' ? make('revoke-access', parts[1]) : null;
  if (parts.length === 1 && method === 'POST') {
    if (parts[0] === 'online-pick') return make('online-pick');
    if (parts[0] === 'objects') return make('create-object');
    if (parts[0] === 'code') return make('create-code');
    const op = SET_OPS[parts[0]];
    return op ? make(op) : null;
  }
  if (parts.length === 2 && method === 'POST' && parts[0] === 'code' && parts[1] === 'replace')
    return make('replace-code');
  if (parts[0] !== 'objects') return null;
  if (parts.length === 2 && method === 'PUT') return make('update-object', parts[1]);
  if (parts.length === 3 && method === 'POST') {
    const op = OBJECT_OPS[parts[2]];
    return op ? make(op, parts[1]) : null;
  }
  return null;
}

function requestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function reply(request: Request, status: number, body: Record<string, unknown>): Response {
  const rid = requestId();
  return Response.json(
    { ok: status < 400, status, ...body, requestId: rid, timestamp: new Date().toISOString() },
    {
      status,
      headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid },
    }
  );
}

const refuse = (request: Request, f: VoteFail) =>
  reply(request, f.status, { code: f.code, error: f.error });

function answer<T>(request: Request, r: VoteResult<T>, key: string, status = 200): Response {
  return r.ok ? reply(request, status, { [key]: r.value }) : refuse(request, r);
}

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const text = await request.text();
  if (!text.trim()) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

const badJson = (request: Request) =>
  reply(request, 400, { code: 'INVALID_JSON', error: 'The body is not JSON' });

/** Serve one admin votables route for the event in the path. */
export async function handleVotables(
  request: Request,
  env: VotablesEnv,
  eventId: string,
  route: VotablesRoute
): Promise<Response> {
  const db = env.DB;
  if (!db)
    return reply(request, 503, { code: 'DB_NOT_CONFIGURED', error: 'Database not available' });
  try {
    const event = await db
      .prepare(`SELECT 1 AS hit FROM events WHERE id = ?`)
      .bind(eventId)
      .first();
    if (!event)
      return reply(request, 404, { code: 'NOT_FOUND', error: `Event not found: ${eventId}` });
    const nowIso = new Date().toISOString();

    const origin = new URL(request.url).origin;
    // The vote code's URL carries this minute's stamp (lib/vote-code-window.ts).
    const clock = { pepper: env.ANON_ID_HASH_PEPPER, nowMs: Date.parse(nowIso) };
    if (route.op === 'list') {
      const { set, objects, event_live } = await listVotables(db, eventId);
      const code = await readVoteCode(db, eventId, origin, clock);
      const online_pick = await readOnlinePick(db, eventId);
      return reply(request, 200, { set, objects, event_live, code, online_pick });
    }
    if (route.op === 'list-access')
      return answer(request, await listAccessPasses(db, eventId), 'access');

    const parsed = await readJson(request);
    if (!parsed.ok) return badJson(request);
    const body = parsed.body;

    switch (route.op) {
      case 'create-set': {
        const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
        const extra = Object.keys(b).filter((k) => k !== 'played_by');
        if (extra.length)
          return reply(request, 400, {
            code: 'UNKNOWN_FIELD',
            error: `Not a field of a vote set: ${extra.join(', ')}`,
          });
        const playedBy = b.played_by ?? 'object';
        if (playedBy !== 'object' && playedBy !== 'team')
          return reply(request, 400, {
            code: 'INVALID_PLAYED_BY',
            error: 'played_by must be object or team',
          });
        return answer(request, await createVoteSet(db, eventId, playedBy), 'set', 201);
      }
      case 'create-code': {
        const { made, code } = await makeVoteCode(db, eventId, origin, clock);
        return reply(request, made ? 201 : 200, { code });
      }
      case 'give-access': {
        // No field is taken: a pass has no name, note or reason to type.
        const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
        if (Object.keys(b).length)
          return reply(request, 400, {
            code: 'UNKNOWN_FIELD',
            error: 'An Access Pass takes no details',
          });
        return answer(
          request,
          await giveAccessPass(db, env.ANON_ID_HASH_PEPPER, eventId, origin),
          'access_pass',
          201
        );
      }
      case 'revoke-access':
        return answer(
          request,
          await revokeAccessPass(db, eventId, route.objectId ?? ''),
          'access_pass'
        );
      case 'online-pick': {
        const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
        const extra = Object.keys(b).filter((k) => k !== 'on');
        if (extra.length || typeof b.on !== 'boolean')
          return reply(request, 400, {
            code: 'INVALID_ONLINE_PICK',
            error: 'Send { on: true } or { on: false }',
          });
        return answer(
          request,
          await setOnlinePick(db, eventId, b.on, env.ANON_ID_HASH_PEPPER, nowIso),
          'online_pick'
        );
      }
      case 'replace-code':
        return reply(request, 201, { code: await replaceVoteCode(db, eventId, origin, clock) });
      case 'open-set': {
        // The first open takes the room size, once (2026-11-26): it is fixed
        // from then on, and the room size check at final reads it.
        const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
        const extra = Object.keys(b).filter((k) => k !== 'room_size');
        if (extra.length)
          return reply(request, 400, {
            code: 'UNKNOWN_FIELD',
            error: `Not a field of opening a vote set: ${extra.join(', ')}`,
          });
        return answer(
          request,
          await openVoteSet(db, eventId, env.ANON_ID_HASH_PEPPER, nowIso, b.room_size),
          'set'
        );
      }
      case 'reopen-set':
        return answer(
          request,
          await reopenVoteSet(db, eventId, env.ANON_ID_HASH_PEPPER, nowIso),
          'set'
        );
      case 'close-set':
        return answer(request, await closeVoteSet(db, eventId, nowIso), 'set');
      case 'finalize-set':
        return answer(request, await adminFinalizeVoteSet(db, eventId, nowIso), 'set');
      case 'create-object': {
        const input = parseVotableCreate(body);
        if (!input.ok) return refuse(request, input);
        return answer(request, await createVotable(db, eventId, input.value), 'object', 201);
      }
      case 'update-object': {
        const patch = parseVotableUpdate(body);
        if (!patch.ok) return refuse(request, patch);
        return answer(
          request,
          await updateVotable(db, eventId, route.objectId ?? '', patch.value, nowIso),
          'object'
        );
      }
      case 'open-object':
      case 'reopen-object':
      case 'close-object': {
        const move = route.op.replace('-object', '') as ObjectMove;
        const kind = await votableKind(db, eventId, route.objectId ?? '');
        if (!kind) return refuse(request, NO_OBJECT);
        // Only an open takes a window: close and reopen are refused as WINDOW_FIXED.
        const window = move === 'open' ? parseWindow(body, kind) : { ok: true as const, value: 0 };
        if (!window.ok) return refuse(request, window);
        return answer(
          request,
          await moveVotable(db, eventId, route.objectId ?? '', move, window.value, nowIso),
          'object'
        );
      }
      default:
        return reply(request, 404, { code: 'NOT_FOUND', error: 'Not found' });
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleVotables',
        op: route.op,
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return reply(request, 503, { code: 'DB_ERROR', error: 'The vote set could not be saved' });
  }
}
