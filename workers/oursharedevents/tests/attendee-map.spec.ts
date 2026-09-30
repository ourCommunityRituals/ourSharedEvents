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
import { renderLandingArea } from '../src/lib/landing-area';
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
    expect(out.html).not.toContain('<svg');
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
    expect(out.html).not.toContain('<svg');
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

describe('attendee map | on the landing', () => {
  it('replaces the placeholder and still sits above the full card list', () => {
    const items = many(6).map((e) => ({ ...e, venue: 'Eagles Hall' }));
    const area = renderLandingArea(items, { now: NOW });
    expect(area.html).not.toContain('A neighborhood map lands here');
    expect(area.html).toContain('data-testid="amap-svg"');
    const mapAt = area.html.indexOf('data-testid="area-map"');
    const listAt = area.html.indexOf('data-testid="area-list"');
    expect(mapAt).toBeGreaterThan(-1);
    expect(mapAt).toBeLessThan(listAt);
    expect(area.html.split('data-testid="area-card"').length - 1).toBe(6);
  });

  it('a thin landing shows the gate note inside the map view', () => {
    const area = renderLandingArea(many(2), { now: NOW });
    expect(area.html).toContain('data-testid="area-map-thin"');
  });
});
