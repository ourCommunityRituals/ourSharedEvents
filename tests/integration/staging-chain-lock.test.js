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
const queueFor = (g) => {
  const q = String(conc.queue ?? 'single');
  return q.includes('${{') ? evaluate(q, g) : q;
};

describe('one staging chain at a time', () => {
  test.each(Object.keys(TRIGGERS).filter((k) => touchesStaging(TRIGGERS[k])))(
    '%s takes the staging lock, queues in order and is never cancelled by the next run',
    (name) => {
      const g = TRIGGERS[name];
      expect(groupFor(g)).toBe(LOCK);
      expect(cancelFor(g)).toBe(false);
      // queue: single (the default) keeps one waiting run; a third arrival cancels it.
      expect(queueFor(g)).toBe('max');
    }
  );

  test.each(Object.keys(TRIGGERS))(
    '%s: GitHub accepts the run (never queue max with cancel)',
    (name) => {
      // GitHub refuses a run whose concurrency resolves to queue: max with
      // cancel-in-progress: true ("workflow file issue"; PR #1234's first run, 43571814615).
      const g = TRIGGERS[name];
      expect(['single', 'max']).toContain(queueFor(g));
      expect(queueFor(g) === 'max' && cancelFor(g) === true).toBe(false);
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

/**
 * OSE-2082: "Stock data (stg)" never runs while T1–T4 run on stg, in either order.
 *
 * On 2026-11-14 the first stock run after a seven-day outage died on one 503 from
 * the admin API while T4 Functional was running on stg (stock run 43533830657; T4
 * 00:25–00:29Z). The stock workflow's run-level group was `stg-writer`, which T4 is
 * not in. The stock run now joins the chain's lock for its whole run.
 *
 * Born red (each fault injected alone, then removed):
 *   L1 the stock group back to `stg-writer`            -> the trigger cases and "T4 and a stock run" fail
 *   L2 the stock group keyed by event (…-${{ github.event_name }}) -> the same cases fail
 *   L3 cancel-in-progress: true on the stock workflow   -> the "never cancelled" and "GitHub accepts" cases fail
 *   L4 queue removed from the stock workflow            -> the "queues in order" case fails
 *   L5 run-level `stg-writer` plus a job asking for the chain's lock -> "one order" fails
 */
describe('the stock run shares the staging chain’s lock (OSE-2082)', () => {
  const WF = join(__dirname, '..', '..', '.github', 'workflows');
  const { readdirSync } = require('node:fs');
  const stock = yaml.load(readFileSync(join(WF, 'stock-data-full.yml'), 'utf8'));
  // Every way a stock run starts. Its jobs run only from main.
  const STOCK_TRIGGERS = {
    'the morning schedule': ctx({ event: 'schedule' }),
    'a dispatch on main': ctx({ event: 'workflow_dispatch' }),
  };
  const sc = stock.concurrency;
  // A value with no `${{ }}` is the literal itself, not an expression.
  const lit = (v, g) => (String(v).includes('${{') ? evaluate(v, g) : v);
  const stockGroup = (g) => lit(sc.group, g);
  const stockCancel = (g) => lit(sc['cancel-in-progress'], g);
  const stockQueue = (g) => {
    const q = String(sc.queue ?? 'single');
    return q.includes('${{') ? evaluate(q, g) : q;
  };

  test('the triggers above are every trigger the stock workflow has', () => {
    expect(Object.keys(stock.on ?? stock[true]).sort()).toEqual(['schedule', 'workflow_dispatch']);
  });

  test.each(Object.keys(STOCK_TRIGGERS))(
    '%s takes the staging lock for the whole run, queues in order and is never cancelled',
    (name) => {
      const g = STOCK_TRIGGERS[name];
      expect(stockGroup(g)).toBe(LOCK);
      expect(stockCancel(g)).toBe(false);
      expect(stockQueue(g)).toBe('max');
    }
  );

  const chainTriggers = Object.keys(TRIGGERS).filter((k) => touchesStaging(TRIGGERS[k]));
  const pairs = chainTriggers.flatMap((c) => Object.keys(STOCK_TRIGGERS).map((s) => [c, s]));

  test.each(pairs)('%s and a stock run from %s wait for each other', (chain, stockTrigger) => {
    expect(groupFor(TRIGGERS[chain])).toBe(stockGroup(STOCK_TRIGGERS[stockTrigger]));
  });

  test('T4 and a stock run cannot hold stg at once: every trigger that runs T4 is in the stock run’s group', () => {
    const t4 = Object.keys(ci.jobs).filter((id) => /^T4\b/.test(String(ci.jobs[id].name)));
    expect(t4.length).toBeGreaterThan(0);
    // A job-level group would replace nothing: the run-level lock is held while any
    // job of the run exists. So it is enough that every trigger that can run a T4
    // job resolves to the stock run's group.
    const runsT4 = (g) =>
      t4.some((id) => {
        const cond = ci.jobs[id].if;
        if (cond === undefined) return true;
        try {
          return Boolean(evaluate(cond, g));
        } catch {
          // a condition over needs.* or always(): treat the job as able to run
          return true;
        }
      });
    const withT4 = Object.keys(TRIGGERS).filter(
      (k) => touchesStaging(TRIGGERS[k]) && runsT4(TRIGGERS[k])
    );
    expect(withT4).toEqual(
      expect.arrayContaining(['push to main', 'dispatch run_functional only'])
    );
    for (const k of withT4) {
      for (const s of Object.values(STOCK_TRIGGERS)) {
        expect(groupFor(TRIGGERS[k]), k).toBe(stockGroup(s));
      }
    }
  });

  test('the two stg locks are always taken in one order: the chain’s for the run, then stg-writer for a job', () => {
    // A run that held stg-writer and had a job waiting for the chain's lock could
    // stand off against a chain run whose T2 pages leg waits for stg-writer.
    const groupText = (c) => (c === undefined ? '' : String(typeof c === 'string' ? c : c.group));
    for (const file of readdirSync(WF).filter((f) => /\.ya?ml$/.test(f))) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repo's own workflow files
      const wf = yaml.load(readFileSync(join(WF, file), 'utf8'));
      const runLevel = groupText(wf.concurrency);
      for (const [id, job] of Object.entries(wf.jobs || {})) {
        const jobLevel = groupText(job.concurrency);
        if (jobLevel.includes(LOCK)) {
          // nobody asks for the chain's lock per job
          throw new Error(`${file} job ${id} takes ${LOCK} per job; it is a run-level lock`);
        }
        if (runLevel.includes('stg-writer')) expect(jobLevel, `${file}/${id}`).not.toContain(LOCK);
      }
    }
    expect(groupText(stock.concurrency)).toBe(LOCK);
  });
});
