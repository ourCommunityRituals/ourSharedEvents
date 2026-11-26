/**
 * The map's rules at the exact sizes where they change: the landing map's
 * hexagon links (OSE-2084; `svgFor` in src/lib/attendee-map.ts), and the
 * distance at which two places on a zoomed area become one (`mapDots`).
 *
 * A hexagon is a link only where it is a 44 px touch target (AGENTS.md
 * invariant 8), so the rule has limits: a hexagon of exactly 44 px is a link
 * and one a hair smaller is not; an area that ends exactly at the edge of the
 * square a phone shows is not cut and one a hair past it is. map-zoom.spec.ts
 * checks real areas at every screen width, and real areas never land exactly
 * on a limit (their sizes come out of a projection). Here each case says where
 * its hexagons are drawn, so it can stand on a limit and one step off it.
 *
 * To do that this spec stands in for one function, the projection (`project`
 * in src/lib/street-map.ts), and only for the corners and the middle of the
 * areas a case draws. Everything else is the code that ships: the areas are
 * real res-7 cells, grouped and named by attendeeMapAreas, and every case reads
 * the page a visitor gets (which hexagons are links, from which step, the
 * taller box, the link style, "Tap a hexagon"), never a value inside svgFor.
 * The dot case reads the places mapDots returns, as map-zoom.spec.ts does.
 *
 * Node project: pure rendering.
 */
// @born-red landing hexagon link limits | method: 11 faults injected by hand into svgFor and atLeast (src/lib/attendee-map.ts), one at a time, each put back, each turning this file red (the whole-frame limit at 95 units; the taller box's floor at 61 units; step 2 at 45 units; step 3 at 37 units; the left edge at 121 units; the right edge at 479 units; a letter counted as 8 units; the name left out of the box; the largest hexagon deciding; the hexagon's height alone counted; a size exactly on its limit not counted); nine of the eleven left map-zoom, attendee-map, street-map-landing and landing-area specs green. StrykerJS, local runs of group map: the mutant that lets the largest hexagon decide (`Math.min` to `Math.max`) seen Killed by a case here; and, on the source before its comparisons went through atLeast, each of the 18 mutants CI run 43749533056 reported as survived seen Killed by a case here | date: 2026-11-15
// @born-red two places exactly two touch targets apart | method: the StrykerJS mutant `<` to `<=` against DOT_MERGE in mapDots, which survived on main as well, seen Killed by the case here in a local run of group map; and the same fault injected by hand, which turned this file red and left the other map specs green | date: 2026-11-15
import { describe, expect, test, vi } from 'vitest';
import {
  cellToBoundary,
  cellToChildren,
  cellToLatLng,
  gridDisk,
  gridDistance,
  latLngToCell,
} from 'h3-js';
import {
  DOT_MERGE,
  mapDots,
  renderAttendeeMap,
  type AttendeeMapItem,
  type ZoomEvent,
} from '../src/lib/attendee-map';
import { LINK_FROM_PX, LINK_STYLE, MAP_GUTTER_PX, MAP_MAX_PX } from '../src/lib/map-link-style';
import { MAP_H, MAP_W } from '../src/lib/street-map';

/** Where this spec draws each corner and middle, by its latitude and longitude. */
const placed = vi.hoisted(() => new Map<string, [number, number]>());

vi.mock('../src/lib/street-map', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/street-map')>();
  return {
    ...real,
    project: (_frame: unknown, lat: number, lng: number): [number, number] => {
      const at = placed.get(`${lat},${lng}`);
      // A point no case placed would be drawn by the real projection, and the
      // case would no longer say what it draws.
      if (!at) throw new Error(`map-limits: no place given for ${lat},${lng}`);
      return at;
    },
  };
});

const NOW = Date.parse('2026-11-09T12:00:00Z');
const SOON = '2026-11-20';
// Real areas round Blue Island IL, no two of them neighbours: neighbours share
// corners, and a case draws each area's corners where it says.
const CELLS = gridDisk(latLngToCell(41.6565, -87.681, 7), 4).reduce<string[]>(
  (apart, c) => (apart.every((a) => gridDistance(a, c) >= 2) ? [...apart, c] : apart),
  []
);

// The limits, counted here from the screens and not read out of the renderer.
const TOUCH_PX = 44;
/** The narrowest phone's map: 320 px less the page's gutters. */
const PHONE_MAP_PX = 320 - MAP_GUTTER_PX;
/** Map units a hexagon must span to be 44 px when `shown` units fill a map `mapPx` wide. */
const unitsFor = (shown: number, mapPx: number) => (TOUCH_PX * shown) / mapPx;
/** 44 px on the phone with the whole 600-unit frame on show: a link at every width. */
const WHOLE = unitsFor(MAP_W, PHONE_MAP_PX);
/** 44 px on the whole frame at each step of the link style (480, 640 and 760 px screens). */
const STEPS = LINK_FROM_PX.map((px) => unitsFor(MAP_W, Math.min(px - MAP_GUTTER_PX, MAP_MAX_PX)));
const [STEP1, STEP2, STEP3] = STEPS as [number, number, number];
/**
 * The taller box: the phone shows the middle 360 units, and at 480 px the whole
 * frame is back, so a hexagon must be 44 px in both.
 */
const TALL = Math.max(unitsFor(MAP_H, PHONE_MAP_PX), STEP1);
/** The square a phone shows in the taller box: the middle 360 of the 600 units. */
const LEFT = (MAP_W - MAP_H) / 2;
const RIGHT = MAP_W - LEFT;
/** One step off a limit: far less than a pixel, and more than a rounding error. */
const HAIR = 1e-9;

/** One hexagon as a case draws it: its box, and optionally its middle and its town. */
interface Drawn {
  x0: number;
  x1: number;
  /** The box runs from 0 to `high`, so its height is exactly `high`. */
  high: number;
  /** Where the number and the name are centred; the middle of the box unless given. */
  mid?: number;
  /** The area's name, drawn under its number while the map has four areas or fewer. */
  town?: string;
}

/** The landing map over these hexagons, the i-th drawn for the i-th area. */
function landing(drawn: readonly Drawn[], opts: { link?: boolean } = {}): string {
  placed.clear();
  const items: AttendeeMapItem[] = drawn.map((d, i) => {
    const cell = CELLS[i]!;
    const half = d.high / 2;
    // Six corners with the box the case names. The rule counts the box.
    const corners: [number, number][] = [
      [d.x0, 0],
      [d.x1, 0],
      [d.x1, half],
      [d.x1, d.high],
      [d.x0, d.high],
      [d.x0, half],
    ];
    const place = (lat: number, lng: number, at: [number, number]) => {
      if (placed.has(`${lat},${lng}`)) throw new Error(`map-limits: ${cell} shares a point`);
      placed.set(`${lat},${lng}`, at);
    };
    cellToBoundary(cell).forEach(([lat, lng], k) => place(lat, lng, corners[k % corners.length]!));
    place(...cellToLatLng(cell), [d.mid ?? (d.x0 + d.x1) / 2, half]);
    return {
      id: `e${i}`,
      name: `Event ${i}`,
      startDateISO: SOON,
      phase: 'pre_event',
      h3_res7: cell,
      where_address: d.town ? `Hall, ${d.town}, IL` : undefined,
    };
  });
  return renderAttendeeMap(items, {
    now: NOW,
    area: { count: 10, min: 10 },
    zoomHref: opts.link === false ? undefined : (c) => `/?area=${c}`,
  }).html;
}

const TAP = 'Tap a hexagon to see its events on the map.';

/**
 * What a visitor gets, read out of the page: `links` is 0 when every hexagon is
 * a link at every width, 1 to 3 when it is one from that step of the link
 * style, null when no hexagon is a link; `tall` is the taller box on a phone.
 * Every part of the page that goes with each answer is checked on the way.
 */
function page(html: string, areas: number): { links: 0 | 1 | 2 | 3 | null; tall: boolean } {
  const hexagons = [
    ...html.matchAll(
      /<g data-testid="amap-area" data-cell="[0-9a-f]{15}" data-count="1" data-tip="[^"]+">(<a (?:class="amap-w(\d)" )?href="\/\?area=[0-9a-f]{15}" data-testid="amap-area-link">)?/g
    ),
  ].map((m) => (!m[1] ? null : m[2] ? Number(m[2]) : 0));
  expect(hexagons).toHaveLength(areas);
  // The smallest hexagon decides for the whole map: every hexagon the same.
  expect(new Set(hexagons).size).toBe(1);
  const links = hexagons[0] as 0 | 1 | 2 | 3 | null;

  // A hexagon that is a link from a step is drawn twice, and the style that
  // picks one of the two is sent; otherwise neither is there.
  const stepped = links === 1 || links === 2 || links === 3;
  expect(html.includes(LINK_STYLE)).toBe(stepped);
  expect(html.match(/<g class="amap-n\d">/g) ?? []).toEqual(
    stepped ? Array.from({ length: areas }, () => `<g class="amap-n${links}">`) : []
  );
  // "Tap a hexagon" is said where a hexagon is a link, from the same step.
  const caption = /<figcaption [^>]*>(.*?)<\/figcaption>/.exec(html)![1]!;
  if (links === null) expect(caption).not.toContain('Tap a hexagon');
  else if (links === 0) expect(caption.endsWith(`never a street address. ${TAP}`)).toBe(true);
  else
    expect(caption).toContain(`<span class="amap-w${links}" data-testid="amap-tap">${TAP}</span>`);

  // The taller box: the figure says so for the phone's rule, and the drawing is
  // cut at its sides to fill it. Both or neither.
  const tall = html.includes('<figure class="amap" data-testid="amap" data-tall>');
  if (!tall) expect(html).toContain('<figure class="amap" data-testid="amap">');
  expect(html.includes(' preserveAspectRatio="xMidYMid slice"')).toBe(tall);
  return { links, tall };
}

/** A hexagon that reaches the frame's left edge: never in the phone's square. */
const atTheSide = (high: number): Drawn => ({ x0: 0, x1: 300, high });
/** A hexagon well inside the phone's square, 120 units wide. */
const inTheMiddle = (high: number): Drawn => ({ x0: 240, x1: 360, high });

describe('the limits, in map units', () => {
  test('44 px on each screen the rule counts with', () => {
    expect(WHOLE).toBeCloseTo(94.2857, 4);
    expect(STEPS).toEqual([60, 44, 26400 / 720]);
    expect(STEP3).toBeCloseTo(36.6667, 4);
    // 56.6 units are 44 px in the taller box on the phone; 480 px asks for 60.
    expect(unitsFor(MAP_H, PHONE_MAP_PX)).toBeCloseTo(56.5714, 4);
    expect(TALL).toBe(60);
    expect([LEFT, RIGHT]).toEqual([120, 480]);
  });
});

describe('how large the smallest hexagon is decides where hexagons are links', () => {
  // Areas that reach the side of the frame: the taller box would cut them, so
  // the whole frame is on show at every width.
  test.each([
    ['exactly 44 px on the narrowest phone', WHOLE, 0],
    ['a hair under 44 px on the phone', WHOLE - HAIR, 1],
    ['exactly 44 px at 480 px', STEP1, 1],
    ['a hair under 44 px at 480 px', STEP1 - HAIR, 2],
    ['exactly 44 px at 640 px', STEP2, 2],
    ['a hair under 44 px at 640 px', STEP2 - HAIR, 3],
    ['exactly 44 px at 760 px, the widest map', STEP3, 3],
    ['a hair under 44 px on the widest map', STEP3 - HAIR, null],
  ] as const)('on the whole frame, %s', (_name, high, links) => {
    expect(page(landing([atTheSide(high)]), 1)).toEqual({ links, tall: false });
  });

  // Areas in the middle of the frame: from 60 units a phone shows the middle
  // square, where they are 44 px, and they are links at every width.
  test.each([
    ['exactly 44 px on the phone needs no taller box', WHOLE, 0, false],
    ['a hair under it, the taller box makes it a link on the phone', WHOLE - HAIR, 0, true],
    ['exactly 44 px at 480 px, the taller box is still enough', TALL, 0, true],
    ['a hair under 44 px at 480 px, no taller box: a link from 640 px', TALL - HAIR, 2, false],
    ['exactly 44 px at 640 px', STEP2, 2, false],
    ['a hair under 44 px on the widest map', STEP3 - HAIR, null, false],
  ] as const)('in the middle of the frame, %s', (_name, high, links, tall) => {
    expect(page(landing([inTheMiddle(high)]), 1)).toEqual({ links, tall });
  });

  test('the box is counted both ways: a hexagon narrower than it is high goes by its width', () => {
    // 50 units wide and 200 high: 44 px from 640 px, whatever its height.
    expect(page(landing([{ x0: 300, x1: 350, high: 200 }]), 1)).toEqual({ links: 2, tall: false });
    // And 200 wide, 50 high: the same.
    expect(page(landing([{ x0: 200, x1: 400, high: 50 }]), 1)).toEqual({ links: 2, tall: false });
  });

  test('the smallest hexagon decides, wherever it comes in the list', () => {
    const large = atTheSide(100);
    const small = { x0: 300, x1: 600, high: STEP1 - HAIR };
    expect(page(landing([large, small]), 2)).toEqual({ links: 2, tall: false });
    expect(page(landing([small, large]), 2)).toEqual({ links: 2, tall: false });
    // One hexagon under the taller box's floor, and the map keeps its whole frame.
    expect(page(landing([inTheMiddle(80), inTheMiddle(TALL - HAIR)]), 2)).toEqual({
      links: 2,
      tall: false,
    });
    expect(page(landing([inTheMiddle(80), inTheMiddle(TALL)]), 2)).toEqual({
      links: 0,
      tall: true,
    });
  });

  test('with no zoom link no hexagon is a link and no box is taller, at any size', () => {
    for (const high of [WHOLE, WHOLE - HAIR, TALL, STEP2, STEP3]) {
      for (const hexagon of [atTheSide(high), inTheMiddle(high)]) {
        const html = landing([hexagon], { link: false });
        expect(page(html, 1)).toEqual({ links: null, tall: false });
        expect(html).not.toContain('amap-zoom');
      }
    }
  });
});

describe('the taller box is used only where it cuts no area', () => {
  // Hexagons 60 units high: links at every width in the taller box, and links
  // from 480 px only (step 1) where the box would cut one of them.
  const kept = { links: 0, tall: true };
  const whole = { links: 1, tall: false };

  test('a hexagon may end exactly at the edge of the square, and not a hair past it', () => {
    expect(page(landing([{ x0: LEFT, x1: LEFT + 120, high: TALL }]), 1)).toEqual(kept);
    expect(page(landing([{ x0: LEFT - HAIR, x1: LEFT + 120, high: TALL }]), 1)).toEqual(whole);
    expect(page(landing([{ x0: RIGHT - 120, x1: RIGHT, high: TALL }]), 1)).toEqual(kept);
    expect(page(landing([{ x0: RIGHT - 120, x1: RIGHT + HAIR, high: TALL }]), 1)).toEqual(whole);
    // From edge to edge of the square.
    expect(page(landing([{ x0: LEFT, x1: RIGHT, high: TALL }]), 1)).toEqual(kept);
  });

  test('every area must be inside it: one that is not keeps the whole frame for all', () => {
    const inside = inTheMiddle(TALL);
    expect(page(landing([inside, { x0: LEFT, x1: RIGHT, high: TALL }]), 2)).toEqual(kept);
    expect(page(landing([inside, { x0: LEFT - 1, x1: 300, high: TALL }]), 2)).toEqual(whole);
    expect(page(landing([{ x0: 300, x1: RIGHT + 1, high: TALL }, inside]), 2)).toEqual(whole);
  });

  // A name is drawn centred under the area's number, 9 units to each side for
  // every letter. It is part of what the box must not cut.
  const TEN = 'Abcdefghij';
  const ELEVEN = 'Abcdefghijk';
  // The names on show: a hexagon drawn as a link and plain carries its name in both.
  const named = (html: string) =>
    [
      ...html
        .replace(/<g class="amap-n\d">.*?<\/g>/g, '')
        .matchAll(/data-testid="amap-area-name">([^<]*)<\/tspan>/g),
    ].map((m) => m[1]);

  test('a name may end exactly at the edge of the square, and not a letter past it', () => {
    // On the left: the hexagon is inside (150 to 270), its name centred on 210.
    const left = (town?: string): Drawn => ({ x0: 150, x1: 270, high: TALL, town });
    expect(page(landing([left()]), 1)).toEqual(kept);
    const ten = landing([left(TEN)]);
    expect(named(ten)).toEqual([TEN]);
    expect(page(ten, 1)).toEqual(kept); // 210 - 90 = 120
    const eleven = landing([left(ELEVEN)]);
    expect(named(eleven)).toEqual([ELEVEN]);
    expect(page(eleven, 1)).toEqual(whole); // 210 - 99 = 111
    // On the right: 330 to 450, its name centred on 390.
    const right = (town?: string): Drawn => ({ x0: 330, x1: 450, high: TALL, town });
    expect(page(landing([right()]), 1)).toEqual(kept);
    expect(page(landing([right(TEN)]), 1)).toEqual(kept); // 390 + 90 = 480
    expect(page(landing([right(ELEVEN)]), 1)).toEqual(whole); // 390 + 99 = 489
  });

  test('the name counted is the name as drawn: cut to 16 letters, and where it is centred', () => {
    const long = 'Abcdefghijklmnopqrst';
    // Sixteen letters drawn (the last one "…"), 144 units to each side.
    const at = (mid: number): Drawn => ({ x0: 250, x1: 350, high: TALL, mid, town: long });
    const edge = landing([at(LEFT + 144)]);
    expect(named(edge)).toEqual(['Abcdefghijklmno…']);
    expect(page(edge, 1)).toEqual(kept);
    expect(page(landing([at(LEFT + 143)]), 1)).toEqual(whole);
    expect(page(landing([at(RIGHT - 144)]), 1)).toEqual(kept);
    expect(page(landing([at(RIGHT - 143)]), 1)).toEqual(whole);
  });

  test('names are not drawn on a map of more than four areas, and then do not count', () => {
    // Each area 64 units below the one before (its middle is half its height),
    // so no name lies over another area's name or number (grade, 2026-11-17).
    const area = (k = 0): Drawn => ({ x0: 150, x1: 270, high: TALL + 128 * k, town: ELEVEN });
    const four = landing([area(0), area(1), area(2), area(3)]);
    expect(named(four)).toEqual([ELEVEN, ELEVEN, ELEVEN, ELEVEN]);
    expect(page(four, 4)).toEqual(whole);
    const five = landing([area(), area(), area(), area(), area()]);
    expect(named(five)).toEqual([]);
    expect(page(five, 5)).toEqual(kept);
  });
});

describe('two places on a zoomed area are one when their touch targets overlap', () => {
  // A dot's touch target is a circle 39 units in radius, so two dots 78 units
  // apart touch and do not overlap: each can still be tapped, and they stay two
  // places. Any nearer and one lies over the other, so they are one place.
  const AREA = CELLS[0]!;
  const [BLOCK_A, BLOCK_B] = cellToChildren(AREA, 9) as [string, string];
  // OSE-2197: an event reaches the zoomed map with its res-9 cell, never a point.
  const at = (id: string, block: string): ZoomEvent => ({
    id,
    name: `Event ${id}`,
    startDateISO: SOON,
    phase: 'pre_event',
    h3_res9: block,
  });
  /** The places of two events, one on each block, the blocks drawn `apart` units apart. */
  const places = (apart: number) => {
    placed.clear();
    placed.set(cellToLatLng(BLOCK_A).join(','), [100, 100]);
    placed.set(cellToLatLng(BLOCK_B).join(','), [100 + apart, 100]);
    return mapDots(AREA, [at('a', BLOCK_A), at('b', BLOCK_B)]).dots.map((d) =>
      d.events.map((e) => e.id)
    );
  };

  test('exactly two touch targets apart they are two places; a hair nearer, one', () => {
    expect(DOT_MERGE).toBe(78);
    expect(places(DOT_MERGE)).toEqual([['a'], ['b']]);
    expect(places(DOT_MERGE - HAIR)).toEqual([['a', 'b']]);
    expect(places(DOT_MERGE + HAIR)).toEqual([['a'], ['b']]);
  });
});
