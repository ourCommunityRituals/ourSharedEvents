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
// says what a person looked at. One line is logged for each try that reads the
// bucket, and for each layer handed out from those kept (STREET_LAYER, below):
// what came of it, on which surface, and five numbers. No cell, no tile
// address, nothing of the request.
//
// FAIL SOFT. No binding, no archive, a part of the frame with no tile, a damaged
// tile, a tile or a frame that holds more than the Worker will decode
// (FRAME_LIMITS), or a slow read: the map is drawn as before, hexagons only.
// The street layer is never a reason the page fails.
//
// IT SAYS WHAT IT DID (street-map CCR 2026-11-15, R4). Every one of those ends
// the same way on the page, so the page cannot say which happened. The
// STREET_LAYER line can: drew, no-archive, no-tile, thin, timeout or error.
//
// THE SWITCH (street-map CCR 2026-11-15, R20). `STREET_MAP` is a plain value in
// wrangler.toml, one for each environment. Exactly "on" draws streets. "off", no
// value, or anything else is hexagons only, for every caller, and the bucket is
// not asked: the archive can sit in the bucket with no street on any page. So
// loading the archive and showing the first street are two steps, and the way
// back from streets is one line in a PR, with the bucket left as it is.
//
// A LAYER IS A STREET MAP OR IT IS NOTHING (street-map CCR 2026-11-15). A layer
// that is shown turns on the OpenStreetMap credit, lightens the hexagons and, in
// the zoomed area, turns on the dots. So three rules stand between the tiles
// and a layer: a frame wider than a street map can show reads no tile
// (MIN_STREET_ZOOM); the point budget pays roads before water and thins or cuts
// a kind to fit, never leaving one out for another (POINT_SHARES, fitParts);
// and a layer with no road to steer by is no layer (layerShows).
//
// DRAWN LAYERS ARE KEPT, IN THE ISOLATE ONLY (base-map scenario pass 2026-11-15,
// S14 and section 6.4 tier 1; OSE ADR-036 D5, the part that needs no ruling).
// A frame drawn once serves the requests for it that follow in the same
// isolate: no read, no decode, no draw. What is kept is the street layer alone,
// under the archive's key, the etag of the object it was read from, the
// drawer's version, the frame's size, the cells and the cells that carry a
// number. Nothing else is in the name: no event, no token, no brand, no count,
// nothing of a request. So a kept layer says what its cells say and is right
// for every reader. Never kept: a null (a missing object is remembered by the
// reader for a minute, lib/pmtiles.ts; a slow, failed or thin try is asked
// again), and never a map with hexagons, numbers or dots on it. The store is
// held to KEPT_LAYER_CHARS, the layer not asked for the longest going first,
// and a layer is handed out for KEPT_LAYER_MS and no longer.

import { cellToBoundary, cellToLatLng } from 'h3-js';
import {
  ArchiveNotFoundError,
  archiveEtag,
  archiveHeader,
  archiveKnownMissing,
  r2Source,
  readTiles,
  type ObjectVersion,
  type RangeBucket,
  type RangeSource,
} from './pmtiles.js';
import { decodeTile, type DecodeCounts, type MvtLayer } from './mvt.js';
import { escapeHtml } from './html-escape.js';

export const MAP_W = 600;
export const MAP_H = 360;

/** The one value of `STREET_MAP` that draws streets. Anything else is off. */
export const STREET_MAP_ON = 'on';

/** The archive read when `MAP_TILES_ARCHIVE` is not set (the proof's region). */
export const DEFAULT_ARCHIVE = 'chicago-region.pmtiles';
const ARCHIVE_NAME = /^[a-z0-9][a-z0-9._-]{0,80}\.pmtiles$/;

/** Tiles read per map at most; past it the zoom steps out. */
export const MAX_TILES = 12;
/** Finest zoom read. z15 adds detail a 600-wide map cannot show. */
export const MAX_ZOOM = 14;
/**
 * The coarsest zoom streets are read at. At zoom 7 the 600-wide frame is about
 * 600 km across; wider than that no tile is read and the answer is hexagons
 * only, for every caller (`loadStreetLayer`).
 */
export const MIN_STREET_ZOOM = 7;
/**
 * The most the tiles of one frame may hold between them, decoded (street-map
 * CCR 2026-11-15, R2): twice what one tile may (lib/mvt.ts, TILE_LIMITS, with
 * what each kind costs). A frame is up to MAX_TILES tiles and every one is
 * decoded before anything is drawn, so without this a frame could hold twelve
 * tiles at the tile limit. At every limit a frame is about 23 MB of points,
 * 9 MB of features and up to 15 MB of properties (Node, a workstation), and
 * the drawer copies the points it may draw once more. MAX_POINTS below is what
 * is drawn; this is what is read to choose them from, 33 times as many.
 *
 * What a real frame needs is not measured: no archive is loaded. A frame past
 * this is hexagons only, and the archive check reports such a place as an
 * error (scripts/street-map-archive/check.ts).
 */
export const FRAME_LIMITS: Readonly<DecodeCounts> = Object.freeze({
  features: 60_000,
  points: 300_000,
  props: 300_000,
});
/** Path points drawn at most, so a dense city stays a small page (see POINT_SHARES). */
export const MAX_POINTS = 9000;
/** Town names drawn at most. */
export const MAX_LABELS = 6;
/** A street layer slower than this is dropped; the hexagons draw alone. */
export const STREET_TIMEOUT_MS = 1500;

/**
 * The room a town name is given, in map units a letter: the largest size it is
 * ever set in. STREET_STYLE sets 22; a narrow screen sets 28, so a name is
 * 13 px on a 280 px map (lib/map-narrow-style.ts). Names are kept clear of each
 * other and of the hexagon numbers at 28, which leaves them clear at 22 too.
 */
const LABEL_PX = 28;

export interface StreetMapEnv {
  /** The switch: streets are drawn only when this is exactly `STREET_MAP_ON`. */
  STREET_MAP?: string;
  MAP_TILES?: RangeBucket;
  MAP_TILES_ARCHIVE?: string;
  /**
   * The etag of the one object streets may be drawn from, unquoted, as R2
   * gives it. Optional and unset everywhere today: the value exists only once
   * the archive is loaded. Set, an object under `MAP_TILES_ARCHIVE` with any
   * other etag is refused and the map is hexagons only (lib/pmtiles.ts,
   * `r2Source`). Empty is the same as unset.
   */
  MAP_TILES_ETAG?: string;
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
  /** Path points in it, by kind. */
  drawn: DrawnPoints;
}

/**
 * What one read of a frame did, filled in as it goes. Numbers and one yes or
 * no: which zoom, how many tiles, how many reads, never which tiles.
 */
export interface StreetTrace {
  /** The zoom the frame's tiles were asked for at; null until the archive is open. */
  z: number | null;
  /** Tiles the frame asked for. */
  tiles: number;
  /** Reads of the source so far. */
  reads: number;
  /** The archive had no tile for a part of the frame. */
  gap: boolean;
}

export function newStreetTrace(): StreetTrace {
  return { z: null, tiles: 0, reads: 0, gap: false };
}

/**
 * What came of one try at the street layer:
 *   drew        a layer is on the page
 *   no-archive  the bucket has no object under the archive's key
 *   no-tile     the archive has no tile for a part of the frame
 *   thin        the tiles were read and drawn, and held no street map (layerShows)
 *   timeout     slower than the limit (STREET_TIMEOUT_MS)
 *   error       a read failed, or the bytes were refused (damaged, or past a limit)
 */
export type StreetOutcome = 'drew' | 'no-archive' | 'no-tile' | 'thin' | 'timeout' | 'error';

/** The two callers. A caller that does not say is logged as "other". */
export type StreetSurface = 'landing' | 'map-areas';
const STREET_SURFACES: ReadonlySet<unknown> = new Set<StreetSurface>(['landing', 'map-areas']);
/** One of the two words, or "other": whatever a caller hands over, only these are written. */
const surfaceWord = (said: unknown): StreetSurface | 'other' =>
  STREET_SURFACES.has(said) ? (said as StreetSurface) : 'other';

/**
 * The STREET_LAYER log line, sealed the way the cost line is
 * (lib/cost-metric.ts): a fixed set of keys, two words from fixed lists and
 * five numbers. Never who and never where: no cell, no tile address, no archive
 * name, no error text, nothing read from the request. Gate:
 * tests/e2e/0-architecture/cost-metric-never-who.invariant.spec.ts.
 */
export interface StreetLayerLine {
  type: 'STREET_LAYER';
  outcome: StreetOutcome;
  surface: StreetSurface | 'other';
  z: number | null;
  tiles: number;
  r2Reads: number;
  ms: number;
}

/** What the loader hands the line. No request and no cell is among it. */
export interface StreetLayerLineInput {
  outcome: StreetOutcome;
  surface: unknown;
  trace: StreetTrace;
  ms: number;
}

/**
 * Write one STREET_LAYER line to Workers Logs. The line is built key by key
 * below, so nothing a caller holds can ride along. `ms` is wall-clock time, and
 * in a Worker the clock moves only when a read comes back. Never throws.
 */
export function emitStreetLayer(input: StreetLayerLineInput): void {
  try {
    const payload: StreetLayerLine = {
      type: 'STREET_LAYER',
      outcome: input.outcome,
      surface: surfaceWord(input.surface),
      z: input.trace.z,
      tiles: input.trace.tiles,
      r2Reads: input.trace.reads,
      ms: Math.max(0, input.ms),
    };
    console.log(JSON.stringify(payload));
  } catch {
    /* a line that cannot be written is never a reason the page fails */
  }
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

/** The zoom a frame's tiles are read at before any stepping out (`tilesFor`). */
export function frameZoom(f: MapFrame): number {
  return Math.round(Math.log2(f.scale / 256));
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
  let z = Math.max(minZoom, Math.min(Math.min(maxZoom, MAX_ZOOM), frameZoom(f)));
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

/** What the layer draws its lines and shapes as, in the order the point budget pays them. */
export type StreetKind = 'highway' | 'major' | 'minor' | 'water' | 'rivers';

/** Path points drawn, by kind. */
export type DrawnPoints = Record<StreetKind, number>;

/**
 * Road classes. Older Protomaps builds say medium_road. A Map, not a plain
 * object: the kind comes from the tile, and a plain object answers
 * "constructor" or "__proto__" with its own members, which are not a class.
 */
const ROAD_CLASS = new Map<string, StreetKind>([
  ['minor_road', 'minor'],
  ['medium_road', 'major'],
  ['major_road', 'major'],
  ['highway', 'highway'],
]);

/**
 * The point budget (street-map CCR 2026-11-15, R7). The share of MAX_POINTS
 * each kind is sure of, in the order the kinds are paid: roads before water,
 * the roads a reader steers by before the streets between them. A kind that
 * needs less than its share leaves the rest to the kinds that need more, the
 * first in this order first. So no kind can take the whole budget: on real
 * tiles the old order (water first, a feature at a time) drew 19 areas of
 * Manhattan as 8,999 points of water and one point of road.
 */
export const POINT_SHARES: readonly (readonly [StreetKind, number])[] = [
  ['highway', 0.3],
  ['major', 0.3],
  ['minor', 0.2],
  ['water', 0.15],
  ['rivers', 0.05],
];

/** The points each kind may draw, from what each would draw with no limit. */
export function spendPoints(need: DrawnPoints, total = MAX_POINTS): DrawnPoints {
  const out = {} as DrawnPoints;
  let left = total;
  for (const [kind, share] of POINT_SHARES) {
    out[kind] = Math.min(need[kind], Math.floor(total * share));
    left -= out[kind];
  }
  for (const [kind] of POINT_SHARES) {
    const more = Math.min(need[kind] - out[kind], left);
    out[kind] += more;
    left -= more;
  }
  return out;
}

/**
 * Road points a layer must draw to be shown. Measured on real tiles of
 * Protomaps build 20261109 (a workstation run, 2026-11-15): the two layers the
 * street-map CCR saw accepted with no map in them drew 1 and 10 points of road;
 * the thinnest real places drew 336 (farmland in Nebraska, one area) and 2,308
 * (Sawyer, Michigan, seven areas). 100 is ten times the worst and a third of
 * the thinnest.
 */
export const MIN_ROAD_POINTS = 100;

/**
 * Whether a drawn layer is a street map a reader can use: it has a highway or
 * a major road to steer by, and MIN_ROAD_POINTS of road in all. Water alone, a
 * blank tile, or a stub of road is not, and showing it would put the
 * OpenStreetMap credit and the zoomed area's dots over nothing.
 */
export function layerShows(drawn: DrawnPoints): boolean {
  const main = drawn.highway + drawn.major;
  return main > 0 && main + drawn.minor >= MIN_ROAD_POINTS;
}

type Pt = readonly [number, number];

/** One line or ring, in whole SVG units, no point twice in a row. */
export interface StreetPart {
  pts: Pt[];
  /** Width plus height of its box: how far across the frame it reaches. */
  span: number;
  /** Its place among the parts of its kind in its own tile, from 0. */
  rank: number;
}

/**
 * How far from a straight run a point may sit and still be left out, in SVG
 * units, tried in turn until a kind fits. 8 is about 1% of the frame's width.
 */
export const THIN_STEPS = [1, 2, 3, 5, 8] as const;

/**
 * Leave out the points that sit within `tol` of the line through the last kept
 * point and the one after it (Reumann-Witkam: one pass, so a tile cannot make
 * it slow). A straight street becomes its two ends; the first and last points
 * always stay.
 */
export function thinLine(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length < 3) return [...pts];
  const out: Pt[] = [pts[0]!];
  let a = pts[0]!;
  let b = pts[1]!;
  for (let i = 2; i < pts.length; i++) {
    const p = pts[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const cross = dx * (p[1] - a[1]) - dy * (p[0] - a[0]);
    if (cross * cross > tol * tol * (dx * dx + dy * dy)) {
      a = pts[i - 1]!;
      b = p;
      out.push(a);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

const pointsIn = (parts: readonly StreetPart[]): number =>
  parts.reduce((s, p) => s + p.pts.length, 0);

/** A ring needs three corners and its closing point; a line needs two ends. */
const fewest = (closed: boolean): number => (closed ? 4 : 2);

/**
 * Bring one kind's parts inside `allot` points. What fits is returned as it
 * came. Past that every part is thinned by the same rule, across the whole
 * frame, a step at a time. If the coarsest step is still too many, the parts
 * that reach furthest are kept, one from every tile before a second from any,
 * and the line the points run out on is cut short at a point. A ring is never
 * cut short, and no ring is kept once a wider one was left out, so an island
 * is never drawn without the water around it.
 */
export function fitParts(
  parts: readonly StreetPart[],
  allot: number,
  closed: boolean
): StreetPart[] {
  let kept: StreetPart[] = [...parts];
  if (pointsIn(kept) <= allot) return kept;
  for (const tol of THIN_STEPS) {
    kept = parts
      .map((p) => ({ ...p, pts: thinLine(p.pts, tol) }))
      .filter((p) => p.pts.length >= fewest(closed));
    if (pointsIn(kept) <= allot) return kept;
  }
  const out: StreetPart[] = [];
  let left = allot;
  for (const p of [...kept].sort((x, y) => y.span - x.span || x.rank - y.rank)) {
    if (p.pts.length > left) {
      if (!closed && left >= fewest(closed)) out.push({ ...p, pts: p.pts.slice(0, left) });
      break;
    }
    out.push(p);
    left -= p.pts.length;
  }
  return out;
}

interface Label {
  text: string;
  x: number;
  y: number;
  rank: number;
}

type Box = [number, number, number, number];

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** The street layer's markup and what it holds. */
export interface StreetDrawing {
  svg: string;
  drawn: DrawnPoints;
}

/** `drawStreetLayer` when only the markup is wanted. */
export function drawStreets(
  f: MapFrame,
  z: number,
  tiles: readonly DecodedTile[],
  // Stryker disable next-line ArrayDeclaration: the mutant puts one made-up id here. It is no H3 cell of any frame (h3 places it in the Arctic), so its box meets no town name.
  cells: readonly string[] = []
): string {
  return drawStreetLayer(f, z, tiles, cells).svg;
}

/**
 * Draw the decoded tiles as the street layer. Pure: same input, same result.
 * `cells` are the hexagons drawn on top; town names keep clear of their numbers.
 */
export function drawStreetLayer(
  f: MapFrame,
  z: number,
  tiles: readonly DecodedTile[],
  // Stryker disable next-line ArrayDeclaration: the mutant puts one made-up id here. It is no H3 cell of any frame (h3 places it in the Arctic), so its box meets no town name.
  cells: readonly string[] = []
): StreetDrawing {
  const n = 2 ** z;
  const found: Record<StreetKind, StreetPart[]> = {
    highway: [],
    major: [],
    minor: [],
    water: [],
    rivers: [],
  };
  const labels: Label[] = [];
  const margin = 12;

  for (const t of tiles) {
    const ranks: DrawnPoints = { highway: 0, major: 0, minor: 0, water: 0, rivers: 0 };
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
        let kind: StreetKind | null = null;
        if (layer.name === 'water') {
          if (feat.type === 3) kind = 'water';
          // A river is a line (type 2). A run of points typed as a point, or not typed, is not drawn.
          else if (feat.type === 2) kind = 'rivers';
        } else if (layer.name === 'roads' && feat.type === 2) {
          kind = ROAD_CLASS.get(String(feat.props.kind)) ?? null;
        }
        if (!kind) continue;
        for (const part of feat.geometry) {
          // Whole units, and no point twice in a row.
          const pts: Pt[] = [];
          let xMin = Infinity;
          let xMax = -Infinity;
          let yMin = Infinity;
          let yMax = -Infinity;
          for (const [px, py] of part) {
            const x = Math.round(ox + px * k);
            const y = Math.round(oy + py * k);
            const last = pts[pts.length - 1];
            if (last && last[0] === x && last[1] === y) continue;
            pts.push([x, y]);
            xMin = Math.min(xMin, x);
            xMax = Math.max(xMax, x);
            yMin = Math.min(yMin, y);
            yMax = Math.max(yMax, y);
          }
          if (xMax < -margin || xMin > f.w + margin || yMax < -margin || yMin > f.h + margin) {
            continue;
          }
          if (pts.length < fewest(kind === 'water')) continue;
          found[kind].push({ pts, span: xMax - xMin + (yMax - yMin), rank: ranks[kind]++ });
        }
      }
    }
  }

  // Spend the point budget: each kind what spendPoints allows it, roads first.
  // Thinning goes in steps, so a kind can land well under what it was allowed.
  // Those points go on to the next kind, and what is still spare after the last
  // goes round once more, in the same order, to the kinds that were cut.
  const need = {} as DrawnPoints;
  for (const [kind] of POINT_SHARES) need[kind] = pointsIn(found[kind]);
  /** What each kind may draw; once it is fitted, what it drew. */
  const drawn = spendPoints(need);
  const kept = {} as Record<StreetKind, StreetPart[]>;
  let spare = 0;
  const pay = (): void => {
    for (const [kind] of POINT_SHARES) {
      const limit = drawn[kind] + spare;
      kept[kind] = fitParts(found[kind], limit, kind === 'water');
      drawn[kind] = pointsIn(kept[kind]);
      spare = limit - drawn[kind];
    }
  };
  pay();
  pay();
  const d = {} as Record<StreetKind, string>;
  for (const [kind] of POINT_SHARES) {
    d[kind] = kept[kind].map((p) => pathOf(p.pts, kind === 'water')).join('');
  }

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

  const path = (cls: string, data: string) => (data ? `<path class="${cls}" d="${data}"/>` : '');
  const svg =
    `<g class="amap-s" aria-hidden="true" data-testid="amap-streets" data-z="${z}">` +
    `<rect class="as-l" width="${f.w}" height="${f.h}"/>` +
    path('as-w', d.water) +
    path('as-v', d.rivers) +
    path('as-r as-1', d.minor) +
    path('as-r as-2', d.major) +
    path('as-r as-3', d.highway) +
    placed.join('') +
    `</g>`;
  return { svg, drawn };
}

/** Points to path data: one command a point. */
function pathOf(pts: readonly Pt[], closed: boolean): string {
  const data = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join('');
  return closed ? `${data}Z` : data;
}

/**
 * Read, decode and draw the frame of these cells, with no judgement of what
 * came out. Throws on bad data, and on tiles that hold more than FRAME_LIMITS
 * allows. Null when the archive has no tile for a part of the frame. The
 * archive check reads this, to say what a draw held. `trace` is told the zoom
 * and the tile count once they are known, and a gap when that is why it is null.
 */
export async function readStreetDrawing(
  src: RangeSource,
  cells: readonly string[],
  w = MAP_W,
  h = MAP_H,
  numbered: readonly string[] = cells,
  trace: StreetTrace = newStreetTrace()
): Promise<StreetDrawing | null> {
  const header = await archiveHeader(src);
  const f = frameForCells(cells, w, h);
  const r = tilesFor(f, header.minZoom, header.maxZoom);
  const want: [number, number][] = [];
  for (let x = r.xMin; x <= r.xMax; x++) {
    for (let y = r.yMin; y <= r.yMax; y++) want.push([x, y]);
  }
  trace.z = r.z;
  trace.tiles = want.length;
  // One call for the whole frame, so tiles that sit together in the file come
  // from one read (lib/pmtiles.ts, readTiles).
  const read = await readTiles(src, r.z, want);
  // Every tile of the frame, or no layer (street-map CCR 2026-11-15, R15). A
  // gap is taken for the edge of what the archive was cut for: streets on one
  // side of the map and blank land on the other would read as "nothing is
  // there", under a credit that says the map is OpenStreetMap's. A build that
  // left out open water inside its region would lose the streets of a frame
  // on the shore to this rule. Whether the loaded build does is not known
  // here; the archive check draws places on the water and fails if one of
  // them has no layer (scripts/street-map-archive/check.ts).
  if (read.includes(null)) {
    trace.gap = true;
    return null;
  }
  const left: DecodeCounts = { ...FRAME_LIMITS };
  const tiles: DecodedTile[] = read.map((bytes, i) => ({
    x: want[i]![0],
    y: want[i]![1],
    layers: decodeTile(bytes!, WANTED, left),
  }));
  return drawStreetLayer(f, r.z, tiles, numbered);
}

/**
 * The street layer for these cells. Throws on bad data. Null when the archive
 * has no tile for a part of the frame, or when what was drawn is not a street map
 * (`layerShows`): a layer of nothing, or of water alone, is a blank or blue
 * rectangle, and the zoomed area would draw its dots on it.
 *
 * `numbered` are the cells that carry a number on the finished map, when that is
 * fewer than the cells the frame is fitted to (the public area map frames the
 * neighbouring cells too, and numbers only the areas). Town names keep clear of
 * those; the frame, the tiles and `cellsKey` come from `cells`.
 */
export async function buildStreetLayer(
  src: RangeSource,
  cells: readonly string[],
  w = MAP_W,
  h = MAP_H,
  numbered: readonly string[] = cells,
  trace: StreetTrace = newStreetTrace()
): Promise<StreetLayer | null> {
  const drawing = await readStreetDrawing(src, cells, w, h, numbered, trace);
  if (!drawing || !layerShows(drawing.drawn)) return null;
  return { cellsKey: cellsKey(cells), svg: drawing.svg, drawn: drawing.drawn };
}

/**
 * The drawer's version, part of the name a drawn layer is kept under. Inside
 * one isolate it never differs: an isolate runs one build of this file. It is
 * in the name so the same name can serve a store that outlives the isolate
 * (OSE ADR-036 D5, the edge store, which is the owner's to decide and is not
 * built). Raise it with any change to what `drawStreetLayer` writes.
 */
export const DRAWER_VERSION = 1;

/**
 * Characters of drawn layers, with their names, kept in an isolate at most. A
 * layer measured about 100 KB, so this is about 30 of them; a character is one
 * byte in the isolate, or two when a town name is not Latin-1, so it is 3 MB
 * to 6 MB of a Worker's 128 MB.
 */
export const KEPT_LAYER_CHARS = 3_000_000;

/**
 * How long a kept layer is handed out, in milliseconds, counted from before
 * its tiles were read. A kept layer is handed out with no read, so nothing
 * checks its object is still the one in the bucket (the etag rides on reads,
 * lib/pmtiles.ts). This is the longest an isolate goes on showing streets from
 * an object that was replaced or removed under its key, when no other frame's
 * read has noticed first. It is the hour the public area map's answer may
 * already be kept by a reader (handlers/map-areas.ts, max-age).
 */
export const KEPT_LAYER_MS = 3_600_000;

interface KeptLayer {
  layer: StreetLayer;
  /** The zoom its tiles were read at, for the line a hand-out writes. */
  z: number | null;
  /** Characters it is counted as: its name and its markup. */
  chars: number;
  /** The time from which it is no longer handed out. */
  until: number;
}

/** Kept layers by frame name; the one not asked for the longest is first. */
const KEPT = new Map<string, KeptLayer>();
/** The object every kept layer was drawn from (`keptSource`). */
let keptOf = '';
let keptChars = 0;

/**
 * The name of one object: the source's key and the object's etag. With no etag
 * (no archive open under the key) it is a name nothing is ever kept under.
 */
export function keptSource(key: string, etag: string | undefined): string {
  return JSON.stringify([key, etag]);
}

/**
 * The name of one frame's layer: the drawer's version, the frame's size, the
 * cells it is fitted to and the cells that carry a number. Cell ids only.
 */
export function layerName(
  cells: readonly string[],
  numbered: readonly string[] = cells,
  w = MAP_W,
  h = MAP_H
): string {
  return `${DRAWER_VERSION}|${w}x${h}|${cellsKey(cells)}|${cellsKey(numbered)}`;
}

/**
 * The etag of the one object a try's reads were held to, or undefined when
 * that cannot be said: nothing was read, the object gave no etag, or the
 * archive was opened more than once in the try (the object changed under the
 * key part way, and the reader opened what is there now). `versions` are the
 * `version` of each read: an opened archive has one for all its reads.
 */
export function keptEtag(versions: ReadonlySet<ObjectVersion | undefined>): string | undefined {
  const [version] = versions;
  return versions.size === 1 ? version?.etag : undefined;
}

/** How many layers are kept, and the characters they are counted as. */
export function keptStreetLayers(): { layers: number; chars: number } {
  return { layers: KEPT.size, chars: keptChars };
}

/** Forget every kept layer (tests, and a layer of another object arriving). */
export function resetStreetLayerCache(): void {
  KEPT.clear();
  keptChars = 0;
}

/**
 * The layer kept for this frame of this object, or null: nothing kept for it,
 * the kept layers are another object's, or its time is up (it is dropped
 * then). A layer handed out becomes the last to go.
 */
export function keptStreetLayer(
  source: string,
  name: string,
  now: number
): { layer: StreetLayer; z: number | null } | null {
  if (source !== keptOf) return null;
  const kept = KEPT.get(name);
  if (!kept) return null;
  KEPT.delete(name);
  if (now >= kept.until) {
    keptChars -= kept.chars;
    return null;
  }
  KEPT.set(name, kept);
  return { layer: kept.layer, z: kept.z };
}

/**
 * Keep a drawn layer for the frames that follow, until `now` + KEPT_LAYER_MS.
 * Layers of another object go first: an isolate reads one archive, so another
 * key or etag means the old object is not coming back. Then the layers not
 * asked for the longest go until all fit KEPT_LAYER_CHARS; a layer larger than
 * that by itself is not kept. The layer is frozen: every request for the frame
 * is handed the same one.
 */
export function keepStreetLayer(
  source: string,
  name: string,
  layer: StreetLayer,
  z: number | null,
  now: number
): void {
  const chars = name.length + layer.svg.length;
  if (chars > KEPT_LAYER_CHARS) return;
  if (source !== keptOf) {
    resetStreetLayerCache();
    keptOf = source;
  }
  const old = KEPT.get(name);
  if (old) {
    KEPT.delete(name);
    keptChars -= old.chars;
  }
  Object.freeze(layer.drawn);
  KEPT.set(name, { layer: Object.freeze(layer), z, chars, until: now + KEPT_LAYER_MS });
  keptChars += chars;
  for (const [first, kept] of KEPT) {
    if (keptChars <= KEPT_LAYER_CHARS) return;
    KEPT.delete(first);
    keptChars -= kept.chars;
  }
}

/** The street layer's time limit ran out. */
class StreetTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StreetTimeout()), ms);
  });
  // The executor above has run by now, so the timer is set. Clearing it means a
  // read that finished leaves nothing running in the isolate.
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The street layer for these cells, or null when it is switched off
 * (`STREET_MAP` is not "on": nothing is read) or cannot be drawn (no
 * binding, no archive, a frame wider than a street map can show, a part of the
 * frame with no tile, nothing in it to steer by, bad data, more in the tiles
 * than the Worker will decode, too slow, or the object under the key is not
 * the one this isolate opened or not the one `MAP_TILES_ETAG` pins; the line
 * below says `error` for those two). Never throws.
 *
 * A try that reads the bucket writes one STREET_LAYER line saying which of
 * those it was (`emitStreetLayer`); `surface` is the caller's name in it. The
 * exits that have no layer and read nothing write nothing: the switch off, no
 * binding, a bad name, a frame too wide, and an archive this isolate found
 * missing less than a minute ago (lib/pmtiles.ts, MISS_MEMORY_MS), which is
 * not asked for again until the minute is up.
 *
 * A frame this isolate has drawn from the object it has open is handed out
 * from the kept layers with nothing read ("DRAWN LAYERS ARE KEPT", above). It
 * writes the line too: `drew`, the layer's zoom, and 0 tiles, 0 reads and 0
 * ms, which is how a kept layer is told from a drawn one in the log. With
 * `MAP_TILES_ETAG` set, only a layer of the pinned object is handed out.
 */
export async function loadStreetLayer(
  env: StreetMapEnv | null | undefined,
  cells: readonly string[],
  opts?: { timeoutMs?: number; numbered?: readonly string[]; surface?: StreetSurface }
): Promise<StreetLayer | null> {
  // The switch first: off reads nothing (street-map CCR 2026-11-15, R20).
  if (env?.STREET_MAP !== STREET_MAP_ON) return null;
  if (!env.MAP_TILES || cells.length === 0) return null;
  const bucket = env.MAP_TILES;
  const name = env.MAP_TILES_ARCHIVE || DEFAULT_ARCHIVE;
  if (!ARCHIVE_NAME.test(name)) return null;
  // Too wide for streets: nothing is read (street-map CCR 2026-11-15, R5).
  if (frameZoom(frameForCells(cells)) < MIN_STREET_ZOOM) return null;
  const src = r2Source(bucket, name, env.MAP_TILES_ETAG);
  // Found missing a moment ago: not asked again yet, and nothing to say.
  if (archiveKnownMissing(src.key)) return null;
  const frame = layerName(cells, opts?.numbered);
  const started = Date.now();
  // Drawn before, from the object this isolate has open: nothing is read.
  // With nothing open there is no etag, and nothing is kept under none.
  const open = archiveEtag(src.key);
  if (!env.MAP_TILES_ETAG || env.MAP_TILES_ETAG === open) {
    const kept = keptStreetLayer(keptSource(src.key, open), frame, started);
    if (kept) {
      const trace = { ...newStreetTrace(), z: kept.z };
      emitStreetLayer({ outcome: 'drew', surface: opts?.surface, trace, ms: 0 });
      return kept.layer;
    }
  }
  const trace = newStreetTrace();
  // The objects this try's reads were held to. An opened archive has one
  // `version` for all its reads, so one here means one object.
  const versions = new Set<ObjectVersion | undefined>();
  const counted: RangeSource = {
    key: src.key,
    // `version` goes through as it came: it is what holds every read of an
    // opened archive to one object (lib/pmtiles.ts, r2Source).
    read(offset, length, version) {
      trace.reads += 1;
      versions.add(version);
      return src.read(offset, length, version);
    },
  };
  let layer: StreetLayer | null = null;
  let outcome: StreetOutcome;
  try {
    layer = await withTimeout(
      buildStreetLayer(counted, cells, MAP_W, MAP_H, opts?.numbered, trace),
      opts?.timeoutMs ?? STREET_TIMEOUT_MS
    );
    if (layer) {
      outcome = 'drew';
      // Kept only when every read was of one object whose etag is known. An
      // archive opened again part way (the object changed under the key) is
      // drawn for this page and not kept.
      const etag = keptEtag(versions);
      if (etag !== undefined) {
        keepStreetLayer(keptSource(src.key, etag), frame, layer, trace.z, started);
      }
    } else outcome = trace.gap ? 'no-tile' : 'thin';
  } catch (e) {
    if (e instanceof StreetTimeout) outcome = 'timeout';
    else outcome = e instanceof ArchiveNotFoundError ? 'no-archive' : 'error';
  }
  emitStreetLayer({ outcome, surface: opts?.surface, trace, ms: Date.now() - started });
  return layer;
}
