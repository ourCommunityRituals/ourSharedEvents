#!/usr/bin/env node
/**
 * check-pr-secret-exposure.mjs — Security Guard: bounded PR-reachable secret surface
 *
 * Enforces ADR-020 (keep the human approval gate on Copilot-authored CI) at the
 * layer that actually matters: the set of `secrets.*` reachable by a workflow job
 * that can run on a plain (agent-authorable, e.g. `copilot/*`) pull request must
 * stay within a small, reviewed allowlist. Deploy/infra credentials
 * (CLOUDFLARE_*, ADMIN_KEY, CF_ACCESS_*, X_OCR_INTERNAL, FORMS_*, SMOKE_RPT_*)
 * must NEVER become reachable on a plain PR.
 *
 * Why this is load-bearing: on `pull_request` (same-repo), GitHub runs the
 * PR-HEAD's workflow content with secrets available, and `.github/` is protected
 * only at MERGE time (CODEOWNERS), not at RUN time. The human approval gate is
 * the only tamper-proof control today — and it is only *safe to ever remove*
 * (ADR-020 Alternative B) if the PR-reachable secret surface is provably minimal.
 * This guard makes that surface a machine-checked contract: add a Cloudflare
 * token to S0/T0, loosen the deploy `if:` so it fires on a plain PR, or introduce
 * `pull_request_target`, and CI turns red.
 *
 * Reachability is decided by a small GitHub-Actions expression evaluator that
 * models a plain PR (event_name='pull_request', head_ref='copilot/x') and the
 * needs-graph (an upstream job that skips resolves to result='skipped'). A job
 * whose `if:` cannot be parsed is treated as reachable (fail-closed).
 *
 * @see docs/security/PR_SECRET_EXPOSURE_GUARD.md
 * @see docs/adr/ADR-020-copilot-ci-human-approval-gate.md
 * @see tests/e2e/0-architecture/ci-approval-gate-safety.invariant.spec.ts
 *
 * Modes:
 *   node scripts/check-pr-secret-exposure.mjs             # enforce (exit 1 on violation)
 *   node scripts/check-pr-secret-exposure.mjs --report    # print PR-reachable secrets, exit 0
 *   node scripts/check-pr-secret-exposure.mjs --self-test # run built-in fixtures, exit 1 on regression
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.PR_SECRET_GUARD_ROOT || join(__dirname, '..');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');
const ALLOWLIST_PATH = join(__dirname, 'check-pr-secret-exposure.allowlist.json');

// ---------------------------------------------------------------------------
// GitHub-Actions expression evaluator (subset) — enough for job `if:` gating.
// Supports: || && ! == != , parentheses, single-quoted strings, always()/
// success()/failure()/cancelled(), startsWith()/endsWith()/contains(), and
// context refs github.event_name / github.head_ref / github.ref /
// github.base_ref / github.event.inputs.* / needs.<job>.result.
// ---------------------------------------------------------------------------

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      tokens.push({ t: c });
      i++;
      continue;
    }
    if (src.startsWith('||', i)) {
      tokens.push({ t: '||' });
      i += 2;
      continue;
    }
    if (src.startsWith('&&', i)) {
      tokens.push({ t: '&&' });
      i += 2;
      continue;
    }
    if (src.startsWith('==', i)) {
      tokens.push({ t: '==' });
      i += 2;
      continue;
    }
    if (src.startsWith('!=', i)) {
      tokens.push({ t: '!=' });
      i += 2;
      continue;
    }
    if (c === '!') {
      tokens.push({ t: '!' });
      i++;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== "'") s += src[j++];
      tokens.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    // identifier / dotted-hyphenated path / number
    const m = /^[A-Za-z0-9_.-]+/.exec(src.slice(i));
    if (m) {
      tokens.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`unexpected char '${c}' at ${i}`);
  }
  return tokens;
}

function truthy(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return v !== 0;
  return Boolean(v);
}

function valEquals(a, b) {
  if (typeof a === typeof b) return a === b;
  return String(a) === String(b);
}

function makeParser(tokens, env) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (t) => {
    const tok = next();
    if (!tok || tok.t !== t) throw new Error(`expected '${t}'`);
    return tok;
  };

  function resolveRef(path) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return '';
    if (path === 'github.event_name') return env.event_name;
    if (path === 'github.head_ref') return env.head_ref;
    if (path === 'github.base_ref') return env.base_ref;
    if (path === 'github.ref') return env.ref;
    if (path.startsWith('github.event.inputs.')) return ''; // dispatch inputs absent on PR (modeled)
    // workflow_run context (ADR-012 / Standard §4.2): modeled only in the
    // PR-sourced workflow_run environment; elsewhere these are unknown refs.
    if (env.workflow_run && path.startsWith('github.event.workflow_run.')) {
      const key = path.slice('github.event.workflow_run.'.length);
      if (key in env.workflow_run) return env.workflow_run[key];
    }
    if (env.workflow_run && path === 'github.repository') return env.repository;
    const m = /^needs\.(.+)\.result$/.exec(path);
    if (m) return env.needsResult(m[1]);
    // UNKNOWN context ref (e.g. github.event.pull_request.draft, github.actor,
    // steps.*, env.*). We cannot model its value, so record that the verdict is
    // built on an unmodeled input — isReachableOnPlainPR fail-closes to reachable
    // if such a verdict comes out "not reachable" (never miss an exposure).
    env.sawUnknown = true;
    return '';
  }

  function parsePrimary() {
    const tok = peek();
    if (!tok) throw new Error('unexpected end');
    if (tok.t === '(') {
      next();
      const v = parseOr();
      expect(')');
      return v;
    }
    if (tok.t === '!') {
      next();
      return !truthy(parseComparison());
    }
    if (tok.t === 'str') {
      next();
      return tok.v;
    }
    if (tok.t === 'id') {
      next();
      // function call?
      if (peek() && peek().t === '(') {
        next(); // (
        const args = [];
        // Args parse at VALUE level (parseComparison), NOT parseOr — parseOr
        // coerces to boolean, which would turn startsWith(github.head_ref, …)
        // into startsWith(true, true) and silently pass the full-pipeline gate.
        if (peek() && peek().t !== ')') {
          args.push(parseComparison());
          while (peek() && peek().t === ',') {
            next();
            args.push(parseComparison());
          }
        }
        expect(')');
        return callFn(tok.v, args);
      }
      return resolveRef(tok.v);
    }
    throw new Error(`unexpected token '${tok.t}'`);
  }

  function callFn(name, args) {
    switch (name) {
      case 'always':
        return true;
      case 'success':
        return true; // assume upstream success when testing reachability
      case 'failure':
      case 'cancelled':
        return false;
      case 'startsWith':
        return String(args[0] ?? '').startsWith(String(args[1] ?? ''));
      case 'endsWith':
        return String(args[0] ?? '').endsWith(String(args[1] ?? ''));
      case 'contains':
        return String(args[0] ?? '').includes(String(args[1] ?? ''));
      default:
        throw new Error(`unsupported function '${name}'`);
    }
  }

  function parseComparison() {
    let left = parsePrimary();
    const tok = peek();
    if (tok && (tok.t === '==' || tok.t === '!=')) {
      next();
      const right = parsePrimary();
      const eq = valEquals(left, right);
      return tok.t === '==' ? eq : !eq;
    }
    return left;
  }

  function parseAnd() {
    let v = truthy(parseComparison());
    while (peek() && peek().t === '&&') {
      next();
      const r = truthy(parseComparison());
      v = v && r;
    }
    return v;
  }

  function parseOr() {
    let v = parseAnd();
    while (peek() && peek().t === '||') {
      next();
      const r = parseAnd();
      v = truthy(v) || truthy(r);
    }
    return truthy(v);
  }

  return { run: () => truthy(parseOr()) };
}

/** Evaluate a job `if:` under a plain-PR environment. Throws on unparseable input. */
export function evaluateIf(ifStr, env) {
  const tokens = tokenize(String(ifStr));
  return makeParser(tokens, env).run();
}

// ---------------------------------------------------------------------------
// Reachability + secret collection
// ---------------------------------------------------------------------------

export function normalizeNeeds(needs) {
  if (!needs) return [];
  if (typeof needs === 'string') return [needs];
  if (Array.isArray(needs)) return needs.filter((n) => typeof n === 'string');
  return [];
}

/**
 * Is `jobName` reachable on a plain (non-full-pipeline) PR? Fail-closed: an `if:`
 * that cannot be evaluated is treated as reachable.
 */
export function isReachableOnPlainPR(jobName, jobs, memo = {}) {
  return isReachableUnder(jobName, jobs, memo, PLAIN_PR_ENV);
}

/** A plain same-repo PR from an agent-authorable branch. */
const PLAIN_PR_ENV = {
  event_name: 'pull_request',
  head_ref: 'copilot/x',
  base_ref: 'main',
  ref: 'refs/pull/1/merge',
};

/**
 * workflow_run runs fired by a run whose SOURCE event was a pull_request. The PR
 * author chooses the branch name, and a fork can open a PR from its own `main`,
 * so the job is tested under each of these and counts as reachable if ANY
 * reaches it. workflow_run runs with the default branch as its ref, so
 * environment branch rules do not stop it, and a head_repository check stops
 * only forks (ADR-012, Standard §4.2).
 */
const SAMPLE_PR_BRANCHES = ['full-pipeline/x', 'copilot/x', 'claude/x', 'dependabot/npm/x', 'feature/x'];

/**
 * The PR author picks the branch name, so a sample list is not enough: a job
 * gated on `head_branch == 'release/x'` would pass every sample. Candidates
 * therefore include every string literal in the workflow's `if:` conditions as a
 * branch name. An exact literal also satisfies startsWith, endsWith and contains
 * on itself, so no prefix/suffix variants are needed. Each candidate is tried
 * from this repo and from a fork.
 */
export function prSourcedWorkflowRunEnvs(ifStr) {
  const literals = [...String(ifStr || '').matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const branches = new Set([...SAMPLE_PR_BRANCHES, 'main']);
  for (const lit of literals) branches.add(lit);
  const envs = [];
  for (const headRepo of ['org/repo', 'fork/repo']) {
    for (const headBranch of branches) envs.push(makeWorkflowRunEnv(headRepo, headBranch));
  }
  return envs;
}

const makeWorkflowRunEnv = (headRepo, headBranch) => ({
  event_name: 'workflow_run',
  head_ref: '',
  base_ref: '',
  ref: 'refs/heads/main',
  repository: 'org/repo',
  workflow_run: {
    event: 'pull_request',
    conclusion: 'success',
    head_branch: headBranch,
    'head_repository.full_name': headRepo,
  },
});

/**
 * Is `jobName` reachable under `baseEnv`? Fail-closed: an `if:` that cannot be
 * evaluated, or a "not reachable" verdict built on an unmodeled ref, counts as
 * reachable.
 */
export function isReachableUnder(jobName, jobs, memo, baseEnv) {
  if (jobName in memo) return memo[jobName];
  memo[jobName] = false; // cycle guard
  const job = jobs[jobName] || {};
  const needs = normalizeNeeds(job.needs);
  const env = {
    ...baseEnv,
    sawUnknown: false,
    needsResult: (n) => (isReachableUnder(n, jobs, memo, baseEnv) ? 'success' : 'skipped'),
  };
  const ifStr = job.if == null ? '' : String(job.if).trim();
  let reachable;
  if (ifStr === '') {
    // No custom if: default is success() of all needs → runs iff all needs run.
    reachable = needs.every((n) => isReachableUnder(n, jobs, memo, baseEnv));
  } else {
    try {
      reachable = evaluateIf(ifStr, env);
      // Fail-closed on UNMODELED inputs: if the "not reachable" verdict was built
      // on an unknown context ref (github.event.pull_request.*, github.actor,
      // steps.*, env.*, …), we cannot trust it — assume reachable so a
      // secret-bearing job gated by an if: we don't understand is never missed.
      if (!reachable && env.sawUnknown) reachable = true;
    } catch {
      reachable = true; // unparseable → fail-closed (assume exposed)
    }
  }
  memo[jobName] = reachable;
  return reachable;
}

/**
 * Secrets a job can read: its own references, the workflow-level `env:` (inherited
 * by every job), and, for a reusable-workflow call with `secrets: inherit`, every
 * secret the caller can see. That last case cannot be enumerated, so it is
 * reported as one sentinel that no allowlist contains (fail-closed).
 */
export const INHERIT_ALL_SECRETS = 'ALL_SECRETS (secrets: inherit)';
export function jobSecrets(wf, job) {
  const out = new Set();
  collectSecretsDeep(job, out);
  if (wf && wf.env) collectSecretsDeep(wf.env, out);
  if (job && typeof job.secrets === 'string' && job.secrets.trim().toLowerCase() === 'inherit') {
    out.add(INHERIT_ALL_SECRETS);
  }
  // `toJSON(secrets)` or a computed `secrets[...]` index reaches every secret
  // without naming one; same fail-closed sentinel.
  if (/toJSON\(\s*secrets\s*\)|(?<![\w-])secrets\[\s*[^'"\s]/i.test(JSON.stringify([wf && wf.env, job]))) {
    out.add(INHERIT_ALL_SECRETS);
  }
  return out;
}

export function collectSecretsDeep(node, out) {
  if (node == null) return;
  if (typeof node === 'string') {
    // Lookbehind excludes filename-like matches (e.g. `set-secrets.sh`) —
    // only a `secrets.` / `secrets['…']` reference not preceded by a word char
    // or hyphen counts as a real secret reference.
    const re = /(?<![\w-])secrets\.([A-Za-z0-9_]+)|(?<![\w-])secrets\[['"]([A-Za-z0-9_]+)['"]\]/g;
    let m;
    while ((m = re.exec(node)) !== null) out.add(m[1] || m[2]);
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) collectSecretsDeep(x, out);
    return;
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) collectSecretsDeep(node[k], out);
  }
}

function getTriggers(wf) {
  const on = wf && (wf.on ?? wf[true] ?? wf['on']);
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  if (typeof on === 'object') return Object.keys(on);
  return [];
}

/**
 * Analyze { filename: parsedWorkflowObject }.
 * Returns { prReachableSecrets: Map<secret, Set<"file:job">>, pullRequestTargetFiles: string[] }.
 */
export function analyzeWorkflows(workflowMap) {
  const prReachableSecrets = new Map();
  const pullRequestTargetFiles = [];
  const persistedTokenCheckouts = [];
  const prSourcedWorkflowRunSecrets = new Map();

  for (const [file, wf] of Object.entries(workflowMap)) {
    if (!wf || typeof wf !== 'object') continue;
    const triggers = getTriggers(wf);
    if (triggers.includes('pull_request_target')) pullRequestTargetFiles.push(file);

    // Rule P (ADR-012 Phase 0.1): a checkout handed a token keeps it for every
    // later step (in .git/config, or with checkout v6+ a credentials file under
    // $RUNNER_TEMP) unless persist-credentials is false. Later steps include PR
    // code and PR-lockfile installs, so a persisted token is a read path.
    for (const [jobName, job] of Object.entries(wf.jobs || {})) {
      (job && Array.isArray(job.steps) ? job.steps : []).forEach((step, i) => {
        if (!step || typeof step.uses !== 'string' || !/^actions\/checkout@/i.test(step.uses.trim())) return;
        const w = step.with || {};
        if (w.token == null || String(w.token).trim() === '') return;
        if (String(w['persist-credentials']).trim().toLowerCase() === 'false') return;
        persistedTokenCheckouts.push(`${file}:${jobName}:step${i + 1}${step.name ? ` (${step.name})` : ''}`);
      });
    }

    // Rule W (ADR-012 Phase 0.2): a workflow_run job may hold no secret when the
    // source run was a pull_request. Fail-closed: every workflow_run is assumed
    // PR-sourceable unless the job's if: excludes it.
    if (triggers.includes('workflow_run')) {
      const jobs = wf.jobs || {};
      for (const [jobName, job] of Object.entries(jobs)) {
        const allIfs = Object.values(jobs)
          .map((j) => (j && j.if != null ? String(j.if) : ''))
          .join(' ');
        const reachable = prSourcedWorkflowRunEnvs(allIfs).some((env) =>
          isReachableUnder(jobName, jobs, {}, env)
        );
        const secrets = jobSecrets(wf, job);
        secrets.delete('GITHUB_TOKEN');
        // Structural backstop (2026-10-01 security review): even when the model
        // finds the job unreachable, a secret-holding workflow_run job must name
        // a trusted source event explicitly, so a modelling gap cannot pass it.
        const ifText = job && job.if != null ? String(job.if) : '';
        const namesTrustedEvent =
          /github\.event\.workflow_run\.event\s*==\s*'(push|schedule)'/.test(ifText) &&
          !/github\.event\.workflow_run\.event\s*==\s*'pull_request/.test(ifText);
        if (!reachable && (secrets.size === 0 || namesTrustedEvent)) continue;
        for (const sec of secrets) {
          if (!prSourcedWorkflowRunSecrets.has(sec)) prSourcedWorkflowRunSecrets.set(sec, new Set());
          prSourcedWorkflowRunSecrets.get(sec).add(`${file}:${jobName}`);
        }
      }
    }

    if (!triggers.includes('pull_request')) continue;

    const jobs = wf.jobs || {};
    const memo = {};
    for (const [jobName, job] of Object.entries(jobs)) {
      if (!isReachableOnPlainPR(jobName, jobs, memo)) continue;
      // Collect at JOB level (the whole job, incl. step-level `env:` even where a
      // step's own `if:` would skip it on a plain PR). This is DELIBERATE, not a
      // gap: under the tamper model an auto-run PR controls the workflow content
      // and can flip any step's `if:` (or add a new step), so a secret referenced
      // anywhere in a plain-PR-reachable job is exfiltratable. Do NOT "optimize"
      // this into step-level `if:` filtering — that would open a real hole.
      const secrets = jobSecrets(wf, job);
      for (const s of secrets) {
        if (!prReachableSecrets.has(s)) prReachableSecrets.set(s, new Set());
        prReachableSecrets.get(s).add(`${file}:${jobName}`);
      }
    }
  }
  return { prReachableSecrets, pullRequestTargetFiles, persistedTokenCheckouts, prSourcedWorkflowRunSecrets };
}

// ---------------------------------------------------------------------------
// I/O + CLI
// ---------------------------------------------------------------------------

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) {
    console.error(`[pr-secret-guard] ERROR: allowlist missing at ${ALLOWLIST_PATH} — fail-closed.`);
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
  return new Set(Object.keys((parsed && parsed.approved) || {}));
}

function readWorkflowsFromDisk() {
  const map = {};
  const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  for (const f of files) {
    try {
      map[f] = yaml.load(readFileSync(join(WORKFLOWS_DIR, f), 'utf8'));
    } catch (err) {
      console.error(`[pr-secret-guard] ERROR: failed to parse ${f}: ${err.message}`);
      process.exit(1);
    }
  }
  return map;
}

function runSelfTest() {
  const TEST_ALLOW = new Set(['OCR_PROPAGATE_TOKEN']);
  const deployIf =
    "(github.event_name == 'push' && github.ref == 'refs/heads/main') || " +
    "(github.event_name == 'workflow_dispatch' && github.event.inputs.deploy_staging == 'true') || " +
    "(github.event_name == 'pull_request' && startsWith(github.head_ref, 'full-pipeline/'))";
  const stagingIf =
    "always() && needs.security.result == 'success' && " +
    "(needs.deploy-staging.result == 'success' || github.event_name == 'schedule')";

  const fixtures = [
    {
      name: 'clean: S0 runs on PR with allowed token; deploy is full-pipeline-gated',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            security: { steps: [{ env: { T: '${{ secrets.OCR_PROPAGATE_TOKEN }}' } }] },
            'deploy-staging': {
              if: deployIf,
              steps: [{ env: { CF: '${{ secrets.CLOUDFLARE_API_TOKEN_OSE }}' } }],
            },
          },
        },
      },
      expectViolation: false,
    },
    {
      name: 'safe: real staging pattern (always() && needs.deploy-staging.result==success)',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            security: { steps: [] },
            'deploy-staging': { if: deployIf, steps: [{ run: 'deploy' }] },
            'smoke-staging-sub': {
              needs: ['security', 'deploy-staging'],
              if: stagingIf,
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: false,
    },
    {
      name: 'leak: a Cloudflare token added to the always-on S0 job',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: { security: { steps: [{ env: { CF: '${{ secrets.CLOUDFLARE_API_TOKEN_OSE }}' } }] } },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: deploy if loosened to fire on any plain PR',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            'deploy-staging': {
              if: "github.event_name == 'pull_request'",
              steps: [{ env: { CF: '${{ secrets.CLOUDFLARE_API_TOKEN_OSE }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: sensitive-secret job gated by an UNKNOWN if-ref (must fail-closed to reachable)',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            // github.event.pull_request.draft is not modeled — the evaluator
            // must NOT resolve it to '' and gate the job (that would miss the
            // ADMIN_KEY exposure). It must fail-closed to reachable.
            leaky: {
              if: "github.event.pull_request.draft == false",
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: sensitive-secret job guarded only by always() (no result gate)',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            'deploy-staging': { if: deployIf, steps: [{ run: 'deploy' }] },
            leaky: {
              needs: ['deploy-staging'],
              if: 'always()',
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: pull_request_target trigger anywhere',
      wf: { 'evil.yml': { on: { pull_request_target: {} }, jobs: { j: { steps: [] } } } },
      expectViolation: true,
    },
    // Rule P — persisted token checkouts (ADR-012 Phase 0.1)
    {
      name: 'leak: checkout with a token and no persist-credentials:false',
      wf: {
        'b.yml': {
          on: { pull_request: {} },
          jobs: {
            j: {
              steps: [
                {
                  uses: 'actions/checkout@v7',
                  with: { repository: 'o/brain', token: '${{ secrets.OCR_PROPAGATE_TOKEN }}' },
                },
              ],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'safe: checkout with a token and persist-credentials:false',
      wf: {
        'b.yml': {
          on: { pull_request: {} },
          jobs: {
            j: {
              steps: [
                {
                  uses: 'actions/checkout@v7',
                  with: {
                    repository: 'o/brain',
                    token: '${{ secrets.OCR_PROPAGATE_TOKEN }}',
                    'persist-credentials': false,
                  },
                },
              ],
            },
          },
        },
      },
      expectViolation: false,
    },
    {
      name: 'leak: persisted token checkout on a push-only workflow too (later steps still read it)',
      wf: {
        'p.yml': {
          on: { push: {} },
          jobs: {
            j: { steps: [{ uses: 'actions/checkout@v4', with: { token: '${{ secrets.OCR_PROPAGATE_TOKEN }}' } }] },
          },
        },
      },
      expectViolation: true,
    },
    // Rule W — PR-sourced workflow_run (ADR-012 Phase 0.2)
    {
      name: 'leak: workflow_run job accepts a pull_request source and holds a secret',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if:
                "github.event.workflow_run.conclusion == 'success' && " +
                "(github.event.workflow_run.event == 'pull_request' || github.event.workflow_run.event == 'push') && " +
                "(startsWith(github.event.workflow_run.head_branch, 'full-pipeline/') || github.event.workflow_run.head_branch == 'main')",
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: a same-repo check alone does not close a PR-sourced workflow_run',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if: 'github.event.workflow_run.head_repository.full_name == github.repository',
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'safe: workflow_run job limited to push runs on main',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if:
                "github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && " +
                'github.event.workflow_run.head_repository.full_name == github.repository',
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: false,
    },
    {
      name: 'leak: workflow_run job gated on an unmodeled ref fails closed',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if: "github.event.workflow_run.actor.login == 'someone'",
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: workflow_run job gated only on an attacker-choosable branch prefix',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if:
                "github.event.workflow_run.event == 'pull_request' && " +
                "startsWith(github.event.workflow_run.head_branch, 'copilot/')",
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: workflow_run job trusting head_branch == main without a repo check (fork PR from main)',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if: "github.event.workflow_run.head_branch == 'main'",
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: workflow_run job gated on an arbitrary branch literal (release/x)',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if:
                "github.event.workflow_run.event == 'pull_request' && " +
                "github.event.workflow_run.head_branch == 'release/x' && " +
                'github.event.workflow_run.head_repository.full_name == github.repository',
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: workflow_run job gated on an arbitrary suffix (endsWith)',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if:
                "github.event.workflow_run.event == 'pull_request' && " +
                "endsWith(github.event.workflow_run.head_branch, '-rc')",
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: workflow-level env secret inherited by a reachable workflow_run job',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          env: { K: '${{ secrets.ADMIN_KEY }}' },
          jobs: { rt: { steps: [{ run: 'echo' }] } },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: reusable-workflow call with secrets: inherit from a reachable workflow_run job',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: { rt: { uses: './.github/workflows/x.yml', secrets: 'inherit' } },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: workflow-level env secret on a PR-triggered workflow',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          env: { K: '${{ secrets.ADMIN_KEY }}' },
          jobs: { j: { steps: [{ run: 'echo' }] } },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: secrets: inherit on a PR-reachable reusable-workflow call',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: { j: { uses: './.github/workflows/x.yml', secrets: 'inherit' } },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: mixed-case Actions/Checkout with a persisted token',
      wf: {
        'b.yml': {
          on: { pull_request: {} },
          jobs: {
            j: { steps: [{ uses: 'Actions/Checkout@v7', with: { token: '${{ secrets.OCR_PROPAGATE_TOKEN }}' } }] },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: toJSON(secrets) in a PR-reachable job',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: { j: { steps: [{ env: { ALL: '${{ toJSON(secrets) }}' } }] } },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: secret-holding workflow_run job that never names a trusted source event',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              // Unreachable under the model (no PR run concludes 'neutral' here),
              // but it names no trusted event, so the structural rule fails it.
              if: "github.event.workflow_run.conclusion == 'neutral' && github.event.workflow_run.event != 'pull_request'",
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'safe: workflow_run job with no secrets at all',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: { rt: { steps: [{ run: 'echo hi' }] } },
        },
      },
      expectViolation: false,
    },
  ];

  let failures = 0;
  for (const fx of fixtures) {
    const { prReachableSecrets, pullRequestTargetFiles, persistedTokenCheckouts, prSourcedWorkflowRunSecrets } =
      analyzeWorkflows(fx.wf);
    const extras = [...prReachableSecrets.keys()].filter((s) => !TEST_ALLOW.has(s));
    const violated =
      extras.length > 0 ||
      pullRequestTargetFiles.length > 0 ||
      persistedTokenCheckouts.length > 0 ||
      prSourcedWorkflowRunSecrets.size > 0;
    const ok = violated === fx.expectViolation;
    console.log(`${ok ? '  ✅' : '  ❌'} ${fx.name}`);
    if (!ok) {
      failures++;
      console.log(
        `       expected violation=${fx.expectViolation}, got=${violated} (extras=[${extras.join(
          ', '
        )}], prt=[${pullRequestTargetFiles.join(', ')}])`
      );
    }
  }
  if (failures) {
    console.error(`\n[pr-secret-guard] SELF-TEST FAILED: ${failures} fixture(s) regressed.`);
    process.exit(1);
  }
  console.log('\n[pr-secret-guard] self-test passed.');
  process.exit(0);
}

function main() {
  const arg = process.argv[2];
  if (arg === '--self-test') return runSelfTest();

  const workflows = readWorkflowsFromDisk();
  const { prReachableSecrets, pullRequestTargetFiles, persistedTokenCheckouts, prSourcedWorkflowRunSecrets } =
    analyzeWorkflows(workflows);

  if (arg === '--report') {
    console.log('PR-reachable secrets (plain, non-full-pipeline PR):');
    for (const [secret, where] of [...prReachableSecrets.entries()].sort()) {
      console.log(`  ${secret}  ← ${[...where].sort().join(', ')}`);
    }
    if (pullRequestTargetFiles.length) {
      console.log(`\npull_request_target workflows: ${pullRequestTargetFiles.join(', ')}`);
    }
    if (persistedTokenCheckouts.length) {
      console.log(`\nToken checkouts without persist-credentials: false:\n  ${persistedTokenCheckouts.join('\n  ')}`);
    }
    for (const [secret, where] of [...prSourcedWorkflowRunSecrets.entries()].sort()) {
      console.log(`\nPR-sourced workflow_run holds ${secret}  ← ${[...where].sort().join(', ')}`);
    }
    process.exit(0);
  }

  const allow = loadAllowlist();
  const violations = [];
  for (const [secret, where] of prReachableSecrets.entries()) {
    if (!allow.has(secret)) {
      violations.push(
        `  secret ${secret} is PR-reachable but NOT allowlisted — via ${[...where].sort().join(', ')}`
      );
    }
  }
  for (const f of pullRequestTargetFiles) {
    violations.push(
      `  workflow ${f} uses pull_request_target — forbidden (runs base-branch code with secrets on PR)`
    );
  }
  for (const c of persistedTokenCheckouts) {
    violations.push(
      `  checkout ${c} is given a token without persist-credentials: false — later steps can read it (ADR-012 0.1)`
    );
  }
  for (const [secret, where] of prSourcedWorkflowRunSecrets.entries()) {
    violations.push(
      `  secret ${secret} is held by a workflow_run job that a pull_request source run can trigger — via ${[...where]
        .sort()
        .join(', ')} (ADR-012 0.2: require workflow_run.event != 'pull_request')`
    );
  }

  console.log('==================================================');
  console.log('  check-pr-secret-exposure (ADR-020)');
  console.log('==================================================');
  if (violations.length === 0) {
    console.log('  ✅ PASS — PR-reachable secret surface within allowlist; no pull_request_target.');
    process.exit(0);
  }
  console.log('  ❌ FAIL — PR-reachable secret surface exceeded the reviewed allowlist:\n');
  console.log(violations.join('\n'));
  console.log('\nGuidance:');
  console.log('  A secret reachable on a plain PR can be exfiltrated by an auto-run agent PR that');
  console.log('  edits a workflow. Either (a) gate the job away from plain PRs (full-pipeline/* or');
  console.log('  needs: a deploy job), or (b) if the exposure is genuinely accepted, add it to');
  console.log('  scripts/check-pr-secret-exposure.allowlist.json WITH a reason — CODEOWNERS-reviewed.');
  console.log('  See docs/security/PR_SECRET_EXPOSURE_GUARD.md');
  process.exit(1);
}

main();
