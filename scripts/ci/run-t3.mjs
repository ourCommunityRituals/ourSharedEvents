#!/usr/bin/env node
/**
 * T3 smoke runner: the one entry point CI and a laptop both call.
 *
 *   npm run test:t3:staging                       # every section against staging
 *   npm run test:t3:staging -- --section iac      # one section
 *   npm run test:t3:staging -- --section forms -- --grep register   # extra Playwright args
 *   node scripts/ci/run-t3.mjs --list             # section names
 *
 * Sections live in scripts/ci/t3-sections.json. The target is BASE_URL (default
 * staging, config/environments.js). Production is refused.
 *
 * Credentials come from the environment. When they are missing and the Doppler CLI is
 * installed, the runner re-runs itself under `doppler run` (project oursharedevents,
 * config stg), so no .env file ever holds them. Traces are off in every config
 * (OSE-1470) and a --trace flag is refused here.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { getBaseUrl } = require('../../config/environments');
const { isProductionUrl } = require('../../config/production-hosts');

const STAGING_SECRETS = ['ADMIN_KEY', 'X_OCR_INTERNAL', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET'];
const DOPPLER_GUARD = 'OSE_T3_UNDER_DOPPLER';

export function loadSections(file = resolve(ROOT, 'scripts/ci/t3-sections.json')) {
  return JSON.parse(readFileSync(file, 'utf8')).sections;
}

/** Pure: split argv into the runner's own flags and the Playwright passthrough. */
export function parseArgs(argv) {
  const out = { section: 'all', list: false, tsv: false, passthrough: [] };
  const sep = argv.indexOf('--');
  const own = sep === -1 ? argv : argv.slice(0, sep);
  out.passthrough = sep === -1 ? [] : argv.slice(sep + 1);
  for (let i = 0; i < own.length; i++) {
    if (own[i] === '--section') out.section = own[++i] ?? '';
    else if (own[i] === '--list') out.list = true;
    else if (own[i] === '--tsv') out.tsv = true;
    else throw new Error(`unknown argument: ${own[i]}`);
  }
  return out;
}

/** Pure: names to run, or an Error message. */
export function pickSections(sections, requested) {
  const all = Object.keys(sections);
  if (requested === 'all') return { names: all };
  const names = requested.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = names.filter((n) => !sections[n]);
  if (!names.length || unknown.length) {
    return { error: `unknown section: ${unknown.join(', ') || '(none given)'}; known: ${all.join(', ')}` };
  }
  return { names };
}

/** Pure: why this run must not start, or null. */
export function preflightProblem({ baseUrl, env, passthrough }) {
  if (isProductionUrl(baseUrl)) return `refusing to run against production (${baseUrl})`;
  const trace = passthrough.findIndex((a) => a === '--trace' || a.startsWith('--trace='));
  if (trace !== -1) {
    const v = passthrough[trace].includes('=') ? passthrough[trace].split('=')[1] : passthrough[trace + 1];
    if (v !== 'off') return 'refusing --trace: traces record CF-Access-Client-Secret and ADMIN_KEY (OSE-1470)';
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(baseUrl).hostname);
  if (!local) {
    const missing = STAGING_SECRETS.filter((k) => !env[k]);
    if (missing.length) return `missing ${missing.join(', ')}`;
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sections = loadSections();

  if (args.list) return console.log(Object.keys(sections).join('\n'));
  if (args.tsv) {
    // name <TAB> config <TAB> specs (space-separated), for run-local-vetting.sh
    for (const [n, s] of Object.entries(sections)) console.log(`${n}\t${s.config}\t${s.specs.join(' ')}`);
    return;
  }

  const picked = pickSections(sections, args.section);
  if (picked.error) {
    console.error(`::error::${picked.error}`);
    process.exit(2);
  }

  const baseUrl = getBaseUrl();
  let problem = preflightProblem({ baseUrl, env: process.env, passthrough: args.passthrough });

  if (problem?.startsWith('missing') && !process.env[DOPPLER_GUARD]) {
    const probe = spawnSync('doppler', ['--version'], { stdio: 'ignore', shell: true });
    if (probe.status === 0) {
      console.log(`${problem}; re-running under Doppler (oursharedevents/stg)`);
      const re = spawnSync(
        'doppler',
        ['run', '--project', 'oursharedevents', '--config', 'stg', '--', 'node', 'scripts/ci/run-t3.mjs', ...process.argv.slice(2)],
        { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, [DOPPLER_GUARD]: '1' } },
      );
      process.exit(re.status ?? 1);
    }
  }
  if (problem) {
    const hint = problem.startsWith('missing')
      ? ' (export them, or install the Doppler CLI and `doppler login`; see docs/testing/local-first-t3-t4-t5-vetting.md)'
      : '';
    console.error(`::error::${problem}${hint}`);
    process.exit(2);
  }

  console.log(`T3 target: ${baseUrl}`);
  let failed = 0;
  for (const name of picked.names) {
    const s = sections[name];
    console.log(`\n== ${s.label} (${name}) ==`);
    const r = spawnSync('npx', ['playwright', 'test', `--config=${s.config}`, ...s.specs, ...args.passthrough], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
    });
    if (r.status !== 0) failed++;
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
