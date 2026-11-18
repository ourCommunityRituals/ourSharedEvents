/**
 * What a voter may vote on now: the public open-objects read (OSE-2135, S3c of
 * OSE-1193; OSE ADR-040 decisions 2, 5 and 7).
 *
 * The voter page (S4b) lists these and puts each object's id on its vote
 * button. Nothing else is here, on purpose:
 *
 *   - AN ALLOWLIST. Each object is `{id, kind, label}`, built field by field
 *     (`projectOpenObject`), never a spread of the row. No count, no state, no
 *     time (not even `closes_at`), no team, no booth, nothing about the set.
 *   - OPEN NOW ONLY. An object is listed only while the event is live (status
 *     'active', the rule every public event read uses), its set is open, not
 *     final and not void, and the object is open with `closes_at` still ahead.
 *     A draft, closed or lapsed object is not listed, and nor is anything of a
 *     closed, final or void set. Anything else (an unknown event, a draft or
 *     archived event, no set) answers the same empty list, so the read tells a
 *     caller nothing they could not see by looking at the room.
 *   - `closes_at` is ISO with a `T` and milliseconds (lib/vote-sets.ts). It is
 *     compared in SQL against an ISO string made the same way, and again in
 *     JavaScript, so neither a format slip nor a clock edge lists a closed song.
 *   - NO NUMBER. This file names no counter and no secret, reads no receipt or
 *     marker, and selects nothing from vote_sets
 *     (tests/e2e/0-architecture/votes-never-who.invariant.spec.ts, rule 8).
 *
 * The route is switched by `VOTING_ENABLED` (lib/voting-switch.ts) and limited
 * per caller in router.ts; this file knows neither.
 */

import { VOTABLE_KINDS, type VotableKind } from './votes';
import { VOTE_OBJECTS_MAX } from './vote-sets';

/** One object a voter can vote on now. Exactly these three fields. */
export interface OpenObject {
  id: string;
  kind: VotableKind;
  label: string;
}

interface OpenObjectRow {
  id: string;
  kind: string;
  label: string;
  closes_at: string | null;
}

/**
 * The open objects of an event's set. One statement: the event, the set and
 * each object are checked together, so a close cannot fall between them.
 * `events` is read by the held id only (tenant-isolation gate).
 */
const OPEN_OBJECTS_SQL = `SELECT o.id, o.kind, o.label, o.closes_at
  FROM votable_objects o
  JOIN vote_sets s ON s.id = o.set_id AND s.event_id = o.event_id
  WHERE o.event_id = ?
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = ? AND e.status = 'active')
    AND s.state = 'open' AND s.is_final = 0 AND s.is_void = 0
    AND o.state = 'open' AND o.closes_at IS NOT NULL AND o.closes_at > ?
  ORDER BY o.sort, o.label, o.id
  LIMIT ?`;

/** The answer's object: three named fields, never the row. */
export function projectOpenObject(row: { id: string; kind: string; label: string }): OpenObject {
  return { id: String(row.id), kind: row.kind as VotableKind, label: String(row.label) };
}

/**
 * The objects a voter may vote on now, in the host's order. Empty for an
 * unknown or non-live event, for an event with no set, and for a set that is
 * not open, is final or is void.
 */
export async function listOpenObjects(
  db: D1Database,
  eventId: string,
  nowMs: number = Date.now()
): Promise<OpenObject[]> {
  const nowIso = new Date(nowMs).toISOString();
  const rows = await db
    .prepare(OPEN_OBJECTS_SQL)
    .bind(eventId, eventId, nowIso, VOTE_OBJECTS_MAX)
    .all<OpenObjectRow>();
  return (rows.results ?? [])
    .filter((r) => {
      const closes = r.closes_at ? Date.parse(r.closes_at) : NaN;
      return (
        Number.isFinite(closes) &&
        closes > nowMs &&
        (VOTABLE_KINDS as readonly string[]).includes(r.kind)
      );
    })
    .map(projectOpenObject);
}
