/**
 * The night's result, decided once, inside SQL, when a vote set becomes final
 * (OSE-2130, S5 of OSE-1193; OSE ADR-040 decisions 4, 7 and 8).
 *
 * ONE RESULT PER SET (Q14). The winner of the night, or "too close to call,
 * the champion retains". Nothing else: no per-song result, no standings, no
 * runner-up, no count, no voter number, no team total, no reason.
 *
 * THE RULE, run on numbers that never leave the database:
 *   - A night played by songs or stalls: the object with the largest up count,
 *     against the runner-up object. "Not for me" counts are not used.
 *   - A night played by teams (Q16): the team with the largest total, against
 *     the runner-up team, where a team's total is the number of distinct
 *     voters who gave any of its songs an up vote: the count of its team
 *     markers. A team's songs' up counts are never summed.
 *   - A winner needs (a) at least V distinct voters on the set (participant
 *     markers, counted raw; V is the secret floor, 10 to 14), and (b) a lead
 *     over the runner-up of at least T (the secret margin, 5 to 9). Otherwise
 *     the night is too close to call. There is no tiebreak (Q17): a tie is a
 *     lead of 0, so it is too close to call.
 *   - A set that never opened, or is void, gets no outcome at all.
 *
 * WHY IN SQL. resultStatements() returns three UPDATEs that read the tallies,
 * the markers, T and V and write only `outcome`, the winner's id and the
 * one-way integrity flag (the room size check). finalizeVoteSet
 * (lib/vote-sets.ts) runs them in the SAME D1 batch, ahead of the statement that
 * sets is_final and nulls T and V, and the deletes of the receipts and markers,
 * under the same guard. So the result, final, the nulling and the deletion are
 * one transaction, and no count, T or V is ever read into the Worker: nothing
 * here can log or answer one (tests/e2e/0-architecture/votes-never-who.invariant.spec.ts
 * lists this file on COUNT_READERS and SECRET_READERS, never a handler).
 *
 * The outcome says nothing about which rule decided: a night under V and a
 * night with a narrow lead read word for word the same.
 */

/** A night's outcome, as the admin list and the voter page read it. */
export const VOTE_OUTCOMES = ['winner', 'too_close'] as const;
export type VoteOutcome = (typeof VOTE_OUTCOMES)[number];

/** The words for a night with no winner, whichever rule decided it (decision 7). */
export const TOO_CLOSE_WORDS = 'Too close to call. The champion retains.';

// Each statement is one literal, with no interpolation, so the T0 gate
// (votes-never-who, rule 5) can read every column it sets. Every subquery is
// correlated to the row being updated (`vote_sets.id`), so no id is bound
// inside SET. Ties order by id so a statement always picks one row; a tie is a
// lead of 0 and never wins, so which row it picks never shows.

/**
 * Statement 1: the outcome. A winner needs the distinct voters to reach V and
 * the first total to lead the second by at least T; each total is 0 when
 * absent. Teams: team markers per team. Otherwise: up_count per object.
 */
const OUTCOME_UPDATE = `UPDATE vote_sets
   SET outcome = CASE
         WHEN secret_floor IS NOT NULL AND secret_margin IS NOT NULL
          AND (SELECT COUNT(*) FROM vote_participants p WHERE p.set_id = vote_sets.id) >= secret_floor
          AND (CASE WHEN played_by = 'team'
                THEN COALESCE((SELECT COUNT(*) AS n FROM vote_team_markers m
                     WHERE m.set_id = vote_sets.id GROUP BY m.team_id ORDER BY n DESC, m.team_id LIMIT 1), 0)
                   - COALESCE((SELECT COUNT(*) AS n FROM vote_team_markers m
                     WHERE m.set_id = vote_sets.id GROUP BY m.team_id ORDER BY n DESC, m.team_id LIMIT 1 OFFSET 1), 0)
                ELSE COALESCE((SELECT t.up_count FROM vote_tallies t JOIN votable_objects o ON o.id = t.object_id
                     WHERE o.set_id = vote_sets.id ORDER BY t.up_count DESC, o.id LIMIT 1), 0)
                   - COALESCE((SELECT t.up_count FROM vote_tallies t JOIN votable_objects o ON o.id = t.object_id
                     WHERE o.set_id = vote_sets.id ORDER BY t.up_count DESC, o.id LIMIT 1 OFFSET 1), 0)
               END) >= secret_margin
         THEN 'winner' ELSE 'too_close' END
 WHERE id = ? AND event_id = ? AND is_void = 0 AND pepper_epoch IS NOT NULL`;

/** Statement 2: on a won night only, the winner's id: the first object, or the first team. */
const WINNER_UPDATE = `UPDATE vote_sets
   SET winner_object_id = CASE WHEN played_by IS NOT 'team' THEN
         (SELECT o.id FROM vote_tallies t JOIN votable_objects o ON o.id = t.object_id
           WHERE o.set_id = vote_sets.id ORDER BY t.up_count DESC, o.id LIMIT 1) END,
       winner_team_id = CASE WHEN played_by = 'team' THEN
         (SELECT m.team_id FROM vote_team_markers m WHERE m.set_id = vote_sets.id
           GROUP BY m.team_id ORDER BY COUNT(*) DESC, m.team_id LIMIT 1) END
 WHERE id = ? AND event_id = ? AND is_void = 0 AND pepper_epoch IS NOT NULL AND outcome = 'winner'`;

/**
 * Statement 3: the room size check (2026-11-26, owner: "as stringent as you
 * can make it"). More distinct voters than the most people the room can hold,
 * as the host said when voting first opened, means some votes did not come
 * from the room: the night is flagged, once, with the same one-way flag as a
 * flood (migration 0122). It catches padding at any pace, a script or an AI
 * agent spreading fake voters over the night included, which the per-minute
 * alarm (lib/vote-flood.ts) cannot see. The count and the room size are
 * compared here and never read into the Worker. It changes no outcome and no
 * winner: it only says the result may be padded. A set opened before the
 * room size existed (room_size null) is not checked.
 */
const ROOM_CHECK_UPDATE = `UPDATE vote_sets
   SET flood_seen = 1
 WHERE id = ? AND event_id = ? AND is_void = 0 AND pepper_epoch IS NOT NULL
   AND room_size IS NOT NULL AND flood_seen = 0
   AND (SELECT COUNT(*) FROM vote_participants p WHERE p.set_id = vote_sets.id) > room_size`;

/**
 * The three UPDATEs that write the night's result and its room check, in order. `guard` is
 * finalizeVoteSet's own condition for this set (not final, may be finalized,
 * still due), with its binds after the set and event ids, so the result is
 * written exactly when the final statement in the same batch makes the set
 * final. A set that never opened (no epoch) or is void gets nothing.
 */
export function resultStatements(
  db: D1Database,
  setId: string,
  eventId: string,
  guard: string,
  guardBinds: unknown[]
): D1PreparedStatement[] {
  return [OUTCOME_UPDATE, WINNER_UPDATE, ROOM_CHECK_UPDATE].map((sql) =>
    db.prepare(`${sql} ${guard}`).bind(setId, eventId, ...guardBinds)
  );
}
