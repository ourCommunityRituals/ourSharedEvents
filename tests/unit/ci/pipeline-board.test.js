/**
 * Pipeline board: the one thing it must never do is call a silently dropped
 * stage "skipped". These cases pin the three meanings of "did not run".
 */

let renderBoard;
let stageState;
let STAGES;
let expectedGates;

beforeAll(async () => {
  ({ renderBoard, stageState, STAGES } =
    await import('../../../scripts/ci/render-pipeline-board.mjs'));
  ({ expectedGates } = await import('../../../scripts/assert-gate-execution.mjs'));
});

const MAIN = { eventName: 'push', ref: 'refs/heads/main' };
const PR = { eventName: 'pull_request', headRef: 'ci/some-fix' };
const ALL_RAN = {
  security: 'success',
  gate: 'success',
  'local-vetting': 'success',
  'deploy-staging': 'success',
  'contract-staging': 'success',
  'smoke-staging': 'success',
  'functional-staging': 'success',
};

const stage = (id) => STAGES.find((s) => s.id === id);
const state = (ctx, id, results) => {
  const expected = expectedGates(ctx);
  const anyFailed = [...expected].some((g) => results[g] === 'failure');
  return stageState(stage(id), { result: results[stage(id).key], expected, anyFailed });
};

describe('pipeline board', () => {
  test('stages are listed in execution order with unique ids', () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      'S0',
      'T0',
      'L',
      'T1',
      'T2',
      'T3',
      'T4',
      'T5',
      'T6',
      'P1',
      'P2',
    ]);
  });

  test('a passing main push is all green and says so', () => {
    const md = renderBoard(MAIN, ALL_RAN);
    expect(md).toContain('Every stage expected for this trigger ran');
    expect(md).not.toContain('DID NOT RUN');
  });

  test('a silently skipped stage is flagged, not labelled skipped', () => {
    const results = { ...ALL_RAN, 'functional-staging': 'skipped' };
    expect(state(MAIN, 'T4', results).glyph).toBe('⚠️');
    const md = renderBoard(MAIN, results);
    expect(md).toContain('1 stage(s) that should have run did not');
    expect(md).toContain('DID NOT RUN (skipped)');
  });

  test('a stage skipped after an upstream failure says why', () => {
    const results = { ...ALL_RAN, 'deploy-staging': 'failure', 'contract-staging': 'skipped' };
    expect(state(MAIN, 'T2', results).state).toBe('not run: an earlier stage failed');
    expect(renderBoard(MAIN, results)).toContain('A stage failed');
  });

  test('on a PR, the staging stages are "not part of this run", not a problem', () => {
    const results = { security: 'success', gate: 'success', 'local-vetting': 'success' };
    expect(state(PR, 'T3', results).state).toBe('not part of this run');
    expect(renderBoard(PR, results)).toContain('Every stage expected for this trigger ran');
  });

  test('on a PR, a silently skipped local vetting is flagged', () => {
    const results = { security: 'success', gate: 'success', 'local-vetting': 'skipped' };
    expect(state(PR, 'L', results).glyph).toBe('⚠️');
  });

  test('T5 and T6 are shown as a separate workflow, never as a result of this run', () => {
    expect(state(MAIN, 'T5', ALL_RAN).state).toBe('separate workflow');
    expect(state(MAIN, 'T6', ALL_RAN).state).toBe('separate workflow');
  });

  test('production is optional on a normal push', () => {
    expect(state(MAIN, 'P1', ALL_RAN).note).toMatch(/tag or manual dispatch/);
  });

  test('a failed stage is red even when it was not expected', () => {
    expect(state(PR, 'T3', { 'smoke-staging': 'failure' }).glyph).toBe('❌');
  });
});
