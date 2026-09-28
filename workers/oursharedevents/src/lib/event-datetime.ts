/**
 * OSE-1313 — event date+time+timezone, canonicalized to a UTC instant.
 *
 * The event carries a wall-clock date + time in a specific IANA time zone
 * (default from the venue/node, editable). We persist the canonical UTC instant
 * (ISO-8601 with `Z`) so it is unambiguous, and render it back in the EVENT's
 * zone on every surface — never the viewer's browser zone.
 *
 * Pure module: only `Intl.DateTimeFormat` + `Date`. No I/O, no workspace deps —
 * so the whole zone/DST/round-trip matrix (OSE-1313 test plan) runs as fast unit
 * tests in the node pool. The same `Intl.formatToParts` technique already backs
 * the .ics `formatInTimezone` in handlers/calendar.ts; this generalizes it.
 */

/** True if `tz` is an IANA zone the runtime's Intl accepts (e.g. "America/Chicago"). */
export function isValidIanaTimezone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    // Throws RangeError for an unknown/malformed zone.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Offset (ms) to add to a UTC instant to get the wall-clock time in `tz` at that
 * instant: `wallClockAsIfUtc - instant`. Positive east of UTC. DST-aware because
 * it asks Intl for the actual local parts at that specific instant.
 */
function zoneOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value);
  const wallAsUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return wallAsUtc - instant.getTime();
}

/**
 * Convert a wall-clock date + time in `tz` to the canonical UTC instant (ISO-8601
 * with `Z`, second precision). Returns null on malformed input or unknown zone.
 *
 * DST handling: we start from the "naive" instant (treat the wall clock as if it
 * were UTC), read the zone offset there, subtract it, then refine ONCE — the
 * offset can differ across a DST boundary, and one refinement lands on the right
 * side for every real transition. Spring-forward gaps (a wall time that does not
 * exist) and fall-back overlaps (one that happens twice) still resolve to a
 * single deterministic, valid instant.
 *
 * @param dateStr local date "YYYY-MM-DD"
 * @param timeStr local time "HH:MM" (24h)
 * @param tz      IANA zone
 */
export function zonedDateTimeToUtcIso(dateStr: string, timeStr: string, tz: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  if (!/^\d{2}:\d{2}$/.test(timeStr)) return null;
  if (!isValidIanaTimezone(tz)) return null;

  const [Y, M, D] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  if (M < 1 || M > 12 || D < 1 || D > 31 || h > 23 || mi > 59) return null;

  const naiveUtc = Date.UTC(Y, M - 1, D, h, mi, 0);
  const off1 = zoneOffsetMs(new Date(naiveUtc), tz);
  let utcMs = naiveUtc - off1;
  const off2 = zoneOffsetMs(new Date(utcMs), tz);
  if (off2 !== off1) utcMs = naiveUtc - off2;

  return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Render a UTC instant for humans in the EVENT's zone, including the zone
 * abbreviation so a viewer in another zone reads the event's local time, not
 * their own (e.g. "Sat, Oct 24, 2026, 6:00 PM CDT"). Falls back to UTC when the
 * zone is missing/invalid. Returns '' for an unparseable instant.
 */
export function formatEventDateTime(utcIso: string | null | undefined, tz: string | null): string {
  if (!utcIso) return '';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = isValidIanaTimezone(tz) ? (tz as string) : 'UTC';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

/**
 * Render only the wall-clock time in the event's zone (e.g. "6:00 PM CDT"),
 * for surfaces that already show the date separately (poster, cards).
 */
export function formatEventTime(utcIso: string | null | undefined, tz: string | null): string {
  if (!utcIso) return '';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = isValidIanaTimezone(tz) ? (tz as string) : 'UTC';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

/** The local calendar date ("YYYY-MM-DD") of a UTC instant in `tz`. */
export function zonedDatePart(utcIso: string | null | undefined, tz: string | null): string {
  if (!utcIso) return '';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = isValidIanaTimezone(tz) ? (tz as string) : 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}
