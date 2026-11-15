// ─── The stalls of a public fair (OSE-1998, OSE ADR-034 decisions 1 and 5) ──────
//
// A fair is one event with many stalls inside it. A reader outside admin (the
// fair's own page, a hall plan later, ourWKRP) needs the stalls a visitor can
// walk up to. This is the one place that decides what such a reader sees.
//
// WHAT IS SHOWN: six fields. The stall's id, the number the organizer uses, the
// trading name, the category, and its spot on the hall plan as two fractions of
// the plan (0 to 1), never a coordinate on earth. Not whether it is in use
// (only stalls in use are shown, so it would say nothing), not the organizer's
// sort key, not when it was made or changed, not its event (the reader asked
// for that event), not its codes or placements, no cell and no count.
//
// WHEN: only stalls in use, of an event whose public read answers. A stall
// takes its brand from its event (no brand column), so the statement binds the
// event's own brand as well as its id: a stall is read only through the event
// the public read already returned.
//
// HOW IT TRAVELS: as a sibling of the event (`booths` beside `item`), like
// `series`. The public event projection is untouched. It is on the single
// event read only, not on the list read: a fair can hold hundreds of stalls,
// and the list read carries every event of a brand.
//
// Fails to empty, as the series does: an event read without its stalls is
// correct, a public read that errors because of them is not.

/** Every field a public stall carries. Additions are decisions. */
export const PUBLIC_BOOTH_FIELDS = [
  'id',
  'number',
  'name',
  'category',
  'hall_x',
  'hall_y',
] as const;

/**
 * The most stalls one read returns. The bulk entry takes 200 at a time; a fair
 * with more than this many stalls is not one this read was built for.
 */
export const PUBLIC_BOOTHS_MAX = 1000;

export interface PublicBooth {
  id: string;
  number: string;
  name: string;
  category: string | null;
  hall_x: number | null;
  hall_y: number | null;
}

// The event id held from the path and the event's own brand are both bound
// inside the statement, so the tenant-isolation gate can read it
// (tests/e2e/0-architecture/tenant-isolation.invariant.spec.ts). The order is
// the organizer's: sort, then number (read in any case, as the column is), then
// id so two reads never disagree.
const PUBLIC_BOOTHS_OF_EVENT_SQL = `SELECT b.id AS id, b.number AS number, b.name AS name, b.category AS category,
          b.hall_x AS hall_x, b.hall_y AS hall_y
     FROM event_booths b
     JOIN events e ON e.id = b.event_id
    WHERE b.event_id = ? AND e.brand_id = ? AND b.is_active = 1
    ORDER BY b.sort ASC, b.number ASC, b.id ASC
    LIMIT ${PUBLIC_BOOTHS_MAX}`;

// One stall by the number a visitor reads off the table card. `number` is
// COLLATE NOCASE in the schema (migration 0109), so "a12" finds "A12".
const PUBLIC_BOOTH_BY_NUMBER_SQL = `SELECT b.id AS id, b.number AS number, b.name AS name, b.category AS category,
          b.hall_x AS hall_x, b.hall_y AS hall_y
     FROM event_booths b
     JOIN events e ON e.id = b.event_id
    WHERE b.event_id = ? AND e.brand_id = ? AND b.number = ? AND b.is_active = 1
    LIMIT 1`;

/** Field by field: a column added to the query does not travel by itself. */
function toPublicBooth(row: PublicBooth): PublicBooth {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    category: row.category,
    hall_x: row.hall_x,
    hall_y: row.hall_y,
  };
}

/** The stalls in use of one event of `brandId`, in the organizer's order. */
export async function fetchPublicBoothsOf(
  db: D1Database | undefined | null,
  eventId: string,
  brandId: string
): Promise<PublicBooth[]> {
  try {
    if (!db || !eventId || !brandId) return [];
    const rs = await db
      .prepare(PUBLIC_BOOTHS_OF_EVENT_SQL)
      .bind(eventId, brandId)
      .all<PublicBooth>();
    return (rs.results ?? []).map(toPublicBooth);
  } catch {
    /* fail open: no stalls, never a broken event read */
    return [];
  }
}

/**
 * One stall in use of one event of `brandId`, by its number, or null. Throws on
 * a database error, so the page can tell "no such stall" from "try again".
 */
export async function fetchPublicBoothByNumber(
  db: D1Database,
  eventId: string,
  brandId: string,
  number: string
): Promise<PublicBooth | null> {
  const row = await db
    .prepare(PUBLIC_BOOTH_BY_NUMBER_SQL)
    .bind(eventId, brandId, number)
    .first<PublicBooth>();
  return row ? toPublicBooth(row) : null;
}
