#!/usr/bin/env node
// One step of the nightly event lifecycle on staging:
//   node scripts/lifecycle/run.mjs <sweep|create|edit|window|remove|cleanup>
// Each workflow step runs one, so each step's checks show under its own name in
// the run log. The run's plan and its event id are kept in lifecycle-out/state.json
// between steps; `cleanup` runs even after a failed step.
//
// Environment:
//   ADMIN_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET   staging secrets (required)
//   OCR_CI_EDGE_TOKEN        lets the event-page read past the edge challenge (OSE-939)
//   LANDING_WHERE_SEARCH     on | off: check the landing town search (PR #1118)
//   WINDOW_PAST_DAYS         days back the landing and map list (0 today)
//   WINDOW_FUTURE_DAYS       days ahead they list (90)
//   LIFECYCLE_POLL_ATTEMPTS, LIFECYCLE_POLL_DELAY_MS   how long a check waits for a change
//   LIFECYCLE_BASE_URL       only for a local worker run (with LIFECYCLE_ALLOW_LOCAL=1, never in CI)
/* eslint-disable security/detect-non-literal-fs-filename -- reads fixed repo files and writes the runner's own summary and state paths */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAGING_BASE_URL,
  DEFAULT_WINDOW,
  STEPS,
  assertTarget,
  chicagoDate,
  createReport,
  createSite,
  placesFrom,
  planRun,
} from './event-lifecycle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'lifecycle-out');
const STATE_FILE = join(OUT_DIR, 'state.json');
const SECRETS = [
  'ADMIN_KEY',
  'CF_ACCESS_CLIENT_ID',
  'CF_ACCESS_CLIENT_SECRET',
  'OCR_CI_EDGE_TOKEN',
];

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

function wholeNumber(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d{1,4}$/.test(raw)) throw new Error(`${name} must be a whole number`);
  return Number(raw);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const step = argv[0];
  if (!Object.prototype.hasOwnProperty.call(STEPS, step)) {
    throw new Error(`usage: run.mjs <${Object.keys(STEPS).join('|')}>`);
  }
  for (const name of SECRETS) {
    const v = env[name];
    if (typeof v === 'string' && v !== '' && env.GITHUB_ACTIONS === 'true') {
      for (const line of v.split(/\r?\n/)) if (line) process.stdout.write(`::add-mask::${line}\n`);
    }
  }

  const inCi = env.CI === 'true' || env.GITHUB_ACTIONS === 'true';
  const baseUrl = assertTarget(env.LIFECYCLE_BASE_URL || STAGING_BASE_URL, {
    allowLocal: env.LIFECYCLE_ALLOW_LOCAL === '1',
    inCi,
  });
  const onStaging = baseUrl === STAGING_BASE_URL;
  if (onStaging && (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET)) {
    throw new Error('CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are not set');
  }
  const whereRaw = env.LANDING_WHERE_SEARCH || 'off';
  if (whereRaw !== 'on' && whereRaw !== 'off')
    throw new Error('LANDING_WHERE_SEARCH must be on or off');

  const site = createSite({
    baseUrl,
    adminKey: env.ADMIN_KEY,
    accessClientId: env.CF_ACCESS_CLIENT_ID,
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
    edgeToken: env.OCR_CI_EDGE_TOKEN || '',
  });

  mkdirSync(OUT_DIR, { recursive: true });
  let state;
  if (existsSync(STATE_FILE)) {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } else {
    const places = placesFrom(readJson('stock/nodes.json'), readJson('stock/seed/seed.json'));
    const runTag = env.GITHUB_RUN_ID
      ? `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || '1'}`
      : `local-${Date.now()}`;
    state = planRun({ places, today: chicagoDate(Date.now()), runTag });
  }
  const save = () => writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  save();

  const report = createReport();
  const ctx = {
    site,
    report,
    state,
    save,
    whereSearch: whereRaw === 'on',
    window: {
      pastDays: wholeNumber(env, 'WINDOW_PAST_DAYS', DEFAULT_WINDOW.pastDays),
      futureDays: wholeNumber(env, 'WINDOW_FUTURE_DAYS', DEFAULT_WINDOW.futureDays),
    },
    attempts: Math.max(1, wholeNumber(env, 'LIFECYCLE_POLL_ATTEMPTS', 6)),
    delayMs: wholeNumber(env, 'LIFECYCLE_POLL_DELAY_MS', 5000),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
  if (step === 'sweep') {
    process.stdout.write(
      `Tonight: "${state.title}" in ${state.from.town} (${state.from.zip}), then ${state.to.town} (${state.to.zip}).\n`
    );
  }
  await STEPS[step](ctx);

  const failed = report.failed();
  if (env.GITHUB_STEP_SUMMARY) {
    const rows = report.results
      .map(
        (r) =>
          `| ${r.pass ? 'pass' : '**FAIL**'} | ${r.name} | ${String(r.detail).replace(/\|/g, '\\|')} |`
      )
      .join('\n');
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `\n### Lifecycle: ${step}\n\n| | Check | Detail |\n|---|---|---|\n${rows}\n`
    );
  }
  process.stdout.write(
    `${step}: ${report.results.length - failed.length} passed, ${failed.length} failed\n`
  );
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`::error::${err.message}\n`);
      process.exit(1);
    }
  );
}
