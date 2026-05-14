/**
 * FOREIGN KEY TYPE INVARIANT
 *
 * Born out of the OSE-237 / OSE-236 block: the AC declared
 * `corridor_id INTEGER REFERENCES corridors(id)`, but `corridors.id` is
 * `TEXT PRIMARY KEY` (migration 0010). SQLite silently accepts the type
 * mismatch but FK lookups become unreliable (no implicit coercion of
 * INTEGER values against TEXT keys), and downstream tooling that types
 * the column off PRAGMA table_info will produce wrong shapes.
 *
 * The architectural rule we are locking in here:
 *   For every FK declared by `FOREIGN KEY (...) REFERENCES other(col)`,
 *   the SQLite type-affinity of the referencing column MUST equal the
 *   type-affinity of the referenced column.
 *
 * SQLite stores type as a free-form `type` string in `PRAGMA table_info`,
 * but its type AFFINITY (TEXT, INTEGER, REAL, BLOB, NUMERIC) is derived
 * from substring rules. We compare affinity, not raw string, so e.g.
 * `VARCHAR(64)` and `TEXT` are both TEXT-affinity and match.
 *
 * If you ever need to reference across affinities deliberately (rare —
 * usually means a schema bug), the right fix is to add the column with
 * the matching affinity, not to weaken this gate.
 */

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

beforeAll(async () => {
  const main: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of main) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      if (msg.includes('no such column')) continue;
      throw e;
    }
  }
  const forms: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of forms) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

/**
 * Map a raw SQLite column type string to its 5-affinity bucket.
 * Implementation follows the type-affinity rules in §3.1 of the SQLite
 * docs: https://www.sqlite.org/datatype3.html#type_affinity
 */
function typeAffinity(
  rawType: string | null | undefined
): 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB' | 'NUMERIC' {
  // SQLite: a column with NO declared type has BLOB affinity. Practically
  // we never want that for FK columns — flag it as BLOB so the test
  // surfaces the issue.
  const t = (rawType ?? '').toUpperCase();
  if (t === '') return 'BLOB';
  if (t.includes('INT')) return 'INTEGER';
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'TEXT';
  if (t.includes('BLOB')) return 'BLOB';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'REAL';
  return 'NUMERIC';
}

async function tablesIn(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
         AND name NOT LIKE 'd1_%'
       ORDER BY name`
    )
    .all<{ name: string }>();
  return (rows.results ?? []).map((r) => r.name);
}

interface ColumnInfo {
  name: string;
  type: string;
}

async function columnsOf(db: D1Database, table: string): Promise<Map<string, ColumnInfo>> {
  const rows = await db
    .prepare(`PRAGMA table_info(${table})`)
    .all<{ name: string; type: string }>();
  const m = new Map<string, ColumnInfo>();
  for (const r of rows.results ?? []) {
    m.set(r.name.toLowerCase(), { name: r.name, type: r.type });
  }
  return m;
}

interface FkRow {
  id: number;
  seq: number;
  table: string; // referenced table
  from: string; // referencing column on `table_name` arg
  to: string; // referenced column on `table` field
}

async function fksOf(db: D1Database, table: string): Promise<FkRow[]> {
  const rows = await db.prepare(`PRAGMA foreign_key_list(${table})`).all<FkRow>();
  return rows.results ?? [];
}

async function assertFkAffinityConsistency(db: D1Database, bindingLabel: string): Promise<void> {
  const tables = await tablesIn(db);

  // Cache column info per table to avoid N*M PRAGMA calls
  const colCache = new Map<string, Map<string, ColumnInfo>>();
  const getCols = async (t: string): Promise<Map<string, ColumnInfo>> => {
    let c = colCache.get(t);
    if (!c) {
      c = await columnsOf(db, t);
      colCache.set(t, c);
    }
    return c;
  };

  const offenders: string[] = [];

  for (const fromTable of tables) {
    const fks = await fksOf(db, fromTable);
    for (const fk of fks) {
      const fromCols = await getCols(fromTable);
      const toCols = await getCols(fk.table);

      const fromCol = fromCols.get(fk.from.toLowerCase());
      const toCol = toCols.get(fk.to.toLowerCase());

      if (!fromCol) {
        offenders.push(
          `${bindingLabel}.${fromTable}: FK column ${fk.from} not found in table_info`
        );
        continue;
      }
      if (!toCol) {
        offenders.push(
          `${bindingLabel}.${fromTable}.${fk.from} → ${fk.table}.${fk.to}: referenced column not found`
        );
        continue;
      }

      const fromAff = typeAffinity(fromCol.type);
      const toAff = typeAffinity(toCol.type);
      if (fromAff !== toAff) {
        offenders.push(
          `${bindingLabel}.${fromTable}.${fk.from} (${fromCol.type || '<no type>'} → ${fromAff}) ` +
            `references ${fk.table}.${fk.to} (${toCol.type || '<no type>'} → ${toAff}); ` +
            `affinity mismatch`
        );
      }
    }
  }

  expect(
    offenders,
    `Foreign-key type-affinity mismatch — referencing column's SQLite ` +
      `affinity must match the referenced column's affinity. ` +
      `Offenders:\n  ${offenders.join('\n  ')}`
  ).toEqual([]);
}

describe('FK type-affinity invariant: referencing column matches referenced column', () => {
  test('DB foreign keys have consistent type affinity', async () => {
    await assertFkAffinityConsistency(tenv().DB, 'DB');
  });

  test('FORMS_DB foreign keys have consistent type affinity', async () => {
    await assertFkAffinityConsistency(tenv().FORMS_DB, 'FORMS_DB');
  });

  test('regression: corridor FK columns are TEXT, matching corridors.id TEXT PRIMARY KEY', async () => {
    // The specific OSE-236 / OSE-237 AC defect — locked in by name so a
    // future migration adding e.g. `corridor_id INTEGER REFERENCES
    // corridors(id)` fails the canonical check above AND this targeted
    // sentinel.
    const tables = await tablesIn(tenv().DB);
    for (const t of tables) {
      const cols = await columnsOf(tenv().DB, t);
      for (const [, info] of cols) {
        if (/^([a-z_]*_)?corridor_id$/i.test(info.name)) {
          const aff = typeAffinity(info.type);
          expect(
            aff,
            `${t}.${info.name} must be TEXT affinity (corridors.id is TEXT). ` +
              `Got: ${info.type} (${aff}).`
          ).toBe('TEXT');
        }
      }
    }
  });
});
