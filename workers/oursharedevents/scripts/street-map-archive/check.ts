// ─── Street-map archive check — run before an archive is loaded into R2 ───────
//
// Reads a cut archive (docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md) the way the
// Worker will: the product's own reader (src/lib/pmtiles.ts) and its own drawing
// (src/lib/street-map.ts), over a local file instead of R2. A file that passes
// here is one the Worker can draw from; a file that fails is not uploaded.
//
// WHAT IT CHECKS
//   1. Header: PMTiles v3, vector tiles, a compression the reader unpacks, and
//      the zoom the zoomed area reads.
//   2. Whole file: every section ends inside the file and the last one ends at
//      its last byte (a cut or copy that stopped early fails here).
//   3. Directories: every leaf directory is read and counted. The counts must
//      match the header, no tile may point past the tile data, and the largest
//      leaf must fit the reader's entry budget. Every directory and every tile
//      must be inside the reader's limits (MAX_DIRECTORY_BYTES, MAX_TILE_BYTES):
//      past them the Worker refuses the read and draws hexagons only.
//   4. Draws: the reader and the drawing behind `buildStreetLayer`, the function
//      the landing page calls, must read no tile for areas outside the region,
//      and for areas inside it must draw a street map: highways and major
//      roads, not water with a road or two (MIN_MAIN_ROAD_POINTS,
//      MIN_MAIN_ROAD_SHARE). The rule asks for more than the Worker's own floor
//      (`layerShows`), so a draw that passes is one the Worker shows.
//
// It is pure: the caller gives it a RangeSource and the file's size. The command
// that opens a file is `scripts/check-street-map-archive.mjs`.
//
// The places below are public city centres, used only to pick an H3 res-7 cell
// to aim a draw at. Nothing here reads a request, a viewer or an event.

import { gridDisk, latLngToCell } from 'h3-js';
import {
  COMPRESSION,
  HEADER_BYTES,
  MAX_DIRECTORY_BYTES,
  MAX_LEAF_ENTRIES,
  MAX_TILE_BYTES,
  TILE_TYPE_MVT,
  decodeDirectory,
  decompress,
  parseHeader,
  resetPmtilesCache,
  type DirEntry,
  type PmtilesHeader,
  type RangeSource,
} from '../../src/lib/pmtiles.js';
import { MAX_ZOOM, readStreetDrawing, type DrawnPoints } from '../../src/lib/street-map.js';

/** Leaf directories the reader follows below the root (lib/pmtiles.ts, MAX_DEPTH). */
export const READER_MAX_DEPTH = 3;

/**
 * What a draw must hold of highway and major road to count as "streets": this
 * many points, and this share of every point drawn. Every draw aimed inside
 * the region is at a city centre. Measured through this drawing on real tiles
 * of Protomaps build 20261109 (a workstation run, 2026-11-15), the thinnest of
 * the 16 drew 304 such points (San Juan) and the smallest share was 7.9%
 * (Anchorage); the layer the old drawing made of 19 areas of Manhattan held 1
 * point of 9,000. A third of the thinnest, so a real cut is not refused for a
 * quiet city, and a layer of water with a road or two is.
 */
export const MIN_MAIN_ROAD_POINTS = 100;
export const MIN_MAIN_ROAD_SHARE = 0.03;

export interface Probe {
  name: string;
  cells: string[];
  /** streets: a street map must be drawn. none: no tile is read. report: recorded, never a failure. */
  expect: 'streets' | 'none' | 'report';
}

export interface ProbeResult {
  name: string;
  cells: number;
  expect: Probe['expect'];
  /**
   * streets: enough highway and major road (a layer the Worker shows).
   * thin-roads: roads were drawn, too few to be a street map. no-roads: tiles
   * were read and held no road. none: no tile for the frame.
   */
  got: 'streets' | 'thin-roads' | 'no-roads' | 'none' | 'error';
  error?: string;
  /** Path points drawn, by kind; null when no tile was read. */
  drawn: DrawnPoints | null;
  zoom: number | null;
  reads: number;
  bytes: number;
  ms: number;
  ok: boolean;
}

export interface ArchiveReport {
  size: number;
  header: {
    minZoom: number;
    maxZoom: number;
    tileType: number;
    tileCompression: number;
    internalCompression: number;
    clustered: boolean;
    rootBytes: number;
    metadataBytes: number;
    leafBytes: number;
    tileDataBytes: number;
    addressedTiles: number;
    tileEntries: number;
    tileContents: number;
  } | null;
  directories: {
    leaves: number;
    depth: number;
    smallestLeaf: number;
    largestLeaf: number;
    tileEntries: number;
    addressedTiles: number;
    /** Leaves of the largest size the reader keeps at once. */
    leavesInBudget: number;
    /** The longest leaf directory as stored, and the longest once unpacked (0 with no leaf). */
    largestLeafBytes: number;
    largestLeafUnpackedBytes: number;
    /** The longest tile as stored. */
    largestTileBytes: number;
  } | null;
  probes: ProbeResult[];
  problems: string[];
}

export interface CheckOptions {
  probes?: Probe[];
  /** The reader's entry budget; tests lower it. */
  maxLeafEntries?: number;
}

const RES = 7;
const INSIDE: [string, number, number][] = [
  ['Chicago', 41.8781, -87.6298],
  ['Seattle', 47.6062, -122.3321],
  ['San Diego', 32.7157, -117.1611],
  ['Miami', 25.7617, -80.1918],
  ['Bangor, Maine', 44.8016, -68.7712],
  ['Anchorage', 61.2181, -149.9003],
  ['Honolulu', 21.3069, -157.8583],
  ['San Juan, Puerto Rico', 18.4655, -66.1057],
];
/**
 * Cities on the water, drawn wide. These are the frames where water took the
 * whole point budget before roads were paid first (street-map CCR 2026-11-15).
 */
const ON_WATER: [string, number, number][] = [
  ['Manhattan', 40.7831, -73.9712],
  ['Seattle', 47.6062, -122.3321],
  ['San Francisco', 37.7749, -122.4194],
];
const OUTSIDE: [string, number, number][] = [
  ['London', 51.5074, -0.1278],
  ['Mexico City', 19.4326, -99.1332],
];

/**
 * The draws every United States archive must pass: one area in each part of the
 * region (docs/runbooks/street-map-us-region.geojson), the landing map's wider
 * frames, the same frames over cities on the water, and two areas outside the
 * region, which must draw nothing.
 */
export function defaultProbes(): Probe[] {
  const chicago = latLngToCell(41.8781, -87.6298, RES);
  return [
    ...INSIDE.map(([name, lat, lng]): Probe => ({
      name: `${name}, one area`,
      cells: [latLngToCell(lat, lng, RES)],
      expect: 'streets',
    })),
    { name: 'Chicago, 7 areas', cells: gridDisk(chicago, 1), expect: 'streets' },
    { name: 'Chicago, 19 areas', cells: gridDisk(chicago, 2), expect: 'streets' },
    ...ON_WATER.flatMap(([name, lat, lng]): Probe[] =>
      [1, 2].map((rings) => {
        const cells = gridDisk(latLngToCell(lat, lng, RES), rings);
        return { name: `${name}, ${cells.length} areas (on the water)`, cells, expect: 'streets' };
      })
    ),
    ...OUTSIDE.map(([name, lat, lng]): Probe => ({
      name: `${name}, one area (outside the region)`,
      cells: [latLngToCell(lat, lng, RES)],
      expect: 'none',
    })),
  ];
}

function u64(view: DataView, at: number): number {
  return view.getUint32(at + 4, true) * 2 ** 32 + view.getUint32(at, true);
}

const compressionName = (c: number): string =>
  Object.entries(COMPRESSION).find(([, v]) => v === c)?.[0] ?? `unknown (${c})`;

/** Check one archive. Never throws: what is wrong is listed in `problems`. */
export async function checkArchive(
  src: RangeSource,
  size: number,
  opts: CheckOptions = {}
): Promise<ArchiveReport> {
  const report: ArchiveReport = { size, header: null, directories: null, probes: [], problems: [] };
  const bad = (msg: string): void => {
    report.problems.push(msg);
  };

  // 1. Header.
  let header: PmtilesHeader;
  let head: Uint8Array;
  try {
    head = await src.read(0, HEADER_BYTES);
    header = parseHeader(head);
  } catch (e) {
    bad(`header: ${(e as Error).message}`);
    return report;
  }
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const h = {
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    tileType: header.tileType,
    tileCompression: header.tileCompression,
    internalCompression: header.internalCompression,
    clustered: head[96] === 1,
    rootBytes: header.rootDirectoryLength,
    metadataBytes: u64(view, 32),
    leafBytes: u64(view, 48),
    tileDataBytes: u64(view, 64),
    addressedTiles: u64(view, 72),
    tileEntries: u64(view, 80),
    tileContents: u64(view, 88),
  };
  report.header = h;
  if (h.tileType !== TILE_TYPE_MVT) bad(`header: tile type ${h.tileType} is not vector (MVT)`);
  for (const [what, c] of [
    ['tile', h.tileCompression],
    ['directory', h.internalCompression],
  ] as const) {
    if (c !== COMPRESSION.gzip && c !== COMPRESSION.none) {
      bad(`header: ${what} compression is ${compressionName(c)}; the reader unpacks gzip only`);
    }
  }
  if (h.maxZoom < MAX_ZOOM) {
    bad(`header: finest zoom is ${h.maxZoom}; the zoomed area reads zoom ${MAX_ZOOM}`);
  }

  // 2. Whole file.
  const sections: [string, number, number][] = [
    ['root directory', header.rootDirectoryOffset, h.rootBytes],
    ['metadata', u64(view, 24), h.metadataBytes],
    ['leaf directories', header.leafDirectoryOffset, h.leafBytes],
    ['tile data', header.tileDataOffset, h.tileDataBytes],
  ];
  let end = HEADER_BYTES;
  for (const [name, offset, length] of sections) {
    end = Math.max(end, offset + length);
    if (offset + length > size) {
      bad(`file: ${name} ends at byte ${offset + length}, past the end of the file (${size})`);
    }
  }
  if (end < size) bad(`file: ${size - end} bytes after the last section (ends at ${end})`);

  // 3. Directories.
  const sizes: number[] = [];
  let depth = 0;
  let tileEntries = 0;
  let addressedTiles = 0;
  let tileEnd = 0;
  let largestLeafBytes = 0;
  let largestLeafUnpackedBytes = 0;
  let largestTileBytes = 0;
  const overLimit = (what: string, length: number): Error =>
    new Error(
      `${what} is stated as ${length} bytes; the reader asks for ${MAX_DIRECTORY_BYTES} at most`
    );
  const walk = async (dir: DirEntry[], level: number): Promise<void> => {
    depth = Math.max(depth, level);
    for (const e of dir) {
      if (e.runLength > 0) {
        tileEntries++;
        addressedTiles += e.runLength;
        tileEnd = Math.max(tileEnd, e.offset + e.length);
        largestTileBytes = Math.max(largestTileBytes, e.length);
        continue;
      }
      if (level >= READER_MAX_DEPTH) throw new Error('nested deeper than the reader follows');
      if (e.offset + e.length > h.leafBytes) throw new Error('a leaf lies outside its section');
      if (e.length > MAX_DIRECTORY_BYTES) throw overLimit('a leaf directory', e.length);
      const raw = await src.read(header.leafDirectoryOffset + e.offset, e.length);
      const unpacked = await decompress(raw, h.internalCompression, MAX_DIRECTORY_BYTES);
      const leaf = decodeDirectory(unpacked);
      largestLeafBytes = Math.max(largestLeafBytes, e.length);
      largestLeafUnpackedBytes = Math.max(largestLeafUnpackedBytes, unpacked.length);
      sizes.push(leaf.length);
      await walk(leaf, level + 1);
    }
  };
  try {
    if (h.rootBytes > MAX_DIRECTORY_BYTES) throw overLimit('the root directory', h.rootBytes);
    const raw = await src.read(header.rootDirectoryOffset, h.rootBytes);
    await walk(
      decodeDirectory(await decompress(raw, h.internalCompression, MAX_DIRECTORY_BYTES)),
      0
    );
    const largest = Math.max(0, ...sizes);
    const budget = opts.maxLeafEntries ?? MAX_LEAF_ENTRIES;
    report.directories = {
      leaves: sizes.length,
      depth,
      smallestLeaf: sizes.length ? Math.min(...sizes) : 0,
      largestLeaf: largest,
      tileEntries,
      addressedTiles,
      leavesInBudget: largest ? Math.floor(budget / largest) : 0,
      largestLeafBytes,
      largestLeafUnpackedBytes,
      largestTileBytes,
    };
    if (largestTileBytes > MAX_TILE_BYTES) {
      bad(
        `directories: a tile is ${largestTileBytes} bytes stored; the reader refuses a frame with a tile over ${MAX_TILE_BYTES}`
      );
    }
    if (largest > budget) {
      bad(`directories: a leaf holds ${largest} entries; the reader keeps ${budget} in all`);
    }
    if (h.tileEntries > 0 && h.tileEntries !== tileEntries) {
      bad(`directories: ${tileEntries} tile entries found; the header says ${h.tileEntries}`);
    }
    if (h.addressedTiles > 0 && h.addressedTiles !== addressedTiles) {
      bad(`directories: ${addressedTiles} tiles addressed; the header says ${h.addressedTiles}`);
    }
    if (tileEnd > h.tileDataBytes) {
      bad(`directories: a tile ends at byte ${tileEnd} of a ${h.tileDataBytes}-byte tile section`);
    }
  } catch (e) {
    bad(`directories: ${(e as Error).message}`);
  }

  // 4. Draws, through the product's reader. Its cache is emptied first, so the
  //    first draw is a cold one; the rest find the header and directories kept.
  resetPmtilesCache();
  for (const p of opts.probes ?? defaultProbes()) {
    let reads = 0;
    let bytes = 0;
    const counted: RangeSource = {
      key: src.key,
      async read(offset, length) {
        const out = await src.read(offset, length);
        reads++;
        bytes += out.length;
        return out;
      },
    };
    const started = performance.now();
    let got: ProbeResult['got'];
    let zoom: number | null = null;
    let error: string | undefined;
    let drawn: DrawnPoints | null = null;
    let why = '';
    try {
      const drawing = await readStreetDrawing(counted, p.cells);
      if (!drawing) got = 'none';
      else {
        drawn = drawing.drawn;
        const main = drawn.highway + drawn.major;
        const all = main + drawn.minor + drawn.water + drawn.rivers;
        if (main + drawn.minor === 0) got = 'no-roads';
        else if (main >= MIN_MAIN_ROAD_POINTS && main >= all * MIN_MAIN_ROAD_SHARE) {
          got = 'streets';
        } else {
          got = 'thin-roads';
          why = `highway and major road: ${main} of ${all} points drawn; a draw needs ${MIN_MAIN_ROAD_POINTS} and ${MIN_MAIN_ROAD_SHARE * 100}%`;
        }
        const z = /data-z="(\d+)"/.exec(drawing.svg);
        if (z) zoom = Number(z[1]);
      }
    } catch (e) {
      got = 'error';
      error = (e as Error).message;
    }
    const ok = p.expect === 'report' ? got !== 'error' : got === p.expect;
    report.probes.push({
      name: p.name,
      cells: p.cells.length,
      expect: p.expect,
      got,
      ...(error ? { error } : {}),
      drawn,
      zoom,
      reads,
      bytes,
      ms: Math.round(performance.now() - started),
      ok,
    });
    const detail = error || (p.expect === 'streets' ? why : '');
    if (!ok)
      bad(`draw: ${p.name}: expected ${p.expect}, got ${got}${detail ? ` (${detail})` : ''}`);
  }
  return report;
}
