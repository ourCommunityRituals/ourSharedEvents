#!/usr/bin/env node
/* eslint-env node */
/**
 * OSE-802 — schema reconciliation guard.
 *
 * A column name reused with different SQLite affinity is almost always a hidden
 * model fork. Existing legacy drift is explicitly baselined here; any new
 * cross-table collision fails CI before it becomes another schema axis.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractColumnDefinitionsFromMigrations } from './verify-d1-canonical-shape.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIGRATION_DIRS = {
  DB: join(root, 'migrations'),
  FORMS_DB: join(root, 'migrations-forms'),
};

const ALLOWED_COLUMN_TYPE_COLLISIONS = new Map([
  [
    'id',
    {
      affinities: ['INTEGER', 'TEXT'],
      reason:
        'Legacy schemas use text UUIDs for application entities and an integer sequence for subscribers.',
    },
  ],
  [
    'legal_clearance_tier',
    {
      affinities: ['INTEGER', 'TEXT'],
      reason:
        'Legacy OSE-802/OSE-1221 drift: node_hierarchy uses regime labels while event types/events use numeric tiers.',
    },
  ],
  [
    'phase',
    {
      affinities: ['INTEGER', 'TEXT'],
      reason:
        'Legacy schemas use numeric event phases and textual audit-log phase labels.',
    },
  ],
]);

function columnDefinitionsByName() {
  const byName = new Map();
  for (const [binding, dir] of Object.entries(MIGRATION_DIRS)) {
    const schema = extractColumnDefinitionsFromMigrations(dir);
    for (const [table, columns] of schema) {
      for (const definition of columns.values()) {
        const list = byName.get(definition.column) ?? [];
        list.push({ ...definition, binding, table });
        byName.set(definition.column, list);
      }
    }
  }
  return byName;
}

export function findColumnTypeCollisions() {
  const collisions = [];
  for (const [column, definitions] of columnDefinitionsByName()) {
    const affinities = [...new Set(definitions.map((definition) => definition.affinity))].sort();
    if (affinities.length <= 1) continue;

    const allowed = ALLOWED_COLUMN_TYPE_COLLISIONS.get(column);
    if (allowed && allowed.affinities.join('|') === affinities.join('|')) continue;

    collisions.push({ column, affinities, definitions });
  }
  return collisions.sort((a, b) => a.column.localeCompare(b.column));
}

function formatDefinition(definition) {
  const type = definition.declaredType || '(no declared type)';
  return `${definition.binding}.${definition.table}.${definition.column}: ${type} (${definition.affinity}) in ${definition.sourceFile}`;
}

export function main() {
  const collisions = findColumnTypeCollisions();
  if (!collisions.length) {
    console.log('ok    no unbaselined column type collisions across D1 migrations');
    for (const [column, baseline] of ALLOWED_COLUMN_TYPE_COLLISIONS) {
      console.log(`note  ${column}: allowed ${baseline.affinities.join(' / ')} — ${baseline.reason}`);
    }
    return 0;
  }

  for (const collision of collisions) {
    console.error(
      `FAIL  ${collision.column}: incompatible affinities ${collision.affinities.join(' / ')}`
    );
    for (const definition of collision.definitions) {
      console.error(`      ${formatDefinition(definition)}`);
    }
  }
  console.error(
    '\nSchema reconciliation guard failed. Rename the new column, align its type, or explicitly baseline a known legacy conflict with a reason.'
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
