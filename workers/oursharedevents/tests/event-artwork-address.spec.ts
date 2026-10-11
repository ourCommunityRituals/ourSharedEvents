/**
 * OSE-1658 — an event's artwork address is checked when it is saved.
 *
 * Owner decision (2026-10-11): `cover_image_url` may only be an uploaded file
 * path under /api/v2/uploads/ (option A). Admin's poster-art card stores
 * exactly that. A pasted outside address, a script or data address, or a path
 * that climbs out of /uploads/ is refused with 400 INVALID_COVER_IMAGE_URL on
 * create and on update, and nothing is written. null or an empty string clears
 * the field.
 *
 * Before this, create cut the value to 500 characters and update accepted it
 * as-is: anything could be stored, and every reader had to defend itself.
 *
 * @born-red OSE-1658 | method: ran against the pre-change handler — every
 * refused address answered 201/200 and was stored | date: 2026-10-11
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose1658-test';
const GOOD = '/api/v2/uploads/poster-art/evt_x/2026-10-11-abc123.png';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
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
  await applyMigrations();
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
});

const post = (body: Record<string, unknown>) =>
  SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
    body: JSON.stringify({ brand_id: BRAND, ...body }),
  });

const put = (id: string, body: Record<string, unknown>) =>
  SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
    body: JSON.stringify(body),
  });

async function stored(id: string): Promise<string | null> {
  const row = await (env as unknown as TestEnv).DB.prepare(
    'SELECT cover_image_url FROM events WHERE id = ?'
  )
    .bind(id)
    .first<{ cover_image_url: string | null }>();
  return row ? row.cover_image_url : null;
}

async function create(title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await post({ title, ...extra });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const REFUSED: Array<[string, string]> = [
  ['a script address', 'javascript:alert(1)'],
  ['a data address', 'data:image/png;base64,iVBORw0KGgo='],
  ['plain http', 'http://example.com/art.png'],
  ['an https address on another host', 'https://example.com/art.png'],
  ['a protocol-relative address', '//example.com/art.png'],
  ['a path outside /uploads/', '/poster-art/art.png'],
  ['a path that climbs out of /uploads/', '/api/v2/uploads/../admin'],
  ['a dot segment', '/api/v2/uploads/./art.png'],
  ['a space in the path', '/api/v2/uploads/my art.png'],
  ['a query string', '/api/v2/uploads/art.png?x=1'],
  ['an over-long upload path', '/api/v2/uploads/' + 'a'.repeat(500) + '.png'],
];

describe('OSE-1658: an artwork address is an uploaded file, or nothing', () => {
  test('create stores an upload path as given', async () => {
    const id = await create('Artwork ok', { cover_image_url: GOOD });
    expect(await stored(id)).toBe(GOOD);
  });

  test('create without artwork stores none', async () => {
    const id = await create('Artwork none');
    expect(await stored(id)).toBeNull();
  });

  for (const [what, value] of REFUSED) {
    test(`create refuses ${what} with 400 and stores nothing`, async () => {
      const title = `Artwork refused ${what}`;
      const res = await post({ title, cover_image_url: value });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('INVALID_COVER_IMAGE_URL');
      const n = await (env as unknown as TestEnv).DB.prepare(
        'SELECT COUNT(*) AS n FROM events WHERE brand_id = ? AND title = ?'
      )
        .bind(BRAND, title)
        .first<{ n: number }>();
      expect(n?.n).toBe(0);
    });

    test(`update refuses ${what} with 400 and keeps the stored artwork`, async () => {
      const id = await create(`Artwork keep ${what}`, { cover_image_url: GOOD });
      const res = await put(id, { cover_image_url: value });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code?: string }).code).toBe('INVALID_COVER_IMAGE_URL');
      expect(await stored(id)).toBe(GOOD);
    });
  }

  test('update sets an upload path', async () => {
    const id = await create('Artwork set later');
    const res = await put(id, { cover_image_url: GOOD });
    expect(res.status).toBeLessThan(300);
    expect(await stored(id)).toBe(GOOD);
  });

  test('update with null clears the artwork', async () => {
    const id = await create('Artwork clear null', { cover_image_url: GOOD });
    const res = await put(id, { cover_image_url: null });
    expect(res.status).toBeLessThan(300);
    expect(await stored(id)).toBeNull();
  });

  test('update with an empty string clears the artwork', async () => {
    const id = await create('Artwork clear empty', { cover_image_url: GOOD });
    const res = await put(id, { cover_image_url: '' });
    expect(res.status).toBeLessThan(300);
    expect(await stored(id)).toBeNull();
  });
});
