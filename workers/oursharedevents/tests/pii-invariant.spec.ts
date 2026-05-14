/**
 * PII INVARIANT — cross-DB regression-class gate
 *
 * OSE-207 fixed one instance of a raw network identifier column
 * (subscribers.ip_address). This file is the *class-level* invariant test
 * that catches the same regression on any future table in any binding.
 *
 * Rule: no table in DB or FORMS_DB may carry a column whose name is a raw
 * network identifier. The only acceptable storage for that signal is a
 * hashed form (e.g. ip_hash from OSE-207's peppered SHA-256), and the
 * column name must reflect that (no `ip_address`, no `client_ip`, etc.).
 *
 * Why this lives here and not in forms-security.spec.ts:
 *   - forms-security S13 is FORMS_DB-only ("no raw email in FORMS_DB").
 *   - This invariant is cross-DB and concerns network identifiers, not
 *     emails, so it is its own architectural gate.
 *
 * If a legitimate need arises to store one of the forbidden column names,
 * the right fix is NOT to weaken this gate — it is to use a hashed
 * variant (e.g. `*_hash`) or to extend the allowlist below with a
 * documented rationale on the row's PR.
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

/**
 * Column-name patterns that indicate a raw network identifier is being
 * stored. The exact-match set comes from RFC terminology and the most
 * common Cloudflare / proxy header names. Hashed variants (`*_hash`)
 * are NOT in this list — they are the documented escape hatch.
 */
const RAW_NETWORK_IDENTIFIER_NAMES = new Set([
  'ip_address',
  'ip_addr',
  'client_ip',
  'remote_ip',
  'remote_addr',
  'x_forwarded_for',
  'cf_connecting_ip',
  'user_ip',
  'src_ip',
  'source_ip',
]);

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

async function columnsOf(db: D1Database, table: string): Promise<string[]> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return (rows.results ?? []).map((r) => r.name);
}

async function assertNoRawNetworkIdInBinding(db: D1Database, bindingLabel: string): Promise<void> {
  const tables = await tablesIn(db);
  const offenders: string[] = [];
  for (const t of tables) {
    const cols = await columnsOf(db, t);
    for (const c of cols) {
      if (RAW_NETWORK_IDENTIFIER_NAMES.has(c.toLowerCase())) {
        offenders.push(`${bindingLabel}.${t}.${c}`);
      }
    }
  }
  expect(
    offenders,
    `Forbidden raw network identifier columns found. Use a hashed variant ` +
      `(e.g. *_hash) per OSE-207 / hashIpForSubscribe. Offenders: ` +
      `[${offenders.join(', ')}]`
  ).toEqual([]);
}

describe('PII invariant: no raw network identifier columns anywhere', () => {
  test('DB has no raw network identifier columns', async () => {
    await assertNoRawNetworkIdInBinding(tenv().DB, 'DB');
  });

  test('FORMS_DB has no raw network identifier columns', async () => {
    await assertNoRawNetworkIdInBinding(tenv().FORMS_DB, 'FORMS_DB');
  });
});
