/**
 * ADR-008 Phase 0 wiring meta-gate (OSE-1399, CCR OSE-1393 D3).
 *
 * The Phase 0 controls are CI wiring, and wiring can be deleted without any
 * other gate going red. This asserts the properties, deriving the subject list
 * from .github/workflows/* (property-asserting, per
 * tests/e2e/0-architecture/README.md) rather than naming jobs:
 *
 *   1. Every job that installs, tests, builds or deploys the Worker stages the
 *      pinned hub (@ocr/ui) BEFORE its first Worker build step, and that
 *      staging step is not continue-on-error (npm ci succeeds on a dangling
 *      file: link, so a skipped stage surfaces later as a confusing import).
 *   2. The blocking design check (@ocr/ui check-spoke-styles) exists, runs from
 *      the staged hub, and is not continue-on-error.
 *   3. .ocr-hub-ref is one full 40-hex SHA.
 *   4. The staging script refuses pins that are not on hub main (OSE-1394).
 *
 * Each detector is proven against synthetic negative controls first, so the
 * gate cannot pass vacuously.
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');

const BUILD =
  /\bnpm (ci|install|test|run test)|\bvitest\b|wrangler (deploy|dev)\b|test:mutation|stryker/;
const STAGE = /ci-stage-ocr-workspace\.sh/;

function workingDir(job, step) {
  return String(step['working-directory'] || job.defaults?.run?.['working-directory'] || '');
}

function isWorkerBuildStep(job, step) {
  const run = String(step.run || '');
  const wd = workingDir(job, step);
  const inWorker =
    /WORKER_DIR|workers\/oursharedevents|matrix\.workdir/.test(wd) ||
    run.includes('cd workers/oursharedevents');
  return inWorker && BUILD.test(run);
}

/** Violations of property 1 for one parsed workflow. */
function stagingViolations(workflow, file) {
  const out = [];
  let workerJobs = 0;
  for (const [name, job] of Object.entries(workflow.jobs || {})) {
    const steps = job.steps || [];
    const firstBuild = steps.findIndex((s) => isWorkerBuildStep(job, s));
    if (firstBuild === -1) continue;
    workerJobs++;
    const stage = steps.findIndex((s) => STAGE.test(String(s.run || '')));
    if (stage === -1 || stage > firstBuild) {
      out.push(`${file}:${name} builds the Worker without staging the pinned hub first`);
    } else if (
      steps[stage]['continue-on-error'] !== undefined &&
      steps[stage]['continue-on-error'] !== false
    ) {
      out.push(`${file}:${name} stages the hub with continue-on-error`);
    }
    if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== false) {
      out.push(`${file}:${name} is continue-on-error at job level`);
    }
  }
  return { out, workerJobs };
}

function realWorkflows() {
  return readdirSync(WF_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: f, wf: yaml.load(readFileSync(join(WF_DIR, f), 'utf8')) }));
}

describe('ADR-008 wiring meta-gate (OSE-1399)', () => {
  describe('negative controls — the detectors can fail', () => {
    const build = { 'working-directory': '${{ env.WORKER_DIR }}', run: 'npm ci' };
    const stage = { run: 'bash scripts/ci-stage-ocr-workspace.sh' };

    test('a Worker job with no staging step is flagged', () => {
      const { out } = stagingViolations({ jobs: { j: { steps: [build] } } }, 'x.yml');
      expect(out).toEqual(['x.yml:j builds the Worker without staging the pinned hub first']);
    });

    test('staging after the first build step is flagged', () => {
      const { out } = stagingViolations({ jobs: { j: { steps: [build, stage] } } }, 'x.yml');
      expect(out).toHaveLength(1);
    });

    test('a continue-on-error staging step is flagged', () => {
      const wf = { jobs: { j: { steps: [{ ...stage, 'continue-on-error': true }, build] } } };
      expect(stagingViolations(wf, 'x.yml').out).toEqual([
        'x.yml:j stages the hub with continue-on-error',
      ]);
    });

    test('a job-default working directory counts as the Worker', () => {
      const wf = {
        jobs: {
          j: {
            defaults: { run: { 'working-directory': 'workers/oursharedevents' } },
            steps: [{ run: 'npm ci' }],
          },
        },
      };
      expect(stagingViolations(wf, 'x.yml').out).toHaveLength(1);
    });

    test('a correctly wired job passes', () => {
      expect(stagingViolations({ jobs: { j: { steps: [stage, build] } } }, 'x.yml').out).toEqual(
        []
      );
    });
  });

  test('every Worker-building job stages the pinned hub first, without continue-on-error', () => {
    let total = 0;
    const violations = [];
    for (const { file, wf } of realWorkflows()) {
      const { out, workerJobs } = stagingViolations(wf, file);
      total += workerJobs;
      violations.push(...out);
    }
    expect(violations).toEqual([]);
    // Anti-vacuity: the detector must actually find the Worker jobs (10 on 2026-09-29).
    expect(total).toBeGreaterThanOrEqual(8);
  });

  test('the blocking design check runs from the staged hub and is not continue-on-error', () => {
    const wf = yaml.load(readFileSync(join(WF_DIR, 'oursharedevents-ci.yml'), 'utf8'));
    const hits = [];
    for (const [name, job] of Object.entries(wf.jobs || {})) {
      const steps = job.steps || [];
      steps.forEach((s, i) => {
        if (/check-spoke-styles\.mjs/.test(String(s.run || '')))
          hits.push({ name, job, steps, i, s });
      });
    }
    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const { name, steps, i, s } of hits) {
      expect(String(s.run), name).toMatch(/\.\.\/packages\/ui\/scripts\/check-spoke-styles\.mjs/);
      expect(s['continue-on-error'], `${name} design check`).toBeUndefined();
      const stage = steps.findIndex((x) => STAGE.test(String(x.run || '')));
      expect(stage, `${name} stages the hub before the design check`).toBeGreaterThanOrEqual(0);
      expect(stage).toBeLessThan(i);
    }
  });

  test('.ocr-hub-ref pins one full 40-hex hub SHA', () => {
    expect(readFileSync(join(ROOT, '.ocr-hub-ref'), 'utf8').trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  test('the staging script refuses pins that are not on hub main (OSE-1394)', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'ci-stage-ocr-workspace.sh'), 'utf8');
    expect(script).toMatch(/merge-base --is-ancestor "\$REF"/);
    expect(script).toMatch(/\[\[ "\$REF" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  });
});
