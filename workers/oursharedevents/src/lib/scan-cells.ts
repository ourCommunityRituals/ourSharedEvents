// ─── Poster scans: one grain for every count anyone reads ───────────────────
//
// OSE-1656 (owner ruling 2026-10-08: "there should be no exceptions to the
// rule. Even at enterprise. the <5 rule still applies so there is
// consistency."). Until then the organizer read poster scans exactly. Now
// every scan count, on every surface, is a sum of the SAME cells, each of
// which clears the floor (K = CORRIDOR_MAP_MIN_COUNT = 5) on its own:
//
//   one poster in one hour (poster_deployment_id × the hour of scan_bucket)
//
// That is the cell the SharedReport's poster attribution already floors
// (OSE-1459): /q/ keeps one scan per person per poster per hour, so only a
// poster-hour of K or more scans is K or more people. A total over hours is
// not (one person scanning once in each of K hours is K scans).
//
// Because the poster, day, event, brand, corridor and sponsor figures are all
// sums of these cells (drop before sum, OSE-683, `floorTotalOfParts`), any
// two of them differ by a sum of cells that each clear the floor, and a
// figure here can never be subtracted from the report's (or the report's
// from it) to get a group under 5 back. A cell under the floor joins no sum.
// "None" and "1 to 4" read the same: withheld.

import { floorTotalOfParts, type FlooredCount } from './count-floor';
import { localDay } from './local-day';

/**
 * The hour of a scan_bucket ("YYYY-MM-DDTHH"), the grain of one cell. Every
 * read that groups scans for a published figure groups by
 * `poster_deployment_id` and this, so the cells are the same everywhere.
 */
export function scanHourSql(alias?: string): string {
  return `substr(${alias ? `${alias}.` : ''}scan_bucket, 1, 13)`;
}
export const SCAN_HOUR_SQL = scanHourSql();

export interface ScanCell {
  poster: string;
  /** UTC hour, "YYYY-MM-DDTHH". */
  hour: string;
  n: number;
}

/**
 * Every poster-hour cell of one event, raw. Never publish a cell: pass them
 * through the functions below. Throws on a failed read; callers decide
 * whether that is a 503 or an empty card.
 */
export async function readEventScanCells(db: D1Database, eventId: string): Promise<ScanCell[]> {
  const res = await db
    .prepare(
      `SELECT poster_deployment_id AS poster, ${SCAN_HOUR_SQL} AS hour, COUNT(*) AS n
         FROM scan_placement_events
        WHERE event_id = ?
        GROUP BY poster_deployment_id, ${SCAN_HOUR_SQL}`
    )
    .bind(eventId)
    .all<ScanCell>();
  return (res.results ?? []).map((r) => ({
    poster: String(r.poster),
    hour: String(r.hour),
    n: Number(r.n) || 0,
  }));
}

/** All scans in `cells`: the sum of the cells that clear the floor. */
export function scansOf(cells: readonly ScanCell[]): FlooredCount {
  return floorTotalOfParts(cells.map((c) => c.n));
}

/** Scans per poster, each the sum of that poster's cells that clear the floor. */
export function scansByPoster(cells: readonly ScanCell[]): Map<string, FlooredCount> {
  const parts = new Map<string, number[]>();
  for (const c of cells) {
    const list = parts.get(c.poster) ?? [];
    list.push(c.n);
    parts.set(c.poster, list);
  }
  const out = new Map<string, FlooredCount>();
  for (const [poster, ns] of parts) out.set(poster, floorTotalOfParts(ns));
  return out;
}

/** A poster's scans; a poster with no cells reads withheld, like 1 to 4. */
export function posterScans(byPoster: Map<string, FlooredCount>, poster: string): FlooredCount {
  return byPoster.get(poster) ?? floorTotalOfParts([]);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Scans per local day for the last `days` days ending today in `tz`, oldest
 * first, every day present. Each day is the sum of that day's cells that
 * clear the floor, so a day is never a second cut finer than the cell. Pure;
 * exported for tests.
 */
export function scansByLocalDay(
  cells: readonly ScanCell[],
  tz: string | null | undefined,
  now: Date,
  days: number
): { day: string; count: FlooredCount }[] {
  const today = localDay(now, tz);
  const first = addDays(today, -(days - 1));
  const parts = new Map<string, number[]>();
  for (const c of cells) {
    const instant = new Date(`${c.hour}:00:00Z`);
    if (Number.isNaN(instant.getTime())) continue;
    const day = localDay(instant, tz);
    if (day < first || day > today) continue;
    const list = parts.get(day) ?? [];
    list.push(c.n);
    parts.set(day, list);
  }
  const out: { day: string; count: FlooredCount }[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(first, i);
    out.push({ day, count: floorTotalOfParts(parts.get(day) ?? []) });
  }
  return out;
}
