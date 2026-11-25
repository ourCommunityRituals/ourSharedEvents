/**
 * Mutation at the integration and end-to-end layers: the runner
 * (scripts/ci/layer-mutation.mjs) and its catalog (mutation/layer-mutants.json).
 *
 * The runner's test half runs in the nightly `mutation-layers` job; what
 * decides a verdict is pure and pinned here.
 *
 * @born-red layer-mutation | method: deliberate-fixture-break | date: 2026-11-24 |
 *   verified: with `unexpected > 0` read as `unexpected >= 0` in
 *   verdictFromPlaywright, the "tests that all passed" case failed here; with
 *   the numFailedTestSuites branch removed from verdictFromVitest, the "suite
 *   that failed to load" case failed here; with the `n !== 1` check removed from
 *   checkCatalog, the "find occurs twice" case failed here.
 */
const { existsSync, readFileSync } = require('node:fs');
const yaml = require('js-yaml');

let mod;
beforeAll(async () => {
  mod = await import('../../../scripts/ci/layer-mutation.mjs');
});

const readOrNull = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

const files = {
  'workers/oursharedevents/src/lib/a.ts': 'if (n < floor) return null;\nreturn n;\n',
  'workers/oursharedevents/tests/a.spec.ts': 'it()',
  'tests/playwright/a.spec.ts': 'test()',
};
const fakeRead = (p) => files[p] ?? null;
const good = {
  mutants: [
    {
      id: 'floor-off',
      layer: 'integration',
      rule: 'r',
      file: 'workers/oursharedevents/src/lib/a.ts',
      find: 'if (n < floor)',
      replace: 'if (false)',
      kill: ['workers/oursharedevents/tests/a.spec.ts'],
    },
  ],
};
const withMutant = (patch) => ({ mutants: [{ ...good.mutants[0], ...patch }] });

describe('the committed catalog', () => {
  test('is sound: every find occurs once, every kill spec exists at its layer', async () => {
    const catalog = JSON.parse(readFileSync(mod.DEFAULT_CATALOG, 'utf8'));
    const { NODE_SPECS } = await import('../../../workers/oursharedevents/vitest.node-specs.mjs');
    const node = new Set(
      NODE_SPECS.map((s) => `workers/oursharedevents/${s.replace(/^\.\//, '')}`)
    );
    expect(mod.checkCatalog(catalog, readOrNull, (s) => node.has(s))).toEqual([]);
  });

  test('has mutants at both layers', () => {
    const catalog = JSON.parse(readFileSync(mod.DEFAULT_CATALOG, 'utf8'));
    const layers = new Set(catalog.mutants.map((m) => m.layer));
    expect([...layers].sort()).toEqual(['e2e', 'integration']);
  });

  test('every end-to-end kill spec is one the local Playwright config runs', () => {
    const catalog = JSON.parse(readFileSync(mod.DEFAULT_CATALOG, 'utf8'));
    const config = readFileSync('playwright.mobile.config.ts', 'utf8');
    for (const m of catalog.mutants.filter((x) => x.layer === 'e2e')) {
      for (const spec of m.kill) {
        const name = spec.replace(/^tests\/playwright\//, '').replace(/\.spec\.ts$/, '');
        expect(config, `${spec} is in playwright.mobile.config.ts testMatch`).toContain(name);
      }
    }
  });
});

describe('checkCatalog', () => {
  test('passes a sound catalog', () => {
    expect(mod.checkCatalog(good, fakeRead)).toEqual([]);
  });

  test('BORN RED: a find that is not in the file (the source moved) fails', () => {
    expect(mod.checkCatalog(withMutant({ find: 'if (n <= floor)' }), fakeRead).join()).toMatch(
      /occurs 0 times/
    );
  });

  test('BORN RED: a find that occurs twice fails', () => {
    expect(mod.checkCatalog(withMutant({ find: 'n' }), fakeRead).join()).toMatch(
      /occurs \d+ times/
    );
  });

  test('BORN RED: a spec at the wrong layer, or a node-project spec, fails', () => {
    expect(
      mod.checkCatalog(withMutant({ kill: ['tests/playwright/a.spec.ts'] }), fakeRead).join()
    ).toMatch(/not a integration spec/);
    expect(
      mod
        .checkCatalog(good, fakeRead, (s) => s === 'workers/oursharedevents/tests/a.spec.ts')
        .join()
    ).toMatch(/node project/);
  });

  test('BORN RED: an unknown layer, a missing spec, no kill list and a no-op mutant fail', () => {
    expect(mod.checkCatalog(withMutant({ layer: 'unit' }), fakeRead).join()).toMatch(
      /layer must be/
    );
    expect(
      mod
        .checkCatalog(
          withMutant({ kill: ['workers/oursharedevents/tests/gone.spec.ts'] }),
          fakeRead
        )
        .join()
    ).toMatch(/does not exist/);
    expect(mod.checkCatalog(withMutant({ kill: [] }), fakeRead).join()).toMatch(/no spec in kill/);
    expect(mod.checkCatalog(withMutant({ replace: 'if (n < floor)' }), fakeRead).join()).toMatch(
      /nothing is mutated/
    );
    expect(
      mod.checkCatalog({ mutants: [good.mutants[0], good.mutants[0]] }, fakeRead).join()
    ).toMatch(/used twice/);
  });
});

describe('applyMutant', () => {
  test('writes the fault in once, literally', () => {
    expect(mod.applyMutant(files['workers/oursharedevents/src/lib/a.ts'], good.mutants[0])).toBe(
      'if (false) return null;\nreturn n;\n'
    );
    expect(mod.applyMutant('a = 1;', { id: 'x', file: 'f', find: '1', replace: "$&$'" })).toBe(
      "a = $&$';"
    );
  });

  test('BORN RED: refuses a find that does not occur exactly once', () => {
    expect(() => mod.applyMutant('x x', { id: 'x', file: 'f', find: 'x', replace: 'y' })).toThrow(
      /2 times/
    );
  });
});

describe('verdictFromPlaywright (fail closed)', () => {
  test('a test that failed on every try kills', () => {
    expect(
      mod.verdictFromPlaywright({ stats: { expected: 3, unexpected: 1, flaky: 0 } }).verdict
    ).toBe('killed');
  });
  test('tests that all passed read as passed (a surviving mutant)', () => {
    expect(
      mod.verdictFromPlaywright({ stats: { expected: 4, unexpected: 0, flaky: 0 } }).verdict
    ).toBe('passed');
  });
  test('BORN RED: a flaky test does not kill', () => {
    expect(
      mod.verdictFromPlaywright({ stats: { expected: 3, unexpected: 0, flaky: 1 } }).verdict
    ).toBe('passed');
  });
  test('BORN RED: no test ran, no report, a Worker that never started are errors', () => {
    expect(
      mod.verdictFromPlaywright({ stats: { expected: 0, unexpected: 0, flaky: 0 } }).verdict
    ).toBe('error');
    expect(mod.verdictFromPlaywright(null).verdict).toBe('error');
    expect(
      mod.verdictFromPlaywright({
        stats: { expected: 0, unexpected: 0 },
        errors: [{ message: 'Timed out waiting 120000ms from config.webServer.' }],
      }).reason
    ).toMatch(/webServer/);
  });
});

describe('verdictFromVitest (fail closed)', () => {
  test('a failed test kills; all passing reads as passed', () => {
    expect(
      mod.verdictFromVitest({ numTotalTests: 5, numFailedTests: 1, numPassedTests: 4 }).verdict
    ).toBe('killed');
    expect(
      mod.verdictFromVitest({ numTotalTests: 5, numFailedTests: 0, numPassedTests: 5 }).verdict
    ).toBe('passed');
  });
  test('BORN RED: a suite that failed to load is an error, not a kill', () => {
    expect(
      mod.verdictFromVitest({
        numTotalTests: 3,
        numFailedTests: 0,
        numPassedTests: 3,
        numFailedTestSuites: 1,
      }).verdict
    ).toBe('error');
  });
  test('BORN RED: no test ran, or no report, is an error', () => {
    expect(
      mod.verdictFromVitest({ numTotalTests: 0, numFailedTests: 0, numPassedTests: 0 }).verdict
    ).toBe('error');
    expect(mod.verdictFromVitest(null).verdict).toBe('error');
  });
});

describe('gateFailures', () => {
  const base = { rule: 'r', layer: 'e2e', file: 'f', kill: ['k'], reason: 'x' };
  test('passes when every mutant was killed', () => {
    expect(mod.gateFailures([{ id: 'a', verdict: 'killed', ...base }])).toEqual([]);
  });
  test('BORN RED: a survivor and an error each fail', () => {
    const f = mod.gateFailures([
      { id: 'a', verdict: 'passed', ...base },
      { id: 'b', verdict: 'error', ...base },
    ]);
    expect(f.map((x) => x.split(' ')[0])).toEqual(['a', 'b']);
    expect(f[0]).toMatch(/SURVIVED/);
    expect(f[1]).toMatch(/ERROR/);
  });
});

describe('the workflow runs the layers', () => {
  test('a nightly job runs the runner', () => {
    const wf = yaml.load(readFileSync('.github/workflows/mutation-testing.yml', 'utf8'));
    const job = wf.jobs['mutation-layers'];
    expect(job, 'the mutation-layers job').toBeTruthy();
    expect(job.steps.some((s) => s.run === 'npm run test:mutation:layers')).toBe(true);
  });
});
