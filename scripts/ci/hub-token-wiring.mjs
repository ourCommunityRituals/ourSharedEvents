/**
 * Token-split wiring: the ONE enumerator for the OCR_PROPAGATE_TOKEN split (OSE-1695).
 *
 * The org PAT OCR_PROPAGATE_TOKEN is write-capable. PR #986 moved every use onto a
 * fallback expression so nothing broke before the new secrets existed. OCR_HUB_READ now
 * exists, so the reads name it alone and the staging script reads env OCR_HUB_READ with
 * no fallback to the old name; only the two write sites keep a fallback (OSE-1695):
 *   reads  (hub staging, hub / OCR-docs checkouts)  ${{ secrets.OCR_HUB_READ }}
 *   writes (two named steps)                         ${{ secrets.<WRITE_SECRET> || secrets.OCR_PROPAGATE_TOKEN }}
 * The read-fallback form is still RECOGNIZED (it names OCR_HUB_READ first), but every
 * fallback is counted by the down-only fallbackUses ratchet, so one cannot come back.
 *
 * Both consumers import this module, so they can never disagree about what exists:
 *   - tests/integration/adr008-wiring.test.js asserts the PROPERTY (every read site is in
 *     a read form, never bare; the write sites are in write forms; nothing else names the
 *     old token);
 *   - scripts/ci/ci-integrity-ratchets.mjs records PROGRESS (per-file counts with step
 *     names, each allowed to move only in its good direction).
 *
 * Static only: one walk of .github, js-yaml parse (anchors, aliases, folded and literal
 * scalars are resolved by the parser, never by regex over YAML text), no network.
 * Enumerated regardless of trigger: every .github/workflows/*.yml|yaml (GitHub reads only
 * the top level) and every composite action .github/actions/** /action.yml|yaml, every job,
 * every step, and the workflow / job / step levels of each.
 *
 * OCCURRENCES. Every `secrets.<NAME>` reference to one of the four names below (dot or
 * bracket spelling, any case: GitHub contexts are case-insensitive), in any key or string
 * at any level, is classified by the FORM of the `${{ }}` expression holding it (an `if:`
 * value is an expression even without `${{ }}`). Whitespace is ignored. The new secret
 * must come FIRST: `||` returns its first truthy operand, so `OLD || NEW` would pick the
 * write-capable token whenever it exists, which is always; that order is `unrecognized`.
 *
 * SITES. A use site has a RIGHT:
 *   read   a step whose run text (or step env) names ci-stage-ocr-workspace, or runs a
 *          package.json script that does; or an actions/checkout of the hub or OCR-docs.
 *          The token a staging step uses is its EFFECTIVE env (workflow, then job, then
 *          step; later wins, as GitHub resolves it) under SCRIPT_TOKEN_ENV, the variable
 *          the script authenticates with on main. A checkout's token is `with.token`.
 *   write  exactly the steps in WRITE_SITES, found by file + job + step name, so a rename
 *          fails loudly. Their token is the effective env under `env`.
 * A composite action can never be proven: the `secrets` context does not exist inside it.
 *
 * ENVIRONMENTS. Every job-level `environment:` (a string, `{ name }`, or an expression whose
 * possible names can be proven) is recorded, and each write site records whether its job
 * declares exactly main-automation, where the write tokens live as environment secrets.
 * ALLOWED_ENVIRONMENTS and MAIN_AUTOMATION_JOBS bound which names and which jobs may appear.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import yaml from 'js-yaml';

export const OLD_NAME = 'OCR_PROPAGATE_TOKEN';
export const READ_NAME = 'OCR_HUB_READ';
export const AUTOMATION_NAME = 'OCR_AUTOMATION_WRITE';
export const NOTIFY_NAME = 'OCR_NOTIFY_OSM';
const FAMILY = new Set([OLD_NAME, READ_NAME, AUTOMATION_NAME, NOTIFY_NAME]);

/**
 * The env var scripts/ci-stage-ocr-workspace.sh authenticates with ON MAIN (pinned by a
 * test): the read secret's own name. A staging step that still sets the old variable name
 * carries no token the script reads, so it is a read site with no recognized token.
 */
export const SCRIPT_TOKEN_ENV = READ_NAME;

/** Recognized forms: the secret names, in order, joined by `||`. */
export const FORMS = {
  bare: [OLD_NAME],
  'read-fallback': [READ_NAME, OLD_NAME],
  'write-fallback-automation': [AUTOMATION_NAME, OLD_NAME],
  'write-fallback-notify': [NOTIFY_NAME, OLD_NAME],
  'new-only-read': [READ_NAME],
  'new-only-automation': [AUTOMATION_NAME],
  'new-only-notify': [NOTIFY_NAME],
};
export const READ_FORMS = ['read-fallback', 'new-only-read'];
export const FALLBACK_FORMS = [
  'read-fallback',
  'write-fallback-automation',
  'write-fallback-notify',
];
export const WRITE_FORMS = {
  [AUTOMATION_NAME]: ['write-fallback-automation', 'new-only-automation'],
  [NOTIFY_NAME]: ['write-fallback-notify', 'new-only-notify'],
};
const ALL_WRITE_FORMS = Object.values(WRITE_FORMS).flat();

/**
 * The only write uses, by file + job + step name. `expected` is the PO decision (OSE-1695):
 * conformance opens a PR in this repo (automation token); notify-osm opens an issue in
 * another repo and gets its own token. Both are on their decided token, so
 * writeUsesOnWrongToken is 0 and may only stay there.
 */
export const WRITE_SITES = [
  {
    file: '.github/workflows/conformance-report.yml',
    job: 'generate',
    step: 'Open/update the conformance-refresh PR',
    env: 'GH_TOKEN',
    expected: AUTOMATION_NAME,
  },
  {
    file: '.github/workflows/notify-osm-flag-change.yml',
    job: 'notify',
    step: 'Open issue in OSM',
    env: 'GH_TOKEN',
    expected: NOTIFY_NAME,
  },
];

/**
 * Job-level GitHub environments (OSE-1695). The write tokens (and the branch-protection
 * read token) are ENVIRONMENT secrets of main-automation: a job sees them only when it
 * declares `environment: main-automation`, and GitHub starts such a job only from a ref the
 * environment's branch policy allows (branch main only).
 */
export const MAIN_AUTOMATION_ENV = 'main-automation';

/**
 * The only environment names a job may declare. Change this list only together with the
 * environment itself: environments are created or protected by scripts/hardening/apply-github.mjs
 * (steps release-tag-ruleset, production-gate, main-automation; OSE-1693). A name that is not
 * here (a typo, or a step name such as production-gate) would make GitHub create a new,
 * unprotected environment on first use.
 */
export const ALLOWED_ENVIRONMENTS = Object.freeze([
  'staging',
  'production',
  'copilot',
  MAIN_AUTOMATION_ENV,
]);

/**
 * The only jobs that may declare main-automation: the two write sites' jobs, and the
 * branch-protection drift job that reads BRANCH_PROTECTION_READ_TOKEN from it (it runs only
 * on schedule / dispatch). Each must declare exactly main-automation; any other job naming it
 * is red, so a new job cannot reach the write tokens without an owner decision here.
 */
export const MAIN_AUTOMATION_JOBS = Object.freeze([
  ...WRITE_SITES.map(({ file, job }) => ({ file, job })),
  { file: '.github/workflows/branch-protection-drift.yml', job: 'full-settings' },
]);

export const READ_REPOS = [
  'ourcommunityrituals/ourcommunityrituals',
  'ourcommunityrituals/ocr-docs',
];
export const STAGE_SCRIPT = /ci-stage-ocr-workspace/;
const PACKAGE_DIRS = ['workers', 'packages'];

const SECRET_REF = /secrets\s*(?:\.\s*([A-Za-z0-9_]+)|\[\s*['"]([A-Za-z0-9_]+)['"]\s*\])/gi;
const WHOLE_SECRETS = /\bsecrets\b(?!\s*[.[])/i;
const EXPR = /\$\{\{([\s\S]*?)\}\}/g;

const rel = (root, p) => relative(root, p).split(sep).join('/');

/**
 * Describe a token VALUE without ever printing it: only secret NAMES are shown. Anything
 * else (a literal, which could be a pasted credential, or another expression) is reported
 * by shape only.
 */
export function describeValue(v) {
  if (v === undefined || v === null || v === '') return 'not set';
  const s = String(v).trim();
  const m = /^\$\{\{([\s\S]*)\}\}$/.exec(s);
  if (m && !m[1].includes('}}')) {
    const names = [...m[1].matchAll(SECRET_REF)].map(
      (x) => `secrets.${(x[1] || x[2]).toUpperCase()}`
    );
    if (names.length) return `an expression naming ${names.join(', ')} (other text not printed)`;
    return 'an expression naming no secret (value not printed)';
  }
  return /\$\{\{/.test(s)
    ? 'text mixed with an expression (value not printed)'
    : 'a literal value (not printed; never put a credential in a workflow)';
}

/** Form of one expression body; null when it names none of the four secrets. */
export function classifyExpression(body) {
  const text = String(body ?? '');
  const refs = [...text.matchAll(SECRET_REF)].map((m) => (m[1] || m[2]).toUpperCase());
  const family = refs.filter((n) => FAMILY.has(n));
  if (!family.length) return WHOLE_SECRETS.test(text) ? 'unrecognized' : null;
  if (WHOLE_SECRETS.test(text)) return 'unrecognized';
  const operands = text
    .replace(/\s+/g, '')
    .split('||')
    .map((o) => /^secrets(?:\.([A-Za-z0-9_]+)|\[['"]([A-Za-z0-9_]+)['"]\])$/i.exec(o));
  if (operands.some((o) => !o)) return 'unrecognized';
  const names = operands.map((o) => (o[1] || o[2]).toUpperCase());
  for (const [form, want] of Object.entries(FORMS))
    if (want.length === names.length && want.every((n, i) => n === names[i])) return form;
  return 'unrecognized';
}

/** Form of a VALUE used as a token (an env value or `with.token`). */
export function classifyValue(v) {
  if (v === undefined || v === null || v === '') return 'missing';
  const s = String(v).trim();
  const m = /^\$\{\{([\s\S]*)\}\}$/.exec(s);
  if (m && !m[1].includes('}}')) return classifyExpression(m[1]) || 'other-expression';
  return /\$\{\{/.test(s) ? 'unrecognized' : 'literal';
}

/** Split `text` on a top-level operator, outside quotes and parentheses; null if unbalanced. */
function splitTop(text, op) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "'") {
        if (text[i + 1] === "'") i++;
        else quoted = false;
      }
    } else if (c === "'") quoted = true;
    else if (c === '(') depth++;
    else if (c === ')') {
      if (--depth < 0) return null;
    } else if (depth === 0 && text.startsWith(op, i)) {
      parts.push(text.slice(start, i));
      start = i + op.length;
      i += op.length - 1;
    }
  }
  if (quoted || depth !== 0) return null;
  parts.push(text.slice(start));
  return parts.map((p) => p.trim());
}

/** Drop parentheses that wrap the whole of `text`. */
function stripParens(text) {
  let t = text.trim();
  while (t.startsWith('(') && t.endsWith(')')) {
    const inner = t.slice(1, -1);
    if (splitTop(inner, '\u0000') === null) break; // the outer pair does not match
    t = inner.trim();
  }
  return t;
}

/** The value of one non-empty single-quoted literal, else null. */
function literalOf(text) {
  const m = /^'((?:[^']|'')+)'$/.exec(stripParens(text));
  return m ? m[1].replace(/''/g, "'") : null;
}

/**
 * Every value an environment expression body can produce, or null when that cannot be
 * proven. Only `c1 && 'a' || c2 && 'b' || 'c'` shapes resolve (any `&&` chain ending in a
 * literal, then a final literal): `||` takes the first truthy operand, a non-empty literal is
 * truthy, and a falsy chain falls through, so the outcomes are exactly those literals.
 * Anything else (a context value, a function call, a chain that can end falsy) fails closed.
 */
export function environmentOutcomes(body) {
  const ors = splitTop(stripParens(String(body ?? '')), '||');
  if (!ors || ors.some((o) => !o)) return null;
  const out = [];
  for (const [i, operand] of ors.entries()) {
    const ands = splitTop(stripParens(operand), '&&');
    if (!ands || ands.some((a) => !a)) return null;
    if (i === ors.length - 1 && ands.length !== 1) return null; // the last one can end falsy
    const lit = literalOf(ands[ands.length - 1]);
    if (lit === null) return null;
    out.push(lit);
  }
  return [...new Set(out)];
}

/**
 * A job's `environment:` value -> { names, why }. names: [] when none is declared, the list of
 * possible names when proven, null when it cannot be proven (fail closed). `why` names the
 * shape only; an unresolved value is never printed.
 */
export function resolveEnvironment(value) {
  if (value === undefined || value === null) return { names: [], why: 'no environment' };
  let v = value;
  if (typeof v === 'object' && !Array.isArray(v)) {
    if (typeof v.name !== 'string')
      return { names: null, why: 'an environment object with no name string' };
    v = v.name;
  }
  if (typeof v !== 'string')
    return { names: null, why: 'an environment that is not a string or { name }' };
  const s = v.trim();
  if (!s) return { names: null, why: 'an empty environment name' };
  const m = /^\$\{\{([\s\S]*)\}\}$/.exec(s);
  if (m && !m[1].includes('}}')) {
    const names = environmentOutcomes(m[1]);
    return names
      ? { names, why: `an expression that can only be ${names.join(' or ')}` }
      : { names: null, why: 'an expression whose possible names cannot be proven' };
  }
  if (/\$\{\{/.test(s)) return { names: null, why: 'text mixed with an expression' };
  return { names: [s], why: `"${s}"` };
}

/** Every family occurrence in one string, by form. `isIf` marks an `if:` value. */
function occurrencesIn(str, isIf) {
  const s = String(str);
  const out = [];
  let rest = s;
  for (const m of s.matchAll(EXPR)) {
    const f = classifyExpression(m[1]);
    if (f) out.push(f);
    rest = rest.replace(m[0], ' ');
  }
  if (isIf && !/\$\{\{/.test(s)) {
    const f = classifyExpression(s);
    if (f) out.push(f);
    return out;
  }
  // A family name outside any expression is never evaluated: fail closed, so prose
  // never hides a use (drop the `secrets.` prefix in prose).
  for (const m of rest.matchAll(SECRET_REF))
    if (FAMILY.has((m[1] || m[2]).toUpperCase())) out.push('unrecognized');
  return out;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** One walk of .github: workflows (top level) and composite actions (any depth). */
export function listSources(root) {
  const out = [];
  for (const abs of walk(join(root, '.github'))) {
    const r = rel(root, abs);
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(r)) out.push({ rel: r, abs, kind: 'workflow' });
    else if (/^\.github\/actions\/.+\/action\.ya?ml$/.test(r))
      out.push({ rel: r, abs, kind: 'action' });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** package.json script names whose command runs the staging script (root, workers/*, packages/*). */
export function stagingScriptAliases(root) {
  const files = [];
  if (existsSync(join(root, 'package.json'))) files.push(join(root, 'package.json'));
  for (const d of PACKAGE_DIRS) {
    const base = join(root, d);
    if (!existsSync(base)) continue;
    for (const sub of readdirSync(base)) {
      const p = join(base, sub, 'package.json');
      if (existsSync(p)) files.push(p);
    }
  }
  const out = [];
  for (const f of files) {
    let scripts;
    try {
      scripts = JSON.parse(readFileSync(f, 'utf8')).scripts || {};
    } catch {
      continue;
    }
    for (const [name, cmd] of Object.entries(scripts))
      if (STAGE_SCRIPT.test(String(cmd))) out.push({ file: rel(root, f), name });
  }
  return out;
}

function invokes(step, aliases) {
  if (step.run === undefined) return false;
  const text = String(step.run ?? '');
  if (STAGE_SCRIPT.test(text)) return true;
  if (
    step.env &&
    typeof step.env === 'object' &&
    Object.values(step.env).some((v) => STAGE_SCRIPT.test(String(v)))
  )
    return true;
  // `npm run <alias>` / `npm run-script <alias>`, matched on words (no dynamic RegExp).
  const words = text.split(/[\s;&|()]+/);
  return aliases.some(({ name }) =>
    words.some(
      (w, i) =>
        w === 'npm' &&
        (words[i + 1] === 'run' || words[i + 1] === 'run-script') &&
        words[i + 2] === name
    )
  );
}

function stepLabel(step, i) {
  if (step && step.name) return String(step.name);
  // Never echo run text (it could carry a credential); name the step by position instead.
  const what = step?.uses ? `uses ${String(step.uses).slice(0, 60)}` : 'run step';
  return `step #${i + 1} (unnamed ${what}; give it a name:)`;
}

const lowerKeys = (o) =>
  Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), v]));
const omit = (obj, ...keys) =>
  Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !keys.includes(k)));

/** Effective env: later layers win; an env given as an expression cannot be proven. */
function effectiveEnv(layers) {
  const env = {};
  for (const [where, layer] of layers) {
    if (layer === undefined || layer === null) continue;
    if (typeof layer !== 'object' || Array.isArray(layer))
      return { env: null, why: `${where} env is an expression, so the token cannot be proven` };
    Object.assign(env, layer);
  }
  return { env, why: '' };
}

/** Visit every key and string under `node`, with its key path. */
function visit(node, path, fn) {
  if (typeof node === 'string') return fn(node, path);
  if (Array.isArray(node)) return node.forEach((v, i) => visit(v, [...path, String(i)], fn));
  if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) {
      fn(k, [...path, `${k} (key)`]);
      visit(v, [...path, k], fn);
    }
}

/** Classify one parsed document. `kind` is 'workflow' or 'action'. */
export function analyzeDoc(doc, file, kind, aliases = []) {
  const occurrences = [];
  const sites = [];
  const mentions = [];
  const environments = [];
  const collect = (job, step, level, node, insideStaging = false) =>
    visit(node, [], (s, path) => {
      const isIf = path[path.length - 1] === 'if';
      for (const form of occurrencesIn(s, isIf))
        occurrences.push({ file, job, step, level, id: `${job} :: ${step}`, form });
      if (STAGE_SCRIPT.test(s) && !path[path.length - 1]?.endsWith('(key)'))
        mentions.push({
          file,
          job,
          step,
          level,
          where: path.join('.'),
          ok: insideStaging || (kind === 'workflow' && level === 'workflow' && path[0] === 'on'),
        });
    });

  const jobs =
    kind === 'action'
      ? { '(composite action)': { steps: doc?.runs?.steps || [] } }
      : doc?.jobs && typeof doc.jobs === 'object'
        ? doc.jobs
        : {};

  if (kind === 'workflow') collect('(workflow)', '(workflow level)', 'workflow', omit(doc, 'jobs'));
  else
    collect('(composite action)', '(action level)', 'action', [
      omit(doc, 'runs'),
      omit(doc?.runs, 'steps'),
    ]);

  // A composite action has no job level, so it can never declare an environment.
  if (kind === 'action' && doc && typeof doc === 'object')
    for (const [where, node] of [
      ['(action level)', doc],
      ['(runs level)', doc.runs],
    ])
      if (node && typeof node === 'object' && 'environment' in node)
        environments.push({
          file,
          job: '(composite action)',
          id: `(composite action) :: ${where}`,
          names: null,
          why: 'a composite action cannot declare an environment',
        });

  for (const [jobName, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object') continue;
    if (kind === 'workflow') collect(jobName, '(job level)', 'job', omit(job, 'steps'));
    const jobEnv = kind === 'workflow' ? resolveEnvironment(job.environment) : { names: [] };
    if (kind === 'workflow' && job.environment !== undefined)
      environments.push({ file, job: jobName, id: `${jobName} :: (job level)`, ...jobEnv });
    const steps = Array.isArray(job.steps) ? job.steps : [];
    steps.forEach((step, i) => {
      if (!step || typeof step !== 'object') return;
      const label = stepLabel(step, i);
      const id = `${jobName} :: ${label}`;
      const staging = invokes(step, aliases);
      collect(jobName, label, 'step', step, staging);

      if (staging) {
        let form;
        let why = '';
        if (kind === 'action') {
          form = 'composite';
          why = 'composite actions cannot read secrets; invoke the script from a workflow step';
        } else {
          const { env, why: w } = effectiveEnv([
            ['workflow', doc.env],
            ['job', job.env],
            ['step', step.env],
          ]);
          if (!env) {
            form = 'unprovable';
            why = w;
          } else {
            form = classifyValue(env[SCRIPT_TOKEN_ENV]);
            why = `${SCRIPT_TOKEN_ENV} is ${describeValue(env[SCRIPT_TOKEN_ENV])}`;
          }
        }
        sites.push({
          file,
          job: jobName,
          step: label,
          id,
          right: 'read',
          kind: 'staging',
          form,
          why,
        });
      }

      if (/^actions\/checkout(@|$)/i.test(String(step.uses || ''))) {
        const w = lowerKeys(step.with);
        const repo = String(w.repository || '').toLowerCase();
        if (READ_REPOS.includes(repo)) {
          const form = kind === 'action' ? 'composite' : classifyValue(w.token);
          sites.push({
            file,
            job: jobName,
            step: label,
            id,
            right: 'read',
            kind: 'checkout',
            form,
            why: `token is ${describeValue(w.token)}`,
          });
        }
      }

      const ws = WRITE_SITES.find(
        (x) => kind === 'workflow' && x.file === file && x.job === jobName && x.step === label
      );
      if (ws) {
        const { env, why: w } = effectiveEnv([
          ['workflow', doc.env],
          ['job', job.env],
          ['step', step.env],
        ]);
        const form = env ? classifyValue(env[ws.env]) : 'unprovable';
        sites.push({
          file,
          job: jobName,
          step: label,
          id,
          right: 'write',
          kind: 'write',
          expected: ws.expected,
          form,
          why: env ? `${ws.env} is ${describeValue(env[ws.env])}` : w,
          environment: jobEnv.names,
          environmentWhy: jobEnv.why,
          inMainAutomation: declaresExactly(jobEnv.names, MAIN_AUTOMATION_ENV),
        });
      }
    });
  }
  return { occurrences, sites, mentions, environments };
}

/** True when the proven names are exactly [name]. */
const declaresExactly = (names, name) =>
  Array.isArray(names) && names.length === 1 && names[0] === name;

/** A job may (possibly) use main-automation: any proven name equal to it, ignoring case. */
const mayUse = (names, name) =>
  Array.isArray(names) && names.some((n) => n.toLowerCase() === name.toLowerCase());

/** Job-level environments that are unproven or not in ALLOWED_ENVIRONMENTS. Names only. */
export function environmentNameProblems(environments) {
  return environments
    .filter((e) => !e.names || !e.names.every((n) => ALLOWED_ENVIRONMENTS.includes(n)))
    .map((e) =>
      e.names
        ? `${e.file} :: ${e.id}: environment ${e.names.map((n) => `"${n}"`).join(' or ')} is not one of ${ALLOWED_ENVIRONMENTS.join(', ')}`
        : `${e.file} :: ${e.id}: ${e.why} (unrecognized; it must resolve to one of ${ALLOWED_ENVIRONMENTS.join(', ')})`
    );
}

/**
 * main-automation users: every MAIN_AUTOMATION_JOBS job declares exactly main-automation (the
 * write sites included), and no other job may use it. Names only.
 */
export function mainAutomationProblems(scanResult) {
  const problems = [];
  const allowed = new Set(MAIN_AUTOMATION_JOBS.map((j) => `${j.file} :: ${j.job}`));
  for (const x of scanResult.sites.filter((s) => s.right === 'write'))
    if (!x.inMainAutomation)
      problems.push(
        `write site ${x.file} :: ${x.id}: its job declares ${x.environmentWhy}, not exactly environment ${MAIN_AUTOMATION_ENV}`
      );
  for (const j of MAIN_AUTOMATION_JOBS) {
    const e = scanResult.environments.find((x) => x.file === j.file && x.job === j.job);
    if (!e || !declaresExactly(e.names, MAIN_AUTOMATION_ENV))
      problems.push(
        `${j.file} :: ${j.job}: listed in MAIN_AUTOMATION_JOBS but declares ${e ? e.why : 'no environment'}, not exactly ${MAIN_AUTOMATION_ENV}`
      );
  }
  for (const e of scanResult.environments)
    if (mayUse(e.names, MAIN_AUTOMATION_ENV) && !allowed.has(`${e.file} :: ${e.job}`))
      problems.push(
        `${e.file} :: ${e.id}: declares ${MAIN_AUTOMATION_ENV} but is not in MAIN_AUTOMATION_JOBS (its secrets are write tokens; a new user is an owner decision, OSE-1695)`
      );
  return problems;
}

const cache = new Map();

/** Enumerate the tree under `root` (memoised per process: callers share one walk). */
export function scan(root, { fresh = false } = {}) {
  if (!fresh && cache.has(root)) return cache.get(root);
  const aliases = stagingScriptAliases(root);
  const result = {
    sources: [],
    aliases,
    occurrences: [],
    sites: [],
    mentions: [],
    environments: [],
    parseErrors: [],
  };
  for (const src of listSources(root)) {
    result.sources.push(src.rel);
    let doc;
    try {
      doc = yaml.load(readFileSync(src.abs, 'utf8'));
    } catch (e) {
      result.parseErrors.push(`${src.rel}: ${String(e.message).split('\n')[0]}`);
      continue;
    }
    const r = analyzeDoc(doc, src.rel, src.kind, aliases);
    result.occurrences.push(...r.occurrences);
    result.sites.push(...r.sites);
    result.mentions.push(...r.mentions);
    result.environments.push(...r.environments);
  }
  cache.set(root, result);
  return result;
}

/** { total, byFile: { file: { count, steps: [id] } } } for a list of entries. */
export function groupByFile(entries) {
  const byFile = {};
  for (const e of entries) {
    const b = (byFile[e.file] ||= { count: 0, steps: [] });
    b.count += 1;
    b.steps.push(e.id);
  }
  for (const b of Object.values(byFile)) b.steps.sort();
  return { total: entries.length, byFile };
}

/** A read site whose token is in no recognized form (bare and unrecognized are counted elsewhere). */
export const readSiteUnrecognized = (s) =>
  s.right === 'read' && ![...READ_FORMS, 'bare', 'unrecognized'].includes(s.form);
export const writeSiteOnExpected = (s) => (WRITE_FORMS[s.expected] || []).includes(s.form);

/** The seven ratchet measurements, from one scan. Names, ids and counts only; never values. */
export function measureTokenSplit(root) {
  const s = scan(root);
  const reads = s.sites.filter((x) => x.right === 'read');
  const writes = s.sites.filter((x) => x.right === 'write');
  const badOcc = s.occurrences.filter((o) => o.form === 'unrecognized');
  const badReads = reads.filter(readSiteUnrecognized);
  const wrong = writes.filter((x) => !writeSiteOnExpected(x));
  // Why each entry is counted (names and shapes only, never values); for messages.
  const whyOf = (list, fn) => Object.fromEntries(list.map((x) => [`${x.file} :: ${x.id}`, fn(x)]));
  return {
    readUsesOnNewSecret: groupByFile(reads.filter((x) => READ_FORMS.includes(x.form))),
    writeUsesOnNewSecret: groupByFile(writes.filter((x) => ALL_WRITE_FORMS.includes(x.form))),
    writeSitesInMainAutomation: groupByFile(writes.filter((x) => x.inMainAutomation)),
    bareOldTokenUses: groupByFile(s.occurrences.filter((o) => o.form === 'bare')),
    fallbackUses: groupByFile(s.occurrences.filter((o) => FALLBACK_FORMS.includes(o.form))),
    writeUsesOnWrongToken: {
      ...groupByFile(wrong),
      why: whyOf(wrong, (x) => `expected secrets.${x.expected}; ${x.why}`),
    },
    unrecognizedTokenForms: {
      ...groupByFile([...badOcc, ...badReads]),
      why: {
        ...whyOf(badOcc, (o) => `${o.level}-level token expression in no recognized form`),
        ...whyOf(
          badReads,
          (x) => `${x.kind} site with no recognized read token (${x.form}): ${x.why}`
        ),
      },
    },
    tokenSplitParseErrors: s.parseErrors,
  };
}
