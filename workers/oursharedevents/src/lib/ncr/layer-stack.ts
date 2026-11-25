/**
 * The NCR layer map, as a stack any map surface can choose layers from
 * (OSE ADR-041; the shared form is OCR-docs fleet ADR-013, proposed).
 *
 * Matt's order (2026-11-25), bottom to top, in four steps a reader walks:
 *
 *   1. base       base.towns (light tints) and base.streets, see-through;
 *   2. hexagons   hex.7, hex.6, hex.5: small, medium and large areas;
 *   3. corridors  corridors and nodes from ourEventRings, where the map
 *                 measures, plus a surface's own overlay (report.cells);
 *   4. rings      ring outlines on top.
 *
 * Each layer's id, order, step, meaning and privacy class live in LAYER_STACK,
 * data a person and an agent read alike; the drawing follows the data. A
 * surface picks which layers are in play (`layers`); the order never changes.
 *
 * Privacy (AGENTS.md invariants 1 to 3): this module draws what it is handed.
 * Every count it receives must already be published under the floor, and it
 * only ever adds published parts together, so a total says nothing a part did
 * not. It reads no database, no request and no network. Ring outlines carry no
 * numbers. Kept free of OSE imports except the street map's projection, so it
 * can move to the shared package.
 */
import {
  cellToBoundary,
  cellToLatLng,
  cellToParent,
  getResolution,
  gridDisk,
  isValidCell,
} from 'h3-js';
import { frameForCells, project, type MapFrame } from '../street-map';

export type StepId = 'base' | 'hexagons' | 'corridors' | 'rings';
export type LayerId =
  | 'base.towns'
  | 'base.streets'
  | 'hex.7'
  | 'hex.6'
  | 'hex.5'
  | 'corridors'
  | 'nodes'
  | 'rings'
  | 'report.cells';

/**
 * geometry: shapes with no counts. people-count: counts under the K=5 floor.
 * oer-derived: taken from ourEventRings' analysis of the dataset (OSE ADR-026).
 */
export type PrivacyClass = 'geometry' | 'people-count' | 'oer-derived';

export interface LayerSpec {
  id: LayerId;
  /**
   * Bottom to top, on the fleet registry's numbers (OCR-docs fleet ADR-013):
   * gaps of 10 leave room for layers other surfaces add. Fixed: a surface
   * never reorders the stack.
   */
  order: number;
  step: StepId;
  label: string;
  /** What the layer is for, in one sentence a reader and an agent both use. */
  meaning: string;
  privacy: PrivacyClass;
}

export interface StepSpec {
  id: StepId;
  n: number;
  label: string;
  meaning: string;
}

export const LAYER_STEPS: readonly StepSpec[] = Object.freeze([
  {
    id: 'base',
    n: 1,
    label: 'Base map',
    meaning: 'Towns in light tints and the streets, kept see-through.',
  },
  {
    id: 'hexagons',
    n: 2,
    label: 'Hexagons',
    meaning:
      'The three sizes rings are read at: small (res 7, thin), medium (res 6) and large (res 5, heavy).',
  },
  {
    id: 'corridors',
    n: 3,
    label: 'Corridors',
    meaning:
      'Corridors and their nodes: where the map is measuring. Dashed ones cross a town line.',
  },
  {
    id: 'rings',
    n: 4,
    label: 'Rings',
    meaning: 'Rings on top, where traffic runs both ways between areas.',
  },
]);

export const LAYER_STACK: readonly LayerSpec[] = Object.freeze([
  {
    id: 'base.towns',
    order: 10,
    step: 'base',
    label: 'Towns',
    meaning:
      'Town lines in light tints, no two neighbours alike, so the layers above read against real places.',
    privacy: 'geometry',
  },
  {
    id: 'base.streets',
    order: 20,
    step: 'base',
    label: 'Streets',
    meaning: 'The street map under everything (OSE ADR-036); not yet drawn on the SharedReport.',
    privacy: 'geometry',
  },
  {
    id: 'hex.7',
    order: 30,
    step: 'hexagons',
    label: 'Small areas',
    meaning: 'Res 7 hexagons holding scans, shaded by the sum of their published poster counts.',
    privacy: 'people-count',
  },
  {
    id: 'hex.6',
    order: 40,
    step: 'hexagons',
    label: 'Medium areas',
    meaning: 'Res 6 hexagons around them, the medium scale rings are read at.',
    privacy: 'people-count',
  },
  {
    id: 'hex.5',
    order: 50,
    step: 'hexagons',
    label: 'Large areas',
    meaning: 'Res 5 hexagons, the large scale rings are read at.',
    privacy: 'people-count',
  },
  {
    id: 'corridors',
    order: 60,
    step: 'corridors',
    label: 'Corridors',
    meaning:
      'Commercial strips where traffic flows, cut at their nodes, never at a town line; dashed ones cross one.',
    privacy: 'geometry',
  },
  {
    id: 'nodes',
    order: 70,
    step: 'corridors',
    label: 'Nodes',
    meaning: 'Crossroads, stations and border retail where a corridor is cut into segments.',
    privacy: 'geometry',
  },
  {
    id: 'rings',
    order: 80,
    step: 'rings',
    label: 'Rings',
    meaning:
      'Ring outlines from ourEventRings: areas whose traffic runs both ways, seen across seasons. Shapes only.',
    privacy: 'oer-derived',
  },
  {
    id: 'report.cells',
    order: 90,
    step: 'corridors',
    label: 'Poster spots',
    meaning: 'The res 9 poster spots this event was scanned at, each at or above the floor of 5.',
    privacy: 'people-count',
  },
]);

export const ALL_LAYERS: readonly LayerId[] = LAYER_STACK.map((l) => l.id);

/** OER's frame for one place (generated copy: corridor-geographies.generated.ts). */
export interface OerGeography {
  id: string;
  name: string;
  rules: string;
  towns: Array<{ name: string; tint: number; rings: Array<Array<[number, number] | number[]>> }>;
  segments: Array<{
    id: string;
    corridor: string;
    name: string;
    from: string;
    to: string;
    tier: number;
    straddles: boolean;
    line: Array<[number, number] | number[]>;
    hexagons: string[];
  }>;
  nodes: Array<{
    id: string;
    name: string;
    kind: string;
    at: [number, number] | number[];
    hexagon: string;
  }>;
}

/** A ring outline: the res 7 cells it covers. Shapes only, never a number. */
export interface RingShape {
  id: string;
  size: 'small' | 'medium' | 'large';
  cells: string[];
}

export interface LayerMapInput {
  /** Measured spots (H3 res 7 or finer) with counts already published under the floor. */
  spots: Array<{ cell: string; count: number }>;
  /** A cell to frame the map on when no spot is published (the event's own area). */
  around?: string | null;
  geographies: readonly OerGeography[];
  rings: readonly RingShape[];
  /** The layers in play on this surface; drawn in LAYER_STACK order. */
  layers?: readonly LayerId[];
}

export interface AreaCount {
  res: 5 | 6 | 7;
  cell: string;
  /** Sum of published parts (each already floored and rounded). */
  scans: number;
}

export interface LayerSummary extends LayerSpec {
  /** How many marks the layer drew on this map. */
  shown: number;
}

export interface LayerMapResult {
  svg: string;
  layers: LayerSummary[];
  areas: AreaCount[];
  frame: MapFrame;
}

const RES = [7, 6, 5] as const;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inFrame(f: MapFrame, x: number, y: number, slack = 0): boolean {
  return x >= -slack && y >= -slack && x <= f.w + slack && y <= f.h + slack;
}

/** Sum published parts by parent cell at res 7, 6 and 5. */
export function areaCounts(spots: LayerMapInput['spots']): AreaCount[] {
  const out: AreaCount[] = [];
  for (const res of RES) {
    const by = new Map<string, number>();
    for (const s of spots) {
      const r = getResolution(s.cell);
      if (r < res) continue;
      const p = r === res ? s.cell : cellToParent(s.cell, res);
      by.set(p, (by.get(p) ?? 0) + s.count);
    }
    for (const [cell, scans] of [...by].sort((a, b) => a[0].localeCompare(b[0])))
      out.push({ res, cell, scans });
  }
  return out;
}

export function renderLayerMap(input: LayerMapInput): LayerMapResult {
  const want = new Set(input.layers ?? ALL_LAYERS);
  const spots = input.spots.filter(
    (s) => isValidCell(s.cell) && getResolution(s.cell) >= 7 && s.count > 0
  );
  const areas = areaCounts(spots);
  const small = areas.filter((a) => a.res === 7).map((a) => a.cell);
  // The frame: the res 7 areas that hold a published spot (or the area the
  // surface names), and one ring of neighbours for context. Purely geometric,
  // so it points at no withheld place.
  const around =
    input.around && isValidCell(input.around) && getResolution(input.around) >= 7
      ? cellToParent(input.around, 7)
      : null;
  const centre = small.length ? small : around ? [around] : [];
  if (!centre.length) throw new Error('renderLayerMap needs a published spot or an area to frame');
  const frameCells = [...new Set(centre.flatMap((c) => gridDisk(c, 1)))].sort();
  const frame = frameForCells(frameCells);
  const pt = (lat: number, lng: number) => project(frame, lat, lng);
  const xy = ([x, y]: [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const hexPoints = (cell: string) =>
    cellToBoundary(cell)
      .map(([la, ln]) => xy(pt(la, ln)))
      .join(' ');

  const marks = Object.fromEntries(ALL_LAYERS.map((id) => [id, [] as string[]])) as Record<
    LayerId,
    string[]
  >;

  if (want.has('base.towns')) {
    for (const g of input.geographies) {
      for (const t of g.towns) {
        const rings = t.rings.map((r) => r.map(([lng, lat]) => pt(lat!, lng!)));
        if (!rings.some((r) => r.some(([x, y]) => inFrame(frame, x, y, frame.w)))) continue;
        const d = rings.map((r) => 'M' + r.map(xy).join('L') + 'Z').join('');
        marks['base.towns'].push(
          `<path class="lm-town lm-t${t.tint % 6}" d="${d}"><title>${esc(t.name)}</title></path>`
        );
      }
    }
  }

  const max = Math.max(1, ...areas.filter((a) => a.res === 7).map((a) => a.scans));
  for (const res of RES) {
    const id = `hex.${res}` as LayerId;
    if (!want.has(id)) continue;
    const word = res === 7 ? 'Small area' : res === 6 ? 'Medium area' : 'Large area';
    for (const a of areas.filter((x) => x.res === res)) {
      const shade = res === 7 ? ` fill-opacity="${(0.2 + 0.55 * (a.scans / max)).toFixed(2)}"` : '';
      marks[id].push(
        `<polygon class="lm-h${res}" points="${hexPoints(a.cell)}"${shade} data-cell="${a.cell}" data-count="${a.scans}"><title>${word} (res ${res}): ${a.scans} scans</title></polygon>`
      );
    }
  }

  for (const g of input.geographies) {
    if (want.has('corridors')) {
      for (const s of g.segments) {
        const p = s.line.map(([lng, lat]) => pt(lat!, lng!));
        if (!p.some(([x, y]) => inFrame(frame, x, y))) continue;
        const cls = `lm-seg lm-tier${s.tier === 1 ? 1 : 2}${s.straddles ? ' lm-straddle' : ''}`;
        marks.corridors.push(
          `<polyline class="${cls}" points="${p.map(xy).join(' ')}"><title>${esc(s.name)}: ${esc(s.from)} to ${esc(s.to)}${s.straddles ? ' (crosses a town line)' : ''}</title></polyline>`
        );
      }
    }
    if (want.has('nodes')) {
      for (const n of g.nodes) {
        const [x, y] = pt(n.at[1]!, n.at[0]!);
        if (!inFrame(frame, x, y)) continue;
        marks.nodes.push(
          `<circle class="lm-node" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"><title>${esc(n.name)}</title></circle>`
        );
      }
    }
  }

  if (want.has('rings')) {
    for (const r of input.rings) {
      const cells = r.cells.filter((c) => isValidCell(c));
      if (!cells.some((c) => frameCells.includes(c))) continue;
      for (const c of cells) {
        marks.rings.push(
          `<polygon class="lm-ring lm-ring-${r.size}" points="${hexPoints(c)}"><title>Ring (${r.size})</title></polygon>`
        );
      }
    }
  }

  if (want.has('report.cells')) {
    for (const s of spots.filter((x) => getResolution(x.cell) > 7)) {
      const [la, ln] = cellToLatLng(s.cell);
      const [x, y] = pt(la, ln);
      marks['report.cells'].push(
        `<circle class="lm-spot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" data-testid="hex-cell" data-cell="${s.cell}" data-count="${s.count}"><title>Poster spot: ${s.count} scans</title></circle>`
      );
    }
  }

  const stack = LAYER_STACK.filter((l) => want.has(l.id));
  const layers: LayerSummary[] = stack.map((l) => ({ ...l, shown: marks[l.id].length }));
  // Drawn in order; each layer sits in its step's group so a reader can walk
  // the steps. Overlays (order past the rings) go last, on top.
  const body = stack
    .map(
      (l) =>
        `<g data-layer="${l.id}" data-step="${l.step}" data-order="${l.order}">${marks[l.id].join('')}</g>`
    )
    .join('');
  const label = `Layer map: ${stack
    .filter((l) => marks[l.id].length)
    .map((l) => l.label.toLowerCase())
    .join(', ')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${frame.w} ${frame.h}" role="img" aria-label="${esc(label)}" class="lm" data-testid="corridor-map">${body}</svg>`;
  return { svg, layers, areas, frame };
}
