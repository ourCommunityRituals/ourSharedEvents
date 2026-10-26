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

let exposures;
let pushBranchPatterns;
beforeAll(async () => {
  ({ exposures, pushBranchPatterns } =
    await import('../../../scripts/ci/branch-push-secret-exposure.mjs'));
});

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

describe('shapes that must NOT be flagged, and the exact report', () => {
  // `'push' in someArray` is true (arrays have a .push method), so a list that does not contain
  // push must be understood as a list, not read as a map with a push key.
  test('a list or a string without push is not a push trigger', () => {
    expect(
      exposures('x.yml', wf(['pull_request', 'workflow_dispatch'], { j: SECRET_JOB }))
    ).toEqual([]);
    expect(exposures('x.yml', wf('pull_request', { j: SECRET_JOB }))).toEqual([]);
    expect(pushBranchPatterns(wf(['pull_request'], {}))).toBeNull();
    expect(pushBranchPatterns(wf('schedule', {}))).toBeNull();
  });

  test('a workflow with no trigger at all, or an empty one, is not flagged and does not throw', () => {
    expect(exposures('x.yml', { jobs: { j: SECRET_JOB } })).toEqual([]);
    expect(exposures('x.yml', wf(null, { j: SECRET_JOB }))).toEqual([]);
    expect(pushBranchPatterns({})).toBeNull();
    expect(pushBranchPatterns({ on: null })).toBeNull();
    // `??` already turns a null doc.on into undefined; a null under the boolean-true key is the one way
    // a null reaches the guard, and `'push' in null` would throw.
    expect(pushBranchPatterns({ [true]: null })).toBeNull();
    expect(exposures('x.yml', { [true]: null, jobs: { j: SECRET_JOB } })).toEqual([]);
  });

  test('a map with other triggers but no push is not flagged', () => {
    expect(pushBranchPatterns(wf({ pull_request: {}, schedule: [] }, {}))).toBeNull();
  });

  test('the boolean-true key some YAML parsers produce for a bare on: is understood', () => {
    const doc = { [true]: { push: { branches: ['claude/**'] } }, jobs: { j: SECRET_JOB } };
    expect(exposures('x.yml', doc)).toHaveLength(1);
    expect(pushBranchPatterns({ [true]: { push: { branches: ['main'] } } })).toEqual(['main']);
  });

  test('the branch patterns are reported as written', () => {
    expect(pushBranchPatterns(wf({ push: { branches: ['main', 'claude/**'] } }, {}))).toEqual([
      'main',
      'claude/**',
    ]);
    expect(pushBranchPatterns(wf('push', {}))).toEqual(['(every branch)']);
    expect(pushBranchPatterns(wf(['push'], {}))).toEqual(['(every branch)']);
    expect(pushBranchPatterns(wf({ push: {} }, {}))).toEqual(['(every branch)']);
    expect(pushBranchPatterns(wf({ push: { paths: ['src/**'] } }, {}))).toEqual(['(every branch)']);
  });

  test('branches-ignore is reported with every ignored pattern', () => {
    expect(
      pushBranchPatterns(wf({ push: { 'branches-ignore': ['docs/**', 'tmp/**'] } }, {}))
    ).toEqual(['(every branch except docs/**, tmp/**)']);
  });

  test('a tags-only push names no branch, but tags with a paths or paths-ignore filter still reach every branch', () => {
    expect(pushBranchPatterns(wf({ push: { tags: ['v*'] } }, {}))).toEqual([]);
    expect(pushBranchPatterns(wf({ push: { tags: ['v*'], paths: ['src/**'] } }, {}))).toEqual([
      '(every branch)',
    ]);
    expect(
      pushBranchPatterns(wf({ push: { tags: ['v*'], 'paths-ignore': ['docs/**'] } }, {}))
    ).toEqual(['(every branch)']);
  });

  test('the report names the file, the job, every secret and every branch, exactly', () => {
    const job = {
      steps: [{ run: 'echo ${{ secrets.ALPHA }} ${{ secrets.BETA }} ${{ secrets.ALPHA }}' }],
    };
    expect(
      exposures(
        'deploy.yml',
        wf({ push: { branches: ['main', 'claude/**', 'feature/**'] } }, { build: job })
      )
    ).toEqual([
      'deploy.yml: job "build" uses ALPHA, BETA and a push to claude/**, feature/** triggers it',
    ]);
    expect(exposures('ci.yml', wf({ push: {} }, { j: SECRET_JOB }))).toEqual([
      'ci.yml: job "j" uses CF_ACCESS_CLIENT_SECRET and a push to (every branch) triggers it',
    ]);
  });

  test('a workflow with no jobs is not flagged and does not throw', () => {
    expect(exposures('x.yml', { on: { push: { branches: ['claude/**'] } } })).toEqual([]);
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
