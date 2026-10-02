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
 *   - raw email never appears in response, and neither does its emailHash
 *     (log redaction: the hash is a stable pseudonym of the erased person)
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, it, expect, beforeAll } from 'vitest';
import { handleDataSubjectErase, type DataSubjectEnv } from '../src/handlers/data-subject';
import { hashAnonIdForReturns } from '../src/lib/anon-id-hash';
import { hashEmail } from '../src/lib/forms-db';

const TEST_ANON_PEPPER = 'test-anon-id-hash-pepper-do-not-use-in-prod';

/**
 * The email hash the erase handler computes — the same function and the same
 * FORMS_HASH_PEPPER (from the shared test worker env, vitest.workers.config.mts)
 * the handler uses. The handler no longer returns it, so tests that seed rows
 * derive it here instead of reading it off a response.
 */
async function handlerEmailHash(email: string): Promise<string> {
  return hashEmail(email.trim(), (env as Record<string, string>).FORMS_HASH_PEPPER, {
    requirePepper: true,
  });
}

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

// OSE-1350: the main DB (scan_node_returns, anon_id_returns) needs its own
// migrations applied — TEST_FORMS_MIGRATION_STATEMENTS only covers FORMS_DB.
async function applyMainMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(
    (env as Record<string, string>).TEST_MIGRATION_STATEMENTS
  );
  for (const stmt of statements) {
    try {
      await (env as Record<string, D1Database>).DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyFormsMigrations();
  await applyMainMigrations();
  // OSE-1350: seed the FK target event used by the anon-ID purge tests below.
  // scan_node_returns.event_id and anon_id_returns.venue_id both FK to
  // events(id); an unseeded 'ds-test' id would fail the insert with
  // SQLITE_CONSTRAINT_FOREIGNKEY. Uses INSERT OR IGNORE so re-runs are safe.
  await (env as Record<string, D1Database>).DB.prepare(
    `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status)
     VALUES ('ds-test', 'test-brand', 'DS Test Event', 'ds-test', 'active')`
  ).run();
});

function formsDb(): D1Database {
  return (env as Record<string, D1Database>).FORMS_DB;
}

function mainDb(): D1Database {
  return (env as Record<string, D1Database>).DB;
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
  test('returns 200 with counts and WITHOUT emailHash for unknown email', async () => {
    const res = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    // Log redaction: the emailHash is a stable pseudonym of the person being
    // erased — it must not leave the handler.
    expect(body).not.toHaveProperty('emailHash');
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
    expect(text).not.toContain(await handlerEmailHash(email));
  });

  test('deletes matching email_signups by hash', async () => {
    const email = 'toerase@example.com';

    const emailHash = await handlerEmailHash(email);

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

    const emailHash = await handlerEmailHash(email);

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

  test('pii_audit_log details carry counts only — no emailHash key or value', async () => {
    const email = 'audit-redaction@example.com';
    const emailHash = await handlerEmailHash(email);
    const signupId = `audit-red-${crypto.randomUUID()}`;
    await formsDb()
      .prepare(
        `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
         VALUES (?, 'ds-test', ?, 'enc-audit', '2026-01', '2099-01-01')`
      )
      .bind(signupId, emailHash)
      .run();

    const res = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).signupsDeleted).toBe(1);

    // The newest erase audit row is the one this request wrote (records_affected
    // = 1 pins it to this erase, not a zero-count one from another test).
    const row = await formsDb()
      .prepare(
        `SELECT details FROM pii_audit_log
          WHERE phase = 'data_subject_erase' AND records_affected = 1
          ORDER BY rowid DESC LIMIT 1`
      )
      .first<{ details: string }>();
    expect(row).not.toBeNull();
    const details = JSON.parse(row!.details) as Record<string, unknown>;
    expect(details).not.toHaveProperty('emailHash');
    expect(row!.details).not.toContain(emailHash);
    expect(details.signupsDeleted).toBe(1);
  });

  test('is idempotent — second call returns 0 deletion counts', async () => {
    const email = 'idempotent@example.com';

    const emailHash = await handlerEmailHash(email);

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

// ── L2: OSE-1350 anon-ID-linked scan/report purge ─────────────────────────────

describe('POST /api/v2/admin/data-subject/erase — OSE-1350 anon-ID purge', () => {
  test('purges scan_node_returns for an anon_id linked via email_signups, no pepper required', async () => {
    const email = 'scan-purge@example.com';
    const anonId = `anon-${crypto.randomUUID()}`;

    const emailHash = await handlerEmailHash(email);

    const signupId = `snr-su-${crypto.randomUUID()}`;
    await formsDb()
      .prepare(
        `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at, anonymous_id)
         VALUES (?, 'ds-test', ?, 'enc-snr', '2026-01', '2099-01-01', ?)`
      )
      .bind(signupId, emailHash, anonId)
      .run();

    const scanRowId = `snr-${crypto.randomUUID()}`;
    await mainDb()
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, anonymous_id, scan_bucket)
         VALUES (?, 'ds-test', ?, '2026-01')`
      )
      .bind(scanRowId, anonId)
      .run();

    const eraseRes = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    expect(eraseRes.status).toBe(200);
    const eraseBody = (await eraseRes.json()) as Record<string, unknown>;
    expect(eraseBody.scanReturnsDeleted).toBe(1);
    // ANON_ID_HASH_PEPPER is not configured in the shared test worker env, so
    // this phase is expected to skip gracefully rather than delete anything.
    expect(eraseBody.anonIdReturnsDeleted).toBe(0);

    const row = await mainDb()
      .prepare('SELECT id FROM scan_node_returns WHERE id = ?')
      .bind(scanRowId)
      .first();
    expect(row).toBeNull();
  });

  test('purges anon_id_returns for an anon_id linked via form_registrations, when pepper is configured', async () => {
    const email = 'anon-returns-purge@example.com';
    const anonId = `anon-${crypto.randomUUID()}`;
    const anonIdHash = await hashAnonIdForReturns(anonId, TEST_ANON_PEPPER);
    expect(anonIdHash).not.toBeNull();

    const testEnv: DataSubjectEnv = {
      ...(env as unknown as DataSubjectEnv),
      ANON_ID_HASH_PEPPER: TEST_ANON_PEPPER,
    };

    const emailHash = await handlerEmailHash(email);

    const regId = `air-reg-${crypto.randomUUID()}`;
    await formsDb()
      .prepare(
        `INSERT INTO form_registrations (id, event_id, registration_bucket, status, attendee_email_hash, anonymous_id)
         VALUES (?, 'ds-test', '2026-04', 'confirmed', ?, ?)`
      )
      .bind(regId, emailHash, anonId)
      .run();

    await mainDb()
      .prepare(
        `INSERT INTO anon_id_returns (anon_id_hash, venue_id, first_seen_at, last_seen_at, visit_count)
         VALUES (?, 'ds-test', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)`
      )
      .bind(anonIdHash)
      .run();

    const eraseRes = await handleDataSubjectErase(
      new Request(eraseUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
      testEnv
    );
    expect(eraseRes.status).toBe(200);
    const eraseBody = (await eraseRes.json()) as Record<string, unknown>;
    expect(eraseBody.anonIdReturnsDeleted).toBe(1);

    const row = await mainDb()
      .prepare('SELECT anon_id_hash FROM anon_id_returns WHERE anon_id_hash = ?')
      .bind(anonIdHash)
      .first();
    expect(row).toBeNull();
  });

  test('leaves scan/report rows untouched for an anon_id never linked to this email', async () => {
    const email = 'unlinked-anon@example.com';
    const unrelatedAnonId = `anon-unrelated-${crypto.randomUUID()}`;

    const scanRowId = `snr-unrelated-${crypto.randomUUID()}`;
    await mainDb()
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, anonymous_id, scan_bucket)
         VALUES (?, 'ds-test', ?, '2026-01')`
      )
      .bind(scanRowId, unrelatedAnonId)
      .run();

    const eraseRes = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    const eraseBody = (await eraseRes.json()) as Record<string, unknown>;
    expect(eraseBody.scanReturnsDeleted).toBe(0);

    const row = await mainDb()
      .prepare('SELECT id FROM scan_node_returns WHERE id = ?')
      .bind(scanRowId)
      .first();
    expect(row).not.toBeNull();
  });

  test('response never contains the raw anon_id when a linked anon_id was purged', async () => {
    const email = 'anon-no-leak@example.com';
    const anonId = `anon-secret-${crypto.randomUUID()}`;

    const emailHash = await handlerEmailHash(email);

    await formsDb()
      .prepare(
        `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at, anonymous_id)
         VALUES (?, 'ds-test', ?, 'enc-leak', '2026-01', '2099-01-01', ?)`
      )
      .bind(`snr-leak-${crypto.randomUUID()}`, emailHash, anonId)
      .run();

    const eraseRes = await SELF.fetch(eraseUrl(), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    const text = await eraseRes.text();
    expect(text).not.toContain(anonId);
  });
});
