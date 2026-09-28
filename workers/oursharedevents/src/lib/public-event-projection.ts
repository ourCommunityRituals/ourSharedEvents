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
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (PUBLIC_EVENT_FIELDS.has(key)) out[key] = row[key];
  }
  return out;
}

export { PUBLIC_EVENT_COLUMNS, PUBLIC_EVENT_COMPUTED, PUBLIC_EVENT_FIELDS };
