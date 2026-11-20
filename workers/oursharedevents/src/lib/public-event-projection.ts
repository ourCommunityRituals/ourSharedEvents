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
// THEN `lat` AND `lon` CAME OUT (OSE-2197). The location-precision policy
// OSE-1245 was waiting on is decided (owner, 2026-11-19): "It should resolve to
// the H3", and "the entire data set should be resolving to the H3 layer and the
// map item, and then use the address as a secondary source." A place in a
// public answer is its cell — `h3_res7` and `corridor_id`, resolution 7, as
// before — never the event's stored point. (The address in that ruling is a
// tie-break for WHICH cell an event belongs to when its point sits near a cell
// edge, decided when the event is saved: OSE-2199, owner's clarification of the
// same day. It is not a second source for a public answer; `where_address`, the
// host's own text, is published as it always was.) Nothing here gives a
// coordinate in place of the point: no consumer
// in this repo needs one, and one that does takes the cell's centre from the
// cell (`cellToLatLng(h3_res7)`), at this answer's own resolution and no finer.
// The stored point stays in the database for admin, tagging and geocoding;
// tests/e2e/0-architecture/public-event-coordinates.invariant.spec.ts fails a
// coordinate named here, and Bruno checks the answers on staging.
//
// Still left as they were: `where_address` and `brand_id`.

import { publishCount } from './count-floor';
import { attendanceModeOf } from './attendance-mode';

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
  // NOT lat, lon (OSE-2197, owner 2026-11-19): a public answer resolves to the
  // cell below, never the stored point.
  'corridor_id',
  'h3_res7',
  // OSE-2012 (owner, 2026-11-12) — 'in_person', 'online' or 'both'. The ONLY
  // field the online-or-in-person story adds. No meeting link is here, and none
  // is stored: a visitor reaches one through the event's own /s code.
  'attendance_mode',
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
 * From the floor up every count is rounded down to a multiple of 5 (OSE-2151,
 * owner ruling 2026-11-18), so the one publisher is `publishCount`; an exact
 * publisher is no longer permitted.
 */
const COUNT_PUBLISHERS = {
  publishCount: (v: unknown) => publishCount(Number(v)).count,
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

/**
 * Fields whose NAME reads like a count and whose value is one of a fixed set of
 * words (OSE-2012). `attendance_mode` says how an event is held; it is not how
 * many attended. Each goes through its function here, which can only return one
 * of its words, so no number is ever published under such a name. The derived
 * spec (tests/count-floor-publication.derived.spec.ts) accepts a count-shaped
 * field only when it is declared here or in PUBLIC_EVENT_COUNT_SOURCES.
 */
const PUBLIC_EVENT_WORD_FIELDS: Readonly<Record<string, (v: unknown) => string>> = {
  attendance_mode: attendanceModeOf,
};

/** The projection itself, with its field list and count declarations passed in. */
export function projectEvent(
  row: Record<string, unknown>,
  fields: ReadonlySet<string>,
  sources: Readonly<Record<string, CountPublisher>>
): Record<string, unknown> {
  const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (!fields.has(key)) continue;
    if (own(PUBLIC_EVENT_WORD_FIELDS, key)) {
      out[key] = PUBLIC_EVENT_WORD_FIELDS[key]!(row[key]);
      continue;
    }
    const publisher = own(sources, key) ? sources[key] : null;
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
  PUBLIC_EVENT_WORD_FIELDS,
};
