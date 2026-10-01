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

// ---------------------------------------------------------------------------
// Three-valued evaluation (true / false / UNKNOWN).
//
// A value the PR author controls (a branch name, a fork name, an upstream job's
// result) is not enumerated: it is SYMBOLIC, and any test on it whose answer
// the author could pick is UNKNOWN. `&&`, `||` and `!` follow Kleene logic, and
// a job whose `if:` comes out true OR unknown counts as reachable. Witness lists
// kept losing to compound predicates (prefix AND suffix, prefix AND not-equal,
// mixed upstream results); a symbolic value cannot be out-guessed.
// ---------------------------------------------------------------------------

const UNKNOWN = Symbol('unknown');

/** An attacker-chosen string, with the few things it is known NOT to be. */
const sym = ({ notEqual = [], notPrefix = [] } = {}) => ({
  sym: true,
  notEqual: notEqual.map((s) => s.toLowerCase()),
  notPrefix: notPrefix.map((s) => s.toLowerCase()),
});
const isSym = (v) => v != null && typeof v === 'object' && v.sym === true;
const isUnknown = (v) => v === UNKNOWN || isSym(v);

function truthy(v) {
  if (isUnknown(v)) return UNKNOWN;
  if (v === true) return true;
  if (v === false || v == null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return v !== 0;
  return Boolean(v);
}

// GitHub compares strings ignoring case, and its startsWith/endsWith/contains
// ignore case too, so the evaluator must as well ('PULL_REQUEST' == 'pull_request').
const fold = (v) => String(v ?? '').toLowerCase();

function valEquals(a, b) {
  if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN;
  if (isSym(a) && isSym(b)) return UNKNOWN;
  if (isSym(a) || isSym(b)) {
    const s = isSym(a) ? a : b;
    const other = fold(isSym(a) ? b : a);
    if (s.notEqual.includes(other)) return false;
    if (s.notPrefix.some((p) => other.startsWith(p))) return false;
    return UNKNOWN;
  }
  if (typeof a === 'string' || typeof b === 'string') return fold(a) === fold(b);
  if (typeof a === typeof b) return a === b;
  return String(a) === String(b);
}

const not = (v) => (v === UNKNOWN ? UNKNOWN : !v);
const and3 = (a, b) => (a === false || b === false ? false : a === UNKNOWN || b === UNKNOWN ? UNKNOWN : true);
const or3 = (a, b) => (a === true || b === true ? true : a === UNKNOWN || b === UNKNOWN ? UNKNOWN : false);

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
    const p = path.toLowerCase(); // context names are case-insensitive
    if (p === 'true') return true;
    if (p === 'false') return false;
    if (p === 'null') return '';
    if (p === 'github.event_name') return env.event_name;
    if (p === 'github.head_ref') return env.head_ref;
    if (p === 'github.base_ref') return env.base_ref;
    if (p === 'github.ref') return env.ref;
    if (p.startsWith('github.event.inputs.')) return ''; // dispatch inputs absent on PR
    if (env.workflow_run && p.startsWith('github.event.workflow_run.')) {
      const key = p.slice('github.event.workflow_run.'.length);
      if (key in env.workflow_run) return env.workflow_run[key];
    }
    if (env.workflow_run && p === 'github.repository') return env.repository;
    const m = /^needs\.(.+)\.result$/.exec(p);
    if (m) return env.needsResult(m[1]);
    // Any other context (github.actor, github.event.pull_request.*, steps.*,
    // env.*, vars.*) is unmodelled, so its tests are UNKNOWN.
    return UNKNOWN;
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
      return not(truthy(parseComparison()));
    }
    if (tok.t === 'str') {
      next();
      return tok.v;
    }
    if (tok.t === 'id') {
      next();
      if (peek() && peek().t === '(') {
        next(); // (
        const args = [];
        // Args parse at VALUE level (parseComparison), NOT parseOr: parseOr
        // coerces to boolean, which would turn startsWith(github.head_ref, …)
        // into startsWith(true, true).
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

  function strFn(args, test) {
    const [a, b] = args;
    if (a === UNKNOWN || b === UNKNOWN || isSym(b)) return UNKNOWN;
    if (isSym(a)) return test === 'startsWith' && a.notPrefix.some((p) => fold(b).startsWith(p)) ? false : UNKNOWN;
    if (test === 'startsWith') return fold(a).startsWith(fold(b));
    if (test === 'endsWith') return fold(a).endsWith(fold(b));
    return fold(a).includes(fold(b));
  }

  function callFn(name, args) {
    switch (String(name).toLowerCase()) {
      case 'always':
        return true;
      case 'success':
      case 'failure':
      case 'cancelled':
        // The PR author decides whether reachable upstream jobs pass, fail or
        // get cancelled, so these are known only when no need can run.
        return env.statusFn(String(name).toLowerCase());
      case 'startswith':
        return strFn(args, 'startsWith');
      case 'endswith':
        return strFn(args, 'endsWith');
      case 'contains':
        return strFn(args, 'contains');
      default:
        throw new Error(`unsupported function '${name}'`);
    }
  }

  function parseComparison() {
    const left = parsePrimary();
    const tok = peek();
    if (tok && (tok.t === '==' || tok.t === '!=')) {
      next();
      const right = parsePrimary();
      const eq = valEquals(left, right);
      return tok.t === '==' ? eq : not(eq);
    }
    return left;
  }

  function parseAnd() {
    let v = truthy(parseComparison());
    while (peek() && peek().t === '&&') {
      next();
      v = and3(v, truthy(parseComparison()));
    }
    return v;
  }

  function parseOr() {
    let v = parseAnd();
    while (peek() && peek().t === '||') {
      next();
      v = or3(v, parseAnd());
    }
    return v;
  }

  return { run: () => truthy(parseOr()) };
}

/** Evaluate a job `if:`. Returns true, false or UNKNOWN; throws on unparseable input. */
export function evaluateIf(ifStr, env) {
  let src = String(ifStr).trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(src);
  if (wrapped) src = wrapped[1];
  return makeParser(tokenize(src), env).run();
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
 * The approved scope boundary (ADR-020): a `full-pipeline/*` PR is the one
 * deliberate path to deploy jobs, so a plain PR's head branch is known NOT to
 * start with it. ADR-012 decision 6 would retire it. Every other test on the
 * head or base branch is UNKNOWN.
 */
export const APPROVED_DEPLOY_PREFIX = 'full-pipeline/';

/** A plain same-repo PR: the author picks both branch names. */
export function plainPrEnv(eventName = 'pull_request') {
  return {
    event_name: eventName,
    head_ref: sym({ notPrefix: [APPROVED_DEPLOY_PREFIX] }),
    base_ref: sym(),
    ref: 'refs/pull/1/merge',
  };
}

export function isReachableOnPlainPR(jobName, jobs, _memo = {}, eventName = 'pull_request') {
  return isReachableUnder(jobName, jobs, {}, plainPrEnv(eventName));
}

/**
 * workflow_run runs fired by a run whose SOURCE event was a pull_request.
 * workflow_run runs with the default branch as its ref, so environment branch
 * rules do not stop it, and a head_repository check stops only forks
 * (ADR-012, Standard §4.2). The head branch is symbolic; the source repo is
 * either this repo or a fork (which is known not to equal this repo); the
 * conclusion is any value GitHub reports, plus any literal in the condition.
 */
export function prSourcedWorkflowRunEnvs(ifStr) {
  const literals = [...String(ifStr || '').matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const conclusions = new Set([...WORKFLOW_RUN_CONCLUSIONS, ...literals]);
  const envs = [];
  for (const headRepo of ['org/repo', sym({ notEqual: ['org/repo'] })]) {
    for (const conclusion of conclusions) envs.push(makeWorkflowRunEnv(headRepo, conclusion));
  }
  return envs;
}

const WORKFLOW_RUN_CONCLUSIONS = [
  'success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale',
];

const makeWorkflowRunEnv = (headRepo, conclusion) => ({
  event_name: 'workflow_run',
  head_ref: '',
  base_ref: '',
  ref: 'refs/heads/main',
  repository: 'org/repo',
  workflow_run: {
    event: 'pull_request',
    conclusion,
    head_branch: sym(),
    'head_repository.full_name': headRepo,
  },
});

/**
 * Is `jobName` reachable under `baseEnv`? A job is reachable when its `if:` is
 * true or UNKNOWN. Fail-closed: an `if:` that cannot be parsed is reachable.
 */
export function isReachableUnder(jobName, jobs, memo, baseEnv) {
  if (jobName in memo) return memo[jobName];
  memo[jobName] = false; // cycle guard
  const job = jobs[jobName] || {};
  const needs = normalizeNeeds(job.needs);
  const live = needs.filter((n) => isReachableUnder(n, jobs, memo, baseEnv));
  const env = {
    ...baseEnv,
    // A need that cannot run is 'skipped'; one that can run ends however the
    // PR author makes it end.
    needsResult: (n) => (live.includes(n) ? UNKNOWN : 'skipped'),
    statusFn: (fn) => {
      if (needs.length === 0) return fn === 'success';
      // success() needs every need to succeed, so one skipped need makes it
      // false. failure() and cancelled() need only ONE need to end that way,
      // so any need that can run leaves them to the PR author.
      if (fn === 'success') return live.length < needs.length ? false : UNKNOWN;
      return live.length > 0 ? UNKNOWN : false;
    },
  };
  const ifStr = job.if == null ? '' : String(job.if).trim();
  let reachable;
  if (ifStr === '') {
    // Default if: success(). Runs iff every need can run (and the author lets it pass).
    reachable = live.length === needs.length;
  } else {
    try {
      const v = evaluateIf(ifStr, env);
      reachable = v === true || v === UNKNOWN;
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
  // Whitespace is legal around the index (`secrets [ x ]`), and context names
  // are case-insensitive, so both patterns allow it.
  if (/toJSON\(\s*secrets\s*\)|(?<![\w-])secrets\s*\[\s*[^'"\s]/i.test(JSON.stringify([wf && wf.env, job]))) {
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
    // Case-insensitive, with optional whitespace around `.` and inside `[ ]`,
    // matching what the GitHub expression parser accepts.
    const re = /(?<![\w-])secrets\s*\.\s*([A-Za-z0-9_]+)|(?<![\w-])secrets\s*\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/gi;
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

const PR_EVENTS = ['pull_request', 'pull_request_review', 'pull_request_review_comment'];

/** Secrets referenced by a local reusable workflow a job calls (`uses: ./.github/workflows/x.yml`). */
export function calledWorkflowSecrets(job, workflowMap, seen = new Set()) {
  const out = new Set();
  const uses = job && typeof job.uses === 'string' ? job.uses.trim() : '';
  const m = /^\.\/\.github\/workflows\/([^@\s]+)$/.exec(uses);
  if (!m || seen.has(m[1])) return out;
  seen.add(m[1]);
  const called = workflowMap[m[1]];
  if (!called || typeof called !== 'object') {
    out.add(INHERIT_ALL_SECRETS); // unreadable callee → fail-closed
    return out;
  }
  for (const cj of Object.values(called.jobs || {})) {
    for (const s of jobSecrets(called, cj)) out.add(s);
    for (const s of calledWorkflowSecrets(cj, workflowMap, seen)) out.add(s);
  }
  out.delete('GITHUB_TOKEN');
  return out;
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
/**
 * Rule P over a step list, following local composite actions (`uses: ./path`)
 * recursively with a cycle guard: a checkout inside a composite action
 * persists its token for the caller's later steps just the same.
 */
function persistedCheckouts(steps, label, resolveAction, out, seen = new Set()) {
  (Array.isArray(steps) ? steps : []).forEach((step, i) => {
    if (!step || typeof step.uses !== 'string') return;
    const uses = step.uses.trim();
    const where = `${label}:step${i + 1}${step.name ? ` (${step.name})` : ''}`;
    if (/^actions\/checkout@/i.test(uses)) {
      const w = step.with || {};
      if (w.token == null || String(w.token).trim() === '') return;
      if (String(w['persist-credentials']).trim().toLowerCase() === 'false') return;
      out.push(where);
      return;
    }
    const local = /^\.\/(.+?)\/?$/.exec(uses);
    if (!local || /\.ya?ml$/i.test(local[1]) || seen.has(local[1])) return;
    const action = resolveAction(local[1]);
    if (!action || !action.runs || String(action.runs.using).toLowerCase() !== 'composite') return;
    persistedCheckouts(action.runs.steps, `${where} → ./${local[1]}`, resolveAction, out, new Set([...seen, local[1]]));
  });
}

export function analyzeWorkflows(workflowMap, resolveAction = () => null) {
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
      persistedCheckouts(job && job.steps, `${file}:${jobName}`, resolveAction, persistedTokenCheckouts);
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
        for (const sec of calledWorkflowSecrets(job, workflowMap)) secrets.add(sec);
        secrets.delete('GITHUB_TOKEN');
        // Structural backstop (2026-10-01 security review): even when the model
        // finds the job unreachable, a secret-holding workflow_run job must name
        // a trusted source event explicitly, so a modelling gap cannot pass it.
        const ifText = job && job.if != null ? String(job.if) : '';
        const namesTrustedEvent =
          /github\.event\.workflow_run\.event\s*==\s*'(push|schedule)'/i.test(ifText) &&
          !/github\.event\.workflow_run\.event\s*==\s*'pull_request/i.test(ifText);
        if (!reachable && (secrets.size === 0 || namesTrustedEvent)) continue;
        for (const sec of secrets) {
          if (!prSourcedWorkflowRunSecrets.has(sec)) prSourcedWorkflowRunSecrets.set(sec, new Set());
          prSourcedWorkflowRunSecrets.get(sec).add(`${file}:${jobName}`);
        }
      }
    }

    // pull_request_review and pull_request_review_comment run the PR's own
    // workflow file, the same exposure as pull_request.
    const prEvents = PR_EVENTS.filter((e) => triggers.includes(e));
    if (prEvents.length === 0) continue;

    const jobs = wf.jobs || {};
    for (const [jobName, job] of Object.entries(jobs)) {
      if (!prEvents.some((e) => isReachableOnPlainPR(jobName, jobs, {}, e))) continue;
      // Collect at JOB level (the whole job, incl. step-level `env:` even where a
      // step's own `if:` would skip it on a plain PR). This is DELIBERATE, not a
      // gap: under the tamper model an auto-run PR controls the workflow content
      // and can flip any step's `if:` (or add a new step), so a secret referenced
      // anywhere in a plain-PR-reachable job is exfiltratable. Do NOT "optimize"
      // this into step-level `if:` filtering — that would open a real hole.
      const secrets = jobSecrets(wf, job);
      // A local reusable workflow runs inside this job's reach: count every
      // secret its jobs reference (fail-closed; it may use environment secrets).
      for (const s of calledWorkflowSecrets(job, workflowMap)) secrets.add(s);
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

/** Load `./<path>/action.yml` (or `.yaml`) from the repo; null if absent. */
function readLocalAction(relPath) {
  for (const name of ['action.yml', 'action.yaml']) {
    const f = join(REPO_ROOT, relPath, name);
    if (existsSync(f)) {
      try {
        return yaml.load(readFileSync(f, 'utf8'));
      } catch (err) {
        console.error(`[pr-secret-guard] ERROR: failed to parse ${relPath}/${name}: ${err.message}`);
        process.exit(1);
      }
    }
  }
  return null;
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
      name: 'leak: whitespace inside a named secrets index (secrets [ \'X\' ])',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: { j: { steps: [{ env: { A: "${{ secrets [ 'ADMIN_KEY' ] }}" } }] } },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: whitespace before a computed secrets index (secrets [ x ])',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: { j: { steps: [{ env: { A: '${{ secrets [ matrix.name ] }}' } }] } },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: mixed-case context name (Secrets.X)',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: { j: { steps: [{ env: { A: '${{ Secrets.ADMIN_KEY }}' } }] } },
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
      name: "leak: trusted event OR'd with a conclusion a PR run can reach",
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if: "github.event.workflow_run.event == 'push' || github.event.workflow_run.conclusion == 'neutral'",
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: job gated on a failed source run',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if: "github.event.workflow_run.conclusion == 'failure' && github.event.workflow_run.head_repository.full_name == github.repository",
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: "leak: case-folded event name (event_name == 'PULL_REQUEST')",
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            test: { steps: [{ run: 'npm test' }] },
            d: { if: "github.event_name == 'PULL_REQUEST'", steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }] },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: failure() after a test job the PR author can fail',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            test: { steps: [{ run: 'npm test' }] },
            d: { needs: 'test', if: 'failure()', steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }] },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: "leak: always() && needs.test.result == 'failure'",
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            test: { steps: [{ run: 'npm test' }] },
            d: { needs: 'test', if: "always() && needs.test.result == 'failure'", steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }] },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: attacker-chosen head-branch prefix on the pull_request path (release/)',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            test: { steps: [{ run: 'npm test' }] },
            d: { if: "startsWith(github.head_ref, 'release/')", steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }] },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: "leak: attacker-chosen base branch (base_ref == 'develop')",
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            test: { steps: [{ run: 'npm test' }] },
            d: { if: "github.base_ref == 'develop'", steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }] },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: "leak: pull_request_review trigger runs the PR's workflow",
      wf: {
        'ci.yml': {
          on: { pull_request_review: {} },
          jobs: {
            test: { steps: [{ run: 'npm test' }] },
            d: { if: 'true', steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }] },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: PR job calls a local reusable workflow whose job reads a secret',
      wf: {
        'ci.yml': { on: { pull_request: {} }, jobs: { call: { uses: './.github/workflows/b.yml' } } },
        'b.yml': {
          on: { workflow_call: {} },
          jobs: { deploy: { environment: 'staging', steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }] } },
        },
      },
      expectViolation: true,
    },
    {
      name: 'safe: PR job calls a local reusable workflow that reads no secret',
      wf: {
        'ci.yml': { on: { pull_request: {} }, jobs: { call: { uses: './.github/workflows/b.yml' } } },
        'b.yml': { on: { workflow_call: {} }, jobs: { t: { steps: [{ run: 'npm test' }] } } },
      },
      expectViolation: false,
    },
    {
      name: 'leak: workflow_run event == push OR a case-folded PULL_REQUEST',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if: "github.event.workflow_run.event == 'push' || github.event.workflow_run.event == 'PULL_REQUEST'",
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: workflow_run branch prefix AND suffix together (release/…-rc)',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: {
            rt: {
              if: "github.event.workflow_run.event == 'push' || (github.event.workflow_run.event != 'push' && startsWith(github.event.workflow_run.head_branch, 'release/') && endsWith(github.event.workflow_run.head_branch, '-rc'))",
              steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: "leak: PR head prefix AND not-equal (startsWith 'release/' && != 'release/')",
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            d: {
              if: "startsWith(github.head_ref, 'release/') && github.head_ref != 'release/'",
              steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: mixed upstream results (needs.a success AND needs.b failure)',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            a: { steps: [{ run: 'npm test' }] },
            b: { steps: [{ run: 'npm run lint' }] },
            d: {
              needs: ['a', 'b'],
              if: "always() && needs.a.result == 'success' && needs.b.result == 'failure'",
              steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'leak: PR-sourced workflow_run job calls a local reusable workflow that reads a secret',
      wf: {
        'rt.yml': {
          on: { workflow_run: { workflows: ['CI'], types: ['completed'] } },
          jobs: { rt: { uses: './.github/workflows/deploy.yml' } },
        },
        'deploy.yml': {
          on: { workflow_call: {} },
          jobs: { d: { environment: 'staging', steps: [{ env: { A: '${{ secrets.ADMIN_KEY }}' } }] } },
        },
      },
      expectViolation: true,
    },
    {
      name: 'safe: approved full-pipeline/ gate still excludes a plain PR, even combined with a suffix',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            d: {
              if: "startsWith(github.head_ref, 'full-pipeline/') && endsWith(github.head_ref, '-x')",
              steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }],
            },
          },
        },
      },
      expectViolation: false,
    },
    {
      name: 'leak: failure() with one need skipped and one that can fail',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            test: { steps: [{ run: 'npm test' }] },
            deploy: { if: "github.event_name == 'push'", steps: [{ run: 'echo deploy' }] },
            notify: {
              needs: ['test', 'deploy'],
              if: 'failure()',
              steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }],
            },
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'safe: success() with a need that can never run',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            test: { steps: [{ run: 'npm test' }] },
            deploy: { if: "github.event_name == 'push'", steps: [{ run: 'echo deploy' }] },
            after: {
              needs: ['test', 'deploy'],
              if: 'success()',
              steps: [{ env: { T: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } }],
            },
          },
        },
      },
      expectViolation: false,
    },
    {
      name: 'leak: local composite action checks out with inputs.token and keeps it',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: {
            j: {
              steps: [
                { uses: './.github/actions/fetch-brain', with: { token: '${{ secrets.OCR_PROPAGATE_TOKEN }}' } },
                { run: 'npm ci' },
              ],
            },
          },
        },
      },
      actions: {
        '.github/actions/fetch-brain': {
          inputs: { token: { required: true } },
          runs: {
            using: 'composite',
            steps: [{ uses: 'actions/checkout@v4', with: { repository: 'org/brain', token: '${{ inputs.token }}' } }],
          },
        },
      },
      expectViolation: true,
    },
    {
      name: 'safe: local composite action checks out with persist-credentials: false',
      wf: {
        'ci.yml': {
          on: { pull_request: {} },
          jobs: { j: { steps: [{ uses: './.github/actions/fetch-brain', with: { token: '${{ secrets.OCR_PROPAGATE_TOKEN }}' } }] } },
        },
      },
      actions: {
        '.github/actions/fetch-brain': {
          runs: {
            using: 'composite',
            steps: [{ uses: 'actions/checkout@v4', with: { token: '${{ inputs.token }}', 'persist-credentials': 'false' } }],
          },
        },
      },
      expectViolation: false,
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
      analyzeWorkflows(fx.wf, (rel) => (fx.actions || {})[rel] || null);
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
    analyzeWorkflows(workflows, readLocalAction);

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
