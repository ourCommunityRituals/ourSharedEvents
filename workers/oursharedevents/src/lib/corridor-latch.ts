// ─── Corridor readiness latch (OCR VISION §6.2b) ──────────────────────────────
//
// The rule, as corridor-readiness.ts states it: a corridor's attendee map opens
// when the forward window holds at least CORRIDOR_READY_MIN_EVENTS events in
// THAT corridor (H3 res 7, the NCR Corridor — not the res-9 Node), and once
// cleared it stays cleared. Grain is the corridor, never the whole brand: five
// events scattered over five corridors open nothing.
//
// Two halves:
//   latchReadyCorridors  nightly (index.ts scheduled): INSERT OR IGNORE one row
//                        per (brand, cell) now at or above the threshold. The
//                        page never writes; a corridor that crosses the line
//                        during the day is still drawn at once (see below).
//   readLatchedCorridors per request, brand-bound: the cells that have latched.
//
// The landing map draws a corridor when it is ready NOW (live count ≥ 5) OR has
// latched — so crossing the threshold shows immediately, and falling back below
// it later does not hide it (no flapping front door).
//
// The SQL window is a date approximation of corridor-readiness's phase rule:
// start_date from "today somewhere" (UTC date 12 h ago) to +CORRIDOR_WINDOW_DAYS.
// A multi-day event that started earlier is not counted here; that errs toward
// latching LATER, never earlier.
//
// Settled events only (PO decision 2026-10-02, OSE-1508). The latch is
// permanent, so a publish the organizer undoes must never set it. An event
// counts once it has been listed for LATCH_SETTLE_HOURS: listed_from (the end
// of its publish grace window, lib/publish-grace.ts) at least that long ago.
// Every publication and every create-as-active stores listed_from, so NULL
// means a row from before migration 0093, which counts as settled as it
// always did.

// THE LANDING AREA LATCH (owner, 2026-10-03). The landing page leads with its
// map once the page's area holds LIST_MAX (10) events, and once that has been
// recorded it keeps leading with the map when the count later drops (no
// flapping front door). It is recorded here, by the same nightly job and under
// the same settled-events rule, as one row per brand whose key is
// LANDING_AREA_LATCH_KEY instead of a cell. So "stays" starts at the first
// nightly run after the area has held 10 settled events; before that run the
// page follows the live count. The per-corridor latch above is unchanged (5).

import { CORRIDOR_READY_MIN_EVENTS, CORRIDOR_WINDOW_DAYS } from './corridor-readiness';
import { LIST_MAX } from './landing-area';

/** The row key that marks "this brand's landing area has latched". Not a cell. */
export const LANDING_AREA_LATCH_KEY = 'landing-area';

/** How long an event must have been listed before it counts toward the latch. */
export const LATCH_SETTLE_HOURS = 24;

export interface CorridorLatchEnv {
  DB: D1Database;
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Record every (brand, corridor) now at or above the threshold. Idempotent. */
export async function latchReadyCorridors(db: D1Database, now: Date = new Date()): Promise<number> {
  const floor = day(now.getTime() - 12 * 3_600_000);
  const horizon = day(now.getTime() + CORRIDOR_WINDOW_DAYS * 86_400_000);
  const settledBy = new Date(now.getTime() - LATCH_SETTLE_HOURS * 3_600_000).toISOString();
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO corridor_readiness_latch (brand_id, h3_res7, latched_at)
       SELECT brand_id, h3_res7, ?
         FROM events
        WHERE is_published = 1 AND status = 'active'
          AND h3_res7 IS NOT NULL AND h3_res7 <> ''
          AND start_date >= ? AND start_date <= ?
          AND (listed_from IS NULL OR listed_from <= ?)
        GROUP BY brand_id, h3_res7
       HAVING COUNT(*) >= ?`
    )
    .bind(now.toISOString(), floor, horizon, settledBy, CORRIDOR_READY_MIN_EVENTS)
    .run();
  return res.meta?.changes ?? 0;
}

/**
 * Record every brand whose landing area now holds at least LIST_MAX settled,
 * listed, upcoming events (with or without a place on the map: the landing
 * counts the events it lists). Idempotent; a one-way door like the rows above.
 */
export async function latchLandingAreas(db: D1Database, now: Date = new Date()): Promise<number> {
  const floor = day(now.getTime() - 12 * 3_600_000);
  const horizon = day(now.getTime() + CORRIDOR_WINDOW_DAYS * 86_400_000);
  const settledBy = new Date(now.getTime() - LATCH_SETTLE_HOURS * 3_600_000).toISOString();
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO corridor_readiness_latch (brand_id, h3_res7, latched_at)
       SELECT brand_id, ?, ?
         FROM events
        WHERE is_published = 1 AND status = 'active'
          AND start_date >= ? AND start_date <= ?
          AND (listed_from IS NULL OR listed_from <= ?)
        GROUP BY brand_id
       HAVING COUNT(*) >= ?`
    )
    .bind(LANDING_AREA_LATCH_KEY, now.toISOString(), floor, horizon, settledBy, LIST_MAX)
    .run();
  return res.meta?.changes ?? 0;
}

/** Everything latched for one brand: its corridor cells, and its landing area. */
export async function readLatches(
  db: D1Database,
  brand: string
): Promise<{ corridors: Set<string>; landingArea: boolean }> {
  const { results } = await db
    .prepare('SELECT h3_res7 FROM corridor_readiness_latch WHERE brand_id = ?')
    .bind(brand)
    .all<{ h3_res7: string }>();
  const keys = (results ?? []).map((r) => r.h3_res7);
  return {
    corridors: new Set(keys.filter((k) => k !== LANDING_AREA_LATCH_KEY)),
    landingArea: keys.includes(LANDING_AREA_LATCH_KEY),
  };
}

/** The corridor cells that have latched for one brand. */
export async function readLatchedCorridors(db: D1Database, brand: string): Promise<Set<string>> {
  return (await readLatches(db, brand)).corridors;
}

/** Nightly phase (index.ts scheduled). Never throws: a missing table is a no-op. */
export async function runCorridorLatch(env: CorridorLatchEnv): Promise<void> {
  try {
    const n = await latchReadyCorridors(env.DB);
    const areas = await latchLandingAreas(env.DB);
    console.log(
      JSON.stringify({ type: 'LIFECYCLE', job: 'corridor_latch', latched: n, landing_areas: areas })
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'LIFECYCLE',
        job: 'corridor_latch',
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}
