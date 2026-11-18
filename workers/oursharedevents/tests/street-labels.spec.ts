/**
 * Street names and landmarks on the street map (lib/street-labels.ts; owner,
 * 2026-11-18: "improve the major street names and POI for reference"), and the
 * names group the street layer draws over the hexagons (lib/street-map.ts).
 *
 * Node project: pure functions and pure drawing. Registered in
 * vitest.node-specs.mjs.
 */
// @born-red street names and landmarks | method: faults put into lib/street-labels.ts and lib/street-map.ts one at a time, this file run, the file restored; each turned it red: names drawn under the hexagons (the group moved before the streets' end); the rotation not folded (a name upside down); a run shorter than its name accepted; the hexagon number boxes left out of `taken`; tier 2 placed at full size; a ref of any shape used as a highway's number; an unknown landmark kind drawn; the landmark budget raised; the pois decode allowed to fail the street layer; the phone band left out of placement | date: 2026-11-18
import { describe, expect, it } from 'vitest';
import {
  LANDMARK_KINDS,
  MAX_LANDMARKS,
  MAX_STREET_NAMES,
  PHONE_BAND,
  landmarkOf,
  longestRun,
  placeLabels,
  roadText,
  type RoadRun,
} from '../src/lib/street-labels';
import {
  LABELS_OPEN,
  drawStreetLayer,
  splitStreetLayer,
  type DecodedTile,
  type MapFrame,
} from '../src/lib/street-map';

const W = 600;
const H = 360;
const run = (
  text: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rank: 0 | 1 = 1
): RoadRun => ({
  text,
  rank,
  x1,
  y1,
  x2,
  y2,
});
const texts = (svg: string) => [...svg.matchAll(/>([^<>]+)<\/text>/g)].map((m) => m[1]);

describe('street names | what a road is called', () => {
  it('a highway goes by its route number, said the way people say it', () => {
    expect(roadText({ ref: 'I 55;US 66', name: 'Stevenson Expressway' }, true)).toBe('I-55');
    expect(roadText({ ref: 'US 34' }, true)).toBe('US-34');
    expect(roadText({ ref: 'IL-83' }, true)).toBe('IL-83');
  });

  it('a ref that is not a route number is not shown; the name is', () => {
    expect(roadText({ ref: 'javascript:alert(1)', name: 'Dan Ryan' }, true)).toBe('Dan Ryan');
    expect(roadText({ ref: 'I 55' }, false)).toBe('');
    expect(roadText({ name: ' Western Avenue ', 'name:en': 'Western Ave' }, false)).toBe(
      'Western Ave'
    );
    expect(roadText({ name: 7 }, false)).toBe('');
  });

  it('the longest straight step of a line is the one a name is set on', () => {
    expect(
      longestRun([
        [0, 0],
        [10, 0],
        [10, 100],
        [20, 100],
      ])
    ).toEqual([10, 0, 10, 100]);
    expect(longestRun([[5, 5]])).toBeNull();
  });
});

describe('street names | where they go', () => {
  it('a name runs with its road and is never upside down', () => {
    const right = placeLabels(W, H, [run('Western Ave', 100, 200, 400, 200)], [], []);
    expect(right).toContain('rotate(0)');
    const left = placeLabels(W, H, [run('Western Ave', 400, 200, 100, 200)], [], []);
    expect(left).toContain('rotate(0)');
    const down = placeLabels(W, H, [run('Cicero Ave', 300, 20, 300, 340)], [], []);
    expect(down).toContain('rotate(90)');
    const up = placeLabels(W, H, [run('Cicero Ave', 300, 340, 300, 20)], [], []);
    expect(up).toContain('rotate(90)');
  });

  it('a road too short for its name, or a name off the frame, is not named', () => {
    expect(placeLabels(W, H, [run('Western Avenue', 100, 200, 140, 200)], [], [])).toBe('');
    expect(placeLabels(W, H, [run('Western Ave', -300, 5, 50, 5)], [], [])).toBe('');
  });

  it('a name keeps off a hexagon number and off another name', () => {
    const number = {
      box: [200, 176, 400, 224] as [number, number, number, number],
      cx: 300,
      cy: 200,
    };
    expect(placeLabels(W, H, [run('Western Ave', 100, 200, 500, 200)], [], [number])).not.toContain(
      'class="as-n"'
    );
    const two = placeLabels(
      W,
      H,
      [run('Western Ave', 100, 200, 500, 200), run('Kedzie Ave', 120, 205, 480, 205)],
      [],
      []
    );
    // Kedzie Ave waits for the zoom (tier 2): at every zoom only one shows.
    expect([...two.matchAll(/<text class="as-n"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual([
      'Western Ave',
    ]);
  });

  it('highways first, then the longest; one name once at every zoom, at most MAX_STREET_NAMES', () => {
    const runs = Array.from({ length: 12 }, (_, i) =>
      run(`Road ${String(i).padStart(2, '0')}`, 20, 20 + i * 28, 20 + 200 + i * 10, 20 + i * 28)
    );
    runs.push(run('I-55', 20, 330, 300, 330, 0));
    const svg = placeLabels(W, H, runs, [], []);
    const first = [...svg.matchAll(/<text class="as-n"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(first).toHaveLength(MAX_STREET_NAMES);
    expect(first[0]).toBe('I-55');
    // Road 11 is the longest; its middle lies on I-55, so it is named further along.
    expect(first[1]).toBe('Road 11');
    expect(new Set(first).size).toBe(first.length);
  });

  it('the second tier waits for the zoom, and is placed as it will be seen then: at half size', () => {
    // Two roads 12 units apart: too close at full size, room enough at half.
    const svg = placeLabels(
      W,
      H,
      [run('Western Ave', 100, 200, 500, 200), run('Kedzie Ave', 120, 212, 480, 212)],
      [],
      []
    );
    expect(svg).toContain('<text class="as-n" ');
    expect(svg).toMatch(/<text class="as-n as-t2"[^>]*>Kedzie Ave</);
  });

  it('a name is text: a hostile name is escaped', () => {
    const svg = placeLabels(W, H, [run('<b onclick="x">Rd</b> & co', 20, 200, 590, 200)], [], []);
    expect(svg).toContain('&lt;b onclick=&quot;x&quot;&gt;Rd&lt;/b&gt; &amp; co');
    expect(svg).not.toContain('<b ');
  });
});

describe('landmarks', () => {
  it('only the kinds a stranger steers by, with a name', () => {
    expect(landmarkOf({ kind: 'park', name: 'Kelly Park' }, 1, 2)).toMatchObject({
      text: 'Kelly Park',
    });
    expect(
      landmarkOf({ kind: 'train_station', 'name:en': 'Blue Island', name: 'x' }, 1, 2)?.text
    ).toBe('Blue Island');
    expect(landmarkOf({ kind: 'bench', name: 'A bench' }, 1, 2)).toBeNull();
    expect(landmarkOf({ kind: 'constructor', name: 'Proto' }, 1, 2)).toBeNull();
    expect(landmarkOf({ kind: 'park' }, 1, 2)).toBeNull();
    expect(LANDMARK_KINDS.get('train_station')).toBe(0);
  });

  it('the most important first (min_zoom), a mark and its name, at most MAX_LANDMARKS at first', () => {
    const lms = Array.from({ length: 10 }, (_, i) => ({
      text: `Park ${i}`,
      x: 20 + (i % 2) * 300,
      y: 20 + Math.floor(i / 2) * 60,
      order: 7,
      minZoom: 20 - i,
    }));
    const svg = placeLabels(W, H, [], lms, []);
    const first = [
      ...svg.matchAll(/<g class="as-q"><circle[^>]*\/><text class="as-p"[^>]*>([^<]+)</g),
    ].map((m) => m[1]);
    expect(first).toHaveLength(MAX_LANDMARKS);
    expect(first[0]).toBe('Park 9');
    expect(svg).toContain('<g class="as-q as-t2">');
  });
});

describe('the phone first', () => {
  it('names a phone shows (the middle PHONE_BAND units) are placed first, ahead of a better name at the side', () => {
    // Four landmarks at the left edge, more important; two in the middle.
    const side = Array.from({ length: 4 }, (_, i) => ({
      text: `Side ${i}`,
      x: 20,
      y: 30 + i * 80,
      order: 7,
      minZoom: 10,
    }));
    const middle = [0, 1].map((i) => ({
      text: `Middle ${i}`,
      x: 250,
      y: 60 + i * 160,
      order: 7,
      minZoom: 15,
    }));
    const svg = placeLabels(W, H, [], [...side, ...middle], []);
    const first = [
      ...svg.matchAll(/<g class="as-q"><circle[^>]*\/><text class="as-p"[^>]*>([^<]+)</g),
    ].map((m) => m[1]);
    expect(first).toHaveLength(MAX_LANDMARKS);
    expect(first.slice(0, 2)).toEqual(['Middle 0', 'Middle 1']);
    expect(PHONE_BAND).toBe(360);
  });

  it('a street name slides into the band where the run allows', () => {
    // A road along the left two thirds of the frame: its middle (x 200) is in
    // the band; a road wholly at the side is still named, after.
    const svg = placeLabels(
      W,
      H,
      [run('Edge Rd', 0, 300, 110, 300), run('Long Ave', 0, 60, 400, 60)],
      [],
      []
    );
    const names = [...svg.matchAll(/<text class="as-n"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(names).toEqual(['Long Ave', 'Edge Rd']);
  });
});

describe('the street layer | names over the hexagons', () => {
  const f: MapFrame = { w: W, h: H, scale: W, x0: 0, y0: 0 };
  const tile = (layers: DecodedTile['layers']): DecodedTile[] => [{ x: 0, y: 0, layers }];
  const road = (kind: string, props: Record<string, unknown>, y: number) => ({
    type: 2,
    props: { kind, ...props },
    geometry: [
      [
        [0, y],
        [4000, y],
      ] as [number, number][],
    ],
  });

  it('names sit in their own group after the streets, and the map splits the layer there', () => {
    const { svg } = drawStreetLayer(
      f,
      0,
      tile([
        {
          name: 'roads',
          extent: 4096,
          features: [
            road('major_road', { name: 'Western Ave' }, 1000),
            road('highway', { ref: 'I 57' }, 2000),
          ],
        },
        {
          name: 'pois',
          extent: 4096,
          features: [
            { type: 1, props: { kind: 'park', name: 'Kelly Park' }, geometry: [[[2000, 1500]]] },
          ],
        },
      ])
    );
    const [under, names] = splitStreetLayer(svg);
    expect(under).toMatch(/^<g class="amap-s"[^>]*>.*<\/g>$/);
    expect(under).not.toContain('<text');
    expect(names.startsWith(LABELS_OPEN)).toBe(true);
    expect(texts(names)).toEqual(expect.arrayContaining(['Western Ave', 'I-57', 'Kelly Park']));
    expect(LABELS_OPEN).toContain('pointer-events="none"');
    expect(LABELS_OPEN).toContain('aria-hidden="true"');
  });

  it('a layer with no name has no names group', () => {
    const { svg } = drawStreetLayer(
      f,
      0,
      tile([{ name: 'roads', extent: 4096, features: [road('minor_road', {}, 1000)] }])
    );
    expect(svg).not.toContain('amap-sl');
    expect(splitStreetLayer(svg)).toEqual([svg, '']);
  });
});
