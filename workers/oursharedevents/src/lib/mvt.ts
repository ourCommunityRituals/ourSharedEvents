// ─── Mapbox Vector Tile decoder — only what the street map draws ───────────────
//
// Decodes the protobuf of one vector tile (MVT 2.1,
// https://github.com/mapbox/vector-tile-spec/tree/master/2.1) into layers of
// features with tile-space geometry. Written here, not imported, so the Worker
// keeps h3-js as its only runtime library. Layers the caller does not ask for
// are skipped without decoding (a Protomaps tile carries buildings and points of
// interest the street map never draws).
//
// WHAT IT TRUSTS. Nothing the tile says about how much it holds. lib/pmtiles.ts
// limits a tile's bytes; this file limits what those bytes may become. A byte
// of tile can ask for far more than a byte of memory: a point is two bytes in
// the tile and 76 once decoded (below), and a ring's closing point costs the
// tile one byte. So the things a tile can multiply are counted as they are
// read (layers, features, points, properties, the integers of one packed
// field), and a tile past a limit is refused with an MvtError before the next
// one is held. The street map turns that into hexagons only. Skipped bytes
// (an unwanted layer, an unknown field) are walked and never held, so they
// need no count: the tile's byte limit is their limit.

export type Props = Record<string, string | number | boolean>;

export interface MvtFeature {
  /** 1 point, 2 line, 3 polygon. */
  type: number;
  props: Props;
  /** Points, lines or rings, in tile units (0..extent). */
  geometry: [number, number][][];
}

export interface MvtLayer {
  name: string;
  extent: number;
  features: MvtFeature[];
}

export class MvtError extends Error {}

/** What a decode has read, or may still read, of each kind it counts. */
export interface DecodeCounts {
  /** Features, counted as each is found in a layer. */
  features: number;
  /** Points of geometry, a ring's closing point included. */
  points: number;
  /** Property keys and values read, and properties set on a feature. */
  props: number;
}

/**
 * The most one tile may hold of each kind (street-map CCR 2026-11-15, R2).
 *
 * Where the numbers stand. The largest real tile read so far was 0.17 MiB
 * unpacked, about 178,000 bytes (build 20261109, a workstation run of a few
 * frames, will-it-work CCR 2026-11-15). A point is two bytes of tile at the
 * least, and so is a key, a value or a property, so that tile could hold at
 * most 89,000 of either if it held nothing else: 150,000 is that with two
 * thirds over. A feature the map can draw is nine bytes at the least (its
 * type, and a geometry of one point), so that tile could hold under 20,000:
 * 30,000 is that with a half over.
 *
 * What they cost. Measured in Node 24 on a workstation, 2026-11-15: 76 bytes a
 * decoded point, 145 a feature with nothing in it, 16 to 49 a property. So a
 * tile at every limit is about 11 MB of points, 4 MB of features and up to
 * 7 MB of properties. With no limit, a tile of the 4 MiB the reader allows
 * could ask for about 4 million points, some 300 MB.
 *
 * What is not known. No real tile has been counted, only weighed, and nothing
 * here was measured in a Worker: no archive is loaded. The archive check
 * (scripts/street-map-archive/check.ts) draws its places through this code and
 * reports a place whose tile passes a limit as an error, so a limit set too low
 * shows at the load.
 */
export const TILE_LIMITS: Readonly<DecodeCounts> = Object.freeze({
  features: 30_000,
  points: 150_000,
  props: 150_000,
});

/**
 * Wanted layers decoded from one tile at most. A Protomaps tile has one layer
 * of each name and the street map asks for three; each layer decoded is three
 * lists and an object whether or not it holds anything.
 */
export const MAX_TILE_LAYERS = 16;

/**
 * Integers read from one packed field (a feature's geometry or its tags) at
 * most. They are held as a list only until the feature is built, at 8 bytes
 * each, so this is 3.6 MB for a moment. A geometry inside the point limit has
 * at most three integers a point (a command and two steps) and tags inside the
 * property limit have two a property, so no field a tile inside its limits
 * holds is refused by this.
 */
export const MAX_PACKED_VALUES = 3 * TILE_LIMITS.points;

/**
 * Counts what one tile's decode reads, and refuses the read that passes a
 * limit: the tile's own (TILE_LIMITS), or what the caller has `left` for all
 * the tiles it decodes together, which is counted down as they are read.
 */
class Meter {
  private readonly used: DecodeCounts = { features: 0, points: 0, props: 0 };
  constructor(private readonly left?: DecodeCounts) {}
  take(kind: keyof DecodeCounts): void {
    if (++this.used[kind] > TILE_LIMITS[kind]) throw new MvtError(`too many ${kind} in one tile`);
    if (this.left && --this.left[kind] < 0) throw new MvtError(`too many ${kind} in one frame`);
  }
}

class Pbf {
  pos: number;
  constructor(
    readonly buf: Uint8Array,
    start = 0,
    readonly end = buf.length
  ) {
    this.pos = start;
  }
  more(): boolean {
    return this.pos < this.end;
  }
  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end) throw new MvtError('truncated varint');
      const b = this.buf[this.pos++]!;
      // Past 2^53 precision is lost; MVT values the map uses stay far below.
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return result;
      shift += 7;
      if (shift > 63) throw new MvtError('varint too long');
    }
  }
  /** Length-delimited field: returns [start, end) and moves past it. */
  bytes(): [number, number] {
    const len = this.varint();
    const start = this.pos;
    const end = start + len;
    if (end > this.end) throw new MvtError('field past end');
    this.pos = end;
    return [start, end];
  }
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.pos += 4;
    else throw new MvtError(`unsupported wire type ${wire}`);
    if (this.pos > this.end) throw new MvtError('field past end');
  }
  string(): string {
    const [s, e] = this.bytes();
    return new TextDecoder().decode(this.buf.subarray(s, e));
  }
  packed(): number[] {
    const [s, e] = this.bytes();
    const inner = new Pbf(this.buf, s, e);
    const out: number[] = [];
    while (inner.more()) {
      if (out.length >= MAX_PACKED_VALUES) throw new MvtError('too many values in one field');
      out.push(inner.varint());
    }
    return out;
  }
}

const zigzag = (n: number): number => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function readValue(p: Pbf, end: number): string | number | boolean | null {
  let value: string | number | boolean | null = null;
  const view = new DataView(p.buf.buffer, p.buf.byteOffset, p.buf.byteLength);
  while (p.pos < end) {
    const tag = p.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) value = p.string();
    else if (field === 2 && wire === 5) {
      value = view.getFloat32(p.pos, true);
      p.pos += 4;
    } else if (field === 3 && wire === 1) {
      value = view.getFloat64(p.pos, true);
      p.pos += 8;
    } else if ((field === 4 || field === 5) && wire === 0) value = p.varint();
    else if (field === 6 && wire === 0) value = zigzag(p.varint());
    else if (field === 7 && wire === 0) value = p.varint() !== 0;
    else p.skip(wire);
  }
  return value;
}

/** Commands to points/lines/rings (spec §4.3), held to one tile's point limit. */
export function decodeGeometry(cmds: readonly number[]): [number, number][][] {
  return geometry(cmds, new Meter());
}

function geometry(cmds: readonly number[], meter: Meter): [number, number][][] {
  const parts: [number, number][][] = [];
  let x = 0;
  let y = 0;
  let cur: [number, number][] | null = null;
  let i = 0;
  while (i < cmds.length) {
    const ci = cmds[i++]!;
    const cmd = ci & 7;
    const count = ci >> 3;
    if (cmd === 7) {
      if (cur && cur.length > 0) {
        // One byte of tile, one more point held: counted like any other.
        meter.take('points');
        cur.push([cur[0]![0], cur[0]![1]]);
      }
      continue;
    }
    if (cmd !== 1 && cmd !== 2) throw new MvtError(`unknown geometry command ${cmd}`);
    for (let k = 0; k < count; k++) {
      if (i + 1 >= cmds.length) throw new MvtError('truncated geometry');
      x += zigzag(cmds[i++]!);
      y += zigzag(cmds[i++]!);
      if (cmd === 1) {
        cur = [];
        parts.push(cur);
      }
      if (!cur) throw new MvtError('LineTo before MoveTo');
      meter.take('points');
      cur.push([x, y]);
    }
  }
  return parts;
}

function readFeature(
  p: Pbf,
  end: number,
  keys: string[],
  values: (string | number | boolean | null)[],
  meter: Meter
): MvtFeature {
  let type = 0;
  // Stryker disable next-line ArrayDeclaration: tags is read only by the pair loop below, and a one-element default fails k + 1 < 1 just as [] fails k + 1 < 0, so no pair is ever read.
  let tags: number[] = [];
  let geom: number[] = [];
  while (p.pos < end) {
    const tag = p.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 2 && wire === 2) tags = p.packed();
    else if (field === 3 && wire === 0) type = p.varint();
    else if (field === 4 && wire === 2) geom = p.packed();
    else p.skip(wire);
  }
  const props: Props = {};
  // Stryker disable next-line ArithmeticOperator: k - 1 < length adds only passes where tags[k] or tags[k + 1] is past the end (undefined), so the key or value lookup is undefined and no prop is set.
  for (let k = 0; k + 1 < tags.length; k += 2) {
    const key = keys[tags[k]!];
    const val = values[tags[k + 1]!];
    if (key !== undefined && val !== undefined && val !== null) {
      meter.take('props');
      props[key] = val;
    }
  }
  return { type, props, geometry: geometry(geom, meter) };
}

function readLayer(
  p: Pbf,
  end: number,
  wanted: ReadonlySet<string>,
  meter: Meter
): MvtLayer | null {
  let name = '';
  let extent = 4096;
  const keys: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  const featureSpans: [number, number][] = [];
  while (p.pos < end) {
    const tag = p.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      name = p.string();
      // The name comes first in every writer we know; stop early when unwanted.
      if (!wanted.has(name)) {
        p.pos = end;
        return null;
      }
    } else if (field === 2 && wire === 2) {
      // Counted here, where its place in the tile is kept, and not when it is
      // decoded: a layer that names itself last has every feature kept by then.
      meter.take('features');
      featureSpans.push(p.bytes());
    } else if (field === 3 && wire === 2) {
      meter.take('props');
      keys.push(p.string());
    } else if (field === 4 && wire === 2) {
      meter.take('props');
      const [s, e] = p.bytes();
      values.push(readValue(new Pbf(p.buf, s, e), e));
    } else if (field === 5 && wire === 0) extent = p.varint() || 4096;
    else p.skip(wire);
  }
  if (!wanted.has(name)) return null;
  const features = featureSpans.map(([s, e]) =>
    readFeature(new Pbf(p.buf, s, e), e, keys, values, meter)
  );
  return { name, extent, features };
}

/**
 * Decode the layers named in `wanted`; every other layer is skipped. Throws an
 * MvtError on a damaged tile and on one that holds more than TILE_LIMITS,
 * MAX_TILE_LAYERS or MAX_PACKED_VALUES allow.
 *
 * `left` is what the caller may still decode across the tiles it reads
 * together (lib/street-map.ts, FRAME_LIMITS). It is counted down by what this
 * tile reads, and the read that would take it under zero is refused.
 */
export function decodeTile(
  bytes: Uint8Array,
  wanted: ReadonlySet<string>,
  left?: DecodeCounts
): MvtLayer[] {
  const meter = new Meter(left);
  const p = new Pbf(bytes);
  const layers: MvtLayer[] = [];
  while (p.more()) {
    const tag = p.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 3 && wire === 2) {
      const [s, e] = p.bytes();
      const layer = readLayer(new Pbf(bytes, s, e), e, wanted, meter);
      if (layer) {
        if (layers.length >= MAX_TILE_LAYERS) throw new MvtError('too many layers in one tile');
        layers.push(layer);
      }
    } else p.skip(wire);
  }
  return layers;
}
