/**
 * A pull request cannot become mergeable without S0 and T0 having run (OSE-1212).
 *
 * PR #455 once sat at four green checks with no S0 Security and no T0 Gate: the
 * pipeline workflow produced no run for it, and nothing on the PR said so. The
 * cause was never established (the first theory, an app-token recursion guard,
 * was disproved two hours later by PR #456). What does not depend on the cause:
 * if the S0 and T0 checks are REQUIRED on `main`, a PR on which they never
 * reported waits at "Expected - Waiting for status to be reported" and cannot
 * merge, admins included.
 *
 * This test locks the repo-side half of that chain, so none of it can be loosened
 * without a red check here:
 *
 *   1. the pipeline workflows start on every pull_request to main (no path
 *      filter, no branch or type filter that could leave a PR without a run);
 *   2. the jobs behind the required names have no `if:` that can skip them, so
 *      the names always report once the workflow starts;
 *   3. tools/ci/main-branch-protection.json requires those names and enforces
 *      them on admins;
 *   4. the reconciler reports on every trigger and expects S0 and T0 on a PR.
 *
 * The live half (does GitHub hold what the JSON says) is checked nightly by
 * .github/workflows/branch-protection-drift.yml. The JSON-to-workflow mapping in
 * general is tests/unit/ci/branch-protection-contract.test.js; this file names
 * the S0 and T0 chain that OSE-1212 is about.
 *
 * Every detector is proven below against a planted fault first, so it cannot
 * pass vacuously.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const readYaml = (rel) => yaml.load(readFileSync(join(ROOT, rel), 'utf8'));

/** The names whose absence must block a merge. */
const CORE_REQUIRED = [
  'S0 Security',
  'T0 Gate (lint)',
  'T0 Gate (typecheck)',
  'T0 Gate (tests)',
  'T0 Gate (a11y)',
  'T0 Gate (invariants)',
  'Gate-execution reconciler',
  'Invariant #22 cross-repo isolation gate',
];
const PR_EVENT_TYPES = ['opened', 'synchronize', 'reopened'];

const triggers = (wf) => (wf && (wf.on !== undefined ? wf.on : wf[true])) || {};
const isAlways = (expr) =>
  typeof expr === 'string' && expr.replace(/^\$\{\{|\}\}$/g, '').trim() === 'always()';

/** Problems that could leave a pull request without a pipeline run. */
function triggerProblems(label, wf) {
  const out = [];
  const on = triggers(wf);
  const pr = typeof on === 'object' && !Array.isArray(on) ? on.pull_request : undefined;
  if (
    typeof on === 'string'
      ? on !== 'pull_request'
      : Array.isArray(on)
        ? !on.includes('pull_request')
        : pr === undefined
  ) {
    return [`${label}: no pull_request trigger`];
  }
  const f = pr || {};
  if (f.paths) out.push(`${label}: pull_request has a paths filter`);
  if (f['paths-ignore']) out.push(`${label}: pull_request has a paths-ignore filter`);
  if (f['branches-ignore']) out.push(`${label}: pull_request has a branches-ignore filter`);
  if (f.branches && !f.branches.includes('main')) {
    out.push(`${label}: pull_request does not cover main`);
  }
  if (f.types) {
    for (const t of PR_EVENT_TYPES) {
      if (!f.types.includes(t)) out.push(`${label}: pull_request types omit "${t}"`);
    }
  }
  return out;
}

/** Problems with the jobs that emit the core required names. */
function jobProblems(ci, inv22) {
  const out = [];
  const jobs = (ci && ci.jobs) || {};
  const sec = jobs.security;
  if (!sec) out.push('ci: no `security` job');
  else {
    if (sec.name !== 'S0 Security') out.push('ci: the security job is not named "S0 Security"');
    if (sec.if !== undefined) out.push('ci: the security job has an `if:` and can skip');
    if (sec.needs !== undefined) {
      out.push('ci: the security job waits on another job and can skip with it');
    }
  }
  const gate = jobs.gate;
  if (!gate) out.push('ci: no `gate` job');
  else {
    if (gate.if !== undefined) out.push('ci: the gate job has an `if:` and can skip');
    // [Claude] T0 runs alongside S0, so it waits on nothing and nothing upstream can
    // skip it. (It used to need only `security`; that wait added S0's time to every PR.)
    if (gate.needs !== undefined) {
      out.push('ci: the gate job waits on another job and can skip with it');
    }
    if (gate.name !== 'T0 Gate (${{ matrix.shard }})') {
      out.push('ci: the gate job name is not "T0 Gate (<shard>)"');
    }
    const shards = (gate.strategy && gate.strategy.matrix && gate.strategy.matrix.shard) || [];
    for (const s of ['lint', 'typecheck', 'a11y', 'invariants']) {
      if (!shards.includes(s)) out.push(`ci: the gate matrix lost the "${s}" shard`);
    }
  }
  const gt = jobs['gate-tests'];
  if (!gt) out.push('ci: no `gate-tests` job');
  else {
    if (gt.name !== 'T0 Gate (tests)') out.push('ci: gate-tests is not named "T0 Gate (tests)"');
    if (!isAlways(gt.if)) {
      out.push(
        'ci: gate-tests must run `if: always()` so a skipped section turns it red, not absent'
      );
    }
  }
  const sub = jobs['gate-tests-sub'];
  if (!sub) out.push('ci: no `gate-tests-sub` job');
  else {
    if (sub.if !== undefined) out.push('ci: gate-tests-sub has an `if:` and can skip');
    if (sub.needs !== undefined) {
      out.push('ci: gate-tests-sub waits on another job and can skip with it');
    }
  }
  // [Claude] With S0 and T0 side by side, a red S0 must still stop everything after
  // them: these jobs run PR code on a local worker or touch staging/production.
  for (const id of ['local-vetting', 'deploy-staging', 'deploy-production']) {
    const needs = [].concat((jobs[id] && jobs[id].needs) || []);
    for (const n of ['security', 'gate']) {
      if (jobs[id] && !needs.includes(n)) out.push(`ci: ${id} does not wait for \`${n}\``);
    }
  }
  const rec = jobs['gate-execution-reconciler'];
  if (!rec) out.push('ci: no `gate-execution-reconciler` job');
  else {
    if (rec.name !== 'Gate-execution reconciler') {
      out.push('ci: the reconciler is not named "Gate-execution reconciler"');
    }
    if (!isAlways(rec.if)) out.push('ci: the reconciler must run `if: always()` on every trigger');
    const needs = [].concat(rec.needs || []);
    for (const n of ['security', 'gate']) {
      if (!needs.includes(n)) out.push(`ci: the reconciler does not watch \`${n}\``);
    }
  }
  const inv = inv22 && inv22.jobs && inv22.jobs['inv22-gate'];
  if (!inv) out.push('inv22: no `inv22-gate` job');
  else {
    if (inv.name !== 'Invariant #22 cross-repo isolation gate') {
      out.push('inv22: the job is not named as the required check');
    }
    if (inv.if !== undefined) out.push('inv22: the gate job has an `if:` and can skip');
  }
  return out;
}

/** Problems with the JSON that decides what blocks a merge. */
function protectionProblems(config) {
  const out = [];
  const required = (
    (config && config.required_status_checks && config.required_status_checks.checks) ||
    []
  ).map((c) => c.context);
  for (const name of CORE_REQUIRED) {
    if (!required.includes(name)) {
      out.push(`protection: "${name}" is not required, so a PR could merge without it`);
    }
  }
  if (!config || config.enforce_admins !== true) {
    out.push(
      'protection: enforce_admins is not true, so an admin could merge past a missing check'
    );
  }
  return out;
}

const allProblems = (ci, inv22, config) => [
  ...triggerProblems('ci', ci),
  ...triggerProblems('inv22', inv22),
  ...jobProblems(ci, inv22),
  ...protectionProblems(config),
];

// ── planted faults (the detectors cannot pass vacuously) ───────────────────

describe('OSE-1212 - each break in the chain is caught', () => {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const ci0 = readYaml('.github/workflows/oursharedevents-ci.yml');
  const inv0 = readYaml('.github/workflows/inv22-cross-repo-gate.yml');
  const cfg0 = JSON.parse(
    readFileSync(join(ROOT, 'tools', 'ci', 'main-branch-protection.json'), 'utf8')
  );

  test('control: the real files have no problems (so the cases below are the only red)', () => {
    expect(allProblems(ci0, inv0, cfg0)).toEqual([]);
  });

  test('a paths filter on the pipeline pull_request trigger', () => {
    const ci = clone(ci0);
    triggers(ci).pull_request.paths = ['src/**'];
    expect(allProblems(ci, inv0, cfg0)).toEqual(['ci: pull_request has a paths filter']);
  });

  test('a pull_request type list that leaves out synchronize', () => {
    const inv = clone(inv0);
    triggers(inv).pull_request.types = ['opened', 'reopened'];
    expect(allProblems(ci0, inv, cfg0)).toEqual(['inv22: pull_request types omit "synchronize"']);
  });

  test('the pipeline stops triggering on pull_request', () => {
    const ci = clone(ci0);
    delete triggers(ci).pull_request;
    expect(allProblems(ci, inv0, cfg0)).toEqual(['ci: no pull_request trigger']);
  });

  test('an `if:` on the security job', () => {
    const ci = clone(ci0);
    ci.jobs.security.if = "github.actor != 'x'";
    expect(allProblems(ci, inv0, cfg0)).toEqual(['ci: the security job has an `if:` and can skip']);
  });

  test('the gate job waits on something that can skip', () => {
    const ci = clone(ci0);
    ci.jobs.gate.needs = ['security', 'local-vetting'];
    expect(allProblems(ci, inv0, cfg0)).toEqual([
      'ci: the gate job waits on another job and can skip with it',
    ]);
  });

  test('a T0 test section waits on another job', () => {
    const ci = clone(ci0);
    ci.jobs['gate-tests-sub'].needs = ['security'];
    expect(allProblems(ci, inv0, cfg0)).toEqual([
      'ci: gate-tests-sub waits on another job and can skip with it',
    ]);
  });

  test.each(['local-vetting', 'deploy-staging', 'deploy-production'])(
    '%s stops waiting for S0',
    (id) => {
      const ci = clone(ci0);
      ci.jobs[id].needs = [].concat(ci.jobs[id].needs).filter((n) => n !== 'security');
      expect(allProblems(ci, inv0, cfg0)).toEqual([`ci: ${id} does not wait for \`security\``]);
    }
  );

  test('a gate shard dropped from the matrix', () => {
    const ci = clone(ci0);
    ci.jobs.gate.strategy.matrix.shard = ci.jobs.gate.strategy.matrix.shard.filter(
      (s) => s !== 'invariants'
    );
    expect(allProblems(ci, inv0, cfg0)).toEqual([
      'ci: the gate matrix lost the "invariants" shard',
    ]);
  });

  test('the reconciler stops running `if: always()`', () => {
    const ci = clone(ci0);
    delete ci.jobs['gate-execution-reconciler'].if;
    expect(allProblems(ci, inv0, cfg0)).toEqual([
      'ci: the reconciler must run `if: always()` on every trigger',
    ]);
  });

  test.each(CORE_REQUIRED)('"%s" dropped from the required list', (name) => {
    const cfg = clone(cfg0);
    cfg.required_status_checks.checks = cfg.required_status_checks.checks.filter(
      (c) => c.context !== name
    );
    expect(allProblems(ci0, inv0, cfg)).toEqual([
      `protection: "${name}" is not required, so a PR could merge without it`,
    ]);
  });

  test('enforce_admins switched off', () => {
    const cfg = clone(cfg0);
    cfg.enforce_admins = false;
    expect(allProblems(ci0, inv0, cfg)).toEqual([
      'protection: enforce_admins is not true, so an admin could merge past a missing check',
    ]);
  });
});

// ── the reconciler's own expectation ───────────────────────────────────────

describe('OSE-1212 - the reconciler expects S0 and T0 on a pull request', () => {
  let expectedGates;
  let findViolations;
  beforeAll(async () => {
    ({ expectedGates, findViolations } =
      await import('../../../scripts/assert-gate-execution.mjs'));
  });

  test('a pull_request expects security and gate', () => {
    const exp = expectedGates({ eventName: 'pull_request', headRef: 'feature/x' });
    expect(exp.has('security')).toBe(true);
    expect(exp.has('gate')).toBe(true);
  });

  test('a PR where S0 or T0 never executed is a violation, not a pass', () => {
    const exp = expectedGates({ eventName: 'pull_request', headRef: 'feature/x' });
    expect(findViolations(exp, { gate: 'success', 'local-vetting': 'success' }).violation).toBe(
      true
    );
    expect(findViolations(exp, { security: 'success', 'local-vetting': 'success' }).violation).toBe(
      true
    );
    expect(
      findViolations(exp, { security: 'skipped', gate: 'skipped', 'local-vetting': 'skipped' })
        .violation
    ).toBe(true);
  });
});
