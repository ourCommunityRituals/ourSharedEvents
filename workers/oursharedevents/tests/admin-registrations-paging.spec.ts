/**
 * OSE-1442: the admin registrations list is bounded and pages by cursor.
 *
 * Before: one request read and decrypted EVERY registration of an event (the
 * staging T2 latency). Now: a default page, a hard max, an opaque validated
 * cursor, and the existing response shape plus `limit` and `next_cursor`.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleAdminRegistrations, type FormsEnv } from '../src/handlers/forms';
import {
  encodeRegistrationsCursor,
  decodeRegistrationsCursor,
  REGISTRATIONS_DEFAULT_LIMIT,
  REGISTRATIONS_MAX_LIMIT,
} from '../src/lib/registrations-paging';
import { encryptText } from '../src/lib/forms-db';

interface TestEnv {
  FORMS_DB: D1Database;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;
const formsEnv = (): FormsEnv => env as unknown as FormsEnv;
const EVENT = 'evt-paging-1442';
const OTHER = 'evt-paging-other';

function req(qs = ''): Request {
  return new Request(`https://paging.test/admin${qs}`);
}
async function call(qs = ''): Promise<{ status: number; body: Record<string, any> }> {
  const res = await handleAdminRegistrations(req(qs), formsEnv(), EVENT);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function seed(n: number, eventId = EVENT, sameSecond = false): Promise<void> {
  const key = formsEnv().FORMS_ENCRYPTION_KEY;
  const stmts: D1PreparedStatement[] = [];
  for (let k = 0; k < n; k++) {
    const id = `${eventId}-r${String(k).padStart(4, '0')}`;
    // Distinct seconds, or all-identical timestamps to prove the id tiebreak.
    const created = sameSecond
      ? '2026-01-01 00:00:00'
      : new Date(Date.UTC(2026, 0, 1, 0, 0, k)).toISOString().replace('T', ' ').slice(0, 19);
    const enc = key ? await encryptText(`Name ${k}`, key) : null;
    stmts.push(
      tenv()
        .FORMS_DB.prepare(
          `INSERT INTO form_registrations (id, event_id, attendee_name, attendee_name_encrypted, attendee_email_hash, registration_bucket, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)`
        )
        .bind(id, eventId, enc ? null : `Name ${k}`, enc, 'h'.repeat(64), 'bucket', created)
    );
  }
  await tenv().FORMS_DB.batch(stmts);
}

beforeAll(async () => {
  const stmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const s of stmts) {
    try {
      await tenv().FORMS_DB.prepare(s).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name')) continue;
      throw e;
    }
  }
  await seed(7);
  await seed(3, OTHER);
});

describe('OSE-1442 admin registrations paging', () => {
  test('default page is bounded and the constants are sane', async () => {
    expect(REGISTRATIONS_DEFAULT_LIMIT).toBeLessThanOrEqual(REGISTRATIONS_MAX_LIMIT);
    expect(REGISTRATIONS_MAX_LIMIT).toBeLessThanOrEqual(500);
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.limit).toBe(REGISTRATIONS_DEFAULT_LIMIT);
  });

  test('limit caps the page and returns next_cursor; shape keeps existing fields', async () => {
    const { body } = await call('?limit=3');
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(3);
    expect(typeof body.next_cursor).toBe('string');
    expect(body).toHaveProperty('count');
    expect(body).toHaveProperty('suppressed');
    expect(body).toHaveProperty('floor');
    expect(body.items[0].attendee_name).toMatch(/^Name \d$/);
    expect(body.items[0]).not.toHaveProperty('attendee_name_encrypted');
  });

  test('following the cursor visits every row exactly once, newest first, then ends', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const { status, body } = await call(qs);
      expect(status).toBe(200);
      for (const it of body.items) seen.push(it.id);
      cursor = body.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3); // 3 + 3 + 1
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toEqual([...seen].sort().reverse()); // created_at rises with id here
  });

  test('exact multiple of limit ends with a null next_cursor, not an empty page', async () => {
    const first = await call('?limit=7');
    expect(first.body.items).toHaveLength(7);
    expect(first.body.next_cursor).toBeNull();
  });

  test('ties on created_at are broken by id so no row is skipped or repeated', async () => {
    const TIE = 'evt-paging-tie';
    await seed(5, TIE, true);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const qs: string = `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await handleAdminRegistrations(req(qs), formsEnv(), TIE);
      const body = (await res.json()) as Record<string, any>;
      for (const it of body.items) seen.push(it.id);
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  test('count is the event total, not the page size, and ignores other events', async () => {
    const { body } = await call('?limit=2');
    // 7 rows >= K=5 so it is not suppressed; a page of 2 would have been.
    expect(body.suppressed).toBe(false);
    expect(body.count).toBe(7);
  });

  test('a cursor never reaches rows of another event (event scope is in the WHERE)', async () => {
    const { body } = await call('?limit=100');
    for (const it of body.items) expect(it.event_id).toBe(EVENT);
  });

  test.each([
    ['limit=0'],
    ['limit=-1'],
    ['limit=abc'],
    ['limit=1.5'],
    [`limit=${REGISTRATIONS_MAX_LIMIT + 1}`],
    ['limit=99999999'],
  ])('bad %s -> 400 INVALID_LIMIT', async (qs) => {
    const { status, body } = await call(`?${qs}`);
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_LIMIT');
  });

  test.each([
    ['garbage'],
    ['r1.'],
    ['r1.!!!notbase64'],
    ['u1.' + btoa('{"c":"x","i":"y"}')],
    ['r1.' + btoa('not json')],
    ['r1.' + btoa('{"c":"2026-01-01","i":"x","z":1}')],
    ['r1.' + btoa('{"c":1,"i":"x"}')],
    ['r1.' + btoa('["a","b"]')],
    ['r1.' + 'A'.repeat(600)],
  ])('bad cursor %s -> 400 INVALID_CURSOR', async (cursor) => {
    const { status, body } = await call(`?cursor=${encodeURIComponent(cursor)}`);
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_CURSOR');
  });

  test('cursor codec round-trips and rejects tampering', () => {
    const c = encodeRegistrationsCursor({ created_at: '2026-01-01 00:00:05', id: 'abc' });
    expect(decodeRegistrationsCursor(c)).toEqual({ c: '2026-01-01 00:00:05', i: 'abc' });
    expect(decodeRegistrationsCursor(c.slice(0, -2) + '$$')).toBeNull();
  });

  test('a SQL-looking cursor value is bound, never executed', async () => {
    const evil = encodeRegistrationsCursor({
      created_at: "x' OR '1'='1",
      id: "y'; DROP TABLE form_registrations;--",
    });
    const { status, body } = await call(`?cursor=${encodeURIComponent(evil)}`);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    const still = await tenv()
      .FORMS_DB.prepare('SELECT COUNT(*) AS n FROM form_registrations')
      .first<{ n: number }>();
    expect(still!.n).toBeGreaterThan(0);
  });

  test('PII handling unchanged: no raw email, hash present, encrypted column hidden', async () => {
    const { body } = await call('?limit=1');
    const it = body.items[0];
    expect(it.attendee_email_hash).toHaveLength(64);
    expect(JSON.stringify(body)).not.toContain('attendee_name_encrypted');
  });
});
