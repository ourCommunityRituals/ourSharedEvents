/**
 * OSE-665 — applyCountFloor unit tests (pure).
 *
 * The uniform K-anon floor MUST match the SharedReport / corridor-map rule
 * (`count < floor` → suppressed) using the same constant, so the admin tile and
 * the report show a sub-5 cohort identically. Pins: 0..4 suppressed, >=5 exact,
 * floor echoed, and the default floor equals CORRIDOR_MAP_MIN_COUNT.
 */

import { describe, test, expect } from 'vitest';
import {
  applyCountFloor,
  flooredRatePct,
  floorNestedCounts,
  floorTotalOfParts,
} from '../src/lib/count-floor';
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

describe('floorNestedCounts — a chain of nested counts never subtracts to a small group', () => {
  test('each count alone must clear the floor', () => {
    expect(floorNestedCounts([20, 4, 0])).toEqual([20, null, null]);
  });

  test('a gap under the floor suppresses the smaller count (12 − 9 = 3 people)', () => {
    expect(floorNestedCounts([12, 9])).toEqual([12, null]);
  });

  test('a gap of exactly the floor, or of zero, is published', () => {
    expect(floorNestedCounts([10, 5])).toEqual([10, 5]);
    expect(floorNestedCounts([7, 7])).toEqual([7, 7]);
  });

  test('the gap is measured from the last PUBLISHED count', () => {
    // 10 published; 7 is 3 short of it → null; 5 is 5 short of 10 → published.
    expect(floorNestedCounts([15, 10, 7, 5])).toEqual([15, 10, null, 5]);
  });

  test('a stricter value floor than gap floor (the corridor baseline: 10 and 5)', () => {
    expect(floorNestedCounts([30, 12], 10, 5)).toEqual([30, 12]);
    expect(floorNestedCounts([30, 27], 10, 5)).toEqual([30, null]);
    expect(floorNestedCounts([9, 4], 10, 5)).toEqual([null, null]);
    expect(floorNestedCounts([11, 3], 10, 5)).toEqual([11, null]);
  });

  test('a chain that is not nested (a later count larger) fails closed', () => {
    expect(floorNestedCounts([10, 12])).toEqual([10, null]);
  });

  test('an increase after a suppressed count still fails closed, and so does the rest', () => {
    // 4 is suppressed, then 10 > 4: the input is not nested, so 10 must not pass.
    expect(floorNestedCounts([4, 10])).toEqual([null, null]);
    // Baseline shape: 90d 9 (under 10), 30d 12 (> 9): both withheld.
    expect(floorNestedCounts([9, 12], 10, 5)).toEqual([null, null]);
    expect(floorNestedCounts([20, 25, 5])).toEqual([20, null, null]);
  });

  test('non-finite and fractional inputs are treated like applyCountFloor treats them', () => {
    expect(floorNestedCounts([5.9])).toEqual([5]);
    expect(floorNestedCounts([10.7, 5.2])).toEqual([10, 5]);
    expect(floorNestedCounts([Number.NaN, Infinity])).toEqual([null, null]);
  });
});

describe('floorTotalOfParts — a total beside its parts is the sum of the published parts', () => {
  test('a part under the floor never joins the sum (6 + 3 is 6, not 9)', () => {
    expect(floorTotalOfParts([6, 3])).toEqual({ count: 6, suppressed: false, floor: 5 });
  });

  test('the total minus the published parts is always zero', () => {
    for (const parts of [
      [20, 3, 4],
      [5, 5, 4, 0],
      [7, 1, 9, 2, 12],
    ]) {
      const published = parts.filter((n) => applyCountFloor(n).count !== null);
      const total = floorTotalOfParts(parts).count ?? 0;
      expect(total - published.reduce((a, b) => a + b, 0)).toBe(0);
    }
  });

  test('small parts never add up past the floor (3 + 3 + 4 is withheld, not 10)', () => {
    expect(floorTotalOfParts([3, 3, 4])).toEqual({ count: null, suppressed: true, floor: 5 });
  });

  test('no parts at all is withheld', () => {
    expect(floorTotalOfParts([])).toEqual({ count: null, suppressed: true, floor: 5 });
  });

  test('a part already withheld (null) or missing counts for nothing', () => {
    expect(floorTotalOfParts([8, null, undefined, 7]).count).toBe(15);
    expect(floorTotalOfParts([null, undefined]).count).toBeNull();
  });

  test('one more in a withheld part changes nothing', () => {
    for (const n of [0, 1, 2, 3]) {
      expect(floorTotalOfParts([20, n])).toEqual(floorTotalOfParts([20, n + 1]));
    }
  });

  test('non-finite and fractional parts are treated like applyCountFloor treats them', () => {
    expect(floorTotalOfParts([5.9, 6.2]).count).toBe(11);
    expect(floorTotalOfParts([Number.NaN, Infinity, -9, 6]).count).toBe(6);
  });

  test('a custom floor applies to each part, and is echoed', () => {
    expect(floorTotalOfParts([12, 7], 10)).toEqual({ count: 12, suppressed: false, floor: 10 });
    expect(floorTotalOfParts([9, 9], 10)).toEqual({ count: null, suppressed: true, floor: 10 });
  });
});

describe('flooredRatePct — a rate is never a head count under the floor', () => {
  test('published when the part and the rest both clear the floor', () => {
    expect(flooredRatePct(5, 10)).toBe(50);
    expect(flooredRatePct(15, 20)).toBe(75);
    expect(flooredRatePct(6, 12)).toBe(50);
  });

  test('a numerator under the floor is withheld, however large the sample', () => {
    for (const part of [0, 1, 2, 3, 4]) {
      expect(flooredRatePct(part, 20)).toBeNull();
      expect(flooredRatePct(part, 5000)).toBeNull();
    }
  });

  test('a denominator under the floor is withheld', () => {
    for (const whole of [0, 1, 2, 3, 4]) {
      expect(flooredRatePct(whole, whole)).toBeNull();
      expect(flooredRatePct(0, whole)).toBeNull();
    }
  });

  test('a rest under the floor is withheld (19 of 20 leaves one person)', () => {
    for (const rest of [1, 2, 3, 4]) {
      expect(flooredRatePct(20 - rest, 20)).toBeNull();
    }
    expect(flooredRatePct(15, 20)).not.toBeNull(); // a rest of exactly the floor
  });

  test('everyone (a rest of none) is published, as the nested-count rule has it', () => {
    expect(flooredRatePct(20, 20)).toBe(100);
    expect(flooredRatePct(5, 5)).toBe(100);
  });

  test('one more person on a withheld side changes nothing', () => {
    for (const n of [0, 1, 2, 3]) {
      expect(flooredRatePct(n, 20)).toBe(flooredRatePct(n + 1, 20));
    }
    for (const n of [1, 2, 3]) {
      expect(flooredRatePct(20 - n, 20)).toBe(flooredRatePct(20 - n - 1, 20));
    }
  });

  test('a part larger than its whole fails closed', () => {
    expect(flooredRatePct(12, 10)).toBeNull();
  });

  test('a custom floor applies to the whole, the part and the rest', () => {
    expect(flooredRatePct(10, 20, 10)).toBe(50);
    expect(flooredRatePct(9, 20, 10)).toBeNull(); // part under 10
    expect(flooredRatePct(15, 20, 10)).toBeNull(); // rest of 5 is under 10
    expect(flooredRatePct(9, 9, 10)).toBeNull(); // whole under 10
  });

  test('non-finite and fractional counts are floored first', () => {
    expect(flooredRatePct(5.9, 10.7)).toBe(50);
    expect(flooredRatePct(Number.NaN, 20)).toBeNull();
    expect(flooredRatePct(10, Infinity)).toBeNull();
  });
});
