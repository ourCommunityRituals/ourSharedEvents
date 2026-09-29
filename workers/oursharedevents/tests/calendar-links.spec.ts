/**
 * OSE-1358 — Google Calendar "Add to calendar" deep link, built server-side.
 *
 * Pure URL builder (no third-party calendar service, "boring on purpose"): a
 * timed event uses its canonical UTC instant (OSE-1313 `starts_at`); a date-only
 * event uses its own calendar day directly (no Date/UTC round-trip, so no
 * off-by-one — the OSE-1363 hazard cannot occur here). Node-clean: only string +
 * Date-UTC math, no cloudflare:test / D1.
 *
 * Privacy: the description carries only the host copy + the ordinary event share
 * URL — no per-person token, no tracking params. Never who, only how many.
 */
import { describe, test, expect } from 'vitest';
import { buildGoogleCalendarUrl } from '../src/lib/calendar-links';

const SHARE = 'https://oursharedevents.com/events/e1';

describe('OSE-1358 buildGoogleCalendarUrl', () => {
  test('a timed event uses its UTC instant and a one-hour default when no timed end', () => {
    const url = buildGoogleCalendarUrl(
      {
        title: 'Bocce Night',
        description: 'Bring friends.',
        location: 'Eagles Bowl',
        where_address: '123 Main St',
        start_date: '2026-10-24',
        end_date: '2026-10-24', // date-only, same day → not a timed end → default +1h
        starts_at: '2026-10-24T23:00:00Z',
        timezone: 'America/Chicago',
      },
      SHARE
    ) as string;
    expect(url).toContain('https://calendar.google.com/calendar/render?');
    expect(url).toContain('action=TEMPLATE');
    expect(url).toContain('dates=20261024T230000Z/20261025T000000Z');
    expect(url).toContain('text=Bocce%20Night');
    expect(url).toContain('location=Eagles%20Bowl%2C%20123%20Main%20St');
    // description + share URL, encoded; the share URL is the ordinary /events/:id.
    expect(url).toContain('https%3A%2F%2Foursharedevents.com%2Fevents%2Fe1');
    // never-who: no scan-ingest path, no tracking params in the link.
    expect(url).not.toContain('/q/');
    expect(url).not.toContain('utm_');
  });

  test('a full-instant end after the start is honoured', () => {
    const url = buildGoogleCalendarUrl(
      {
        title: 'X',
        start_date: '2026-10-24',
        end_date: '2026-10-25T01:30:00Z',
        starts_at: '2026-10-24T23:00:00Z',
        timezone: 'America/Chicago',
      },
      SHARE
    ) as string;
    expect(url).toContain('dates=20261024T230000Z/20261025T013000Z');
  });

  test('a date-only event is all-day on ITS OWN day (end exclusive = next day, no UTC shift)', () => {
    const url = buildGoogleCalendarUrl(
      {
        title: 'Fall Fair',
        start_date: '2026-10-24',
        starts_at: null,
        timezone: 'America/Chicago',
      },
      SHARE
    ) as string;
    // The bug this guards: reading "2026-10-24" through a negative-offset zone
    // would produce 20261023. All-day must be the literal day.
    expect(url).toContain('dates=20261024/20261025');
    expect(url).not.toContain('20261023');
  });

  test('a legacy full-ISO start_date with no starts_at is treated as timed', () => {
    const url = buildGoogleCalendarUrl(
      { title: 'Legacy', start_date: '2026-10-01T18:00:00.000Z', starts_at: null },
      SHARE
    ) as string;
    expect(url).toContain('dates=20261001T180000Z/20261001T190000Z');
  });

  test('no start_date → no link', () => {
    expect(buildGoogleCalendarUrl({ title: 'X', start_date: null }, SHARE)).toBeNull();
  });

  test('hostile title / venue / description are percent-encoded — no raw markup or scheme in the URL', () => {
    const url = buildGoogleCalendarUrl(
      {
        title: '"><script>alert(1)</script>',
        description: 'javascript:alert(2)',
        location: 'Venue & "Bad"',
        where_address: '<b>',
        start_date: '2026-10-24',
        starts_at: '2026-10-24T23:00:00Z',
        timezone: 'America/Chicago',
      },
      SHARE
    ) as string;
    // The origin is always the fixed Google host — no user control over the scheme.
    expect(url.startsWith('https://calendar.google.com/calendar/render?')).toBe(true);
    // No raw structural characters survive encoding anywhere in the URL.
    expect(url).not.toContain('<');
    expect(url).not.toContain('>');
    expect(url).not.toContain('"');
    // The literal payload appears only in its percent-encoded form.
    expect(url).toContain(encodeURIComponent('"><script>alert(1)</script>'));
  });

  test('all-day range rolls over month and year boundaries correctly', () => {
    const nye = buildGoogleCalendarUrl(
      { title: 'NYE', start_date: '2026-12-31', starts_at: null },
      SHARE
    ) as string;
    expect(nye).toContain('dates=20261231/20270101');
    const halloween = buildGoogleCalendarUrl(
      { title: 'Halloween', start_date: '2026-10-31', starts_at: null },
      SHARE
    ) as string;
    expect(halloween).toContain('dates=20261031/20261101');
  });

  test('a full-instant end BEFORE the start is ignored (never a negative span) → one-hour default', () => {
    const url = buildGoogleCalendarUrl(
      {
        title: 'X',
        start_date: '2026-10-24',
        starts_at: '2026-10-24T23:00:00Z',
        end_date: '2026-10-24T20:00:00Z', // three hours BEFORE the start
        timezone: 'America/Chicago',
      },
      SHARE
    ) as string;
    expect(url).toContain('dates=20261024T230000Z/20261025T000000Z');
  });
});
