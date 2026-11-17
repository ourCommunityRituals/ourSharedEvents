/**
 * OSE-1986 — the landing and the event list are limited per caller, and a
 * refused reader gets a page in their language (threat TL-100).
 *
 * Workers pool, through the real router. What these pin:
 *   - every address that serves the landing or the list is behind the limit:
 *     `/`, its five aliases, `/events`, and both under each language prefix
 *   - the landing addresses share one allowance; the list has its own
 *   - the refusal is an HTML page with one <h1>, in the page's language and
 *     direction, with Retry-After, never stored, with no cookie, and with
 *     nothing from the request's query written into it
 *   - a venue's Wi-Fi: the 10-second edge layer does not apply to a page
 *   - the limiter fails open
 *   - a request that is served is the page it was before
 */
// @born-red every landing address is limited | method: the publicPageLimited wrapper removed from the `/` block in router.ts; "the landing and its aliases are refused past the limit" failed (200, not 429) for all six addresses | date: 2026-11-16
// @born-red language prefixes are limited | method: the wrapper removed from the `landing` and `events` branches of the language-prefix block; "a language prefix is no second allowance" and "the event list is refused past the limit" failed | date: 2026-11-16
// @born-red the refusal is a page in the reader's language | method: pageLimitResponse made to return publicReadLimitResponse() (the API's JSON); "the refusal is a page, in the page's language" failed on Content-Type | date: 2026-11-16
// @born-red right to left | method: `dir` dropped from renderErrorPage's <html>; "Arabic is written right to left" failed | date: 2026-11-16
// @born-red nothing from the query is written back | method: the retry link built from request.url; "nothing from the request is written into the refusal" failed | date: 2026-11-16
// @born-red a venue is not refused by the 10-second layer | method: PUBLIC_PAGE_MAX lowered to PUBLIC_READ_MAX; "a page skips the 10-second edge layer" failed (refused) | date: 2026-11-16
// @born-red fails open | method: the try/catch removed from isPublicReadLimited; "a limiter whose storage throws serves the page" failed (it threw) | date: 2026-11-16
import { describe, test, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { PUBLIC_PAGE_MAX, PUBLIC_READ_MAX, publicPageLimited } from '../src/lib/public-read-limit';
import { rateLimitKvKey } from '../src/lib/rate-limit';
import { PAGE_LIMIT_RETRY_SECONDS } from '../src/handlers/pages';
import { msg } from '../src/lib/i18n/catalog';
import { DIRECTION, LANGUAGES, type Lang } from '../src/lib/i18n/languages';

interface TestEnv {
  RATE_LIMIT_KV: KVNamespace;
  RATE_LIMIT_KEY_PEPPER?: string;
}
const tenv = (): TestEnv => env as unknown as TestEnv;

const ORIGIN = 'https://t.test';
const LANDING = ['/', '/home', '/welcome', '/landing', '/about', '/info', '/map'];
const PREFIXED = LANGUAGES.filter((l) => l !== 'en');

let nextIp = 10;
/** A caller nobody else in this file uses. */
const freshIp = (): string => `203.0.113.${nextIp++}`;

/** Spend a caller's whole minute for one scope. */
async function spend(scope: string, ip: string): Promise<void> {
  const key = await rateLimitKvKey(`publicread:${scope}:${ip}`, tenv().RATE_LIMIT_KEY_PEPPER);
  await tenv().RATE_LIMIT_KV.put(
    key,
    JSON.stringify({ count: PUBLIC_PAGE_MAX, resetAt: Date.now() + 60_000, max: PUBLIC_PAGE_MAX })
  );
}

const get = (path: string, ip: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, {
    redirect: 'manual',
    headers: { 'CF-Connecting-IP': ip, Accept: 'text/html', ...headers },
  });

const h1Count = (body: string): number => (body.match(/<h1[\s>]/g) ?? []).length;

describe('OSE-1986 | which addresses are limited', () => {
  test('the limit is the page limit, above the API limit', () => {
    // Written out: a test that reads only the constant moves with it.
    expect(PUBLIC_PAGE_MAX).toBe(600);
    expect(PUBLIC_PAGE_MAX).toBeGreaterThan(PUBLIC_READ_MAX);
    expect(PAGE_LIMIT_RETRY_SECONDS).toBe(60);
  });

  test('the landing and its aliases are refused past the limit, on one shared allowance', async () => {
    const ip = freshIp();
    for (const path of LANDING) {
      const served = await get(path, ip);
      expect(served.status, `${path} before the limit`).toBe(200);
      await served.arrayBuffer();
    }
    await spend('landing', ip);
    for (const path of LANDING) {
      const refused = await get(path, ip);
      expect(refused.status, `${path} past the limit`).toBe(429);
      await refused.arrayBuffer();
    }
  });

  test('a language prefix is no second allowance', async () => {
    const ip = freshIp();
    await spend('landing', ip);
    for (const lang of PREFIXED) {
      for (const path of [`/${lang}/`, `/${lang}`, `/${lang}/map`]) {
        const res = await get(path, ip);
        expect(res.status, path).toBe(429);
        await res.arrayBuffer();
      }
    }
  });

  test('the event list is refused past the limit, with or without a prefix', async () => {
    const ip = freshIp();
    expect((await get('/events', ip)).status).toBe(200);
    await spend('events-page', ip);
    for (const path of ['/events', ...PREFIXED.map((l) => `/${l}/events`)]) {
      const res = await get(path, ip);
      expect(res.status, path).toBe(429);
      await res.arrayBuffer();
    }
  });

  test('the landing and the list do not spend each other, and another caller is untouched', async () => {
    const ip = freshIp();
    await spend('landing', ip);
    expect((await get('/', ip)).status).toBe(429);
    expect((await get('/events', ip)).status).toBe(200);
    expect((await get('/', freshIp())).status).toBe(200);

    const other = freshIp();
    await spend('events-page', other);
    expect((await get('/events', other)).status).toBe(429);
    expect((await get('/', other)).status).toBe(200);
  });

  test('an area and a search are the same page and the same allowance', async () => {
    const ip = freshIp();
    await spend('landing', ip);
    for (const path of ['/?area=872664570ffffff', '/?where=Chicago', '/?zip=60453']) {
      const res = await get(path, ip);
      expect(res.status, path).toBe(429);
      await res.arrayBuffer();
    }
  });
});

describe('OSE-1986 | the refusal', () => {
  test("the refusal is a page, in the page's language, with one heading", async () => {
    const ip = freshIp();
    await spend('landing', ip);
    await spend('events-page', ip);
    const cases: [string, Lang][] = [
      ['/', 'en'],
      ['/events', 'en'],
      ...PREFIXED.flatMap((l): [string, Lang][] => [
        [`/${l}/`, l],
        [`/${l}/events`, l],
      ]),
    ];
    for (const [path, lang] of cases) {
      const res = await get(path, ip);
      expect(res.status, path).toBe(429);
      expect(res.headers.get('Content-Type') ?? '', path).toContain('text/html');
      const body = await res.text();
      expect(body, path).toContain(`<html lang="${lang}" dir="${DIRECTION[lang]}"`);
      expect(h1Count(body), path).toBe(1);
      expect(body, path).toContain(msg(lang, 'limit.title'));
      expect(body, path).toContain(msg(lang, 'limit.body'));
      expect(body, path).toContain(msg(lang, 'limit.again'));
      // "Please wait", not "Error 429": the reader did nothing wrong.
      expect(body, path).toContain(msg(lang, 'limit.status'));
      expect(body, path).not.toContain('Error 429');
      // Not the API's answer.
      expect(body, path).not.toContain('RATE_LIMITED');
    }
  });

  test('each language has its own words', () => {
    for (const key of ['limit.title', 'limit.body', 'limit.again', 'limit.status'] as const) {
      const texts = LANGUAGES.map((l) => msg(l, key));
      expect(new Set(texts).size, key).toBe(LANGUAGES.length);
    }
  });

  test('Arabic is written right to left', async () => {
    const ip = freshIp();
    await spend('landing', ip);
    const body = await (await get('/ar/', ip)).text();
    expect(body).toContain('<html lang="ar" dir="rtl"');
  });

  test('it says when to come back, and is never stored', async () => {
    const ip = freshIp();
    await spend('landing', ip);
    const res = await get('/', ip);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  test("a bare address takes the reader's language from the header, and says so", async () => {
    const ip = freshIp();
    await spend('landing', ip);
    const res = await get('/', ip, { 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.5' });
    expect(res.headers.get('Vary') ?? '').toContain('Accept-Language');
    const body = await res.text();
    expect(body).toContain('<html lang="es" dir="ltr"');
    expect(body).toContain(msg('es', 'limit.title'));
    // A prefix is the reader's explicit choice: the header does not change it.
    const prefixed = await get('/pl/', ip, { 'Accept-Language': 'es' });
    expect(prefixed.headers.get('Vary') ?? '').not.toContain('Accept-Language');
    expect(await prefixed.text()).toContain('<html lang="pl" dir="ltr"');
  });

  test('"Try again" goes back to the same page, in the same language', async () => {
    const ip = freshIp();
    await spend('landing', ip);
    await spend('events-page', ip);
    const link = async (path: string, headers: Record<string, string> = {}) =>
      /data-testid="error-cta" href="([^"]*)"/.exec(
        await (await get(path, ip, headers)).text()
      )?.[1];
    expect(await link('/')).toBe('/');
    expect(await link('/about')).toBe('/');
    expect(await link('/events')).toBe('/events');
    expect(await link('/es/')).toBe('/es/');
    expect(await link('/ar/events')).toBe('/ar/events');
    // A bare address stays bare, whatever the header says.
    expect(await link('/', { 'Accept-Language': 'pl' })).toBe('/');
  });

  test('nothing from the request is written into the refusal', async () => {
    const ip = freshIp();
    await spend('landing', ip);
    await spend('events-page', ip);
    const marker = 'zzq9marker';
    for (const path of [
      `/?where=${marker}`,
      `/?area=${marker}&x="><script>${marker}</script>`,
      `/events?q=${marker}`,
      `/es/?where=${marker}`,
    ]) {
      const res = await get(path, ip);
      expect(res.status, path).toBe(429);
      expect(await res.text(), path).not.toContain(marker);
    }
  });
});

describe('OSE-1986 | a request that is served', () => {
  test('is the landing or the list, with no trace of the limit', async () => {
    const ip = freshIp();
    for (const [path, surface] of [
      ['/', 'ose-landing'],
      ['/es/', 'ose-landing'],
    ] as const) {
      const res = await get(path, ip);
      expect(res.status, path).toBe(200);
      const body = await res.text();
      expect(body, path).toContain(`data-surface="${surface}"`);
      expect(body, path).not.toContain(msg('en', 'limit.title'));
      expect(body, path).not.toContain('data-surface="ose-error"');
      expect(res.headers.get('Retry-After'), path).toBeNull();
      expect(res.headers.get('Set-Cookie'), path).toBeNull();
    }
    const list = await get('/events', ip);
    expect(list.status).toBe(200);
    expect(await list.text()).not.toContain('data-surface="ose-error"');
  });
});

describe('OSE-1986 | the wrapper', () => {
  const page = async () => new Response('the page', { status: 200 });
  const refusal = () => new Response('refused', { status: 429 });
  const req = (ip: string) => new Request(`${ORIGIN}/`, { headers: { 'CF-Connecting-IP': ip } });

  test('a page skips the 10-second edge layer, so a venue behind one address is not refused by it', async () => {
    let asked = 0;
    const refusingEdge = {
      limit: async () => {
        asked += 1;
        return { success: false };
      },
    };
    const wrapped = publicPageLimited('venue-test', page, refusal);
    const res = await wrapped(req(freshIp()), {
      PUBLIC_READ_EDGE_LIMITER: refusingEdge,
    } as never);
    expect(res.status).toBe(200);
    expect(asked).toBe(0);
    // The control: at the API's limit the same edge layer refuses.
    const atApiLimit = publicPageLimited('venue-test', page, refusal, PUBLIC_READ_MAX);
    const refused = await atApiLimit(req(freshIp()), {
      PUBLIC_READ_EDGE_LIMITER: refusingEdge,
    } as never);
    expect(refused.status).toBe(429);
    expect(asked).toBe(1);
  });

  test('a limiter whose storage throws serves the page', async () => {
    const broken = {
      get: async () => {
        throw new Error('KV is down');
      },
      put: async () => {
        throw new Error('KV is down');
      },
    };
    const wrapped = publicPageLimited('broken-test', page, refusal);
    const res = await wrapped(req(freshIp()), { RATE_LIMIT_KV: broken } as never);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('the page');
  });

  test('with no storage bound at all, the page is served', async () => {
    const wrapped = publicPageLimited('unbound-test', page, refusal);
    expect((await wrapped(req(freshIp()), {} as never)).status).toBe(200);
  });

  test('the refusal is built only for a refused request', async () => {
    let built = 0;
    const wrapped = publicPageLimited('built-test', page, () => {
      built += 1;
      return refusal();
    });
    await wrapped(req(freshIp()), {} as never);
    expect(built).toBe(0);
  });

  test('the count is per caller: the 601st load in a minute is refused, the 600th is not', async () => {
    const ip = freshIp();
    const key = await rateLimitKvKey(`publicread:count-test:${ip}`, tenv().RATE_LIMIT_KEY_PEPPER);
    const wrapped = publicPageLimited('count-test', page, refusal);
    const put = (count: number) =>
      tenv().RATE_LIMIT_KV.put(
        key,
        JSON.stringify({ count, resetAt: Date.now() + 60_000, max: PUBLIC_PAGE_MAX })
      );
    await put(598);
    expect((await wrapped(req(ip), tenv() as never)).status).toBe(200); // the 599th
    await put(599);
    expect((await wrapped(req(ip), tenv() as never)).status).toBe(200); // the 600th
    await put(600);
    expect((await wrapped(req(ip), tenv() as never)).status).toBe(429); // the 601st
  });
});
