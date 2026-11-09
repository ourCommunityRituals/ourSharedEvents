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
import { cellToChildren, cellToLatLng, cellToParent, latLngToCell } from 'h3-js';
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
    // Each event's link in the list carries its own classes.
    expect(html).toMatch(/<span class="amap-f type-bingo when-month"><a href="\/events\/b"/);
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
      { now: NOW, zoom: { cell: CELL, backHref: '/' }, typeCategories }
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

  test("a dot's touch target is at least 44 px on a 343 px wide phone map", () => {
    const html = zoomed([ev('a')]).html;
    const r = Number(/class="amap-hit" [^>]*r="(\d+)"/.exec(html)![1]);
    expect(2 * r * (343 / MAP_W)).toBeGreaterThanOrEqual(44);
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
    expect(html).not.toContain('<script');
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
