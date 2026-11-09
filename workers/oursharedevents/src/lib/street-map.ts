// ─── Street map under the hexagons — server-drawn SVG ──────────────────────────
//
// The third map layer in docs/positioning/MAPPING-COST-STRUCTURE.md: a street
// map drawn UNDER the H3 res-7 hexagons, so a reader can see where the areas
// are. Owner choice 2026-11-09: drawn by the Worker as inline SVG (hex-map
// standard rule 10), not an interactive map in the browser.
//
// HOW. The Worker reads the few vector tiles that cover the frame from a
// self-hosted OpenStreetMap archive (Protomaps build, PMTiles) in R2
// (`MAP_TILES`), decodes water, roads and town names (lib/mvt.ts) and draws them
// as SVG paths in the same Web Mercator frame as the hexagons. No JavaScript, no
// browser request, no outside company sees a visitor; the page's CSP is
// unchanged.
//
// NEVER WHO. The frame comes from the drawn cell ids alone (`cellToBoundary`),
// exactly as the hexagons do; no event lat/lon and no viewer location is read.
// The server, not the visitor, chooses which tiles to read, so no tile request
// says what a person looked at, and nothing here logs.
//
// FAIL SOFT. No binding, no archive, a damaged tile, or a slow read: the map is
// drawn as before, hexagons only. The street layer is never a reason the page
// fails.

import { cellToBoundary, cellToLatLng } from 'h3-js';
import {
  archiveHeader,
  r2Source,
  readTile,
  type RangeBucket,
  type RangeSource,
} from './pmtiles.js';
import { decodeTile, type MvtLayer } from './mvt.js';
import { escapeHtml } from './html-escape.js';

export const MAP_W = 600;
export const MAP_H = 360;

/** The archive read when `MAP_TILES_ARCHIVE` is not set (the proof's region). */
export const DEFAULT_ARCHIVE = 'chicago-region.pmtiles';
const ARCHIVE_NAME = /^[a-z0-9][a-z0-9._-]{0,80}\.pmtiles$/;

/** Tiles read per map at most; past it the zoom steps out. */
export const MAX_TILES = 12;
/** Finest zoom read. z15 adds detail a 600-wide map cannot show. */
export const MAX_ZOOM = 14;
/** Path points drawn at most, so a dense city stays a small page. */
export const MAX_POINTS = 9000;
/** Town names drawn at most. */
export const MAX_LABELS = 6;
/** A street layer slower than this is dropped; the hexagons draw alone. */
export const STREET_TIMEOUT_MS = 1500;

const LABEL_PX = 22;

export interface StreetMapEnv {
  MAP_TILES?: RangeBucket;
  MAP_TILES_ARCHIVE?: string;
}

/** A Web Mercator frame: world units (0..1) to SVG units. */
export interface MapFrame {
  w: number;
  h: number;
  /** SVG units per world unit. */
  scale: number;
  /** World coordinates of the top-left corner. */
  x0: number;
  y0: number;
}

export interface StreetLayer {
  /** The cells this layer was drawn for; it is used only with exactly these. */
  cellsKey: string;
  /** `<g>` markup to place first inside the map's `<svg>`. */
  svg: string;
}

/** Under the 400-char inline budget (ADR-008 design check); tokens only. */
export const STREET_STYLE =
  '<style>.as-l{fill:var(--surface)}.as-w{fill:var(--info);opacity:.3}.as-v,.as-r{fill:none;stroke-linecap:round}.as-v{stroke:var(--info);opacity:.5;stroke-width:2}.as-r{stroke:var(--border-strong)}.as-1{stroke:var(--border);stroke-width:1.2}.as-2{stroke-width:2.5}.as-3{stroke-width:4}.as-t{fill:var(--text-muted);font:600 22px system-ui;paint-order:stroke;stroke:var(--bg);stroke-width:4}</style>';

export function cellsKey(cells: readonly string[]): string {
  return [...cells].sort().join(',');
}

/** Latitude/longitude to Web Mercator world units, origin top-left. */
export function toWorld(lat: number, lng: number): [number, number] {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

/** Fit the cells' outlines into a w × h frame with padding, centred. */
export function frameForCells(
  cells: readonly string[],
  w = MAP_W,
  h = MAP_H,
  pad = 0.08
): MapFrame {
  const pts = cells.flatMap((c) => cellToBoundary(c).map(([lat, lng]) => toWorld(lat, lng)));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const spanX = Math.max(xMax - xMin, 1e-9);
  const spanY = Math.max(yMax - yMin, 1e-9);
  const scale = Math.min((w * (1 - 2 * pad)) / spanX, (h * (1 - 2 * pad)) / spanY);
  return {
    w,
    h,
    scale,
    x0: (xMin + xMax) / 2 - w / 2 / scale,
    y0: (yMin + yMax) / 2 - h / 2 / scale,
  };
}

export function project(f: MapFrame, lat: number, lng: number): [number, number] {
  const [x, y] = toWorld(lat, lng);
  return [(x - f.x0) * f.scale, (y - f.y0) * f.scale];
}

export interface TileRange {
  z: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function rangeAt(f: MapFrame, z: number): TileRange {
  const n = 2 ** z;
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v * n)));
  return {
    z,
    xMin: clamp(f.x0),
    xMax: clamp(f.x0 + f.w / f.scale),
    yMin: clamp(f.y0),
    yMax: clamp(f.y0 + f.h / f.scale),
  };
}

const tileCount = (r: TileRange) => (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);

/**
 * The zoom whose tiles are about 256 SVG units across in this frame, stepped
 * out until the frame needs at most MAX_TILES tiles.
 */
export function tilesFor(f: MapFrame, minZoom = 0, maxZoom = MAX_ZOOM): TileRange {
  let z = Math.round(Math.log2(f.scale / 256));
  z = Math.max(minZoom, Math.min(Math.min(maxZoom, MAX_ZOOM), z));
  let r = rangeAt(f, z);
  while (tileCount(r) > MAX_TILES && z > minZoom) r = rangeAt(f, --z);
  return r;
}

export interface DecodedTile {
  x: number;
  y: number;
  layers: MvtLayer[];
}

const WANTED = new Set(['water', 'roads', 'places']);

/** Road classes, finest first. Older Protomaps builds say medium_road. */
const ROAD_CLASS: Record<string, 'r1' | 'r2' | 'r3'> = {
  minor_road: 'r1',
  medium_road: 'r2',
  major_road: 'r2',
  highway: 'r3',
};

interface Label {
  text: string;
  x: number;
  y: number;
  rank: number;
}

type Box = [number, number, number, number];

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Draw the decoded tiles as the street layer. Pure: same input, same string.
 * `cells` are the hexagons drawn on top; town names keep clear of their numbers.
 */
export function drawStreets(
  f: MapFrame,
  z: number,
  tiles: readonly DecodedTile[],
  cells: readonly string[] = []
): string {
  const n = 2 ** z;
  const buckets: Record<'w' | 'v' | 'r1' | 'r2' | 'r3', string[][]> = {
    w: [],
    v: [],
    r1: [],
    r2: [],
    r3: [],
  };
  const labels: Label[] = [];
  const margin = 12;

  for (const t of tiles) {
    for (const layer of t.layers) {
      const k = f.scale / (n * layer.extent);
      const ox = (t.x / n - f.x0) * f.scale;
      const oy = (t.y / n - f.y0) * f.scale;
      for (const feat of layer.features) {
        if (layer.name === 'places') {
          if (feat.type !== 1 || feat.props.kind !== 'locality') continue;
          const name = feat.props['name:en'] ?? feat.props.name;
          const pt = feat.geometry[0]?.[0];
          if (typeof name !== 'string' || !name || !pt) continue;
          const rank = Number(feat.props.population_rank ?? 0);
          labels.push({ text: name, x: ox + pt[0] * k, y: oy + pt[1] * k, rank });
          continue;
        }
        let bucket: keyof typeof buckets | null = null;
        if (layer.name === 'water') bucket = feat.type === 3 ? 'w' : feat.type === 2 ? 'v' : null;
        else if (layer.name === 'roads' && feat.type === 2) {
          bucket = ROAD_CLASS[String(feat.props.kind)] ?? null;
        }
        if (!bucket) continue;
        const parts: string[] = [];
        for (const part of feat.geometry) {
          const pts = part.map(([x, y]) => [ox + x * k, oy + y * k] as [number, number]);
          const xs = pts.map((p) => p[0]);
          const ys = pts.map((p) => p[1]);
          if (
            Math.max(...xs) < -margin ||
            Math.min(...xs) > f.w + margin ||
            Math.max(...ys) < -margin ||
            Math.min(...ys) > f.h + margin
          ) {
            continue;
          }
          parts.push(pathOf(pts, feat.type === 3));
        }
        if (parts.length) buckets[bucket].push(parts);
      }
    }
  }

  // Spend the point budget on what orients a reader first.
  let budget = MAX_POINTS;
  const keep = (b: keyof typeof buckets): string => {
    const out: string[] = [];
    for (const parts of buckets[b]) {
      const cost = parts.reduce((s, p) => s + (p.match(/[ML]/g)?.length ?? 0), 0);
      if (cost > budget) continue;
      budget -= cost;
      out.push(...parts);
    }
    return out.join('');
  };
  const water = keep('w');
  const r3 = keep('r3');
  const r2 = keep('r2');
  const rivers = keep('v');
  const r1 = keep('r1');

  // Town names: biggest first, inside the frame, clear of each other and of the
  // hexagon numbers.
  const taken: Box[] = cells.map((c) => {
    const [lat, lng] = cellToLatLng(c);
    const [x, y] = project(f, lat, lng);
    return [x - 40, y - 24, x + 40, y + 52];
  });
  const placed: string[] = [];
  for (const l of labels.sort((a, b) => b.rank - a.rank || a.text.localeCompare(b.text))) {
    if (placed.length >= MAX_LABELS) break;
    const half = (l.text.length * LABEL_PX * 0.55) / 2;
    const box: Box = [l.x - half, l.y - LABEL_PX, l.x + half, l.y + 4];
    if (box[0] < 0 || box[2] > f.w || box[1] < 0 || box[3] > f.h) continue;
    if (taken.some((t) => overlaps(t, box))) continue;
    taken.push(box);
    placed.push(
      `<text class="as-t" x="${l.x.toFixed(0)}" y="${l.y.toFixed(0)}" text-anchor="middle">${escapeHtml(l.text)}</text>`
    );
  }

  const path = (cls: string, d: string) => (d ? `<path class="${cls}" d="${d}"/>` : '');
  return (
    `<g class="amap-s" aria-hidden="true" data-testid="amap-streets" data-z="${z}">` +
    `<rect class="as-l" width="${f.w}" height="${f.h}"/>` +
    path('as-w', water) +
    path('as-v', rivers) +
    path('as-r as-1', r1) +
    path('as-r as-2', r2) +
    path('as-r as-3', r3) +
    placed.join('') +
    `</g>`
  );
}

/** Points to path data: whole units, near-duplicates dropped. */
function pathOf(pts: readonly [number, number][], closed: boolean): string {
  let d = '';
  let lx = NaN;
  let ly = NaN;
  pts.forEach(([x, y], i) => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const last = i === pts.length - 1;
    if (i > 0 && !last && Math.abs(rx - lx) < 1 && Math.abs(ry - ly) < 1) return;
    if (i > 0 && last && rx === lx && ry === ly) return;
    d += `${i === 0 ? 'M' : 'L'}${rx} ${ry}`;
    lx = rx;
    ly = ry;
  });
  return closed ? `${d}Z` : d;
}

/** Read, decode and draw the street layer for these cells. Throws on bad data. */
export async function buildStreetLayer(
  src: RangeSource,
  cells: readonly string[],
  w = MAP_W,
  h = MAP_H
): Promise<StreetLayer> {
  const header = await archiveHeader(src);
  const f = frameForCells(cells, w, h);
  const r = tilesFor(f, header.minZoom, header.maxZoom);
  const jobs: Promise<DecodedTile | null>[] = [];
  for (let x = r.xMin; x <= r.xMax; x++) {
    for (let y = r.yMin; y <= r.yMax; y++) {
      jobs.push(
        readTile(src, r.z, x, y).then((bytes) =>
          bytes ? { x, y, layers: decodeTile(bytes, WANTED) } : null
        )
      );
    }
  }
  const tiles = (await Promise.all(jobs)).filter((t): t is DecodedTile => t !== null);
  return { cellsKey: cellsKey(cells), svg: drawStreets(f, r.z, tiles, cells) };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('street map timed out')), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * The street layer for these cells, or null when it cannot be drawn (no
 * binding, no archive, bad data, too slow). Never throws.
 */
export async function loadStreetLayer(
  env: StreetMapEnv | null | undefined,
  cells: readonly string[],
  opts?: { timeoutMs?: number }
): Promise<StreetLayer | null> {
  const bucket = env?.MAP_TILES;
  if (!bucket || cells.length === 0) return null;
  const name = env?.MAP_TILES_ARCHIVE || DEFAULT_ARCHIVE;
  if (!ARCHIVE_NAME.test(name)) return null;
  try {
    return await withTimeout(
      buildStreetLayer(r2Source(bucket, name), cells),
      opts?.timeoutMs ?? STREET_TIMEOUT_MS
    );
  } catch {
    return null;
  }
}
