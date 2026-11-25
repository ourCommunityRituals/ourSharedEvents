#!/usr/bin/env node
/**
 * Copy ourEventRings' map frame into OSE: towns, corridor segments and nodes.
 *
 * OER (ourCommunityRituals/ourEventRings) is the source. OSE keeps a typed copy
 * at src/lib/ncr/oer-geographies.generated.ts, synced by hand (the OSE ADR-012
 * pattern), so the Worker never reads OER, the dataset or the network. Nothing
 * here is about people or scans: it is road research and town lines.
 *
 * Usage (from workers/oursharedevents):
 *   # in the OER clone, for each geography:
 *   #   python -m ncr corridors --geography geographies/<g> --out <OUT>/<g>
 *   node scripts/sync-oer-geographies.mjs --oer <OER clone> --segments <OUT> --ref <OER commit>
 *   node scripts/sync-oer-geographies.mjs ... --check   # exit 1 when the copy differs
 */
/* global process, console */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(HERE, '../src/lib/ncr/oer-geographies.generated.ts');
/** Douglas-Peucker tolerance for town outlines, in degrees (about 40 m). */
const TOWN_TOLERANCE = 0.0004;
/** Towns closer than this (degrees, about 60 m) count as touching for tints. */
const TOUCH = 0.0006;
/** Light tints the report defines for towns (lm-t0 to lm-t5). */
const TINTS = 6;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const r5 = (x) => Math.round(x * 1e5) / 1e5;

function perpDist(p, a, b) {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  let max = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, idx + 1), tol);
  return left.slice(0, -1).concat(simplify(pts.slice(idx), tol));
}

function outerRings(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0]);
  return [];
}

function touches(a, b) {
  for (const ra of a)
    for (const p of ra)
      for (const rb of b) {
        for (let i = 0; i + 1 < rb.length; i++)
          if (perpDist(p, rb[i], rb[i + 1]) < TOUCH) return true;
      }
  return false;
}

/** Point at distance-fraction t along a polyline, and t of the nearest point to p. */
function nearestT(line, p) {
  let best = { d: Infinity, s: 0 };
  let acc = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = len
      ? Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len))
        )
      : 0;
    const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { d, s: acc + t * len };
    acc += len;
  }
  return best.s;
}

function substring(line, s0, s1) {
  const [lo, hi] = s0 <= s1 ? [s0, s1] : [s1, s0];
  const out = [];
  let acc = 0;
  const at = (a, b, len, s) => {
    const t = len ? (s - acc) / len : 0;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + len >= lo && acc <= hi) {
      if (!out.length) out.push(at(a, b, len, Math.max(lo, acc)));
      out.push(at(a, b, len, Math.min(hi, acc + len)));
    }
    acc += len;
  }
  return out;
}

function build(oer, segmentsDir, ref) {
  const geographies = [];
  for (const id of readdirSync(join(oer, 'geographies')).sort()) {
    const dir = join(oer, 'geographies', id);
    const defsPath = join(dir, 'corridors.json');
    const segPath = join(segmentsDir, id, 'corridor-segments.geojson');
    if (!existsSync(defsPath)) continue;
    if (!existsSync(segPath))
      throw new Error(`no segments for ${id}: run python -m ncr corridors first`);
    const defs = JSON.parse(readFileSync(defsPath, 'utf8'));
    const segs = JSON.parse(readFileSync(segPath, 'utf8'));
    const juris = JSON.parse(readFileSync(join(dir, 'jurisdictions.geojson'), 'utf8'));

    const towns = juris.features
      .filter((f) => f.properties.kind === 'municipality')
      .map((f) => ({
        name: f.properties.name,
        rings: outerRings(f.geometry).map((r) =>
          simplify(r, TOWN_TOLERANCE).map(([x, y]) => [r5(x), r5(y)])
        ),
      }))
      .filter((t) => t.rings.some((r) => r.length >= 4));
    // Tints: largest-first greedy so no two touching towns share one.
    const size = (t) => t.rings.reduce((n, r) => n + r.length, 0);
    const order = [...towns].sort((a, b) => size(b) - size(a) || a.name.localeCompare(b.name));
    const tint = new Map();
    for (const t of order) {
      const used = new Set(
        order
          .filter((o) => tint.has(o.name) && touches(t.rings, o.rings))
          .map((o) => tint.get(o.name))
      );
      let c = 0;
      while (used.has(c) && c < TINTS - 1) c++;
      tint.set(t.name, c);
    }

    const lines = new Map(defs.corridors.map((c) => [c.id, c.line]));
    const nodeAt = new Map(defs.nodes.map((n) => [n.name, n.at]));
    const segments = [];
    const nodes = [];
    for (const f of segs.features) {
      const p = f.properties;
      if (p.layer === 'node') {
        nodes.push({
          id: p.id,
          name: p.name,
          kind: p.kind,
          at: f.geometry.coordinates.map(r5),
          hexagon: p.hexagon,
        });
        continue;
      }
      const line = lines.get(p.corridor);
      const a = nodeAt.get(p.from) ?? line[0];
      const b = nodeAt.get(p.to) ?? line[line.length - 1];
      segments.push({
        id: p.segment,
        corridor: p.corridor,
        name: p.name,
        from: p.from,
        to: p.to,
        tier: p.tier,
        straddles: !!p.straddles,
        line: substring(line, nearestT(line, a), nearestT(line, b)).map(([x, y]) => [r5(x), r5(y)]),
        hexagons: [...p.hexagons].sort(),
      });
    }
    geographies.push({
      id,
      name: defs.name,
      rules: defs.rules,
      towns: towns.map((t) => ({ ...t, tint: tint.get(t.name) })),
      segments,
      nodes,
    });
  }
  const body = JSON.stringify(geographies);
  return `// GENERATED by scripts/sync-oer-geographies.mjs from ourCommunityRituals/ourEventRings.
// Do not edit by hand: change OER, then sync (OSE ADR-012 pattern, OSE ADR-041).
// Road research and town lines only: no scans, counts or people.
import type { OerGeography } from './layer-stack';

export const OER_SOURCE = { repo: 'ourCommunityRituals/ourEventRings', ref: ${JSON.stringify(ref)} } as const;

export const OER_GEOGRAPHIES: readonly OerGeography[] = ${body};
`;
}

const oer = arg('--oer');
const segmentsDir = arg('--segments');
const ref = arg('--ref') ?? 'unknown';
if (!oer || !segmentsDir) {
  console.error(
    'usage: sync-oer-geographies.mjs --oer <OER clone> --segments <dir> --ref <sha> [--check]'
  );
  process.exit(2);
}
const out = build(resolve(oer), resolve(segmentsDir), ref);
if (process.argv.includes('--check')) {
  const cur = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : '';
  if (cur !== out) {
    console.error('oer-geographies.generated.ts differs from OER; run without --check and commit');
    process.exit(1);
  }
  console.log('in sync');
} else {
  writeFileSync(TARGET, out);
  console.log(`wrote ${TARGET} (${out.length} bytes)`);
}
