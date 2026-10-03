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

import { describe, it, expect } from 'vitest';
import { latLngToCell } from 'h3-js';
import {
  renderAttendeeMap,
  attendeeMapAreas,
  MAX_MAP_AREAS,
  type AttendeeMapItem,
} from '../src/lib/attendee-map';
import { renderLandingArea, LIST_MAX } from '../src/lib/landing-area';
import { CORRIDOR_READY_MIN_EVENTS } from '../src/lib/corridor-readiness';

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
    // The only drawing below the gate is the labelled example, never a real map.
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
    // The only drawing below the gate is the labelled example, never a real map.
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
});

describe('attendee map | the example shown below the gate', () => {
  const thin = () => renderAttendeeMap(many(CORRIDOR_READY_MIN_EVENTS - 1), { now: NOW });
  const figure = (h: string) => h.slice(h.indexOf('<figure'), h.indexOf('</figure>'));

  it('shows an example drawing under a bar that says Example', () => {
    const html = thin().html;
    expect(html).toContain('data-testid="amap-example"');
    expect(html).toContain('dominant-baseline="central">Example</text>');
    expect(html).toContain('these are not real events');
    expect(html.split('<polygon').length - 1).toBe(3);
  });

  it('cannot be mistaken for a real map: no real test ids, links, cells or counts', () => {
    const html = thin().html;
    expect(html).not.toContain('data-testid="amap-svg"');
    expect(html).not.toContain('data-testid="amap-area"');
    expect(html).not.toContain('data-testid="amap-legend"');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('data-cell');
    expect(html).not.toContain('data-count');
    expect(html).not.toContain(BLUE7);
  });

  it('is the same drawing whatever the events are (it is not data)', () => {
    const other = renderAttendeeMap([ev(1, { h3_res7: BEV7 })], { now: NOW }).html;
    expect(figure(other)).toBe(figure(thin().html));
  });

  it('is named for assistive tech as an example, and is gone once a real map is drawn', () => {
    expect(thin().html).toContain(
      'role="img" aria-label="Example of the neighborhood map. These are not real events."'
    );
    const real = renderAttendeeMap(many(CORRIDOR_READY_MIN_EVENTS), { now: NOW }).html;
    expect(real).not.toContain('amap-example');
    expect(real).not.toContain('>Example<');
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
