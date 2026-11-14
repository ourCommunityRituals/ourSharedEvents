/**
 * OSE-1319 R3 — typed external-link controls persist through create + update.
 *
 * events.what_url_enabled (0/1 gate) and events.what_url_type (allowlisted enum)
 * were added by migration 0074. This suite proves the admin write path actually
 * reads + persists them, and enforces the allowlist (strict-in / 400).
 *
 * Integration (workers pool): real miniflare env.DB with migrations applied,
 * SELF.fetch to the admin routes. Mirrors events-h3-wiring.spec.ts.
 *
 * Verified red: before wiring the columns into the INSERT/UPDATE, every
 * persistence assertion failed (row.what_url_type was undefined / unchanged);
 * before the allowlist check, the invalid-type cases returned 201/200.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose1319-r3-test';
const HTTPS = 'https://give.example.org/bocce-2026';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await (tenv.DB as D1Database).prepare(stmt).run();
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

async function postEvent(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
    body: JSON.stringify({
      attendance_mode: 'in_person',
      location: 'Test Hall',
      ...(body as object),
    }),
  });
}

async function putEvent(id: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://t.test/api/v2/admin/events/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
    body: JSON.stringify(body),
  });
}

async function getRow(id: string): Promise<Record<string, unknown> | null> {
  const tenv = env as unknown as TestEnv;
  return (tenv.DB as D1Database)
    .prepare('SELECT id, what_url, what_url_enabled, what_url_type FROM events WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
}

async function createId(body: Record<string, unknown>): Promise<string> {
  const res = await postEvent({ brand_id: BRAND, ...body });
  expect(res.status).toBe(201);
  const j = (await res.json()) as { ok: boolean; id?: string };
  expect(j.ok).toBe(true);
  return j.id!;
}

beforeAll(async () => {
  await applyMigrations();
  const tenv = env as unknown as TestEnv;
  await (tenv.DB as D1Database).prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
});

describe('R3 create — persists the typed-link trio', () => {
  test('enabled + type + https url all land in the row', async () => {
    const id = await createId({
      title: 'R3 Bocce Fundraiser',
      what_url: HTTPS,
      what_url_enabled: true,
      what_url_type: 'donation',
    });
    const row = await getRow(id);
    expect(row?.what_url).toBe(HTTPS);
    expect(row?.what_url_enabled).toBe(1);
    expect(row?.what_url_type).toBe('donation');
  });

  test('enabled defaults OFF (0) when the flag is omitted', async () => {
    const id = await createId({ title: 'R3 No-Flag', what_url: HTTPS, what_url_type: 'tickets' });
    const row = await getRow(id);
    expect(row?.what_url_enabled).toBe(0);
    expect(row?.what_url_type).toBe('tickets');
  });

  test('an out-of-vocabulary what_url_type is rejected 400 (strict-in)', async () => {
    const res = await postEvent({
      brand_id: BRAND,
      title: 'R3 Bad Type',
      what_url: HTTPS,
      what_url_enabled: true,
      what_url_type: 'phishing',
    });
    expect(res.status).toBe(400);
    const j = (await res.json()) as { code?: string };
    expect(j.code).toBe('INVALID_WHAT_URL_TYPE');
  });

  test("'signup' and 'public' are NOT valid what_url_types (poster-only kinds)", async () => {
    for (const t of ['signup', 'public']) {
      const res = await postEvent({ brand_id: BRAND, title: `R3 ${t}`, what_url_type: t });
      expect(res.status).toBe(400);
    }
  });
});

describe('R3 update — persists + validates the typed-link trio', () => {
  test('PUT flips enabled on and sets the type', async () => {
    const id = await createId({ title: 'R3 Update Target', what_url: HTTPS });
    // created OFF by default
    expect((await getRow(id))?.what_url_enabled).toBe(0);

    const res = await putEvent(id, { what_url_enabled: true, what_url_type: 'league' });
    expect(res.status).toBe(200);
    const row = await getRow(id);
    expect(row?.what_url_enabled).toBe(1);
    expect(row?.what_url_type).toBe('league');
  });

  test('PUT can turn the link back OFF without clearing the url', async () => {
    const id = await createId({
      title: 'R3 Toggle Off',
      what_url: HTTPS,
      what_url_enabled: true,
      what_url_type: 'donation',
    });
    const res = await putEvent(id, { what_url_enabled: false });
    expect(res.status).toBe(200);
    const row = await getRow(id);
    expect(row?.what_url_enabled).toBe(0);
    expect(row?.what_url).toBe(HTTPS); // url survives; only the gate moved
    expect(row?.what_url_type).toBe('donation');
  });

  test('PUT with an invalid type is rejected 400 and does not mutate the row', async () => {
    const id = await createId({
      title: 'R3 Update Bad',
      what_url: HTTPS,
      what_url_enabled: true,
      what_url_type: 'workshop',
    });
    const res = await putEvent(id, { what_url_type: 'malware' });
    expect(res.status).toBe(400);
    expect((await getRow(id))?.what_url_type).toBe('workshop'); // unchanged
  });
});
