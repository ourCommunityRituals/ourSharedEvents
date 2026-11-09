/**
 * The landing map, zoomed in on one area (owner, 2026-11-09).
 *
 * A hexagon on the landing links to `?area=<res-7 cell>`. That view draws the
 * one area over the street map with a numbered dot per place that holds an
 * event: a business or landmark (`place_kind` 'business') at its exact point,
 * anything else at the centre of its res-9 block. One event per dot links to
 * its page; more link to their row in the list. The dots carry the cards'
 * filter classes, so the landing's pills filter them with no JS.
 *
 * Node project: pure rendering. The page itself (`/?area=` through the
 * Worker) is covered in event-place.spec.ts.
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
 */
import { describe, expect, test } from 'vitest';
import { cellToLatLng, cellToParent, latLngToCell } from 'h3-js';
import {
  MAP_STYLE,
  ZOOM_STYLE,
  mapDots,
  renderAttendeeMap,
  type ZoomEvent,
} from '../src/lib/attendee-map';
import { landingZoom, renderLandingArea } from '../src/lib/landing-area';
import { MAP_H, MAP_W, cellsKey, frameForCells, project } from '../src/lib/street-map';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const SOON = '2026-11-20';
// Rock Island Public House, Blue Island IL, in res-7 cell 872664544ffffff.
const RIPH = { lat: 41.6565, lon: -87.681 };
const CELL = latLngToCell(RIPH.lat, RIPH.lon, 7);
const OTHER = latLngToCell(41.88, -87.63, 7);

function ev(id: string, over: Partial<ZoomEvent> = {}): ZoomEvent {
  return {
    id,
    name: `Event ${id}`,
    startDateISO: SOON,
    phase: 'pre_event',
    h3_res7: CELL,
    lat: RIPH.lat,
    lon: RIPH.lon,
    place_kind: 'business',
    classes: ['type-trivia', 'when-week'],
    ...over,
  };
}

const zoomed = (events: ZoomEvent[], extra: Record<string, unknown> = {}) =>
  renderAttendeeMap([], {
    now: NOW,
    zoom: { cell: CELL, events, backHref: '/?zip=60406' },
    ...extra,
  });

describe('where a dot sits', () => {
  test('a business at its own point, an address at its res-9 block centre', () => {
    const { dots } = mapDots(CELL, [ev('biz'), ev('home', { place_kind: 'address' })]);
    const biz = dots.find((d) => d.events[0]!.id === 'biz')!;
    const home = dots.find((d) => d.events[0]!.id === 'home')!;
    expect(biz.exact).toBe(true);
    expect([biz.lat, biz.lng]).toEqual([RIPH.lat, RIPH.lon]);
    expect(home.exact).toBe(false);
    expect([home.lat, home.lng]).toEqual(cellToLatLng(latLngToCell(RIPH.lat, RIPH.lon, 9)));
    expect([home.lat, home.lng]).not.toEqual([RIPH.lat, RIPH.lon]);
  });

  test('no kind, or any other value, is drawn as a block, never exactly', () => {
    for (const place_kind of [undefined, null, '', 'Business', 'premise', 1]) {
      const { dots } = mapDots(CELL, [ev('x', { place_kind })]);
      expect(dots[0]!.exact, String(place_kind)).toBe(false);
    }
  });

  test('events on one block share a dot; one business point is its own dot', () => {
    const near = { lat: RIPH.lat + 0.0003, lon: RIPH.lon + 0.0003 };
    expect(latLngToCell(near.lat, near.lon, 9)).toBe(latLngToCell(RIPH.lat, RIPH.lon, 9));
    const { dots } = mapDots(CELL, [
      ev('a', { place_kind: 'address' }),
      ev('b', { place_kind: 'address', ...near }),
      ev('c'),
      ev('d'),
    ]);
    expect(dots).toHaveLength(2);
    expect(dots.map((d) => d.events.map((e) => e.id).join()).sort()).toEqual(['a,b', 'c,d']);
  });

  test('an event with no coordinates is listed, not drawn', () => {
    const { dots, unplaced } = mapDots(CELL, [
      ev('a', { lat: null, lon: null }),
      ev('b', { lat: 'x' as unknown as number }),
      ev('c', { lat: 200 }),
    ]);
    expect(dots).toHaveLength(0);
    expect(unplaced.map((e) => e.id)).toEqual(['a', 'b', 'c']);
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
  test('one event: the dot links to its page; more: to its row in the list', () => {
    const one = zoomed([ev('solo')]).html;
    expect(one).toMatch(/<a href="\/events\/solo" class="amap-f [^"]*" data-testid="amap-dot"/);
    const two = zoomed([ev('a'), ev('b')]).html;
    expect(two).toMatch(/<a href="#amap-dot-1" [^>]*data-testid="amap-dot"[^>]*data-count="2"/);
    expect(two).toContain('id="amap-dot-1"');
    expect(two).toContain('href="/events/a"');
    expect(two).toContain('href="/events/b"');
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
    // Each event's link in the list carries its own classes.
    expect(html).toMatch(/<span class="amap-f type-bingo when-month"><a href="\/events\/b"/);
  });

  test('an address dot is marked as a block; a business dot is not', () => {
    const html = zoomed([ev('biz'), ev('home', { place_kind: 'address' })]).html;
    expect(html).toMatch(/class="amap-f amap-blk [^"]*" data-testid="amap-dot" data-exact="0"/);
    expect(html).toMatch(/class="amap-f type[^"]*" data-testid="amap-dot" data-exact="1"/);
  });

  test('dots sit where the frame projects them, inside the area outline', () => {
    const html = zoomed([ev('biz')]).html;
    const f = frameForCells([CELL], MAP_W, MAP_H);
    const [x, y] = project(f, RIPH.lat, RIPH.lon).map((v) => v.toFixed(1));
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

  test('an event without a place is listed under the map, not drawn', () => {
    const html = zoomed([ev('a'), ev('nowhere', { lat: null, lon: null })]).html;
    expect(html).toContain('data-testid="amap-unplaced"');
    expect(html).toMatch(
      /amap-unplaced"><strong>Somewhere in this area:<\/strong>.*\/events\/nowhere/
    );
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
    const streets = { cellsKey: cellsKey([CELL]), svg: '<g data-testid="amap-streets"></g>' };
    const yes = zoomed([ev('a')], { streets }).html;
    expect(yes).toContain('data-testid="amap-streets"');
    expect(yes).toContain('data-testid="amap-credit"');
    const no = zoomed([ev('a')], { streets: { ...streets, cellsKey: cellsKey([OTHER]) } }).html;
    expect(no).not.toContain('data-testid="amap-streets"');
    expect(no).not.toContain('data-testid="amap-credit"');
  });

  test('the caption says what the dots mean, in English and Spanish', () => {
    expect(zoomed([ev('a')]).html).toContain('a pale dot marks only its block');
    expect(zoomed([ev('a')], { lang: 'es' }).html).toContain('un punto claro marca solo su cuadra');
  });
});

describe('the hexagons link to their areas', () => {
  const items = [ev('a'), ev('b', { h3_res7: OTHER, lat: 41.88, lon: -87.63 })];
  const href = (cell: string) => `/?zip=60406&area=${cell}`;

  test('with a zoom link, each hexagon and each list row opens its area', () => {
    const html = renderAttendeeMap(items, {
      now: NOW,
      area: { count: 10, min: 10 },
      zoomHref: href,
    }).html;
    for (const cell of [CELL, OTHER]) {
      expect(html).toContain(
        `<g data-testid="amap-area" data-cell="${cell}" data-count="1"><a href="/?zip=60406&amp;area=${cell}" data-testid="amap-area-link">`
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

  test('the type, window and where pills hide the dots and rows as they hide the cards', () => {
    const area = renderLandingArea([...items, { ...ev('two'), template_id: 'bingo' }], {
      now: NOW,
      zoom: { cell: CELL, backHref: '/' },
    });
    expect(area.html).toContain(
      '#type-trivia:checked ~ .area .event-card:not(.type-trivia),#type-trivia:checked ~ .area .amap-f:not(.type-trivia){display:none}'
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

  test("a dot's touch target is at least 44 px on a 343 px wide phone map", () => {
    const html = zoomed([ev('a')]).html;
    const r = Number(/class="amap-hit" [^>]*r="(\d+)"/.exec(html)![1]);
    expect(2 * r * (343 / MAP_W)).toBeGreaterThanOrEqual(44);
  });
});
