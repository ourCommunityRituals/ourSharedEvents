/**
 * CI integrity ratchets (OSE-1606): continue-on-error steps, skipped tests and
 * orphan tests/e2e specs may only shrink. Baseline: .ci-integrity-baseline.json.
 *
 * 1. The real tree matches its baseline exactly (a new one fails; a fixed one
 *    fails until the baseline is lowered, so the gain is locked in).
 * 2. Every baseline entry carries a real reason.
 * 3. The baseline cannot exceed the base branch's copy (when origin/main has one;
 *    a local convenience only, since a shallow CI checkout has no origin/main).
 * 4. Hermetic born-red cases: a throwaway tree with a baseline, then one injected
 *    continue-on-error / skip / orphan spec each turn the script red.
 * 5. CI wiring (OSE-1691): the T0 lint shard runs this script with
 *    --base-config, blocking. Before OSE-1691 nothing in CI ran it, and (3)
 *    returned early in CI, so a raised baseline passed every check (#933).
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join, dirname } = require('path');

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'ci-integrity-ratchets.mjs');
const BASELINE = '.ci-integrity-baseline.json';

function run(root, ...args) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf-8' });
}

function put(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

describe('CI integrity ratchets (OSE-1606): the real tree', () => {
  test('counts equal the committed baseline', () => {
    const r = run(ROOT);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ci-integrity ratchets ok');
  });

  test('every baseline entry has a real reason', () => {
    const b = JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf-8'));
    const entries = [
      ...Object.values(b.continueOnError.byFile),
      ...Object.values(b.skipsUnconditional.byFile),
      ...Object.values(b.skipsConditional.byFile),
      ...b.orphanSpecs.files,
    ];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.reason).toBe('string');
      expect(e.reason.length).toBeGreaterThan(15);
      expect(e.reason).not.toMatch(/^TODO/);
    }
  });

  test('baseline does not exceed the base branch copy (when one is reachable)', () => {
    const show = spawnSync('git', ['show', `origin/main:${BASELINE}`], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    // No origin/main here (a shallow CI checkout, a fresh clone): nothing to
    // compare locally. CI's own comparison is the lint-shard step, held in
    // place by "the lint shard runs the ratchet against the base branch" below.
    if (show.status !== 0) return;
    const baseFile = join(mkdtempSync(join(tmpdir(), 'ci-int-base-')), 'base.json');
    writeFileSync(baseFile, show.stdout);
    const r = run(ROOT, '--base-config', baseFile);
    expect(r.stderr).not.toContain('baseline raised');
  });

  test('the lint shard runs the ratchet against the base branch, blocking (OSE-1691)', () => {
    const yaml = require('js-yaml');
    const wf = yaml.load(
      readFileSync(join(ROOT, '.github', 'workflows', 'oursharedevents-ci.yml'), 'utf-8')
    );
    const hits = [];
    for (const [name, job] of Object.entries(wf.jobs || {})) {
      for (const s of job.steps || []) {
        if (/scripts\/ci\/ci-integrity-ratchets\.mjs/.test(String(s.run || '')))
          hits.push({ name, job, s });
      }
    }
    expect(hits.length, 'a CI step runs ci-integrity-ratchets.mjs').toBeGreaterThanOrEqual(1);
    const { name, job, s } = hits[0];
    const run = String(s.run);
    expect(s.if, `${name}: runs in the lint shard`).toMatch(/matrix\.shard == 'lint'/);
    expect(run, `${name}: compares with the base branch's baseline`).toMatch(
      /--base-config "\$RUNNER_TEMP\/base-ci-integrity\.json"/
    );
    expect(run, `${name}: reads the base copy of the baseline`).toContain(
      'FETCH_HEAD:.ci-integrity-baseline.json'
    );
    expect(s['continue-on-error'], `${name}: blocking`).toBeUndefined();
    expect(job['continue-on-error'], `${name}: job is blocking`).toBeUndefined();
  });
});

describe('CI integrity ratchets (OSE-1606): born-red on injected faults', () => {
  let root;
  const WF = '.github/workflows/ci.yml';
  const CLEAN_WF = 'jobs:\n  a:\n    steps:\n      - name: x\n        run: echo hi\n';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ci-int-'));
    put(root, WF, CLEAN_WF + '            tests/e2e/1-smoke/named.spec.ts\n');
    put(root, 'tests/e2e/1-smoke/named.spec.ts', "test('a', () => {});\n");
    put(root, 'tests/unit/a.test.js', "test('a', () => {});\n");
    expect(run(root, '--update').status).toBe(0);
    expect(run(root).status).toBe(0); // green baseline before any fault
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a new continue-on-error step is red', () => {
    put(
      root,
      WF,
      CLEAN_WF + '        continue-on-error: true\n            tests/e2e/1-smoke/named.spec.ts\n'
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/continueOnError: 1 > baseline 0/);
  });

  test('a comment mentioning continue-on-error is not counted', () => {
    put(
      root,
      WF,
      CLEAN_WF +
        '      # never continue-on-error: true here\n            tests/e2e/1-smoke/named.spec.ts\n'
    );
    expect(run(root).status).toBe(0);
  });

  test('a new unconditional skip is red', () => {
    put(root, 'tests/unit/a.test.js', "test.skip('a', () => {});\n");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/skipsUnconditional: 1 > baseline 0/);
  });

  test('a new conditional skip is red', () => {
    put(
      root,
      'tests/unit/a.test.js',
      "test('a', ({}, ti) => { test.skip(!process.env.X, 'no X'); });\n"
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/skipsConditional: 1 > baseline 0/);
  });

  test('xit / xdescribe count as skips', () => {
    put(root, 'tests/unit/a.test.js', "xit('a', () => {});\nxdescribe('b', () => {});\n");
    expect(run(root).stderr).toMatch(/skipsUnconditional: 2 > baseline 0/);
  });

  test('a new orphan e2e spec is red', () => {
    put(root, 'tests/e2e/3-flows/unnamed.spec.ts', "test('a', () => {});\n");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/orphanSpecs: 1 > baseline 0/);
  });

  test('naming a spec in a workflow (path, dir prefix or glob) is not an orphan', () => {
    put(root, 'tests/e2e/3-flows/b.spec.ts', "test('a', () => {});\n");
    put(root, 'tests/e2e/2-pages/form-x.spec.ts', "test('a', () => {});\n");
    put(root, 'tests/e2e/0-architecture/c.spec.ts', "test('a', () => {});\n");
    put(
      root,
      WF,
      CLEAN_WF +
        '            tests/e2e/3-flows/b.spec.ts tests/e2e/2-pages/form-*.spec.ts tests/e2e/0-architecture/ tests/e2e/1-smoke/named.spec.ts\n'
    );
    expect(run(root).status).toBe(0);
  });

  test('a shrunk count is red until the baseline is lowered', () => {
    put(
      root,
      WF,
      CLEAN_WF + '        continue-on-error: true\n            tests/e2e/1-smoke/named.spec.ts\n'
    );
    expect(run(root, '--update').status).toBe(0); // baseline now 1
    put(root, WF, CLEAN_WF + '            tests/e2e/1-smoke/named.spec.ts\n'); // fixed, baseline not lowered
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/continueOnError: 0 < baseline 1.*lower/);
  });

  test('a swap at equal totals (one fixed, one added) is red', () => {
    put(root, 'tests/unit/a.test.js', "test.skip('a', () => {});\n");
    expect(run(root, '--update').status).toBe(0);
    put(root, 'tests/unit/a.test.js', "test('a', () => {});\n");
    put(root, 'tests/unit/b.test.js', "test.skip('b', () => {});\n");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/b\.test\.js has 1, baseline 0/);
  });

  test('a baseline raised above the base branch copy is red', () => {
    put(root, 'tests/unit/a.test.js', "test.skip('a', () => {});\n");
    const lowBase = join(root, 'base.json');
    writeFileSync(lowBase, readFileSync(join(root, BASELINE), 'utf-8')); // base had 0 skips
    expect(run(root, '--update').status).toBe(0); // baseline raised to 1
    const r = run(root, '--base-config', lowBase);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/baseline raised to 1 above the base branch's 0/);
  });
});
