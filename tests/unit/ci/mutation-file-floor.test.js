/**
 * Per-file mutation floor (OSE-1801, CCR 2026-11-04 S-2).
 *
 * scripts/ci/mutation-file-floor.mjs fails the mutation job when one listed file
 * scores under its own floor, even while the global score passes. These cases pin
 * each way it must fail and the one way it must pass.
 *
 * @born-red TL-084 | method: deliberate-fixture-break | date: 2026-11-04 |
 *   verified: with the `score < floor` check removed, the under-floor case passed
 *   wrongly and failed here; with the missing-file branch removed, the
 *   not-in-report case failed here.
 */
let checkFloors;
let fileScore;
beforeAll(async () => {
  ({ checkFloors, fileScore } = await import('../../../scripts/ci/mutation-file-floor.mjs'));
});

const m = (status, line = 1) => ({ status, mutatorName: 'X', location: { start: { line } } });
const report = (files) => ({ files });

describe('fileScore', () => {
  test('detected over valid; Ignored and CompileError do not count', () => {
    expect(
      fileScore([m('Killed'), m('Timeout'), m('Survived'), m('Ignored'), m('CompileError')])
    ).toBeCloseTo((2 / 3) * 100);
  });

  test('NoCoverage counts against the score', () => {
    expect(fileScore([m('Killed'), m('NoCoverage')])).toBe(50);
  });

  test('no valid mutant is no score', () => {
    expect(fileScore([m('Ignored')])).toBeNull();
  });
});

describe('checkFloors', () => {
  const floors = { 'src/auth/admin.ts': 100, 'src/lib/pii.ts': 95 };

  test('every file at or above its floor passes', () => {
    const r = report({
      'src/auth/admin.ts': { mutants: [m('Killed'), m('Timeout')] },
      'src/lib/pii.ts': { mutants: [...Array(19).fill(m('Killed')), m('Survived')] },
    });
    expect(checkFloors(r, floors)).toEqual([]);
  });

  test('one survivor in a 100% file fails, naming the line, while the total would pass', () => {
    const r = report({
      'src/auth/admin.ts': { mutants: [...Array(99).fill(m('Killed')), m('Survived', 271)] },
      'src/lib/pii.ts': { mutants: Array(100).fill(m('Killed')) },
    });
    const failures = checkFloors(r, floors);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/src\/auth\/admin\.ts: 99\.00% is below its floor of 100%/);
    expect(failures[0]).toMatch(/line 271/);
  });

  test('a listed file missing from the report fails', () => {
    const r = report({ 'src/lib/pii.ts': { mutants: [m('Killed')] } });
    expect(checkFloors(r, floors)).toEqual([
      'src/auth/admin.ts: not in the mutation report (was it mutated?)',
    ]);
  });

  test('a listed file with no valid mutants fails', () => {
    const r = report({
      'src/auth/admin.ts': { mutants: [m('Ignored')] },
      'src/lib/pii.ts': { mutants: [m('Killed')] },
    });
    expect(checkFloors(r, floors)).toEqual(['src/auth/admin.ts: no valid mutants']);
  });

  test('Windows separators in report paths still match', () => {
    const r = report({
      'src\\auth\\admin.ts': { mutants: [m('Killed')] },
      'src\\lib\\pii.ts': { mutants: [m('Killed')] },
    });
    expect(checkFloors(r, floors)).toEqual([]);
  });
});
