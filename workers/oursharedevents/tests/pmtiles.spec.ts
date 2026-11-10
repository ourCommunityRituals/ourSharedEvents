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
 *   - every range check at its exact boundary, the per-archive and leaf caches
 *     (counted reads on a fake source), and the R2 source
 *   - a whole-planet build's layout, on a sparse file: every tile two leaf
 *     directories down, byte offsets past 4 GiB and 128 GiB, an open-water run
 *   - the leaf cache is bounded by the entries it keeps, not only by its count
 */
// @born-red pmtiles reader mutants | method: StrykerJS mutants of src/lib/pmtiles.ts, each new test seen failing against the mutant it kills (status Killed in the report) | date: 2026-11-09
// @born-red planet-sized layout and leaf entry budget | method: 6 faults injected one at a time in src/lib/pmtiles.ts (header offsets cut to 32 bits, directory offsets cut to 32 bits, one leaf level only, a run covering only its first tile, leaves never kept, the entry budget never applied), each planet and budget case seen failing on at least one; the budget cases also seen failing before the budget existed. "is laid out as meant" checks the fixture, not the reader | date: 2026-11-09
import { describe, it, expect, beforeEach } from 'vitest';
import {
  archiveHeader,
  decodeDirectory,
  decompress,
  findEntry,
  parseHeader,
  planReads,
  r2Source,
  readTile,
  readTiles,
  resetPmtilesCache,
  zxyToTileId,
  PmtilesError,
  HEADER_BYTES,
  MAX_LEAF_ENTRIES,
  MAX_READ_BYTES,
  MAX_READ_GAP,
  type DirEntry,
  type RangeSource,
} from '../src/lib/pmtiles';
import {
  fakeBucket,
  gzip,
  memSource,
  planetArchive,
  pmtilesArchive,
  sparseSource,
  varint,
  type PlanetTile,
} from './helpers/street-map-fixtures';

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

// ── a raw archive writer, so each test places the directories where it needs ──

function dirOf(entries: DirEntry[]): Uint8Array {
  const out = [...varint(entries.length)];
  let last = 0;
  for (const e of entries) {
    out.push(...varint(e.tileId - last));
    last = e.tileId;
  }
  for (const e of entries) out.push(...varint(e.runLength));
  for (const e of entries) out.push(...varint(e.length));
  for (const e of entries) out.push(...varint(e.offset + 1));
  return new Uint8Array(out);
}

function putU64(b: Uint8Array, at: number, v: number): void {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  view.setUint32(at, v % 2 ** 32, true);
  view.setUint32(at + 4, Math.floor(v / 2 ** 32), true);
}

function headerBytes(): Uint8Array {
  const h = new Uint8Array(HEADER_BYTES);
  h.set(bytes('PMTiles'), 0);
  h[7] = 3;
  return h;
}

interface RawArchive {
  archive: Uint8Array;
  leafAt: number;
}

function rawArchive(p: {
  root: Uint8Array;
  leaves?: Uint8Array;
  data?: Uint8Array;
  rootAt?: number;
  minZoom?: number;
  maxZoom?: number;
}): RawArchive {
  const leaves = p.leaves ?? new Uint8Array(0);
  const data = p.data ?? new Uint8Array(0);
  const rootAt = p.rootAt ?? HEADER_BYTES;
  const leafAt = rootAt + p.root.length;
  const dataAt = leafAt + leaves.length;
  const out = new Uint8Array(dataAt + data.length);
  out.set(headerBytes(), 0);
  putU64(out, 8, rootAt);
  putU64(out, 16, p.root.length);
  putU64(out, 40, leafAt);
  putU64(out, 56, dataAt);
  out[97] = 1;
  out[98] = 1;
  out[99] = 1;
  out[100] = p.minZoom ?? 0;
  out[101] = p.maxZoom ?? 15;
  out.set(p.root, rootAt);
  out.set(leaves, leafAt);
  out.set(data, dataAt);
  return { archive: out, leafAt };
}

interface Tile {
  z: number;
  x: number;
  y: number;
  data: Uint8Array;
}

/** Every tile in its own leaf directory; the root holds one leaf pointer per tile. */
function leafPerTile(tiles: Tile[]): RawArchive & { leafOf: Map<Tile, number> } {
  const sorted = tiles
    .map((t) => ({ t, id: zxyToTileId(t.z, t.x, t.y) }))
    .sort((a, b) => a.id - b.id);
  const data: number[] = [];
  const leaves: number[] = [];
  const pointers: DirEntry[] = [];
  const leafOffset = new Map<Tile, number>();
  for (const { t, id } of sorted) {
    const leaf = dirOf([{ tileId: id, offset: data.length, length: t.data.length, runLength: 1 }]);
    data.push(...t.data);
    pointers.push({ tileId: id, offset: leaves.length, length: leaf.length, runLength: 0 });
    leafOffset.set(t, leaves.length);
    leaves.push(...leaf);
  }
  const raw = rawArchive({
    root: dirOf(pointers),
    leaves: new Uint8Array(leaves),
    data: new Uint8Array(data),
  });
  const leafOf = new Map([...leafOffset].map(([t, off]) => [t, raw.leafAt + off]));
  return { ...raw, leafOf };
}

/** One tile behind `levels` leaf directories, each pointing to the next. */
function chainArchive(levels: number, t: Tile): Uint8Array {
  const id = zxyToTileId(t.z, t.x, t.y);
  const section: number[] = [];
  let child = dirOf([{ tileId: id, offset: 0, length: t.data.length, runLength: 1 }]);
  let childAt = 0;
  section.push(...child);
  for (let k = levels - 1; k >= 1; k--) {
    const b = dirOf([{ tileId: id, offset: childAt, length: child.length, runLength: 0 }]);
    childAt = section.length;
    child = b;
    section.push(...b);
  }
  const root = dirOf([{ tileId: id, offset: childAt, length: child.length, runLength: 0 }]);
  return rawArchive({ root, leaves: new Uint8Array(section), data: t.data }).archive;
}

/** A source whose first read matching `when` fails, as a dropped connection would. */
function failOnce(
  src: RangeSource,
  when: (offset: number) => boolean
): RangeSource & { failures: number } {
  const s = {
    key: src.key,
    failures: 0,
    async read(offset: number, length: number) {
      if (s.failures === 0 && when(offset)) {
        s.failures++;
        throw new Error('connection dropped');
      }
      return src.read(offset, length);
    },
  };
  return s;
}

/** Hilbert d for (x, y) on an n×n grid, written from the textbook xy2d, without bit ops. */
function referenceTileId(z: number, x: number, y: number): number {
  const n = 2 ** z;
  let d = 0;
  let px = x;
  let py = y;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = Math.floor(px / s) % 2;
    const ry = Math.floor(py / s) % 2;
    d += s * s * (rx === 0 ? (ry === 0 ? 0 : 1) : ry === 0 ? 3 : 2);
    if (ry === 0) {
      if (rx === 1) {
        px = n - 1 - px;
        py = n - 1 - py;
      }
      [px, py] = [py, px];
    }
  }
  return (4 ** z - 1) / 3 + d;
}

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

describe('pmtiles | header fields', () => {
  it('reads each field at its byte offset and nothing from the bytes between', () => {
    const h = headerBytes();
    putU64(h, 8, 1000);
    putU64(h, 16, 2000);
    putU64(h, 24, 9); // metadata offset: not read
    putU64(h, 32, 9); // metadata length: not read
    putU64(h, 40, 3000);
    putU64(h, 48, 9); // leaf directories length: not read
    putU64(h, 56, 4000);
    putU64(h, 64, 9); // tile data length: not read
    h.set([2, 2, 1, 4, 14], 97);
    expect(parseHeader(h)).toEqual({
      rootDirectoryOffset: 1000,
      rootDirectoryLength: 2000,
      leafDirectoryOffset: 3000,
      tileDataOffset: 4000,
      internalCompression: 2,
      tileCompression: 2,
      tileType: 1,
      minZoom: 4,
      maxZoom: 14,
    });
  });

  it('reads the high 32 bits of an offset little-endian', () => {
    const h = headerBytes();
    putU64(h, 8, 2 ** 32 + 7);
    putU64(h, 56, 2 ** 53 - 1);
    const got = parseHeader(h);
    expect(got.rootDirectoryOffset).toBe(2 ** 32 + 7);
    expect(got.tileDataOffset).toBe(2 ** 53 - 1);
  });

  it('refuses an offset past the safe integer range', () => {
    const h = headerBytes();
    putU64(h, 56, 2 ** 53);
    expect(() => parseHeader(h)).toThrow(/offset out of range/);
    const all = headerBytes();
    all.fill(0xff, 8, 16);
    expect(() => parseHeader(all)).toThrow(PmtilesError);
  });

  it('needs the full 127-byte header: 126 bytes is short', () => {
    expect(parseHeader(headerBytes()).rootDirectoryOffset).toBe(0);
    expect(() => parseHeader(headerBytes().subarray(0, HEADER_BYTES - 1))).toThrow(/short header/);
  });
});

describe('pmtiles | tile id bounds and reference', () => {
  it('agrees with a textbook Hilbert curve on every tile up to z6', () => {
    for (let z = 0; z <= 6; z++) {
      const n = 2 ** z;
      for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) expect(zxyToTileId(z, x, y)).toBe(referenceTileId(z, x, y));
      }
    }
  });

  it('agrees with the reference at high zooms, z 26 included', () => {
    let seed = 12345;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (const z of [10, 17, 20, 26]) {
      const n = 2 ** z;
      for (const [x, y] of [
        [0, 0],
        [n - 1, 0],
        [0, n - 1],
        [n - 1, n - 1],
        [next(n), next(n)],
        [next(n), next(n)],
      ] as [number, number][]) {
        expect(zxyToTileId(z, x, y)).toBe(referenceTileId(z, x, y));
      }
    }
    expect(zxyToTileId(26, 0, 0)).toBe((4 ** 26 - 1) / 3);
  });

  it('allows z 26 and refuses z 27, a negative zoom and a fractional zoom', () => {
    expect(() => zxyToTileId(26, 0, 0)).not.toThrow();
    expect(() => zxyToTileId(27, 0, 0)).toThrow(/zoom out of range/);
    expect(() => zxyToTileId(-1, 0, 0)).toThrow(/zoom out of range/);
    expect(() => zxyToTileId(1.5, 0, 0)).toThrow(/zoom out of range/);
  });

  it('refuses x or y equal to 2^z, below 0, or not whole', () => {
    expect(zxyToTileId(2, 3, 3)).toBe(referenceTileId(2, 3, 3));
    for (const [x, y] of [
      [4, 0],
      [0, 4],
      [-1, 0],
      [0, -1],
      [0.5, 0],
      [0, 0.5],
      [1.5, 1.5],
    ]) {
      expect(() => zxyToTileId(2, x!, y!)).toThrow(/tile out of range/);
    }
    expect(() => zxyToTileId(1, 0, 2)).toThrow(/tile out of range/);
  });
});

describe('pmtiles | directory decoding', () => {
  it('adds tile id deltas and stores each offset plus one', () => {
    const dir = new Uint8Array([
      ...[3, 3, 7, 1], // count, then deltas: ids 3, 10, 11
      ...[1, 2, 1], // run lengths
      ...[5, 6, 7], // lengths
      ...[...varint(101), ...varint(301), ...varint(201)], // offsets 100, 300, 200
    ]);
    expect(decodeDirectory(dir)).toEqual([
      { tileId: 3, offset: 100, length: 5, runLength: 1 },
      { tileId: 10, offset: 300, length: 6, runLength: 2 },
      { tileId: 11, offset: 200, length: 7, runLength: 1 },
    ]);
  });

  it('reads a stored 0 as "after the previous entry", but not for the first entry', () => {
    const first = decodeDirectory(new Uint8Array([1, 4, 1, 9, 0]));
    expect(first).toEqual([{ tileId: 4, offset: -1, length: 9, runLength: 1 }]);
    const both = decodeDirectory(new Uint8Array([2, 4, 1, 1, 1, 9, 3, 51, 0]));
    expect(both[1]).toEqual({ tileId: 5, offset: 59, length: 3, runLength: 1 });
  });

  it('refuses a count larger than the buffer, but a count equal to it reads on', () => {
    expect(() => decodeDirectory(new Uint8Array([3, 1]))).toThrow(/directory count out of range/);
    expect(() => decodeDirectory(new Uint8Array([...varint(1e9), 0]))).toThrow(
      /directory count out of range/
    );
    expect(() => decodeDirectory(new Uint8Array([1]))).toThrow(/truncated varint/);
  });

  it('refuses a directory cut short by its last byte or inside a varint', () => {
    expect(decodeDirectory(new Uint8Array([1, 5, 1, 4, 1]))).toHaveLength(1);
    expect(() => decodeDirectory(new Uint8Array([1, 5, 1, 4]))).toThrow(/truncated varint/);
    expect(() => decodeDirectory(new Uint8Array([1, 0x85]))).toThrow(/truncated varint/);
    expect(() => decodeDirectory(new Uint8Array(0))).toThrow(/truncated varint/);
  });

  it('takes a varint of eight bytes and refuses a ninth', () => {
    expect(decodeDirectory(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0]))).toEqual(
      []
    );
    const big = varint(2 ** 50);
    expect(big).toHaveLength(8);
    const dir = new Uint8Array([1, ...big, 1, 1, 1]);
    expect(decodeDirectory(dir)[0]!.tileId).toBe(2 ** 50);
    expect(() =>
      decodeDirectory(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0]))
    ).toThrow(/varint too long/);
  });
});

describe('pmtiles | finding an entry', () => {
  const run: DirEntry = { tileId: 10, offset: 0, length: 1, runLength: 3 };
  const leafPtr: DirEntry = { tileId: 20, offset: 1, length: 1, runLength: 0 };
  const single: DirEntry = { tileId: 30, offset: 2, length: 1, runLength: 1 };
  const entries = [run, leafPtr, single];

  it('finds an exact hit, a tile inside a run and its last tile, not one past', () => {
    expect(findEntry(entries, 10)).toBe(run);
    expect(findEntry(entries, 11)).toBe(run);
    expect(findEntry(entries, 12)).toBe(run);
    expect(findEntry(entries, 13)).toBeNull();
    expect(findEntry(entries, 30)).toBe(single);
    expect(findEntry(entries, 31)).toBeNull();
  });

  it('sends a tile after a leaf pointer to that leaf', () => {
    expect(findEntry(entries, 20)).toBe(leafPtr);
    expect(findEntry(entries, 29)).toBe(leafPtr);
  });

  it('is null below the first entry and in an empty directory', () => {
    expect(findEntry(entries, 9)).toBeNull();
    expect(findEntry([], 0)).toBeNull();
  });

  it('returns the exact hit it lands on first, even when a damaged directory repeats an id', () => {
    const a: DirEntry = { tileId: 5, offset: 0, length: 1, runLength: 1 };
    const b: DirEntry = { tileId: 5, offset: 1, length: 1, runLength: 1 };
    expect(findEntry([a, b], 5)).toBe(a);
  });
});

describe('pmtiles | decompress', () => {
  it('passes bytes through for none and unknown', async () => {
    const b = bytes('plain');
    expect(await decompress(b, 1)).toBe(b);
    expect(await decompress(b, 0)).toBe(b);
  });

  it('round-trips gzip', async () => {
    expect(text(await decompress(await gzip(bytes('zipped tile')), 2))).toBe('zipped tile');
  });

  it('refuses brotli, zstd and an unknown code by name', async () => {
    const b = await gzip(bytes('x'));
    await expect(decompress(b, 3)).rejects.toThrow(/unsupported compression 3/);
    await expect(decompress(b, 4)).rejects.toThrow(/unsupported compression 4/);
    await expect(decompress(b, 9)).rejects.toThrow(PmtilesError);
  });
});

describe('pmtiles | reading from an archive', () => {
  const t325 = { z: 3, x: 2, y: 5, data: bytes('tile-325') };
  const t377 = { z: 3, x: 7, y: 7, data: bytes('tile-377') };
  const world = { z: 0, x: 0, y: 0, data: bytes('world') };

  it('returns null for a zoom below min or above max, even with the tile present', async () => {
    const low = memSource(await pmtilesArchive([world, t325], { minZoom: 1, maxZoom: 3 }));
    expect(await readTile(low, 0, 0, 0)).toBeNull();
    expect(text(await readTile(low, 3, 2, 5))).toBe('tile-325');
    const high = memSource(await pmtilesArchive([world, t325], { minZoom: 0, maxZoom: 2 }));
    expect(await readTile(high, 3, 2, 5)).toBeNull();
    expect(text(await readTile(high, 0, 0, 0))).toBe('world');
  });

  it('reads tiles at exactly the min and max zoom', async () => {
    const src = memSource(await pmtilesArchive([world, t325], { minZoom: 0, maxZoom: 3 }));
    expect(text(await readTile(src, 0, 0, 0))).toBe('world');
    expect(text(await readTile(src, 3, 2, 5))).toBe('tile-325');
  });

  it('takes a root that ends exactly at the first read from that read', async () => {
    const root = dirOf([]);
    const { archive } = rawArchive({
      root,
      rootAt: 16384 - root.length,
      data: new Uint8Array(10),
    });
    const src = memSource(archive);
    await archiveHeader(src);
    expect(src.reads).toEqual([[0, 16384]]);
  });

  it('reads a root that runs past the first read on its own', async () => {
    const id = zxyToTileId(t325.z, t325.x, t325.y);
    const root = dirOf([{ tileId: id, offset: 0, length: t325.data.length, runLength: 1 }]);
    const rootAt = 16384 - root.length + 1;
    const src = memSource(rawArchive({ root, rootAt, data: t325.data }).archive);
    expect(text(await readTile(src, 3, 2, 5))).toBe('tile-325');
    expect(src.reads[1]).toEqual([rootAt, root.length]);
    const far = memSource(rawArchive({ root, rootAt: 20000, data: t325.data }).archive);
    expect(text(await readTile(far, 3, 2, 5))).toBe('tile-325');
    expect(far.reads[1]).toEqual([20000, root.length]);
  });

  it('reads an archive with an empty root as having no tiles, in one read', async () => {
    const src = memSource(rawArchive({ root: dirOf([]) }).archive);
    expect(await readTile(src, 0, 0, 0)).toBeNull();
    expect(src.reads).toEqual([[0, 16384]]);
  });

  it('finds tiles in leaf directories past the first, each leaf read once', async () => {
    const raw = leafPerTile([t325, t377]);
    const src = memSource(raw.archive);
    expect(text(await readTile(src, 3, 2, 5))).toBe('tile-325');
    expect(text(await readTile(src, 3, 7, 7))).toBe('tile-377');
    expect(text(await readTile(src, 3, 2, 5))).toBe('tile-325');
    expect(text(await readTile(src, 3, 7, 7))).toBe('tile-377');
    for (const t of [t325, t377]) {
      expect(src.reads.filter(([off]) => off === raw.leafOf.get(t))).toHaveLength(1);
    }
    expect(raw.leafOf.get(t377)).toBeGreaterThan(raw.leafOf.get(t325)!);
  });

  it('keeps 64 leaf directories and evicts the oldest for the 65th', async () => {
    const tiles: Tile[] = [];
    for (let i = 0; i < 65; i++) {
      tiles.push({ z: 4, x: i % 16, y: Math.floor(i / 16), data: bytes(`t${i}`) });
    }
    tiles.sort((a, b) => zxyToTileId(a.z, a.x, a.y) - zxyToTileId(b.z, b.x, b.y));
    const raw = leafPerTile(tiles);
    const src = memSource(raw.archive);
    const leafReads = (t: Tile) => src.reads.filter(([off]) => off === raw.leafOf.get(t)).length;
    for (const t of tiles.slice(0, 64)) await readTile(src, t.z, t.x, t.y);
    // 64 kept: the first is still there
    const first = tiles[0]!;
    expect(text(await readTile(src, first.z, first.x, first.y))).toBe(text(first.data));
    expect(leafReads(first)).toBe(1);
    const last = tiles[64]!;
    expect(text(await readTile(src, last.z, last.x, last.y))).toBe(text(last.data));
    // the 65th pushed out the oldest; the second is still kept
    const second = tiles[1]!;
    await readTile(src, second.z, second.x, second.y);
    expect(leafReads(second)).toBe(1);
    expect(text(await readTile(src, first.z, first.x, first.y))).toBe(text(first.data));
    expect(leafReads(first)).toBe(2);
  });

  it('finds a tile three leaf levels down and refuses a fourth', async () => {
    const three = memSource(chainArchive(3, t325));
    expect(text(await readTile(three, 3, 2, 5))).toBe('tile-325');
    const four = memSource(chainArchive(4, t325));
    await expect(readTile(four, 3, 2, 5)).rejects.toThrow(/directory nesting too deep/);
  });
});

// The whole-planet build (owner 2026-11-09) is about 138.5 GB. The reader had
// only ever met a 0.464 GB regional file, where every offset fits in 32 bits and
// a leaf directory holds a few thousand entries. These give it a planet's
// layout without the planet: a sparse file with the byte ranges at their true
// offsets (tests/helpers/street-map-fixtures.ts, planetArchive).
describe('pmtiles | a planet-sized layout', () => {
  const GIB = 2 ** 30;
  const LEAF_AT = 3 * 2 ** 20;
  const DATA_AT = 5 * GIB;
  // z15's last tile: the largest tile id a Protomaps build holds.
  const LAST_Z15 = (4 ** 16 - 1) / 3 - 1;

  const world: PlanetTile = { z: 0, x: 0, y: 0, data: bytes('world'), at: 0 };
  // Open water: one stored tile for the first 64 × 64 block of z13.
  const water: PlanetTile = { z: 13, x: 0, y: 0, data: bytes('water'), at: 2 * GIB, run: 4 ** 6 };
  const city: PlanetTile = { z: 14, x: 4201, y: 6092, data: bytes('city'), at: 40 * GIB };
  const next: PlanetTile = { z: 14, x: 4202, y: 6092, data: bytes('next'), at: 40 * GIB + 70_000 };
  const last: PlanetTile = { z: 15, x: 32767, y: 0, data: bytes('last'), at: 130 * GIB };
  const all = [world, water, city, next, last];

  const planet = (dirGap = 0) =>
    planetArchive(all, { leafSize: 2, fanOut: 2, leafAt: LEAF_AT, dataAt: DATA_AT, dirGap });

  it('is laid out as meant: two leaf levels, a tile id past 2^30, bytes past 2^37', async () => {
    const { dirs, stored } = await planet(2 * GIB);
    expect(dirs.filter((d) => d.level === 2)).toHaveLength(3);
    expect(dirs.filter((d) => d.level === 1)).toHaveLength(2);
    expect(zxyToTileId(last.z, last.x, last.y)).toBe(LAST_Z15);
    expect(LAST_Z15).toBeGreaterThan(2 ** 30);
    expect(stored.get(last)![0]).toBe(135 * GIB);
    expect(stored.get(last)![0]).toBeGreaterThan(2 ** 37);
    // With the gap, leaf directories themselves start past 4 GiB.
    expect(Math.max(...dirs.map((d) => d.at))).toBeGreaterThan(2 ** 32);
  });

  for (const dirGap of [0, 2 * GIB]) {
    it(`finds every tile two leaf levels down, at its exact byte offset (directory gap ${dirGap})`, async () => {
      const { file, stored } = await planet(dirGap);
      const src = sparseSource(file);
      for (const t of all) {
        expect(text(await readTile(src, t.z, t.x, t.y))).toBe(text(t.data));
        // The read asked for the tile's true offset: nothing was cut to 32 bits.
        expect(src.reads).toContainEqual(stored.get(t));
      }
    });
  }

  it('reads one stored tile for every tile of an open-water run, and none past it', async () => {
    const { file, stored } = await planet();
    const src = sparseSource(file);
    for (const [x, y] of [
      [0, 0],
      [17, 40],
      [63, 63],
    ]) {
      expect(text(await readTile(src, 13, x!, y!))).toBe('water');
    }
    expect(src.reads.filter(([off]) => off === stored.get(water)![0])).toHaveLength(3);
    expect(await readTile(src, 13, 64, 0)).toBeNull();
    expect(await readTile(src, 13, 0, 64)).toBeNull();
  });

  it('a tile the planet does not hold is null: before, between and after the stored ones', async () => {
    const { file } = await planet();
    const src = sparseSource(file);
    expect(await readTile(src, 1, 0, 0)).toBeNull();
    expect(await readTile(src, 14, 4203, 6092)).toBeNull();
    expect(await readTile(src, 15, 32766, 0)).toBeNull();
    // None of these read tile bytes.
    expect(src.reads.every(([off]) => off < DATA_AT)).toBe(true);
  });

  it('reads the header once and each directory once, however many tiles follow', async () => {
    const { file, dirs } = await planet();
    const src = sparseSource(file);
    for (let pass = 0; pass < 3; pass++) {
      for (const t of all) await readTile(src, t.z, t.x, t.y);
    }
    expect(src.reads.filter(([off]) => off === 0)).toHaveLength(1);
    for (const d of dirs) {
      expect(src.reads.filter(([off, len]) => off === d.at && len === d.length)).toHaveLength(1);
    }
    // Header, five directories, then only tiles.
    expect(src.reads).toHaveLength(1 + dirs.length + 3 * all.length);
  });

  it('two neighbouring tiles cost one walk down the directories between them', async () => {
    const { file } = await planet();
    const src = sparseSource(file);
    await Promise.all([
      readTile(src, city.z, city.x, city.y),
      readTile(src, next.z, next.x, next.y),
    ]);
    // Header, one level-1 directory, one level-2 directory, two tiles.
    expect(src.reads).toHaveLength(5);
  });
});

// A planet's leaf directories are large (its tile entries divided among the few
// thousand pointers a 16 KB root can hold), so the cache is bounded by the
// entries it keeps, not only by how many directories.
describe('pmtiles | leaf directory cache budget', () => {
  const HALF = MAX_LEAF_ENTRIES / 2;
  const A = { z: 12, x: 0, y: 0 };
  const B = { z: 12, x: 10, y: 3000 };
  const C = { z: 12, x: 3000, y: 3000 };
  const D = { z: 12, x: 4095, y: 0 };

  /** One leaf directory per start tile: `count` entries in a row from its id. */
  function bigLeaves(starts: { t: { z: number; x: number; y: number }; count: number }[]) {
    const sorted = starts
      .map((s) => ({ ...s, id: zxyToTileId(s.t.z, s.t.x, s.t.y) }))
      .sort((a, b) => a.id - b.id);
    const leaves: Uint8Array[] = [];
    const pointers: DirEntry[] = [];
    let leafOffset = 0;
    let dataOffset = 0;
    sorted.forEach((s, i) => {
      const nextId = sorted[i + 1]?.id ?? Infinity;
      if (s.id + s.count > nextId) throw new Error('leaves overlap: pick tiles further apart');
      const entries = Array.from({ length: s.count }, (_, k) => ({
        tileId: s.id + k,
        offset: dataOffset + k,
        length: 1,
        runLength: 1,
      }));
      const leaf = dirOf(entries);
      pointers.push({ tileId: s.id, offset: leafOffset, length: leaf.length, runLength: 0 });
      leaves.push(leaf);
      leafOffset += leaf.length;
      dataOffset += s.count;
    });
    const section = new Uint8Array(leafOffset);
    let at = 0;
    for (const l of leaves) {
      section.set(l, at);
      at += l.length;
    }
    const raw = rawArchive({
      root: dirOf(pointers),
      leaves: section,
      data: new Uint8Array(dataOffset).fill(7),
    });
    const src = memSource(raw.archive);
    const leafAt = new Map(sorted.map((s, i) => [s.t, raw.leafAt + pointers[i]!.offset] as const));
    const read = async (t: { z: number; x: number; y: number }) => {
      expect(await readTile(src, t.z, t.x, t.y)).toEqual(new Uint8Array([7]));
    };
    const leafReads = (t: { z: number; x: number; y: number }) =>
      src.reads.filter(([off]) => off === leafAt.get(t)).length;
    return { read, leafReads };
  }

  it('keeps leaves that fill the budget exactly, and drops only the oldest when one more arrives', async () => {
    const { read, leafReads } = bigLeaves([
      { t: A, count: HALF },
      { t: B, count: HALF },
      { t: C, count: HALF },
    ]);
    await read(A);
    await read(B);
    // Two halves are the whole budget: both are kept.
    await read(A);
    expect(leafReads(A)).toBe(1);
    // A third half is over: the oldest (A) goes, and that is enough.
    await read(C);
    await read(B);
    await read(C);
    expect(leafReads(B)).toBe(1);
    expect(leafReads(C)).toBe(1);
    // A comes back as the newest, and now B is the oldest and goes.
    await read(A);
    expect(leafReads(A)).toBe(2);
    await read(C);
    expect(leafReads(C)).toBe(1);
    await read(B);
    expect(leafReads(B)).toBe(2);
  });

  it('keeps one leaf larger than the whole budget until another arrives', async () => {
    const { read, leafReads } = bigLeaves([
      { t: A, count: 10 },
      { t: D, count: MAX_LEAF_ENTRIES + 1 },
    ]);
    await read(D);
    await read(D);
    expect(leafReads(D)).toBe(1);
    await read(A);
    await read(A);
    expect(leafReads(A)).toBe(1);
    await read(D);
    expect(leafReads(D)).toBe(2);
  });
});

// Tiles that sit near each other in the file come from one read (2026-11-10).
// Measured on the planet build (20261109): the 12 tiles of a zoomed area are
// back to back, and read one by one a first map cost 14 reads; it costs 3 now.
// @born-red reads planned and tiles read together | method: StrykerJS mutants of planReads and readTiles in src/lib/pmtiles.ts, each case seen failing against the mutant it kills (status Killed in the report); the loader's read count in street-map.spec.ts seen failing on the reader that read each tile by itself (14 reads, 3 expected) | date: 2026-11-10
describe('pmtiles | planning reads', () => {
  const R = (offset: number, length: number) => ({ offset, length });

  it('nothing wanted is no read', () => {
    expect(planReads([])).toEqual([]);
  });

  it('ranges back to back are one read, whatever order they come in', () => {
    expect(planReads([R(300, 50), R(100, 100), R(200, 100)])).toEqual([R(100, 250)]);
  });

  it('a gap of exactly the limit is read through; one byte more is a second read', () => {
    expect(planReads([R(0, 10), R(10 + 64, 5)], 64, 1000)).toEqual([R(0, 79)]);
    expect(planReads([R(0, 10), R(10 + 65, 5)], 64, 1000)).toEqual([R(0, 10), R(75, 5)]);
  });

  it('a joined read of exactly the size limit is one read; one byte more is two', () => {
    expect(planReads([R(0, 60), R(60, 40)], 0, 100)).toEqual([R(0, 100)]);
    expect(planReads([R(0, 60), R(60, 41)], 0, 100)).toEqual([R(0, 60), R(60, 41)]);
    // Near enough, but too much to hold: the size limit decides alone.
    expect(planReads([R(0, 60), R(70, 41)], 500, 100)).toEqual([R(0, 60), R(70, 41)]);
  });

  it('a range longer than the size limit is read alone and whole', () => {
    expect(planReads([R(0, 500)], 0, 100)).toEqual([R(0, 500)]);
    expect(planReads([R(0, 500), R(500, 10)], 0, 100)).toEqual([R(0, 500), R(500, 10)]);
  });

  it('a repeat, and a range inside another, add nothing; an overlap reaches the further end', () => {
    expect(planReads([R(100, 100), R(100, 100), R(120, 30)])).toEqual([R(100, 100)]);
    expect(planReads([R(100, 100), R(150, 100)])).toEqual([R(100, 150)]);
  });

  it('the gap is measured from the end of the read so far, not from the last range', () => {
    // 10..20 lies inside 0..100. The next range starts 64 past 100, not past 20.
    expect(planReads([R(0, 100), R(10, 10), R(164, 5)], 64, 1000)).toEqual([R(0, 169)]);
    expect(planReads([R(0, 100), R(10, 10), R(165, 5)], 64, 1000)).toEqual([R(0, 100), R(165, 5)]);
  });

  it('leaves what it was given as it was', () => {
    const wanted = Object.freeze([
      Object.freeze(R(300, 50)),
      Object.freeze(R(100, 100)),
      Object.freeze(R(200, 100)),
    ]);
    expect(planReads(wanted)).toEqual([R(100, 250)]);
    expect(wanted.map((r) => r.offset)).toEqual([300, 100, 200]);
    expect(wanted[1]).toEqual(R(100, 100));
  });

  it('by default reads through 256 KiB and stops a read at 2 MiB', () => {
    expect(MAX_READ_GAP).toBe(256 * 1024);
    expect(MAX_READ_BYTES).toBe(2 * 1024 * 1024);
    expect(planReads([R(0, 1), R(1 + MAX_READ_GAP, 1)])).toHaveLength(1);
    expect(planReads([R(0, 1), R(2 + MAX_READ_GAP, 1)])).toHaveLength(2);
    expect(planReads([R(0, MAX_READ_BYTES - 1), R(MAX_READ_BYTES - 1, 1)])).toHaveLength(1);
    expect(planReads([R(0, MAX_READ_BYTES - 1), R(MAX_READ_BYTES - 1, 2)])).toHaveLength(2);
  });
});

describe('pmtiles | reading several tiles at once', () => {
  const GIB = 2 ** 30;
  const DATA_AT = 5 * GIB;
  const OPTS = { leafSize: 4, fanOut: 2, leafAt: 3 * 2 ** 20, dataAt: DATA_AT };
  const ROW = 6092;
  const xy = (t: PlanetTile): [number, number] => [t.x, t.y];
  const tileReads = (src: { reads: [number, number][] }) =>
    src.reads.filter(([off]) => off >= DATA_AT);

  /** Tiles of one z14 row, each `gaps[i]` bytes after the one before it. */
  async function row(words: string[], gaps: number[] = []) {
    const tiles: PlanetTile[] = [];
    let at = 0;
    for (const [i, w] of words.entries()) {
      at += gaps[i] ?? 0;
      const data = bytes(w);
      tiles.push({ z: 14, x: 4201 + i, y: ROW, data, at });
      at += (await gzip(data)).length;
    }
    const { file, stored } = await planetArchive(tiles, OPTS);
    return { tiles, stored, src: sparseSource(file) };
  }

  it('tiles back to back are one read, and each tile gets its own bytes in the order asked', async () => {
    const { tiles, stored, src } = await row(['alpha', 'bravo-bravo', 'charlie']);
    const [a, b, c] = tiles as [PlanetTile, PlanetTile, PlanetTile];
    const got = await readTiles(src, 14, [xy(c), xy(a), xy(b)]);
    expect(got.map(text)).toEqual(['charlie', 'alpha', 'bravo-bravo']);
    const from = stored.get(a)![0];
    const to = stored.get(c)![0] + stored.get(c)![1];
    expect(tileReads(src)).toEqual([[from, to - from]]);
  });

  it('a gap of exactly the limit is read through, and the bytes on both sides are cut right', async () => {
    const { tiles, stored, src } = await row(['near', 'far-side'], [0, MAX_READ_GAP]);
    const got = await readTiles(src, 14, tiles.map(xy));
    expect(got.map(text)).toEqual(['near', 'far-side']);
    const [a, b] = tiles.map((t) => stored.get(t)!) as [[number, number], [number, number]];
    expect(b[0] - (a[0] + a[1])).toBe(MAX_READ_GAP);
    expect(tileReads(src)).toEqual([[a[0], b[0] + b[1] - a[0]]]);
  });

  it('one byte past the limit is two reads, each tile from its own, in either order', async () => {
    const { tiles, stored, src } = await row(['near', 'far-side'], [0, MAX_READ_GAP + 1]);
    const [a, b] = tiles as [PlanetTile, PlanetTile];
    expect((await readTiles(src, 14, [xy(b), xy(a)])).map(text)).toEqual(['far-side', 'near']);
    expect(tileReads(src)).toHaveLength(2);
    expect(tileReads(src)).toContainEqual(stored.get(a));
    expect(tileReads(src)).toContainEqual(stored.get(b));
  });

  it('a tile longer than the gap before it is cut from its own read, not from the read before', async () => {
    // Bytes that do not compress, so the stored tile is longer than the gap.
    const noise = new Uint8Array(300_000);
    let s = 20261110;
    for (let i = 0; i < noise.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      noise[i] = s >>> 24;
    }
    const small: PlanetTile = { z: 14, x: 4201, y: ROW, data: bytes('near'), at: 0 };
    const smallLen = (await gzip(small.data)).length;
    const big: PlanetTile = {
      z: 14,
      x: 4202,
      y: ROW,
      data: noise,
      at: smallLen + MAX_READ_GAP + 1,
    };
    const { file, stored } = await planetArchive([small, big], OPTS);
    const src = sparseSource(file);
    const [a, b] = [stored.get(small)!, stored.get(big)!];
    // The tile's start, less its own length, falls before the first read's end.
    expect(b[1]).toBeGreaterThan(b[0] - (a[0] + a[1]));
    const got = await readTiles(src, 14, [xy(small), xy(big)]);
    expect(text(got[0]!)).toBe('near');
    expect(got[1]!.length).toBe(noise.length);
    expect(got[1]!.every((v, i) => v === noise[i])).toBe(true);
    expect(tileReads(src)).toEqual([a, b]);
  });

  it('a run: three tiles of open water are one stored tile, read once and unpacked once', async () => {
    const water: PlanetTile = { z: 13, x: 0, y: 0, data: bytes('water'), at: 0, run: 4 ** 6 };
    const { file, stored } = await planetArchive([water], OPTS);
    const src = sparseSource(file);
    const got = await readTiles(src, 13, [
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(got.map(text)).toEqual(['water', 'water', 'water']);
    expect(got[1]).toBe(got[0]);
    expect(got[2]).toBe(got[0]);
    expect(tileReads(src)).toEqual([stored.get(water)]);
  });

  it('a tile the archive does not hold is null in its place and costs no read', async () => {
    const { tiles, src } = await row(['alpha', 'bravo']);
    const [a, b] = tiles as [PlanetTile, PlanetTile];
    const got = await readTiles(src, 14, [xy(a), [9000, 9000], xy(b), [0, 0]]);
    expect(got.map(text)).toEqual(['alpha', null, 'bravo', null]);
    expect(tileReads(src)).toHaveLength(1);
  });

  it('nothing held, or nothing asked: no tile read', async () => {
    const { src } = await row(['alpha']);
    expect(
      await readTiles(src, 14, [
        [9000, 9000],
        [0, 0],
      ])
    ).toEqual([null, null]);
    expect(await readTiles(src, 14, [])).toEqual([]);
    expect(tileReads(src)).toHaveLength(0);
  });

  it('a zoom outside the archive is null for every tile, after the header read alone', async () => {
    const { tiles, src } = await row(['alpha', 'bravo']);
    expect(await readTiles(src, 16, tiles.map(xy))).toEqual([null, null]);
    expect(src.reads).toHaveLength(1);
  });

  it('a tile address outside its zoom is refused before any tile read', async () => {
    const { tiles, src } = await row(['alpha']);
    await expect(readTiles(src, 14, [xy(tiles[0]!), [2 ** 14, 0]])).rejects.toThrow(
      'tile out of range'
    );
    expect(tileReads(src)).toHaveLength(0);
  });

  it('a short answer is refused by name: part of a read is no tile', async () => {
    const { tiles, src } = await row(['alpha', 'bravo', 'charlie']);
    const short: RangeSource = {
      key: 'short',
      read: async (offset, length) => {
        const all = await src.read(offset, length);
        return offset >= DATA_AT ? all.subarray(0, length - 1) : all;
      },
    };
    const err = await readTiles(short, 14, tiles.map(xy)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PmtilesError);
    expect((err as Error).message).toBe('short read');
    // The same for one tile asked by itself.
    const lastOnly = await readTiles(short, 14, [xy(tiles[2]!)]).catch((e: unknown) => e);
    expect((lastOnly as Error).message).toBe('short read');
  });

  it('a read that fails fails the call: no tile is handed back alone', async () => {
    const { tiles, src } = await row(['near', 'far-side'], [0, MAX_READ_GAP + 1]);
    let n = 0;
    const flaky: RangeSource = {
      key: 'flaky',
      read: async (offset, length) => {
        if (offset >= DATA_AT && ++n === 2) throw new Error('network');
        return src.read(offset, length);
      },
    };
    await expect(readTiles(flaky, 14, tiles.map(xy))).rejects.toThrow('network');
  });
});

describe('pmtiles | per-archive cache', () => {
  const t325 = { z: 3, x: 2, y: 5, data: bytes('tile-325') };
  const headerReads = (src: { reads: [number, number][] }) =>
    src.reads.filter(([off]) => off === 0).length;

  it('reads the header once for many header and tile reads', async () => {
    const src = memSource(await pmtilesArchive([t325]));
    await archiveHeader(src);
    await archiveHeader(src);
    await readTile(src, 3, 2, 5);
    expect(headerReads(src)).toBe(1);
  });

  it('forgets the archive after resetPmtilesCache', async () => {
    const src = memSource(await pmtilesArchive([t325]));
    await archiveHeader(src);
    resetPmtilesCache();
    await archiveHeader(src);
    expect(headerReads(src)).toBe(2);
  });

  it('does not keep a failed open: the next read tries again', async () => {
    const inner = memSource(await pmtilesArchive([t325]));
    const src = failOnce(inner, (off) => off === 0);
    await expect(readTile(src, 3, 2, 5)).rejects.toThrow('connection dropped');
    expect(text(await readTile(src, 3, 2, 5))).toBe('tile-325');
    expect(src.failures).toBe(1);
  });

  it('does not keep a failed leaf read: the next read tries again', async () => {
    const raw = leafPerTile([t325]);
    const inner = memSource(raw.archive);
    const src = failOnce(inner, (off) => off === raw.leafOf.get(t325));
    await expect(readTile(src, 3, 2, 5)).rejects.toThrow('connection dropped');
    expect(text(await readTile(src, 3, 2, 5))).toBe('tile-325');
    expect(src.failures).toBe(1);
  });
});

describe('pmtiles | R2 source', () => {
  it('names its cache key after the object and asks R2 for the exact range', async () => {
    const body = bytes('0123456789abcdef');
    const bucket = fakeBucket('map.pmtiles', body);
    const src = r2Source(bucket, 'map.pmtiles');
    expect(src.key).toBe('r2:map.pmtiles');
    expect(text(await src.read(4, 6))).toBe('456789');
    expect(bucket.gets).toEqual([{ key: 'map.pmtiles', range: { offset: 4, length: 6 } }]);
  });

  it('throws when the object is missing', async () => {
    const src = r2Source(fakeBucket('map.pmtiles', bytes('x')), 'other.pmtiles');
    await expect(src.read(0, 1)).rejects.toThrow(/archive not found/);
  });
});
