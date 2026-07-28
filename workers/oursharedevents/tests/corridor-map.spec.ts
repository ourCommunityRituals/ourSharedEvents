/**
 * OSE-495 — Corridor map module (S-6.3.1a)
 *
 * 8 tests covering renderCorridorMap from src/lib/corridor-map.ts:
 *
 *   1. Empty state — no cells → empty SVG with correct aria-label
 *   2. Day-one single-hex honesty — one Eagles Hall cell (count=1) renders
 *      as suppressed, NOT empty state (the hex outline is the product)
 *   3. Suppression floor (above) — cell at exactly minCount renders as active
 *   4. Suppressed counts NEVER serialized — suppressed polygon has no data-count
 *   5. Suppressed polygon title says "below reporting floor" (no number)
 *   6. Ring-view with room-to-grow — two valid cells above floor both rendered
 *   7. XSS protection — label with HTML special chars is escaped in SVG output
 *   8. Invalid cell ID filtered — garbage string never appears in rendered output
 *
 * Eagles Hall ground truth: res9 = 89266454447ffff
 */

import { describe, test, expect } from 'vitest';
import { renderCorridorMap, type CellDensity } from '../src/lib/corridor-map';

const EAGLES_RES9 = '89266454447ffff';
// Rock Island Public House — same corridor (res7), different node (res9)
const RIPH_RES9 = '89266454443ffff';

describe('OSE-495: corridor-map module', () => {
  test('1. Empty state — no cells returns empty SVG with corridor-map-empty testid', () => {
    const result = renderCorridorMap([]);
    expect(result.rendered).toBe(0);
    expect(result.suppressed).toHaveLength(0);
    expect(result.svg).toContain('data-testid="corridor-map-empty"');
    expect(result.svg).toContain('Corridor data accumulates');
    // Must NOT claim this is a data map
    expect(result.svg).not.toContain('data-testid="corridor-map"');
  });

  test('2. Day-one single-hex honesty — count=1 renders suppressed outline, not empty state', () => {
    const cells: CellDensity[] = [{ cell: EAGLES_RES9, count: 1 }];
    const result = renderCorridorMap(cells);
    // Must not be the empty state — the hex outline IS the product day-one
    expect(result.svg).not.toContain('data-testid="corridor-map-empty"');
    expect(result.svg).toContain('data-testid="corridor-map"');
    // The cell is suppressed (count=1 < default floor=5)
    expect(result.suppressed).toContain(EAGLES_RES9);
    expect(result.rendered).toBe(0);
    // Outline present
    expect(result.svg).toContain('data-testid="hex-suppressed"');
  });

  test('3. Suppression floor (at threshold) — count === minCount renders as active', () => {
    const minCount = 5;
    const cells: CellDensity[] = [{ cell: EAGLES_RES9, count: minCount }];
    const result = renderCorridorMap(cells, { minCount });
    // count >= minCount → NOT suppressed
    expect(result.suppressed).not.toContain(EAGLES_RES9);
    expect(result.rendered).toBe(1);
    expect(result.svg).toContain('data-testid="hex-cell"');
    expect(result.svg).not.toContain('data-testid="hex-suppressed"');
  });

  test('4. Suppressed counts NEVER serialized — suppressed polygon has no data-count attribute', () => {
    const cells: CellDensity[] = [{ cell: EAGLES_RES9, count: 2 }];
    const result = renderCorridorMap(cells);
    expect(result.suppressed).toContain(EAGLES_RES9);
    // The suppressed polygon must carry no count — privacy floor enforcement
    expect(result.svg).not.toMatch(/data-testid="hex-suppressed"[^>]*data-count/);
    // No data-count attribute at all in a suppression-only map
    expect(result.svg).not.toContain('data-count=');
  });

  test('5. Suppressed polygon title says "below reporting floor" — no count number exposed', () => {
    const cells: CellDensity[] = [{ cell: EAGLES_RES9, count: 3 }];
    const result = renderCorridorMap(cells);
    expect(result.suppressed).toContain(EAGLES_RES9);
    expect(result.svg).toContain('Activity below reporting floor');
    // The digit "3" must NOT appear inside the SVG — count is suppressed
    expect(result.svg).not.toContain('>3<');
    expect(result.svg).not.toMatch(/\b3 scan/);
  });

  test('6. Ring-view with room-to-grow — two cells above floor both rendered', () => {
    const cells: CellDensity[] = [
      { cell: EAGLES_RES9, count: 12, label: 'Eagles Hall' },
      { cell: RIPH_RES9, count: 8, label: 'RIPH' },
    ];
    const result = renderCorridorMap(cells, { minCount: 5 });
    expect(result.rendered).toBe(2);
    expect(result.suppressed).toHaveLength(0);
    // Both cells appear in the SVG
    expect(result.svg).toContain(`data-cell="${EAGLES_RES9}"`);
    expect(result.svg).toContain(`data-cell="${RIPH_RES9}"`);
    // Both counts present
    expect(result.svg).toContain('data-count="12"');
    expect(result.svg).toContain('data-count="8"');
  });

  test('7. XSS protection — label with HTML special chars is escaped in SVG output', () => {
    const xssLabel = '<script>alert("xss")</script>';
    const cells: CellDensity[] = [{ cell: EAGLES_RES9, count: 10, label: xssLabel }];
    const result = renderCorridorMap(cells, { minCount: 5 });
    expect(result.rendered).toBe(1);
    // Raw tags must not appear
    expect(result.svg).not.toContain('<script>');
    expect(result.svg).not.toContain('</script>');
    // Escaped form must be present
    expect(result.svg).toContain('&lt;script&gt;');
    expect(result.svg).toContain('alert(&quot;xss&quot;)');
  });

  test('8. Invalid cell ID is filtered — garbage string never appears in rendered output', () => {
    const cells: CellDensity[] = [
      { cell: 'not-a-valid-h3-cell', count: 100 },
      { cell: EAGLES_RES9, count: 10 },
    ];
    const result = renderCorridorMap(cells, { minCount: 5 });
    // Only the valid Eagles Hall cell should render
    expect(result.rendered).toBe(1);
    expect(result.svg).toContain(`data-cell="${EAGLES_RES9}"`);
    // The invalid cell must not appear at all
    expect(result.svg).not.toContain('not-a-valid-h3-cell');
  });
});
