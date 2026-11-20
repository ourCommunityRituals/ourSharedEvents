/**
 * A cell's own centre, as a page may write it: five decimals of the H3 cell
 * id's centre, "lat,lng", and nothing else (OSE-2198; AGENTS.md invariant 3,
 * place, not person).
 *
 * The one place a page's point for a place is made, so every use writes the
 * same value: the map's area centre (a res-7 cell) and, zoomed in, each place's
 * own point (its res-9 cell), which the map's script measures "where am I" to
 * (lib/attendee-map.ts, lib/map-pan-script.ts). A link that needs a point for a
 * place takes it from here too. A pure function of the cell id: moving an
 * event anywhere inside its cell changes no byte.
 *
 * The cell-only gate (tests/map-georef-cell-only.spec.ts, and the Bruno check
 * in bruno/ose-pages/16. Landing Map Zoom) pins these values per cell, worked
 * out from the cell id on its own, and allows each one only where it belongs.
 * A new place on a page that writes this value needs that gate widened for it,
 * with a security review and the owner's sign-off.
 */
import { cellToLatLng, getResolution, isValidCell } from 'h3-js';

export function cellPoint(cell: string): string {
  return cellToLatLng(cell)
    .map((v) => v.toFixed(5))
    .join(',');
}

// ── An event's point (OSE-2196) ───────────────────────────────────────────────
//
// Owner rulings, 2026-11-19: "It should resolve to the H3", and "it should not
// go to the center of the cell, it should go to the Res9 if possible." A public
// page never carries an event's stored lat and lon. Where a coordinate is
// needed at all (a maps link cannot take a hexagon), it is cellPoint of the
// event's res-9 cell, about a block; of its res-7 area only when it has no
// res-9 cell. Reads the stored cell ids only, never lat or lon, so the stored
// point cannot reach a caller through it. Shared with OSE-2198 (#1491): the
// same cellPoint, so the map and the directions write one value per cell.

/** The cell columns of an `events` row. */
export interface EventCells {
  h3_res9?: unknown;
  h3_res7?: unknown;
}

export interface EventCellPoint {
  /** cellPoint of the cell: "lat,lng", five decimals. */
  point: string;
  /** Which cell: 9 (a block), or 7 (the area) when there is no res-9 cell. */
  res: 9 | 7;
}

function pointOf(cell: unknown, res: 9 | 7): EventCellPoint | null {
  if (typeof cell !== 'string' || !isValidCell(cell) || getResolution(cell) !== res) return null;
  return { point: cellPoint(cell), res };
}

/** The event's res-9 cell point, else its res-7 area point, else null. */
export function eventCellPoint(e: EventCells): EventCellPoint | null {
  return pointOf(e.h3_res9, 9) ?? pointOf(e.h3_res7, 7);
}
