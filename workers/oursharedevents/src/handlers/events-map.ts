// ─── Attendee map data — OSE-1242 ──────────────────────────────────────────────
//
//   GET /api/v2/events/map?cell=<h3_res7>
//
// The Customer corner of the Triangle, as data. Doctrine: OCR_VISION.md §6.2b.
//
// ── THE ENDPOINT CANNOT RECEIVE A COORDINATE, AND THAT IS THE POINT ───────────
//
// §6.2b: "The reader's position is used to determine which cell they are
// standing in and is then discarded ... Invariant #1 holds BY CONSTRUCTION
// RATHER THAN BY POLICY."
//
// A server that accepts `lat`/`lon` and promises to discard them holds the
// invariant by policy: the coordinate exists in the request, and therefore in
// any log, proxy or trace that sees the request. This endpoint accepts a CELL.
// The reader's device resolves its own position and the coordinate never leaves
// it. What arrives is "somewhere in this ~5 km² tile", which is the same thing
// the platform already knows about every event in it.
//
// Coordinate-shaped parameters are REJECTED with 400 rather than ignored. A
// future client that tries to send one fails loudly on its first request
// instead of quietly leaking on every request, and `tests/events-map-*.spec.ts`
// asserts that refusal so it cannot be relaxed by accident.
//
// ── WHAT IT RETURNS ───────────────────────────────────────────────────────────
//
// Events in the forward window (now → +90d, attendable phases only) for that
// corridor, plus the readiness verdict for the front door. Corridor-scoped by
// the query, tier-blind by construction — there is no tier input and no tier
// branch anywhere in this file (Invariant #5).
//
// It returns EVENTS, which are public listings, not people. Invariant #7's
// aggregate-only rule governs SharedReports about attendees; it does not apply
// here, and nothing in this response is derived from `anon_id_returns`,
// `scan_aggregates`, or the forms database.

import { isValidCell, getResolution } from 'h3-js';
import { CORRIDOR_RES } from '../lib/h3-tagging';
import { enrichWithPhase } from '../lib/event-enrich.js';
import {
  eventsInWindow,
  isCorridorReady,
  CORRIDOR_WINDOW_DAYS,
  CORRIDOR_READY_MIN_EVENTS,
} from '../lib/corridor-readiness.js';
import { corsHeaders } from '../lib/cors';

export interface EventsMapEnv {
  DB?: D1Database;
  WORKER_ENV?: string;
}

/**
 * Parameter names that carry a position rather than a cell. Rejected outright.
 * Spelled out rather than pattern-matched so the list is auditable.
 */
const COORDINATE_PARAMS = [
  'lat',
  'lon',
  'lng',
  'latitude',
  'longitude',
  'coords',
  'coordinates',
  'position',
  'geo',
];

/** Fields the pop-out needs. Deliberately narrow — this is a public response. */
interface MapEvent {
  id: string;
  name: string | null;
  startDateISO: string | null;
  venue: string | null;
  phase: string;
  lat: number | null;
  lon: number | null;
}

function errorResponse(request: Request, code: string, message: string, status: number): Response {
  return Response.json(
    { ok: false, status, code, error: message },
    { status, headers: corsHeaders(request) }
  );
}

export async function handleEventsMap(request: Request, env: EventsMapEnv): Promise<Response> {
  const url = new URL(request.url);

  // 1. Refuse coordinates before doing anything else.
  //
  // Case-INSENSITIVE, because query parameter names are case-sensitive and a
  // literal `has('lat')` lets `?LAT=41.65` through. That was found by
  // RT-MAP-001. The exposure was small — the server never reads the key, so
  // the position would sit only in the request line — but "small" is a
  // property of today's logging config, not of the design, and this endpoint's
  // whole claim is that the invariant holds by construction.
  for (const name of [...url.searchParams.keys()]) {
    if (COORDINATE_PARAMS.includes(name.toLowerCase())) {
      return errorResponse(
        request,
        'COORDINATES_NOT_ACCEPTED',
        `This endpoint does not accept a position. Resolve your location to an H3 resolution-${CORRIDOR_RES} cell on the device and pass it as 'cell'. The coordinate must not leave the reader's device.`,
        400
      );
    }
  }

  // 2. A cell is required. There is no "everywhere" view: an unscoped map is a
  //    different product, and defaulting to one would quietly turn a corridor
  //    question into a global scan.
  const cell = url.searchParams.get('cell');
  if (!cell) {
    return errorResponse(request, 'CELL_REQUIRED', "Missing required 'cell' parameter.", 400);
  }

  if (!isValidCell(cell)) {
    return errorResponse(request, 'CELL_INVALID', 'Not a valid H3 cell.', 400);
  }

  // 3. Resolution is pinned to the corridor. A finer cell (res 9+) would let a
  //    caller narrow the query toward a specific block and, with enough
  //    requests, toward a specific address — the precision floor is the
  //    privacy floor, so it is enforced here rather than assumed of clients.
  if (getResolution(cell) !== CORRIDOR_RES) {
    return errorResponse(
      request,
      'CELL_RESOLUTION',
      `Cell must be resolution ${CORRIDOR_RES} (corridor). Finer resolutions are not served.`,
      400
    );
  }

  if (!env.DB) {
    return errorResponse(request, 'DB_UNAVAILABLE', 'Events are unavailable.', 503);
  }

  try {
    // Over-fetch by status only; the window and phase filtering happen in
    // corridor-readiness so the gate and the map cannot diverge on what counts.
    const { results } = await env.DB.prepare(
      `SELECT id, title, slug, status, location, start_date, end_date, timezone,
              lat, lon, h3_res7
         FROM events
        WHERE h3_res7 = ? AND status = 'active'
        ORDER BY start_date ASC`
    )
      .bind(cell)
      .all<Record<string, unknown>>();

    const enriched = (results ?? []).map(enrichWithPhase);
    const inWindow = eventsInWindow(enriched);

    const items: MapEvent[] = inWindow.map((e) => ({
      id: String(e.id ?? ''),
      name: (e.name as string) ?? null,
      startDateISO: (e.startDateISO as string) ?? null,
      venue: (e.venue as string) ?? null,
      phase: String(e.phase),
      lat: typeof e.lat === 'number' ? e.lat : null,
      lon: typeof e.lon === 'number' ? e.lon : null,
    }));

    return Response.json(
      {
        ok: true,
        status: 200,
        cell,
        // The front-door verdict, computed from the SAME list that was just
        // returned — the caller cannot be told "ready" alongside an empty map.
        ready: isCorridorReady(inWindow),
        windowDays: CORRIDOR_WINDOW_DAYS,
        minEvents: CORRIDOR_READY_MIN_EVENTS,
        items,
      },
      {
        headers: {
          ...corsHeaders(request),
          // Short cache: the window moves, and a stale "ready" is a wrong
          // front door rather than a stale list.
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        },
      }
    );
  } catch {
    return errorResponse(request, 'MAP_UNAVAILABLE', 'Could not load the map.', 500);
  }
}
