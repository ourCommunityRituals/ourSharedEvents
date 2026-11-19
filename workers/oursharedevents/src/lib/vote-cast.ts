/**
 * The vote write: one vote per object per voter (OSE-2128, S4a of OSE-1193;
 * OSE ADR-040 decisions 1, 4, 5, 6 and 11).
 *
 * The vote route (handlers/vote.ts) checks the request (the switch, JSON only,
 * same-origin) and hands the body here. This file checks the rest and writes:
 *
 *   1. THE PASS (decision 6). `/q` minted it from the anonymous browser id; this
 *      file never sees a browser id. openVotePass (lib/vote-pass.ts) checks its
 *      MAC in constant time (WebCrypto verify), its shape, its expiry (30
 *      minutes), its event against the path's, and its pepper epoch against the
 *      current one. No pepper: nothing is checked and nothing is written.
 *   2. THREE EPOCHS. The pass's, the set's (stamped once at the first open) and
 *      the current one must all match (epochsMatch). On the first mismatch the
 *      vote is refused and, while the set is open, the set is marked void with
 *      its reason: the pepper rotated under an open set, so no later vote could
 *      count there and the night publishes nothing (decision 6).
 *   3. THE OBJECT, THE SET AND THE EVENT, inside every statement of the batch:
 *      the object is this event's and open with `closes_at` ahead; its set is
 *      open, not final and not void, with the current epoch; the event is live
 *      (EVENT_LIVE, lib/event-live.ts; decision 11). A close, a final or a void
 *      cannot land between a check and the write, because the check is in the
 *      write.
 *   4. ONE D1 BATCH, one transaction. It first reads whether the object can
 *      take a vote (the checks in 3), so a vote that meets a close, a final or
 *      a void answers NOT_OPEN even when the close landed a moment before the
 *      batch. Then each write but the last runs only while this voter's receipt
 *      for the object is not there yet, and the last writes that receipt:
 *        a. raise the side's counter on the object's tally;
 *        b. on a team night, for an up vote, add the voter's team marker
 *           HMAC(K_team, k ‖ team_id) if it is new (Q16);
 *        c. add the voter's participant marker HMAC(K_participant, k ‖ set_id)
 *           if it is new;
 *        d. add the receipt HMAC(K_receipt, k ‖ object_id) if it is new.
 *      The story lists the receipt first and "raise the counter only if the
 *      receipt was new". Here the receipt is written last and every earlier
 *      statement asks whether it is there, which is the same rule without
 *      leaning on SQLite's changes() between statements of a batch. A D1 batch
 *      is one transaction and D1 runs one at a time, so two votes with one pass
 *      cannot both find the receipt missing.
 *
 * A duplicate (a second vote by the same voter on the same object, either
 * side) changes nothing, and the caller cannot tell it from a counted vote:
 * castVote answers 'accepted' for both and does not know which it was. The
 * batch has the same five statements every time, whatever the side or the
 * night (the team statement selects nothing when it does not apply), so the
 * number of statements says nothing either.
 *
 * NOTHING ABOUT A VOTER IS KEPT. k comes from the pass and is used only to make
 * the three markers; it is stored nowhere. A receipt carries no side. Nothing
 * here logs, and nothing here returns a count, a marker or the pass.
 *
 * Gates: tests/vote-cast.spec.ts (workers pool) and
 * tests/e2e/0-architecture/votes-never-who.invariant.spec.ts (T0).
 */

import { pepperEpoch } from './anon-id-hash';
import { EVENT_LIVE } from './event-live';
import { openVotePass } from './vote-pass';
import { isVoteTeamId, voteParticipantMarker, voteReceipt, voteTeamMarker } from './votes';

/** The two sides a vote can take: up, and "not for me". */
export const VOTE_SIDES = ['up', 'down'] as const;
export type VoteSide = (typeof VOTE_SIDES)[number];

/**
 * What the route answers. 'accepted' is a counted vote and a duplicate alike.
 * 'not_open' covers every reason the object cannot take a vote now: unknown,
 * another event's, draft, closed, past its window, its set not open, final or
 * void, the event not live, or an epoch mismatch.
 */
export type CastOutcome = 'accepted' | 'not_open' | 'pass_refused' | 'unavailable';

export interface CastInput {
  eventId: string;
  objectId: string;
  side: VoteSide;
  pass: unknown;
  nowMs: number;
}

/** True for a side on {@link VOTE_SIDES}. */
export function isVoteSide(value: unknown): value is VoteSide {
  return typeof value === 'string' && (VOTE_SIDES as readonly string[]).includes(value);
}

/**
 * The pass's epoch, the set's and the current one: all three present and
 * equal. Comparing two of them is not enough: a set stamped under an old
 * pepper must refuse a pass minted under the new one, and the reverse.
 */
export function epochsMatch(
  passEpoch: string | null | undefined,
  setEpoch: string | null | undefined,
  currentEpoch: string | null | undefined
): boolean {
  return (
    typeof passEpoch === 'string' &&
    typeof setEpoch === 'string' &&
    typeof currentEpoch === 'string' &&
    passEpoch.length > 0 &&
    passEpoch === setEpoch &&
    setEpoch === currentEpoch
  );
}

/**
 * The object can take a vote now. It names `o` (the object) and `s` (its set)
 * and takes five bound values, in order: the object id, the event id, now (ISO,
 * the format closes_at is written in), the current epoch, the event id.
 */
const LIVE_OBJECT = `FROM votable_objects o
  JOIN vote_sets s ON s.id = o.set_id AND s.event_id = o.event_id
 WHERE o.id = ? AND o.event_id = ?
   AND o.state = 'open' AND o.closes_at IS NOT NULL AND o.closes_at > ?
   AND s.state = 'open' AND s.is_final = 0 AND s.is_void = 0 AND s.pepper_epoch = ?
   AND ${EVENT_LIVE}`;

/** Whether the object can take a vote now, read inside the batch. */
const STILL_LIVE = `SELECT 1 AS live ${LIVE_OBJECT}`;

/** This voter's receipt for the object is not there yet. Two bound values: the object id, the receipt. */
const NOT_YET_COUNTED = `NOT EXISTS (SELECT 1 FROM vote_receipts r WHERE r.object_id = ? AND r.receipt = ?)`;

/** a. The side's counter rises, only for a new receipt. */
const RAISE_TALLY = `UPDATE vote_tallies
    SET up_count = up_count + (? = 'up'), down_count = down_count + (? = 'down')
  WHERE object_id = ?
    AND EXISTS (SELECT 1 ${LIVE_OBJECT})
    AND ${NOT_YET_COUNTED}`;

/** b. On a team night, for an up vote, the voter's marker for the song's team. */
const ADD_TEAM_MARKER = `INSERT INTO vote_team_markers (set_id, team_id, marker)
  SELECT s.id, o.group_id, ? ${LIVE_OBJECT}
     AND s.played_by = 'team' AND o.group_id = ? AND ? = 'up'
     AND ${NOT_YET_COUNTED}
  ON CONFLICT DO NOTHING`;

/** c. The voter's marker for the set. */
const ADD_PARTICIPANT = `INSERT INTO vote_participants (set_id, marker)
  SELECT s.id, ? ${LIVE_OBJECT}
     AND s.id = ?
     AND ${NOT_YET_COUNTED}
  ON CONFLICT DO NOTHING`;

/** d. The receipt: one vote per voter per object. Last, so a-c can ask for it. */
const ADD_RECEIPT = `INSERT INTO vote_receipts (object_id, receipt)
  SELECT o.id, ? ${LIVE_OBJECT}
  ON CONFLICT DO NOTHING`;

/**
 * The set of an object of this event, read before the batch: the set's id,
 * play mode and epoch, and the object's team. A team is fixed once the set has
 * opened (lib/vote-sets.ts), so the team marker made from it matches the row
 * the batch writes (the batch checks `o.group_id = ?` again). No counter, no
 * secret.
 */
const OBJECT_AND_SET = `SELECT o.group_id AS group_id, s.id AS set_id, s.played_by AS played_by,
       s.pepper_epoch AS pepper_epoch, s.state AS state
  FROM votable_objects o
  JOIN vote_sets s ON s.id = o.set_id AND s.event_id = o.event_id
 WHERE o.id = ? AND o.event_id = ?`;

/**
 * A pepper rotated under an open set: mark it void, once, with its reason
 * (decision 6). A void set publishes nothing, and nothing un-voids it.
 */
const VOID_SET = `UPDATE vote_sets
    SET is_void = 1, void_reason = 'pepper_epoch', updated_at = strftime('%Y-%m-%d %H:00:00', 'now')
  WHERE id = ? AND state = 'open' AND is_final = 0 AND is_void = 0
    AND pepper_epoch IS NOT NULL AND pepper_epoch <> ?`;

interface ObjectAndSet {
  group_id: string | null;
  set_id: string;
  played_by: string | null;
  pepper_epoch: string | null;
  state: string;
}

/**
 * Check one vote and write it. Answers 'accepted' for a counted vote and for a
 * duplicate alike; never a count. Throws only on a database failure, which the
 * route answers as 'unavailable'.
 */
export async function castVote(
  db: D1Database,
  pepper: string | undefined,
  input: CastInput
): Promise<CastOutcome> {
  const current = await pepperEpoch(pepper);
  if (!pepper || !current) return 'unavailable';

  const claims = await openVotePass(pepper, input.pass, input.nowMs, input.eventId);
  if (!claims) return 'pass_refused';

  const row = await db
    .prepare(OBJECT_AND_SET)
    .bind(input.objectId, input.eventId)
    .first<ObjectAndSet>();
  if (!row || !row.pepper_epoch) return 'not_open';

  if (!epochsMatch(claims.pepper_epoch, row.pepper_epoch, current)) {
    if (row.pepper_epoch !== current) await db.prepare(VOID_SET).bind(row.set_id, current).run();
    return 'not_open';
  }

  const k = claims.k;
  const team = isVoteTeamId(row.group_id) ? row.group_id : null;
  const [receipt, participant, teamMarker] = await Promise.all([
    voteReceipt(pepper, k, input.objectId),
    voteParticipantMarker(pepper, k, row.set_id),
    // Made for either side when the object has a team, so an up vote and a
    // "not for me" do the same work; the statement writes it for up only.
    team ? voteTeamMarker(pepper, k, team) : Promise.resolve(null),
  ]);
  if (!receipt || !participant) return 'unavailable';

  const nowIso = new Date(input.nowMs).toISOString();
  const live = [input.objectId, input.eventId, nowIso, current, input.eventId];
  const notYet = [input.objectId, receipt];
  const [still] = await db.batch([
    db.prepare(STILL_LIVE).bind(...live),
    db.prepare(RAISE_TALLY).bind(input.side, input.side, input.objectId, ...live, ...notYet),
    db.prepare(ADD_TEAM_MARKER).bind(teamMarker, ...live, team, input.side, ...notYet),
    db.prepare(ADD_PARTICIPANT).bind(participant, ...live, row.set_id, ...notYet),
    db.prepare(ADD_RECEIPT).bind(receipt, ...live),
  ]);
  // The writes ran under the same checks in the same transaction: no row here
  // means none of them wrote anything.
  return (still?.results?.length ?? 0) > 0 ? 'accepted' : 'not_open';
}
