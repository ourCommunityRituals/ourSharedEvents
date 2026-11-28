/**
 * POST /api/v2/admin/data-subject/export — answer an access request (GDPR
 * Art. 15 / 20) from the forms database, by email.
 *
 * Level: W (workers pool, real D1, the real route through SELF).
 *
 * @born-red export | method: written before the route existed; every request
 *   answered 404, so each test failed | date: 2026-11-28
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { encryptText, hashEmail } from '../src/lib/forms-db';

const E = env as unknown as Record<string, string> & { DB: D1Database; FORMS_DB: D1Database };
const URL_EXPORT = 'https://t.test/api/v2/admin/data-subject/export';
const ADMIN_HEADERS = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
};

async function applyAll(db: D1Database, statementsJson: string): Promise<void> {
  for (const stmt of JSON.parse(statementsJson) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column name') ||
        m.includes('already exists') ||
        m.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyAll(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
  await applyAll(E.DB, E.TEST_MIGRATION_STATEMENTS);
});

afterEach(() => vi.restoreAllMocks());

const post = (body: unknown, headers: Record<string, string> = ADMIN_HEADERS) =>
  SELF.fetch(URL_EXPORT, { method: 'POST', headers, body: JSON.stringify(body) });

async function seed(email: string) {
  const h = await hashEmail(email, E.FORMS_HASH_PEPPER, { requirePepper: true });
  const key = E.FORMS_ENCRYPTION_KEY;
  await E.FORMS_DB.prepare(
    `INSERT INTO form_registrations (id, event_id, registration_bucket, status, attendee_email_hash,
       attendee_name_encrypted, attendee_email_encrypted, anonymous_id, expires_at)
     VALUES (?, 'ds-export', '2026-11', 'confirmed', ?, ?, ?, 'keyed-id-must-not-leak', '2099-01-01')`
  )
    .bind(
      `reg-${crypto.randomUUID()}`,
      h,
      key ? await encryptText('Pat Example', key) : 'x',
      key ? await encryptText(email, key) : 'x'
    )
    .run();
  await E.FORMS_DB.prepare(
    `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
     VALUES (?, 'ds-export', ?, ?, '2026-11', '2099-01-01')`
  )
    .bind(`su-${crypto.randomUUID()}`, h, key ? await encryptText(email, key) : 'x')
    .run();
  await E.FORMS_DB.prepare(
    `INSERT INTO subscribers (email_hash, email_encrypted, ip_hash, source) VALUES (?, ?, 'iph', 'landing')`
  )
    .bind(h, key ? await encryptText(email, key) : 'x')
    .run();
  return h;
}

describe('data-subject export', () => {
  test('no credentials: 401', async () => {
    const res = await post({ email: 'a@example.com' }, { 'Content-Type': 'application/json' });
    expect(res.status).toBe(401);
  });

  test('a bad email: 400, before any lookup', async () => {
    const res = await post({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('returns every forms row for the email, decrypted, and nothing that names the lookup', async () => {
    const email = `export-${crypto.randomUUID()}@example.com`;
    const h = await seed(email);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(' '));
    });
    const res = await post({ email });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.ok).toBe(true);
    expect(body.data.registrations).toHaveLength(1);
    expect(body.data.event_email_signups).toHaveLength(1);
    expect(body.data.updates_list).toHaveLength(1);
    if (E.FORMS_ENCRYPTION_KEY) {
      expect(body.data.registrations[0].name).toBe('Pat Example');
      expect(body.data.registrations[0].email).toBe(email);
    }
    expect(body.not_included).toContain('cannot be found by email');
    // The lookup hash and the keyed id never leave the handler.
    expect(text).not.toContain(h);
    expect(text).not.toContain('keyed-id-must-not-leak');
    for (const l of lines) {
      expect(l).not.toContain(h);
      expect(l).not.toContain(email);
    }
    const audit = await E.FORMS_DB.prepare(
      'SELECT phase, records_affected, details FROM pii_audit_log WHERE id = ?'
    )
      .bind(body.jobId)
      .first<{ phase: string; records_affected: number; details: string }>();
    expect(audit?.phase).toBe('data_subject_export');
    expect(audit?.records_affected).toBe(3);
    expect(audit?.details).not.toContain(h);
  });

  test('changes nothing: a second export finds the same rows', async () => {
    const email = `export-ro-${crypto.randomUUID()}@example.com`;
    await seed(email);
    const one = await (await post({ email })).json<{ data: Record<string, unknown[]> }>();
    const two = await (await post({ email })).json<{ data: Record<string, unknown[]> }>();
    expect(two.data.registrations.length).toBe(one.data.registrations.length);
    expect(two.data.updates_list.length).toBe(1);
  });

  test('an unknown email: ok, with empty lists', async () => {
    const res = await post({ email: `nobody-${crypto.randomUUID()}@example.com` });
    const body = await res.json<{ ok: boolean; data: Record<string, unknown[]> }>();
    expect(body.ok).toBe(true);
    expect(body.data.registrations).toEqual([]);
  });
});
