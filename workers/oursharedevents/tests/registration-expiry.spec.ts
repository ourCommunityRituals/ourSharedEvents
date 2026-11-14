/**
 * OSE-826: when a registration expires.
 *
 * Owner decision 2026-11-13 ("Later of the two"): a registration expires 90
 * days after the person registers, or at the end of the day after its event
 * (midnight UTC two days after the event's date), whichever is later. Before,
 * only the 90 days held, so anyone who registered more than 90 days ahead was
 * deleted by the nightly job before the event and arrived unregistered.
 *
 * Pure rule in src/lib/retention-windows.ts (registrationExpiresAt). The
 * request path and the nightly job are in registration-expiry-http.spec.ts.
 *
 * Scenario ids: H happy, N negative, E edge, F fat finger.
 *
 * @born-red retention#OSE-826 | method: (1) registrationExpiresAt returning the
 *   old rule (now + 90 days): H2, H3, H4, E3, E4 and the property failed, 19
 *   passed; (2) the real-date check switched off: the N2 cases for 30 Feb,
 *   29 Feb 2027, month 13, month 00, day 00 and day 32 failed | date: 2026-11-13
 */
import { describe, expect, test } from 'vitest';
import { REGISTRATION_TTL_DAYS, registrationExpiresAt } from '../src/lib/retention-windows';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-13T15:30:00.000Z');
const BY_TTL = new Date(NOW.getTime() + REGISTRATION_TTL_DAYS * DAY).toISOString();

/** The YYYY-MM-DD date `days` after NOW's date (UTC). */
function dayFromNow(days: number): string {
  const d = new Date(Date.UTC(2026, 10, 13 + days));
  return d.toISOString().slice(0, 10);
}

describe('registrationExpiresAt: the later of 90 days and the day after the event', () => {
  test('H1: an event inside the 90 days keeps the 90 days', () => {
    expect(registrationExpiresAt(NOW, dayFromNow(10))).toBe(BY_TTL);
  });

  test('H2: an event 200 days ahead keeps the row until the day after it is over', () => {
    expect(registrationExpiresAt(NOW, '2027-06-01')).toBe('2027-06-03T00:00:00.000Z');
  });

  test('H3: a date with a time reads its date', () => {
    expect(registrationExpiresAt(NOW, '2027-06-01T19:00:00Z')).toBe('2027-06-03T00:00:00.000Z');
  });

  test('H4: the expiry is never before the day after the event, however far ahead', () => {
    expect(registrationExpiresAt(NOW, '2028-11-13')).toBe('2028-11-15T00:00:00.000Z');
  });

  test('E1: an event already over keeps the 90 days', () => {
    expect(registrationExpiresAt(NOW, '2026-01-01')).toBe(BY_TTL);
  });

  test('E2: an event 88 days ahead (its day after ends before the 90 days) keeps the 90 days', () => {
    // 2026-11-13 + 88 days = 2027-02-09; the day after it ends 2027-02-11T00:00Z,
    // before the 90 days (2027-02-11T15:30Z).
    expect(registrationExpiresAt(NOW, dayFromNow(88))).toBe(BY_TTL);
  });

  test('E3: an event 89 days ahead moves the expiry past the 90 days', () => {
    expect(registrationExpiresAt(NOW, dayFromNow(89))).toBe('2027-02-12T00:00:00.000Z');
  });

  test('E4: 29 February in a leap year is a real date', () => {
    expect(registrationExpiresAt(NOW, '2028-02-29')).toBe('2028-03-02T00:00:00.000Z');
  });

  test('E5: the 90 days are counted from the moment of registering', () => {
    const later = new Date('2026-11-14T01:00:00.000Z');
    expect(registrationExpiresAt(later, null)).toBe('2027-02-12T01:00:00.000Z');
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
  ])('N1: no date (%s) keeps the 90 days', (_label, value) => {
    expect(registrationExpiresAt(NOW, value)).toBe(BY_TTL);
  });

  test.each([
    ['not a date', 'next spring'],
    ['30 February', '2027-02-30'],
    ['29 February in a common year', '2027-02-29'],
    ['month 13', '2027-13-01'],
    ['month 00', '2028-00-10'],
    ['day 00', '2027-06-00'],
    ['day 32', '2027-12-32'],
    ['a two-digit year', '0050-06-01'],
  ])('N2: a date that is not a real calendar date (%s) keeps the 90 days', (_label, value) => {
    expect(registrationExpiresAt(NOW, value)).toBe(BY_TTL);
  });

  test.each([
    ['no leading zeros', '2027-6-1'],
    ['a leading space', ' 2027-06-01'],
    ['slashes', '2027/06/01'],
    ['day first', '01-06-2027'],
  ])('F1: a mistyped date (%s) keeps the 90 days', (_label, value) => {
    expect(registrationExpiresAt(NOW, value)).toBe(BY_TTL);
  });

  test('property: for every event day from a year back to two years ahead, the expiry is the later of the two', () => {
    for (let k = -365; k <= 730; k++) {
      const day = dayFromNow(k);
      const afterEvent = Date.parse(`${day}T00:00:00.000Z`) + 2 * DAY;
      const want = new Date(Math.max(Date.parse(BY_TTL), afterEvent)).toISOString();
      expect(registrationExpiresAt(NOW, day), day).toBe(want);
    }
  });
});
