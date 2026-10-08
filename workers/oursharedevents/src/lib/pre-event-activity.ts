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
// Two audiences, two shapes, ONE read:
//   • organizer (admin)  → exact counts. Same rule as /stats: anonymous scans
//     have no individual to re-identify, and a first real scan must show as 1.
//   • sponsor (external) → every scan/click count goes through the uniform
//     floor (lib/count-floor.ts, K=5), per day as well as in total, so an
//     outside party never sees a sub-5 count. Poster and place counts are the
//     organizer's own placements (not people) and stay exact.

import { applyCountFloor, floorTotalOfParts, type FlooredCount } from './count-floor';

/**
 * One code on the poster = every short link of one kind (a link with no kind
 * is the event link). The organizer's per-code list (lib/poster-reach.ts) and
 * the organizer's tap total below group by this one expression, so the total
 * is a sum of the same parts the list shows.
 */
export const TAP_CODE_SQL = `COALESCE(NULLIF(kind, ''), 'public')`;

/** Days of history the window shows (ending today, in the event's zone). */
export const PRE_EVENT_DAYS = 14;
const HOME_TZ = 'America/Chicago';

export interface PreEventActivity {
  /** Active posters out for this event. */
  posters: number;
  /** Distinct res-7 places those posters cover (organizer-declared). */
  places: number;
  /** Poster QR scans, all time. */
  scans: number;
  /** Short-link taps, all time (running counter; no per-day history exists). */
  clicks: number;
  /**
   * The same taps, per code (TAP_CODE_SQL): the parts `clicks` adds up. Read
   * side only. Neither audience is sent these; the organizer's total is built
   * from them (organizerPreEventActivity).
   */
  clicksByCode: number[];
  /** Scans per day for the last PRE_EVENT_DAYS days, oldest first, zero-filled. */
  scansByDay: { day: string; count: number }[];
}

export interface FlooredPreEventActivity {
  posters: number;
  places: number;
  scans: FlooredCount;
  clicks: FlooredCount;
  scansByDay: { day: string; count: FlooredCount }[];
}

/** YYYY-MM-DD of an instant in `tz` (falls back to HOME_TZ, then UTC). */
export function localDay(instant: Date, tz: string | null | undefined): string {
  for (const zone of [tz, HOME_TZ, 'UTC']) {
    if (!zone) continue;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(instant);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
      // unknown zone → next fallback
    }
  }
  return instant.toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Bucket hour-level scan counts into the event's local days. Pure; exported
 * for tests. `hours` are scan_bucket values (UTC, "YYYY-MM-DDTHH:00").
 */
export function bucketScansByDay(
  hours: { bucket: string; cnt: number }[],
  tz: string | null | undefined,
  now: Date,
  days: number = PRE_EVENT_DAYS
): { day: string; count: number }[] {
  const today = localDay(now, tz);
  const first = addDays(today, -(days - 1));
  const byDay = new Map<string, number>();
  for (const h of hours) {
    const instant = new Date(`${h.bucket}:00Z`);
    if (Number.isNaN(instant.getTime())) continue;
    const day = localDay(instant, tz);
    if (day < first || day > today) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + (Number(h.cnt) || 0));
  }
  const out: { day: string; count: number }[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(first, i);
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
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
  const scanRow = await one<{ cnt: number }>(
    db
      .prepare('SELECT COUNT(*) AS cnt FROM scan_placement_events WHERE event_id = ?')
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

  // Hour buckets for the window plus a day of slack either side (zone shift);
  // bucketScansByDay trims to the event's local days.
  const since = new Date(now.getTime() - (PRE_EVENT_DAYS + 1) * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 13);
  let hours: { bucket: string; cnt: number }[] = [];
  try {
    const res = await db
      .prepare(
        `SELECT scan_bucket AS bucket, COUNT(*) AS cnt
           FROM scan_placement_events
          WHERE event_id = ? AND scan_bucket >= ?
          GROUP BY scan_bucket`
      )
      .bind(eventId, since)
      .all<{ bucket: string; cnt: number }>();
    hours = res.results ?? [];
  } catch (e) {
    if (strict) throw e;
    hours = [];
  }

  return {
    posters: Number(posterRow?.posters) || 0,
    places: Number(posterRow?.places) || 0,
    scans: Number(scanRow?.cnt) || 0,
    clicks: clicksByCode.reduce((t, n) => t + n, 0),
    clicksByCode,
    scansByDay: bucketScansByDay(hours, timezone, now),
  };
}

/**
 * The organizer-facing shape (poster tiers, PO 2026-09-30): physical poster
 * scans stay exact (the organizer's own placements — same rule as /stats),
 * but digital link TAPS are floored at K=5 like every other digital count.
 * The organizer also sees taps per code (lib/poster-reach.ts floorTaps), so
 * this total is the sum of the codes that clear the floor on their own
 * (floorTotalOfParts), withheld when none does. A code under the floor never
 * joins it, so the total cannot be subtracted against the listed codes to get
 * a withheld one back. The per-code parts themselves are not sent.
 */
export function organizerPreEventActivity(
  a: PreEventActivity
): Omit<PreEventActivity, 'clicks' | 'clicksByCode'> & { clicks: FlooredCount } {
  const { clicksByCode, ...rest } = a;
  return { ...rest, clicks: floorTotalOfParts(clicksByCode) };
}

/**
 * The sponsor-facing shape: every scan/click count floored (K=5), per day too.
 * The tap figure follows the same rule as the organizer's (owner, 2026-10-08:
 * the floor has no exceptions for any reader): it is the sum of the codes that
 * clear the floor on their own, withheld when none does. A sponsor is shown
 * no per-code counts, but an organizer can open a sponsor's page and the
 * organizer's card lists the codes, so a raw total here gave a withheld code
 * back.
 */
export function floorPreEventActivity(a: PreEventActivity): FlooredPreEventActivity {
  return {
    posters: a.posters,
    places: a.places,
    scans: applyCountFloor(a.scans),
    clicks: floorTotalOfParts(a.clicksByCode),
    scansByDay: a.scansByDay.map((d) => ({ day: d.day, count: applyCountFloor(d.count) })),
  };
}
