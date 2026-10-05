/**
 * Branch-protection contract (OSE-1216).
 *
 * tools/ci/main-branch-protection.json is what `scripts/apply-branch-protection.mjs
 * --apply` puts on `main`. This test ties that list to what the workflows can
 * actually report on a pull request, so the file cannot drift away from the
 * pipeline without a red check here. It needs no token and no network.
 *
 * "Always reports on a pull_request" is derived from the workflow, not typed in:
 *   - the workflow has a `pull_request` trigger with no `paths` / `paths-ignore`
 *     (a path filter means the workflow may not start at all);
 *   - the job has no `if:` (or exactly `always()`), and every job it `needs:`
 *     reports too (a job behind a skipped job is skipped, and a skipped job is
 *     not success).
 *
 * Three findings, each proven below against a planted fault so the gate cannot
 * pass vacuously:
 *   PHANTOM      a required context no always-reporting job emits. Nothing can
 *                satisfy it, so every PR waits on it forever (OSE-1260: the old
 *                "S2 Post-Execution Security").
 *   DEADLOCK     a required context that only a conditional job emits. It skips
 *                on some PRs, and a skipped job is not success.
 *   UNGUARDED    a check the pipeline always runs on a PR that is neither
 *                required nor on the reviewed ALLOWED_UNREQUIRED list. A red
 *                result of it would not block a merge (OSE-1216: the component
 *                shard ran real Playwright specs and was never required).
 *
 * The live half (does GitHub hold what the JSON says) is
 * `node scripts/apply-branch-protection.mjs --check-checks`, run nightly by
 * .github/workflows/branch-protection-drift.yml.
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');

/** Pipeline workflows whose unrequired always-on checks must be reviewed (UNGUARDED). */
const PIPELINE_WORKFLOWS = ['oursharedevents-ci.yml', 'inv22-cross-repo-gate.yml'];

/**
 * Always-on checks that are deliberately not required. Every entry needs a reason.
 * Keyed by "<file>#<job key>".
 */
const ALLOWED_UNREQUIRED = {
  'oursharedevents-ci.yml#gate-tests-sub':
    'T0 test sections. Their verdict is the required aggregate "T0 Gate (tests)" (needs gate-tests-sub, fails on any non-success).',
  'oursharedevents-ci.yml#summary':
    'Pipeline Summary only renders the board and the table; it asserts nothing. The reconciler is the enforcement anchor.',
};

// ── derivation (pure) ──────────────────────────────────────────────────────

function triggers(wf) {
  // js-yaml 4 keeps `on` as a string key; tolerate a YAML 1.1 parser that turns it into `true`.
  return (wf && (wf.on !== undefined ? wf.on : wf[true])) || {};
}

/** True when the workflow always starts on a pull_request to main. */
function startsOnEveryPullRequest(wf) {
  const on = triggers(wf);
  if (typeof on === 'string') return on === 'pull_request';
  if (Array.isArray(on)) return on.includes('pull_request');
  if (!Object.prototype.hasOwnProperty.call(on, 'pull_request')) return false;
  const pr = on.pull_request || {};
  if (pr.paths || pr['paths-ignore']) return false;
  if (pr['branches-ignore']) return false;
  if (pr.branches && !pr.branches.includes('main')) return false;
  return true;
}

function isAlways(expr) {
  return typeof expr === 'string' && expr.replace(/^\$\{\{|\}\}$/g, '').trim() === 'always()';
}

/** Does job `key` run to completion on every pull_request (given its workflow starts)? */
function jobAlwaysRuns(jobs, key, seen = new Set()) {
  const job = jobs[key];
  if (!job || seen.has(key)) return false;
  if (job.if !== undefined) return isAlways(job.if);
  const needs = [].concat(job.needs || []);
  return needs.every((n) => jobAlwaysRuns(jobs, n, new Set([...seen, key])));
}

/** Check-run names a job reports; null when the name depends on something we cannot derive. */
function jobCheckNames(key, job) {
  const raw = job.name === undefined ? key : String(job.name);
  if (!raw.includes('${{')) return [raw];
  const matrix = (job.strategy && job.strategy.matrix) || {};
  const listKeys = Object.keys(matrix).filter(
    (k) => Array.isArray(matrix[k]) && k !== 'include' && k !== 'exclude'
  );
  let combos = [];
  if (listKeys.length) {
    combos = listKeys.reduce(
      (acc, k) => acc.flatMap((c) => matrix[k].map((v) => ({ ...c, [k]: v }))),
      [{}]
    );
  }
  combos = combos.concat(matrix.include || []);
  if (!combos.length) return null;
  const names = [];
  for (const combo of combos) {
    let ok = true;
    const name = raw.replace(/\$\{\{\s*matrix\.([A-Za-z0-9_]+)\s*\}\}/g, (_, k) => {
      if (combo[k] === undefined) ok = false;
      return String(combo[k]);
    });
    if (!ok || name.includes('${{')) return null;
    names.push(name);
  }
  return names;
}

/**
 * @param {Record<string, any>} workflows file name -> parsed workflow
 * @returns {{always: Map<string,string>, conditional: Map<string,string>, dynamic: string[]}}
 *   check name -> "<file>#<job>", plus jobs whose name cannot be derived ("<file>#<job>")
 */
function emittedChecks(workflows) {
  const always = new Map();
  const conditional = new Map();
  const dynamic = [];
  for (const [file, wf] of Object.entries(workflows)) {
    if (!wf || !wf.jobs) continue;
    const starts = startsOnEveryPullRequest(wf);
    for (const [key, job] of Object.entries(wf.jobs)) {
      const names = jobCheckNames(key, job || {});
      const id = `${file}#${key}`;
      if (names === null) {
        dynamic.push(id);
        continue;
      }
      const target = starts && jobAlwaysRuns(wf.jobs, key) ? always : conditional;
      for (const n of names) target.set(n, id);
    }
  }
  return { always, conditional, dynamic };
}

/** @returns {string[]} one line per finding; empty = the contract holds */
function contractFindings(required, workflows, allowedUnrequired = ALLOWED_UNREQUIRED) {
  const { always, conditional, dynamic } = emittedChecks(workflows);
  const findings = [];
  for (const ctx of required) {
    if (always.has(ctx)) continue;
    if (conditional.has(ctx)) {
      findings.push(
        `DEADLOCK: "${ctx}" is required but only ${conditional.get(ctx)} emits it, and that job can skip on a PR`
      );
    } else {
      findings.push(`PHANTOM: "${ctx}" is required but no job emits it`);
    }
  }
  const pipeline = Object.fromEntries(
    Object.entries(workflows).filter(([f]) => PIPELINE_WORKFLOWS.includes(f))
  );
  const pipelineChecks = emittedChecks(pipeline);
  for (const [name, id] of pipelineChecks.always) {
    if (required.includes(name) || allowedUnrequired[id]) continue;
    findings.push(
      `UNGUARDED: "${name}" (${id}) always runs on a PR but is not required and not on ALLOWED_UNREQUIRED`
    );
  }
  for (const id of pipelineChecks.dynamic) {
    if (!allowedUnrequired[id]) {
      findings.push(
        `UNGUARDED: ${id} has a check name that cannot be derived and is not on ALLOWED_UNREQUIRED`
      );
    }
  }
  return findings;
}

// ── fixtures ───────────────────────────────────────────────────────────────

const PR_ON = { pull_request: { branches: ['main'] }, push: { branches: ['main'] } };

function wf(jobs, on = PR_ON) {
  return { on, jobs };
}

describe('OSE-1216 — deriving "always reports on a pull_request" (controls)', () => {
  test('a job with no if reports; a job behind it reports too', () => {
    const { always } = emittedChecks({
      'a.yml': wf({ s: { name: 'S' }, g: { name: 'G', needs: ['s'] } }),
    });
    expect([...always.keys()].sort()).toEqual(['G', 'S']);
  });

  test('`if: always()` reports, even behind a conditional job', () => {
    const { always, conditional } = emittedChecks({
      'a.yml': wf({
        c: { name: 'C', if: "github.event_name == 'push'" },
        r: { name: 'R', needs: ['c'], if: 'always()' },
      }),
    });
    expect([...always.keys()]).toEqual(['R']);
    expect([...conditional.keys()]).toEqual(['C']);
  });

  test('a job whose needs include a conditional job is conditional (a skipped job is not success)', () => {
    const { always, conditional } = emittedChecks({
      'a.yml': wf({ c: { name: 'C', if: 'false' }, d: { name: 'D', needs: ['c'] } }),
    });
    expect(always.size).toBe(0);
    expect([...conditional.keys()].sort()).toEqual(['C', 'D']);
  });

  test('a workflow with a paths filter on pull_request never counts as always reporting', () => {
    const { always } = emittedChecks({
      'a.yml': wf({ s: { name: 'S' } }, { pull_request: { paths: ['src/**'] } }),
    });
    expect(always.size).toBe(0);
  });

  test('a push-only workflow does not report on a pull_request', () => {
    const { always } = emittedChecks({ 'a.yml': wf({ s: { name: 'S' } }, { push: {} }) });
    expect(always.size).toBe(0);
  });

  test('matrix names expand per shard; an underivable name is reported as dynamic', () => {
    const { always, dynamic } = emittedChecks({
      'a.yml': wf({
        gate: {
          name: 'T0 Gate (${{ matrix.shard }})',
          strategy: { matrix: { shard: ['lint', 'a11y'] } },
        },
        sub: {
          name: "T0 ${{ matrix.section && format(' {0}', matrix.section) || '' }}",
          strategy: { matrix: { include: [{ section: 'x' }] } },
        },
      }),
    });
    expect([...always.keys()].sort()).toEqual(['T0 Gate (a11y)', 'T0 Gate (lint)']);
    expect(dynamic).toEqual(['a.yml#sub']);
  });
});

describe('OSE-1216 — contract findings are proven against planted faults', () => {
  const good = {
    'a.yml': wf({ s: { name: 'S' }, c: { name: 'C', if: "github.event_name == 'push'" } }),
  };

  test('control: required = what always reports -> no findings', () => {
    expect(contractFindings(['S'], good, {})).toEqual([]);
  });

  test('PHANTOM: a required context nothing emits is caught', () => {
    const f = contractFindings(['S', 'S2 Post-Execution Security'], good, {});
    expect(f).toEqual(['PHANTOM: "S2 Post-Execution Security" is required but no job emits it']);
  });

  test('DEADLOCK: a required context only a conditional job emits is caught', () => {
    const f = contractFindings(['S', 'C'], good, {});
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/^DEADLOCK: "C"/);
  });

  test('UNGUARDED: an always-on check that is not required is caught, an allowed one is not', () => {
    const pipe = {
      'oursharedevents-ci.yml': wf({ s: { name: 'S' }, comp: { name: 'Component' } }),
    };
    const f = contractFindings(['S'], pipe, {});
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/^UNGUARDED: "Component"/);
    expect(contractFindings(['S'], pipe, { 'oursharedevents-ci.yml#comp': 'reason' })).toEqual([]);
  });

  test('a required check emitted by a different always-on workflow counts', () => {
    const two = { ...good, 'b.yml': wf({ other: { name: 'Other gate' } }) };
    expect(contractFindings(['S', 'Other gate'], two, {})).toEqual([]);
  });
});

// ── the real contract ──────────────────────────────────────────────────────

function loadWorkflows() {
  const out = {};
  for (const f of readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    out[f] = yaml.load(readFileSync(join(WF_DIR, f), 'utf8'));
  }
  return out;
}

describe('OSE-1216 — tools/ci/main-branch-protection.json vs the workflows', () => {
  const config = JSON.parse(
    readFileSync(join(ROOT, 'tools', 'ci', 'main-branch-protection.json'), 'utf8')
  );
  const required = config.required_status_checks.checks.map((c) => c.context);
  const workflows = loadWorkflows();

  test('the required list is non-empty and has no duplicates', () => {
    expect(required.length).toBeGreaterThan(0);
    expect(new Set(required).size).toBe(required.length);
  });

  test('every required context is one a job always reports on a pull_request, and every always-on pipeline check is required or reviewed', () => {
    expect(contractFindings(required, workflows)).toEqual([]);
  });

  test('every ALLOWED_UNREQUIRED entry still names a real job (no stale exemptions)', () => {
    for (const id of Object.keys(ALLOWED_UNREQUIRED)) {
      const [file, key] = id.split('#');
      expect(
        workflows[file] && workflows[file].jobs && workflows[file].jobs[key],
        id
      ).toBeDefined();
    }
  });

  test('the required list holds the gates the OSE-1216 ticket names', () => {
    expect(required).toContain('T0 Gate (component)');
    expect(required).not.toContain('S2 Post-Execution Security');
  });
});
