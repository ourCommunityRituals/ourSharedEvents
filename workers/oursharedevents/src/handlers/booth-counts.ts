/**
 * Scans per stall at a fair, for the organizer (OSE-2004, OSE ADR-034 decision 6).
 *
 *   GET /api/v2/admin/events/:id/booths/counts
 *
 * → { ok, status: 200, event_id,
 *     booths:     [{ id, number, name, category, is_active, scans }],
 *     categories: [{ category, booths, scans }],
 *     no_stall:   { placements, scans },
 *     total,
 *     any_withheld }
 *
 * Every `scans` and `total` is a FlooredCount, `{ count, suppressed, floor }`:
 * the shape /stats and the poster list use, so the admin page's one wording
 * function (`oseFewerThan`, lib/withheld-words.ts) reads a withheld one as
 * "Fewer than 5 scans in any hour". `any_withheld` is a boolean, never how many.
 * The numbers are built in lib/booth-counts.ts from the same poster-hour cells
 * as every other scan figure; the reasons are there.
 *
 * WHO. The router's guardAdminObjectScope has already proved the event is in
 * the caller's brands. `event_booths` has no brand column; every read here
 * binds the path event, so a stall or placement of another event never joins.
 *
 * PLAN. A stall's count is poster attribution at a coarser grain, so it follows
 * the poster list (OSE-682): on an event whose plan lacks the paid report, a
 * brand admin gets the stalls and the fair total (the figure /stats already
 * shows) and no per-stall, per-category or "no stall" count; the answer names
 * what it left out. A platform admin sees it all, and the router audits that.
 *
 * NEVER WHO. Reads `events`, `event_booths`, `poster_deployments` (id and
 * booth_id only) and `scan_placement_events` through scan-cells. No FORMS_DB.
 */

import { corsHeaders } from '../lib/cors';
import { errorLabel } from '../lib/error-label';
import { boothCounts, type BoothRef, type PlacementRef } from '../lib/booth-counts';
import { readEventScanCells } from '../lib/scan-cells';
import { hasPaidReport, planNote, type ReportPlan } from '../lib/report-plan';

export interface BoothCountsEnv {
  DB?: D1Database;
}

/** What a capped answer leaves out, named in its plan note. */
export const BOOTH_COUNTS_LOCKED = [
  'booths.scans',
  'categories.scans',
  'no_stall.scans',
  'any_withheld',
];

function json(request: Request, rid: string, status: number, body: Record<string, unknown>) {
  return Response.json(
    { ok: status < 400, status, ...body },
    {
      status,
      headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid },
    }
  );
}

export async function handleAdminBoothCounts(
  request: Request,
  env: BoothCountsEnv,
  eventId: string,
  plan: ReportPlan
): Promise<Response> {
  const rid = crypto.randomUUID?.() ?? `req-${Date.now()}`;
  const db = env.DB;
  if (!db)
    return json(request, rid, 503, { code: 'DB_NOT_CONFIGURED', error: 'Database not available' });
  try {
    const event = await db.prepare(`SELECT id FROM events WHERE id = ?`).bind(eventId).first();
    if (!event)
      return json(request, rid, 404, { code: 'NOT_FOUND', error: `Event not found: ${eventId}` });

    const booths = await db
      .prepare(
        `SELECT id, number, name, category, is_active FROM event_booths
          WHERE event_id = ?
          ORDER BY is_active DESC, sort ASC, number ASC, id ASC`
      )
      .bind(eventId)
      .all<{
        id: string;
        number: string;
        name: string;
        category: string | null;
        is_active: number;
      }>();
    const placements = await db
      .prepare(`SELECT id, booth_id FROM poster_deployments WHERE event_id = ?`)
      .bind(eventId)
      .all<{ id: string; booth_id: string | null }>();
    // A failed cell read is a 503, never a withheld figure: an organizer must
    // not read "Fewer than 5" for a fair whose scans could not be read.
    const cells = await readEventScanCells(db, eventId);

    const refs: BoothRef[] = (booths.results ?? []).map((b) => ({
      id: String(b.id),
      number: String(b.number),
      name: String(b.name),
      category: b.category === null || b.category === undefined ? null : String(b.category),
      is_active: Number(b.is_active) === 1,
    }));
    const places: PlacementRef[] = (placements.results ?? []).map((p) => ({
      id: String(p.id),
      booth_id: p.booth_id === null || p.booth_id === undefined ? null : String(p.booth_id),
    }));
    const counts = boothCounts(refs, places, cells);

    if (hasPaidReport(plan, eventId)) {
      return json(request, rid, 200, {
        event_id: eventId,
        booths: counts.booths,
        categories: counts.categories,
        no_stall: counts.no_stall,
        total: counts.total,
        any_withheld: counts.any_withheld,
      });
    }
    // Capped: the stalls as entities, and the fair total /stats already shows.
    return json(request, rid, 200, {
      event_id: eventId,
      booths: counts.booths.map(({ scans: _scans, ...stall }) => stall),
      categories: counts.categories.map(({ scans: _scans, ...category }) => category),
      no_stall: { placements: counts.no_stall.placements },
      total: counts.total,
      plan: planNote(BOOTH_COUNTS_LOCKED),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminBoothCounts',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return json(request, rid, 503, { code: 'DB_ERROR', error: 'The counts could not be read' });
  }
}
