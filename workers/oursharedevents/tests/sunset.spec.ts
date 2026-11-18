/**
 * Sunset, and the "home before dark" choice (lib/sunset.ts; owner, 2026-11-18,
 * for attendees aged 55 to 75, many of whom avoid driving at night).
 *
 * Node-clean: pure functions, no DOM, no D1 (registered in vitest.node-specs.mjs).
 * The reference times are the US Naval Observatory's published sunsets for
 * Chicago (41.88 N, 87.63 W); the equation is held to two minutes of them.
 */
// @born-red home before dark | method: faults put into lib/sunset.ts one at a time, this file run, the file restored; each turned it red: the local-day offset dropped (an evening event reckoned on the next day); the refraction term zeroed; the end taken as the start; a date with no time read as an instant; the polar case left to NaN | date: 2026-11-18

import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_MS, endsBeforeDark, sunsetMs } from '../src/lib/sunset';

const CHI = { lat: 41.8781, lon: -87.6298 };
const MIN = 60_000;
const at = (iso: string) => Date.parse(iso);

describe('sunsetMs', () => {
  it('Chicago in November and June, to two minutes of the published times', () => {
    // 2026-11-18: 4:28 pm CST = 22:28Z. 2026-06-21: 8:29 pm CDT = 01:29Z next day.
    const nov = sunsetMs(at('2026-11-18T15:00:00Z'), CHI.lat, CHI.lon)!;
    expect(Math.abs(nov - at('2026-11-18T22:28:00Z'))).toBeLessThan(2 * MIN);
    const jun = sunsetMs(at('2026-06-21T18:00:00Z'), CHI.lat, CHI.lon)!;
    expect(Math.abs(jun - at('2026-06-22T01:29:00Z'))).toBeLessThan(2 * MIN);
  });

  it('a 7 pm event is reckoned on its own local day, not the UTC one', () => {
    // 7 pm CST on Nov 18 is 01:00Z on Nov 19; its sunset is still Nov 18's.
    const s = sunsetMs(at('2026-11-19T01:00:00Z'), CHI.lat, CHI.lon)!;
    expect(Math.abs(s - at('2026-11-18T22:28:00Z'))).toBeLessThan(2 * MIN);
  });

  it('null where the sun does not set or rise that day', () => {
    expect(sunsetMs(at('2026-06-21T12:00:00Z'), 78, 15)).toBeNull();
    expect(sunsetMs(at('2026-12-21T12:00:00Z'), 78, 15)).toBeNull();
  });
});

describe('endsBeforeDark', () => {
  const nov = (hhmmZ: string) => `2026-11-18T${hhmmZ}:00Z`;

  it('an afternoon event that ends by sunset counts; one that ends after does not', () => {
    expect(
      endsBeforeDark({ startDateISO: nov('19:00'), endDateISO: nov('21:00') }, CHI.lat, CHI.lon)
    ).toBe(true);
    expect(
      endsBeforeDark({ startDateISO: nov('19:00'), endDateISO: nov('23:00') }, CHI.lat, CHI.lon)
    ).toBe(false);
  });

  it('no end time: the start and two hours', () => {
    expect(DEFAULT_EVENT_MS).toBe(2 * 60 * 60 * 1000);
    expect(endsBeforeDark({ startDateISO: nov('20:00') }, CHI.lat, CHI.lon)).toBe(true);
    // 21:00Z + 2 h = 23:00Z, after the 22:28Z sunset.
    expect(endsBeforeDark({ startDateISO: nov('21:00') }, CHI.lat, CHI.lon)).toBe(false);
  });

  it('never promises what the data cannot tell: no time of day, no place, an end before its start', () => {
    expect(endsBeforeDark({ startDateISO: '2026-11-18' }, CHI.lat, CHI.lon)).toBe(false);
    expect(endsBeforeDark({}, CHI.lat, CHI.lon)).toBe(false);
    expect(endsBeforeDark({ startDateISO: nov('19:00') }, null, CHI.lon)).toBe(false);
    expect(endsBeforeDark({ startDateISO: nov('19:00') }, NaN, CHI.lon)).toBe(false);
    expect(
      endsBeforeDark({ startDateISO: nov('19:00'), endDateISO: nov('18:00') }, CHI.lat, CHI.lon)
    ).toBe(false);
    expect(endsBeforeDark({ startDateISO: 42 }, CHI.lat, CHI.lon)).toBe(false);
  });

  it('a date-only end falls back to the start and two hours', () => {
    expect(
      endsBeforeDark({ startDateISO: nov('19:00'), endDateISO: '2026-11-18' }, CHI.lat, CHI.lon)
    ).toBe(true);
  });
});
