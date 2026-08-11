/**
 * OSE-659 — anonymous registration self-delete (destroyed by architecture + by
 * the person's own request, before the TTL).
 *
 * The attendee removes their own opt-in PII via DELETE on the register path,
 * authenticated ONLY by the peppered hash of the email they registered with —
 * no new credential, no identity surface (#1). Writes ONLY to FORMS_DB; never
 * joins registration↔scan. A registration made without an email cannot be
 * self-deleted (TTL destroys it); name-only deletion is refused.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
  for (const key of ['TEST_MIGRATION_STATEMENTS', 'TEST_FORMS_MIGRATION_STATEMENTS'] as const) {
    const db = key === 'TEST_MIGRATION_STATEMENTS' ? tenv().DB : tenv().FORMS_DB;
    for (const stmt of JSON.parse(tenv()[key]) as string[]) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m.includes('duplicate column name') || m.includes('already exists')) continue;
        throw e;
      }
    }
  }
}

const EVENT = 'ose659-selfdel-evt';

async function register(email?: string): Promise<Response> {
  return SELF.fetch(`https://t.test/api/v2/events/${EVENT}/forms/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Attendee', ...(email ? { email } : {}) }),
  });
}

async function selfDelete(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`https://t.test/api/v2/events/${EVENT}/forms/register`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function rowCount(email?: string): Promise<number> {
  const r = await tenv()
    .FORMS_DB.prepare(
      `SELECT COUNT(*) AS n FROM form_registrations WHERE event_id = ?` +
        (email ? '' : '')
    )
    .bind(EVENT)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

beforeAll(async () => {
  await applyMigrations();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, 'ose659', 'Self Del', ?, 'active')
       ON CONFLICT(id) DO NOTHING`
    )
    .bind(EVENT, EVENT)
    .run();
});

describe('OSE-659 — registration self-delete', () => {
  test('an attendee deletes their own registration with the registered email', async () => {
    const email = 'alice@example.com';
    expect((await register(email)).status).toBe(200);
    const before = await rowCount();
    expect(before).toBeGreaterThanOrEqual(1);

    const res = await selfDelete({ email });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: number };
    expect(body.ok).toBe(true);
    expect(body.deleted).toBeGreaterThanOrEqual(1);
    // The row is physically gone from FORMS_DB.
    expect(await rowCount()).toBe(before - body.deleted);
  });

  test('a wrong email deletes nothing and does not reveal existence (deleted: 0, ok)', async () => {
    await register('bob@example.com');
    const res = await selfDelete({ email: 'not-bob@example.com' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: number };
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(0);
  });

  test('self-delete requires a valid email — name-only / missing / invalid is refused', async () => {
    expect((await selfDelete({ name: 'Attendee' })).status).toBe(400);
    expect((await selfDelete({})).status).toBe(400);
    expect((await selfDelete({ email: 'not-an-email' })).status).toBe(400);
  });

  test('#1: the handler + route never join registration↔scan (FORMS_DB only)', () => {
    const files: Record<string, string> = JSON.parse(
      (env as unknown as { TEST_SOURCE_FILES_JSON: string }).TEST_SOURCE_FILES_JSON
    );
    const src = Object.entries(files).find(([p]) => p.replace(/\\/g, '/').endsWith('handlers/forms.ts'))![1];
    // Isolate the self-delete handler body and assert it only touches FORMS_DB.
    const start = src.indexOf('export async function handleSelfDeleteRegistration');
    const body = src.slice(start, start + 1600);
    expect(body).toContain('env.FORMS_DB');
    expect(body).not.toContain('env.DB.prepare'); // never the scan DB
    expect(body).not.toMatch(/JOIN|scans|scan_aggregates/i);
  });
});
