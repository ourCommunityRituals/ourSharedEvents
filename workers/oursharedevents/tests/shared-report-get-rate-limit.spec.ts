/**
 * Part of OSE-1421 — the single-event SharedReport read is rate-limited.
 *
 * `GET /api/v2/events/:id/shared-report` had no limiter (only the batch route
 * did). `poster_attribution` is a live join, so a signed-link holder could poll
 * and watch one poster's floored count tick, at roughly 150 m granularity:
 * presence, not identity, but unbounded (deduction route D3, temporal polling
 * delta).
 *
 * Owner ruling (2026-10-01): 60 requests per minute (RATE_LIMIT_MAX), keyed on
 * the signed-link token, falling back to the IP when there is no token. Applied
 * at the route, through the public-read wrapper, so an unlimited report read is
 * visibly unlimited when you read the router.
 *
 * Exercised through the real route (SELF.fetch) against the miniflare worker.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { mintSignedLinkToken } from '../src/lib/shared-report-auth';
import { RATE_LIMIT_MAX } from '../src/lib/rate-limit';

interface TestEnv {
  DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const SIGNING_SECRET = 'test-shared-report-signing-secret-do-not-use';
const EVENT = 'test-evt-rl-report';

// Keys that would make a payload person-shaped. A report is counts and labels.
const BANNED_KEY =
  /^(anon_id_hash|anonymous_id|anon_id|ip|ip_hash|user_agent|user_agent_hash|session|session_id|device|device_id|fingerprint|email|phone|lat|lon|latitude|longitude)$/i;
function bannedKeysIn(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => bannedKeysIn(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(BANNED_KEY.test(k) ? [`${path}.${k}`] : []),
      ...bannedKeysIn(v, `${path}.${k}`),
    ]);
  }
  return [];
}

async function applyMigrations(): Promise<void> {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

// Tokens are deterministic per (event, role, expiry second); a distinct ttl gives a
// distinct token, so each test below owns its own bucket regardless of timing.
async function mint(role: 'bar_owner' | 'admin', ttlSeconds = 3600): Promise<string> {
  const t = await mintSignedLinkToken(
    { SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET },
    EVENT,
    role,
    ttlSeconds
  );
  if (!t) throw new Error('mint returned null');
  return t;
}

const read = (token?: string) =>
  SELF.fetch(`https://test.local/api/v2/events/${EVENT}/shared-report`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

beforeAll(async () => {
  await applyMigrations();
  await tenv().DB.prepare(`DELETE FROM events WHERE id = ?`).bind(EVENT).run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
       VALUES (?, 'test-brand', 'Rate Limit Night', ?, 'active', 'Test Venue', '2026-05-07T19:00:00Z',
               datetime('now'), datetime('now'))`
    )
    .bind(EVENT, EVENT)
    .run();
});

describe('GET /api/v2/events/:id/shared-report is limited to RATE_LIMIT_MAX per minute', () => {
  test('the limit is the ruled 60 per minute', () => {
    expect(RATE_LIMIT_MAX).toBe(60);
  });

  test('requests 1..60 with one token are served; the 61st is a 429 with Retry-After', async () => {
    const token = await mint('bar_owner', 3600);
    for (let i = 1; i <= RATE_LIMIT_MAX; i++) {
      const res = await read(token);
      expect(res.status, `request ${i}`).toBe(200);
      await res.text();
    }
    const limited = await read(token);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(limited.headers.get('Cache-Control')).toBe('no-store');
    const body = (await limited.json()) as Record<string, unknown>;
    expect(body.code).toBe('RATE_LIMITED');
    // A refusal carries no report data.
    expect(body).not.toHaveProperty('report');
    expect(bannedKeysIn(body)).toEqual([]);
  });

  test('the bucket is the token, not the address: a second token from the same address is served', async () => {
    // Storage is isolated per test, so spend this bucket here.
    const spent = await mint('bar_owner', 3602);
    for (let i = 1; i <= RATE_LIMIT_MAX; i++) await (await read(spent)).text();
    expect((await read(spent)).status).toBe(429);

    const other = await mint('admin', 3600);
    const res = await read(other);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { report: unknown };
    expect(bannedKeysIn(body.report)).toEqual([]);
  });

  test('with no token the address is the bucket: the 61st tokenless request is a 429', async () => {
    let last = 0;
    for (let i = 1; i <= RATE_LIMIT_MAX + 1; i++) {
      const res = await read();
      last = res.status;
      await res.text();
      if (i <= RATE_LIMIT_MAX) expect(last, `request ${i}`).toBe(401);
    }
    expect(last).toBe(429);
  });

  test('the limiter keeps no token and no address: KV keys are hashed, values are counts', async () => {
    const token = await mint('bar_owner', 3601);
    await (await read(token)).text();

    const listed = await tenv().RATE_LIMIT_KV.list({ prefix: 'ratelimit:' });
    expect(listed.keys.length).toBeGreaterThan(0);
    for (const k of listed.keys) {
      expect(k.name).not.toContain(token);
      expect(k.name).not.toContain(token.split('.')[0]!);
      const value = await tenv().RATE_LIMIT_KV.get(k.name);
      expect(value, k.name).not.toBeNull();
      expect(Object.keys(JSON.parse(value!)).sort()).toEqual(['count', 'max', 'resetAt']);
    }
  });
});
