/**
 * OSE-658 — public event page cache-coherence.
 *
 * The one URL renders pre/in/post state derived per request; a cache must never
 * serve a state past its phase pivot, and must never shared-cache a sub-floor
 * count (#7). publicEventCacheControl() enforces both: private + hard-expiring
 * by the next boundary.
 */

import { describe, it, expect } from 'vitest';
import {
  secondsToNextPhaseBoundary,
  publicEventCacheControl,
  PHASE_CACHE_MAX_AGE_CAP,
} from '../src/lib/phase-cache';
import type { EventPhaseInput } from '../src/domain/event-phase';

const NOW = new Date('2026-06-01T20:00:00Z');
const ev = (start: string | null, end: string | null, status = 'active'): EventPhaseInput => ({
  status,
  start_date: start,
  end_date: end,
});
const maxAge = (cc: string) => Number(cc.match(/max-age=(\d+)/)![1]);

describe('OSE-658 | secondsToNextPhaseBoundary', () => {
  it('pre_event → seconds until start_date', () => {
    // start 2 minutes from NOW
    const secs = secondsToNextPhaseBoundary(ev('2026-06-01T20:02:00Z', '2026-06-01T22:00:00Z'), 'pre_event', NOW);
    expect(secs).toBe(120);
  });

  it('event → seconds until end_date', () => {
    const secs = secondsToNextPhaseBoundary(ev('2026-06-01T19:00:00Z', '2026-06-01T20:00:30Z'), 'event', NOW);
    expect(secs).toBe(30);
  });

  it('post_event → null (no forward boundary)', () => {
    expect(secondsToNextPhaseBoundary(ev('2026-06-01T18:00:00Z', '2026-06-01T19:00:00Z'), 'post_event', NOW)).toBeNull();
  });

  it('missing/malformed dates → null', () => {
    expect(secondsToNextPhaseBoundary(ev(null, null), 'pre_event', NOW)).toBeNull();
    expect(secondsToNextPhaseBoundary(ev('not-a-date', null), 'pre_event', NOW)).toBeNull();
  });

  it('honors timezone offset in the stored date', () => {
    // 20:02:00+00:00 expressed as an offset time = same instant as 22:02:00+02:00
    const secs = secondsToNextPhaseBoundary(ev('2026-06-01T22:02:00+02:00', null), 'pre_event', NOW);
    expect(secs).toBe(120);
  });
});

describe('OSE-658 | publicEventCacheControl — coherence + wall', () => {
  it('is ALWAYS private, never public (no shared-edge cache of a sub-floor count)', () => {
    for (const [phase, e] of [
      ['pre_event', ev('2026-06-01T21:00:00Z', '2026-06-01T22:00:00Z')],
      ['event', ev('2026-06-01T19:00:00Z', '2026-06-01T21:00:00Z')],
      ['post_event', ev('2026-06-01T18:00:00Z', '2026-06-01T19:00:00Z')],
    ] as const) {
      const cc = publicEventCacheControl(e, phase, NOW);
      expect(cc).toMatch(/(^|[,\s])private/);
      expect(cc).not.toMatch(/public/);
    }
  });

  it('never lets max-age exceed the seconds to the pivot (no stale state past the boundary)', () => {
    // start 90s away → max-age must be <= 90
    const cc = publicEventCacheControl(ev('2026-06-01T20:01:30Z', '2026-06-01T22:00:00Z'), 'pre_event', NOW);
    expect(maxAge(cc)).toBe(90);
  });

  it('caps a far-away boundary at PHASE_CACHE_MAX_AGE_CAP', () => {
    // start 3 hours away → capped
    const cc = publicEventCacheControl(ev('2026-06-01T23:00:00Z', '2026-06-02T00:00:00Z'), 'pre_event', NOW);
    expect(maxAge(cc)).toBe(PHASE_CACHE_MAX_AGE_CAP);
  });

  it('never emits a negative max-age at/after the boundary', () => {
    // end already passed relative to NOW while still nominally "event"
    const cc = publicEventCacheControl(ev('2026-06-01T18:00:00Z', '2026-06-01T19:59:30Z'), 'event', NOW);
    expect(maxAge(cc)).toBe(0);
  });

  it('post_event (no forward boundary) uses the cap', () => {
    const cc = publicEventCacheControl(ev('2026-06-01T18:00:00Z', '2026-06-01T19:00:00Z'), 'post_event', NOW);
    expect(maxAge(cc)).toBe(PHASE_CACHE_MAX_AGE_CAP);
  });
});
