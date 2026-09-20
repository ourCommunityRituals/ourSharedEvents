#!/usr/bin/env node
/**
 * OSE-1347 — remote D1 deploy gate.
 *
 * Compares the staging/production D1 schema against the canonical column set
 * derived from the migration SQL the deploy just applied. The live table set
 * comes from tests/migration-smoke.spec.ts; columns come from migrations/.
 */
import { execFile as execFileCb } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, '..');

const DB_NAMES = {
  staging: {
    DB: 'ocr-db-staging',
    FORMS_DB: 'ocr-forms-db-staging',
  },
  production: {
    DB: 'ocr-db-production',
    FORMS_DB: 'ocr-forms-db-production',
  },
};

const TABLE_LIST_REGEX = {
  DB: /const DB_TABLES = \[([\s\S]*?)\] as const;/,
  FORMS_DB: /const FORMS_DB_TABLES = \[([\s\S]*?)\] as const;/,
};
const TABLE_LIST_FLOORS = {
  DB: 10,
  FORMS_DB: 3,
};
const PRAGMA_CONCURRENCY = 6;

function usage() {
  return `Usage: node scripts/verify-d1-canonical-shape.mjs --env <staging|production>`;
}

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function splitSql(sql) {
  const statements = [];
  let current = '';
  let quote = null;
  let depth = 0;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const prev = sql[i - 1];
    if (quote) {
      current += ch;
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

function splitTopLevelComma(input) {
  const parts = [];
  let current = '';
  let quote = null;
  let depth = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const prev = input[i - 1];
    if (quote) {
      current += ch;
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function unquoteIdentifier(identifier) {
  const trimmed = identifier.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function firstIdentifier(sqlFragment) {
  const match = sqlFragment.trim().match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)/);
  return match ? unquoteIdentifier(match[1]) : null;
}

function createTableColumns(statement) {
  const match = statement.match(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/i
  );
  if (!match) return null;
  const table = unquoteIdentifier(match[1]);
  const columns = [];
  for (const part of splitTopLevelComma(match[2])) {
    const name = firstIdentifier(part);
    if (!name) continue;
    if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|KEY)$/i.test(name)) continue;
    columns.push(name);
  }
  return { table, columns };
}

function applyStatement(schema, statement) {
  const create = createTableColumns(statement);
  if (create) {
    schema.set(create.table, new Set(create.columns));
    return;
  }

  let match = statement.match(
    /^ALTER\s+TABLE\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+COLUMN\s+([\s\S]+)$/i
  );
  if (match) {
    const table = unquoteIdentifier(match[1]);
    const column = firstIdentifier(match[2]);
    if (column) {
      if (!schema.has(table)) schema.set(table, new Set());
      schema.get(table).add(column);
    }
    return;
  }

  match = statement.match(
    /^ALTER\s+TABLE\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s+DROP\s+COLUMN\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)$/i
  );
  if (match) {
    schema.get(unquoteIdentifier(match[1]))?.delete(unquoteIdentifier(match[2]));
    return;
  }

  match = statement.match(
    /^ALTER\s+TABLE\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s+RENAME\s+COLUMN\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s+TO\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)$/i
  );
  if (match) {
    const table = unquoteIdentifier(match[1]);
    const oldName = unquoteIdentifier(match[2]);
    const newName = unquoteIdentifier(match[3]);
    const columns = schema.get(table);
    if (columns?.has(oldName)) {
      columns.delete(oldName);
      columns.add(newName);
    }
    return;
  }

  match = statement.match(
    /^ALTER\s+TABLE\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s+RENAME\s+TO\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)$/i
  );
  if (match) {
    const from = unquoteIdentifier(match[1]);
    const to = unquoteIdentifier(match[2]);
    const columns = schema.get(from);
    if (columns) {
      schema.delete(from);
      schema.set(to, columns);
    }
    return;
  }

  match = statement.match(
    /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)$/i
  );
  if (match) {
    schema.delete(unquoteIdentifier(match[1]));
  }
}

export function extractTableLists(smokeSpecPath = join(rootDir, 'tests/migration-smoke.spec.ts')) {
  const source = readFileSync(smokeSpecPath, 'utf8');
  const result = {};
  for (const [binding, regex] of Object.entries(TABLE_LIST_REGEX)) {
    const match = source.match(regex);
    if (!match) throw new Error(`could not extract ${binding}_TABLES from migration-smoke.spec.ts`);
    const tables = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    if (!tables.length) throw new Error(`extracted empty ${binding}_TABLES from migration-smoke.spec.ts`);
    if (tables.length < TABLE_LIST_FLOORS[binding]) {
      throw new Error(
        `extracted ${tables.length} ${binding}_TABLES from migration-smoke.spec.ts; expected at least ${TABLE_LIST_FLOORS[binding]}`
      );
    }
    result[binding] = tables;
  }
  return result;
}

export function extractColumnsFromMigrations(migrationsDir) {
  const schema = new Map();
  const files = readdirSync(migrationsDir)
    .filter((file) => /^\d{4}_.*\.sql$/.test(file))
    .sort();
  for (const file of files) {
    const sql = stripComments(readFileSync(join(migrationsDir, file), 'utf8'));
    for (const statement of splitSql(sql)) applyStatement(schema, statement);
  }
  return schema;
}

export function canonicalSchema(root = rootDir) {
  const tableLists = extractTableLists(join(root, 'tests/migration-smoke.spec.ts'));
  const migrationDirs = {
    DB: join(root, 'migrations'),
    FORMS_DB: join(root, 'migrations-forms'),
  };
  const result = {};
  for (const binding of Object.keys(migrationDirs)) {
    const parsed = extractColumnsFromMigrations(migrationDirs[binding]);
    result[binding] = new Map();
    for (const table of tableLists[binding]) {
      const columns = parsed.get(table);
      if (!columns) throw new Error(`canonical parser found no columns for live ${binding} table ${table}`);
      result[binding].set(table, [...columns].sort());
    }
  }
  return result;
}

function resultRows(value) {
  const rows = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (Array.isArray(node.results)) rows.push(...node.results);
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return rows;
}

async function wranglerQuery(dbName, cfEnv, command) {
  const { stdout, stderr } = await execFile(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['wrangler', 'd1', 'execute', dbName, '--env', cfEnv, '--remote', '--json', '--command', command],
    { cwd: rootDir, maxBuffer: 1024 * 1024 * 10 }
  );
  if (stderr.trim()) process.stderr.write(stderr);
  return resultRows(JSON.parse(stdout));
}

function quotePragmaTable(table) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error(`unsafe table name: ${table}`);
  return `"${table}"`;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function remoteSchema(dbName, cfEnv, tables, query = wranglerQuery) {
  const actual = new Map();
  await mapLimit(tables, PRAGMA_CONCURRENCY, async (table) => {
    const rows = await query(dbName, cfEnv, `PRAGMA table_info(${quotePragmaTable(table)})`);
    if (!rows.length) return;
    actual.set(
      table,
      rows
        .map((row) => row.name)
        .filter(Boolean)
        .sort()
    );
  });
  return actual;
}

export async function remoteObjectNames(dbName, cfEnv, type, query = wranglerQuery) {
  const rows = await query(
    dbName,
    cfEnv,
    `SELECT name FROM sqlite_master WHERE type='${type}' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name`
  );
  return rows.map((row) => row.name).filter(Boolean).sort();
}

export function diffSchema(expected, actual) {
  const problems = [];
  const expectedTables = [...expected.keys()].sort();
  const actualTables = [...actual.keys()].sort();
  for (const table of expectedTables) {
    if (!actual.has(table)) {
      problems.push({ type: 'missing-table', table });
      continue;
    }
    const expectedColumns = expected.get(table);
    const actualColumns = actual.get(table);
    for (const column of expectedColumns) {
      if (!actualColumns.includes(column)) problems.push({ type: 'missing-column', table, column });
    }
    for (const column of actualColumns) {
      if (!expectedColumns.includes(column)) problems.push({ type: 'extra-column', table, column });
    }
  }
  for (const table of actualTables) {
    if (!expected.has(table)) problems.push({ type: 'extra-table', table });
  }
  return problems;
}

function problemMessage(binding, cfEnv, problem) {
  if (problem.type === 'missing-table') return `${binding} ${cfEnv}: missing table ${problem.table}`;
  if (problem.type === 'extra-table') return `${binding} ${cfEnv}: unexpected table ${problem.table}`;
  if (problem.type === 'missing-column') {
    return `${binding} ${cfEnv}: ${problem.table} is missing canonical column ${problem.column}`;
  }
  return `${binding} ${cfEnv}: ${problem.table} has unexpected column ${problem.column}`;
}

async function verifyBinding({ binding, dbName, cfEnv, expected }) {
  const actualTableNames = await remoteObjectNames(dbName, cfEnv, 'table');
  const actualColumns = await remoteSchema(dbName, cfEnv, [...expected.keys()]);
  for (const table of actualTableNames) {
    if (!actualColumns.has(table)) actualColumns.set(table, []);
  }

  const schemaProblems = diffSchema(expected, actualColumns);
  for (const problem of schemaProblems) {
    console.error(`::error::${problemMessage(binding, cfEnv, problem)}`);
  }

  const triggers = await remoteObjectNames(dbName, cfEnv, 'trigger');
  if (triggers.length) {
    console.error(`::error::${binding} ${cfEnv}: unexpected triggers [${triggers.join(' ')}]`);
  }

  if (schemaProblems.length || triggers.length) {
    return false;
  }

  const columnCount = [...expected.values()].reduce((sum, cols) => sum + cols.length, 0);
  console.log(`✓ ${binding} ${cfEnv}: ${expected.size} tables / ${columnCount} columns match canonical migrations; 0 triggers`);
  return true;
}

async function main(argv = process.argv.slice(2)) {
  const envIndex = argv.indexOf('--env');
  const cfEnv = envIndex >= 0 ? argv[envIndex + 1] : undefined;
  if (!cfEnv || !DB_NAMES[cfEnv]) {
    console.error(usage());
    return 2;
  }

  const expected = canonicalSchema(rootDir);
  let ok = true;
  for (const binding of ['DB', 'FORMS_DB']) {
    ok =
      (await verifyBinding({
        binding,
        dbName: DB_NAMES[cfEnv][binding],
        cfEnv,
        expected: expected[binding],
      })) && ok;
  }

  if (!ok) {
    console.error(
      `D1 canonical-shape verify failed for ${cfEnv}. Re-apply the missing migration, then rerun the deploy gate.`
    );
    return 1;
  }
  console.log(`{"type":"OSE_1347_D1_CANONICAL_SHAPE","env":"${cfEnv}","status":"ok"}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.stack || err.message : String(err));
      process.exitCode = 1;
    });
}
