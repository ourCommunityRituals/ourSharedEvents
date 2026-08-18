#!/usr/bin/env node
/**
 * OSE-803 — keep the schema guard constants in step with the migration directories.
 *
 * The guard in src/lib/schema-guard.ts refuses to serve when a D1 binding is behind
 * the migration this Worker was built against. That is only true if the constants
 * are bumped whenever a migration lands. This check makes forgetting a build failure
 * rather than a silent weakening of the guard.
 *
 * Run: node scripts/check-schema-guard.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function highestMigration(dir) {
  const files = readdirSync(join(root, dir)).filter((f) => /^\d{4}_.*\.sql$/.test(f));
  if (!files.length) throw new Error(`no migrations found in ${dir}`);
  return files.reduce((max, f) => Math.max(max, parseInt(f.slice(0, 4), 10)), 0);
}

function constantFrom(source, name) {
  const m = source.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`could not find ${name} in schema-guard.ts`);
  return parseInt(m[1], 10);
}

const guard = readFileSync(join(root, 'src/lib/schema-guard.ts'), 'utf8');

const checks = [
  { dir: 'migrations', constant: 'REQUIRED_DB_MIGRATION', binding: 'DB' },
  { dir: 'migrations-forms', constant: 'REQUIRED_FORMS_MIGRATION', binding: 'FORMS_DB' },
];

let failed = false;
for (const c of checks) {
  const onDisk = highestMigration(c.dir);
  const inCode = constantFrom(guard, c.constant);
  if (onDisk !== inCode) {
    failed = true;
    console.error(
      `FAIL  ${c.binding}: ${c.dir}/ is at ${onDisk} but ${c.constant} says ${inCode}.\n` +
        `      Bump ${c.constant} to ${onDisk} in src/lib/schema-guard.ts, in this PR.`
    );
  } else {
    console.log(`ok    ${c.binding}: ${c.constant} = ${inCode}, matches ${c.dir}/`);
  }
}

if (failed) {
  console.error('\nSchema guard is out of step with the migrations it is meant to guard.');
  process.exit(1);
}
console.log('\nSchema guard constants are in step.');
