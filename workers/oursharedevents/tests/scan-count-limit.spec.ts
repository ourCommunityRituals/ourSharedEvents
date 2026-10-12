/**
 * OSE-1496 — a flood of scans or short-link clicks from one caller stops being
 * counted, and nobody is turned away.
 *
 * `/q/<token>` and `/s/<code>` were the two public routes with no limit. Both
 * write a count on every request, so one client could add as many scans or
 * clicks as it liked: inflate a sponsor's numbers, or push a node's count
 * across the floor to learn whether one real person scanned there.
 *
 * These are the links people scan off a poster, and a crowd at a door shares
 * one address. So past the limit the visitor is still sent on (302), and the
 * request is not counted. A 429 would block real people; counting would let
 * the flood in. The limit is the same one every public read has.
 *
 * Level: W (workers pool, real D1 and KV, real routes through SELF).
 *
 * @born-red OSE-1496 | method: ran against the pre-change router and handlers.
 * Every request past the limit was still counted | date: 2026-10-06
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import {
  publicCountLimited,
  isPublicReadLimited,
  PUBLIC_READ_MAX,
} from '../src/lib/public-read-limit';
import { handleQrScan } from '../src/handlers/qr-scan';
import { handleShortlinkResolve } from '../src/handlers/shortlink-resolve';
import { createShortlink } from '../src/lib/shortlinks';
import ROUTER_SOURCE from '../src/router.ts?raw';
import { AS_PERSON } from './helpers/person-agent';

interface TestEnv {
  DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const EVENT_ID = 'test-evt-count-limit';
const DEPLOYMENT_ID = 'test-pd-count-limit-001';
const QR_TOKEN = 'qrt_count_limit_token_1496abc';
let shortCode = '';

/** In-memory KV good enough for the limiter's window. */
function kv() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace;
}

const scanRows = async () =>
  (
    await tenv()
      .DB.prepare('SELECT COUNT(*) AS c FROM scan_placement_events WHERE event_id = ?')
      .bind(EVENT_ID)
      .first<{ c: number }>()
  )?.c ?? 0;

const returnRows = async () =>
  (
    await tenv()
      .DB.prepare('SELECT COUNT(*) AS c FROM scan_node_returns WHERE event_id = ?')
      .bind(EVENT_ID)
      .first<{ c: number }>()
  )?.c ?? 0;

const clicks = async () =>
  (
    await tenv()
      .DB.prepare('SELECT clicks AS c FROM shortlinks WHERE code = ?')
      .bind(shortCode)
      .first<{ c: number }>()
  )?.c ?? 0;

beforeAll(async () => {
  for (const stmt of JSON.parse(tenv().TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column name') ||
        m.includes('already exists') ||
        m.includes('no such column')
      )
        continue;
      throw e;
    }
  }
  await tenv()
    .DB.prepare(
      `INSERT OR REPLACE INTO events
         (id, brand_id, title, slug, status, start_date, created_at, updated_at)
       VALUES (?, 'brand-test', 'Count Limit Event', ?, 'active', datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(EVENT_ID, EVENT_ID)
    .run();
  await tenv()
    .DB.prepare(
      `INSERT OR REPLACE INTO poster_deployments
         (id, event_id, qr_token, placement_label, is_active, created_at)
       VALUES (?, ?, ?, 'Count Limit Poster', 1, datetime('now'))`
    )
    .bind(DEPLOYMENT_ID, EVENT_ID, QR_TOKEN)
    .run();
  shortCode = (await createShortlink(tenv(), EVENT_ID)).code;
});

beforeEach(async () => {
  await tenv()
    .DB.prepare('DELETE FROM scan_placement_events WHERE event_id = ?')
    .bind(EVENT_ID)
    .run();
  await tenv().DB.prepare('DELETE FROM scan_node_returns WHERE event_id = ?').bind(EVENT_ID).run();
  await tenv().DB.prepare('UPDATE shortlinks SET clicks = 0 WHERE code = ?').bind(shortCode).run();
});

describe('the wrapper never refuses: it tells the handler whether to count', () => {
  const req = (ip = '203.0.113.10') =>
    new Request('https://t.test/q/x', { headers: { 'CF-Connecting-IP': ip } });

  test('under the limit every request is countable', async () => {
    const seen: boolean[] = [];
    const wrapped = publicCountLimited('t', async (_r, _e, countable) => {
      seen.push(countable);
      return new Response(null, { status: 302 });
    });
    const e = { RATE_LIMIT_KV: kv() };
    for (let i = 0; i < 20; i++) expect((await wrapped(req(), e)).status).toBe(302);
    expect(seen.every(Boolean)).toBe(true);
  });

  test('past the limit the handler still runs, and is told not to count', async () => {
    const seen: boolean[] = [];
    const wrapped = publicCountLimited('t', async (_r, _e, countable) => {
      seen.push(countable);
      return new Response(null, { status: 302 });
    });
    const e = { RATE_LIMIT_KV: kv() };
    let last = new Response('');
    for (let i = 0; i <= PUBLIC_READ_MAX + 1; i++) last = await wrapped(req(), e);
    expect(last.status, 'never a 429').toBe(302);
    expect(seen.filter(Boolean).length, 'counted up to the limit').toBe(PUBLIC_READ_MAX);
    expect(seen[seen.length - 1], 'the last one is not counted').toBe(false);
  });

  test('one caller past the limit does not stop another from being counted', async () => {
    const seen: Array<[string, boolean]> = [];
    const wrapped = publicCountLimited('t', async (r, _e, countable) => {
      seen.push([r.headers.get('CF-Connecting-IP') ?? '', countable]);
      return new Response(null, { status: 302 });
    });
    const e = { RATE_LIMIT_KV: kv() };
    for (let i = 0; i <= PUBLIC_READ_MAX + 1; i++) await wrapped(req('203.0.113.10'), e);
    await wrapped(req('203.0.113.99'), e);
    expect(seen[seen.length - 1]).toEqual(['203.0.113.99', true]);
  });

  // A limit that stops counting can be turned around: drain someone else's
  // allowance and their real scans stop being counted. So the bucket may only
  // ever be the address Cloudflare itself reports, never one the client names.
  test('a caller cannot drain another address by naming it in X-Forwarded-For', async () => {
    const seen: boolean[] = [];
    const wrapped = publicCountLimited('t', async (_r, _e, countable) => {
      seen.push(countable);
      return new Response(null, { status: 302 });
    });
    const e = { RATE_LIMIT_KV: kv() };
    const victim = '203.0.113.50';
    const forged = () =>
      new Request('https://t.test/q/x', { headers: { 'X-Forwarded-For': victim } });
    for (let i = 0; i <= PUBLIC_READ_MAX + 5; i++) await wrapped(forged(), e);
    seen.length = 0;
    await wrapped(req(victim), e);
    expect(seen, 'the real visitor at that address is still counted').toEqual([true]);
  });

  test('requests with no Cloudflare address do not share an allowance', async () => {
    const seen: boolean[] = [];
    const wrapped = publicCountLimited('t', async (_r, _e, countable) => {
      seen.push(countable);
      return new Response(null, { status: 302 });
    });
    const e = { RATE_LIMIT_KV: kv() };
    const bare = () => new Request('https://t.test/q/x');
    for (let i = 0; i <= PUBLIC_READ_MAX + 5; i++) await wrapped(bare(), e);
    expect(seen.every(Boolean), 'no shared bucket to drain: all counted').toBe(true);
  });

  test('with no KV bound everything is counted (the limiter fails open)', async () => {
    const seen: boolean[] = [];
    const wrapped = publicCountLimited('t', async (_r, _e, countable) => {
      seen.push(countable);
      return new Response(null, { status: 302 });
    });
    for (let i = 0; i < 5; i++) await wrapped(req(), {});
    expect(seen).toEqual([true, true, true, true, true]);
  });
});

describe('a scan that is not countable still sends the visitor on, and writes nothing', () => {
  const scan = (countable: boolean) =>
    handleQrScan(
      new Request(`https://t.test/q/${QR_TOKEN}?type=checkin`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone)' },
      }),
      tenv(),
      QR_TOKEN,
      countable
    );

  test('countable: one placement row and one return row, as before', async () => {
    const res = await scan(true);
    expect(res.status).toBe(302);
    expect(await scanRows()).toBe(1);
    expect(await returnRows()).toBe(1);
  });

  test('not countable: the same redirect, no rows, and no cookie is set', async () => {
    const counted = await scan(true);
    await tenv()
      .DB.prepare('DELETE FROM scan_placement_events WHERE event_id = ?')
      .bind(EVENT_ID)
      .run();
    await tenv()
      .DB.prepare('DELETE FROM scan_node_returns WHERE event_id = ?')
      .bind(EVENT_ID)
      .run();
    const res = await scan(false);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(counted.headers.get('Location'));
    expect(res.headers.get('Location')).toContain(`/events/${EVENT_ID}`);
    expect(await scanRows()).toBe(0);
    expect(await returnRows()).toBe(0);
    expect(
      res.headers.get('Set-Cookie'),
      'no anonymous id is minted for an uncounted scan'
    ).toBeNull();
  });

  test('not countable does not use up this hour for a later real scan', async () => {
    const cookie = 'ose_anon=anon_11111111-1111-4111-8111-111111111111';
    const withCookie = (countable: boolean) =>
      handleQrScan(
        new Request(`https://t.test/q/${QR_TOKEN}`, { headers: { Cookie: cookie } }),
        tenv(),
        QR_TOKEN,
        countable
      );
    await withCookie(false);
    expect(await scanRows()).toBe(0);
    await withCookie(true);
    expect(await scanRows(), 'the real scan is still recorded').toBe(1);
  });
});

describe('a short-link click that is not countable still redirects, and adds no click', () => {
  const click = (countable: boolean) =>
    handleShortlinkResolve(
      new Request(`https://t.test/s/${shortCode}`, { headers: AS_PERSON }),
      tenv(),
      shortCode,
      countable
    );

  test('countable: the click is counted', async () => {
    expect((await click(true)).status).toBe(302);
    expect(await clicks()).toBe(1);
  });

  test('not countable: the same redirect and no click', async () => {
    const counted = await click(true);
    const res = await click(false);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(counted.headers.get('Location'));
    expect(await clicks()).toBe(1);
  });
});

describe('through the real routes', () => {
  const FLOOD_IP = '198.51.100.77';
  const hit = (path: string, ip: string) =>
    SELF.fetch(`https://localhost${path}`, {
      redirect: 'manual',
      headers: { 'CF-Connecting-IP': ip, ...AS_PERSON },
    });

  /**
   * Use up `ip`'s per-minute allowance for `scope`, without sending hundreds of
   * real requests. The scope name is the one the router passes, so a route wired
   * to a different scope (or to none) is still counted and fails.
   *
   * It asks with a limit one above the default. That is how a caller skips the
   * 10-second edge layer (public-read-limit.ts), so every call here lands on the
   * per-minute count. Asked with the default limit, the edge layer answers
   * "limited" after 60 calls and returns before the per-minute count is touched:
   * the count stopped at 61 of 360, and the route was held back by the edge layer
   * alone. A run that crossed that layer's 10-second boundary between the drain
   * and the clicks counted them again (CI, 2026-10-07: "expected 3 to be 1").
   *
   * The last line checks the drain did what it says, with the edge layer out of
   * the question, so this cannot go back to depending on the clock unnoticed.
   */
  const useUp = async (scope: string, ip: string) => {
    const r = new Request('https://localhost/x', { headers: { 'CF-Connecting-IP': ip } });
    for (let i = 0; i <= PUBLIC_READ_MAX; i++) {
      await isPublicReadLimited(r, tenv(), scope, PUBLIC_READ_MAX + 1);
    }
    // Asked on its own terms, not the loop's: the edge layer is skipped here
    // whatever the loop above does, so only the per-minute count can say yes.
    expect(
      await isPublicReadLimited(r, tenv(), scope, PUBLIC_READ_MAX + 1),
      'the per-minute allowance is used up, whatever the edge layer says'
    ).toBe(true);
  };

  test('scans: counted up to the limit, then sent on uncounted; another caller is unaffected', async () => {
    expect((await hit(`/q/${QR_TOKEN}`, FLOOD_IP)).status).toBe(302);
    expect(await scanRows(), 'under the limit a scan is counted').toBe(1);

    await useUp('qr-scan', FLOOD_IP);
    for (let i = 0; i < 5; i++) {
      const res = await hit(`/q/${QR_TOKEN}`, FLOOD_IP);
      expect(res.status, 'the visitor is never refused').toBe(302);
      expect(res.headers.get('Location')).toContain(`/events/${EVENT_ID}`);
      expect(res.headers.get('Set-Cookie')).toBeNull();
    }
    expect(await scanRows(), 'five forged scans past the limit add nothing').toBe(1);
    expect(await returnRows()).toBe(1);

    expect((await hit(`/q/${QR_TOKEN}`, '198.51.100.200')).status).toBe(302);
    expect(await scanRows(), 'a different caller is still counted').toBe(2);
  });

  test('short links: counted up to the limit, then redirected uncounted', async () => {
    const ip = '198.51.100.78';
    expect((await hit(`/s/${shortCode}`, ip)).status).toBe(302);
    expect(await clicks()).toBe(1);

    await useUp('shortlink', ip);
    for (let i = 0; i < 5; i++) expect((await hit(`/s/${shortCode}`, ip)).status).toBe(302);
    expect(await clicks(), 'five clicks past the limit add nothing').toBe(1);

    expect((await hit(`/s/${shortCode}`, '198.51.100.201')).status).toBe(302);
    expect(await clicks(), 'a different caller is still counted').toBe(2);
  });

  test('the two routes have their own allowance: a scan flood does not stop a click being counted', async () => {
    const ip = '198.51.100.79';
    await useUp('qr-scan', ip);
    expect((await hit(`/s/${shortCode}`, ip)).status).toBe(302);
    expect(await clicks()).toBe(1);
  });

  test('the router wraps both routes, so the limit is visible where the route is', () => {
    expect(ROUTER_SOURCE).toMatch(/publicCountLimited\(\s*'qr-scan'/);
    expect(ROUTER_SOURCE).toMatch(/publicCountLimited\(\s*'shortlink'/);
  });
});
