/**
 * Scans per stall at a fair (OSE-2004, OSE ADR-034 decision 6): the pure half,
 * lib/booth-counts.ts.
 *
 * Rules held here:
 *   1. a stall is the sum of its placements' poster-hour cells that clear the
 *      floor (5), and reads withheld when none does, whatever the cells add to;
 *   2. "no stall" is one more part built the same way, never a remainder;
 *   3. the fair total and each category total go through floorTotalOfParts, so
 *      a withheld stall never joins them;
 *   4. the fair total equals the event's scans as /stats builds them (scansOf),
 *      and a stall equals the sum of its posters on the poster list;
 *   5. `any_withheld` is a boolean;
 *   6. order follows the organizer, never a count.
 *
 * @born-red OSE-2004 | method: before lib/booth-counts.ts existed the import
 *   failed (the whole file red, no test collected); then one fault at a time
 *   in boothCounts, each restored before the next:
 *   (a) the stall summed raw and floored once (no per-cell floor): 6 of 14 red;
 *   (a2) the floor removed on the stall count: 8 of 14 red;
 *   (b) the pooled total from the raw cell sum: 5 of 14 red;
 *   (c) `any_withheld` as the number of withheld rows: 5 of 14 red
 * | date: 2026-11-16
 *
 * Placement: node project (pure; no runtime).
 */

import { describe, expect, test } from 'vitest';
import {
  BOOTH_COUNTS_KEYS,
  BOOTH_COUNT_ROW_KEYS,
  boothCounts,
  type BoothRef,
  type PlacementRef,
} from '../src/lib/booth-counts';
import { posterScans, scansByPoster, scansOf, type ScanCell } from '../src/lib/scan-cells';

const WITHHELD = { count: null, suppressed: true, floor: 5 };
const shown = (count: number) => ({ count, suppressed: false, floor: 5 });

const stall = (
  id: string,
  number: string,
  category: string | null = null,
  active = true
): BoothRef => ({
  id,
  number,
  name: `Stall ${number}`,
  category,
  is_active: active,
});
const cell = (poster: string, hour: string, n: number): ScanCell => ({ poster, hour, n });
const H = (h: number) => `2026-12-05T${String(h).padStart(2, '0')}`;

describe('a stall is the sum of its cleared placement-hours', () => {
  test('two placements at 4 and 3 in different hours: the stall is withheld, not 7', () => {
    const out = boothCounts(
      [stall('b1', 'A1')],
      [
        { id: 'p1', booth_id: 'b1' },
        { id: 'p2', booth_id: 'b1' },
      ],
      [cell('p1', H(10), 4), cell('p2', H(11), 3)]
    );
    expect(out.booths[0].scans).toEqual(WITHHELD);
    expect(out.total).toEqual(WITHHELD);
    expect(out.any_withheld).toBe(true);
  });

  test('the same 4 and 3 in the same hour on two codes are still two cells: withheld', () => {
    const out = boothCounts(
      [stall('b1', 'A1')],
      [
        { id: 'p1', booth_id: 'b1' },
        { id: 'p2', booth_id: 'b1' },
      ],
      [cell('p1', H(10), 4), cell('p2', H(10), 3)]
    );
    expect(out.booths[0].scans).toEqual(WITHHELD);
  });

  // OSE-2151: a cleared hour is published rounded down to a multiple of 5.
  test('seven in one hour at one placement: the stall reads 5', () => {
    const out = boothCounts(
      [stall('b1', 'A1')],
      [{ id: 'p1', booth_id: 'b1' }],
      [cell('p1', H(10), 7)]
    );
    expect(out.booths[0].scans).toEqual(shown(5));
    expect(out.total).toEqual(shown(5));
    expect(out.any_withheld).toBe(false);
  });

  test('a cleared hour and a withheld hour: only the cleared one counts (6 + 4 reads 5)', () => {
    const out = boothCounts(
      [stall('b1', 'A1')],
      [{ id: 'p1', booth_id: 'b1' }],
      [cell('p1', H(10), 6), cell('p1', H(11), 4)]
    );
    expect(out.booths[0].scans).toEqual(shown(5));
  });

  test('a stall with no placement, and one with no scans, read withheld (never 0)', () => {
    const out = boothCounts(
      [stall('b1', 'A1'), stall('b2', 'A2')],
      [{ id: 'p2', booth_id: 'b2' }],
      []
    );
    expect(out.booths.map((b) => b.scans)).toEqual([WITHHELD, WITHHELD]);
    expect(JSON.stringify(out)).not.toMatch(/"count":0\b/);
  });
});

describe('"no stall" is one more part, built the same way', () => {
  test("a placement with no stall, one pointing at another event's stall, and a stray cell", () => {
    const out = boothCounts(
      [stall('b1', 'A1')],
      [
        { id: 'p1', booth_id: 'b1' },
        { id: 'p2', booth_id: null },
        { id: 'p3', booth_id: 'not-this-event' },
      ],
      [cell('p1', H(10), 5), cell('p2', H(10), 6), cell('p3', H(10), 2), cell('p9', H(10), 8)]
    );
    // 6 + 8 publish as 5 + 5; with the stall's 5 the total is 15.
    expect(out.no_stall).toEqual({ placements: 2, scans: shown(10) });
    expect(out.total).toEqual(shown(15));
  });

  test('"no stall" with placements and nothing cleared is a withheld row', () => {
    const out = boothCounts(
      [stall('b1', 'A1')],
      [
        { id: 'p1', booth_id: 'b1' },
        { id: 'p2', booth_id: null },
      ],
      [cell('p1', H(10), 9), cell('p2', H(10), 4)]
    );
    expect(out.no_stall.scans).toEqual(WITHHELD);
    expect(out.any_withheld).toBe(true);
  });

  test('an empty "no stall" (no placements) does not count as a withheld row', () => {
    const out = boothCounts(
      [stall('b1', 'A1')],
      [{ id: 'p1', booth_id: 'b1' }],
      [cell('p1', H(10), 9)]
    );
    expect(out.no_stall.placements).toBe(0);
    expect(out.any_withheld).toBe(false);
  });
});

describe('totals never take a withheld stall', () => {
  const booths = [stall('b1', 'A1', 'food'), stall('b2', 'A2', 'food'), stall('b3', 'B1', 'craft')];
  const placements: PlacementRef[] = [
    { id: 'p1', booth_id: 'b1' },
    { id: 'p2', booth_id: 'b2' },
    { id: 'p3', booth_id: 'b3' },
  ];
  const cells = [
    cell('p1', H(10), 6),
    cell('p2', H(10), 3),
    cell('p3', H(10), 4),
    cell('p3', H(12), 4),
  ];
  const out = boothCounts(booths, placements, cells);

  test('the fair total is the published stalls only: 5 (6 rounded), not 17 and not 9', () => {
    expect(out.total).toEqual(shown(5));
  });

  test('a category is its published stalls: food 5 (6 rounded), craft withheld (4 + 4 is not 8)', () => {
    expect(out.categories).toEqual([
      { category: 'food', booths: 2, scans: shown(5) },
      { category: 'craft', booths: 1, scans: WITHHELD },
    ]);
  });

  test('total minus every published row is 0: the classic subtraction finds nothing', () => {
    const published = out.booths.reduce((s, b) => s + (b.scans.count ?? 0), 0);
    expect((out.total.count ?? 0) - published - (out.no_stall.scans.count ?? 0)).toBe(0);
  });

  test('the fair total equals /stats (scansOf), and each stall equals the sum of its posters', () => {
    expect(out.total).toEqual(scansOf(cells));
    const byPoster = scansByPoster(cells);
    for (const b of out.booths) {
      const posters = placements.filter((p) => p.booth_id === b.id).map((p) => p.id);
      const sum = posters.reduce((s, p) => s + (posterScans(byPoster, p).count ?? 0), 0);
      expect(b.scans.count ?? 0, b.number).toBe(sum);
    }
  });
});

describe('the shape', () => {
  test('only the declared keys, and any_withheld is a boolean', () => {
    const out = boothCounts(
      [stall('b1', 'A1')],
      [{ id: 'p1', booth_id: 'b1' }],
      [cell('p1', H(10), 2)]
    );
    expect(Object.keys(out).sort()).toEqual([...BOOTH_COUNTS_KEYS].sort());
    expect(Object.keys(out.booths[0]).sort()).toEqual([...BOOTH_COUNT_ROW_KEYS].sort());
    expect(typeof out.any_withheld).toBe('boolean');
  });

  test("order is the organizer's and the category list's, never a count", () => {
    const out = boothCounts(
      [stall('b2', 'Z9', null), stall('b1', 'A1', 'craft'), stall('b3', 'M5', 'food', false)],
      [
        { id: 'p1', booth_id: 'b1' },
        { id: 'p2', booth_id: 'b2' },
      ],
      [cell('p2', H(10), 50), cell('p1', H(10), 3)]
    );
    expect(out.booths.map((b) => b.id)).toEqual(['b2', 'b1', 'b3']);
    expect(out.categories.map((c) => c.category)).toEqual(['food', 'craft', null]);
  });
});
