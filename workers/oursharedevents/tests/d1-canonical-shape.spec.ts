import { describe, expect, test } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalSchema,
  diffSchema,
  extractColumnsFromMigrations,
  remoteSchema,
} from '../scripts/verify-d1-canonical-shape.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = join(here, '..');

describe('OSE-1347 canonical D1 shape verifier', () => {
  test('derives the post-migration forms column set from migration SQL', () => {
    const schema = extractColumnsFromMigrations(join(workerRoot, 'migrations-forms'));

    expect(schema.get('form_registrations')).toEqual(
      new Set([
        'id',
        'event_id',
        'source_placement_id',
        'attendee_name',
        'attendee_email_hash',
        'registration_bucket',
        'status',
        'created_at',
        'expires_at',
        'anonymous_id',
        'consent_given_at',
        'consent_type',
        'attendee_name_encrypted',
        'attendee_email_encrypted',
      ])
    );
  });

  test('handles recreated/renamed main tables and excludes retired ones', () => {
    const schema = canonicalSchema();

    expect(schema.DB.has('scans')).toBe(false);
    expect(schema.DB.has('sponsors')).toBe(false);
    expect(schema.DB.get('scan_aggregates')).toContain('distinct_agent_hashes');
    expect(schema.DB.get('scan_aggregates')).not.toContain('unique_agents');
    // OSE-1661: the email list left the anonymous DB (main 0098, forms 0017).
    expect(schema.DB.has('subscribers')).toBe(false);
    expect(schema.FORMS_DB.get('subscribers')).toEqual([
      'created_at',
      'email_encrypted',
      'email_hash',
      'id',
      'ip_hash',
      'source',
    ]);
  });

  test('reports missing and extra columns by table', () => {
    const expected = new Map([
      ['form_registrations', ['attendee_name_encrypted', 'event_id', 'id']],
    ]);
    const actual = new Map([['form_registrations', ['event_id', 'id', 'legacy_plaintext']]]);

    expect(diffSchema(expected, actual)).toEqual([
      {
        type: 'missing-column',
        table: 'form_registrations',
        column: 'attendee_name_encrypted',
      },
      {
        type: 'extra-column',
        table: 'form_registrations',
        column: 'legacy_plaintext',
      },
    ]);
  });

  test('queries PRAGMA table_info for every canonical table', async () => {
    const commands: string[] = [];
    const actual = await remoteSchema(
      'ocr-forms-db-staging',
      'staging',
      ['form_registrations'],
      async (dbName, cfEnv, command) => {
        commands.push(`${dbName}:${cfEnv}:${command}`);
        return [{ name: 'id' }, { name: 'attendee_name_encrypted' }];
      }
    );

    expect(commands).toEqual([
      'ocr-forms-db-staging:staging:PRAGMA table_info("form_registrations")',
    ]);
    expect(actual.get('form_registrations')).toEqual(['attendee_name_encrypted', 'id']);
  });

  test('does not synthesize an empty table when PRAGMA table_info returns no rows', async () => {
    const actual = await remoteSchema(
      'ocr-forms-db-staging',
      'staging',
      ['form_registrations'],
      async () => []
    );

    expect(actual.has('form_registrations')).toBe(false);
    expect(diffSchema(new Map([['form_registrations', ['id']]]), actual)).toEqual([
      { type: 'missing-table', table: 'form_registrations' },
    ]);
  });
});
