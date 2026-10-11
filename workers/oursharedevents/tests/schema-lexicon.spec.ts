/**
 * OSE-801 (A4, milestone M0) — the honesty lexicon runs over the SCHEMA.
 *
 * Reads the REAL built schema after all migrations (sqlite_master + PRAGMA
 * table_info) and asserts no table / column / index / view / trigger identifier
 * carries a banned token. This is the CI step the ticket asks for — the lint no
 * longer stops at the surface while the storage layer speaks the banned words.
 *
 * OSE-934: the same read runs over FORMS_DB (registrations, check-ins, surveys,
 * email signups, flags, PII audit). A gate that read one of two databases would
 * stay green while a forms migration brought the banned words back.
 *
 * @born-red OSE-801 | method: sqlite_master-vs-banned-lexicon | date: 2026-08-20
 * @born-red OSE-934 | method: planted forms-side column | date: 2026-10-11
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  BANNED_SCHEMA_TERMS,
  EXEMPT_IDENTIFIERS,
  findBannedSchemaIdentifiers,
  tokenizeIdentifier,
  type SchemaIdentifier,
} from '../src/lib/schema-lexicon';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

/** Both persistence layers, each with its own migrations. */
const DATABASES = [
  { name: 'DB', db: () => tenv().DB, statements: () => tenv().TEST_MIGRATION_STATEMENTS },
  {
    name: 'FORMS_DB',
    db: () => tenv().FORMS_DB,
    statements: () => tenv().TEST_FORMS_MIGRATION_STATEMENTS,
  },
] as const;

async function applyMigrations(db: D1Database, json: string): Promise<void> {
  const statements: string[] = JSON.parse(json);
  for (const stmt of statements) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      if (msg.includes('no such column')) continue;
      throw e;
    }
  }
}

/** Collect every user-defined identifier from the built schema. */
async function collectSchemaIdentifiers(db: D1Database): Promise<SchemaIdentifier[]> {
  const ids: SchemaIdentifier[] = [];

  const objects = await db
    .prepare(
      `SELECT type, name FROM sqlite_master
     WHERE type IN ('table','index','view','trigger')
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '_cf_%'
       AND name NOT LIKE 'd1_%'`
    )
    .all<{ type: string; name: string }>();

  for (const o of objects.results ?? []) {
    ids.push({ kind: o.type, name: o.name });
    if (o.type === 'table') {
      const cols = await db.prepare(`PRAGMA table_info(${o.name})`).all<{ name: string }>();
      for (const c of cols.results ?? []) {
        ids.push({ kind: 'column', name: c.name, table: o.name });
      }
    }
  }
  return ids;
}

beforeAll(async () => {
  for (const d of DATABASES) await applyMigrations(d.db(), d.statements());
});

describe('OSE-801 — schema honesty lexicon (M0)', () => {
  test.each(DATABASES.map((d) => [d.name, d] as const))(
    '%s: no schema identifier carries a banned token',
    async (_name, d) => {
      const ids = await collectSchemaIdentifiers(d.db());
      // The read sees the schema at all (a broken collector would pass on nothing).
      expect(ids.filter((i) => i.kind === 'table').length).toBeGreaterThan(3);
      const violations = findBannedSchemaIdentifiers(ids);
      const detail = violations
        .map((v) => `${v.kind} ${v.table ? v.table + '.' : ''}${v.name} → "${v.term}"`)
        .join('\n  ');
      // If this fails, a migration introduced a banned-word identifier. Rename it
      // (add a migration) or, if the rename is a separate coordinated change,
      // add it to EXEMPT_IDENTIFIERS with the ticket that removes it. Do NOT
      // weaken BANNED_SCHEMA_TERMS to make this pass.
      expect(violations, `banned-word identifiers in ${d.name}:\n  ${detail}`).toEqual([]);
    }
  );

  test('every EXEMPT_IDENTIFIERS entry still exists in the schema (no stale exemptions)', async () => {
    const present = new Set<string>();
    for (const d of DATABASES) {
      for (const i of await collectSchemaIdentifiers(d.db())) present.add(i.name);
    }
    for (const name of EXEMPT_IDENTIFIERS.keys()) {
      // A stale exemption is a lie the other direction — it must be pruned once
      // the identifier is gone. Fails when the tracked rename finally lands.
      expect(present.has(name), `exempt identifier "${name}" no longer in schema — remove it`).toBe(
        true
      );
    }
  });

  test('planted violation is caught (the gate actually bites)', () => {
    const planted: SchemaIdentifier[] = [
      { kind: 'column', name: 'impressions_total', table: 'fixture' },
      { kind: 'column', name: 'uniqueVisitors', table: 'fixture' },
      { kind: 'table', name: 'attendance_rollup' },
    ];
    const violations = findBannedSchemaIdentifiers(planted);
    expect(violations.map((v) => v.term).sort()).toEqual(['attendance', 'impressions', 'unique']);
  });

  test('tokenizer splits snake_case and camelCase', () => {
    expect(tokenizeIdentifier('unique_agents')).toEqual(['unique', 'agents']);
    expect(tokenizeIdentifier('impressionToken')).toEqual(['impression', 'token']);
    expect(tokenizeIdentifier('distinct_agent_hashes')).toEqual(['distinct', 'agent', 'hashes']);
  });

  test('a legitimate near-miss is not a false positive', () => {
    // "reviews" contains "view" as a substring but not as a token; "reachable"
    // is not "reach". Token matching, not substring, keeps these clean.
    const ok: SchemaIdentifier[] = [
      { kind: 'column', name: 'is_local_review_flag', table: 'fixture' },
      { kind: 'column', name: 'reachable_at', table: 'fixture' },
    ];
    expect(tokenizeIdentifier('is_local_review_flag')).not.toContain('view');
    expect(findBannedSchemaIdentifiers(ok)).toEqual([]);
    // sanity: the banned set is non-empty and holds the anchors
    expect(BANNED_SCHEMA_TERMS.has('impression')).toBe(true);
  });
});
