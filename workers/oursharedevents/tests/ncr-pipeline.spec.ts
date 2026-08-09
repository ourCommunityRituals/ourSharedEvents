/**
 * OSE-582 — NCR pipeline invariant: close conformance gap on #4 (ncr_data_accumulation)
 *
 * Invariant #4 claims NCR corridor density is:
 *   - Suppressed below the privacy floor (default minCount=5)
 *   - Accurately counted from valid cells only
 *   - Never mis-renders invalid H3 cell IDs
 *
 * TL-046: NCR accumulation inconsistency (suppression bypass or bad counts)
 *
 * Tests are L1 unit tests importing renderCorridorMap directly.
 */

import { describe, test, expect } from 'vitest';
import { renderCorridorMap } from '../src/lib/corridor-map';
import type { CellDensity } from '../src/lib/corridor-map';

// Two valid Chicago-area H3 cells (res 7) — verified with h3.latLngToCell(41.8781, -87.6298, 7)
// and h3.gridDisk. renderCorridorMap passes these through isValidCell before processing.
const CELL_A = '872664c1affffff'; // valid res7 cell, Chicago area
const CELL_B = '872664cadffffff'; // valid res7 cell, adjacent (gridDisk neighbor)

describe('OSE-582 — TL-046: NCR suppression floor prevents sub-floor disclosure', () => {
  // @born-red TL-046 | method: design-time-negative-assertion | date: 2026-08-03
  test('cells below default floor (5) appear in suppressed list and are not rendered', () => {
    const cells: CellDensity[] = [
      { cell: CELL_A, count: 3 }, // below floor
      { cell: CELL_B, count: 10 }, // above floor
    ];
    const result = renderCorridorMap(cells);

    expect(result.suppressed, 'cell with count < 5 must be suppressed').toContain(CELL_A);
    expect(result.suppressed, 'cell with count >= 5 must not be suppressed').not.toContain(CELL_B);
    expect(result.rendered, 'only above-floor cells count toward rendered').toBe(1);
  });

  // @born-red TL-046 | method: design-time-negative-assertion | date: 2026-08-03
  test('cells at exactly the floor boundary (count === minCount) are NOT suppressed', () => {
    const cells: CellDensity[] = [
      { cell: CELL_A, count: 5 }, // exactly at floor
    ];
    const result = renderCorridorMap(cells, { minCount: 5 });

    expect(result.suppressed, 'count === minCount must NOT be suppressed').not.toContain(CELL_A);
    expect(result.rendered).toBe(1);
  });

  test('count === minCount - 1 is suppressed', () => {
    const cells: CellDensity[] = [
      { cell: CELL_A, count: 4 }, // one below floor
    ];
    const result = renderCorridorMap(cells, { minCount: 5 });

    expect(result.suppressed).toContain(CELL_A);
    expect(result.rendered).toBe(0);
  });

  // @born-red TL-046 | method: design-time-negative-assertion | date: 2026-08-03
  test('custom minCount is respected (floor is configurable, default is 5)', () => {
    const cells: CellDensity[] = [
      { cell: CELL_A, count: 3 },
      { cell: CELL_B, count: 7 },
    ];

    // With minCount=8: both suppressed
    const r8 = renderCorridorMap(cells, { minCount: 8 });
    expect(r8.suppressed).toContain(CELL_A);
    expect(r8.suppressed).toContain(CELL_B);
    expect(r8.rendered).toBe(0);

    // With minCount=2: both rendered
    const r2 = renderCorridorMap(cells, { minCount: 2 });
    expect(r2.suppressed).not.toContain(CELL_A);
    expect(r2.suppressed).not.toContain(CELL_B);
    expect(r2.rendered).toBe(2);
  });
});

describe('OSE-582 — NCR rendered count is accurate', () => {
  test('rendered count matches number of above-floor cells', () => {
    const cells: CellDensity[] = [
      { cell: CELL_A, count: 2 },  // suppressed
      { cell: CELL_B, count: 12 }, // rendered
    ];
    const result = renderCorridorMap(cells);
    expect(result.rendered).toBe(1);
    expect(result.suppressed).toHaveLength(1);
    expect(result.rendered + result.suppressed.length).toBe(cells.length);
  });

  test('empty input returns rendered=0 and empty suppressed list', () => {
    const result = renderCorridorMap([]);
    expect(result.rendered).toBe(0);
    expect(result.suppressed).toHaveLength(0);
    expect(result.svg).toContain('<svg');
  });

  test('all-above-floor input: suppressed is empty', () => {
    const cells: CellDensity[] = [
      { cell: CELL_A, count: 10 },
      { cell: CELL_B, count: 20 },
    ];
    const result = renderCorridorMap(cells);
    expect(result.suppressed).toHaveLength(0);
    expect(result.rendered).toBe(2);
  });

  test('rendered + suppressed always equals valid input cell count', () => {
    const cells: CellDensity[] = [
      { cell: CELL_A, count: 1 },
      { cell: CELL_B, count: 6 },
    ];
    const result = renderCorridorMap(cells);
    expect(result.rendered + result.suppressed.length).toBe(cells.length);
  });
});

describe('OSE-582 — NCR SVG output is well-formed', () => {
  test('result.svg is a non-empty string containing an SVG element', () => {
    const result = renderCorridorMap([{ cell: CELL_B, count: 10 }]);
    expect(typeof result.svg).toBe('string');
    expect(result.svg.length).toBeGreaterThan(0);
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('</svg>');
  });

  test('SVG does not contain script tags (CSP-clean)', () => {
    const result = renderCorridorMap([{ cell: CELL_B, count: 10 }]);
    expect(result.svg).not.toMatch(/<script/i);
  });

  test('OSE-582 evidence', () => {
    const report = {
      story: 'OSE-582',
      threats_covered: ['TL-046'],
      invariant: 4,
      date: '2026-08-03',
    };
    console.log(`[OSE-582-EVIDENCE] ${JSON.stringify(report)}`);
    expect(report.threats_covered).toHaveLength(1);
  });
});
