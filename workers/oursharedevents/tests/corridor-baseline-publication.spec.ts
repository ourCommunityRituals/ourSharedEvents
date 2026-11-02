/**
 * OSE-1751 — the corridor baseline, as the SharedReport read path publishes it.
 *
 * The 90-day window holds the 30-day one. Published on their own, 112 and 109
 * hand a reader the 3 people who were there only in days 31 to 90. The read path
 * now publishes the pair through `floorCorridorBaseline` (count-floor.ts), the
 * same call the BigQuery export makes. This file holds the pure part: the numbers
 * the report carries for a baseline row, and what it says when one is withheld.
 *
 * The density ratios are the second half of the leak. A ratio is this event's
 * published count over a baseline, so a ratio built on the RAW baseline gives the
 * raw baseline back (count / ratio) and undoes the rounding. They are built on
 * the published value, or not at all.
 *
 * Pure logic, so it runs in the node project. The same rules are read through
 * the real routes by shared-report-read.spec.ts and shared-report-neighbour-floor.spec.ts.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { floorCorridorBaseline } from '../src/lib/count-floor';
import { publishCorridorBaseline } from '../src/lib/shared-report-builder';
import { CORRIDOR_BASELINE_MIN_SAMPLE, CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';

const row = (window_90d_count: number, window_30d_count: number) => ({
  window_90d_count,
  window_30d_count,
});

describe('publishCorridorBaseline — one chain, not two numbers', () => {
  test('112 in 90 days and 109 in 30 days publish as 110 and 105, not as a difference of 3', () => {
    const out = publishCorridorBaseline(row(112, 109), 20);
    expect(out.baseline_90d).toBe(110);
    expect(out.baseline_30d).toBe(105);
    expect(out.suppression).toEqual([]);
  });

  test('the report carries what floorCorridorBaseline gives the export, for every nested pair', () => {
    const drift: string[] = [];
    for (let w90 = 0; w90 <= 150; w90++) {
      for (let w30 = 0; w30 <= w90; w30++) {
        const read = publishCorridorBaseline(row(w90, w30), 20);
        const exported = floorCorridorBaseline(w90, w30);
        if (
          read.baseline_90d !== exported.window_90d ||
          read.baseline_30d !== exported.window_30d
        ) {
          drift.push(`${w90}/${w30}`);
        }
      }
    }
    expect(drift).toEqual([]);
  });

  test('no two published baselines differ by 1 to 4, for every nested pair', () => {
    const named: string[] = [];
    for (let w90 = 0; w90 <= 150; w90++) {
      for (let w30 = 0; w30 <= w90; w30++) {
        const { baseline_90d: a, baseline_30d: b } = publishCorridorBaseline(row(w90, w30), 20);
        if (a !== null && b !== null && a - b >= 1 && a - b < CORRIDOR_MAP_MIN_COUNT) {
          named.push(`${w90}/${w30} -> ${a}/${b}`);
        }
      }
    }
    expect(named).toEqual([]);
  });
});

describe('publishCorridorBaseline — the ratios are built on the published baseline', () => {
  test('a ratio is this event over the published baseline, so it cannot give the raw one back', () => {
    const out = publishCorridorBaseline(row(112, 109), 20);
    expect(out.density_ratio_90d).toBe(20 / 110);
    expect(out.density_ratio_30d).toBe(20 / 105);
    // What a reader can recover from a ratio and the published count is the
    // published baseline: 20 / (20/105) is 105, never 109.
    expect(20 / out.density_ratio_30d!).toBeCloseTo(105, 9);
  });

  test('a ratio whose baseline is withheld is null', () => {
    const out = publishCorridorBaseline(row(80, 9), 20);
    expect(out.baseline_30d).toBeNull();
    expect(out.density_ratio_30d).toBeNull();
    expect(out.density_ratio_90d).toBe(20 / 80);
  });

  test("with this event's own count withheld no ratio is computed, and the baselines still publish", () => {
    const out = publishCorridorBaseline(row(112, 109), null);
    expect(out.density_ratio_30d).toBeNull();
    expect(out.density_ratio_90d).toBeNull();
    expect(out.baseline_90d).toBe(110);
    expect(out.baseline_30d).toBe(105);
  });
});

describe('publishCorridorBaseline — a withheld window says the same thing whatever the cause', () => {
  test('under the floor, and withheld by the chain, read byte for byte alike', () => {
    // 30 days under the floor of 10.
    const underFloor = publishCorridorBaseline(row(80, 9), 20);
    // 30 days at or over the floor but above the 90-day window: not a chain, withheld.
    const byChain = publishCorridorBaseline(row(40, 55), 20);
    expect(underFloor.baseline_30d).toBeNull();
    expect(byChain.baseline_30d).toBeNull();
    expect(JSON.stringify(underFloor.suppression)).toBe(JSON.stringify(byChain.suppression));
  });

  test('each withheld window gets its own entry, on the field it names', () => {
    const out = publishCorridorBaseline(row(9, 3), 20);
    expect(out.suppression.map((s) => s.field)).toEqual([
      'corridor_density.baseline_30d',
      'corridor_density.baseline_90d',
    ]);
    for (const s of out.suppression) expect(s.reason).toBe('below_min_sample_size');
  });

  test('the detail names the floor and no count of anyone', () => {
    const out = publishCorridorBaseline(row(80, 9), 20);
    const detail = out.suppression[0]!.detail!;
    expect(detail).toContain(`fewer than ${CORRIDOR_BASELINE_MIN_SAMPLE}`);
    expect(detail.match(/\d+/g)).toEqual([String(CORRIDOR_BASELINE_MIN_SAMPLE)]);
  });
});

describe('the report builder reaches the baseline only through floorCorridorBaseline', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8');

  test('neither the builder nor the export gates a window against the floor itself', () => {
    const builder = read('src/lib/shared-report-builder.ts');
    const exporter = read('src/lib/shared-report-export.ts');
    for (const [name, src] of [
      ['builder', builder],
      ['export', exporter],
    ] as const) {
      expect(src, `${name} calls floorCorridorBaseline`).toContain('floorCorridorBaseline(');
      // The old shape: a window compared with the floor on its own.
      expect(src, `${name} gates a window on its own`).not.toMatch(
        /window_(30|90)d_count\s*>=\s*CORRIDOR_BASELINE_MIN_SAMPLE/
      );
    }
  });
});
