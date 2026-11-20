/**
 * OSE-2197 — where a parsed public answer could carry a point.
 *
 * Owner, 2026-11-19: "It should resolve to the H3." A public event answer says
 * where an event is by its cell; it never carries the event's stored point.
 * This walks a parsed JSON answer and names every place a coordinate could sit,
 * by its JSON path:
 *
 *   - a key named like a coordinate (`lat`, `lon`, `lng`, `latitude`,
 *     `longitude`, `geo`, `coords`, `coordinates`, `position`, `latlng`, `ll`,
 *     or a name ending or starting with one of the first five, `venue_lat`);
 *   - a number with three or more decimal places that could be a latitude or
 *     longitude (at most 180 either way), except the fields named in
 *     NOT_A_PLACE, which are positions on a hall plan, not on the earth;
 *   - text holding a coordinate pair ("41.657,-87.681", or `%2C` between),
 *     which is how a maps link carries one.
 *
 * The Bruno check on staging applies the same three rules
 * (bruno/ose-api/…/OSE-2197 …), so the two layers fail on the same thing.
 */

const COORDINATE_KEY =
  /^(geo|coords?|coordinates|position|latlng|lat_lng|lat_lon|ll)$|(^|_)(lat|lon|lng|latitude|longitude)(_|$)/i;

/** Numbers that are fractions of a hall plan (0109_event_booths.sql), not places on the earth. */
const NOT_A_PLACE: ReadonlySet<string> = new Set(['hall_x', 'hall_y']);

const PAIR_IN_TEXT = /-?\d{1,3}\.\d{3,}\s*(,|%2C)\s*-?\d{1,3}\.\d{3,}/i;

function decimalPlaces(n: number): number {
  const s = String(n);
  if (s.includes('e')) return Infinity; // 1e-7 is a fraction too small to be anything but a coordinate part
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Every place in `value` where a coordinate sits, as JSON paths with a reason. */
export function coordinateFindings(value: unknown, path = '$', key = ''): string[] {
  const out: string[] = [];
  if (key && COORDINATE_KEY.test(key)) out.push(`${path}: a coordinate-named field`);
  if (typeof value === 'number') {
    if (
      !Number.isInteger(value) &&
      Math.abs(value) <= 180 &&
      decimalPlaces(value) >= 3 &&
      !NOT_A_PLACE.has(key)
    ) {
      out.push(`${path}: ${value} is coordinate-shaped`);
    }
  } else if (typeof value === 'string') {
    if (PAIR_IN_TEXT.test(value)) out.push(`${path}: text holds a coordinate pair`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...coordinateFindings(v, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(...coordinateFindings(v, `${path}.${k}`, k));
    }
  }
  return out;
}
