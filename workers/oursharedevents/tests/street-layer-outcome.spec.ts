/**
 * The street layer says what it did, and does not ask an empty bucket on every
 * view (lib/street-map.ts `loadStreetLayer` and `emitStreetLayer`,
 * lib/pmtiles.ts `r2Source` and `archiveKnownMissing`; street-map CCR
 * 2026-11-15, R4 and R5).
 *
 * Node-clean: in-memory archives and fake R2 buckets, the clock held by the
 * test. Registered in vitest.node-specs.mjs. The same rules through the Workers
 * runtime, with a real R2 binding, are in street-map-runtime.spec.ts.
 *
 * What these pin:
 *   - one STREET_LAYER line for each try that reads the bucket, and which of
 *     the six outcomes it names: drew, no-archive, no-tile, thin, timeout, error
 *   - the line is seven keys and no more: two words from fixed lists and five
 *     numbers. No cell, no archive name, no error text
 *   - the exits that read nothing write nothing
 *   - a line that cannot be written changes nothing on the page
 *   - "no object under this key", answered to the archive's first read, is
 *     remembered for MISS_MEMORY_MS and not a millisecond longer, a key at a
 *     time, and is the only thing remembered: a read that threw, broke, came
 *     back short or late, and a later read that found no object, are asked for
 *     again at once
 */
// @born-red the outcome line | method: 15 faults in src/lib/street-map.ts, one at a time, each seen failing here and put back: the emit call removed from loadStreetLayer (24 cases failed); thin and no-tile swapped (the case named for each); drew said for a null layer (12); a timeout said as error ("timeout" and the late read of the miss window); no-archive said as error (6); every error said as no-archive (the four "error" cases); `trace.gap = true` removed ("no-tile"); `trace.reads += 1` removed (11, on r2Reads); `trace.z` and `trace.tiles` not set (4 each); `Date.now() - started` turned to a sum ("ms is the time the try took" and 7 more); the 0 floor under ms removed ("a clock that steps back"); the surface written as given ("a surface that is not one of the two"); `cells` added to the payload ("what the line is given beyond its own fields"); the catch in emitStreetLayer rethrowing ("a line that cannot be written") | date: 2026-11-15
// @born-red the miss window | method: 11 faults, one at a time, each seen failing here and put back. In src/lib/pmtiles.ts: `MISSING.set` removed from r2Source; `<` turned to `<=` in archiveKnownMissing, the window twice as long, and the window never ending ("not a millisecond longer", "the object lands", "the source"); a miss remembered at any offset ("a later read that finds no object", "an object deleted under an isolate", "the source"); every throw of the read remembered as a miss (the "threw" and "broke in its body" cases); the miss marked before the read comes back and cleared when it does ("threw" and "came back after the limit"); a short answer to the first read taken for no object ("came back short"); the key written without the name ("a key at a time"); `MISSING.clear()` removed from resetPmtilesCache. In src/lib/street-map.ts: the `archiveKnownMissing` line removed from loadStreetLayer ("asked once", "not a millisecond longer", "the object lands") | date: 2026-11-15
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { latLngToCell } from 'h3-js';
import {
  DEFAULT_ARCHIVE,
  MIN_STREET_ZOOM,
  emitStreetLayer,
  frameForCells,
  frameZoom,
  loadStreetLayer,
  newStreetTrace,
  type StreetLayerLine,
} from '../src/lib/street-map';
import {
  ArchiveNotFoundError,
  MISS_MEMORY_MS,
  PmtilesError,
  archiveKnownMissing,
  r2Source,
  resetPmtilesCache,
} from '../src/lib/pmtiles';
import {
  fakeBucket,
  pmtilesArchive,
  scriptedBucket,
  tilesForCells,
  tilesOfFrame,
  type GetStep,
} from './helpers/street-map-fixtures';

const BLUE7 = latLngToCell(41.6573, -87.68, 7);
// Los Angeles: no tile in common with the Chicago cell at any zoom the map reads.
const FAR7 = latLngToCell(34.05, -118.25, 7);
const ON = { STREET_MAP: 'on' } as const;

/** The keys of the line, in the order it is written. */
const KEYS = ['type', 'outcome', 'surface', 'z', 'tiles', 'r2Reads', 'ms'];

/** The test's clock. `Date.now` reads it; nothing moves it but the test. */
const T0 = Date.parse('2026-11-15T12:00:00.000Z');
let now = T0;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetPmtilesCache();
  now = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

/** Every line written so far, as text. */
const written = (): string[] => log.mock.calls.map((c: unknown[]) => String(c[0]));
/** Every STREET_LAYER line written so far. */
const lines = (): StreetLayerLine[] =>
  written()
    .map((text) => JSON.parse(text) as StreetLayerLine)
    .filter((l) => l.type === 'STREET_LAYER');

/** A sound archive for one area, gzipped, its tiles behind a leaf directory: three reads cold. */
const sound = async (cells = [BLUE7]) => {
  const { r, tiles } = tilesForCells(cells);
  return { r, tiles, archive: await pmtilesArchive(tiles, { gzip: true, leaf: true }) };
};

describe('street layer outcome | one line for each try that reads the bucket', () => {
  it('drew: the layer is returned, and the line says so with the zoom, the tiles and the reads', async () => {
    const { r, tiles, archive } = await sound();
    const bucket = fakeBucket(DEFAULT_ARCHIVE, archive);
    const layer = await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7], {
      surface: 'landing',
    });
    expect(layer?.svg).toContain('data-testid="amap-streets"');
    expect(bucket.gets).toHaveLength(3);
    expect(lines()).toEqual([
      {
        type: 'STREET_LAYER',
        outcome: 'drew',
        surface: 'landing',
        z: r.z,
        tiles: tiles.length,
        r2Reads: 3,
        ms: 0,
      },
    ]);
    // Exactly one line, and it is the whole of what the loader wrote.
    expect(written()).toHaveLength(1);
    // The next map of the area in the isolate: the directories are kept, one read.
    await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7], { surface: 'landing' });
    expect(lines()).toHaveLength(2);
    expect(lines()[1]).toMatchObject({ outcome: 'drew', z: r.z, tiles: tiles.length, r2Reads: 1 });
  });

  it('no-archive: the bucket has no such object. One read, no zoom, no tile', async () => {
    const bucket = fakeBucket('other.pmtiles', new Uint8Array(200));
    expect(
      await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7], { surface: 'landing' })
    ).toBeNull();
    expect(bucket.gets).toHaveLength(1);
    expect(lines()).toEqual([
      {
        type: 'STREET_LAYER',
        outcome: 'no-archive',
        surface: 'landing',
        z: null,
        tiles: 0,
        r2Reads: 1,
        ms: 0,
      },
    ]);
  });

  it('no-tile: a sound archive with no tile for the frame', async () => {
    // Tiles for another part of the world.
    const { archive } = await sound([FAR7]);
    const bucket = fakeBucket(DEFAULT_ARCHIVE, archive);
    const want = tilesForCells([BLUE7]);
    expect(
      await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7], { surface: 'map-areas' })
    ).toBeNull();
    expect(lines()).toEqual([
      {
        type: 'STREET_LAYER',
        outcome: 'no-tile',
        surface: 'map-areas',
        z: want.r.z,
        tiles: want.tiles.length,
        r2Reads: bucket.gets.length,
        ms: 0,
      },
    ]);
    // The header and the directory were read; no tile was there to read.
    expect(bucket.gets.length).toBeGreaterThan(0);
  });

  it('thin: every tile was read and drawn, and held no street map', async () => {
    // Water in every tile of the frame and not one road (layerShows).
    const { r, tiles } = tilesOfFrame([BLUE7], () => [
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
    expect(
      await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7], { surface: 'landing' })
    ).toBeNull();
    expect(lines()).toEqual([
      {
        type: 'STREET_LAYER',
        outcome: 'thin',
        surface: 'landing',
        z: r.z,
        tiles: tiles.length,
        r2Reads: bucket.gets.length,
        ms: 0,
      },
    ]);
    expect(bucket.gets.length).toBeGreaterThan(1);
  });

  it('timeout: slower than the limit. The line is written when the limit runs out', async () => {
    const { archive } = await sound();
    const bucket = fakeBucket(DEFAULT_ARCHIVE, archive, { delayMs: 150 });
    expect(
      await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7], {
        timeoutMs: 20,
        surface: 'landing',
      })
    ).toBeNull();
    // The first read was asked for and had not come back.
    expect(lines()).toEqual([
      {
        type: 'STREET_LAYER',
        outcome: 'timeout',
        surface: 'landing',
        z: null,
        tiles: 0,
        r2Reads: 1,
        ms: 0,
      },
    ]);
    // The read left behind runs on to its end and writes no second line.
    await bucket.settle();
    expect(lines()).toHaveLength(1);
  });

  it.each<[string, (archive: Uint8Array) => ReturnType<typeof scriptedBucket>, number]>([
    [
      'the first read throws',
      (a) => scriptedBucket(DEFAULT_ARCHIVE, a, (n) => (n === 0 ? 'throw' : 'ok')),
      1,
    ],
    [
      'the body of the first read breaks',
      (a) => scriptedBucket(DEFAULT_ARCHIVE, a, (n) => (n === 0 ? 'body-fails' : 'ok')),
      1,
    ],
    [
      'the tiles come back short',
      (a) => scriptedBucket(DEFAULT_ARCHIVE, a, (n) => (n === 2 ? { shortTo: 10 } : 'ok')),
      3,
    ],
    [
      'the object is not a PMTiles archive',
      () => scriptedBucket(DEFAULT_ARCHIVE, new Uint8Array(4096).fill(7), () => 'ok'),
      1,
    ],
  ])('error: %s', async (_, make, reads) => {
    const { archive } = await sound();
    const bucket = make(archive);
    expect(
      await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7], { surface: 'landing' })
    ).toBeNull();
    expect(bucket.gets).toHaveLength(reads);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      type: 'STREET_LAYER',
      outcome: 'error',
      surface: 'landing',
      r2Reads: reads,
    });
  });

  it('ms is the time the try took, by the clock', async () => {
    const { archive } = await sound();
    // Every read of the bucket takes 25 ms of the test's clock.
    const bucket = scriptedBucket(DEFAULT_ARCHIVE, archive, () => {
      now += 25;
      return 'ok';
    });
    now = T0 + 1_000;
    await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7], { surface: 'landing' });
    expect(bucket.gets).toHaveLength(3);
    expect(lines()[0]!.ms).toBe(75);
  });

  it('a clock that steps back is 0 ms, never a negative time', async () => {
    const { archive } = await sound();
    const bucket = scriptedBucket(DEFAULT_ARCHIVE, archive, () => {
      now -= 25;
      return 'ok';
    });
    await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7], { surface: 'landing' });
    expect(lines()[0]).toMatchObject({ outcome: 'drew', ms: 0 });
  });
});

describe('street layer outcome | the line is sealed', () => {
  it('seven keys and no more, in every outcome', async () => {
    const { archive } = await sound();
    await loadStreetLayer({ ...ON, MAP_TILES: fakeBucket(DEFAULT_ARCHIVE, archive) }, [BLUE7]);
    resetPmtilesCache();
    await loadStreetLayer({ ...ON, MAP_TILES: fakeBucket('other.pmtiles', archive) }, [BLUE7]);
    resetPmtilesCache();
    await loadStreetLayer({ ...ON, MAP_TILES: fakeBucket(DEFAULT_ARCHIVE, archive) }, [FAR7]);
    resetPmtilesCache();
    const junk = fakeBucket(DEFAULT_ARCHIVE, new Uint8Array(4096).fill(7));
    await loadStreetLayer({ ...ON, MAP_TILES: junk }, [BLUE7]);
    expect(lines().map((l) => l.outcome)).toEqual(['drew', 'no-archive', 'no-tile', 'error']);
    for (const line of lines()) expect(Object.keys(line)).toEqual(KEYS);
  });

  it('never where: no cell, no archive name and no tile address is in the text', async () => {
    const name = 'region-2026.pmtiles';
    const { r, tiles, archive } = await sound();
    const env = { ...ON, MAP_TILES: fakeBucket(name, archive), MAP_TILES_ARCHIVE: name };
    await loadStreetLayer(env, [BLUE7], { numbered: [BLUE7], surface: 'map-areas' });
    const text = written().join('\n');
    expect(text).toBe(
      `{"type":"STREET_LAYER","outcome":"drew","surface":"map-areas","z":${r.z},"tiles":${tiles.length},"r2Reads":3,"ms":0}`
    );
    expect(text).not.toContain(BLUE7);
    expect(text).not.toContain('region');
    expect(text).not.toContain('pmtiles');
    // No tile column or row: the frame's own are four- and five-digit numbers.
    for (const t of tiles) {
      expect(text).not.toContain(String(t.x));
      expect(text).not.toContain(String(t.y));
    }
  });

  it('a surface that is not one of the two is written as "other"', async () => {
    const { archive } = await sound();
    const bucket = fakeBucket(DEFAULT_ARCHIVE, archive);
    const env = { ...ON, MAP_TILES: bucket };
    await loadStreetLayer(env, [BLUE7], { surface: 'landing' });
    await loadStreetLayer(env, [BLUE7], { surface: 'map-areas' });
    // Not said.
    await loadStreetLayer(env, [BLUE7]);
    await loadStreetLayer(env, [BLUE7], {});
    // A caller that hands on a word from a request: it is not written.
    await loadStreetLayer(env, [BLUE7], { surface: 'st-marys-fish-fry' as never });
    await loadStreetLayer(env, [BLUE7], { surface: { toString: () => 'landing' } as never });
    expect(lines().map((l) => l.surface)).toEqual([
      'landing',
      'map-areas',
      'other',
      'other',
      'other',
      'other',
    ]);
    expect(written().join('\n')).not.toContain('fish');
  });

  it('what the line is given beyond its own fields is not written', () => {
    const trace = { ...newStreetTrace(), z: 12, tiles: 4, reads: 2, cell: BLUE7 };
    emitStreetLayer({
      outcome: 'drew',
      surface: 'landing',
      trace,
      ms: 40,
      cells: [BLUE7],
      url: 'https://t.test/?t=secret',
    } as never);
    expect(written()).toEqual([
      '{"type":"STREET_LAYER","outcome":"drew","surface":"landing","z":12,"tiles":4,"r2Reads":2,"ms":40}',
    ]);
  });

  it('a new trace is empty', () => {
    expect(newStreetTrace()).toEqual({ z: null, tiles: 0, reads: 0, gap: false });
  });
});

describe('street layer outcome | the exits that read nothing write nothing', () => {
  it('the switch off, no binding, no cells, a bad name, a frame too wide', async () => {
    const { archive } = await sound();
    const bucket = fakeBucket(DEFAULT_ARCHIVE, archive);
    const opts = { surface: 'landing' } as const;
    expect(await loadStreetLayer({ STREET_MAP: 'off', MAP_TILES: bucket }, [BLUE7], opts)).toBe(
      null
    );
    expect(await loadStreetLayer({ MAP_TILES: bucket }, [BLUE7], opts)).toBeNull();
    expect(await loadStreetLayer(ON, [BLUE7], opts)).toBeNull();
    expect(await loadStreetLayer(null, [BLUE7], opts)).toBeNull();
    expect(await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [], opts)).toBeNull();
    expect(
      await loadStreetLayer(
        { ...ON, MAP_TILES: bucket, MAP_TILES_ARCHIVE: '../x.pmtiles' },
        [BLUE7],
        opts
      )
    ).toBeNull();
    const wide = [BLUE7, FAR7];
    expect(frameZoom(frameForCells(wide))).toBeLessThan(MIN_STREET_ZOOM);
    expect(await loadStreetLayer({ ...ON, MAP_TILES: bucket }, wide, opts)).toBeNull();
    expect(bucket.gets).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
    // The same bucket and options, switched on and in frame: read, and one line.
    expect(await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7], opts)).not.toBeNull();
    expect(lines()).toHaveLength(1);
  });
});

describe('street layer outcome | a line that cannot be written', () => {
  it('changes nothing: the layer is returned, a miss is still null, and nothing throws', async () => {
    log.mockImplementation(() => {
      throw new Error('the log is closed');
    });
    const { archive } = await sound();
    const layer = await loadStreetLayer(
      { ...ON, MAP_TILES: fakeBucket(DEFAULT_ARCHIVE, archive) },
      [BLUE7]
    );
    expect(layer?.svg).toContain('data-testid="amap-streets"');
    resetPmtilesCache();
    expect(
      await loadStreetLayer({ ...ON, MAP_TILES: fakeBucket('other.pmtiles', archive) }, [BLUE7])
    ).toBeNull();
    // Both tried to write.
    expect(log).toHaveBeenCalledTimes(2);
    expect(() =>
      emitStreetLayer({ outcome: 'error', surface: 'landing', trace: newStreetTrace(), ms: 1 })
    ).not.toThrow();
  });
});

describe('street layer miss window | an empty bucket is asked once a minute', () => {
  /** A bucket that holds the archive from get number `from` on, and nothing before. */
  const landsAt = (archive: Uint8Array, from: number) =>
    scriptedBucket(DEFAULT_ARCHIVE, archive, (n): GetStep => (n < from ? 'missing' : 'ok'));

  it('the window is one minute', () => {
    expect(MISS_MEMORY_MS).toBe(60_000);
  });

  it('asked once: the views that follow inside the window read nothing and write nothing', async () => {
    const bucket = fakeBucket('other.pmtiles', new Uint8Array(200));
    const env = { ...ON, MAP_TILES: bucket };
    expect(await loadStreetLayer(env, [BLUE7], { surface: 'landing' })).toBeNull();
    expect(bucket.gets).toHaveLength(1);
    expect(lines().map((l) => l.outcome)).toEqual(['no-archive']);
    for (const later of [0, 1, 1_000, 30_000, MISS_MEMORY_MS - 1]) {
      now = T0 + later;
      expect(await loadStreetLayer(env, [BLUE7], { surface: 'landing' })).toBeNull();
      // Another area, the other surface: the object is missing for them all.
      expect(await loadStreetLayer(env, [FAR7], { surface: 'map-areas' })).toBeNull();
    }
    expect(bucket.gets).toHaveLength(1);
    expect(lines()).toHaveLength(1);
  });

  it('not a millisecond longer: at the end of the window the bucket is asked again', async () => {
    const bucket = fakeBucket('other.pmtiles', new Uint8Array(200));
    const env = { ...ON, MAP_TILES: bucket };
    await loadStreetLayer(env, [BLUE7]);
    now = T0 + MISS_MEMORY_MS - 1;
    await loadStreetLayer(env, [BLUE7]);
    expect(bucket.gets).toHaveLength(1);
    now = T0 + MISS_MEMORY_MS;
    await loadStreetLayer(env, [BLUE7]);
    expect(bucket.gets).toHaveLength(2);
    // Still missing: a new window, counted from this read.
    now = T0 + 2 * MISS_MEMORY_MS - 1;
    await loadStreetLayer(env, [BLUE7]);
    expect(bucket.gets).toHaveLength(2);
    now = T0 + 2 * MISS_MEMORY_MS;
    await loadStreetLayer(env, [BLUE7]);
    expect(bucket.gets).toHaveLength(3);
    expect(lines().map((l) => l.outcome)).toEqual(['no-archive', 'no-archive', 'no-archive']);
  });

  it('the object lands: hexagons only until the window is up, then streets, with no deploy', async () => {
    const { archive } = await sound();
    // The first get finds nothing. The object is there from the second on.
    const bucket = landsAt(archive, 1);
    const env = { ...ON, MAP_TILES: bucket };
    expect(await loadStreetLayer(env, [BLUE7], { surface: 'landing' })).toBeNull();
    // Loaded now, and the isolate does not look yet.
    now = T0 + MISS_MEMORY_MS - 1;
    expect(await loadStreetLayer(env, [BLUE7], { surface: 'landing' })).toBeNull();
    expect(bucket.gets).toHaveLength(1);
    now = T0 + MISS_MEMORY_MS;
    const layer = await loadStreetLayer(env, [BLUE7], { surface: 'landing' });
    expect(layer?.svg).toContain('data-testid="amap-streets"');
    expect(bucket.gets).toHaveLength(4);
    expect(lines().map((l) => l.outcome)).toEqual(['no-archive', 'drew']);
    // And the view after that: the directories are kept, one read.
    expect(await loadStreetLayer(env, [BLUE7], { surface: 'landing' })).not.toBeNull();
    expect(bucket.gets).toHaveLength(5);
  });

  it.each<[string, GetStep, string]>([
    ['threw', 'throw', 'error'],
    ['broke in its body', 'body-fails', 'error'],
    ['came back short', { shortTo: 10 }, 'error'],
    ['came back after the limit', { delayMs: 150 }, 'timeout'],
  ])(
    'a read that failed is not a miss: one that %s is asked for again at once',
    async (_, bad, said) => {
      const { archive } = await sound();
      const bucket = scriptedBucket(DEFAULT_ARCHIVE, archive, (n) => (n === 0 ? bad : 'ok'));
      const env = { ...ON, MAP_TILES: bucket };
      expect(await loadStreetLayer(env, [BLUE7], { timeoutMs: 20 })).toBeNull();
      expect(archiveKnownMissing(`r2:${DEFAULT_ARCHIVE}`)).toBe(false);
      // Let a late read land and run out before the next try.
      await new Promise((r) => setTimeout(r, 200));
      const before = bucket.gets.length;
      const layer = await loadStreetLayer(env, [BLUE7], { timeoutMs: 5_000 });
      expect(layer?.svg).toContain('data-testid="amap-streets"');
      expect(bucket.gets.length).toBeGreaterThan(before);
      expect(lines().map((l) => l.outcome)).toEqual([said, 'drew']);
    }
  );

  it('a later read that finds no object is no-archive in the log, and is not remembered', async () => {
    const { archive } = await sound();
    // The header is read; the leaf directory read finds no object.
    const bucket = scriptedBucket(DEFAULT_ARCHIVE, archive, (n) => (n === 1 ? 'missing' : 'ok'));
    const env = { ...ON, MAP_TILES: bucket };
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    expect(bucket.gets).toHaveLength(2);
    expect(bucket.gets[1]!.range!.offset).toBeGreaterThan(0);
    expect(lines().map((l) => l.outcome)).toEqual(['no-archive']);
    expect(archiveKnownMissing(`r2:${DEFAULT_ARCHIVE}`)).toBe(false);
    // The next view asks at once, and draws.
    expect(await loadStreetLayer(env, [BLUE7])).not.toBeNull();
    expect(lines().map((l) => l.outcome)).toEqual(['no-archive', 'drew']);
  });

  it('an object deleted under an isolate that has it open: asked for on every view, and said each time', async () => {
    const { archive } = await sound();
    // Drawn once: the isolate holds the directories. From then on the object is gone.
    const bucket = scriptedBucket(DEFAULT_ARCHIVE, archive, (n) => (n < 3 ? 'ok' : 'missing'));
    const env = { ...ON, MAP_TILES: bucket };
    expect(await loadStreetLayer(env, [BLUE7])).not.toBeNull();
    expect(bucket.gets).toHaveLength(3);
    for (const view of [1, 2, 3]) {
      expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
      expect(bucket.gets).toHaveLength(3 + view);
    }
    expect(lines().map((l) => l.outcome)).toEqual([
      'drew',
      'no-archive',
      'no-archive',
      'no-archive',
    ]);
    // A new isolate opens from the first byte, and remembers.
    resetPmtilesCache();
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    expect(bucket.gets).toHaveLength(7);
  });

  it('a key at a time: one name found missing does not hide another', async () => {
    const { archive } = await sound();
    const bucket = fakeBucket('region-2026.pmtiles', archive);
    expect(await loadStreetLayer({ ...ON, MAP_TILES: bucket }, [BLUE7])).toBeNull();
    expect(archiveKnownMissing(`r2:${DEFAULT_ARCHIVE}`)).toBe(true);
    expect(archiveKnownMissing('r2:region-2026.pmtiles')).toBe(false);
    const layer = await loadStreetLayer(
      { ...ON, MAP_TILES: bucket, MAP_TILES_ARCHIVE: 'region-2026.pmtiles' },
      [BLUE7]
    );
    expect(layer?.svg).toContain('data-testid="amap-streets"');
  });

  it('forgotten with the rest of what the isolate keeps (resetPmtilesCache)', async () => {
    const bucket = fakeBucket('other.pmtiles', new Uint8Array(200));
    const env = { ...ON, MAP_TILES: bucket };
    await loadStreetLayer(env, [BLUE7]);
    expect(archiveKnownMissing(`r2:${DEFAULT_ARCHIVE}`)).toBe(true);
    resetPmtilesCache();
    expect(archiveKnownMissing(`r2:${DEFAULT_ARCHIVE}`)).toBe(false);
    await loadStreetLayer(env, [BLUE7]);
    expect(bucket.gets).toHaveLength(2);
  });

  it('the source: a first read that finds no object throws ArchiveNotFoundError and is remembered', async () => {
    const bucket = fakeBucket('other.pmtiles', new Uint8Array(200));
    const src = r2Source(bucket, 'us.pmtiles');
    expect(src.key).toBe('r2:us.pmtiles');
    expect(archiveKnownMissing(src.key)).toBe(false);
    const miss = await src.read(0, 16).catch((e: unknown) => e);
    expect(miss).toBeInstanceOf(ArchiveNotFoundError);
    expect(miss).toBeInstanceOf(PmtilesError);
    expect(archiveKnownMissing(src.key)).toBe(true);
    now = T0 + MISS_MEMORY_MS - 1;
    expect(archiveKnownMissing(src.key)).toBe(true);
    now = T0 + MISS_MEMORY_MS;
    expect(archiveKnownMissing(src.key)).toBe(false);
    // The source itself always asks: the memory is for its caller to read first.
    await expect(src.read(0, 16)).rejects.toBeInstanceOf(ArchiveNotFoundError);
    expect(bucket.gets).toHaveLength(2);
    // Past the first byte it throws the same and remembers nothing.
    resetPmtilesCache();
    await expect(src.read(127, 16)).rejects.toBeInstanceOf(ArchiveNotFoundError);
    expect(archiveKnownMissing(src.key)).toBe(false);
  });
});
