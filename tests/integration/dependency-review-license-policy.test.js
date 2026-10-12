/**
 * Dependency review licence policy.
 *
 * .github/workflows/dependency-review.yml tells actions/dependency-review-action
 * which licences a new or bumped dependency may carry. The action ignores an
 * input it does not know, so a policy written with an option that a later major
 * removes would stop being applied with nothing going red. `deny-licenses` is
 * that option: deprecated in v5, "for possible removal in the next major
 * release" (the action's README). The policy is therefore an allowlist, and
 * these rules keep it one:
 *
 *   1. The step sets a non-empty `allow-licenses`.
 *   2. The step does not set `deny-licenses`.
 *   3. No GPL, AGPL, SSPL or EUPL id is on the allowlist. LGPL is a different
 *      family and may be listed.
 *   4. The action is named in one workflow file only, comments included, so a
 *      second copy of the settings cannot drift from the first.
 *
 * The detector is proven against synthetic controls first, so the gate cannot
 * pass vacuously.
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');
const ACTION = 'actions/dependency-review-action';
const STRONG_COPYLEFT = /^(GPL|AGPL|SSPL|EUPL)-/i;

/** The action reads a comma-separated list and trims each entry. */
function parseLicenseList(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Every dependency-review-action step: [{ file, job, step }]. */
function reviewSteps(workflows) {
  const found = [];
  for (const [file, wf] of Object.entries(workflows)) {
    for (const [job, def] of Object.entries((wf && wf.jobs) || {})) {
      for (const step of (def && def.steps) || []) {
        if (step && typeof step.uses === 'string' && step.uses.startsWith(`${ACTION}@`)) {
          found.push({ file, job, step });
        }
      }
    }
  }
  return found;
}

/** What is wrong with one step's licence inputs: a list of short reasons. */
function licensePolicyProblems(step) {
  const inputs = (step && step.with) || {};
  const problems = [];
  if ('deny-licenses' in inputs) problems.push('sets deny-licenses');
  const allow = parseLicenseList(inputs['allow-licenses']);
  if (allow.length === 0) problems.push('no allow-licenses');
  for (const id of allow.filter((l) => STRONG_COPYLEFT.test(l))) {
    problems.push(`allows ${id}`);
  }
  return problems;
}

describe('detector controls', () => {
  test('flags a denylist, a missing or empty allowlist and a strong copyleft id', () => {
    const problems = (inputs) => licensePolicyProblems({ uses: `${ACTION}@v5`, with: inputs });
    expect(problems({ 'allow-licenses': 'MIT, Apache-2.0, LGPL-3.0-or-later' })).toEqual([]);
    expect(problems({ 'allow-licenses': 'MIT,\n  ISC' })).toEqual([]);
    expect(problems({ 'deny-licenses': 'GPL-3.0-only' })).toEqual([
      'sets deny-licenses',
      'no allow-licenses',
    ]);
    expect(problems({ 'fail-on-severity': 'high' })).toEqual(['no allow-licenses']);
    expect(problems({ 'allow-licenses': ' , ' })).toEqual(['no allow-licenses']);
    expect(
      problems({ 'allow-licenses': 'MIT, GPL-3.0-or-later, AGPL-3.0-only, SSPL-1.0, EUPL-1.2' })
    ).toEqual([
      'allows GPL-3.0-or-later',
      'allows AGPL-3.0-only',
      'allows SSPL-1.0',
      'allows EUPL-1.2',
    ]);
    expect(licensePolicyProblems({ uses: `${ACTION}@v5` })).toEqual(['no allow-licenses']);
  });

  test('finds the action at any ref and ignores other steps', () => {
    const steps = reviewSteps({
      'a.yml': {
        jobs: {
          x: {
            steps: [{ uses: 'actions/checkout@v7' }, { uses: `${ACTION}@v5` }, { run: 'true' }],
          },
          y: { uses: 'owner/reusable/.github/workflows/w.yml@main' },
        },
      },
      'b.yml': { jobs: { z: { steps: [{ uses: `${ACTION}@${'a'.repeat(40)}` }] } } },
    });
    expect(steps.map((s) => `${s.file}:${s.job}`)).toEqual(['a.yml:x', 'b.yml:z']);
  });
});

describe('.github/workflows', () => {
  const files = readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n));
  const text = {};
  const workflows = {};
  for (const f of files) {
    text[f] = readFileSync(join(WF_DIR, f), 'utf8');
    workflows[f] = yaml.load(text[f]);
  }

  test('dependency-review.yml runs the action once, and no other workflow does', () => {
    expect(reviewSteps(workflows).map((s) => `${s.file}:${s.job}`)).toEqual([
      'dependency-review.yml:dependency-review',
    ]);
  });

  test('the licence policy is an allowlist with no strong copyleft id on it', () => {
    for (const { file, step } of reviewSteps(workflows)) {
      expect({ file, problems: licensePolicyProblems(step) }).toEqual({ file, problems: [] });
    }
  });

  test('no other workflow names the action, in a comment or anywhere else', () => {
    expect(files.filter((f) => text[f].includes(ACTION))).toEqual(['dependency-review.yml']);
  });
});
