/**
 * The OCR-docs brain is read at a pinned commit (CCR F3; owner decision
 * 2026-11-26: pilot in ourWKRP, then the hub and OSE).
 *
 * Six checkouts in five workflows read OCR-docs at main, so a change merged
 * there ran in OSE's CI on the next PR without a review here, including in
 * report-drift, which holds a token that can comment. Now:
 *   1. .ocr-brain-ref holds one full commit id;
 *   2. every OCR-docs checkout fetches main with full history, and the next
 *      step (after the token probe, if there is one) runs scripts/ci/brain-pin.sh
 *      on that checkout, under the same `if:`;
 *   3. jobs that run on a pull request pass the base branch's pin, so a PR
 *      cannot roll the brain back; report-drift reads the base branch's own pin;
 *   4. brain-pin.sh refuses a malformed pin, a pin that is not on OCR-docs main
 *      and a pin older than the base branch's, then moves the checkout to it.
 *
 * Born red: rules 1 to 3 fail on the old workflows; rule 4 runs the real
 * script against a throwaway OCR-docs history.
 */
const { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { spawnSync } = require('child_process');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'brain-pin.sh');

const checkouts = [];
for (const file of readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f))) {
  const wf = yaml.load(readFileSync(join(WF_DIR, file), 'utf8'));
  for (const [job, def] of Object.entries((wf && wf.jobs) || {})) {
    const steps = (def && def.steps) || [];
    steps.forEach((s, i) => {
      if (s.with && s.with.repository === 'ourCommunityRituals/OCR-docs') checkouts.push({ id: `${file}:${job}`, s, i, steps });
    });
  }
}

describe('the pin file and the workflow wiring (CCR F3)', () => {
  test('.ocr-brain-ref is one full commit id', () => {
    expect(existsSync(join(ROOT, '.ocr-brain-ref'))).toBe(true);
    expect(readFileSync(join(ROOT, '.ocr-brain-ref'), 'utf8').trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  test('the six brain checkouts are the ones this test knows', () => {
    expect(checkouts.map((c) => c.id).sort()).toEqual([
      'brain-contract-check.yml:contract-check',
      'brain-contract-check.yml:report-drift',
      'conformance-report.yml:generate',
      'flags-package-ci.yml:flags-tests',
      'inv22-cross-repo-gate.yml:inv22-gate',
      'oursharedevents-ci.yml:gate-tests-sub',
    ].sort());
  });

  test.each(checkouts.map((c) => [c.id, c]))(
    '%s: fetches main with full history and pins it before anything else reads it',
    (_id, c) => {
      expect(c.s.with.ref).toBe('main');
      expect(c.s.with['fetch-depth']).toBe(0);
      let j = c.i + 1;
      if (/assert-no-persisted-token\.sh/.test(c.steps[j].run || '')) j += 1;
      const pin = c.steps[j];
      expect(pin.run || '').toMatch(new RegExp(`scripts/ci/brain-pin\\.sh ${c.s.with.path} `));
      expect(pin.if).toBe(c.s.if);
    },
  );

  test.each(checkouts.filter((c) => !c.id.endsWith(':report-drift')).map((c) => [c.id, c]))(
    '%s: passes the base branch pin, so a PR cannot roll the brain back',
    (_id, c) => {
      const pin = c.steps.find((s) => /scripts\/ci\/brain-pin\.sh/.test(s.run || ''));
      expect(pin.env.BASE_REF).toBe('${{ github.base_ref }}');
      expect(pin.run).toMatch(/show FETCH_HEAD:\.ocr-brain-ref/);
      expect(pin.run).toMatch(/"\$base_pin"/);
    },
  );

  test('report-drift, which can comment, pins the brain from the base branch, never the PR', () => {
    const c = checkouts.find((x) => x.id.endsWith(':report-drift'));
    const pin = c.steps.find((s) => /scripts\/ci\/brain-pin\.sh/.test(s.run || ''));
    expect(pin.run.trim()).toBe('bash ose-base/scripts/ci/brain-pin.sh ocr-docs ose-base/.ocr-brain-ref');
  });
});

describe('brain-pin.sh, run for real', () => {
  let dir = '';
  let brain = '';
  const sha = {};
  const git = (...a) => spawnSync('git', ['-C', brain, ...a], { encoding: 'utf8' }).stdout.trim();
  const commit = (label) => {
    writeFileSync(join(brain, 'f.txt'), label);
    git('add', 'f.txt');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', label);
    sha[label] = git('rev-parse', 'HEAD');
  };
  const run = (pin, base = '') => {
    const pinFile = join(dir, 'pin');
    if (pin === null) rmSync(pinFile, { force: true });
    else writeFileSync(pinFile, `${pin}\n`);
    git('checkout', '-q', 'main');
    return spawnSync('bash', [SCRIPT, brain, pinFile, base], { encoding: 'utf8' });
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'brain-pin-'));
    brain = join(dir, 'ocr-docs');
    spawnSync('git', ['init', '-q', '-b', 'main', brain]);
    commit('A');
    commit('B');
    git('checkout', '-q', '-b', 'side');
    commit('D'); // on a branch, never merged
    git('checkout', '-q', 'main');
    commit('C');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('a pin on main moves the checkout there and warns how far behind it is', () => {
    const r = run(sha.B);
    expect(r.status).toBe(0);
    expect(git('rev-parse', 'HEAD')).toBe(sha.B);
    expect(r.stdout).toContain('::warning');
    expect(r.stdout).toContain('1 commit(s) behind');
  });

  test('a pin at main passes without a warning', () => {
    const r = run(sha.C, sha.B);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('::warning');
  });

  test.each([
    ['a missing pin file', () => run(null), 'is missing'],
    ['a short commit id', () => run(sha.B.slice(0, 7)), 'full 40-character'],
    ['a branch name', () => run('main'), 'full 40-character'],
    ['a commit that is not on main', () => run(sha.D), 'not on OCR-docs main'],
    ['a commit OCR-docs does not have', () => run('f'.repeat(40)), 'not in OCR-docs'],
    ['a pin older than the base branch pin', () => run(sha.B, sha.C), 'moves the brain back'],
  ])('refuses %s', (_label, go, message) => {
    const r = go();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('::error');
    expect(r.stdout).toContain(message);
  });
});
