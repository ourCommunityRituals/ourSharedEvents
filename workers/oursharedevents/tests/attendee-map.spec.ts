/**
 * Attendee map (TRIANGLE next slice #1) — lib/attendee-map + its landing wiring.
 *
 * Node-clean: pure renderer, string assertions. Registered in vitest.node-specs.mjs.
 *
 * What these pin:
 *   - the gate, per corridor (§6.2b): a res-7 corridor is drawn only with
 *     ≥ CORRIDOR_READY_MIN_EVENTS events of its own, or once latched; scattered
 *     events across corridors open nothing
 *   - precision: hexes are res-7 cells only; a res-9 cell is never drawn, and no
 *     event lat/lon reaches the markup (the map never reads them)
 *   - window: wrapped / beyond-horizon events are not on the map
 *   - escaping, links, the design-check CSS budget, and that the cards stay
 *     below the map (OSE-1354)
 */
// @born-red attendee-map mutants | method: StrykerJS mutants of src/lib/attendee-map.ts, each new test seen failing against the mutant it kills (status Killed in the report) | date: 2026-11-09

import { describe, it, expect } from 'vitest';
import { latLngToCell } from 'h3-js';
import {
  renderAttendeeMap,
  attendeeMapAreas,
  townOf,
  MAX_MAP_AREAS,
  type AttendeeMapItem,
} from '../src/lib/attendee-map';
import {
  renderLandingArea,
  injectLandingArea,
  orderLandingSections,
  LIST_MAX,
} from '../src/lib/landing-area';
import LANDING_HTML from '../src/templates/landing.html';
import { CORRIDOR_READY_MIN_EVENTS } from '../src/lib/corridor-readiness';
import { STREET_STYLE, cellsKey } from '../src/lib/street-map';

const NOW = Date.parse('2026-09-13T00:00:00.000Z');
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

// Two real corridors: Blue Island and Beverly (Chicago). Distinctive decimals so
// a leak would be findable in the output.
const BLUE = { lat: 41.657731, lon: -87.680213 };
const BEV = { lat: 41.717329, lon: -87.673159 };
const BLUE7 = latLngToCell(BLUE.lat, BLUE.lon, 7);
const BEV7 = latLngToCell(BEV.lat, BEV.lon, 7);

function ev(i: number, over: Partial<AttendeeMapItem & { lat: number; lon: number }> = {}) {
  return {
    id: `e${i}`,
    name: `Event ${i}`,
    startDateISO: inDays(3 + i),
    phase: 'pre_event',
    h3_res7: BLUE7,
    lat: BLUE.lat,
    lon: BLUE.lon,
    ...over,
  };
}

const many = (n: number, over: Partial<AttendeeMapItem> = {}) =>
  Array.from({ length: n }, (_, i) => ev(i, over));

// A distinct res-7 cell per index, walking east (for "scattered" cases).
const cellAt = (i: number) => latLngToCell(41.7, -87.9 + i * 0.05, 7);

describe('attendee map | per-corridor gate (§6.2b)', () => {
  it('below the gate in every corridor: no SVG, the busiest count, a pointer to the list', () => {
    const out = renderAttendeeMap(many(CORRIDOR_READY_MIN_EVENTS - 1), { now: NOW });
    expect(out.state).toBe('thin');
    // No real neighborhood is drawn: only the labelled example.
    expect(out.html).not.toContain('data-testid="amap-svg"');
    expect(out.html).not.toContain('data-testid="amap-area"');
    expect(out.html).toContain('data-testid="area-map-thin"');
    expect(out.html).toContain(`The busiest has ${CORRIDOR_READY_MIN_EVENTS - 1} so far`);
    expect(out.html).toContain('every event is listed below');
  });

  it('empty input says "None yet"', () => {
    const out = renderAttendeeMap([], { now: NOW });
    expect(out.state).toBe('thin');
    expect(out.html).toContain('None yet');
  });

  it('at the gate in one corridor: that corridor is drawn', () => {
    const out = renderAttendeeMap(many(CORRIDOR_READY_MIN_EVENTS), { now: NOW });
    expect(out.state).toBe('map');
    expect(out.areas.map((a) => a.cell)).toEqual([BLUE7]);
    expect(out.count).toBe(CORRIDOR_READY_MIN_EVENTS);
  });

  it('five events scattered over five corridors open NOTHING (the brand-wide count is not the grain)', () => {
    const items = Array.from({ length: CORRIDOR_READY_MIN_EVENTS }, (_, i) =>
      ev(i, { h3_res7: cellAt(i) })
    );
    const out = renderAttendeeMap(items, { now: NOW });
    expect(out.state).toBe('thin');
    expect(out.html).not.toContain('data-testid="amap-svg"');
    expect(out.html).not.toContain('data-testid="amap-area"');
    expect(out.html).toContain('The busiest has 1 so far');
  });

  it('only corridors at the gate are drawn; a quiet corridor beside a busy one is not', () => {
    const items = [...many(CORRIDOR_READY_MIN_EVENTS), ev(40, { h3_res7: BEV7 })];
    const out = renderAttendeeMap(items, { now: NOW });
    expect(out.areas.map((a) => [a.n, a.cell, a.events.length])).toEqual([
      [1, BLUE7, CORRIDOR_READY_MIN_EVENTS],
    ]);
    expect(out.html).not.toContain('href="/events/e40"');
  });

  it('a latched corridor stays drawn after it falls below the gate (no flapping)', () => {
    const out = renderAttendeeMap([ev(0), ev(1, { h3_res7: BEV7 })], {
      now: NOW,
      latched: new Set([BLUE7]),
    });
    expect(out.state).toBe('map');
    expect(out.areas.map((a) => [a.cell, a.events.length])).toEqual([[BLUE7, 1]]);
  });

  it('a latched corridor with nothing coming up draws no empty hex', () => {
    const out = renderAttendeeMap([ev(0, { h3_res7: BEV7 })], {
      now: NOW,
      latched: new Set([BLUE7]),
    });
    expect(out.state).toBe('thin');
  });

  it('counts only what it would draw: events without a cell never count toward a corridor', () => {
    const items = [...many(CORRIDOR_READY_MIN_EVENTS - 1), ev(99, { h3_res7: null })];
    const out = renderAttendeeMap(items, { now: NOW });
    expect(out.state).toBe('thin');
  });
});

describe('attendee map | precision (Invariant #1 by construction)', () => {
  it('never puts an event coordinate in the markup', () => {
    const items = [
      ...many(CORRIDOR_READY_MIN_EVENTS),
      ...Array.from({ length: CORRIDOR_READY_MIN_EVENTS }, (_, i) =>
        ev(10 + i, { h3_res7: BEV7, lat: BEV.lat, lon: BEV.lon })
      ),
    ];
    const out = renderAttendeeMap(items, { now: NOW });
    expect(out.areas.length).toBe(2);
    for (const n of [BLUE.lat, BLUE.lon, BEV.lat, BEV.lon]) {
      expect(out.html).not.toContain(String(n));
      expect(out.html).not.toContain(n.toFixed(4));
    }
  });

  it('draws res-7 cells only — a finer cell is never a hex', () => {
    const res9 = latLngToCell(BLUE.lat, BLUE.lon, 9);
    const { areas, count } = attendeeMapAreas(
      [...many(5), ev(50, { h3_res7: res9 }), ev(51, { h3_res7: 'not-a-cell' })],
      new Date(NOW)
    );
    expect(count).toBe(5);
    expect(areas.map((a) => a.cell)).toEqual([BLUE7]);
  });
});

// The landing draws through an area gate (lib/landing-area: at LIST_MAX events,
// or once latched, every corridor with an event). The gate changes WHICH
// corridors are drawn; it must not change what a hex is made from.
describe('landing map | Invariant #1 holds on the area-gate path', () => {
  const coords = [BLUE.lat, BLUE.lon, BEV.lat, BEV.lon];
  const mixed = (n: number) => [
    ...many(n - 1),
    ev(30, { h3_res7: BEV7, lat: BEV.lat, lon: BEV.lon }),
  ];
  const drawnCells = (html: string) => [...html.matchAll(/data-cell="([^"]*)"/g)].map((m) => m[1]!);

  it('at the threshold: no event coordinate reaches the page, in the map or the cards', () => {
    const html = renderLandingArea(mixed(LIST_MAX), { now: NOW }).html;
    expect(drawnCells(html).sort()).toEqual([BLUE7, BEV7].sort());
    for (const n of coords) {
      expect(html).not.toContain(String(n));
      expect(html).not.toContain(n.toFixed(4));
    }
  });

  it('latched below the threshold: the same holds', () => {
    const html = renderLandingArea(mixed(3), { now: NOW, areaLatched: true }).html;
    expect(drawnCells(html).length).toBe(2);
    for (const n of coords) expect(html).not.toContain(String(n));
  });

  it('only res-7 cells are ever drawn: a finer cell or a non-cell is counted but never a hex', () => {
    const res9 = latLngToCell(BLUE.lat, BLUE.lon, 9);
    const items = [...many(LIST_MAX), ev(40, { h3_res7: res9 }), ev(41, { h3_res7: 'not-a-cell' })];
    const html = renderLandingArea(items, { now: NOW }).html;
    expect(drawnCells(html)).toEqual([BLUE7]);
    expect(html).not.toContain(res9);
    expect(html).not.toContain('not-a-cell');
  });

  it('each hex still counts exactly the events it links (the thing counted is the thing shown)', () => {
    const out = renderAttendeeMap(mixed(LIST_MAX), {
      now: NOW,
      area: { count: LIST_MAX, min: LIST_MAX },
    });
    for (const a of out.areas) {
      expect(out.html).toContain(`data-cell="${a.cell}" data-count="${a.events.length}"`);
    }
    expect(out.count).toBe(out.areas.reduce((s, a) => s + a.events.length, 0));
  });
});

describe('attendee map | forward window', () => {
  it('drops wrapped events and events past the horizon', () => {
    const items = [
      ...many(5),
      ev(60, { phase: 'post_event' }),
      ev(61, { startDateISO: inDays(200) }),
    ];
    const { count } = attendeeMapAreas(items, new Date(NOW));
    expect(count).toBe(5);
  });
});

describe('attendee map | shape', () => {
  it('one hex per drawn corridor, busiest first, numbered, legend, caption last', () => {
    const items = [
      ...many(CORRIDOR_READY_MIN_EVENTS + 1),
      ...Array.from({ length: CORRIDOR_READY_MIN_EVENTS }, (_, i) => ev(20 + i, { h3_res7: BEV7 })),
    ];
    const out = renderAttendeeMap(items, { now: NOW });
    expect(out.areas.map((a) => [a.n, a.cell, a.events.length])).toEqual([
      [1, BLUE7, CORRIDOR_READY_MIN_EVENTS + 1],
      [2, BEV7, CORRIDOR_READY_MIN_EVENTS],
    ]);
    expect(out.html.split('data-testid="amap-area"').length - 1).toBe(2);
    expect(out.html).toContain(
      `<li value="1" data-testid="amap-legend-area"><strong>${CORRIDOR_READY_MIN_EVENTS + 1} events:</strong>`
    );
    expect(out.html).toContain('href="/events/e20"');
    expect(out.html).toContain('aria-labelledby="amap-caption"');
    expect(out.html).toContain('never a street address');
    expect(out.html).toContain('the filters above change the list, not the map');
    // <figcaption> is the figure's last child (HTML content model).
    expect(out.html.trim()).toMatch(/<\/figcaption>\s*<\/figure>$/);
  });

  it('escapes event names and ids', () => {
    const items = many(5).map((e, i) =>
      i === 0 ? { ...e, id: '"><x', name: '<script>alert(1)</script>' } : e
    );
    const out = renderAttendeeMap(items, { now: NOW });
    expect(out.html).not.toContain('<script>alert');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).not.toContain('href="/events/"><x"');
  });

  it(`caps the hex count at ${MAX_MAP_AREAS}`, () => {
    const cells = Array.from({ length: MAX_MAP_AREAS + 5 }, (_, i) => cellAt(i));
    const out = renderAttendeeMap(
      cells.map((c, i) => ev(i, { h3_res7: c, startDateISO: inDays(5) })),
      { now: NOW, latched: new Set(cells) }
    );
    expect(out.areas.length).toBe(MAX_MAP_AREAS);
  });

  it('its one <style> fits the 400-char design-check budget and uses tokens, not hex', () => {
    const out = renderAttendeeMap(many(5), { now: NOW });
    const css = out.html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(css.length).toBeGreaterThan(0);
    expect(css.length).toBeLessThanOrEqual(400);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).toMatch(/min-height:44px/);
  });

  it('legend links take the accent token, not the browser default blue (OSE-1548)', () => {
    const out = renderAttendeeMap(many(5), { now: NOW });
    const css = out.html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    const rule = /\.amap-legend a\{([^}]*)\}/.exec(css)?.[1] ?? '';
    // --accent is 6.51:1 on the dark page background (@ocr/ui tokens.ts) and the
    // plain-web link blue in light, so a token colour is the measured contrast.
    expect(rule).toMatch(/(^|;)color:var\(--accent\)/);
  });
});

describe('attendee map | the landing area gate', () => {
  const gate = (count: number) => ({ now: NOW, area: { count, min: 10 } });

  it('below the gate the note carries the real count and nothing is drawn', () => {
    const out = renderAttendeeMap(many(7), gate(7));
    expect(out.state).toBe('thin');
    expect(out.html).toContain('once this area has 10 events');
    expect(out.html).toContain('There are 7 so far');
  });

  it('says "is" for one event and "None yet" for none', () => {
    expect(renderAttendeeMap(many(1), gate(1)).html).toContain('There is 1 so far');
    expect(renderAttendeeMap([], gate(0)).html).toContain('None yet');
  });

  it('at the gate, events without a place on the map get a plain note, not a broken map', () => {
    const out = renderAttendeeMap(many(10, { h3_res7: null }), gate(10));
    expect(out.state).toBe('thin');
    expect(out.html).toContain('None of these events has a place on the map yet');
  });

  it('a latched area keeps drawing below the gate', () => {
    const out = renderAttendeeMap(many(3), {
      now: NOW,
      area: { count: 3, min: 10, latched: true },
    });
    expect(out.state).toBe('map');
    expect(out.areas.map((a) => [a.cell, a.events.length])).toEqual([[BLUE7, 3]]);
  });

  it('without an area gate the shared per-neighbourhood rule (5, or latched) still applies', () => {
    expect(CORRIDOR_READY_MIN_EVENTS).toBe(5);
    expect(renderAttendeeMap(many(5), { now: NOW }).state).toBe('map');
    expect(renderAttendeeMap(many(4), { now: NOW }).state).toBe('thin');
    expect(renderAttendeeMap(many(1), { now: NOW, latched: new Set([BLUE7]) }).state).toBe('map');
  });
});

describe('attendee map | on the landing', () => {
  it('replaces the placeholder and still sits above the full card list', () => {
    const items = many(LIST_MAX).map((e) => ({ ...e, venue: 'Eagles Hall' }));
    const area = renderLandingArea(items, { now: NOW });
    expect(area.html).not.toContain('A neighborhood map lands here');
    expect(area.html).toContain('data-testid="amap-svg"');
    const mapAt = area.html.indexOf('data-testid="area-map"');
    const listAt = area.html.indexOf('data-testid="area-list"');
    expect(mapAt).toBeGreaterThan(-1);
    expect(mapAt).toBeLessThan(listAt);
    expect(area.html.split('data-testid="area-card"').length - 1).toBe(LIST_MAX);
  });

  it('at the landing threshold every neighbourhood with an event is drawn, lonely ones too', () => {
    const items = [...many(LIST_MAX - 1), ev(20, { h3_res7: BEV7 })];
    const area = renderLandingArea(items, { now: NOW });
    expect(area.html).toContain(`data-cell="${BLUE7}"`);
    expect(area.html).toContain(`data-cell="${BEV7}"`);
  });

  it('one event short of the threshold draws nothing, even in a latched neighbourhood', () => {
    const area = renderLandingArea(many(LIST_MAX - 1), { now: NOW, latched: new Set([BLUE7]) });
    expect(area.html).not.toContain('data-cell=');
    expect(area.html).toContain('data-testid="amap-example"');
  });

  it('a thin landing shows the gate note inside the map view', () => {
    const area = renderLandingArea(many(2), { now: NOW });
    expect(area.html).toContain('data-testid="area-map-thin"');
  });
});

describe('attendee map | place names (the free base: no map service)', () => {
  const G = CORRIDOR_READY_MIN_EVENTS;

  it('townOf reads the town from a US address or a "Venue, Town ST" line, and nothing else', () => {
    expect(townOf('13326 Olde Western Ave, Blue Island, IL 60406')).toBe('Blue Island');
    expect(townOf('5771 Sawyer Rd, Sawyer, MI 49125-9100, USA')).toBe('Sawyer');
    expect(townOf('Beverly Arts Center, Chicago IL')).toBe('Chicago');
    expect(townOf("Rock Island Public House, Coeur d'Alene, ID")).toBe("Coeur d'Alene");
    // No state, a street where the town should be, or junk: no name.
    expect(townOf('Rock Island Public House')).toBeNull();
    expect(townOf('Suite 4, 123 Main St, IL')).toBeNull();
    expect(townOf('<b>x</b>, <i>y</i>, IL')).toBeNull();
    expect(townOf(null)).toBeNull();
    expect(townOf(42)).toBeNull();
  });

  it('names an area after the commonest town in its events, in the hexagon and the legend', () => {
    const items = [
      ...many(G - 1, { where_address: '13326 Olde Western Ave, Blue Island, IL 60406' }),
      ev(50, { where_address: '1 Elsewhere Rd, Posen, IL 60469' }),
    ];
    const out = renderAttendeeMap(items, { now: NOW });
    expect(out.areas.map((a) => a.name)).toEqual(['Blue Island']);
    expect(out.html).toContain('<title>Area 1, Blue Island: ' + G + ' events</title>');
    expect(out.html).toMatch(/<tspan [^>]*data-testid="amap-area-name">Blue Island<\/tspan>/);
    expect(out.html).toContain(
      '<span data-testid="amap-legend-name">Blue Island</span> &middot; ' + G + ' events:'
    );
  });

  it('falls back to the venue line, then to "near <venue>", then to no name at all', () => {
    const town = renderAttendeeMap(many(G, { venue: 'Beverly Arts Center, Chicago IL' }), {
      now: NOW,
    });
    expect(town.areas[0]!.name).toBe('Chicago');

    const near = renderAttendeeMap(many(G, { location: 'Rock Island Public House' }), { now: NOW });
    expect(near.areas[0]!.name).toBe('near Rock Island Public House');

    const none = renderAttendeeMap(many(G), { now: NOW });
    expect(none.areas[0]!.name).toBe('');
    expect(none.html).not.toContain('amap-area-name');
    expect(none.html).not.toContain('amap-legend-name');
    expect(none.html).toContain('<title>Area 1: ' + G + ' events</title>');
    expect(none.html).toContain('<strong>' + G + ' events:</strong>');
  });

  it('escapes a hostile venue name wherever the area name is written', () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const out = renderAttendeeMap(many(G, { venue: hostile }), { now: NOW });
    expect(out.areas[0]!.name).toContain('near ');
    expect(out.html).not.toContain('<img');
    expect(out.html).toContain('&lt;img');
  });

  it('draws names inside the hexagons only while they are few; the legend always has them', () => {
    const towns = ['Alsip', 'Posen', 'Harvey', 'Dolton', 'Riverdale'];
    const items = towns.flatMap((t, c) =>
      Array.from({ length: G }, (_, i) =>
        ev(c * 10 + i, { h3_res7: cellAt(c), where_address: `1 Main St, ${t}, IL` })
      )
    );
    const five = renderAttendeeMap(items, { now: NOW });
    expect(five.areas.map((a) => a.name).sort()).toEqual([...towns].sort());
    expect(five.html).not.toContain('amap-area-name');
    expect(five.html.match(/data-testid="amap-legend-name"/g)?.length).toBe(5);

    const four = renderAttendeeMap(items.slice(0, 4 * G), { now: NOW });
    expect(four.html.match(/data-testid="amap-area-name"/g)?.length).toBe(4);
  });

  it('a long name is shortened in the hexagon and whole in the legend; no address reaches the page', () => {
    const address = '900 Lake Shore Dr, Village of Grand Beach Springs, MI 49117';
    const out = renderAttendeeMap(many(G, { where_address: address }), { now: NOW });
    expect(out.html).toContain('data-testid="amap-area-name">Village of Gran…</tspan>');
    expect(out.html).toContain('Village of Grand Beach Springs</span>');
    expect(out.html).not.toContain('900 Lake Shore');
    expect(out.html).not.toContain('49117');
  });
});

describe('attendee map | the example below the gate (PO 2026-10-03)', () => {
  it('shows a labelled example drawing, with no cell, no event and no link in it', () => {
    const out = renderAttendeeMap(many(CORRIDOR_READY_MIN_EVENTS - 1), { now: NOW });
    expect(out.state).toBe('thin');
    expect(out.areas).toEqual([]);
    const i = out.html.indexOf('data-testid="amap-example"');
    expect(i).toBeGreaterThan(-1);
    const example = out.html.slice(i);
    expect(example).toContain('<strong>Example.</strong>');
    expect(example.match(/<polygon class="amap-cell"/g)?.length).toBe(3);
    expect(example).not.toContain('data-cell=');
    expect(example).not.toContain('href=');
    expect(example).not.toContain(BLUE7);
    expect(example).not.toContain('Event 0');
  });

  it('is gone once a real neighborhood is drawn', () => {
    const out = renderAttendeeMap(many(CORRIDOR_READY_MIN_EVENTS), { now: NOW });
    expect(out.state).toBe('map');
    expect(out.html).not.toContain('amap-example');
  });
});

describe('landing | which leads: the create doors or the map (PO 2026-10-03)', () => {
  const PAGE =
    '<h1>H</h1><!--OCR_DOORS_START--><section data-testid="landing-doors">D</section><!--OCR_DOORS_END-->' +
    '<section data-testid="landing-area">A</section><!--OCR_AFTER_AREA--><p>tail</p>';

  it('fewer than LIST_MAX events: the doors lead, then the area', () => {
    const html = orderLandingSections(PAGE, 'list');
    expect(html.indexOf('landing-doors')).toBeLessThan(html.indexOf('landing-area'));
    expect(html).not.toContain('<!--OCR_');
  });

  it('LIST_MAX or more: the area (map) leads and the doors sit directly beneath it', () => {
    const html = orderLandingSections(PAGE, 'map');
    expect(html.indexOf('landing-area')).toBeLessThan(html.indexOf('landing-doors'));
    expect(html.indexOf('landing-doors')).toBeLessThan(html.indexOf('tail'));
    expect(html).not.toContain('<!--OCR_');
    expect(html.match(/landing-doors/g)?.length).toBe(1);
  });

  it('a template without the markers is returned unchanged', () => {
    expect(orderLandingSections('<p>plain</p>', 'map')).toBe('<p>plain</p>');
  });

  it('the real landing template: doors first under the threshold, map first at it, markers gone', () => {
    const served = (n: number) =>
      injectLandingArea(
        LANDING_HTML,
        renderLandingArea(
          Array.from({ length: n }, (_, i) => ev(i, { h3_res7: cellAt(i) })),
          { now: NOW }
        )
      );
    const few = served(LIST_MAX - 1);
    expect(few.indexOf('data-testid="landing-doors"')).toBeLessThan(
      few.indexOf('data-testid="landing-area"')
    );
    const many10 = served(LIST_MAX);
    expect(many10.indexOf('data-testid="landing-area"')).toBeLessThan(
      many10.indexOf('data-testid="landing-doors"')
    );
    // Both doors survive the move, once each, and the h1 still leads the page.
    for (const page of [few, many10]) {
      expect(page).not.toContain('<!--OCR_DOORS');
      expect(page).not.toContain('<!--OCR_AFTER_AREA');
      expect(page.match(/data-testid="door-create-event"/g)?.length).toBe(1);
      expect(page.match(/data-testid="door-create-sponsor"/g)?.length).toBe(1);
      expect(page.indexOf('data-testid="landing-h1"')).toBeLessThan(
        page.indexOf('data-testid="landing-area"')
      );
    }
  });

  it('the threshold is the same one the list/map default uses', () => {
    const at = (n: number) =>
      renderLandingArea(
        Array.from({ length: n }, (_, i) => ev(i, { h3_res7: cellAt(i) })),
        { now: NOW }
      ).defaultView;
    expect(at(LIST_MAX - 1)).toBe('list');
    expect(at(LIST_MAX)).toBe('map');
  });
});

describe('attendee map | OSE-1522: the legend names the consented sponsor by an event title', () => {
  const legendOf = (html: string) => html.match(/<ol class="amap-legend"[^]*?<\/ol>/)?.[0] ?? '';
  const sponsorTitles = new Map([['e0', 'Hall <b>Bakery</b>']]);

  it('a sponsored event is followed by "Supported by <title>", escaped; the others are not', () => {
    const legend = legendOf(
      renderAttendeeMap(many(CORRIDOR_READY_MIN_EVENTS), { now: NOW, sponsorTitles }).html
    );
    expect(legend).toContain('data-testid="amap-event-sponsor"');
    expect(legend).toContain('Supported by Hall &lt;b&gt;Bakery&lt;/b&gt;');
    expect(legend).not.toContain('<b>Bakery');
    expect(legend.split('Supported by').length - 1).toBe(1);
    // it sits right after its own event's link
    expect(legend).toMatch(
      /data-testid="amap-event">Event 0<\/a> <span data-testid="amap-event-sponsor">/
    );
  });

  it('no sponsor titles, no sponsor text', () => {
    const legend = legendOf(renderAttendeeMap(many(CORRIDOR_READY_MIN_EVENTS), { now: NOW }).html);
    expect(legend).not.toContain('Supported by');
  });

  it('the landing hands its sponsor titles to the map legend as well as to the cards', () => {
    const html = renderLandingArea(many(LIST_MAX), { now: NOW, sponsorTitles }).html;
    expect(legendOf(html)).toContain('Supported by Hall');
    expect(html.split('Supported by Hall').length - 1).toBe(2); // one card, one legend entry
  });
});

describe('attendee map | area names, order and shading, edge by edge', () => {
  const G = CORRIDOR_READY_MIN_EVENTS;
  const at = (town: string) => `1 Main St, ${town}, IL`;

  it('townOf drops a trailing country however it is written, and only a country', () => {
    const street = '13326 Olde Western Ave, Blue Island, IL 60406';
    for (const country of [
      'US',
      'USA',
      'usa.',
      'United States',
      'United States.',
      'United States of America',
    ]) {
      expect(townOf(`${street}, ${country}`), country).toBe('Blue Island');
    }
    // Empty parts between commas are skipped, not read as the state.
    expect(townOf(`${street},`)).toBe('Blue Island');
    expect(townOf(`${street}, , USA`)).toBe('Blue Island');
  });

  it('townOf reads "Town ST" with a ZIP or ZIP+4, and spaced the way people type it', () => {
    expect(townOf('Venue, Chicago IL 60406')).toBe('Chicago');
    expect(townOf('Venue, Chicago IL 60406-9100')).toBe('Chicago');
    expect(townOf('Venue, Chicago IL  60406')).toBe('Chicago');
    expect(townOf('1 Main St, Blue Island, IL  60406')).toBe('Blue Island');
  });

  it('townOf: a state that is not two capitals, or a country inside a longer part, is no name', () => {
    expect(townOf('1 Main St, Blue Island, ILLINOIS')).toBeNull();
    expect(townOf('Venue, Chicago ILLINOIS')).toBeNull();
    expect(townOf('Venue, Old\nChicago IL')).toBeNull();
    expect(townOf('1 Main St, Chicago IL, Little USA')).toBeNull();
    expect(townOf('1 Main St, Chicago IL, USA Today')).toBeNull();
  });

  it('townOf: a town is 2 to 40 characters', () => {
    expect(townOf('1 Main St, X, IL')).toBeNull();
    expect(townOf('1 Main St, Ox, IL')).toBe('Ox');
    const forty = `A${'a'.repeat(39)}`;
    expect(townOf(`1 Main St, ${forty}, IL`)).toBe(forty);
    expect(townOf(`1 Main St, ${forty}a, IL`)).toBeNull();
  });

  it('a number given as an id is written as that number', () => {
    const out = renderAttendeeMap(many(G, { id: 7 }), { now: NOW });
    expect(out.areas[0]!.events[0]!.id).toBe('7');
    expect(out.html).toContain('href="/events/7"');
  });

  it('townOf: a town with a digit or a symbol, or a line of one part, is no name', () => {
    expect(townOf('1 Main St, Blue Island 2, IL')).toBeNull();
    expect(townOf('1 Main St, Blue Island!, IL 60406')).toBeNull();
    expect(townOf('Chicago IL')).toBeNull();
    expect(townOf('IL')).toBeNull();
    expect(townOf('IL 60406')).toBeNull();
  });

  it('the commonest town names the area whatever order the events come in', () => {
    const items = [
      ev(0, { where_address: at('Alsip') }),
      ev(1, { where_address: at('Posen') }),
      ev(2, { where_address: at('Posen') }),
      ev(3, { where_address: at('Posen') }),
    ];
    expect(attendeeMapAreas(items, new Date(NOW)).areas[0]!.name).toBe('Posen');
  });

  it('two towns with as many events each: the first alphabetically names the area', () => {
    const items = [ev(0, { where_address: at('Posen') }), ev(1, { where_address: at('Alsip') })];
    expect(attendeeMapAreas(items, new Date(NOW)).areas[0]!.name).toBe('Alsip');
  });

  it('areas come busiest first, numbered from 1, whatever order the events come in', () => {
    const [lo, hi] = [BLUE7, BEV7].sort();
    const items = [ev(0, { h3_res7: lo }), ev(1, { h3_res7: hi }), ev(2, { h3_res7: hi })];
    const { areas } = attendeeMapAreas(items, new Date(NOW));
    expect(areas.map((a) => [a.n, a.cell, a.events.length])).toEqual([
      [1, hi, 2],
      [2, lo, 1],
    ]);
  });

  it('areas with as many events each are ordered by cell id', () => {
    const [lo, hi] = [BLUE7, BEV7].sort();
    const { areas } = attendeeMapAreas(
      [ev(0, { h3_res7: hi }), ev(1, { h3_res7: lo })],
      new Date(NOW)
    );
    expect(areas.map((a) => [a.n, a.cell])).toEqual([
      [1, lo],
      [2, hi],
    ]);
  });

  it('an event with no name is listed as an untitled event', () => {
    const out = renderAttendeeMap(many(G, { name: '' }), { now: NOW });
    expect(out.areas[0]!.events[0]).toEqual({ id: 'e0', name: 'Untitled event' });
    expect(out.html).toContain('href="/events/e0" data-testid="amap-event">Untitled event</a>');
  });

  it('"near <venue>" is the venue line trimmed and cut at 40 characters', () => {
    const out = renderAttendeeMap(many(G, { location: `  ${'x'.repeat(45)}  ` }), { now: NOW });
    expect(out.areas[0]!.name).toBe(`near ${'x'.repeat(40)}`);
  });

  it('a name of exactly 16 characters is drawn whole; one more is cut with an ellipsis', () => {
    const whole = renderAttendeeMap(many(G, { where_address: at('Grand Beach Park') }), {
      now: NOW,
    });
    expect(whole.html).toContain('data-testid="amap-area-name">Grand Beach Park</tspan>');
    const cut = renderAttendeeMap(many(G, { where_address: at('Grand Beach Parks') }), {
      now: NOW,
    });
    expect(cut.html).toContain('data-testid="amap-area-name">Grand Beach Par…</tspan>');
  });

  it('a hexagon with no name carries its number and nothing else', () => {
    const html = renderAttendeeMap(many(G), { now: NOW }).html;
    expect(html).toMatch(/dominant-baseline="central">1<\/text><\/g><\/svg>/);
  });

  it('the busiest hexagon is shaded deepest, and every shade is lighter over a street map', () => {
    const items = [ev(0), ev(1), ev(2), ev(3, { h3_res7: BEV7 })];
    const opts = { now: NOW, latched: new Set([BLUE7, BEV7]) };
    const opacity = (html: string, cell: string) =>
      new RegExp(`data-cell="${cell}"[^]*?fill-opacity="([\\d.]+)"`).exec(html)![1];
    const plain = renderAttendeeMap(items, opts).html;
    expect(opacity(plain, BLUE7)).toBe('0.80');
    expect(opacity(plain, BEV7)).toBe('0.40');
    const streets = {
      cellsKey: cellsKey([BLUE7, BEV7]),
      svg: '<g data-testid="amap-streets"></g>',
    };
    const over = renderAttendeeMap(items, { ...opts, streets }).html;
    expect(over).toContain('data-testid="amap-streets"');
    expect(opacity(over, BLUE7)).toBe('0.50');
    expect(opacity(over, BEV7)).toBe('0.27');
    expect(over).toContain(
      '<p class="amap-credit" data-testid="amap-credit">Street map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors.</p>'
    );
    // Streets drawn for other cells would not line up: they are left out.
    const elsewhere = renderAttendeeMap(items, {
      ...opts,
      streets: { ...streets, cellsKey: cellsKey([BLUE7]) },
    }).html;
    expect(elsewhere).not.toContain('data-testid="amap-streets"');
    expect(elsewhere).not.toContain('data-testid="amap-credit"');
    expect(opacity(elsewhere, BLUE7)).toBe('0.80');
  });

  it('the clock given is the one used: an event past its horizon is not drawn', () => {
    const then = Date.parse('2020-01-01T00:00:00.000Z');
    const later = new Date(then + 100 * 86_400_000).toISOString();
    const out = renderAttendeeMap(many(G, { startDateISO: later }), { now: then });
    expect(out.state).toBe('thin');
    expect(out.count).toBe(0);
  });

  it('with no options at all: the real clock, the per-corridor gate, no streets, no zoom links', () => {
    expect(renderAttendeeMap(null).state).toBe('thin');
    expect(renderAttendeeMap(undefined).html).toContain('None yet');
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const out = renderAttendeeMap(many(G, { startDateISO: soon }));
    expect(out.state).toBe('map');
    expect(out.count).toBe(G);
    expect(out.html).toContain('data-testid="amap-svg"');
    expect(out.html).not.toContain('amap-zoom');
    expect(out.html).not.toContain('amap-area-link');
    expect(out.html).not.toContain('Tap a hexagon');
    expect(out.html).not.toContain('data-testid="amap-credit"');
    expect(out.html).toMatch(/<\/figcaption>\s*<\/figure>$/);
    expect(out.html).not.toContain(STREET_STYLE);
    expect(out.html).not.toContain('Supported by');
    expect(renderAttendeeMap(many(G - 1, { startDateISO: soon })).state).toBe('thin');
  });
});
