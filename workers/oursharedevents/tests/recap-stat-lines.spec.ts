/**
 * OSE-1752 — the public recap's "Walked in" line says the same thing whichever way
 * it is withheld.
 *
 * Walk-ins are floored as a subset of check-ins (OSE-1657), so a walk-in count can
 * be withheld for two reasons: it is under 5, or it is 5 or more but what is left
 * of the check-ins (registered and attended) would be 1 to 4. The second case used
 * to print "held, so a group under 5 cannot be worked out", which told a reader
 * that walk-ins were 5 or more AND that the rest was a small group: with "Checked
 * in: 20" above it, walk-ins in 16..19. Both cases now print the same markup.
 *
 * Pure markup from counts, so it runs in the node project. The page that renders
 * it is read through the real route by recap-walk-in.spec.ts.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { floorNestedCounts, floorPublishedChain, flooredRatePct } from '../src/lib/count-floor';
import { clearsFloor, statLine, walkInStatLine } from '../src/lib/recap-stat-lines';

const SUPPRESSED = '<p data-testid="stat-walk-ins">Fewer than 5 Walked in</p>';

describe('walkInStatLine — the two ways a walk-in count is withheld read the same', () => {
  test('20 check-ins with 3 walk-ins is the suppressed line', () => {
    // 3: walk-ins are under 5.
    expect(walkInStatLine(20, 3)).toBe(SUPPRESSED);
  });

  test('OSE-2151: an exact rest of 1 to 4 is still withheld, though rounding would hide it', () => {
    // Exact, 18 walk-ins leave 2 who registered and came: withheld (OSE-1752).
    // Rounded (20 and 15) the rest would read 5, so the exact pair is judged too.
    expect(walkInStatLine(20, 18)).toBe(SUPPRESSED);
    expect(walkInStatLine(20, 19)).toBe(SUPPRESSED);
  });

  test('OSE-2151: a published walk-in count is rounded down to a multiple of 5', () => {
    // 23 of 30 leaves 7: published, as 20 (30 - 20 = 10, a rest a reader may read).
    expect(walkInStatLine(30, 23)).toBe(
      '<p data-testid="stat-walk-ins"><strong>20</strong> Walked in</p>'
    );
    // Neighbours inside a step of 5 read the same.
    expect(walkInStatLine(31, 22)).toBe(walkInStatLine(30, 20));
  });

  test('every withheld walk-in count, whatever the reason, is the one suppressed line', () => {
    const differing: string[] = [];
    for (let checkins = 5; checkins <= 60; checkins++) {
      for (let walkIns = 0; walkIns <= checkins; walkIns++) {
        const [, shown] = floorPublishedChain([checkins, walkIns]);
        const [, exact] = floorNestedCounts([checkins, walkIns]);
        if (shown !== null && exact !== null) continue;
        const line = walkInStatLine(checkins, walkIns);
        if (line !== SUPPRESSED) differing.push(`${checkins}/${walkIns}: ${line}`);
      }
    }
    expect(differing).toEqual([]);
  });

  test('a published walk-in count: rounded down to a multiple of 5, bold, same test id', () => {
    expect(walkInStatLine(20, 8)).toBe(
      '<p data-testid="stat-walk-ins"><strong>5</strong> Walked in</p>'
    );
    // What is left is exactly 5, or none: both publish.
    expect(walkInStatLine(20, 15)).toBe(
      '<p data-testid="stat-walk-ins"><strong>15</strong> Walked in</p>'
    );
    expect(walkInStatLine(20, 20)).toBe(
      '<p data-testid="stat-walk-ins"><strong>20</strong> Walked in</p>'
    );
  });

  test('under 5 check-ins draws no walk-in line at all', () => {
    for (let c = 0; c < 5; c++) expect(walkInStatLine(c, 0)).toBe('');
  });

  test('the line never says which reason applied', () => {
    for (const [c, w] of [
      [20, 18],
      [20, 3],
      [7, 5],
      [12, 0],
    ] as const) {
      const line = walkInStatLine(c, w);
      expect(line).not.toMatch(/: held|cannot be worked out/i);
    }
  });

  test('the walk-in share is withheld in exactly the cases the line is, so the card reads alike', () => {
    // The share line is drawn from flooredRatePct, the line from floorPublishedChain.
    // If they ever disagreed, one card would carry a share the other lacks.
    const disagree: string[] = [];
    for (let checkins = 0; checkins <= 60; checkins++) {
      for (let walkIns = 0; walkIns <= checkins; walkIns++) {
        const lineShown = walkInStatLine(checkins, walkIns).includes('<strong>');
        const shareShown = flooredRatePct(walkIns, checkins) !== null;
        if (lineShown !== shareShown) disagree.push(`${checkins}/${walkIns}`);
      }
    }
    expect(disagree).toEqual([]);
  });
});

describe('statLine — a withheld count is one form', () => {
  test('under the floor reads "Fewer than 5", 0 as 4', () => {
    for (let n = 0; n < 5; n++) {
      expect(statLine(n, 'Checked in', 'stat-checkins')).toBe(
        '<p data-testid="stat-checkins">Fewer than 5 Checked in</p>'
      );
    }
  });

  test('at the floor it reads the exact count', () => {
    expect(statLine(5, 'Checked in', 'stat-checkins')).toBe(
      '<p data-testid="stat-checkins"><strong>5</strong> Checked in</p>'
    );
    expect(clearsFloor(5)).toBe(true);
    expect(clearsFloor(4)).toBe(false);
  });
});

describe('the recap page reaches the walk-in line only through walkInStatLine', () => {
  test('no distinct "held" string is left in the page handler', () => {
    const src = readFileSync(resolve(__dirname, '..', 'src/handlers/pages.ts'), 'utf8');
    expect(src).not.toContain('cannot be worked out');
    expect(src).toMatch(/walkInStatLine\(/);
    // The line is not built a second time next to the shared one.
    expect(src).not.toContain('data-testid="stat-walk-ins"');
  });

  test('no surface under src/ prints a "held" wording that names a withheld count', () => {
    const root = resolve(__dirname, '..', 'src');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|html)$/.test(entry.name)) {
          const text = readFileSync(full, 'utf8');
          if (/cannot be worked out|, so a group under \d+/.test(text))
            hits.push(full.slice(root.length));
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
