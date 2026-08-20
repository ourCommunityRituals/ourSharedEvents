// OSE-896 — Admin event dashboard aggregate counts.
//
// Powers the ported GAS Event Dashboard card (OSE-886) `EventDashboard.init()`
// seam: turns the `—` stat tiles into real numbers for the selected event.
//
// Privacy model (per-data-class):
//   • scans        — anonymous scan events (DB.scans). No individual to
//                    re-identify → EXACT. This is the First-Scan gauge: a single
//                    real scan must show as `1`, never suppressed.
//   • appearances  — count of ACTIVE SPONSORS present on the event
//                    (DB.sponsors, is_active=1). Public businesses, not privacy
//                    contributors → EXACT. This is presence, NOT an impression/
//                    "displayed" metric (Invariant #25 forbids impressions).
//   • registrations / checkins — identity-derived (FORMS_DB). Floored through
//                    the canonical uniform count floor (lib/count-floor.ts, K=5 =
//                    CORRIDOR_MAP_MIN_COUNT) — the SAME rule the SharedReport and
//                    the existing admin count tiles apply, so no surface
//                    side-channels a small count (OSE-665). Sub-K raw values
//                    never leave the worker; the tile renders "<5".
//
// NB: a looser audience-tiered admin floor (K=3, since the organizer already has
// row-level access to their own registrations) is proposed but DEFERRED to a
// dedicated governance amendment — this handler stays on the uniform K=5 until
// that lands, keeping the admin surface internally consistent.
//
// Two-DB isolation: scans + sponsors come from DB, registrations + checkins from
// FORMS_DB. No cross-DB join. No runtime LLM. No banned lexicon on the wire.

import { applyCountFloor, type FlooredCount } from '../lib/count-floor';

export interface EventStatsEnv {
  DB: D1Database;
  FORMS_DB?: D1Database;
}

async function countExact(db: D1Database, sql: string, id: string): Promise<number> {
  try {
    const row = await db.prepare(sql).bind(id).first<{ cnt: number }>();
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

/**
 * GET /api/v2/admin/events/:id/stats  (admin-guarded in the router)
 *
 * → { ok, status:200, stats: {
 *       scans: number,               // exact
 *       appearances: number,         // exact (active sponsors present)
 *       registrations: FlooredCount, // K=5 uniform floor, communicated
 *       checkins: FlooredCount,      // K=5 uniform floor, communicated
 *     } }
 */
export async function handleAdminEventStats(
  _request: Request,
  env: EventStatsEnv,
  eventId: string
): Promise<Response> {
  // Anonymous, exact — the First-Scan gauge. One physical scan = one placement
  // event (WHERE side of the split scan path; migration 0062 / OSE-798). Counting
  // scan_placement_events (not scan_node_returns) keeps the gauge = scans, and
  // never touches a session-derived column.
  const scans = await countExact(
    env.DB,
    'SELECT COUNT(*) AS cnt FROM scan_placement_events WHERE event_id = ?',
    eventId
  );

  // Active sponsors present — public businesses, exact (not impressions).
  const appearances = await countExact(
    env.DB,
    'SELECT COUNT(*) AS cnt FROM sponsors WHERE event_id = ? AND is_active = 1',
    eventId
  );

  // Identity-derived — floored through the canonical uniform floor (K=5).
  let registrations: FlooredCount = applyCountFloor(0);
  let checkins: FlooredCount = applyCountFloor(0);
  if (env.FORMS_DB) {
    registrations = applyCountFloor(
      await countExact(
        env.FORMS_DB,
        `SELECT COUNT(*) AS cnt FROM form_registrations
         WHERE event_id = ? AND status = 'confirmed'
           AND (expires_at IS NULL OR expires_at > datetime('now'))`,
        eventId
      )
    );
    checkins = applyCountFloor(
      await countExact(
        env.FORMS_DB,
        'SELECT total_count AS cnt FROM checkin_counts WHERE event_id = ?',
        eventId
      )
    );
  }

  return Response.json({
    ok: true,
    status: 200,
    stats: { scans, appearances, registrations, checkins },
  });
}
