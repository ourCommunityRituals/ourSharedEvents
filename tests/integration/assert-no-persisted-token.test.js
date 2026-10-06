/**
 * scripts/ci/assert-no-persisted-token.sh (OSE-1466 item 0.1).
 *
 * The runtime half of "no token checkout leaves its token behind": CI runs the
 * script right after each token checkout, before any step that runs PR code.
 * Behavioral and hermetic: each case builds a temp git repo with a FAKE
 * credential, runs the real script, and checks the exit code and that the
 * output never contains the value.
 *
 * The second block is the wiring gate: every checkout that takes a `token:`
 * must be followed, in the same job, by a step that runs the script on that
 * checkout's path. It derives the checkouts from the workflows.
 */

const { spawnSync, execFileSync } = require('child_process');
const { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const SCRIPT_REL = 'scripts/ci/assert-no-persisted-token.sh';
const SCRIPT = join(ROOT, SCRIPT_REL);

// Fake value only. Never a real secret.
const FAKE = 'ZmFrZS10b2tlbi1ub3QtcmVhbA'; // pragma: allowlist secret (fake test value)

// No global or system git config: a developer's own settings must not decide
// the result.
const ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf-8' });
const posix = (p) => p.replace(/\\/g, '/');

function run(...dirs) {
  const res = spawnSync('bash', [posix(SCRIPT), ...dirs.map(posix)], {
    encoding: 'utf-8',
    env: ENV,
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

let tmp;
let repo;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'no-token-'));
  repo = join(tmp, 'checkout');
  git(tmp, 'init', '-q', 'checkout');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/example/repo');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

// Each case spawns git and bash several times; slow on a loaded Windows machine.
describe('assert-no-persisted-token.sh', { timeout: 30_000 }, () => {
  test('a clean checkout passes', () => {
    const r = run(repo);
    expect(r.out).toContain('clean');
    expect(r.code).toBe(0);
  });

  test('an extraheader in .git/config fails, and the value is not printed', () => {
    git(repo, 'config', 'http.https://github.com/.extraheader', `AUTHORIZATION: basic ${FAKE}`);
    const r = run(repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain('extraheader');
    expect(r.out).not.toContain(FAKE);
  });

  test('an extraheader pulled in by includeIf fails (where newer checkouts keep it)', () => {
    const credFile = join(tmp, 'git-credentials.config');
    writeFileSync(
      credFile,
      `[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic ${FAKE}\n`
    );
    const gitDir = posix(git(repo, 'rev-parse', '--absolute-git-dir').trim());
    git(repo, 'config', `includeIf.gitdir:${gitDir}.path`, posix(credFile));
    const r = run(repo);
    expect(r.code).toBe(1);
    expect(r.out).not.toContain(FAKE);
  });

  test('a token in the remote URL fails, and the value is not printed', () => {
    git(repo, 'remote', 'set-url', 'origin', `https://x-access-token:${FAKE}@github.com/e/r`);
    const r = run(repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain('remote.origin.url');
    expect(r.out).not.toContain(FAKE);
  });

  test('one bad checkout among several fails the run', () => {
    const second = join(tmp, 'second');
    git(tmp, 'init', '-q', 'second');
    git(second, 'config', 'http.https://github.com/.extraheader', `AUTHORIZATION: basic ${FAKE}`);
    expect(run(repo, second).code).toBe(1);
  });

  test('a path that is not a checkout does not pass silently', () => {
    expect(run(join(tmp, 'missing')).code).toBe(2);
  });

  test('no arguments is a usage error', () => {
    expect(run().code).toBe(2);
  });
});

describe('every token checkout is checked at run time', () => {
  const WF_DIR = join(ROOT, '.github', 'workflows');

  /** [{ where, path, checked }] for each actions/checkout step that sets `token:`. */
  function tokenCheckouts(workflows) {
    const found = [];
    for (const [file, wf] of Object.entries(workflows)) {
      for (const [job, def] of Object.entries((wf && wf.jobs) || {})) {
        const steps = (def && def.steps) || [];
        steps.forEach((step, i) => {
          const isCheckout = typeof step.uses === 'string' && /^actions\/checkout@/.test(step.uses);
          if (!isCheckout || !step.with || step.with.token === undefined) return;
          const path = step.with.path || '.';
          const next = steps[i + 1] || {};
          const run = typeof next.run === 'string' ? next.run : '';
          const checked =
            run.includes(SCRIPT_REL) && run.split(/\s+/).includes(path) && next.if === step.if;
          found.push({ where: `${file}:${job}`, path, checked });
        });
      }
    }
    return found;
  }

  test('detector: flags a token checkout with no check, a wrong path or a different condition', () => {
    const co = (extra = {}) => ({
      uses: 'actions/checkout@v7',
      with: { token: 'x', path: 'brain' },
      ...extra,
    });
    const check = (path, extra = {}) => ({ run: `bash ${SCRIPT_REL} ${path}`, ...extra });
    const jobs = {
      ok: { steps: [co(), check('brain')] },
      okIf: { steps: [co({ if: 'a' }), check('brain', { if: 'a' })] },
      none: { steps: [co(), { run: 'npm ci' }] },
      wrongPath: { steps: [co(), check('other')] },
      late: { steps: [co(), { run: 'npm ci' }, check('brain')] },
      skippable: { steps: [co(), check('brain', { if: 'false' })] },
      noToken: { steps: [{ uses: 'actions/checkout@v7' }] },
    };
    const bad = tokenCheckouts({ 'a.yml': { jobs } })
      .filter((c) => !c.checked)
      .map((c) => c.where);
    expect(bad).toEqual(['a.yml:none', 'a.yml:wrongPath', 'a.yml:late', 'a.yml:skippable']);
  });

  const workflows = {};
  for (const f of readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    workflows[f] = yaml.load(readFileSync(join(WF_DIR, f), 'utf8'));
  }
  const checkouts = tokenCheckouts(workflows);

  test('there are token checkouts to check (not vacuous)', () => {
    expect(checkouts.length).toBeGreaterThanOrEqual(5);
  });

  test('the step right after each token checkout runs the script on its path', () => {
    expect(checkouts.filter((c) => !c.checked).map((c) => `${c.where} (${c.path})`)).toEqual([]);
  });
});
