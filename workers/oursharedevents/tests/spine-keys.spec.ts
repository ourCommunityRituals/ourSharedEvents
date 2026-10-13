/**
 * Spine keys, the pure functions (OSE-1615): venue_canonical_id and
 * event_correlation_id, version v1.
 *
 * The rule is the PO's decision of 2026-10-04 (.telemetry/tracking-plan.md,
 * Decisions 1 and 2). The fixtures in tests/fixtures/spine-keys.v1.json are the
 * published contract: any repository that computes these keys must reproduce
 * every row. Their hashes were computed with node:crypto, independently of the
 * library under test, and their normalised names were written by hand.
 *
 * @born-red spine keys, the rule | method: the file was first run before
 *   `src/lib/spine-keys.ts` existed and failed to load; each rule was then seen
 *   red on a planted fault (the list, one place each, and the tests each turned
 *   red: `.claude/outputs/CCR-SPINE-KEYS-2026-10-12.md`, section D, "The rule")
 *   | date: 2026-10-12
 */
import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/spine-keys.v1.json';
import {
  SPINE_KEY_VERSION,
  computeSpineKeys,
  eventCorrelationId,
  eventNightBucket,
  normaliseVenueName,
  venueCanonicalId,
} from '../src/lib/spine-keys';

describe('spine keys v1: the fixtures file', () => {
  it('holds the vectors the tables below run on (an emptied array would run no test)', () => {
    expect(fixtures.venues.length).toBeGreaterThanOrEqual(45);
    expect(fixtures.no_venue_key.length).toBeGreaterThanOrEqual(12);
    expect(fixtures.buckets.length).toBeGreaterThanOrEqual(20);
    expect(fixtures.no_bucket.length).toBeGreaterThanOrEqual(3);
    expect(fixtures.events.length).toBeGreaterThanOrEqual(6);
    expect(fixtures.no_event_key.length).toBeGreaterThanOrEqual(9);
  });

  it('every id in it is 32 lower-case hex characters', () => {
    for (const v of fixtures.venues) expect(v.venue_canonical_id).toMatch(/^[0-9a-f]{32}$/);
    for (const e of fixtures.events) expect(e.event_correlation_id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('spine keys v1: venue name normalisation', () => {
  it.each(fixtures.venues.map((v) => [v.name, v.normalised]))('%j -> %j', (name, normalised) => {
    expect(normaliseVenueName(name)).toBe(normalised);
  });

  it('an apostrophe is removed, not turned into a space', () => {
    expect(normaliseVenueName("Joe's")).toBe('joes');
    expect(normaliseVenueName('Joe’s')).toBe('joes');
  });

  it('removes every apostrophe form in the rule, the acute accent among them', () => {
    // U+00B4 is the one NFKC would split into a space and a mark if it ran first.
    for (const a of ["'", '’', '‘', 'ʼ', '`', '´', '＇']) {
      expect(normaliseVenueName(`Joe${a}s Tavern`), `U+${a.codePointAt(0)?.toString(16)}`).toBe(
        'joes tavern'
      );
    }
  });

  it('keeps a combining mark with its letter: two names that differ in a vowel sign stay two', () => {
    const cafe = normaliseVenueName('कैफ़े');
    const coffee = normaliseVenueName('काफ़ी');
    expect(cafe).not.toBe(coffee);
    expect(cafe).not.toContain(' ');
    expect(normaliseVenueName('İstanbul Cafe')).toBe('i̇stanbul cafe');
  });

  it('keeps accents: "Café" and "Cafe" are two names (accepted)', () => {
    expect(normaliseVenueName('Café Olé')).not.toBe(normaliseVenueName('Cafe Ole'));
  });

  it('drops "the" only as a leading word', () => {
    expect(normaliseVenueName('The Lodge')).toBe('lodge');
    expect(normaliseVenueName('Theatre Royal')).toBe('theatre royal');
    expect(normaliseVenueName('Over the Rhine')).toBe('over the rhine');
  });

  it('gives an empty string when nothing is left', () => {
    expect(normaliseVenueName('!!! ...')).toBe('');
    expect(normaliseVenueName(null)).toBe('');
    expect(normaliseVenueName(undefined)).toBe('');
  });
});

describe('spine keys v1: venue_canonical_id', () => {
  it.each(fixtures.venues.map((v) => [v.name, v.h3_res7, v.venue_canonical_id]))(
    '%j in %s -> %s',
    async (name, cell, id) => {
      expect(await venueCanonicalId(name, cell)).toBe(id);
    }
  );

  it('one venue typed two ways is one id', async () => {
    const a = await venueCanonicalId("Joe's Tavern", '872664c1affffff');
    const b = await venueCanonicalId('JOES  TAVERN', '872664c1affffff');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('the same name in another res-7 cell is another venue', async () => {
    const a = await venueCanonicalId('Eagles Hall', '872664c1affffff');
    const b = await venueCanonicalId('Eagles Hall', '872664c1bffffff');
    expect(a).not.toBe(b);
  });

  it.each(fixtures.no_venue_key.map((v) => [v.why, v.name, v.h3_res7]))(
    'no key: %s',
    async (_why, name, cell) => {
      expect(await venueCanonicalId(name, cell)).toBeNull();
    }
  );
});

describe('spine keys v1: the night bucket', () => {
  it.each(fixtures.buckets.map((b) => [b.note, b, b.bucket]))('%s', (_note, input, bucket) => {
    expect(eventNightBucket(input)).toBe(bucket);
  });

  it.each(fixtures.no_bucket.map((b) => [b.why, b]))('no bucket: %s', (_why, input) => {
    expect(eventNightBucket(input)).toBeNull();
  });

  it('works on the wall clock, not on the instant minus four hours', () => {
    // Fall-back day in Chicago: 03:30 local happens at 09:30Z (CST). Subtracting
    // four hours from the instant would still say Oct 31 here, but on the
    // spring-forward day 04:30 local is 09:30Z, and "minus four hours" would
    // wrongly land on Mar 7.
    expect(
      eventNightBucket({
        starts_at: '2026-03-08T09:30:00Z',
        start_date: '2026-03-08',
        timezone: 'America/Chicago',
      })
    ).toBe('2026-03-08');
  });
});

describe('spine keys v1: event_correlation_id', () => {
  it.each(fixtures.events.map((e) => [e.uec_code, e.bucket, e]))(
    '%s on %s',
    async (_code, _bucket, e) => {
      expect(await eventCorrelationId(e.venue_canonical_id, e.uec_code, e.bucket)).toBe(
        e.event_correlation_id
      );
    }
  );

  it('same venue, type and night is one id; a different type or night is not', async () => {
    const [same, otherType, otherNight, otherVenue] = fixtures.events;
    const again = await eventCorrelationId(same.venue_canonical_id, same.uec_code, same.bucket);
    expect(again).toBe(same.event_correlation_id);
    const ids = new Set([
      same.event_correlation_id,
      otherType.event_correlation_id,
      otherNight.event_correlation_id,
      otherVenue.event_correlation_id,
    ]);
    expect(ids.size).toBe(4);
  });

  it.each(fixtures.no_event_key.map((e) => [e.why, e]))('no key: %s', async (_why, e) => {
    expect(await eventCorrelationId(e.venue_canonical_id, e.uec_code, e.bucket)).toBeNull();
  });
});

describe('spine keys v1: computeSpineKeys (a stored row in, both keys out)', () => {
  const row = {
    location: 'The Eagles Hall',
    h3_res7: '872664c1affffff',
    uec_code: 'ART-MUSIC-001',
    starts_at: '2026-10-22T23:30:00Z',
    start_date: '2026-10-22',
    timezone: 'America/Chicago',
  };

  it('computes both keys from the row', async () => {
    const keys = await computeSpineKeys(row);
    expect(keys.venue_canonical_id).toBe(fixtures.venues[3].venue_canonical_id);
    expect(keys.event_correlation_id).toBe(fixtures.events[0].event_correlation_id);
  });

  it('a key is never computed from part of its inputs', async () => {
    expect(await computeSpineKeys({ ...row, h3_res7: null })).toEqual({
      venue_canonical_id: null,
      event_correlation_id: null,
    });
    const untyped = await computeSpineKeys({ ...row, uec_code: null });
    expect(untyped.venue_canonical_id).toBe(fixtures.venues[3].venue_canonical_id);
    expect(untyped.event_correlation_id).toBeNull();
    const undated = await computeSpineKeys({ ...row, starts_at: null, start_date: null });
    expect(undated.event_correlation_id).toBeNull();
  });

  it('no coordinate can reach the hash: the function does not read lat, lon or the res-9 cell', async () => {
    const withGeo = { ...row, lat: 41.87, lon: -86.6, h3_res9: '892664c1a03ffff' };
    expect(await computeSpineKeys(withGeo)).toEqual(await computeSpineKeys(row));
  });

  it('is versioned', () => {
    expect(SPINE_KEY_VERSION).toBe('v1');
    expect(fixtures.version).toBe(SPINE_KEY_VERSION);
  });
});
