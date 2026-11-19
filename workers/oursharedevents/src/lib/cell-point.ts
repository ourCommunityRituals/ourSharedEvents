/**
 * The one point a public page may give for an event's place (OSE-2196).
 *
 * Owner rulings, 2026-11-19: "It should resolve to the H3", and "it should not
 * go to the center of the cell, it should go to the Res9 if possible." Place,
 * not person (AGENTS.md invariant 3): a public page never carries the event's
 * stored lat and lon. Where a coordinate is needed at all (a maps link cannot
 * take a hexagon), it is the point of the event's res-9 cell, about a block;
 * the res-7 area's point only when the event has no res-9 cell.
 *
 * Reads the stored cell ids only (h3_res9, h3_res7, written by lib/h3-tagging
 * when the place is saved). It never reads lat or lon, so the stored point
 * cannot reach a caller through it.
 */
import { cellToLatLng, getResolution, isValidCell } from 'h3-js';

/** The cell columns of an `events` row. */
export interface EventCells {
  h3_res9?: unknown;
  h3_res7?: unknown;
}

export interface CellPoint {
  lat: number;
  lon: number;
  /** Which cell the point is from: 9 (a block), or 7 (the area) when there is no res-9 cell. */
  res: 9 | 7;
}

function pointOf(cell: unknown, res: 9 | 7): CellPoint | null {
  if (typeof cell !== 'string' || !isValidCell(cell) || getResolution(cell) !== res) return null;
  const [lat, lon] = cellToLatLng(cell);
  return { lat, lon, res };
}

/** The event's res-9 cell point, else its res-7 area point, else null. */
export function eventCellPoint(e: EventCells): CellPoint | null {
  return pointOf(e.h3_res9, 9) ?? pointOf(e.h3_res7, 7);
}
