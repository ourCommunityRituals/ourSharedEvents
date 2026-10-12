// ─── Pre-event window activity ───────────────────────────────────────────────
//
// The poster/pre-event window is when the flywheel starts: posters go up, QR
// codes get scanned (/q/, tracking) and short links get tapped (/s/, routing).
// That activity is the payoff for two corners of the triangle:
//
//   • the ORGANIZER (Event) — "is my poster working, and where?"
//   • the SPONSOR           — "how far is my name reaching?"
//
// The attendee corner is NOT shown these numbers; they get the event itself.
//
// NEVER WHO, ONLY HOW MANY. Every number here is a COUNT of anonymous events:
//   - scans come from scan_placement_events (event, poster, hour bucket — no
//     session, no device, no person; migration 0062 split the WHO side off);
//   - clicks are the shortlinks.clicks running counter (no per-click rows at
//     all, so there is nothing to break down by person, day or place);
//   - places are the organizer-declared res-7 cells of ACTIVE posters — where
//     a poster hangs, never where a scanner stood.
// Nothing reads scan_node_returns, IPs, request.cf, or FORMS_DB.
//
// One read, one rule for both audiences (OSE-1656, owner ruling 2026-10-08:
// the floor has no exceptions, "even at enterprise"). Scans are sums of
// poster-hour cells that each clear the floor (lib/scan-cells.ts), per day as
// well as in total; taps are sums of the codes that clear it. The organizer
// and the sponsor read the same numbers. Poster and place counts are the
// organizer's own placements (not people) and stay exact.

import { floorTotalOfParts, type FlooredCount } from './count-floor';
import { localDay } from './local-day';
import { readEventScanCells, scansByLocalDay, scansOf, type ScanCell } from './scan-cells';

export { localDay };

/**
 * One code on the poster = every short link of one kind (a link with no kind
 * is the event link). The organizer's per-code list (lib/poster-reach.ts) and
 * the organizer's tap total below group by this one expression, so the total
 * is a sum of the same parts the list shows.
 */
export const TAP_CODE_SQL = `COALESCE(NULLIF(kind, ''), 'public')`;

/** Days of history the window shows (ending today, in the event's zone). */
export const PRE_EVENT_DAYS = 14;

export interface PreEventActivity {
  /** Active posters out for this event. */
  posters: number;
  /** Distinct res-7 places those posters cover (organizer-declared). */
  places: number;
  /** Poster QR scans, all time: the sum of the poster-hours that clear the floor. */
  scans: FlooredCount;
  /**
   * Short-link taps per code (TAP_CODE_SQL). Read side only: no audience is
   * sent these; the published tap total is built from them.
   */
  clicksByCode: number[];
  /** Scans per day for the last PRE_EVENT_DAYS days, oldest first, every day present. */
  scansByDay: { day: string; count: FlooredCount }[];
}

export interface FlooredPreEventActivity {
  posters: number;
  places: number;
  scans: FlooredCount;
  clicks: FlooredCount;
  scansByDay: { day: string; count: FlooredCount }[];
}

async function one<T>(stmt: D1PreparedStatement, strict: boolean): Promise<T | null> {
  try {
    return await stmt.first<T>();
  } catch (e) {
    if (strict) throw e;
    return null;
  }
}

/**
 * Read the pre-event activity for one event. Counts only. A failed sub-query
 * reads as 0 rather than failing the whole card (same stance as /stats).
 * `strict` rethrows instead, for callers that must not publish a zero they did
 * not read (the OSE-1468 event dashboard answers 503).
 */
export async function readPreEventActivity(
  db: D1Database,
  eventId: string,
  timezone: string | null | undefined,
  now: Date = new Date(),
  strict = false
): Promise<PreEventActivity> {
  const posterRow = await one<{ posters: number; places: number }>(
    db
      .prepare(
        `SELECT COUNT(*) AS posters, COUNT(DISTINCT h3_res7) AS places
           FROM poster_deployments WHERE event_id = ? AND is_active = 1`
      )
      .bind(eventId),
    strict
  );
  // Taps per code, in one read: `clicks` is their sum, and the organizer's
  // total is built from the parts (organizerPreEventActivity).
  let clicksByCode: number[] = [];
  try {
    const res = await db
      .prepare(
        `SELECT COALESCE(SUM(clicks), 0) AS taps
           FROM shortlinks
          WHERE event_id = ?
          GROUP BY ${TAP_CODE_SQL}`
      )
      .bind(eventId)
      .all<{ taps: number }>();
    clicksByCode = (res.results ?? []).map((r) => Number(r.taps) || 0);
  } catch (e) {
    if (strict) throw e;
    clicksByCode = [];
  }

  let cells: ScanCell[] = [];
  try {
    cells = await readEventScanCells(db, eventId);
  } catch (e) {
    if (strict) throw e;
    cells = [];
  }

  return {
    posters: Number(posterRow?.posters) || 0,
    places: Number(posterRow?.places) || 0,
    scans: scansOf(cells),
    clicksByCode,
    scansByDay: scansByLocalDay(cells, timezone, now, PRE_EVENT_DAYS),
  };
}

/**
 * The published shape, the same for the organizer's card and the sponsor's
 * page (OSE-1656). Scans are already sums of poster-hours that clear the floor
 * (readPreEventActivity). The tap total is the sum of the codes that clear the
 * floor on their own, withheld when none does: the organizer's card lists the
 * codes (lib/poster-reach.ts floorTaps), so a raw total would give a withheld
 * code back. The per-code parts themselves are not sent.
 */
export function floorPreEventActivity(a: PreEventActivity): FlooredPreEventActivity {
  return {
    posters: a.posters,
    places: a.places,
    scans: a.scans,
    clicks: floorTotalOfParts(a.clicksByCode),
    scansByDay: a.scansByDay,
  };
}

/** The organizer's card reads the same numbers as the sponsor's page. */
export const organizerPreEventActivity = floorPreEventActivity;
