// ─── PMTiles v3 reader — the street map's tile source ──────────────────────────
//
// The street map under the hexagons (lib/street-map.ts) is drawn by the Worker
// from a self-hosted OpenStreetMap archive (Protomaps build, PMTiles v3) kept in
// R2. This module reads single tiles out of that one file by byte range. It is
// written here rather than imported so the Worker keeps h3-js as its only
// runtime library; the format is small and fixed
// (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md).
//
// WHAT IT READS. Only z/x/y tile addresses chosen by the server from the cells
// being drawn. No request parameter, viewer position or identity reaches it, and
// it logs nothing (a logged tile range would say which part of the map a page
// showed).

/** Where the archive's bytes come from. R2 in the Worker; a buffer in tests. */
export interface RangeSource {
  /** Stable name for caching (archive key plus its version). */
  readonly key: string;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface PmtilesHeader {
  rootDirectoryOffset: number;
  rootDirectoryLength: number;
  leafDirectoryOffset: number;
  tileDataOffset: number;
  internalCompression: number;
  tileCompression: number;
  tileType: number;
  minZoom: number;
  maxZoom: number;
}

export interface DirEntry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

export const HEADER_BYTES = 127;
/** First read: the header and, in a Protomaps build, the whole root directory. */
const FIRST_READ_BYTES = 16384;
/** Leaf directory lookups at most, so a damaged archive cannot loop. */
const MAX_DEPTH = 3;

export const COMPRESSION = { unknown: 0, none: 1, gzip: 2, brotli: 3, zstd: 4 } as const;
export const TILE_TYPE_MVT = 1;

export class PmtilesError extends Error {}

function u64(view: DataView, at: number): number {
  const lo = view.getUint32(at, true);
  const hi = view.getUint32(at + 4, true);
  const v = hi * 2 ** 32 + lo;
  if (!Number.isSafeInteger(v)) throw new PmtilesError('offset out of range');
  return v;
}

export function parseHeader(bytes: Uint8Array): PmtilesHeader {
  if (bytes.length < HEADER_BYTES) throw new PmtilesError('short header');
  const magic = String.fromCharCode(...bytes.subarray(0, 7));
  if (magic !== 'PMTiles') throw new PmtilesError('not a PMTiles archive');
  if (bytes[7] !== 3) throw new PmtilesError(`unsupported PMTiles version ${bytes[7]}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    rootDirectoryOffset: u64(view, 8),
    rootDirectoryLength: u64(view, 16),
    leafDirectoryOffset: u64(view, 40),
    tileDataOffset: u64(view, 56),
    internalCompression: bytes[97]!,
    tileCompression: bytes[98]!,
    tileType: bytes[99]!,
    minZoom: bytes[100]!,
    maxZoom: bytes[101]!,
  };
}

/** Hilbert-curve tile id (spec: "TileID"). Exact up to z 26. */
export function zxyToTileId(z: number, x: number, y: number): number {
  if (!Number.isInteger(z) || z < 0 || z > 26) throw new PmtilesError('zoom out of range');
  const n = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) {
    throw new PmtilesError('tile out of range');
  }
  const base = (4 ** z - 1) / 3;
  let d = 0;
  let tx = x;
  let ty = y;
  // Stryker disable next-line ArithmeticOperator: starting at s = n * 2 adds two rounds (s = 2n, then n) where x, y < n have those bits clear, so each adds 0 and swaps tx/ty, the two swaps cancel, and the walk from n / 2 on is unchanged
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (tx & s) > 0 ? 1 : 0;
    const ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - (tx & (s - 1));
        ty = s - 1 - (ty & (s - 1));
      }
      const t = tx;
      tx = ty;
      ty = t;
    }
  }
  return base + d;
}

class Cursor {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}
  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.buf.length) throw new PmtilesError('truncated varint');
      const b = this.buf[this.pos++]!;
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 49) throw new PmtilesError('varint too long');
    }
    return result;
  }
}

export function decodeDirectory(bytes: Uint8Array): DirEntry[] {
  const c = new Cursor(bytes);
  const n = c.varint();
  // Each entry takes at least four bytes; a count past that is a damaged file.
  if (n > bytes.length) throw new PmtilesError('directory count out of range');
  const entries: DirEntry[] = [];
  let last = 0;
  for (let i = 0; i < n; i++) {
    last += c.varint();
    entries.push({ tileId: last, offset: 0, length: 0, runLength: 0 });
  }
  for (const e of entries) e.runLength = c.varint();
  for (const e of entries) e.length = c.varint();
  for (let i = 0; i < n; i++) {
    const v = c.varint();
    const e = entries[i]!;
    if (v === 0 && i > 0) {
      const prev = entries[i - 1]!;
      e.offset = prev.offset + prev.length;
    } else {
      e.offset = v - 1;
    }
  }
  return entries;
}

/** The entry for `tileId`, a leaf pointer (runLength 0), or null. */
export function findEntry(entries: readonly DirEntry[], tileId: number): DirEntry | null {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const id = entries[mid]!.tileId;
    if (id < tileId) lo = mid + 1;
    else if (id > tileId) hi = mid - 1;
    else return entries[mid]!;
  }
  // Largest tileId below the target: a run that covers it, or a leaf directory.
  if (hi >= 0) {
    const e = entries[hi]!;
    if (e.runLength === 0) return e;
    if (tileId - e.tileId < e.runLength) return e;
  }
  return null;
}

export async function decompress(bytes: Uint8Array, compression: number): Promise<Uint8Array> {
  if (compression === COMPRESSION.none || compression === COMPRESSION.unknown) return bytes;
  if (compression !== COMPRESSION.gzip) {
    throw new PmtilesError(`unsupported compression ${compression}`);
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Opened {
  header: PmtilesHeader;
  root: DirEntry[];
  leaves: Map<number, Promise<DirEntry[]>>;
}

/** Header and directories per archive, kept for the life of the isolate. */
const OPENED = new Map<string, Promise<Opened>>();
/** Leaf directories kept per archive; past this the oldest goes. */
const MAX_LEAVES = 64;

async function open(src: RangeSource): Promise<Opened> {
  const hit = OPENED.get(src.key);
  if (hit) return hit;
  const p = (async () => {
    const first = await src.read(0, FIRST_READ_BYTES);
    const header = parseHeader(first);
    const { rootDirectoryOffset: off, rootDirectoryLength: len } = header;
    const raw =
      off + len <= first.length ? first.subarray(off, off + len) : await src.read(off, len);
    const root = decodeDirectory(await decompress(raw, header.internalCompression));
    return { header, root, leaves: new Map() };
  })();
  OPENED.set(src.key, p);
  // A failed open is not kept: the next page tries again.
  p.catch(() => OPENED.delete(src.key));
  return p;
}

/** Forget cached headers and directories (tests; an archive swapped in place). */
export function resetPmtilesCache(): void {
  OPENED.clear();
}

async function leaf(src: RangeSource, o: Opened, e: DirEntry): Promise<DirEntry[]> {
  const at = o.header.leafDirectoryOffset + e.offset;
  const hit = o.leaves.get(at);
  if (hit) return hit;
  const p = src
    .read(at, e.length)
    .then((raw) => decompress(raw, o.header.internalCompression))
    .then(decodeDirectory);
  if (o.leaves.size >= MAX_LEAVES) o.leaves.delete(o.leaves.keys().next().value!);
  o.leaves.set(at, p);
  p.catch(() => o.leaves.delete(at));
  return p;
}

/** Header of the archive (zoom range, tile type). */
export async function archiveHeader(src: RangeSource): Promise<PmtilesHeader> {
  return (await open(src)).header;
}

/**
 * One tile's bytes, decompressed, or null when the archive has no tile there
 * (open water and empty land are often left out).
 */
export async function readTile(
  src: RangeSource,
  z: number,
  x: number,
  y: number
): Promise<Uint8Array | null> {
  const o = await open(src);
  if (z < o.header.minZoom || z > o.header.maxZoom) return null;
  const id = zxyToTileId(z, x, y);
  let dir = o.root;
  for (let depth = 0; depth <= MAX_DEPTH; depth++) {
    const e = findEntry(dir, id);
    if (!e) return null;
    if (e.runLength > 0) {
      const raw = await src.read(o.header.tileDataOffset + e.offset, e.length);
      return decompress(raw, o.header.tileCompression);
    }
    dir = await leaf(src, o, e);
  }
  throw new PmtilesError('directory nesting too deep');
}

/** Minimal shape of the R2 binding this module reads (`R2Bucket` satisfies it). */
export interface RangeBucket {
  get(
    key: string,
    options?: { range?: { offset: number; length: number } }
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; etag?: string } | null>;
}

/** A RangeSource over one R2 object. */
export function r2Source(bucket: RangeBucket, name: string): RangeSource {
  return {
    key: `r2:${name}`,
    async read(offset, length) {
      const obj = await bucket.get(name, { range: { offset, length } });
      if (!obj) throw new PmtilesError('archive not found');
      return new Uint8Array(await obj.arrayBuffer());
    },
  };
}
