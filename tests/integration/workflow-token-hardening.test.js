/**
 * Workflow hardening gates (OSE-1466 items 0.4, 0.5, 0.6).
 *
 * Credential isolation is part of the never-who promise: whoever can change
 * the pipeline, or ride a job's token, can change the code that enforces it.
 * Three static rules, each a property over every workflow in
 * .github/workflows/ (tests/e2e/0-architecture/README.md: property-asserting,
 * not subject-naming). Each detector is proven against synthetic controls
 * first, so the gate cannot pass vacuously.
 *
 *   0.6  Every job runs with an explicit permission set: a top-level
 *        `permissions:` or one on the job itself. Without either, the job
 *        gets the repository default token, which may be read-write.
 *   0.4  A third-party action is pinned to a 40-character commit SHA. A tag
 *        can be moved by whoever controls that repository. actions/* and
 *        github/* (first-party) may stay tag-pinned.
 *   0.5  No `${{ secrets.* | inputs.* | github.event.* | github.head_ref |
 *        github.actor }}` expression inside a `run:` script. Those values
 *        reach the shell as text and can inject commands; pass them through
 *        `env:` instead.
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');

// ── 0.6 ────────────────────────────────────────────────────────────────────
/** Jobs with no explicit permissions at either level: [{ file, job }]. */
function jobsWithoutPermissions(workflows) {
  const bad = [];
  for (const [file, wf] of Object.entries(workflows)) {
    if (wf && wf.permissions !== undefined) continue;
    for (const [job, def] of Object.entries((wf && wf.jobs) || {})) {
      if (def && def.permissions === undefined) bad.push({ file, job });
    }
  }
  return bad;
}

// ── 0.6, write surface ─────────────────────────────────────────────────────
// On pull_request the workflow file itself comes from the PR, so every job in
// such a workflow can be made to run PR code with its token. The set of those
// jobs whose token can push, comment or open issues is therefore a reviewed
// list, like the PR-reachable secrets list. Adding to it is a security decision.
const WRITE_SCOPES = ['contents', 'pull-requests', 'issues'];
const PR_WRITE_ALLOWED = {
  'dependency-review.yml:dependency-review':
    'Posts the dependency review summary on the pull request. Runs no repo code.',
  'claude-review.yml:review': 'Posts the automated review on the pull request.',
  'claude-review.yml:respond': 'Replies to review comments on the pull request.',
  'brain-contract-check.yml:report-drift':
    'Comments on drift and opens the Linear ticket after a failed check. Runs brain scripts and one base-branch script, never the pull request code.',
};

/** Jobs in pull_request workflows whose token has a write scope: [{ id, scopes }]. */
function prJobsWithWrite(workflows) {
  const found = [];
  for (const [file, wf] of Object.entries(workflows)) {
    const on = wf && (wf.on || wf[true]);
    const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on || {});
    if (!triggers.some((t) => t === 'pull_request' || t === 'pull_request_target')) continue;
    for (const [job, def] of Object.entries((wf && wf.jobs) || {})) {
      const perms = def && def.permissions !== undefined ? def.permissions : wf.permissions;
      const scopes =
        perms === 'write-all'
          ? WRITE_SCOPES
          : WRITE_SCOPES.filter((s) => perms && typeof perms === 'object' && perms[s] === 'write');
      if (scopes.length) found.push({ id: `${file}:${job}`, scopes });
    }
  }
  return found;
}

// ── 0.4 ────────────────────────────────────────────────────────────────────
const FIRST_PARTY = /^(actions|github)\//;
const SHA = /^[0-9a-f]{40}$/;

/** Third-party `uses:` refs not pinned to a commit SHA: [{ file, uses }]. */
function unpinnedThirdParty(workflows) {
  const bad = [];
  const check = (file, uses) => {
    if (typeof uses !== 'string') return;
    if (uses.startsWith('./') || uses.startsWith('docker://')) return;
    if (FIRST_PARTY.test(uses)) return;
    const at = uses.lastIndexOf('@');
    const ref = at === -1 ? '' : uses.slice(at + 1);
    if (!SHA.test(ref)) bad.push({ file, uses });
  };
  for (const [file, wf] of Object.entries(workflows)) {
    for (const def of Object.values((wf && wf.jobs) || {})) {
      if (!def) continue;
      check(file, def.uses);
      for (const step of def.steps || []) check(file, step && step.uses);
    }
  }
  return bad;
}

// ── 0.5 ────────────────────────────────────────────────────────────────────
const RISKY_EXPR =
  /\$\{\{\s*(secrets\.|inputs\.|github\.event\.|github\.head_ref|github\.actor)[^}]*\}\}/g;

/** Risky expressions inside run: scripts: [{ file, job, expr }]. */
function injectionInRun(workflows) {
  const bad = [];
  for (const [file, wf] of Object.entries(workflows)) {
    for (const [job, def] of Object.entries((wf && wf.jobs) || {})) {
      for (const step of (def && def.steps) || []) {
        if (!step || typeof step.run !== 'string') continue;
        for (const m of step.run.match(RISKY_EXPR) || []) {
          bad.push({ file, job, expr: m.replace(/\s+/g, ' ') });
        }
      }
    }
  }
  return bad;
}

describe('detector controls', () => {
  test('0.6 flags a job with no permissions anywhere, passes either level', () => {
    expect(
      jobsWithoutPermissions({
        'a.yml': { jobs: { x: { steps: [] } } },
        'b.yml': { permissions: { contents: 'read' }, jobs: { y: {} } },
        'c.yml': { jobs: { z: { permissions: { contents: 'read' } } } },
        'd.yml': { permissions: {}, jobs: { w: {} } },
      })
    ).toEqual([{ file: 'a.yml', job: 'x' }]);
  });

  test('0.6 finds write scopes on pull_request jobs, at either level, and ignores other triggers', () => {
    expect(
      prJobsWithWrite({
        'a.yml': {
          on: { pull_request: {} },
          permissions: { contents: 'read', issues: 'write' },
          jobs: {
            inherits: {},
            narrowed: { permissions: { contents: 'read' } },
            widened: { permissions: { contents: 'write', checks: 'write' } },
          },
        },
        'b.yml': { on: ['push', 'pull_request'], permissions: 'write-all', jobs: { all: {} } },
        'c.yml': { on: 'schedule', permissions: { issues: 'write' }, jobs: { nightly: {} } },
        'd.yml': { on: 'pull_request', permissions: { checks: 'write' }, jobs: { checksOnly: {} } },
      })
    ).toEqual([
      { id: 'a.yml:inherits', scopes: ['issues'] },
      { id: 'a.yml:widened', scopes: ['contents'] },
      { id: 'b.yml:all', scopes: ['contents', 'pull-requests', 'issues'] },
    ]);
  });

  test('0.4 flags a tag-pinned third-party action, passes a SHA and first-party', () => {
    const sha = 'a'.repeat(40);
    expect(
      unpinnedThirdParty({
        'a.yml': {
          jobs: {
            x: {
              steps: [
                { uses: 'dorny/test-reporter@v3' },
                { uses: `dorny/test-reporter@${sha}` },
                { uses: 'actions/checkout@v4' },
                { uses: 'github/codeql-action/init@v3' },
                { uses: './.github/actions/local' },
                { uses: 'docker://alpine:3' },
                { uses: 'owner/repo' },
              ],
            },
            y: { uses: 'owner/reusable/.github/workflows/w.yml@main' },
          },
        },
      })
    ).toEqual([
      { file: 'a.yml', uses: 'dorny/test-reporter@v3' },
      { file: 'a.yml', uses: 'owner/repo' },
      { file: 'a.yml', uses: 'owner/reusable/.github/workflows/w.yml@main' },
    ]);
  });

  test('0.5 flags risky expressions in run:, passes env: and safe contexts', () => {
    expect(
      injectionInRun({
        'a.yml': {
          jobs: {
            x: {
              steps: [
                { run: 'echo "${{ github.event.pull_request.title }}"' },
                { run: 'curl -H "k: ${{ secrets.KEY }}" x' },
                { run: 'echo ${{ inputs.target }}' },
                { run: 'echo "$TITLE"', env: { TITLE: '${{ github.event.pull_request.title }}' } },
                { run: 'echo ${{ github.sha }} ${{ matrix.node }} ${{ runner.os }}' },
              ],
            },
          },
        },
      }).map((b) => b.expr)
    ).toEqual([
      '${{ github.event.pull_request.title }}',
      '${{ secrets.KEY }}',
      '${{ inputs.target }}',
    ]);
  });
});

describe('.github/workflows', () => {
  const workflows = {};
  for (const f of readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    workflows[f] = yaml.load(readFileSync(join(WF_DIR, f), 'utf8'));
  }

  test('there are workflows to check', () => {
    expect(Object.keys(workflows).length).toBeGreaterThan(10);
  });

  test('0.6 every job has explicit token permissions', () => {
    expect(jobsWithoutPermissions(workflows)).toEqual([]);
  });

  test('0.6 only reviewed pull_request jobs hold a token that can push, comment or open issues', () => {
    const ids = prJobsWithWrite(workflows).map((j) => j.id);
    expect(ids.filter((id) => !(id in PR_WRITE_ALLOWED))).toEqual([]);
    // An entry whose job no longer holds write must be removed, so the list only shrinks.
    expect(Object.keys(PR_WRITE_ALLOWED).filter((id) => !ids.includes(id))).toEqual([]);
  });

  test('0.6 the brain drift reporter, which can comment, never checks out the pull request code', () => {
    const wf = workflows['brain-contract-check.yml'];
    const report = wf.jobs['report-drift'];
    const checkouts = report.steps.filter(
      (st) => typeof st.uses === 'string' && st.uses.startsWith('actions/checkout')
    );
    expect(checkouts.length).toBeGreaterThan(0);
    // A checkout with no `repository` and no `ref` is the pull request's head.
    const prHead = checkouts.filter((st) => !st.with || (!st.with.repository && !st.with.ref));
    expect(prHead).toEqual([]);
    const ownRepo = checkouts.filter((st) => !st.with.repository).map((st) => st.with.ref);
    expect(ownRepo).toEqual(['${{ github.event.pull_request.base.sha }}']);
    // It only runs after the check job, and only when that job failed.
    expect(report.needs).toEqual(['contract-check']);
    expect(report.if).toContain("needs.contract-check.result == 'failure'");
    // No step runs a script from a path other than the brain or the base checkout.
    const runs = report.steps.map((st) => st.run).filter(Boolean);
    for (const r of runs) expect(r).toMatch(/(^|[ "])(ocr-docs|ose-base)\//);
  });

  test('0.6 the run-time token probe is wired into the jobs that run PR code', () => {
    const probed = [];
    for (const [file, wf] of Object.entries(workflows)) {
      for (const [job, def] of Object.entries((wf && wf.jobs) || {})) {
        const hit = ((def && def.steps) || []).some(
          (s) => typeof s.run === 'string' && s.run.includes('scripts/ci/assert-token-read-only.sh')
        );
        if (hit) probed.push(`${file}:${job}`);
      }
    }
    expect(probed.sort()).toEqual([
      'mobile-workability-audit.yml:pr-code',
      'oursharedevents-ci.yml:gate',
    ]);
  });

  test('0.4 every third-party action is pinned to a commit SHA', () => {
    expect(unpinnedThirdParty(workflows)).toEqual([]);
  });

  test('0.5 no secrets, inputs or event data are interpolated into a run: script', () => {
    expect(injectionInRun(workflows)).toEqual([]);
  });
});
