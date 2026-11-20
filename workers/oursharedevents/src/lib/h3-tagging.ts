/**
 * H3 capture-time tagging (Epic 6 F6.1 — pulled to launch per Matt's gate
 * override, recorded 2026-07-17).
 *
 * DROP-IN: workers/oursharedevents/src/lib/h3-tagging.ts
 * DEPENDENCY: h3-js (runs fine in Workers; ~works in the admin/event-creation
 * path ONLY — this module must NEVER be imported by scan-path handlers.
 * The tier-equity static discipline gets a sibling: geo-tagging stays out of
 * the hot path by the same source-level test pattern — S-6.3.1c.)
 *
 * Resolutions (NCR mapping):
 *   res 9  ≈ 0.1 km²  → NODE (venue)      — h3_res9
 *   res 7  ≈ 5 km²    → CORRIDOR scale    — h3_res7
 *   Ring   = gridRing/gridDisk over res7  — computed, never stored
 *
 * The res-9 cell is the place. The res-7 cell is always its parent
 * (OSE-2199): an H3 child is not drawn exactly inside its parent, so the res-7
 * cell of the point itself can differ from the parent of the point's res-9
 * cell near a res-7 edge (21 of the 397 stock events). Taking res 7 from the
 * point split one block between two areas and failed `tagsConsistent`.
 *
 * At a seam (OSE-2199, owner 2026-11-19: "at those moments, fallback to the
 * address to distinguish which H3 to select"): when a geocoded point is
 * within the geocoder's likely error of a res-9 edge, the address chooses
 * the cell from the cells in reach (`tagPlace`). Away from a seam, and for a
 * point with no stated precision, the cell is the point's cell.
 *
 * Schema: migration 0037 adds nullable h3_res9/h3_res7 to events.
 * Backfill: rows where lat/lon IS NOT NULL AND h3_res9 IS NULL.
 */
import {
  latLngToCell,
  cellToParent,
  isValidCell,
  originToDirectedEdges,
  directedEdgeToBoundary,
  getDirectedEdgeDestination,
} from 'h3-js';

export const NODE_RES = 9;
export const CORRIDOR_RES = 7;

export interface H3Tags {
  h3_res9: string;
  h3_res7: string;
}

function assertOnGlobe(lat: number, lon: number): void {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw new Error(`invalid coordinates: ${lat},${lon}`);
  }
}

/** Both cells from a chosen res-9 cell: res 7 is its parent, never another. */
function tagsOf(res9: string): H3Tags {
  return { h3_res9: res9, h3_res7: cellToParent(res9, CORRIDOR_RES) };
}

/** Compute both NCR cells from venue coordinates. Throws on invalid input —
 *  callers are creation-time flows where failing loudly is correct. */
export function tagCoordinates(lat: number, lon: number): H3Tags {
  assertOnGlobe(lat, lon);
  return tagsOf(latLngToCell(lat, lon, NODE_RES));
}

/** Consistency check for stored tags (CI/data-quality use):
 *  both cells valid AND res9's parent at res7 equals the stored res7. */
export function tagsConsistent(tags: H3Tags): boolean {
  return (
    isValidCell(tags.h3_res9) &&
    isValidCell(tags.h3_res7) &&
    cellToParent(tags.h3_res9, CORRIDOR_RES) === tags.h3_res7
  );
}

/** Null-tolerant helper for update paths: tag when coords exist, else null. */
export function maybeTag(lat: number | null, lon: number | null): H3Tags | null {
  if (lat === null || lon === null) return null;
  return tagCoordinates(lat, lon);
}

// ─── Seams (OSE-2199) ─────────────────────────────────────────────────────────

/** How exact a geocoded point is: the geocoder's `geometry.location_type`. */
export const POINT_PRECISIONS = [
  'ROOFTOP',
  'RANGE_INTERPOLATED',
  'GEOMETRIC_CENTER',
  'APPROXIMATE',
] as const;
export type PointPrecision = (typeof POINT_PRECISIONS)[number];

export function isPointPrecision(v: unknown): v is PointPrecision {
  return typeof v === 'string' && (POINT_PRECISIONS as readonly string[]).includes(v);
}

/**
 * Metres: a point this near a res-9 edge sits at a seam. The margin is how far
 * two lookups of one address can land apart, by how exact the geocoder says
 * the point is, so a later lookup on the other side of the edge still reaches
 * the same cells.
 *
 *   ROOFTOP 10: the point is on the building at that address; another lookup of
 *     it, or of the business there, lands on the same lot, about a frontage away.
 *   RANGE_INTERPOLATED 25: estimated along the street line between two known
 *     house numbers; a later lookup that finds the building moves it by the
 *     setback and the guess along the street, tens of metres.
 *   GEOMETRIC_CENTER 25: the centre of the building or lot outline; the rooftop
 *     or entrance can be anywhere inside it.
 *   APPROXIMATE 50: no stated precision; capped (below).
 *
 * A point with no stated precision (coordinates the organizer or automation
 * sent) gets no margin: the point is taken as placed.
 */
export const SEAM_MARGIN_M: Readonly<Record<PointPrecision, number>> = Object.freeze({
  ROOFTOP: 10,
  RANGE_INTERPOLATED: 25,
  GEOMETRIC_CENTER: 25,
  APPROXIMATE: 50,
});

/**
 * No margin is larger. A res-9 cell is about 175 m from its centre to an edge
 * (never under 120 m in a sample of 20,000 cells worldwide, pentagons
 * included), so at 50 m only the point's own cell and the neighbours across
 * its nearest edges are in reach, and the address can move a place at most
 * 50 m past an edge, never a whole cell.
 */
export const SEAM_MARGIN_MAX_M = 50;

/** The seam margin for a precision; 0 when the precision is not known. */
export function seamMarginMeters(precision: unknown): number {
  return isPointPrecision(precision) ? SEAM_MARGIN_M[precision] : 0;
}

const ADDRESS_KEY_MAX = 500;

/**
 * The address as a key: Unicode-folded (accents dropped), lower case, every
 * run of characters that are not letters or digits made one space, trimmed.
 * "13328 Olde Western Ave." and "13328  OLDE WESTERN AVE" are one key. Null
 * when nothing is left (no text, or punctuation only). Held in memory to choose
 * a cell; never stored and never logged.
 */
export function normaliseAddressKey(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  const key = address
    .slice(0, ADDRESS_KEY_MAX)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return key || null;
}

/** 32-bit FNV-1a over UTF-16 code units, then the murmur3 finaliser. */
function score(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The cell the address picks: highest score of (address, cell), ties to the
 * lower cell id. The pick depends only on the address and the set of cells, so
 * two lookups of one address that reach the same cells pick the same one,
 * whichever side of the edge each point fell on. Dropping a cell that was not
 * picked never changes the pick.
 */
function pickByAddress(key: string, cells: readonly string[]): string {
  let best = cells[0];
  let bestScore = score(`${key}\u0000${best}`);
  for (const cell of cells.slice(1)) {
    const s = score(`${key}\u0000${cell}`);
    if (s > bestScore || (s === bestScore && cell < best)) {
      best = cell;
      bestScore = s;
    }
  }
  return best;
}

const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

/** Metres from a point to a polyline of [lat, lng] vertices (local plane). */
function metresToPolyline(lat: number, lon: number, line: readonly number[][]): number {
  const kx = Math.cos(lat * RAD) * EARTH_RADIUS_M * RAD;
  const ky = EARTH_RADIUS_M * RAD;
  const xy = line.map(([vLat, vLng]) => {
    let dLng = vLng - lon;
    if (dLng > 180) dLng -= 360;
    if (dLng < -180) dLng += 360;
    return [dLng * kx, (vLat - lat) * ky];
  });
  let best = Infinity;
  for (let i = 0; i + 1 < xy.length; i++) {
    const [ax, ay] = xy[i];
    const [bx, by] = xy[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/**
 * The point's own res-9 cell first, then each neighbour whose shared edge is
 * within `margin` metres of the point, in id order.
 */
export function cellsInReach(lat: number, lon: number, margin: number): string[] {
  assertOnGlobe(lat, lon);
  const own = latLngToCell(lat, lon, NODE_RES);
  if (!(margin > 0)) return [own];
  const reach = Math.min(margin, SEAM_MARGIN_MAX_M);
  const near: string[] = [];
  for (const edge of originToDirectedEdges(own)) {
    const d = metresToPolyline(lat, lon, directedEdgeToBoundary(edge));
    if (d <= reach) near.push(getDirectedEdgeDestination(edge));
  }
  return [own, ...near.sort()];
}

/**
 * How the res-9 cell was chosen:
 *   off_seam     no edge within the margin: the point's cell, as before;
 *   address      at a seam: the address chose among the cells in reach (it may
 *                be the point's own cell);
 *   no_precision the point's precision is not known, so no margin: the point's
 *                cell;
 *   no_address   at a seam, but no address or one with no letters or digits:
 *                the point's cell.
 */
export type SeamChoice = 'off_seam' | 'address' | 'no_precision' | 'no_address';

export interface PlaceTags extends H3Tags {
  seam: SeamChoice;
  /** Cells in reach of the point, its own included (1 off a seam). */
  candidates: number;
}

/**
 * The cells of a looked-up place. The res-9 cell is the point's cell unless the
 * point is at a seam for its precision; there the address picks one of the
 * cells in reach. The res-7 cell is always the parent of the res-9 cell. Throws
 * on invalid coordinates, as `tagCoordinates` does; never on the address.
 */
export function tagPlace(
  lat: number,
  lon: number,
  opts: { precision?: unknown; address?: unknown } = {}
): PlaceTags {
  const margin = seamMarginMeters(opts.precision);
  const cells = cellsInReach(lat, lon, margin);
  const own = tagsOf(cells[0]);
  if (margin <= 0) return { ...own, seam: 'no_precision', candidates: 1 };
  if (cells.length === 1) return { ...own, seam: 'off_seam', candidates: 1 };
  const key = normaliseAddressKey(opts.address);
  if (key === null) return { ...own, seam: 'no_address', candidates: cells.length };
  return { ...tagsOf(pickByAddress(key, cells)), seam: 'address', candidates: cells.length };
}
