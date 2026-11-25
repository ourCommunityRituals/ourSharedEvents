/**
 * The map's georeference is the cell's, nothing finer (OSE-2150; AGENTS.md
 * invariant 3, place, not person).
 *
 * With a street layer, the map's `<svg>` carries its frame (`data-x0`,
 * `data-y0`, `data-scale`, `data-mpu`) and each area its centre (`data-ll`), so
 * the map's script can place the phone's own position on the drawing
 * (lib/map-pan-script.ts). Zoomed in on one area, each place's dot also carries
 * its own point (`data-ll`, OSE-2198; owner 2026-11-19: the distance from the
 * person to an event is measured to the event's res-9 cell): the centre of the
 * res-9 cell the dot is drawn at. These are the only coordinate-shaped numbers
 * on the page. This file proves they say no more than the cells the page
 * already shows:
 *   - the frame and the area's centre are the same whatever the events and
 *     wherever they are: they come from the area's res-7 cell id alone;
 *   - moving any event anywhere inside its res-9 block changes no byte of the
 *     zoomed page (and anywhere inside its res-7 area, no byte of the area map),
 *     so nothing finer than the block can be read from it, by any means;
 *   - each dot, read back through the page's own frame, is its block's centre;
 *   - each dot's own point is exactly that block's centre, to five decimals,
 *     pinned per cell: worked out here from the cell id the dot's drawing reads
 *     back to, never read off the page, and never an event's own point;
 *   - nothing else in the zoomed part has the shape of a coordinate.
 *
 * The staging layer is the Bruno request "OSE-1891 - GET area (seeded)" in
 * bruno/ose-pages/16. Landing Map Zoom; it pins the same strings as FIXTURE_*
 * below, for the same cells, so the two layers cannot drift.
 *
 * Node project: pure rendering.
 *
 * @born-red georeference is cell-only (OSE-2150) | method: 8 faults injected
 *   into src/lib/attendee-map.ts one at a time, each put back (a dot drawn at
 *   the event's own point, the area centre taken from the first dot, the frame
 *   fitted around the dots' blocks, x0 written to 12 decimals, a dot carrying
 *   its point as a data attribute, the touch target drawn off its dot, a point
 *   in micro-degrees, an area-map centre that is not its cell's); each turned
 *   this file red | date: 2026-11-18
 * @born-red each place's own point is its res-9 cell's (OSE-2198) | method:
 *   first, the dots' new `data-ll` with this file as it was: the coordinate scan
 *   went red in all four areas. Then, with this file extended, 7 faults injected
 *   into src/lib/attendee-map.ts one at a time, each put back (a dot's point
 *   written from its first event's own lat/lon; from the area's centre; from a
 *   neighbouring block's centre; to six decimals; the event's own point added
 *   as a second attribute; a merged dot's point taken from the block merged
 *   into it; the dot's point written on the dot's touch target too); each
 *   turned this file red. After the security review, each dot given back a
 *   list of its event ids: red too | date: 2026-11-19
 */
import { describe, expect, test } from 'vitest';
import { cellToBoundary, cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import { DOT_MERGE, renderAttendeeMap, type ZoomEvent } from '../src/lib/attendee-map';
import { MAP_H, MAP_W, cellsKey, frameForCells, project } from '../src/lib/street-map';

const NOW = Date.parse('2026-11-18T12:00:00Z');

// The staging fixture (bruno/fixtures/map-zoom-area-seed.sql): one area, three
// places, the first a business.
const FIXTURE_CELL = '872664405ffffff';
const FIXTURE_POINTS: [number, number, string][] = [
  [41.621, -87.8555, 'business'],
  [41.6119, -87.8657, 'address'],
  [41.6061, -87.8483, 'address'],
];
// Pinned in the Bruno check too. Change both or neither.
const FIXTURE_FRAME =
  'data-x0="0.255867824" data-y0="0.372606262" data-scale="3363057.841" data-mpu="8.909"';
const FIXTURE_CENTRE = 'data-ll="41.61285,-87.85547"';
// Each place's own point: its res-9 cell's centre, by the number on its dot
// (north is 1). Pinned in the Bruno check too. Change both or neither.
const FIXTURE_PLACES: Record<number, [cell: string, ll: string]> = {
  1: ['892664405d7ffff', 'data-ll="41.62094,-87.85603"'], // the business
  2: ['89266440547ffff', 'data-ll="41.61159,-87.86385"'],
  3: ['89266440537ffff', 'data-ll="41.60601,-87.84653"'],
};
const MILE = 'MPU / unitPx() / 1609.344';
// Coordinate-shaped: three or more decimals (a degree to about 110 m anywhere, a
// radian, a fraction of the frame) or seven or more digits in a row (micro-degrees).
const COORD = /\d\.\d{3,}|\d{7,}/;
/** Undo URL escapes first, so "%2060406" (a space and a ZIP) is not a run of seven digits, and "%2E" is a dot. */
const unescaped = (t: string) => t.replace(/%2e/gi, '.').replace(/%[0-9a-f]{2}/gi, ' ');

// Areas on both sides of the equator and the meridian: the rules hold anywhere.
const CELLS = [
  FIXTURE_CELL,
  latLngToCell(-33.8688, 151.2093, 7), // Sydney
  latLngToCell(51.5007, -0.1246, 7), // London, both signs of longitude nearby
  latLngToCell(-12.0464, -77.0428, 7), // Lima
];

const streetsFor = (cells: string[]) => ({
  cellsKey: cellsKey(cells),
  svg: '<g data-testid="amap-streets"></g>',
});

// The event carries its point beside its stored res-9 cell, so a map that read
// the point instead of the cell (OSE-2197) would draw it off its block centre.
function ev(
  i: number,
  cell: string,
  lat: number,
  lon: number,
  kind = 'address'
): ZoomEvent & { lat: number; lon: number } {
  return {
    id: `e${i}`,
    name: `Event ${i}`,
    startDateISO: '2026-11-25',
    phase: 'pre_event',
    h3_res7: cell,
    h3_res9: latLngToCell(lat, lon, 9),
    lat,
    lon,
    place_kind: kind,
    classes: [],
    // What an organizer types: the names and the street address the event page shows.
    venue: `Hall ${i}`,
    location: `Hall ${i}`,
    where_address: `${1200 + i} S Main St, Blue Island, IL 60406`,
  };
}

const zoomPage = (cell: string, events: ZoomEvent[]) =>
  renderAttendeeMap([], {
    now: NOW,
    zoom: { cell, events, backHref: '/' },
    streets: streetsFor([cell]),
  }).html;

/** A point inside a cell: `t` of the way from its centre to its `k`th corner. */
function inside(cell: string, k: number, t: number): [number, number] {
  const [clat, clng] = cellToLatLng(cell);
  const ring = cellToBoundary(cell);
  const [vlat, vlng] = ring[k % ring.length]!;
  return [clat + (vlat - clat) * t, clng + (vlng - clng) * t];
}

/** Res-9 blocks of an area, drawn far enough apart that no two dots merge. */
function blocksIn(cell: string, n: number): string[] {
  const frame = frameForCells([cell], MAP_W, MAP_H);
  const xy = (b: string) => project(frame, ...cellToLatLng(b));
  const centre = latLngToCell(...cellToLatLng(cell), 9);
  const out: string[] = [];
  for (const b of gridDisk(centre, 8)) {
    if (out.length >= n) break;
    if (latLngToCell(...cellToLatLng(b), 7) !== cell) continue;
    const [x, y] = xy(b);
    if (out.every((o) => Math.hypot(xy(o)[0] - x, xy(o)[1] - y) > DOT_MERGE + 10)) out.push(b);
  }
  return out;
}

const tagOf = (html: string, testid: string) => {
  const at = html.indexOf(`data-testid="${testid}"`);
  return at < 0 ? '' : html.slice(at).match(/^[^>]*>/)![0];
};
const frameOf = (html: string) => {
  const svg = tagOf(html, 'amap-svg');
  const m = svg.match(/data-x0="[^"]+" data-y0="[^"]+" data-scale="[^"]+" data-mpu="[^"]+"/);
  return m ? m[0] : '';
};
const centreOf = (html: string) => (tagOf(html, 'amap-zone').match(/data-ll="[^"]+"/) || [''])[0];
/** A cell's centre as the page may write it, worked out here from the cell id alone. */
const pointOf = (cell: string) =>
  `data-ll="${cellToLatLng(cell)
    .map((v) => v.toFixed(5))
    .join(',')}"`;
/** Each dot's opening tag, by its number. */
const dotTags = (html: string) =>
  new Map(
    [...html.matchAll(/<a href="#amap-dot-(\d+)"[^>]*data-testid="amap-dot"[^>]*>/g)].map(
      (m) => [Number(m[1]), m[0]] as const
    )
  );

function metres(a: [number, number], b: [number, number]): number {
  const k = 111_195;
  return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * k * Math.cos((a[0] * Math.PI) / 180));
}

/** Each dot of a zoomed page, read back through the page's own frame. */
function readBack(html: string): { n: number; at: [number, number] }[] {
  const num = (name: string) =>
    Number(tagOf(html, 'amap-svg').match(new RegExp(`${name}="([^"]+)"`))![1]);
  const [x0, y0, scale] = [num('data-x0'), num('data-y0'), num('data-scale')];
  // Each dot is one link: its touch target, dot and number. All three are drawn
  // at one point, and that point is read back.
  const re = /<a href="#amap-dot-(\d+)"[^>]*data-testid="amap-dot"[^>]*>([\s\S]*?)<\/a>/g;
  const out: { n: number; at: [number, number] }[] = [];
  for (const m of html.matchAll(re)) {
    const xs = [...m[2]!.matchAll(/\s(?:cx|x)="([^"]*)"/g)].map((v) => v[1]);
    const ys = [...m[2]!.matchAll(/\s(?:cy|y)="([^"]*)"/g)].map((v) => v[1]);
    expect(xs.length).toBe(3);
    expect(ys.length).toBe(3);
    expect(new Set(xs).size).toBe(1);
    expect(new Set(ys).size).toBe(1);
    const wy = y0 + Number(ys[0]) / scale;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI;
    const lng = (x0 + Number(xs[0]) / scale) * 360 - 180;
    out.push({ n: Number(m[1]), at: [lat, lng] });
  }
  return out;
}

const zoomedPart = (html: string) => html.slice(html.indexOf('data-testid="amap-wrap"'));

describe("the georeference on the zoomed map is the area cell's (OSE-2150)", () => {
  test("the staging fixture's area writes the frame and centre the Bruno check pins", () => {
    const html = zoomPage(
      FIXTURE_CELL,
      FIXTURE_POINTS.map(([la, ln, k], i) => ev(i, FIXTURE_CELL, la, ln, k))
    );
    expect(frameOf(html)).toBe(FIXTURE_FRAME);
    expect(centreOf(html)).toBe(FIXTURE_CENTRE);
    expect(FIXTURE_CENTRE).toBe(
      `data-ll="${cellToLatLng(FIXTURE_CELL)
        .map((v) => v.toFixed(5))
        .join(',')}"`
    );
  });

  test("the staging fixture's places each write the point the Bruno check pins: their res-9 cell's centre", () => {
    const html = zoomPage(
      FIXTURE_CELL,
      FIXTURE_POINTS.map(([la, ln, k], i) => ev(i, FIXTURE_CELL, la, ln, k))
    );
    const tags = dotTags(html);
    expect([...tags.keys()]).toEqual([1, 2, 3]);
    for (const [n, [cell, ll]] of Object.entries(FIXTURE_PLACES)) {
      const [la, ln] = FIXTURE_POINTS[Number(n) - 1]!;
      // The pin is the cell's centre, and the cell is the place's own block.
      expect(latLngToCell(la, ln, 9)).toBe(cell);
      expect(pointOf(cell)).toBe(ll);
      expect(tags.get(Number(n))!.match(/data-ll="[^"]+"/g)).toEqual([ll]);
      expect(html.split(ll).length - 1, `place ${n} is written once`).toBe(1);
      // Never the seeded point itself, at any precision the page could write.
      for (const dp of [3, 4, 5, 6]) {
        expect(html).not.toContain(`${la.toFixed(dp)},${ln.toFixed(dp)}`);
      }
    }
  });

  test.each(CELLS)('in %s the frame and the centre do not move when the places do', (cell) => {
    const sets = [blocksIn(cell, 1), blocksIn(cell, 3), blocksIn(cell, 5).slice(2)].map((bs) =>
      bs.map((b, i) => ev(i, cell, ...cellToLatLng(b), i ? 'address' : 'business'))
    );
    const pages = sets.map((s) => zoomPage(cell, s));
    expect(frameOf(pages[0]!)).not.toBe('');
    for (const p of pages) {
      expect(frameOf(p)).toBe(frameOf(pages[0]!));
      expect(centreOf(p)).toBe(centreOf(pages[0]!));
    }
    expect(centreOf(pages[0]!)).toBe(
      `data-ll="${cellToLatLng(cell)
        .map((v) => v.toFixed(5))
        .join(',')}"`
    );
  });

  test.each(CELLS)(
    'in %s moving every event anywhere inside its res-9 block changes no byte of the page',
    (cell) => {
      const blocks = blocksIn(cell, 4);
      expect(blocks.length).toBe(4);
      const render = (t: number, k: number) =>
        zoomPage(
          cell,
          blocks.map((b, i) => {
            const p = inside(b, k + i, t);
            expect(latLngToCell(p[0], p[1], 9)).toBe(b);
            return ev(i, cell, p[0], p[1], i ? 'address' : 'business');
          })
        );
      const base = render(0, 0);
      expect(base).toContain('data-testid="amap-dot"');
      for (const [t, k] of [
        [0.3, 0],
        [0.6, 2],
        [0.9, 4],
        [0.95, 5],
      ] as const) {
        expect(render(t, k)).toBe(base);
      }
    }
  );

  test.each(CELLS)(
    "in %s each dot, read back through the page's frame, is its block centre",
    (cell) => {
      const blocks = blocksIn(cell, 4);
      // Every event sits off its block centre, as a real business does.
      const events = blocks.map((b, i) =>
        ev(i, cell, ...inside(b, i, 0.7), i ? 'address' : 'business')
      );
      const html = zoomPage(cell, events);
      const back = readBack(html);
      expect(back.length).toBe(blocks.length);
      for (const { at } of back) {
        const block = latLngToCell(at[0], at[1], 9);
        expect(blocks).toContain(block);
        // Written to a tenth of a map unit: well under a metre at any latitude here.
        expect(metres(at, cellToLatLng(block) as [number, number])).toBeLessThan(1);
        const own = events[blocks.indexOf(block)]!;
        expect(metres(at, [own.lat as number, own.lon as number])).toBeGreaterThan(20);
      }
    }
  );

  test.each(CELLS)(
    "in %s each dot's own point is its block's centre, pinned to the cell and never the event's",
    (cell) => {
      const blocks = blocksIn(cell, 4);
      const events = blocks.map((b, i) =>
        ev(i, cell, ...inside(b, i, 0.7), i ? 'address' : 'business')
      );
      const html = zoomPage(cell, events);
      const tags = dotTags(html);
      const back = readBack(html);
      expect(tags.size).toBe(blocks.length);
      for (const { n, at } of back) {
        // The block is the one the dot's drawing reads back to; its point is
        // worked out here from that cell id alone, not read off the page.
        const block = latLngToCell(at[0], at[1], 9);
        const own = events[blocks.indexOf(block)]!;
        const lls = tags.get(n)!.match(/data-ll="[^"]+"/g);
        expect(lls).toEqual([pointOf(block)]);
        const [lat, lng] = lls![0]!.slice(9, -1).split(',').map(Number) as [number, number];
        // Five decimals of the centre: inside the block, within a metre or two of
        // its centre, and well away from where the event itself is.
        expect(latLngToCell(lat, lng, 9)).toBe(block);
        expect(metres([lat, lng], cellToLatLng(block) as [number, number])).toBeLessThan(2);
        expect(metres([lat, lng], [own.lat as number, own.lon as number])).toBeGreaterThan(20);
        // The same events on another point of the same block: the same point.
        expect(pointOf(latLngToCell(own.lat as number, own.lon as number, 9))).toBe(lls![0]);
      }
    }
  );

  test.each(CELLS)(
    "in %s the zoomed part holds no coordinate-shaped number but the cell's frame, its centre, each place's own block centre and the metres in a mile",
    (cell) => {
      // The first block is the area's centre child, whose centre is the area's
      // own: a place there writes the same point as the area, on its own dot.
      const blocks = blocksIn(cell, 3);
      expect(cellToLatLng(blocks[0]!)).toEqual(cellToLatLng(cell));
      const html = zoomPage(
        cell,
        blocks.map((b, i) => ev(i, cell, ...inside(b, i, 0.5), i ? 'address' : 'business'))
      );
      let part = zoomedPart(html);
      const frame = frameOf(html);
      const centre = centreOf(html);
      expect(part.split(frame).length - 1).toBe(1);
      // The area's centre is on the area's outline, once.
      const zone = tagOf(html, 'amap-zone');
      expect(zone.match(/data-ll="[^"]+"/g)).toEqual([centre]);
      part = part.replace(zone, zone.replace(centre, ''));
      // Each place's point is on its own dot, once, and is the centre of the
      // block that dot reads back to (worked out here, not read off the page).
      const back = readBack(html);
      expect(back.length).toBe(3);
      for (const [n, tag] of dotTags(html)) {
        const at = back.find((b) => b.n === n)!.at;
        const own = pointOf(latLngToCell(at[0], at[1], 9));
        expect(tag.match(/data-ll="[^"]+"/g)).toEqual([own]);
        part = part.replace(tag, tag.replace(own, ''));
      }
      // The area's own cell id is the one run of seven digits allowed.
      const rest = part.replace(frame, '').replace(MILE, '').split(cell).join('');
      expect(unescaped(rest).match(COORD)?.[0] ?? null).toBe(null);
    }
  );

  test('a dot carries its point and no event id: which events are at a place is its panel, as before', () => {
    const blocks = blocksIn(FIXTURE_CELL, 3);
    const html = zoomPage(
      FIXTURE_CELL,
      blocks.map((b, i) => ev(i, FIXTURE_CELL, ...inside(b, i, 0.5), i ? 'address' : 'business'))
    );
    for (const [, tag] of dotTags(html)) {
      expect(tag.match(/\sdata-[a-z-]+=/g)).toEqual([
        ' data-testid=',
        ' data-exact=',
        ' data-count=',
        ' data-ll=',
        ' data-tip=',
      ]);
      expect(tag).not.toMatch(/\be\d\b/);
    }
  });

  test("two blocks near enough to merge are one dot, drawn at the first block's centre", () => {
    const [first] = blocksIn(FIXTURE_CELL, 1);
    const next = gridDisk(first!, 1).find(
      (b) => b !== first && latLngToCell(...cellToLatLng(b), 7) === FIXTURE_CELL
    )!;
    const html = zoomPage(FIXTURE_CELL, [
      ev(0, FIXTURE_CELL, ...inside(first!, 0, 0.8), 'business'),
      ev(1, FIXTURE_CELL, ...inside(next, 3, 0.8)),
    ]);
    const back = readBack(html);
    expect(back.length).toBe(1);
    const block = latLngToCell(back[0]!.at[0], back[0]!.at[1], 9);
    expect([first, next]).toContain(block);
    expect(metres(back[0]!.at, cellToLatLng(block) as [number, number])).toBeLessThan(1);
    // Its own point is the block it is drawn at; the block merged into it is
    // written nowhere, and the dot holds both events.
    const other = block === first ? next : first!;
    const tag = dotTags(html).get(1)!;
    expect(tag.match(/data-ll="[^"]+"/g)).toEqual([pointOf(block)]);
    expect(tag).toContain('data-count="2"');
    // (The area's centre child shares the area's centre, which its outline carries.)
    const asArea = pointOf(other) === pointOf(FIXTURE_CELL) ? 1 : 0;
    expect(html.split(pointOf(other).slice(9, -1)).length - 1).toBe(asArea);
  });
});

describe("the georeference on the area map is the drawn cells' (OSE-2150)", () => {
  // The area map draws hexagons from each event's res-7 cell; AttendeeMapItem
  // has no point at all, so today these tests hold by construction. They are a
  // guard: a later change that reads a point here (the landing hands it whole
  // public events) turns them red.
  const A = FIXTURE_CELL;
  const B = gridDisk(A, 1).find((c) => c !== A)!;
  const items = (t: number) =>
    [A, A, B].map((cell, i) => {
      const [lat, lon] = inside(cell, i, t);
      return {
        id: `a${i}`,
        name: `Area ${i}`,
        startDateISO: '2026-11-25',
        phase: 'pre_event',
        h3_res7: cell,
        lat,
        lon,
      };
    });
  const page = (t: number) =>
    renderAttendeeMap(items(t), {
      now: NOW,
      latched: new Set([A, B]),
      streets: streetsFor([A, B]),
    }).html;

  test("moving every event anywhere inside its area changes no byte, and each centre is its cell's", () => {
    const base = page(0);
    expect(base).toContain('data-x0="');
    for (const t of [0.4, 0.8, 0.95]) expect(page(t)).toBe(base);
    for (const cell of [A, B]) {
      expect(base).toContain(
        `data-cell="${cell}" data-count="${cell === A ? 2 : 1}" data-ll="${cellToLatLng(cell)
          .map((v) => v.toFixed(5))
          .join(',')}"`
      );
    }
    let rest = base.replace(frameOf(base), '').replace(MILE, '');
    for (const cell of [A, B]) {
      rest = rest
        .replace(
          `data-ll="${cellToLatLng(cell)
            .map((v) => v.toFixed(5))
            .join(',')}"`,
          ''
        )
        .split(cell)
        .join('');
    }
    expect(frameOf(base)).not.toBe('');
    expect(unescaped(rest).match(COORD)?.[0] ?? null).toBe(null);
  });
});
