/**
 * OSE-2086 — the public pages that read data on every request are limited per
 * caller: the event page, the form pages, the TV, the poster, the SharedReport
 * shell, /health and /robots.txt.
 *
 * Workers pool, through the real router. That every one of these addresses is
 * limited at all is `public-page-limit-gate.spec.ts`. What these pin is what
 * the gate cannot see:
 *   - a refused reader gets the wait page, in their language, with a link back
 *     to the page they asked for and nothing from the query in it
 *   - a language prefix is no second allowance
 *   - each kind of page has its own allowance
 *   - /health and /robots.txt answer a machine: JSON or text, not a page
 *   - a venue's Wi-Fi: the 10-second edge layer does not apply to these pages
 */
// @born-red the event page is limited | method: the limitedPage wrapper removed from the `/events/` block in router.ts; "each page is refused past its limit" failed for /events/evt-1 (not 429) | date: 2026-11-16
// @born-red the link goes back to the page asked for | method: limitedPage made to pass '/' as the path; "the refusal links back to the page that was asked for" failed | date: 2026-11-16
// @born-red a prefix shares the allowance | method: the prefixed event branch given the scope 'event-page-lang'; "a language prefix is no second allowance" failed (not 429) | date: 2026-11-16
// @born-red separate allowances | method: the form pages given the scope 'event-page'; "each kind of page has its own allowance" failed | date: 2026-11-16
// @born-red /health answers JSON | method: /health wrapped with limitedPage; "/health is refused as JSON" failed on Content-Type | date: 2026-11-16
// @born-red not the 10-second layer | method: limitedPage given max PUBLIC_READ_MAX; "a page skips the 10-second edge layer" failed (refused) | date: 2026-11-16
// @born-red a path that reads as another host | method: the `//` check removed from pageLimitResponse; "a target that could be another host goes to the landing" failed | date: 2026-11-16
import { describe, test, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { PUBLIC_PAGE_MAX } from '../src/lib/public-read-limit';
import { rateLimitKvKey } from '../src/lib/rate-limit';
import { PAGE_LIMIT_RETRY_SECONDS, pageLimitResponse } from '../src/handlers/pages';
import { msg } from '../src/lib/i18n/catalog';

interface TestEnv {
  RATE_LIMIT_KV: KVNamespace;
  RATE_LIMIT_KEY_PEPPER?: string;
}
const tenv = (): TestEnv => env as unknown as TestEnv;

const ORIGIN = 'https://t.test';

let nextIp = 10;
/** A caller nobody else in this file uses. */
const freshIp = (): string => `198.51.100.${nextIp++}`;

/** Spend a caller's whole minute for one scope. */
async function spend(scope: string, ip: string): Promise<void> {
  const key = await rateLimitKvKey(`publicread:${scope}:${ip}`, tenv().RATE_LIMIT_KEY_PEPPER);
  await tenv().RATE_LIMIT_KV.put(
    key,
    JSON.stringify({ count: 600, resetAt: Date.now() + 60_000, max: 600 })
  );
}

const get = (path: string, ip: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { 'CF-Connecting-IP': ip, Accept: 'text/html', ...(init.headers ?? {}) },
  });

/** Each kind of page, its scope, and the addresses that share that scope. */
const PAGES: Record<string, string[]> = {
  'event-page': ['/events/evt-1', '/events/evt-1/a-name', '/es/events/evt-1'],
  'form-page': [
    '/events/evt-1/register',
    '/events/evt-1/checkin',
    '/events/evt-1/survey',
    '/events/evt-1/updates',
    '/forms/evt-1',
    '/es/events/evt-1/register',
  ],
  'display-page': ['/display', '/tv', '/kiosk', '/screen', '/events/evt-1/tv'],
  'poster-page': [
    '/poster',
    '/posters',
    '/flyers',
    '/tabletop',
    '/tent',
    '/signage',
    '/events/evt-1/poster',
  ],
  'report-page': ['/sharedReport', '/report', '/analytics', '/reports', '/insights', '/stats'],
};

describe('OSE-2086 | the pages are limited per caller', () => {
  test('the number is the page limit, written out', () => {
    expect(PUBLIC_PAGE_MAX).toBe(600);
  });

  test('each page is refused past its limit, with the wait page', async () => {
    for (const [scope, paths] of Object.entries(PAGES)) {
      const ip = freshIp();
      for (const path of paths) {
        const before = await get(path, ip);
        expect(before.status, `${path} before the limit`).not.toBe(429);
        await before.arrayBuffer();
      }
      await spend(scope, ip);
      for (const path of paths) {
        const res = await get(path, ip);
        expect(res.status, `${path} past the limit`).toBe(429);
        expect(res.headers.get('Content-Type') ?? '', path).toContain('text/html');
        expect(res.headers.get('Retry-After'), path).toBe(String(PAGE_LIMIT_RETRY_SECONDS));
        expect(res.headers.get('Cache-Control'), path).toBe('no-store');
        expect(res.headers.get('Set-Cookie'), path).toBeNull();
        const body = await res.text();
        expect((body.match(/<h1[\s>]/g) ?? []).length, path).toBe(1);
      }
    }
  });

  test('each kind of page has its own allowance', async () => {
    const ip = freshIp();
    await spend('event-page', ip);
    expect((await get('/events/evt-1', ip)).status).toBe(429);
    for (const path of ['/events/evt-1/register', '/display', '/poster', '/sharedReport']) {
      const res = await get(path, ip);
      expect(res.status, path).not.toBe(429);
      await res.arrayBuffer();
    }
  });

  test('another caller is not refused', async () => {
    const ip = freshIp();
    await spend('event-page', ip);
    const other = await get('/events/evt-1', freshIp());
    expect(other.status).not.toBe(429);
    await other.arrayBuffer();
  });
});

describe('OSE-2086 | what a refused reader gets', () => {
  test('the refusal links back to the page that was asked for', async () => {
    const ip = freshIp();
    await spend('event-page', ip);
    const body = await (await get('/events/evt-1/a-name', ip)).text();
    expect(body).toContain('href="/events/evt-1/a-name"');
    expect(body).toContain(msg('en', 'limit.title'));
  });

  test('a language prefix is no second allowance, and its refusal is in that language', async () => {
    const ip = freshIp();
    await spend('event-page', ip);
    const res = await get('/es/events/evt-1', ip);
    expect(res.status).toBe(429);
    const body = await res.text();
    expect(body).toContain('<html lang="es"');
    expect(body).toContain(msg('es', 'limit.title'));
    expect(body).toContain('href="/es/events/evt-1"');
    // The path chose the language, so the answer does not vary by header.
    expect(res.headers.get('Vary') ?? '').not.toContain('Accept-Language');
  });

  test('nothing from the query is written into the refusal', async () => {
    const ip = freshIp();
    await spend('report-page', ip);
    const body = await (await get('/sharedReport?token=SECRET-TOKEN-123&x=<b>', ip)).text();
    expect(body).not.toContain('SECRET-TOKEN-123');
    expect(body).not.toContain('<b>');
    expect(body).toContain('href="/sharedReport"');
  });

  test('a target that could be another host goes to the landing', async () => {
    const req = new Request(`${ORIGIN}/x`);
    for (const target of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
      const body = await pageLimitResponse(req, undefined, target).text();
      expect(body, target).not.toContain('evil.example');
      expect(body, target).toContain('href="/"');
    }
  });
});

describe('OSE-2086 | forms, machines and venues', () => {
  test('/health is refused as JSON, on the page number', async () => {
    const ip = freshIp();
    for (const path of ['/health', '/api/status']) {
      const ok = await get(path, ip);
      expect(ok.status, path).toBe(200);
      await ok.arrayBuffer();
    }
    await spend('health', ip);
    for (const path of ['/health', '/api/status']) {
      const res = await get(path, ip);
      expect(res.status, path).toBe(429);
      expect(res.headers.get('Content-Type') ?? '', path).toContain('application/json');
      expect(res.headers.get('Retry-After'), path).not.toBeNull();
      await res.arrayBuffer();
    }
  });

  test('/robots.txt is refused past the public-read limit, not as a page', async () => {
    const ip = freshIp();
    const ok = await get('/robots.txt', ip);
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();
    await spend('robots', ip);
    const res = await get('/robots.txt', ip);
    expect(res.status).toBe(429);
    expect(res.headers.get('Content-Type') ?? '').not.toContain('text/html');
    await res.arrayBuffer();
  });

  test('a page skips the 10-second edge layer: 61 loads at once from one address are served', async () => {
    const ip = freshIp();
    for (const path of ['/display', '/events/evt-1/checkin', '/health']) {
      const results = await Promise.all(
        Array.from({ length: 61 }, async () => {
          const res = await get(path, ip);
          await res.arrayBuffer();
          return res.status;
        })
      );
      expect(
        results.filter((s) => s === 429),
        path
      ).toHaveLength(0);
    }
  });
});
