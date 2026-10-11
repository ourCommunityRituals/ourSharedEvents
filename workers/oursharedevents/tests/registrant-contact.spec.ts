/**
 * Registrants can be reached about their event, if they choose to be
 * (owner 2026-10-11).
 *
 * The point of registering is that the organizer can say "the night moved" or
 * "it is cancelled", and a person can give up their place. So:
 *
 *   - The email stays optional (the choice principle). When one is given it is
 *     kept encrypted, beside the hash that already handled dedup and erasure.
 *   - The organizer reads the emails for their own event on one admin route,
 *     `GET /api/v2/admin/events/:id/forms/contacts`, brand-scoped by the object
 *     guard and written to the admin audit log as READ_REGISTRANT_CONTACTS.
 *   - Name and email are cleared the day after the event's last date (end
 *     date, else start date), so a reschedule moves the clearing with it. The
 *     row and its email hash stay until the row's own 90-day expiry, so counts
 *     and erasure by email still work.
 *
 * @born-red registrant contact | method: each test was run before the change
 *   (no encrypted column, no contacts route, no clearing) | date: 2026-10-11
 */
import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import worker from '../src/index';
import type { RouterEnv } from '../src/router';
import { handleFormRegistration, type FormsEnv } from '../src/handlers/forms';
import { decryptText, encryptText } from '../src/lib/pii';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  FORMS_ENCRYPTION_KEY: string;
}
const E = env as unknown as TestEnv;
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };

async function apply(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column') ||
        m.includes('already exists') ||
        m.includes('no such column')
      )
        continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await apply(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await apply(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
});

/** A UTC calendar day, `n` days from today (negative is the past). */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function seedEvent(id: string, start: string, end: string | null = start): Promise<void> {
  await E.DB.prepare(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, location, created_at, updated_at)
     VALUES (?, 'root', ?, ?, 'active', 1, ?, ?, 'The Hall', datetime('now'), datetime('now'))`
  )
    .bind(id, `Contact ${id}`, id, start, end)
    .run();
}

const register = (
  eventId: string,
  body: Record<string, unknown>,
  e: FormsEnv = E as unknown as FormsEnv
) =>
  handleFormRegistration(
    new Request('https://t.test/form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    e,
    eventId
  );

const row = (id: string) =>
  E.FORMS_DB.prepare(
    'SELECT attendee_name, attendee_name_encrypted, attendee_email_hash, attendee_email_encrypted FROM form_registrations WHERE id = ?'
  )
    .bind(id)
    .first<Record<string, string | null>>();

describe('an email given at registration is kept encrypted, and stays optional', () => {
  test('with an email: stored as v1: ciphertext that decrypts to it, never in the clear', async () => {
    await seedEvent('evt-rc-enc', day(10));
    const res = await register('evt-rc-enc', { name: 'Ana', email: 'Ana@Example.org' });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const r = (await row(id))!;
    expect(r.attendee_email_encrypted?.startsWith('v1:')).toBe(true);
    expect(await decryptText(r.attendee_email_encrypted!, E.FORMS_ENCRYPTION_KEY)).toBe(
      'Ana@Example.org'
    );
    expect(JSON.stringify(r)).not.toContain('Example.org');
    expect(r.attendee_email_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('without an email: registration still succeeds and keeps no email', async () => {
    await seedEvent('evt-rc-none', day(10));
    const res = await register('evt-rc-none', { name: 'Bo' });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const r = (await row(id))!;
    expect(r.attendee_email_encrypted).toBeNull();
    expect(r.attendee_email_hash).toBeNull();
  });

  test('an email with no encryption key is refused (503) and nothing is written', async () => {
    await seedEvent('evt-rc-nokey', day(10));
    const noKey = { ...(E as unknown as FormsEnv), FORMS_ENCRYPTION_KEY: undefined } as FormsEnv;
    const res = await register('evt-rc-nokey', { email: 'c@example.org' }, noKey);
    expect(res.status).toBe(503);
    const n = await E.FORMS_DB.prepare(
      'SELECT COUNT(*) AS n FROM form_registrations WHERE event_id = ?'
    )
      .bind('evt-rc-nokey')
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});

describe('the organizer reads the emails for their own event, audited', () => {
  test('GET /forms/contacts lists name and email of those who gave one, and is audited', async () => {
    await seedEvent('evt-rc-list', day(10));
    await register('evt-rc-list', { name: 'Dee', email: 'dee@example.org' });
    await register('evt-rc-list', { name: 'Eli' }); // no email: not a contact
    await register('evt-rc-list', { email: 'fay@example.org' }); // email only

    const res = await SELF.fetch('https://t.test/api/v2/admin/events/evt-rc-list/forms/contacts', {
      headers: ADMIN,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as {
      ok: boolean;
      items: { name: string | null; email: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.items.map((i) => i.email).sort()).toEqual(['dee@example.org', 'fay@example.org']);
    expect(body.items.find((i) => i.email === 'dee@example.org')?.name).toBe('Dee');

    const audit = await E.DB.prepare(
      `SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'READ_REGISTRANT_CONTACTS' AND resource_id = ?`
    )
      .bind('evt-rc-list')
      .first<{ n: number }>();
    expect(audit?.n ?? 0).toBeGreaterThan(0);
  });

  test('no admin credential: 401, and no email in the answer', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/evt-rc-list/forms/contacts');
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('@example.org');
  });
});

describe('name and email are cleared the day after the event', () => {
  async function seedRegistration(id: string, eventId: string): Promise<void> {
    const k = E.FORMS_ENCRYPTION_KEY;
    await E.FORMS_DB.prepare(
      `INSERT INTO form_registrations (id, event_id, attendee_name, attendee_name_encrypted, attendee_email_hash, attendee_email_encrypted, registration_bucket, status, expires_at)
       VALUES (?, ?, 'Legacy Name', ?, ?, ?, '2026-10', 'confirmed', ?)`
    )
      .bind(
        id,
        eventId,
        await encryptText('Gus', k),
        'a'.repeat(64),
        await encryptText('gus@example.org', k),
        new Date(Date.now() + 80 * 86_400_000).toISOString()
      )
      .run();
  }

  async function nightly(): Promise<void> {
    const ctx = createExecutionContext();
    await worker.scheduled(
      { scheduledTime: Date.now(), cron: '0 3 * * *', noRetry: () => {} },
      env as unknown as RouterEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);
  }

  test('ended two days ago: name and email cleared; the row and its email hash stay', async () => {
    await seedEvent('evt-rc-past', day(-2));
    await seedRegistration('reg-rc-past', 'evt-rc-past');
    await nightly();
    const r = (await row('reg-rc-past'))!;
    expect(r).not.toBeNull();
    expect(r.attendee_name).toBeNull();
    expect(r.attendee_name_encrypted).toBeNull();
    expect(r.attendee_email_encrypted).toBeNull();
    expect(r.attendee_email_hash).toBe('a'.repeat(64));
    const audit = await E.FORMS_DB.prepare(
      `SELECT SUM(records_affected) AS n FROM pii_audit_log WHERE phase = 'registrations_contact_clear'`
    ).first<{ n: number }>();
    expect(audit?.n ?? 0).toBeGreaterThan(0);
  });

  test('ended yesterday: kept until the next night, so the day after is still reachable', async () => {
    await seedEvent('evt-rc-yday', day(-1));
    await seedRegistration('reg-rc-yday', 'evt-rc-yday');
    await nightly();
    expect((await row('reg-rc-yday'))!.attendee_email_encrypted).not.toBeNull();
  });

  test('a multi-day event that started long ago but ends today keeps its contacts', async () => {
    await seedEvent('evt-rc-long', day(-5), day(0));
    await seedRegistration('reg-rc-long', 'evt-rc-long');
    await nightly();
    expect((await row('reg-rc-long'))!.attendee_email_encrypted).not.toBeNull();
  });

  test('rescheduled to later: the clearing moves with the new date', async () => {
    await seedEvent('evt-rc-moved', day(-3));
    await E.DB.prepare('UPDATE events SET start_date = ?, end_date = ? WHERE id = ?')
      .bind(day(7), day(7), 'evt-rc-moved')
      .run();
    await seedRegistration('reg-rc-moved', 'evt-rc-moved');
    await nightly();
    expect((await row('reg-rc-moved'))!.attendee_email_encrypted).not.toBeNull();
  });

  // D1 allows 100 bound values a statement, so ids go in pages of 90. More than
  // one page of open events sorted ahead of an ended one must not hide it.
  test('more than a page of open events ahead of an ended one: the ended one is still cleared', async () => {
    for (let i = 0; i < 95; i++) {
      const id = `evt-rc-pg-${String(i).padStart(3, '0')}`;
      await seedEvent(id, day(10));
      await seedRegistration(`reg-rc-pg-${i}`, id);
    }
    await seedEvent('evt-rc-pg-zzz', day(-4));
    await seedRegistration('reg-rc-pg-zzz', 'evt-rc-pg-zzz');
    await nightly();
    expect((await row('reg-rc-pg-zzz'))!.attendee_email_encrypted).toBeNull();
    expect((await row('reg-rc-pg-0'))!.attendee_email_encrypted).not.toBeNull();
  });

  test('an event that no longer exists: nothing to tell anyone about, so cleared', async () => {
    await seedRegistration('reg-rc-gone', 'evt-rc-gone-never-created');
    await nightly();
    expect((await row('reg-rc-gone'))!.attendee_email_encrypted).toBeNull();
  });
});
