// The street-map archive check (scripts/street-map-archive/check.ts) is what
// stands between a cut archive and the R2 bucket, so every problem it names is
// watched here on an archive with that one fault put in, next to the same
// archive without it.

import { getResolution, latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import {
  checkArchive,
  defaultProbes,
  READER_MAX_DEPTH,
  type Probe,
} from '../scripts/street-map-archive/check.js';
import { MAX_DIRECTORY_BYTES, MAX_TILE_BYTES, zxyToTileId } from '../src/lib/pmtiles.js';
import {
  gzip,
  memSource,
  mvtTile,
  pmtilesArchive,
  tilesForCells,
  varint,
  type FixtureTile,
} from './helpers/street-map-fixtures.js';

const CELL = '872664570ffffff';
const FAR = latLngToCell(51.5074, -0.1278, 7);
const PROBES: Probe[] = [
  { name: 'inside', cells: [CELL], expect: 'streets' },
  { name: 'outside', cells: [FAR], expect: 'none' },
];

const tiles = (): FixtureTile[] => tilesForCells([CELL]).tiles;
const good = (opts: Parameters<typeof pmtilesArchive>[1] = {}) =>
  pmtilesArchive(tiles(), { gzip: true, ...opts });
const run = (
  bytes: Uint8Array,
  opts: Parameters<typeof checkArchive>[2] = {},
  size = bytes.length
) => checkArchive(memSource(bytes), size, { probes: PROBES, ...opts });

function withByte(bytes: Uint8Array, at: number, v: number): Uint8Array {
  const out = bytes.slice();
  out[at] = v;
  return out;
}
function withU64(bytes: Uint8Array, at: number, v: number): Uint8Array {
  const out = bytes.slice();
  new DataView(out.buffer).setUint32(at, v, true);
  new DataView(out.buffer).setUint32(at + 4, 0, true);
  return out;
}

describe('street-map archive check | an archive the Worker can read passes', () => {
  it('reports the header, the layout and each draw, and names no problem', async () => {
    const r = await run(await good());
    expect(r.problems).toEqual([]);
    expect(r.header).toMatchObject({
      minZoom: 0,
      maxZoom: 15,
      tileType: 1,
      tileCompression: 2,
      internalCompression: 2,
    });
    expect(r.directories).toMatchObject({ leaves: 0, depth: 0, tileEntries: tiles().length });
    expect(r.probes.map((p) => [p.name, p.got, p.ok])).toEqual([
      ['inside', 'streets', true],
      ['outside', 'none', true],
    ]);
    expect(r.probes[0]).toMatchObject({ cells: 1, zoom: 14 });
    expect(r.probes[0]!.reads).toBeGreaterThan(0);
    expect(r.probes[0]!.bytes).toBeGreaterThan(0);
  });

  it('counts the leaf directories of an archive that has them', async () => {
    const r = await run(await good({ leaf: true }));
    expect(r.problems).toEqual([]);
    expect(r.directories).toMatchObject({
      leaves: 1,
      depth: 1,
      smallestLeaf: tiles().length,
      largestLeaf: tiles().length,
      tileEntries: tiles().length,
      addressedTiles: tiles().length,
    });
  });

  it('every default draw passes on an archive that holds the tiles of the region', async () => {
    const inside = defaultProbes().filter((p) => p.expect === 'streets');
    const all = new Map<string, FixtureTile>();
    for (const p of inside) {
      for (const t of tilesForCells(p.cells).tiles) all.set(`${t.z}/${t.x}/${t.y}`, t);
    }
    const bytes = await pmtilesArchive([...all.values()], { gzip: true, leaf: true });
    const r = await checkArchive(memSource(bytes), bytes.length);
    expect(r.problems).toEqual([]);
    expect(r.probes).toHaveLength(defaultProbes().length);
    expect(r.probes.filter((p) => p.got === 'streets')).toHaveLength(inside.length);
    expect(r.probes.filter((p) => p.got === 'none').map((p) => p.name)).toEqual([
      'London, one area (outside the region)',
      'Mexico City, one area (outside the region)',
    ]);
  });
});

describe('street-map archive check | the default draws', () => {
  it('aim at res-7 areas in every part of the region, and at two outside it', () => {
    const probes = defaultProbes();
    expect(probes.map((p) => `${p.expect}: ${p.name}`)).toEqual([
      'streets: Chicago, one area',
      'streets: Seattle, one area',
      'streets: San Diego, one area',
      'streets: Miami, one area',
      'streets: Bangor, Maine, one area',
      'streets: Anchorage, one area',
      'streets: Honolulu, one area',
      'streets: San Juan, Puerto Rico, one area',
      'streets: Chicago, 7 areas',
      'streets: Chicago, 19 areas',
      'none: London, one area (outside the region)',
      'none: Mexico City, one area (outside the region)',
    ]);
    expect(probes.map((p) => p.cells.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 7, 19, 1, 1]);
    for (const p of probes) for (const c of p.cells) expect(getResolution(c)).toBe(7);
  });
});

describe('street-map archive check | a file that is not a readable archive', () => {
  it('a file that is not PMTiles is named, and nothing more is read', async () => {
    const r = await run(new Uint8Array(400));
    expect(r.problems).toEqual(['header: not a PMTiles archive']);
    expect(r.header).toBeNull();
    expect(r.probes).toEqual([]);
  });

  it('a file shorter than a header is named', async () => {
    expect((await run(new Uint8Array(20))).problems).toEqual(['header: short header']);
  });

  it('tiles that are not vector tiles are named', async () => {
    const r = await run(withByte(await good(), 99, 2));
    expect(r.problems).toContain('header: tile type 2 is not vector (MVT)');
  });

  it('tile compression the reader cannot unpack is named, and the draw fails', async () => {
    const r = await run(withByte(await good(), 98, 3));
    expect(r.problems).toContain(
      'header: tile compression is brotli; the reader unpacks gzip only'
    );
    expect(r.problems).toContain(
      'draw: inside: expected streets, got error (unsupported compression 3)'
    );
  });

  it('directory compression the reader cannot unpack is named', async () => {
    const r = await run(withByte(await good(), 97, 4));
    expect(r.problems).toContain(
      'header: directory compression is zstd; the reader unpacks gzip only'
    );
    expect(r.problems).toContain('directories: unsupported compression 4');
    expect(r.directories).toBeNull();
  });

  it('an archive that stops short of the zoom the zoomed area reads is named', async () => {
    const r = await run(await good({ maxZoom: 13 }));
    expect(r.problems).toContain('header: finest zoom is 13; the zoomed area reads zoom 14');
    expect((await run(await good({ maxZoom: 14 }))).problems).toEqual([]);
  });
});

describe('street-map archive check | a file that is not whole', () => {
  it('a file cut short is named by the section that runs past its end', async () => {
    const bytes = await good();
    const r = await run(bytes.slice(0, bytes.length - 1), {}, bytes.length - 1);
    expect(r.problems).toContain(
      `file: tile data ends at byte ${bytes.length}, past the end of the file (${bytes.length - 1})`
    );
  });

  it('bytes after the last section are named', async () => {
    const bytes = await good();
    const longer = new Uint8Array(bytes.length + 5);
    longer.set(bytes);
    const r = await run(longer);
    expect(r.problems).toEqual([`file: 5 bytes after the last section (ends at ${bytes.length})`]);
  });

  it('a tile that points past the tile data is named', async () => {
    const r = await run(withU64(await good(), 64, 1));
    expect(
      r.problems.some((p) =>
        /^directories: a tile ends at byte \d+ of a 1-byte tile section$/.test(p)
      )
    ).toBe(true);
  });
});

// The reader refuses what is past its limits (lib/pmtiles.ts). A file that
// passes the check must be inside every one of them, or staging would draw
// hexagons only from a file the check called good.
describe('street-map archive check | the reader limits', () => {
  /**
   * An archive that is a header and a root of one entry, nothing compressed.
   * The entry states `length` bytes: a tile (`run` 1) or a leaf directory
   * (`run` 0). The bytes it points at are not in the file; `size` says they are.
   */
  function oneEntry(run: 0 | 1, length: number): { bytes: Uint8Array; size: number } {
    const root = [
      ...varint(1),
      ...varint(zxyToTileId(3, 2, 5)),
      ...varint(run),
      ...varint(length),
      1,
    ];
    const at = 127 + root.length;
    const bytes = new Uint8Array(at);
    bytes.set(new TextEncoder().encode('PMTiles'), 0);
    bytes[7] = 3;
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 127, true);
    view.setUint32(16, root.length, true);
    view.setUint32(24, at, true);
    view.setUint32(40, at, true);
    view.setUint32(48, run === 0 ? length : 0, true);
    view.setUint32(56, run === 0 ? at + length : at, true);
    view.setUint32(64, run === 1 ? length : 0, true);
    bytes.set([1, 1, 1, 0, 15], 97);
    bytes.set(root, 127);
    return { bytes, size: at + length };
  }
  const tileOver = (n: number) =>
    `directories: a tile is ${n} bytes stored; the reader refuses a frame with a tile over ${MAX_TILE_BYTES}`;
  const stated = (what: string, n: number) =>
    `directories: ${what} is stated as ${n} bytes; the reader asks for ${MAX_DIRECTORY_BYTES} at most`;

  it('records the largest leaf directory, stored and unpacked, and the largest tile', async () => {
    const d = (await run(await good({ leaf: true }))).directories!;
    expect(d.largestTileBytes).toBeGreaterThan(0);
    expect(d.largestTileBytes).toBeLessThanOrEqual(MAX_TILE_BYTES);
    expect(d.largestLeafBytes).toBeGreaterThan(0);
    expect(d.largestLeafUnpackedBytes).toBeGreaterThan(0);
    expect(d.largestLeafUnpackedBytes).toBeLessThanOrEqual(MAX_DIRECTORY_BYTES);
    const plain = (await run(await good({ leaf: true, gzip: false }))).directories!;
    expect(plain.largestLeafUnpackedBytes).toBe(plain.largestLeafBytes);
    expect(d.largestLeafUnpackedBytes).toBe(plain.largestLeafBytes);
    const flat = (await run(await good())).directories!;
    expect([flat.largestLeafBytes, flat.largestLeafUnpackedBytes]).toEqual([0, 0]);
  });

  it('a tile stored longer than the reader asks for is named; one at the limit is not', async () => {
    const over = oneEntry(1, MAX_TILE_BYTES + 1);
    const r = await checkArchive(memSource(over.bytes), over.size, { probes: [] });
    expect(r.problems).toEqual([tileOver(MAX_TILE_BYTES + 1)]);
    expect(r.directories!.largestTileBytes).toBe(MAX_TILE_BYTES + 1);
    const at = oneEntry(1, MAX_TILE_BYTES);
    const ok = await checkArchive(memSource(at.bytes), at.size, { probes: [] });
    expect(ok.problems).toEqual([]);
    expect(ok.directories!.largestTileBytes).toBe(MAX_TILE_BYTES);
  });

  it('a leaf directory stated longer than the reader asks for is named and is not read', async () => {
    const over = oneEntry(0, MAX_DIRECTORY_BYTES + 1);
    const src = memSource(over.bytes);
    const r = await checkArchive(src, over.size, { probes: [] });
    expect(r.problems).toEqual([stated('a leaf directory', MAX_DIRECTORY_BYTES + 1)]);
    expect(src.reads.some(([, length]) => length > MAX_DIRECTORY_BYTES)).toBe(false);
    // At the limit it is asked for. The fixture holds no leaf bytes, so the read
    // names a different problem: what matters is that the limit is not it.
    const at = oneEntry(0, MAX_DIRECTORY_BYTES);
    const atSrc = memSource(at.bytes);
    const ok = await checkArchive(atSrc, at.size, { probes: [] });
    expect(ok.problems.some((p) => p.includes('is stated as'))).toBe(false);
    expect(atSrc.reads.some(([, length]) => length === MAX_DIRECTORY_BYTES)).toBe(true);
  });

  it('a root directory stated longer than the reader asks for is named and is not read', async () => {
    const bytes = withU64(await good(), 16, MAX_DIRECTORY_BYTES + 1);
    const src = memSource(bytes);
    const r = await checkArchive(src, bytes.length, { probes: [] });
    expect(r.problems).toContain(stated('the root directory', MAX_DIRECTORY_BYTES + 1));
    expect(src.reads.some(([, length]) => length > MAX_DIRECTORY_BYTES)).toBe(false);
  });

  it('a directory that unpacks past the limit is named; one that unpacks to the limit is not', async () => {
    const base = await good();
    for (const over of [0, 1]) {
      // A root with no entries, then zero bytes: the decoder stops after the count.
      const root = await gzip(new Uint8Array(MAX_DIRECTORY_BYTES + over));
      const out = new Uint8Array(base.length + root.length);
      out.set(base);
      out.set(root, base.length);
      const view = new DataView(out.buffer);
      view.setUint32(8, base.length, true);
      view.setUint32(16, root.length, true);
      const r = await checkArchive(memSource(out), out.length, { probes: [] });
      const named = `directories: gzip unpacks past ${MAX_DIRECTORY_BYTES} bytes`;
      expect(r.problems.includes(named)).toBe(over === 1);
    }
  });
});

describe('street-map archive check | directories', () => {
  it('a leaf larger than the entries the reader keeps is named', async () => {
    const bytes = await good({ leaf: true });
    const n = tiles().length;
    const r = await run(bytes, { maxLeafEntries: n - 1 });
    expect(r.problems).toEqual([
      `directories: a leaf holds ${n} entries; the reader keeps ${n - 1} in all`,
    ]);
    expect(r.directories!.leavesInBudget).toBe(0);
    const fits = await run(bytes, { maxLeafEntries: n * 4 });
    expect(fits.problems).toEqual([]);
    expect(fits.directories!.leavesInBudget).toBe(4);
  });

  it('a count of tile entries that differs from the header is named; the true count is not', async () => {
    const bytes = await good();
    const n = tiles().length;
    expect((await run(withU64(bytes, 80, n + 1))).problems).toEqual([
      `directories: ${n} tile entries found; the header says ${n + 1}`,
    ]);
    expect((await run(withU64(bytes, 80, n))).problems).toEqual([]);
  });

  it('a count of addressed tiles that differs from the header is named; the true count is not', async () => {
    const bytes = await good();
    const n = tiles().length;
    expect((await run(withU64(bytes, 72, n + 2))).problems).toEqual([
      `directories: ${n} tiles addressed; the header says ${n + 2}`,
    ]);
    expect((await run(withU64(bytes, 72, n))).problems).toEqual([]);
  });

  // Hand-made archives with no tiles: a directory of one pointer is five bytes
  // (count 1, tile id 0, run length 0, length, offset + 1); an empty one is one.
  const pointer = (offset: number, length: number): number[] => [
    ...varint(1),
    ...varint(0),
    ...varint(0),
    ...varint(length),
    ...varint(offset + 1),
  ];
  function handMade(root: number[], leafSection: number[]): Uint8Array {
    const out = new Uint8Array(127 + root.length + leafSection.length);
    out.set(new TextEncoder().encode('PMTiles'), 0);
    out[7] = 3;
    const view = new DataView(out.buffer);
    view.setUint32(8, 127, true);
    view.setUint32(16, root.length, true);
    view.setUint32(24, 127 + root.length, true);
    view.setUint32(40, 127 + root.length, true);
    view.setUint32(48, leafSection.length, true);
    view.setUint32(56, out.length, true);
    out.set([1, 1, 1, 0, 15], 97);
    out.set(root, 127);
    out.set(leafSection, 127 + root.length);
    return out;
  }
  /** The root, then `depth` leaves one inside the other; the last is empty. */
  function nested(depth: number): Uint8Array {
    const leaves: number[] = [];
    for (let i = 1; i < depth; i++) leaves.push(...pointer(5 * i, i === depth - 1 ? 1 : 5));
    leaves.push(...varint(0));
    return handMade(pointer(0, depth === 1 ? 1 : 5), leaves);
  }

  it('leaves nested as deep as the reader follows pass; one deeper is named', async () => {
    expect(READER_MAX_DEPTH).toBe(3);
    const ok = await run(nested(3), { probes: [] });
    expect(ok.problems).toEqual([]);
    expect(ok.directories).toMatchObject({ leaves: 3, depth: 3, tileEntries: 0 });
    const deep = await run(nested(4), { probes: [] });
    expect(deep.problems).toEqual(['directories: nested deeper than the reader follows']);
  });

  it('a leaf that points back at itself ends the walk', async () => {
    const r = await run(handMade(pointer(0, 5), pointer(0, 5)), { probes: [] });
    expect(r.problems).toEqual(['directories: nested deeper than the reader follows']);
  });

  it('a leaf that lies outside the leaf section is named', async () => {
    const r = await run(handMade(pointer(0, 5), pointer(0, 50)), { probes: [] });
    expect(r.problems).toEqual(['directories: a leaf lies outside its section']);
  });
});

describe('street-map archive check | draws', () => {
  it('an area inside the region that draws nothing is a problem', async () => {
    const r = await run(await good(), {
      probes: [{ name: 'empty', cells: [FAR], expect: 'streets' }],
    });
    expect(r.problems).toEqual(['draw: empty: expected streets, got none']);
  });

  it('an area outside the region that draws streets is a problem', async () => {
    const r = await run(await good(), {
      probes: [{ name: 'kept', cells: [CELL], expect: 'none' }],
    });
    expect(r.problems).toEqual(['draw: kept: expected none, got streets']);
  });

  it('a layer with water and no roads is not streets', async () => {
    const lake = mvtTile([
      {
        name: 'water',
        features: [
          {
            type: 3,
            props: { kind: 'lake' },
            parts: [
              [
                [0, 0],
                [4096, 0],
                [4096, 4096],
                [0, 0],
              ],
            ],
          },
        ],
      },
    ]);
    const bytes = await pmtilesArchive(
      tiles().map((t) => ({ ...t, data: lake })),
      { gzip: true }
    );
    const r = await run(bytes, { probes: [PROBES[0]!] });
    expect(r.probes[0]!.got).toBe('no-roads');
    expect(r.problems).toEqual(['draw: inside: expected streets, got no-roads']);
  });

  it('a draw that is only reported never fails for what it drew', async () => {
    const r = await run(await good(), {
      probes: [
        { name: 'a', cells: [FAR], expect: 'report' },
        { name: 'b', cells: [CELL], expect: 'report' },
      ],
    });
    expect(r.problems).toEqual([]);
    expect(r.probes.map((p) => p.got)).toEqual(['none', 'streets']);
  });
});
