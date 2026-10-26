/**
 * No secret on a branch push (OSE-1695, acceptance criterion 3).
 *
 * On a `push`, GitHub runs the workflow file that is on the pushed branch, so anyone with write
 * access can push a branch with an edited workflow and read every repository secret that a job
 * on that trigger can see. A job that uses a credential must therefore not be triggered by a
 * push to any branch except main.
 *
 * What this was written for: security-regression.yml ran on pushes to `claude/**` with the
 * CF Access service token for staging (CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET) and no
 * environment, so a pushed `claude/x` branch could send that token anywhere.
 *
 * The rule is safe by default: every secret is protected unless it is on the short list below.
 * A new secret added to any workflow is covered the moment it appears.
 *
 * Out of scope here: pull_request exposure (scripts/check-pr-secret-exposure.mjs models that),
 * tag pushes, and schedule or manual runs, which only ever use the workflow on the default
 * branch or one a writer picks deliberately.
 */
const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/**
 * Secrets that may be used on a push to any branch.
 * GITHUB_TOKEN is minted per run and scoped by the workflow's permissions block.
 * OCR_HUB_READ is a fine-grained, read-only token for the hub repository, by design.
 * This list must only ever shrink or stay the same; adding to it needs a reason in review.
 */
const SAFE_ON_ANY_BRANCH_PUSH = new Set(['GITHUB_TOKEN', 'OCR_HUB_READ']);

/** The branch patterns a push trigger accepts, or null if the workflow has no push trigger. */
function pushBranchPatterns(doc) {
  const on = doc.on ?? doc[true];
  if (on === undefined || on === null) return null;
  let push;
  if (typeof on === 'string') push = on === 'push' ? {} : null;
  else if (Array.isArray(on)) push = on.includes('push') ? {} : null;
  else push = 'push' in on ? (on.push ?? {}) : null;
  if (push === null) return null;
  if (Array.isArray(push.branches)) return push.branches;
  if (Array.isArray(push['branches-ignore']))
    return ['(every branch except ' + push['branches-ignore'].join(', ') + ')'];
  // `tags` or `paths` alone: with no `branches` key a push to ANY branch still triggers, unless the
  // trigger names only tags.
  if (Array.isArray(push.tags) && !push.paths && !push['paths-ignore']) return [];
  return ['(every branch)'];
}

/** The secrets a job references, by name. */
function secretsOfJob(job) {
  const text = JSON.stringify(job);
  return [...new Set([...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
}

/** One line per job that uses a protected secret in a workflow a branch push can trigger. */
function exposures(name, doc) {
  const branches = pushBranchPatterns(doc);
  if (!branches) return [];
  const beyondMain = branches.filter((b) => b !== 'main');
  if (beyondMain.length === 0) return [];
  const found = [];
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    const protectedSecrets = secretsOfJob(job).filter((s) => !SAFE_ON_ANY_BRANCH_PUSH.has(s));
    if (protectedSecrets.length > 0) {
      found.push(
        `${name}: job "${jobName}" uses ${protectedSecrets.join(', ')} and a push to ${beyondMain.join(', ')} triggers it`
      );
    }
  }
  return found;
}

const wf = (on, jobs) => ({ on, jobs });
const SECRET_JOB = {
  'runs-on': 'ubuntu-latest',
  steps: [{ run: 'echo ${{ secrets.CF_ACCESS_CLIENT_SECRET }}' }],
};
const HUB_READ_JOB = {
  'runs-on': 'ubuntu-latest',
  steps: [{ uses: 'actions/checkout@v4', with: { token: '${{ secrets.OCR_HUB_READ }}' } }],
};

describe('the rule itself: each fault turns it red, each safe shape stays green', () => {
  test('a secret job on a push to claude/** is flagged (the original finding)', () => {
    expect(
      exposures('x.yml', wf({ push: { branches: ['main', 'claude/**'] } }, { j: SECRET_JOB }))
    ).toHaveLength(1);
  });
  test('a push with no branch filter means every branch, and is flagged', () => {
    expect(exposures('x.yml', wf({ push: {} }, { j: SECRET_JOB }))).toHaveLength(1);
    expect(exposures('x.yml', wf({ push: null }, { j: SECRET_JOB }))).toHaveLength(1);
  });
  test('the string and list forms of `on` are understood', () => {
    expect(exposures('x.yml', wf('push', { j: SECRET_JOB }))).toHaveLength(1);
    expect(exposures('x.yml', wf(['push', 'pull_request'], { j: SECRET_JOB }))).toHaveLength(1);
  });
  test('branches-ignore is a push to every other branch, and is flagged', () => {
    expect(
      exposures('x.yml', wf({ push: { 'branches-ignore': ['docs/**'] } }, { j: SECRET_JOB }))
    ).toHaveLength(1);
  });
  test('a `paths` filter alone does not limit which branches trigger it', () => {
    expect(exposures('x.yml', wf({ push: { paths: ['src/**'] } }, { j: SECRET_JOB }))).toHaveLength(
      1
    );
  });
  test('main only is safe, with or without a paths filter or tags', () => {
    expect(exposures('x.yml', wf({ push: { branches: ['main'] } }, { j: SECRET_JOB }))).toEqual([]);
    expect(
      exposures(
        'x.yml',
        wf({ push: { branches: ['main'], paths: ['src/**'], tags: ['v*.*.*'] } }, { j: SECRET_JOB })
      )
    ).toEqual([]);
  });
  test('a tags-only push, a pull_request, a schedule or a manual run is out of scope', () => {
    expect(exposures('x.yml', wf({ push: { tags: ['v*.*.*'] } }, { j: SECRET_JOB }))).toEqual([]);
    expect(exposures('x.yml', wf({ pull_request: {} }, { j: SECRET_JOB }))).toEqual([]);
    expect(
      exposures(
        'x.yml',
        wf({ schedule: [{ cron: '0 3 * * *' }], workflow_dispatch: {} }, { j: SECRET_JOB })
      )
    ).toEqual([]);
  });
  test('the read-only hub token and GITHUB_TOKEN are allowed on any branch push', () => {
    expect(exposures('x.yml', wf({ push: { branches: ['**'] } }, { j: HUB_READ_JOB }))).toEqual([]);
    expect(
      exposures(
        'x.yml',
        wf({ push: {} }, { j: { steps: [{ run: 'echo ${{ secrets.GITHUB_TOKEN }}' }] } })
      )
    ).toEqual([]);
  });
  test('a brand-new secret is protected by default', () => {
    const job = { steps: [{ run: 'echo ${{ secrets.SOMETHING_NEW }}' }] };
    expect(exposures('x.yml', wf({ push: { branches: ['claude/**'] } }, { j: job }))).toHaveLength(
      1
    );
  });
  test('only the offending job is named when a workflow mixes jobs', () => {
    const out = exposures(
      'x.yml',
      wf({ push: { branches: ['main', 'feature/**'] } }, { ok: HUB_READ_JOB, bad: SECRET_JOB })
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('job "bad"');
  });
});

describe('the real workflows', () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));

  test('there are workflows to check (a green run is not an empty run)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test('no job that uses a protected secret can be triggered by a push to a branch other than main', () => {
    const found = files.flatMap((f) =>
      exposures(f, yaml.load(readFileSync(join(WORKFLOWS, f), 'utf8')) ?? {})
    );
    expect(
      found,
      'On a push the workflow file comes from the pushed branch, so a writer can read these secrets.\n' +
        'Limit the push trigger to main, or run the job from a pull request, schedule or manual trigger.\n' +
        found.map((l) => '  - ' + l).join('\n')
    ).toEqual([]);
  });

  test('security-regression.yml pushes only from main', () => {
    const doc = yaml.load(readFileSync(join(WORKFLOWS, 'security-regression.yml'), 'utf8'));
    expect(pushBranchPatterns(doc)).toEqual(['main']);
  });
});
