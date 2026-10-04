/**
 * Gate-execution reconciler — OSE-1255 (the "Detect" model).
 *
 * The honest-green arm (OSE-834) guarantees a gate can't *lie when it runs*.
 * This guarantees a gate can't *silently not run*. On a given trigger, a fixed
 * set of gates is EXPECTED to execute; this reconciles that expected set against
 * what ACTUALLY ran (from `needs.*.result`) and fails if an expected gate was
 * skipped/cancelled/absent for no legitimate reason.
 *
 * Trigger-aware expected set (the "Detect" decision, PO-ratified 2026-09-08):
 *   - Always: security (S0), gate (T0).
 *   - Staging lane (deploy-staging + T2 + T3, and T4 when functional): a push to
 *     main, a workflow_dispatch with deploy_staging=true, or a full-pipeline/* PR.
 *   - Production tiers are NOT part of the standard guarantee (tag/dispatch only),
 *     so they are never "expected" here.
 *
 * Legit-skip rule: a skip is only a violation when it is UNEXPLAINED. If some
 * expected gate FAILED, the downstream skips are an honest cascade (the failed
 * gate is already the red signal), so the reconciler stays quiet and just logs
 * them. An expected gate that skipped while nothing upstream failed = the
 * false-green hole this gate exists to catch.
 *
 * A gate that ran and FAILED counts as EXECUTED — outcome is that gate's own
 * concern; this reconciler only asserts coverage (did it run), not pass/fail.
 *
 * Pure `expectedGates`/`findViolations` are exported and import-safe (the CLI
 * entrypoint is isMain-guarded), so the born-red cases run both as `--self-test`
 * and in the T0 `tests` shard (tests/unit/ci/gate-execution.test.js).
 *
 * Usage (in CI, from the reconciler job):
 *   EVENT_NAME=... REF=... HEAD_REF=... INPUT_DEPLOY_STAGING=... INPUT_RUN_FUNCTIONAL=... \
 *   RESULTS_JSON='${{ toJSON(needs) }}' node scripts/assert-gate-execution.mjs
 *
 *   node scripts/assert-gate-execution.mjs --self-test
 */

const EXECUTED = new Set(['success', 'failure']);

/** The set of job keys expected to EXECUTE for this trigger. */
export function expectedGates({ eventName, ref, headRef, inputs } = {}) {
  const inp = inputs || {};
  const set = new Set(['security', 'gate']); // always
  // Local vetting (T2/T3 on the PR's own code) runs on every pull request, never on a push.
  if (eventName === 'pull_request') set.add('local-vetting');

  const onMain = eventName === 'push' && ref === 'refs/heads/main';
  const fullPipelinePr =
    eventName === 'pull_request' && String(headRef || '').startsWith('full-pipeline/');
  const dispatchDeploy = eventName === 'workflow_dispatch' && String(inp.deploy_staging) === 'true';

  const stagingLane = onMain || fullPipelinePr || dispatchDeploy;
  if (stagingLane) {
    set.add('deploy-staging');
    set.add('contract-staging');
    set.add('smoke-staging');
    // T4 runs on main / full-pipeline PR unconditionally; on dispatch only when asked.
    const functional =
      onMain || fullPipelinePr || (eventName === 'workflow_dispatch' && String(inp.run_functional) === 'true');
    if (functional) set.add('functional-staging');
  }
  return set;
}

/**
 * Reconcile expected vs actual. `results` maps jobKey -> conclusion string
 * (success|failure|skipped|cancelled|undefined).
 */
export function findViolations(expected, results) {
  const res = results || {};
  const executed = [];
  const missing = [];
  for (const g of expected) {
    if (EXECUTED.has(res[g])) executed.push(g);
    else missing.push(g); // skipped | cancelled | absent
  }
  const anyExpectedFailed = [...expected].some((g) => res[g] === 'failure');
  // Unexplained missing = a gate skipped/absent with no upstream failure to explain it.
  const violation = missing.length > 0 && !anyExpectedFailed;
  return { violation, executed, missing, explainedByFailure: anyExpectedFailed };
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function runSelfTest() {
  const main = { eventName: 'push', ref: 'refs/heads/main' };
  const pr = { eventName: 'pull_request', headRef: 'ci/some-fix' };
  const fp = { eventName: 'pull_request', headRef: 'full-pipeline/x' };
  const disp = { eventName: 'workflow_dispatch', inputs: { deploy_staging: 'true', run_functional: 'true' } };
  const allRan = {
    security: 'success', gate: 'success', 'local-vetting': 'success', 'deploy-staging': 'success',
    'contract-staging': 'success', 'smoke-staging': 'success', 'functional-staging': 'success',
  };
  const cases = [
    // [name, context, results, expectViolation]
    ['main-push, everything ran → OK', main, allRan, false],
    ['main-push, T4 executed-but-FAILED → OK (executed, outcome is T4’s concern)', main, { ...allRan, 'functional-staging': 'failure' }, false],
    ['main-push, T4 SILENTLY skipped, nothing upstream failed → VIOLATION', main, { ...allRan, 'functional-staging': 'skipped' }, true],
    ['main-push, deploy FAILED so T2-T4 skipped → OK (explained cascade)', main, { security: 'success', gate: 'success', 'deploy-staging': 'failure', 'contract-staging': 'skipped', 'smoke-staging': 'skipped', 'functional-staging': 'skipped' }, false],
    ['main-push, T4 cancelled, nothing failed → VIOLATION', main, { ...allRan, 'functional-staging': 'cancelled' }, true],
    ['main-push, T4 absent from results → VIOLATION', main, { security: 'success', gate: 'success', 'deploy-staging': 'success', 'contract-staging': 'success', 'smoke-staging': 'success' }, true],
    ['PR (ci/*), staging tiers skipped → OK (not expected on a PR)', pr, { security: 'success', gate: 'success', 'local-vetting': 'success', 'deploy-staging': 'skipped', 'contract-staging': 'skipped', 'smoke-staging': 'skipped', 'functional-staging': 'skipped' }, false],
    ['PR (ci/*), local vetting SILENTLY skipped, nothing upstream failed → VIOLATION', pr, { security: 'success', gate: 'success', 'local-vetting': 'skipped' }, true],
    ['PR (ci/*), local vetting executed-but-FAILED → OK (executed, outcome is its own concern)', pr, { security: 'success', gate: 'success', 'local-vetting': 'failure' }, false],
    ['PR (ci/*), T0 FAILED so local vetting skipped → OK (explained cascade)', pr, { security: 'success', gate: 'failure', 'local-vetting': 'skipped' }, false],
    ['main-push, local vetting absent → OK (PR-only gate)', main, allRan, false],
    ['PR (ci/*), S0 skipped → VIOLATION (S0 always expected)', pr, { security: 'skipped', gate: 'success' }, true],
    ['full-pipeline/* PR, everything ran → OK', fp, allRan, false],
    ['full-pipeline/* PR, T4 silently skipped → VIOLATION', fp, { ...allRan, 'functional-staging': 'skipped' }, true],
    ['dispatch deploy+functional, everything ran → OK', disp, allRan, false],
    ['dispatch deploy only (no run_functional), T4 skipped → OK (T4 not expected)', { eventName: 'workflow_dispatch', inputs: { deploy_staging: 'true' } }, { ...allRan, 'functional-staging': 'skipped' }, false],
  ];
  let failed = 0;
  for (const [name, ctx, results, expectViolation] of cases) {
    const exp = expectedGates(ctx);
    const got = findViolations(exp, results).violation;
    const pass = got === expectViolation;
    if (!pass) failed++;
    console.log(`${pass ? 'PASS' : 'FAIL'} — ${name} (expected violation=${expectViolation}, got ${got})`);
  }
  if (failed > 0) fail(`\nself-test: ${failed} case(s) failed — reconciler logic is wrong.`);
  console.log(`\nself-test: all ${cases.length} cases passed.`);
}

function main() {
  let raw;
  try {
    raw = JSON.parse(process.env.RESULTS_JSON || '{}');
  } catch {
    fail('gate-execution: RESULTS_JSON is not valid JSON (expected `toJSON(needs)`).');
  }
  const results = {};
  for (const [k, v] of Object.entries(raw)) {
    results[k] = v && typeof v === 'object' ? v.result : v;
  }
  const expected = expectedGates({
    eventName: process.env.EVENT_NAME,
    ref: process.env.REF,
    headRef: process.env.HEAD_REF,
    inputs: {
      deploy_staging: process.env.INPUT_DEPLOY_STAGING,
      run_functional: process.env.INPUT_RUN_FUNCTIONAL,
    },
  });
  const { violation, executed, missing, explainedByFailure } = findViolations(expected, results);

  console.log(`gate-execution: trigger=${process.env.EVENT_NAME} ref=${process.env.REF || ''}`);
  console.log(`gate-execution: expected ${expected.size} — ${[...expected].join(', ')}`);
  console.log(`gate-execution: executed ${executed.length} — ${executed.join(', ') || '(none)'}`);
  if (missing.length) {
    console.log(`gate-execution: not-executed ${missing.length} — ${missing.join(', ')}`);
  }

  if (violation) {
    fail(
      `❌ gate-execution FAILED — expected gate(s) did NOT run and nothing upstream failed to explain it:\n` +
        missing.map((g) => `  - ${g}`).join('\n') +
        `\nA gate silently not running is the false-green hole. If this skip is intentional, ` +
        `update expectedGates() in scripts/assert-gate-execution.mjs (with a born-red case), don't ignore it.`
    );
  }
  if (explainedByFailure && missing.length) {
    console.log(
      `✅ gate-execution: ${missing.length} expected gate(s) skipped as an honest cascade of an upstream failure — the failed gate is the real signal, not a coverage hole.`
    );
  } else {
    console.log('✅ gate-execution: every gate expected for this trigger executed.');
  }
  process.exit(0);
}

// ── entrypoint ────────────────────────────────────────────────────────────────
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('assert-gate-execution.mjs');
if (isMain) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else main();
}
