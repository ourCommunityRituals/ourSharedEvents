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
 */
// @born-red pmtiles reader mutants | method: StrykerJS mutants of src/lib/pmtiles.ts, each new test seen failing against the mutant it kills (status Killed in the report) | date: 2026-11-09
import { describe, it, expect, beforeEach } from 'vitest';
import {
  archiveHeader,
  decodeDirectory,
  decompress,
  findEntry,
  parseHeader,
  r2Source,
  readTile,
  resetPmtilesCache,
  zxyToTileId,
  PmtilesError,
  HEADER_BYTES,
  type DirEntry,
  type RangeSource,
} from '../src/lib/pmtiles';
import { fakeBucket, gzip, memSource, pmtilesArchive, varint } from './helpers/street-map-fixtures';

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
