/**
 * The Online Pick (OSE ADR-040 decision 13; owner, 2026-11-26, explicit go at
 * 05:22 UTC): an optional second vote, beside the room's, that anyone online can
 * join, for fun. It has its own result and NEVER touches the Room Pick.
 *
 * TWO CHANNELS, NEVER MIXED. The Online Pick rides on the room set's objects
 * (the same ids, the same open windows) but writes only its own tables:
 * vote_crowd_sets, vote_crowd_tallies, vote_crowd_receipts and
 * vote_crowd_participants (migration 0123). Its voter key and its pass seal are
 * its own HKDF labels (lib/vote-pass.ts), so a crowd pass never opens as a room
 * pass. No statement in this file names a room counter or marker table, and no
 * room statement names a crowd table: the T0 gate
 * (tests/e2e/0-architecture/votes-never-who.invariant.spec.ts, "channels never
 * mix") fails on any SQL literal that names both. No crowd number is ever a
 * tiebreak, a weight, a bonus or a seed for the room.
 *
 * THE RULES (decision 13):
 *   - Off by default. Only an event admin of the brand turns it on, per event;
 *     a sponsor cannot. Not on a team night (v1): the room's result is by team
 *     and the crowd's would not compare.
 *   - It takes a vote only while the room set is open, the object is open, the
 *     Online Pick is on, and the event is live. So it closes when the room
 *     closes, and cannot be announced first.
 *   - Its own secret T (5 to 9) and V (10 to 14), drawn once when it is first
 *     turned on, never redrawn, nulled at final. The same publishing rule as the
 *     room: the winner, or "too close to call", after final, nothing else.
 *   - It becomes final only after the room set is final
 *     (finalizeOnlinePickAndPasses), so both results come out together and the
 *     room's is never later than the crowd's.
 *   - At final its receipts, markers and tallies are deleted at once: nothing
 *     needs them, so nothing keeps them.
 *   - Labels are fixed platform words: "Room Pick" and "Online Pick". No skin,
 *     host or sponsor renames or reorders them (lib/vote-page-render.ts).
 *
 * WHY THIS IS SAFE FOR THE ROOM. A bot farm, a sponsor's mailing list or a
 * host's friends can win the Online Pick, and the Room Pick does not move: the
 * room's result reads room tables only (lib/vote-results.ts).
 */

import { hourStamp } from './scan-buffer';
import type { VoteFloodEnv } from './vote-flood';
import { pepperEpoch } from './anon-id-hash';
import { EVENT_LIVE } from './event-live';
import { voteCrowdParticipantMarker, voteCrowdReceipt } from './votes';
import { deleteAccessPassesOfFinalSet } from './vote-access-pass';
import { drawUniform, SECRET_FLOOR_RANGE, SECRET_MARGIN_RANGE } from './vote-sets';
import type { VoteSide } from './vote-cast';

export type CrowdFail = { ok: false; status: number; code: string; error: string };
export type CrowdResult<T> = { ok: true; value: T } | CrowdFail;
const fail = (status: number, code: string, error: string): CrowdFail => ({
  ok: false,
  status,
  code,
  error,
});

/** The fixed words. Platform text: no skin, host or sponsor can change them. */
export const ROOM_PICK_WORDS = 'Room Pick';
export const ONLINE_PICK_WORDS = 'Online Pick';
export const ONLINE_PICK_HOST_NOTE =
  "Lets people who aren't here vote for fun. It never changes the Room Pick.";
export const ONLINE_PICK_GAMEABLE_NOTE =
  "Anyone can vote here, so this can be gamed. That's why it's for fun and never the official result.";

/**
 * What the host sees: whether it is on, whether it is final, and whether the
 * swarm alarm tripped. Never a count, T or V.
 */
export interface OnlinePickView {
  on: boolean;
  final: boolean;
  burst_seen: boolean;
}

/** The host's words when the swarm alarm tripped. Only the host sees them. */
export const ONLINE_PICK_BURST_WORDS =
  'More Online Pick links were opened in one minute than a full room would. Someone may be gaming the Online Pick. The Room Pick is not affected.';

const NO_SET = fail(404, 'VOTE_SET_NOT_FOUND', 'This event has no vote set');
const SET_DONE = fail(409, 'VOTE_SET_FINAL', 'This vote is over');
const TEAM_NIGHT = fail(
  409,
  'ONLINE_PICK_TEAM_NIGHT',
  'The Online Pick is for nights played by songs, stalls or entries, not teams'
);

/** The host's view of the Online Pick, or off when it was never turned on. */
export async function readOnlinePick(db: D1Database, eventId: string): Promise<OnlinePickView> {
  const row = await db
    .prepare(`SELECT is_on, is_final, burst_seen FROM vote_crowd_sets WHERE event_id = ?`)
    .bind(eventId)
    .first<{ is_on: number; is_final: number; burst_seen: number }>();
  return { on: row?.is_on === 1, final: row?.is_final === 1, burst_seen: row?.burst_seen === 1 };
}

/**
 * Turn the Online Pick on or off for the event's set. On draws T and V and
 * stamps the epoch the first time only; later turns keep them. Refused once the
 * room set is final or void, and on a team night.
 */
export async function setOnlinePick(
  db: D1Database,
  eventId: string,
  on: boolean,
  pepper: string | undefined,
  nowIso: string
): Promise<CrowdResult<OnlinePickView>> {
  const set = await db
    .prepare(`SELECT id, played_by, is_final, is_void FROM vote_sets WHERE event_id = ?`)
    .bind(eventId)
    .first<{ id: string; played_by: string | null; is_final: number; is_void: number }>();
  if (!set) return NO_SET;
  if (set.is_final === 1 || set.is_void === 1) return SET_DONE;
  if (set.played_by === 'team') return TEAM_NIGHT;
  if (on) {
    const epoch = await pepperEpoch(pepper);
    if (!epoch)
      return fail(503, 'VOTING_UNAVAILABLE', 'The Online Pick is not available right now');
    await db.batch([
      db
        .prepare(
          `INSERT INTO vote_crowd_sets (set_id, event_id, is_on, pepper_epoch, secret_margin, secret_floor, updated_at)
           SELECT s.id, s.event_id, 1, ?, ?, ?, ?
             FROM vote_sets s WHERE s.id = ? AND s.event_id = ? AND s.is_final = 0 AND s.is_void = 0
           ON CONFLICT (set_id) DO NOTHING`
        )
        .bind(
          epoch,
          drawUniform(...SECRET_MARGIN_RANGE),
          drawUniform(...SECRET_FLOOR_RANGE),
          hourStamp(nowIso),
          set.id,
          eventId
        ),
      db
        .prepare(
          `UPDATE vote_crowd_sets SET is_on = 1, updated_at = ?
            WHERE set_id = ? AND event_id = ? AND is_final = 0`
        )
        .bind(hourStamp(nowIso), set.id, eventId),
    ]);
  } else {
    await db
      .prepare(
        `UPDATE vote_crowd_sets SET is_on = 0, updated_at = ?
          WHERE set_id = ? AND event_id = ? AND is_final = 0`
      )
      .bind(hourStamp(nowIso), set.id, eventId)
      .run();
  }
  return { ok: true, value: await readOnlinePick(db, eventId) };
}

/**
 * May the crowd entry mint a crowd pass for this event? The Online Pick is on
 * and not final, the room set is open, not final and not void, and the event
 * is live. One statement.
 */
export async function onlinePickMayMint(db: D1Database, eventId: string): Promise<boolean> {
  return !!(await db
    .prepare(
      `SELECT 1 AS hit FROM vote_crowd_sets c
         JOIN vote_sets s ON s.id = c.set_id AND s.event_id = c.event_id
        WHERE c.event_id = ? AND c.is_on = 1 AND c.is_final = 0
          AND s.state = 'open' AND s.is_final = 0 AND s.is_void = 0
          AND ${EVENT_LIVE}`
    )
    .bind(eventId, eventId)
    .first());
}

/**
 * The object may take an Online Pick vote now: the room object and set are
 * open (the same windows), the Online Pick is on and not final, its epoch is the
 * one running now, and the event is live. Binds: object id, event id, now,
 * epoch, event id.
 */
const CROWD_OPEN_NOW = `o.id = ? AND o.event_id = ?
     AND o.state = 'open' AND o.closes_at IS NOT NULL AND o.closes_at > ?
     AND s.state = 'open' AND s.is_final = 0 AND s.is_void = 0
     AND c.is_on = 1 AND c.is_final = 0
     AND c.pepper_epoch IS NOT NULL AND c.pepper_epoch = ?
     AND ${EVENT_LIVE}`;

const CROWD_FROM = `FROM votable_objects o
     JOIN vote_sets s ON s.id = o.set_id AND s.event_id = o.event_id
     JOIN vote_crowd_sets c ON c.set_id = s.id AND c.event_id = s.event_id`;

/** Step 0: the object's crowd counter row, made the first time it is voted on. */
const CROWD_TALLY_ROW = `INSERT INTO vote_crowd_tallies (object_id)
   SELECT o.id ${CROWD_FROM} WHERE ${CROWD_OPEN_NOW}
   ON CONFLICT DO NOTHING`;

const CROWD_RECEIPT_INSERT = `INSERT INTO vote_crowd_receipts (object_id, receipt)
   SELECT o.id, ? ${CROWD_FROM} WHERE ${CROWD_OPEN_NOW}
   ON CONFLICT DO NOTHING`;

const CROWD_COUNT = `UPDATE vote_crowd_tallies
    SET up_count = up_count + (? = 'up'), down_count = down_count + (? = 'down')
  WHERE object_id = ? AND changes() = 1`;

const CROWD_PARTICIPANT_INSERT = `INSERT INTO vote_crowd_participants (set_id, marker)
   SELECT ?, ?
    WHERE EXISTS (SELECT 1 FROM vote_crowd_receipts WHERE object_id = ? AND receipt = ?)
   ON CONFLICT DO NOTHING`;

const CROWD_AFTER = `SELECT
     EXISTS (SELECT 1 FROM vote_crowd_receipts WHERE object_id = ? AND receipt = ?) AS held,
     EXISTS (SELECT 1 ${CROWD_FROM} WHERE ${CROWD_OPEN_NOW}) AS open_now`;

export interface CrowdCastInput {
  eventId: string;
  objectId: string;
  side: VoteSide;
  k: string;
  epoch: string;
  nowMs: number;
}

/**
 * One Online Pick vote, in one batch, the room's shape: the receipt if new and
 * open, the counter only when the receipt was new, the participant marker, one
 * read. `accepted` for counted and already counted alike; `closed` otherwise.
 * Null when a marker could not be made.
 */
export async function castCrowdVote(
  db: D1Database,
  pepper: string | undefined,
  input: CrowdCastInput
): Promise<'accepted' | 'closed' | null> {
  const { eventId, objectId, side, k, epoch } = input;
  const obj = await db
    .prepare(`SELECT o.set_id FROM votable_objects o WHERE o.id = ? AND o.event_id = ?`)
    .bind(objectId, eventId)
    .first<{ set_id: string }>();
  if (!obj) return 'closed';
  const receipt = await voteCrowdReceipt(pepper, k, objectId);
  const participant = await voteCrowdParticipantMarker(pepper, k, obj.set_id);
  if (!receipt || !participant) return null;
  const open = [objectId, eventId, new Date(input.nowMs).toISOString(), epoch, eventId];
  const results = await db.batch([
    db.prepare(CROWD_TALLY_ROW).bind(...open),
    db.prepare(CROWD_RECEIPT_INSERT).bind(receipt, ...open),
    db.prepare(CROWD_COUNT).bind(side, side, objectId),
    db.prepare(CROWD_PARTICIPANT_INSERT).bind(obj.set_id, participant, objectId, receipt),
    db.prepare(CROWD_AFTER).bind(objectId, receipt, ...open),
  ]);
  if ((results[2]?.meta?.changes ?? 0) === 1) return 'accepted';
  const after = (results[4]?.results?.[0] ?? {}) as { held?: number; open_now?: number };
  return Number(after.held) === 1 && Number(after.open_now) === 1 ? 'accepted' : 'closed';
}

/**
 * The Online Pick's outcome, decided in SQL from crowd tables only, the room's
 * rule: V distinct crowd voters, and a lead of at least T over the runner-up,
 * by up counts. Guarded so it runs only when the room set is already final.
 */
const CROWD_OUTCOME = `UPDATE vote_crowd_sets
   SET outcome = CASE
         WHEN secret_floor IS NOT NULL AND secret_margin IS NOT NULL
          AND (SELECT COUNT(*) FROM vote_crowd_participants p WHERE p.set_id = vote_crowd_sets.set_id) >= secret_floor
          AND COALESCE((SELECT t.up_count FROM vote_crowd_tallies t JOIN votable_objects o ON o.id = t.object_id
                 WHERE o.set_id = vote_crowd_sets.set_id ORDER BY t.up_count DESC, o.id LIMIT 1), 0)
            - COALESCE((SELECT t.up_count FROM vote_crowd_tallies t JOIN votable_objects o ON o.id = t.object_id
                 WHERE o.set_id = vote_crowd_sets.set_id ORDER BY t.up_count DESC, o.id LIMIT 1 OFFSET 1), 0)
            >= secret_margin
         THEN 'winner' ELSE 'too_close' END,
       winner_object_id = NULL
 WHERE set_id = ? AND is_final = 0 AND pepper_epoch IS NOT NULL
   AND set_id IN (SELECT id FROM vote_sets WHERE id = ? AND is_final = 1 AND is_void = 0)`;

const CROWD_WINNER = `UPDATE vote_crowd_sets
   SET winner_object_id = (SELECT o.id FROM vote_crowd_tallies t JOIN votable_objects o ON o.id = t.object_id
                            WHERE o.set_id = vote_crowd_sets.set_id ORDER BY t.up_count DESC, o.id LIMIT 1)
 WHERE set_id = ? AND is_final = 0 AND outcome = 'winner'
   AND set_id IN (SELECT id FROM vote_sets WHERE id = ? AND is_final = 1)`;

const CROWD_FINAL = `UPDATE vote_crowd_sets
   SET is_final = 1, is_on = 0, secret_margin = NULL, secret_floor = NULL
 WHERE set_id = ? AND is_final = 0
   AND set_id IN (SELECT id FROM vote_sets WHERE id = ? AND is_final = 1)`;

/**
 * After the room set is final: the Online Pick's result, its final lock, the
 * deletion of its receipts, markers and counters, and the deletion of the set's
 * Access Passes. One batch. Every statement is guarded by the room set being
 * final, so calling it early does nothing, and calling it twice does nothing
 * more. A void room set publishes no Online Pick either.
 */
export async function finalizeOnlinePickAndPasses(db: D1Database, setId: string): Promise<void> {
  const finalRoom = `IN (SELECT o.id FROM votable_objects o JOIN vote_sets s ON s.id = o.set_id
                          WHERE s.id = ? AND s.is_final = 1)`;
  await db.batch([
    db.prepare(CROWD_OUTCOME).bind(setId, setId),
    db.prepare(CROWD_WINNER).bind(setId, setId),
    db.prepare(CROWD_FINAL).bind(setId, setId),
    db.prepare(`DELETE FROM vote_crowd_receipts WHERE object_id ${finalRoom}`).bind(setId),
    db.prepare(`DELETE FROM vote_crowd_tallies WHERE object_id ${finalRoom}`).bind(setId),
    db
      .prepare(
        `DELETE FROM vote_crowd_participants
          WHERE set_id = ? AND set_id IN (SELECT id FROM vote_sets WHERE id = ? AND is_final = 1)`
      )
      .bind(setId, setId),
    deleteAccessPassesOfFinalSet(db, setId),
  ]);
}

/**
 * Room sets that are final but still hold Online Pick or Access Pass rows: a
 * finalize whose follow-up batch failed. The nightly job finishes them.
 */
export async function finalSetsWithLeftovers(db: D1Database): Promise<string[]> {
  const rs = await db
    .prepare(
      `SELECT s.id FROM vote_sets s
        WHERE s.is_final = 1
          AND (EXISTS (SELECT 1 FROM vote_crowd_sets c WHERE c.set_id = s.id AND c.is_final = 0)
            OR EXISTS (SELECT 1 FROM vote_access_passes a WHERE a.set_id = s.id))
        LIMIT 200`
    )
    .all<{ id: string }>();
  return (rs.results ?? []).map((r) => r.id);
}

/** The Online Pick's result as the voter page shows it, after both are final. */
export type PublicCrowdResult = { outcome: 'winner'; label: string } | { outcome: 'too_close' };

export async function readPublicCrowdResult(
  db: D1Database,
  eventId: string
): Promise<PublicCrowdResult | null> {
  const row = await db
    .prepare(
      `SELECT c.outcome AS outcome,
              (SELECT w.label FROM votable_objects w
                WHERE w.id = c.winner_object_id AND w.set_id = c.set_id) AS winner_label
         FROM vote_crowd_sets c
         JOIN vote_sets s ON s.id = c.set_id AND s.event_id = c.event_id
        WHERE c.event_id = ? AND c.is_final = 1 AND c.outcome IS NOT NULL
          AND s.is_final = 1 AND s.is_void = 0
        LIMIT 1`
    )
    .bind(eventId)
    .first<{ outcome: string | null; winner_label: string | null }>();
  if (!row) return null;
  if (row.outcome === 'too_close') return { outcome: 'too_close' };
  if (row.outcome === 'winner' && row.winner_label)
    return { outcome: 'winner', label: String(row.winner_label) };
  return null;
}

/**
 * The Online Pick's swarm alarm (F1 of the 2026-11-26 sweep), the room's
 * alarm (lib/vote-flood.ts) applied to the Online Pick's way in. Every crowd
 * pass `/q/crowd/:eventId` mints counts once in the same Workers Rate Limiting
 * binding, under its own key (`crowd-flood:` and the event id only). Past
 * VOTE_FLOOD_PASSES_PER_MINUTE in a minute, vote_crowd_sets.burst_seen turns
 * to 1, once. The host sees it; no public answer carries it.
 *
 * It detects and never blocks: the Online Pick is gameable by design and says
 * so. Its use is to tell the host that the for-fun result was swarmed. No
 * count, time, address, cookie or pass is kept. Never throws.
 */
export const MARK_CROWD_FLOOD_SQL = `UPDATE vote_crowd_sets SET burst_seen = 1
  WHERE event_id = ? AND burst_seen = 0 AND is_final = 0`;

export function crowdFloodKey(eventId: string): string {
  return `crowd-flood:${eventId}`;
}

const crowdFlagged = new Set<string>();

/** For tests only: forget what this isolate has flagged. */
export function resetCrowdFloodMemo(): void {
  crowdFlagged.clear();
}

export async function noteCrowdPassMinted(env: VoteFloodEnv, eventId: string): Promise<boolean> {
  const limiter = env.VOTE_FLOOD_LIMITER;
  if (!limiter || !eventId || !env.DB) return false;
  try {
    const { success } = await limiter.limit({ key: crowdFloodKey(eventId) });
    if (success || crowdFlagged.has(eventId)) return false;
    const res = await env.DB.prepare(MARK_CROWD_FLOOD_SQL).bind(eventId).run();
    if (crowdFlagged.size >= 1000) crowdFlagged.clear();
    crowdFlagged.add(eventId);
    return (res.meta?.changes ?? 0) > 0;
  } catch {
    return false;
  }
}
