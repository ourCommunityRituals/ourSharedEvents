/**
 * The pool triage check runs on every pull request (OSE-1227, one slice).
 *
 * `scripts/triage-vitest-pool.mjs --check` fails when
 * `docs/testing/vitest-pool-triage.json` no longer matches the worker specs.
 * For three weeks nothing ran it: no workflow, no package script. The manifest
 * fell 128 specs behind while the docs said the check guarded it.
 *
 * A check that exists and is never run guards nothing, so this test holds the
 * wiring: a step in the pipeline runs the check, in a job that cannot be skipped
 * on a pull request, and a red check fails that step.
 *
 * Every way of loosening it is planted below first, so the detector cannot pass
 * on an empty result.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WORKFLOW = '.github/workflows/oursharedevents-ci.yml';
const SCRIPT = 'scripts/triage-vitest-pool.mjs';
const CHECK = `node ${SCRIPT} --check`;

const readCi = () => yaml.load(readFileSync(join(ROOT, WORKFLOW), 'utf8'));
// js-yaml 4 keeps `on` as a string key; tolerate a YAML 1.1 parser that turns it into `true`.
const triggers = (wf) => (wf && (wf.on !== undefined ? wf.on : wf[true])) || {};
const runLines = (step) =>
  String((step && step.run) || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

/** Every step that names the script with `--check`, with the job it sits in. */
function checkSteps(ci) {
  const out = [];
  for (const [jobId, job] of Object.entries((ci && ci.jobs) || {})) {
    for (const step of (job && job.steps) || []) {
      if (runLines(step).some((l) => l.includes(SCRIPT) && l.includes('--check'))) {
        out.push({ jobId, job, step });
      }
    }
  }
  return out;
}

/** Jobs in the `needs` chain of `jobId` (itself included) that carry an `if:`. */
function conditionalJobs(ci, jobId, seen = new Set()) {
  if (seen.has(jobId)) return [];
  seen.add(jobId);
  const job = ci.jobs[jobId];
  if (!job) return [`${jobId} (missing)`];
  const out = job.if !== undefined ? [jobId] : [];
  for (const need of [].concat(job.needs || [])) out.push(...conditionalJobs(ci, need, seen));
  return out;
}

/** Why one wired step might not run, or might not fail, on a pull request. */
function stepProblems(ci, { jobId, job, step }) {
  const out = [];
  const at = `${jobId} / "${step.name || '(unnamed step)'}"`;
  if (!runLines(step).includes(CHECK)) {
    out.push(`${at}: the check is not run as the plain command, so a red check may not fail it`);
  }
  if (step['continue-on-error'] !== undefined) out.push(`${at}: the step has continue-on-error`);
  if (job['continue-on-error'] !== undefined) out.push(`${at}: the job has continue-on-error`);
  if (step['working-directory'] !== undefined) {
    out.push(`${at}: the step runs from another folder; the script path is from the repo root`);
  }
  if (step.if !== undefined) {
    const m = /^matrix\.(\w+) == '([^']+)'$/.exec(String(step.if).trim());
    const values = m
      ? (job.strategy && job.strategy.matrix && job.strategy.matrix[m[1]]) || []
      : [];
    if (!m) out.push(`${at}: the step has a condition other than its matrix shard`);
    else if (!values.includes(m[2])) {
      out.push(`${at}: the step waits for ${m[1]} "${m[2]}", which the job matrix does not have`);
    }
  }
  for (const j of conditionalJobs(ci, jobId)) {
    out.push(`${at}: job \`${j}\` has an \`if:\` and can skip on a pull request`);
  }
  return out;
}

/** Empty when the check is wired so that a stale manifest blocks a pull request. */
function wiringProblems(ci) {
  if (triggers(ci).pull_request === undefined) return ['the pipeline has no pull_request trigger'];
  const steps = checkSteps(ci);
  if (steps.length === 0) return [`no step runs \`${CHECK}\``];
  const perStep = steps.map((s) => stepProblems(ci, s));
  return perStep.some((p) => p.length === 0) ? [] : perStep.flat();
}

describe('the pool triage check is wired into the pull request pipeline', () => {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const ci0 = readCi();
  const NAME = 'Lint: pool triage manifest matches the worker specs';
  const AT = `gate / "${NAME}"`;
  const wired = (ci) => checkSteps(ci)[0];

  test('a step runs the check, in a job that runs on pull requests', () => {
    expect(wiringProblems(ci0)).toEqual([]);
  });

  test('it sits in the T0 gate, on the lint shard, beside the other static checks', () => {
    const hit = wired(ci0);
    expect(hit && hit.jobId).toBe('gate');
    expect(hit.step).toEqual({ name: NAME, if: "matrix.shard == 'lint'", run: CHECK });
    const names = ci0.jobs.gate.steps.map((s) => s.name);
    expect(names.indexOf(NAME)).toBe(
      names.indexOf('Lint: test-id registry matches the templates') + 1
    );
  });

  // ── planted faults ───────────────────────────────────────────────────────

  test('the step is removed', () => {
    const ci = clone(ci0);
    ci.jobs.gate.steps = ci.jobs.gate.steps.filter((s) => s.name !== NAME);
    expect(wiringProblems(ci)).toEqual([`no step runs \`${CHECK}\``]);
  });

  test('the step is left in place but commented out of its run block', () => {
    const ci = clone(ci0);
    wired(ci).step.run = `# ${CHECK}\necho skipped`;
    expect(wiringProblems(ci)).toEqual([`no step runs \`${CHECK}\``]);
  });

  test('a failure is swallowed with `|| true`', () => {
    const ci = clone(ci0);
    wired(ci).step.run = `${CHECK} || true`;
    expect(wiringProblems(ci)).toEqual([
      `${AT}: the check is not run as the plain command, so a red check may not fail it`,
    ]);
  });

  test('continue-on-error on the step', () => {
    const ci = clone(ci0);
    wired(ci).step['continue-on-error'] = true;
    expect(wiringProblems(ci)).toEqual([`${AT}: the step has continue-on-error`]);
  });

  test('continue-on-error on the job', () => {
    const ci = clone(ci0);
    ci.jobs.gate['continue-on-error'] = true;
    expect(wiringProblems(ci)).toEqual([`${AT}: the job has continue-on-error`]);
  });

  test('the step is pointed at the worker folder, where this script does not live', () => {
    const ci = clone(ci0);
    wired(ci).step['working-directory'] = '${{ env.WORKER_DIR }}';
    expect(wiringProblems(ci)).toEqual([
      `${AT}: the step runs from another folder; the script path is from the repo root`,
    ]);
  });

  test('the step only runs on a push', () => {
    const ci = clone(ci0);
    wired(ci).step.if = "matrix.shard == 'lint' && github.event_name == 'push'";
    expect(wiringProblems(ci)).toEqual([
      `${AT}: the step has a condition other than its matrix shard`,
    ]);
  });

  test('the step waits for a shard the matrix does not have', () => {
    const ci = clone(ci0);
    ci.jobs.gate.strategy.matrix.shard = ci.jobs.gate.strategy.matrix.shard.filter(
      (s) => s !== 'lint'
    );
    expect(wiringProblems(ci)).toEqual([
      `${AT}: the step waits for shard "lint", which the job matrix does not have`,
    ]);
  });

  test('the job gets an `if:`', () => {
    const ci = clone(ci0);
    ci.jobs.gate.if = "github.event_name != 'pull_request'";
    expect(wiringProblems(ci)).toEqual([
      `${AT}: job \`gate\` has an \`if:\` and can skip on a pull request`,
    ]);
  });

  test('a job it waits on gets an `if:`', () => {
    const ci = clone(ci0);
    ci.jobs.security.if = "github.actor != 'x'";
    expect(wiringProblems(ci)).toEqual([
      `${AT}: job \`security\` has an \`if:\` and can skip on a pull request`,
    ]);
  });

  test('the pipeline stops starting on pull requests', () => {
    const ci = clone(ci0);
    delete triggers(ci).pull_request;
    expect(wiringProblems(ci)).toEqual(['the pipeline has no pull_request trigger']);
  });
});
