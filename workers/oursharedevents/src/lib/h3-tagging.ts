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
 * Schema: migration 0037 adds nullable h3_res9/h3_res7 to events.
 * Backfill: rows where lat/lon IS NOT NULL AND h3_res9 IS NULL.
 */
import { latLngToCell, cellToParent, isValidCell } from 'h3-js';

export const NODE_RES = 9;
export const CORRIDOR_RES = 7;

export interface H3Tags {
  h3_res9: string;
  h3_res7: string;
}

/** Compute both NCR cells from venue coordinates. Throws on invalid input —
 *  callers are creation-time flows where failing loudly is correct. */
export function tagCoordinates(lat: number, lon: number): H3Tags {
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
  const h3_res9 = latLngToCell(lat, lon, NODE_RES);
  const h3_res7 = latLngToCell(lat, lon, CORRIDOR_RES);
  return { h3_res9, h3_res7 };
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
