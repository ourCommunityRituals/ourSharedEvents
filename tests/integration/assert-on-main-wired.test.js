/**
 * Production ships only commits that are on main (OSE-1662).
 *
 * deploy-production runs on any `v*.*.*` tag push or a manual dispatch. Before
 * this gate, a tag on a side branch shipped whatever that branch held: nothing
 * compared the commit with main.
 *
 *   1. The script, run against a throwaway git repository, passes a commit on
 *      main (the tip or an older one) and refuses a commit off main, a missing
 *      main and an unknown commit.
 *   2. deploy-production runs it as its first step after a full-history
 *      checkout, with nothing that could skip it or swallow a failure. Every
 *      way of loosening that is planted below, so the detector cannot pass on
 *      an empty result.
 *
 * No request leaves this machine.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, rmSync, readFileSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const SCRIPT = 'scripts/ci/assert-on-main.sh';
const WORKFLOW = '.github/workflows/oursharedevents-ci.yml';

// ── 1. the script against a throwaway repository ────────────────────────────

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(cwd, name) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a temp dir this test made
  writeFileSync(join(cwd, name), name);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-q', '-m', name);
  return git(cwd, 'rev-parse', 'HEAD');
}

/**
 * main: a — b — c, and a side branch off b: b — x.
 * origin/main is a remote-tracking ref, as actions/checkout leaves it.
 */
function buildRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'on-main-'));
  git(dir, 'init', '-q', '-b', 'main');
  const a = commit(dir, 'a');
  const b = commit(dir, 'b');
  git(dir, 'checkout', '-q', '-b', 'side');
  const x = commit(dir, 'x');
  git(dir, 'checkout', '-q', 'main');
  const c = commit(dir, 'c');
  git(dir, 'update-ref', 'refs/remotes/origin/main', c);
  return { dir, a, b, c, x };
}

function runGate(cwd, env = {}) {
  const r = spawnSync('bash', [join(ROOT, SCRIPT)], {
    cwd,
    env: { ...process.env, ...GIT_ENV, SHIP_SHA: '', MAIN_REF: '', ...env },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe('the gate, run against a throwaway repository', () => {
  let repo;
  beforeAll(() => {
    repo = buildRepo();
  });
  afterAll(() => rmSync(repo.dir, { recursive: true, force: true }));

  test('the tip of main ships', () => {
    const r = runGate(repo.dir, { SHIP_SHA: repo.c });
    expect(r.out).toContain(`ON MAIN: ${repo.c} is on origin/main`);
    expect(r.code).toBe(0);
  });

  test('an older commit on main ships (a release tag main has since moved past)', () => {
    for (const sha of [repo.a, repo.b]) {
      expect(runGate(repo.dir, { SHIP_SHA: sha }).code).toBe(0);
    }
  });

  test('with no SHIP_SHA it checks HEAD', () => {
    git(repo.dir, 'checkout', '-q', repo.x);
    try {
      expect(runGate(repo.dir).code).toBe(1);
    } finally {
      git(repo.dir, 'checkout', '-q', 'main');
    }
    expect(runGate(repo.dir).code).toBe(0);
  });

  test('a commit on a side branch is refused', () => {
    const r = runGate(repo.dir, { SHIP_SHA: repo.x });
    expect(r.out).toContain(`::error title=Not on main::${repo.x} is not on origin/main`);
    expect(r.out).not.toContain('ON MAIN');
    expect(r.code).toBe(1);
  });

  test('no origin/main in the checkout: refused, not waved through', () => {
    const r = runGate(repo.dir, { SHIP_SHA: repo.c, MAIN_REF: 'origin/nope' });
    expect(r.out).toContain('origin/nope is not in this checkout, so nothing ships');
    expect(r.code).toBe(1);
  });

  test('an unknown commit is refused', () => {
    const r = runGate(repo.dir, { SHIP_SHA: 'f'.repeat(40) });
    expect(r.out).toContain('is not a commit in this checkout, so nothing ships');
    expect(r.code).toBe(1);
  });

  test('the local main branch is not what it compares against', () => {
    // A side commit fast-forwarded into the local `main` only: origin/main is
    // still the truth, so it is still refused.
    git(repo.dir, 'branch', '-f', 'main-copy', 'main');
    git(repo.dir, 'checkout', '-q', 'main-copy');
    git(repo.dir, 'merge', '-q', '--no-edit', 'side');
    const merged = git(repo.dir, 'rev-parse', 'HEAD');
    git(repo.dir, 'checkout', '-q', 'main');
    expect(runGate(repo.dir, { SHIP_SHA: merged }).code).toBe(1);
  });

  test('the script only reads the local repository', () => {
    const src = readFileSync(join(ROOT, SCRIPT), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(src).not.toMatch(/\bgit (fetch|push|pull|clone|remote)\b|curl|wget|secrets|TOKEN/);
  });
});

// ── 2. the wiring ───────────────────────────────────────────────────────────

const JOB = 'deploy-production';
const NAME = 'Gate: the commit is on main (OSE-1662)';
const RUN = `bash ${SCRIPT}`;
const AT = `${JOB} / "${NAME}"`;

const readCi = () => yaml.load(readFileSync(join(ROOT, WORKFLOW), 'utf8'));
const runLines = (step) =>
  String((step && step.run) || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

/** Empty when a commit off main stops deploy-production before anything else runs. */
function wiringProblems(ci) {
  const job = ci.jobs[JOB];
  if (!job) return [`there is no ${JOB} job`];
  const steps = job.steps || [];
  const hits = steps.filter((s) => runLines(s).some((l) => l.includes(SCRIPT)));
  if (hits.length === 0) return [`no step in ${JOB} runs ${SCRIPT}`];
  const step = hits[0];
  const out = [];
  if (runLines(step).length !== 1 || runLines(step)[0] !== RUN) {
    out.push(
      `${AT}: the gate is not run as the one plain command, so a failure may not fail the step`
    );
  }
  if (step.env !== undefined) {
    out.push(`${AT}: the step sets env, so it may not check this run's commit`);
  }
  if (step['continue-on-error'] !== undefined) out.push(`${AT}: the step has continue-on-error`);
  if (job['continue-on-error'] !== undefined) out.push(`${AT}: the job has continue-on-error`);
  if (step.if !== undefined) out.push(`${AT}: the step has an \`if:\` and can be skipped`);
  if (step['working-directory'] !== undefined) out.push(`${AT}: the step runs from another folder`);
  const checkout = steps.findIndex((s) => String(s.uses || '').startsWith('actions/checkout@'));
  if (checkout === -1) {
    out.push(`${AT}: the job has no checkout`);
  } else {
    if (steps.indexOf(step) !== checkout + 1) {
      out.push(
        `${AT}: it is not the first step after checkout, so other steps run for a commit off main`
      );
    }
    const w = steps[checkout].with || {};
    if (w['fetch-depth'] !== 0) {
      out.push(
        `${AT}: the checkout is not full history, so origin/main and the commit's history are not both there`
      );
    }
    if (w.ref !== undefined) {
      out.push(`${AT}: the checkout names a ref, so it may not be this run's commit`);
    }
  }
  return out;
}

describe('the gate is wired into deploy-production', () => {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const ci0 = readCi();
  const gate = (ci) => ci.jobs[JOB].steps.find((s) => s.name === NAME);
  const checkout = (ci) =>
    ci.jobs[JOB].steps.find((s) => String(s.uses || '').startsWith('actions/checkout@'));

  test('the step is there, plain, first after a full checkout, and cannot be skipped', () => {
    expect(wiringProblems(ci0)).toEqual([]);
  });

  test('it is exactly this step', () => {
    expect(gate(ci0)).toEqual({ name: NAME, run: RUN });
  });

  // ── planted faults ─────────────────────────────────────────────────────

  test('the step is removed', () => {
    const ci = clone(ci0);
    ci.jobs[JOB].steps = ci.jobs[JOB].steps.filter((s) => s.name !== NAME);
    expect(wiringProblems(ci)).toEqual([`no step in ${JOB} runs ${SCRIPT}`]);
  });

  test('the command is commented out', () => {
    const ci = clone(ci0);
    gate(ci).run = `# ${RUN}\necho skipped`;
    expect(wiringProblems(ci)).toEqual([`no step in ${JOB} runs ${SCRIPT}`]);
  });

  test('a failure is swallowed with `|| true`', () => {
    const ci = clone(ci0);
    gate(ci).run = `${RUN} || true`;
    expect(wiringProblems(ci)).toEqual([
      `${AT}: the gate is not run as the one plain command, so a failure may not fail the step`,
    ]);
  });

  test('the step can be skipped or ignored', () => {
    for (const [key, value, msg] of [
      ['if', "github.event_name == 'push'", `${AT}: the step has an \`if:\` and can be skipped`],
      ['continue-on-error', true, `${AT}: the step has continue-on-error`],
      ['working-directory', 'workers/oursharedevents', `${AT}: the step runs from another folder`],
      [
        'env',
        { SHIP_SHA: 'main' },
        `${AT}: the step sets env, so it may not check this run's commit`,
      ],
    ]) {
      const ci = clone(ci0);
      gate(ci)[key] = value;
      expect(wiringProblems(ci), key).toEqual([msg]);
    }
  });

  test('the job is allowed to fail', () => {
    const ci = clone(ci0);
    ci.jobs[JOB]['continue-on-error'] = true;
    expect(wiringProblems(ci)).toEqual([`${AT}: the job has continue-on-error`]);
  });

  test('the step is moved after another step', () => {
    const ci = clone(ci0);
    const steps = ci.jobs[JOB].steps;
    const i = steps.indexOf(gate(ci));
    [steps[i], steps[i + 1]] = [steps[i + 1], steps[i]];
    expect(wiringProblems(ci)).toEqual([
      `${AT}: it is not the first step after checkout, so other steps run for a commit off main`,
    ]);
  });

  test('the checkout goes back to a shallow clone', () => {
    const ci = clone(ci0);
    delete checkout(ci).with['fetch-depth'];
    expect(wiringProblems(ci)).toEqual([
      `${AT}: the checkout is not full history, so origin/main and the commit's history are not both there`,
    ]);
  });

  test('the checkout is pointed at another ref', () => {
    const ci = clone(ci0);
    checkout(ci).with.ref = 'main';
    expect(wiringProblems(ci)).toEqual([
      `${AT}: the checkout names a ref, so it may not be this run's commit`,
    ]);
  });
});
