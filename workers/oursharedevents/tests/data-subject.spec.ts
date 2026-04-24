/**
 * OSE-203 — Data Subject Rights: POST /api/v2/admin/data-subject/erase
 *
 * GDPR Art. 17 right to erasure, CCPA §1798.105 right to delete,
 * and 13 US state privacy laws with equivalent rights.
 *
 * L1: static shape (export)
 * L2: integration via SELF.fetch
 *   - admin auth required
 *   - input validation (missing/invalid email)
 *   - correct deletion from email_signups and form_registrations
 *   - pii_audit_log entry written
 *   - idempotent (second call returns 0 counts)
 *   - raw email never appears in response (only hash)
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, it, expect, beforeAll } from 'vitest';
import { handleDataSubjectErase } from '../src/handlers/data-subject';

// ── DB setup ───────────────────────────────────────────────────────────────────

async function applyFormsMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(
    (env as Record<string, string>).TEST_FORMS_MIGRATION_STATEMENTS
  );
  for (const stmt of statements) {
    try {
      await (env as Record<string, D1Database>).FORMS_DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyFormsMigrations();
});

function formsDb(): D1Database {
  return (env as Record<string, D1Database>).FORMS_DB;
}

const ADMIN_KEY = 'test-admin-key-e2e-2026';

function adminHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' };
}

function eraseUrl(): string {
  return 'https://t.test/api/v2/admin/data-subject/erase';
}

// ── L1: Static shape ──────────────────────────────────────────────────────────

describe('data-subject — L1 static', () => {
  it('exports handleDataSubjectErase as a function', () => {
    expect(typeof handleDataSubjectErase).toBe('function');
  });
});

// ── L2: Auth ──────────────────────────────────────────────────────────────────

describe('POST /api/v2/admin/data-subject/erase — auth', () => {
  test('no auth → 401', async () => {
    const res = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });
});

// ── L2: Input validation ──────────────────────────────────────────────────────

describe('POST /api/v2/admin/data-subject/erase — validation', () => {
  test('missing email field → 400 INVALID_EMAIL', async () => {
    const res = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('INVALID_EMAIL');
  });

  test('invalid email format → 400 INVALID_EMAIL', async () => {
    const res = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('INVALID_EMAIL');
  });

  test('non-JSON body → 400 INVALID_BODY', async () => {
    const res = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      body: 'not json at all',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('INVALID_BODY');
  });
});

// ── L2: Erasure behaviour ─────────────────────────────────────────────────────

describe('POST /api/v2/admin/data-subject/erase — erasure', () => {
  test('returns 200 with emailHash and counts for unknown email', async () => {
    const res = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.emailHash).toBe('string');
    expect((body.emailHash as string).length).toBe(64);
    expect(body.signupsDeleted).toBe(0);
    expect(body.registrationsDeleted).toBe(0);
    expect(typeof body.erasedAt).toBe('string');
  });

  test('response never contains the raw email address', async () => {
    const email = 'sensitive@example.com';
    const res = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    const text = await res.text();
    expect(text).not.toContain(email);
  });

  test('deletes matching email_signups by hash', async () => {
    const email = 'toerase@example.com';

    // Step 1: get the hash via a dry-run erase
    const hashRes = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    const { emailHash } = (await hashRes.json()) as { emailHash: string };

    // Step 2: seed a signup with that hash
    const signupId = `erase-su-${crypto.randomUUID()}`;
    await formsDb()
      .prepare(
        `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
         VALUES (?, 'ds-test', ?, 'enc-xyz', '2026-01', '2099-01-01')`
      )
      .bind(signupId, emailHash)
      .run();

    // Step 3: erase
    const eraseRes = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    expect(eraseRes.status).toBe(200);
    const eraseBody = (await eraseRes.json()) as Record<string, unknown>;
    expect(eraseBody.signupsDeleted).toBe(1);

    // Step 4: verify row is gone
    const row = await formsDb()
      .prepare('SELECT id FROM email_signups WHERE id = ?')
      .bind(signupId)
      .first();
    expect(row).toBeNull();
  });

  test('deletes matching form_registrations by attendee_email_hash', async () => {
    const email = 'reg-erase@example.com';

    const hashRes = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    const { emailHash } = (await hashRes.json()) as { emailHash: string };

    const regId = `erase-reg-${crypto.randomUUID()}`;
    await formsDb()
      .prepare(
        `INSERT INTO form_registrations (id, event_id, registration_bucket, status, attendee_email_hash)
         VALUES (?, 'ds-test', '2026-04', 'confirmed', ?)`
      )
      .bind(regId, emailHash)
      .run();

    const eraseRes = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    const eraseBody = (await eraseRes.json()) as Record<string, unknown>;
    expect(eraseBody.registrationsDeleted).toBe(1);

    const row = await formsDb()
      .prepare('SELECT id FROM form_registrations WHERE id = ?')
      .bind(regId)
      .first();
    expect(row).toBeNull();
  });

  test('writes a pii_audit_log entry with phase = data_subject_erase', async () => {
    const countBefore = await formsDb()
      .prepare(`SELECT COUNT(*) as n FROM pii_audit_log WHERE phase = 'data_subject_erase'`)
      .first<{ n: number }>();

    await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email: 'audit-check@example.com' }),
    });

    const countAfter = await formsDb()
      .prepare(`SELECT COUNT(*) as n FROM pii_audit_log WHERE phase = 'data_subject_erase'`)
      .first<{ n: number }>();

    expect(countAfter?.n ?? 0).toBeGreaterThan(countBefore?.n ?? 0);
  });

  test('is idempotent — second call returns 0 deletion counts', async () => {
    const email = 'idempotent@example.com';

    const hashRes = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    const { emailHash } = (await hashRes.json()) as { emailHash: string };

    const signupId = `idem-${crypto.randomUUID()}`;
    await formsDb()
      .prepare(
        `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
         VALUES (?, 'ds-test', ?, 'enc-idem', '2026-01', '2099-01-01')`
      )
      .bind(signupId, emailHash)
      .run();

    // First erase — deletes 1
    const first = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(firstBody.signupsDeleted).toBe(1);

    // Second erase — nothing left to delete
    const second = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    const secondBody = (await second.json()) as Record<string, unknown>;
    expect(secondBody.ok).toBe(true);
    expect(secondBody.signupsDeleted).toBe(0);
  });
});
