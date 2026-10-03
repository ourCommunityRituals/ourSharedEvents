/**
 * A workflow_run job must be able to run (2026-10-03).
 *
 * `github.event.workflow_run.event` is the event of the SOURCE run. When the
 * source workflow is itself triggered by workflow_run, that value is always
 * 'workflow_run', never 'push'. So a job gated on
 * `workflow_run.event == 'push'` whose sources have no push trigger can never
 * run. #743 put that gate on security-finale.yml (source: the T5 workflow) and
 * post-t6-security.yml (source: security-finale), and both skipped on every
 * run until T6 and post-T6 became `needs:` jobs in red-team-adversarial.yml.
 *
 * Property-asserting (tests/e2e/0-architecture/README.md): the subject list is
 * every workflow_run workflow in .github/workflows/. The detector is proven
 * against synthetic controls first, so the gate cannot pass vacuously.
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');

const triggersOf = (wf) => {
  const on = wf && (wf.on ?? wf[true]);
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return on && typeof on === 'object' ? Object.keys(on) : [];
};

// The job's if: demands a push source with no alternative branch (no `||`)
// that could admit another source event.
const requiresPushSource = (ifText) =>
  /github\.event\.workflow_run\.event\s*==\s*'push'/i.test(ifText) && !/\|\|/.test(ifText);

/** Jobs that can never run: [{ file, job, sources }]. */
function deadWorkflowRunJobs(workflows) {
  const dead = [];
  for (const [file, wf] of Object.entries(workflows)) {
    const on = wf && (wf.on ?? wf[true]);
    const wr = on && typeof on === 'object' && !Array.isArray(on) ? on.workflow_run : null;
    if (!wr || !Array.isArray(wr.workflows)) continue;
    const sources = Object.values(workflows).filter((w) => wr.workflows.includes(w && w.name));
    // An unresolvable source name is not this test's subject (fail-open here;
    // the secret guard fails closed on it).
    if (sources.length === 0) continue;
    const anyPushSource = sources.some((s) => triggersOf(s).includes('push'));
    if (anyPushSource) continue;
    for (const [job, def] of Object.entries(wf.jobs || {})) {
      if (requiresPushSource(def && def.if != null ? String(def.if) : '')) {
        dead.push({ file, job, sources: sources.map((s) => s.name) });
      }
    }
  }
  return dead;
}

const PUSH_GATE =
  "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'";

describe('detector controls', () => {
  test('flags a push-gated job whose source is itself workflow_run-triggered', () => {
    const wfs = {
      'a.yml': {
        name: 'A',
        on: { workflow_run: { workflows: ['CI'] } },
        jobs: { x: { if: PUSH_GATE } },
      },
      'b.yml': {
        name: 'B',
        on: { workflow_run: { workflows: ['A'] } },
        jobs: { y: { if: PUSH_GATE } },
      },
      'ci.yml': { name: 'CI', on: { push: { branches: ['main'] } }, jobs: {} },
    };
    expect(deadWorkflowRunJobs(wfs)).toEqual([{ file: 'b.yml', job: 'y', sources: ['A'] }]);
  });

  test('passes a push-gated job whose source has a push trigger', () => {
    const wfs = {
      'a.yml': {
        name: 'A',
        on: { workflow_run: { workflows: ['CI'] } },
        jobs: { x: { if: PUSH_GATE } },
      },
      'ci.yml': { name: 'CI', on: ['push', 'pull_request'], jobs: {} },
    };
    expect(deadWorkflowRunJobs(wfs)).toEqual([]);
  });

  test('passes a gate with an alternative source event', () => {
    const wfs = {
      'b.yml': {
        name: 'B',
        on: { workflow_run: { workflows: ['A'] } },
        jobs: { y: { if: `${PUSH_GATE} || github.event.workflow_run.event == 'schedule'` } },
      },
      'a.yml': { name: 'A', on: { workflow_run: { workflows: ['CI'] } }, jobs: {} },
    };
    expect(deadWorkflowRunJobs(wfs)).toEqual([]);
  });
});

describe('.github/workflows', () => {
  const workflows = {};
  for (const f of readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    workflows[f] = yaml.load(readFileSync(join(WF_DIR, f), 'utf8'));
  }

  test('there is at least one workflow_run workflow to check', () => {
    expect(Object.values(workflows).some((wf) => triggersOf(wf).includes('workflow_run'))).toBe(
      true
    );
  });

  test('no workflow_run job is gated on a push source its source workflows can never be', () => {
    expect(deadWorkflowRunJobs(workflows)).toEqual([]);
  });
});
