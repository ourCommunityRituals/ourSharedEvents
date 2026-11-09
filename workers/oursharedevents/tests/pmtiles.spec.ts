/**
 * PMTiles v3 reader (lib/pmtiles.ts) — the street map's tile source.
 *
 * Node-clean: pure byte handling over in-memory archives. Registered in
 * vitest.node-specs.mjs.
 *
 * What these pin:
 *   - the tile id matches the spec's published values and is a true Hilbert
 *     curve (every id once, each step to a neighbouring tile)
 *   - tiles are found in the root directory, through a leaf directory, and with
 *     gzip on both directories and tiles
 *   - a missing tile or a zoom outside the archive is null, not an error
 *   - a file that is not PMTiles v3 is refused
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  archiveHeader,
  decodeDirectory,
  findEntry,
  parseHeader,
  readTile,
  resetPmtilesCache,
  zxyToTileId,
  PmtilesError,
} from '../src/lib/pmtiles';
import { memSource, pmtilesArchive, varint } from './helpers/street-map-fixtures';

const bytes = (s: string) => new TextEncoder().encode(s);

beforeEach(() => resetPmtilesCache());

describe('pmtiles | tile id', () => {
  it('matches the spec values for z0 to z2', () => {
    expect(zxyToTileId(0, 0, 0)).toBe(0);
    expect(zxyToTileId(1, 0, 0)).toBe(1);
    expect(zxyToTileId(1, 0, 1)).toBe(2);
    expect(zxyToTileId(1, 1, 1)).toBe(3);
    expect(zxyToTileId(1, 1, 0)).toBe(4);
    expect(zxyToTileId(2, 0, 0)).toBe(5);
  });

  it('walks a Hilbert curve: every id once, each step to a neighbouring tile', () => {
    for (const z of [3, 5]) {
      const n = 2 ** z;
      const base = (4 ** z - 1) / 3;
      const at = new Map<number, [number, number]>();
      for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) at.set(zxyToTileId(z, x, y), [x, y]);
      expect(at.size).toBe(n * n);
      for (let id = base; id < base + n * n; id++) {
        expect(at.has(id)).toBe(true);
        if (id > base) {
          const [ax, ay] = at.get(id - 1)!;
          const [bx, by] = at.get(id)!;
          expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1);
        }
      }
    }
  });

  it('refuses a tile outside its zoom', () => {
    expect(() => zxyToTileId(2, 4, 0)).toThrow(PmtilesError);
    expect(() => zxyToTileId(-1, 0, 0)).toThrow(PmtilesError);
  });
});

describe('pmtiles | directories', () => {
  it('reads a run of tiles and an offset of 0 as "right after the last one"', () => {
    // two entries: id 5 (run 2) at offset 0 len 10, then id 9 contiguous len 4
    const dir = new Uint8Array([
      ...varint(2),
      ...varint(5),
      ...varint(4),
      ...varint(2),
      ...varint(1),
      ...varint(10),
      ...varint(4),
      ...varint(1),
      ...varint(0),
    ]);
    const entries = decodeDirectory(dir);
    expect(entries).toEqual([
      { tileId: 5, offset: 0, length: 10, runLength: 2 },
      { tileId: 9, offset: 10, length: 4, runLength: 1 },
    ]);
    expect(findEntry(entries, 6)).toBe(entries[0]);
    expect(findEntry(entries, 7)).toBeNull();
    expect(findEntry(entries, 4)).toBeNull();
    expect(findEntry(entries, 9)).toBe(entries[1]);
  });

  it('refuses a truncated directory', () => {
    expect(() => decodeDirectory(new Uint8Array([3, 1]))).toThrow(PmtilesError);
  });
});

describe('pmtiles | archives', () => {
  const tiles = [
    { z: 0, x: 0, y: 0, data: bytes('world') },
    { z: 3, x: 2, y: 5, data: bytes('tile-325') },
    { z: 3, x: 7, y: 7, data: bytes('tile-377') },
  ];

  for (const opts of [{}, { gzip: true }, { leaf: true }, { leaf: true, gzip: true }]) {
    it(`finds each tile (${JSON.stringify(opts)})`, async () => {
      const src = memSource(await pmtilesArchive(tiles, opts));
      for (const t of tiles) {
        const got = await readTile(src, t.z, t.x, t.y);
        expect(new TextDecoder().decode(got!)).toBe(new TextDecoder().decode(t.data));
      }
      expect(await readTile(src, 3, 0, 0)).toBeNull();
    });
  }

  it('reads the header once and keeps it', async () => {
    const src = memSource(await pmtilesArchive(tiles));
    await readTile(src, 3, 2, 5);
    await readTile(src, 3, 7, 7);
    const headerReads = src.reads.filter(([off]) => off === 0);
    expect(headerReads).toHaveLength(1);
  });

  it('a zoom outside the archive is null, without a tile read', async () => {
    const src = memSource(await pmtilesArchive(tiles, { minZoom: 0, maxZoom: 3 }));
    expect((await archiveHeader(src)).maxZoom).toBe(3);
    const before = src.reads.length;
    expect(await readTile(src, 4, 0, 0)).toBeNull();
    expect(src.reads.length).toBe(before);
  });

  it('refuses a file that is not PMTiles v3', async () => {
    const archive = await pmtilesArchive(tiles);
    expect(() => parseHeader(archive.slice(0, 50))).toThrow(PmtilesError);
    const wrongMagic = archive.slice();
    wrongMagic[0] = 0x58;
    expect(() => parseHeader(wrongMagic)).toThrow(/not a PMTiles/);
    const v2 = archive.slice();
    v2[7] = 2;
    expect(() => parseHeader(v2)).toThrow(/version 2/);
    await expect(readTile(memSource(v2), 0, 0, 0)).rejects.toThrow(PmtilesError);
  });
});
