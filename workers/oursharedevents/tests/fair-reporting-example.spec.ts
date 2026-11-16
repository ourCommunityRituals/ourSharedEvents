/**
 * The worked example in docs/features/FAIR-REPORTING.md, computed (OSE-2004).
 *
 * A synthetic fair at the size of the reference fair: 120 stalls, 3 days, open
 * 10:00 to 17:00. Nothing here is a real fair, vendor or person; the
 * distribution is invented and stated below. The scans go through the real
 * code (lib/booth-counts.ts, lib/scan-cells.ts), and the numbers this file
 * computes must be the numbers in the doc's example table, row by row, so the
 * table carries its method:
 *
 *   cd workers/oursharedevents && npx vitest run --config vitest.node.config.mts tests/fair-reporting-example.spec.ts
 *
 * THE DISTRIBUTION (synthetic, stated):
 *   - 120 stalls, 15 in each of the 8 categories; each has a table card, and
 *     every fourth stall also a banner (150 stall codes); 4 entrance posters
 *     point at no stall;
 *   - 7 open hours a day on 3 days; each code's scans in an hour are Poisson
 *     with mean (stall tier) × (day): tiers busy 6 (24 stalls), steady 2.5
 *     (60), quiet 0.8 (36); a banner draws half its stall's mean; an entrance
 *     poster 4; days 0.6, 1.3 and 1.0;
 *   - the random source is mulberry32 with seed 2004, so every run is the same.
 *
 * @born-red OSE-2004 | method: run with the doc absent (1 of 1 red), and with one
 *   number in the doc's table changed (38 of 120 to 37 of 120): 1 of 1 red
 *   | date: 2026-11-16
 *
 * Placement: node project (pure, reads the doc).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { boothCounts, type BoothRef, type PlacementRef } from '../src/lib/booth-counts';
import { BOOTH_CATEGORIES } from '../src/lib/event-booths';
import { floorTotalOfParts } from '../src/lib/count-floor';
import { scansByLocalDay, scansOf, type ScanCell } from '../src/lib/scan-cells';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(rand: () => number, mean: number): number {
  const limit = Math.exp(-mean);
  let k = 0;
  let p = rand();
  while (p > limit) {
    k++;
    p *= rand();
  }
  return k;
}

const DAYS = ['2026-06-05', '2026-06-06', '2026-06-07'];
const DAY_FACTOR = [0.6, 1.3, 1.0];
const HOURS = [10, 11, 12, 13, 14, 15, 16];

function exampleFair() {
  const rand = mulberry32(2004);
  const booths: BoothRef[] = [];
  const placements: PlacementRef[] = [];
  const means = new Map<string, number>();
  for (let i = 0; i < 120; i++) {
    const id = `s${i + 1}`;
    booths.push({
      id,
      number: String(i + 1),
      name: `Stall ${i + 1}`,
      category: BOOTH_CATEGORIES[i % BOOTH_CATEGORIES.length],
      is_active: true,
    });
    // Tiers by position: 24 busy, 60 steady, 36 quiet.
    const mean = i % 5 === 0 ? 6 : i % 10 === 3 || i % 10 === 7 || i % 10 === 9 ? 0.8 : 2.5;
    placements.push({ id: `${id}-card`, booth_id: id });
    means.set(`${id}-card`, mean);
    if (i % 4 === 0) {
      placements.push({ id: `${id}-banner`, booth_id: id });
      means.set(`${id}-banner`, mean / 2);
    }
  }
  for (let e = 1; e <= 4; e++) {
    placements.push({ id: `entrance-${e}`, booth_id: null });
    means.set(`entrance-${e}`, 4);
  }
  const cells: ScanCell[] = [];
  DAYS.forEach((day, d) => {
    for (const h of HOURS)
      for (const p of placements) {
        const n = poisson(rand, means.get(p.id)! * DAY_FACTOR[d]);
        if (n > 0) cells.push({ poster: p.id, hour: `${day}T${String(h).padStart(2, '0')}`, n });
      }
  });
  return { booths, placements, cells };
}

/** The example's numbers, as the doc's table rows: [label, value]. */
function exampleRows(): [string, string][] {
  const { booths, placements, cells } = exampleFair();
  const out = boothCounts(booths, placements, cells);
  const raw = cells.reduce((s, c) => s + c.n, 0);
  const allCells = placements.length * HOURS.length * DAYS.length;
  const cleared = cells.filter((c) => c.n >= 5);
  const withheldStalls = out.booths.filter((b) => b.scans.suppressed).length;
  const days = scansByLocalDay(cells, 'UTC', new Date(`${DAYS[2]}T20:00:00Z`), DAYS.length);
  // Stall × day: NOT published (see the doc); counted to show why.
  let stallDays = 0;
  let stallDaysWithheld = 0;
  for (const b of booths) {
    const own = new Set(placements.filter((p) => p.booth_id === b.id).map((p) => p.id));
    for (const day of DAYS) {
      stallDays++;
      const parts = cells
        .filter((c) => own.has(c.poster) && c.hour.startsWith(day))
        .map((c) => c.n);
      if (floorTotalOfParts(parts).suppressed) stallDaysWithheld++;
    }
  }
  const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
  return [
    ['Codes (placements)', String(placements.length)],
    ['Placement-hour cells', String(allCells)],
    ['Cells with 5 or more scans', String(cleared.length)],
    ['Scans made (raw, never published)', String(raw)],
    ['Scans published (fair total)', String(out.total.count)],
    ['Share of scans published', pct(out.total.count ?? 0, raw)],
    ['Fair total equals /stats', String(out.total.count === scansOf(cells).count)],
    ['Stalls reading "Fewer than 5"', `${withheldStalls} of ${booths.length}`],
    [
      'Days reading "Fewer than 5"',
      `${days.filter((d) => d.count.suppressed).length} of ${DAYS.length}`,
    ],
    [
      'Categories reading "Fewer than 5"',
      `${out.categories.filter((c) => c.scans.suppressed).length} of ${out.categories.length}`,
    ],
    [
      '"No stall" (4 entrance posters)',
      out.no_stall.scans.suppressed ? 'Fewer than 5' : String(out.no_stall.scans.count),
    ],
    [
      'Stall-days that would read "Fewer than 5" (not published)',
      `${stallDaysWithheld} of ${stallDays}`,
    ],
  ];
}

const DOC = join(__dirname, '..', '..', '..', 'docs', 'features', 'FAIR-REPORTING.md');

/** The rows of the doc's example table, between its markers. */
function docRows(): Map<string, string> {
  const text = readFileSync(DOC, 'utf8');
  const a = text.indexOf('<!-- fair-example:begin -->');
  const b = text.indexOf('<!-- fair-example:end -->');
  expect(a, 'the doc has the example markers').toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  const rows = new Map<string, string>();
  for (const line of text.slice(a, b).split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4 || /^-+$/.test(cells[1]) || cells[1] === 'Measure') continue;
    rows.set(cells[1], cells[2]);
  }
  return rows;
}

describe('OSE-2004 | the worked example in FAIR-REPORTING.md is what the code computes', () => {
  test('every row of the doc table matches, and no row is missing', () => {
    const want = exampleRows();
    const got = docRows();
    for (const [label, value] of want) expect(got.get(label), label).toBe(value);
    expect([...got.keys()].sort()).toEqual(want.map(([l]) => l).sort());
  });
});
