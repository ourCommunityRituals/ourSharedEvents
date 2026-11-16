// ─── Consented sponsor titles, one per listed event (OSE-1522, OSE-1901) ─────────
//
// The rule (PO, 2026-10-02): wherever an event title shows, and that event has a
// sponsor both sides have agreed to, the sponsor shows by the title. This is the
// one query behind every LIST surface that shows many titles at once (/events,
// the landing cards, the map's place panel, the TV's "also coming up"), so the
// surfaces cannot disagree about who counts.
//
// It reads the existing consent rule, PLACEMENT_ON_SHOW_SQL (the event opted in
// to sponsors, sponsor_accepted = 1, organizer side source-aware, placement on,
// sponsor active). No new rule. The brand is bound, never a literal.
//
// Which name, when an event has more than one (OSE-1901, owner 2026-11-09): the
// covenant share picks it (lib/sponsor-line-pick.ts; OCR-docs invariant 25). A
// placement's level and its geo-derived local flag decide how OFTEN its name
// comes up. They decide nothing else: this function hands back a title and only
// a title, so no surface can print one sponsor larger, higher or differently
// from another. The pick reads the event id, the clock hour and the event's own
// sponsors; it is given nothing about the visitor or the request, and its
// callers pass it a database and a brand and nothing more.
//
// A share is only right over ALL of an event's sponsors, so the rows are read in
// pages until there are no more (one page for almost every brand). A brand with
// more rows than the pages allow loses the line on the event the read stopped in
// and on the events after it; it never gets a share worked out over part of a
// list.
//
// Fails to empty: a card without its sponsor line is correct, a list that errors
// because of it is not. One event whose rows the share math refuses loses its
// own line and leaves the others theirs.

import { PLACEMENT_ON_SHOW_SQL } from './sponsor-card.js';
import { hourOf, pickSponsorLine, type LineCandidate } from './sponsor-line-pick.js';

/** Rows in one read. */
export const SPONSOR_TITLE_PAGE_ROWS = 500;
/** Reads at most, for one brand: 5,000 placements on show. */
export const SPONSOR_TITLE_MAX_PAGES = 10;

interface TitleRow {
  event_id: string;
  id: string;
  title: string;
  tier: string | null;
  is_local: number | null;
}

/**
 * One consented sponsor title per event id, for `brandId`'s own events, as the
 * line reads in the clock hour of `nowMs`.
 */
export async function fetchSponsorTitles(
  db: D1Database | undefined | null,
  brandId: string,
  nowMs: number = Date.now()
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  try {
    if (!db) return titles;
    // Each page starts after the last row of the one before (event, then sponsor).
    const page = db.prepare(
      `SELECT sp.event_id AS event_id, sb.id AS id,
              COALESCE(NULLIF(sb.display_name, ''), sb.name) AS title,
              sp.tier AS tier, COALESCE(sp.locality_band, 0) AS is_local
         FROM sponsor_placement sp
         JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
         JOIN events e ON e.id = sp.event_id
        WHERE sb.brand_id = ?1 AND e.brand_id = ?1 AND ${PLACEMENT_ON_SHOW_SQL}
          AND (sp.event_id > ?2 OR (sp.event_id = ?2 AND sb.id > ?3))
        ORDER BY sp.event_id ASC, sb.id ASC
        LIMIT ${SPONSOR_TITLE_PAGE_ROWS}`
    );
    const rows: TitleRow[] = [];
    let afterEvent = '';
    let afterId = '';
    let cut = false;
    for (let n = 0; ; n++) {
      if (n === SPONSOR_TITLE_MAX_PAGES) {
        // Every page so far was full, so there may be more rows than were read.
        cut = true;
        break;
      }
      const got = (await page.bind(brandId, afterEvent, afterId).all<TitleRow>()).results ?? [];
      rows.push(...got);
      if (got.length < SPONSOR_TITLE_PAGE_ROWS) break;
      const last = got[got.length - 1]!;
      afterEvent = last.event_id;
      afterId = last.id;
    }

    const byEvent = new Map<string, LineCandidate[]>();
    for (const r of rows) {
      const list = byEvent.get(r.event_id) ?? [];
      list.push({
        id: r.id,
        title: r.title,
        tier: r.tier ?? '',
        isLocal: Number(r.is_local) === 1,
      });
      byEvent.set(r.event_id, list);
    }
    // A read that was cut may have stopped part-way through the last event's
    // sponsors. A share worked out over part of them would be wrong (it could
    // drop the local), so that one event shows no line rather than a wrong one.
    if (cut) byEvent.delete(rows[rows.length - 1]!.event_id);

    const hour = hourOf(nowMs);
    for (const [eventId, candidates] of byEvent) {
      try {
        const pick = pickSponsorLine(eventId, candidates, hour);
        if (pick) titles.set(eventId, pick.title);
      } catch {
        /* this event shows no line; the others keep theirs */
      }
    }
  } catch {
    /* fail open: no sponsor line, never a broken list */
  }
  return titles;
}
