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
// drawn from `h3_res7` alone. No view here reads an event's `lat`/`lon` (the
// zoomed area reads its res-9 cell, below; OSE-2197), and no reader's position
// is read anywhere. The hex
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
// THE LANDING'S FILTERS NARROW THE HEXAGONS TOO (the grade of 2026-11-17).
// Each hexagon, legend row and event link carries the window, type and
// modality classes of its events (`filterClasses`), and the landing's own
// CSS-only hide rules (lib/landing-area.ts, `.amap-f`) hide a hexagon when none
// of its events match, as they hide a zoomed dot. Still no JS. A hexagon's
// number, shading and count stay those of every event in it.
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
// JS. The dot's place is the event's res-9 cell (`h3_res9`: the stored cell,
// else the one the server derives from the stored point; lib/landing-area.ts
// blockOf), passed in by the landing beside the projected event, never in the
// public JSON; this module reads no event coordinate at all (OSE-2197, owner
// 2026-11-19: "It should resolve to the H3"). No event's coordinate is written to the page and
// no viewer location is read on the server. With a street map, the drawing
// carries its frame and each area its centre (frameAttrs, `data-ll`), for the
// map's script; both come from the cell ids alone (OSE-2150,
// tests/map-georef-cell-only.spec.ts).
//
// DISTANCE TO THE PLACE, NOT THE AREA (owner, 2026-11-19: "this is how you get
// accurate measurements and distance from current location to event
// distance"; OSE-2198). Zoomed in, each dot also carries its own res-9 cell's
// centre (`data-ll`, lib/cell-point.ts), so the map's script measures "where
// am I" to the place (a block, about 0.35 km across) rather than to the area
// (about 2.4 km). That point is the same one the dot is drawn at, written from
// the cell id alone: no event's own point. It says nothing the drawing does not
// already say (the dot read back through the frame is the same block; the same
// spec pins both). Which events are at a place is read from the place's own
// panel, so no event is tied to a place the panel does not name.
//
// NO STREET MAP, NO FLOATING DOTS (owner, 2026-11-09; OSE-1894). Dots on a bare
// hexagon tell nobody where anything is. Where the street map is missing (no
// `MAP_TILES` binding, or a failed read), the zoomed area is the list of its
// places and their panels, and no dot map is drawn.

import { cellToBoundary, cellToLatLng, getResolution, isValidCell } from 'h3-js';
import { CORRIDOR_RES, NODE_RES } from './h3-tagging.js';
import { cellPoint } from './cell-point.js';
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
  splitStreetLayer,
  type MapFrame,
  type StreetLayer,
} from './street-map.js';
import { LABEL_STYLE } from './map-label-style.js';
import { PAN_STYLE } from './map-pan-style.js';
import { PAN_SCRIPT } from './map-pan-script.js';
import { TIP_SCRIPT } from './map-tip-script.js';
import { TIP_STYLE } from './map-tip-style.js';

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
// What a narrow screen changes: its own module, for the same budget.
import { NARROW_MAP_STYLE } from './map-narrow-style.js';
// From which screen width a hexagon is a link: its own module, for the same budget.
import { MAP_LIST_HIDDEN_CLASS, MAP_LIST_STYLE } from './map-list-style.js';
import { LINK_FROM_PX, LINK_STYLE, MAP_GUTTER_PX, MAP_MAX_PX } from './map-link-style.js';
import {
  renderPlacePanels,
  type PanelEvent,
  type PanelOptions,
  type PanelPlace,
} from './map-place-panel.js';

/**
 * Touch target round a dot, in map units. 78 units across is 44 px once a unit
 * is 0.565 px. The whole 600-unit frame gives that only on a map 339 px wide or
 * more, so under 480 px the zoomed area is drawn 4 by 3 (map-narrow-style.ts),
 * where a unit is 0.583 px on the narrowest phone (320 px, a 280 px map).
 */
const DOT_HIT_R = 39;
/** The dot itself: wide enough for a two-digit number at either size it is set in. */
const DOT_R = 17;
/** Dots nearer than two hit radii overlap as touch targets, so they are one place. */
export const DOT_MERGE = 2 * DOT_HIT_R;

/**
 * A hexagon on the landing's own map is a link only where it is a touch target
 * (AGENTS.md invariant 8). The narrowest phone is 320 px, whose gutters leave
 * the map 280 px (map-narrow-style.ts).
 */
const TOUCH_MIN_PX = 44;
const PHONE_MAP_PX = 320 - MAP_GUTTER_PX;
/** Map units a hexagon must span to be 44 px when `shown` units fill a map `mapPx` wide. */
const touchUnits = (shown: number, mapPx: number) => (TOUCH_MIN_PX * shown) / mapPx;
/**
 * `v` is `floor` or more. Every size and edge the map compares goes through
 * here. Written with `min`, not `>=`: a size worked out from a cell's corners
 * never equals its floor, so `>=` has a twin, `>`, that no page can tell from
 * it and no test can fail on (the mutation floor, scripts/ci/mutation-file-floor.mjs).
 */
const atLeast = (v: number, floor: number) => Math.min(v, floor) === floor;
/** The same on the whole frame, for each step of map-link-style.ts. */
const STEP_UNITS = LINK_FROM_PX.map((px) =>
  touchUnits(MAP_W, Math.min(px - MAP_GUTTER_PX, MAP_MAX_PX))
);
/** Half the width of a name drawn in a hexagon, in map units a letter (bold, 28 units high). */
const NAME_HALF_UNITS = 9;

/**
 * OpenStreetMap's copyright page, one per language of this site. Its address
 * without a language follows the visitor's browser, not the language chosen
 * here, so each language names its own page (owner 2026-11-10). A new language
 * does not compile until it has one.
 */
export const OSM_COPYRIGHT_URL: Record<Lang, string> = {
  en: 'https://www.openstreetmap.org/copyright/en',
  es: 'https://www.openstreetmap.org/copyright/es',
  pl: 'https://www.openstreetmap.org/copyright/pl',
  ar: 'https://www.openstreetmap.org/copyright/ar',
};

/**
 * Protomaps prepares the archive the streets are read from, out of
 * OpenStreetMap's data. It asks for a credit and its licence does not require
 * one; the owner chose to give it (2026-11-10). Its site has one language. A
 * link a visitor may tap: nothing is ever loaded from this host.
 */
const PROTOMAPS_LINK = '<a href="https://protomaps.com">Protomaps</a>';

/**
 * The credit under a map that draws streets. OpenStreetMap's licence (ODbL)
 * asks for it wherever its data shows, so it goes with the street layer and
 * never without it. In the page's language; the link opens OpenStreetMap's own
 * page, which says the data is under the Open Database License.
 */
export function streetCredit(lang: Lang): string {
  const osm = `<a href="${OSM_COPYRIGHT_URL[lang]}">OpenStreetMap</a>`;
  const credit = fmt(lang, 'map.credit', { osm, protomaps: PROTOMAPS_LINK });
  return `<p class="amap-credit" data-testid="amap-credit">${credit}</p>`;
}

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

/** The list under the landing's map (lib/landing-area.ts), where every event is. */
export const AREA_LIST_ID = 'area-list';

function thinHtml(note: string, lang: Lang, toList: boolean): string {
  // On the landing the note points to the list it names (the grade of
  // 2026-11-17: under the gate a new area saw a picture and no way on).
  const link = toList
    ? `<p><a class="btn btn-outline" href="#${AREA_LIST_ID}" data-testid="area-map-thin-list">${msg(lang, 'map.seeList')}</a></p>`
    : '';
  return `<div class="map-placeholder" data-testid="area-map-thin" role="status">
              <p>${fmt(lang, 'map.listedBelow', { note })}</p>${link}
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

/**
 * The landing's own map. With `zoomHref` a hexagon opens its area (owner,
 * 2026-11-09), on every screen where it is large enough to be a touch target.
 *
 * The drawing is 600 by 360 units, scaled to the page, so on a 320 px phone a
 * hexagon must span 95 units to be 44 px, and areas side by side are rarely
 * that large (staging, 2026-11-15: ten areas, 62 by 60 units, 29 by 28 px). A
 * larger invisible target, as a dot has, cannot be used: areas share their
 * edges, so it would lie over the neighbour and take its taps (tried, and seen
 * in a browser). The hexagons themselves have to be large enough. The size
 * counted is the hexagon's box, as the phone audit counts it
 * (tests/playwright/mobile-workability.spec.ts), and the smallest hexagon
 * decides for the whole map. `links` says where they are links:
 *   0     at every width. Either they are 95 units or more, or every area lies
 *         in the middle 360 units and a phone shows that square (`tall`: `slice`
 *         here, the box in map-narrow-style.ts), which cuts only street at the
 *         sides. A hexagon is then 44 px from 57 units on the phone and from 60
 *         units at 480 px, where the whole frame is back.
 *   1 2 3 from a wider screen only (map-link-style.ts): each hexagon is drawn
 *         as a link and plain, and the width decides which shows.
 *   null  never: no `zoomHref`, or hexagons under 36.7 units.
 * The list under the map keeps a 44 px link to every area in every case.
 */
function svgFor(
  areas: AttendeeMapArea[],
  lang: Lang,
  streets?: string,
  zoomHref?: (cell: string) => string,
  filterClasses?: FilterClasses
): { svg: string; tall: boolean; links: 0 | 1 | 2 | 3 | null } {
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
  const cutName = (a: AttendeeMapArea) =>
    !a.name || areas.length > SVG_NAME_MAX_AREAS
      ? ''
      : a.name.length > SVG_NAME_MAX_CHARS
        ? `${a.name.slice(0, SVG_NAME_MAX_CHARS - 1)}…`
        : a.name;
  const shown = namesClear(
    rings.map(({ a, mid }) => ({ cell: a.cell, mid, name: cutName(a) })),
    W
  );
  /**
   * The name under an area's number, cut to fit, while the hexagons are few and
   * large, and only where it lies clear of every other name and number (the
   * grade of 2026-11-17: "near A hall" lay over "Oak Lawn"). The list under the
   * map names every area either way.
   */
  const shortName = (a: AttendeeMapArea) => (shown.has(a.cell) ? cutName(a) : '');

  // Each hexagon's box, and how far its name reaches either side of its middle.
  const span = (vs: number[]) => Math.max(...vs) - Math.min(...vs);
  const boxes = rings.map(({ a, ring, mid }) => {
    const xs = ring.map((p) => p[0]);
    const half = shortName(a).length * NAME_HALF_UNITS;
    return {
      left: Math.min(...xs, mid[0] - half),
      right: Math.max(...xs, mid[0] + half),
      least: Math.min(span(xs), span(ring.map((p) => p[1]))),
    };
  });
  const side = (W - H) / 2;
  // The smallest decides: every hexagon that is a link must be a touch target.
  // The areas of one map are drawn nearly the same size, and near a limit
  // "nearly" is the difference (tests/map-limits.spec.ts).
  const least = Math.min(...boxes.map((b) => b.least));
  // On the whole frame the phone decides; in the taller box the phone has room
  // to spare and 480 px, back on the whole frame, decides.
  const wholeFloor = touchUnits(W, PHONE_MAP_PX);
  const tallFloor = Math.max(touchUnits(H, PHONE_MAP_PX), STEP_UNITS[0] ?? wholeFloor);
  const large = atLeast(least, wholeFloor);
  const tall =
    !!zoomHref &&
    !large &&
    atLeast(least, tallFloor) &&
    boxes.every((b) => atLeast(b.left, side) && atLeast(W - side, b.right));
  const step = STEP_UNITS.findIndex((units) => atLeast(least, units));
  const links = !zoomHref ? null : large || tall ? 0 : step >= 0 ? ((step + 1) as 1 | 2 | 3) : null;

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
      const short = shortName(a);
      const nameLine = short
        ? `<tspan x="${fx(mid[0])}" dy="1.15em" data-testid="amap-area-name">${escapeHtml(short)}</tspan>`
        : '';
      const body =
        `<title>${escapeHtml(label)}</title>` +
        `<polygon class="amap-cell" points="${points}" fill-opacity="${opacity}" stroke-width="1.5"/>` +
        `<text class="amap-num" x="${fx(mid[0])}" y="${fx(mid[1])}" text-anchor="middle" dominant-baseline="central">${a.n}${nameLine}</text>`;
      // On the landing a hexagon opens its area, zoomed in (owner, 2026-11-09):
      // at every width, or as a link and plain, one of them shown.
      const href = zoomHref && links !== null ? escapeHtml(zoomHref(a.cell)) : '';
      const inner = !href
        ? body
        : links === 0
          ? `<a href="${href}" data-testid="amap-area-link">${body}</a>`
          : `<a class="amap-w${links}" href="${href}" data-testid="amap-area-link">${body}</a><g class="amap-n${links}">${body}</g>`;
      // With a street map, where the area's middle is and what it is called, for
      // the distance the map's script works out on the phone
      // (lib/map-pan-script.ts). Both come from the public cell id and the
      // public address, as the drawing does.
      const where = streets
        ? ` data-ll="${cellPoint(a.cell)}" data-name="${escapeHtml(a.name || String(a.n))}"`
        : '';
      // The same words for the map's own tooltip (lib/map-tip-script.ts), which
      // keeps clear of the pointer and shows on a press and hold on a phone.
      return `<g${areaClassAttr(a, filterClasses)} data-testid="amap-area" data-cell="${a.cell}" data-count="${k}"${where} data-tip="${escapeHtml(label)}">${inner}</g>`;
    })
    .join('');
  const cut = tall ? ' preserveAspectRatio="xMidYMid slice"' : '';
  // OSE-2112: a drawing that holds links is a group, as the zoomed drawing is
  // (OSE-1889). Inside role="img" every child is presentational, so a screen
  // reader would skip the hexagon links the keyboard still stops on. With no
  // link in it, the drawing is one picture.
  const role = links === null ? 'img' : 'group';
  // The street map under the hexagons, its names over them (lib/street-labels.ts).
  const [under, names] = splitStreetLayer(streets ?? '');
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"${cut} role="${role}" aria-labelledby="amap-caption" data-testid="amap-svg"${streets ? frameAttrs(frame) : ''}>${under}${shapes}${names}</svg>`,
    tall,
    links,
  };
}

/** Event id to the landing's filter classes for it (window, type, modality). */
export type FilterClasses = ReadonlyMap<string, readonly string[]>;

/** Every filter class an area's events carry: a pill hides the area only when none match. */
function areaClasses(a: AttendeeMapArea, filterClasses: FilterClasses): string {
  const all = a.events.flatMap((e) => filterClasses.get(e.id) ?? []);
  return ['amap-f', ...new Set(all)].join(' ');
}

/** ` class="amap-f …"` on the landing, nothing anywhere else. */
function areaClassAttr(a: AttendeeMapArea, filterClasses?: FilterClasses): string {
  return filterClasses ? ` class="${escapeHtml(areaClasses(a, filterClasses))}"` : '';
}

/** Half the height of a hexagon's number, and the band its name is set in, in map units. */
const NUM_HALF_UNITS = 16;
const NAME_TOP_UNITS = 14;
const NAME_BOTTOM_UNITS = 48;

type Box = [left: number, top: number, right: number, bottom: number];
const overlaps = (p: Box, q: Box) => p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3];

/**
 * The cells whose name may be drawn under their number: in order (the busiest
 * area first), a name is kept when its box lies inside the frame and clear of
 * every other area's number and of every name kept before it. Boxes are measured at the
 * largest size a name is set in (NAME_HALF_UNITS a letter).
 */
export function namesClear(
  labels: readonly { cell: string; mid: readonly [number, number]; name: string }[],
  width: number
): Set<string> {
  const numbers: Box[] = labels.map(({ mid: [x, y] }) => [
    x - NUM_HALF_UNITS,
    y - NUM_HALF_UNITS,
    x + NUM_HALF_UNITS,
    y + NUM_HALF_UNITS,
  ]);
  // Stryker disable next-line ArrayDeclaration: equivalent mutant. A string in this list is never a box: every comparison overlaps() makes with its letters is false, so it lies over no name.
  const kept: Box[] = [];
  const cells = new Set<string>();
  for (const [i, { cell, mid, name }] of labels.entries()) {
    if (!name) continue;
    const half = name.length * NAME_HALF_UNITS;
    const box: Box = [
      mid[0] - half,
      mid[1] + NAME_TOP_UNITS,
      mid[0] + half,
      mid[1] + NAME_BOTTOM_UNITS,
    ];
    const inFrame = box[0] >= 0 && box[2] <= width;
    // Its own number sits just above it, so only the others are in the way.
    const others = numbers.filter((_, j) => j !== i);
    if (!inFrame || [...others, ...kept].some((b) => overlaps(b, box))) continue;
    kept.push(box);
    cells.add(cell);
  }
  return cells;
}

/** One event's link in a legend, with its consented sponsor (OSE-1522). */
function eventLink(
  e: { id: string; name: string },
  lang: Lang,
  sponsorTitles?: ReadonlyMap<string, string>,
  classes?: string,
  before = ''
): string {
  const sponsor = sponsorTitles?.get(e.id);
  const by = sponsor
    ? ` <span data-testid="amap-event-sponsor">${fmt(lang, 'map.sponsor', { sponsor: escapeHtml(sponsor) })}</span>`
    : '';
  const link = `<a href="${withLangPrefix(lang, `/events/${escapeHtml(e.id)}`)}" data-testid="amap-event">${escapeHtml(e.name)}</a>${by}`;
  return classes ? `<span class="${escapeHtml(classes)}">${before}${link}</span>` : link;
}

/**
 * The drawing's frame, for the map's script (lib/map-pan-script.ts): where a
 * position falls on it, and how many metres a map unit is at its middle, for
 * the scale bar. The frame comes from the drawn cell ids alone.
 */
function frameAttrs(f: MapFrame): string {
  const midY = f.y0 + f.h / 2 / f.scale;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * midY)));
  const mpu = (40_075_016.686 * Math.cos(lat)) / f.scale;
  return ` data-x0="${f.x0.toFixed(9)}" data-y0="${f.y0.toFixed(9)}" data-scale="${f.scale.toFixed(3)}" data-mpu="${mpu.toFixed(3)}"`;
}

/**
 * The map's zoom buttons, its scale bar and the line about where the visitor
 * is. Hidden until the map's script shows them, so a page without the script
 * shows no button that does nothing. The words the script writes ride on the
 * block, already in the page's language.
 */
function panControls(lang: Lang, zoomed = false): string {
  const w = (key: Parameters<typeof msg>[1]) => escapeHtml(msg(lang, key));
  const words: (readonly [string, Parameters<typeof msg>[1]])[] = [
    ['from', 'map.fromYou'],
    ['miles', 'map.miles'],
    ['you', 'map.you'],
    ['outside', 'map.youOutside'],
    ['nearest', 'map.nearest'],
    ['locating', 'map.locating'],
    ['off', 'map.locationOff'],
  ];
  // Zoomed in, the distance is to each place (OSE-2198); an event with no place
  // on the map is measured to the area and says "about".
  if (zoomed) words.push(['near-place', 'map.nearestPlace'], ['from-about', 'map.fromYouAbout']);
  const data = words.map(([k, key]) => ` data-${k}="${w(key)}"`).join('');
  const b = (z: string, label: string, text: string) =>
    `<button type="button" class="btn btn-secondary" data-z="${z}" data-testid="amap-${z}"${label ? ` aria-label="${label}"` : ''}>${text}</button>`;
  return (
    `<div class="amap-ctl" data-testid="amap-ctl" hidden${data}>` +
    b('in', w('map.zoomIn'), '+') +
    b('out', w('map.zoomOut'), '&minus;') +
    b('reset', '', w('map.zoomReset')) +
    b('me', '', w('map.showMe')) +
    `<span class="amap-scale" role="img" aria-label="${w('map.scale')}" data-testid="amap-scale"><span class="amap-bar"></span><span data-testid="amap-scale-text"></span></span>` +
    `<p data-testid="amap-hint">${w('map.zoomHint')}</p>` +
    `<p aria-live="polite" data-testid="amap-you-status"></p>` +
    `</div>`
  );
}

function legendFor(
  areas: AttendeeMapArea[],
  lang: Lang,
  sponsorTitles?: ReadonlyMap<string, string>,
  zoomHref?: (cell: string) => string,
  filterClasses?: FilterClasses,
  /** The map's script is on: each row says which area it is, for its distance. */
  pan?: boolean,
  /** The landing: the list stays in the page, unseen (lib/map-list-style.ts). */
  quiet?: boolean
): string {
  const rows = areas
    .map((a) => {
      // On the landing each link carries its event's filter classes, so a pill
      // hides it; the separator rides inside the link's own span with it.
      const links = filterClasses
        ? a.events
            .map((e, i) =>
              eventLink(
                e,
                lang,
                sponsorTitles,
                ['amap-f', ...(filterClasses.get(e.id) ?? [])].join(' '),
                i > 0 ? '&middot; ' : ''
              )
            )
            .join(' ')
        : a.events.map((e) => eventLink(e, lang, sponsorTitles)).join(' &middot; ');
      const k = a.events.length;
      const place = a.name
        ? `<span data-testid="amap-legend-name">${escapeHtml(a.name)}</span> &middot; `
        : '';
      const zoom = zoomHref
        ? ` <a class="amap-zoom" href="${escapeHtml(zoomHref(a.cell))}" data-testid="amap-zoom">${msg(lang, 'map.zoomIn')}</a>`
        : '';
      return `<li value="${a.n}"${areaClassAttr(a, filterClasses)} data-testid="amap-legend-area"${pan ? ` data-area="${a.cell}"` : ''}><strong>${place}${eventCount(k, lang)}:</strong> ${links}${zoom}</li>`;
    })
    .join('');
  const cls = quiet ? `amap-legend ${MAP_LIST_HIDDEN_CLASS}` : 'amap-legend';
  return `<ol class="${cls}" data-testid="amap-legend">${rows}</ol>`;
}

// ── zoomed in on one area ────────────────────────────────────────────────────

/**
 * An event as the zoomed map needs it: its place and the landing's filter classes.
 *
 * Its place is its res-9 cell, the block the dot is drawn at (OSE-2197). It
 * carries no point: the public projection gives none, and the dot never needed
 * one, only the block the point was in.
 */
export interface ZoomEvent extends AttendeeMapItem {
  /** The event's res-9 cell from the server's own row (stored, else derived from its stored point); never from the projection. */
  h3_res9?: unknown;
  /** 'business' is marked (solid, named); every kind sits at its block centre. */
  place_kind?: unknown;
  /** The card's filter classes (type, window, modality), so the pills filter the dot. */
  classes?: readonly string[];
}

export interface MapDot {
  /** 1-based, top to bottom then left to right; printed in the dot and the list. */
  n: number;
  /** The res-9 cell the dot is drawn at (the first block, when nearby blocks merged). */
  cell: string;
  /** That cell's centre: `cellToLatLng(cell)`, never an event's own point. */
  lat: number;
  lng: number;
  /** True when every event here is at a business (drawn solid, named). Always a block centre. */
  exact: boolean;
  events: { id: string; name: string; classes: string[] }[];
}

/** The event's res-9 cell, or null when it has none (or anything else). */
function blockOf(v: unknown): string | null {
  return typeof v === 'string' && isValidCell(v) && getResolution(v) === NODE_RES ? v : null;
}

/**
 * Where each event of one area sits (owner, 2026-11-09): at its res-9 block's
 * centre, a business too. Events on one block share a dot, and so do blocks
 * nearer than two touch targets (DOT_MERGE), at the centre of the first of them
 * in reading order. Events with no res-9 cell are returned as `unplaced`.
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
    // Place, not person (AGENTS.md invariant 3; owner 2026-11-09, epic OSE-1880):
    // every place sits at its res-9 block centre, a business too. A business is
    // marked (solid dot, named in its panel), never pinpointed. The block is the
    // event's stored cell (OSE-2197), so no point is read here at all.
    const block = blockOf(e.h3_res9);
    if (block === null) {
      unplaced.push(ev);
      continue;
    }
    const business = e.place_kind === 'business';
    const at = cellToLatLng(block);
    const key = `b:${block}`;
    const dot = byKey.get(key) ?? { cell: block, lat: at[0], lng: at[1], exact: true, events: [] };
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

function zoomSvg(cell: string, dots: MapDot[], lang: Lang, streets: string, name: string): string {
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
      // The place's own point (its res-9 cell's centre, the point it is drawn at),
      // for the distance the map's script works out on the phone.
      return (
        `<a href="${dotHref(d)}" class="${escapeHtml(cls)}" data-testid="amap-dot" data-exact="${d.exact ? 1 : 0}" data-count="${d.events.length}" data-ll="${cellPoint(d.cell)}" data-tip="${escapeHtml(title)}">` +
        `<title>${escapeHtml(title)}</title>` +
        `<circle class="amap-hit" cx="${fx(x)}" cy="${fx(y)}" r="${DOT_HIT_R}" fill-opacity="0"/>` +
        `<circle class="amap-dot" cx="${fx(x)}" cy="${fx(y)}" r="${DOT_R}"/>` +
        `<text class="amap-dn" x="${fx(x)}" y="${fx(y)}" text-anchor="middle" dominant-baseline="central">${d.n}</text>` +
        `</a>`
      );
    })
    .join('');
  // "slice": in a box taller than the frame the drawing fills the box and its
  // sides are cut (map-narrow-style.ts). In a 5 by 3 box it changes nothing.
  const [under, names] = splitStreetLayer(streets);
  const ll = cellPoint(cell);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="group" aria-labelledby="amap-caption" data-testid="amap-svg"${frameAttrs(frame)}>` +
    `${under}<polygon class="amap-zone" points="${ring}" data-testid="amap-zone" data-cell="${cell}" data-ll="${ll}" data-name="${escapeHtml(name)}"/>${names}${marks}</svg>`
  );
}

/**
 * The zoomed area has no text list of places: the event cards below the map are
 * the list (owner, 2026-11-17). This is only the anchor "Show all places" in a
 * panel points at, so closing a panel leaves the map as it was.
 */
function zoomLegend(): string {
  return `<span id="amap-places" data-testid="amap-places-anchor"></span>`;
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
  const { dots } = mapDots(cell, inArea, lang);
  const streets =
    streetLayer && streetLayer.cellsKey === cellsKey([cell]) ? streetLayer.svg : undefined;
  const credit = streets ? streetCredit(lang) : '';
  const events = eventCount(inArea.length, lang);
  const days = CORRIDOR_WINDOW_DAYS;
  const caption = area.name
    ? fmt(lang, streets ? 'map.zoomCaptionNamed' : 'map.listCaptionNamed', {
        events,
        name: escapeHtml(area.name),
        days,
      })
    : fmt(lang, streets ? 'map.zoomCaption' : 'map.listCaption', { events, days });
  // No street map, no floating dots (OSE-1894): the event cards below are the list.
  const drawing = streets
    ? zoomSvg(cell, dots, lang, streets, area.name || '1')
    : `<div class="map-placeholder" data-testid="amap-no-tiles" role="status"><p>${msg(lang, 'map.noTiles')}</p></div>`;
  const byId = new Map(inArea.map((e) => [str(e.id), e]));
  const places: PanelPlace[] = dots.map((d) => ({
    n: d.n,
    business: d.exact,
    events: d.events.map((ev) => ({ ...(byId.get(ev.id) as PanelEvent), classes: ev.classes })),
  }));
  const panels = renderPlacePanels(places, { lang, sponsorTitles, ...panel });
  const html = `<div class="amap-wrap" data-testid="amap-wrap"><figure class="amap" data-testid="amap" data-zoom="${cell}"${streets ? ' data-pan' : ''}>
              ${MAP_STYLE}${ZOOM_STYLE}${streets ? STREET_STYLE + LABEL_STYLE + PAN_STYLE : ''}${NARROW_MAP_STYLE}${streets ? TIP_STYLE : ''}
              ${back}
              ${drawing}${streets ? panControls(lang, true) : ''}
              ${zoomLegend()}
              <figcaption id="amap-caption" data-testid="amap-caption">${caption}</figcaption>${credit}
            </figure>${panels}</div>${streets ? PAN_SCRIPT + TIP_SCRIPT : ''}`;
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
    /**
     * The landing: each event's filter classes, so its pills hide the hexagons,
     * legend rows and links whose events none match (CSS only).
     */
    filterClasses?: FilterClasses;
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
    return { html: thinHtml(note, lang, !!gate), state: 'thin', count: 0, areas: [] };
  }

  const caption = fmt(lang, opts?.filterClasses ? 'map.captionFiltered' : 'map.caption', {
    events: eventCount(count, lang),
    areas: fmtCount(lang, drawn.length, { one: 'map.areasOne', other: 'map.areas' }),
    days: CORRIDOR_WINDOW_DAYS,
  });
  const streets =
    opts?.streets && opts.streets.cellsKey === cellsKey(drawn.map((a) => a.cell))
      ? opts.streets.svg
      : undefined;
  const credit = streets ? streetCredit(lang) : '';
  // The landing (its pills give filter classes) keeps the list but does not show it.
  const quiet = !!opts?.filterClasses;
  const map = svgFor(drawn, lang, streets, opts?.zoomHref, opts?.filterClasses);
  // "Tap a hexagon" only where a hexagon is a link.
  const tap =
    map.links === null
      ? ''
      : map.links === 0
        ? ` ${msg(lang, 'map.tapToZoom')}`
        : ` <span class="amap-w${map.links}" data-testid="amap-tap">${msg(lang, 'map.tapToZoom')}</span>`;
  const html = `<figure class="amap" data-testid="amap"${map.tall ? ' data-tall' : ''}${streets ? ' data-pan' : ''}>
              ${MAP_STYLE}${streets ? STREET_STYLE + LABEL_STYLE + PAN_STYLE : ''}${opts?.zoomHref ? ZOOM_STYLE : ''}${NARROW_MAP_STYLE}${map.links ? LINK_STYLE : ''}${quiet ? MAP_LIST_STYLE : ''}${TIP_STYLE}
              ${map.svg}${streets ? panControls(lang) : ''}
              ${legendFor(drawn, lang, opts?.sponsorTitles, opts?.zoomHref, opts?.filterClasses, !!streets, quiet)}
              <figcaption id="amap-caption" data-testid="amap-caption">${caption}${tap}</figcaption>${credit}
            </figure>${streets ? PAN_SCRIPT : ''}${TIP_SCRIPT}`;
  return { html, state: 'map', count, areas: drawn };
}
