/**
 * Migration parity before a production deploy: the gate that already exists,
 * held in place.
 *
 * `deploy-production` applies the migrations and then runs
 * "Gate: zero unapplied D1 migrations before deploy (OSE-803)". If either
 * production database still has a migration to apply, or wrangler could not
 * answer, the job stops before the Worker is deployed.
 *
 * tests/integration/infra-consistency.test.js checks that the step exists and
 * mentions the right things. It does not check that the step can fail, or that
 * it sits before the deploy. This file does both:
 *
 *   1. It runs the step's own script, taken from the workflow, with a stand-in
 *      for wrangler that answers from text. A stale database must stop it.
 *   2. It checks the step's place and that nothing can skip it or swallow its
 *      failure, with every loosening planted first.
 *
 * Nothing reaches Cloudflare: the stand-in replaces `npx` inside the script.
 */

const { spawnSync } = require('child_process');
const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WORKER = join(ROOT, 'workers', 'oursharedevents');
const JOB = 'deploy-production';
const GATE = 'Gate: zero unapplied D1 migrations before deploy (OSE-803)';
const APPLY_MAIN = 'Apply D1 migrations (main DB)';
const APPLY_FORMS = 'Apply D1 migrations (forms DB)';
const DEPLOY = 'Deploy';

const readCi = () =>
  yaml.load(readFileSync(join(ROOT, '.github/workflows/oursharedevents-ci.yml'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const stepNamed = (ci, name) => ci.jobs[JOB].steps.find((s) => s.name === name);

// ── 1. the gate's own script, against a stand-in for wrangler ───────────────

const UP_TO_DATE = '✅ No migrations to apply!';
const STALE_DB = [
  'Migrations to be applied:',
  '│ 0078_events_add_starts_at.sql │',
  '│ 0094_shortlink_click_daily.sql │',
].join('\n');
const STALE_FORMS = 'Migrations to be applied:\n│ 0016_scrub_raw_anonymous_id.sql │';
const AUTH_ERROR = 'Authentication error [code: 10000]';

/**
 * Stands in for `npx` inside the step. It answers only the exact command the
 * gate is meant to send; anything else gets a line that is not "up to date".
 */
const STAND_IN = `
npx() {
  if [ "$1 $2 $3 $4" != "wrangler d1 migrations list" ] || [ "\${6:-} \${7:-} \${8:-}" != "--env production --remote" ]; then
    echo "stand-in: unexpected command: npx $*"
    return 0
  fi
  case "$5" in
    DB) printf '%s\\n' "$FAKE_DB" ;;
    FORMS_DB) printf '%s\\n' "$FAKE_FORMS" ;;
    *) echo "stand-in: unexpected database $5" ;;
  esac
  return "\${FAKE_EXIT:-0}"
}
`;

/** Run a gate script with the stand-in. Returns { code, out }. */
function runGate(script, { db, forms, exit = '0' }) {
  const r = spawnSync('bash', ['-c', `${STAND_IN}\n${script}`], {
    cwd: WORKER,
    encoding: 'utf8',
    env: { ...process.env, FAKE_DB: db, FAKE_FORMS: forms, FAKE_EXIT: exit },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('the production migration gate, run on its own script', () => {
  const script = stepNamed(readCi(), GATE).run;
  const SLOW = 60_000;

  test(
    'both databases up to date: the gate passes',
    () => {
      const r = runGate(script, { db: UP_TO_DATE, forms: UP_TO_DATE });
      expect(r.out).toContain('ok    DB (production): no unapplied migrations');
      expect(r.out).toContain('ok    FORMS_DB (production): no unapplied migrations');
      expect(r.code).toBe(0);
    },
    SLOW
  );

  test(
    'a stale main database stops the deploy, and says which database and which files',
    () => {
      const r = runGate(script, { db: STALE_DB, forms: UP_TO_DATE });
      expect(r.out).toContain('FAIL  DB (production): unapplied migrations remain');
      expect(r.out).toContain('0078_events_add_starts_at.sql');
      expect(r.out).toContain('0094_shortlink_click_daily.sql');
      expect(r.out).toContain('ok    FORMS_DB (production)');
      expect(r.out).toContain('Refusing to deploy a Worker ahead of its database.');
      expect(r.code).not.toBe(0);
    },
    SLOW
  );

  test(
    'a stale forms database stops the deploy',
    () => {
      const r = runGate(script, { db: UP_TO_DATE, forms: STALE_FORMS });
      expect(r.out).toContain('FAIL  FORMS_DB (production)');
      expect(r.out).toContain('0016_scrub_raw_anonymous_id.sql');
      expect(r.code).not.toBe(0);
    },
    SLOW
  );

  test(
    'wrangler cannot answer (bad token): the deploy stops, it does not pass by default',
    () => {
      const r = runGate(script, { db: AUTH_ERROR, forms: AUTH_ERROR, exit: '1' });
      expect(r.out).toContain('FAIL  DB (production)');
      expect(r.out).toContain('FAIL  FORMS_DB (production)');
      expect(r.code).not.toBe(0);
    },
    SLOW
  );

  test(
    'wrangler prints nothing at all: the deploy stops',
    () => {
      expect(runGate(script, { db: '', forms: '' }).code).not.toBe(0);
    },
    SLOW
  );

  test(
    'the gate asks about production, for both databases, on the remote',
    () => {
      // The stand-in only answers the exact command. A gate that asked staging, or
      // dropped --remote, would get "unexpected command" and fail the first test above.
      for (const wrong of [
        script.replace(/--env production/g, '--env staging'),
        script.replace(/ --remote/g, ''),
      ]) {
        expect(wrong).not.toBe(script);
        const r = runGate(wrong, { db: UP_TO_DATE, forms: UP_TO_DATE });
        expect(r.out).toContain('stand-in: unexpected command');
        expect(r.code).not.toBe(0);
      }
    },
    SLOW
  );

  // ── planted faults: each weakened script is shown to let a stale database through ──

  test.each([
    [
      'the forms database is dropped from the loop',
      (s) => s.replace('for BINDING in DB FORMS_DB; do', 'for BINDING in DB; do'),
    ],
    [
      'the final exit is turned into a warning',
      (s) => s.replace(/\n\s*exit 1\n/, '\n  echo "::warning::behind"\n'),
    ],
    ['FAILED is never set', (s) => s.replace('FAILED=1', 'FAILED=0')],
  ])(
    '%s: a stale forms database would get through',
    (_name, weaken) => {
      const weak = weaken(script);
      expect(weak).not.toBe(script);
      expect(runGate(weak, { db: UP_TO_DATE, forms: STALE_FORMS }).code).toBe(0);
      // ...which is what the real script refuses:
      expect(runGate(script, { db: UP_TO_DATE, forms: STALE_FORMS }).code).not.toBe(0);
    },
    SLOW
  );
});

// ── 2. where the gate sits ──────────────────────────────────────────────────

/** Empty when a stale production database cannot be followed by a Worker deploy. */
function gateProblems(ci) {
  const job = ci.jobs[JOB];
  const steps = job.steps || [];
  const at = (name) => steps.findIndex((s) => s.name === name);
  const out = [];
  for (const name of [APPLY_MAIN, APPLY_FORMS, GATE, DEPLOY]) {
    if (at(name) === -1) out.push(`${JOB} has no step "${name}"`);
  }
  if (out.length) return out;
  if (job['continue-on-error'] !== undefined) out.push(`${JOB}: the job has continue-on-error`);
  for (const name of [APPLY_MAIN, APPLY_FORMS, GATE]) {
    const step = steps[at(name)];
    if (step['continue-on-error'] !== undefined) out.push(`"${name}" has continue-on-error`);
    if (step.if !== undefined) out.push(`"${name}" has an \`if:\` and can be skipped`);
  }
  if (!(at(APPLY_MAIN) < at(GATE) && at(APPLY_FORMS) < at(GATE))) {
    out.push('the gate runs before the migrations are applied');
  }
  if (!(at(GATE) < at(DEPLOY))) out.push('the Worker is deployed before the gate runs');
  const deploy = steps[at(DEPLOY)];
  if (/always\(\)|failure\(\)/.test(String(deploy.if ?? ''))) {
    out.push('"Deploy" runs even when an earlier step failed');
  }
  if (steps.filter((s) => /wrangler deploy\b/.test(String(s.run))).length !== 1) {
    out.push('more than one step deploys the Worker');
  }
  const expectRun = (name, run) => {
    if (String(steps[at(name)].run).trim() !== run) out.push(`"${name}" no longer runs: ${run}`);
  };
  expectRun(APPLY_MAIN, 'npx wrangler d1 migrations apply DB --env production --remote');
  expectRun(APPLY_FORMS, 'npx wrangler d1 migrations apply FORMS_DB --env production --remote');
  expectRun(DEPLOY, 'npx wrangler deploy --env production');
  return out;
}

describe('the production migration gate sits before the deploy and cannot be skipped', () => {
  const ci0 = readCi();
  const move = (ci, name, beforeName) => {
    const steps = ci.jobs[JOB].steps;
    const [step] = steps.splice(
      steps.findIndex((s) => s.name === name),
      1
    );
    steps.splice(
      steps.findIndex((s) => s.name === beforeName),
      0,
      step
    );
  };

  test('as the workflow stands, there is no problem', () => {
    expect(gateProblems(ci0)).toEqual([]);
  });

  test('fault: the gate is removed', () => {
    const ci = clone(ci0);
    ci.jobs[JOB].steps = ci.jobs[JOB].steps.filter((s) => s.name !== GATE);
    expect(gateProblems(ci)).toEqual([`${JOB} has no step "${GATE}"`]);
  });

  test('fault: the gate is moved after the deploy', () => {
    const ci = clone(ci0);
    const steps = ci.jobs[JOB].steps;
    steps.push(
      ...steps.splice(
        steps.findIndex((s) => s.name === GATE),
        1
      )
    );
    expect(gateProblems(ci)).toEqual(['the Worker is deployed before the gate runs']);
  });

  test('fault: the gate is moved ahead of the migrations', () => {
    const ci = clone(ci0);
    move(ci, GATE, APPLY_MAIN);
    expect(gateProblems(ci)).toEqual(['the gate runs before the migrations are applied']);
  });

  test.each([GATE, APPLY_MAIN, APPLY_FORMS])('fault: continue-on-error on "%s"', (name) => {
    const ci = clone(ci0);
    stepNamed(ci, name)['continue-on-error'] = true;
    expect(gateProblems(ci)).toEqual([`"${name}" has continue-on-error`]);
  });

  test('fault: an `if:` on the gate', () => {
    const ci = clone(ci0);
    stepNamed(ci, GATE).if = "github.event_name == 'push'";
    expect(gateProblems(ci)).toEqual([`"${GATE}" has an \`if:\` and can be skipped`]);
  });

  test('fault: continue-on-error on the job', () => {
    const ci = clone(ci0);
    ci.jobs[JOB]['continue-on-error'] = true;
    expect(gateProblems(ci)).toEqual([`${JOB}: the job has continue-on-error`]);
  });

  test('fault: the deploy step runs even after a failure', () => {
    const ci = clone(ci0);
    stepNamed(ci, DEPLOY).if = 'always()';
    expect(gateProblems(ci)).toEqual(['"Deploy" runs even when an earlier step failed']);
  });

  test('fault: a second deploy step is added ahead of the gate', () => {
    const ci = clone(ci0);
    ci.jobs[JOB].steps.unshift({
      name: 'Early deploy',
      run: 'npx wrangler deploy --env production',
    });
    expect(gateProblems(ci)).toEqual(['more than one step deploys the Worker']);
  });

  test('fault: the migrations are applied to staging instead', () => {
    const ci = clone(ci0);
    stepNamed(ci, APPLY_MAIN).run = 'npx wrangler d1 migrations apply DB --env staging --remote';
    expect(gateProblems(ci)).toEqual([
      `"${APPLY_MAIN}" no longer runs: npx wrangler d1 migrations apply DB --env production --remote`,
    ]);
  });
});
