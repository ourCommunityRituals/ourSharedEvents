/**
 * "Next at this venue": a curated few upcoming events at the same venue.
 *
 * One query, read by the public event page and its recap (OSE-657 / OSE-1518)
 * and by the email-signup confirmation on the form page (S-5.3.2), so every
 * surface lists the same events by the same rules:
 *   - the same brand only (OSE-1242, Invariant #9);
 *   - live and listed only: `status = 'active'`, `is_published = 1` and past
 *     the publish grace window (`listedSql()`), so a draft, a ready event, an
 *     event off the map or one still inside its grace window never appears;
 *   - future only, soonest first, never the event the visitor is on;
 *   - at most MAX_NEXT_AT_VENUE rows (a curated few, never an exhaustive list).
 *
 * Reads only public event fields from DB. No counts, no FORMS_DB.
 */

import { listedSql } from './publish-grace';

export interface NextEventRow {
  id: string;
  title: string;
  start_date: string | null;
  location: string | null;
}

/** The event the list is for: its own id is left out, its venue and brand bound it. */
export interface NextAtVenueAnchor {
  id: string;
  brand_id: string | null;
  location: string | null;
}

export const MAX_NEXT_AT_VENUE = 3;

/** Fails to [] so the page around it always renders. */
export async function fetchNextEventsAtVenue(
  db: D1Database | undefined,
  anchor: NextAtVenueAnchor
): Promise<NextEventRow[]> {
  try {
    if (!anchor.location || !anchor.brand_id || !db) return [];
    const rs = await db
      .prepare(
        `SELECT id, title, start_date, location FROM events
       WHERE brand_id = ?1 AND status = 'active' AND location = ?2 AND id != ?3
         AND is_published = 1 AND ${listedSql()}
         AND start_date IS NOT NULL AND datetime(start_date) > datetime('now')
       ORDER BY datetime(start_date) ASC LIMIT ?4`
      )
      .bind(anchor.brand_id, anchor.location, anchor.id, MAX_NEXT_AT_VENUE)
      .all<NextEventRow>();
    return rs.results ?? [];
  } catch {
    return [];
  }
}
