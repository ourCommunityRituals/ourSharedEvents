/**
 * Erasure leaves no trace of who was erased.
 *
 * POST /api/v2/admin/data-subject/erase finds a person by a peppered hash of
 * their email. That hash is deterministic: whoever holds it can test whether a
 * given address was ever a subject, and it would outlive the erasure. So it may
 * not leave the handler by any road: not the response, not a log line, not an
 * audit row. The same holds for the raw email and for the anonymous id (and its
 * returns hash) the erasure follows into the main database.
 *
 * What the caller gets instead is a job id: a random id with no link to the
 * person, shared by the response, the log line and the `pii_audit_log` row, so
 * an operator can show that a given erasure ran.
 *
 * Level: W (workers pool, real D1, real route through SELF). The one test that
 * calls the handler directly does so only to supply ANON_ID_HASH_PEPPER, which
 * the shared test worker does not carry.
 *
 * @born-red job id | method: ran against the handler before the change. The
 *   response, the log line and the audit row shared no id (`jobId` undefined) |
 *   date: 2026-10-07
 * @born-red no trace | method: these already held on main, so each was proved
 *   by putting the leak back (emailHash in the response, in the log line, in the
 *   audit details; anonId in the log line) and watching the test fail |
 *   date: 2026-10-07
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { handleDataSubjectErase, type DataSubjectEnv } from '../src/handlers/data-subject';
import { hashAnonIdForReturns } from '../src/lib/anon-id-hash';
import { hashEmail } from '../src/lib/forms-db';

const E = env as unknown as Record<string, string> & { DB: D1Database; FORMS_DB: D1Database };
const TEST_ANON_PEPPER = 'test-anon-id-hash-pepper-do-not-use-in-prod';
const ERASE_URL = 'https://t.test/api/v2/admin/data-subject/erase';
const ADMIN_HEADERS = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
  await E.DB.prepare(
    `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status)
     VALUES ('ds-trace', 'test-brand', 'DS Trace Event', 'ds-trace', 'active')`
  ).run();
});

afterEach(() => vi.restoreAllMocks());

/** The lookup hash the handler computes for `email` (same function, same pepper). */
const lookupHash = (email: string) =>
  hashEmail(email.trim(), E.FORMS_HASH_PEPPER, { requirePepper: true });

interface Subject {
  email: string;
  emailHash: string;
  anonId: string;
}

/** One person in every store erasure reaches by email or by the linked anon id. */
async function seedSubject(tag: string): Promise<Subject> {
  const email = `${tag}-${crypto.randomUUID()}@example.com`;
  const emailHash = await lookupHash(email);
  const anonId = `anon-${tag}-${crypto.randomUUID()}`;
  await E.FORMS_DB.prepare(
    `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at, anonymous_id)
     VALUES (?, 'ds-trace', ?, 'enc-trace', '2026-01', '2099-01-01', ?)`
  )
    .bind(`su-${crypto.randomUUID()}`, emailHash, anonId)
    .run();
  await E.FORMS_DB.prepare(
    `INSERT INTO form_registrations (id, event_id, registration_bucket, status, attendee_email_hash, anonymous_id)
     VALUES (?, 'ds-trace', '2026-04', 'confirmed', ?, ?)`
  )
    .bind(`reg-${crypto.randomUUID()}`, emailHash, anonId)
    .run();
  await E.FORMS_DB.prepare(
    `INSERT INTO subscribers (email_hash, email_encrypted, ip_hash, source) VALUES (?, 'enc-trace', 'iph', 'landing')`
  )
    .bind(emailHash)
    .run();
  await E.DB.prepare(
    `INSERT INTO scan_node_returns (id, event_id, anonymous_id, scan_bucket)
     VALUES (?, 'ds-trace', ?, '2026-01')`
  )
    .bind(`snr-${crypto.randomUUID()}`, anonId)
    .run();
  return { email, emailHash, anonId };
}

/** Every line written to any console level while `fn` ran, as text. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(
        args
          .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : safeJson(a)))
          .join(' ')
      );
    });
  }
  const result = await fn();
  return { result, lines };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

const eraseLine = (lines: string[]) =>
  lines
    .filter((l) => l.includes('"DATA_SUBJECT_ERASE"'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);

/** Every column of every row, as one string per row. */
async function dumpRows(db: D1Database, table: string): Promise<string[]> {
  const res = await db.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
  return (res.results ?? []).map((r) => JSON.stringify(r));
}

/** The router audits through waitUntil; wait until that row has landed. */
async function adminAuditRows(minimum: number): Promise<string[]> {
  for (let i = 0; i < 40; i++) {
    const res = await E.DB.prepare(
      `SELECT * FROM admin_audit_log WHERE action = 'DATA_SUBJECT_ERASE'`
    ).all<Record<string, unknown>>();
    if ((res.results ?? []).length >= minimum) {
      return (res.results ?? []).map((r) => JSON.stringify(r));
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return [];
}

describe('erasure: the lookup hash appears nowhere', () => {
  test('a seeded subject is erased and no response, log line or audit row names them', async () => {
    const s = await seedSubject('trace');
    const auditBefore = (
      await E.DB.prepare(
        `SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'DATA_SUBJECT_ERASE'`
      ).first<{ n: number }>()
    )?.n;

    const { result: res, lines } = await captureLogs(() =>
      SELF.fetch(ERASE_URL, {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ email: s.email }),
      })
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    // The erasure really ran on this person (so the checks below are not vacuous).
    expect(body).toMatchObject({
      ok: true,
      signupsDeleted: 1,
      registrationsDeleted: 1,
      subscribersDeleted: 1,
      scanReturnsDeleted: 1,
    });
    expect(eraseLine(lines), 'one DATA_SUBJECT_ERASE line').toHaveLength(1);

    const piiAudit = await dumpRows(E.FORMS_DB, 'pii_audit_log');
    expect(piiAudit.some((r) => r.includes('data_subject_erase'))).toBe(true);
    const adminAudit = await adminAuditRows((auditBefore ?? 0) + 1);
    expect(adminAudit.length, 'the admin audit row landed').toBeGreaterThan(auditBefore ?? 0);

    const secrets: Array<[string, string]> = [
      ['the lookup hash', s.emailHash],
      ['the raw email', s.email],
      ['the anonymous id', s.anonId],
    ];
    for (const [what, value] of secrets) {
      expect(text, `response body carries ${what}`).not.toContain(value);
      for (const [name, value_] of res.headers) {
        expect(`${name}: ${value_}`, `response header carries ${what}`).not.toContain(value);
      }
      for (const line of lines) expect(line, `a log line carries ${what}`).not.toContain(value);
      for (const row of piiAudit) expect(row, `pii_audit_log carries ${what}`).not.toContain(value);
      for (const row of adminAudit) {
        expect(row, `admin_audit_log carries ${what}`).not.toContain(value);
      }
    }
    // No key that would name the hash either, whatever its value.
    const NAMES_A_PERSON = /hash|email|^anon(?:ymous)?_?id$/i;
    expect(Object.keys(body).filter((k) => NAMES_A_PERSON.test(k))).toEqual([]);
    expect(Object.keys(eraseLine(lines)[0]).filter((k) => NAMES_A_PERSON.test(k))).toEqual([]);
  });

  test('the anon-id returns hash is not logged, stored or returned either', async () => {
    const s = await seedSubject('returns');
    const anonIdHash = (await hashAnonIdForReturns(s.anonId, TEST_ANON_PEPPER)) as string;
    expect(anonIdHash).toBeTruthy();
    await E.DB.prepare(
      `INSERT INTO anon_id_returns (anon_id_hash, venue_id, first_seen_at, last_seen_at, return_count)
       VALUES (?, 'ds-trace', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)`
    )
      .bind(anonIdHash)
      .run();

    const { result: res, lines } = await captureLogs(() =>
      handleDataSubjectErase(
        new Request(ERASE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: s.email }),
        }),
        { ...(env as unknown as DataSubjectEnv), ANON_ID_HASH_PEPPER: TEST_ANON_PEPPER }
      )
    );
    const text = await res.text();
    expect((JSON.parse(text) as Record<string, unknown>).anonIdReturnsDeleted).toBe(1);

    const piiAudit = await dumpRows(E.FORMS_DB, 'pii_audit_log');
    for (const value of [s.emailHash, s.email, s.anonId, anonIdHash]) {
      expect(text).not.toContain(value);
      for (const line of lines) expect(line).not.toContain(value);
      for (const row of piiAudit) expect(row).not.toContain(value);
    }
  });
});

describe('erasure: a job id stands in for the hash', () => {
  test('the response, the log line and the audit row share one random job id', async () => {
    const s = await seedSubject('job');
    const { result: res, lines } = await captureLogs(() =>
      SELF.fetch(ERASE_URL, {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ email: s.email }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.jobId, 'response carries a job id').toMatch(UUID);
    expect(eraseLine(lines)[0]?.jobId, 'the log line carries the same job id').toBe(body.jobId);

    const row = await E.FORMS_DB.prepare(
      `SELECT phase, triggered_by, records_affected FROM pii_audit_log WHERE id = ?`
    )
      .bind(body.jobId as string)
      .first<{ phase: string; triggered_by: string; records_affected: number }>();
    expect(row, 'the audit row is keyed by the job id').toEqual({
      phase: 'data_subject_erase',
      triggered_by: 'admin_api',
      records_affected: 4,
    });
  });

  test('the job id is not derived from the person: the same email gets a new one each time', async () => {
    const email = `repeat-${crypto.randomUUID()}@example.com`;
    const ids: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await SELF.fetch(ERASE_URL, {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ email }),
      });
      ids.push(((await res.json()) as Record<string, unknown>).jobId);
    }
    expect(ids[0]).toMatch(UUID);
    expect(ids[1]).toMatch(UUID);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
