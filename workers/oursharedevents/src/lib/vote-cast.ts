/**
 * One vote: the write behind the vote route (OSE-2128, S4a of OSE-1193; OSE
 * ADR-040 decisions 1, 4 and 6).
 *
 * An anonymous vote is a counter on an object, never a row about a voter. A
 * vote raises one side's counter on one object, once per voter key k per
 * object. k comes from the vote pass (lib/vote-pass.ts); the route checked the
 * pass before it calls this. Nothing here reads a cookie, and nothing here
 * logs.
 *
 * ONE D1 BATCH, ONE TRANSACTION:
 *   1. the receipt, HMAC(K_receipt, k ‖ object_id), is inserted if new, and
 *      only while: the object is this event's and open with its window ahead,
 *      its set is open, not final and not void, the set's pepper epoch is the
 *      one running now, and the event is live (EVENT_LIVE). These checks are
 *      inside the insert, so a close cannot land between a check and the write;
 *   2. the side's counter rises only when step 1 inserted a row
 *      (`changes() = 1`: the receipt was new). One statement for both sides,
 *      with the side bound, so the SQL text never names it;
 *   3. the team statement: on a team night, for an up vote, the team marker
 *      HMAC(K_team, k ‖ team_id) is inserted if step 2 counted (Q16): a voter
 *      who backs three of a team's songs adds one to its total. The statement
 *      is in every batch, whatever the side and whatever the night, with a
 *      null marker when it does not apply (it then writes nothing), and on a
 *      team night the marker is computed for both sides. So the batch, its
 *      statement count and the work done never depend on the side: the
 *      OPERATION_COST line (d1Queries) cannot carry it;
 *   4. the participant marker HMAC(K_participant, k ‖ set_id) is inserted if
 *      new, while this voter's receipt for the object exists;
 *   5. one read: does the receipt exist, and is the object still open?
 *
 * The outcome is `accepted` or `closed`. `accepted` covers both a vote that
 * counted now and one whose receipt was already there (the same pass, or a
 * re-scan, on the same object, whichever side): the route is never handed the
 * difference, so no edit there can answer or log it. A receipt has
 * no side and no time, and a receipt survives a reopen, so a voter who already
 * voted on an object never votes on it again.
 *
 * The pepper epoch: a set stamps the epoch when it first opens. When the epoch
 * running now differs, no receipt can be written (step 1), and voidOnEpochChange
 * (lib/vote-sets.ts) marks the set void with its reason: a void set publishes
 * nothing (decision 6).
 */

import { EVENT_LIVE } from './event-live';
import { voteParticipantMarker, voteReceipt, voteTeamMarker } from './votes';

/** The two sides of a vote. "Not for me" is `down`. */
export const VOTE_SIDES = ['up', 'down'] as const;
export type VoteSide = (typeof VOTE_SIDES)[number];

/**
 * What the route may know: the vote stands (`accepted`, counted now or
 * before: one shape on purpose) or the object is closed.
 */
export type CastOutcome = 'accepted' | 'closed';

/**
 * The object may take a vote now. Binds, in order: object id, event id, the
 * time now (ISO, the format closes_at is written in), the epoch running now,
 * and the event id again (EVENT_LIVE).
 */
const OPEN_NOW = `o.id = ? AND o.event_id = ?
     AND o.state = 'open' AND o.closes_at IS NOT NULL AND o.closes_at > ?
     AND s.state = 'open' AND s.is_final = 0 AND s.is_void = 0
     AND s.pepper_epoch IS NOT NULL AND s.pepper_epoch = ?
     AND ${EVENT_LIVE}`;

/**
 * The last bind is the Access Pass id, or null for a pass from the room (ADR-040
 * decision 13). The text is the same for both, so no log or query analytics can
 * tell an Access Pass vote from a room vote. A pass taken back while its vote
 * was in flight writes no receipt, so it is not counted (CCR loop 4, SEC-4).
 */
const RECEIPT_INSERT = `INSERT INTO vote_receipts (object_id, receipt)
   SELECT o.id, ?
     FROM votable_objects o
     JOIN vote_sets s ON s.id = o.set_id AND s.event_id = o.event_id
    WHERE ${OPEN_NOW}
      AND (? IS NULL OR EXISTS (SELECT 1 FROM vote_access_passes a
                                 WHERE a.id = ? AND a.event_id = s.event_id
                                   AND a.set_id = s.id AND a.is_revoked = 0))
   ON CONFLICT DO NOTHING`;

/**
 * Step 2. One statement for both sides, the side bound as a value (twice, then
 * the object id): the SQL text is the same whichever side, so neither the
 * Worker's log nor the database's own query analytics, which group by the
 * text, can tell an up vote from a "not for me". No column name is built from
 * input: `(? = 'up')` is 1 or 0.
 */
const COUNT = `UPDATE vote_tallies
    SET up_count = up_count + (? = 'up'), down_count = down_count + (? = 'down')
  WHERE object_id = ? AND changes() = 1`;

/**
 * Step 3. Binds set id, team id, marker, then the marker again: a null marker
 * (not a team night, or not an up vote) writes nothing, so the statement can
 * sit in every batch.
 */
const TEAM_MARKER_INSERT = `INSERT INTO vote_team_markers (set_id, team_id, marker)
   SELECT ?, ?, ? WHERE changes() = 1 AND ? IS NOT NULL
   ON CONFLICT DO NOTHING`;

const PARTICIPANT_INSERT = `INSERT INTO vote_participants (set_id, marker)
   SELECT ?, ?
    WHERE EXISTS (SELECT 1 FROM vote_receipts WHERE object_id = ? AND receipt = ?)
   ON CONFLICT DO NOTHING`;

const AFTER = `SELECT
     EXISTS (SELECT 1 FROM vote_receipts WHERE object_id = ? AND receipt = ?) AS held,
     EXISTS (SELECT 1 FROM votable_objects o
               JOIN vote_sets s ON s.id = o.set_id AND s.event_id = o.event_id
              WHERE ${OPEN_NOW}) AS open_now`;

/** The object's set and team, to build the markers. Null when it is not this event's. */
const OBJECT_READ = `SELECT o.set_id, o.group_id, s.played_by
   FROM votable_objects o
   JOIN vote_sets s ON s.id = o.set_id AND s.event_id = o.event_id
  WHERE o.id = ? AND o.event_id = ?`;

export interface CastInput {
  eventId: string;
  objectId: string;
  side: VoteSide;
  /** The voter key from the pass. 64 lowercase hex characters. */
  k: string;
  /** The epoch running now (pepperEpoch of ANON_ID_HASH_PEPPER). */
  epoch: string;
  nowMs: number;
  /** The Access Pass behind this pass (claim `a`), checked in the same statement. */
  accessId?: string | null;
}

/**
 * Cast one vote. Returns null when a marker could not be made (no pepper, or k
 * is not a key): nothing is written then, and no fallback value is made.
 */
export async function castVote(
  db: D1Database,
  pepper: string | undefined,
  input: CastInput
): Promise<CastOutcome | null> {
  const { eventId, objectId, side, k, epoch } = input;
  const obj = await db
    .prepare(OBJECT_READ)
    .bind(objectId, eventId)
    .first<{ set_id: string; group_id: string | null; played_by: string | null }>();
  if (!obj) return 'closed';
  const receipt = await voteReceipt(pepper, k, objectId);
  const participant = await voteParticipantMarker(pepper, k, obj.set_id);
  if (!receipt || !participant) return null;
  // The night, never the side, decides whether a team marker is made: on a
  // team night it is made for both sides, so the work is the same.
  const teamNight = obj.played_by === 'team' && !!obj.group_id;
  const made = teamNight ? await voteTeamMarker(pepper, k, obj.group_id as string) : null;
  if (teamNight && !made) return null;
  const team = side === 'up' ? made : null;

  const nowIso = new Date(input.nowMs).toISOString();
  const open = [objectId, eventId, nowIso, epoch, eventId];
  const statements = [
    db
      .prepare(RECEIPT_INSERT)
      .bind(receipt, ...open, input.accessId ?? null, input.accessId ?? null),
    db.prepare(COUNT).bind(side, side, objectId),
    db.prepare(TEAM_MARKER_INSERT).bind(obj.set_id, obj.group_id ?? null, team, team),
    db.prepare(PARTICIPANT_INSERT).bind(obj.set_id, participant, objectId, receipt),
    db.prepare(AFTER).bind(objectId, receipt, ...open),
  ];
  const results = await db.batch(statements);
  // Counted now: the receipt was new, so the object was open when it landed.
  if ((results[1]?.meta?.changes ?? 0) === 1) return 'accepted';
  const after = (results[results.length - 1]?.results?.[0] ?? {}) as {
    held?: number;
    open_now?: number;
  };
  // Counted before, and still open: the same answer as counted now.
  return Number(after.held) === 1 && Number(after.open_now) === 1 ? 'accepted' : 'closed';
}
