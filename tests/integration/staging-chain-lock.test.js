/**
 * One staging chain at a time (T1 Deploy → T2 Contract → T3 Smoke → T4 Functional).
 *
 * stg has one worker and one D1. On 2026-11-14 three dispatches went red only at the
 * T4 deploy-freshness preflight because another run's T1 deployed over their build
 * mid-chain (runs 43550717549, 43550998525, 43552994911; the later deploys were
 * 43550998525, 43551219281 and 43553148041). Their T2 and T3 had already passed against
 * a build that was not theirs. A per-job lock cannot fix that: T1 would release it
 * before T2 starts. So the whole run of any event that touches stg joins one
 * workflow-level group, waits its turn in a FIFO queue (`queue: max`) and is never
 * cancelled by the next one.
 *
 * The test evaluates the workflow's own expressions for each trigger, so a new way to
 * deploy stg (a new branch of the T1 `if:`) that skips the lock goes red here.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const ci = yaml.load(
  readFileSync(
    join(__dirname, '..', '..', '.github', 'workflows', 'oursharedevents-ci.yml'),
    'utf8'
  )
);
const LOCK = 'ose-staging-chain';

/**
 * Evaluate a GitHub expression for one trigger. The workflow uses only
 * ==, !=, &&, ||, !, string literals, startsWith() and format(), whose
 * JavaScript readings match GitHub's for these values.
 */
function evaluateBody(body, github) {
  const startsWith = (s, p) => String(s ?? '').startsWith(String(p));
  const format = (f, ...a) => f.replace(/\{(\d+)\}/g, (_, i) => String(a[Number(i)]));
  return new Function('github', 'startsWith', 'format', `return (${body});`)(
    github,
    startsWith,
    format
  );
}

// A value that is one `${{ }}` keeps its type; text with `${{ }}` inside is interpolated;
// a bare `if:` condition is an expression without the braces.
function evaluate(value, github) {
  const text = String(value).trim();
  const whole = text.match(/^\$\{\{([\s\S]*)\}\}$/);
  if (whole && !whole[1].includes('${{')) return evaluateBody(whole[1], github);
  if (!text.includes('${{')) return evaluateBody(text, github);
  return text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, body) => String(evaluateBody(body, github)));
}

function ctx({ event, ref = 'refs/heads/main', headRef = '', pr, inputs = {} }) {
  return {
    event_name: event,
    ref,
    head_ref: headRef,
    event: { pull_request: pr ? { number: pr } : {}, inputs },
  };
}

const TRIGGERS = {
  'push to main': ctx({ event: 'push' }),
  'release tag': ctx({ event: 'push', ref: 'refs/tags/v1.2.3' }),
  'nightly schedule': ctx({ event: 'schedule' }),
  'dispatch deploy_staging on branch A': ctx({
    event: 'workflow_dispatch',
    ref: 'refs/heads/role-state-event-create-status',
    inputs: { deploy_staging: 'true', run_functional: 'false', deploy_production: '' },
  }),
  'dispatch deploy_staging on branch B': ctx({
    event: 'workflow_dispatch',
    ref: 'refs/heads/registration-kept-until-event',
    inputs: { deploy_staging: 'true', run_functional: 'false', deploy_production: '' },
  }),
  'dispatch run_functional only': ctx({
    event: 'workflow_dispatch',
    ref: 'refs/heads/some-branch',
    inputs: { deploy_staging: 'false', run_functional: 'true', deploy_production: '' },
  }),
  'dispatch production': ctx({
    event: 'workflow_dispatch',
    inputs: { deploy_staging: 'false', run_functional: 'false', deploy_production: 'PRODUCTION' },
  }),
  'full-pipeline PR': ctx({
    event: 'pull_request',
    ref: 'refs/pull/7/merge',
    headRef: 'full-pipeline/try',
    pr: 7,
  }),
  'plain dispatch': ctx({
    event: 'workflow_dispatch',
    ref: 'refs/heads/some-branch',
    inputs: { deploy_staging: 'false', run_functional: 'false', deploy_production: '' },
  }),
  'PR 11': ctx({ event: 'pull_request', ref: 'refs/pull/11/merge', headRef: 'feature-x', pr: 11 }),
  'PR 12': ctx({ event: 'pull_request', ref: 'refs/pull/12/merge', headRef: 'feature-y', pr: 12 }),
};

// A trigger touches stg when T1 deploys it, or when T2–T4 read it without a deploy
// (the nightly runs T2/T3 against the standing build; run_functional runs T4).
const touchesStaging = (g) =>
  Boolean(evaluate(ci.jobs['deploy-staging'].if, g)) ||
  g.event_name === 'schedule' ||
  (g.event_name === 'workflow_dispatch' && g.event.inputs.run_functional === 'true');

const conc = ci.concurrency;
const groupFor = (g) => evaluate(conc.group, g);
const cancelFor = (g) => evaluate(String(conc['cancel-in-progress']), g);

describe('one staging chain at a time', () => {
  test('waiting runs queue in order instead of replacing each other', () => {
    // queue: single (the default) keeps one waiting run; a third arrival cancels it.
    expect(conc.queue).toBe('max');
  });

  test.each(Object.keys(TRIGGERS).filter((k) => touchesStaging(TRIGGERS[k])))(
    '%s takes the staging lock and is never cancelled by the next run',
    (name) => {
      const g = TRIGGERS[name];
      expect(groupFor(g)).toBe(LOCK);
      expect(cancelFor(g)).toBe(false);
    }
  );

  test('two branches dispatched to staging wait for each other', () => {
    const a = groupFor(TRIGGERS['dispatch deploy_staging on branch A']);
    const b = groupFor(TRIGGERS['dispatch deploy_staging on branch B']);
    expect(a).toBe(b);
  });

  test.each(Object.keys(TRIGGERS).filter((k) => !touchesStaging(TRIGGERS[k])))(
    '%s stays off the staging lock',
    (name) => {
      expect(groupFor(TRIGGERS[name])).not.toBe(LOCK);
    }
  );

  test('a PR push still supersedes its own stale run, and only its own', () => {
    expect(cancelFor(TRIGGERS['PR 11'])).toBe(true);
    expect(groupFor(TRIGGERS['PR 11'])).not.toBe(groupFor(TRIGGERS['PR 12']));
  });

  test('every trigger that deploys stg is covered by a case above', () => {
    // If the T1 `if:` gains a branch, add a trigger for it here.
    const branches = String(ci.jobs['deploy-staging'].if)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    expect(branches).toHaveLength(5);
  });
});
