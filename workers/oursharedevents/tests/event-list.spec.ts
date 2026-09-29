/**
 * OSE-1363 — a date-only event start must render its OWN calendar date on the
 * public discovery listing, never a UTC-shifted day-before.
 *
 * The bug: formatEventDate did
 *   new Date("2026-10-24").toLocaleDateString('en-US', { timeZone: 'America/Chicago' })
 * "2026-10-24" parses as UTC midnight; rendering THAT instant in any
 * negative-offset zone rolls the day back ("October 23"). Every event carrying a
 * timezone was off by one on the one surface whose job is "what's happening?".
 *
 * Pure module: event-list.ts imports only html-escape + inject-marker, so this
 * runs in the node pool. formatEventDate is private — asserted through the public
 * renderEventList, which is also the real user-facing behaviour.
 */
import { describe, test, expect } from 'vitest';
import { renderEventList } from '../src/lib/event-list';

describe('OSE-1363 date-only start renders the event day, not a UTC-shifted day-before', () => {
  test('a date-only Chicago event shows October 24, not the day before', () => {
    // Deterministic regardless of the runtime zone: the explicit America/Chicago
    // (UTC-5 on this date) is what forced UTC-midnight back to Oct 23.
    const { html } = renderEventList([
      {
        id: 'e1',
        name: 'Bocce Night',
        startDateISO: '2026-10-24',
        venue: 'Sawyer',
        phase: 'pre_event',
        timezone: 'America/Chicago',
      },
    ]);
    expect(html).toContain('October 24, 2026');
    expect(html).not.toContain('October 23');
  });

  test('a date-only event with no zone still shows its own day (UTC anchor)', () => {
    const { html } = renderEventList([
      { id: 'e0', name: 'No Zone', startDateISO: '2026-10-24', phase: 'pre_event' },
    ]);
    expect(html).toContain('October 24, 2026');
    expect(html).not.toContain('October 23');
  });

  test('a full instant renders the date in the EVENT zone, not empty', () => {
    // 2026-10-25T03:00:00Z is Oct 24 22:00 in Chicago (CDT) — the event day is the
    // 24th. Guards the reroute: passing a full instant straight to a date-only
    // formatter would blank the date instead of resolving the zoned day.
    const { html } = renderEventList([
      {
        id: 'e2',
        name: 'Late Set',
        startDateISO: '2026-10-25T03:00:00Z',
        venue: 'Sawyer',
        phase: 'pre_event',
        timezone: 'America/Chicago',
      },
    ]);
    expect(html).toContain('October 24, 2026');
    expect(html).not.toContain('October 25');
  });
});
