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
    // hourCycle only — `hour12` takes precedence over it, and some ICU builds
    // then pick h24, rendering midnight as "24" (seen on CI's Node).
    hourCycle: 'h23',
  }).formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value);
  if (map.hour === 24) map.hour = 0; // defensive: an h24 runtime labels midnight 24
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
 * side for every real transition. A fall-back overlap (a wall time that happens
 * twice) resolves to a single deterministic, valid instant; a spring-forward gap
 * (a wall time that does not exist) returns null rather than a different time.
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

  const iso = new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  // A wall time that does not exist in the zone (the spring-forward gap, e.g.
  // 02:30 on the US DST start day) would otherwise resolve to an instant that
  // reads back as a DIFFERENT time — the event would be stored at a time
  // nobody entered. Refuse it; the fall-back overlap still round-trips.
  if (zonedDatePart(iso, tz) !== dateStr || zonedTimePart(iso, tz) !== timeStr) return null;
  return iso;
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

/**
 * Format a date-only value ("YYYY-MM-DD") for humans WITHOUT a timezone shift.
 *
 * A date-only value names a CALENDAR DAY, not an instant. `new Date("2026-10-24")`
 * parses it as UTC midnight, and formatting that instant in a negative-offset zone
 * rolls the day back a day ("Oct 23") — the OSE-1363 off-by-one. This anchors the
 * value at UTC midnight and formats in UTC, so the rendered day always matches the
 * value. `timeZone: 'UTC'` is spread LAST so it overrides any `timeZone` a caller
 * left in `opts` — a date-only value has no zone to honour.
 *
 * Returns '' for anything that is not a bare `YYYY-MM-DD` (a full instant has a
 * zone; render it with the zoned formatters above, not this one).
 */
export function formatDateOnly(
  dateStr: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = {}
): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(d);
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

/**
 * The local wall-clock time ("HH:MM", 24h) of a UTC instant in `tz`. The update
 * path uses it to keep an event's time-of-day when only its date or zone moves.
 */
export function zonedTimePart(utcIso: string | null | undefined, tz: string | null): string {
  if (!utcIso) return '';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = isValidIanaTimezone(tz) ? (tz as string) : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    // hourCycle only — `hour12` takes precedence over it, and some ICU builds
    // then pick h24, rendering midnight as "24" (seen on CI's Node).
    hourCycle: 'h23',
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  const hour = map.hour === '24' ? '00' : map.hour; // defensive: h24 runtimes
  return `${hour}:${map.minute}`;
}

/**
 * The ISO start/end the canonical phase resolver (domain/event-phase) should
 * see for an event. The resolver's contract takes ISO datetimes and is left
 * untouched; this feeds it the most precise ones we have.
 *
 * - A timed event (starts_at set) starts at starts_at, not at UTC midnight of
 *   the date-only start_date — otherwise an 18:00 event goes "live" at 00:00Z.
 * - Its date-only end_date is a CALENDAR DAY, not an instant: it ends at the
 *   end of that day in the event's zone. Read as UTC midnight it would land
 *   before a same-day timed start and flip the event to post_event the moment
 *   it went live.
 * - A date-only event (no starts_at) passes through unchanged.
 */
export function phaseTimesFor(row: {
  start_date: string | null;
  end_date: string | null;
  starts_at?: string | null;
  timezone?: string | null;
}): { start_date: string | null; end_date: string | null } {
  if (!row.starts_at || Number.isNaN(new Date(row.starts_at).getTime())) {
    return { start_date: row.start_date, end_date: row.end_date };
  }
  let end = row.end_date;
  if (end && /^\d{4}-\d{2}-\d{2}$/.test(end.trim())) {
    const zone = isValidIanaTimezone(row.timezone) ? (row.timezone as string) : 'UTC';
    const lastMinute = zonedDateTimeToUtcIso(end.trim(), '23:59', zone);
    // Through 23:59:59.999 local — the whole final minute, not its first second.
    end = lastMinute ? new Date(new Date(lastMinute).getTime() + 59_999).toISOString() : null;
  }
  // An end that still precedes the start is bad data: drop it so the event
  // stays live until archived rather than skipping straight to the recap.
  if (end && new Date(end).getTime() < new Date(row.starts_at).getTime()) end = null;
  return { start_date: row.starts_at, end_date: end };
}
