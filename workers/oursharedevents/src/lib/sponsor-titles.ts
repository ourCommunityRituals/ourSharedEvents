// ─── Consented sponsor titles, one per listed event (OSE-1522) ──────────────────
//
// The rule (PO, 2026-10-02): wherever an event title shows, and that event has a
// sponsor both sides have agreed to, the sponsor shows by the title. This is the
// one query behind every LIST surface that shows many titles at once (/events,
// the landing cards, the TV's "also coming up"), so the surfaces cannot disagree
// about who counts.
//
// It reads the existing consent rule, PLACEMENT_ON_SHOW_SQL (sponsor_accepted = 1,
// organizer side source-aware, placement on, sponsor active). No new rule. The
// title is the sponsor's display name, else its business name, never tier or
// spend keyed (Invariant #25). The brand is bound, never a literal.
//
// Fails to empty: a card without its sponsor line is correct, a list that errors
// because of it is not.

import { PLACEMENT_ON_SHOW_SQL } from './sponsor-card.js';

/** One consented sponsor title per event id, for `brandId`'s own events. */
export async function fetchSponsorTitles(
  db: D1Database | undefined | null,
  brandId: string
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  try {
    if (!db) return titles;
    const rs = await db
      .prepare(
        `SELECT sp.event_id AS event_id, COALESCE(NULLIF(sb.display_name, ''), sb.name) AS title
           FROM sponsor_placement sp
           JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
           JOIN events e ON e.id = sp.event_id
          WHERE sb.brand_id = ?1 AND e.brand_id = ?1 AND ${PLACEMENT_ON_SHOW_SQL}
          ORDER BY sb.name ASC, sb.id ASC
          LIMIT 500`
      )
      .bind(brandId)
      .all<{ event_id: string; title: string }>();
    for (const r of rs.results ?? []) if (!titles.has(r.event_id)) titles.set(r.event_id, r.title);
  } catch {
    /* fail open: no sponsor line, never a broken list */
  }
  return titles;
}
