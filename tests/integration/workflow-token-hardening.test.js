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

  test('0.4 every third-party action is pinned to a commit SHA', () => {
    expect(unpinnedThirdParty(workflows)).toEqual([]);
  });

  test('0.5 no secrets, inputs or event data are interpolated into a run: script', () => {
    expect(injectionInRun(workflows)).toEqual([]);
  });
});
