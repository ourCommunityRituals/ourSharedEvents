/**
 * Nothing in the forms database outlives the 90-day ceiling (owner 2026-10-11).
 *
 * The table list is derived from the forms migration SQL (the same parser the
 * deploy-time shape check uses), so a new FORMS_DB table fails here until it
 * states how long it keeps a person's data. Each table is one of:
 *   - deleted after a window of days, which must be at or under the ceiling;
 *   - holding no person data, which is checked against the identity-column
 *     patterns (tests/helpers/identity-columns.ts);
 *   - an open item with the ticket that decides it. An open item that no longer
 *     names a table fails, so the list cannot outlive its tickets.
 *
 * @born-red forms retention ceiling | method: with the values before this change
 *   (SUBSCRIBER_RETENTION_DAYS 365, wrangler.toml "365") the window and
 *   wrangler tests failed; removing feature_flags from RETENTION failed the
 *   "every table" test | date: 2026-10-11
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractColumnsFromMigrations } from '../scripts/verify-d1-canonical-shape.mjs';
import {
  EMAIL_RETENTION_DAYS,
  FORMS_RETENTION_CEILING_DAYS,
  REGISTRATION_TTL_DAYS,
  SUBSCRIBER_RETENTION_DAYS,
} from '../src/lib/retention-windows';
import { classifyColumn } from './helpers/identity-columns';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

type Rule =
  | { kind: 'deleted-after'; days: number; how: string }
  | { kind: 'no-person-data'; why: string }
  | { kind: 'open'; what: string; ticket: string };

/** How long each FORMS_DB table keeps a person's data. */
const RETENTION: Record<string, Rule> = {
  form_registrations: {
    kind: 'deleted-after',
    days: REGISTRATION_TTL_DAYS,
    how: 'expires_at; a row with none goes by created_at (runFormDataLifecycle phase 1)',
  },
  email_signups: {
    kind: 'deleted-after',
    days: EMAIL_RETENTION_DAYS,
    how: 'retention_expires_at, NOT NULL (runFormDataLifecycle phase 3)',
  },
  subscribers: {
    kind: 'deleted-after',
    days: SUBSCRIBER_RETENTION_DAYS,
    how: 'created_at (runFormDataLifecycle phase 4; SUBSCRIBERS_RETENTION_DAYS may shorten it)',
  },
  feature_flags: { kind: 'no-person-data', why: 'plan switches per brand or event' },
  pii_audit_log: { kind: 'no-person-data', why: 'counts of what each erasure or sweep removed' },
  form_surveys: {
    kind: 'open',
    what: 'answers scrubbed the next night, but the row and its keyed id are kept',
    ticket: 'OSE-1687',
  },
  checkin_counts: {
    kind: 'open',
    what: 'last_anonymous_id (a per-event keyed id) is never cleared',
    ticket: 'OSE-1687',
  },
};

const formsTables = () => [...extractColumnsFromMigrations(join(root, 'migrations-forms')).keys()];
const formsColumns = (table: string) => [
  ...(extractColumnsFromMigrations(join(root, 'migrations-forms')).get(table) ?? []),
];

describe('forms database retention ceiling (90 days, owner 2026-10-11)', () => {
  test('the ceiling is 90 days', () => {
    expect(FORMS_RETENTION_CEILING_DAYS).toBe(90);
  });

  test('every forms table states how long it keeps person data, and every rule names a table', () => {
    const tables = formsTables().sort();
    expect(tables.length).toBeGreaterThan(5);
    expect(tables).toEqual(Object.keys(RETENTION).sort());
  });

  test('every deletion window is at or under the ceiling', () => {
    for (const [table, rule] of Object.entries(RETENTION)) {
      if (rule.kind !== 'deleted-after') continue;
      expect(rule.days, table).toBeGreaterThan(0);
      expect(rule.days, table).toBeLessThanOrEqual(FORMS_RETENTION_CEILING_DAYS);
    }
  });

  test('a table said to hold no person data has no identity-shaped column', () => {
    for (const [table, rule] of Object.entries(RETENTION)) {
      if (rule.kind !== 'no-person-data') continue;
      const identity = formsColumns(table).filter((c) => classifyColumn(c).length > 0);
      expect(identity, table).toEqual([]);
    }
  });

  test('every open item names its ticket', () => {
    for (const [table, rule] of Object.entries(RETENTION)) {
      if (rule.kind === 'open') expect(rule.ticket, table).toMatch(/^OSE-\d+$/);
    }
  });

  test('no environment in wrangler.toml sets the email list above the ceiling', () => {
    const toml = readFileSync(join(root, 'wrangler.toml'), 'utf8');
    const values = [...toml.matchAll(/^\s*SUBSCRIBERS_RETENTION_DAYS\s*=\s*"(-?\d+)"/gm)].map((m) =>
      Number(m[1])
    );
    for (const v of values) {
      // Non-positive turns the sweep off entirely, which is never under a ceiling.
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(FORMS_RETENTION_CEILING_DAYS);
    }
  });
});
