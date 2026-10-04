/**
 * One entry point for T3 (scripts/ci/run-t3.mjs): CI's matrix step, a laptop's
 * `npm run test:t3:staging` and run-local-vetting.sh all read scripts/ci/t3-sections.json.
 * These tests pin the pure rules and that nothing re-inlines a spec list.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let m;
beforeAll(async () => {
  m = await import('../../../scripts/ci/run-t3.mjs');
});

const FULL_ENV = {
  ADMIN_KEY: 'a',
  X_OCR_INTERNAL: 'b',
  CF_ACCESS_CLIENT_ID: 'c',
  CF_ACCESS_CLIENT_SECRET: 'd',
};

describe('run-t3 pure rules', () => {
  test('parseArgs separates runner flags from Playwright passthrough', () => {
    expect(m.parseArgs(['--section', 'iac', '--', '--grep', 'x'])).toMatchObject({
      section: 'iac',
      passthrough: ['--grep', 'x'],
    });
    expect(() => m.parseArgs(['--bogus'])).toThrow();
  });

  test('pickSections rejects unknown names and defaults to all', () => {
    const s = m.loadSections();
    expect(m.pickSections(s, 'all').names).toEqual(Object.keys(s));
    expect(m.pickSections(s, 'nope').error).toMatch(/unknown section/);
    expect(m.pickSections(s, '').error).toMatch(/unknown section/);
  });

  test('production is refused, including the www host', () => {
    for (const baseUrl of ['https://oursharedevents.com', 'https://www.oursharedevents.com/x']) {
      expect(m.preflightProblem({ baseUrl, env: FULL_ENV, passthrough: [] })).toMatch(/production/);
    }
  });

  test('staging needs all four credentials; local does not', () => {
    const stg = 'https://stg.oursharedevents.com';
    expect(m.preflightProblem({ baseUrl: stg, env: FULL_ENV, passthrough: [] })).toBeNull();
    const { CF_ACCESS_CLIENT_SECRET, ...partial } = FULL_ENV;
    expect(m.preflightProblem({ baseUrl: stg, env: partial, passthrough: [] })).toMatch(
      /CF_ACCESS_CLIENT_SECRET/
    );
    expect(
      m.preflightProblem({ baseUrl: 'http://127.0.0.1:8787', env: {}, passthrough: [] })
    ).toBeNull();
  });

  test('a recording trace is refused (OSE-1470); --trace off is fine', () => {
    const base = { baseUrl: 'http://127.0.0.1:8787', env: {} };
    expect(m.preflightProblem({ ...base, passthrough: ['--trace', 'on'] })).toMatch(/OSE-1470/);
    expect(m.preflightProblem({ ...base, passthrough: ['--trace=retain-on-failure'] })).toMatch(
      /OSE-1470/
    );
    expect(m.preflightProblem({ ...base, passthrough: ['--trace=off'] })).toBeNull();
  });
});

describe('one list of T3 specs', () => {
  const sections = JSON.parse(read('scripts/ci/t3-sections.json')).sections;

  test('every named spec and config exists', () => {
    for (const s of Object.values(sections)) {
      expect(fs.existsSync(path.join(ROOT, s.config))).toBe(true);
      for (const spec of s.specs) expect(fs.existsSync(path.join(ROOT, spec))).toBe(true);
    }
  });

  test('the CI matrix runs the shared runner and does not carry its own spec list', () => {
    const wf = yaml.load(read('.github/workflows/oursharedevents-ci.yml'));
    const job = wf.jobs['smoke-staging-sub'];
    const matrixSections = job.strategy.matrix.include.map((e) => e.section).sort();
    expect(matrixSections).toEqual(Object.keys(sections).sort());
    for (const e of job.strategy.matrix.include) expect(e.specs).toBeUndefined();
    const run = job.steps.find((s) => s.name === 'Run T3 smoke section');
    expect(run.run).toBe('node scripts/ci/run-t3.mjs --section ${{ matrix.section }}');
  });

  test('local vetting reads the same list; the npm script points at the runner', () => {
    expect(read('scripts/ci/run-local-vetting.sh')).toContain('run-t3.mjs" --tsv');
    expect(JSON.parse(read('package.json')).scripts['test:t3:staging']).toBe(
      'node scripts/ci/run-t3.mjs'
    );
  });
});
