/**
 * L6 Integration — CI cost collector (COST-302 / OSE-781)
 *
 * Exercises the collector's pure parse/aggregate/merge logic against a fixture
 * shaped like real `gh run view --json jobs` output. The `gh`-driven main() is
 * not invoked here (no network); this proves the transformation from GitHub
 * Actions job data → the committed JSONL time-series is correct and idempotent.
 *
 * Runs under root `npm test` (vitest, tests/integration/**, globals on) → T0
 * Gate. The collector is ESM (.mjs); we load it via dynamic import so this file
 * stays CommonJS-parseable (matching the tests/integration convention).
 */

let mod;
beforeAll(async () => {
  mod = await import('../../scripts/ci-cost-collector.mjs');
});

const RUN = {
  databaseId: 31957882699,
  number: 412,
  event: 'pull_request',
  headBranch: 'ose-781-cost-302-ci-cost-collector',
  headSha: '0d448c3abcdef0123456789',
  workflowName: 'oursharedevents-ci',
};

// Shaped like `gh run view <id> --json jobs`.jobs
const JOBS_FIXTURE = [
  {
    databaseId: 111,
    name: 'S0 Security',
    conclusion: 'success',
    startedAt: '2026-08-16T16:00:00Z',
    completedAt: '2026-08-16T16:02:30Z', // 150s
  },
  {
    databaseId: 222,
    name: 'T0 Gate (tests)',
    conclusion: 'success',
    startedAt: '2026-08-16T16:02:30Z',
    completedAt: '2026-08-16T16:03:31Z', // 61s
  },
  {
    databaseId: 333,
    name: 'T0 Gate (invariants)',
    conclusion: 'failure',
    startedAt: '2026-08-16T16:02:30Z',
    completedAt: '2026-08-16T16:02:40Z', // 10s
  },
  {
    // In-flight job — no completedAt → must be dropped (not yet timeable).
    databaseId: 444,
    name: 'T1 Deploy',
    conclusion: null,
    startedAt: '2026-08-16T16:03:31Z',
    completedAt: null,
  },
];

describe('computeDurationSec', () => {
  it('returns whole seconds for a valid interval', () => {
    expect(mod.computeDurationSec('2026-08-16T16:00:00Z', '2026-08-16T16:02:30Z')).toBe(150);
  });
  it('returns null for missing or non-monotonic timestamps', () => {
    expect(mod.computeDurationSec(null, '2026-08-16T16:00:00Z')).toBeNull();
    expect(mod.computeDurationSec('2026-08-16T16:00:00Z', null)).toBeNull();
    expect(mod.computeDurationSec('2026-08-16T16:02:00Z', '2026-08-16T16:00:00Z')).toBeNull();
    expect(mod.computeDurationSec('not-a-date', '2026-08-16T16:00:00Z')).toBeNull();
  });
});

describe('jobsToRecords', () => {
  it('emits one record per completed, timeable job (drops the in-flight job)', () => {
    const records = mod.jobsToRecords(RUN, JOBS_FIXTURE);
    expect(records.map((r) => r.jobName)).toEqual([
      'S0 Security',
      'T0 Gate (tests)',
      'T0 Gate (invariants)',
    ]);
  });

  it('computes per-job wall-clock durations', () => {
    const records = mod.jobsToRecords(RUN, JOBS_FIXTURE);
    expect(records.find((r) => r.jobName === 'S0 Security').durationSec).toBe(150);
    expect(records.find((r) => r.jobName === 'T0 Gate (tests)').durationSec).toBe(61);
  });

  it('records failing jobs too (cost is incurred regardless of outcome)', () => {
    const inv = mod
      .jobsToRecords(RUN, JOBS_FIXTURE)
      .find((r) => r.jobName === 'T0 Gate (invariants)');
    expect(inv.conclusion).toBe('failure');
    expect(inv.durationSec).toBe(10);
  });

  it('stamps schema + run context and truncates the SHA to 12 chars', () => {
    const r = mod.jobsToRecords(RUN, JOBS_FIXTURE)[0];
    expect(r.schema).toBe(mod.SCHEMA);
    expect(r.runId).toBe(RUN.databaseId);
    expect(r.workflow).toBe('oursharedevents-ci');
    expect(r.headSha).toBe('0d448c3abcde');
    expect(r.headSha.length).toBe(12);
  });

  it('never-who: carries no actor / committer / person identity', () => {
    const records = mod.jobsToRecords(RUN, JOBS_FIXTURE);
    const keys = new Set(records.flatMap((r) => Object.keys(r)));
    for (const forbidden of ['actor', 'login', 'author', 'committer', 'email', 'user']) {
      expect([...keys].some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it('returns [] for a malformed jobs argument', () => {
    expect(mod.jobsToRecords(RUN, null)).toEqual([]);
    expect(mod.jobsToRecords(RUN, undefined)).toEqual([]);
  });
});

describe('mergeHistory — idempotent append', () => {
  it('appends new records to existing history', () => {
    const merged = mod.mergeHistory([], mod.jobsToRecords(RUN, JOBS_FIXTURE));
    expect(merged).toHaveLength(3);
    expect(() => merged.forEach((l) => JSON.parse(l))).not.toThrow();
  });

  it('is idempotent — re-merging the same records adds nothing', () => {
    const records = mod.jobsToRecords(RUN, JOBS_FIXTURE);
    const first = mod.mergeHistory([], records);
    const second = mod.mergeHistory(first, records);
    expect(second).toEqual(first);
  });

  it('dedups by runId:jobId', () => {
    const records = mod.jobsToRecords(RUN, JOBS_FIXTURE);
    const existing = mod.mergeHistory([], records);
    const key = mod.recordKey(records[0]);
    const dupKeys = existing.map((l) => mod.recordKey(JSON.parse(l))).filter((k) => k === key);
    expect(dupKeys).toHaveLength(1);
  });

  it('skips malformed existing lines rather than propagating them', () => {
    const merged = mod.mergeHistory(['{not json', '', '  '], mod.jobsToRecords(RUN, JOBS_FIXTURE));
    expect(merged).toHaveLength(3);
    merged.forEach((l) => expect(() => JSON.parse(l)).not.toThrow());
  });
});
