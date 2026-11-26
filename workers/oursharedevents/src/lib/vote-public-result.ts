/**
 * The night's result as the voter page shows it (OSE-2129, S4b of OSE-1193;
 * OSE ADR-040 decisions 7 and 8, Q14).
 *
 * One result per event, and only once its set is final: the winner's label,
 * the labels of the winning team's songs, or "too close to call". Nothing
 * else: no count, no runner-up, no voter number, no reason, and nothing before
 * final. A void set, or a set with no outcome, shows nothing.
 *
 * `padded` (OSE-2234): the set's flood flag, so the page can say the result
 * may be padded. It rides only on a final result, so no public answer carries
 * it before final (invariant 5). A flag, never a count.
 *
 * NO NUMBER. This file names no counter, no secret and no receipt or marker
 * table (tests/e2e/0-architecture/votes-never-who.invariant.spec.ts). It reads
 * `outcome` and the winner's id from vote_sets, and labels from
 * votable_objects. The answer is built field by field.
 */

import type { VoteOutcome } from './vote-results';

/** The result the voter page shows. */
export type PublicVoteResult = (
  | { outcome: 'winner'; kind: 'object'; label: string }
  | { outcome: 'winner'; kind: 'team'; labels: string[] }
  | { outcome: 'too_close' }
) & {
  /** A flood of vote passes was seen on this night's vote code (OSE-2234). */
  padded: boolean;
};

const RESULT_SQL = `SELECT s.id, s.outcome, s.winner_object_id, s.winner_team_id, s.flood_seen,
       (SELECT w.label FROM votable_objects w
         WHERE w.id = s.winner_object_id AND w.set_id = s.id) AS winner_label
  FROM vote_sets s
 WHERE s.event_id = ? AND s.is_final = 1 AND s.is_void = 0 AND s.outcome IS NOT NULL
 LIMIT 1`;

const TEAM_LABELS_SQL = `SELECT label FROM votable_objects
 WHERE set_id = ? AND group_id = ?
 ORDER BY sort, label, id
 LIMIT 20`;

interface ResultRow {
  id: string;
  outcome: VoteOutcome | null;
  winner_object_id: string | null;
  winner_team_id: string | null;
  winner_label: string | null;
  flood_seen: number | null;
}

/**
 * The event's result, or null when there is none to show: no set, a set not
 * final, a void set, or a winner whose label cannot be read.
 */
export async function readPublicVoteResult(
  db: D1Database,
  eventId: string
): Promise<PublicVoteResult | null> {
  const row = await db.prepare(RESULT_SQL).bind(eventId).first<ResultRow>();
  if (!row) return null;
  const padded = Number(row.flood_seen) === 1;
  if (row.outcome === 'too_close') return { outcome: 'too_close', padded };
  if (row.outcome !== 'winner') return null;
  if (row.winner_object_id) {
    return row.winner_label
      ? { outcome: 'winner', kind: 'object', label: String(row.winner_label), padded }
      : null;
  }
  if (row.winner_team_id) {
    const rs = await db
      .prepare(TEAM_LABELS_SQL)
      .bind(row.id, row.winner_team_id)
      .all<{ label: string }>();
    const labels = (rs.results ?? []).map((r) => String(r.label));
    return labels.length ? { outcome: 'winner', kind: 'team', labels, padded } : null;
  }
  return null;
}
