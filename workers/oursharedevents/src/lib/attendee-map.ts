// ─── Attendee map — the Customer corner, drawn ─────────────────────────────────
//
// Replaces the landing's "A neighborhood map lands here" placeholder
// (TRIANGLE-SCREEN-MAP-2026-09-16, next slice #1). Doctrine: OCR_VISION §6.2b
// and the corridor-readiness rule in ./corridor-readiness.ts.
//
// WHAT IT DRAWS. One hexagon per H3 resolution-7 corridor cell (~5 km²) that
// holds at least one attendable event in the forward window, shaded by how
// many, numbered, with a legend listing each area's events as links. That is
// the same precision `GET /api/v2/events/map` serves and no finer: the map is
// drawn from `h3_res7` alone. An event's `lat`/`lon` is NEVER read here, so no
// coordinate — the event's or the reader's — can reach the markup. The hex
// outline comes from the cell id (`cellToBoundary`), which says "somewhere in
// this tile" and nothing more.
//
// NO JS, NO TILES, NO REQUESTS. Same technique as ./corridor-map.ts (inline
// SVG, CSP-clean, prints clean) but deliberately NOT that module: corridor-map
// is retrospective proof and is "honest at any density"; this is a stranger
// deciding whether to go out, so it is density-gated (corridor-map's own
// header says do not wire this surface to it).
//
// THE GATE — PER CORRIDOR, LATCHED (§6.2b; CCR PR 700 corrected the first cut,
// which counted across the whole brand). A corridor (H3 res 7 — the NCR
// Corridor, not the res-9 Node) is drawn when it holds at least
// CORRIDOR_READY_MIN_EVENTS events in the forward window RIGHT NOW, or when it
// has latched (lib/corridor-latch: the nightly job records the first time it
// did). Once open it stays open, so the front door does not flap as events
// wrap up. Five events scattered over five corridors draw nothing: a map of
// lonely hexes reads as abandoned, the failure §6.2b exists to prevent. A
// latched corridor with no upcoming event is not drawn (there is nothing to
// link to). Events in corridors that are not drawn are still in the card list.
// THE THING COUNTED IS THE THING SHOWN: each corridor's count is exactly the
// events its hex links.
//
// The landing's type / modality / product radios do not re-draw the map (it is
// CSS-only, no JS), so the caption says what the map shows: every kind, the
// next CORRIDOR_WINDOW_DAYS days. The filtered list sits right below.

import { cellToBoundary, cellToLatLng, getResolution, isValidCell } from 'h3-js';
import { CORRIDOR_RES } from './h3-tagging.js';
import {
  CORRIDOR_READY_MIN_EVENTS,
  CORRIDOR_WINDOW_DAYS,
  isInForwardWindow,
} from './corridor-readiness.js';
import { escapeHtml } from './html-escape.js';

export interface AttendeeMapItem {
  id?: unknown;
  name?: unknown;
  startDateISO?: unknown;
  endDateISO?: unknown;
  phase?: unknown;
  h3_res7?: unknown;
}

export interface AttendeeMapArea {
  cell: string;
  /** 1-based number printed in the hex and the legend. */
  n: number;
  events: { id: string; name: string }[];
}

export interface RenderedAttendeeMap {
  html: string;
  /** 'map' when drawn; 'thin' below the gate. */
  state: 'map' | 'thin';
  /** Events that are (or would be) on the map. */
  count: number;
  areas: AttendeeMapArea[];
}

/**
 * The landing page's own gate (owner, 2026-10-03): the AREA the page shows, not
 * one corridor. Under `min` events the map view is the note plus the labelled
 * example; at `min` or more the map leads the page and draws every corridor
 * that holds an event. `count` is the real number of events the page lists.
 * This is a display rule for that one page. CORRIDOR_READY_MIN_EVENTS (5), the
 * latch, GET /api/v2/events/map and every privacy floor are untouched by it.
 */
export interface AreaGate {
  count: number;
  min: number;
  /** The area reached `min` before and was recorded (lib/corridor-latch): stay open. */
  latched?: boolean;
}

/** Hexes drawn at most. Past this the answer is clustering, not a bigger SVG. */
export const MAX_MAP_AREAS = 60;

const W = 600;
const H = 360;

// Under the 400-char inline budget (ADR-008 design check); tokens only, no hex.
// One literal <style> so the design check measures exactly what ships.
const MAP_STYLE =
  '<style>.amap svg{display:block;width:100%;height:auto}.amap-cell{fill:var(--accent);stroke:var(--accent)}.amap-num{fill:var(--text);font:700 26px system-ui;paint-order:stroke;stroke:var(--bg);stroke-width:4px}.amap-legend{margin:.75rem 0 0;padding-left:1.5rem}.amap-legend a{display:inline-flex;align-items:center;min-height:44px}</style>';

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Is this a cell the map may draw — valid, and exactly corridor resolution? */
function corridorCell(v: unknown): string | null {
  const cell = str(v);
  if (!cell || !isValidCell(cell)) return null;
  return getResolution(cell) === CORRIDOR_RES ? cell : null;
}

/** Group the drawable events by corridor cell, most events first. */
export function attendeeMapAreas(
  items: readonly AttendeeMapItem[] | null | undefined,
  now: Date = new Date()
): { areas: AttendeeMapArea[]; count: number } {
  const byCell = new Map<string, { id: string; name: string }[]>();
  for (const e of items ?? []) {
    if (!isInForwardWindow(e, now)) continue;
    const cell = corridorCell(e.h3_res7);
    if (!cell) continue;
    const list = byCell.get(cell) ?? [];
    list.push({ id: str(e.id), name: str(e.name) || 'Untitled event' });
    byCell.set(cell, list);
  }
  const sorted = [...byCell.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_MAP_AREAS);
  const areas = sorted.map(([cell, events], i) => ({ cell, n: i + 1, events }));
  return { areas, count: areas.reduce((s, a) => s + a.events.length, 0) };
}

// The below-the-gate state shows what the map WILL look like: three made-up
// hexagons under an "Example" bar. It is a fixed drawing, not data: no cell id,
// no event, no link, no count, and none of the test ids a real map carries, so
// nothing can mistake it for one. It reuses MAP_STYLE's classes (no new CSS).
const EXAMPLE_HEXES: readonly (readonly [number, number, string])[] = [
  [248, 140, '0.80'],
  [352, 140, '0.50'],
  [300, 230, '0.30'],
];

function exampleSvg(): string {
  const r = 60;
  const dx = (0.866 * r).toFixed(1);
  const hexes = EXAMPLE_HEXES.map(([cx, cy, opacity], i) => {
    const pts = [
      [cx, cy - r],
      [cx + +dx, cy - r / 2],
      [cx + +dx, cy + r / 2],
      [cx, cy + r],
      [cx - +dx, cy + r / 2],
      [cx - +dx, cy - r / 2],
    ]
      .map((p) => p.join(','))
      .join(' ');
    return (
      `<polygon class="amap-cell" points="${pts}" fill-opacity="${opacity}" stroke-width="1.5"/>` +
      `<text class="amap-num" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`
    );
  }).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 305" role="img" aria-label="Example of the neighborhood map. These are not real events." data-testid="amap-example-svg">` +
    `<rect class="amap-cell" x="1" y="1" width="${W - 2}" height="52" fill-opacity="0.25" stroke-width="1.5"/>` +
    `<text class="amap-num" x="${W / 2}" y="27" text-anchor="middle" dominant-baseline="central">Example</text>` +
    hexes +
    `</svg>`
  );
}

function thinHtml(note: string): string {
  return `<div class="map-placeholder" data-testid="area-map-thin" role="status">
              <p>${note} &mdash; every event is listed below.</p>
              <figure class="amap" data-testid="amap-example">
                ${MAP_STYLE}
                ${exampleSvg()}
                <figcaption>Example only. This is how a neighborhood will look on the map; these are not real events.</figcaption>
              </figure>
            </div>`;
}

function corridorNote(busiest: number): string {
  const sofar = busiest === 0 ? 'None yet' : `The busiest has ${busiest} so far`;
  return `<strong>A neighborhood appears on the map once it has ${CORRIDOR_READY_MIN_EVENTS} events in the next ${CORRIDOR_WINDOW_DAYS} days.</strong> ${sofar}`;
}

function areaNote(gate: AreaGate): string {
  const sofar =
    gate.count === 0 ? 'None yet' : `There ${gate.count === 1 ? 'is' : 'are'} ${gate.count} so far`;
  return `<strong>The map appears once this area has ${gate.min} events in the next ${CORRIDOR_WINDOW_DAYS} days.</strong> ${sofar}`;
}

function svgFor(areas: AttendeeMapArea[]): string {
  const rings = areas.map((a) => ({ a, ring: cellToBoundary(a.cell), mid: cellToLatLng(a.cell) }));
  const lats = rings.flatMap((r) => r.ring.map((p) => p[0]!));
  const lons = rings.flatMap((r) => r.ring.map((p) => p[1]!));
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);
  const kx = Math.cos((((latMin + latMax) / 2) * Math.PI) / 180);
  const spanX = Math.max((lonMax - lonMin) * kx, 1e-6);
  const spanY = Math.max(latMax - latMin, 1e-6);
  const pad = 0.08;
  const scale = Math.min((W * (1 - 2 * pad)) / spanX, (H * (1 - 2 * pad)) / spanY);
  const offX = W * pad + (W * (1 - 2 * pad) - spanX * scale) / 2;
  const offY = H * pad + (H * (1 - 2 * pad) - spanY * scale) / 2;
  const px = (lon: number) => ((lon - lonMin) * kx * scale + offX).toFixed(1);
  const py = (lat: number) => (H - ((lat - latMin) * scale + offY)).toFixed(1);

  const max = Math.max(...areas.map((a) => a.events.length), 1);
  const shapes = rings
    .map(({ a, ring, mid }) => {
      const k = a.events.length;
      const points = ring.map((p) => `${px(p[1]!)},${py(p[0]!)}`).join(' ');
      const opacity = (0.2 + 0.6 * (k / max)).toFixed(2);
      const label = `Area ${a.n}: ${k} event${k === 1 ? '' : 's'}`;
      return (
        `<g data-testid="amap-area" data-cell="${a.cell}" data-count="${k}">` +
        `<title>${escapeHtml(label)}</title>` +
        `<polygon class="amap-cell" points="${points}" fill-opacity="${opacity}" stroke-width="1.5"/>` +
        `<text class="amap-num" x="${px(mid[1])}" y="${py(mid[0])}" text-anchor="middle" dominant-baseline="central">${a.n}</text>` +
        `</g>`
      );
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="amap-caption" data-testid="amap-svg">${shapes}</svg>`;
}

function legendFor(areas: AttendeeMapArea[]): string {
  const rows = areas
    .map((a) => {
      const links = a.events
        .map(
          (e) =>
            `<a href="/events/${escapeHtml(e.id)}" data-testid="amap-event">${escapeHtml(e.name)}</a>`
        )
        .join(' &middot; ');
      const k = a.events.length;
      return `<li value="${a.n}" data-testid="amap-legend-area"><strong>${k} event${k === 1 ? '' : 's'}:</strong> ${links}</li>`;
    })
    .join('');
  return `<ol class="amap-legend" data-testid="amap-legend">${rows}</ol>`;
}

/**
 * Render the attendee map block. Pure: same input, same string.
 *
 * @param opts.now injectable clock for deterministic window tests.
 */
export function renderAttendeeMap(
  items: readonly AttendeeMapItem[] | null | undefined,
  opts?: { now?: number; latched?: ReadonlySet<string>; area?: AreaGate }
): RenderedAttendeeMap {
  const now = new Date(opts?.now ?? Date.now());
  const latched = opts?.latched ?? new Set<string>();
  const all = attendeeMapAreas(items, now).areas;
  const gate = opts?.area;
  // Landing (an area gate is given): below it nothing is drawn; at it, every
  // corridor with an event is. Anywhere else: per corridor, ready now or latched.
  const drawn = (
    gate
      ? gate.count >= gate.min || gate.latched
        ? all
        : []
      : all.filter((a) => a.events.length >= CORRIDOR_READY_MIN_EVENTS || latched.has(a.cell))
  ).map((a, i) => ({ ...a, n: i + 1 }));
  const count = drawn.reduce((s, a) => s + a.events.length, 0);

  if (drawn.length === 0) {
    const busiest = all.reduce((m, a) => Math.max(m, a.events.length), 0);
    const note =
      gate && gate.count < gate.min && !gate.latched
        ? areaNote(gate)
        : gate
          ? '<strong>None of these events has a place on the map yet</strong>'
          : corridorNote(busiest);
    return { html: thinHtml(note), state: 'thin', count: 0, areas: [] };
  }

  const caption = `${count} event${count === 1 ? '' : 's'} in ${drawn.length} neighborhood${drawn.length === 1 ? '' : 's'}, every kind, over the next ${CORRIDOR_WINDOW_DAYS} days (the filters above change the list, not the map). Each hexagon is a few square kilometres, never a street address.`;
  const html = `<figure class="amap" data-testid="amap">
              ${MAP_STYLE}
              ${svgFor(drawn)}
              ${legendFor(drawn)}
              <figcaption id="amap-caption" data-testid="amap-caption">${caption}</figcaption>
            </figure>`;
  return { html, state: 'map', count, areas: drawn };
}
