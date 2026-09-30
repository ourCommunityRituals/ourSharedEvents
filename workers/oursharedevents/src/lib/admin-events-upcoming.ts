// ─── Admin events list — "Soonest first" ordering + its own cursor ─────────────
//
// TRIANGLE screen map, next slice #4: `GET /api/v2/admin/events?sort=upcoming`.
//
// The default list is newest-CREATED first (created_at DESC), which answers
// "what did I just make". An organizer coming back mid-season asks a different
// question — "what is next" — so this ordering reorders the SAME set (same
// brand scope, same status / mine filters; nothing is dropped) into three bands:
//
//   0  coming up   start_date on or after the floor, soonest first
//   1  undated     no start_date yet (usually a draft), by id
//   2  past        start_date before the floor, most recent first
//
// THE FLOOR IS "TODAY SOMEWHERE". start_date is a local calendar date with no
// zone math in SQL, and an organizer in Chicago at 8 pm is already "tomorrow" in
// UTC. So the floor is the UTC calendar date 12 hours ago: an event dated D is
// still coming up while it is D (or earlier) anywhere west of the date line.
// Erring early costs a just-finished event a few hours at the top of the list;
// erring late would drop tonight's event to the bottom while it is happening.
//
// ITS OWN CURSOR. created_at cannot page a list ordered by date, so the cursor
// is the last row's position in the ordering — (band, start_date, starts_at,
// id) — plus the floor it was computed against, so paging across midnight does
// not reshuffle bands between page one and page two. It is opaque to the
// client: `u1.` + base64url(JSON). Anything that does not decode to exactly
// that shape is refused (400), never guessed at.
//
// Every value reaches SQL as a bound parameter. The band expression appears
// several times; `upcomingSql` returns the fragments together with their binds
// in text order so a caller cannot mis-order them.

export const UPCOMING_CURSOR_PREFIX = 'u1.';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CURSOR_LEN = 512;

export type UpcomingBand = 0 | 1 | 2;

export interface UpcomingCursor {
  /** Floor date (YYYY-MM-DD) page one was computed against. */
  f: string;
  b: UpcomingBand;
  /** start_date of the last row ('' for band 1). */
  d: string;
  /** starts_at of the last row, '' when null. */
  s: string;
  /** id of the last row. */
  i: string;
}

/** "Today somewhere": the UTC calendar date 12 hours before `now`. */
export function upcomingFloor(now: Date = new Date()): string {
  return new Date(now.getTime() - 12 * 3_600_000).toISOString().slice(0, 10);
}

/** Which band a row is in, by the same rule the SQL applies. */
export function upcomingBand(startDate: unknown, floor: string): UpcomingBand {
  if (typeof startDate !== 'string' || startDate === '') return 1;
  return startDate >= floor ? 0 : 2;
}

function b64urlEncode(s: string): string {
  let bin = '';
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
    Uint8Array.from(bin, (c) => c.charCodeAt(0))
  );
}

export function encodeUpcomingCursor(c: UpcomingCursor): string {
  return UPCOMING_CURSOR_PREFIX + b64urlEncode(JSON.stringify(c));
}

/** Decode a cursor, or null when it is not exactly the shape this module mints. */
export function decodeUpcomingCursor(raw: string | null | undefined): UpcomingCursor | null {
  if (!raw || raw.length > MAX_CURSOR_LEN || !raw.startsWith(UPCOMING_CURSOR_PREFIX)) return null;
  let v: unknown;
  try {
    v = JSON.parse(b64urlDecode(raw.slice(UPCOMING_CURSOR_PREFIX.length)));
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  if (keys !== 'b,d,f,i,s') return null;
  if (typeof o.f !== 'string' || !ISO_DAY.test(o.f)) return null;
  if (o.b !== 0 && o.b !== 1 && o.b !== 2) return null;
  if (typeof o.d !== 'string' || typeof o.s !== 'string' || typeof o.i !== 'string') return null;
  if (o.b === 1 ? o.d !== '' : !ISO_DAY.test(o.d)) return null;
  if (o.s.length > 64 || o.i.length === 0 || o.i.length > 128) return null;
  return { f: o.f, b: o.b, d: o.d, s: o.s, i: o.i };
}

/** The cursor that resumes after `row`, under `floor`. */
export function cursorAfter(
  row: { start_date?: unknown; starts_at?: unknown; id?: unknown },
  floor: string
): string {
  const b = upcomingBand(row.start_date, floor);
  return encodeUpcomingCursor({
    f: floor,
    b,
    d: b === 1 ? '' : String(row.start_date),
    s: typeof row.starts_at === 'string' ? row.starts_at : '',
    i: String(row.id ?? ''),
  });
}

export interface SqlPart {
  sql: string;
  binds: string[];
}

/**
 * SQL for the ordering (and, when resuming, the WHERE condition that starts
 * after the cursor). Column refs assume the `events e` alias.
 */
export function upcomingSql(
  floor: string,
  after: UpcomingCursor | null
): {
  where: SqlPart | null;
  orderBy: SqlPart;
} {
  const band = `(CASE WHEN e.start_date IS NULL OR e.start_date = '' THEN 1 WHEN e.start_date >= ? THEN 0 ELSE 2 END)`;
  const at = `COALESCE(e.starts_at, '')`;

  const orderBy: SqlPart = {
    sql:
      ` ORDER BY ${band} ASC,` +
      ` CASE WHEN ${band} = 0 THEN e.start_date END ASC,` +
      ` CASE WHEN ${band} = 0 THEN ${at} END ASC,` +
      ` CASE WHEN ${band} = 2 THEN e.start_date END DESC,` +
      ` CASE WHEN ${band} = 2 THEN ${at} END DESC,` +
      ` e.id ASC`,
    binds: [floor, floor, floor, floor, floor],
  };

  if (!after) return { where: null, orderBy };

  // "Strictly after the cursor row" in the ordering above.
  let where: SqlPart;
  if (after.b === 0) {
    where = {
      sql:
        `(${band} > 0 OR (${band} = 0 AND (e.start_date > ? OR (e.start_date = ? AND` +
        ` (${at} > ? OR (${at} = ? AND e.id > ?))))))`,
      binds: [floor, floor, after.d, after.d, after.s, after.s, after.i],
    };
  } else if (after.b === 1) {
    where = {
      sql: `(${band} > 1 OR (${band} = 1 AND e.id > ?))`,
      binds: [floor, floor, after.i],
    };
  } else {
    where = {
      sql:
        `(${band} = 2 AND (e.start_date < ? OR (e.start_date = ? AND` +
        ` (${at} < ? OR (${at} = ? AND e.id > ?)))))`,
      binds: [floor, after.d, after.d, after.s, after.s, after.i],
    };
  }
  return { where, orderBy };
}
