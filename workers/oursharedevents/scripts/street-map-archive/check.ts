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
//      leaf must fit the reader's entry budget.
//   4. Draws: `buildStreetLayer`, the function the landing page calls, must draw
//      roads for areas inside the region and nothing for areas outside it.
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
  MAX_LEAF_ENTRIES,
  TILE_TYPE_MVT,
  decodeDirectory,
  decompress,
  parseHeader,
  resetPmtilesCache,
  type DirEntry,
  type PmtilesHeader,
  type RangeSource,
} from '../../src/lib/pmtiles.js';
import { MAX_ZOOM, buildStreetLayer } from '../../src/lib/street-map.js';

/** Leaf directories the reader follows below the root (lib/pmtiles.ts, MAX_DEPTH). */
export const READER_MAX_DEPTH = 3;

export interface Probe {
  name: string;
  cells: string[];
  /** streets: roads must be drawn. none: no layer at all. report: recorded, never a failure. */
  expect: 'streets' | 'none' | 'report';
}

export interface ProbeResult {
  name: string;
  cells: number;
  expect: Probe['expect'];
  got: 'streets' | 'no-roads' | 'none' | 'error';
  error?: string;
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
const OUTSIDE: [string, number, number][] = [
  ['London', 51.5074, -0.1278],
  ['Mexico City', 19.4326, -99.1332],
];

/**
 * The draws every United States archive must pass: one area in each part of the
 * region (docs/runbooks/street-map-us-region.geojson), the landing map's wider
 * frames, and two areas outside the region, which must draw nothing.
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
  const walk = async (dir: DirEntry[], level: number): Promise<void> => {
    depth = Math.max(depth, level);
    for (const e of dir) {
      if (e.runLength > 0) {
        tileEntries++;
        addressedTiles += e.runLength;
        tileEnd = Math.max(tileEnd, e.offset + e.length);
        continue;
      }
      if (level >= READER_MAX_DEPTH) throw new Error('nested deeper than the reader follows');
      if (e.offset + e.length > h.leafBytes) throw new Error('a leaf lies outside its section');
      const raw = await src.read(header.leafDirectoryOffset + e.offset, e.length);
      const leaf = decodeDirectory(await decompress(raw, h.internalCompression));
      sizes.push(leaf.length);
      await walk(leaf, level + 1);
    }
  };
  try {
    const raw = await src.read(header.rootDirectoryOffset, h.rootBytes);
    await walk(decodeDirectory(await decompress(raw, h.internalCompression)), 0);
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
    };
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
    try {
      const layer = await buildStreetLayer(counted, p.cells);
      got = !layer ? 'none' : layer.svg.includes('class="as-r') ? 'streets' : 'no-roads';
      const z = layer && /data-z="(\d+)"/.exec(layer.svg);
      if (z) zoom = Number(z[1]);
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
      zoom,
      reads,
      bytes,
      ms: Math.round(performance.now() - started),
      ok,
    });
    if (!ok) bad(`draw: ${p.name}: expected ${p.expect}, got ${got}${error ? ` (${error})` : ''}`);
  }
  return report;
}
