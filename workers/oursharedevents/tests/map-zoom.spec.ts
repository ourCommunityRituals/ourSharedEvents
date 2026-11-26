/**
 * The landing map, zoomed in on one area (owner, 2026-11-09).
 *
 * A hexagon on the landing links to `?area=<res-7 cell>`. That view draws the
 * one area over the street map with a numbered dot per place that holds an
 * event, every one at the centre of its res-9 block (invariant 3; epic
 * OSE-1880). A business or landmark (`place_kind` 'business') is marked, never
 * pinpointed. Dots nearer than two touch targets are one place. Every dot
 * opens its place panel under the map. The dots carry the cards' filter
 * classes, so the landing's pills filter them with no JS. With no street map
 * there is no dot map: the places are a list, with the same panels.
 *
 * Node project: pure rendering. The page itself (`/?area=` through the
 * Worker, where no street map is bound) is covered in event-place.spec.ts.
 *
 * @born-red map zoom | method: 21 faults injected one at a time (all dots exact,
 *   none exact, kind always address, kind not saved, kinds asked for events placed
 *   from coordinates, over the nightly budget, on a Google outage, a kind fill that
 *   moves the point, a finer cell accepted, every parameter reflected, pills that
 *   skip dots, cards not scoped, dot classes dropped, a shared dot linking to one
 *   event, hexagon links inverted, the handler not zooming, an edit keeping the
 *   old kind, an unescaped dot title, a small touch target, other areas drawn,
 *   blocks not shared); each turned map-zoom.spec.ts or event-place.spec.ts red
 *   | date: 2026-11-09
 * @born-red merged dots, no-tiles list, neutral outline | method: 11 faults
 *   injected one at a time (near blocks not merged, the merge taking every
 *   block, a merged place marked as a business, dots drawn with no street map,
 *   the no-street-map note dropped, the list rows without their place link, the
 *   dot caption kept on the list, and its named form, the outline back on the
 *   accent colour, the fill too, the touch target without its fill-opacity);
 *   each turned this file red | date: 2026-11-09
 */
// @born-red landing hexagon links are touch targets (OSE-2084) | method: the six tests seen failing on the source as it was (a staging hexagon link: 28.1 px at 320 px), then 16 faults injected one at a time, each put back (the floor at 30 px; the taller box never used, used though it cuts an area, without its 480 px floor, without slice, without data-tall, its rule removed, its rule 4/3; one step too early; small hexagons linked at every width; hexagons under the last step linked; the plain copy dropped; the link style not sent; its third step at 700 px; the linked copies not hidden first; "Tap a hexagon" always said); each turned this file red. Then StrykerJS on src/lib/attendee-map.ts: 18 mutants of the new code survived the first run (the name's reach on each side, the box holding an area on each side, a row of five linked from 480 px, large hexagons keeping the whole frame); each is killed now, by the test that names it | date: 2026-11-15
// @born-red attendee-map mutants | method: StrykerJS mutants of src/lib/attendee-map.ts, each new test seen failing against the mutant it kills (status Killed in the report) | date: 2026-11-09
import { PAN_SCRIPT } from '../src/lib/map-pan-script';
import { TIP_SCRIPT } from '../src/lib/map-tip-script';
import { TIP_STYLE } from '../src/lib/map-tip-style';
import { PAN_STYLE } from '../src/lib/map-pan-style';
import { LABEL_STYLE } from '../src/lib/map-label-style';
import { describe, expect, test } from 'vitest';
import {
  cellToBoundary,
  cellToChildren,
  cellToLatLng,
  cellToParent,
  gridDisk,
  h3IndexToSplitLong,
  latLngToCell,
} from 'h3-js';
import {
  DOT_MERGE,
  MAP_STYLE,
  ZOOM_STYLE,
  mapDots,
  renderAttendeeMap,
  type ZoomEvent,
} from '../src/lib/attendee-map';
import { landingZoom, renderLandingArea } from '../src/lib/landing-area';
import { NARROW_MAP_STYLE } from '../src/lib/map-narrow-style';
import { LINK_FROM_PX, LINK_STYLE, MAP_GUTTER_PX } from '../src/lib/map-link-style';
import { PLACE_PANEL_CSS } from '../src/lib/event-list';
import { CORRIDOR_WINDOW_DAYS } from '../src/lib/corridor-readiness';
import {
  MAP_H,
  MAP_W,
  STREET_STYLE,
  cellsKey,
  frameForCells,
  project,
} from '../src/lib/street-map';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const SOON = '2026-11-20';
// Rock Island Public House, Blue Island IL, in res-7 cell 872664544ffffff.
const RIPH = { lat: 41.6565, lon: -87.681 };
const CELL = latLngToCell(RIPH.lat, RIPH.lon, 7);
const OTHER = latLngToCell(41.88, -87.63, 7);
// The area next to CELL: near enough that both hexagons are drawn large.
const NEAR = gridDisk(CELL, 1).find((c) => c !== CELL)!;

/** The res-9 cell the server stores for a point (lib/h3-tagging), or none. */
function storedRes9(lat: unknown, lon: unknown): string | null {
  const ok = (v: unknown, max: number): v is number =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
  return ok(lat, 90) && ok(lon, 180) ? latLngToCell(lat, lon, 9) : null;
}

/**
 * An event as the zoomed map gets it. A test says where the event is as a
 * point, as a place is given; the map is handed only what the server stores
 * from it, the res-9 cell (OSE-2197: the map reads no point). `h3_res9` in
 * `over` is passed as it is.
 */
function ev(
  id: string,
  over: Partial<ZoomEvent> & { lat?: unknown; lon?: unknown } = {}
): ZoomEvent {
  const { lat = RIPH.lat, lon = RIPH.lon, ...rest } = over;
  return {
    id,
    name: `Event ${id}`,
    startDateISO: SOON,
    phase: 'pre_event',
    h3_res7: CELL,
    h3_res9: storedRes9(lat, lon),
    place_kind: 'business',
    classes: ['type-trivia', 'when-week'],
    ...rest,
  };
}

// The street map drawn for this one area. Without it no dot map is drawn.
// Made when a test asks, not as the file loads: street-map code run under no
// test makes its mutants "static", and the mutation pass then reruns every spec
// for each of them (street-map.ts is mutated whole since 2026-11-15).
const streets = () => ({
  cellsKey: cellsKey([CELL]),
  svg: '<g data-testid="amap-streets"></g>',
});

const zoomed = (events: ZoomEvent[], extra: Record<string, unknown> = {}) =>
  renderAttendeeMap([], {
    now: NOW,
    zoom: { cell: CELL, events, backHref: '/?zip=60406' },
    streets: streets(),
    ...extra,
  });

/** Where a block's dot is drawn, in map units. */
const frame = () => frameForCells([CELL], MAP_W, MAP_H);
const xyOf = (lat: number, lon: number) =>
  project(frame(), ...cellToLatLng(latLngToCell(lat, lon, 9)));
const apart = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

// OSE-2197: the public projection carries no point any more, and the zoomed
// landing used to find each dot's block from the point the projection carried.
// The landing now hands the drawing each event's res-9 cell from the server's
// own row (lib/landing-area.ts blockOf): the stored h3_res9, else the cell the
// server derives from its stored point. Rows here are shaped as the list read
// returns them (lib/data-provider.ts fetchEvents): the point and both cells.
// @born-red OSE-2197 landing zoom | method: `h3_res9: blockOf(e)` taken out of renderLandingArea's zoom events (lat and lon gone from the projection with no cell passed instead), the four cases below ran red; each event's h3_res9 written into the zoomed page as a data attribute, the first case ran red; each restored | date: 2026-11-19
describe('the zoomed landing still draws its dots with the point out of the public answer', () => {
  const far = { lat: RIPH.lat + 0.01, lon: RIPH.lon };
  const row = (
    id: string,
    at: { lat: number; lon: number },
    extra: Record<string, unknown> = {}
  ) => ({
    id,
    name: `Event ${id}`,
    startDateISO: SOON,
    phase: 'pre_event',
    h3_res7: CELL,
    place_kind: 'address',
    lat: at.lat,
    lon: at.lon,
    ...extra,
  });
  const res9 = (at: { lat: number; lon: number }) => latLngToCell(at.lat, at.lon, 9);
  const zoomedLanding = (rows: Record<string, unknown>[]) =>
    renderLandingArea(rows, { now: NOW, zoom: { cell: CELL, backHref: '/' }, streets: streets() })
      .html;
  /** Each dot's drawn centre, as the page writes it. */
  const dotsDrawn = (html: string) =>
    [...html.matchAll(/<circle class="amap-dot" cx="([\d.-]+)" cy="([\d.-]+)"/g)].map(
      (m) => `${m[1]},${m[2]}`
    );
  const at = (p: { lat: number; lon: number }) =>
    xyOf(p.lat, p.lon)
      .map((v) => v.toFixed(1))
      .join(',');

  test('rows as the list read returns them: one dot per place, each at its block', () => {
    const html = zoomedLanding([
      row('a', RIPH, { h3_res9: res9(RIPH) }),
      row('b', far, { h3_res9: res9(far) }),
    ]);
    expect(dotsDrawn(html).sort()).toEqual([at(RIPH), at(far)].sort());
    expect(html).not.toContain(String(RIPH.lat));
    expect(html).not.toContain(String(RIPH.lon));
    // The res-9 cell the landing hands the drawing places the dot; its id is
    // never written to the page (only the area's res-7 cell is).
    expect(html).not.toContain(res9(RIPH));
    expect(html).not.toContain(res9(far));
  });

  test('a row from before its cells were written: the server derives its block from the stored point', () => {
    const html = zoomedLanding([row('a', RIPH), row('b', far)]);
    expect(dotsDrawn(html).sort()).toEqual([at(RIPH), at(far)].sort());
  });

  test("the stored cell wins over the point: the dot is at the event's own block", () => {
    const html = zoomedLanding([row('a', far, { h3_res9: res9(RIPH) })]);
    expect(dotsDrawn(html)).toEqual([at(RIPH)]);
  });

  test('a stored value that is no res-9 cell is not used: the block comes from the point', () => {
    for (const bad of [CELL, 'not-a-cell']) {
      const html = zoomedLanding([row('a', RIPH, { h3_res9: bad })]);
      expect(dotsDrawn(html), bad).toEqual([at(RIPH)]);
    }
  });

  // The bounds a point must keep to give a block (StrykerJS on blockOf): just
  // off the globe gives none; on its edge is still a place.
  test('a point off the globe gives no block; a point on its edge does', () => {
    const off = zoomedLanding([
      row('n', { lat: 90.5, lon: RIPH.lon }),
      row('e', { lat: RIPH.lat, lon: 180.5 }),
    ]);
    expect(dotsDrawn(off)).toEqual([]);
    expect(off).toContain('/events/n');
    expect(off).toContain('/events/e');
    const edge = zoomedLanding([
      row('pole', { lat: 90, lon: 0 }),
      row('line', { lat: 0, lon: 180 }),
    ]);
    expect(dotsDrawn(edge)).toHaveLength(2);
  });

  test('with neither a cell nor a point, the event is listed and not drawn', () => {
    const html = zoomedLanding([
      row('a', RIPH, { h3_res9: res9(RIPH) }),
      { ...row('b', RIPH), lat: null, lon: null },
    ]);
    expect(dotsDrawn(html)).toEqual([at(RIPH)]);
    expect(html).toContain('/events/b');
  });
});

describe('where a dot sits', () => {
  // Place, not person (AGENTS.md invariant 3; owner 2026-11-09, epic OSE-1880):
  // every place is drawn at its res-9 block centre. A business is marked, not
  // pinpointed.
  test('a business and an address both sit at the res-9 block centre; only the business is marked', () => {
    const far = { lat: RIPH.lat + 0.01, lon: RIPH.lon };
    const { dots } = mapDots(CELL, [ev('biz'), ev('home', { place_kind: 'address', ...far })]);
    const biz = dots.find((d) => d.events[0]!.id === 'biz')!;
    const home = dots.find((d) => d.events[0]!.id === 'home')!;
    expect(biz.exact).toBe(true);
    expect([biz.lat, biz.lng]).toEqual(cellToLatLng(latLngToCell(RIPH.lat, RIPH.lon, 9)));
    expect([biz.lat, biz.lng]).not.toEqual([RIPH.lat, RIPH.lon]);
    expect(home.exact).toBe(false);
    expect([home.lat, home.lng]).toEqual(cellToLatLng(latLngToCell(far.lat, far.lon, 9)));
  });

  test('no exact coordinate of any event reaches the page', () => {
    const html = zoomed([ev('biz'), ev('home', { place_kind: 'address' })]).html;
    expect(html).not.toContain(String(RIPH.lat));
    expect(html).not.toContain(String(RIPH.lon));
  });

  test('no kind, or any other value, is drawn as a block, never exactly', () => {
    for (const place_kind of [undefined, null, '', 'Business', 'premise', 1]) {
      const { dots } = mapDots(CELL, [ev('x', { place_kind })]);
      expect(dots[0]!.exact, String(place_kind)).toBe(false);
    }
  });

  test('events on one block share a dot, a business among them; the dot is marked only when all are businesses', () => {
    const near = { lat: RIPH.lat + 0.0003, lon: RIPH.lon + 0.0003 };
    expect(latLngToCell(near.lat, near.lon, 9)).toBe(latLngToCell(RIPH.lat, RIPH.lon, 9));
    const mixed = mapDots(CELL, [ev('a', { place_kind: 'address' }), ev('b', near), ev('c')]).dots;
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.events.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(mixed[0]!.exact).toBe(false);
    const allBusiness = mapDots(CELL, [ev('c'), ev('d', near)]).dots;
    expect(allBusiness).toHaveLength(1);
    expect(allBusiness[0]!.exact).toBe(true);
  });

  test('an event with no res-9 cell is listed, not drawn', () => {
    const { dots, unplaced } = mapDots(CELL, [
      ev('a', { h3_res9: null }),
      ev('b', { h3_res9: 'x' }),
      ev('c', { h3_res9: undefined }),
    ]);
    expect(dots).toHaveLength(0);
    expect(unplaced.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  // OSE-2197: a dot is placed from the event's cell; the map reads no point.
  // @born-red OSE-2197 zoom | method: mapDots given a fallback to the event's lat/lon when it has no res-9 cell; this ran red, restored | date: 2026-11-19
  test('a point beside the cell is never read: the dot sits at the cell, and with no cell it is listed', () => {
    const block = latLngToCell(RIPH.lat, RIPH.lon, 9);
    const elsewhere = { lat: RIPH.lat + 0.01, lon: RIPH.lon };
    const withCell = mapDots(CELL, [{ ...ev('a', { h3_res9: block }), ...elsewhere }]);
    expect([withCell.dots[0]!.lat, withCell.dots[0]!.lng]).toEqual(cellToLatLng(block));
    const pointOnly = mapDots(CELL, [{ ...ev('b', { h3_res9: null }), ...elsewhere }]);
    expect(pointOnly.dots).toEqual([]);
    expect(pointOnly.unplaced.map((e) => e.id)).toEqual(['b']);
  });

  test('dots are numbered top to bottom, then left to right', () => {
    const north = { lat: RIPH.lat + 0.01, lon: RIPH.lon };
    const { dots } = mapDots(CELL, [ev('south'), ev('north', north)]);
    expect(dots.map((d) => [d.n, d.events[0]!.id])).toEqual([
      [1, 'north'],
      [2, 'south'],
    ]);
  });
});

describe('the zoomed map', () => {
  test('every dot opens its place panel, one event or many', () => {
    const one = zoomed([ev('solo')]).html;
    expect(one).toMatch(
      /<a href="#amap-dot-1" class="amap-f amap-d1 [^"]*" data-testid="amap-dot"/
    );
    expect(one).toContain('<span class="amap-t" id="amap-dot-1"></span><section class="amap-p');
    const two = zoomed([ev('a'), ev('b')]).html;
    expect(two).toMatch(/<a href="#amap-dot-1" [^>]*data-testid="amap-dot"[^>]*data-count="2"/);
    // One target per place, and the list rows no longer carry the id.
    expect(two.match(/id="amap-dot-1"/g)).toHaveLength(1);
    expect(two).toContain('href="/events/a"');
    expect(two).toContain('href="/events/b"');
  });

  test('the zoomed map is a group, so a screen reader reaches its dot links', () => {
    const html = zoomed([ev('solo')]).html;
    expect(html).toMatch(
      /<svg [^>]*role="group" aria-labelledby="amap-caption" data-testid="amap-svg"/
    );
  });

  test('a dot carries every filter class of its events, so a pill hides it only when none match', () => {
    const html = zoomed([
      ev('a', { classes: ['type-trivia', 'when-week'] }),
      ev('b', { classes: ['type-bingo', 'when-month'] }),
    ]).html;
    const cls = /class="(amap-f[^"]*)" data-testid="amap-dot"/.exec(html)![1]!.split(' ');
    expect(cls).toEqual(
      expect.arrayContaining(['amap-f', 'type-trivia', 'type-bingo', 'when-week', 'when-month'])
    );
    // Each event's card in the place panel carries its own classes.
    expect(html).toMatch(/<article[^>]*class="[^"]*amap-f type-bingo when-month[^"]*"[^>]*>/);
  });

  test('an address dot is marked as a block; a business dot is not', () => {
    const far = { lat: RIPH.lat + 0.01, lon: RIPH.lon };
    const html = zoomed([ev('biz'), ev('home', { place_kind: 'address', ...far })]).html;
    expect(html).toMatch(
      /class="amap-f amap-d\d amap-blk [^"]*" data-testid="amap-dot" data-exact="0"/
    );
    expect(html).toMatch(/class="amap-f amap-d\d type[^"]*" data-testid="amap-dot" data-exact="1"/);
  });

  test('dots sit where the frame projects them, inside the area outline', () => {
    const html = zoomed([ev('biz')]).html;
    const f = frameForCells([CELL], MAP_W, MAP_H);
    const [lat, lng] = cellToLatLng(latLngToCell(RIPH.lat, RIPH.lon, 9));
    const [x, y] = project(f, lat, lng).map((v) => v.toFixed(1));
    expect(html).toContain(`<circle class="amap-dot" cx="${x}" cy="${y}"`);
    expect(html).toContain(`data-testid="amap-zone" data-cell="${CELL}"`);
  });

  test("only this area's upcoming events are drawn", () => {
    const r = zoomed([
      ev('in'),
      ev('elsewhere', { h3_res7: OTHER }),
      ev('over', { startDateISO: '2026-01-01', phase: 'post_event' }),
    ]);
    expect(r.count).toBe(1);
    expect(r.html).toContain('/events/in');
    expect(r.html).not.toContain('/events/elsewhere');
    expect(r.html).not.toContain('/events/over');
    expect(r.areas.map((a) => a.cell)).toEqual([CELL]);
  });

  test('an event without a place is not drawn, and the map carries no text list of places', () => {
    const html = zoomed([ev('a'), ev('nowhere', { lat: null, lon: null })]).html;
    // The event cards below the map are the list (owner, 2026-11-17).
    expect(html).not.toContain('data-testid="amap-unplaced"');
    expect(html).not.toContain('data-testid="amap-legend"');
    expect(html).not.toContain('data-testid="amap-legend-dot"');
    expect(html).not.toContain('data-testid="amap-place-link"');
    expect(html).not.toContain('/events/nowhere');
    expect(html).toContain('id="amap-places"');
  });

  test('names are escaped in the dot title and the list', () => {
    const html = zoomed([ev('a', { name: '<img src=x onerror=alert(1)>' })]).html;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('the way back is a 44 px link to the landing with the search kept', () => {
    const html = zoomed([ev('a')]).html;
    expect(html).toContain('<a class="amap-back" href="/?zip=60406" data-testid="amap-back">');
    expect(ZOOM_STYLE).toContain(
      '.amap-back,.amap-zoom{display:inline-flex;align-items:center;min-height:44px'
    );
  });

  test('an area with nothing upcoming says so, with the way back', () => {
    const r = zoomed([ev('over', { startDateISO: '2026-01-01', phase: 'post_event' })]);
    expect(r.state).toBe('thin');
    expect(r.areas).toEqual([]);
    expect(r.html).toContain('data-testid="amap-zoom-empty"');
    expect(r.html).toContain('data-testid="amap-back"');
  });

  test('streets are drawn only when they were drawn for this one cell', () => {
    const yes = zoomed([ev('a')]).html;
    expect(yes).toContain('data-testid="amap-streets"');
    expect(yes).toContain('data-testid="amap-credit"');
    const no = zoomed([ev('a')], { streets: { ...streets(), cellsKey: cellsKey([OTHER]) } }).html;
    expect(no).not.toContain('data-testid="amap-streets"');
    expect(no).not.toContain('data-testid="amap-credit"');
    // Streets for another area are no street map for this one: no dots either.
    expect(no).not.toContain('data-testid="amap-dot"');
    expect(no).toContain('data-testid="amap-no-tiles"');
  });

  test('the caption says what the dots mean, in English and Spanish', () => {
    expect(zoomed([ev('a')]).html).toContain('a pale dot marks only its block');
    expect(zoomed([ev('a')], { lang: 'es' }).html).toContain('un punto claro marca solo su cuadra');
  });
});

// OSE-1889: two dots nearer than two touch targets overlap, and one of them
// cannot be tapped. They are one place.
describe('dots too near to tap apart are one place', () => {
  // One block north is nearer than two hit radii; 0.01 of latitude is not.
  const next = { lat: RIPH.lat + 0.003, lon: RIPH.lon };
  const far = { lat: RIPH.lat + 0.01, lon: RIPH.lon };

  test('the fixtures: the next block is a different block, nearer than two hit radii', () => {
    expect(latLngToCell(next.lat, next.lon, 9)).not.toBe(latLngToCell(RIPH.lat, RIPH.lon, 9));
    const here = xyOf(RIPH.lat, RIPH.lon);
    expect(apart(here, xyOf(next.lat, next.lon))).toBeLessThan(DOT_MERGE);
    expect(apart(here, xyOf(far.lat, far.lon))).toBeGreaterThanOrEqual(DOT_MERGE);
  });

  test('sunny: two near blocks share one numbered place, at the first block centre', () => {
    const { dots } = mapDots(CELL, [ev('south'), ev('north', next)]);
    expect(dots).toHaveLength(1);
    expect(dots[0]!.n).toBe(1);
    // Reading order: the northern block is first, and the place stays on it.
    expect(dots[0]!.events.map((e) => e.id)).toEqual(['north', 'south']);
    expect([dots[0]!.lat, dots[0]!.lng]).toEqual(cellToLatLng(latLngToCell(next.lat, next.lon, 9)));
    const html = zoomed([ev('south'), ev('north', next)]).html;
    expect(html.match(/data-testid="amap-dot"/g)).toHaveLength(1);
    expect(html).toMatch(/data-testid="amap-dot" data-exact="1" data-count="2"/);
    expect(html.match(/data-testid="amap-panel"/g)).toHaveLength(1);
  });

  test('rainy: blocks two hit radii apart or more stay separate places', () => {
    const { dots } = mapDots(CELL, [ev('south'), ev('north', far)]);
    expect(dots.map((d) => d.events.map((e) => e.id))).toEqual([['north'], ['south']]);
  });

  test('edge: a merged place is marked as a business only when every event in it is one', () => {
    const mixed = mapDots(CELL, [ev('biz'), ev('home', { place_kind: 'address', ...next })]).dots;
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.exact).toBe(false);
    // The pale block joins a business that comes first in reading order, too.
    const other = mapDots(CELL, [ev('home', { place_kind: 'address' }), ev('biz', next)]).dots;
    expect(other).toHaveLength(1);
    expect(other[0]!.exact).toBe(false);
  });

  test('edge: an event on every block of the area: no two touch targets overlap, no event is lost', () => {
    const events = cellToChildren(CELL, 9).map((block, i) => {
      const [lat, lon] = cellToLatLng(block);
      return ev(`e${i}`, { lat, lon });
    });
    const { dots, unplaced } = mapDots(CELL, events);
    expect(unplaced).toEqual([]);
    expect(dots.flatMap((d) => d.events.map((e) => e.id)).sort()).toEqual(
      events.map((e) => String(e.id)).sort()
    );
    expect(dots.length).toBeGreaterThan(1);
    expect(dots.length).toBeLessThan(events.length);
    expect(dots.map((d) => d.n)).toEqual(dots.map((_, i) => i + 1));
    const at = dots.map((d) => project(frame(), d.lat, d.lng));
    for (let i = 0; i < at.length; i += 1) {
      for (let j = i + 1; j < at.length; j += 1) {
        expect(apart(at[i]!, at[j]!), `${i + 1} and ${j + 1}`).toBeGreaterThanOrEqual(DOT_MERGE);
      }
    }
    // Every place is still a res-9 block centre, never a point between blocks.
    for (const d of dots) {
      expect([d.lat, d.lng]).toEqual(cellToLatLng(latLngToCell(d.lat, d.lng, 9)));
    }
  });
});

// OSE-1894 (owner 2026-11-09, merged decision 6): no street tiles, no floating
// dots. Staging and production have no MAP_TILES binding today.
describe('no street map: the places are a list, with their panels', () => {
  const far = { lat: RIPH.lat + 0.01, lon: RIPH.lon };
  const bare = (events: ZoomEvent[], extra: Record<string, unknown> = {}) =>
    zoomed(events, { streets: null, origin: 'https://stg.example', ...extra });

  test('rainy: no dot map is drawn: no svg, no outline, no dot, and it says why', () => {
    const r = bare([ev('a'), ev('b', far)]);
    expect(r.state).toBe('map');
    expect(r.count).toBe(2);
    expect(r.html).toContain(`data-zoom="${CELL}"`);
    expect(r.html).not.toContain('<svg');
    expect(r.html).not.toContain('<circle');
    expect(r.html).not.toContain('data-testid="amap-dot"');
    expect(r.html).not.toContain('data-testid="amap-zone"');
    expect(r.html).not.toContain('data-testid="amap-credit"');
    expect(r.html).toContain(
      '<div class="map-placeholder" data-testid="amap-no-tiles" role="status"><p><strong>The street map for this area is not here yet.</strong>'
    );
    expect(zoomed([ev('a')]).html).not.toContain('amap-no-tiles');
  });

  test('sunny: no text list of places is drawn, and the panels are all there', () => {
    const html = bare([ev('a'), ev('b', far)]).html;
    for (const n of [1, 2]) {
      expect(html).toContain(
        `<span class="amap-t" id="amap-dot-${n}"></span><section class="amap-p`
      );
    }
    expect(html).not.toContain('data-testid="amap-legend"');
    expect(html).not.toContain('data-testid="amap-legend-dot"');
    expect(html).not.toContain('data-testid="amap-place-link"');
    expect(html.match(/data-testid="amap-panel"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="amap-open"');
    expect(html).toContain('data-testid="share-btn"');
    expect(html).toContain('data-testid="amap-back"');
  });

  test('sunny: with a street map the dots open the panels, and no list row does', () => {
    const html = zoomed([ev('a'), ev('b', far)]).html;
    expect(html).not.toContain('data-testid="amap-place-link"');
    expect(html).toMatch(/<a href="#amap-dot-2" class="[^"]*" data-testid="amap-dot"/);
  });

  // @born-red no-tiles note still sending people to the removed place list | method: old en, es and pl text put back, seen failing at the first language (en)
  test('edge: with no street map the note points at the event cards, not at a place list, in all four languages', () => {
    const note = (lang: string) =>
      /data-testid="amap-no-tiles" role="status"><p>(.*?)<\/p>/s.exec(
        bare([ev('a')], { lang }).html
      )![1]!;
    const want: Record<string, [string, RegExp]> = {
      en: ['Its events are listed below.', /Open a place|places are listed/],
      es: ['Sus eventos aparecen abajo.', /Abre un lugar|Sus lugares/],
      pl: ['Jego wydarzenia są wymienione poniżej.', /Otwórz miejsce|Jego miejsca/],
      ar: ['فعالياتها مذكورة أدناه.', /افتح مكانًا|أماكنها/],
    };
    for (const [lang, [has, gone]] of Object.entries(want)) {
      expect(note(lang), lang).toContain(has);
      expect(note(lang), lang).not.toMatch(gone);
    }
  });

  test('the caption speaks of places, not dots, in English and Spanish', () => {
    const caption = (html: string) => /<figcaption[^>]*>(.*?)<\/figcaption>/s.exec(html)![1]!;
    const en = caption(bare([ev('a')]).html);
    expect(en).toContain('listed by place. A place is a block, never a street address.');
    expect(en).not.toContain('dot');
    const named = caption(
      bare([ev('a', { where_address: '1 Main St, Blue Island, IL 60406' })]).html
    );
    expect(named).toContain('in this area (Blue Island) over the next');
    expect(named).toContain('listed by place.');
    const es = bare([ev('a')], { lang: 'es' }).html;
    expect(caption(es)).toContain('por lugar. Un lugar es una cuadra, nunca una dirección.');
    expect(caption(es)).not.toContain('punto');
    expect(es).toContain('El mapa de calles de esta zona todavía no está disponible.');
  });

  test('edge: the places and their numbers are the same with and without the street map', () => {
    const events = [ev('a'), ev('b', far), ev('c', { lat: RIPH.lat + 0.003, lon: RIPH.lon })];
    const ids = (html: string) =>
      [...html.matchAll(/data-testid="amap-panel" data-n="(\d+)"/g)].map((m) => m[1]);
    expect(ids(bare(events).html)).toEqual(ids(zoomed(events).html));
    expect(ids(bare(events).html)).toEqual(['1', '2']);
  });

  test('edge: the pills still filter each place panel by its events', () => {
    const html = bare([
      ev('a', { classes: ['type-bingo', 'when-month'] }),
      ev('nowhere', { lat: null, lon: null }),
    ]).html;
    expect(html).not.toContain('data-testid="amap-unplaced"');
    expect(html).toMatch(/<section class="amap-p amap-f type-bingo when-month"/);
  });

  test('never who: no coordinate reaches the page, and no link reaches tracking', () => {
    const html = bare([ev('a'), ev('b', far)]).html;
    expect(html).not.toContain(String(RIPH.lat));
    expect(html).not.toContain(String(RIPH.lon));
    for (const m of html.matchAll(/href="([^"]*)"/g)) {
      expect(m[1], m[1]).not.toMatch(/^\/(q|s|e|r|c)\//);
    }
  });

  test('the landing, zoomed with no street map: the list and panels, opened on the map view', () => {
    const area = renderLandingArea([{ ...ev('here'), template_id: 'trivia' }], {
      now: NOW,
      zoom: { cell: CELL, backHref: '/' },
      origin: 'https://stg.example',
    });
    expect(area.defaultView).toBe('map');
    expect(area.mapCells).toEqual([CELL]);
    expect(area.html).toContain('data-testid="amap-no-tiles"');
    expect(area.html).not.toContain('data-testid="amap-dot"');
    expect(area.html).toContain('data-testid="amap-panel"');
    expect(area.html).toContain('data-share-url="https://stg.example/events/here"');
    // No origin (no request): no Share button, and nothing else changes.
    const quiet = renderLandingArea([{ ...ev('here'), template_id: 'trivia' }], {
      now: NOW,
      zoom: { cell: CELL, backHref: '/' },
      origin: null,
    });
    expect(quiet.html).not.toContain('share-btn');
    expect(quiet.html).toContain('data-testid="amap-panel"');
  });
});

describe('the hexagons link to their areas', () => {
  // Two areas side by side. Far apart they are drawn too small to be links
  // (OSE-2084, "design budget" below).
  const items = [ev('a'), ev('b', { h3_res7: NEAR })];
  const href = (cell: string) => `/?zip=60406&area=${cell}`;

  test('with a zoom link, each hexagon and each list row opens its area', () => {
    const html = renderAttendeeMap(items, {
      now: NOW,
      area: { count: 10, min: 10 },
      zoomHref: href,
    }).html;
    for (const cell of [CELL, NEAR]) {
      // The map's own tooltip (lib/map-tip-script.ts) says what the <title> says.
      const tip = html.match(
        new RegExp(`data-cell="${cell}" data-count="1" data-tip="([^"]+)"`)
      )?.[1];
      expect(tip).toMatch(/^Area \d.*: 1 event$/);
      expect(html).toContain(`<title>${tip}</title>`);
      expect(html).toContain(
        `<g data-testid="amap-area" data-cell="${cell}" data-count="1" data-tip="${tip}"><a href="/?zip=60406&amp;area=${cell}" data-testid="amap-area-link">`
      );
      expect(html).toContain(
        `<a class="amap-zoom" href="/?zip=60406&amp;area=${cell}" data-testid="amap-zoom">Zoom in</a>`
      );
    }
    expect(html).toContain('Tap a hexagon to see its events on the map.');
  });

  test('without one (every other surface) the hexagons stay plain', () => {
    const html = renderAttendeeMap(items, { now: NOW, area: { count: 10, min: 10 } }).html;
    expect(html).not.toContain('amap-area-link');
    expect(html).not.toContain('amap-zoom');
    expect(html).not.toContain('Tap a hexagon');
  });
});

describe('the landing, zoomed', () => {
  const items = [
    { ...ev('here'), template_id: 'trivia' },
    { ...ev('there', { h3_res7: OTHER, lat: 41.88, lon: -87.63 }), template_id: 'bingo' },
  ];

  test("lists only the area's events and opens on its map", () => {
    const area = renderLandingArea(items, {
      now: NOW,
      zoom: { cell: CELL, backHref: '/' },
      zoomHref: (c) => `/?area=${c}`,
    });
    expect(area.defaultView).toBe('map');
    expect(area.mapCells).toEqual([CELL]);
    expect(area.html).toContain('/events/here');
    expect(area.html).not.toContain('/events/there');
    expect(area.html).toContain(`data-zoom="${CELL}"`);
  });

  test('the category, window and where pills hide the dots and rows as they hide the cards', () => {
    // Two categories in the area, so the category pills are offered.
    const typeCategories = new Map([
      ['etr-art-music', { code: 'ART', name: 'Arts', order: 50 }],
      ['etr-biz-mixer', { code: 'BIZ', name: 'Business', order: 80 }],
    ]);
    const area = renderLandingArea(
      [
        { ...ev('here'), event_type_id: 'etr-art-music' },
        { ...ev('two'), event_type_id: 'etr-biz-mixer' },
      ],
      { now: NOW, zoom: { cell: CELL, backHref: '/' }, typeCategories, streets: streets() }
    );
    expect(area.html).toContain(
      '#cat-art:checked ~ .area .event-card:not(.cat-art),#cat-art:checked ~ .area .amap-f:not(.cat-art){display:none}'
    );
    // Each dot carries its events' category class, so the rule reaches it.
    expect(area.html).toMatch(
      /<a [^>]*class="[^"]*amap-f[^"]*cat-art[^"]*"[^>]*data-testid="amap-dot"/
    );
    expect(area.html).toContain('#win-week:checked ~ .area .amap-f:not(.when-week){display:none}');
  });

  test("an area with none of the page's events says so, with the way back", () => {
    const area = renderLandingArea(items, {
      now: NOW,
      zoom: { cell: latLngToCell(40.7, -74, 7), backHref: '/?zip=60406' },
    });
    expect(area.html).toContain('data-testid="amap-zoom-empty"');
    expect(area.html).toContain('href="/?zip=60406"');
    expect(area.mapCells).toEqual([]);
    // It opens on the map, with no category pills to offer.
    expect(area.defaultView).toBe('map');
    expect(area.leadsWithMap).toBe(true);
    expect(area.categories).toEqual([]);
  });
});

describe('the ?area= parameter', () => {
  const read = (q: string) => landingZoom(new URL(`https://t.test/${q}`), '/');

  test('a res-7 cell zooms; anything else is ignored', () => {
    expect(read(`?area=${CELL}`).cell).toBe(CELL);
    expect(read(`?area=${CELL.toUpperCase()}`).cell).toBe(CELL);
    for (const v of [
      latLngToCell(RIPH.lat, RIPH.lon, 9),
      cellToParent(CELL, 5), // a coarser area; derived, so no latLngToCell at an unlisted res (geo-invariant G5)
      'x',
      '41.6,-87.6',
      '',
    ]) {
      expect(read(`?area=${encodeURIComponent(v)}`).cell, v).toBeNull();
    }
    expect(landingZoom(null, '/').cell).toBeNull();
  });

  test('fat fingers: a padded, spaced, cut, foreign-script or wrong-size cell never zooms', () => {
    // h3-js reads a cell as hex, so `00` + a cell is still "valid" to it. Taken as
    // is, the page zoomed on a string no event row holds ("nothing upcoming") and
    // echoed it, at any length, into every link.
    const fullwidth = [...CELL]
      .map((c) => (/[0-9]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c))
      .join('');
    for (const v of [
      `0${CELL}`,
      `00${CELL}`,
      `${'0'.repeat(2000)}${CELL}`,
      ` ${CELL}`,
      `${CELL} `,
      `${CELL}	`,
      `${CELL}
`,
      `${CELL}​`,
      `0x${CELL}`,
      CELL.slice(0, -1),
      `${CELL}${'f'.repeat(5000)}`,
      fullwidth,
      cellToParent(CELL, 6),
      cellToChildren(CELL, 8)[0]!,
    ]) {
      const z = read(`?area=${encodeURIComponent(v)}`);
      expect(z.cell, JSON.stringify(v.slice(0, 40))).toBeNull();
    }
    // `+` in a query is a space: `?area=+<cell>` is a spaced cell, not a cell.
    expect(read(`?area=+${CELL}`).cell).toBeNull();
    // The parameter name is exact, and with two the first is the one read.
    expect(read(`?AREA=${CELL}`).cell).toBeNull();
    expect(read(`?area=${CELL}&area=x`).cell).toBe(CELL);
    expect(read(`?area=x&area=${CELL}`).cell).toBeNull();
  });

  test('links keep the search and nothing else', () => {
    const z = read(`?zip=60406&where=Blue+Island&nozip=1&area=${CELL}&evil=<b>&utm=1`);
    expect(z.href()).toBe('/?where=Blue+Island&zip=60406&nozip=1');
    expect(z.href(OTHER)).toBe(`/?where=Blue+Island&zip=60406&nozip=1&area=${OTHER}`);
    expect(landingZoom(new URL('https://t.test/es/'), '/es/').href(CELL)).toBe(`/es/?area=${CELL}`);
    expect(landingZoom(null, '/').href()).toBe('/');
  });
});

describe('design budget', () => {
  test('the zoom style is one block under 400 characters, tokens only', () => {
    expect(ZOOM_STYLE.length).toBeLessThanOrEqual(400);
    expect(MAP_STYLE.length).toBeLessThanOrEqual(400);
    expect(ZOOM_STYLE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(ZOOM_STYLE.match(/<style>/g)).toHaveLength(1);
  });

  // What a narrow screen changes, read out of the style that ships
  // (lib/map-narrow-style.ts). The page's side gutters are 40 px in all, so a
  // 320 px phone has a 280 px map, and from 480 px, where the rule ends, the map
  // is 440 px or more. That gutter, and that a browser obeys the rule, are seen
  // in tests/e2e/2-pages/street-map-sizes.component.spec.ts.
  const narrow = {
    under: Number(/@media\(max-width:(\d+)px\)/.exec(NARROW_MAP_STYLE)![1]) + 1,
    ratio: /\.amap\[data-zoom\] svg\{aspect-ratio:(\d+)\/(\d+)\}/.exec(NARROW_MAP_STYLE)!,
    dotNumber: Number(/\.amap-dn\{font-size:(\d+)px\}/.exec(NARROW_MAP_STYLE)![1]),
    names: Number(/\.as-t,\.amap-num\{font-size:(\d+)px\}/.exec(NARROW_MAP_STYLE)![1]),
  };
  const GUTTER = 40;
  /** The map units the taller box shows across: 4 by 3 of a 360-unit-high drawing. */
  const SHOWN = (MAP_H * Number(narrow.ratio[1])) / Number(narrow.ratio[2]);
  /** Screen px to a map unit: the narrowest phone, and the first width past the rule. */
  const PHONE = (320 - GUTTER) / MAP_W;
  const WIDE = (narrow.under - GUTTER) / MAP_W;
  /** The same on the narrowest phone, for the zoomed area in its taller box. */
  const PHONE_ZOOMED = (320 - GUTTER) / SHOWN;
  const two = () => [ev('a'), ev('b', { h3_res7: OTHER, lat: 41.88, lon: -87.63 })];

  test('the narrow style is one block under 400 characters, one rule, no colour', () => {
    expect(NARROW_MAP_STYLE).toBe(
      '<style>@media(max-width:479px){.amap[data-zoom] svg{aspect-ratio:4/3}.amap[data-tall] svg{aspect-ratio:1/1}.amap-dn{font-size:23px}.as-t,.amap-num{font-size:28px}}</style>'
    );
    expect(NARROW_MAP_STYLE.length).toBeLessThanOrEqual(400);
    expect(NARROW_MAP_STYLE.match(/<style>/g)).toHaveLength(1);
    expect(NARROW_MAP_STYLE).not.toMatch(/var\(|#[0-9a-f]{3,8}\b|fill|stroke|color/i);
    expect(narrow.under).toBe(480);
    expect(SHOWN).toBe(480);
  });

  test('the zoomed map is cut at its sides, not shrunk, in a taller box; a landing map with areas far apart is not', () => {
    expect(zoomed([ev('a')]).html).toContain(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid slice" role="group" `
    );
    // Two areas far apart are too small to be links in either box, so the
    // landing's own map keeps its whole frame (the taller box: OSE-2084, below).
    const landing = renderAttendeeMap(two(), {
      now: NOW,
      area: { count: 10, min: 10 },
      zoomHref: (c) => `/?area=${c}`,
    }).html;
    expect(landing).toContain(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W} ${MAP_H}" role="img" `
    );
    expect(landing).not.toContain('preserveAspectRatio');
    // The narrow style comes after the other blocks, so its sizes are the ones used.
    expect(landing).toContain(`${MAP_STYLE}${ZOOM_STYLE}${NARROW_MAP_STYLE}${TIP_STYLE}\n`);
    const plain = renderAttendeeMap(two(), { now: NOW, area: { count: 10, min: 10 } }).html;
    expect(plain).toContain(`${MAP_STYLE}${NARROW_MAP_STYLE}${TIP_STYLE}\n`);
  });

  test('what the taller box shows holds the whole area and every dot target', () => {
    const left = (MAP_W - SHOWN) / 2;
    const r = Number(/class="amap-hit" [^>]*r="(\d+)"/.exec(zoomed([ev('a')]).html)![1]);
    // Chicago, the equator, a high latitude and the south: the hexagon turns with the place.
    for (const [lat, lng] of [
      [RIPH.lat, RIPH.lon],
      [0.1, 0.1],
      [64.84, -147.72],
      [-33.87, 151.21],
    ] as const) {
      const cell = latLngToCell(lat, lng, 7);
      const f = frameForCells([cell], MAP_W, MAP_H);
      const xs = cellToBoundary(cell).map(([a, b]) => project(f, a, b)[0]);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(left);
      expect(Math.max(...xs)).toBeLessThanOrEqual(MAP_W - left);
      // A dot sits at the centre of the block its place is in. A place is in
      // the area by where it is, and a block on the area's edge can belong to
      // the area next door, so every block with a corner or its centre in this
      // area counts, whichever area it belongs to. Its whole target shows.
      const blocks = gridDisk(cell, 1)
        .flatMap((c) => cellToChildren(c, 9))
        .filter((block) =>
          [cellToLatLng(block), ...cellToBoundary(block)].some(
            ([a, b]) => latLngToCell(a, b, 7) === cell
          )
        )
        .map((block) => project(f, ...cellToLatLng(block))[0]);
      expect(blocks.length).toBeGreaterThan(49);
      expect(Math.min(...blocks) - r).toBeGreaterThanOrEqual(left);
      expect(Math.max(...blocks) + r).toBeLessThanOrEqual(MAP_W - left);
    }
  });

  test("a dot's touch target is at least 44 px on the narrowest phone and at every width above it", () => {
    const html = zoomed([ev('a')]).html;
    const r = Number(/class="amap-hit" [^>]*r="(\d+)"/.exec(html)![1]);
    // 320 px: the zoomed area is in its taller box. On the whole frame the same
    // target is under 44 px there, which is what a browser showed (36.4 px).
    expect(2 * r * PHONE_ZOOMED).toBeGreaterThanOrEqual(44);
    expect(2 * r * PHONE).toBeLessThan(44);
    // 480 px, where the rule ends and the whole frame is back.
    expect(2 * r * WIDE).toBeGreaterThanOrEqual(44);
    // Two targets that do not overlap are two radii apart: the merge distance.
    expect(DOT_MERGE).toBe(2 * r);
    // The target is invisible but still takes the tap (a fill of none would not).
    expect(html).toMatch(/<circle class="amap-hit" [^>]*fill-opacity="0"\/>/);
  });

  // The landing's hexagon links (OSE-2084). Seen on staging on 2026-11-15: ten
  // areas, each hexagon 62 by 60 units, so 29 by 28 px on a 320 px phone and 35
  // by 34 px at 375 px, and the nightly phone audit red since 2026-11-10.
  const STAGING_AREAS = [
    '87266452bffffff',
    '872664544ffffff',
    '872664cdcffffff',
    '872664574ffffff',
    '872664cdaffffff',
    '872664529ffffff',
    '872664572ffffff',
    '87266450cffffff',
    '87266450dffffff',
    '872664cd8ffffff',
  ];
  // The area the staging fixture adds (bruno/fixtures/map-zoom-area-seed.sql).
  const FIXTURE_AREA = '872664405ffffff';
  // Eight areas, all in the middle of the frame, drawn 58 units across: a 44 px
  // target in the taller box on a phone, and under it at 480 px on the whole frame.
  const BETWEEN_FLOORS = [
    '87266455cffffff',
    '872664572ffffff',
    '872664563ffffff',
    '872664555ffffff',
    '87266454cffffff',
    '87266455dffffff',
    '872664566ffffff',
    '872664540ffffff',
  ];
  const landingOver = (cells: readonly string[]) =>
    renderAttendeeMap(
      cells.map((c, i) => ev(`s${i}`, { h3_res7: c })),
      { now: NOW, area: { count: 10, min: 10 }, zoomHref: (c) => `/?area=${c}` }
    ).html;
  /** Each step of the link style: its number and the screen width it starts at. */
  const steps = [
    ...LINK_STYLE.matchAll(
      /@media\(min-width:(\d+)px\)\{\.amap-w(\d)\{display:inline\}\.amap-n\2\{display:none\}\}/g
    ),
  ].map((m) => ({ step: Number(m[2]), from: Number(m[1]) }));
  const boxOf = (points: string) => {
    const pts = points.split(' ').map((p) => p.split(',').map(Number));
    const xs = pts.map((p) => p[0]!);
    const ys = pts.map((p) => p[1]!);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  /**
   * The landing map as a screen `width` px wide draws it, read out of the page
   * and the styles that ship: the hexagon links on show, each one's smaller
   * side in px, and whether the plain hexagons are on show.
   */
  function onScreen(html: string, width: number) {
    const tallBox = /\.amap\[data-tall\] svg\{aspect-ratio:(\d+)\/(\d+)\}/.exec(NARROW_MAP_STYLE);
    const tall =
      /<figure class="amap" data-testid="amap" data-tall>/.test(html) &&
      width < narrow.under &&
      !!tallBox;
    // Map units across the map: the whole frame, or the middle of it in the taller box.
    const shown = tall ? (MAP_H * Number(tallBox![1])) / Number(tallBox![2]) : MAP_W;
    const scale = Math.min(width - GUTTER, 720) / shown;
    const links = [
      ...html.matchAll(
        /<a (?:class="amap-w(\d)" )?href="[^"]*" data-testid="amap-area-link">.*?<polygon class="amap-cell" points="([^"]+)"/g
      ),
    ]
      // A link with a step is on show from that step's width; without one, always.
      .filter((m) => !m[1] || width >= steps.find((s) => s.step === Number(m[1]))!.from)
      .map((m) => {
        const b = boxOf(m[2]!);
        return Math.min(b.x1 - b.x0, b.y1 - b.y0) * scale;
      });
    const plainStep = /<g class="amap-n(\d)">/.exec(html)?.[1];
    const plain = plainStep
      ? width < steps.find((s) => s.step === Number(plainStep))!.from
      : !html.includes('amap-area-link');
    return { tall, shown, links, plain };
  }
  // Every width a rule starts or ends at, one px either side, a phone and a desktop.
  const WIDTHS = [320, 375, 479, 480, 639, 640, 759, 760, 1280];
  const layouts = () => ({
    staging: landingOver(STAGING_AREAS),
    stagingWithFixture: landingOver([...STAGING_AREAS, FIXTURE_AREA]),
    two: landingOver([CELL, NEAR]),
    one: landingOver([CELL]),
    seven: landingOver(gridDisk(CELL, 1)),
    nineteen: landingOver(gridDisk(CELL, 2)),
    thirtySeven: landingOver(gridDisk(CELL, 3)),
    betweenFloors: landingOver(BETWEEN_FLOORS),
    farApart: landingOver([CELL, OTHER]),
  });

  test('the link style is one block under 400 characters, three steps, no colour', () => {
    expect(LINK_STYLE).toBe(
      '<style>.amap-w1,.amap-w2,.amap-w3{display:none}@media(min-width:480px){.amap-w1{display:inline}.amap-n1{display:none}}@media(min-width:640px){.amap-w2{display:inline}.amap-n2{display:none}}@media(min-width:760px){.amap-w3{display:inline}.amap-n3{display:none}}</style>'
    );
    expect(LINK_STYLE.length).toBeLessThanOrEqual(400);
    expect(LINK_STYLE.match(/<style>/g)).toHaveLength(1);
    expect(LINK_STYLE).not.toMatch(/var\(|#[0-9a-f]{3,8}\b|fill|stroke|color/i);
    // The widths the renderer counts with are the widths the style switches at.
    expect(steps).toEqual(LINK_FROM_PX.map((from, i) => ({ step: i + 1, from })));
    // The first step starts where the narrow rule ends: no width is under both.
    expect(steps[0]!.from).toBe(narrow.under);
    expect(MAP_GUTTER_PX).toBe(GUTTER);
  });

  test('a hexagon link on show is a 44 px touch target, at every width', () => {
    for (const [name, html] of Object.entries(layouts())) {
      for (const width of WIDTHS) {
        const m = onScreen(html, width);
        for (const px of m.links) {
          expect(px, `${name}, ${width} px: a hexagon link`).toBeGreaterThanOrEqual(44);
        }
        // Links or plain hexagons, never both and never neither.
        expect(m.links.length > 0, `${name}, ${width} px: links or plain`).toBe(!m.plain);
      }
    }
    // A hexagon carries no larger invisible target: next to another area it
    // would lie over the neighbour and take its taps.
    expect(layouts().staging).not.toContain('amap-hit');
  });

  test('hexagons are links from the narrowest screen that makes them 44 px, and not below it', () => {
    const maps = layouts();
    /** The narrowest of WIDTHS at which the hexagons are links, and how many are. */
    const from = (html: string) => {
      const width = WIDTHS.find((w) => onScreen(html, w).links.length > 0);
      return width ? [width, onScreen(html, width).links.length] : null;
    };
    // Large enough on the whole frame, or in the taller box a phone draws.
    expect(from(maps.one)).toEqual([320, 1]);
    expect(from(maps.two)).toEqual([320, 2]);
    expect(from(maps.seven)).toEqual([320, 7]);
    expect(from(maps.staging)).toEqual([320, 10]);
    expect(from(maps.nineteen)).toEqual([320, 19]);
    for (const html of [maps.one, maps.two, maps.seven, maps.staging, maps.nineteen]) {
      // Drawn once: no second copy, no step, no link style.
      expect(html).not.toMatch(/amap-w\d|amap-n\d/);
      expect(html).not.toContain(LINK_STYLE);
    }
    // Staging while its fixture is loaded (eleven areas, 45 by 44 units), and
    // thirty-seven areas: links on a wide screen only, plain hexagons under it.
    expect(from(maps.stagingWithFixture)).toEqual([760, 11]);
    expect(from(maps.thirtySeven)).toEqual([640, 37]);
    // 58 units: the taller box would do for a phone, and leave 43 px at 480 px.
    // So no taller box, and links from the width that makes them 44 px.
    expect(from(maps.betweenFloors)).toEqual([640, 8]);
    expect(onScreen(maps.betweenFloors, 320).tall).toBe(false);
    expect((58.07 * (320 - GUTTER)) / MAP_H).toBeGreaterThanOrEqual(44);
    expect(58.07 * WIDE).toBeLessThan(44);
    expect(maps.stagingWithFixture).toContain(LINK_STYLE);
    expect(onScreen(maps.stagingWithFixture, 759)).toMatchObject({ links: [], plain: true });
    // Two areas far apart (31 units): 37 px on the widest map, so never links.
    expect(from(maps.farApart)).toBeNull();
    expect(maps.farApart).not.toContain('amap-area-link');
    expect(maps.farApart).not.toContain(LINK_STYLE);
    // Staging's hexagons on the whole frame, which is why the taller box exists.
    expect(60.24 * PHONE).toBeLessThan(44);
  });

  test('a hexagon drawn as a link and plain is the same drawing twice, one address', () => {
    const html = landingOver([...STAGING_AREAS, FIXTURE_AREA]);
    const twice = [
      ...html.matchAll(
        /<g data-testid="amap-area" data-cell="([0-9a-f]{15})" data-count="1" data-tip="[^"]+"><a class="amap-w3" href="\/\?area=([0-9a-f]{15})" data-testid="amap-area-link">(.*?)<\/a><g class="amap-n3">(.*?)<\/g><\/g>/g
      ),
    ];
    expect(twice).toHaveLength(11);
    for (const m of twice) {
      expect(m[2]).toBe(m[1]);
      expect(m[4]).toBe(m[3]);
      expect(m[3]).toContain('<polygon class="amap-cell" ');
    }
  });

  test('the taller box on a phone cuts no area, and the svg is cut at its sides, not shrunk', () => {
    const html = landingOver(STAGING_AREAS);
    expect(onScreen(html, 320)).toMatchObject({ tall: true, shown: MAP_H });
    expect(onScreen(html, 479).tall).toBe(true);
    expect(onScreen(html, 480)).toMatchObject({ tall: false, shown: MAP_W });
    // Its hexagons are links, so the drawing is a group (OSE-2112).
    expect(html).toContain(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid slice" role="group" `
    );
    const left = (MAP_W - MAP_H) / 2;
    const cells = [...html.matchAll(/<polygon class="amap-cell" points="([^"]+)"/g)].map((m) =>
      boxOf(m[1]!)
    );
    expect(cells).toHaveLength(10);
    for (const b of cells) {
      expect(b.x0).toBeGreaterThanOrEqual(left);
      expect(b.x1).toBeLessThanOrEqual(MAP_W - left);
    }
    // Areas in a line east to west reach past the middle of the frame: the box
    // would cut them, so the map keeps its whole frame and its usual shape.
    const [lat, lng] = cellToLatLng(CELL);
    const line = [-0.12, -0.06, 0, 0.06, 0.12].map((d) => latLngToCell(lat, lng + d, 7));
    expect(new Set(line).size).toBe(5);
    const wide = landingOver(line);
    expect(wide).not.toContain('preserveAspectRatio');
    expect(wide).toContain('<figure class="amap" data-testid="amap">');
    // Five in a line are 65 units: links from 480 px, where the whole frame makes them 44 px.
    expect(WIDTHS.find((w) => onScreen(wide, w).links.length > 0)).toBe(480);
    expect(onScreen(wide, 480).links).toHaveLength(5);
    expect(wide).toContain('<a class="amap-w1" href=');
    // Hexagons already 44 px on the whole frame keep it: one area, or seven.
    for (const cells of [[CELL], gridDisk(CELL, 1)]) {
      const large = landingOver(cells);
      expect(large).toContain('<figure class="amap" data-testid="amap">');
      expect(large).not.toContain('preserveAspectRatio');
    }
    // Nor is the box used where it would not make a hexagon a link on a phone.
    expect(landingOver([...STAGING_AREAS, FIXTURE_AREA])).not.toContain('preserveAspectRatio');
  });

  test("the taller box cuts no area's name either, on the left or on the right", () => {
    // Three areas, 83 units across, all in the middle of the frame: the one on
    // the left has its middle at 171 units, the one on the right at 429. A name
    // is drawn under an area's number, centred, as wide as its letters.
    const LEFT = '872664570ffffff';
    const MIDDLE = '87266456affffff';
    const RIGHT = '872664561ffffff';
    const over = (named: Record<string, string>) =>
      renderAttendeeMap(
        [LEFT, MIDDLE, RIGHT].map((c, i) =>
          ev(`n${i}`, {
            h3_res7: c,
            ...(named[c] ? { where_address: `1 Main St, ${named[c]}, IL 60008` } : {}),
          })
        ),
        { now: NOW, area: { count: 10, min: 10 }, zoomHref: (c) => `/?area=${c}` }
      ).html;
    const TALL = '<figure class="amap" data-testid="amap" data-tall>';
    const WHOLE = '<figure class="amap" data-testid="amap">';
    const LONG = 'Rolling Meadowsville';
    // No name, or a short one: the square box holds everything.
    expect(over({})).toContain(TALL);
    expect(over({ [LEFT]: 'Posen', [RIGHT]: 'Posen' })).toContain(TALL);
    // A long name (cut to 16 letters, 144 units either side of the middle)
    // reaches past the box on that side only: the map keeps its whole frame.
    for (const cell of [LEFT, RIGHT]) {
      const html = over({ [cell]: LONG });
      expect(html).toContain('data-testid="amap-area-name">Rolling Meadows…</tspan>');
      expect(html).toContain(WHOLE);
      expect(html).not.toContain('preserveAspectRatio');
    }
  });

  test('"Tap a hexagon" is said only where a hexagon is a link; the list always links every area', () => {
    const maps = layouts();
    const TAP = 'Tap a hexagon to see its events on the map.';
    expect(maps.staging).toContain(`never a street address. ${TAP}</figcaption>`);
    // On show with the links, from the same width.
    expect(maps.stagingWithFixture).toContain(
      `never a street address. <span class="amap-w3" data-testid="amap-tap">${TAP}</span></figcaption>`
    );
    expect(maps.farApart).not.toContain('Tap a hexagon');
    // Every area keeps its way in on every screen: the 44 px "Zoom in" link in the list.
    for (const [html, cells] of [
      [maps.stagingWithFixture, [...STAGING_AREAS, FIXTURE_AREA]],
      [maps.farApart, [CELL, OTHER]],
    ] as const) {
      for (const c of cells) {
        expect(html).toContain(
          `<a class="amap-zoom" href="/?area=${c}" data-testid="amap-zoom">Zoom in</a>`
        );
      }
    }
    expect(ZOOM_STYLE).toContain(
      '.amap-zoom{display:inline-flex;align-items:center;min-height:44px'
    );
  });

  test("an outlined panel button's hover keeps its accent text readable", () => {
    // Seen in a browser (2026-11-09): the filled button's hover, the accent
    // itself, went under the outlined buttons' accent text. On a phone a hover
    // stays after the tap, so Share turned unreadable once pressed.
    expect(PLACE_PANEL_CSS).toContain(
      '.event-card .amap-acts .cta-secondary:hover { background: var(--surface-hover); }'
    );
    expect(PLACE_PANEL_CSS).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  test('no text on the map is under 13 px, on the narrowest phone or where the narrow rule ends', () => {
    const px = (style: string, rule: RegExp) => Number(rule.exec(style)![1]);
    const dotNumber = px(ZOOM_STYLE, /\.amap-dn\{[^}]*font:700 (\d+)px system-ui/);
    const townName = px(STREET_STYLE, /\.as-t\{[^}]*font:600 (\d+)px system-ui/);
    const areaNumber = px(MAP_STYLE, /\.amap-num\{[^}]*font:700 (\d+)px system-ui/);
    // From 480 px: the sizes the three blocks set, on the whole frame.
    for (const units of [dotNumber, townName, areaNumber]) {
      expect(units * WIDE).toBeGreaterThanOrEqual(13);
    }
    // Under 480 px: the sizes the narrow rule sets. A dot's number is only ever
    // on the zoomed map; names and area numbers are on the landing's own map too.
    expect(narrow.dotNumber * PHONE_ZOOMED).toBeGreaterThanOrEqual(13);
    expect(narrow.names * PHONE).toBeGreaterThanOrEqual(13);
    // The sizes they replace were under the floor there: that is why the rule exists.
    expect(dotNumber * PHONE_ZOOMED).toBeLessThan(13);
    expect(townName * PHONE).toBeLessThan(13);
    expect(areaNumber * PHONE).toBeLessThan(13);
  });

  test('a dot is wide enough for a two-digit number at either size it is set in', () => {
    const html = zoomed([ev('a')]).html;
    const r = Number(/class="amap-dot" [^>]*r="(\d+)"/.exec(html)![1]);
    const stroke = Number(/\.amap-dot\{[^}]*stroke-width:(\d+)/.exec(ZOOM_STYLE)![1]);
    // Two bold digits are about 1.2 of the font size wide.
    for (const units of [
      Number(/\.amap-dn\{[^}]*font:700 (\d+)px/.exec(ZOOM_STYLE)![1]),
      narrow.dotNumber,
    ]) {
      expect(1.2 * units).toBeLessThanOrEqual(2 * r - stroke);
    }
  });

  test('the area outline is neutral; the accent colour is for the dots alone', () => {
    // Design system README (2026-10-08): map cells are never the button colour.
    expect(ZOOM_STYLE).toContain(
      '.amap-zone{fill:var(--border-strong);fill-opacity:.06;stroke:var(--border-strong);stroke-width:3}'
    );
    expect(ZOOM_STYLE).toContain('.amap-dot{fill:var(--accent);');
    expect(/\.amap-zone\{[^}]*\}/.exec(ZOOM_STYLE)![0]).not.toContain('--accent');
  });
});

// ─── The place panels under the zoomed map (owner 2026-11-09; epic OSE-1880) ────
describe('the place panel under the map', () => {
  const far = { lat: RIPH.lat + 0.01, lon: RIPH.lon };
  const links = new Map([
    [
      'a',
      {
        shareCode: 'ABC234',
        links: [{ kind: 'donation', href: 'https://give.example/a?x=1&y=2' }],
      },
    ],
  ]);
  const panelled = (events: ZoomEvent[], extra: Record<string, unknown> = {}) =>
    zoomed(events, { placeLinks: links, origin: 'https://stg.example', ...extra }).html;
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);

  test('sunny: one panel per place, an h2 title, Prev and Next between them', () => {
    const html = panelled([ev('a', { venue: 'Harbor Lanes' }), ev('b', far)]);
    expect(html.match(/data-testid="amap-panel"/g)).toHaveLength(2);
    expect(html).not.toContain('<h1');
    expect(html).toMatch(/<h2 class="amap-ph" id="amap-ph-2">Place 2 · Harbor Lanes<\/h2>/);
    expect(html).toContain('at Harbor Lanes');
    expect(html).toMatch(/href="#amap-dot-2" data-testid="amap-next"/);
    expect(html).toMatch(/href="#amap-dot-1" data-testid="amap-prev"/);
    expect(html).toContain('href="#amap-places" data-testid="amap-all"');
    expect(html).toContain('id="amap-places"');
  });

  test('sunny: a card has Open event, Register, the organizer link and Share, in that order', () => {
    const html = panelled([ev('a')]);
    const acts = /<div class="amap-acts"[^>]*>(.*?)<\/div>/s.exec(html)![1]!;
    const order = [
      ...acts.matchAll(/data-testid="(amap-open|amap-register|amap-link|share-btn)"/g),
    ].map((m) => m[1]);
    expect(order).toEqual(['amap-open', 'amap-register', 'amap-link', 'share-btn']);
    expect(acts).toContain('href="/events/a"');
    expect(acts).toContain('href="/events/a/register"');
    expect(acts).toContain(
      'href="https://give.example/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer nofollow"'
    );
  });

  // @born-red Take me there | method: a coordinate passed to directionsUrls in lib/map-place-panel.ts, this file run (2 red), restored | date: 2026-11-18
  test('sunny: Take me there, in Google Maps and in Apple Maps, searches the address the event page shows (owner, 2026-11-18)', () => {
    const html = panelled([
      ev('a', {
        venue: 'Harbor Lanes',
        where_address: '13501 S Western Ave, Blue Island',
      } as Partial<ZoomEvent>),
    ]);
    const acts = /<div class="amap-acts"[^>]*>(.*?)<\/div>/s.exec(html)![1]!;
    const order = [
      ...acts.matchAll(/data-testid="(amap-register|amap-go-google|amap-go-apple|amap-link)"/g),
    ].map((m) => m[1]);
    // After the organizer's links, so Register keeps its place beside them.
    expect(order).toEqual(['amap-register', 'amap-link', 'amap-go-google', 'amap-go-apple']);
    const q = encodeURIComponent('13501 S Western Ave, Blue Island');
    expect(acts).toContain(
      `href="https://www.google.com/maps/search/?api=1&amp;query=${q}" target="_blank" rel="noopener noreferrer" data-testid="amap-go-google" aria-label="Take me there (Google Maps): directions to Event a (opens another site)">Take me there (Google Maps)</a>`
    );
    expect(acts).toContain(`href="https://maps.apple.com/?q=${q}" target="_blank"`);
    // The venue name when there is no street address.
    expect(panelled([ev('b', { venue: 'Harbor Lanes' })])).toContain(
      'href="https://maps.apple.com/?q=Harbor%20Lanes"'
    );
  });

  // @born-red OSE-2070 | method: aria-label put back to card.open ("Open Event a public page"), this runs red, restored | date: 2026-11-18
  test('WCAG 2.5.3: the name of Open event starts with the words on it, in each language', () => {
    const live = /<a [^>]*data-testid="amap-open"[^>]*>[^<]*<\/a>/.exec(panelled([ev('a')]))![0];
    expect(live).toContain('aria-label="Open event: Event a">Open event</a>');
    const es = /<a [^>]*data-testid="amap-open"[^>]*>[^<]*<\/a>/.exec(
      panelled([ev('a')], { lang: 'es' })
    )![0];
    expect(es).toContain('aria-label="Abrir el evento: Event a">Abrir el evento</a>');
  });

  test('never where: Take me there carries no coordinate; none when nothing says where, or once over', () => {
    // Only a point, no address or venue: no button, as the point stays off the page.
    const pointOnly = panelled([ev('a')]);
    expect(pointOnly).not.toContain('amap-go-');
    expect(pointOnly).not.toContain(String(RIPH.lat));
    const over = panelled([ev('a', { phase: 'post_event', venue: 'Harbor Lanes' })]);
    expect(over).not.toContain('amap-go-');
  });

  test('sunny: Share is the event page share: its /e/ code, else its page, and one script for all', () => {
    const html = panelled([ev('a'), ev('b', far)]);
    expect(html).toContain(
      'data-share-url="https://stg.example/e/ABC234" data-share-title="Event a"'
    );
    expect(html).toContain(
      'data-share-url="https://stg.example/events/b" data-share-title="Event b"'
    );
    expect(html.match(/<script data-testid="share-script">/g)).toHaveLength(1);
  });

  test('rainy: no origin (no request) means no Share button and no script; the panel still works', () => {
    const html = zoomed([ev('a')]).html;
    // The map's own zoom and tooltip scripts (lib/map-pan-script.ts,
    // lib/map-tip-script.ts) are the only scripts.
    expect(html.split(PAN_SCRIPT).join('').split(TIP_SCRIPT).join('')).not.toContain('<script');
    expect(html).not.toContain('share-btn');
    expect(html).toContain('data-testid="amap-open"');
  });

  test('never who: no map link reaches tracking or check-in, and no panel shows a count of people', () => {
    const html = panelled([ev('a'), ev('b', far)]);
    for (const h of hrefs(html)) {
      expect(h, h).not.toMatch(/^\/(q|s|e|r|c)\//);
      expect(h, h).not.toMatch(/checkin/);
    }
    expect(html).not.toMatch(/\d+ (going|registered|checked in|people)/i);
  });

  test('edge: a place with more events than a panel shows says how many are in the list', () => {
    const many = Array.from({ length: 14 }, (_, i) => ev(`e${i}`));
    const html = panelled(many);
    expect(html.match(/data-testid="amap-card"/g)).toHaveLength(12);
    expect(html).toContain('2 more here');
  });

  test('edge: a pill hides a panel card with its dot (the cards carry the filter classes)', () => {
    const html = panelled([ev('a', { classes: ['type-bingo', 'when-month'] })]);
    expect(html).toMatch(
      /<article class="event-card amap-f type-bingo when-month" data-testid="amap-card"/
    );
    expect(html).toMatch(/<section class="amap-p amap-f type-bingo when-month"/);
  });

  test('fat finger: a name with markup is escaped in the title, the card and the Share title', () => {
    const html = panelled([ev('x', { name: '<b>&"Q"', venue: '<i>Bar</i>' })]);
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>Bar');
    expect(html).toContain('data-share-title="&lt;b&gt;&amp;&quot;Q&quot;"');
  });

  test('the tapped place gets a ring: one generated rule per place, tokens only', () => {
    const html = panelled([ev('a'), ev('b', far)]);
    const css = /<style data-testid="amap-sel-css">(.*?)<\/style>/s.exec(html)![1]!;
    expect(css).toContain('.amap-wrap:has(#amap-dot-1:target) .amap-d1 .amap-dot');
    expect(css).toContain('.amap-wrap:has(#amap-dot-2:target) .amap-d2 .amap-dot');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b(?!:)/i);
  });
});

describe('the zoomed area, edge by edge', () => {
  const far = { lat: RIPH.lat + 0.01, lon: RIPH.lon };
  const back =
    '<p><a class="amap-back" href="/?zip=60406" data-testid="amap-back">Back to all areas</a></p>';
  const caption = (html: string) => /<figcaption[^>]*>(.*?)<\/figcaption>/s.exec(html)![1]!;

  test('an event with no name is untitled, a named one keeps its name, and no classes is none', () => {
    const { dots } = mapDots(CELL, [
      ev('a', { name: '' }),
      ev('b', { ...far, classes: undefined }),
    ]);
    expect(dots.map((d) => d.events)).toEqual([
      [{ id: 'b', name: 'Event b', classes: [] }],
      [{ id: 'a', name: 'Untitled event', classes: ['type-trivia', 'when-week'] }],
    ]);
  });

  test('only a res-9 cell id is placed: a res-7 or res-10 cell, text, a number, the cell as two halves or nothing are not', () => {
    const block = latLngToCell(RIPH.lat, RIPH.lon, 9);
    const { dots, unplaced } = mapDots(CELL, [
      ev('res7', { h3_res9: CELL }),
      ev('res10', { h3_res9: cellToChildren(block, 10)[0] }),
      ev('text', { h3_res9: 'not-a-cell' }),
      ev('number', { h3_res9: 617700169958293500 }),
      // A valid res-9 cell in h3-js's other form, two 32-bit halves: not the
      // cell id the server stores, so not a place (StrykerJS on blockOf).
      ev('halves', { h3_res9: h3IndexToSplitLong(block) }),
      ev('none', { h3_res9: null }),
    ]);
    expect(dots).toEqual([]);
    expect(unplaced.map((e) => e.id)).toEqual([
      'res7',
      'res10',
      'text',
      'number',
      'halves',
      'none',
    ]);
  });

  test('a block at the pole or on the date line is still a block, so it is placed', () => {
    const { dots, unplaced } = mapDots(CELL, [
      ev('pole', { lat: 90, lon: 0 }),
      ev('dateline', { lat: 0, lon: 180 }),
    ]);
    expect(unplaced).toEqual([]);
    expect(dots.flatMap((d) => d.events.map((e) => e.id)).sort()).toEqual(['dateline', 'pole']);
  });

  test('dots in one row are numbered left to right', () => {
    // Web Mercator stops near 85°, so two blocks that far north share one row.
    const { dots } = mapDots(CELL, [
      ev('east', { lat: 89, lon: 10 }),
      ev('west', { lat: 89, lon: -10 }),
    ]);
    expect(dots.map((d) => [d.n, d.events[0]!.id])).toEqual([
      [1, 'west'],
      [2, 'east'],
    ]);
  });

  test('one dot, written out in full: its link, title, touch target, dot and number', () => {
    const html = zoomed([ev('solo')]).html;
    const [x, y] = xyOf(RIPH.lat, RIPH.lon).map((v) => v.toFixed(1));
    // Its own point is its res-9 cell's centre (OSE-2198), never the event's.
    const ll = cellToLatLng(latLngToCell(RIPH.lat, RIPH.lon, 9))
      .map((v) => v.toFixed(5))
      .join(',');
    expect(html).toContain(
      `<a href="#amap-dot-1" class="amap-f amap-d1 type-trivia when-week" data-testid="amap-dot" data-exact="1" data-count="1" data-ll="${ll}" data-tip="Event solo">` +
        '<title>Event solo</title>' +
        `<circle class="amap-hit" cx="${x}" cy="${y}" r="39" fill-opacity="0"/>` +
        `<circle class="amap-dot" cx="${x}" cy="${y}" r="17"/>` +
        `<text class="amap-dn" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">1</text>` +
        '</a></svg>'
    );
  });

  test('the area outline is the cell boundary, point by point', () => {
    const ring = cellToBoundary(CELL)
      .map(([lat, lng]) => project(frame(), lat, lng))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    expect(zoomed([ev('a')]).html).toContain(
      `<polygon class="amap-zone" points="${ring}" data-testid="amap-zone" data-cell="${CELL}" data-ll="${cellToLatLng(
        CELL
      )
        .map((v) => v.toFixed(5))
        .join(',')}" data-name="1"/>`
    );
  });

  test('a shared dot is titled with its count; a pale one is marked; no classes, no stray space', () => {
    const html = zoomed([
      ev('a', { classes: [] }),
      ev('b', { classes: [] }),
      ev('n', { ...far, classes: [], place_kind: 'address' }),
    ]).html;
    const ll = (lat: number, lon: number) =>
      cellToLatLng(latLngToCell(lat, lon, 9))
        .map((v) => v.toFixed(5))
        .join(',');
    expect(html).toContain(
      `<a href="#amap-dot-1" class="amap-f amap-d1 amap-blk" data-testid="amap-dot" data-exact="0" data-count="1" data-ll="${ll(far.lat, far.lon)}" data-tip="Event n"><title>Event n</title>`
    );
    expect(html).toContain(
      `</a><a href="#amap-dot-2" class="amap-f amap-d2" data-testid="amap-dot" data-exact="1" data-count="2" data-ll="${ll(RIPH.lat, RIPH.lon)}" data-tip="Spot 2: 2 events"><title>Spot 2: 2 events</title>`
    );
    // No text list sits between the drawing and the caption, only the anchor.
    expect(html).not.toContain('data-testid="amap-legend-dot"');
    expect(html).toMatch(
      /<\/svg><div class="amap-ctl"[^>]*>.*?<\/div>\s*<span id="amap-places"[^>]*><\/span>\s*<figcaption id="amap-caption"/
    );
  });

  test('the way back, word for word', () => {
    expect(zoomed([ev('a')]).html).toContain(back);
  });

  test('an area with nothing upcoming, or no area at all, is the note and the way back alone', () => {
    const empty =
      '<div class="map-placeholder" data-testid="amap-zoom-empty" role="status"><p><strong>No upcoming events in this area.</strong></p></div>' +
      `${ZOOM_STYLE}${back}`;
    for (const cell of [CELL, latLngToCell(RIPH.lat, RIPH.lon, 9), 'x']) {
      const r = renderAttendeeMap([], {
        now: NOW,
        zoom: { cell, events: cell === CELL ? [] : [ev('a')], backHref: '/?zip=60406' },
        streets: streets(),
      });
      expect(r.html, cell).toBe(empty);
      expect(r.count).toBe(0);
    }
  });

  test('with streets: the OpenStreetMap credit, their style, and the dot caption', () => {
    const html = zoomed([ev('a')]).html;
    expect(html).toContain(
      '<p class="amap-credit" data-testid="amap-credit">Street map data © <a href="https://www.openstreetmap.org/copyright/en">OpenStreetMap</a> contributors, prepared by <a href="https://protomaps.com">Protomaps</a>.</p>'
    );
    // The credit is in the page's language, and so is the page its link opens.
    expect(zoomed([ev('a')], { lang: 'es' }).html).toContain(
      '<p class="amap-credit" data-testid="amap-credit">Datos del mapa de calles © colaboradores de <a href="https://www.openstreetmap.org/copyright/es">OpenStreetMap</a>, preparados por <a href="https://protomaps.com">Protomaps</a>.</p>'
    );
    expect(html).toContain(
      `${MAP_STYLE}${ZOOM_STYLE}${STREET_STYLE}${LABEL_STYLE}${PAN_STYLE}${NARROW_MAP_STYLE}${TIP_STYLE}\n`
    );
    expect(caption(html)).toBe(
      `1 event in this area over the next ${CORRIDOR_WINDOW_DAYS} days. A solid dot is a named place, shown on its block; a pale dot marks only its block.`
    );
  });

  test('without streets: no credit, no street style, and the list caption', () => {
    const html = zoomed([ev('a')], { streets: null }).html;
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(html).not.toContain(STREET_STYLE);
    expect(html).toContain(`${MAP_STYLE}${ZOOM_STYLE}${NARROW_MAP_STYLE}\n`);
    expect(html).toMatch(/<\/figcaption>\s*<\/figure>/);
    expect(caption(html)).toBe(
      `1 event in this area over the next ${CORRIDOR_WINDOW_DAYS} days, listed by place. A place is a block, never a street address.`
    );
  });
});
