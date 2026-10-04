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
// THE LANDING IS THE ONE EXCEPTION TO THAT GATE (owner, 2026-10-03; see
// AreaGate below). The landing passes an area gate, and then the question is
// the whole area the page lists: under 10 events nothing is drawn, at 10 or
// more (or once latched) every corridor with an event is drawn, lonely ones
// included. That is the owner's call for this page and departs from the
// per-corridor grain above on purpose. What does NOT change on that path: the
// hexes still come from res-7 cell ids alone (attendeeMapAreas), no event
// coordinate and no viewer location is read, and each hex's count is still
// exactly the events it links. The area count also includes events with no
// cell; those are listed in the cards and never drawn.
//
// PLACE NAMES (2026-10-03). A hexagon alone does not say where it is, so each
// area carries a name taken from the events in it: the town in their public
// address ("…, Blue Island, IL 60406" or "Venue, Chicago IL"), else "near
// <venue>". Both fields are already public (the event projection); no
// coordinate is read and nothing is looked up. This is the free base for every
// tier — there is no map service behind it. An area whose events carry neither
// stays a number.
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
  /** Public venue name and address — read only to NAME the area. */
  venue?: unknown;
  location?: unknown;
  where_address?: unknown;
}

export interface AttendeeMapArea {
  cell: string;
  /** 1-based number printed in the hex and the legend. */
  n: number;
  /** Town, or "near <venue>"; '' when the events carry neither. */
  name: string;
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
// One literal style block so the design check measures exactly what ships.
const MAP_STYLE =
  '<style>.amap svg{display:block;width:100%;height:auto}.amap-cell{fill:var(--accent);stroke:var(--accent)}.amap-num{fill:var(--text);font:700 26px system-ui;paint-order:stroke;stroke:var(--bg);stroke-width:4px}.amap-legend{margin:.75rem 0 0;padding-left:1.5rem}.amap-legend a{display:inline-flex;align-items:center;min-height:44px;color:var(--accent)}</style>';

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Is this a cell the map may draw — valid, and exactly corridor resolution? */
function corridorCell(v: unknown): string | null {
  const cell = str(v);
  if (!cell || !isValidCell(cell)) return null;
  return getResolution(cell) === CORRIDOR_RES ? cell : null;
}

const STATE_ZIP = /^[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/;
const TOWN_STATE = /^(.+?)\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/;
const COUNTRY = /^(?:USA?|United States(?: of America)?)\.?$/i;
const NAME_MAX = 40;
/** Names are drawn inside the hexagons only while there is room for them. */
const SVG_NAME_MAX_AREAS = 4;
const SVG_NAME_MAX_CHARS = 16;

/** A town is letters, spaces and a little punctuation — never a street number. */
function asTown(v: string): string | null {
  const t = v.trim();
  return t.length >= 2 && t.length <= NAME_MAX && /^[\p{L} .'-]+$/u.test(t) ? t : null;
}

/** The town in a US-style address or "Venue, Town ST" line, else null. */
export function townOf(text: unknown): string | null {
  const parts = str(text)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  while (parts.length && COUNTRY.test(parts[parts.length - 1]!)) parts.pop();
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1]!;
  if (STATE_ZIP.test(last)) return asTown(parts[parts.length - 2]!);
  const m = TOWN_STATE.exec(last);
  return m ? asTown(m[1]!) : null;
}

function mostCommon(values: (string | null)[]): string {
  const tally = new Map<string, number>();
  for (const v of values) if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
}

/** Name an area from its events: the commonest town, else "near <venue>". */
function areaName(places: { town: string | null; venue: string | null }[]): string {
  const town = mostCommon(places.map((p) => p.town));
  if (town) return town;
  const venue = mostCommon(places.map((p) => p.venue));
  return venue ? `near ${venue}` : '';
}

/** Group the drawable events by corridor cell, most events first. */
export function attendeeMapAreas(
  items: readonly AttendeeMapItem[] | null | undefined,
  now: Date = new Date()
): { areas: AttendeeMapArea[]; count: number } {
  const byCell = new Map<string, { id: string; name: string }[]>();
  const places = new Map<string, { town: string | null; venue: string | null }[]>();
  for (const e of items ?? []) {
    if (!isInForwardWindow(e, now)) continue;
    const cell = corridorCell(e.h3_res7);
    if (!cell) continue;
    const list = byCell.get(cell) ?? [];
    list.push({ id: str(e.id), name: str(e.name) || 'Untitled event' });
    byCell.set(cell, list);
    const venueLine = str(e.venue) || str(e.location);
    const venue = venueLine.split(',')[0]!.trim().slice(0, NAME_MAX) || null;
    const seen = places.get(cell) ?? [];
    seen.push({ town: townOf(e.where_address) ?? townOf(venueLine), venue });
    places.set(cell, seen);
  }
  const sorted = [...byCell.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_MAP_AREAS);
  const areas = sorted.map(([cell, events], i) => ({
    cell,
    n: i + 1,
    name: areaName(places.get(cell) ?? []),
    events,
  }));
  return { areas, count: areas.reduce((s, a) => s + a.events.length, 0) };
}

// Below the gate the map shows an EXAMPLE, clearly labelled, so a first-time
// visitor sees what the map becomes (PO, 2026-10-03). It is a fixed drawing:
// no cell id, no event, no link, and none of the real map's test ids, so it can
// never be mistaken for (or counted as) a neighborhood. Same classes as the
// real map, so it takes both themes from the tokens.
const HEX = (cx: number, cy: number) =>
  `${cx},${cy - 80} ${cx + 69.3},${cy - 40} ${cx + 69.3},${cy + 40} ${cx},${cy + 80} ${cx - 69.3},${cy + 40} ${cx - 69.3},${cy - 40}`;
const EXAMPLE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 320" role="img" aria-label="Example map: three neighborhoods drawn as numbered hexagons, the busiest shaded deepest" data-testid="amap-example-svg">` +
  [
    [231, 100, '0.80', '1'],
    [369.6, 100, '0.50', '2'],
    [300.3, 220, '0.30', '3'],
  ]
    .map(
      ([cx, cy, o, n]) =>
        `<polygon class="amap-cell" points="${HEX(cx as number, cy as number)}" fill-opacity="${o}" stroke-width="1.5"/>` +
        `<text class="amap-num" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central">${n}</text>`
    )
    .join('') +
  `</svg>`;

function thinHtml(note: string): string {
  return `<div class="map-placeholder" data-testid="area-map-thin" role="status">
              <p>${note} &mdash; every event is listed below.</p>
            </div>
            <figure class="amap" data-testid="amap-example">
              ${MAP_STYLE}
              ${EXAMPLE_SVG}
              <figcaption data-testid="amap-example-caption"><strong>Example.</strong> This is what the map looks like once neighborhoods fill in: one numbered hexagon each, a few square kilometres, never a street address.</figcaption>
            </figure>`;
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
      const label = `Area ${a.n}${a.name ? `, ${a.name}` : ''}: ${k} event${k === 1 ? '' : 's'}`;
      // The name sits under the number while the hexagons are few and large.
      const short =
        a.name.length > SVG_NAME_MAX_CHARS ? `${a.name.slice(0, SVG_NAME_MAX_CHARS - 1)}…` : a.name;
      const nameLine =
        a.name && areas.length <= SVG_NAME_MAX_AREAS
          ? `<tspan x="${px(mid[1])}" dy="1.15em" data-testid="amap-area-name">${escapeHtml(short)}</tspan>`
          : '';
      return (
        `<g data-testid="amap-area" data-cell="${a.cell}" data-count="${k}">` +
        `<title>${escapeHtml(label)}</title>` +
        `<polygon class="amap-cell" points="${points}" fill-opacity="${opacity}" stroke-width="1.5"/>` +
        `<text class="amap-num" x="${px(mid[1])}" y="${py(mid[0])}" text-anchor="middle" dominant-baseline="central">${a.n}${nameLine}</text>` +
        `</g>`
      );
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="amap-caption" data-testid="amap-svg">${shapes}</svg>`;
}

function legendFor(areas: AttendeeMapArea[], sponsorTitles?: ReadonlyMap<string, string>): string {
  const rows = areas
    .map((a) => {
      // OSE-1522: an event title shown here carries its consented sponsor.
      const links = a.events
        .map((e) => {
          const sponsor = sponsorTitles?.get(e.id);
          const by = sponsor
            ? ` <span data-testid="amap-event-sponsor">(Supported by ${escapeHtml(sponsor)})</span>`
            : '';
          return `<a href="/events/${escapeHtml(e.id)}" data-testid="amap-event">${escapeHtml(e.name)}</a>${by}`;
        })
        .join(' &middot; ');
      const k = a.events.length;
      const place = a.name
        ? `<span data-testid="amap-legend-name">${escapeHtml(a.name)}</span> &middot; `
        : '';
      return `<li value="${a.n}" data-testid="amap-legend-area"><strong>${place}${k} event${k === 1 ? '' : 's'}:</strong> ${links}</li>`;
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
  opts?: {
    now?: number;
    latched?: ReadonlySet<string>;
    area?: AreaGate;
    /** OSE-1522: event id to the consented sponsor's title, shown by the event title. */
    sponsorTitles?: ReadonlyMap<string, string>;
  }
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
              ${legendFor(drawn, opts?.sponsorTitles)}
              <figcaption id="amap-caption" data-testid="amap-caption">${caption}</figcaption>
            </figure>`;
  return { html, state: 'map', count, areas: drawn };
}
