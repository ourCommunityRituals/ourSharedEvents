/* eslint-disable security/detect-non-literal-fs-filename -- the repo's own workflow, exception file and CODEOWNERS, and reports written to a temp folder by this test */
/**
 * The Dependency Vulnerability Audit's blocking decision, with its exception
 * file (scripts/ci/npm-audit-gate.mjs, .security-exceptions.json). OSE-1489.
 *
 * The report below is cut from a real `npm audit --json` (npm 11, auditReportVersion 2)
 * taken on 2026-11-17: picomatch's advisory as an object, the packages above it naming it
 * by string, glob's moderate advisory beside a string.
 *
 * BORN RED (2026-11-17). Each fault was put into npm-audit-gate.mjs (or the workflow), this
 * file run, the named tests seen failing, and the fault taken out:
 *   F1  expiry check removed (`review <= today` never true)
 *         -> "an exception on its review date fails", "an expired exception fails even when ...",
 *            "exits 1 with the same entry past its review date"
 *   F2  severity window not checked
 *         -> "a high exception longer than 30 days fails"
 *   F3  a critical advisory may be excepted (critical given a 30-day window AND its refusal
 *       removed; either one alone still fails the entry, so each alone left the file green)
 *         -> "a critical advisory cannot be excepted"
 *   F4  an exception matches on the package alone (id ignored)
 *         -> "an exception for another advisory in the same package does not cover it"
 *   F5  an npm error report reads as an empty one (advisories() returns [] on report.error)
 *         -> "an npm error report fails closed", "the CLI fails closed on an error report"
 *   F6  workflow: the audit step without the script (the old HIGH-count exit; seen on the
 *       workflow as main had it, before this change)
 *         -> "the audit step decides with the gate script"
 *   F7  CODEOWNERS without the two lines (seen on CODEOWNERS as main had it)
 *         -> "CODEOWNERS locks the exception file and the gate"
 */
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'npm-audit-gate.mjs');

let gate;
beforeAll(async () => {
  gate = await import('../../../scripts/ci/npm-audit-gate.mjs');
});

const PICO = 'GHSA-fc5q-39xc-vjpf';
const advisory = (name, id, severity, extra = {}) => ({
  source: 1247710,
  name,
  dependency: name,
  title: `${name} advisory`,
  url: `https://github.com/advisories/${id}`,
  severity,
  range: '<=4.0.7',
  ...extra,
});

/** A report shaped as `npm audit --json` writes it. */
const report = (vulns) => ({
  auditReportVersion: 2,
  vulnerabilities: vulns,
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
});

const REAL = report({
  picomatch: {
    name: 'picomatch',
    severity: 'high',
    isDirect: false,
    via: [advisory('picomatch', PICO, 'high')],
    effects: ['fdir', 'tinyglobby', 'vite', 'vitest'],
    range: '*',
    nodes: ['node_modules/picomatch'],
    fixAvailable: { name: 'vitest', version: '3.1.4', isSemVerMajor: true },
  },
  vite: {
    name: 'vite',
    severity: 'high',
    isDirect: false,
    via: ['picomatch', 'tinyglobby'],
    effects: [],
  },
  glob: {
    name: 'glob',
    severity: 'moderate',
    isDirect: false,
    via: [advisory('glob', 'GHSA-3g3m-2fjr-6pw4', 'moderate'), 'minimatch'],
    effects: ['rimraf'],
  },
});

const entry = (over = {}) => ({
  id: PICO,
  package: 'picomatch',
  severity: 'high',
  reason: 'no patched release; dev tooling only',
  mitigation: 'globs come from repo config only',
  addedBy: 'test',
  approvedBy: 'test owner',
  addedDate: '2026-11-17',
  reviewDate: '2026-12-17',
  ...over,
});
const file = (...entries) => ({ exceptions: entries });
const TODAY = '2026-11-20';

describe('npm audit gate: advisories', () => {
  test('one per advisory and package, string vias skipped', () => {
    const found = gate.advisories(REAL).map((a) => `${a.id}|${a.package}|${a.severity}`);
    expect(found.sort()).toEqual([`GHSA-3g3m-2fjr-6pw4|glob|moderate`, `${PICO}|picomatch|high`]);
  });

  test('an npm error report fails closed', () => {
    expect(() =>
      gate.evaluate({ error: { code: 'E400', summary: 'Bad Request' } }, null, TODAY)
    ).toThrow(/npm audit reported an error/);
  });

  test('a report that is not npm audit v2 fails closed', () => {
    expect(() => gate.evaluate({}, null, TODAY)).toThrow(/not an npm audit v2 report/);
    expect(() => gate.evaluate({ auditReportVersion: 1, advisories: {} }, null, TODAY)).toThrow(
      /not an npm audit v2 report/
    );
  });
});

describe('npm audit gate: decision', () => {
  test('an unexcepted high advisory blocks', () => {
    const r = gate.evaluate(REAL, null, TODAY);
    expect(r.pass).toBe(false);
    expect(r.blocking.map((a) => a.id)).toEqual([PICO]);
  });

  test('a moderate advisory never blocks', () => {
    const only = report({ glob: REAL.vulnerabilities.glob });
    expect(gate.evaluate(only, null, TODAY).pass).toBe(true);
  });

  test('an active exception passes the advisory it names', () => {
    const r = gate.evaluate(REAL, file(entry()), TODAY);
    expect(r.problems).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.excepted.map((a) => a.id)).toEqual([PICO]);
  });

  test('an exception on its review date fails', () => {
    const r = gate.evaluate(REAL, file(entry()), '2026-12-17');
    expect(r.pass).toBe(false);
    expect(r.problems.join('\n')).toMatch(/expired, review was due 2026-12-17/);
  });

  test('an expired exception fails even when the advisory is gone', () => {
    const r = gate.evaluate(report({}), file(entry()), '2027-01-01');
    expect(r.pass).toBe(false);
    expect(r.problems.join('\n')).toMatch(/expired/);
  });

  test('a high exception longer than 30 days fails', () => {
    const r = gate.evaluate(REAL, file(entry({ reviewDate: '2026-12-18' })), TODAY);
    expect(r.pass).toBe(false);
    expect(r.problems.join('\n')).toMatch(/runs 31 days; a high exception runs at most 30/);
  });

  test('a critical advisory cannot be excepted', () => {
    const crit = report({
      x: {
        name: 'x',
        severity: 'critical',
        via: [advisory('x', 'GHSA-2222-3333-4444', 'critical')],
      },
    });
    const r = gate.evaluate(
      crit,
      file(
        entry({
          id: 'GHSA-2222-3333-4444',
          package: 'x',
          severity: 'critical',
          reviewDate: '2026-11-18',
        })
      ),
      '2026-11-17'
    );
    expect(r.pass).toBe(false);
    expect(r.blocking.map((a) => a.id)).toEqual(['GHSA-2222-3333-4444']);
    expect(r.problems.join('\n')).toMatch(/critical advisory cannot be excepted/);
  });

  test('an exception for another advisory in the same package does not cover it', () => {
    const r = gate.evaluate(REAL, file(entry({ id: 'GHSA-2222-3333-4444' })), TODAY);
    expect(r.pass).toBe(false);
    expect(r.blocking.map((a) => a.id)).toEqual([PICO]);
    expect(r.unused.map((e) => e.id)).toEqual(['GHSA-2222-3333-4444']);
  });

  test('an exception for the advisory in another package does not cover it', () => {
    const r = gate.evaluate(REAL, file(entry({ package: 'vite' })), TODAY);
    expect(r.pass).toBe(false);
  });

  test('a severity that does not match the report fails', () => {
    const r = gate.evaluate(
      REAL,
      file(entry({ severity: 'moderate', reviewDate: '2027-01-01' })),
      TODAY
    );
    expect(r.pass).toBe(false);
    expect(r.problems.join('\n')).toMatch(/the entry says moderate; the report says high/);
  });

  test.each([
    ['a missing mitigation', { mitigation: '' }, /"mitigation" is missing/],
    ['a missing approver', { approvedBy: undefined }, /"approvedBy" is missing/],
    ['an id that is not a GHSA', { id: 'CVE-2026-112366' }, /must be a GHSA advisory id/],
    [
      'a date that does not exist',
      { reviewDate: '2026-02-31' },
      /"reviewDate" must be a real date/,
    ],
    [
      'a review date before the added date',
      { reviewDate: '2026-11-01' },
      /must come after "addedDate"/,
    ],
  ])('%s fails', (_name, over, message) => {
    const r = gate.evaluate(REAL, file(entry(over)), TODAY);
    expect(r.pass).toBe(false);
    expect(r.problems.join('\n')).toMatch(message);
  });

  test('a file without an exceptions array fails', () => {
    expect(gate.evaluate(REAL, { picomatch: true }, TODAY).problems.join('\n')).toMatch(
      /"exceptions" array/
    );
  });

  test('the same entry twice fails', () => {
    expect(gate.evaluate(REAL, file(entry(), entry()), TODAY).problems.join('\n')).toMatch(
      /listed twice/
    );
  });
});

describe('npm audit gate: CLI', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'audit-gate-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (reportBody, exceptionsBody) => {
    const r = join(dir, `report-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(r, typeof reportBody === 'string' ? reportBody : JSON.stringify(reportBody));
    const e = join(dir, `exc-${Math.random().toString(36).slice(2)}.json`);
    if (exceptionsBody !== undefined) writeFileSync(e, JSON.stringify(exceptionsBody));
    return spawnSync(process.execPath, [SCRIPT, r, e], { encoding: 'utf8' });
  };
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

  test('exits 1 on an unexcepted high advisory and names it', () => {
    const out = run(REAL);
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(new RegExp(`BLOCKING high: ${PICO} in picomatch`));
  });

  test('exits 0 with an active exception, and says it is excepted', () => {
    const out = run(REAL, file(entry({ addedDate: today, reviewDate: plusDays(30) })));
    expect(out.stdout).toMatch(/EXCEPTED high/);
    expect(out.status).toBe(0);
  });

  test('exits 1 with the same entry past its review date', () => {
    const out = run(REAL, file(entry({ addedDate: plusDays(-31), reviewDate: plusDays(-1) })));
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/expired/);
  });

  test('the CLI fails closed on an error report', () => {
    const out = run({ error: { code: 'E400', summary: 'Bad Request' } });
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/failed closed/);
  });

  test('the CLI fails closed on a report that is not JSON', () => {
    expect(run('npm ERR! audit endpoint returned an error').status).toBe(1);
  });
});

describe('npm audit gate: repo wiring', () => {
  test('the audit step decides with the gate script', () => {
    const wf = yaml.load(
      readFileSync(join(ROOT, '.github', 'workflows', 'security-scan.yml'), 'utf8')
    );
    const step = wf.jobs['dependency-audit'].steps.find((s) => s.id === 'npm-audit');
    expect(step.run).toMatch(
      /node scripts\/ci\/npm-audit-gate\.mjs \.security-reports\/npm-audit\.json \.security-exceptions\.json/
    );
    expect(step.run).not.toMatch(/BLOCKING_COUNT/);
  });

  test('the committed exception file is sound on the day each entry was added', () => {
    const committed = JSON.parse(readFileSync(join(ROOT, '.security-exceptions.json'), 'utf8'));
    expect(Array.isArray(committed.exceptions)).toBe(true);
    for (const e of committed.exceptions) expect(gate.entryProblems(e, e.addedDate)).toEqual([]);
  });

  test('CODEOWNERS locks the exception file and the gate', () => {
    const owners = readFileSync(join(ROOT, '.github', 'CODEOWNERS'), 'utf8');
    expect(owners).toMatch(/^\/\.security-exceptions\.json\s+@\S+/m);
    expect(owners).toMatch(/^\/scripts\/ci\/npm-audit-gate\.mjs\s+@\S+/m);
  });
});
