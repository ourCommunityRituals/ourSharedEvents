#!/usr/bin/env node
// Today's counts for the things docs keep quoting (gates, specs, templates,
// test ids, migrations, routes, workflows), each with how it is counted.
//
// Why a script and not a committed table: a count written into a doc is wrong
// the day after (OSE-1672 found "26 gates" quoted in three assessments when
// there were 34). A generated file checked in CI would not help either: two
// pull requests that each add a spec would conflict on it, which is why the
// pool-triage manifest stopped storing totals (PR 864). So nothing is stored.
// When a doc needs a number, run this and quote it with the date.
//
//   node scripts/brain/counts.mjs [--root .] [--json]
//
// Read-only. No network: the required status checks on main are not counted
// here because reading branch protection needs a token.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

const SKIP_DIRS = new Set(['node_modules', '.git', 'archive', 'worktrees', '.wrangler', 'dist', 'coverage']);

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, keep, out);
    } else if (keep(name)) out.push(p);
  }
  return out;
}

const list = (dir, keep) => (existsSync(dir) ? readdirSync(dir).filter(keep) : []);
const text = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '');

function constant(source, name) {
  const m = source.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
}

export function count(root) {
  const at = (...p) => join(root, ...p);
  const worker = at('workers', 'oursharedevents');
  const rows = [];
  const add = (key, what, value, how) => rows.push({ key, what, value, how });

  add('archGates', 'Architecture gate spec files', list(at('tests', 'e2e', '0-architecture'), (f) => f.endsWith('.spec.ts')).length, '`tests/e2e/0-architecture/*.spec.ts`');
  add('workerSpecs', 'Worker spec files', walk(join(worker, 'tests'), (f) => f.endsWith('.spec.ts')).length, '`workers/oursharedevents/tests/**/*.spec.ts`');
  add('rootTests', 'Root test and spec files', walk(at('tests'), (f) => /\.(test|spec)\.(js|ts|mjs)$/.test(f)).length, '`tests/**/*.{test,spec}.{js,ts,mjs}`, `archive/` excluded');
  add('templates', 'HTML templates', list(join(worker, 'src', 'templates'), (f) => f.endsWith('.html')).length, '`workers/oursharedevents/src/templates/*.html`');

  let testids = null;
  const registry = at('web', 'shared', 'testids.js');
  if (existsSync(registry)) {
    try {
      testids = createRequire(import.meta.url)(resolve(registry)).ALL_TESTIDS.length;
    } catch {
      testids = null;
    }
  }
  add('testids', 'Test ids in the registry', testids, '`ALL_TESTIDS.length` from `web/shared/testids.js`');

  const guard = text(join(worker, 'src', 'lib', 'schema-guard.ts'));
  const main = list(join(worker, 'migrations'), (f) => f.endsWith('.sql')).length;
  const forms = list(join(worker, 'migrations-forms'), (f) => f.endsWith('.sql')).length;
  const needMain = constant(guard, 'REQUIRED_DB_MIGRATION');
  const needForms = constant(guard, 'REQUIRED_FORMS_MIGRATION');
  add('migrationsMain', 'Main DB migrations', main, `\`migrations/*.sql\`; \`REQUIRED_DB_MIGRATION\` is ${needMain} (${needMain === main ? 'matches' : 'DOES NOT MATCH'})`);
  add('migrationsForms', 'Forms DB migrations', forms, `\`migrations-forms/*.sql\`; \`REQUIRED_FORMS_MIGRATION\` is ${needForms} (${needForms === forms ? 'matches' : 'DOES NOT MATCH'})`);

  const router = text(join(worker, 'src', 'router.ts'));
  const header = (router.match(/^\/\*\*[\s\S]*?\*\//) || [''])[0];
  add('routesInHeader', 'Routes listed in the router header', (header.match(/\b(GET|POST|PUT|DELETE|PATCH)\s+\//g) || []).length, '`METHOD /path` lines in the first comment of `src/router.ts`');
  add('routeChecksInCode', 'Method checks in the route table', (router.match(/method === '(GET|POST|PUT|DELETE|PATCH)'/g) || []).length, "`method === '…'` in `src/router.ts`; a rough count, not one per route");

  const workflows = list(at('.github', 'workflows'), (f) => /\.ya?ml$/.test(f));
  add('workflows', 'Workflow files', workflows.length, '`.github/workflows/*.yml`');
  let jobs = null;
  try {
    jobs = Object.keys(yaml.load(text(at('.github', 'workflows', 'oursharedevents-ci.yml'))).jobs).length;
  } catch {
    jobs = null;
  }
  add('pipelineJobs', 'Jobs in the main pipeline', jobs, 'top-level `jobs:` in `oursharedevents-ci.yml`');

  const skills = at('.claude', 'skills');
  add('skills', 'Skills Claude Code loads', list(skills, (d) => existsSync(join(skills, d, 'SKILL.md'))).length, '`.claude/skills/*/SKILL.md`');
  add('agents', 'Agent definitions', list(at('.claude', 'agents'), (f) => f.endsWith('.md')).length, '`.claude/agents/*.md`');
  for (const f of ['AGENTS.md', 'CLAUDE.md']) {
    add(f, `${f} size in bytes`, existsSync(at(f)) ? Buffer.byteLength(text(at(f)), 'utf8') : null, 'LF line endings');
  }
  return rows;
}

function render(rows, date) {
  const cell = (v) => (v === null ? 'not found' : String(v));
  return (
    `Counts on ${date} (run \`node scripts/brain/counts.mjs\` for today's):\n\n` +
    '| What | Count | How it is counted |\n|---|---|---|\n' +
    rows.map((r) => `| ${r.what} | ${cell(r.value)} | ${r.how} |`).join('\n') +
    '\n\nNot counted here: required status checks on `main` (reading branch protection needs a token).\n'
  );
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/brain/counts.mjs')) {
  const argv = process.argv.slice(2);
  const root = argv.indexOf('--root') >= 0 ? argv[argv.indexOf('--root') + 1] : process.cwd();
  const rows = count(root);
  process.stdout.write(
    argv.includes('--json')
      ? JSON.stringify(Object.fromEntries(rows.map((r) => [r.key, r.value])), null, 2) + '\n'
      : render(rows, new Date().toISOString().slice(0, 10)),
  );
}
