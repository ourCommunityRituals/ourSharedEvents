/**
 * A status write says where the event was.
 *
 * The admin status panel offers Undo after every move. It used to send the
 * event back to the status the panel last showed. If another tab had moved the
 * event meanwhile (Draft in this panel, Ready in fact), Archive still landed
 * (ready -> archived is a valid edge) and Undo then sent it to Draft, a place
 * it had never been. The panel needs the server's answer to "moved from what",
 * so `PUT /api/v2/admin/events/:id` with a status now returns `from`: the
 * status the guarded UPDATE matched. A write with no status carries no `from`.
 *
 * Runtime-bound (SELF.fetch + env.DB) -> workers pool.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { giveCoreValues } from './helpers/core-values';

const BRAND = 'ose-status-write-from';
const HEADERS = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
  'Sec-Fetch-Site': 'same-origin',
};

beforeAll(async () => {
  const statements = JSON.parse(
    (env as unknown as { TEST_MIGRATION_STATEMENTS: string }).TEST_MIGRATION_STATEMENTS
  ) as string[];
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
});

async function seed(id: string, status: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, BRAND, `From ${id}`, `slug-${id}`, status)
    .run();
  await giveCoreValues(env.DB, id);
}

async function put(id: string, body: Record<string, unknown>) {
  const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function statusOf(id: string): Promise<string | undefined> {
  const row = await env.DB.prepare('SELECT status FROM events WHERE id = ?')
    .bind(id)
    .first<{ status: string }>();
  return row?.status;
}

describe('PUT status answers with the status it moved from', () => {
  test('draft -> ready says from: draft', async () => {
    await seed('swf-1', 'draft');
    const r = await put('swf-1', { status: 'ready' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.from).toBe('draft');
  });

  test('a stale panel: the client thought Draft, the row is Ready; Archive says from: ready', async () => {
    await seed('swf-2', 'draft');
    // Another tab moves it first.
    expect((await put('swf-2', { status: 'ready' })).status).toBe(200);
    // This panel still believes Draft and sends Archive; ready -> archived is valid.
    const r = await put('swf-2', { status: 'archived' });
    expect(r.status).toBe(200);
    expect(r.body.from).toBe('ready');
    expect(await statusOf('swf-2')).toBe('archived');
  });

  test('a same-status write says from: that status', async () => {
    await seed('swf-3', 'ready');
    const r = await put('swf-3', { status: 'ready' });
    expect(r.status).toBe(200);
    expect(r.body.from).toBe('ready');
  });

  test('a write with no status carries no from', async () => {
    await seed('swf-4', 'draft');
    const r = await put('swf-4', { title: 'Renamed' });
    expect(r.status).toBe(200);
    expect('from' in r.body).toBe(false);
  });

  test('a refused move still names where the event is (409 INVALID_TRANSITION)', async () => {
    await seed('swf-5', 'archived');
    const r = await put('swf-5', { status: 'ready' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('INVALID_TRANSITION');
    expect(r.body.from).toBe('archived');
    expect(await statusOf('swf-5')).toBe('archived');
  });
});
