/**
 * A job that runs wrangler with a Cloudflare token must run the version the worker
 * lockfile pins (workers/oursharedevents/package-lock.json), not whatever npx
 * fetches that day.
 *
 * Why: the staging contract (T2) and functional (T4) jobs installed the root
 * dependencies only. Root has no wrangler, so `npx wrangler` downloaded the newest
 * release (4.151.1 in run 39194783868) while the deploy job ran the locked 4.145.0,
 * and the unpinned copy ran with CLOUDFLARE_API_TOKEN_OSE in its environment.
 *
 * Seen red: against the workflow before this change, contract-staging-sub and
 * functional-staging-sub fail.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const workflow = yaml.load(
  readFileSync(join(ROOT, '.github', 'workflows', 'oursharedevents-ci.yml'), 'utf8')
);

// Steps that end up running wrangler: a direct call, or a script that spawns it.
const RUNS_WRANGLER = /\bnpx wrangler\b|d1-seed-staging\.mjs|trace-scan-staging\.sh/;

const installsWorkerDeps = (step) =>
  /\bnpm ci\b/.test(step.run ?? '') &&
  String(step['working-directory'] ?? '').includes('WORKER_DIR');

describe('jobs that run wrangler install the worker dependencies first', () => {
  const jobs = Object.entries(workflow.jobs).filter(([, job]) =>
    (job.steps ?? []).some((s) => RUNS_WRANGLER.test(s.run ?? ''))
  );

  test('the workflow has wrangler-running jobs to check', () => {
    const names = jobs.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        'deploy-staging',
        'deploy-production',
        'contract-staging-sub',
        'functional-staging-sub',
      ])
    );
  });

  for (const [name, job] of jobs) {
    test(`${name}: worker npm ci runs before the first wrangler step`, () => {
      const steps = job.steps;
      const firstWrangler = steps.findIndex((s) => RUNS_WRANGLER.test(s.run ?? ''));
      const install = steps.findIndex(installsWorkerDeps);
      expect(install).toBeGreaterThan(-1);
      expect(install).toBeLessThan(firstWrangler);
    });
  }
});
