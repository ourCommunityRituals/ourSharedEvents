// vitest globals: true (vitest.config.ts). The conformance-refresh PR (OSE-1031)
// opens only for a real coverage change, from the newest main, one run at a time.
// PR 1617 (28 Nov 2026): two merges seconds apart started two runs; the older one
// landed last, reset the refresh branch to an older main and opened a PR that
// changed only the stamp and conflicted with the refresh that had just merged, so
// none of the required checks could run on it.
const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/ci/conformance-stamp-only.sh');
const wf = yaml.load(
  readFileSync(path.join(ROOT, '.github/workflows/conformance-report.yml'), 'utf8')
);
const RPT = 'workers/oursharedevents/docs/security';

const md = (commit, run, row = '| 1 | ✅ |') =>
  `# Report\n\n> **Generated:** 2026-11-28 | **Commit:** \`${commit}\` | **Run:** [CI Run](${run})\n>\n${row}\n`;
const json = (date, commit, run, covered = 25) =>
  JSON.stringify(
    { generated_at: date, commit, run_url: run, schema_version: '1.0.0', summary: { covered } },
    null,
    2
  ) + '\n';

describe('conformance stamp-only check', () => {
  let dir;
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  const write = (m, j) => {
    writeFileSync(path.join(dir, RPT, 'CONFORMANCE.md'), m);
    writeFileSync(path.join(dir, RPT, 'conformance.json'), j);
  };
  const check = () => spawnSync('bash', [SCRIPT, RPT], { cwd: dir }).status;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'conf-stamp-'));
    mkdirSync(path.join(dir, RPT), { recursive: true });
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'user.name', 't');
    write(md('0f57d8d9', 'https://x/runs/1'), json('2026-11-27', '0f57d8d9', 'https://x/runs/1'));
    git('add', '-A');
    git('commit', '-qm', 'base');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('only the date, commit and run link moved: stamp only (no PR)', () => {
    write(md('ea8f57ba', 'https://x/runs/2'), json('2026-11-28', 'ea8f57ba', 'https://x/runs/2'));
    expect(check()).toBe(0);
  });

  test('a coverage number moved in the JSON: a real change (PR)', () => {
    write(
      md('ea8f57ba', 'https://x/runs/2'),
      json('2026-11-28', 'ea8f57ba', 'https://x/runs/2', 24)
    );
    expect(check()).toBe(1);
  });

  test('a report row moved in the Markdown: a real change (PR)', () => {
    write(
      md('ea8f57ba', 'https://x/runs/2', '| 1 | ❌ Gap |'),
      json('2026-11-28', 'ea8f57ba', 'https://x/runs/2')
    );
    expect(check()).toBe(1);
  });
});

describe('conformance-refresh workflow wiring', () => {
  const steps = wf.jobs.generate.steps;
  const run = steps.find((s) => s.name === 'Open/update the conformance-refresh PR').run;

  test('one run at a time; the newest replaces an older one', () => {
    expect(wf.concurrency).toEqual({ group: 'conformance-report', 'cancel-in-progress': true });
  });

  test('a stamp-only change opens no PR, checked before the branch is touched', () => {
    const at = run.indexOf('bash scripts/ci/conformance-stamp-only.sh "$RPT"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(run.indexOf('git checkout -B "$BRANCH"'));
  });

  test('a run whose main is no longer the newest leaves the branch alone', () => {
    const at = run.indexOf('if [ "$MAIN_NOW" != "$GITHUB_SHA" ]; then');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(run.indexOf('git checkout -B "$BRANCH"'));
    expect(run.slice(at, run.indexOf('fi', at))).toContain('exit 0');
  });
});
