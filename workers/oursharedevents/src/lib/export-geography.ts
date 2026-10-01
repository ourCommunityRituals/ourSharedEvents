// ─── Export geography: corridor grain only ─────────────────────────────────────
//
// OSE-616 (QR Path to Done, rung 5). The H3 layer is the geography model:
//
//   res9 node  — physical places only: a poster's placement, and live QR scans
//                at the event's venue during the event. Nothing else is res9.
//   res7 node  — the corridor. This is the corridor id the warehouse sees, and
//                the finest grain anything other than those two ever carries.
//
// Every row that crosses the D1 → BigQuery boundary is at corridor grain or
// coarser. A res9 node, a coordinate, an address or a placement reference is
// sub-corridor geography and must never leave. The SELECT lists in the
// exporters already omit those columns; this guard is the structural check on
// the row actually handed to BigQuery. It THROWS rather than filtering: a row
// that would leak is a bug, and the phase fails closed (no watermark advance)
// instead of shipping a quietly trimmed row.

import { getResolution, isValidCell } from 'h3-js';

/** Column names that carry sub-corridor geography. */
const SUB_CORRIDOR_KEY =
  /^(h3(_res\d+)?|cell|lat|lon|lng|latitude|longitude|where_address|address|poster_deployment_id|placement_id|placement_label|qr_token)$/i;

/** Finest H3 resolution allowed out of the boundary (the corridor node). */
export const CORRIDOR_H3_RESOLUTION = 7;

/**
 * H3 index (cell mode): 15 hex chars, mode nibble 8. Case-insensitive: h3-js
 * writes lowercase, but nothing in D1 constrains case, so an imported
 * uppercase cell must not slip past the guard as "not an H3 value".
 */
const H3_CELL = /^8[0-9a-f]{14}$/i;

/** The resolution of an H3 cell string, or null when the value is not one. */
export function h3Resolution(value: unknown): number | null {
  if (typeof value !== 'string' || !H3_CELL.test(value)) return null;
  return parseInt(value[1], 16);
}

export class ExportGeographyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportGeographyError';
  }
}

/** The exported corridor id when an event or bucket has no corridor node. */
export const UNKNOWN_CORRIDOR = 'unknown';

/**
 * True when a stored value is a real H3 cell, in any case spelling. This only
 * VALIDATES a value already written at capture time (events.ts computes the
 * cells); it never computes one. It lives here, in the module that owns what a
 * real corridor cell is, so the SharedReport pipeline lib (shared-report.ts)
 * keeps no h3-js import of its own (OSE-490 Gate 7).
 */
export function isH3Cell(value: unknown): boolean {
  return typeof value === 'string' && H3_CELL.test(value) && isValidCell(value.toLowerCase());
}

/** True when a corridor id is a real corridor: a valid H3 cell at res7 or coarser. */
export function isCorridorId(value: unknown): boolean {
  if (typeof value !== 'string' || !H3_CELL.test(value)) return false;
  const cell = value.toLowerCase();
  return isValidCell(cell) && getResolution(cell) <= CORRIDOR_H3_RESOLUTION;
}

/**
 * The corridor id to export for a stored value (ADR-011: the corridor is the
 * res7 node). A value shaped like an H3 cell is lowercased (H3 addresses are
 * case-insensitive, warehouse grouping is not, so one corridor must have one
 * spelling) and otherwise passed through, so the row guard judges it (a res9
 * or malformed cell fails the phase closed). Anything else is not geography
 * at all — absent, or a legacy named id such as the pre-H3 `corridors.id` —
 * and becomes the explicit 'unknown' sentinel rather than an opaque string the
 * warehouse would treat as a corridor.
 */
export function canonicalCorridorId(value: unknown): string {
  if (typeof value === 'string' && H3_CELL.test(value)) return value.toLowerCase();
  return UNKNOWN_CORRIDOR;
}

/**
 * Throw if a row bound for BigQuery carries anything finer than a corridor:
 * a sub-corridor column name, any value that is an H3 cell finer than res7, or
 * a corridor_id that is neither a valid res7-or-coarser H3 cell nor 'unknown'.
 */
export function assertCorridorGrainRow(row: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(row)) {
    if (SUB_CORRIDOR_KEY.test(key)) {
      throw new ExportGeographyError(`export row carries sub-corridor column "${key}"`);
    }
    const res = h3Resolution(value);
    if (res !== null && res > CORRIDOR_H3_RESOLUTION) {
      throw new ExportGeographyError(
        `export row field "${key}" is an H3 res${res} cell — finer than the res${CORRIDOR_H3_RESOLUTION} corridor`
      );
    }
  }
  if (
    'corridor_id' in row &&
    row.corridor_id !== UNKNOWN_CORRIDOR &&
    !isCorridorId(row.corridor_id)
  ) {
    throw new ExportGeographyError(
      `export row corridor_id ${JSON.stringify(row.corridor_id)} is not a res${CORRIDOR_H3_RESOLUTION}-or-coarser H3 cell or '${UNKNOWN_CORRIDOR}'`
    );
  }
}
