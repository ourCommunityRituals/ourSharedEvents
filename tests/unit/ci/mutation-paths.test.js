/**
 * Mutation run decision (scripts/ci/mutation-paths.mjs).
 *
 * The mutation workflow starts on every pull request so its two checks,
 * `mutation` and `mutation-ci-scripts`, always report and can be required on
 * `main`. Whether a change needs the run is decided inside each job from one
 * list of paths. Two ways to be wrong, and only one is safe: running when
 * nothing relevant changed costs minutes; not running when a guard or its spec
 * changed lets a hollow test merge behind a green required check. So every
 * unknown here must come out as "run".
 *
 * Four things are held:
 *   1. the decision (a relevant file runs, an unrelated one does not, unknown runs);
 *   2. reading the changed files from git, which refuses a checkout it cannot trust;
 *   3. the list covers every file the two Stryker configs mutate and every file
 *      with a per-file floor, so a new target cannot be added without its path;
 *   4. the workflow's shape: no path filter, no job-level `if`, every step
 *      behind the decision, and only an explicit `false` skips.
 *
 * @born-red method: injected fault, 24 of them, one at a time in the script or the
 *   workflow, each watched failing here and then reverted | date: 2026-11-09 | verified:
 *   - an empty list decided as "no run" -> the five unknown-list cases fail;
 *   - `error` ignored -> "an error reading the changed files" and the command case fail;
 *   - schedule decided as "no run" -> the nightly, dispatch, unknown-event and command cases fail;
 *   - match by startsWith / by endsWith instead of the exact path -> the near-miss cases fail;
 *   - `count-floor.ts`, the workflow, or this rule taken off the list -> its own
 *     case and the coverage cases fail, naming the missing path;
 *   - the two-parent check, the head-sha check or the before-sha check removed
 *     -> the matching "is refused" case fails;
 *   - the command made to print always `true` or always `false` -> the real-repository case fails;
 *   - floors not checked, patterns passed unchecked, line ranges not stripped ->
 *     the matching coverage case fails;
 *   - workflow: `paths:` back on pull_request or on push, a job-level `if:`, a
 *     step without its condition, `== 'true'` in place of `!= 'false'`,
 *     fetch-depth removed, the scope step running something else -> "the real
 *     workflow holds the shape" fails.
 *   Also seen red on a real change, not an injected one: merging the PR that
 *   added attendee-map.ts, mvt.ts and pmtiles.ts as mutate targets, before their
 *   paths were on the list, failed the real coverage case with six findings.
 */

const { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('fs');
const { join, dirname } = require('path');
const { tmpdir } = require('os');
const { execFileSync, spawnSync } = require('child_process');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'mutation-paths.mjs');
const WORKFLOW = '.github/workflows/mutation-testing.yml';
const W = 'workers/oursharedevents/';

let MUTATION_PATHS;
let decideMutationRun;
let readChangedFiles;
let uncoveredMutationInputs;
let workerConfig;
let ciScriptsConfig;
let FLOORS;

beforeAll(async () => {
  ({ MUTATION_PATHS, decideMutationRun, readChangedFiles, uncoveredMutationInputs } =
    await import('../../../scripts/ci/mutation-paths.mjs'));
  workerConfig = (await import('../../../workers/oursharedevents/stryker.conf.mjs')).default;
  ciScriptsConfig = (await import('../../../stryker.ci-scripts.conf.mjs')).default;
  ({ FLOORS } = await import('../../../scripts/ci/mutation-file-floor.mjs'));
});

const pr = (files, extra = {}) => decideMutationRun({ eventName: 'pull_request', files, ...extra });

// ── 1. the decision ────────────────────────────────────────────────────────

describe('a change the mutation run measures runs it', () => {
  test.each([
    ['a guard source', `${W}src/lib/count-floor.ts`],
    ['the admin guard', `${W}src/auth/admin.ts`],
    ['a handler mutated in a marker range', `${W}src/handlers/pages.ts`],
    ['a spec that kills mutants', `${W}tests/count-floor.spec.ts`],
    ['a red-team spec', `${W}tests/red-team/auth-guard-mutation.spec.ts`],
    ['a spec helper', `${W}tests/helpers/list-landing-rows.ts`],
    ['the Worker Stryker config', `${W}stryker.conf.mjs`],
    ['the Worker lockfile', `${W}package-lock.json`],
    ['a CI security rule', 'scripts/ci/branch-push-secret-exposure.mjs'],
    ['the test of a CI security rule', 'tests/unit/ci/no-secret-echo.test.js'],
    ['the per-file floor', 'scripts/ci/mutation-file-floor.mjs'],
    ['the workflow itself', WORKFLOW],
    ['this rule', 'scripts/ci/mutation-paths.mjs'],
  ])('%s', (_label, file) => {
    expect(pr([file]).run).toBe(true);
  });

  test('one measured file among many others is enough, and the reason names it', () => {
    const d = pr(['README.md', 'docs/a.md', `${W}src/lib/pii.ts`, 'bruno/x.bru']);
    expect(d.run).toBe(true);
    expect(d.reason).toContain(`${W}src/lib/pii.ts`);
  });

  test('a push to main decides the same way', () => {
    expect(decideMutationRun({ eventName: 'push', files: [`${W}src/lib/pii.ts`] }).run).toBe(true);
    expect(decideMutationRun({ eventName: 'push', files: ['README.md'] }).run).toBe(false);
  });

  test('a Windows-style path still matches', () => {
    expect(pr(['workers\\oursharedevents\\src\\auth\\admin.ts']).run).toBe(true);
  });
});

describe('a change the mutation run cannot see does not run it', () => {
  test.each([
    ['docs', 'docs/brain/ROLE-STATE.md'],
    ['the project contract', 'AGENTS.md'],
    ['a Worker source that is not mutated', `${W}src/lib/cors.ts`],
    ['a Worker spec that kills no mutant', `${W}tests/qr-roundtrip.spec.ts`],
    ['another workflow', '.github/workflows/codeql.yml'],
    ['a Bruno request', 'bruno/ose-api/01-health/health.bru'],
    ['a root test of something else', 'tests/unit/ci/gate-execution.test.js'],
  ])('%s', (_label, file) => {
    const d = pr([file]);
    expect(d.run).toBe(false);
    expect(d.reason).toMatch(/none of the 1 changed file/);
  });

  test('several unrelated files together', () => {
    expect(pr(['README.md', 'docs/a.md', `${W}src/lib/cors.ts`]).run).toBe(false);
  });

  // The list holds exact paths. A looser match would run more often, which is
  // safe, but these pin that the match is the one the list documents.
  test.each([
    ['the same name without the Worker folder', 'src/lib/count-floor.ts'],
    ['a sibling whose name starts the same', `${W}src/lib/count-floor.ts.bak`],
    ['a file under a listed name', `${W}src/lib/pii.ts/notes.md`],
  ])('near miss: %s', (_label, file) => {
    expect(pr([file]).run).toBe(false);
  });
});

describe('when the changed files are unknown, run (fail closed)', () => {
  test('an empty list means the list could not be read', () => {
    const d = pr([]);
    expect(d.run).toBe(true);
    expect(d.reason).toMatch(/empty/);
  });

  test('blank lines are not files', () => {
    expect(pr(['', '  ', '\n']).run).toBe(true);
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a string, not a list', 'README.md'],
  ])('a list that is %s', (_label, files) => {
    expect(pr(files).run).toBe(true);
  });

  test('an error reading the changed files runs, whatever the list holds', () => {
    const d = pr(['README.md'], { error: new Error('fatal: bad revision HEAD^1') });
    expect(d.run).toBe(true);
    expect(d.reason).toMatch(/could not be read/);
    expect(d.reason).toMatch(/bad revision/);
  });

  test('no arguments at all runs', () => {
    expect(decideMutationRun().run).toBe(true);
  });
});

describe('the nightly and a manual run always run', () => {
  test('the nightly schedule', () => {
    expect(decideMutationRun({ eventName: 'schedule', files: ['README.md'] }).run).toBe(true);
    expect(decideMutationRun({ eventName: 'schedule' }).run).toBe(true);
  });

  test('workflow_dispatch', () => {
    expect(decideMutationRun({ eventName: 'workflow_dispatch', files: ['README.md'] }).run).toBe(
      true
    );
  });

  test('an event this file does not know runs', () => {
    expect(decideMutationRun({ eventName: 'merge_group', files: ['README.md'] }).run).toBe(true);
    expect(decideMutationRun({ files: ['README.md'] }).run).toBe(true);
  });
});

// ── 2. reading the changed files from git ──────────────────────────────────

describe('reading the changed files from git', () => {
  const BASE = 'b'.repeat(40);
  const HEAD = 'a'.repeat(40);
  const MERGE = 'c'.repeat(40);

  /** A git stand-in: answers by the first argument, records every call. */
  function fakeGit(answers) {
    const calls = [];
    const git = (args) => {
      calls.push(args);
      const a = answers[args[0]];
      if (a instanceof Error) throw a;
      if (a === undefined) throw new Error(`unexpected git ${args.join(' ')}`);
      return a;
    };
    git.calls = calls;
    return git;
  }

  test('pull_request: the merge commit against its first parent, renames as both names', () => {
    const git = fakeGit({
      'rev-list': `${MERGE} ${BASE} ${HEAD}\n`,
      diff: `README.md\0${W}src/lib/pii.ts\0`,
    });
    const files = readChangedFiles({ eventName: 'pull_request', prHeadSha: HEAD }, git);
    expect(files).toEqual(['README.md', `${W}src/lib/pii.ts`]);
    expect(git.calls[1]).toEqual(['diff', '--no-renames', '--name-only', '-z', 'HEAD^1', 'HEAD']);
  });

  test('pull_request: a checkout that is not the merge commit is refused', () => {
    // One parent: HEAD^1 would be the commit before, and the diff only the last commit.
    const git = fakeGit({ 'rev-list': `${HEAD} ${BASE}\n`, diff: 'README.md\0' });
    expect(() => readChangedFiles({ eventName: 'pull_request', prHeadSha: HEAD }, git)).toThrow(
      /not a merge commit/
    );
  });

  test('pull_request: a merge commit of some other head is refused', () => {
    const git = fakeGit({
      'rev-list': `${MERGE} ${BASE} ${'d'.repeat(40)}\n`,
      diff: 'README.md\0',
    });
    expect(() => readChangedFiles({ eventName: 'pull_request', prHeadSha: HEAD }, git)).toThrow(
      /does not merge/
    );
  });

  test('pull_request: no head sha from the event is refused', () => {
    const git = fakeGit({ 'rev-list': `${MERGE} ${BASE} ${HEAD}\n`, diff: 'README.md\0' });
    expect(() => readChangedFiles({ eventName: 'pull_request' }, git)).toThrow(/head sha/);
  });

  test('push: the commit before the push against HEAD', () => {
    const git = fakeGit({ diff: 'docs/a.md\0' });
    expect(readChangedFiles({ eventName: 'push', before: BASE }, git)).toEqual(['docs/a.md']);
    expect(git.calls[0]).toEqual(['diff', '--no-renames', '--name-only', '-z', BASE, 'HEAD']);
  });

  test.each([
    ['missing', undefined],
    ['empty', ''],
    ['all zeros (a new branch)', '0'.repeat(40)],
    ['not a sha', 'main; rm -rf .'],
  ])('push: a before sha that is %s is refused', (_label, before) => {
    const git = fakeGit({ diff: 'docs/a.md\0' });
    expect(() => readChangedFiles({ eventName: 'push', before }, git)).toThrow(/before/);
    expect(git.calls).toEqual([]);
  });

  test('a git failure is passed on, not turned into an empty list', () => {
    const git = fakeGit({ diff: new Error('fatal: bad object') });
    expect(() => readChangedFiles({ eventName: 'push', before: BASE }, git)).toThrow(/bad object/);
  });

  test('an event with no changed files to read is refused', () => {
    expect(() => readChangedFiles({ eventName: 'schedule' }, fakeGit({}))).toThrow(/schedule/);
  });
});

// ── the command, end to end ────────────────────────────────────────────────

describe('the command the workflow runs', () => {
  function run(env, cwd = ROOT) {
    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        GITHUB_OUTPUT: '',
        GITHUB_STEP_SUMMARY: '',
        ...env,
      },
    });
    return { status: r.status, out: r.stdout, err: r.stderr };
  }

  test('schedule prints run=true', () => {
    const r = run({ GITHUB_EVENT_NAME: 'schedule' });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^run=true$/m);
  }, 30_000);

  test('a push whose before sha is missing prints run=true and says why', () => {
    const r = run({ GITHUB_EVENT_NAME: 'push', MUTATION_BEFORE_SHA: '' });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^run=true$/m);
    expect(r.out + r.err).toMatch(/could not be read/);
  }, 30_000);

  test('a real repository: an unrelated push prints run=false, a guard change run=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutation-paths-repo-'));
    const outDir = mkdtempSync(join(tmpdir(), 'mutation-paths-out-'));
    const identity = ['user.name=t', 'user.email=t@example.invalid', 'commit.gpgsign=false'];
    const git = (...args) =>
      execFileSync(
        'git',
        [...identity.flatMap((c) => ['-c', c]), '-c', 'core.autocrlf=false', ...args],
        { cwd: dir, encoding: 'utf8' }
      ).trim();
    const commit = (file, text) => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
      git('add', '-A');
      git('commit', '-q', '-m', `change ${file}`);
      return git('rev-parse', 'HEAD');
    };
    try {
      git('init', '-q');
      const first = commit('README.md', 'one');
      const second = commit('docs/a.md', 'two');
      const out = join(outDir, 'out.txt');
      const summary = join(outDir, 'summary.md');
      const env = { GITHUB_EVENT_NAME: 'push', GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary };

      const unrelated = run({ ...env, MUTATION_BEFORE_SHA: first }, dir);
      expect(unrelated.status).toBe(0);
      expect(unrelated.out).toMatch(/^run=false$/m);
      expect(readFileSync(out, 'utf8')).toBe('run=false\n');
      expect(readFileSync(summary, 'utf8')).toMatch(/not needed/);

      commit(`${W}src/lib/count-floor.ts`, 'three');
      writeFileSync(out, '');
      const guard = run({ ...env, MUTATION_BEFORE_SHA: second }, dir);
      expect(guard.out).toMatch(/^run=true$/m);
      expect(readFileSync(out, 'utf8')).toBe('run=true\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
    // Eleven short processes; slow to start on Windows, so not the default 5 s.
  }, 60_000);
});

// ── 3. the list covers what the configs mutate ─────────────────────────────

describe('the list itself', () => {
  test('has no duplicates and only repository-relative forward-slash paths', () => {
    expect(new Set(MUTATION_PATHS).size).toBe(MUTATION_PATHS.length);
    for (const p of MUTATION_PATHS) {
      expect(p, p).toMatch(/^[A-Za-z0-9._@-]+(\/[A-Za-z0-9._@-]+)*$/);
    }
  });

  test('names only files that exist (a mistyped path is a filter that never fires)', () => {
    const missing = MUTATION_PATHS.filter((p) => !existsSync(join(ROOT, p)));
    expect(missing).toEqual([]);
  });
});

describe('every mutated file and every floor is on the list (proven against planted faults)', () => {
  const worker = (mutate) => ({ mutate, vitest: { configFile: 'vitest.node.config.mts' } });
  const ci = (mutate) => ({ mutate, vitest: { configFile: 'vitest.ci-scripts.config.mjs' } });
  const good = () => ({
    workerConfig: worker(['src/lib/pii.ts']),
    ciScriptsConfig: ci(['scripts/ci/secret-echo-exposure.mjs']),
    floors: { 'src/lib/pii.ts': 95 },
  });

  test('control: the real list covers a small config', () => {
    expect(uncoveredMutationInputs(good())).toEqual([]);
  });

  test('a new Worker mutate target with no path is caught', () => {
    const c = good();
    c.workerConfig = worker(['src/lib/pii.ts', 'src/lib/brand-new-guard.ts']);
    const f = uncoveredMutationInputs(c);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/^workers\/oursharedevents\/src\/lib\/brand-new-guard\.ts \(.*mutate/);
  });

  test('a target given as a line range is checked by its file', () => {
    const c = good();
    c.workerConfig = worker(['src/handlers/pages.ts:10-20', 'src/handlers/not-listed.ts:1-5']);
    const f = uncoveredMutationInputs(c);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/^workers\/oursharedevents\/src\/handlers\/not-listed\.ts /);
  });

  test('a new per-file floor with no path is caught', () => {
    const c = good();
    c.floors = { 'src/lib/pii.ts': 95, 'src/lib/floored-only.ts': 100 };
    const f = uncoveredMutationInputs(c);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/^workers\/oursharedevents\/src\/lib\/floored-only\.ts \(.*floor/);
  });

  test('a new CI-script mutate target with no path is caught', () => {
    const c = good();
    c.ciScriptsConfig = ci(['scripts/ci/secret-echo-exposure.mjs', 'scripts/ci/new-rule.mjs']);
    const f = uncoveredMutationInputs(c);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/^scripts\/ci\/new-rule\.mjs \(/);
  });

  test('a glob or a negation is reported, never passed unchecked', () => {
    const c = good();
    c.workerConfig = worker(['src/lib/*.ts', '!src/lib/pii.ts']);
    const f = uncoveredMutationInputs(c);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatch(/pattern/);
    expect(f[1]).toMatch(/pattern/);
  });

  test('a list without the workflow, the configs or this rule is caught', () => {
    const paths = MUTATION_PATHS.filter(
      (p) =>
        p !== WORKFLOW &&
        p !== 'scripts/ci/mutation-paths.mjs' &&
        p !== `${W}stryker.conf.mjs` &&
        p !== 'vitest.ci-scripts.config.mjs'
    );
    const f = uncoveredMutationInputs(good(), paths).map((line) => line.split(' ')[0]);
    expect(f.sort()).toEqual(
      [
        WORKFLOW,
        'scripts/ci/mutation-paths.mjs',
        `${W}stryker.conf.mjs`,
        'vitest.ci-scripts.config.mjs',
      ].sort()
    );
  });

  test('an empty or missing mutate list is reported (a config that could not be read)', () => {
    const c = good();
    c.workerConfig = { vitest: { configFile: 'vitest.node.config.mts' } };
    expect(uncoveredMutationInputs(c).join('\n')).toMatch(/no mutate targets/);
  });

  test('the real configs: stryker.conf.mjs, stryker.ci-scripts.conf.mjs and FLOORS', () => {
    expect(workerConfig.mutate.length).toBeGreaterThan(0);
    expect(ciScriptsConfig.mutate.length).toBeGreaterThan(0);
    expect(Object.keys(FLOORS).length).toBeGreaterThan(0);
    expect(uncoveredMutationInputs({ workerConfig, ciScriptsConfig, floors: FLOORS })).toEqual([]);
  });
});

// ── 4. the workflow's shape ────────────────────────────────────────────────

const JOBS = ['mutation', 'mutation-ci-scripts'];
const RUN_UNLESS_FALSE = "steps.scope.outputs.run != 'false'";

function triggers(wf) {
  // js-yaml 4 keeps `on` as a string key; tolerate a YAML 1.1 parser that turns it into `true`.
  return (wf && (wf.on !== undefined ? wf.on : wf[true])) || {};
}

/** @returns {string[]} one line per problem; empty = the shape holds */
function workflowProblems(wf) {
  const out = [];
  const on = triggers(wf);

  if (!Object.prototype.hasOwnProperty.call(on, 'pull_request')) {
    out.push('no pull_request trigger');
  }
  for (const event of ['pull_request', 'push']) {
    const t = on[event] || {};
    for (const key of ['paths', 'paths-ignore', 'branches-ignore']) {
      if (t[key]) out.push(`${event} has a ${key} filter`);
    }
  }
  const prBranches = (on.pull_request || {}).branches;
  if (prBranches && !prBranches.includes('main')) out.push('pull_request does not cover main');
  if (!((on.push || {}).branches || []).includes('main')) out.push('push does not cover main');
  if (!Array.isArray(on.schedule) || !on.schedule.length) out.push('no nightly schedule');
  if (!Object.prototype.hasOwnProperty.call(on, 'workflow_dispatch')) {
    out.push('no workflow_dispatch');
  }

  for (const key of JOBS) {
    const job = (wf.jobs || {})[key];
    if (!job) {
      out.push(`${key}: job is missing`);
      continue;
    }
    if (job.name !== undefined && job.name !== key) {
      out.push(`${key}: check name changed to "${job.name}"`);
    }
    // A job-level `if` or a `needs` can skip the whole job. The branch-protection
    // contract then counts the check as one that may not report.
    if (job.if !== undefined) out.push(`${key}: has a job-level if`);
    if (job.needs !== undefined) out.push(`${key}: has needs`);

    const steps = job.steps || [];
    const at = steps.findIndex((s) => s.id === 'scope');
    if (at < 0) {
      out.push(`${key}: no step with id scope`);
      continue;
    }
    const scope = steps[at];
    if (scope.if !== undefined) out.push(`${key}: the scope step is conditional`);
    if (scope['continue-on-error']) out.push(`${key}: the scope step may fail quietly`);
    if (!/^node scripts\/ci\/mutation-paths\.mjs$/m.test(String(scope.run || '').trim())) {
      out.push(`${key}: the scope step does not run scripts/ci/mutation-paths.mjs`);
    }
    const before = steps.slice(0, at);
    const checkout = before.find((s) => String(s.uses || '').startsWith('actions/checkout@'));
    if (before.length !== 1 || !checkout) {
      out.push(`${key}: the scope step is not right after the checkout`);
    } else if (Number((checkout.with || {})['fetch-depth']) !== 2) {
      out.push(`${key}: checkout fetch-depth is not 2 (the pull_request diff reads HEAD^1)`);
    }
    const after = steps.slice(at + 1);
    if (!after.length) out.push(`${key}: no step after the scope step`);
    for (const s of after) {
      const label = s.name || s.uses || s.run;
      const cond = String(s.if === undefined ? '' : s.if);
      if (!cond.includes(RUN_UNLESS_FALSE)) {
        out.push(`${key}: step "${label}" is not behind ${RUN_UNLESS_FALSE}`);
      }
      // Only an explicit `false` may skip. `== 'true'` would skip when the output is missing.
      if (/outputs\.run\s*==/.test(cond)) {
        out.push(`${key}: step "${label}" skips on a missing output`);
      }
      if (cond.includes('||')) out.push(`${key}: step "${label}" has an || in its condition`);
    }
  }
  return out;
}

describe('the mutation workflow reports on every pull request', () => {
  const load = () => yaml.load(readFileSync(join(ROOT, WORKFLOW), 'utf8'));

  test('the real workflow holds the shape', () => {
    expect(workflowProblems(load())).toEqual([]);
  });

  test('both jobs have real work behind the decision', () => {
    const wf = load();
    const runs = (key) => wf.jobs[key].steps.map((s) => String(s.run || '')).join('\n');
    expect(runs('mutation')).toMatch(/npm run test:mutation/);
    expect(runs('mutation')).toMatch(/mutation-file-floor\.mjs/);
    expect(runs('mutation-ci-scripts')).toMatch(/stryker\.js run stryker\.ci-scripts\.conf\.mjs/);
  });

  describe('planted faults', () => {
    test('a paths filter on pull_request', () => {
      const wf = load();
      triggers(wf).pull_request = { paths: ['workers/**'] };
      expect(workflowProblems(wf)).toEqual(['pull_request has a paths filter']);
    });

    test('a paths filter on push (a second list)', () => {
      const wf = load();
      triggers(wf).push.paths = ['workers/**'];
      expect(workflowProblems(wf)).toEqual(['push has a paths filter']);
    });

    test('no pull_request trigger', () => {
      const wf = load();
      delete triggers(wf).pull_request;
      expect(workflowProblems(wf)).toEqual(['no pull_request trigger']);
    });

    test('the nightly removed', () => {
      const wf = load();
      delete triggers(wf).schedule;
      expect(workflowProblems(wf)).toEqual(['no nightly schedule']);
    });

    test.each(JOBS)('%s: a job-level if', (key) => {
      const wf = load();
      wf.jobs[key].if = "needs.scope.outputs.run == 'true'";
      expect(workflowProblems(wf)).toEqual([`${key}: has a job-level if`]);
    });

    test.each(JOBS)('%s: renamed', (key) => {
      const wf = load();
      wf.jobs[key].name = 'Mutation';
      expect(workflowProblems(wf)).toEqual([`${key}: check name changed to "Mutation"`]);
    });

    test.each(JOBS)('%s: a step with no condition', (key) => {
      const wf = load();
      const steps = wf.jobs[key].steps;
      delete steps[steps.length - 2].if;
      expect(workflowProblems(wf)).toHaveLength(1);
      expect(workflowProblems(wf)[0]).toMatch(new RegExp(`^${key}: step ".*" is not behind`));
    });

    test.each(JOBS)("%s: a step that runs only on 'true'", (key) => {
      const wf = load();
      const steps = wf.jobs[key].steps;
      steps[steps.length - 2].if = "steps.scope.outputs.run == 'true'";
      const problems = workflowProblems(wf);
      expect(problems.some((p) => p.includes('skips on a missing output'))).toBe(true);
    });

    test.each(JOBS)('%s: the scope step removed', (key) => {
      const wf = load();
      wf.jobs[key].steps = wf.jobs[key].steps.filter((s) => s.id !== 'scope');
      expect(workflowProblems(wf)).toEqual([`${key}: no step with id scope`]);
    });

    test.each(JOBS)('%s: a shallow checkout of one commit', (key) => {
      const wf = load();
      delete wf.jobs[key].steps[0].with['fetch-depth'];
      expect(workflowProblems(wf)).toEqual([
        `${key}: checkout fetch-depth is not 2 (the pull_request diff reads HEAD^1)`,
      ]);
    });

    test.each(JOBS)('%s: the scope step allowed to fail quietly', (key) => {
      const wf = load();
      wf.jobs[key].steps.find((s) => s.id === 'scope')['continue-on-error'] = true;
      expect(workflowProblems(wf)).toEqual([`${key}: the scope step may fail quietly`]);
    });
  });
});
