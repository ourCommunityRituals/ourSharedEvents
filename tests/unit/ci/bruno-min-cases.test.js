/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own workflow, and reports written to a temp folder this test makes */
/**
 * OSE-2160 (F-46): a staging Bruno run that checked nothing is red.
 *
 * `bru run` exits 0 for a run with no case in it. scripts/ci/bruno-min-cases.mjs
 * reads the run's JUnit report and exits 1 for zero cases, for fewer than the
 * floor, for too many skipped requests, and for a missing report or an unusable
 * floor. This file runs it as the workflow does (a process, an exit code) on:
 *   - a report Bruno's own reporter wrote, from a real `bru run`;
 *   - the faults: an empty report, N-1 cases, one skip over the ceiling, a report
 *     of only NOT RUN and edge-challenge names, no file, no --min.
 * And pins the workflow: the step exists, comes after the Bruno step and before the report scan,
 * is not continue-on-error, and every matrix entry carries a floor and a ceiling.
 *
 * Born red: take the check out of the workflow, or raise a matrix floor above
 * what main counts, and the pin fails; an empty report gets exit 1 here.
 */
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts/ci/bruno-min-cases.mjs');
const WF = join(ROOT, '.github', 'workflows', 'oursharedevents-ci.yml');

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bruno-min-cases-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A JUnit report in the shape Bruno writes: one suite a request, one case a test. */
function report({ cases = 0, notRun = 0, edge = 0, skippedRequests = 0, suites = 1 } = {}) {
  const tc = (name) => `    <testcase name="${name}" status="pass" classname="a/b" time="0.1"/>`;
  const body = [
    ...Array.from({ length: cases }, (_, i) => tc(`Returns 200 #${i}`)),
    ...Array.from({ length: notRun }, (_, i) => tc(`NOT RUN (asserts nothing #${i})`)),
    ...Array.from({ length: edge }, (_, i) => tc(`Returns 200 or 403 (edge challenge) #${i}`)),
  ].join('\n');
  const suiteTags = Array.from({ length: suites }, (_, i) =>
    i === 0
      ? `  <testsuite name="r" file="r.yml" errors="0" failures="0" skipped="0" tests="${cases}">\n${body}\n  </testsuite>`
      : `  <testsuite name="r${i}" file="r${i}.yml" errors="0" failures="0" skipped="0" tests="0"></testsuite>`
  ).join('\n');
  const skipped = Array.from(
    { length: skippedRequests },
    (_, i) =>
      `  <testsuite name="s${i}" file="s${i}.yml" errors="0" failures="0" skipped="1" tests="0">\n    <skipped message="Request Skipped"/>\n  </testsuite>`
  ).join('\n');
  return `<?xml version="1.0"?>\n<testsuites>\n${suiteTags}\n${skipped}\n</testsuites>\n`;
}

let n = 0;
function run(xml, args) {
  const file = join(dir, `r${n++}.xml`);
  if (xml !== null) writeFileSync(file, xml);
  const r = spawnSync(process.execPath, [SCRIPT, file, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const LIMITS = ['--min', '100', '--max-skipped', '3', '--label', 'T2: pages'];

describe('bruno-min-cases: the exit code the workflow sees', () => {
  test('control: exactly the floor, and exactly the ceiling, pass', () => {
    const r = run(report({ cases: 100, skippedRequests: 3 }), LIMITS);
    expect(r.code).toBe(0);
    expect(r.out).toContain('100 test cases counted (minimum 100), 3 requests skipped');
  });

  test('zero cases is red, and says the run checked nothing', () => {
    const r = run(report({ cases: 0 }), LIMITS);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/0 test cases proved anything/);
    expect(r.err).toMatch(/checked nothing/);
  });

  test('a report with no request in it at all is red', () => {
    const r = run('<?xml version="1.0"?>\n<testsuites>\n</testsuites>\n', LIMITS);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no request in it/);
  });

  test('one case under the floor is red, with the counts', () => {
    const r = run(report({ cases: 99 }), LIMITS);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/99 test cases counted, fewer than the minimum 100/);
  });

  test('one skipped request over the ceiling is red', () => {
    const r = run(report({ cases: 100, skippedRequests: 4 }), LIMITS);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/4 requests skipped, more than the ceiling 3/);
  });

  test('NOT RUN and edge-challenge cases do not count', () => {
    const r = run(report({ cases: 98, notRun: 5, edge: 5 }), LIMITS);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/98 test cases counted/);
    expect(r.err).toMatch(/5 NOT RUN, 5 edge challenge/);
    // A run of nothing but those is the empty run.
    const only = run(report({ cases: 0, notRun: 50, edge: 50 }), LIMITS);
    expect(only.code).toBe(1);
    expect(only.err).toMatch(/0 test cases proved anything/);
  });

  test('no report file is red', () => {
    const r = spawnSync(process.execPath, [SCRIPT, join(dir, 'nope.xml'), ...LIMITS], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no JUnit report/);
  });

  test('a floor of 0, or none, cannot fail, so it is refused', () => {
    for (const args of [
      ['--min', '0', '--max-skipped', '3'],
      ['--max-skipped', '3'],
      ['--min', 'x', '--max-skipped', '3'],
      ['--min', '100'],
    ]) {
      const r = run(report({ cases: 500 }), args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err, args.join(' ')).toMatch(/no usable --(min|max-skipped)/);
    }
  });
});

describe('bruno-min-cases: a report Bruno wrote itself', () => {
  let server;
  let junit;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'text/html', 'X-Monetization-Inert': 'true' });
      res.end('<!DOCTYPE html><html><body>ok</body></html>');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const out = join(dir, 'real.xml');
    await new Promise((resolve) => {
      const p = spawn(
        process.execPath,
        [
          join(ROOT, 'node_modules/@usebruno/cli/bin/bru.js'),
          'run',
          '3. MVP Surfaces/GET -poster.yml',
          '--env',
          'ose-staging',
          '--env-var',
          `baseUrl=http://127.0.0.1:${port}`,
          '--reporter-junit',
          out,
        ],
        { cwd: join(ROOT, 'bruno/ose-pages'), stdio: 'ignore' }
      );
      p.on('exit', resolve);
    });
    junit = readFileSync(out, 'utf8');
  }, 60_000);
  afterAll(() => server?.close());

  test('its cases are counted; a floor above them is red, one at them is green', () => {
    // The script is ESM and this file is not, so it is read through its CLI.
    const file = join(dir, 'real-copy.xml');
    writeFileSync(file, junit);
    const probe = spawnSync(
      process.execPath,
      [SCRIPT, file, '--min', '100000', '--max-skipped', '0'],
      { encoding: 'utf8' }
    );
    const m = /(\d+) test cases counted/.exec(probe.stdout + probe.stderr);
    expect(m, probe.stderr).not.toBeNull();
    const counted = Number(m[1]);
    expect(counted).toBeGreaterThanOrEqual(3);
    const ok = spawnSync(
      process.execPath,
      [SCRIPT, file, '--min', String(counted), '--max-skipped', '0'],
      { encoding: 'utf8' }
    );
    expect(ok.status).toBe(0);
    const red = spawnSync(
      process.execPath,
      [SCRIPT, file, '--min', String(counted + 1), '--max-skipped', '0'],
      { encoding: 'utf8' }
    );
    expect(red.status).toBe(1);
  });
});

describe('workflow pin: the T2 step', () => {
  const job = yaml.load(readFileSync(WF, 'utf8')).jobs['contract-staging-sub'];
  const steps = job.steps || [];
  const bruStep = steps.findIndex((s) => s && s.name === 'Bruno contract section');
  const countStep = steps.findIndex((s) => s && /^Bruno ran enough cases/.test(s.name || ''));

  /** What is wrong with a job, as sentences. Run on the real job and on faulty ones. */
  function problems(j) {
    const s = j.steps || [];
    const i = s.findIndex((x) => x && x.name === 'Bruno contract section');
    const k = s.findIndex((x) => x && /^Bruno ran enough cases/.test(x.name || ''));
    const out = [];
    if (k < 0) return ['no "Bruno ran enough cases" step'];
    const scan = s.findIndex((x, n) => n > i && x && x.name === 'Scan artifacts for credentials');
    if (!(k > i && (scan < 0 || k < scan))) {
      out.push('the count step is not after the Bruno step and before the report scan');
    }
    if (s[k]['continue-on-error']) out.push('the count step is continue-on-error');
    if (s[k].if && !/^success\(\)$/.test(String(s[k].if).trim())) {
      out.push(`the count step has an if: ${s[k].if}`);
    }
    if (!/scripts\/ci\/bruno-min-cases\.mjs/.test(s[k].run || '')) {
      out.push('the step does not run the script');
    }
    for (const e of j.strategy.matrix.include) {
      if (!Number.isInteger(e.min_cases) || e.min_cases < 1) {
        out.push(`${e.section}: no min_cases`);
      }
      if (!Number.isInteger(e.max_skipped) || e.max_skipped < 0) {
        out.push(`${e.section}: no max_skipped`);
      }
    }
    return out;
  }

  test('the real job passes the pin', () => {
    expect(bruStep).toBeGreaterThanOrEqual(0);
    expect(countStep).toBeGreaterThan(bruStep);
    expect(problems(job)).toEqual([]);
  });

  test('every matrix entry has a floor under what main counts and a ceiling', () => {
    // Measured on main's green runs of 2026-11-19: api 2418 / 53 skipped, pages 563 / 0.
    const measured = { api: { cases: 2418, skipped: 53 }, pages: { cases: 563, skipped: 0 } };
    for (const e of job.strategy.matrix.include) {
      expect(measured[e.section], e.section).toBeDefined();
      expect(e.min_cases, `${e.section} floor under what main counts`).toBeLessThanOrEqual(
        measured[e.section].cases
      );
      expect(e.min_cases, `${e.section} floor is not slack`).toBeGreaterThan(
        measured[e.section].cases * 0.8
      );
      expect(e.max_skipped, `${e.section} ceiling holds today's skips`).toBeGreaterThanOrEqual(
        measured[e.section].skipped
      );
    }
  });

  test('the pin catches a step removed, moved, masked, or a matrix entry without a floor', () => {
    const clone = () => JSON.parse(JSON.stringify(job));
    const removed = clone();
    removed.steps.splice(countStep, 1);
    expect(problems(removed)).toEqual(['no "Bruno ran enough cases" step']);
    const masked = clone();
    masked.steps[countStep]['continue-on-error'] = true;
    expect(problems(masked)).toContain('the count step is continue-on-error');
    const moved = clone();
    const [s] = moved.steps.splice(countStep, 1);
    moved.steps.splice(bruStep, 0, s); // ahead of the Bruno run: it would read no report
    expect(problems(moved)).toContain(
      'the count step is not after the Bruno step and before the report scan'
    );
    const noFloor = clone();
    delete noFloor.strategy.matrix.include[0].min_cases;
    expect(problems(noFloor).join()).toMatch(/no min_cases/);
  });
});
