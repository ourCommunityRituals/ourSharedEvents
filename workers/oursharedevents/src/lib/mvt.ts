// ─── Mapbox Vector Tile decoder — only what the street map draws ───────────────
//
// Decodes the protobuf of one vector tile (MVT 2.1,
// https://github.com/mapbox/vector-tile-spec/tree/master/2.1) into layers of
// features with tile-space geometry. Written here, not imported, so the Worker
// keeps h3-js as its only runtime library. Layers the caller does not ask for
// are skipped without decoding (a Protomaps tile carries buildings and points of
// interest the street map never draws).

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
    while (inner.more()) out.push(inner.varint());
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

/** Commands to points/lines/rings (spec §4.3). */
export function decodeGeometry(cmds: readonly number[]): [number, number][][] {
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
      if (cur && cur.length > 0) cur.push([cur[0]![0], cur[0]![1]]);
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
      cur.push([x, y]);
    }
  }
  return parts;
}

function readFeature(
  p: Pbf,
  end: number,
  keys: string[],
  values: (string | number | boolean | null)[]
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
    if (key !== undefined && val !== undefined && val !== null) props[key] = val;
  }
  return { type, props, geometry: decodeGeometry(geom) };
}

function readLayer(p: Pbf, end: number, wanted: ReadonlySet<string>): MvtLayer | null {
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
    } else if (field === 2 && wire === 2) featureSpans.push(p.bytes());
    else if (field === 3 && wire === 2) keys.push(p.string());
    else if (field === 4 && wire === 2) {
      const [s, e] = p.bytes();
      values.push(readValue(new Pbf(p.buf, s, e), e));
    } else if (field === 5 && wire === 0) extent = p.varint() || 4096;
    else p.skip(wire);
  }
  if (!wanted.has(name)) return null;
  const features = featureSpans.map(([s, e]) => readFeature(new Pbf(p.buf, s, e), e, keys, values));
  return { name, extent, features };
}

/** Decode the layers named in `wanted`; every other layer is skipped. */
export function decodeTile(bytes: Uint8Array, wanted: ReadonlySet<string>): MvtLayer[] {
  const p = new Pbf(bytes);
  const layers: MvtLayer[] = [];
  while (p.more()) {
    const tag = p.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 3 && wire === 2) {
      const [s, e] = p.bytes();
      const layer = readLayer(new Pbf(bytes, s, e), e, wanted);
      if (layer) layers.push(layer);
    } else p.skip(wire);
  }
  return layers;
}
