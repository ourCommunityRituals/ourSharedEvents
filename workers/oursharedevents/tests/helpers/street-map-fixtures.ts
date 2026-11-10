/**
 * Test-only writers for the street map's two formats: a Mapbox Vector Tile
 * (protobuf) and a PMTiles v3 archive. Small and independent of the readers in
 * src/lib/mvt.ts and src/lib/pmtiles.ts, except for the tile id, which is
 * pinned on its own by the spec's published values in pmtiles.spec.ts.
 */
import { zxyToTileId, type RangeBucket, type RangeSource } from '../../src/lib/pmtiles';
import { frameForCells, tilesFor } from '../../src/lib/street-map';

// ── protobuf ─────────────────────────────────────────────────────────────────

export function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}

const zz = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const key = (field: number, wire: number) => varint(field * 8 + wire);
const lenField = (field: number, bytes: number[]) => [
  ...key(field, 2),
  ...varint(bytes.length),
  ...bytes,
];
const str = (s: string) => [...new TextEncoder().encode(s)];
const packed = (field: number, nums: number[]) => lenField(field, nums.flatMap(varint));

export type Pt = [number, number];

/** Geometry commands for a point, a line or a closed ring, in tile units. */
export function geom(type: 1 | 2 | 3, parts: Pt[][]): number[] {
  const out: number[] = [];
  let cx = 0;
  let cy = 0;
  for (const part of parts) {
    const pts = type === 3 ? part.slice(0, -1) : part;
    const [first, ...rest] = pts;
    out.push((1 << 3) | 1, zz(first![0] - cx), zz(first![1] - cy));
    cx = first![0];
    cy = first![1];
    if (rest.length) {
      out.push((rest.length << 3) | 2);
      for (const [x, y] of rest) {
        out.push(zz(x - cx), zz(y - cy));
        cx = x;
        cy = y;
      }
    }
    if (type === 3) out.push((1 << 3) | 7);
  }
  return out;
}

export interface FixtureFeature {
  type: 1 | 2 | 3;
  props: Record<string, string | number | boolean>;
  parts: Pt[][];
}

export interface FixtureLayer {
  name: string;
  extent?: number;
  features: FixtureFeature[];
}

function valueMsg(v: string | number | boolean): number[] {
  if (typeof v === 'string') return lenField(1, str(v));
  if (typeof v === 'boolean') return [...key(7, 0), v ? 1 : 0];
  if (Number.isInteger(v) && v >= 0) return [...key(5, 0), ...varint(v)];
  if (Number.isInteger(v)) return [...key(6, 0), ...varint(zz(v))];
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...key(3, 1), ...b];
}

export function mvtTile(layers: FixtureLayer[]): Uint8Array {
  const out: number[] = [];
  for (const l of layers) {
    const keys: string[] = [];
    const values: (string | number | boolean)[] = [];
    const idx = <T>(arr: T[], v: T) => {
      const i = arr.indexOf(v);
      return i >= 0 ? i : arr.push(v) - 1;
    };
    const feats = l.features.map((f) => {
      const tags = Object.entries(f.props).flatMap(([k, v]) => [idx(keys, k), idx(values, v)]);
      return lenField(2, [
        ...packed(2, tags),
        ...key(3, 0),
        f.type,
        ...packed(4, geom(f.type, f.parts)),
      ]);
    });
    const body = [
      ...key(15, 0),
      2,
      ...lenField(1, str(l.name)),
      ...feats.flat(),
      ...keys.flatMap((k) => lenField(3, str(k))),
      ...values.flatMap((v) => lenField(4, valueMsg(v))),
      ...key(5, 0),
      ...varint(l.extent ?? 4096),
    ];
    out.push(...lenField(3, body));
  }
  return new Uint8Array(out);
}

// ── PMTiles ──────────────────────────────────────────────────────────────────

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

interface Entry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

function dirBytes(entries: Entry[]): number[] {
  const out = [...varint(entries.length)];
  let last = 0;
  for (const e of entries) {
    out.push(...varint(e.tileId - last));
    last = e.tileId;
  }
  for (const e of entries) out.push(...varint(e.runLength));
  for (const e of entries) out.push(...varint(e.length));
  for (const e of entries) out.push(...varint(e.offset + 1));
  return out;
}

function setU64(view: DataView, at: number, v: number): void {
  view.setUint32(at, v % 2 ** 32, true);
  view.setUint32(at + 4, Math.floor(v / 2 ** 32), true);
}

export interface FixtureTile {
  z: number;
  x: number;
  y: number;
  data: Uint8Array;
}

/**
 * A PMTiles v3 archive holding these tiles. `leaf: true` puts every entry in
 * one leaf directory behind the root, as large builds do.
 */
export async function pmtilesArchive(
  tiles: FixtureTile[],
  opts: { gzip?: boolean; leaf?: boolean; minZoom?: number; maxZoom?: number } = {}
): Promise<Uint8Array> {
  const comp = async (b: Uint8Array) => (opts.gzip ? gzip(b) : b);
  const sorted = [...tiles]
    .map((t) => ({ ...t, id: zxyToTileId(t.z, t.x, t.y) }))
    .sort((a, b) => a.id - b.id);
  const data: number[] = [];
  const entries: Entry[] = [];
  for (const t of sorted) {
    const bytes = await comp(t.data);
    entries.push({ tileId: t.id, offset: data.length, length: bytes.length, runLength: 1 });
    data.push(...bytes);
  }
  let root: Uint8Array;
  let leaves = new Uint8Array(0);
  if (opts.leaf && entries.length) {
    leaves = await comp(new Uint8Array(dirBytes(entries)));
    root = await comp(
      new Uint8Array(
        dirBytes([{ tileId: entries[0]!.tileId, offset: 0, length: leaves.length, runLength: 0 }])
      )
    );
  } else {
    root = await comp(new Uint8Array(dirBytes(entries)));
  }
  const rootAt = 127;
  const leafAt = rootAt + root.length;
  const dataAt = leafAt + leaves.length;
  const out = new Uint8Array(dataAt + data.length);
  out.set(new TextEncoder().encode('PMTiles'), 0);
  out[7] = 3;
  const view = new DataView(out.buffer);
  setU64(view, 8, rootAt);
  setU64(view, 16, root.length);
  setU64(view, 24, leafAt); // metadata: none
  setU64(view, 32, 0);
  setU64(view, 40, leafAt);
  setU64(view, 48, leaves.length);
  setU64(view, 56, dataAt);
  setU64(view, 64, data.length);
  out[97] = opts.gzip ? 2 : 1;
  out[98] = opts.gzip ? 2 : 1;
  out[99] = 1;
  out[100] = opts.minZoom ?? 0;
  out[101] = opts.maxZoom ?? 15;
  out.set(root, rootAt);
  out.set(leaves, leafAt);
  out.set(data, dataAt);
  return out;
}

let sourceSeq = 0;

/** An in-memory RangeSource with a fresh cache key each time. */
export function memSource(bytes: Uint8Array): RangeSource & { reads: [number, number][] } {
  const reads: [number, number][] = [];
  return {
    key: `mem:${++sourceSeq}`,
    reads,
    async read(offset, length) {
      reads.push([offset, length]);
      return bytes.slice(offset, offset + length);
    },
  };
}

/** A fake R2 bucket holding one object; records every get. */
export function fakeBucket(
  name: string,
  bytes: Uint8Array,
  opts: { delayMs?: number } = {}
): RangeBucket & { gets: { key: string; range?: { offset: number; length: number } }[] } {
  const gets: { key: string; range?: { offset: number; length: number } }[] = [];
  return {
    gets,
    async get(k, o) {
      gets.push({ key: k, range: o?.range });
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (k !== name) return null;
      const off = o?.range?.offset ?? 0;
      const len = o?.range?.length ?? bytes.length;
      const slice = bytes.slice(off, off + len);
      return { arrayBuffer: async () => slice.buffer };
    },
  };
}

/**
 * What a scripted bucket does with one get. `ok` answers; the rest are the ways
 * a read over the network goes wrong: the call rejects, R2 says the object is
 * not there, the answer holds fewer bytes than asked, the body breaks after the
 * answer started, or the answer is late.
 */
export type GetStep =
  'ok' | 'throw' | 'missing' | 'body-fails' | { shortTo: number } | { delayMs: number };

/**
 * A fake R2 bucket holding one object, whose every get is decided by
 * `plan(n, range)`, n counting gets from 0. Records every get.
 */
export function scriptedBucket(
  name: string,
  bytes: Uint8Array,
  plan: (n: number, range?: { offset: number; length: number }) => GetStep
): RangeBucket & { gets: { key: string; range?: { offset: number; length: number } }[] } {
  const gets: { key: string; range?: { offset: number; length: number } }[] = [];
  return {
    gets,
    async get(k, o) {
      const step = plan(gets.length, o?.range);
      gets.push({ key: k, range: o?.range });
      if (step === 'throw') throw new TypeError('Network connection lost.');
      if (step === 'missing' || k !== name) return null;
      if (typeof step === 'object' && 'delayMs' in step) {
        await new Promise((r) => setTimeout(r, step.delayMs));
      }
      if (step === 'body-fails') {
        return {
          arrayBuffer: async () => {
            throw new TypeError('The body stream was cut short.');
          },
        };
      }
      const off = o?.range?.offset ?? 0;
      const len = o?.range?.length ?? bytes.length;
      const asked =
        typeof step === 'object' && 'shortTo' in step ? Math.min(len, step.shortTo) : len;
      const slice = bytes.slice(off, off + asked);
      return { arrayBuffer: async () => slice.buffer };
    },
  };
}

// ── a planet-sized layout ───────────────────────────────────────────────────
//
// The whole-planet Protomaps build is about 138.5 GB: far more tiles than fit
// in the root directory, so every tile sits behind leaf directories, and tile
// bytes start many gigabytes into the file. No test holds such a file. A sparse
// file gives the reader the same layout: a few byte ranges at their true
// offsets, zeros everywhere else.

export interface SparseFile {
  segments: { at: number; bytes: Uint8Array }[];
}

function sparseRead(file: SparseFile, offset: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (const s of file.segments) {
    const from = Math.max(offset, s.at);
    const to = Math.min(offset + length, s.at + s.bytes.length);
    if (from < to) out.set(s.bytes.subarray(from - s.at, to - s.at), from - offset);
  }
  return out;
}

/** A RangeSource over a sparse file, with a fresh cache key each time. */
export function sparseSource(file: SparseFile): RangeSource & { reads: [number, number][] } {
  const reads: [number, number][] = [];
  return {
    key: `sparse:${++sourceSeq}`,
    reads,
    async read(offset, length) {
      reads.push([offset, length]);
      return sparseRead(file, offset, length);
    },
  };
}

/** A fake R2 bucket holding one sparse object; records every get. */
export function sparseBucket(
  name: string,
  file: SparseFile
): RangeBucket & { gets: { key: string; range?: { offset: number; length: number } }[] } {
  const gets: { key: string; range?: { offset: number; length: number } }[] = [];
  return {
    gets,
    async get(k, o) {
      gets.push({ key: k, range: o?.range });
      if (k !== name || !o?.range) return null;
      const slice = sparseRead(file, o.range.offset, o.range.length);
      return { arrayBuffer: async () => slice.buffer as ArrayBuffer };
    },
  };
}

export interface PlanetTile extends FixtureTile {
  /** Where the tile's bytes start, inside the tile data section. */
  at: number;
  /** Tiles in a row that share these bytes, as open water does. Default 1. */
  run?: number;
}

export interface PlanetDir {
  /** 1: holds pointers to level-2 directories. 2: holds tile entries. */
  level: 1 | 2;
  /** Absolute offset in the file. */
  at: number;
  length: number;
  /** Tile entries (level 2) or pointers (level 1) it holds. */
  entries: number;
}

/**
 * A gzip PMTiles v3 archive laid out as a planet build is: the root holds only
 * pointers, and every tile is two leaf directories down. `leafSize` tile
 * entries go in each level-2 directory and `fanOut` pointers in each level-1
 * directory. `dirGap` leaves that many bytes between leaf directories.
 */
export async function planetArchive(
  tiles: PlanetTile[],
  opts: { leafSize: number; fanOut: number; leafAt: number; dataAt: number; dirGap?: number }
): Promise<{ file: SparseFile; dirs: PlanetDir[]; stored: Map<PlanetTile, [number, number]> }> {
  const sorted = [...tiles]
    .map((t) => ({ t, id: zxyToTileId(t.z, t.x, t.y) }))
    .sort((a, b) => a.id - b.id);
  const segments: SparseFile['segments'] = [];
  const stored = new Map<PlanetTile, [number, number]>();
  const entries: Entry[] = [];
  for (const { t, id } of sorted) {
    const bytes = await gzip(t.data);
    segments.push({ at: opts.dataAt + t.at, bytes });
    stored.set(t, [opts.dataAt + t.at, bytes.length]);
    entries.push({ tileId: id, offset: t.at, length: bytes.length, runLength: t.run ?? 1 });
  }
  const dirs: PlanetDir[] = [];
  let next = 0;
  // Write one directory into the leaf section; return the pointer to it.
  const put = async (level: 1 | 2, of: Entry[]): Promise<Entry> => {
    const bytes = await gzip(new Uint8Array(dirBytes(of)));
    const offset = next;
    segments.push({ at: opts.leafAt + offset, bytes });
    dirs.push({ level, at: opts.leafAt + offset, length: bytes.length, entries: of.length });
    next += bytes.length + (opts.dirGap ?? 0);
    return { tileId: of[0]!.tileId, offset, length: bytes.length, runLength: 0 };
  };
  const chunk = <T>(all: T[], n: number): T[][] =>
    Array.from({ length: Math.ceil(all.length / n) }, (_, i) => all.slice(i * n, i * n + n));
  const level2: Entry[] = [];
  for (const c of chunk(entries, opts.leafSize)) level2.push(await put(2, c));
  const level1: Entry[] = [];
  for (const c of chunk(level2, opts.fanOut)) level1.push(await put(1, c));
  const root = await gzip(new Uint8Array(dirBytes(level1)));

  const head = new Uint8Array(127 + root.length);
  head.set(new TextEncoder().encode('PMTiles'), 0);
  head[7] = 3;
  const view = new DataView(head.buffer);
  setU64(view, 8, 127);
  setU64(view, 16, root.length);
  setU64(view, 40, opts.leafAt);
  setU64(view, 48, next);
  setU64(view, 56, opts.dataAt);
  head[97] = 2;
  head[98] = 2;
  head[99] = 1;
  head[100] = 0;
  head[101] = 15;
  head.set(root, 127);
  segments.push({ at: 0, bytes: head });
  return { file: { segments }, dirs, stored };
}

// ── a street map for real cells ─────────────────────────────────────────────

/** A tile for every z/x/y the frame reads: a highway across the middle, a
 * minor road, a lake polygon, and one town. */
export function tilesForCells(
  cells: string[],
  extra: (x: number, y: number) => FixtureLayer[] = () => []
) {
  const f = frameForCells(cells);
  const r = tilesFor(f, 0, 15);
  const out = [];
  for (let x = r.xMin; x <= r.xMax; x++) {
    for (let y = r.yMin; y <= r.yMax; y++) {
      out.push({
        z: r.z,
        x,
        y,
        data: mvtTile([
          {
            name: 'roads',
            features: [
              {
                type: 2,
                props: { kind: 'highway' },
                parts: [
                  [
                    [0, 2048],
                    [4096, 2048],
                  ],
                ],
              },
              {
                type: 2,
                props: { kind: 'minor_road' },
                parts: [
                  [
                    [2048, 0],
                    [2048, 4096],
                  ],
                ],
              },
              {
                type: 2,
                props: { kind: 'path' },
                parts: [
                  [
                    [0, 0],
                    [4096, 4096],
                  ],
                ],
              },
            ],
          },
          {
            name: 'water',
            features: [
              {
                type: 3,
                props: { kind: 'lake' },
                parts: [
                  [
                    [0, 0],
                    [600, 0],
                    [600, 600],
                    [0, 600],
                    [0, 0],
                  ],
                ],
              },
            ],
          },
          {
            name: 'buildings',
            features: [
              {
                type: 3,
                props: { kind: 'building' },
                parts: [
                  [
                    [9, 9],
                    [19, 9],
                    [19, 19],
                    [9, 9],
                  ],
                ],
              },
            ],
          },
          ...extra(x, y),
        ]),
      });
    }
  }
  return { f, r, tiles: out };
}
