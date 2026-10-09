/**
 * The short TV code (OSE-1684, owner decision 2026-10-09).
 *
 * An event's TV page is /events/<id>/tv; the id is 40 characters, which nobody
 * types with a TV remote. The organizer asks admin for the event's code and
 * types /tv/<code> on the TV.
 *
 *   - POST /api/v2/admin/events/:id/tv-code: admin only; one code per event,
 *     minted on first ask and the same ever after; six characters from an
 *     alphabet with no look-alikes.
 *   - GET /tv/<code>: public (a TV cannot sign in); 302 to /events/<id>/tv;
 *     read case- and space-insensitively; anything else is a 404 page.
 *   - The code lives in its own table (migration 0096), so it is never one of
 *     the event's shortlinks (counted, printed on posters, reported).
 *   - Deleting the event deletes its code.
 *
 * Born-red: without the routes every request here is a 404 or 401.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import {
  TV_CODE_ALPHABET,
  TV_CODE_LENGTH,
  generateTvCode,
  normalizeTvCode,
} from '../src/lib/tv-code';
import { CRAWL_DISALLOW } from '../src/lib/crawl-policy';

const ORIGIN = 'https://t.test';
const KEY = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const JSON_KEY = { ...KEY, 'Content-Type': 'application/json' };

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const db = () => (env as unknown as TestEnv).DB;

beforeAll(async () => {
  for (const stmt of JSON.parse(
    (env as unknown as TestEnv).TEST_MIGRATION_STATEMENTS
  ) as string[]) {
    try {
      await db().prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
});

async function createEvent(title: string): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events`, {
    method: 'POST',
    headers: JSON_KEY,
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  return String(((await res.json()) as { id: string }).id);
}

const askCode = (id: string, headers: Record<string, string> = JSON_KEY) =>
  SELF.fetch(`${ORIGIN}/api/v2/admin/events/${encodeURIComponent(id)}/tv-code`, {
    method: 'POST',
    headers,
    body: '{}',
  });

const open = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual', ...init });

describe('lib/tv-code', () => {
  test('a generated code is six characters from the no-look-alike alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateTvCode();
      expect(code).toHaveLength(TV_CODE_LENGTH);
      for (const ch of code) expect(TV_CODE_ALPHABET).toContain(ch);
    }
    for (const ch of '0O1IL') expect(TV_CODE_ALPHABET).not.toContain(ch);
    expect(TV_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(TV_CODE_ALPHABET).size).toBe(31);
  });

  test('what was typed is read case- and space-insensitively', () => {
    expect(normalizeTvCode('K7Q2PX')).toBe('K7Q2PX');
    expect(normalizeTvCode('k7q2px')).toBe('K7Q2PX');
    expect(normalizeTvCode('k7q%202px')).toBe('K7Q2PX');
    expect(normalizeTvCode('K7Q-2PX')).toBe('K7Q2PX');
  });

  test('anything that cannot be a code is null', () => {
    for (const bad of [
      '',
      'K7Q2P',
      'K7Q2PXX',
      'K7Q2P0',
      'K7Q2PO',
      'K7Q2P1',
      '%E0%A4%A',
      '../x/y',
    ]) {
      expect(normalizeTvCode(bad), bad).toBeNull();
    }
  });
});

describe('POST /api/v2/admin/events/:id/tv-code', () => {
  test('an organizer gets a code; asking again gives the same code', async () => {
    const id = await createEvent(`TV code ${Date.now()}`);
    const first = await askCode(id);
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    const a = (await first.json()) as { ok: boolean; code: string; path: string; tv_path: string };
    expect(a.ok).toBe(true);
    expect(normalizeTvCode(a.code)).toBe(a.code);
    expect(a.path).toBe(`/tv/${a.code}`);
    expect(a.tv_path).toBe(`/events/${id}/tv`);
    const b = (await (await askCode(id)).json()) as { code: string };
    expect(b.code).toBe(a.code);
  });

  test("the code is not one of the event's shortlinks", async () => {
    const id = await createEvent(`TV code links ${Date.now()}`);
    const { code } = (await (await askCode(id)).json()) as { code: string };
    const row = await db()
      .prepare('SELECT COUNT(*) AS n FROM shortlinks WHERE code = ? OR kind = ?')
      .bind(code, 'tv')
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  test('without signing in: 401, and no code is made', async () => {
    const id = await createEvent(`TV code auth ${Date.now()}`);
    const res = await askCode(id, { 'Content-Type': 'application/json' });
    expect(res.status).toBe(401);
    const row = await db()
      .prepare('SELECT COUNT(*) AS n FROM event_tv_codes WHERE event_id = ?')
      .bind(id)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  test('an unknown event: 404', async () => {
    expect((await askCode('evt_no_such_event')).status).toBe(404);
  });

  test('GET is not a way to make one', async () => {
    const id = await createEvent(`TV code get ${Date.now()}`);
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${id}/tv-code`, { headers: KEY });
    expect(res.status).not.toBe(200);
  });
});

describe('GET /tv/<code>', () => {
  test("opens that event's TV, however the code was typed", async () => {
    const id = await createEvent(`TV open ${Date.now()}`);
    const { code } = (await (await askCode(id)).json()) as { code: string };
    const typed = [code, code.toLowerCase(), `${code.slice(0, 3)}%20${code.slice(3)}`];
    for (const t of typed) {
      const res = await open(`/tv/${t}`);
      expect(res.status, t).toBe(302);
      expect(res.headers.get('location'), t).toBe(`/events/${id}/tv`);
      expect(res.headers.get('Cache-Control'), t).toBe('no-store');
    }
    expect((await open(`/tv/${code}`, { method: 'HEAD' })).status).toBe(302);
  });

  test('a code that matches nothing, or cannot be a code, is a 404 page', async () => {
    for (const path of ['/tv/ZZZZZZ', '/tv/abc', '/tv/K7Q2P0']) {
      const res = await open(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toMatch(/That TV code didn(&#39;|')t match an event/);
    }
  });

  test('/tv alone is still the TV display', async () => {
    const res = await open('/tv');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('function routeEventId()');
  });

  test('crawlers are told to leave /tv/ alone', () => {
    expect(CRAWL_DISALLOW).toContain('/tv/');
  });

  test('deleting the event deletes its code', async () => {
    const id = await createEvent(`TV delete ${Date.now()}`);
    const { code } = (await (await askCode(id)).json()) as { code: string };
    const del = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${id}`, {
      method: 'DELETE',
      headers: KEY,
    });
    expect(del.status).toBeLessThan(300);
    expect((await open(`/tv/${code}`)).status).toBe(404);
  });
});
