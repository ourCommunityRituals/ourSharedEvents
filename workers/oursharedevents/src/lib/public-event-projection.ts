// ─── The public event projection ───────────────────────────────────────────────
//
// OSE-1247. What `GET /api/v2/events` emits was, until this module, "whatever
// the SELECT happens to project" — `enrichWithPhase` spreads `...row`, so every
// column added to the query for any internal reason reached the public JSON.
//
// The API snapshot recorded 24 projected columns, so the wide shape was
// DECLARED rather than accidental. But a snapshot that records the projection
// documents it; it does not decide it. `template_id` proves the difference: it
// was emitted publicly and was not in the snapshot at all. Nothing broke,
// nothing complained, and the contract quietly grew.
//
// This module makes the projection a decision. A column added to the SELECT
// tomorrow does not reach the public response unless someone adds it here.
//
// WHAT CAME OUT, AND WHY ONLY THIS ONE.
//
//   h3_res9 — the NCR *Node* cell, ~201 m edge / 0.105 km².
//
// `GET /api/v2/events/map` refuses to ACCEPT a res-9 cell: a caller cannot
// narrow a map query below corridor resolution, because the precision floor is
// the privacy floor (OSE-1242). The list was EMITTING res 9 at the same time.
// The floor was enforced inbound and not outbound, which made the map's
// guarantee weaker than it looked — the finer cell was one request away on a
// different endpoint.
//
// Nothing reads it. The two surfaces that render an `h3_res9` do so from poster
// DEPLOYMENT objects, not from event list items.
//
// Everything else is left exactly as it was. Narrowing further — `lat`/`lon`,
// `where_address`, `brand_id` — is a real contract change with consumers to
// audit, and OSE-1245 has to decide the location-precision policy first. Doing
// it here would be guessing at that decision rather than implementing it.

import { applyCountFloor, roundForPublish } from './count-floor';

/** Columns of `events` that a public response may carry. Additions are decisions. */
const PUBLIC_EVENT_COLUMNS = [
  'id',
  'brand_id',
  'title',
  'slug',
  'status',
  'description',
  'location',
  'start_date',
  'end_date',
  'timezone',
  // OSE-1313 — the canonical UTC start instant (null for date-only events).
  // Additive; carries no identity. Surfaces render it in `timezone`.
  'starts_at',
  'cover_image_url',
  'created_at',
  'updated_at',
  'legal_clearance_tier',
  'what_short',
  'who_host',
  'why_purpose',
  'how_details',
  'where_address',
  'lat',
  'lon',
  'corridor_id',
  'h3_res7',
  // NOT template_id. It looked like contract drift — emitted publicly, absent
  // from the snapshot — but it exists only in the MOCK fixture; the real SELECT
  // never projects it. Adding it here would have made mock responses carry a
  // field real ones do not. The api-response-schema gate caught the mistake by
  // asserting the snapshot's columns are actually in the query.
] as const;

/** Fields computed by `enrichWithPhase` rather than read from a column. */
const PUBLIC_EVENT_COMPUTED = ['name', 'startDateISO', 'venue', 'phase'] as const;

const PUBLIC_EVENT_FIELDS: ReadonlySet<string> = new Set<string>([
  ...PUBLIC_EVENT_COLUMNS,
  ...PUBLIC_EVENT_COMPUTED,
]);

/**
 * Reduce an enriched row to the fields a public response may carry.
 *
 * An allowlist, not a denylist: a field nobody decided to publish is absent by
 * default. The inverse — remembering to strip each new internal column — is the
 * shape that produced this ticket.
 */
export function toPublicEvent(row: Record<string, unknown>): Record<string, unknown> {
  return projectEvent(row, PUBLIC_EVENT_FIELDS, PUBLIC_EVENT_COUNT_SOURCES);
}

/**
 * The count-floor.ts functions that may produce a published count field, each
 * taking the raw value and returning what is published. A field declared in
 * PUBLIC_EVENT_COUNT_SOURCES goes through its function here, so the declaration
 * is the transformation and not a note beside it (OSE-1782).
 *
 * Every publisher withholds (null) a count under the floor: rounding alone would
 * turn 0..4 into a published 0, which reads as "none" and not "fewer than 5".
 */
const COUNT_PUBLISHERS = {
  applyCountFloor: (v: unknown) => applyCountFloor(Number(v)).count,
  roundForPublish: (v: unknown) => {
    const floored = applyCountFloor(Number(v)).count;
    return floored === null ? null : roundForPublish(floored);
  },
} as const;

type CountPublisher = keyof typeof COUNT_PUBLISHERS;

/**
 * Fields in the list above that carry a count, each mapped to the `count-floor.ts`
 * function that produces it (OSE-1782). Empty today: no public event field is a
 * count. A count added to the projection is declared here, which makes
 * `projectEvent` run it through that function, and the derived spec
 * (tests/count-floor-publication.derived.spec.ts) fails the build for a
 * count-shaped field that is not declared, so no surface formats its own number.
 */
const PUBLIC_EVENT_COUNT_SOURCES: Readonly<Record<string, CountPublisher>> = {};

/** The projection itself, with its field list and count declarations passed in. */
export function projectEvent(
  row: Record<string, unknown>,
  fields: ReadonlySet<string>,
  sources: Readonly<Record<string, CountPublisher>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (!fields.has(key)) continue;
    const publisher = Object.prototype.hasOwnProperty.call(sources, key) ? sources[key] : null;
    out[key] = publisher ? COUNT_PUBLISHERS[publisher](row[key]) : row[key];
  }
  return out;
}

export {
  COUNT_PUBLISHERS,
  PUBLIC_EVENT_COLUMNS,
  PUBLIC_EVENT_COMPUTED,
  PUBLIC_EVENT_COUNT_SOURCES,
  PUBLIC_EVENT_FIELDS,
};
