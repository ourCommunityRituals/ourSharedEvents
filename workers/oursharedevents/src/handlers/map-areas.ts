// ─── Public area map — OSE-2039, OSE ADR-031 ───────────────────────────────────
//
//   GET /api/v2/map/areas?cells=<h3_res7>,<h3_res7>…[&around=1]
//
// The map OurSharedEvents draws, for a reader outside it: the street layer under
// see-through H3 resolution-7 hexagons. The street tiles sit in the Worker's
// private `MAP_TILES` bucket, so only the Worker can draw streets. A static site
// (the OurWKRP creator showcase is the first) reads this at build time and puts
// the answer in its own page, so the owner has one map renderer.
//
// WHAT IT RETURNS. The Web Mercator frame, every cell's outline already
// projected into it, and the street layer as SVG markup with its CSS and its
// OpenStreetMap credit. `streets` is null when no street layer can be drawn. A
// caller that uses the outlines as given needs no projection of its own, and its
// hexagons sit on the streets because both came from one frame.
//
// CELLS ONLY (AGENTS.md invariant 3). A coordinate-shaped parameter is refused
// with a 400, exactly as GET /api/v2/events/map refuses it, and for its reason:
// a position that never arrives cannot be logged. The frame comes from the cell
// ids alone (lib/street-map.ts, `frameForCells`).
//
// RESOLUTION 7 ONLY, AND BOUNDED. At most MAX_AREA_CELLS cells. The frame is a
// fixed MAP_W × MAP_H; the caller cannot size it. The street read is bounded in
// lib/street-map.ts (MAX_TILES tiles, STREET_TIMEOUT_MS), and a frame wider than
// a street map can show (below MIN_STREET_ZOOM) reads no tile at all: it would
// spend the read on tiles of half a continent to draw a few highways.
//
// NOTHING ABOUT ANYONE. No database is read: not events, not scans, not forms.
// The answer says where cells are, which the cell ids already say. No cookie is
// set and nothing is logged.
//
// FAIL SOFT. No binding, no archive, no tile, bad data or a slow read: the
// answer is 200 with the hexagons and `streets: null`. Only a bad request is an
// error.

import { cellToBoundary, cellToLatLng, getResolution, gridDisk, isValidCell } from 'h3-js';
import { CORRIDOR_RES } from '../lib/h3-tagging';
import { corsHeaders } from '../lib/cors';
import { OSM_COPYRIGHT_URL, streetCredit } from '../lib/attendee-map.js';
import {
  MAP_H,
  MAP_W,
  STREET_STYLE,
  frameForCells,
  loadStreetLayer,
  project,
  type MapFrame,
  type StreetMapEnv,
} from '../lib/street-map.js';
import { COORDINATE_PARAMS } from './events-map.js';

/** Cells per request at most. A station's upcoming events sit in a few areas. */
export const MAX_AREA_CELLS = 12;

/**
 * The coarsest zoom streets are read at. At zoom 7 the 600-wide frame is about
 * 600 km across; wider than that the answer is hexagons only.
 */
export const MIN_STREET_ZOOM = 7;

/** A res-7 cell id is 15 characters; anything much longer is not a cell list. */
const MAX_PARAM_CHARS = MAX_AREA_CELLS * 16 + 64;

export interface DrawnCell {
  cell: string;
  /** The outline in frame units, ready for `<polygon points>`. */
  points: string;
}

export interface DrawnArea extends DrawnCell {
  /** 1-based, in the order the caller gave the cells. */
  n: number;
  /** The middle of the cell in frame units, where a number goes. */
  centre: [number, number];
}

function errorResponse(request: Request, code: string, message: string, status: number): Response {
  return Response.json(
    { ok: false, status, code, error: message },
    { status, headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } }
  );
}

const fx = (v: number) => Number(v.toFixed(1));

function outline(frame: MapFrame, cell: string): string {
  return cellToBoundary(cell)
    .map(([lat, lng]) => project(frame, lat, lng))
    .map(([x, y]) => `${fx(x)},${fx(y)}`)
    .join(' ');
}

/** The zoom a frame's tiles are read at before any stepping out (lib/street-map.ts, tilesFor). */
export function frameZoom(frame: MapFrame): number {
  return Math.round(Math.log2(frame.scale / 256));
}

export async function handleMapAreas(request: Request, env: StreetMapEnv): Promise<Response> {
  const url = new URL(request.url);

  // 1. Refuse coordinates before anything else, in any letter case
  //    (events-map.ts, RT-MAP-001).
  for (const name of url.searchParams.keys()) {
    if (COORDINATE_PARAMS.includes(name.toLowerCase())) {
      return errorResponse(
        request,
        'COORDINATES_NOT_ACCEPTED',
        `This endpoint does not accept a position. Pass H3 resolution-${CORRIDOR_RES} cells as 'cells'.`,
        400
      );
    }
  }

  // 2. The cells: required, a short list, each a valid resolution-7 cell.
  const raw = url.searchParams.getAll('cells').join(',');
  if (!raw) {
    return errorResponse(request, 'CELLS_REQUIRED', "Missing required 'cells' parameter.", 400);
  }
  if (raw.length > MAX_PARAM_CHARS) {
    return errorResponse(request, 'TOO_MANY_CELLS', `At most ${MAX_AREA_CELLS} cells.`, 400);
  }
  const cells = [...new Set(raw.split(','))];
  if (cells.length > MAX_AREA_CELLS) {
    return errorResponse(request, 'TOO_MANY_CELLS', `At most ${MAX_AREA_CELLS} cells.`, 400);
  }
  for (const cell of cells) {
    if (!isValidCell(cell)) {
      return errorResponse(request, 'CELL_INVALID', 'Not a valid H3 cell.', 400);
    }
    // The precision floor is the privacy floor (events-map.ts): a finer cell is
    // a block, and a block can be a home.
    if (getResolution(cell) !== CORRIDOR_RES) {
      return errorResponse(
        request,
        'CELL_RESOLUTION',
        `Every cell must be resolution ${CORRIDOR_RES}. Other resolutions are not served.`,
        400
      );
    }
  }

  // 3. `around=1` fits the frame to the neighbouring cells too and returns their
  //    outlines, so an area is seen among its neighbours. Still cells only.
  const aroundParam = url.searchParams.get('around');
  if (aroundParam !== null && aroundParam !== '0' && aroundParam !== '1') {
    return errorResponse(request, 'AROUND_INVALID', "'around' is 0 or 1.", 400);
  }
  const own = new Set(cells);
  const around =
    aroundParam === '1'
      ? [...new Set(cells.flatMap((c) => gridDisk(c, 1)))].filter((c) => !own.has(c))
      : [];
  const framed = [...cells, ...around];

  const frame = frameForCells(framed, MAP_W, MAP_H);
  const areas: DrawnArea[] = cells.map((cell, i) => {
    const [x, y] = project(frame, ...cellToLatLng(cell));
    return { cell, n: i + 1, points: outline(frame, cell), centre: [fx(x), fx(y)] };
  });
  const neighbours: DrawnCell[] = around.map((cell) => ({ cell, points: outline(frame, cell) }));

  // 4. The streets, when the frame is one a street map can show. Never throws.
  const layer =
    frameZoom(frame) >= MIN_STREET_ZOOM
      ? await loadStreetLayer(env, framed, { numbered: cells })
      : null;

  return Response.json(
    {
      ok: true,
      status: 200,
      frame: {
        projection: 'web-mercator',
        w: frame.w,
        h: frame.h,
        scale: frame.scale,
        x0: frame.x0,
        y0: frame.y0,
      },
      areas,
      around: neighbours,
      streets: layer
        ? {
            // One `<g>`, to sit first inside an `<svg viewBox="0 0 w h">`.
            svg: layer.svg,
            // The layer's rules, without the <style> tags. They read @ocr/ui
            // colour tokens (--surface, --info, --border, --border-strong,
            // --text-muted, --bg) from the page they are put in.
            css: STREET_STYLE.replace(/^<style>|<\/style>$/g, ''),
            // OpenStreetMap's licence asks for the credit wherever its data
            // shows: it goes with the street layer and never without it.
            credit: { html: streetCredit('en'), osm: OSM_COPYRIGHT_URL.en },
          }
        : null,
    },
    {
      headers: {
        ...corsHeaders(request),
        // Streets change when the archive is refreshed, a few times a year. An
        // answer without them is kept only briefly, so a failed read is not
        // what a build keeps getting.
        'Cache-Control': layer
          ? 'public, max-age=3600, stale-while-revalidate=86400'
          : 'public, max-age=60',
      },
    }
  );
}
