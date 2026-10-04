/**
 * Pipeline board: the testing flow in execution order, one row per stage, with
 * an explicit reason for every stage that did not run.
 *
 * Why: the old summary listed jobs in a flat table where `skipped` could mean "not
 * part of this trigger", "an earlier stage failed" or "something silently did not
 * run". Only the last one is a problem, and the reader had to work out which.
 * This board says which, using the same trigger-aware expected set the
 * gate-execution reconciler enforces (scripts/assert-gate-execution.mjs), so the
 * board and the gate can never disagree about what should have run.
 *
 * Pure `stageState` / `renderBoard` are exported and import-safe; the CLI is
 * isMain-guarded. Usage (from the summary job):
 *   EVENT_NAME=... REF=... HEAD_REF=... INPUT_DEPLOY_STAGING=... INPUT_RUN_FUNCTIONAL=... \
 *   RESULTS_JSON='${{ toJSON(needs) }}' node scripts/ci/render-pipeline-board.mjs >> "$GITHUB_STEP_SUMMARY"
 */
import { expectedGates } from '../assert-gate-execution.mjs';

/** Execution order. `key` is the job id in oursharedevents-ci.yml; `key: null` runs in another workflow. */
export const STAGES = [
  { id: 'S0', key: 'security', label: 'S0 Security', proves: 'No known vulnerability or secret in the diff' },
  { id: 'T0', key: 'gate', label: 'T0 Gate', proves: 'Lint, types, invariants, unit and component tests' },
  { id: 'T1', key: 'deploy-staging', label: 'T1 Deploy → Staging', proves: 'Migrations apply, worker deploys, /health is ok' },
  { id: 'T2', key: 'contract-staging', label: 'T2 Contract → Staging (Bruno)', proves: 'API and page contracts hold' },
  { id: 'T3', key: 'smoke-staging', label: 'T3 Smoke → Staging (Playwright)', proves: 'Security smoke, health, form endpoints' },
  { id: 'T4', key: 'functional-staging', label: 'T4 Functional → Staging', proves: 'End-to-end journeys and UI smoke' },
  { id: 'T5', key: null, label: 'T5 Adversarial Red Team', proves: 'Attacks on staging fail', where: 'red-team-adversarial.yml, after this run is green on main' },
  { id: 'T6', key: null, label: 'T6 Closing Security', proves: 'Security holds after the full run', where: 'red-team-adversarial.yml, after T5' },
  { id: 'P1', key: 'deploy-production', label: 'T1 Deploy → Production', proves: 'Production deploy', optional: true },
  { id: 'P2', key: 'smoke-production', label: 'T2 Smoke → Production', proves: 'Production smoke', optional: true },
];

/**
 * @returns {{glyph: string, state: string, note: string}}
 * `expected` is the reconciler's set; `anyFailed` is true when an expected gate failed.
 */
export function stageState(stage, { result, expected, anyFailed }) {
  if (stage.key === null) {
    return { glyph: '➡️', state: 'separate workflow', note: stage.where };
  }
  if (result === 'success') return { glyph: '✅', state: 'passed', note: '' };
  if (result === 'failure') return { glyph: '❌', state: 'failed', note: 'this stage is the red signal' };
  const isExpected = expected.has(stage.key);
  if (!isExpected) {
    return {
      glyph: '⏭️',
      state: 'not part of this run',
      note: stage.optional ? 'production runs on a tag or manual dispatch' : 'not run for this trigger',
    };
  }
  if (anyFailed) {
    return { glyph: '⏭️', state: 'not run: an earlier stage failed', note: 'the failed stage is the signal' };
  }
  return {
    glyph: '⚠️',
    state: `DID NOT RUN (${result || 'absent'})`,
    note: 'expected for this trigger and nothing failed upstream; the reconciler fails this',
  };
}

export function renderBoard(ctx, results) {
  const expected = expectedGates(ctx);
  const anyFailed = [...expected].some((g) => results[g] === 'failure');
  const rows = STAGES.map((stage) => {
    const s = stageState(stage, { result: results[stage.key], expected, anyFailed });
    return { stage, ...s };
  });
  const dropped = rows.filter((r) => r.glyph === '⚠️');

  const lines = [
    '## Testing flow',
    '',
    dropped.length
      ? `**⚠️ ${dropped.length} stage(s) that should have run did not:** ${dropped.map((r) => r.stage.id).join(', ')}`
      : rows.some((r) => r.glyph === '❌')
        ? '**❌ A stage failed.** Stages after it were not run.'
        : '**✅ Every stage expected for this trigger ran.**',
    '',
    '| Order | Stage | State | What it proves | Note |',
    '|---|---|---|---|---|',
    ...rows.map(
      (r, i) => `| ${i + 1} | ${r.stage.label} | ${r.glyph} ${r.state} | ${r.stage.proves} | ${r.note} |`
    ),
    '',
    `Trigger: \`${ctx.eventName}\`${ctx.ref ? ` · \`${ctx.ref}\`` : ''}`,
  ];
  return lines.join('\n');
}

function main() {
  let raw = {};
  try {
    raw = JSON.parse(process.env.RESULTS_JSON || '{}');
  } catch {
    console.log('## Testing flow\n\nCould not read job results.');
    return;
  }
  const results = {};
  for (const [k, v] of Object.entries(raw)) results[k] = v && typeof v === 'object' ? v.result : v;
  console.log(
    renderBoard(
      {
        eventName: process.env.EVENT_NAME,
        ref: process.env.REF,
        headRef: process.env.HEAD_REF,
        inputs: {
          deploy_staging: process.env.INPUT_DEPLOY_STAGING,
          run_functional: process.env.INPUT_RUN_FUNCTIONAL,
        },
      },
      results
    )
  );
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('render-pipeline-board.mjs');
if (isMain) main();
