/**
 * PII INVARIANT — the column gate for Invariant #1, derived from the schema
 *
 * Rule: no table in DB or FORMS_DB may carry a column that identifies a person
 * (an email, a phone number, a person's name, a raw network address, a browser
 * identifier) unless it is stored hashed or encrypted, or is a reviewed
 * exemption with its reason and where it was decided.
 *
 * Until OSE-1660 this file checked ten exact network-identifier names, so a new
 * column called `email`, `ip` or `attendee_name` passed it. It now reads the
 * real schema after every migration (sqlite_master + PRAGMA table_info) and
 * classifies every column by name pattern (tests/helpers/identity-columns.ts),
 * the way schema-lexicon.spec.ts checks its banned words. A planted violation
 * shows the gate bites, and an exemption that no longer matches a column fails.
 *
 * If this fails on a new column: hash it (`*_hash`), encrypt it
 * (`*_encrypted`), move it, or add a reviewed exemption. Do not loosen the
 * patterns to make it pass.
 *
 * @born-red OSE-1660 | method: a throwaway migration adding events.email,
 *   events.ip and form_surveys.guest_name turned both binding tests red, and a
 *   planted exemption for a missing column turned the stale test red; each was
 *   removed after | date: 2026-10-11
 */

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  IDENTITY_EXEMPTIONS,
  classifyColumn,
  piiColumnViolations,
  readSchemaColumns,
  staleExemptions,
  type SchemaColumn,
} from './helpers/identity-columns';

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

async function allColumns(): Promise<SchemaColumn[]> {
  return [
    ...(await readSchemaColumns(tenv().DB, 'DB')),
    ...(await readSchemaColumns(tenv().FORMS_DB, 'FORMS_DB')),
  ];
}

describe('PII invariant: a column that identifies a person is hashed, encrypted or exempt', () => {
  test('DB: every identity-shaped column is hashed, encrypted or a reviewed exemption', async () => {
    const offenders = piiColumnViolations(await readSchemaColumns(tenv().DB, 'DB'));
    expect(
      offenders,
      `Identity columns stored in the clear: [${offenders.join(', ')}]. ` +
        'Hash it (*_hash), encrypt it (*_encrypted), move it, or add a reviewed exemption.'
    ).toEqual([]);
  });

  test('FORMS_DB: every identity-shaped column is hashed, encrypted or a reviewed exemption', async () => {
    const offenders = piiColumnViolations(await readSchemaColumns(tenv().FORMS_DB, 'FORMS_DB'));
    expect(
      offenders,
      `Identity columns stored in the clear: [${offenders.join(', ')}]. ` +
        'Hash it (*_hash), encrypt it (*_encrypted), move it, or add a reviewed exemption.'
    ).toEqual([]);
  });

  test('the schema really is read: both databases have tables and identity columns', async () => {
    const cols = await allColumns();
    expect(cols.filter((c) => c.binding === 'DB').length).toBeGreaterThan(100);
    expect(cols.filter((c) => c.binding === 'FORMS_DB').length).toBeGreaterThan(20);
    // A gate that classifies nothing passes everything: the known columns are seen.
    expect(cols.filter((c) => classifyColumn(c.column).length > 0).length).toBeGreaterThan(5);
  });

  test('every exemption still names a column in the schema (no stale exemptions)', async () => {
    expect(staleExemptions(await allColumns())).toEqual([]);
    for (const [key, e] of IDENTITY_EXEMPTIONS) {
      expect(e.why.length, `${key} has no reason`).toBeGreaterThan(10);
      expect(e.ref, `${key} names no decision or ticket`).toMatch(/OSE-\d+|PR #\d+|migration \d+/);
    }
  });

  test('planted violations are caught (the gate bites)', () => {
    const planted: SchemaColumn[] = [
      { binding: 'DB', table: 'fixture', column: 'email' },
      { binding: 'DB', table: 'fixture', column: 'ip' },
      { binding: 'FORMS_DB', table: 'fixture', column: 'attendee_name' },
      { binding: 'DB', table: 'fixture', column: 'user_agent' },
      { binding: 'DB', table: 'fixture', column: 'anonymous_id' },
      { binding: 'DB', table: 'fixture', column: 'contactPhone' },
      { binding: 'DB', table: 'fixture', column: 'x_forwarded_for' },
    ];
    expect(piiColumnViolations(planted)).toEqual([
      'DB.fixture.email (email)',
      'DB.fixture.ip (network)',
      'FORMS_DB.fixture.attendee_name (person-name)',
      'DB.fixture.user_agent (browser)',
      'DB.fixture.anonymous_id (browser)',
      'DB.fixture.contactPhone (phone)',
      'DB.fixture.x_forwarded_for (network)',
    ]);
  });

  test('hashed and encrypted forms pass; near-misses are not identity columns', () => {
    const ok: SchemaColumn[] = [
      { binding: 'FORMS_DB', table: 'fixture', column: 'attendee_email_hash' },
      { binding: 'FORMS_DB', table: 'fixture', column: 'email_encrypted' },
      { binding: 'DB', table: 'fixture', column: 'ip_hash' },
      { binding: 'DB', table: 'fixture', column: 'distinct_agent_hashes' },
    ];
    expect(piiColumnViolations(ok)).toEqual([]);
    for (const near of [
      'display_name',
      'shipping_zone',
      'skip_count',
      'event_type_name',
      'where_address',
    ]) {
      expect(classifyColumn(near), near).toEqual([]);
    }
  });
});
