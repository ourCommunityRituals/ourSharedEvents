/**
 * OSE-1250 — unit tests for the Linear auto-close automation guards.
 *
 * These put the born-red cases (also embedded as each script's `--self-test`)
 * into the CI test pyramid so a regression in the pure logic is caught by the
 * T0 `tests` shard (`npx vitest run`), not only by the scripts' own workflows.
 * Both modules export pure functions and are import-safe (their CLI entrypoints
 * are guarded by an isMain check), so importing here never runs the CLI.
 *
 * Root vitest config runs with `globals: true` (describe/test/expect are global)
 * and `sourceType: 'script'` for test files, so the ESM modules under test are
 * loaded via dynamic import() in beforeAll rather than a static import.
 */

let evaluate;
let classify;

beforeAll(async () => {
  ({ evaluate } = await import('../../../scripts/check-pr-linear-close.mjs'));
  ({ classify } = await import('../../../scripts/detect-premature-close.mjs'));
});

describe('OSE-1250 — PR close-guard (evaluate)', () => {
  test('slice PR: id-free branch + "Part of" body → OK (the fix)', () => {
    const r = evaluate({
      branch: 'ci/sponsor-slice-isolation',
      title: 'sponsor-slice isolation',
      body: 'Part of OSE-1172',
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  test('completing PR: id in branch + "Closes" body → OK (intentional close)', () => {
    expect(
      evaluate({ branch: 'ci/ose-1172-done', title: 'finish OSE-1172', body: 'Closes OSE-1172' }).ok
    ).toBe(true);
  });

  test('slice PR: id in branch + "Part of" body for same id → OK (explicit slice intent)', () => {
    expect(
      evaluate({
        branch: 'ci/ose-1172-sponsor-slice-isolation',
        title: 'slice 1',
        body: 'Part of OSE-1172',
      }).ok
    ).toBe(true);
  });

  test('THE BUG (#466): id in branch, body only "Refs" → violation on that id', () => {
    const r = evaluate({
      branch: 'ci/ose-1172-sponsor-slice-isolation',
      title: 'slice 1',
      body: 'Refs OSE-1172',
    });
    expect(r.ok).toBe(false);
    expect(r.violations).toEqual(['OSE-1172']);
  });

  test('id in title only + matching "Part of" body → OK', () => {
    expect(
      evaluate({ branch: 'ci/whatever', title: 'work on OSE-946', body: 'Part of OSE-946' }).ok
    ).toBe(true);
  });

  test('id in title only, no declaration in body → violation', () => {
    expect(
      evaluate({ branch: 'ci/whatever', title: 'work on OSE-946', body: 'notes only' }).ok
    ).toBe(false);
  });

  test('id in branch but a DIFFERENT id closed in body → violation on the branch id', () => {
    const r = evaluate({ branch: 'ci/ose-1172-x', title: 't', body: 'Closes OSE-9999' });
    expect(r.ok).toBe(false);
    expect(r.violations).toEqual(['OSE-1172']);
  });

  test('no Linear id anywhere → OK (non-Linear PR)', () => {
    expect(evaluate({ branch: 'ci/typo-fix', title: 'fix typo', body: 'just a docs fix' }).ok).toBe(
      true
    );
  });

  test('multi-id branch, only one closed → violation lists the unclosed id', () => {
    const r = evaluate({ branch: 'ci/ose-1-and-ose-2', title: 't', body: 'Closes OSE-1' });
    expect(r.ok).toBe(false);
    expect(r.violations).toEqual(['OSE-2']);
  });

  test('case-insensitive: lower-case branch id + lower-case "closes" → OK', () => {
    expect(evaluate({ branch: 'ci/ose-1172-x', title: 't', body: 'closes OSE-1172' }).ok).toBe(
      true
    );
  });
});

describe('OSE-1250 — premature-close detector (classify)', () => {
  const done = (over) => ({
    identifier: 'OSE-1',
    title: 't',
    children: [],
    linkedPRs: [],
    ...over,
  });

  test('Signal A: Done issue with an open child → suspect', () => {
    const s = classify([done({ identifier: 'OSE-946', children: [{ stateType: 'started' }] })]);
    expect(s).toHaveLength(1);
    expect(s[0].identifier).toBe('OSE-946');
    expect(s[0].reasons.join(' ')).toMatch(/open child/i);
  });

  test('clean: Done, children terminal, a linked PR closes it → no suspect', () => {
    expect(
      classify([
        done({ children: [{ stateType: 'completed' }], linkedPRs: [{ body: 'Closes OSE-1' }] }),
      ])
    ).toHaveLength(0);
  });

  test('Signal B: Done, linked PR body only "Part of" → suspect', () => {
    const s = classify([
      done({ identifier: 'OSE-1172', linkedPRs: [{ body: 'Part of OSE-1172' }] }),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].reasons.join(' ')).toMatch(/no linked PR body explicitly closes/i);
  });

  test('clean: Done, no children, no linked PR (legit manual completion) → no suspect', () => {
    expect(classify([done()])).toHaveLength(0);
  });

  test('clean: one of several linked PRs closes it → no suspect', () => {
    expect(
      classify([done({ linkedPRs: [{ body: 'Part of OSE-1' }, { body: 'Closes OSE-1' }] })])
    ).toHaveLength(0);
  });

  test('Signal B: closing word but for the WRONG id → suspect', () => {
    expect(
      classify([done({ identifier: 'OSE-4', linkedPRs: [{ body: 'Closes OSE-999' }] })])
    ).toHaveLength(1);
  });

  test('canceled child counts as terminal (not "open") → no Signal A', () => {
    expect(
      classify([
        done({ children: [{ stateType: 'canceled' }], linkedPRs: [{ body: 'Closes OSE-1' }] }),
      ])
    ).toHaveLength(0);
  });

  test('both signals on one issue → a single suspect entry with both reasons', () => {
    const s = classify([
      done({
        identifier: 'OSE-5',
        children: [{ stateType: 'backlog' }],
        linkedPRs: [{ body: 'Refs OSE-5' }],
      }),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].reasons).toHaveLength(2);
  });
});
