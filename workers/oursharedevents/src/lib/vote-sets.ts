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
 *   - A song's window. `closes_at` is set by the server when an object opens:
 *     now plus a window, never more than VOTE_WINDOW_MAX_SECONDS. It names the
 *     song's window, never a voter (decision 3).
 *   - A team is fixed once the set first opens: a song's `group_id` changes only
 *     while `pepper_epoch IS NULL` (Q16).
 *   - A booth must be a booth of the same event, in use (S2 review, "Booths").
 *
 * FINAL, IN THIS STORY. Decision 4 says computing the results sets final, and
 * computing results is S5 (OSE-2130). Final also deletes T, V and the markers,
 * so a set that could hold a vote must not be made final until S5 computes its
 * result in the same step. So this file makes final only a set that can hold no
 * vote: one that never opened (no epoch, so no pass can match it), and, for the
 * nightly job only, a void set (which publishes nothing). An admin's finalize
 * answers the same for a void set as for any other set that opened. Once the
 * nightly job has made a void set final, though, the list shows it final while
 * a set that opened and is not void is not, so an admin can then tell that the
 * set is void: that a pass was refused after a pepper rotation. No count and no
 * identity follow from it, and decision 8 makes a void set visible after S5
 * anyway (it gets no report). S5 widens finalizeVoteSet to every set and
 * computes the result in the same batch; until then the T0 gate
 * (votes-never-who) refuses any writer of a receipt or a marker.
 *
 * NO NUMBER, NO SECRET. Nothing here reads a counter, reads T or V, or returns
 * them. T and V are written once, by the first open, and set to null by final.
 * No log line carries a set's state beyond its id and an error label.
 */

import { pepperEpoch } from './anon-id-hash';
import { hourStamp } from './scan-buffer';
import { isVotableKind, isVoteTeamId, parseVotableLabel, type VotableKind } from './votes';

/** The longest window an object can be open for in one go: 12 hours (a fair day). */
export const VOTE_WINDOW_MAX_SECONDS = 12 * 60 * 60;
/** The shortest: 30 seconds. */
export const VOTE_WINDOW_MIN_SECONDS = 30;
/** With no window given: 10 minutes for a song (longer than the 7:11 song), a fair day for a stall. */
export const VOTE_WINDOW_DEFAULT_SECONDS: Record<VotableKind, number> = {
  song: 10 * 60,
  stall: VOTE_WINDOW_MAX_SECONDS,
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
const EVENT_OVER = fail(409, 'EVENT_OVER', 'The event is over; voting cannot open again');

/** What the admin sees of a set. No epoch value, no void flag, no counter, no T or V. */
export interface VoteSetView {
  id: string;
  event_id: string;
  state: 'draft' | 'open' | 'closed';
  played_by: 'object' | 'team';
  opened: boolean;
  final: boolean;
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

const SET_SELECT = `SELECT id, event_id, state, played_by, (pepper_epoch IS NOT NULL) AS opened, is_final
  FROM vote_sets`;
const OBJECT_SELECT = `SELECT id, kind, label, booth_id, group_id, state, closes_at, sort
  FROM votable_objects`;

/**
 * The event is still on: it is not archived, and its last date is yesterday or
 * later (UTC), or it has no date. It takes ONE bound parameter, the event id from the path, so the
 * events row is read by a held id (tests/e2e/0-architecture/
 * tenant-isolation.invariant.spec.ts), never by a column relation.
 */
const EVENT_ON = `EXISTS (SELECT 1 FROM events e
   WHERE e.id = ? AND e.status <> 'archived'
     AND (COALESCE(e.end_date, e.start_date) IS NULL
          OR substr(COALESCE(e.end_date, e.start_date), 1, 10) >= date('now', '-1 day')))`;

function projectSet(row: SetRow): VoteSetView {
  return {
    id: row.id,
    event_id: row.event_id,
    state: row.state,
    played_by: row.played_by === 'team' ? 'team' : 'object',
    opened: Number(row.opened) === 1,
    final: Number(row.is_final) === 1,
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

/** The event's set and its objects, for the admin list. */
export async function listVotables(
  db: D1Database,
  eventId: string
): Promise<{ set: VoteSetView | null; objects: VotableView[] }> {
  const set = await readVoteSet(db, eventId);
  if (!set) return { set: null, objects: [] };
  const rows = await db
    .prepare(`${OBJECT_SELECT} WHERE set_id = ? AND event_id = ? ORDER BY sort, label, id`)
    .bind(set.id, eventId)
    .all<ObjectRow>();
  const now = Date.now();
  return { set, objects: (rows.results ?? []).map((r) => projectObject(r, set, now)) };
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
  if (!(await eventStillOn(db, eventId))) return EVENT_OVER;
  return fail(409, 'WRONG_STATE', `The vote set is ${set.state}`);
}

/**
 * First open: draft → open. Stamps the pepper epoch and draws T and V, once.
 * With no pepper, refuses: a set that opens with no epoch could never count.
 */
export async function openVoteSet(
  db: D1Database,
  eventId: string,
  pepper: string | undefined,
  nowIso: string
): Promise<VoteResult<VoteSetView>> {
  const epoch = await pepperEpoch(pepper);
  if (!epoch)
    return fail(
      409,
      'PEPPER_NOT_SET',
      'Voting cannot open here: the anonymous key is not configured'
    );
  const margin = drawUniform(SECRET_MARGIN_RANGE[0], SECRET_MARGIN_RANGE[1]);
  const floor = drawUniform(SECRET_FLOOR_RANGE[0], SECRET_FLOOR_RANGE[1]);
  const res = await db
    .prepare(
      `UPDATE vote_sets
          SET state = 'open', pepper_epoch = ?, secret_margin = ?, secret_floor = ?, updated_at = ?
        WHERE event_id = ? AND state = 'draft' AND is_final = 0
          AND pepper_epoch IS NULL AND secret_margin IS NULL AND secret_floor IS NULL
          AND ${EVENT_ON}`
    )
    .bind(epoch, margin, floor, hourStamp(nowIso), eventId, eventId)
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
  if (!epoch)
    return fail(
      409,
      'PEPPER_NOT_SET',
      'Voting cannot open here: the anonymous key is not configured'
    );
  const res = await db
    .prepare(
      `UPDATE vote_sets
          SET state = 'open', updated_at = ?
        WHERE event_id = ? AND state = 'closed' AND is_final = 0
          AND pepper_epoch IS NOT NULL AND pepper_epoch = ?
          AND ${EVENT_ON}`
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
 * Which sets this story may make final. `admin`: a set that never opened.
 * `job`: also a void set. A set that opened and is not void waits for S5,
 * which computes its result in the same step (see the header).
 */
const FINALIZABLE = {
  admin: (t = '') => `${t}pepper_epoch IS NULL`,
  job: (t = '') => `(${t}pepper_epoch IS NULL OR ${t}is_void = 1)`,
} as const;

/**
 * Make one set final, for good, in one batch: its objects close, the set closes,
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
  const results = await db.batch([
    db
      .prepare(
        `UPDATE votable_objects SET state = 'closed', closes_at = NULL, updated_at = ?
          WHERE set_id = ? AND event_id = ? AND state <> 'closed'
            AND set_id IN (SELECT id FROM vote_sets WHERE id = ? AND is_final = 0 AND ${may})`
      )
      .bind(hourStamp(nowIso), setId, eventId, setId),
    db
      .prepare(
        `UPDATE vote_sets
            SET is_final = 1, final_at = ?, state = 'closed', secret_margin = NULL, secret_floor = NULL, updated_at = ?
          WHERE id = ? AND event_id = ? AND is_final = 0 AND ${may}`
      )
      .bind(hourStamp(nowIso), hourStamp(nowIso), setId, eventId),
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
  return (results[1]?.meta?.changes ?? 0) > 0;
}

/** An admin's finalize. Only a set that never opened, in this story (see the header). */
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
  return fail(
    409,
    'RESULTS_NOT_BUILT',
    'A set that has opened becomes final when its results are computed, which a later release adds'
  );
}

// ── The objects ──────────────────────────────────────────────────────────────

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
  if (!isVotableKind(b.kind)) return fail(400, 'INVALID_KIND', 'kind must be song or stall');
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
  // kind, it is under the cap, and the booth is this event's. Then the object's
  // tally row, made with it (0111), only if the object was made.
  const [made] = await db.batch([
    db
      .prepare(
        `INSERT INTO votable_objects (id, event_id, set_id, kind, label, booth_id, group_id, sort)
         SELECT ?, s.event_id, s.id, ?, ?, ?, ?, ?
           FROM vote_sets s
          WHERE s.id = ? AND s.event_id = ? AND s.is_final = 0
            AND ${EVENT_ON}
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

/** Change an object's label, sort, booth or team. A team changes only before the first open. */
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
                            AND (pepper_epoch IS NULL OR votable_objects.group_id IS ?))
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
      booth,
      booth
    )
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    const now = await readVoteSet(db, eventId);
    if (now?.final) return FINAL;
    if (changesTeam && now?.opened)
      return fail(409, 'TEAM_FIXED', 'A team is fixed once the vote set has opened');
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
 * object. Opening needs the set open, not final, and the event on; it sets
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
                              AND ${EVENT_ON})`
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
    if (!(await eventStillOn(db, eventId))) return EVENT_OVER;
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
  errors: number;
}

const JOB_BATCH = 200;

/**
 * Every set reaches final (ADR-040 decisions 1 and 4). Nightly:
 *   1. A set whose event's last date is more than 7 days ago (or, with no date,
 *      untouched for 7 days with no object window in them, open or closed) and
 *      that this story may make final
 *      (never opened, or void) becomes final. Each is audited as
 *      VOTE_SET_FINAL against its event, with no detail: which rule decided is
 *      never written anywhere.
 *   2. Tallies of objects in sets final for more than 30 days are deleted.
 * Logs a total of sets made final and an error flag, nothing per set.
 */
export async function runVoteFinalJob(env: VoteFinalJobEnv): Promise<VoteFinalJobResult> {
  const out: VoteFinalJobResult = { finalized: 0, errors: 0 };
  const db = env.DB;
  if (!db) return out;
  const nowIso = new Date().toISOString();
  try {
    const due = await db
      .prepare(
        `SELECT s.id, s.event_id FROM vote_sets s
           JOIN events e ON e.id = s.event_id
          WHERE s.is_final = 0 AND ${FINALIZABLE.job('s.')}
            AND ((COALESCE(e.end_date, e.start_date) IS NOT NULL
                  AND substr(COALESCE(e.end_date, e.start_date), 1, 10) < date('now', ?))
              OR (COALESCE(e.end_date, e.start_date) IS NULL
                  AND s.updated_at < datetime('now', ?)
                  AND NOT EXISTS (SELECT 1 FROM votable_objects o
                                   WHERE o.set_id = s.id
                                     AND o.closes_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))))
          ORDER BY s.id
          LIMIT ?`
      )
      .bind(
        `-${VOTE_FINAL_AFTER_DAYS} days`,
        `-${VOTE_FINAL_AFTER_DAYS} days`,
        `-${VOTE_FINAL_AFTER_DAYS} days`,
        JOB_BATCH
      )
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
  console.log(
    JSON.stringify({
      type: 'VOTE_FINAL_JOB',
      finalized: out.finalized,
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
