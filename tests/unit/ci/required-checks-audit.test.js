/**
 * OSE-1261 — unit test for the phantom required-context detector.
 *
 * Lifts the born-red case (also the script's `--self-test`) into the tests/unit
 * shard so a regression in the app_id:null heuristic is caught by CI, not only
 * by the reconciler's own step. `findPhantomContexts` is pure and import-safe
 * (its CLI entrypoint is isMain-guarded).
 */

let findPhantomContexts;

beforeAll(async () => {
  ({ findPhantomContexts } = await import('../../../scripts/audit-required-checks.mjs'));
});

describe('OSE-1261 — findPhantomContexts', () => {
  test('flags a required context with app_id:null (the real OSE-1260 S2 phantom)', () => {
    // This is the exact `checks[]` payload branch protection returned in OSE-1260.
    const checks = [
      { context: 'S0 Security', app_id: 15368 },
      { context: 'T0 Gate (lint)', app_id: 15368 },
      { context: 'T0 Gate (typecheck)', app_id: 15368 },
      { context: 'T0 Gate (tests)', app_id: 15368 },
      { context: 'T0 Gate (a11y)', app_id: 15368 },
      { context: 'T0 Gate (invariants)', app_id: 15368 },
      { context: 'S2 Post-Execution Security', app_id: null },
      { context: 'Gate-execution reconciler', app_id: 15368 },
    ];
    expect(findPhantomContexts(checks)).toEqual(['S2 Post-Execution Security']);
  });

  test('all-real contexts → no phantoms', () => {
    const checks = [
      { context: 'S0 Security', app_id: 15368 },
      { context: 'T0 Gate (tests)', app_id: 15368 },
    ];
    expect(findPhantomContexts(checks)).toEqual([]);
  });

  test('multiple phantoms are all reported, in order', () => {
    const checks = [
      { context: 'Real', app_id: 15368 },
      { context: 'Ghost A', app_id: null },
      { context: 'Ghost B', app_id: null },
    ];
    expect(findPhantomContexts(checks)).toEqual(['Ghost A', 'Ghost B']);
  });

  test('empty / malformed input → no phantoms (no false positives)', () => {
    expect(findPhantomContexts([])).toEqual([]);
    expect(findPhantomContexts(null)).toEqual([]);
    expect(findPhantomContexts(undefined)).toEqual([]);
  });
});
