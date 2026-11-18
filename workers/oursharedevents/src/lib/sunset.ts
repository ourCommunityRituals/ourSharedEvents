/**
 * Sunset, and whether an event is over before it (owner, 2026-11-18: a "home
 * before dark" choice for attendees aged 55 to 75, many of whom avoid driving
 * at night).
 *
 * The sunrise equation (NOAA's simplified form): good to a minute or two in
 * the corridors we serve, which is all a "before dark" choice needs. Pure: the
 * place is the event's public point or its area's middle, never the visitor.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
/** Julian day of 1970-01-01T00:00Z. */
const UNIX_EPOCH_JD = 2_440_587.5;
const J2000 = 2_451_545;
/** How long an event with a start and no end is taken to last. */
export const DEFAULT_EVENT_MS = 2 * 60 * 60 * 1000;

/**
 * The instant of sunset (ms since the epoch, UTC) on the local calendar day
 * that holds `at`, at latitude `lat` and longitude `lon` (degrees, east
 * positive). Null where the sun does not set or rise that day.
 */
export function sunsetMs(at: number, lat: number, lon: number): number | null {
  // The local day, by the sun: a 7 pm event in Chicago is the next day in UTC.
  const localNoon = Math.floor((at + (lon / 15) * 3_600_000) / DAY_MS) * DAY_MS + DAY_MS / 2;
  const n = Math.round(localNoon / DAY_MS + UNIX_EPOCH_JD - J2000 + 0.0008);
  const jStar = n - lon / 360;
  const m = (357.5291 + 0.98560028 * jStar) % 360;
  const c =
    1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = J2000 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW =
    (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  if (cosW < -1 || cosW > 1) return null;
  const set = transit + Math.acos(cosW) / RAD / 360;
  return Math.round((set - UNIX_EPOCH_JD) * DAY_MS);
}

/** An ISO value with a time of day; a date alone says nothing about dark. */
function instant(v: unknown): number | null {
  if (typeof v !== 'string' || !/T\d{2}:\d{2}/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * True when the event is over before sunset where it is held. Its end, or its
 * start and two hours when it has no end time. An event with no time of day,
 * or no place, is never counted as before dark: the choice must not promise
 * what the data cannot tell.
 */
export function endsBeforeDark(
  e: { startDateISO?: unknown; endDateISO?: unknown },
  lat: number | null,
  lon: number | null
): boolean {
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const start = instant(e.startDateISO);
  const end = instant(e.endDateISO) ?? (start === null ? null : start + DEFAULT_EVENT_MS);
  if (end === null || (start !== null && end < start)) return false;
  const set = sunsetMs(end, lat, lon);
  return set !== null && end <= set;
}
