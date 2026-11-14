// ─── The series a public event sits on (OSE-2018, OSE ADR-029 amendment) ──────────
//
// A reader outside admin (ourWKRP building the creator showcase) needs to see
// that an event sits on a series an organizer declared or confirmed. This is
// the one place that decides what such a reader sees.
//
// WHAT IS SHOWN: five fields, the programme's label and schedule. Not the
// lifecycle state (only `confirmed` is ever shown, so it would say nothing),
// not the anchor event, not when or how the series began, not a rejection
// reason, and no count.
//
// WHEN: only a `confirmed` series whose anchor event is in the event's own
// brand. `event_series` has no brand column; a series' brand is its anchor's
// (owner ruling 2026-10-01, OSE-1421). A pending suggestion is the detector's
// guess and a rejected one is the organizer's no; neither is published.
//
// HOW IT TRAVELS: as a sibling of the event (`series` beside `item` / `items`),
// like `sponsor_titles`. The public event projection, its API snapshot and
// brain invariant 16 are untouched, and `series_id` stays off the public
// column list.
//
// Fails to empty, as the sponsor titles do: an event read without its series is
// correct, a public read that errors because of it is not.

/** Every field a public series object carries. Additions are decisions. */
export const PUBLIC_SERIES_FIELDS = [
  'id',
  'name',
  'cadence',
  'day_of_week',
  'hour_of_day',
] as const;

export interface PublicSeries {
  id: string;
  name: string;
  cadence: string | null;
  day_of_week: number | null;
  hour_of_day: number | null;
}

interface PublicSeriesRow extends PublicSeries {
  event_id: string;
}

// Two statements, each whole: the brand (or the event id held from the path) is
// bound inside the statement itself, so the tenant-isolation gate can read it
// (tests/e2e/0-architecture/tenant-isolation.invariant.spec.ts). Both carry the
// same two rules: `confirmed` only, and the anchor in the event's own brand.
const PUBLIC_SERIES_BY_BRAND_SQL = `SELECT e.id AS event_id, es.id AS id, es.series_name AS name, es.cadence AS cadence,
          es.day_of_week AS day_of_week, es.hour_of_day AS hour_of_day
     FROM events e
     JOIN event_series es ON es.id = e.series_id
     JOIN events anchor ON anchor.id = es.venue_id AND anchor.brand_id = e.brand_id
    WHERE e.brand_id = ? AND es.state = 'confirmed'
    LIMIT 1000`;

const PUBLIC_SERIES_OF_EVENT_SQL = `SELECT e.id AS event_id, es.id AS id, es.series_name AS name, es.cadence AS cadence,
          es.day_of_week AS day_of_week, es.hour_of_day AS hour_of_day
     FROM events e
     JOIN event_series es ON es.id = e.series_id
     JOIN events anchor ON anchor.id = es.venue_id AND anchor.brand_id = e.brand_id
    WHERE e.id = ? AND es.state = 'confirmed'`;

/** Field by field: a column added to the query does not travel by itself. */
function toPublicSeries(row: PublicSeriesRow): PublicSeries {
  return {
    id: row.id,
    name: row.name,
    cadence: row.cadence,
    day_of_week: row.day_of_week,
    hour_of_day: row.hour_of_day,
  };
}

/** The confirmed series of each of `brandId`'s events, keyed by event id. */
export async function fetchPublicSeriesByEvent(
  db: D1Database | undefined | null,
  brandId: string
): Promise<Map<string, PublicSeries>> {
  const out = new Map<string, PublicSeries>();
  try {
    if (!db) return out;
    const rs = await db.prepare(PUBLIC_SERIES_BY_BRAND_SQL).bind(brandId).all<PublicSeriesRow>();
    for (const r of rs.results ?? []) out.set(r.event_id, toPublicSeries(r));
  } catch {
    /* fail open: no series, never a broken list */
  }
  return out;
}

/** The confirmed series one event sits on, or null. */
export async function fetchPublicSeriesOf(
  db: D1Database | undefined | null,
  eventId: string
): Promise<PublicSeries | null> {
  try {
    if (!db) return null;
    const row = await db.prepare(PUBLIC_SERIES_OF_EVENT_SQL).bind(eventId).first<PublicSeriesRow>();
    return row ? toPublicSeries(row) : null;
  } catch {
    return null;
  }
}
