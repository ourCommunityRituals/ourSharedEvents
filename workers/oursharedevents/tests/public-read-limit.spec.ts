/**
 * OSE-1247 — rate limiting for public reads, default-on.
 *
 * The property under test is the DIRECTION of the default. `lib/rate-limit.ts`
 * has worked for a long time; the gap was that it was applied by hand per
 * route, so the safe path required remembering and every new public endpoint
 * started unlimited.
 *
 * The fail-open behaviour gets as much coverage as the limiting, because it is
 * the part most likely to be "fixed" by someone who reads a rate limiter as a
 * security boundary. It is not one. It is a speed bump on enumeration, and it
 * must never be load-bearing enough to be worth an outage.
 */
import { describe, test, expect } from 'vitest';
import {
  publicReadLimited,
  isPublicReadLimited,
  publicReadLimitResponse,
  PUBLIC_READ_MAX,
} from '../src/lib/public-read-limit';

/** In-memory KV good enough for the sliding window the limiter uses. */
function kv() {
  const store = new Map<string, string>();
  return {
    store,
    RATE_LIMIT_KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => void store.set(k, v),
    } as unknown as KVNamespace,
  };
}

const req = (ip = '203.0.113.10') =>
  new Request('https://t.test/api/v2/events/map?cell=x', {
    headers: { 'CF-Connecting-IP': ip },
  });

const ok = async () => new Response('ok');

describe('the limit applies, and only past the threshold', () => {
  test('a normal burst is never touched', async () => {
    const { RATE_LIMIT_KV } = kv();
    const wrapped = publicReadLimited('t', ok);
    for (let i = 0; i < 20; i++) {
      expect((await wrapped(req(), { RATE_LIMIT_KV })).status).toBe(200);
    }
  });

  test('exceeding the max returns 429 with a Retry-After', async () => {
    const { RATE_LIMIT_KV } = kv();
    const wrapped = publicReadLimited('t', ok);
    let last = new Response('');
    for (let i = 0; i <= PUBLIC_READ_MAX + 1; i++) {
      last = await wrapped(req(), { RATE_LIMIT_KV });
    }
    expect(last.status).toBe(429);
    expect(last.headers.get('Retry-After')).toBe('60');
  });

  test('the 429 is not cacheable — a cached 429 would lock a caller out', async () => {
    expect(publicReadLimitResponse().headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('buckets are separated so one endpoint cannot throttle another', () => {
  test('hammering the map does not limit the list', async () => {
    const { RATE_LIMIT_KV } = kv();
    const map = publicReadLimited('events-map', ok);
    for (let i = 0; i <= PUBLIC_READ_MAX + 1; i++) await map(req(), { RATE_LIMIT_KV });
    expect((await map(req(), { RATE_LIMIT_KV })).status).toBe(429);

    const list = publicReadLimited('events-list', ok);
    expect((await list(req(), { RATE_LIMIT_KV })).status).toBe(200);
  });

  test('one caller hitting the limit does not affect another', async () => {
    const { RATE_LIMIT_KV } = kv();
    const wrapped = publicReadLimited('t', ok);
    for (let i = 0; i <= PUBLIC_READ_MAX + 1; i++) {
      await wrapped(req('203.0.113.10'), { RATE_LIMIT_KV });
    }
    expect((await wrapped(req('203.0.113.10'), { RATE_LIMIT_KV })).status).toBe(429);
    expect((await wrapped(req('198.51.100.7'), { RATE_LIMIT_KV })).status).toBe(200);
  });
});

describe('it fails open, and that is the design', () => {
  test('no KV binding serves the request', async () => {
    expect((await publicReadLimited('t', ok)(req(), {})).status).toBe(200);
  });

  test('a throwing KV serves the request', async () => {
    const broken = {
      RATE_LIMIT_KV: {
        get: async () => {
          throw new Error('KV unavailable');
        },
        put: async () => {
          throw new Error('KV unavailable');
        },
      } as unknown as KVNamespace,
    };
    expect((await publicReadLimited('t', ok)(req(), broken)).status).toBe(200);
    expect(await isPublicReadLimited(req(), broken, 't')).toBe(false);
  });

  test('a request with no client address is served, not rejected', async () => {
    const { RATE_LIMIT_KV } = kv();
    const anon = new Request('https://t.test/api/v2/events');
    expect((await publicReadLimited('t', ok)(anon, { RATE_LIMIT_KV })).status).toBe(200);
  });
});

describe('the limiter does not become a place an address is kept', () => {
  test('the KV key holds only a count and a reset time — never the address', async () => {
    const k = kv();
    await publicReadLimited('t', ok)(req('203.0.113.10'), { RATE_LIMIT_KV: k.RATE_LIMIT_KV });
    const values = [...k.store.values()].join(' ');
    expect(values).not.toContain('203.0.113.10');
    const parsed = JSON.parse([...k.store.values()][0]!);
    expect(Object.keys(parsed).sort()).toEqual(['count', 'resetAt']);
  });

  test('the address appears only in the key, which expires with the window', async () => {
    // A bucket key is not a record: it is written to expire, holds no history,
    // and is never read for anything but a count. Asserted so a future change
    // that starts logging or persisting it has to break this test first.
    const k = kv();
    await publicReadLimited('t', ok)(req('203.0.113.10'), { RATE_LIMIT_KV: k.RATE_LIMIT_KV });
    expect([...k.store.keys()][0]).toContain('ratelimit:');
  });
});
