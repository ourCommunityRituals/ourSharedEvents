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
// drawn from `h3_res7` alone. The hexagon view never reads an event's
// `lat`/`lon` (only the zoomed area does, below), and no reader's position is
// read anywhere. The hex
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
//
// ZOOMED IN ON ONE AREA (owner, 2026-11-09). On the landing each hexagon links
// to `?area=<cell>`, which draws that one res-7 area over the street map with a
// numbered dot per place that holds an event. Where a dot sits is the owner's
// rule, merged with invariant 3 (place, not person; epic OSE-1880): every place
// at the centre of its res-9 cell, about one block, a business too. A place the
// lookup named a business or landmark (`place_kind` 'business',
// lib/event-place.ts) is marked (solid dot, named in its panel), never
// pinpointed; anything else, which can be a home, is a pale dashed dot. A
// missing kind is drawn as a block. Dots nearer than two touch targets are one
// place, so every dot can be tapped. Every dot opens its place panel under the
// map (lib/map-place-panel.ts). Dots carry the same type, window and modality
// classes as the cards, so the landing's pills filter them too, still with no
// JS. This is the one place this module reads an event's lat/lon, and only to
// find the event's own block; no coordinate is written to the page and no
// viewer location is read.
//
// NO STREET MAP, NO FLOATING DOTS (owner, 2026-11-09; OSE-1894). Dots on a bare
// hexagon tell nobody where anything is. Where the street map is missing (no
// `MAP_TILES` binding, or a failed read), the zoomed area is the list of its
// places and their panels, and no dot map is drawn.

import { cellToBoundary, cellToLatLng, getResolution, isValidCell, latLngToCell } from 'h3-js';
import { CORRIDOR_RES, NODE_RES } from './h3-tagging.js';
import {
  CORRIDOR_READY_MIN_EVENTS,
  CORRIDOR_WINDOW_DAYS,
  isInForwardWindow,
} from './corridor-readiness.js';
import { escapeHtml } from './html-escape.js';
import { fmt, fmtCount, msg } from './i18n/catalog.js';
import { DEFAULT_LANG, type Lang } from './i18n/languages.js';
import { withLangPrefix } from './i18n/path-prefix.js';
import {
  MAP_H,
  MAP_W,
  STREET_STYLE,
  cellsKey,
  frameForCells,
  project,
  type StreetLayer,
} from './street-map.js';

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

const W = MAP_W;
const H = MAP_H;

// Under the 400-char inline budget (ADR-008 design check); tokens only, no hex.
// One literal style block so the design check measures exactly what ships.
export const MAP_STYLE =
  '<style>.amap svg{display:block;width:100%;height:auto}.amap-cell{fill:var(--accent);stroke:var(--accent)}.amap-num{fill:var(--text);font:700 26px system-ui;paint-order:stroke;stroke:var(--bg);stroke-width:4px}.amap-legend{margin:.75rem 0 0;padding-inline-start:1.5rem}.amap-credit a,.amap-legend a{display:inline-flex;align-items:center;min-height:44px;color:var(--accent)}</style>';

// The zoomed area's style lives in its own module: the ADR-008 design check
// gives each source file one 400-char inline budget, and MAP_STYLE uses this one.
export { ZOOM_STYLE } from './map-zoom-style.js';
import { ZOOM_STYLE } from './map-zoom-style.js';
import {
  renderPlacePanels,
  type PanelEvent,
  type PanelOptions,
  type PanelPlace,
} from './map-place-panel.js';

/** Touch target round a dot, in map units: 44 px on a 343 px wide phone map. */
const DOT_HIT_R = 39;
const DOT_R = 13;
/** Dots nearer than two hit radii overlap as touch targets, so they are one place. */
export const DOT_MERGE = 2 * DOT_HIT_R;

/** OpenStreetMap's licence (ODbL) asks for this credit wherever its data shows. */
const OSM_LINK = '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Is this a cell the map may draw — valid, and exactly corridor resolution? */
function corridorCell(v: unknown): string | null {
  const cell = str(v);
  // Stryker disable next-line LogicalOperator: h3-js getResolution returns -1 for any invalid cell, empty included, so with && the next line still returns null for them.
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
  // Stryker disable next-line MethodExpression: every caller passes a trimmed part, or a lazy (.+?) capture that starts the trimmed part and cannot end in a space, so trim() changes nothing.
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
function areaName(places: { town: string | null; venue: string | null }[], lang: Lang): string {
  const town = mostCommon(places.map((p) => p.town));
  if (town) return town;
  const venue = mostCommon(places.map((p) => p.venue));
  return venue ? fmt(lang, 'map.near', { venue }) : '';
}

/** Group the drawable events by corridor cell, most events first. */
export function attendeeMapAreas(
  items: readonly AttendeeMapItem[] | null | undefined,
  now: Date = new Date(),
  lang: Lang = DEFAULT_LANG
): { areas: AttendeeMapArea[]; count: number } {
  const byCell = new Map<string, { id: string; name: string }[]>();
  const places = new Map<string, { town: string | null; venue: string | null }[]>();
  // Stryker disable next-line ArrayDeclaration: a filler string in place of [] has no phase, so isInForwardWindow drops it and the result is the same empty map.
  for (const e of items ?? []) {
    if (!isInForwardWindow(e, now)) continue;
    const cell = corridorCell(e.h3_res7);
    if (!cell) continue;
    const list = byCell.get(cell) ?? [];
    list.push({ id: str(e.id), name: str(e.name) || msg(lang, 'card.untitled') });
    byCell.set(cell, list);
    const venueLine = str(e.venue) || str(e.location);
    const venue = venueLine.split(',')[0]!.trim().slice(0, NAME_MAX) || null;
    // Stryker disable next-line ArrayDeclaration: a filler string in place of [] has no town or venue, and mostCommon skips empty values, so the name is the same.
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
    // Stryker disable next-line ArrayDeclaration: places gets an entry for every cell byCell does, in the same loop, so this fallback is never taken.
    name: areaName(places.get(cell) ?? [], lang),
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
const exampleSvg = (lang: Lang) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 320" role="img" aria-label="${msg(lang, 'map.exampleLabel')}" data-testid="amap-example-svg">` +
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

function thinHtml(note: string, lang: Lang): string {
  return `<div class="map-placeholder" data-testid="area-map-thin" role="status">
              <p>${fmt(lang, 'map.listedBelow', { note })}</p>
            </div>
            <figure class="amap" data-testid="amap-example">
              ${MAP_STYLE}
              ${exampleSvg(lang)}
              <figcaption data-testid="amap-example-caption">${msg(lang, 'map.exampleCaption')}</figcaption>
            </figure>`;
}

function corridorNote(busiest: number, lang: Lang): string {
  const sofar = busiest === 0 ? msg(lang, 'map.noneYet') : fmt(lang, 'map.busiest', { n: busiest });
  return fmt(lang, 'map.corridorNote', {
    min: CORRIDOR_READY_MIN_EVENTS,
    days: CORRIDOR_WINDOW_DAYS,
    sofar,
  });
}

function areaNote(gate: AreaGate, lang: Lang): string {
  const sofar =
    gate.count === 0
      ? msg(lang, 'map.noneYet')
      : fmtCount(lang, gate.count, { one: 'map.soFarOne', other: 'map.soFar' });
  return fmt(lang, 'map.areaNote', { min: gate.min, days: CORRIDOR_WINDOW_DAYS, sofar });
}

/** "3 events", in the page's language. */
function eventCount(n: number, lang: Lang): string {
  return fmtCount(lang, n, { one: 'when.all.countOne', other: 'when.all.count' });
}

function svgFor(
  areas: AttendeeMapArea[],
  lang: Lang,
  streets?: string,
  zoomHref?: (cell: string) => string
): string {
  // Web Mercator, the street map's projection, so the hexagons sit on its
  // streets. The frame comes from the cell ids alone.
  const frame = frameForCells(
    areas.map((a) => a.cell),
    W,
    H
  );
  const rings = areas.map((a) => ({
    a,
    ring: cellToBoundary(a.cell).map(([lat, lng]) => project(frame, lat, lng)),
    mid: project(frame, ...cellToLatLng(a.cell)),
  }));
  const fx = (v: number) => v.toFixed(1);

  const max = Math.max(...areas.map((a) => a.events.length), 1);
  const shapes = rings
    .map(({ a, ring, mid }) => {
      const k = a.events.length;
      const points = ring.map(([x, y]) => `${fx(x)},${fx(y)}`).join(' ');
      // Lighter over a street map, so the streets still read through.
      const opacity = (streets ? 0.15 + 0.35 * (k / max) : 0.2 + 0.6 * (k / max)).toFixed(2);
      const count = eventCount(k, lang);
      const label = a.name
        ? fmt(lang, 'map.areaTitleNamed', { n: a.n, name: a.name, count })
        : fmt(lang, 'map.areaTitle', { n: a.n, count });
      // The name sits under the number while the hexagons are few and large.
      const short =
        a.name.length > SVG_NAME_MAX_CHARS ? `${a.name.slice(0, SVG_NAME_MAX_CHARS - 1)}…` : a.name;
      const nameLine =
        a.name && areas.length <= SVG_NAME_MAX_AREAS
          ? `<tspan x="${fx(mid[0])}" dy="1.15em" data-testid="amap-area-name">${escapeHtml(short)}</tspan>`
          : '';
      const body =
        `<title>${escapeHtml(label)}</title>` +
        `<polygon class="amap-cell" points="${points}" fill-opacity="${opacity}" stroke-width="1.5"/>` +
        `<text class="amap-num" x="${fx(mid[0])}" y="${fx(mid[1])}" text-anchor="middle" dominant-baseline="central">${a.n}${nameLine}</text>`;
      // On the landing a hexagon opens its area, zoomed in (owner, 2026-11-09).
      const inner = zoomHref
        ? `<a href="${escapeHtml(zoomHref(a.cell))}" data-testid="amap-area-link">${body}</a>`
        : body;
      return `<g data-testid="amap-area" data-cell="${a.cell}" data-count="${k}">${inner}</g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="amap-caption" data-testid="amap-svg">${streets ?? ''}${shapes}</svg>`;
}

/** One event's link in a legend, with its consented sponsor (OSE-1522). */
function eventLink(
  e: { id: string; name: string },
  lang: Lang,
  sponsorTitles?: ReadonlyMap<string, string>,
  classes?: string
): string {
  const sponsor = sponsorTitles?.get(e.id);
  const by = sponsor
    ? ` <span data-testid="amap-event-sponsor">${fmt(lang, 'map.sponsor', { sponsor: escapeHtml(sponsor) })}</span>`
    : '';
  const link = `<a href="${withLangPrefix(lang, `/events/${escapeHtml(e.id)}`)}" data-testid="amap-event">${escapeHtml(e.name)}</a>${by}`;
  return classes ? `<span class="${escapeHtml(classes)}">${link}</span>` : link;
}

function legendFor(
  areas: AttendeeMapArea[],
  lang: Lang,
  sponsorTitles?: ReadonlyMap<string, string>,
  zoomHref?: (cell: string) => string
): string {
  const rows = areas
    .map((a) => {
      const links = a.events.map((e) => eventLink(e, lang, sponsorTitles)).join(' &middot; ');
      const k = a.events.length;
      const place = a.name
        ? `<span data-testid="amap-legend-name">${escapeHtml(a.name)}</span> &middot; `
        : '';
      const zoom = zoomHref
        ? ` <a class="amap-zoom" href="${escapeHtml(zoomHref(a.cell))}" data-testid="amap-zoom">${msg(lang, 'map.zoomIn')}</a>`
        : '';
      return `<li value="${a.n}" data-testid="amap-legend-area"><strong>${place}${eventCount(k, lang)}:</strong> ${links}${zoom}</li>`;
    })
    .join('');
  return `<ol class="amap-legend" data-testid="amap-legend">${rows}</ol>`;
}

// ── zoomed in on one area ────────────────────────────────────────────────────

/** An event as the zoomed map needs it: its place and the landing's filter classes. */
export interface ZoomEvent extends AttendeeMapItem {
  lat?: unknown;
  lon?: unknown;
  /** 'business' is marked (solid, named); every kind sits at its block centre. */
  place_kind?: unknown;
  /** The card's filter classes (type, window, modality), so the pills filter the dot. */
  classes?: readonly string[];
}

export interface MapDot {
  /** 1-based, top to bottom then left to right; printed in the dot and the list. */
  n: number;
  lat: number;
  lng: number;
  /** True when every event here is at a business (drawn solid, named). Always a block centre. */
  exact: boolean;
  events: { id: string; name: string; classes: string[] }[];
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Where each event of one area sits (owner, 2026-11-09): at its res-9 block's
 * centre, a business too. Events on one block share a dot, and so do blocks
 * nearer than two touch targets (DOT_MERGE), at the centre of the first of them
 * in reading order. Events with no coordinates are returned as `unplaced`.
 */
export function mapDots(
  cell: string,
  events: readonly ZoomEvent[],
  lang: Lang = DEFAULT_LANG
): { dots: MapDot[]; unplaced: { id: string; name: string; classes: string[] }[] } {
  const frame = frameForCells([cell], W, H);
  const byKey = new Map<string, Omit<MapDot, 'n'>>();
  const unplaced: { id: string; name: string; classes: string[] }[] = [];
  for (const e of events) {
    const ev = {
      id: str(e.id),
      name: str(e.name) || msg(lang, 'card.untitled'),
      classes: [...(e.classes ?? [])],
    };
    const lat = finite(e.lat);
    const lon = finite(e.lon);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      unplaced.push(ev);
      continue;
    }
    // Place, not person (AGENTS.md invariant 3; owner 2026-11-09, epic OSE-1880):
    // every place sits at its res-9 block centre, a business too. A business is
    // marked (solid dot, named in its panel), never pinpointed.
    const business = e.place_kind === 'business';
    const block = latLngToCell(lat, lon, NODE_RES);
    const at = cellToLatLng(block);
    const key = `b:${block}`;
    const dot = byKey.get(key) ?? { lat: at[0], lng: at[1], exact: true, events: [] };
    dot.exact = dot.exact && business;
    dot.events.push(ev);
    byKey.set(key, dot);
  }
  const blocks = [...byKey.values()]
    .map((d) => ({ d, xy: project(frame, d.lat, d.lng) }))
    .sort((a, b) => a.xy[1] - b.xy[1] || a.xy[0] - b.xy[0]);
  // Two dots nearer than two hit radii overlap, and one of them cannot be
  // tapped. In reading order, a block that near an earlier place joins it.
  const kept: typeof blocks = [];
  for (const b of blocks) {
    const near = kept.find((k) => Math.hypot(k.xy[0] - b.xy[0], k.xy[1] - b.xy[1]) < DOT_MERGE);
    if (!near) {
      kept.push(b);
      continue;
    }
    near.d.events.push(...b.d.events);
    near.d.exact = near.d.exact && b.d.exact;
  }
  const dots = kept.map(({ d }, i) => ({ n: i + 1, ...d }));
  return { dots, unplaced };
}

/** Every filter class the dot's events carry, so a pill hides it only when none match. */
function dotClasses(events: { classes: string[] }[]): string {
  return [...new Set(events.flatMap((e) => e.classes))].join(' ');
}

/** Every dot opens its place panel under the map (lib/map-place-panel.ts). */
function dotHref(d: MapDot): string {
  return `#amap-dot-${d.n}`;
}

function zoomSvg(cell: string, dots: MapDot[], lang: Lang, streets: string): string {
  const frame = frameForCells([cell], W, H);
  const fx = (v: number) => v.toFixed(1);
  const ring = cellToBoundary(cell)
    .map(([lat, lng]) => project(frame, lat, lng))
    .map(([x, y]) => `${fx(x)},${fx(y)}`)
    .join(' ');
  const marks = dots
    .map((d) => {
      const [x, y] = project(frame, d.lat, d.lng);
      const title =
        d.events.length === 1
          ? d.events[0]!.name
          : fmt(lang, 'map.dotTitle', { n: d.n, count: eventCount(d.events.length, lang) });
      const cls = `amap-f amap-d${d.n}${d.exact ? '' : ' amap-blk'} ${dotClasses(d.events)}`.trim();
      return (
        `<a href="${dotHref(d)}" class="${escapeHtml(cls)}" data-testid="amap-dot" data-exact="${d.exact ? 1 : 0}" data-count="${d.events.length}">` +
        `<title>${escapeHtml(title)}</title>` +
        `<circle class="amap-hit" cx="${fx(x)}" cy="${fx(y)}" r="${DOT_HIT_R}" fill-opacity="0"/>` +
        `<circle class="amap-dot" cx="${fx(x)}" cy="${fx(y)}" r="${DOT_R}"/>` +
        `<text class="amap-dn" x="${fx(x)}" y="${fx(y)}" text-anchor="middle" dominant-baseline="central">${d.n}</text>` +
        `</a>`
      );
    })
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="group" aria-labelledby="amap-caption" data-testid="amap-svg">` +
    `${streets}<polygon class="amap-zone" points="${ring}" data-testid="amap-zone" data-cell="${cell}"/>${marks}</svg>`
  );
}

function zoomLegend(
  dots: MapDot[],
  unplaced: { id: string; name: string; classes: string[] }[],
  lang: Lang,
  sponsorTitles?: ReadonlyMap<string, string>
): string {
  const row = (events: { id: string; name: string; classes: string[] }[]) =>
    events
      .map((e) => eventLink(e, lang, sponsorTitles, ['amap-f', ...e.classes].join(' ')))
      .join(' ');
  const rows = dots
    .map(
      (d) =>
        `<li value="${d.n}" class="${escapeHtml(`amap-f ${dotClasses(d.events)}`.trim())}" data-testid="amap-legend-dot"><a class="amap-zoom" href="${dotHref(d)}" data-testid="amap-place-link">${fmt(lang, 'map.place', { n: d.n })}</a>: ${row(d.events)}</li>`
    )
    .join('');
  const rest = unplaced.length
    ? `<p class="amap-f ${escapeHtml(dotClasses(unplaced))}" data-testid="amap-unplaced"><strong>${msg(lang, 'map.unplaced')}:</strong> ${row(unplaced)}</p>`
    : '';
  return `<ol class="amap-legend" id="amap-places" data-testid="amap-legend">${rows}</ol>${rest}`;
}

/**
 * The landing's zoomed area: one hexagon, its streets, a dot per place. With no
 * street map: the same places as a list, and their panels, with no dot map.
 */
function renderZoom(
  zoom: AreaZoom,
  now: Date,
  lang: Lang,
  sponsorTitles?: ReadonlyMap<string, string>,
  streetLayer?: StreetLayer | null,
  panel?: Pick<PanelOptions, 'placeLinks' | 'origin'>
): RenderedAttendeeMap {
  const back = `<p><a class="amap-back" href="${escapeHtml(zoom.backHref)}" data-testid="amap-back">${msg(lang, 'map.allAreas')}</a></p>`;
  const cell = corridorCell(zoom.cell);
  const inArea = cell
    ? zoom.events.filter((e) => isInForwardWindow(e, now) && corridorCell(e.h3_res7) === cell)
    : [];
  if (!cell || inArea.length === 0) {
    return {
      html: `<div class="map-placeholder" data-testid="amap-zoom-empty" role="status"><p>${msg(lang, 'map.zoomEmpty')}</p></div>${ZOOM_STYLE}${back}`,
      state: 'thin',
      count: 0,
      areas: [],
    };
  }
  const area = attendeeMapAreas(inArea, now, lang).areas[0]!;
  const { dots, unplaced } = mapDots(cell, inArea, lang);
  const streets =
    streetLayer && streetLayer.cellsKey === cellsKey([cell]) ? streetLayer.svg : undefined;
  const credit = streets
    ? `<p class="amap-credit" data-testid="amap-credit">${fmt(lang, 'map.credit', { osm: OSM_LINK })}</p>`
    : '';
  const events = eventCount(inArea.length, lang);
  const days = CORRIDOR_WINDOW_DAYS;
  const caption = area.name
    ? fmt(lang, streets ? 'map.zoomCaptionNamed' : 'map.listCaptionNamed', {
        events,
        name: escapeHtml(area.name),
        days,
      })
    : fmt(lang, streets ? 'map.zoomCaption' : 'map.listCaption', { events, days });
  // No street map, no floating dots (OSE-1894): the places are the list below.
  const drawing = streets
    ? zoomSvg(cell, dots, lang, streets)
    : `<div class="map-placeholder" data-testid="amap-no-tiles" role="status"><p>${msg(lang, 'map.noTiles')}</p></div>`;
  const byId = new Map(inArea.map((e) => [str(e.id), e]));
  const places: PanelPlace[] = dots.map((d) => ({
    n: d.n,
    business: d.exact,
    events: d.events.map((ev) => ({ ...(byId.get(ev.id) as PanelEvent), classes: ev.classes })),
  }));
  const panels = renderPlacePanels(places, { lang, sponsorTitles, ...panel });
  const html = `<div class="amap-wrap" data-testid="amap-wrap"><figure class="amap" data-testid="amap" data-zoom="${cell}">
              ${MAP_STYLE}${ZOOM_STYLE}${streets ? STREET_STYLE : ''}
              ${back}
              ${drawing}
              ${zoomLegend(dots, unplaced, lang, sponsorTitles)}
              <figcaption id="amap-caption" data-testid="amap-caption">${caption}</figcaption>${credit}
            </figure>${panels}</div>`;
  return { html, state: 'map', count: inArea.length, areas: [{ ...area, n: 1 }] };
}

/** The landing's zoom request: one res-7 area and the way back. */
export interface AreaZoom {
  cell: string;
  /** The area's events (already the page's list), with place and filter classes. */
  events: readonly ZoomEvent[];
  /** The landing without `area`, the search kept. */
  backHref: string;
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
    /** The page's language (OSE-1762). */
    lang?: Lang;
    /**
     * The street map under the hexagons (lib/street-map.ts). Used only when it
     * was drawn for exactly the cells this map draws, so the two frames match.
     */
    streets?: StreetLayer | null;
    /** The landing: each hexagon links here to open its area zoomed in. */
    zoomHref?: (cell: string) => string;
    /** The landing, zoomed in on one area: drawn in place of the hexagons. */
    zoom?: AreaZoom;
    /** Zoomed in: each event's direct links and share code (lib/map-place-links.ts). */
    placeLinks?: PanelOptions['placeLinks'];
    /** Zoomed in: the site's origin, for the link a Share button carries. */
    origin?: string | null;
  }
): RenderedAttendeeMap {
  const lang = opts?.lang ?? DEFAULT_LANG;
  const now = new Date(opts?.now ?? Date.now());
  // A zoom was asked for by a tap, so the area gate does not apply to it.
  if (opts?.zoom)
    return renderZoom(opts.zoom, now, lang, opts.sponsorTitles, opts.streets, {
      placeLinks: opts.placeLinks,
      origin: opts.origin,
    });
  const latched = opts?.latched ?? new Set<string>();
  const all = attendeeMapAreas(items, now, lang).areas;
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
        ? areaNote(gate, lang)
        : gate
          ? msg(lang, 'map.noPlace')
          : corridorNote(busiest, lang);
    return { html: thinHtml(note, lang), state: 'thin', count: 0, areas: [] };
  }

  const caption =
    fmt(lang, 'map.caption', {
      events: eventCount(count, lang),
      areas: fmtCount(lang, drawn.length, { one: 'map.areasOne', other: 'map.areas' }),
      days: CORRIDOR_WINDOW_DAYS,
    }) + (opts?.zoomHref ? ` ${msg(lang, 'map.tapToZoom')}` : '');
  const streets =
    opts?.streets && opts.streets.cellsKey === cellsKey(drawn.map((a) => a.cell))
      ? opts.streets.svg
      : undefined;
  const credit = streets
    ? `<p class="amap-credit" data-testid="amap-credit">${fmt(lang, 'map.credit', { osm: OSM_LINK })}</p>`
    : '';
  const html = `<figure class="amap" data-testid="amap">
              ${MAP_STYLE}${streets ? STREET_STYLE : ''}${opts?.zoomHref ? ZOOM_STYLE : ''}
              ${svgFor(drawn, lang, streets, opts?.zoomHref)}
              ${legendFor(drawn, lang, opts?.sponsorTitles, opts?.zoomHref)}
              <figcaption id="amap-caption" data-testid="amap-caption">${caption}</figcaption>${credit}
            </figure>`;
  return { html, state: 'map', count, areas: drawn };
}
