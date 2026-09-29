/**
 * OSE-1313 — event date+time+timezone → canonical UTC instant.
 *
 * Exercises the pure timezone math against the ticket's zone/DST/day-boundary
 * matrix: round-trip, day-boundary crossing, DST edges (spring-forward +
 * fall-back), no-DST zones, half-hour offset, and viewer-in-another-zone.
 */
import { describe, test, expect } from 'vitest';
import {
  isValidIanaTimezone,
  zonedDateTimeToUtcIso,
  formatEventDateTime,
  formatEventTime,
  formatDateOnly,
  zonedDatePart,
  zonedTimePart,
  phaseTimesFor,
} from '../src/lib/event-datetime';

// The ticket's parameterized zone list.
const ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Athens',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'Asia/Kolkata',
];

// Re-derive the wall clock (YYYY-MM-DD HH:MM) an instant shows in a zone, so the
// round-trip can be checked independently of the display formatter.
function wallClockIn(utcIso: string, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(new Date(utcIso));
  const m: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value;
  return { date: `${m.year}-${m.month}-${m.day}`, time: `${m.hour}:${m.minute}` };
}

describe('OSE-1313 isValidIanaTimezone', () => {
  test('accepts real IANA zones', () => {
    for (const z of ZONES) expect(isValidIanaTimezone(z), z).toBe(true);
    expect(isValidIanaTimezone('UTC')).toBe(true);
  });
  test('rejects garbage / empty / typos', () => {
    for (const bad of ['', null, undefined, 'America/Chicagoo', 'Not/AZone', 'EST5EDT ', '../etc'])
      expect(isValidIanaTimezone(bad as string)).toBe(false);
  });
});

describe('OSE-1313 round-trip across every listed zone (case 1)', () => {
  // 18:00 is never inside a DST gap, so the wall clock must survive the round trip.
  for (const tz of ZONES) {
    test(`${tz}: 2026-10-24 18:00 → UTC → same wall clock`, () => {
      const utc = zonedDateTimeToUtcIso('2026-10-24', '18:00', tz);
      expect(utc, `${tz} produced null`).toBeTruthy();
      expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); // ISO-8601 with Z
      const wall = wallClockIn(utc as string, tz);
      expect(wall.time).toBe('18:00');
      expect(wall.date).toBe('2026-10-24');
    });
  }
});

describe('OSE-1313 known UTC values', () => {
  test('America/Chicago 2026-10-24 18:00 (CDT, UTC-5) → 23:00Z', () => {
    expect(zonedDateTimeToUtcIso('2026-10-24', '18:00', 'America/Chicago')).toBe(
      '2026-10-24T23:00:00Z'
    );
  });
  test('America/Phoenix has no DST — Jan and Jul share the offset (UTC-7)', () => {
    expect(zonedDateTimeToUtcIso('2026-01-04', '18:00', 'America/Phoenix')).toBe(
      '2026-01-05T01:00:00Z'
    );
    expect(zonedDateTimeToUtcIso('2026-07-04', '18:00', 'America/Phoenix')).toBe(
      '2026-07-05T01:00:00Z'
    );
  });
  test('Asia/Kolkata half-hour offset (UTC+5:30): 18:00 → 12:30Z', () => {
    expect(zonedDateTimeToUtcIso('2026-10-24', '18:00', 'Asia/Kolkata')).toBe(
      '2026-10-24T12:30:00Z'
    );
  });
});

describe('OSE-1313 day-boundary crossing (case 2)', () => {
  test('America/Los_Angeles 2026-10-24 20:00 (PDT, UTC-7) lands on the next UTC date', () => {
    const utc = zonedDateTimeToUtcIso('2026-10-24', '20:00', 'America/Los_Angeles');
    expect(utc).toBe('2026-10-25T03:00:00Z');
    // The event's own zone still reads Oct 24; only the UTC calendar date rolled.
    expect(zonedDatePart(utc, 'America/Los_Angeles')).toBe('2026-10-24');
  });
  test('Pacific/Honolulu (UTC-10) evening also crosses the UTC date', () => {
    const utc = zonedDateTimeToUtcIso('2026-10-24', '20:00', 'Pacific/Honolulu');
    expect(wallClockIn(utc as string, 'Pacific/Honolulu')).toEqual({
      date: '2026-10-24',
      time: '20:00',
    });
    expect(zonedDatePart(utc, 'UTC')).toBe('2026-10-25');
  });
});

describe('OSE-1313 DST edges (case 3)', () => {
  // US spring-forward 2026 = Mar 8, 02:00→03:00; fall-back = Nov 1, 02:00→01:00.
  test('America/New_York the hour after spring-forward is EDT (UTC-4)', () => {
    // 03:00 EDT on the transition day
    expect(zonedDateTimeToUtcIso('2026-03-08', '03:00', 'America/New_York')).toBe(
      '2026-03-08T07:00:00Z'
    );
  });
  test('America/New_York the hour before spring-forward is EST (UTC-5)', () => {
    expect(zonedDateTimeToUtcIso('2026-03-08', '01:00', 'America/New_York')).toBe(
      '2026-03-08T06:00:00Z'
    );
  });
  test('America/New_York fall-back day resolves to a single valid instant', () => {
    // 01:30 is ambiguous (occurs twice); we require A valid instant that reads
    // 01:30 back in-zone, not a specific side of the overlap.
    const utc = zonedDateTimeToUtcIso('2026-11-01', '01:30', 'America/New_York');
    expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(wallClockIn(utc as string, 'America/New_York').time).toBe('01:30');
  });
  test('America/Denver evening shifts with the season (MST vs MDT)', () => {
    expect(zonedDateTimeToUtcIso('2026-01-15', '18:00', 'America/Denver')).toBe(
      '2026-01-16T01:00:00Z' // MST, UTC-7
    );
    expect(zonedDateTimeToUtcIso('2026-07-15', '18:00', 'America/Denver')).toBe(
      '2026-07-16T00:00:00Z' // MDT, UTC-6
    );
  });
});

describe('OSE-1313 render in the event zone, not the viewer (case 4)', () => {
  const utc = '2026-10-24T23:00:00Z'; // 6pm CDT / 4pm PDT / 7pm EDT
  test('formatEventDateTime shows the event zone abbreviation + local time', () => {
    const chi = formatEventDateTime(utc, 'America/Chicago');
    expect(chi).toContain('6:00');
    expect(chi).toMatch(/CDT|CST/); // event zone, regardless of who is looking
    const la = formatEventDateTime(utc, 'America/Los_Angeles');
    expect(la).toContain('4:00');
    expect(la).toMatch(/PDT|PST/);
  });
  test('formatEventTime is time-only in the event zone', () => {
    expect(formatEventTime(utc, 'America/New_York')).toMatch(/7:00\s?PM\s+(EDT|EST)/);
  });
  test('invalid/missing zone falls back to UTC; bad instant → empty string', () => {
    // 23:00Z rendered in the UTC fallback is 11:00 PM UTC.
    expect(formatEventDateTime(utc, 'Not/AZone')).toContain('11:00');
    expect(formatEventDateTime(utc, 'Not/AZone')).toMatch(/UTC/);
    expect(formatEventDateTime('', 'America/Chicago')).toBe('');
    expect(formatEventDateTime('not-a-date', 'America/Chicago')).toBe('');
  });
});

describe('OSE-1313 malformed input → null (no silent bad store)', () => {
  test.each([
    ['2026-13-01', '18:00', 'America/Chicago'], // bad month
    ['2026-10-24', '25:00', 'America/Chicago'], // bad hour
    ['10/24/2026', '18:00', 'America/Chicago'], // wrong date format
    ['2026-10-24', '6pm', 'America/Chicago'], // wrong time format
    ['2026-10-24', '18:00', 'America/Chicagoo'], // typo zone
  ])('rejects (%s, %s, %s)', (d, t, z) => {
    expect(zonedDateTimeToUtcIso(d, t, z)).toBeNull();
  });
});

describe('OSE-1313 zonedTimePart (update path keeps the wall time)', () => {
  test.each(ZONES)('%s: time part round-trips the entered wall time', (tz) => {
    const utc = zonedDateTimeToUtcIso('2026-10-24', '18:30', tz) as string;
    expect(zonedTimePart(utc, tz)).toBe('18:30');
  });

  test('midnight renders as 00:00, not 24:00', () => {
    const utc = zonedDateTimeToUtcIso('2026-10-24', '00:00', 'America/Chicago') as string;
    expect(zonedTimePart(utc, 'America/Chicago')).toBe('00:00');
  });

  test('empty / unparseable instant → empty string', () => {
    expect(zonedTimePart(null, 'America/Chicago')).toBe('');
    expect(zonedTimePart('nope', 'America/Chicago')).toBe('');
  });
});

describe('OSE-1313 midnight wall time (h23 vs h24 runtimes)', () => {
  // Some ICU builds render midnight as hour "24" when hour12:false is set;
  // in zoneOffsetMs that would roll the wall clock a day forward and shift the
  // stored instant by 24h. Pin the conversion at 00:00 across DST and non-DST zones.
  test.each([
    ['America/Chicago', '2026-10-24', '2026-10-24T05:00:00Z'],
    ['America/Phoenix', '2026-01-15', '2026-01-15T07:00:00Z'],
    ['Europe/London', '2026-12-31', '2026-12-31T00:00:00Z'],
    ['Asia/Kolkata', '2026-10-24', '2026-10-23T18:30:00Z'],
  ])('%s %s 00:00 → %s', (tz, date, expected) => {
    expect(zonedDateTimeToUtcIso(date, '00:00', tz)).toBe(expected);
  });
});

describe('OSE-1313 spring-forward gap is refused, not silently shifted', () => {
  test.each([
    ['America/New_York', '2026-03-08', '02:30'],
    ['America/Chicago', '2026-03-08', '02:00'],
    ['Europe/Berlin', '2026-03-29', '02:15'],
  ])('%s %s %s does not exist → null', (tz, date, time) => {
    expect(zonedDateTimeToUtcIso(date, time, tz)).toBeNull();
  });

  test('the fall-back overlap still resolves (it exists, twice)', () => {
    expect(zonedDateTimeToUtcIso('2026-11-01', '01:30', 'America/New_York')).not.toBeNull();
  });
});

describe('OSE-1363 formatDateOnly — a calendar day, never a UTC-shifted instant', () => {
  test('renders the given day with weekday/month/day/year opts', () => {
    expect(
      formatDateOnly('2026-10-24', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    ).toBe('Saturday, October 24, 2026');
  });

  test('forces UTC LAST — a caller-supplied timeZone cannot shift the day', () => {
    // The whole bug: a negative-offset zone rolled UTC-midnight back a day.
    expect(
      formatDateOnly('2026-10-24', {
        timeZone: 'America/Chicago',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    ).toBe('October 24, 2026');
  });

  test('with no opts, falls back to the en-US numeric default of the same day', () => {
    expect(formatDateOnly('2026-10-24')).toBe('10/24/2026');
  });

  test('rejects anything that is not a bare YYYY-MM-DD → empty string', () => {
    for (const bad of [
      '2026-10-25T03:00:00Z',
      'not-a-date',
      '10/24/2026',
      '2026-10',
      '',
      null,
      undefined,
    ])
      expect(formatDateOnly(bad as string)).toBe('');
  });
});

describe('OSE-1313 phaseTimesFor — what the phase resolver sees', () => {
  test('date-only event spans its whole local day, not UTC midnight to UTC midnight', () => {
    expect(
      phaseTimesFor({
        start_date: '2026-10-24',
        end_date: '2026-10-24',
        timezone: 'America/Chicago',
      })
    ).toEqual({ start_date: '2026-10-24T05:00:00Z', end_date: '2026-10-25T04:59:59.999Z' });
  });

  test('date-only with no end → the start day; with an end → through that local day', () => {
    expect(
      phaseTimesFor({ start_date: '2026-10-24', end_date: null, timezone: 'America/Chicago' })
        .end_date
    ).toBe('2026-10-25T04:59:59.999Z');
    expect(
      phaseTimesFor({
        start_date: '2026-10-24',
        end_date: '2026-10-26',
        timezone: 'Pacific/Auckland',
      })
    ).toEqual({ start_date: '2026-10-23T11:00:00Z', end_date: '2026-10-26T10:59:59.999Z' });
  });

  test('date-only with no/invalid zone reads the day in America/Chicago', () => {
    expect(
      phaseTimesFor({ start_date: '2026-10-24', end_date: '2026-10-24', timezone: 'Mars/Base' })
        .start_date
    ).toBe('2026-10-24T05:00:00Z');
  });

  test('timed event starts at starts_at; a date-only end closes at the end of that local day', () => {
    expect(
      phaseTimesFor({
        start_date: '2026-10-24',
        end_date: '2026-10-24',
        starts_at: '2026-10-24T23:00:00Z',
        timezone: 'America/Chicago',
      })
    ).toEqual({ start_date: '2026-10-24T23:00:00Z', end_date: '2026-10-25T04:59:59.999Z' });
  });

  test('a full ISO end after the start is kept as-is', () => {
    expect(
      phaseTimesFor({
        start_date: '2026-10-24',
        end_date: '2026-10-25T03:00:00Z',
        starts_at: '2026-10-24T23:00:00Z',
        timezone: 'America/Chicago',
      }).end_date
    ).toBe('2026-10-25T03:00:00Z');
  });

  test('an end before the start is dropped, so the event never skips straight to the recap', () => {
    expect(
      phaseTimesFor({
        start_date: '2026-10-24',
        end_date: '2026-10-20',
        starts_at: '2026-10-24T23:00:00Z',
        timezone: 'America/Chicago',
      }).end_date
    ).toBeNull();
  });
});
