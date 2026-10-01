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

import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkRateLimit,
  isRateLimited,
  rateLimitKvKey,
  pepperedKeyHash,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_PEPPER_MIN_LENGTH,
} from '../src/lib/rate-limit';

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
    keys: () => [...store.keys()],
  } as unknown as KVNamespace & { keys(): string[] };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (k: string, s: string) => createHmac('sha256', k).update(s).digest('hex');

describe('rate-limit KV key — peppered (OSE-1447)', () => {
  it('with a pepper, the stored key is HMAC-SHA256 under it, not bare SHA-256', async () => {
    const kv = fakeKv();
    await isRateLimited('203.0.113.7', kv, PEPPER);
    expect(kv.keys()).toEqual([`ratelimit:${hmac(PEPPER, '203.0.113.7')}`]);
    expect(kv.keys()).not.toContain(`ratelimit:${sha256('203.0.113.7')}`);
  });

  it('a stored key does not reverse to the IP by enumerating SHA-256 over candidates', async () => {
    const kv = fakeKv();
    const victim = '198.51.100.42';
    await isRateLimited(victim, kv, PEPPER);
    const [stored] = kv.keys();
    // The attacker's offline search over the /24 (the real search is all of IPv4).
    const hit = Array.from({ length: 256 }, (_, i) => `198.51.100.${i}`).find(
      (ip) => `ratelimit:${sha256(ip)}` === stored
    );
    expect(hit).toBeUndefined();
  });

  it('without a pepper the old SHA-256 key is kept, so rate limiting never breaks', async () => {
    expect(await rateLimitKvKey('203.0.113.7')).toBe(`ratelimit:${sha256('203.0.113.7')}`);
    // Too short counts as unset, like the other hash peppers.
    expect(await rateLimitKvKey('203.0.113.7', 'short')).toBe(`ratelimit:${sha256('203.0.113.7')}`);
  });

  it('bucket semantics hold under a pepper: the request after the limit is refused', async () => {
    const kv = fakeKv();
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(await isRateLimited('192.0.2.1', kv, PEPPER)).toBe(false);
    }
    expect(await isRateLimited('192.0.2.1', kv, PEPPER)).toBe(true);
    // Another IP still has its own bucket.
    expect(await isRateLimited('192.0.2.2', kv, PEPPER)).toBe(false);
  });

  it('rotating the pepper moves every caller to a fresh bucket (rotation is free)', async () => {
    const kv = fakeKv();
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) {
      await checkRateLimit('admin:x', kv, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, PEPPER);
    }
    expect(
      await checkRateLimit('admin:x', kv, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, OTHER_PEPPER)
    ).toBe(false);
  });

  it('pepperedKeyHash (beacon dedup key) uses the same HMAC', async () => {
    expect(await pepperedKeyHash('1.2.3.4|e|s', PEPPER)).toBe(hmac(PEPPER, '1.2.3.4|e|s'));
  });
});

// Every production call site must hand the pepper through. A site that forgets
// it silently falls back to the reversible SHA-256 key, and nothing else fails.
describe('rate-limit KV key — every src call site passes RATE_LIMIT_KEY_PEPPER', () => {
  const root = join(__dirname, '..');
  const CALL = /\b(checkRateLimit|isRateLimited|isDuplicateBeacon|pepperedKeyHash)\(/g;
  const IMPORTS_RATE_LIMIT = /from\s+['"](?:\.{1,2}\/)+(?:lib\/)?rate-limit['"]/;

  // Derived, not listed: every src file that imports the KV rate limiter. A new
  // caller anywhere in src/ is covered without editing this spec.
  function walk(dir: string): string[] {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return walk(rel);
      return /\.ts$/.test(e.name) ? [rel] : [];
    });
  }
  const files = walk('src').filter(
    (rel) =>
      rel !== 'src/lib/rate-limit.ts' &&
      IMPORTS_RATE_LIMIT.test(readFileSync(join(root, rel), 'utf8'))
  );

  it('finds the known callers (the scan is not empty)', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'src/router.ts',
        'src/handlers/shared-report-read.ts',
        'src/lib/public-read-limit.ts',
        'src/lib/invalid-traffic.ts',
      ])
    );
  });

  it('each call in every importing file carries env.RATE_LIMIT_KEY_PEPPER', () => {
    for (const file of files) {
      const src = readFileSync(join(root, file), 'utf8');
      const calls = [...src.matchAll(CALL)].filter((m) => {
        // Skip declarations (`function isDuplicateBeacon(`).
        const before = src.slice(Math.max(0, m.index! - 15), m.index!);
        return !/function\s+$/.test(before);
      });
      for (const m of calls) {
        // The argument list: up to the matching close paren.
        let depth = 0;
        let end = m.index! + m[0].length - 1;
        for (; end < src.length; end++) {
          if (src[end] === '(') depth++;
          else if (src[end] === ')' && --depth === 0) break;
        }
        const args = src.slice(m.index!, end + 1);
        expect(args, `${file}: ${args}`).toMatch(/RATE_LIMIT_KEY_PEPPER|\bpepper\b/);
      }
    }
  });
});
