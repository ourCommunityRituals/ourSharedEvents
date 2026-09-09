/**
 * OSE-665 — applyCountFloor unit tests (pure).
 *
 * The uniform K-anon floor MUST match the SharedReport / corridor-map rule
 * (`count < floor` → suppressed) using the same constant, so the admin tile and
 * the report show a sub-5 cohort identically. Pins: 0..4 suppressed, >=5 exact,
 * floor echoed, and the default floor equals CORRIDOR_MAP_MIN_COUNT.
 */

import { describe, test, expect } from 'vitest';
import { applyCountFloor } from '../src/lib/count-floor';
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';

describe('applyCountFloor — uniform K-anon floor', () => {
  test('default floor is the SharedReport floor (single source of truth)', () => {
    expect(CORRIDOR_MAP_MIN_COUNT).toBe(5);
    expect(applyCountFloor(4).floor).toBe(5);
  });

  test('0..4 are suppressed (matches corridor-map: count < floor), count is null', () => {
    for (const n of [0, 1, 2, 3, 4]) {
      expect(applyCountFloor(n)).toEqual({ count: null, suppressed: true, floor: 5 });
    }
  });

  test('>= floor shows the exact count', () => {
    expect(applyCountFloor(5)).toEqual({ count: 5, suppressed: false, floor: 5 });
    expect(applyCountFloor(42)).toEqual({ count: 42, suppressed: false, floor: 5 });
  });

  test('negative / NaN / fractional inputs are handled safely (never leak a sub-floor value)', () => {
    expect(applyCountFloor(-3)).toEqual({ count: null, suppressed: true, floor: 5 });
    expect(applyCountFloor(Number.NaN)).toEqual({ count: null, suppressed: true, floor: 5 });
    expect(applyCountFloor(4.9)).toEqual({ count: null, suppressed: true, floor: 5 });
    expect(applyCountFloor(5.9)).toEqual({ count: 5, suppressed: false, floor: 5 });
    // Infinity is the ONLY input that distinguishes the finiteness guard from a
    // bare `raw > 0`: without `Number.isFinite`, Math.floor(Infinity)=Infinity
    // sails past the floor as a non-suppressed count. Must be suppressed.
    // (OSE-1186 mutation kill — the finiteness guard had no teeth without this.)
    expect(applyCountFloor(Number.POSITIVE_INFINITY)).toEqual({
      count: null,
      suppressed: true,
      floor: 5,
    });
  });

  test('a custom floor is honored and echoed', () => {
    expect(applyCountFloor(7, 10)).toEqual({ count: null, suppressed: true, floor: 10 });
    expect(applyCountFloor(10, 10)).toEqual({ count: 10, suppressed: false, floor: 10 });
  });
});
