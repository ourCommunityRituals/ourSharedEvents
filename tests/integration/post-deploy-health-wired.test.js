/**
 * The post-deploy health gate: it works against a server, and it is wired in.
 *
 * Two things a unit test of the rules cannot show:
 *
 *   1. The command, run against a fake /health on localhost, reaches the right
 *      answer and exit code for each kind of production it might meet.
 *   2. The production smoke job runs it, before any smoke spec, with nothing
 *      that could skip it or swallow a failure. Every way of loosening the
 *      wiring is planted below, so the detector cannot pass on an empty result.
 *
 * No request leaves this machine.
 */

const { spawn } = require('child_process');
const { createServer } = require('http');
const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const SCRIPT = 'scripts/ci/post-deploy-health.mjs';
const WORKFLOW = '.github/workflows/oursharedevents-ci.yml';
const SHA = 'abc1234';

// ── 1. the command against a fake server ────────────────────────────────────

const GOOD = { ok: true, env: 'production', db: 'ok', version: `prod-${SHA}-20261024` };

/**
 * Serve `answers` in order; the last one repeats. Each is [status, body, headers],
 * or a function of the request that returns one.
 */
function fakeHealth(answers) {
  let served = 0;
  const server = createServer((req, res) => {
    const next = answers[Math.min(served, answers.length - 1)];
    const [status, body, headers = {}] = typeof next === 'function' ? next(req) : next;
    served++;
    res.writeHead(status, {
      'content-type': typeof body === 'string' ? 'text/html' : 'application/json',
      ...headers,
    });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}/health`,
        count: () => served,
        close: () => server.close(),
      })
    );
  });
}

function runGate(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: {
        ...process.env,
        EXPECTED_SHA: SHA,
        EXPECTED_ENV: 'production',
        EXPECTED_PREFIX: 'prod',
        SECONDS_BETWEEN_READINGS: '0.01',
        ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe('the gate, run against a fake /health on localhost', () => {
  let server;
  afterEach(() => server && server.close());

  test('a healthy production on the deployed build: HEALTHY, exit 0, after five readings', async () => {
    server = await fakeHealth([[200, GOOD]]);
    const r = await runGate({ HEALTH_URL: server.url });
    expect(r.out).toContain('HEALTHY: 5 good readings in a row');
    expect(r.code).toBe(0);
    expect(server.count()).toBe(5);
  });

  test('it rides out a brief wobble: two bad readings, then five good', async () => {
    server = await fakeHealth([
      [503, { ok: false }],
      [503, { ok: false }],
      [200, GOOD],
    ]);
    const r = await runGate({ HEALTH_URL: server.url });
    expect(r.out).toContain('reading 2: bad (HTTP 503)');
    expect(r.out).toContain('HEALTHY');
    expect(r.code).toBe(0);
    expect(server.count()).toBe(7);
  });

  test('a production that keeps failing: ROLL BACK, exit 1, after three readings', async () => {
    server = await fakeHealth([[503, { ok: false, db: 'error' }]]);
    const r = await runGate({ HEALTH_URL: server.url });
    expect(r.out).toContain('ROLL BACK: 3 bad readings in a row');
    expect(r.out).toContain('docs/runbooks/ROLLBACK.md');
    expect(r.code).toBe(1);
    expect(server.count()).toBe(3);
  });

  test('healthy, but still the old build: WRONG BUILD, exit 1', async () => {
    server = await fakeHealth([[200, { ...GOOD, version: 'main' }]]);
    const r = await runGate({ HEALTH_URL: server.url });
    expect(r.out).toContain('WRONG BUILD: /health reports version "main"');
    expect(r.out).toContain('Do not roll back');
    expect(r.code).toBe(1);
  });

  test('another environment answering on this address, even with the right version: ROLL BACK, never healthy', async () => {
    server = await fakeHealth([[200, { ...GOOD, env: 'staging' }]]);
    const r = await runGate({ HEALTH_URL: server.url });
    expect(r.out).toContain(
      'ROLL BACK: 3 bad readings in a row (the last one: env is "staging", expected "production")'
    );
    expect(r.out).not.toContain('HEALTHY');
    expect(r.code).toBe(1);
    expect(server.count()).toBe(3);
  });

  test.each([
    ['a sign-in page', [200, '<html>Sign in</html>'], 'the answer was not JSON'],
    ['a bot challenge', [403, '<html>Just a moment...</html>'], 'HTTP 403, not from the Worker'],
  ])(
    '%s answers instead of the Worker: CANNOT SEE, exit 1, and no order to roll back',
    async (_name, answer, why) => {
      server = await fakeHealth([answer]);
      const r = await runGate({ HEALTH_URL: server.url });
      expect(r.out).toContain(`reading 1: blocked (${why})`);
      expect(r.out).toContain('CANNOT SEE: 12 of 12 readings never reached the Worker');
      expect(r.out).toContain('do not roll back on this alone');
      expect(r.out).not.toContain('ROLL BACK');
      expect(r.code).toBe(1);
      expect(server.count()).toBe(12);
    }
  );

  test('a redirect is not followed, even to a page that looks healthy', async () => {
    // /health redirects; the place it points at would answer as a healthy Worker.
    server = await fakeHealth([
      (req) => (req.url === '/health' ? [302, '', { location: '/elsewhere' }] : [200, GOOD]),
    ]);
    const r = await runGate({ HEALTH_URL: server.url });
    expect(r.out).toContain('reading 1: blocked (HTTP 302, not from the Worker)');
    expect(r.out).not.toContain('HEALTHY');
    expect(r.code).toBe(1);
  });

  test('it never settles: ROLL BACK after twelve readings', async () => {
    const flap = Array.from({ length: 12 }, (_, i) => (i % 2 ? [503, { ok: false }] : [200, GOOD]));
    server = await fakeHealth(flap);
    const r = await runGate({ HEALTH_URL: server.url });
    expect(r.out).toContain('ROLL BACK: it did not settle: 12 readings, 6 bad');
    expect(r.code).toBe(1);
    expect(server.count()).toBe(12);
  });

  test('nothing is listening: ROLL BACK, exit 1', async () => {
    server = await fakeHealth([[200, GOOD]]);
    const dead = server.url;
    server.close();
    server = null;
    const r = await runGate({ HEALTH_URL: dead });
    expect(r.out).toContain('bad (no answer');
    expect(r.code).toBe(1);
  });

  test('no address or no commit id: exit 1 without a request', async () => {
    expect((await runGate({ HEALTH_URL: '' })).code).toBe(1);
    server = await fakeHealth([[200, GOOD]]);
    expect((await runGate({ HEALTH_URL: server.url, EXPECTED_SHA: '' })).code).toBe(1);
    expect(server.count()).toBe(0);
  });

  test('the script only reads: one fetch, no method, no body, no credential', () => {
    const src = readFileSync(join(ROOT, SCRIPT), 'utf8');
    expect(src.match(/\bfetch\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/method:|body:|authorization|CF_ACCESS|ADMIN_KEY/i);
    expect(src).not.toMatch(/child_process|wrangler/);
  });
});

// ── 2. the wiring ───────────────────────────────────────────────────────────

const JOB = 'smoke-production';
const NAME = 'Gate: production runs this build and stays healthy';
const RUN = `EXPECTED_SHA="$(git rev-parse --short HEAD)" node ${SCRIPT}`;
const ENV = {
  HEALTH_URL: '${{ env.PROD_BASE_URL }}/health',
  EXPECTED_ENV: 'production',
  EXPECTED_PREFIX: 'prod',
};
const AT = `${JOB} / "${NAME}"`;

const readCi = () => yaml.load(readFileSync(join(ROOT, WORKFLOW), 'utf8'));
const runLines = (step) =>
  String((step && step.run) || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
const runsSpec = (step) => runLines(step).some((l) => /\btests\/\S+\.spec\.[jt]s\b/.test(l));

/** Empty when a stale or unhealthy production fails the smoke job before any spec runs. */
function wiringProblems(ci) {
  const job = ci.jobs[JOB];
  if (!job) return [`there is no ${JOB} job`];
  const steps = job.steps || [];
  const hits = steps.filter((s) => runLines(s).some((l) => l.includes(SCRIPT)));
  if (hits.length === 0) return [`no step in ${JOB} runs ${SCRIPT}`];
  const step = hits[0];
  const out = [];
  if (!runLines(step).includes(RUN) || runLines(step).length !== 1) {
    out.push(
      `${AT}: the gate is not run as the one plain command, so a failure may not fail the step`
    );
  }
  if (JSON.stringify(step.env || {}) !== JSON.stringify(ENV)) {
    out.push(`${AT}: the step's settings are not exactly the production address, env and prefix`);
  }
  if (step['continue-on-error'] !== undefined) out.push(`${AT}: the step has continue-on-error`);
  if (job['continue-on-error'] !== undefined) out.push(`${AT}: the job has continue-on-error`);
  if (step.if !== undefined) out.push(`${AT}: the step has an \`if:\` and can be skipped`);
  if (step['working-directory'] !== undefined) out.push(`${AT}: the step runs from another folder`);
  if (job.if !== undefined) {
    out.push(
      `${AT}: the job has an \`if:\`, so it can run without a deploy or be skipped after one`
    );
  }
  if (![].concat(job.needs || []).includes('deploy-production')) {
    out.push(`${AT}: the job does not wait for deploy-production`);
  }
  const firstSpec = steps.findIndex(runsSpec);
  if (firstSpec !== -1 && steps.indexOf(step) > firstSpec) {
    out.push(`${AT}: a smoke spec runs before the gate, against a build nobody has confirmed`);
  }
  if (ci.env.PROD_BASE_URL !== 'https://' + 'oursharedevents.com') {
    out.push(`${AT}: PROD_BASE_URL is not the production address`);
  }
  return out;
}

describe('the gate is wired into the production smoke job', () => {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const ci0 = readCi();
  const gate = (ci) => ci.jobs[JOB].steps.find((s) => s.name === NAME);

  test('the step is there, plain, and cannot be skipped', () => {
    expect(wiringProblems(ci0)).toEqual([]);
  });

  test('it is exactly this step, just before the first smoke spec', () => {
    expect(gate(ci0)).toEqual({ name: NAME, env: ENV, run: RUN });
    const steps = ci0.jobs[JOB].steps;
    expect(steps.indexOf(gate(ci0))).toBe(steps.findIndex(runsSpec) - 1);
  });

  test('the job has room for the longest watch (12 readings, 10 s apart, 10 s each)', () => {
    expect(ci0.jobs[JOB]['timeout-minutes']).toBeGreaterThanOrEqual(10);
  });

  // ── planted faults ─────────────────────────────────────────────────────

  test('the step is removed', () => {
    const ci = clone(ci0);
    ci.jobs[JOB].steps = ci.jobs[JOB].steps.filter((s) => s.name !== NAME);
    expect(wiringProblems(ci)).toEqual([`no step in ${JOB} runs ${SCRIPT}`]);
  });

  test('the command is commented out of its run block', () => {
    const ci = clone(ci0);
    gate(ci).run = `# ${RUN}\necho skipped`;
    expect(wiringProblems(ci)).toEqual([`no step in ${JOB} runs ${SCRIPT}`]);
  });

  test('a failure is swallowed with `|| true`', () => {
    const ci = clone(ci0);
    gate(ci).run = `${RUN} || true`;
    expect(wiringProblems(ci)).toEqual([
      `${AT}: the gate is not run as the one plain command, so a failure may not fail the step`,
    ]);
  });

  test('a second line is added after it, so the step ends on that line’s result', () => {
    const ci = clone(ci0);
    gate(ci).run = `${RUN}\necho done`;
    expect(wiringProblems(ci)).toEqual([
      `${AT}: the gate is not run as the one plain command, so a failure may not fail the step`,
    ]);
  });

  test('continue-on-error on the step', () => {
    const ci = clone(ci0);
    gate(ci)['continue-on-error'] = true;
    expect(wiringProblems(ci)).toEqual([`${AT}: the step has continue-on-error`]);
  });

  test('continue-on-error on the job', () => {
    const ci = clone(ci0);
    ci.jobs[JOB]['continue-on-error'] = true;
    expect(wiringProblems(ci)).toEqual([`${AT}: the job has continue-on-error`]);
  });

  test('an `if:` on the step', () => {
    const ci = clone(ci0);
    gate(ci).if = "github.event_name == 'push'";
    expect(wiringProblems(ci)).toEqual([`${AT}: the step has an \`if:\` and can be skipped`]);
  });

  test('an `if:` on the job', () => {
    const ci = clone(ci0);
    ci.jobs[JOB].if = 'always()';
    expect(wiringProblems(ci)).toEqual([
      `${AT}: the job has an \`if:\`, so it can run without a deploy or be skipped after one`,
    ]);
  });

  test('the job stops waiting for the deploy', () => {
    const ci = clone(ci0);
    ci.jobs[JOB].needs = ci.jobs[JOB].needs.filter((n) => n !== 'deploy-production');
    expect(wiringProblems(ci)).toEqual([`${AT}: the job does not wait for deploy-production`]);
  });

  test('the step is moved after the smoke specs', () => {
    const ci = clone(ci0);
    const steps = ci.jobs[JOB].steps;
    steps.push(...steps.splice(steps.indexOf(gate(ci)), 1));
    expect(wiringProblems(ci)).toEqual([
      `${AT}: a smoke spec runs before the gate, against a build nobody has confirmed`,
    ]);
  });

  test.each([
    ['the wait between readings is overridden', (env) => (env.SECONDS_BETWEEN_READINGS = '0')],
    ['it is pointed at staging', (env) => (env.HEALTH_URL = '${{ env.STG_BASE_URL }}/health')],
    ['the expected environment is dropped', (env) => delete env.EXPECTED_ENV],
    ['the expected prefix is changed', (env) => (env.EXPECTED_PREFIX = 'stg')],
  ])('%s', (_name, change) => {
    const ci = clone(ci0);
    change(gate(ci).env);
    expect(wiringProblems(ci)).toEqual([
      `${AT}: the step's settings are not exactly the production address, env and prefix`,
    ]);
  });

  test('the step is pointed at the worker folder, where this script does not live', () => {
    const ci = clone(ci0);
    gate(ci)['working-directory'] = '${{ env.WORKER_DIR }}';
    expect(wiringProblems(ci)).toEqual([`${AT}: the step runs from another folder`]);
  });

  test('PROD_BASE_URL is pointed somewhere else', () => {
    const ci = clone(ci0);
    ci.env.PROD_BASE_URL = ci.env.STG_BASE_URL;
    expect(wiringProblems(ci)).toEqual([`${AT}: PROD_BASE_URL is not the production address`]);
  });
});
