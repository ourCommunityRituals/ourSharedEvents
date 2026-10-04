/**
 * OSE-1255 — unit tests for the gate-execution reconciler's pure logic.
 *
 * Lifts the born-red cases (also the script's `--self-test`) into the T0 `tests`
 * shard so a regression in the trigger-aware expected-set or the legit-skip rule
 * is caught by CI, not only by the gate's own step. The module exports pure
 * functions and is import-safe (its CLI entrypoint is isMain-guarded).
 */

let expectedGates;
let findViolations;

beforeAll(async () => {
  ({ expectedGates, findViolations } = await import('../../../scripts/assert-gate-execution.mjs'));
});

const ALL_RAN = {
  security: 'success',
  gate: 'success',
  'local-vetting': 'success',
  'deploy-staging': 'success',
  'contract-staging': 'success',
  'smoke-staging': 'success',
  'functional-staging': 'success',
};

describe('OSE-1255 — expectedGates (trigger-aware)', () => {
  test('a ci/* PR expects S0 + T0 + local vetting (staging tiers legitimately skip)', () => {
    const e = expectedGates({ eventName: 'pull_request', headRef: 'ci/some-fix' });
    expect([...e].sort()).toEqual(['gate', 'local-vetting', 'security']);
  });

  test('a push to main expects the full staging chain incl functional', () => {
    const e = expectedGates({ eventName: 'push', ref: 'refs/heads/main' });
    expect(e.has('deploy-staging')).toBe(true);
    expect(e.has('contract-staging')).toBe(true);
    expect(e.has('smoke-staging')).toBe(true);
    expect(e.has('functional-staging')).toBe(true);
  });

  test('production tiers are never expected (tag/dispatch only)', () => {
    const e = expectedGates({ eventName: 'push', ref: 'refs/heads/main' });
    expect(e.has('deploy-production')).toBe(false);
    expect(e.has('smoke-production')).toBe(false);
  });

  test('a full-pipeline/* PR expects the staging chain', () => {
    const e = expectedGates({ eventName: 'pull_request', headRef: 'full-pipeline/x' });
    expect(e.has('functional-staging')).toBe(true);
  });

  test('dispatch deploy-only does NOT expect functional (needs run_functional)', () => {
    const e = expectedGates({ eventName: 'workflow_dispatch', inputs: { deploy_staging: 'true' } });
    expect(e.has('deploy-staging')).toBe(true);
    expect(e.has('functional-staging')).toBe(false);
  });
});

describe('OSE-1255 — findViolations (legit-skip rule)', () => {
  const V = (ctx, results) => findViolations(expectedGates(ctx), results).violation;
  const MAIN = { eventName: 'push', ref: 'refs/heads/main' };

  test('everything ran on main → no violation', () => {
    expect(V(MAIN, ALL_RAN)).toBe(false);
  });

  test('T4 executed-but-FAILED → no violation (executed; outcome is T4’s own red)', () => {
    expect(V(MAIN, { ...ALL_RAN, 'functional-staging': 'failure' })).toBe(false);
  });

  test('T4 SILENTLY skipped with nothing upstream failed → VIOLATION (the hole)', () => {
    expect(V(MAIN, { ...ALL_RAN, 'functional-staging': 'skipped' })).toBe(true);
  });

  test('deploy FAILED so T2–T4 skipped → no violation (honest cascade)', () => {
    expect(
      V(MAIN, {
        security: 'success',
        gate: 'success',
        'deploy-staging': 'failure',
        'contract-staging': 'skipped',
        'smoke-staging': 'skipped',
        'functional-staging': 'skipped',
      })
    ).toBe(false);
  });

  test('T4 cancelled with nothing failed → VIOLATION', () => {
    expect(V(MAIN, { ...ALL_RAN, 'functional-staging': 'cancelled' })).toBe(true);
  });

  test('T4 absent from results → VIOLATION', () => {
    const partial = { ...ALL_RAN };
    delete partial['functional-staging'];
    expect(V(MAIN, partial)).toBe(true);
  });

  test('PR with local vetting silently skipped, nothing upstream failed → VIOLATION', () => {
    expect(
      V(
        { eventName: 'pull_request', headRef: 'ci/x' },
        { security: 'success', gate: 'success', 'local-vetting': 'skipped' }
      )
    ).toBe(true);
  });

  test('push to main does not expect local vetting (PR-only gate)', () => {
    expect(expectedGates({ eventName: 'push', ref: 'refs/heads/main' }).has('local-vetting')).toBe(
      false
    );
  });

  test('PR with staging tiers skipped → no violation (not expected)', () => {
    expect(
      V(
        { eventName: 'pull_request', headRef: 'ci/x' },
        {
          security: 'success',
          gate: 'success',
          'local-vetting': 'success',
          'deploy-staging': 'skipped',
          'functional-staging': 'skipped',
        }
      )
    ).toBe(false);
  });

  test('S0 skipped on a PR → VIOLATION (S0 always expected)', () => {
    expect(
      V({ eventName: 'pull_request', headRef: 'ci/x' }, { security: 'skipped', gate: 'success' })
    ).toBe(true);
  });
});
