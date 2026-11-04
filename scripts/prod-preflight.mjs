#!/usr/bin/env node
/**
 * Production preflight.
 *
 * Run this before you dispatch the production deploy. It prints one line per
 * check (PASS, FAIL or TODO) with what to do, and exits non-zero unless every
 * check passed.
 *
 *   node scripts/prod-preflight.mjs              every check
 *   node scripts/prod-preflight.mjs --repo-only  only the checks that read this checkout
 *   node scripts/prod-preflight.mjs --activation  also fails on an empty CF_ACCESS_AUD (before going live)
 *   node scripts/prod-preflight.mjs --inputs <dir> --sha <commit>
 *
 * It is read-only. It makes no network request, runs no wrangler command and
 * reads no credential. Five checks need something only you can read (the names
 * of the production secrets, what production still has to migrate, two CI runs).
 * You run those commands yourself and save what they print into `.preflight/`
 * (ignored by git); the script reads the files. A check with no file is TODO,
 * and TODO is not a pass.
 *
 * Every check is a pure function of the text it is given, so each one is
 * tested with fixtures in tests/unit/ci/prod-preflight.test.js.
 *
 * What it cannot prove is printed at the end of every run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── what the checks compare against ─────────────────────────────────────────

/** Same two lists as the "required secrets present" gate in deploy-production. */
export const REQUIRED_SECRETS = [
  'SHARED_REPORT_SIGNING_SECRET',
  'FORMS_ENCRYPTION_KEY',
  'FORMS_HASH_PEPPER',
  'RATE_LIMIT_KEY_PEPPER',
  'ANON_ID_HASH_PEPPER',
];
export const FORBIDDEN_SECRETS = ['ADMIN_KEY', 'X_OCR_INTERNAL', 'ADMIN_TOKEN'];

/** Settings staging has on purpose and production must never have. */
export const STAGING_ONLY_VARS = [
  'ADMIN_SCOPE_ALL',
  'ALLOW_ADMIN_KEY_FALLBACK',
  'ALLOW_OCR_INTERNAL',
  // OSE-1800: the CI service actor's synthetic brand; production has no svc actor.
  'CI_SERVICE_ACTOR_BRAND',
];

/** Job names of the staging chain, as the CI workflow prints them. */
export const STAGING_JOBS = [
  'T1 Deploy → Staging',
  'T2 Contract → Staging (Bruno)',
  'T3 E2E Smoke → Staging (Playwright)',
  'T4 Functional → Staging',
];
export const ACCESS_CANARY_JOB = 'Access app routing — production';

export const PRODUCTION_WORKER_NAME = 'oursharedevents-prod';
export const PRODUCTION_HOST = 'oursharedevents.com';
export const PRODUCTION_BACKUP_DATASET = 'oursharedevents_backup';
export const PLAN_PATH = 'docs/runbooks/PRODUCTION-MIGRATION-PLAN.md';
export const INPUT_DIR = '.preflight';
export const INPUT_FILES = {
  names: 'secrets.txt',
  migrationsDb: 'migrations-db.txt',
  migrationsForms: 'migrations-forms.txt',
  stagingRun: 'staging-run.json',
  accessCanary: 'access-canary.json',
};

const WORKER = 'workers/oursharedevents';
const PLACEHOLDER = /^(PROVISION|TODO|REPLACE|CHANGEME|FIXME|<.*>)/i;
const ID_KEYS = [
  'id',
  'database_id',
  'database_name',
  'bucket_name',
  'namespace_id',
  'queue',
  'dead_letter_queue',
];

/** Where each schema constant is declared in schema-guard.ts. */
const CONSTANT = {
  REQUIRED_DB_MIGRATION: /export const REQUIRED_DB_MIGRATION\s*=\s*(\d+)/,
  REQUIRED_FORMS_MIGRATION: /export const REQUIRED_FORMS_MIGRATION\s*=\s*(\d+)/,
};

const pass = (id, title, detail, extra = {}) => ({ id, title, status: 'pass', detail, ...extra });
const fail = (id, title, detail, fix, extra = {}) => ({
  id,
  title,
  status: 'fail',
  detail,
  fix,
  ...extra,
});
const todo = (id, title, fix) => ({ id, title, status: 'todo', detail: 'no input file yet', fix });

// ── reading text ────────────────────────────────────────────────────────────

/**
 * Bytes to text. Windows PowerShell 5 writes `>` output as UTF-16 with a mark
 * at the front; everything else writes UTF-8, with or without a mark.
 */
export function decodeText(bytes) {
  const b = Buffer.from(bytes);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
    return b.subarray(3).toString('utf8');
  return b.toString('utf8');
}

const lines = (text) => String(text).split(/\r?\n/);

/**
 * A small reader for the parts of wrangler.toml the checks need: section
 * headers and `key = value` lines. Comments are dropped. A value that opens a
 * bracket is read to its closing bracket and kept as raw text.
 * Returns [{ header, array, values }] in file order; the top of the file is header ''.
 */
export function parseToml(text) {
  const sections = [{ header: '', array: false, values: {} }];
  const src = lines(text);
  for (let i = 0; i < src.length; i++) {
    const line = src[i].trim();
    if (!line || line.startsWith('#')) continue;
    const head = line.startsWith('[') ? /^(\[\[?)([^\]]+)\]/.exec(line) : null;
    if (head) {
      sections.push({ header: head[2].trim(), array: head[1] === '[[', values: {} });
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2];
    if (value.startsWith('"')) {
      const end = value.indexOf('"', 1);
      value = end === -1 ? value.slice(1) : value.slice(1, end);
    } else if (value.startsWith('[') || value.startsWith('{')) {
      const depth = (s) => (s.match(/[[{]/g) || []).length - (s.match(/[\]}]/g) || []).length;
      while (depth(value) > 0 && i + 1 < src.length) {
        const next = src[++i].trim();
        if (!next.startsWith('#')) value += `\n${next}`;
      }
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    sections[sections.length - 1].values[kv[1]] = value;
  }
  return sections;
}

const section = (sections, header) => sections.find((s) => s.header === header);

/** Bindings declared for one environment ('' is the top of the file, used by local dev). */
function bindingsOf(sections, envName) {
  const prefix = envName ? `env.${envName}.` : '';
  return sections
    .filter(
      (s) => s.array && (envName ? s.header.startsWith(prefix) : !s.header.startsWith('env.'))
    )
    .map((s) => ({
      kind: s.header.slice(prefix.length),
      name: s.values.binding ?? s.values.name ?? s.values.queue ?? '(unnamed)',
      ids: ID_KEYS.filter((k) => s.values[k] !== undefined).map((k) => [k, s.values[k]]),
    }));
}

const short = (sha) => String(sha || '').slice(0, 7);
const numberOf = (file) => parseInt(file.slice(0, 4), 10);
const migrationFiles = (names) => (names || []).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const pad = (n) => String(n).padStart(4, '0');

// ── checks that read this checkout ──────────────────────────────────────────

/**
 * The Worker refuses to serve when a database is below REQUIRED_*_MIGRATION,
 * and it measures the database by how many migrations ran. So the constants
 * must equal the highest file number, and the numbers must run 1..N with no
 * hole and no repeat, or the count and the number can never agree.
 */
export function checkSchemaConstants({ db, forms, guardSource }) {
  const id = 'schema-constants';
  const title = 'Schema constants match the migration files';
  const fix = `Set the constant to the highest file number in ${WORKER}/src/lib/schema-guard.ts, and give every migration its own next number.`;
  const problems = [];
  const levels = [];
  for (const [label, constant, names] of [
    ['main', 'REQUIRED_DB_MIGRATION', db],
    ['forms', 'REQUIRED_FORMS_MIGRATION', forms],
  ]) {
    const found = CONSTANT[constant].exec(String(guardSource));
    const files = migrationFiles(names);
    if (!found) {
      problems.push(`${constant} was not found in schema-guard.ts`);
      continue;
    }
    if (!files.length) {
      problems.push(`no ${label} migration files were found`);
      continue;
    }
    const want = parseInt(found[1], 10);
    const numbers = files.map(numberOf);
    const highest = Math.max(...numbers);
    if (want !== highest)
      problems.push(`${constant} is ${want} but the highest file is ${highest}`);
    const repeats = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))];
    if (repeats.length)
      problems.push(`${label}: more than one file is numbered ${repeats.map(pad).join(', ')}`);
    const holes = [];
    for (let n = 1; n <= highest; n++) if (!numbers.includes(n)) holes.push(pad(n));
    if (holes.length) problems.push(`${label}: no file is numbered ${holes.join(', ')}`);
    levels.push(`${label} ${want}`);
  }
  return problems.length
    ? fail(id, title, problems.join('; '), fix)
    : pass(id, title, levels.join(', '));
}

/** Production has every binding staging has, each with its own real id. */
export function checkProductionBindings(toml) {
  const id = 'bindings';
  const title = 'Production bindings are real and are not shared';
  const fix = `Edit the [env.production] blocks in ${WORKER}/wrangler.toml.`;
  const sections = parseToml(toml);
  if (!section(sections, 'env.production')) {
    return fail(id, title, 'wrangler.toml has no [env.production] section', fix);
  }
  const prod = bindingsOf(sections, 'production');
  const staging = bindingsOf(sections, 'staging');
  const local = bindingsOf(sections, '');
  const valuesOf = (list) => new Set(list.flatMap((b) => b.ids.map(([, v]) => v)));
  const stagingValues = valuesOf(staging);
  const localValues = valuesOf(local);
  const problems = [];
  for (const b of prod) {
    for (const [key, value] of b.ids) {
      if (PLACEHOLDER.test(value))
        problems.push(`${b.name}: ${key} is still a placeholder ("${value}")`);
      else if (stagingValues.has(value)) problems.push(`${b.name}: ${key} "${value}" is staging's`);
      else if (localValues.has(value))
        problems.push(`${b.name}: ${key} "${value}" is the local development value`);
    }
  }
  const have = new Set(prod.map((b) => `${b.kind}/${b.name}`));
  for (const b of staging) {
    // The scan queue is dark on production until it has queues of its own.
    if (b.kind.startsWith('queues.')) continue;
    if (!have.has(`${b.kind}/${b.name}`))
      problems.push(`${b.name} (${b.kind}) is on staging but not on production`);
  }
  return problems.length
    ? fail(id, title, problems.join('; '), fix)
    : pass(id, title, `${prod.length} bindings, none shared with staging or local dev`);
}

/** What [env.production.vars] must have, and what it must never have. */
export function checkProductionVars(toml, { activation = false } = {}) {
  const id = 'vars';
  const title = 'Production settings are complete and carry no staging switch';
  const fix = `Edit [env.production.vars] in ${WORKER}/wrangler.toml. A setting only staging should have goes in STAGING_ONLY_VARS in scripts/prod-preflight.mjs.`;
  const sections = parseToml(toml);
  const vars = section(sections, 'env.production.vars')?.values;
  if (!vars) return fail(id, title, 'wrangler.toml has no [env.production.vars] section', fix);
  const stagingVars = section(sections, 'env.staging.vars')?.values ?? {};
  const problems = [];
  for (const name of [...STAGING_ONLY_VARS, ...FORBIDDEN_SECRETS, 'MOCK_MODE']) {
    if (name in vars) problems.push(`${name} is set on production and must not be`);
  }
  if (vars.WORKER_ENV !== 'production') {
    problems.push(`WORKER_ENV is "${vars.WORKER_ENV ?? ''}", not exactly "production"`);
  }
  if (!vars.CF_ACCESS_TEAM_DOMAIN)
    problems.push('CF_ACCESS_TEAM_DOMAIN is empty, so no admin sign-in can be verified');
  if (!vars.ALLOWED_ADMIN_EMAILS && !vars.ALLOWED_ADMIN_DOMAINS) {
    problems.push(
      'ALLOWED_ADMIN_EMAILS and ALLOWED_ADMIN_DOMAINS are both empty, so nobody is an admin'
    );
  }
  if (
    vars.BIGQUERY_DATASET_ID !== undefined &&
    vars.BIGQUERY_DATASET_ID !== PRODUCTION_BACKUP_DATASET
  ) {
    problems.push(
      `BIGQUERY_DATASET_ID is "${vars.BIGQUERY_DATASET_ID}", not "${PRODUCTION_BACKUP_DATASET}"`
    );
  }
  for (const [name, value] of Object.entries(vars)) {
    if (/(^|[^a-z])(stg|staging)([^a-z]|$)/i.test(value) && name !== 'BIGQUERY_DATASET_ID') {
      problems.push(`${name} points at staging ("${value}")`);
    }
  }
  for (const name of Object.keys(stagingVars)) {
    if (!(name in vars) && !STAGING_ONLY_VARS.includes(name)) {
      problems.push(
        `${name} is set on staging but not on production (a named environment inherits nothing)`
      );
    }
  }
  // Updating production keeps it ready and does not make it live, so an empty audience is a
  // note there. Activation is the act that exposes the admin to the outside, and the audience
  // pin is dark when empty (admin.ts), so for activation it is a failure (CCR 2026-10-12, A5).
  if (activation && !vars.CF_ACCESS_AUD) {
    problems.push(
      'CF_ACCESS_AUD is empty, so the Access audience is not pinned and any Access app in the team can sign an admin token (OSE-1377)'
    );
  }
  if (problems.length) return fail(id, title, problems.join('; '), fix);
  const note = vars.CF_ACCESS_AUD
    ? ''
    : ' Note: CF_ACCESS_AUD is empty, so the Access audience is not pinned yet (OSE-1377).';
  return pass(id, title, `${Object.keys(vars).length} settings.${note}`);
}

/** The Worker name, the hosts it answers on, and the nightly job. */
export function checkProductionRoutes(toml) {
  const id = 'routes';
  const title = 'Production name, routes and nightly job';
  const fix = `Edit [env.production] and [env.production.triggers] in ${WORKER}/wrangler.toml.`;
  const sections = parseToml(toml);
  const prod = section(sections, 'env.production')?.values;
  if (!prod) return fail(id, title, 'wrangler.toml has no [env.production] section', fix);
  const problems = [];
  if (prod.name !== PRODUCTION_WORKER_NAME) {
    problems.push(`the Worker name is "${prod.name ?? ''}", not "${PRODUCTION_WORKER_NAME}"`);
  }
  const patterns = [...String(prod.routes ?? '').matchAll(/pattern\s*=\s*"([^"]+)"/g)].map(
    (m) => m[1]
  );
  if (!patterns.includes(`${PRODUCTION_HOST}/*`))
    problems.push(`no route for ${PRODUCTION_HOST}/*`);
  for (const p of patterns) {
    const host = p.split('/')[0];
    if (host !== PRODUCTION_HOST && host !== `www.${PRODUCTION_HOST}`) {
      problems.push(`route "${p}" is not a production host`);
    }
  }
  const crons = section(sections, 'env.production.triggers')?.values.crons ?? '';
  if (!/"[^"]+"/.test(crons)) {
    problems.push(
      'production has no nightly job ([env.production.triggers] crons); retention and exports would never run'
    );
  }
  return problems.length
    ? fail(id, title, problems.join('; '), fix)
    : pass(
        id,
        title,
        `${PRODUCTION_WORKER_NAME} on ${patterns.join(' and ')}, nightly job ${crons}`
      );
}

/**
 * The deploy step stamps the build with
 *   sed 's/WORKER_BUILD_VERSION = "prod-.*"/WORKER_BUILD_VERSION = "prod-<sha>-<date>"/'
 * If no line matches, sed changes nothing and says nothing, and /health reports
 * the placeholder. That is how production came to report a version CI never makes.
 */
export function checkBuildStamp(toml) {
  const id = 'build-stamp';
  const title = 'The deploy step can stamp the build version';
  const fix = `Keep exactly one line in ${WORKER}/wrangler.toml written as: WORKER_BUILD_VERSION = "prod-..." (one space each side of =), inside [env.production.vars].`;
  const matching = lines(toml).filter((l) => /WORKER_BUILD_VERSION = "prod-.*"/.test(l));
  const inProd = section(parseToml(toml), 'env.production.vars')?.values.WORKER_BUILD_VERSION ?? '';
  if (matching.length !== 1) {
    return fail(
      id,
      title,
      `${matching.length} lines match what the deploy step rewrites; it must be exactly 1`,
      fix
    );
  }
  if (!inProd.startsWith('prod-')) {
    return fail(id, title, 'the matching line is not the one in [env.production.vars]', fix);
  }
  return pass(id, title, 'one line matches, in [env.production.vars]');
}

// ── checks that read a file the operator made ───────────────────────────────

/** Names only. Nothing from the file is ever repeated in the output. */
export function checkSecrets(text) {
  const id = 'secrets';
  const title = 'Production secrets (names only)';
  const command = `in ${WORKER}, run: npx wrangler secret list --env production > ../../${INPUT_DIR}/${INPUT_FILES.names}`;
  if (text === undefined) return todo(id, title, command);
  let names = null;
  const open = text.indexOf('[');
  const close = text.lastIndexOf(']');
  if (open !== -1 && close > open) {
    try {
      const list = JSON.parse(text.slice(open, close + 1));
      if (Array.isArray(list) && list.every((s) => s && typeof s.name === 'string')) {
        names = new Set(list.map((s) => s.name));
      }
    } catch {
      names = null;
    }
  }
  if (!names) {
    // wrangler may print a banner or a notice around the list; the name fields still say what is set.
    const found = [...text.matchAll(/"name"\s*:\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
    if (found.length) names = new Set(found);
  }
  if (!names) {
    return fail(
      id,
      title,
      'the file is not a secret list (wrangler may have printed an error instead)',
      `Run it again: ${command}`
    );
  }
  const missing = REQUIRED_SECRETS.filter((n) => !names.has(n));
  const present = FORBIDDEN_SECRETS.filter((n) => names.has(n));
  if (missing.length || present.length) {
    const detail = [
      missing.length ? `missing: ${missing.join(', ')}` : '',
      present.length ? `set but must not be: ${present.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    const fixes = [
      missing.length ? 'bash scripts/set-secrets.sh production' : '',
      ...present.map((n) => `npx wrangler secret delete ${n} --env production`),
    ].filter(Boolean);
    return fail(id, title, detail, fixes.join(' ; '));
  }
  return pass(
    id,
    title,
    `${REQUIRED_SECRETS.length} required names present, no static admin credential`
  );
}

/**
 * What production still has to apply, read from `wrangler d1 migrations list`.
 * The deploy applies them, so being behind is fine. What is not fine is a list
 * that is not simply "the last N migrations in a row up to what the build needs".
 */
export function checkPendingMigrations({ binding, text, files, required }) {
  const id = `pending-${binding}`;
  const title = `Migrations production ${binding} still has to apply`;
  const command = `in ${WORKER}, run: npx wrangler d1 migrations list ${binding} --env production --remote > ../../${INPUT_DIR}/${
    binding === 'DB' ? INPUT_FILES.migrationsDb : INPUT_FILES.migrationsForms
  }`;
  if (text === undefined) return todo(id, title, command);
  const named = [...new Set(text.match(/\b\d{4}_[A-Za-z0-9_.-]*\.sql\b/g) || [])].sort();
  const none = /no migrations to apply/i.test(text);
  if (named.length === 0 && !none) {
    return fail(
      id,
      title,
      `the list for ${binding} could not be read (empty, or wrangler printed an error)`,
      `Run it again: ${command}`
    );
  }
  if (named.length > 0 && none) {
    return fail(
      id,
      title,
      `the list for ${binding} could not be read (it says both "nothing to apply" and names files)`,
      `Run it again: ${command}`
    );
  }
  const repo = migrationFiles(files);
  const unknown = named.filter((n) => !repo.includes(n));
  if (unknown.length) {
    return fail(
      id,
      title,
      `${binding}: the list names files this checkout does not have: ${unknown.join(', ')}`,
      'Run the command from the commit you are about to deploy (git pull on main first).'
    );
  }
  const level = required - named.length;
  const expected = repo.filter((f) => numberOf(f) > level && numberOf(f) <= required);
  if (expected.join() !== named.join()) {
    return fail(
      id,
      title,
      `${binding}: the list is not the last ${named.length} migrations in a row up to ${pad(required)} (it has ${named
        .map((n) => n.slice(0, 4))
        .join(', ')})`,
      'Stop. An older migration never ran, or this checkout is not the build you mean to deploy. Do not deploy until you know which.'
    );
  }
  const detail = named.length
    ? `production ${binding} is at ${level}; this build needs ${required}. The deploy applies ${named.length}: ${named[0].slice(0, 4)} to ${named[
        named.length - 1
      ].slice(0, 4)}`
    : `production ${binding} is at ${required}, which is what this build needs. Nothing to apply`;
  return pass(id, title, detail, { level, pending: named });
}

/**
 * Statements in a migration that write or remove rows, in file order:
 * DELETE FROM, UPDATE, DROP TABLE, INSERT INTO. Comments are ignored.
 */
export function dataChanges(sql) {
  const code = String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
  const out = [];
  for (const statement of code.split(';')) {
    // One space between words, so the pattern below needs no repeats inside repeats.
    const flat = statement.trim().split(/\s+/).join(' ');
    const m =
      /^(DELETE FROM|UPDATE|DROP TABLE IF EXISTS|DROP TABLE|INSERT OR [A-Za-z]+ INTO|INSERT INTO) ["`]?([A-Za-z_]\w*)/i.exec(
        flat
      );
    if (!m) continue;
    const verb = m[1]
      .toUpperCase()
      .replace(' IF EXISTS', '')
      .replace(/^INSERT OR [A-Z]+ INTO$/, 'INSERT INTO');
    out.push(`${verb} ${m[2]}`);
  }
  return out;
}

/** Every migration the deploy will apply has a line in the written plan. */
export function checkPlanCoverage({ pending, planText }) {
  const id = 'migration-plan';
  const title = 'The written migration plan covers what will be applied';
  if (pending === undefined) {
    return todo(id, title, 'Make the two migration list files first (see the two lines above).');
  }
  if (pending.length === 0) return pass(id, title, 'nothing to apply');
  const describe = (p) => {
    const changes = dataChanges(p.sql);
    return changes.length ? `${p.file} (${changes.join(', ')})` : p.file;
  };
  if (planText === undefined) {
    return fail(id, title, `${PLAN_PATH} is missing`, `Restore ${PLAN_PATH} from main.`);
  }
  const missing = pending.filter((p) => !planText.includes(p.file));
  if (missing.length) {
    return fail(
      id,
      title,
      `not in the plan: ${missing.map((p) => `${p.binding} ${describe(p)}`).join('; ')}`,
      `Read each file, then add its line to ${PLAN_PATH}: what it does, and whether it deletes or rewrites rows.`
    );
  }
  const changing = pending.filter((p) => dataChanges(p.sql).length);
  return pass(
    id,
    title,
    `${pending.length} to apply, all in ${PLAN_PATH}. ${changing.length} write or remove rows: ${
      changing.map(describe).join('; ') || 'none'
    }`
  );
}

/**
 * Job names carry an arrow or a long dash. Windows PowerShell 5 re-encodes them
 * when it saves a command's output, so names are compared on their plain letters
 * and digits only.
 */
const plain = (name) =>
  String(name ?? '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
const jobNamed = (run, name) => run.jobs.find((j) => plain(j.name) === plain(name));

function parseRun(text) {
  try {
    const run = JSON.parse(text.slice(text.indexOf('{')));
    return run && Array.isArray(run.jobs) ? run : null;
  } catch {
    return null;
  }
}

/** T1 to T4 on staging passed, on main, for the commit about to be deployed. */
export function checkStagingChain({ text, sha }) {
  const id = 'staging-chain';
  const title = 'The staging chain is green for this commit';
  const command = `find the run: gh run list --workflow "OurSharedEvents CI/CD" --branch main --event push --limit 5 ; then save it: gh run view <id> --json headSha,headBranch,event,conclusion,jobs > ${INPUT_DIR}/${INPUT_FILES.stagingRun}`;
  if (text === undefined) return todo(id, title, command);
  const run = parseRun(text);
  if (!run)
    return fail(
      id,
      title,
      'the file is not a CI run (gh may have printed an error instead)',
      `Run it again: ${command}`
    );
  const want = String(sha || '')
    .trim()
    .toLowerCase();
  const got = String(run.headSha || '').toLowerCase();
  if (!want)
    return fail(
      id,
      title,
      'no commit id to compare with',
      'Pass --sha <commit>, or run this inside the git checkout.'
    );
  if (!got || !(got.startsWith(want) || want.startsWith(got))) {
    return fail(
      id,
      title,
      `the run is for ${short(got) || 'an unknown commit'} but you are about to deploy ${short(want)}`,
      'git pull on main so your checkout is the commit CI tested, or save the run for the commit you mean (pass --sha <commit>).'
    );
  }
  if (run.headBranch !== 'main') {
    return fail(
      id,
      title,
      `the run is from branch "${run.headBranch ?? ''}", not main`,
      'Save a run of main.'
    );
  }
  const problems = [];
  for (const name of STAGING_JOBS) {
    const job = jobNamed(run, name);
    if (!job) problems.push(`${name}: not in the run`);
    else if (job.conclusion !== 'success')
      problems.push(`${name}: ${job.conclusion || 'still running'}`);
  }
  if (problems.length) {
    return fail(
      id,
      title,
      problems.join('; '),
      'Wait for the run to finish, or mend what failed on main first. The deploy job needs the same four stages green in its own run.'
    );
  }
  return pass(id, title, `T1 to T4 passed on main for ${short(got)}`);
}

/**
 * The deploy job ends by checking that production /admin is challenged by
 * production's own Cloudflare Access app. If it is not, that last step fails
 * AFTER the Worker is live. The Access canary runs the same question every six
 * hours, so its latest run answers it before you deploy.
 */
export function checkAccessApp({ text }) {
  const id = 'access-app';
  const title = 'Production admin is behind its own Cloudflare Access app';
  const command = `find the run: gh run list --workflow "CF Access Canary" --limit 1 ; then save it: gh run view <id> --json conclusion,jobs > ${INPUT_DIR}/${INPUT_FILES.accessCanary}`;
  if (text === undefined) return todo(id, title, command);
  const run = parseRun(text);
  if (!run)
    return fail(
      id,
      title,
      'the file is not a CI run (gh may have printed an error instead)',
      `Run it again: ${command}`
    );
  const job = jobNamed(run, ACCESS_CANARY_JOB);
  if (!job || job.conclusion !== 'success') {
    return fail(
      id,
      title,
      `the canary job "${ACCESS_CANARY_JOB}" ${job ? `ended ${job.conclusion || 'unfinished'}` : 'is not in the run'}: production admin is not behind the production Access app`,
      'Create the production Access app first (docs/runbooks/RUNBOOK-DEPLOYMENT.md, "First Production Launch — Cloudflare Access App"). Until then the deploy job goes red at its last step, after the Worker is live.'
    );
  }
  return pass(id, title, 'the latest canary run found the production Access app');
}

// ── the report ──────────────────────────────────────────────────────────────

const LABEL = { pass: 'PASS', fail: 'FAIL', todo: 'TODO' };

/** One line per check, then the verdict. exitCode is 0 only when every check passed. */
export function render(results) {
  const out = [];
  for (const r of results) {
    out.push(`${LABEL[r.status]}  ${r.title}: ${r.detail}`);
    if (r.status !== 'pass' && r.fix) out.push(`      Do: ${r.fix}`);
  }
  const failed = results.filter((r) => r.status === 'fail').length;
  const unchecked = results.filter((r) => r.status === 'todo').length;
  out.push('');
  if (failed === 0 && unchecked === 0) out.push(`READY: all ${results.length} checks passed.`);
  else out.push(`NOT READY: ${failed} failed${unchecked ? `, ${unchecked} not checked` : ''}.`);
  const text = out.join('\n').split(String.fromCharCode(92)).join('/');
  return { text, exitCode: failed === 0 && unchecked === 0 ? 0 : 1 };
}

export const NOT_CHECKED = [
  'That each secret holds a usable value. Only names can be listed; scripts/set-secrets.sh checks length when it sets one.',
  'That the commit GitHub deploys is the one in this checkout. Dispatch from main, right after this passes.',
  'Before the deploy: note a restore point for both production databases (the plan, "Before you start").',
  'After the deploy: the one-time steps in docs/runbooks/RUNBOOK-DEPLOYMENT.md (founder membership rows, the 0088 backfill, the 0091 purge, the BigQuery tables before 03:00 UTC), then set PRODUCTION_LIVE=true.',
];

// ── command line ────────────────────────────────────────────────────────────

function readIfThere(path) {
  return existsSync(path) ? decodeText(readFileSync(path)) : undefined;
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(
      'Usage: node scripts/prod-preflight.mjs [--repo-only] [--activation] [--inputs <dir>] [--sha <commit>]\n' +
        `Reads this checkout and, unless --repo-only, the files you saved in ${INPUT_DIR}/. Makes no network request.`
    );
    return 0;
  }
  const repoOnly = argv.includes('--repo-only');
  const inputs = arg('--inputs') ? arg('--inputs') : join(root, INPUT_DIR);
  let sha = arg('--sha');
  if (!sha) {
    try {
      sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    } catch {
      sha = '';
    }
  }

  const worker = join(root, WORKER);
  const toml = decodeText(readFileSync(join(worker, 'wrangler.toml')));
  const dbFiles = readdirSync(join(worker, 'migrations'));
  const formsFiles = readdirSync(join(worker, 'migrations-forms'));
  const guardSource = readFileSync(join(worker, 'src/lib/schema-guard.ts'), 'utf8');
  const required = (name) => parseInt(CONSTANT[name].exec(guardSource)?.[1] ?? '0', 10);

  const results = [
    checkSchemaConstants({ db: dbFiles, forms: formsFiles, guardSource }),
    checkProductionBindings(toml),
    checkProductionVars(toml, { activation: argv.includes('--activation') }),
    checkProductionRoutes(toml),
    checkBuildStamp(toml),
  ];

  if (!repoOnly) {
    const input = (key) => readIfThere(join(inputs, INPUT_FILES[key]));
    const db = checkPendingMigrations({
      binding: 'DB',
      text: input('migrationsDb'),
      files: dbFiles,
      required: required('REQUIRED_DB_MIGRATION'),
    });
    const forms = checkPendingMigrations({
      binding: 'FORMS_DB',
      text: input('migrationsForms'),
      files: formsFiles,
      required: required('REQUIRED_FORMS_MIGRATION'),
    });
    const sqlOf = (dir, file) => readFileSync(join(worker, dir, file), 'utf8');
    const pending =
      db.pending && forms.pending
        ? [
            ...db.pending.map((file) => ({ binding: 'DB', file, sql: sqlOf('migrations', file) })),
            ...forms.pending.map((file) => ({
              binding: 'FORMS_DB',
              file,
              sql: sqlOf('migrations-forms', file),
            })),
          ]
        : undefined;
    results.push(
      checkStagingChain({ text: input('stagingRun'), sha }),
      checkSecrets(input('names')),
      db,
      forms,
      // A list that failed to read is already a FAIL above; the plan check then has nothing to judge.
      db.status === 'fail' || forms.status === 'fail'
        ? fail(
            'migration-plan',
            'The written migration plan covers what will be applied',
            'not judged: a migration list above could not be used',
            'Mend the migration list first.'
          )
        : checkPlanCoverage({ pending, planText: readIfThere(join(root, PLAN_PATH)) }),
      checkAccessApp({ text: input('accessCanary') })
    );
  }

  const report = render(results);
  console.log(
    `Production preflight for commit ${short(sha) || '(unknown)'}${repoOnly ? ' (repo checks only)' : ''}\n`
  );
  console.log(report.text);
  if (!repoOnly && !existsSync(inputs)) {
    console.log(
      `\nFirst make the folder for the files you save: mkdir ${INPUT_DIR}   (git ignores it)`
    );
  }
  console.log('\nThis script cannot check:');
  for (const line of NOT_CHECKED) console.log(`  - ${line}`);
  return report.exitCode;
}

const isMain = process.argv[1]
  ?.split(String.fromCharCode(92))
  .join('/')
  .endsWith('scripts/prod-preflight.mjs');
if (isMain) process.exit(main(process.argv.slice(2)));
