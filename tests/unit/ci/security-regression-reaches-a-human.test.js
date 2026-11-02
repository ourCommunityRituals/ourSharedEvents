/**
 * A nightly security regression red reaches a human.
 *
 * security-regression.yml runs every night against staging. It used to carry a job-level
 * `continue-on-error` on schedule, so a red night showed green and nobody was told. That line is
 * gone, and security-triage.yml now watches the workflow by name, so a failed run files (or
 * comments on) a tracked issue with the repository's own GITHUB_TOKEN.
 *
 * Each test below guards one way that chain could quietly break again: the red is swallowed in
 * the regression workflow, the nightly run stops, the watch list stops matching the name, or the
 * triage workflow stops firing on a failure or starts needing a secret it does not have.
 *
 * Both workflows are parsed as objects. The workflow name is read from the file, never typed
 * here, so renaming one side without the other turns this red.
 */
const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const REGRESSION_FILE = join(WORKFLOWS, 'security-regression.yml');
const TRIAGE_FILE = join(WORKFLOWS, 'security-triage.yml');

// js-yaml follows YAML 1.2, so the `on:` key loads as the string "on", not boolean true.
const triggers = (doc) => doc.on ?? doc[true] ?? {};

const regressionText = readFileSync(REGRESSION_FILE, 'utf8');
const triageText = readFileSync(TRIAGE_FILE, 'utf8');
const regression = yaml.load(regressionText);
const triage = yaml.load(triageText);

describe('security-regression.yml reports a red as a red', () => {
  test('no job and no step carries continue-on-error', () => {
    const found = [];
    for (const [jobId, job] of Object.entries(regression.jobs ?? {})) {
      if (job && Object.prototype.hasOwnProperty.call(job, 'continue-on-error')) {
        found.push(`job "${jobId}"`);
      }
      (job?.steps ?? []).forEach((step, i) => {
        if (step && Object.prototype.hasOwnProperty.call(step, 'continue-on-error')) {
          found.push(`job "${jobId}" step "${step.name ?? i}"`);
        }
      });
    }
    expect(
      found,
      'continue-on-error makes a failed security check show green, so a nightly red reaches nobody.\n' +
        found.map((l) => '  - ' + l).join('\n')
    ).toEqual([]);
  });

  test('it still runs on a schedule', () => {
    expect(
      Object.keys(triggers(regression)),
      'Without the schedule trigger the nightly check stops running and there is nothing to report.'
    ).toContain('schedule');
  });

  test('the schedule is a non-empty list of cron entries', () => {
    const schedule = triggers(regression).schedule;
    expect(
      Array.isArray(schedule) && schedule.length > 0,
      'An empty schedule keeps the trigger key but never runs the check.'
    ).toBe(true);
  });

  test('it has no top-level run-name', () => {
    expect(
      Object.prototype.hasOwnProperty.call(regression, 'run-name'),
      'A run-name replaces the title each run shows in the Actions list. Keep the plain workflow\n' +
        'name there, so a red night reads as this check and matches the issue triage files.'
    ).toBe(false);
  });

  test('the "Run security regression checks" step does not swallow its exit code', () => {
    const step = Object.values(regression.jobs ?? {})
      .flatMap((job) => job?.steps ?? [])
      .find((s) => s?.name === 'Run security regression checks');
    expect(step, 'The step that runs the security checks is missing.').toBeDefined();
    expect(
      step.run,
      'A trailing "|| true" turns every failed check into a pass, so the night shows green.'
    ).not.toContain('|| true');
  });
});

describe('security-triage.yml files an issue when the nightly run fails', () => {
  const workflowRun = triggers(triage).workflow_run ?? {};

  test('the watch list names the regression workflow by its real name', () => {
    expect(
      workflowRun.workflows ?? [],
      'workflow_run matches on the name: line of the watched workflow. If the two differ, a\n' +
        'failed nightly run never wakes triage and nobody hears about it.'
    ).toContain(regression.name);
  });

  test('it fires only on completed runs', () => {
    expect(
      workflowRun.types,
      'Triage reads the run conclusion, which only exists once a run has completed. Other types\n' +
        'would start triage on runs that have no result yet.'
    ).toEqual(['completed']);
  });

  test('the watch has no branch filter', () => {
    expect(
      Object.keys(workflowRun),
      'A branch filter would drop failures on the branches it leaves out; the nightly runs on the\n' +
        'default branch and its failures must always reach triage.'
    ).not.toContain('branches');
    expect(Object.keys(workflowRun)).not.toContain('branches-ignore');
  });

  test('the triage job still gates on a failed conclusion', () => {
    expect(
      String(triage.jobs?.triage?.if ?? ''),
      'Triage exists to report failures. Without this condition it reports nothing useful.'
    ).toContain("conclusion == 'failure'");
  });

  test('the triage job runs on exactly a failed conclusion, from any event', () => {
    expect(
      triage.jobs?.triage?.if,
      'This is the exact condition. An event filter here could drop the scheduled nightly failures\n' +
        'this chain exists for, and any other change alters triage for every workflow it watches,\n' +
        'so it is a decision of its own, not a side effect of this one.'
    ).toBe("github.event.workflow_run.conclusion == 'failure'");
  });

  test('it may write issues', () => {
    expect(
      triage.permissions?.issues,
      'Without issues: write the GITHUB_TOKEN cannot file or comment on the tracked issue.'
    ).toBe('write');
  });

  test('it uses no secret other than GITHUB_TOKEN', () => {
    const names = [...triageText.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
    const others = [...new Set(names.filter((n) => n !== 'GITHUB_TOKEN'))];
    expect(
      others,
      'Triage runs on every watched failure. A secret it depends on may be missing or rotated, and\n' +
        'then the report never arrives; the built-in GITHUB_TOKEN is always there.'
    ).toEqual([]);
  });
});
