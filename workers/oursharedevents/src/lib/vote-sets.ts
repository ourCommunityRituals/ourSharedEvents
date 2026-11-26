/**
 * The vote set and its objects: open, close, reopen and the final lock
 * (OSE-2127, S3 of OSE-1193; OSE ADR-040 decisions 3, 4, 6, 7 and 10).
 *
 * Every SQL statement that writes `vote_sets` or `votable_objects` lives in this
 * file, so the gates read one place (tests/e2e/0-architecture/
 * votes-never-who.invariant.spec.ts lists it on VOTE_TABLE_FILES and
 * SECRET_READERS).
 *
 * THE RULES THIS FILE HOLDS
 *
 *   - One set per event (UNIQUE(event_id) in 0111). Opening it is what turns
 *     voting on (D6 = A). It is played by objects or by teams, fixed at create.
 *   - First open. The set moves draft → open, and in the same statement the
 *     pepper epoch is stamped and the secret margin T (5 to 9) and the secret
 *     voter floor V (10 to 14) are drawn. The WHERE says `pepper_epoch IS NULL`,
 *     so none of the three is ever written again: not at a reopen, not by a
 *     retry. With no pepper there is no epoch, and the set does not open.
 *   - Reopen. A closed set or object may open again while the event is still on
 *     and the set is not final (C3). The epoch, T and V stay as they are. A
 *     reopen is refused when the pepper now running is not the one stamped: a
 *     vote could never count there (decision 6).
 *   - The final lock (Q10). `is_final` only ever becomes 1. Every write to an
 *     object, and every open or reopen, carries `is_final = 0` in its WHERE, so
 *     nothing reopens a final set or adds to it. Nothing here reads the event's
 *     dates to undo final, so a date change cannot.
 *   - The event is still on while its last date (end date, else start date) is
 *     yesterday or later, UTC, or it has no date. The one day of grace keeps an
 *     evening event west of UTC open until its night is over. The same rule
 *     decides when a registrant's contact is cleared (src/index.ts).
 *   - Nothing is more live than its container (OSE-2142, S3e; owner,
 *     2026-11-18). Open, reopen, opening an object, and adding an object to a
 *     set that has opened all need the event live: Published (listed or
 *     unlisted) and on its dates (EVENT_LIVE, lib/event-live.ts). Setting up
 *     stays allowed on a draft or ready event: make the set, add objects while
 *     the set is still in draft, edit them. When the event leaves Published,
 *     its open set closes in the same D1 batch as the status change, one
 *     transaction (closeVoteSetUnlessPublished, batched by the admin edit and
 *     the QR verify undo), and a host reopens it once the event is Published
 *     again. The nightly job closes any set a write outside the app left open,
 *     and the pass and the public read refuse such a set anyway. A refusal for
 *     an event that is on but not Published says EVENT_NOT_PUBLISHED.
 *   - The room's vote code (OSE-2140, S3d). voteCodeMayMint is the one check
 *     /q asks before it mints a pass: the scanned placement is the event's vote
 *     code in use, the set is open and not final, and the event is live, in one
 *     statement.
 *   - A song's window. `closes_at` is set by the server when an object opens:
 *     now plus a window, never more than VOTE_WINDOW_MAX_SECONDS. It names the
 *     song's window, never a voter (decision 3).
 *   - A team is fixed once the set first opens: a song's `group_id` changes only
 *     while `pepper_epoch IS NULL` (Q16).
 *   - A booth must be a booth of the same event, in use (S2 review, "Booths").
 *
 * FINAL AND THE RESULT (S5, OSE-2130). Decision 4: computing the results sets
 * final. finalizeVoteSet runs lib/vote-results.ts resultStatements in the same
 * D1 batch, ahead of the statement that sets is_final, nulls T and V and the
 * deletes of the receipts and markers, all under one guard: the night's
 * outcome is decided inside SQL from numbers that never reach the Worker, and
 * written in the same transaction that destroys them. A set that never opened,
 * or is void, becomes final with no outcome. An admin may compute the result of
 * a set that never opened or is closed (never of an open one: close voting
 * first); the nightly job makes every due set final.
 *
 * NO NUMBER, NO SECRET. Nothing here reads a counter, reads T or V, or returns
 * them. T and V are written once, by the first open, and set to null by final.
 * No log line carries a set's state beyond its id and an error label.
 */

import { pepperEpoch } from './anon-id-hash';
import { EVENT_LIVE, EVENT_ON_ITS_DATES, EVENT_PUBLISHED, eventIsLive } from './event-live';
import { eventLiveSql } from '../domain/event-state';
import { hourStamp } from './scan-buffer';
import { isVotableKind, isVoteTeamId, parseVotableLabel, type VotableKind } from './votes';
import { resultStatements, type VoteOutcome } from './vote-results';

/** The longest window an object can be open for in one go: 12 hours (a fair day). */
export const VOTE_WINDOW_MAX_SECONDS = 12 * 60 * 60;
/** The shortest: 30 seconds. */
export const VOTE_WINDOW_MIN_SECONDS = 30;
/**
 * With no window given: 10 minutes for a song (longer than the 7:11 song), a
 * fair day for a stall, and the whole event for an entry, as a stall's
 * (ADR-040 decision 12).
 */
export const VOTE_WINDOW_DEFAULT_SECONDS: Record<VotableKind, number> = {
  song: 10 * 60,
  stall: VOTE_WINDOW_MAX_SECONDS,
  entry: VOTE_WINDOW_MAX_SECONDS,
};
/** The most objects one set holds. */
export const VOTE_OBJECTS_MAX = 500;
/** The nightly job makes final a set left this many days after its event (ADR-040 decision 4). */
export const VOTE_FINAL_AFTER_DAYS = 7;
/** Tallies are deleted this many days after final (decision 1). */
export const VOTE_TALLY_KEEP_DAYS = 30;

/** The range of the secret margin T and the secret voter floor V (decision 7). */
export const SECRET_MARGIN_RANGE = [5, 9] as const;
export const SECRET_FLOOR_RANGE = [10, 14] as const;

export type VoteFail = { ok: false; status: number; code: string; error: string };
export type VoteResult<T> = { ok: true; value: T } | VoteFail;

const fail = (status: number, code: string, error: string): VoteFail => ({
  ok: false,
  status,
  code,
  error,
});

export const NO_SET = fail(404, 'VOTE_SET_NOT_FOUND', 'This event has no vote set');
export const NO_OBJECT = fail(404, 'VOTABLE_NOT_FOUND', 'Votable object not found');
const FINAL = fail(
  409,
  'VOTE_SET_FINAL',
  'The vote set is final; nothing reopens it or adds to it'
);
/** A label is fixed once the set has opened (2026-11-26): a rename would move votes to another name. */
const LABEL_FIXED = fail(
  409,
  'LABEL_FIXED',
  'A name is fixed once voting has opened, so votes stay with what was voted for'
);
const EVENT_OVER = fail(409, 'EVENT_OVER', 'The event is over; voting cannot open again');
/** OSE-2142: the event is on but not Published. The admin card says "Publish the event to open voting." */
export const EVENT_NOT_PUBLISHED = fail(
  409,
  'EVENT_NOT_PUBLISHED',
  'Publish the event to open voting'
);

/** What the admin sees of a set. No epoch value, no void flag, no counter, no T or V. */
export interface VoteSetView {
  id: string;
  event_id: string;
  state: 'draft' | 'open' | 'closed';
  played_by: 'object' | 'team';
  opened: boolean;
  final: boolean;
  /**
   * The night's result once the set is final and opened and is not void
   * (OSE-2130): the outcome, and the winner's id on a won night. Never a
   * count, a margin, a voter number or which rule decided.
   */
  result: VoteSetResult | null;
  /**
   * A flood of vote passes was seen on the event's vote code (OSE-2234,
   * lib/vote-flood.ts). A flag only, for the host: no count, no time. It stays
   * true through a reopen and after final.
   */
  flood_seen: boolean;
  /**
   * The room size the host gave when voting first opened: the most people the
   * room can hold. Fixed from then on (migration 0122 trigger). Null before
   * the first open. Admin only; never in a public answer.
   */
  room_size: number | null;
}

/** A final set's one result (ADR-040 decision 7, Q14). */
export interface VoteSetResult {
  outcome: VoteOutcome;
  /** The winning song or stall: its id and label. Null unless won by an object. */
  winner_object: { id: string; label: string } | null;
  /** The winning team's opaque OSE id. Null unless won by a team. */
  winner_team_id: string | null;
}

/** What the admin sees of an object. */
export interface VotableView {
  id: string;
  kind: VotableKind;
  label: string;
  booth_id: string | null;
  group_id: string | null;
  state: 'draft' | 'open' | 'closed';
  closes_at: string | null;
  open_now: boolean;
  sort: number;
}

interface SetRow {
  id: string;
  event_id: string;
  state: VoteSetView['state'];
  played_by: VoteSetView['played_by'] | null;
  opened: number;
  is_final: number;
  outcome: string | null;
  winner_object_id: string | null;
  winner_label: string | null;
  winner_team_id: string | null;
  flood_seen: number;
  room_size: number | null;
}

interface ObjectRow {
  id: string;
  kind: string;
  label: string;
  booth_id: string | null;
  group_id: string | null;
  state: VotableView['state'];
  closes_at: string | null;
  sort: number;
}

const SET_SELECT = `SELECT id, event_id, state, played_by, (pepper_epoch IS NOT NULL) AS opened, is_final,
       outcome, winner_object_id, winner_team_id, flood_seen, room_size,
       (SELECT w.label FROM votable_objects w
         WHERE w.id = vote_sets.winner_object_id AND w.set_id = vote_sets.id) AS winner_label
  FROM vote_sets`;
const OBJECT_SELECT = `SELECT id, kind, label, booth_id, group_id, state, closes_at, sort
  FROM votable_objects`;

/**
 * The event is still on: it is not archived, and its last date is yesterday or
 * later (UTC), or it has no date. It takes ONE bound parameter, the event id from the path, so the
 * events row is read by a held id (tests/e2e/0-architecture/
 * tenant-isolation.invariant.spec.ts), never by a column relation.
 *
 * Since S3e it gates only setting up (adding an object to a set still in
 * draft) and names why a move was refused (EVENT_OVER). Every move that makes
 * voting live needs EVENT_LIVE (lib/event-live.ts), which is this and Published.
 */
const EVENT_ON = `EXISTS (SELECT 1 FROM events e
   WHERE e.id = ? AND e.status <> 'archived'
     AND ${EVENT_ON_ITS_DATES})`;

function projectSet(row: SetRow): VoteSetView {
  return {
    id: row.id,
    event_id: row.event_id,
    state: row.state,
    played_by: row.played_by === 'team' ? 'team' : 'object',
    opened: Number(row.opened) === 1,
    final: Number(row.is_final) === 1,
    result: projectResult(row),
    flood_seen: Number(row.flood_seen) === 1,
    room_size: row.room_size == null ? null : Number(row.room_size),
  };
}

/** The result, field by field, only for a final set with an outcome. */
function projectResult(row: SetRow): VoteSetResult | null {
  if (Number(row.is_final) !== 1) return null;
  if (row.outcome !== 'winner' && row.outcome !== 'too_close') return null;
  const won = row.outcome === 'winner';
  return {
    outcome: row.outcome,
    winner_object:
      won && row.winner_object_id && row.winner_label
        ? { id: String(row.winner_object_id), label: String(row.winner_label) }
        : null,
    winner_team_id: won && row.winner_team_id ? String(row.winner_team_id) : null,
  };
}

function projectObject(row: ObjectRow, set: VoteSetView, nowMs: number): VotableView {
  const closes = row.closes_at ? Date.parse(row.closes_at) : NaN;
  return {
    id: row.id,
    kind: row.kind as VotableKind,
    label: row.label,
    booth_id: row.booth_id,
    group_id: row.group_id,
    state: row.state,
    closes_at: row.closes_at,
    open_now:
      !set.final &&
      set.state === 'open' &&
      row.state === 'open' &&
      Number.isFinite(closes) &&
      closes > nowMs,
    sort: Number(row.sort) || 0,
  };
}

/** A whole number in [lo, hi], uniform, by rejection sampling on crypto.getRandomValues. */
export function drawUniform(lo: number, hi: number): number {
  const n = hi - lo + 1;
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return lo + (buf[0] % n);
  }
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

/** The event's set, or null. */
export async function readVoteSet(db: D1Database, eventId: string): Promise<VoteSetView | null> {
  const row = await db.prepare(`${SET_SELECT} WHERE event_id = ?`).bind(eventId).first<SetRow>();
  return row ? projectSet(row) : null;
}

/**
 * The event's set and its objects, for the admin list, and whether the event is
 * live (OSE-2142): the card greys out Open and says "Publish the event to open
 * voting." when it is not.
 */
export async function listVotables(
  db: D1Database,
  eventId: string
): Promise<{ set: VoteSetView | null; objects: VotableView[]; event_live: boolean }> {
  const event_live = await eventIsLive(db, eventId);
  const set = await readVoteSet(db, eventId);
  if (!set) return { set: null, objects: [], event_live };
  const rows = await db
    .prepare(`${OBJECT_SELECT} WHERE set_id = ? AND event_id = ? ORDER BY sort, label, id`)
    .bind(set.id, eventId)
    .all<ObjectRow>();
  const now = Date.now();
  return {
    set,
    objects: (rows.results ?? []).map((r) => projectObject(r, set, now)),
    event_live,
  };
}

async function readObject(
  db: D1Database,
  eventId: string,
  objectId: string
): Promise<VotableView | null> {
  const set = await readVoteSet(db, eventId);
  if (!set) return null;
  const row = await db
    .prepare(`${OBJECT_SELECT} WHERE id = ? AND event_id = ?`)
    .bind(objectId, eventId)
    .first<ObjectRow>();
  return row ? projectObject(row, set, Date.now()) : null;
}

async function eventStillOn(db: D1Database, eventId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS hit WHERE ${EVENT_ON}`).bind(eventId).first();
  return !!row;
}

/**
 * Why the event refused a live move, or null when it is live: over (archived,
 * or past its dates) before not Published, so an archived event keeps its
 * EVENT_OVER answer.
 */
async function eventRefusal(db: D1Database, eventId: string): Promise<VoteFail | null> {
  if (!(await eventStillOn(db, eventId))) return EVENT_OVER;
  if (!(await eventIsLive(db, eventId))) return EVENT_NOT_PUBLISHED;
  return null;
}

/**
 * May `/q` mint a vote pass for this scan (OSE-2140, OSE-2142)? Only when, in
 * one statement: the scanned placement is this event's vote code and in use,
 * the event's set is open and not final, and the event is live. An ordinary
 * poster code of the event never qualifies, whatever its `?type=`.
 */
export async function voteCodeMayMint(
  db: D1Database,
  eventId: string,
  deploymentId: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS hit FROM vote_sets s
        WHERE s.event_id = ? AND s.state = 'open' AND s.is_final = 0
          AND EXISTS (SELECT 1 FROM poster_deployments d
                       WHERE d.id = ? AND d.event_id = ? AND d.is_vote_code = 1 AND d.is_active = 1)
          AND ${EVENT_LIVE}`
    )
    .bind(eventId, deploymentId, eventId, eventId)
    .first();
  return !!row;
}

/**
 * Does the event have a vote set? A vote set is never deleted (ADR-040 decision
 * 4), so the event hard-delete refuses an event that has one: archive it.
 */
export async function eventHasVoteSet(db: D1Database, eventId: string): Promise<boolean> {
  return !!(await db
    .prepare(`SELECT 1 AS hit FROM vote_sets WHERE event_id = ?`)
    .bind(eventId)
    .first());
}

// ── The set ──────────────────────────────────────────────────────────────────

/** Make the event's one vote set, in draft. A second one is refused. */
export async function createVoteSet(
  db: D1Database,
  eventId: string,
  playedBy: 'object' | 'team'
): Promise<VoteResult<VoteSetView>> {
  if (await readVoteSet(db, eventId))
    return fail(409, 'VOTE_SET_EXISTS', 'This event already has its vote set');
  try {
    await db
      .prepare(`INSERT INTO vote_sets (id, event_id, played_by) VALUES (?, ?, ?)`)
      .bind(newId('vset'), eventId, playedBy)
      .run();
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(String(err)))
      return fail(409, 'VOTE_SET_EXISTS', 'This event already has its vote set');
    throw err;
  }
  const set = await readVoteSet(db, eventId);
  return set ? { ok: true, value: set } : NO_SET;
}

/** Why a set write changed nothing. Read after the write, so it names what is true now. */
async function whySetRefused(
  db: D1Database,
  eventId: string,
  want: VoteSetView['state'][]
): Promise<VoteFail> {
  const set = await readVoteSet(db, eventId);
  if (!set) return NO_SET;
  if (set.final) return FINAL;
  if (!want.includes(set.state)) return fail(409, 'WRONG_STATE', `The vote set is ${set.state}`);
  const event = await eventRefusal(db, eventId);
  if (event) return event;
  return fail(409, 'WRONG_STATE', `The vote set is ${set.state}`);
}

/**
 * With no pepper, voting cannot open. A set that does not exist or is final
 * says so first, so a final set answers VOTE_SET_FINAL whatever the pepper.
 */
async function noPepper(db: D1Database, eventId: string): Promise<VoteFail> {
  const set = await readVoteSet(db, eventId);
  if (!set) return NO_SET;
  if (set.final) return FINAL;
  return fail(
    409,
    'PEPPER_NOT_SET',
    'Voting cannot open here: the anonymous key is not configured'
  );
}

/** The room size a host may give: the most people the room can hold (migration 0122). */
export const ROOM_SIZE_RANGE = [10, 50000] as const;

/**
 * A room size from a request body, or why not. Required to open voting
 * (2026-11-26, the room size check at final): a whole number in ROOM_SIZE_RANGE.
 */
export function parseRoomSize(v: unknown): VoteResult<number> {
  if (typeof v !== 'number' || !Number.isInteger(v))
    return fail(
      400,
      'ROOM_SIZE_NEEDED',
      'Say how many the room can hold (a whole number) to open voting'
    );
  if (v < ROOM_SIZE_RANGE[0] || v > ROOM_SIZE_RANGE[1])
    return fail(
      400,
      'ROOM_SIZE_OUT_OF_RANGE',
      `The room size must be from ${ROOM_SIZE_RANGE[0]} to ${ROOM_SIZE_RANGE[1]}`
    );
  return { ok: true, value: v };
}

/**
 * First open: draft → open. Stamps the pepper epoch and draws T and V, once,
 * and writes the room size the host gave, once. With no pepper, refuses: a
 * set that opens with no epoch could never count. Without a valid room size,
 * refuses (ROOM_SIZE_NEEDED), after saying first why else it could not open.
 *
 * THE ROOM SIZE IS FIXED HERE (2026-11-26, owner: hosts and sponsors must not
 * push a result up or down). Only this first open writes it, and the trigger
 * vote_sets_room_size_fixed (migration 0122) refuses any later change, so a
 * host cannot raise it after the night to hide padding. A reopen keeps it.
 */
export async function openVoteSet(
  db: D1Database,
  eventId: string,
  pepper: string | undefined,
  nowIso: string,
  roomSize: unknown
): Promise<VoteResult<VoteSetView>> {
  const room = parseRoomSize(roomSize);
  if (!room.ok) {
    // A set that does not exist, is final or already opened says so first, so
    // a refused open answers as it did before the room size was asked for.
    const set = await readVoteSet(db, eventId);
    if (!set) return NO_SET;
    if (set.final) return FINAL;
    if (set.state !== 'draft' || set.opened)
      return fail(409, 'WRONG_STATE', `The vote set is ${set.state}`);
    return room;
  }
  const epoch = await pepperEpoch(pepper);
  if (!epoch) return noPepper(db, eventId);
  const margin = drawUniform(SECRET_MARGIN_RANGE[0], SECRET_MARGIN_RANGE[1]);
  const floor = drawUniform(SECRET_FLOOR_RANGE[0], SECRET_FLOOR_RANGE[1]);
  const res = await db
    .prepare(
      `UPDATE vote_sets
          SET state = 'open', pepper_epoch = ?, secret_margin = ?, secret_floor = ?, room_size = ?, updated_at = ?
        WHERE event_id = ? AND state = 'draft' AND is_final = 0
          AND pepper_epoch IS NULL AND secret_margin IS NULL AND secret_floor IS NULL
          AND room_size IS NULL
          AND ${EVENT_LIVE}`
    )
    .bind(epoch, margin, floor, room.value, hourStamp(nowIso), eventId, eventId)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return whySetRefused(db, eventId, ['draft']);
  const set = await readVoteSet(db, eventId);
  return set ? { ok: true, value: set } : NO_SET;
}

/** Reopen: closed → open. The epoch, T and V are not touched. */
export async function reopenVoteSet(
  db: D1Database,
  eventId: string,
  pepper: string | undefined,
  nowIso: string
): Promise<VoteResult<VoteSetView>> {
  const epoch = await pepperEpoch(pepper);
  if (!epoch) return noPepper(db, eventId);
  const res = await db
    .prepare(
      `UPDATE vote_sets
          SET state = 'open', updated_at = ?
        WHERE event_id = ? AND state = 'closed' AND is_final = 0
          AND pepper_epoch IS NOT NULL AND pepper_epoch = ?
          AND ${EVENT_LIVE}`
    )
    .bind(hourStamp(nowIso), eventId, epoch, eventId)
    .run();
  if ((res.meta?.changes ?? 0) > 0) {
    const set = await readVoteSet(db, eventId);
    return set ? { ok: true, value: set } : NO_SET;
  }
  const why = await whySetRefused(db, eventId, ['closed']);
  if (why.code !== 'WRONG_STATE') return why;
  const set = await readVoteSet(db, eventId);
  if (set?.state === 'closed')
    return fail(
      409,
      'PEPPER_CHANGED',
      'The anonymous key changed since this set first opened, so no vote could count in it'
    );
  return why;
}

/**
 * The statement that closes the event's open set unless the event is
 * Published (OSE-2142). A status writer puts it in the SAME `db.batch` as its
 * `UPDATE events SET status`, after it, so the two land in one transaction:
 * no reader ever sees an unpublished event with an open set. It reads the
 * status the batch just wrote, so it is a no-op for a move into Published, a
 * refused move, or an event with no open set. It never makes a set final, and
 * never opens one. Batched by handlers/events.ts (PUT status) and
 * handlers/qr-verify.ts (the verify undo); the T0 gate votes-never-who rule 11
 * holds that every status writer does.
 */
export function closeVoteSetUnlessPublished(db: D1Database, eventId: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE vote_sets
          SET state = 'closed', updated_at = strftime('%Y-%m-%d %H:00:00', 'now')
        WHERE event_id = ? AND state = 'open' AND is_final = 0
          AND NOT ${EVENT_PUBLISHED}`
    )
    .bind(eventId, eventId);
}

/** Close: open → closed. Allowed after the event, so a host can always stop voting. */
export async function closeVoteSet(
  db: D1Database,
  eventId: string,
  nowIso: string
): Promise<VoteResult<VoteSetView>> {
  const res = await db
    .prepare(
      `UPDATE vote_sets SET state = 'closed', updated_at = ?
        WHERE event_id = ? AND state = 'open' AND is_final = 0`
    )
    .bind(hourStamp(nowIso), eventId)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    const set = await readVoteSet(db, eventId);
    if (!set) return NO_SET;
    if (set.final) return FINAL;
    return fail(409, 'WRONG_STATE', `The vote set is ${set.state}`);
  }
  const set = await readVoteSet(db, eventId);
  return set ? { ok: true, value: set } : NO_SET;
}

/**
 * A vote met a set opened under another pepper (decision 6): the epoch the set
 * stamped at its first open is not the one running now, so no vote can count
 * in it again. Mark it void, once, with its reason. A void set publishes
 * nothing. Called by the vote route (OSE-2128) after a refused vote; returns
 * whether this call voided the set. Never touches a final set.
 */
export async function voidOnEpochChange(
  db: D1Database,
  eventId: string,
  currentEpoch: string
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE vote_sets SET is_void = 1, void_reason = 'pepper_epoch', updated_at = strftime('%Y-%m-%d %H:00:00', 'now')
        WHERE event_id = ? AND is_void = 0 AND is_final = 0
          AND pepper_epoch IS NOT NULL AND pepper_epoch <> ?`
    )
    .bind(eventId, currentEpoch)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Which sets may be made final, and so have their result computed. `admin`: a
 * set that never opened, or one that is closed (a host closes voting before
 * computing the result, so a night cannot end by a stray tap). `job`: every
 * due set, open or not: every set reaches final (decision 4).
 */
const FINALIZABLE = {
  admin: (t = '') => `(${t}pepper_epoch IS NULL OR ${t}state = 'closed')`,
  job: (t = '') => `${t}id IS NOT NULL`,
} as const;

/**
 * A set is due for the nightly job (decision 4): its event's last date is more
 * than 7 days ago, or, with no date, the set has been untouched for 7 days with
 * no object window in that time. `set` names the vote set in the statement,
 * and `e` the event row. It takes the three bound values in DUE_BINDS.
 */
const DUE_WINDOW = (set: string) => `((COALESCE(e.end_date, e.start_date) IS NOT NULL
      AND substr(COALESCE(e.end_date, e.start_date), 1, 10) < date('now', ?))
   OR (COALESCE(e.end_date, e.start_date) IS NULL
      AND ${set}.updated_at < datetime('now', ?)
      AND NOT EXISTS (SELECT 1 FROM votable_objects o
                       WHERE o.set_id = ${set}.id
                         AND o.closes_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))))`;
const DUE_BINDS = [
  `-${VOTE_FINAL_AFTER_DAYS} days`,
  `-${VOTE_FINAL_AFTER_DAYS} days`,
  `-${VOTE_FINAL_AFTER_DAYS} days`,
];

/**
 * Make one set final, for good, in one batch: the night's result is written
 * (lib/vote-results.ts, decided in SQL), its objects close, the set closes,
 * is_final becomes 1, T and V become null, and its receipts, participant
 * markers and team markers are deleted. Each delete runs only when the set is
 * final by then, so a refused finalize deletes nothing. Returns whether the set
 * became final in this call.
 */
export async function finalizeVoteSet(
  db: D1Database,
  setId: string,
  eventId: string,
  mode: keyof typeof FINALIZABLE,
  nowIso: string
): Promise<boolean> {
  const may = FINALIZABLE[mode]();
  // The job checks again, in the same statements, that the set is still due:
  // an event moved into the future after the job chose the set is left alone
  // (PR #1432 review). An admin's finalize has no date rule.
  const due =
    mode === 'job'
      ? `AND EXISTS (SELECT 1 FROM events e WHERE e.id = ? AND ${DUE_WINDOW('vote_sets')})`
      : '';
  const dueBinds = mode === 'job' ? [eventId, ...DUE_BINDS] : [];
  const results = await db.batch([
    ...resultStatements(db, setId, eventId, `AND is_final = 0 AND ${may} ${due}`, dueBinds),
    db
      .prepare(
        `UPDATE votable_objects SET state = 'closed', closes_at = NULL, updated_at = ?
          WHERE set_id = ? AND event_id = ? AND state <> 'closed'
            AND set_id IN (SELECT id FROM vote_sets WHERE id = ? AND is_final = 0 AND ${may} ${due})`
      )
      .bind(hourStamp(nowIso), setId, eventId, setId, ...dueBinds),
    db
      .prepare(
        `UPDATE vote_sets
            SET is_final = 1, final_at = ?, state = 'closed', secret_margin = NULL, secret_floor = NULL, updated_at = ?
          WHERE id = ? AND event_id = ? AND is_final = 0 AND ${may} ${due}`
      )
      .bind(hourStamp(nowIso), hourStamp(nowIso), setId, eventId, ...dueBinds),
    db
      .prepare(
        `DELETE FROM vote_receipts
          WHERE object_id IN (SELECT o.id FROM votable_objects o
                                JOIN vote_sets s ON s.id = o.set_id
                               WHERE s.id = ? AND s.is_final = 1)`
      )
      .bind(setId),
    db
      .prepare(
        `DELETE FROM vote_participants
          WHERE set_id = ? AND set_id IN (SELECT id FROM vote_sets WHERE id = ? AND is_final = 1)`
      )
      .bind(setId, setId),
    db
      .prepare(
        `DELETE FROM vote_team_markers
          WHERE set_id = ? AND set_id IN (SELECT id FROM vote_sets WHERE id = ? AND is_final = 1)`
      )
      .bind(setId, setId),
  ]);
  // The result statements (the outcome, the winner, the room size check) come
  // first, then one closes the objects, then one makes the set final, then the
  // three deletes. Counted from the end, so a new result statement cannot move it.
  return (results[results.length - 4]?.meta?.changes ?? 0) > 0;
}

/**
 * An admin's finalize: compute the night's result and make the set final, for
 * good (decision 4, Q10). Refused while the set is open: close voting first.
 */
export async function adminFinalizeVoteSet(
  db: D1Database,
  eventId: string,
  nowIso: string
): Promise<VoteResult<VoteSetView>> {
  const set = await readVoteSet(db, eventId);
  if (!set) return NO_SET;
  if (set.final) return FINAL;
  if (await finalizeVoteSet(db, set.id, eventId, 'admin', nowIso)) {
    const after = await readVoteSet(db, eventId);
    return after ? { ok: true, value: after } : NO_SET;
  }
  const now = await readVoteSet(db, eventId);
  if (now?.final) return FINAL;
  return fail(409, 'VOTE_SET_OPEN', 'Close voting before computing the result');
}

export interface VotableInput {
  kind: VotableKind;
  label: string;
  booth_id: string | null;
  group_id: string | null;
  sort: number;
}

const CREATE_FIELDS = new Set(['kind', 'label', 'booth_id', 'group_id', 'sort']);
const UPDATE_FIELDS = new Set(['label', 'booth_id', 'group_id', 'sort']);

function parseSort(raw: unknown): number | null {
  if (raw === undefined || raw === null) return 0;
  return Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) <= 100_000
    ? (raw as number)
    : null;
}

function parseOptionalId(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null;
  return typeof raw === 'string' && raw.length <= 80 ? raw : undefined;
}

/** Check a new object's body. Any other field is refused, so no person field can ride along. */
export function parseVotableCreate(body: unknown): VoteResult<VotableInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return fail(400, 'INVALID_BODY', 'Send a JSON object');
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !CREATE_FIELDS.has(k));
  if (extra.length)
    return fail(400, 'UNKNOWN_FIELD', `Not a field of a votable object: ${extra.join(', ')}`);
  if (!isVotableKind(b.kind)) return fail(400, 'INVALID_KIND', 'kind must be song, stall or entry');
  const label = parseVotableLabel(b.label);
  if (!label.ok) return fail(400, label.code, label.error);
  const booth = parseOptionalId(b.booth_id);
  if (booth === undefined) return fail(400, 'INVALID_BOOTH', 'booth_id must be a booth id');
  const group = parseOptionalId(b.group_id);
  if (group === undefined || (group !== null && !isVoteTeamId(group)))
    return fail(400, 'INVALID_GROUP', 'group_id must be a team id (grp_ and hex)');
  const sort = parseSort(b.sort);
  if (sort === null) return fail(400, 'INVALID_SORT', 'sort must be a whole number, 0 to 100000');
  return {
    ok: true,
    value: { kind: b.kind, label: label.value, booth_id: booth, group_id: group, sort },
  };
}

export type VotablePatch = Partial<Omit<VotableInput, 'kind'>>;

/** Check a change to an object. The kind never changes. */
export function parseVotableUpdate(body: unknown): VoteResult<VotablePatch> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return fail(400, 'INVALID_BODY', 'Send a JSON object');
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !UPDATE_FIELDS.has(k));
  if (extra.length)
    return fail(400, 'UNKNOWN_FIELD', `Not a field you can change: ${extra.join(', ')}`);
  const out: VotablePatch = {};
  if ('label' in b) {
    const label = parseVotableLabel(b.label);
    if (!label.ok) return fail(400, label.code, label.error);
    out.label = label.value;
  }
  if ('booth_id' in b) {
    const booth = parseOptionalId(b.booth_id);
    if (booth === undefined) return fail(400, 'INVALID_BOOTH', 'booth_id must be a booth id');
    out.booth_id = booth;
  }
  if ('group_id' in b) {
    const group = parseOptionalId(b.group_id);
    if (group === undefined || (group !== null && !isVoteTeamId(group)))
      return fail(400, 'INVALID_GROUP', 'group_id must be a team id (grp_ and hex)');
    out.group_id = group;
  }
  if ('sort' in b) {
    const sort = parseSort(b.sort);
    if (sort === null) return fail(400, 'INVALID_SORT', 'sort must be a whole number, 0 to 100000');
    out.sort = sort;
  }
  if (!Object.keys(out).length) return fail(400, 'NOTHING_TO_CHANGE', 'Send a field to change');
  return { ok: true, value: out };
}

/** A booth of this event, in use. A booth of another event is the same miss. */
async function boothOfEvent(db: D1Database, boothId: string, eventId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS hit FROM event_booths WHERE id = ? AND event_id = ? AND is_active = 1`)
    .bind(boothId, eventId)
    .first();
  return !!row;
}

const BOOTH_MISS = fail(400, 'BOOTH_NOT_FOUND', 'booth_id must be a stall of this event, in use');

function teamRule(set: VoteSetView, group: string | null): VoteFail | null {
  if (set.played_by === 'team' && !group)
    return fail(400, 'GROUP_REQUIRED', 'This set is played by teams: give each object its team');
  if (set.played_by === 'object' && group)
    return fail(400, 'GROUP_NOT_ALLOWED', 'This set is played by objects, not teams');
  return null;
}

/** Add an object to the event's set, in draft. Refused on a final set or after the event. */
export async function createVotable(
  db: D1Database,
  eventId: string,
  input: VotableInput
): Promise<VoteResult<VotableView>> {
  const set = await readVoteSet(db, eventId);
  if (!set) return NO_SET;
  if (set.final) return FINAL;
  const team = teamRule(set, input.group_id);
  if (team) return team;
  if (input.booth_id && !(await boothOfEvent(db, input.booth_id, eventId))) return BOOTH_MISS;
  const id = newId('vobj');
  // One statement: the set is not final, the event is on, the set holds one
  // kind, it is under the cap, and the booth is this event's. A set that has
  // opened takes a new object only while its event is live (OSE-2142): setting
  // up on a draft or ready event is for a set still in draft. Then the object's
  // tally row, made with it (0111), only if the object was made.
  const [made] = await db.batch([
    db
      .prepare(
        `INSERT INTO votable_objects (id, event_id, set_id, kind, label, booth_id, group_id, sort)
         SELECT ?, s.event_id, s.id, ?, ?, ?, ?, ?
           FROM vote_sets s
          WHERE s.id = ? AND s.event_id = ? AND s.is_final = 0
            AND ${EVENT_ON}
            AND (s.state = 'draft' OR ${EVENT_LIVE})
            AND NOT EXISTS (SELECT 1 FROM votable_objects o WHERE o.set_id = s.id AND o.kind <> ?)
            AND (SELECT COUNT(*) FROM votable_objects o WHERE o.set_id = s.id) < ?
            AND (? IS NULL OR EXISTS (SELECT 1 FROM event_booths b
                                       WHERE b.id = ? AND b.event_id = s.event_id AND b.is_active = 1))`
      )
      .bind(
        id,
        input.kind,
        input.label,
        input.booth_id,
        input.group_id,
        input.sort,
        set.id,
        eventId,
        eventId,
        eventId,
        input.kind,
        VOTE_OBJECTS_MAX,
        input.booth_id,
        input.booth_id
      ),
    db
      .prepare(
        `INSERT INTO vote_tallies (object_id)
         SELECT id FROM votable_objects WHERE id = ? AND event_id = ?`
      )
      .bind(id, eventId),
  ]);
  if ((made?.meta?.changes ?? 0) === 0) {
    const now = await readVoteSet(db, eventId);
    if (!now) return NO_SET;
    if (now.final) return FINAL;
    if (!(await eventStillOn(db, eventId))) return EVENT_OVER;
    if (now.state !== 'draft' && !(await eventIsLive(db, eventId))) return EVENT_NOT_PUBLISHED;
    const other = await db
      .prepare(`SELECT kind FROM votable_objects WHERE set_id = ? AND kind <> ? LIMIT 1`)
      .bind(set.id, input.kind)
      .first<{ kind: string }>();
    if (other)
      return fail(
        409,
        'KIND_MISMATCH',
        `This set holds ${other.kind} objects; a set holds one kind`
      );
    const size = await db
      .prepare(`SELECT COUNT(*) AS n FROM votable_objects WHERE set_id = ?`)
      .bind(set.id)
      .first<{ n: number }>();
    if (Number(size?.n ?? 0) >= VOTE_OBJECTS_MAX)
      return fail(409, 'TOO_MANY', `A vote set holds ${VOTE_OBJECTS_MAX} objects at most`);
    return BOOTH_MISS;
  }
  const view = await readObject(db, eventId, id);
  return view ? { ok: true, value: view } : NO_OBJECT;
}

/**
 * Change an object's label, sort, booth or team. A team, and the label, change
 * only before the first open (2026-11-26): once votes can be cast, renaming
 * a song or stall would move its votes to a different name, a way for a host
 * to push a result up or down. Fix a typo before opening voting.
 */
export async function updateVotable(
  db: D1Database,
  eventId: string,
  objectId: string,
  patch: VotablePatch,
  nowIso: string
): Promise<VoteResult<VotableView>> {
  const set = await readVoteSet(db, eventId);
  const current = set ? await readObject(db, eventId, objectId) : null;
  if (!set || !current) return NO_OBJECT;
  if (set.final) return FINAL;
  const changesTeam = 'group_id' in patch && patch.group_id !== current.group_id;
  if (changesTeam && set.opened)
    return fail(409, 'TEAM_FIXED', 'A team is fixed once the vote set has opened');
  const changesLabel = patch.label !== undefined && patch.label !== current.label;
  if (changesLabel && set.opened) return LABEL_FIXED;
  if ('group_id' in patch) {
    const team = teamRule(set, patch.group_id ?? null);
    if (team) return team;
  }
  if (patch.booth_id && !(await boothOfEvent(db, patch.booth_id, eventId))) return BOOTH_MISS;
  const label = patch.label ?? current.label;
  const sort = patch.sort ?? current.sort;
  const booth = 'booth_id' in patch ? (patch.booth_id ?? null) : current.booth_id;
  const group = 'group_id' in patch ? (patch.group_id ?? null) : current.group_id;
  const res = await db
    .prepare(
      `UPDATE votable_objects
          SET label = ?, sort = ?, booth_id = ?, group_id = ?, updated_at = ?
        WHERE id = ? AND event_id = ?
          AND set_id IN (SELECT id FROM vote_sets
                          WHERE event_id = ? AND is_final = 0
                            AND (pepper_epoch IS NULL
                                 OR (votable_objects.group_id IS ? AND votable_objects.label = ?)))
          AND (? IS NULL OR EXISTS (SELECT 1 FROM event_booths b
                                     WHERE b.id = ? AND b.event_id = votable_objects.event_id
                                       AND b.is_active = 1))`
    )
    .bind(
      label,
      sort,
      booth,
      group,
      hourStamp(nowIso),
      objectId,
      eventId,
      eventId,
      group,
      label,
      booth,
      booth
    )
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    const now = await readVoteSet(db, eventId);
    if (now?.final) return FINAL;
    if (changesTeam && now?.opened)
      return fail(409, 'TEAM_FIXED', 'A team is fixed once the vote set has opened');
    if (changesLabel && now?.opened) return LABEL_FIXED;
    return NO_OBJECT;
  }
  const view = await readObject(db, eventId, objectId);
  return view ? { ok: true, value: view } : NO_OBJECT;
}

/** An object's kind, only when it belongs to `eventId`. */
export async function votableKind(
  db: D1Database,
  eventId: string,
  objectId: string
): Promise<VotableKind | null> {
  const row = await db
    .prepare(`SELECT kind FROM votable_objects WHERE id = ? AND event_id = ?`)
    .bind(objectId, eventId)
    .first<{ kind: string }>();
  return row && isVotableKind(row.kind) ? row.kind : null;
}

/** Read a window in seconds, or the kind's default. */
export function parseWindow(body: unknown, kind: VotableKind): VoteResult<number> {
  const raw =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).window_seconds
      : undefined;
  if (raw === undefined || raw === null)
    return { ok: true, value: VOTE_WINDOW_DEFAULT_SECONDS[kind] };
  if (
    !Number.isInteger(raw) ||
    (raw as number) < VOTE_WINDOW_MIN_SECONDS ||
    (raw as number) > VOTE_WINDOW_MAX_SECONDS
  )
    return fail(
      400,
      'INVALID_WINDOW',
      `window_seconds must be a whole number from ${VOTE_WINDOW_MIN_SECONDS} to ${VOTE_WINDOW_MAX_SECONDS}`
    );
  return { ok: true, value: raw as number };
}

/** Kinds of the object-state change, for the audit action and the allowed start state. */
export type ObjectMove = 'open' | 'reopen' | 'close';
/** The states each move starts from. A reopen also re-arms an open object whose window ran out. */
const MOVE_FROM: Record<ObjectMove, VotableView['state'][]> = {
  open: ['draft'],
  reopen: ['closed', 'open'],
  close: ['open'],
};

/**
 * Open (draft → open), reopen (closed → open) or close (open → closed) one
 * object. Opening needs the set open, not final, and the event live; it sets
 * `closes_at` to now plus the window. Closing needs only that the set is not
 * final.
 */
export async function moveVotable(
  db: D1Database,
  eventId: string,
  objectId: string,
  move: ObjectMove,
  windowSeconds: number,
  nowIso: string
): Promise<VoteResult<VotableView>> {
  const from = MOVE_FROM[move];
  let changes = 0;
  if (move === 'close') {
    const res = await db
      .prepare(
        `UPDATE votable_objects SET state = 'closed', updated_at = ?
          WHERE id = ? AND event_id = ? AND state = 'open'
            AND set_id IN (SELECT id FROM vote_sets WHERE event_id = ? AND is_final = 0)`
      )
      .bind(hourStamp(nowIso), objectId, eventId, eventId)
      .run();
    changes = res.meta?.changes ?? 0;
  } else {
    const seconds = Math.min(
      Math.max(windowSeconds, VOTE_WINDOW_MIN_SECONDS),
      VOTE_WINDOW_MAX_SECONDS
    );
    const closesAt = new Date(Date.now() + seconds * 1000).toISOString();
    const res = await db
      .prepare(
        `UPDATE votable_objects SET state = 'open', closes_at = ?, updated_at = ?
          WHERE id = ? AND event_id = ?
            AND (state = ? OR (state = 'closed' AND ? = 'reopen')
                 OR (state = 'open' AND ? = 'reopen' AND closes_at IS NOT NULL AND closes_at <= ?))
            AND set_id IN (SELECT s.id FROM vote_sets s
                            WHERE s.event_id = ? AND s.is_final = 0 AND s.state = 'open'
                              AND ${EVENT_LIVE})`
      )
      .bind(
        closesAt,
        hourStamp(nowIso),
        objectId,
        eventId,
        move === 'open' ? 'draft' : 'closed',
        move,
        move,
        nowIso,
        eventId,
        eventId
      )
      .run();
    changes = res.meta?.changes ?? 0;
  }
  if (changes === 0) {
    const set = await readVoteSet(db, eventId);
    const obj = set ? await readObject(db, eventId, objectId) : null;
    if (!set || !obj) return NO_OBJECT;
    if (set.final) return FINAL;
    const expired = obj.state === 'open' && !obj.open_now && obj.closes_at !== null;
    if (!from.includes(obj.state) || (move === 'reopen' && obj.state === 'open' && !expired))
      return fail(409, 'WRONG_STATE', `The object is ${obj.state}`);
    if (set.state !== 'open')
      return fail(409, 'VOTE_SET_NOT_OPEN', 'Open the vote set before an object in it');
    const event = await eventRefusal(db, eventId);
    if (event) return event;
    return NO_OBJECT;
  }
  const view = await readObject(db, eventId, objectId);
  return view ? { ok: true, value: view } : NO_OBJECT;
}

// ── The nightly job ──────────────────────────────────────────────────────────

export interface VoteFinalJobEnv {
  DB?: D1Database;
}

export interface VoteFinalJobResult {
  finalized: number;
  /** Sets closed because their event is not Published (a number only, OSE-2142). */
  closedUnpublished: number;
  errors: number;
}

const JOB_BATCH = 200;

/**
 * Every set reaches final (ADR-040 decisions 1 and 4). Nightly:
 *   1. A set whose event's last date is more than 7 days ago (or, with no date,
 *      untouched for 7 days with no object window in them, open or closed)
 *      becomes final, with its result computed in the same batch (S5,
 *      OSE-2130). Each is audited as
 *      VOTE_SET_FINAL against its event, with no detail: which rule decided is
 *      never written anywhere.
 *   2. Tallies of objects in sets final for more than 30 days are deleted.
 *   3. OSE-2142: a set left open on an event that is not Published (its status
 *      changed outside the app: a seed, a script) is closed, as the app's own
 *      status writers close it in the same batch. Not audited per set; the
 *      pass and the public read already refused it.
 * Logs a total of sets made final and an error flag, nothing per set.
 */
export async function runVoteFinalJob(env: VoteFinalJobEnv): Promise<VoteFinalJobResult> {
  const out: VoteFinalJobResult = { finalized: 0, closedUnpublished: 0, errors: 0 };
  const db = env.DB;
  if (!db) return out;
  const nowIso = new Date().toISOString();
  try {
    const due = await db
      .prepare(
        `SELECT s.id, s.event_id FROM vote_sets s
           JOIN events e ON e.id = s.event_id
          WHERE s.is_final = 0 AND ${FINALIZABLE.job('s.')}
            AND ${DUE_WINDOW('s')}
          ORDER BY s.id
          LIMIT ?`
      )
      .bind(...DUE_BINDS, JOB_BATCH)
      .all<{ id: string; event_id: string }>();
    for (const { id, event_id } of due.results ?? []) {
      try {
        if (await finalizeVoteSet(db, id, event_id, 'job', nowIso)) {
          out.finalized++;
          await auditFinal(db, event_id, nowIso);
        }
      } catch {
        out.errors++;
      }
    }
    await db
      .prepare(
        `DELETE FROM vote_tallies
          WHERE object_id IN (SELECT o.id FROM votable_objects o
                                JOIN vote_sets s ON s.id = o.set_id
                               WHERE s.is_final = 1 AND s.final_at < datetime('now', ?))`
      )
      .bind(`-${VOTE_TALLY_KEEP_DAYS} days`)
      .run();
  } catch {
    out.errors++;
  }
  // OSE-2142: its own step, so a failure above never skips it.
  try {
    const closed = await db
      .prepare(
        `UPDATE vote_sets
            SET state = 'closed', updated_at = strftime('%Y-%m-%d %H:00:00', 'now')
          WHERE state = 'open' AND is_final = 0
            AND NOT EXISTS (SELECT 1 FROM events e
                             WHERE e.id = vote_sets.event_id AND ${eventLiveSql('e')})`
      )
      .run();
    out.closedUnpublished = closed.meta?.changes ?? 0;
  } catch {
    out.errors++;
  }
  console.log(
    JSON.stringify({
      type: 'VOTE_FINAL_JOB',
      finalized: out.finalized,
      closed_unpublished: out.closedUnpublished,
      errors: out.errors,
      timestamp: nowIso,
    })
  );
  return out;
}

async function auditFinal(db: D1Database, eventId: string, nowIso: string): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO admin_audit_log
           (id, action, actor, resource_type, resource_id, request_id, outcome, details, brand_id)
         SELECT lower(hex(randomblob(16))), 'VOTE_SET_FINAL', 'system:lifecycle', 'event',
                e.id, ?, 'success', NULL, e.brand_id
           FROM events e WHERE e.id = ?`
      )
      .bind(`vote-final:${hourStamp(nowIso)}`, eventId)
      .run();
  } catch {
    // An audit failure must never stop the job.
  }
}
