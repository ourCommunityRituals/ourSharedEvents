#!/usr/bin/env node
/**
 * Staging and production config parity (owner stipulation, 2026-10-12).
 *
 * Staging and production stay in sync and ready for each other; the one
 * difference in posture is the live switch, which is off. This reads the
 * [env.staging] and [env.production] blocks of the Worker's wrangler.toml and
 * reports every difference. A difference is one of:
 *
 *   intentional  named below with its reason (ids, names, hosts, secrets of one
 *                environment, staging-only switches);
 *   undecided    a real difference nobody has ruled on yet, listed below with
 *                the reason it is open. It is reported on every run, and
 *                `--strict` (the check before announcing production) fails on it;
 *   unlisted     anything else. That fails the default run.
 *
 * So a new setting in one environment cannot land without a decision, and a
 * difference cannot sit open unseen.
 *
 *   node scripts/ci/env-parity.mjs            # fails on an unlisted difference
 *   node scripts/ci/env-parity.mjs --strict   # also fails on an undecided one
 *   node scripts/ci/env-parity.mjs --json
 *
 * What it does not read: the databases (migration level), deployed secrets and
 * the deployed Worker. Those need a network read, which CI does and this does
 * not. Its output says so.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseToml } from '../prod-preflight.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WRANGLER_PATH = 'workers/oursharedevents/wrangler.toml';

/** Settings whose value must differ between the two, and why. */
export const INTENTIONAL_VALUE_DIFFERENCES = {
  WORKER_ENV: 'names the environment',
  WORKER_BUILD_VERSION: 'each environment stamps its own build',
  WIF_PROVIDER_ID: 'a separate workload-identity provider per environment',
  WIF_ISSUER: 'the issuer is the environment host',
  BIGQUERY_DATASET_ID:
    'staging writes _stg; only production writes the dataset OER reads (OSE-1416)',
  CF_ACCESS_AUD:
    'a separate Access app per environment, so a separate audience; production is pinned (OSE-1353), staging is still unpinned (OSE-1377)',
};

/** Settings only one environment may carry, and why. */
export const INTENTIONAL_ONLY_IN = {
  staging: {
    ADMIN_SCOPE_ALL:
      'staging admin sees every brand; production must not (tests/prod-admin-scope-config.spec.ts)',
    ALLOW_ADMIN_KEY_FALLBACK: 'a key fallback for CI callers; production has none',
    ALLOW_OCR_INTERNAL: 'internal-header fallback for CI callers; production has none',
    STAGING_VARIANT: 'names which staging site this is (empty or full); production has no variant',
    CI_SERVICE_ACTORS:
      'the CI service token accepted as a brand admin (OSE-1800); production has none (tests/prod-admin-scope-config.spec.ts)',
    CI_SERVICE_ACTOR_BRAND:
      'the one synthetic brand the CI service actor administers (OSE-1800); production has none',
  },
  production: {},
};

/**
 * Real differences nobody has ruled on. Each names what is open. Remove an
 * entry when the owner decides, and either add the missing side or move it to
 * the intentional lists with a reason.
 */
export const UNDECIDED = [
  {
    key: 'binding:queues.producers:SCAN_QUEUE',
    reason:
      'staging has the scan write-buffer queue (SCAN_QUEUE, ose-scans, dead-letter ose-scans-dlq); production has none, so production writes scans straight to D1. Owner to decide whether production gets the queue before it is announced.',
  },
  {
    key: 'binding:queues.consumers:ose-scans',
    reason: 'the consumer side of the same scan queue; decided together with SCAN_QUEUE.',
  },
];

const VAR_HEADER = (env) => `env.${env}.vars`;

function varsOf(sections, env) {
  return sections.find((s) => s.header === VAR_HEADER(env))?.values ?? null;
}

/** [{ kind, name, values }] for the array sections of one environment. */
function bindingsOf(sections, env) {
  const prefix = `env.${env}.`;
  return sections
    .filter((s) => s.array && s.header.startsWith(prefix))
    .map((s) => ({
      kind: s.header.slice(prefix.length),
      name: s.values.binding ?? s.values.name ?? s.values.queue ?? '(unnamed)',
      values: s.values,
    }));
}

const scalar = (sections, env, key) => sections.find((s) => s.header === `env.${env}`)?.values[key];
const crons = (sections, env) =>
  sections.find((s) => s.header === `env.${env}.triggers`)?.values.crons ?? null;

/**
 * Compare the two environments. Pure: takes wrangler.toml text.
 * @returns {{ ok: boolean, strictOk: boolean, findings: Array<{level: string, key: string, detail: string}> }}
 */
export function compareEnvironments(tomlText) {
  const sections = parseToml(tomlText);
  const findings = [];
  const add = (level, key, detail) => findings.push({ level, key, detail });
  const undecidedKeys = new Set(UNDECIDED.map((u) => u.key));
  const undecided = (key) => UNDECIDED.find((u) => u.key === key);

  const stg = varsOf(sections, 'staging');
  const prod = varsOf(sections, 'production');
  if (!stg || !prod) {
    add(
      'unlisted',
      'vars',
      `missing section: ${!stg ? '[env.staging.vars]' : '[env.production.vars]'}`
    );
    return summarize(findings);
  }

  // Settings present on one side only.
  for (const [side, from, other] of [
    ['staging', stg, prod],
    ['production', prod, stg],
  ]) {
    for (const key of Object.keys(from)) {
      if (key in other) continue;
      const why = INTENTIONAL_ONLY_IN[side][key];
      if (why) add('intentional', `only-in-${side}:${key}`, why);
      else
        add(
          'unlisted',
          `only-in-${side}:${key}`,
          `${key} is set in ${side} and not in the other environment`
        );
    }
  }

  // Settings present on both sides with different values.
  for (const key of Object.keys(stg)) {
    if (!(key in prod)) continue;
    const same = stg[key] === prod[key];
    const u = undecided(`value:${key}`);
    if (u?.sameValueIsOpen && same && (stg[key] === '' || stg[key] === undefined)) {
      add('undecided', `value:${key}`, u.reason);
      continue;
    }
    if (same) continue;
    const why = INTENTIONAL_VALUE_DIFFERENCES[key];
    if (why) add('intentional', `value:${key}`, why);
    else
      add(
        'unlisted',
        `value:${key}`,
        `${key} is "${stg[key]}" in staging and "${prod[key]}" in production`
      );
  }

  // Bindings: the same kinds and names on both sides.
  const sb = bindingsOf(sections, 'staging');
  const pb = bindingsOf(sections, 'production');
  const id = (b) => `${b.kind}:${b.name}`;
  const sIds = new Map(sb.map((b) => [id(b), b]));
  const pIds = new Map(pb.map((b) => [id(b), b]));
  for (const [k] of sIds) {
    if (pIds.has(k)) continue;
    const key = `binding:${k}`;
    const u = undecided(key);
    if (u) add('undecided', key, u.reason);
    else add('unlisted', key, `${k} is declared for staging and not for production`);
  }
  for (const [k] of pIds) {
    if (sIds.has(k)) continue;
    const key = `binding:${k}`;
    const u = undecided(key);
    if (u) add('undecided', key, u.reason);
    else add('unlisted', key, `${k} is declared for production and not for staging`);
  }

  // The same limits where a binding exists on both sides (ids differ on purpose).
  for (const [k, s] of sIds) {
    const p = pIds.get(k);
    if (!p) continue;
    for (const field of [
      'simple',
      'max_batch_size',
      'max_batch_timeout',
      'max_retries',
      'dead_letter_queue',
    ]) {
      if (s.values[field] !== p.values[field]) {
        add(
          'unlisted',
          `binding-field:${k}:${field}`,
          `${k} ${field} is ${s.values[field] ?? '(unset)'} in staging and ${p.values[field] ?? '(unset)'} in production`
        );
      }
    }
  }

  // The nightly job.
  if (crons(sections, 'staging') !== crons(sections, 'production')) {
    add(
      'unlisted',
      'triggers.crons',
      `staging ${crons(sections, 'staging')} vs production ${crons(sections, 'production')}`
    );
  }

  // Every undecided entry must still be a real difference (no stale entries).
  const seen = new Set(findings.filter((f) => f.level === 'undecided').map((f) => f.key));
  for (const key of undecidedKeys) {
    if (!seen.has(key))
      add(
        'unlisted',
        `stale-undecided:${key}`,
        `${key} is listed as undecided and is no longer a difference: remove it from UNDECIDED`
      );
  }
  void scalar;
  return summarize(findings);
}

function summarize(findings) {
  const unlisted = findings.filter((f) => f.level === 'unlisted');
  const undecided = findings.filter((f) => f.level === 'undecided');
  return {
    ok: unlisted.length === 0,
    strictOk: unlisted.length === 0 && undecided.length === 0,
    findings,
  };
}

export function render(report) {
  const out = ['Staging and production config parity (wrangler.toml)', ''];
  for (const level of ['unlisted', 'undecided', 'intentional']) {
    const rows = report.findings.filter((f) => f.level === level);
    out.push(`${level.toUpperCase()} (${rows.length})`);
    for (const r of rows) out.push(`  - ${r.key}: ${r.detail}`);
    out.push('');
  }
  out.push(
    report.ok ? 'PASS: no unlisted difference.' : 'FAIL: an unlisted difference needs a decision.'
  );
  out.push(
    report.strictOk
      ? 'STRICT: aligned, no undecided difference.'
      : 'STRICT: not aligned yet (undecided differences above).'
  );
  out.push('');
  out.push(
    'Not read here (needs a network read, done in CI): database migration level on both sides, deployed secrets, the deployed Worker SHA.'
  );
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const report = compareEnvironments(readFileSync(join(ROOT, WRANGLER_PATH), 'utf8'));
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(render(report));
  const pass = args.includes('--strict') ? report.strictOk : report.ok;
  process.exitCode = pass ? 0 : 1;
}
