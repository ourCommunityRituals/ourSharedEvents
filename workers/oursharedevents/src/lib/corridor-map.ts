/**
 * Premium corridor hex map (Epic 6 F6.3 — pulled to launch).
 *
 * DROP-IN: workers/oursharedevents/src/lib/corridor-map.ts
 *
 * Renders H3 cell densities as a SELF-CONTAINED inline SVG:
 *   – no map tiles, no external requests, no JS — CSP-clean, prints clean,
 *     drops straight into SHARED_REPORT_HTML's premium section.
 *   – honest at any density: one venue lighting one cell on day one IS the
 *     product ("watch the corridor fill in" — saturation doctrine visible).
 *   – PRIVACY FLOOR ENFORCED AT RENDER: cells under `minCount` draw as
 *     suppressed (outlined, uncounted) and are reported in the return value
 *     for _meta.suppression_reasons. The resolution-floor rule (candidate
 *     invariant; Tom question outstanding) has its enforcement point here.
 *
 * DEPTH GATE: as of SR-25, report-depth field-stripping is NOT applied in
 * the read handler. This module is called for all token roles that have
 * H3 cells tagged on the event. The client enforces the sponsor exclusion
 * list (see screen design spec). If depth-stripping is reinstated (open
 * question #1), restore the gate in shared-report-read.ts, not here.
 */
import { cellToBoundary, isValidCell } from 'h3-js';
import { CORRIDOR_MAP_MIN_COUNT } from './shared-report';

export interface CellDensity {
  cell: string;
  count: number;
  label?: string; // e.g. venue display name — optional, premium context only
}

export interface CorridorMapOptions {
  /** Suppression floor K: cells under this render suppressed. Default 5. */
  minCount?: number;
  width?: number; // SVG px, default 600
  height?: number; // SVG px, default 360
  accent?: string; // fill colour, default OSE blue
}

export interface CorridorMapResult {
  svg: string;
  rendered: number;
  suppressed: string[]; // cell ids under the floor → _meta.suppression_reasons
}

export function renderCorridorMap(
  cells: CellDensity[],
  opts: CorridorMapOptions = {}
): CorridorMapResult {
  const minCount = opts.minCount ?? CORRIDOR_MAP_MIN_COUNT;
  const width = opts.width ?? 600;
  const height = opts.height ?? 360;
  const accent = opts.accent ?? '#4361ee';

  const valid = cells.filter((c) => isValidCell(c.cell) && c.count >= 0);
  if (valid.length === 0) {
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Corridor map — no data yet" data-testid="corridor-map-empty"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="system-ui" font-size="14" fill="#5a5a5a">Corridor data accumulates with each event.</text></svg>`,
      rendered: 0,
      suppressed: [],
    };
  }

  // Boundaries in [lat, lng]; project equirectangular into the viewBox with
  // latitude-scaled longitude (fine at metro scale) and 8% padding.
  const boundaries = valid.map((c) => ({ ...c, ring: cellToBoundary(c.cell) }));
  const lats = boundaries.flatMap((b) => b.ring.map((p) => p[0]!));
  const lons = boundaries.flatMap((b) => b.ring.map((p) => p[1]!));
  const latMin = Math.min(...lats),
    latMax = Math.max(...lats);
  const lonMin = Math.min(...lons),
    lonMax = Math.max(...lons);
  const latMid = (latMin + latMax) / 2;
  const kx = Math.cos((latMid * Math.PI) / 180);
  const spanX = Math.max((lonMax - lonMin) * kx, 1e-6);
  const spanY = Math.max(latMax - latMin, 1e-6);
  const pad = 0.08;
  const scale = Math.min((width * (1 - 2 * pad)) / spanX, (height * (1 - 2 * pad)) / spanY);
  const px = (lon: number) =>
    (lon - lonMin) * kx * scale + width * pad + (width * (1 - 2 * pad) - spanX * scale) / 2;
  const py = (lat: number) =>
    height - ((lat - latMin) * scale + height * pad + (height * (1 - 2 * pad) - spanY * scale) / 2);

  const maxCount = Math.max(...valid.map((c) => c.count), 1);
  const suppressed: string[] = [];
  const polys: string[] = [];

  for (const b of boundaries) {
    const points = b.ring.map((p) => `${px(p[1]!).toFixed(1)},${py(p[0]!).toFixed(1)}`).join(' ');
    const isSuppressed = b.count < minCount;
    if (isSuppressed) {
      suppressed.push(b.cell);
      polys.push(
        `<polygon points="${points}" fill="none" stroke="#b9b4ab" stroke-width="1.5" stroke-dasharray="4 3" data-testid="hex-suppressed" data-cell="${b.cell}"><title>Activity below reporting floor</title></polygon>`
      );
    } else {
      const opacity = (0.25 + 0.65 * (b.count / maxCount)).toFixed(2);
      const label = b.label ? `${escXml(b.label)} — ${b.count} scans` : `${b.count} scans`;
      polys.push(
        `<polygon points="${points}" fill="${accent}" fill-opacity="${opacity}" stroke="${accent}" stroke-width="1" data-testid="hex-cell" data-cell="${b.cell}" data-count="${b.count}"><title>${label}</title></polygon>`
      );
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Corridor performance map" data-testid="corridor-map">${polys.join('')}</svg>`;
  return { svg, rendered: valid.length - suppressed.length, suppressed };
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
