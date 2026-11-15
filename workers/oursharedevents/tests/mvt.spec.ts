/**
 * Vector tile decoder (lib/mvt.ts) — what the street map reads out of a tile.
 *
 * Node-clean: pure byte handling. Registered in vitest.node-specs.mjs.
 */
// @born-red mvt decoder mutants | method: StrykerJS mutants of src/lib/mvt.ts, each new test seen failing against the mutant it kills (status Killed in the report) | date: 2026-11-09
// @born-red limits on what a tile may ask the Worker to hold (street-map CCR 2026-11-15, R2) | method: 16 faults injected one at a time in src/lib/mvt.ts (each count left out or moved, each limit moved by one, what is left for the frame ignored), each seen failing the cases named for it in the PR's fault list. Main's decoder counted nothing and has no limits to import, so the block was not run against it as it stood | date: 2026-11-15
import { describe, it, expect } from 'vitest';
import {
  decodeGeometry,
  decodeTile,
  MvtError,
  MAX_PACKED_VALUES,
  MAX_TILE_LAYERS,
  TILE_LIMITS,
  type DecodeCounts,
  type Props,
} from '../src/lib/mvt';
import { geom, mvtTile } from './helpers/street-map-fixtures';

// ─── Raw protobuf builders, so each test spells out the exact bytes ───────────
const vint = (n: number): number[] => {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
};
const tag = (field: number, wire: number): number[] => vint(field * 8 + wire);
const ld = (field: number, bytes: number[]): number[] => [
  ...tag(field, 2),
  ...vint(bytes.length),
  ...bytes,
];
const u = (field: number, n: number): number[] => [...tag(field, 0), ...vint(n)];
const txt = (s: string): number[] => [...new TextEncoder().encode(s)];
const f32 = (field: number, x: number): number[] => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, x, true);
  return [...tag(field, 5), ...b];
};
const f64 = (field: number, x: number): number[] => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x, true);
  return [...tag(field, 1), ...b];
};
const tileOf = (...parts: number[][]): Uint8Array => Uint8Array.from(parts.flat());
const layerMsg = (name: string, ...rest: number[][]): number[] =>
  ld(3, [...ld(1, txt(name)), ...rest.flat()]);
/** Seven or eight 0x07 bytes: read as a tag they are wire type 7, which always throws. */
const sevens = (n: number): number[] => new Array<number>(n).fill(7);
/** A point at (1, 2): MoveTo x1, zigzag(1)=2, zigzag(2)=4. */
const POINT_GEOM = [9, 2, 4];
const POINT = [...u(3, 1), ...ld(4, POINT_GEOM)];
const KV = [...ld(3, txt('k')), ...ld(4, ld(1, txt('v')))];

function layerOf(...body: number[][]) {
  const layers = decodeTile(tileOf(layerMsg('L', ...body)), new Set(['L']));
  expect(layers).toHaveLength(1);
  return layers[0]!;
}
function featureOf(feature: number[], kv: number[] = KV) {
  return layerOf(kv, ld(2, feature)).features[0]!;
}
/** Props of one point tagged k -> the given value message. A trap of 0x07 bytes sits
 * just before the value, so a reader that steps backwards fails at once. */
function valueProps(value: number[]): Props {
  const kv = [...ld(3, txt('k')), ...ld(15, sevens(8)), ...ld(4, value)];
  return featureOf([...ld(2, [0, 0]), ...POINT], kv).props;
}

describe('mvt | geometry', () => {
  it('decodes points, lines and closes rings', () => {
    expect(decodeGeometry(geom(1, [[[25, 17]]]))).toEqual([[[25, 17]]]);
    expect(
      decodeGeometry(
        geom(2, [
          [
            [2, 2],
            [2, 10],
            [10, 10],
          ],
        ])
      )
    ).toEqual([
      [
        [2, 2],
        [2, 10],
        [10, 10],
      ],
    ]);
    const ring = decodeGeometry(
      geom(3, [
        [
          [3, 6],
          [8, 12],
          [20, 34],
          [3, 6],
        ],
      ])
    );
    expect(ring).toEqual([
      [
        [3, 6],
        [8, 12],
        [20, 34],
        [3, 6],
      ],
    ]);
  });

  it('refuses a truncated or unknown command', () => {
    expect(() => decodeGeometry([9, 50])).toThrow(MvtError);
    expect(() => decodeGeometry([(1 << 3) | 4, 0, 0])).toThrow(MvtError);
    expect(() => decodeGeometry([(1 << 3) | 2, 2, 2])).toThrow(/LineTo before MoveTo/);
  });
});

describe('mvt | tiles', () => {
  const tile = mvtTile([
    {
      name: 'buildings',
      features: [
        {
          type: 3,
          props: { kind: 'building' },
          parts: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      ],
    },
    {
      name: 'roads',
      extent: 4096,
      features: [
        {
          type: 2,
          props: { kind: 'highway', name: 'I-90', oneway: true, min_zoom: 5, width: -2, sort: 1.5 },
          parts: [
            [
              [0, 2048],
              [4096, 2048],
            ],
          ],
        },
      ],
    },
    {
      name: 'places',
      extent: 512,
      features: [
        { type: 1, props: { kind: 'locality', name: 'Blue Island' }, parts: [[[256, 256]]] },
      ],
    },
  ]);

  it('decodes the asked-for layers with their properties, and skips the rest', () => {
    const layers = decodeTile(tile, new Set(['roads', 'places']));
    expect(layers.map((l) => l.name)).toEqual(['roads', 'places']);
    const [roads, places] = layers;
    expect(roads!.extent).toBe(4096);
    expect(roads!.features[0]).toEqual({
      type: 2,
      props: { kind: 'highway', name: 'I-90', oneway: true, min_zoom: 5, width: -2, sort: 1.5 },
      geometry: [
        [
          [0, 2048],
          [4096, 2048],
        ],
      ],
    });
    expect(places!.extent).toBe(512);
    expect(places!.features[0]!.props.name).toBe('Blue Island');
  });

  it('an empty wanted set decodes nothing', () => {
    expect(decodeTile(tile, new Set())).toEqual([]);
  });

  it('refuses a truncated tile', () => {
    expect(() => decodeTile(tile.slice(0, tile.length - 7), new Set(['places']))).toThrow(MvtError);
  });
});

describe('mvt | geometry edges', () => {
  it('a ClosePath with no ring yet is ignored, and one after a ring closes it', () => {
    expect(decodeGeometry([7])).toEqual([]);
    expect(decodeGeometry([7, ...POINT_GEOM, 7])).toEqual([
      [
        [1, 2],
        [1, 2],
      ],
    ]);
  });

  it('names an unknown command', () => {
    for (const cmd of [0, 3, 4, 5, 6]) {
      expect(() => decodeGeometry([(1 << 3) | cmd, 2, 2])).toThrow(
        new MvtError(`unknown geometry command ${cmd}`)
      );
    }
  });

  it('refuses geometry cut off at the exact parameter', () => {
    expect(() => decodeGeometry([9, 2])).toThrow(new MvtError('truncated geometry'));
    expect(() => decodeGeometry([17, 2, 4, 2])).toThrow(new MvtError('truncated geometry'));
    expect(decodeGeometry([17, 2, 4, 2, 2])).toEqual([[[1, 2]], [[2, 3]]]);
  });

  it('a MoveTo with count 0 starts no line, so a LineTo after it is refused', () => {
    expect(() => decodeGeometry([1, 10, 2, 2])).toThrow(new MvtError('LineTo before MoveTo'));
  });

  it('zigzag turns odd numbers negative and even numbers positive', () => {
    expect(decodeGeometry([9, 1, 3, 10, 5, 6])).toEqual([
      [
        [-1, -2],
        [-4, 1],
      ],
    ]);
  });
});

describe('mvt | protobuf reader', () => {
  const L = layerMsg('L');
  const wantL = new Set(['L']);
  const decodedL = [{ name: 'L', extent: 4096, features: [] }];

  it('refuses a varint that runs past the end', () => {
    expect(() => decodeTile(tileOf([0x80]), wantL)).toThrow(new MvtError('truncated varint'));
    // The field ends on a continuation byte while the tile still has bytes after it.
    expect(() => featureOf([...ld(4, [0x80]), ...u(3, 1)])).toThrow(
      new MvtError('truncated varint')
    );
  });

  it('reads a ten-byte varint, and refuses an eleventh byte', () => {
    const tenBytes = [...new Array<number>(9).fill(0x80), 1];
    expect(decodeTile(tileOf(tag(1, 0), tenBytes, L), wantL)).toEqual(decodedL);
    expect(() => decodeTile(tileOf(tag(1, 0), new Array(10).fill(0x80), [0]), wantL)).toThrow(
      new MvtError('varint too long')
    );
  });

  it('refuses a length-delimited field longer than what is left', () => {
    expect(() => decodeTile(tileOf(tag(3, 2), [5], [0]), wantL)).toThrow(
      new MvtError('field past end')
    );
  });

  it('skips unknown top-level fields of wire types 0, 1, 2 and 5', () => {
    expect(decodeTile(tileOf(u(1, 300), L), wantL)).toEqual(decodedL);
    expect(decodeTile(tileOf(ld(1, [0x1a, 0x7f, 0x00]), L), wantL)).toEqual(decodedL);
    expect(decodeTile(tileOf(ld(1, sevens(7)), tag(2, 1), sevens(8), L), wantL)).toEqual(decodedL);
    expect(decodeTile(tileOf(ld(1, sevens(7)), tag(2, 5), sevens(4), L), wantL)).toEqual(decodedL);
  });

  it('a fixed field that fits exactly is fine; one byte short is past the end', () => {
    expect(decodeTile(tileOf(L, tag(2, 5), [1, 2, 3, 4]), wantL)).toEqual(decodedL);
    expect(decodeTile(tileOf(L, tag(2, 1), sevens(8)), wantL)).toEqual(decodedL);
    expect(() => decodeTile(tileOf(L, tag(2, 5), [1, 2, 3]), wantL)).toThrow(
      new MvtError('field past end')
    );
    expect(() => decodeTile(tileOf(L, tag(2, 1), sevens(7)), wantL)).toThrow(
      new MvtError('field past end')
    );
  });

  it('names an unsupported wire type', () => {
    for (const wire of [3, 4, 6, 7]) {
      expect(() => decodeTile(tileOf(tag(1, wire), sevens(8)), wantL)).toThrow(
        new MvtError(`unsupported wire type ${wire}`)
      );
    }
  });

  it('a layer is only field 3 with wire type 2', () => {
    expect(decodeTile(tileOf(ld(9, ld(1, txt('L')))), wantL)).toEqual([]);
    expect(decodeTile(tileOf(ld(9, L)), wantL)).toEqual([]);
    expect(decodeTile(tileOf(L, u(3, 5)), wantL)).toEqual(decodedL);
  });
});

describe('mvt | layers', () => {
  it('a layer with no name is decoded when the empty name is wanted', () => {
    expect(decodeTile(tileOf(ld(3, u(5, 256))), new Set(['']))).toEqual([
      { name: '', extent: 256, features: [] },
    ]);
    expect(decodeTile(tileOf(ld(3, u(5, 256))), new Set(['L']))).toEqual([]);
  });

  it('an unwanted layer is skipped as soon as its name is read', () => {
    const tile = tileOf(layerMsg('buildings', tag(9, 3)), layerMsg('L'));
    expect(decodeTile(tile, new Set(['L']))).toEqual([{ name: 'L', extent: 4096, features: [] }]);
  });

  it('an unwanted layer whose name comes after its features is still dropped', () => {
    const tile = tileOf(ld(3, [...KV, ...ld(2, POINT), ...ld(1, txt('buildings'))]));
    expect(decodeTile(tile, new Set(['L']))).toEqual([]);
  });

  it('reads the name only from field 1 with wire type 2', () => {
    expect(layerOf(u(1, 0)).name).toBe('L');
  });

  it('extent 0 means the default 4096; extent comes only from field 5 as a varint', () => {
    expect(layerOf(u(5, 0)).extent).toBe(4096);
    expect(layerOf(u(5, 512), u(9, 7)).extent).toBe(512);
    expect(layerOf(u(5, 512), ld(5, [0])).extent).toBe(512);
    expect(layerOf(u(5, 512), ld(9, u(5, 7))).extent).toBe(512);
  });

  it('features, keys and values come only from their own fields with wire type 2', () => {
    expect(layerOf(u(2, 0)).features).toEqual([]);
    const tagged = [...ld(2, [0, 0]), ...POINT];
    expect(featureOf(tagged, [...u(3, 0), ...KV]).props).toStrictEqual({ k: 'v' });
    expect(
      featureOf(tagged, [...ld(3, txt('k')), ...ld(9, []), ...ld(4, ld(1, txt('v')))]).props
    ).toStrictEqual({ k: 'v' });
    expect(
      featureOf(tagged, [...ld(3, txt('k')), ...u(4, 0), ...ld(4, ld(1, txt('v')))]).props
    ).toStrictEqual({ k: 'v' });
  });
});

describe('mvt | features', () => {
  it('a feature with no geometry and no tags decodes empty', () => {
    expect(featureOf(u(3, 2))).toStrictEqual({ type: 2, props: {}, geometry: [] });
  });

  it('tags come only from field 2 with wire type 2', () => {
    expect(featureOf([...ld(2, [0, 0]), ...u(2, 1), ...POINT]).props).toStrictEqual({ k: 'v' });
  });

  it('type comes only from field 3 as a varint', () => {
    expect(featureOf([...u(3, 2), ...u(9, 7), ...ld(4, POINT_GEOM)]).type).toBe(2);
    expect(featureOf([...u(3, 2), ...ld(3, [0]), ...ld(4, POINT_GEOM)]).type).toBe(2);
  });

  it('geometry comes only from field 4 with wire type 2, and unknown fields are skipped', () => {
    expect(featureOf([...u(3, 2), ...ld(4, POINT_GEOM), ...ld(9, u(3, 3))])).toStrictEqual({
      type: 2,
      props: {},
      geometry: [[[1, 2]]],
    });
    expect(featureOf([...u(3, 2), ...ld(4, POINT_GEOM), ...u(4, 0)]).geometry).toEqual([[[1, 2]]]);
  });

  it('refuses an unsupported wire type inside a feature', () => {
    expect(() => featureOf([...POINT, ...tag(9, 3)])).toThrow(
      new MvtError('unsupported wire type 3')
    );
  });

  it('drops a tag pair whose key or value index is out of range, and an odd last tag', () => {
    expect(featureOf([...ld(2, [5, 0]), ...POINT]).props).toStrictEqual({});
    expect(featureOf([...ld(2, [0, 5]), ...POINT]).props).toStrictEqual({});
    expect(featureOf([...ld(2, [0, 0, 0]), ...POINT]).props).toStrictEqual({ k: 'v' });
  });

  it('drops a property whose value message holds no known field', () => {
    expect(valueProps(u(9, 1))).toStrictEqual({});
  });
});

describe('mvt | property values', () => {
  it('reads each value field 1 to 7', () => {
    expect(valueProps(ld(1, txt('x')))).toStrictEqual({ k: 'x' });
    expect(valueProps(f32(2, 1.5))).toStrictEqual({ k: 1.5 });
    expect(valueProps(f64(3, -2.25))).toStrictEqual({ k: -2.25 });
    expect(valueProps(u(4, 300))).toStrictEqual({ k: 300 });
    expect(valueProps(u(5, 7))).toStrictEqual({ k: 7 });
    expect(valueProps(u(6, 3))).toStrictEqual({ k: -2 });
    expect(valueProps(u(6, 4))).toStrictEqual({ k: 2 });
    expect(valueProps(u(7, 1))).toStrictEqual({ k: true });
    expect(valueProps(u(7, 0))).toStrictEqual({ k: false });
  });

  it('a value field with the wrong wire type is skipped', () => {
    const x = ld(1, txt('x'));
    expect(valueProps([...u(1, 5), ...u(4, 9)])).toStrictEqual({ k: 9 });
    expect(valueProps([...u(2, 1), ...x])).toStrictEqual({ k: 'x' });
    expect(valueProps([...u(3, 1), ...x])).toStrictEqual({ k: 'x' });
    expect(valueProps([...ld(5, [1]), ...x])).toStrictEqual({ k: 'x' });
    expect(valueProps([...ld(6, [1]), ...x])).toStrictEqual({ k: 'x' });
    expect(valueProps([...ld(7, [1]), ...x])).toStrictEqual({ k: 'x' });
  });

  it('an unknown field after a value is skipped and leaves the value alone', () => {
    const x = ld(1, txt('x'));
    expect(valueProps([...x, ...ld(9, txt('zz'))])).toStrictEqual({ k: 'x' });
    expect(valueProps([...x, ...f32(9, 1.5)])).toStrictEqual({ k: 'x' });
    expect(valueProps([...x, ...f64(9, 2.5)])).toStrictEqual({ k: 'x' });
    expect(valueProps([...x, ...u(9, 1)])).toStrictEqual({ k: 'x' });
    expect(valueProps([...x, ...ld(9, u(4, 7))])).toStrictEqual({ k: 'x' });
  });

  it('refuses an unsupported wire type inside a value', () => {
    expect(() => valueProps(tag(9, 3))).toThrow(new MvtError('unsupported wire type 3'));
  });
});

// street-map CCR 2026-11-15, R2. A tile's bytes are limited by the reader
// (lib/pmtiles.ts); until these limits nothing limited what the bytes became. A
// point is two bytes of tile and 76 decoded, and a ring's closing point is one
// byte, so a tile of the 4 MiB the reader allows could ask for some 300 MB.
describe('mvt | limits on what a tile may ask the Worker to hold', () => {
  const packedField = (field: number, nums: number[]): number[] => ld(field, nums.flatMap(vint));
  /** A line of n points: a MoveTo, then n - 1 steps of one unit. */
  const lineOf = (n: number): number[] => [
    9,
    0,
    0,
    ((n - 1) << 3) | 2,
    ...new Array<number>(2 * (n - 1)).fill(2),
  ];
  /** A feature that is a line of n points. */
  const lineFeature = (n: number): number[] => ld(2, [...u(3, 2), ...packedField(4, lineOf(n))]);
  const many = (n: number, item: number[]): number[][] => new Array<number[]>(n).fill(item);
  const EMPTY_FEATURE = ld(2, []);
  const tooMany = (kind: string, where = 'tile') =>
    new MvtError(`too many ${kind} in one ${where}`);
  const L = new Set(['L']);
  const LM = new Set(['L', 'M']);

  it('the limits are the ones the source gives its reasons for', () => {
    expect(TILE_LIMITS).toEqual({ features: 30_000, points: 150_000, props: 150_000 });
    expect(Object.isFrozen(TILE_LIMITS)).toBe(true);
    expect(MAX_TILE_LAYERS).toBe(16);
    expect(MAX_PACKED_VALUES).toBe(450_000);
  });

  // ── points ────────────────────────────────────────────────────────────────
  it('points: a line of exactly the limit is decoded, and one point more is refused', () => {
    const parts = decodeGeometry(lineOf(TILE_LIMITS.points));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(TILE_LIMITS.points);
    expect(parts[0]![TILE_LIMITS.points - 1]).toEqual([
      TILE_LIMITS.points - 1,
      TILE_LIMITS.points - 1,
    ]);
    expect(() => decodeGeometry(lineOf(TILE_LIMITS.points + 1))).toThrow(tooMany('points'));
  });

  it('points: the point a ClosePath adds is counted, though it costs the tile one byte', () => {
    const closed = decodeGeometry([...lineOf(TILE_LIMITS.points - 1), 7]);
    expect(closed[0]).toHaveLength(TILE_LIMITS.points);
    expect(closed[0]![TILE_LIMITS.points - 1]).toEqual([0, 0]);
    expect(() => decodeGeometry([...lineOf(TILE_LIMITS.points), 7])).toThrow(tooMany('points'));
    // A ring of three points closed again and again: every close is a point held.
    const again = [...lineOf(3), ...new Array<number>(TILE_LIMITS.points - 3).fill(7)];
    expect(decodeGeometry(again)[0]).toHaveLength(TILE_LIMITS.points);
    expect(() => decodeGeometry([...again, 7])).toThrow(tooMany('points'));
  });

  it('points: counted across the features and layers of one tile, and from nothing for the next tile', () => {
    const half = TILE_LIMITS.points / 2;
    const full = tileOf(layerMsg('L', lineFeature(half)), layerMsg('M', lineFeature(half)));
    const layers = decodeTile(full, LM);
    expect(layers.map((l) => l.features[0]!.geometry[0]!.length)).toEqual([half, half]);
    // The same tile again: the count is one tile's, not the decoder's.
    expect(decodeTile(full, LM)).toHaveLength(2);
    // One more point, in a second feature of the second layer.
    const over = tileOf(
      layerMsg('L', lineFeature(half)),
      layerMsg('M', lineFeature(half), ld(2, [...u(3, 1), ...ld(4, POINT_GEOM)]))
    );
    expect(() => decodeTile(over, LM)).toThrow(tooMany('points'));
    // In two features of one layer as well.
    const twoInOne = tileOf(layerMsg('L', lineFeature(half), lineFeature(half + 1)));
    expect(() => decodeTile(twoInOne, L)).toThrow(tooMany('points'));
  });

  // ── features ──────────────────────────────────────────────────────────────
  it('features: exactly the limit is decoded, and one more is refused, across layers too', () => {
    const atLimit = tileOf(layerMsg('L', ...many(TILE_LIMITS.features, EMPTY_FEATURE)));
    const [layer] = decodeTile(atLimit, L);
    expect(layer!.features).toHaveLength(TILE_LIMITS.features);
    const over = tileOf(layerMsg('L', ...many(TILE_LIMITS.features + 1, EMPTY_FEATURE)));
    expect(() => decodeTile(over, L)).toThrow(tooMany('features'));
    const half = TILE_LIMITS.features / 2;
    const split = (extra: number) =>
      tileOf(
        layerMsg('L', ...many(half, EMPTY_FEATURE)),
        layerMsg('M', ...many(half + extra, EMPTY_FEATURE))
      );
    expect(decodeTile(split(0), LM).map((l) => l.features.length)).toEqual([half, half]);
    expect(() => decodeTile(split(1), LM)).toThrow(tooMany('features'));
  });

  it('an unwanted layer named first costs nothing; one named last is counted as it is held', () => {
    const big = [...many(TILE_LIMITS.features + 1, EMPTY_FEATURE), lineFeature(TILE_LIMITS.points)];
    // Named first: skipped at its name, and the wanted layer after it has the whole tile limit.
    const skipped = tileOf(
      layerMsg('X', ...big),
      layerMsg('L', ...many(TILE_LIMITS.features, EMPTY_FEATURE))
    );
    expect(decodeTile(skipped, L)[0]!.features).toHaveLength(TILE_LIMITS.features);
    // Named last: its features were kept before the name said to drop them.
    const late = tileOf(
      ld(3, [...many(TILE_LIMITS.features + 1, EMPTY_FEATURE).flat(), ...ld(1, txt('X'))])
    );
    expect(() => decodeTile(late, L)).toThrow(tooMany('features'));
    const lateAtLimit = tileOf(
      ld(3, [...many(TILE_LIMITS.features, EMPTY_FEATURE).flat(), ...ld(1, txt('X'))])
    );
    expect(decodeTile(lateAtLimit, L)).toEqual([]);
  });

  // ── properties ────────────────────────────────────────────────────────────
  it('properties: keys read, values read and properties set share one count', () => {
    const key = ld(3, txt('k'));
    const value = ld(4, ld(1, txt('v')));
    /** One feature that sets k -> v `pairs` times over. */
    const setter = (pairs: number): number[] =>
      ld(2, [...packedField(2, new Array<number>(2 * pairs).fill(0)), ...POINT]);
    // One key, one value, and the rest of the limit in properties set.
    const rest = TILE_LIMITS.props - 2;
    const atLimit = decodeTile(tileOf(layerMsg('L', key, value, setter(rest))), L);
    expect(atLimit[0]!.features[0]!.props).toEqual({ k: 'v' });
    for (const [what, extra] of [
      ['a property set', [key, value, setter(rest + 1)]],
      ['a key', [key, key, value, setter(rest)]],
      ['a value', [key, value, value, setter(rest)]],
    ] as const) {
      expect(() => decodeTile(tileOf(layerMsg('L', ...extra)), L), what).toThrow(tooMany('props'));
    }
  });

  it('properties: a tag pair that sets nothing is not counted', () => {
    // Indexes past the one key and the one value: dropped, as before, and free.
    const dropped = new Array<number>(2 * TILE_LIMITS.props).fill(7);
    const tile = tileOf(
      layerMsg(
        'L',
        ld(3, txt('k')),
        ld(4, ld(1, txt('v'))),
        ld(2, [...packedField(2, dropped), ...POINT])
      )
    );
    expect(decodeTile(tile, L)[0]!.features[0]!.props).toEqual({});
  });

  // ── one packed field ──────────────────────────────────────────────────────
  it('a packed field of exactly the limit is read, as tags or as geometry; one integer more is refused', () => {
    const refused = new MvtError('too many values in one field');
    // Tags that name no key, and a geometry of MoveTo commands with a count of 0:
    // integers that are read and held, and become nothing.
    for (const [field, value] of [
      [2, 7],
      [4, 1],
    ] as const) {
      const feature = (n: number) => ld(2, packedField(field, new Array<number>(n).fill(value)));
      const [layer] = decodeTile(tileOf(layerMsg('L', feature(MAX_PACKED_VALUES))), L);
      expect(layer!.features).toEqual([{ type: 0, props: {}, geometry: [] }]);
      expect(() => decodeTile(tileOf(layerMsg('L', feature(MAX_PACKED_VALUES + 1))), L)).toThrow(
        refused
      );
    }
  });

  // ── layers ────────────────────────────────────────────────────────────────
  it('layers: exactly the limit of wanted layers is decoded, one more is refused, and unwanted ones are free', () => {
    const wanted = many(MAX_TILE_LAYERS, layerMsg('L'));
    const unwanted = many(3 * MAX_TILE_LAYERS, layerMsg('X'));
    expect(decodeTile(tileOf(...unwanted, ...wanted), L)).toHaveLength(MAX_TILE_LAYERS);
    expect(() => decodeTile(tileOf(...wanted, layerMsg('L')), L)).toThrow(
      new MvtError('too many layers in one tile')
    );
  });

  // ── what the caller has left for the frame ────────────────────────────────
  describe('what the caller has left, for the tiles it decodes together', () => {
    // 3 features; 2 keys and 2 values; 3 properties set; 2 + 1 + 4 points.
    const tile = tileOf(
      layerMsg(
        'L',
        ld(3, txt('a')),
        ld(3, txt('b')),
        ld(4, ld(1, txt('v'))),
        ld(4, ld(1, txt('w'))),
        ld(2, [...packedField(2, [0, 0, 1, 1]), ...u(3, 2), ...packedField(4, lineOf(2))]),
        ld(2, [...packedField(2, [0, 1]), ...POINT]),
        ld(2, [...u(3, 3), ...packedField(4, [...lineOf(3), 7])])
      )
    );
    const NEEDS: DecodeCounts = { features: 3, points: 7, props: 7 };

    it('is counted down by what the tile read', () => {
      const left: DecodeCounts = { features: 10, points: 100, props: 50 };
      const [layer] = decodeTile(tile, L, left);
      expect(layer!.features.map((f) => f.props)).toEqual([{ a: 'v', b: 'w' }, { a: 'w' }, {}]);
      expect(left).toEqual({ features: 7, points: 93, props: 43 });
      // A second tile is counted from where the first left off.
      decodeTile(tile, L, left);
      expect(left).toEqual({ features: 4, points: 86, props: 36 });
    });

    it('exactly enough left is enough, and ends at nothing left', () => {
      const left = { ...NEEDS };
      expect(decodeTile(tile, L, left)).toHaveLength(1);
      expect(left).toEqual({ features: 0, points: 0, props: 0 });
    });

    it.each(['features', 'points', 'props'] as const)(
      'one short of %s is refused, by the frame and not the tile',
      (kind) => {
        const left = { ...NEEDS, [kind]: NEEDS[kind] - 1 };
        expect(() => decodeTile(tile, L, left)).toThrow(tooMany(kind, 'frame'));
      }
    );

    it("the tile's own limit holds whatever is left for the frame", () => {
      const left: DecodeCounts = { features: 10, points: 10 * TILE_LIMITS.points, props: 10 };
      const over = tileOf(layerMsg('L', lineFeature(TILE_LIMITS.points + 1)));
      expect(() => decodeTile(over, L, left)).toThrow(tooMany('points'));
    });

    it('with nothing passed there is no frame to run out: only the tile limits apply', () => {
      for (let i = 0; i < 3; i++) {
        const atLimit = tileOf(layerMsg('L', lineFeature(TILE_LIMITS.points)));
        expect(decodeTile(atLimit, L)[0]!.features[0]!.geometry[0]).toHaveLength(
          TILE_LIMITS.points
        );
      }
    });
  });
});
