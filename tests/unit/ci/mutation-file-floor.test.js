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
 * @born-red mergeReports | method: deliberate-fixture-break | date: 2026-11-10 |
 *   verified: with the duplicate-path branch removed, the second report's copy
 *   replaced the first and the "in two reports" case failed here; reading only
 *   the first report failed the "both passes" case.
 */
let checkFloors;
let fileScore;
let mergeReports;
beforeAll(async () => {
  ({ checkFloors, fileScore, mergeReports } =
    await import('../../../scripts/ci/mutation-file-floor.mjs'));
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

describe('mergeReports (stryker.conf.mjs and stryker.language.conf.mjs each write one)', () => {
  const floors = { 'src/auth/admin.ts': 100, 'src/lib/i18n/bidi.ts': 95 };

  test('both passes together meet the floors; either one alone does not', () => {
    const main = report({ 'src/auth/admin.ts': { mutants: [m('Killed')] } });
    const language = report({ 'src/lib/i18n/bidi.ts': { mutants: [m('Killed')] } });
    const merged = mergeReports([main, language]);
    expect(merged.failures).toEqual([]);
    expect(checkFloors(merged.report, floors)).toEqual([]);
    expect(checkFloors(mergeReports([main]).report, floors)).toEqual([
      'src/lib/i18n/bidi.ts: not in the mutation report (was it mutated?)',
    ]);
  });

  test('a file in two reports fails, and the second copy does not hide the first', () => {
    const a = report({ 'src\\lib\\i18n\\bidi.ts': { mutants: [m('Survived', 7)] } });
    const b = report({ 'src/lib/i18n/bidi.ts': { mutants: [m('Killed')] } });
    const merged = mergeReports([a, b]);
    expect(merged.failures).toEqual(['src/lib/i18n/bidi.ts: in more than one mutation report']);
    expect(checkFloors(merged.report, { 'src/lib/i18n/bidi.ts': 95 })[0]).toMatch(
      /below its floor/
    );
  });
});
