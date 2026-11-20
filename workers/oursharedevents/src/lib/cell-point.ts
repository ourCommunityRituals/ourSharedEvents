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
import { cellToLatLng } from 'h3-js';

export function cellPoint(cell: string): string {
  return cellToLatLng(cell)
    .map((v) => v.toFixed(5))
    .join(',');
}
