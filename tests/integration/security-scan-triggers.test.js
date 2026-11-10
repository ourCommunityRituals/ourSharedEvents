/**
 * security-scan.yml runs each job once per PR (2026-11-09).
 *
 * The workflow used to trigger on `push` to every branch AND `pull_request`
 * to every branch, so every PR's Checks page listed "Security Config Audit"
 * and "Dependency Vulnerability Audit" twice for the same SHA (one push run,
 * one pull_request run). Coverage now comes from:
 *   - pull_request on every branch, no paths filter (S0 security-unconditional:
 *     every PR is scanned whatever it touches);
 *   - push to main only (the merged result is scanned again);
 *   - the weekly schedule and manual dispatch.
 *
 * This spec fails if the push trigger widens again (`'**'`, `'*'`, a missing
 * branch filter, or branches-ignore), or if the pull_request trigger narrows
 * (a branch filter that is not `'**'`, or any paths filter). The detector is
 * proven against synthetic controls first, so it cannot pass vacuously.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WORKFLOW = '.github/workflows/security-scan.yml';

// js-yaml reads a bare `on:` key as boolean true under YAML 1.1.
const triggersOf = (wf) => (wf && (wf.on ?? wf[true])) || {};

/** Problems with a workflow's triggers, as readable strings. Empty = good. */
function triggerProblems(wf) {
  const on = triggersOf(wf);
  const problems = [];
  if (typeof on !== 'object' || Array.isArray(on)) {
    return ['`on:` must be a mapping of events'];
  }

  if (!('push' in on)) {
    problems.push('push trigger is missing: main must be scanned after merge');
  } else {
    const push = on.push || {};
    if (push['branches-ignore']) {
      problems.push('push uses branches-ignore (pushes to every other branch)');
    }
    const branches = push.branches;
    if (!Array.isArray(branches) || branches.length === 0) {
      problems.push('push has no branch filter, so it runs on every branch');
    } else if (branches.length !== 1 || branches[0] !== 'main') {
      problems.push(`push branches must be exactly ['main'], got ${JSON.stringify(branches)}`);
    }
    if (push.paths || push['paths-ignore']) problems.push('push must not carry a paths filter');
  }

  if (!('pull_request' in on)) {
    problems.push('pull_request trigger is missing: every PR must be scanned');
  } else {
    const pr = on.pull_request || {};
    if (pr['branches-ignore']) problems.push('pull_request uses branches-ignore');
    if (pr.branches !== undefined && !(Array.isArray(pr.branches) && pr.branches.includes('**'))) {
      problems.push(
        `pull_request must cover every base branch, got ${JSON.stringify(pr.branches)}`
      );
    }
    if (pr.paths || pr['paths-ignore']) {
      problems.push('pull_request must not carry a paths filter (security-unconditional)');
    }
  }

  if (!('schedule' in on)) problems.push('weekly schedule is missing');
  if (!('workflow_dispatch' in on)) problems.push('workflow_dispatch is missing');
  return problems;
}

const good = () => ({
  on: {
    push: { branches: ['main'] },
    pull_request: { branches: ['**'] },
    schedule: [{ cron: '0 0 * * 0' }],
    workflow_dispatch: {},
  },
});

describe('security-scan.yml trigger detector (synthetic controls)', () => {
  it('accepts push to main + pull_request to every branch', () => {
    expect(triggerProblems(good())).toEqual([]);
  });

  it('accepts a pull_request trigger with no branch filter (all PRs)', () => {
    const wf = good();
    wf.on.pull_request = null;
    expect(triggerProblems(wf)).toEqual([]);
  });

  it("flags push to '**' (the duplicate-check regression)", () => {
    const wf = good();
    wf.on.push.branches = ['**'];
    expect(triggerProblems(wf).join('\n')).toMatch(/push branches must be exactly/);
  });

  it('flags push with no branch filter', () => {
    const wf = good();
    wf.on.push = null;
    expect(triggerProblems(wf).join('\n')).toMatch(/push has no branch filter/);
  });

  it('flags push with branches-ignore', () => {
    const wf = good();
    wf.on.push = { 'branches-ignore': ['dependabot/**'] };
    expect(triggerProblems(wf).join('\n')).toMatch(/branches-ignore/);
  });

  it('flags a dropped push trigger (main no longer re-scanned)', () => {
    const wf = good();
    delete wf.on.push;
    expect(triggerProblems(wf).join('\n')).toMatch(/push trigger is missing/);
  });

  it('flags a pull_request trigger narrowed to main', () => {
    const wf = good();
    wf.on.pull_request.branches = ['main'];
    expect(triggerProblems(wf).join('\n')).toMatch(/every base branch/);
  });

  it('flags a paths filter on pull_request', () => {
    const wf = good();
    wf.on.pull_request.paths = ['src/**'];
    expect(triggerProblems(wf).join('\n')).toMatch(/security-unconditional/);
  });

  it('flags a dropped schedule', () => {
    const wf = good();
    delete wf.on.schedule;
    expect(triggerProblems(wf).join('\n')).toMatch(/schedule/);
  });

  it('reads a bare `on:` key parsed as boolean true', () => {
    const wf = yaml.load('on:\n  push:\n    branches: ["**"]\n');
    expect(triggerProblems(wf).join('\n')).toMatch(/push branches must be exactly/);
  });
});

describe('security-scan.yml runs each job once per PR', () => {
  it('pushes scan main only; every PR is scanned with no paths filter', () => {
    const wf = yaml.load(readFileSync(join(ROOT, WORKFLOW), 'utf-8'));
    expect(triggerProblems(wf)).toEqual([]);
  });
});
