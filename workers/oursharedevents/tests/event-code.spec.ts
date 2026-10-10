/**
 * One short code per event, a short address per screen (OSE-1684, owner
 * decisions 2026-10-09).
 *
 *   /e/<code> event page   /p/<code> poster   /tv/<code> TV
 *   /r/<code> register     /c/<code> check-in
 *
 *   - POST /api/v2/admin/events/:id/short-links: admin only; one code per
 *     event, the same ever after; six characters, no look-alikes. Create mints
 *     it, so the event page's Share button hands out /e/<code>.
 *   - Every shared link counts ("anything that is being shared"): one number in
 *     share_opens_daily per event × screen × phase × day — what and when, never
 *     who. /tv/ is typed on the venue's TV, so it does not count. Only a GET by
 *     a person of a public event counts: not HEAD, not a link-preview robot,
 *     not a draft (CCR 2026-10-09, C2).
 *   - A draft's code never reveals its name (C1).
 *   - Shares never touch the shortlinks counters, so a shared poster is never
 *     read as a poster-code scan (C3).
 *   - Codes live in their own table (migration 0096). Deleting the event
 *     deletes its code.
 *
 * Born-red: with the routes switched off, every route test here fails.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import {
  EVENT_CODE_ALPHABET,
  EVENT_CODE_LENGTH,
  eventCodeLinks,
  generateEventCode,
  normalizeEventCode,
} from '../src/lib/event-code';
import { CRAWL_DISALLOW } from '../src/lib/crawl-policy';
import { EVENT_CODE_GUESS_MAX } from '../src/handlers/event-code';

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

interface Created {
  id: string;
  slug: string;
  event_code: string | null;
}

async function createEvent(title: string): Promise<Created> {
  const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events`, {
    method: 'POST',
    headers: JSON_KEY,
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Created;
}

const askLinks = (id: string, headers: Record<string, string> = JSON_KEY) =>
  SELF.fetch(`${ORIGIN}/api/v2/admin/events/${encodeURIComponent(id)}/short-links`, {
    method: 'POST',
    headers,
    body: '{}',
  });

const open = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual', ...init });

const BROWSER =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const asPerson = { headers: { 'User-Agent': BROWSER } };

async function sharesOf(eventId: string): Promise<Record<string, number>> {
  const { results } = await db()
    .prepare(
      `SELECT screen || ':' || phase AS k, SUM(opens) AS n FROM share_opens_daily
        WHERE event_id = ? GROUP BY screen, phase`
    )
    .bind(eventId)
    .all<{ k: string; n: number }>();
  const out: Record<string, number> = {};
  for (const r of results ?? []) out[r.k] = Number(r.n) || 0;
  return out;
}

async function shortlinkTaps(eventId: string): Promise<number> {
  const row = await db()
    .prepare('SELECT COALESCE(SUM(clicks), 0) AS n FROM shortlinks WHERE event_id = ?')
    .bind(eventId)
    .first<{ n: number }>();
  return Number(row?.n) || 0;
}

/** Make the event public and set when it starts (days from today, UTC). */
async function goLive(id: string, startInDays: number, endInDays = startInDays): Promise<void> {
  const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  await db()
    .prepare(
      `UPDATE events SET status = 'active', is_published = 1, start_date = ?, end_date = ?,
              starts_at = NULL, timezone = 'UTC' WHERE id = ?`
    )
    .bind(day(startInDays), day(endInDays), id)
    .run();
}

describe('lib/event-code', () => {
  test('a generated code is six characters from the no-look-alike alphabet', () => {
    expect(EVENT_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(EVENT_CODE_ALPHABET).size).toBe(31);
    for (const ch of '0O1IL') expect(EVENT_CODE_ALPHABET).not.toContain(ch);
    for (let i = 0; i < 200; i++) {
      const code = generateEventCode();
      expect(code).toHaveLength(EVENT_CODE_LENGTH);
      for (const ch of code) expect(EVENT_CODE_ALPHABET).toContain(ch);
    }
  });

  test('what was typed is read case- and space-insensitively', () => {
    expect(normalizeEventCode('K7Q2PX')).toBe('K7Q2PX');
    expect(normalizeEventCode('k7q2px')).toBe('K7Q2PX');
    expect(normalizeEventCode('k7q%202px')).toBe('K7Q2PX');
    expect(normalizeEventCode('K7Q-2PX')).toBe('K7Q2PX');
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
      expect(normalizeEventCode(bad), bad).toBeNull();
    }
  });

  test('one code, five short addresses', () => {
    expect(eventCodeLinks('K7Q2PX')).toEqual({
      share: '/e/K7Q2PX',
      poster: '/p/K7Q2PX',
      tv: '/tv/K7Q2PX',
      register: '/r/K7Q2PX',
      checkin: '/c/K7Q2PX',
    });
  });
});

describe('the code is made with the event', () => {
  test('create answers with the event code, and admin returns the same one', async () => {
    const ev = await createEvent(`Code at create ${Date.now()}`);
    expect(normalizeEventCode(String(ev.event_code))).toBe(ev.event_code);
    const res = await askLinks(ev.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { code: string; links: Record<string, string> };
    expect(body.code).toBe(ev.event_code);
    expect(body.links).toEqual(eventCodeLinks(body.code));
  });

  test('an event without a code gets one on first ask, the same ever after', async () => {
    const ev = await createEvent(`Code later ${Date.now()}`);
    await db().prepare('DELETE FROM event_codes WHERE event_id = ?').bind(ev.id).run();
    const a = (await (await askLinks(ev.id)).json()) as { code: string };
    const b = (await (await askLinks(ev.id)).json()) as { code: string };
    expect(normalizeEventCode(a.code)).toBe(a.code);
    expect(b.code).toBe(a.code);
  });

  test('without signing in: 401; an unknown event: 404; GET makes nothing', async () => {
    const ev = await createEvent(`Code auth ${Date.now()}`);
    expect((await askLinks(ev.id, { 'Content-Type': 'application/json' })).status).toBe(401);
    expect((await askLinks('evt_no_such_event')).status).toBe(404);
    const get = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${ev.id}/short-links`, {
      headers: KEY,
    });
    expect(get.status).not.toBe(200);
  });
});

describe('the short addresses', () => {
  test('each opens its screen, however the code is typed', async () => {
    const ev = await createEvent(`Short open ${Date.now()}`);
    await goLive(ev.id, 7);
    const code = String(ev.event_code);
    const id = ev.id;
    const want: Array<[string, string]> = [
      ['e', `/events/${id}/${ev.slug}`],
      ['p', `/events/${id}/poster`],
      ['tv', `/events/${id}/tv`],
      ['r', `/forms/${id}?type=register`],
      ['c', `/forms/${id}?type=checkin`],
    ];
    for (const [prefix, location] of want) {
      for (const typed of [code, code.toLowerCase(), `${code.slice(0, 3)}%20${code.slice(3)}`]) {
        const res = await open(`/${prefix}/${typed}`);
        expect(res.status, `${prefix} ${typed}`).toBe(302);
        expect(res.headers.get('location'), `${prefix} ${typed}`).toBe(location);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
      }
    }
    expect((await open(`/tv/${code}`, { method: 'HEAD' })).status).toBe(302);
  });

  test('a code that matches nothing, or cannot be one, is a 404 page', async () => {
    for (const path of ['/e/ZZZZZZ', '/p/abc', '/tv/K7Q2P0', '/r/ZZZZZZ', '/c/ZZZZZZ']) {
      const res = await open(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toMatch(/That code didn(&#39;|')t match an event/);
    }
  });

  test('/tv alone is still the TV display', async () => {
    const res = await open('/tv');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('function routeEventId()');
  });

  test('crawlers are told to leave every short prefix alone', () => {
    for (const p of ['/e/', '/p/', '/tv/', '/r/', '/c/']) expect(CRAWL_DISALLOW).toContain(p);
  });
});

describe('a shared link is counted: what and when, never who', () => {
  test('one number per screen and phase; /tv/ is never counted', async () => {
    const ev = await createEvent(`Short count ${Date.now()}`);
    await goLive(ev.id, 10);
    const code = String(ev.event_code);
    for (const prefix of ['e', 'e', 'p', 'r', 'c', 'c', 'c', 'tv', 'tv']) {
      await open(`/${prefix}/${code}`, asPerson);
    }
    expect(await sharesOf(ev.id)).toEqual({
      'event:pre_event': 2,
      'poster:pre_event': 1,
      'register:pre_event': 1,
      'checkin:pre_event': 3,
    });
  });

  test("the phase is the event page's own: live today, recap after it ended", async () => {
    const live = await createEvent(`Short live ${Date.now()}`);
    await goLive(live.id, -1, 1);
    await open(`/e/${live.event_code}`, asPerson);
    const past = await createEvent(`Short past ${Date.now()}`);
    await goLive(past.id, -10, -9);
    await open(`/e/${past.event_code}`, asPerson);
    expect(await sharesOf(live.id)).toEqual({ 'event:event': 1 });
    expect(await sharesOf(past.id)).toEqual({ 'event:post_event': 1 });
  });

  test('shares never touch the shortlinks counters (a poster share is not a poster scan)', async () => {
    const ev = await createEvent(`Short apart ${Date.now()}`);
    await goLive(ev.id, 5);
    const before = await shortlinkTaps(ev.id);
    for (const prefix of ['e', 'p', 'r', 'c']) await open(`/${prefix}/${ev.event_code}`, asPerson);
    expect(await shortlinkTaps(ev.id)).toBe(before);
    const kinds = await db()
      .prepare(
        `SELECT COUNT(*) AS n FROM shortlinks WHERE event_id = ? AND kind IN ('register', 'checkin')`
      )
      .bind(ev.id)
      .first<{ n: number }>();
    expect(kinds?.n).toBe(0);
  });

  // @born-red TL-073 | method: deliberate-fixture-break | date: 2026-10-09
  test('HEAD and link-preview robots open the link but are not counted', async () => {
    const ev = await createEvent(`Short robots ${Date.now()}`);
    await goLive(ev.id, 5);
    const code = String(ev.event_code);
    const robots = [
      'facebookexternalhit/1.1 Facebot Twitterbot/1.0', // iMessage previews say this
      'WhatsApp/2.23.20.0 A',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      '',
    ];
    for (const ua of robots) {
      const res = await open(`/e/${code}`, { headers: { 'User-Agent': ua } });
      expect(res.status, ua).toBe(302);
    }
    const head = await open(`/e/${code}`, { method: 'HEAD', ...asPerson });
    expect(head.status).toBe(302);
    expect(await sharesOf(ev.id)).toEqual({});
    // A phone whose brand carries "bot" is still a person.
    await open(`/e/${code}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 12; CUBOT P60) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
      },
    });
    expect(await sharesOf(ev.id)).toEqual({ 'event:pre_event': 1 });
  });

  test('a draft: the code never reveals its name, and nothing is counted', async () => {
    const ev = await createEvent(`Secret Draft Party ${Date.now()}`);
    const code = String(ev.event_code);
    const res = await open(`/e/${code}`, asPerson);
    expect(res.status).toBe(302);
    const location = String(res.headers.get('location'));
    expect(location).toBe(`/events/${ev.id}`);
    expect(location).not.toContain('secret');
    // That address answers the same 404 as an unknown event.
    const page = await open(location);
    expect(page.status).toBe(404);
    for (const prefix of ['p', 'r', 'c']) await open(`/${prefix}/${code}`, asPerson);
    expect(await sharesOf(ev.id)).toEqual({});
  });

  // @born-red TL-074 | method: design-time-negative-assertion | date: 2026-10-09
  test('the counter holds no person: only event, screen, phase, day and a number', async () => {
    const cols = await db().prepare('PRAGMA table_info(share_opens_daily)').all<{ name: string }>();
    expect((cols.results ?? []).map((c) => c.name).sort()).toEqual([
      'day',
      'event_id',
      'opens',
      'phase',
      'screen',
    ]);
    const codes = await db().prepare('PRAGMA table_info(event_codes)').all<{ name: string }>();
    expect((codes.results ?? []).map((c) => c.name).sort()).toEqual([
      'code',
      'created_at',
      'event_id',
    ]);
  });

  test('the event page Share button hands out /e/<code>', async () => {
    const ev = await createEvent(`Short share ${Date.now()}`);
    await db()
      .prepare(`UPDATE events SET status = 'active', is_published = 1 WHERE id = ?`)
      .bind(ev.id)
      .run();
    const html = await (await open(`/events/${ev.id}`)).text();
    expect(html).toContain(`data-share-url="${ORIGIN}/e/${ev.event_code}"`);
    // The canonical address stays the readable one.
    expect(html).toContain(`rel="canonical" href="${ORIGIN}/events/${ev.id}/${ev.slug}"`);
  });

  test('deleting the event deletes its code', async () => {
    const ev = await createEvent(`Short delete ${Date.now()}`);
    const del = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${ev.id}`, {
      method: 'DELETE',
      headers: KEY,
    });
    expect(del.status).toBeLessThan(300);
    expect((await open(`/e/${ev.event_code}`)).status).toBe(404);
  });
});

describe('guessing codes is limited; a right code never is (2026-10-10)', () => {
  const from = (ip: string) => ({ headers: { 'User-Agent': BROWSER, 'CF-Connecting-IP': ip } });
  // A real code of one event, and wrong ones that cannot match it.
  const wrong = (n: number) =>
    `/e/ZZZZ${EVENT_CODE_ALPHABET[n % 31]}${EVENT_CODE_ALPHABET[(n * 7) % 31]}`;

  // @born-red TL-075 | method: deliberate-fixture-break | date: 2026-10-10
  test('past the limit every code is refused, right ones too, so a hit cannot be told from a miss', async () => {
    const ev = await createEvent(`Short guess ${Date.now()}`);
    await goLive(ev.id, 7);
    const code = String(ev.event_code);
    const guesser = from('198.51.100.7');
    for (let i = 0; i < EVENT_CODE_GUESS_MAX; i++) {
      expect((await open(wrong(i), guesser)).status, `guess ${i + 1}`).toBe(404);
    }
    const over = await open(wrong(EVENT_CODE_GUESS_MAX), guesser);
    expect(over.status).toBe(429);
    expect(over.headers.get('Retry-After')).toBe('60');
    // The same caller now gets the same answer for a real code, on every prefix.
    for (const prefix of ['e', 'p', 'r', 'c', 'tv']) {
      expect((await open(`/${prefix}/${code}`, guesser)).status, prefix).toBe(429);
    }
    // Nobody else is touched.
    expect((await open(`/e/${code}`, from('198.51.100.8'))).status).toBe(302);
  });

  test('a right code never counts as a guess: a crowd on one address is never refused', async () => {
    const ev = await createEvent(`Short crowd ${Date.now()}`);
    await goLive(ev.id, 7);
    const crowd = from('203.0.113.20');
    for (let i = 0; i < EVENT_CODE_GUESS_MAX * 2; i++) {
      expect((await open(`/e/${ev.event_code}`, crowd)).status, `open ${i + 1}`).toBe(302);
    }
    // And the crowd's own typing mistakes still get the plain 404.
    expect((await open(wrong(1), crowd)).status).toBe(404);
  });

  test('something that cannot be a code is not looked up and not counted', async () => {
    const caller = from('203.0.113.21');
    for (let i = 0; i < EVENT_CODE_GUESS_MAX + 5; i++) {
      expect((await open('/e/abc', caller)).status).toBe(404);
    }
    expect((await open(wrong(2), caller)).status).toBe(404);
  });
});

describe('a guessed code of a draft opens nothing about it (2026-10-10)', () => {
  /** Follow redirects by hand (same site only) and return the last answer. */
  async function land(path: string): Promise<{ status: number; body: string; path: string }> {
    let at = path;
    for (let hop = 0; hop < 4; hop++) {
      const res = await open(at, asPerson);
      const next = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && next) {
        const url = new URL(next, ORIGIN);
        if (url.origin !== ORIGIN) throw new Error(`${path} left the site: ${next}`);
        at = url.pathname + url.search;
        continue;
      }
      return { status: res.status, body: await res.text(), path: at };
    }
    throw new Error(`too many redirects from ${path}`);
  }

  // @born-red TL-072 | method: deliberate-fixture-break | date: 2026-10-10
  test('draft and ready: no screen shows the name, and the data behind them refuses', async () => {
    for (const status of ['draft', 'ready']) {
      const marker = `Hushhush ${status} ${Date.now()}`;
      const ev = await createEvent(marker);
      await db().prepare('UPDATE events SET status = ? WHERE id = ?').bind(status, ev.id).run();
      for (const prefix of ['e', 'p', 'r', 'c', 'tv']) {
        const end = await land(`/${prefix}/${ev.event_code}`);
        expect(end.body, `${status} /${prefix}/ → ${end.path}`).not.toContain(marker);
        expect(end.body.toLowerCase(), `${status} /${prefix}/`).not.toContain(ev.slug);
        expect(end.path, `${status} /${prefix}/ lands on`).not.toContain(ev.slug);
      }
      for (const api of [
        `/api/v2/events/${ev.id}`,
        `/api/v2/events/${ev.id}/poster-bundle`,
        `/api/v2/events/${ev.id}/display-config`,
      ]) {
        const res = await open(api, asPerson);
        expect(res.status, `${status} ${api}`).not.toBe(200);
        expect(await res.text(), `${status} ${api}`).not.toContain(marker);
      }
    }
  });
});
