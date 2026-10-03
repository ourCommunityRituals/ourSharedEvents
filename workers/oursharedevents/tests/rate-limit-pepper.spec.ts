/**
 * OSE-1447 follow-up — rate-limit KV keys are peppered.
 *
 * Before: the KV key was `ratelimit:` + SHA-256(key), and the key embeds the
 * client IP. IPv4 is 2^32 values, so anyone who can read a stored key (the
 * platform `GET /security/rate-limit-stats` hands them out) can reverse it to
 * the IP offline. With RATE_LIMIT_KEY_PEPPER set, the key is HMAC-SHA256 under
 * that secret and the same enumeration finds nothing.
 *
 * Node project: pure module + an in-memory KV fake + source reads (no runtime).
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkRateLimit,
  isRateLimited,
  isBucketTripped,
  parseRateLimitEntry,
  scanRateLimitBuckets,
  pepperedKeyHash,
  rateLimitKvKey,
  RATE_LIMIT_MAX,
  RATE_LIMIT_PEPPER_MIN_LENGTH,
} from '../src/lib/rate-limit';
import { classifyBeacon } from '../src/lib/invalid-traffic';

const PEPPER = 'p'.repeat(RATE_LIMIT_PEPPER_MIN_LENGTH);
const OTHER_PEPPER = 'q'.repeat(RATE_LIMIT_PEPPER_MIN_LENGTH);

function fakeKv(): KVNamespace & { keys(): string[] } {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
    delete: async (k: string) => {
      store.delete(k);
    },
    list: async ({ prefix = '' }: { prefix?: string } = {}) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
    keys: () => [...store.keys()],
  } as unknown as KVNamespace & { keys(): string[] };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (k: string, s: string) => createHmac('sha256', k).update(s).digest('hex');

describe('rate-limit KV key — peppered (OSE-1447)', () => {
  it('stores HMAC-SHA256 under the pepper, which a SHA-256 enumeration cannot reverse', async () => {
    const kv = fakeKv();
    const victim = '198.51.100.42';
    await isRateLimited({ RATE_LIMIT_KV: kv, RATE_LIMIT_KEY_PEPPER: PEPPER }, victim);
    const [stored] = kv.keys();
    expect(stored).toBe(`ratelimit:${hmac(PEPPER, victim)}`);
    // The attacker's offline search over the /24 (the real search is all of IPv4).
    const hit = Array.from({ length: 256 }, (_, i) => `198.51.100.${i}`).find(
      (ip) => `ratelimit:${sha256(ip)}` === stored
    );
    expect(hit).toBeUndefined();
  });

  it('without a usable pepper the old SHA-256 key is kept, so rate limiting never breaks', async () => {
    expect(await rateLimitKvKey('203.0.113.7')).toBe(`ratelimit:${sha256('203.0.113.7')}`);
    expect(await rateLimitKvKey('203.0.113.7', 'short')).toBe(`ratelimit:${sha256('203.0.113.7')}`);
  });

  it('bucket semantics hold under a pepper: the request after the limit is refused', async () => {
    const env = { RATE_LIMIT_KV: fakeKv(), RATE_LIMIT_KEY_PEPPER: PEPPER };
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(await isRateLimited(env, '192.0.2.1')).toBe(false);
    }
    expect(await isRateLimited(env, '192.0.2.1')).toBe(true);
    expect(await isRateLimited(env, '192.0.2.2')).toBe(false);
  });

  it('rotating the pepper moves every caller to a fresh bucket (rotation is free)', async () => {
    const kv = fakeKv();
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) {
      await checkRateLimit({ RATE_LIMIT_KV: kv, RATE_LIMIT_KEY_PEPPER: PEPPER }, 'admin:x');
    }
    expect(
      await checkRateLimit({ RATE_LIMIT_KV: kv, RATE_LIMIT_KEY_PEPPER: OTHER_PEPPER }, 'admin:x')
    ).toBe(false);
  });

  it('beacon dedup keys are peppered too, and still catch the repeat', async () => {
    const kv = fakeKv();
    const env = { RATE_LIMIT_KV: kv, RATE_LIMIT_KEY_PEPPER: PEPPER };
    const ip = '198.51.100.42';
    const req = () =>
      new Request('https://t.test/b', {
        headers: { 'CF-Connecting-IP': ip, 'User-Agent': 'Mozilla/5.0' },
      });
    const beacon = {
      eventId: 'e1',
      sponsorId: 's1',
      surface: 'public',
      placement: 'top',
      kind: 'impression',
    };
    expect(await classifyBeacon(req(), env, beacon)).toEqual({ counted: true });
    expect(await classifyBeacon(req(), env, beacon)).toEqual({
      counted: false,
      reason: 'duplicate',
    });
    const identity = [ip, 'e1', 's1', 'public', 'top', 'impression'].join('|');
    expect(kv.keys()).toContain(`ivt:dedup:${hmac(PEPPER, identity)}`);
    expect(kv.keys()).not.toContain(`ivt:dedup:${sha256(identity)}`);
  });

  it('fails open with no KV bound', async () => {
    expect(await checkRateLimit({}, 'any', 0)).toBe(false);
  });

  it('a failed HMAC key import is not cached: the next call retries', async () => {
    const pepper = 'r'.repeat(RATE_LIMIT_PEPPER_MIN_LENGTH);
    const spy = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValueOnce(new Error('transient'));
    await expect(pepperedKeyHash('x', pepper)).rejects.toThrow('transient');
    expect(await pepperedKeyHash('x', pepper)).toBe(hmac(pepper, 'x'));
    spy.mockRestore();
  });
});

describe('rate-limit buckets are judged by their own limit', () => {
  it.each([
    [{ count: 11, max: 10 }, true],
    [{ count: 100, max: 120 }, false],
    [{ count: RATE_LIMIT_MAX + 1 }, true],
    [{ count: RATE_LIMIT_MAX }, false],
  ])('isBucketTripped(%o) is %s', (entry, tripped) => {
    expect(isBucketTripped({ resetAt: 0, ...entry })).toBe(tripped);
  });
});

describe('stored bucket values are validated before use', () => {
  it.each(['null', '[]', '7', '"x"', '{"count":"1","resetAt":0}', '{not json', ''])(
    'parseRateLimitEntry(%j) is null, so a bad value never reaches a scan',
    (raw) => {
      expect(parseRateLimitEntry(raw)).toBeNull();
    }
  );

  it('the shared scan yields live windows only, skipping expired and malformed values', async () => {
    const kv = fakeKv();
    const now = Date.now();
    await kv.put('ratelimit:live', JSON.stringify({ count: 99, resetAt: now + 30_000 }));
    await kv.put('ratelimit:expired', JSON.stringify({ count: 99, resetAt: now - 1 }));
    await kv.put('ratelimit:bad', 'null');
    const ids: string[] = [];
    for await (const { id } of scanRateLimitBuckets(kv)) ids.push(id);
    expect(ids).toEqual(['live']);
  });

  it('a malformed stored value is reset by the limiter, not thrown', async () => {
    const kv = fakeKv();
    const env = { RATE_LIMIT_KV: kv, RATE_LIMIT_KEY_PEPPER: PEPPER };
    await kv.put(await rateLimitKvKey('k', PEPPER), 'null');
    expect(await checkRateLimit(env, 'k')).toBe(false);
    expect(parseRateLimitEntry(await kv.get(await rateLimitKvKey('k', PEPPER)))).toMatchObject({
      count: 1,
    });
  });
});

// Structural: one rate limiter, used one way. A file outside lib/rate-limit.ts
// that builds its own store literal could leave the pepper out, and one that
// lists `ratelimit:` keys itself would bypass the shared scan and its rule.
describe('src uses the rate limiter through env and the shared scan', () => {
  const root = join(__dirname, '..');
  // readdirSync yields `lib\rate-limit.ts` on Windows; compare on forward slashes.
  const srcFiles = (readdirSync(join(root, 'src'), { recursive: true }) as string[])
    .map((rel) => rel.replace(/\\/g, '/'))
    .filter((rel) => rel.endsWith('.ts') && !rel.endsWith('lib/rate-limit.ts'))
    .map((rel) => [rel, readFileSync(join(root, 'src', rel), 'utf8')] as const);

  it('no src file builds a { RATE_LIMIT_KV: … } literal (callers pass env)', () => {
    for (const [rel, src] of srcFiles) {
      expect(src, rel).not.toMatch(/\{\s*RATE_LIMIT_KV\s*:\s*(?!KVNamespace)/);
    }
  });

  it('no src file lists ratelimit: keys itself (scanRateLimitBuckets does)', () => {
    for (const [rel, src] of srcFiles) {
      expect(src, rel).not.toMatch(/prefix:\s*'ratelimit:'/);
    }
  });
});
