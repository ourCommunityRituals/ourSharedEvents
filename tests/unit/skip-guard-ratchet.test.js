// ─────────────────────────────────────────────────────────────────────────────
// Skip-guard ratchet — OSE-852 (MINE-0) fix #2.
//
// A suite that skips is not a suite that passes, but from outside the two are
// indistinguishable once nobody counts. Before this existed, the repo's silent
// skips had been estimated three times and got a different answer each time
// (288 in the ticket, then 199, then 181) — because each count was a one-off
// grep, not a committed measurement. This makes the count an artifact and gives
// it an object whose job is to go red.
//
// The ratchet is one-directional BY DESIGN: these are ceilings. Fixing a silent
// guard lowers the real count and the baseline should follow it DOWN. Raising a
// baseline number to make CI green re-buries exactly what this exists to
// surface, which is why the fixture says so in its own text.
//
// Classes, worst first:
//   ifReturn    `if (...) return;` in a test body — the GAS failure mode the
//               ticket names. No report entry at all: the test PASSES having
//               asserted nothing. All 97 are live in the suite today.
//   unannotated `test.skip(cond)` with no reason — currently 0. The assertion
//               below keeps it there.
//   bare        unconditional `test.skip()` / `describe.skip(...)`.
//
// `annotated` is deliberately NOT ratcheted: it is the correct form, and
// converting a silent guard into an annotated one must never trip this test.
// ─────────────────────────────────────────────────────────────────────────────
const { readFileSync } = require('node:fs');
const path = require('node:path');
// vitest globals: true (vitest.config.ts) — matches the sibling CI meta-tests.

const BASELINE = JSON.parse(
  readFileSync(path.resolve(__dirname, 'fixtures/skip-census-baseline.json'), 'utf8')
);

let totals;
beforeAll(async () => {
  ({ totals } = await import(path.resolve(__dirname, '../../scripts/skip-census.mjs')).then((m) =>
    m.census()
  ));
});

describe('OSE-852 — silent test skips may not grow', () => {
  it('the census actually found spec files (it would ratchet zero otherwise)', async () => {
    const { filesScanned } = await import(
      path.resolve(__dirname, '../../scripts/skip-census.mjs')
    ).then((m) => m.census());
    expect(
      filesScanned,
      'census scanned no spec files — the ratchet would pass vacuously'
    ).toBeGreaterThan(100);
  });

  for (const cls of ['ifReturn', 'unannotated', 'bare']) {
    it(`\`${cls}\` does not exceed its baseline of ${BASELINE[cls]}`, () => {
      expect(
        totals[cls],
        `${cls} rose to ${totals[cls]} (baseline ${BASELINE[cls]}). A new silent skip was introduced. ` +
          `Give it a reason string, make it a hard failure, or use test.fixme with a linked ticket — ` +
          `do NOT raise the baseline.`
      ).toBeLessThanOrEqual(BASELINE[cls]);
    });
  }

  it('flags a baseline that has drifted above reality, so it can be tightened', () => {
    const stale = ['ifReturn', 'unannotated', 'bare'].filter((c) => totals[c] < BASELINE[c]);
    expect(
      stale,
      `these classes are now BELOW baseline — good, tighten the ceiling: ` +
        stale.map((c) => `${c} ${BASELINE[c]}->${totals[c]}`).join(', ')
    ).toEqual([]);
  });

  it('the census exclusion list holds exactly this meta-test — no wider', async () => {
    const { CENSUS_EXCLUDE } = await import(
      path.resolve(__dirname, '../../scripts/skip-census.mjs')
    );
    expect(
      [...CENSUS_EXCLUDE],
      'the exclusion list is how a census grows a blind spot — it may hold only this file'
    ).toEqual(['tests/unit/skip-guard-ratchet.test.js']);
  });

  it('no test.skip carries a condition without a reason', () => {
    expect(
      totals.unannotated,
      'a skip with no reason cannot be told apart from rot in the report'
    ).toBe(0);
  });
});
