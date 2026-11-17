/**
 * Drawn street layers are kept in the isolate (lib/street-map.ts, "DRAWN LAYERS
 * ARE KEPT"; base-map scenario pass 2026-11-15, S14, gap G8, section 6.4 tier 1;
 * OSE ADR-036 D5, the part that needs no ruling).
 *
 * Node-clean: in-memory archives and fake R2 buckets, the clock held by the
 * test. Registered in vitest.node-specs.mjs.
 *
 * What these pin:
 *   - two requests for one frame draw once: the second reads nothing and is
 *     handed the same layer, and its line says drew with 0 tiles and 0 reads
 *   - what makes a frame another frame: the cells, the cells that carry a
 *     number, the frame's size and the drawer's version, and nothing else
 *   - another archive key, or another object under the key, draws again, and
 *     the layers of the old object are dropped
 *   - with MAP_TILES_ETAG set, only a layer of the pinned object is handed out
 *   - a kept layer is handed out for KEPT_LAYER_MS and not a millisecond longer
 *   - a null is never kept: thin, no tile, slow, failed
 *   - the store holds KEPT_LAYER_CHARS at most, and the layer not asked for
 *     the longest goes first
 *   - a kept layer cannot be changed by the page it is handed to
 */
// @born-red drawn layers kept in the isolate | method: 30 faults, one at a time, each seen failing here and put back. In src/lib/street-map.ts (28): a kept layer never handed out (11 cases failed, and in workerd "the next map of that area in the isolate reads nothing" in street-map-runtime.spec.ts); a drawn layer never kept (13); the pin not read on a hand-out; the etag, then the key, left out of the object's name; the numbered cells, the frame size, then the drawer version left out of the frame's name; the hour never ending, a millisecond longer, two hours, and started again by a hand-out (4 cases each); a hand-out not making the layer the last to go; a layer whose time is up still counted; the budget not held, exactly the budget not fitting, a layer over the budget kept, a layer of exactly the budget not kept; layers of another object not dropped; the name not counted; the old count left when a name is kept again; the counts, then the layer, not frozen; the zoom not kept; a hand-out writing no line, and saying a read was made; a layer kept whatever the etag; the first of two objects read taken as the one. In src/lib/pmtiles.ts (2): no etag said for an open archive (11); a changed object left open (3). One more fault changed nothing and its line was taken out of the source (the object's name cleared on reset) | date: 2026-11-16
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gridDisk, latLngToCell } from 'h3-js';
import {
  DEFAULT_ARCHIVE,
  DRAWER_VERSION,
  KEPT_LAYER_CHARS,
  KEPT_LAYER_MS,
  MAP_H,
  MAP_W,
  cellsKey,
  keepStreetLayer,
  keptEtag,
  keptSource,
  keptStreetLayer,
  keptStreetLayers,
  layerName,
  loadStreetLayer,
  resetStreetLayerCache,
  type StreetLayer,
  type StreetLayerLine,
} from '../src/lib/street-map';
import { archiveEtag, r2Source, resetPmtilesCache, type RangeBucket } from '../src/lib/pmtiles';
import {
  fakeBucket,
  pmtilesArchive,
  scriptedBucket,
  tilesForCells,
  tilesOfFrame,
  type FixtureLayer,
  type FixtureTile,
  type Pt,
} from './helpers/street-map-fixtures';

const BLUE7 = latLngToCell(41.6573, -87.68, 7);
/** The area next to it: a frame of its own, and a frame with BLUE7. */
const NEXT7 = gridDisk(BLUE7, 1).find((c) => c !== BLUE7)!;
const ON = { STREET_MAP: 'on' } as const;
const KEY = `r2:${DEFAULT_ARCHIVE}`;

/** The test's clock. `Date.now` reads it; nothing moves it but the test. */
const T0 = Date.parse('2026-11-16T12:00:00.000Z');
let now = T0;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetPmtilesCache();
  resetStreetLayerCache();
  now = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

/** Every STREET_LAYER line written so far. */
const lines = (): StreetLayerLine[] =>
  log.mock.calls
    .map((c: unknown[]) => JSON.parse(String(c[0])) as StreetLayerLine)
    .filter((l) => l.type === 'STREET_LAYER');

/** A major road across each tile: a layer drawn with it is other markup. */
const majorRoad = (): FixtureLayer[] => [
  {
    name: 'roads',
    features: [
      {
        type: 2,
        props: { kind: 'major_road' },
        parts: [Array.from({ length: 65 }, (_, i): Pt => [i * 64, 1000])],
      },
    ],
  },
];

/**
 * One archive that holds the tiles of each of these frames, gzipped, behind a
 * leaf directory. A tile two frames share is in it once.
 */
const archiveFor = async (
  frames: string[][],
  extra: () => FixtureLayer[] = () => []
): Promise<Uint8Array> => {
  const tiles = new Map<string, FixtureTile>();
  for (const cells of frames) {
    for (const t of tilesForCells(cells, extra).tiles) tiles.set(`${t.z}/${t.x}/${t.y}`, t);
  }
  return pmtilesArchive([...tiles.values()], { gzip: true, leaf: true });
};

const FRAMES = [[BLUE7], [NEXT7], [BLUE7, NEXT7]];

describe('kept street layers | through the door: two requests for one frame draw once', () => {
  it('the second request reads nothing and is handed the same layer', async () => {
    const { r } = tilesForCells([BLUE7]);
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const env = { ...ON, MAP_TILES: bucket };
    const first = await loadStreetLayer(env, [BLUE7], { surface: 'landing' });
    expect(first?.svg).toContain('data-testid="amap-streets"');
    const reads = bucket.gets.length;
    expect(reads).toBe(3);
    expect(keptStreetLayers().layers).toBe(1);

    const second = await loadStreetLayer(env, [BLUE7], { surface: 'map-areas' });
    expect(second).toBe(first);
    expect(bucket.gets).toHaveLength(reads);
    // A line for each: the second says drew, on its own surface, the layer's
    // zoom, and nothing asked for and nothing read.
    expect(lines()).toEqual([
      {
        type: 'STREET_LAYER',
        outcome: 'drew',
        surface: 'landing',
        z: r.z,
        tiles: tilesForCells([BLUE7]).tiles.length,
        r2Reads: 3,
        ms: 0,
      },
      {
        type: 'STREET_LAYER',
        outcome: 'drew',
        surface: 'map-areas',
        z: r.z,
        tiles: 0,
        r2Reads: 0,
        ms: 0,
      },
    ]);
  });

  it('a kept layer is frozen: a page cannot change what the next page is handed', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const layer = await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7]);
    expect(Object.isFrozen(layer)).toBe(true);
    expect(Object.isFrozen(layer!.drawn)).toBe(true);
    expect(() => {
      (layer as { svg: string }).svg = '';
    }).toThrow(TypeError);
    expect(() => {
      layer!.drawn.highway = 0;
    }).toThrow(TypeError);
  });

  it('the cells in another order are the same frame', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const env = { ...ON, MAP_TILES: bucket };
    const first = await loadStreetLayer(env, [BLUE7, NEXT7]);
    expect(first).not.toBeNull();
    const reads = bucket.gets.length;
    expect(await loadStreetLayer(env, [NEXT7, BLUE7], { numbered: [NEXT7, BLUE7] })).toBe(first);
    expect(bucket.gets).toHaveLength(reads);
  });

  it('other cells are another frame: read and drawn, and both are kept', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const env = { ...ON, MAP_TILES: bucket };
    const blue = await loadStreetLayer(env, [BLUE7]);
    const reads = bucket.gets.length;
    const next = await loadStreetLayer(env, [NEXT7]);
    expect(next).not.toBeNull();
    expect(next).not.toBe(blue);
    expect(next!.cellsKey).toBe(cellsKey([NEXT7]));
    expect(bucket.gets.length).toBeGreaterThan(reads);
    expect(keptStreetLayers().layers).toBe(2);
    // Each is handed out for its own cells.
    const after = bucket.gets.length;
    expect(await loadStreetLayer(env, [BLUE7])).toBe(blue);
    expect(await loadStreetLayer(env, [NEXT7])).toBe(next);
    expect(bucket.gets).toHaveLength(after);
  });

  it('the same cells with other cells numbered are another frame', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const env = { ...ON, MAP_TILES: bucket };
    const all = await loadStreetLayer(env, [BLUE7, NEXT7]);
    const reads = bucket.gets.length;
    const one = await loadStreetLayer(env, [BLUE7, NEXT7], { numbered: [BLUE7] });
    expect(one).not.toBeNull();
    expect(one).not.toBe(all);
    expect(bucket.gets.length).toBeGreaterThan(reads);
    expect(keptStreetLayers().layers).toBe(2);
    const after = bucket.gets.length;
    expect(await loadStreetLayer(env, [BLUE7, NEXT7], { numbered: [BLUE7] })).toBe(one);
    expect(await loadStreetLayer(env, [BLUE7, NEXT7])).toBe(all);
    expect(bucket.gets).toHaveLength(after);
  });

  it('nothing open in the isolate: the frame is read, whatever is kept', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const env = { ...ON, MAP_TILES: bucket };
    const first = await loadStreetLayer(env, [BLUE7]);
    // The reader forgets the archive, as it does when an object changes.
    resetPmtilesCache();
    expect(archiveEtag(KEY)).toBeUndefined();
    const reads = bucket.gets.length;
    const second = await loadStreetLayer(env, [BLUE7]);
    expect(bucket.gets.length).toBe(reads + 3);
    expect(second).not.toBe(first);
    expect(second!.svg).toBe(first!.svg);
    expect(keptStreetLayers().layers).toBe(1);
  });
});

describe('kept street layers | another object draws again', () => {
  it('another archive key: read and drawn, and the first key has nothing kept', async () => {
    const a = fakeBucket('a.pmtiles', await archiveFor(FRAMES));
    const b = fakeBucket('b.pmtiles', await archiveFor(FRAMES, majorRoad));
    const envA = { ...ON, MAP_TILES: a, MAP_TILES_ARCHIVE: 'a.pmtiles' };
    const envB = { ...ON, MAP_TILES: b, MAP_TILES_ARCHIVE: 'b.pmtiles' };
    const fromA = await loadStreetLayer(envA, [BLUE7]);
    await loadStreetLayer(envA, [NEXT7]);
    expect(keptStreetLayers().layers).toBe(2);

    const fromB = await loadStreetLayer(envB, [BLUE7]);
    expect(b.gets).toHaveLength(3);
    expect(fromB!.svg).not.toBe(fromA!.svg);
    // The layers of the first object went when the second was kept.
    expect(keptStreetLayers().layers).toBe(1);
    expect(await loadStreetLayer(envB, [BLUE7])).toBe(fromB);
    expect(b.gets).toHaveLength(3);

    // Back on the first key: its archive is still open, and its layer is drawn again.
    const reads = a.gets.length;
    const again = await loadStreetLayer(envA, [BLUE7]);
    expect(a.gets.length).toBe(reads + 1);
    expect(again).not.toBe(fromA);
    expect(again!.svg).toBe(fromA!.svg);
  });

  it('an object replaced under the key: a frame not kept notices on its read, and no layer of the old object is handed out after', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const env = { ...ON, MAP_TILES: bucket };
    const old = await loadStreetLayer(env, [BLUE7], { surface: 'landing' });
    expect(old).not.toBeNull();
    bucket.replace(await archiveFor(FRAMES, majorRoad));

    // A frame that is not kept reads, and its read is refused: the object changed.
    expect(await loadStreetLayer(env, [NEXT7], { surface: 'landing' })).toBeNull();
    expect(lines().at(-1)).toMatchObject({ outcome: 'error' });
    expect(archiveEtag(KEY)).toBeUndefined();

    // The kept frame is read from the new object, not handed out from the old.
    const reads = bucket.gets.length;
    const fresh = await loadStreetLayer(env, [BLUE7], { surface: 'landing' });
    expect(bucket.gets.length).toBe(reads + 3);
    expect(fresh).not.toBe(old);
    expect(fresh!.svg).not.toBe(old!.svg);
    expect(fresh!.svg).toContain('as-r as-2');
    expect(old!.svg).not.toContain('as-r as-2');
    expect(keptStreetLayers().layers).toBe(1);
    expect(await loadStreetLayer(env, [BLUE7])).toBe(fresh);
  });

  it('MAP_TILES_ETAG names the object that is open: its kept layer is handed out', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const env = { ...ON, MAP_TILES: bucket, MAP_TILES_ETAG: bucket.etag };
    const first = await loadStreetLayer(env, [BLUE7]);
    expect(first).not.toBeNull();
    const reads = bucket.gets.length;
    expect(await loadStreetLayer(env, [BLUE7])).toBe(first);
    // An empty pin is no pin.
    expect(await loadStreetLayer({ ...env, MAP_TILES_ETAG: '' }, [BLUE7])).toBe(first);
    expect(bucket.gets).toHaveLength(reads);
  });

  it('MAP_TILES_ETAG names another object: a kept layer is not handed out', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const env = { ...ON, MAP_TILES: bucket };
    expect(await loadStreetLayer(env, [BLUE7], { surface: 'landing' })).not.toBeNull();
    const reads = bucket.gets.length;
    expect(
      await loadStreetLayer({ ...env, MAP_TILES_ETAG: 'another-object' }, [BLUE7], {
        surface: 'landing',
      })
    ).toBeNull();
    // It read, and the read was refused: not the pinned object.
    expect(bucket.gets.length).toBeGreaterThan(reads);
    expect(lines().at(-1)).toMatchObject({ outcome: 'error', r2Reads: 1 });
  });

  it('the pinned object replaced: its kept layer is still handed out, and nothing of the other object is ever drawn', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const env = { ...ON, MAP_TILES: bucket, MAP_TILES_ETAG: bucket.etag };
    const pinned = await loadStreetLayer(env, [BLUE7]);
    expect(pinned).not.toBeNull();
    bucket.replace(await archiveFor(FRAMES, majorRoad));
    // Drawn from the pinned object before it was replaced: still that layer.
    expect(await loadStreetLayer(env, [BLUE7])).toBe(pinned);
    // A frame that has to read gets nothing, now and after.
    expect(await loadStreetLayer(env, [NEXT7])).toBeNull();
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    now = T0 + KEPT_LAYER_MS;
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    // (The old layer is still held, and out of reach: nothing is open to hand it out under.)
    for (const l of lines().slice(2)) expect(l.outcome).toBe('error');
  });

  it('an object with no etag is drawn and not kept', async () => {
    const real = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const noEtag: RangeBucket = {
      async get(k, o) {
        const got = await real.get(k, o);
        return got && { ...got, etag: undefined as unknown as string };
      },
    };
    const env = { ...ON, MAP_TILES: noEtag };
    expect(await loadStreetLayer(env, [BLUE7])).not.toBeNull();
    expect(keptStreetLayers()).toEqual({ layers: 0, chars: 0 });
    const reads = real.gets.length;
    expect(await loadStreetLayer(env, [BLUE7])).not.toBeNull();
    expect(real.gets.length).toBe(reads + 1);
  });
});

describe('kept street layers | handed out for KEPT_LAYER_MS and no longer', () => {
  it('an hour, the same hour the area map answer may be kept by a reader', () => {
    expect(KEPT_LAYER_MS).toBe(3_600_000);
  });

  it('kept until the last millisecond, then read and drawn again', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const env = { ...ON, MAP_TILES: bucket };
    const first = await loadStreetLayer(env, [BLUE7]);
    const reads = bucket.gets.length;
    now = T0 + KEPT_LAYER_MS - 1;
    expect(await loadStreetLayer(env, [BLUE7])).toBe(first);
    expect(bucket.gets).toHaveLength(reads);
    now = T0 + KEPT_LAYER_MS;
    const again = await loadStreetLayer(env, [BLUE7]);
    expect(bucket.gets.length).toBe(reads + 1);
    expect(again).not.toBe(first);
    // The new one's hour starts at its own draw. A hand-out does not extend it.
    now = T0 + 2 * KEPT_LAYER_MS - 1;
    expect(await loadStreetLayer(env, [BLUE7])).toBe(again);
    now = T0 + 2 * KEPT_LAYER_MS;
    expect(await loadStreetLayer(env, [BLUE7])).not.toBe(again);
  });

  it('an object replaced under the key that no read noticed: the old layer is out by the hour', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES));
    const env = { ...ON, MAP_TILES: bucket };
    const old = await loadStreetLayer(env, [BLUE7]);
    bucket.replace(await archiveFor(FRAMES, majorRoad));
    // Inside the hour nothing is read, so nothing can notice.
    now = T0 + KEPT_LAYER_MS - 1;
    expect(await loadStreetLayer(env, [BLUE7])).toBe(old);
    // At the hour the frame is read; the read is refused; the next one is the new object's.
    now = T0 + KEPT_LAYER_MS;
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    expect(lines().at(-1)).toMatchObject({ outcome: 'error' });
    const fresh = await loadStreetLayer(env, [BLUE7]);
    expect(fresh!.svg).toContain('as-r as-2');
  });
});

describe('kept street layers | the object removed under an isolate that has it open', () => {
  it('a kept frame is handed out until its hour is up; a frame that reads has no streets', async () => {
    const archive = await archiveFor(FRAMES);
    // Drawn once, three reads. From then on the bucket has no such object.
    const bucket = scriptedBucket(DEFAULT_ARCHIVE, archive, (n) => (n < 3 ? 'ok' : 'missing'));
    const env = { ...ON, MAP_TILES: bucket };
    const kept = await loadStreetLayer(env, [BLUE7]);
    expect(kept).not.toBeNull();
    expect(bucket.gets).toHaveLength(3);
    expect(await loadStreetLayer(env, [NEXT7])).toBeNull();
    expect(lines().at(-1)).toMatchObject({ outcome: 'no-archive' });
    now = T0 + KEPT_LAYER_MS - 1;
    expect(await loadStreetLayer(env, [BLUE7])).toBe(kept);
    now = T0 + KEPT_LAYER_MS;
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    expect(lines().at(-1)).toMatchObject({ outcome: 'no-archive' });
  });
});

describe('kept street layers | a null is never kept', () => {
  it('thin: asked again on the next request', async () => {
    const { tiles } = tilesOfFrame([BLUE7], () => [
      {
        name: 'water',
        features: [
          {
            type: 3,
            props: { kind: 'lake' },
            parts: [
              [
                [100, 100],
                [3000, 100],
                [3000, 3000],
                [100, 3000],
                [100, 100],
              ],
            ],
          },
        ],
      },
    ]);
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true }));
    const env = { ...ON, MAP_TILES: bucket };
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    expect(keptStreetLayers()).toEqual({ layers: 0, chars: 0 });
    const reads = bucket.gets.length;
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    expect(bucket.gets.length).toBeGreaterThan(reads);
    expect(lines().map((l) => l.outcome)).toEqual(['thin', 'thin']);
  });

  it('no tile for the frame: asked again', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor([[NEXT7]]));
    const env = { ...ON, MAP_TILES: bucket };
    const far = latLngToCell(34.05, -118.25, 7);
    expect(await loadStreetLayer(env, [far])).toBeNull();
    expect(await loadStreetLayer(env, [far])).toBeNull();
    expect(keptStreetLayers()).toEqual({ layers: 0, chars: 0 });
    expect(lines().map((l) => l.outcome)).toEqual(['no-tile', 'no-tile']);
  });

  it('slower than the limit: nothing is kept, not even when the read lands later', async () => {
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await archiveFor(FRAMES), { delayMs: 30 });
    const env = { ...ON, MAP_TILES: bucket };
    expect(await loadStreetLayer(env, [BLUE7], { timeoutMs: 5 })).toBeNull();
    await bucket.settle();
    expect(keptStreetLayers()).toEqual({ layers: 0, chars: 0 });
    expect(lines().map((l) => l.outcome)).toEqual(['timeout']);
  });
});

describe('kept street layers | the name a layer is kept under', () => {
  it('the drawer version, the frame size, the cells sorted, the numbered cells sorted', () => {
    expect(DRAWER_VERSION).toBe(1);
    expect(layerName(['b', 'a'], ['b'], 300, 200)).toBe('1|300x200|a,b|b');
    expect(layerName(['b', 'a'], ['c', 'b'], 300, 200)).toBe('1|300x200|a,b|b,c');
  });

  it('with nothing said: every cell carries a number, and the frame is the map size', () => {
    expect(layerName(['b', 'a'])).toBe(`${DRAWER_VERSION}|${MAP_W}x${MAP_H}|a,b|a,b`);
    expect(layerName([BLUE7])).toBe(`1|600x360|${BLUE7}|${BLUE7}`);
  });

  it('the object: the source key and the etag, and no two objects share a name', () => {
    expect(keptSource('r2:a.pmtiles', 'e1')).toBe('["r2:a.pmtiles","e1"]');
    expect(keptSource('r2:a', 'b|c')).not.toBe(keptSource('r2:a|b', 'c'));
    expect(
      keptSource(r2Source(fakeBucket('x.pmtiles', new Uint8Array(1)), 'x.pmtiles').key, 'e')
    ).toBe('["r2:x.pmtiles","e"]');
  });

  it('the etag a try read: one object with a known etag, or none', () => {
    const one = { etag: 'e1' };
    expect(keptEtag(new Set([one]))).toBe('e1');
    // Nothing was read.
    expect(keptEtag(new Set())).toBeUndefined();
    // The object gave no etag.
    expect(keptEtag(new Set([{}]))).toBeUndefined();
    // The archive was opened twice in one try: two objects, or one read twice over.
    expect(keptEtag(new Set([one, { etag: 'e2' }]))).toBeUndefined();
    expect(keptEtag(new Set([one, { etag: 'e1' }]))).toBeUndefined();
    expect(keptEtag(new Set([{}, one]))).toBeUndefined();
    // A read that was held to nothing.
    expect(keptEtag(new Set([undefined]))).toBeUndefined();
    expect(keptEtag(new Set([undefined, one]))).toBeUndefined();
  });
});

describe('kept street layers | the store', () => {
  const SRC = keptSource(KEY, 'e1');
  /** A layer whose name and markup count as exactly `chars`. */
  const layerOf = (name: string, chars: number): StreetLayer => ({
    cellsKey: name,
    svg: 'x'.repeat(chars - name.length),
    drawn: { water: 0, rivers: 0, highway: 1, major: 0, minor: 0 },
  });
  const QUARTER = KEPT_LAYER_CHARS / 4;

  it('the budget is 3,000,000 characters', () => {
    expect(KEPT_LAYER_CHARS).toBe(3_000_000);
  });

  it('keeps a layer under its object and its name, with its zoom', () => {
    const a = layerOf('a', 1000);
    keepStreetLayer(SRC, 'a', a, 12, T0);
    expect(keptStreetLayers()).toEqual({ layers: 1, chars: 1000 });
    expect(keptStreetLayer(SRC, 'a', T0)).toEqual({ layer: a, z: 12 });
    expect(keptStreetLayer(SRC, 'a', T0)!.layer).toBe(a);
    // Another name, or another object: nothing, and nothing is dropped.
    expect(keptStreetLayer(SRC, 'b', T0)).toBeNull();
    expect(keptStreetLayer(keptSource(KEY, 'e2'), 'a', T0)).toBeNull();
    expect(keptStreetLayer(keptSource('r2:other.pmtiles', 'e1'), 'a', T0)).toBeNull();
    expect(keptStreetLayers()).toEqual({ layers: 1, chars: 1000 });
    expect(keptStreetLayer(SRC, 'a', T0)!.layer).toBe(a);
  });

  it('no archive open is a name nothing is kept under, whatever an etag spells', () => {
    const none = keptSource(KEY, undefined);
    for (const etag of ['', 'null', 'undefined']) {
      keepStreetLayer(keptSource(KEY, etag), 'a', layerOf('a', 100), 9, T0);
      expect(keptStreetLayer(keptSource(KEY, etag), 'a', T0)).not.toBeNull();
      expect(keptStreetLayer(none, 'a', T0)).toBeNull();
    }
    resetStreetLayerCache();
    expect(keptStreetLayer(none, 'a', T0)).toBeNull();
  });

  it('a zoom that is not known is kept as null', () => {
    keepStreetLayer(SRC, 'a', layerOf('a', 100), null, T0);
    expect(keptStreetLayer(SRC, 'a', T0)!.z).toBeNull();
  });

  it('exactly the budget fits; one character more and the first kept goes', () => {
    for (const name of ['a', 'b', 'c', 'd'])
      keepStreetLayer(SRC, name, layerOf(name, QUARTER), 9, T0);
    expect(keptStreetLayers()).toEqual({ layers: 4, chars: KEPT_LAYER_CHARS });
    keepStreetLayer(SRC, 'e', layerOf('e', 1), 9, T0);
    expect(keptStreetLayers()).toEqual({ layers: 4, chars: KEPT_LAYER_CHARS - QUARTER + 1 });
    expect(keptStreetLayer(SRC, 'a', T0)).toBeNull();
    for (const name of ['b', 'c', 'd', 'e']) expect(keptStreetLayer(SRC, name, T0)).not.toBeNull();
  });

  it('as many go as it takes, first kept first, and the new one stays', () => {
    for (const name of ['a', 'b', 'c', 'd'])
      keepStreetLayer(SRC, name, layerOf(name, QUARTER), 9, T0);
    keepStreetLayer(SRC, 'big', layerOf('big', 2 * QUARTER + 1), 9, T0);
    expect(keptStreetLayers()).toEqual({ layers: 2, chars: 3 * QUARTER + 1 });
    expect(keptStreetLayer(SRC, 'd', T0)).not.toBeNull();
    expect(keptStreetLayer(SRC, 'big', T0)).not.toBeNull();
    for (const name of ['a', 'b', 'c']) expect(keptStreetLayer(SRC, name, T0)).toBeNull();
  });

  it('a layer handed out is the last to go', () => {
    for (const name of ['a', 'b', 'c', 'd'])
      keepStreetLayer(SRC, name, layerOf(name, QUARTER), 9, T0);
    expect(keptStreetLayer(SRC, 'a', T0)).not.toBeNull();
    keepStreetLayer(SRC, 'e', layerOf('e', QUARTER), 9, T0);
    keepStreetLayer(SRC, 'f', layerOf('f', QUARTER), 9, T0);
    // b and c went, in that order; a was asked for and stayed.
    for (const name of ['b', 'c']) expect(keptStreetLayer(SRC, name, T0)).toBeNull();
    for (const name of ['a', 'd', 'e', 'f']) expect(keptStreetLayer(SRC, name, T0)).not.toBeNull();
    expect(keptStreetLayers()).toEqual({ layers: 4, chars: KEPT_LAYER_CHARS });
  });

  it('a layer as large as the budget is kept alone; one character larger is not kept, and what is kept stays', () => {
    keepStreetLayer(SRC, 'a', layerOf('a', 1000), 9, T0);
    keepStreetLayer(SRC, 'over', layerOf('over', KEPT_LAYER_CHARS + 1), 9, T0);
    expect(keptStreetLayer(SRC, 'over', T0)).toBeNull();
    expect(keptStreetLayers()).toEqual({ layers: 1, chars: 1000 });
    // Not kept, and not a reason to drop another object's layers either.
    keepStreetLayer(keptSource(KEY, 'e2'), 'over', layerOf('over', KEPT_LAYER_CHARS + 1), 9, T0);
    expect(keptStreetLayer(SRC, 'a', T0)).not.toBeNull();

    keepStreetLayer(SRC, 'whole', layerOf('whole', KEPT_LAYER_CHARS), 9, T0);
    expect(keptStreetLayers()).toEqual({ layers: 1, chars: KEPT_LAYER_CHARS });
    expect(keptStreetLayer(SRC, 'whole', T0)).not.toBeNull();
    expect(keptStreetLayer(SRC, 'a', T0)).toBeNull();
  });

  it('the name counts: a layer is its name and its markup', () => {
    const name = 'n'.repeat(400);
    keepStreetLayer(SRC, name, { ...layerOf('a', 1), svg: 'x'.repeat(600) }, 9, T0);
    expect(keptStreetLayers()).toEqual({ layers: 1, chars: 1000 });
  });

  it('kept again under the same name: the new one takes its place and its count, and is the last to go', () => {
    keepStreetLayer(SRC, 'a', layerOf('a', QUARTER), 9, T0);
    keepStreetLayer(SRC, 'b', layerOf('b', QUARTER), 9, T0);
    const newer = layerOf('a', 2 * QUARTER);
    keepStreetLayer(SRC, 'a', newer, 10, T0 + 5);
    expect(keptStreetLayers()).toEqual({ layers: 2, chars: 3 * QUARTER });
    // b is now first: one more quarter fits, the next pushes b out and not a.
    keepStreetLayer(SRC, 'c', layerOf('c', QUARTER), 9, T0);
    keepStreetLayer(SRC, 'd', layerOf('d', 1), 9, T0);
    expect(keptStreetLayer(SRC, 'b', T0)).toBeNull();
    expect(keptStreetLayer(SRC, 'a', T0 + 5)).toEqual({ layer: newer, z: 10 });
  });

  it('a layer of another object: every layer of the old one goes first', () => {
    keepStreetLayer(SRC, 'a', layerOf('a', 1000), 9, T0);
    keepStreetLayer(SRC, 'b', layerOf('b', 1000), 9, T0);
    const other = keptSource(KEY, 'e2');
    keepStreetLayer(other, 'c', layerOf('c', 500), 9, T0);
    expect(keptStreetLayers()).toEqual({ layers: 1, chars: 500 });
    expect(keptStreetLayer(SRC, 'a', T0)).toBeNull();
    expect(keptStreetLayer(other, 'a', T0)).toBeNull();
    expect(keptStreetLayer(other, 'c', T0)).not.toBeNull();
    // The same object again: nothing goes.
    keepStreetLayer(other, 'd', layerOf('d', 500), 9, T0);
    expect(keptStreetLayers()).toEqual({ layers: 2, chars: 1000 });
  });

  it('handed out until KEPT_LAYER_MS after it was kept, then dropped and uncounted', () => {
    keepStreetLayer(SRC, 'a', layerOf('a', 1000), 9, T0);
    keepStreetLayer(SRC, 'b', layerOf('b', 500), 9, T0 + 10);
    expect(keptStreetLayer(SRC, 'a', T0 + KEPT_LAYER_MS - 1)).not.toBeNull();
    expect(keptStreetLayer(SRC, 'a', T0 + KEPT_LAYER_MS)).toBeNull();
    expect(keptStreetLayers()).toEqual({ layers: 1, chars: 500 });
    // Gone for good, at any time asked.
    expect(keptStreetLayer(SRC, 'a', T0)).toBeNull();
    expect(keptStreetLayer(SRC, 'b', T0 + KEPT_LAYER_MS + 9)).not.toBeNull();
    expect(keptStreetLayer(SRC, 'b', T0 + KEPT_LAYER_MS + 10)).toBeNull();
    expect(keptStreetLayers()).toEqual({ layers: 0, chars: 0 });
  });

  it('keeping freezes the layer and its counts', () => {
    const a = layerOf('a', 100);
    keepStreetLayer(SRC, 'a', a, 9, T0);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.drawn)).toBe(true);
  });

  it('reset forgets every layer', () => {
    keepStreetLayer(SRC, 'a', layerOf('a', 100), 9, T0);
    resetStreetLayerCache();
    expect(keptStreetLayers()).toEqual({ layers: 0, chars: 0 });
    expect(keptStreetLayer(SRC, 'a', T0)).toBeNull();
    expect(keptStreetLayer('', 'a', T0)).toBeNull();
    keepStreetLayer(SRC, 'b', layerOf('b', 100), 9, T0);
    expect(keptStreetLayers()).toEqual({ layers: 1, chars: 100 });
  });
});
