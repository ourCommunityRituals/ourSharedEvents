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
//
// WHAT IT TRUSTS. Nothing the archive says about its own size. Every length in
// the header or a directory is checked against a limit before a byte is asked
// for, and gzip stops unpacking at a limit (the limits are below, with the
// numbers they stand on). Past a limit the read is refused with a PmtilesError,
// which the street map turns into hexagons only. Without them a damaged or
// hostile file could make the Worker hold more than it has, and that ends the
// isolate and the page with it.

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

/**
 * A directory (root or leaf): stated longer than this it is not asked for, and
 * it may unpack to no more than this. One number for both, so a directory
 * stored without compression is held to what a gzipped one may unpack to.
 * Measured on build 20261109 (2026-11-10): a leaf of 61,239 entries was 115 KB
 * and 129 KB gzipped and about 0.32 MB unpacked (5.2 bytes an entry). So this
 * is 16 of the largest seen as stored, and unpacked it holds about 400,000
 * entries of that build, more than MAX_LEAF_ENTRIES keeps. The most any
 * directory this long can hold is 524,287 entries, at four bytes an entry
 * (`decodeDirectory`): about 43 MB at the 82 bytes an entry measured in Node.
 */
export const MAX_DIRECTORY_BYTES = 2_097_152;
/**
 * One tile unpacked. A frame reads at most 12 tiles (lib/street-map.ts,
 * MAX_TILES) and unpacks them together, so a frame holds at most 48 MiB of
 * tiles. Measured on build 20261109 (2026-11-10): a first map read 0.41 MB to
 * 0.77 MB as stored, header, leaf directory and every tile of the frame
 * together. What those tiles unpacked to was not recorded.
 */
export const MAX_TILE_UNPACKED_BYTES = 4_194_304;

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
  // An entry is four varints (id, run, length, offset), a byte each at the
  // least, so n entries need 4n bytes after the count. A count the bytes cannot
  // hold is refused here, before an entry is made for it: the count is the
  // file's word, and the entries are the Worker's memory (street-map CCR
  // 2026-11-15, R2: held to the byte length alone, a directory of zeros that
  // unpacks to MAX_DIRECTORY_BYTES could claim 2,097,151 entries, about 170 MB
  // at 82 bytes an entry, before the second column ran out and it threw).
  if (n * 4 > bytes.length - c.pos) throw new PmtilesError('directory count out of range');
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

/**
 * The bytes unpacked. Gzip is read a chunk at a time and stopped once it has
 * given more than `maxBytes`: the rest of the stream is not read, so a small
 * body that unpacks to gigabytes costs one chunk past the limit. Bytes stored
 * without compression are returned as they are; their length was checked
 * before they were asked for.
 */
export async function decompress(
  bytes: Uint8Array,
  compression: number,
  maxBytes: number
): Promise<Uint8Array> {
  if (compression === COMPRESSION.none || compression === COMPRESSION.unknown) return bytes;
  if (compression !== COMPRESSION.gzip) {
    throw new PmtilesError(`unsupported compression ${compression}`);
  }
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PmtilesError(`gzip unpacks past ${maxBytes} bytes`);
    }
    parts.push(value);
  }
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

/** Refuse a directory the archive states as longer than MAX_DIRECTORY_BYTES. */
function directoryLength(length: number): number {
  if (length > MAX_DIRECTORY_BYTES) {
    throw new PmtilesError(`directory of ${length} bytes is over the limit`);
  }
  return length;
}

interface Opened {
  header: PmtilesHeader;
  root: DirEntry[];
  /** Decoded leaf directories by offset in the file, oldest first. */
  leaves: Map<number, DirEntry[]>;
}

/**
 * Header and directories per archive, kept for the life of the isolate.
 *
 * Only what has been read and decoded is kept, never a read in flight. Every
 * request in an isolate shares this map, and the Workers runtime drops a read
 * with the request that asked for it: a request that ends first (the street
 * layer's time limit, lib/street-map.ts) leaves a promise that never settles.
 * Kept here, that promise would be waited on by every later request until its
 * own limit ran out, for as long as the isolate lived
 * (tests/street-map-runtime.spec.ts, in workerd). So two requests that open a
 * cold archive together each read the header: 16 KB more, once.
 */
const OPENED = new Map<string, Opened>();
/** Leaf directories kept per archive; past this the oldest goes. */
const MAX_LEAVES = 64;
/**
 * Directory entries kept in those leaves, in all. A regional file's leaves hold
 * a few thousand entries each; a whole-planet build spreads hundreds of millions
 * of entries over the few thousand pointers a 16 KB root can hold, so one leaf
 * can hold a hundred thousand. Counting leaves alone, 64 of those would outgrow
 * a Worker's memory. An entry measured about 82 bytes in Node, so this budget is
 * about 25 MB. The newest leaf always stays, whatever its size.
 * Measured on build 20261109 (2026-11-10, two leaves, from a workstation): each
 * held 61,239 entries (115 KB and 129 KB gzipped, about 0.32 MB unpacked, 5 ms
 * to unpack and decode), so this budget keeps four leaves of that size.
 */
export const MAX_LEAF_ENTRIES = 300_000;

/**
 * Leaf directories being read by one call, by offset in the file. The tiles of
 * one frame share them; nothing outlives the call.
 */
type LeafReads = Map<number, Promise<DirEntry[]>>;

async function open(src: RangeSource): Promise<Opened> {
  const hit = OPENED.get(src.key);
  if (hit) return hit;
  const first = await src.read(0, FIRST_READ_BYTES);
  const header = parseHeader(first);
  const off = header.rootDirectoryOffset;
  const len = directoryLength(header.rootDirectoryLength);
  const raw = off + len <= first.length ? first.subarray(off, off + len) : await src.read(off, len);
  const root = decodeDirectory(
    await decompress(raw, header.internalCompression, MAX_DIRECTORY_BYTES)
  );
  // Kept only now that it is whole. A failed or abandoned open leaves nothing:
  // the next page tries again.
  const opened: Opened = { header, root, leaves: new Map() };
  OPENED.set(src.key, opened);
  return opened;
}

/** Forget cached headers and directories (tests; an archive swapped in place). */
export function resetPmtilesCache(): void {
  OPENED.clear();
}

async function leaf(
  src: RangeSource,
  o: Opened,
  e: DirEntry,
  reads: LeafReads
): Promise<DirEntry[]> {
  const at = o.header.leafDirectoryOffset + e.offset;
  const kept = o.leaves.get(at);
  if (kept) return kept;
  const reading = reads.get(at);
  if (reading) return reading;
  const length = directoryLength(e.length);
  const read = src
    .read(at, length)
    .then((raw) => decompress(raw, o.header.internalCompression, MAX_DIRECTORY_BYTES))
    .then(decodeDirectory)
    .then((entries) => {
      // Kept only once it is decoded. A failed or abandoned read leaves
      // nothing: the next tile tries again.
      keepLeaf(o.leaves, at, entries);
      return entries;
    });
  reads.set(at, read);
  return read;
}

/**
 * Keep this decoded leaf as the newest. A 65th pushes the oldest out; then the
 * oldest go until those kept fit MAX_LEAF_ENTRIES. The newest always stays.
 */
function keepLeaf(leaves: Map<number, DirEntry[]>, at: number, entries: DirEntry[]): void {
  if (leaves.size >= MAX_LEAVES) leaves.delete(leaves.keys().next().value!);
  leaves.set(at, entries);
  let total = 0;
  for (const l of leaves.values()) total += l.length;
  for (const [k, l] of leaves) {
    if (total <= MAX_LEAF_ENTRIES) return;
    if (k === at) continue;
    total -= l.length;
    leaves.delete(k);
  }
}

/** Header of the archive (zoom range, tile type). */
export async function archiveHeader(src: RangeSource): Promise<PmtilesHeader> {
  return (await open(src)).header;
}

/** The directory entry that holds this tile's bytes, or null when the archive has none. */
async function tileEntry(
  src: RangeSource,
  o: Opened,
  id: number,
  reads: LeafReads
): Promise<DirEntry | null> {
  let dir = o.root;
  for (let depth = 0; depth <= MAX_DEPTH; depth++) {
    const e = findEntry(dir, id);
    if (!e) return null;
    if (e.runLength > 0) return e;
    dir = await leaf(src, o, e, reads);
  }
  throw new PmtilesError('directory nesting too deep');
}

export interface ByteRange {
  offset: number;
  length: number;
}

/**
 * Two wanted ranges this close are read in one request, the bytes between them
 * included. A Protomaps build stores tiles in Hilbert order, so the tiles of
 * one map frame sit back to back or a tile or two apart (measured on build
 * 20261109: 12 of 12 back to back at z14, and gaps of about 180 KB at z12).
 * Reading a gap through costs bytes that R2 does not charge for; skipping it
 * costs a second request.
 */
export const MAX_READ_GAP = 262_144;
/** One merged read is at most this long. A single range longer than this is read alone. */
export const MAX_READ_BYTES = 2_097_152;
/**
 * One tile as stored: longer than this and the frame is refused before a tile
 * byte is asked for. It is the length of the longest joined read, so no read of
 * tiles is ever longer than MAX_READ_BYTES.
 */
export const MAX_TILE_BYTES = MAX_READ_BYTES;

/**
 * The fewest reads that cover every wanted range: sorted, repeats dropped,
 * neighbours joined while the gap between them is at most `maxGap` and the
 * joined read is at most `maxBytes`. Pure.
 */
export function planReads(
  wanted: readonly ByteRange[],
  maxGap = MAX_READ_GAP,
  maxBytes = MAX_READ_BYTES
): ByteRange[] {
  const sorted = [...wanted].sort((a, b) => a.offset - b.offset);
  const out: ByteRange[] = [];
  for (const r of sorted) {
    const cur = out[out.length - 1];
    if (cur) {
      const curEnd = cur.offset + cur.length;
      const end = Math.max(curEnd, r.offset + r.length);
      if (r.offset - curEnd <= maxGap && end - cur.offset <= maxBytes) {
        cur.length = end - cur.offset;
        continue;
      }
    }
    out.push({ offset: r.offset, length: r.length });
  }
  return out;
}

/**
 * These tiles' bytes, decompressed, in the order asked; null where the archive
 * has no tile (outside the region it was cut for; some builds leave out open
 * water and empty land as well). Tiles that sit near each other in the file
 * come from one read (planReads), and tiles that share one stored tile (a run)
 * are read and decompressed once.
 */
export async function readTiles(
  src: RangeSource,
  z: number,
  tiles: readonly (readonly [x: number, y: number])[]
): Promise<(Uint8Array | null)[]> {
  const o = await open(src);
  if (z < o.header.minZoom || z > o.header.maxZoom) return tiles.map(() => null);
  const leafReads: LeafReads = new Map();
  const entries = await Promise.all(
    tiles.map(([x, y]) => tileEntry(src, o, zxyToTileId(z, x, y), leafReads))
  );
  const at = (e: DirEntry): number => o.header.tileDataOffset + e.offset;
  // Tiles of one run share one entry: it is wanted once.
  const stored = [...new Set(entries)].filter((e): e is DirEntry => e !== null);
  // Half a frame is no frame: one tile over the limit refuses them all.
  const long = stored.find((e) => e.length > MAX_TILE_BYTES);
  if (long) throw new PmtilesError(`tile of ${long.length} bytes is over the limit`);
  const reads = planReads(stored.map((e) => ({ offset: at(e), length: e.length })));
  const chunks = await Promise.all(reads.map((r) => src.read(r.offset, r.length)));
  const done = new Map<DirEntry, Promise<Uint8Array>>();
  const bytesOf = (e: DirEntry): Promise<Uint8Array> => {
    const hit = done.get(e);
    if (hit) return hit;
    // The reads are in file order and each starts at a wanted tile, so the first
    // one that reaches this tile's end is the one that holds it.
    const i = reads.findIndex((r) => at(e) + e.length <= r.offset + r.length);
    const from = at(e) - reads[i]!.offset;
    const chunk = chunks[i]!;
    // The source answered with fewer bytes than asked: half a tile is no tile.
    if (from + e.length > chunk.length) throw new PmtilesError('short read');
    const p = decompress(
      chunk.subarray(from, from + e.length),
      o.header.tileCompression,
      MAX_TILE_UNPACKED_BYTES
    );
    done.set(e, p);
    return p;
  };
  return Promise.all(entries.map((e) => (e ? bytesOf(e) : null)));
}

/** One tile's bytes, decompressed, or null when the archive has no tile there. */
export async function readTile(
  src: RangeSource,
  z: number,
  x: number,
  y: number
): Promise<Uint8Array | null> {
  return (await readTiles(src, z, [[x, y]]))[0]!;
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
