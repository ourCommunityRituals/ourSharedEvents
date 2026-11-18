/**
 * Is the event live? The one SQL fragment for it (OSE-2142, S3e of OSE-1193;
 * OSE ADR-040, "nothing is more live than its container", owner 2026-11-18).
 *
 * An event's status is the master switch for everything inside it. Draft,
 * Ready, Published ('active') and Archived; Published may be listed or unlisted
 * (`is_published`), and either is live. A child (a vote set, its objects, and
 * later anything else that can be voted on) works only inside what its event
 * allows. No child has a status column of its own for this: each reads its
 * event's.
 *
 *   EVENT_PUBLISHED  the event is Published, listed or unlisted.
 *   EVENT_LIVE       Published, and on its dates: its last date (end date, else
 *                    start date) is yesterday or later, UTC, or it has no date.
 *                    The one day of grace keeps an evening event west of UTC
 *                    live until its night is over (the rule EVENT_ON in
 *                    lib/vote-sets.ts has used since S3).
 *
 * Each takes ONE bound parameter, the event id, so the events row is read by a
 * held id (tests/e2e/0-architecture/tenant-isolation.invariant.spec.ts), never
 * by a column relation. Use them inside a WHERE: `... AND ${EVENT_LIVE}`.
 *
 * Who uses it: open, reopen and opening an object (lib/vote-sets.ts), adding an
 * object to a set that has opened, and the /q vote-pass mint
 * (voteCodeMayMint). The vote route (S4a) uses it too, so the rule lands once.
 * A status change that takes an event out of Published closes its open set in
 * the same D1 batch (closeVoteSetUnlessPublished, lib/vote-sets.ts, which reads
 * EVENT_PUBLISHED).
 *
 * The status part is not written here: it is eventLiveSql in
 * domain/event-state.ts (OSE-2144), the one test of "the parent event is live",
 * derived from the state machine. These fragments add the held event id and,
 * for EVENT_LIVE, the dates.
 */
import { eventLiveSql } from '../domain/event-state';

/** The status of a Published event, listed or unlisted. */
export const EVENT_PUBLISHED_STATUS = 'active';

/** The event's last date is yesterday or later (UTC), or it has none. `e` names the events row. */
export const EVENT_ON_ITS_DATES = `(COALESCE(e.end_date, e.start_date) IS NULL
          OR substr(COALESCE(e.end_date, e.start_date), 1, 10) >= date('now', '-1 day'))`;

/** The event is Published, listed or unlisted. One bound parameter: the event id. */
export const EVENT_PUBLISHED = `EXISTS (SELECT 1 FROM events e
   WHERE e.id = ? AND ${eventLiveSql('e')})`;

/** The event is Published and on its dates. One bound parameter: the event id. */
export const EVENT_LIVE = `EXISTS (SELECT 1 FROM events e
   WHERE e.id = ? AND ${eventLiveSql('e')}
     AND ${EVENT_ON_ITS_DATES})`;

/** Is the event live now (EVENT_LIVE)? */
export async function eventIsLive(db: D1Database, eventId: string): Promise<boolean> {
  return !!(await db.prepare(`SELECT 1 AS hit WHERE ${EVENT_LIVE}`).bind(eventId).first());
}
