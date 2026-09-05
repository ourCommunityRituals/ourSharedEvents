/**
 * OSE-1242 — the corridor readiness gate (OCR_VISION.md §6.2b, CCR Loop 10).
 *
 * The property under test is not "does 5 mean 5". It is that THE THING COUNTED
 * IS THE THING SHOWN — the gate and the map read the same window, so the
 * customer card can never be promoted onto an empty map. Most of what follows
 * is boundary and direction coverage, because direction is what the retracted
 * gate got wrong (Loop 9) and a number is easy to check while a direction is
 * easy to assume.
 */
import { describe, test, expect } from 'vitest';
import {
  CORRIDOR_READY_MIN_EVENTS,
  CORRIDOR_WINDOW_DAYS,
  isInForwardWindow,
  eventsInWindow,
  isCorridorReady,
} from '../src/lib/corridor-readiness';

const NOW = new Date('2026-09-05T12:00:00Z');
const DAY = 86_400_000;

function at(daysFromNow: number, phase = 'pre_event') {
  return { startDateISO: new Date(NOW.getTime() + daysFromNow * DAY).toISOString(), phase };
}

describe('the window is forward, and its edges are where they are claimed', () => {
  test('an event today is in', () => {
    expect(isInForwardWindow(at(0), NOW)).toBe(true);
  });

  test('an event at exactly +90 days is in — the horizon is inclusive', () => {
    expect(isInForwardWindow(at(CORRIDOR_WINDOW_DAYS), NOW)).toBe(true);
  });

  test('an event at +91 days is out', () => {
    expect(isInForwardWindow(at(CORRIDOR_WINDOW_DAYS + 1), NOW)).toBe(false);
  });

  test('the horizon is 90 days, not 30', () => {
    // Guards against the window quietly reverting to the density baseline's.
    expect(CORRIDOR_WINDOW_DAYS).toBe(90);
    expect(isInForwardWindow(at(60), NOW)).toBe(true);
  });
});

describe('the past edge is decided by phase, never by a date comparison', () => {
  test('a wrapped event is out however recently it happened', () => {
    expect(isInForwardWindow(at(-1, 'post_event'), NOW)).toBe(false);
    expect(isInForwardWindow(at(0, 'post_event'), NOW)).toBe(false);
    // Owner spec: post_event is not on the map at all. Not even a same-day one.
    expect(isInForwardWindow(at(1, 'post_event'), NOW)).toBe(false);
  });

  test('a live event that STARTED IN THE PAST is still in', () => {
    // The case a naive `start >= now` filter gets wrong: a multi-day event
    // that began yesterday is happening right now, and dropping it from the
    // map is exactly the reader-facing failure the map exists to avoid.
    expect(isInForwardWindow(at(-2, 'event'), NOW)).toBe(true);
  });

  test('an unknown or empty phase is out — it cannot be routed to a flow', () => {
    expect(isInForwardWindow(at(5, ''), NOW)).toBe(false);
    expect(isInForwardWindow({ startDateISO: at(5).startDateISO }, NOW)).toBe(false);
    expect(isInForwardWindow(at(5, 'draft'), NOW)).toBe(false);
  });
});

describe('an event that cannot be placed in time is not shown', () => {
  test('a missing start date is out', () => {
    expect(isInForwardWindow({ phase: 'pre_event' }, NOW)).toBe(false);
    expect(isInForwardWindow({ phase: 'pre_event', startDateISO: '' }, NOW)).toBe(false);
  });

  test('an unparseable start date is out rather than throwing', () => {
    expect(isInForwardWindow({ phase: 'pre_event', startDateISO: 'soon' }, NOW)).toBe(false);
  });

  test('a non-string start date is out', () => {
    expect(isInForwardWindow({ phase: 'pre_event', startDateISO: 12345 }, NOW)).toBe(false);
  });
});

describe('the gate counts exactly what the surface would show', () => {
  test('the threshold is 5 and it is inclusive', () => {
    expect(CORRIDOR_READY_MIN_EVENTS).toBe(5);
    const four = [at(1), at(2), at(3), at(4)];
    expect(isCorridorReady(four, NOW)).toBe(false);
    expect(isCorridorReady([...four, at(5)], NOW)).toBe(true);
  });

  test('events outside the window do not count toward readiness', () => {
    // Five events, but every one beyond the horizon. A gate that counted these
    // would open the card onto an empty map.
    const beyond = [1, 2, 3, 4, 5].map((i) => at(CORRIDOR_WINDOW_DAYS + i));
    expect(eventsInWindow(beyond, NOW)).toEqual([]);
    expect(isCorridorReady(beyond, NOW)).toBe(false);
  });

  test('wrapped events do not count toward readiness', () => {
    // The retracted gate counted trailing activity. This asserts the successor
    // does not, in the form the mistake would take here.
    const wrapped = [1, 2, 3, 4, 5, 6].map((i) => at(-i, 'post_event'));
    expect(isCorridorReady(wrapped, NOW)).toBe(false);
  });

  test('the card can never lead on an empty map — the invariant, stated directly', () => {
    // For any input, if the gate says ready then the surface has something to
    // show. This is the property the instrument was chosen for.
    const corpora = [
      [],
      [at(1)],
      [at(1), at(2), at(3), at(4)],
      [at(1), at(2), at(3), at(4), at(5)],
      [...[1, 2, 3, 4, 5, 6].map((i) => at(-i, 'post_event')), at(2)],
      [
        ...[1, 2, 3, 4, 5].map((i) => at(CORRIDOR_WINDOW_DAYS + i)),
        ...[1, 2, 3, 4, 5].map((i) => at(i)),
      ],
      [at(0, 'event'), at(-3, 'event'), at(89), at(90), at(91)],
    ];
    for (const events of corpora) {
      if (isCorridorReady(events, NOW)) {
        expect(eventsInWindow(events, NOW).length).toBeGreaterThanOrEqual(
          CORRIDOR_READY_MIN_EVENTS
        );
      }
    }
  });

  test('null and malformed input are not ready, and do not throw', () => {
    for (const bad of [null, undefined, 'nope', 42, {}]) {
      expect(isCorridorReady(bad as never, NOW)).toBe(false);
      expect(eventsInWindow(bad as never, NOW)).toEqual([]);
    }
  });
});

describe('this gate is not the density baseline', () => {
  test('the threshold is its own number, not CORRIDOR_BASELINE_MIN_SAMPLE', async () => {
    // Loop 9: the two were conflated in ratified doctrine. If someone later
    // "deduplicates" them, this fails and points at the reason.
    const { CORRIDOR_BASELINE_MIN_SAMPLE } = await import('../src/lib/shared-report');
    expect(CORRIDOR_READY_MIN_EVENTS).not.toBe(CORRIDOR_BASELINE_MIN_SAMPLE);
  });
});
