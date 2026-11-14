/**
 * A closed event page tells the truth, and the same truth for every case.
 *
 * Owner report 2026-10-10: the organizer opened their own draft's short link
 * (/e/<code>) and read "This event link doesn't work anymore — it may have
 * been archived". The event was a draft, never archived. The page must still
 * say the same thing for a missing id, a draft and a ready event (a probe must
 * not tell them apart), so the one message now names both cases.
 *
 * @born-red 2026-10-10 | method: the copy assertions fail on main's wording
 */

import { SELF, env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { EVENT_NOT_OPEN_COPY } from '../src/handlers/pages';

const ORIGIN = 'https://t.test';
const JSON_KEY = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
};
const BROWSER =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

beforeAll(async () => {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
});

const escaped = EVENT_NOT_OPEN_COPY.replace(/'/g, '&#39;');

async function closedPageText(path: string): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}${path}`, { headers: { 'User-Agent': BROWSER } });
  expect(res.status, path).toBe(404);
  return res.text();
}

describe('the closed event page', () => {
  test('says the event may not be published yet, and never that it was archived', () => {
    expect(EVENT_NOT_OPEN_COPY).toMatch(/not be published yet/);
    expect(EVENT_NOT_OPEN_COPY).not.toMatch(/archived/i);
  });

  test('a draft, a ready event, a missing id and a malformed id all show the same message', async () => {
    const make = async (status?: string) => {
      const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events`, {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify({
          attendance_mode: 'in_person',
          location: 'Test Hall',
          title: 'Bears, Big Screens and Barricades',
          ...(status ? { status } : {}),
        }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const draft = await make();
    const ready = await make('ready');
    for (const path of [
      `/events/${draft}`,
      `/events/${ready}`,
      '/events/evt_does_not_exist',
      '/events/not%20an%20id',
    ]) {
      const html = await closedPageText(path);
      expect(html, path).toContain(escaped);
      expect(html, path).not.toMatch(/may have been archived/);
      expect(html, path).not.toContain('Bears, Big Screens');
    }
  });

  test("a draft's short code lands on that same page", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events`, {
      method: 'POST',
      headers: JSON_KEY,
      body: JSON.stringify({
        attendance_mode: 'in_person',
        location: 'Test Hall',
        title: 'Watch the Bears game',
      }),
    });
    const { id, event_code } = (await res.json()) as { id: string; event_code: string | null };
    expect(event_code).toBeTruthy();
    const hop = await SELF.fetch(`${ORIGIN}/e/${event_code}`, {
      redirect: 'manual',
      headers: { 'User-Agent': BROWSER },
    });
    expect(hop.status).toBeGreaterThanOrEqual(300);
    expect(hop.status).toBeLessThan(400);
    const to = new URL(hop.headers.get('Location') || '', ORIGIN).pathname;
    expect(to).toBe(`/events/${id}`);
    expect(await closedPageText(to)).toContain(escaped);
  });
});
