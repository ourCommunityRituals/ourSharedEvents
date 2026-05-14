/**
 * OSE-240 / BE-25 — Shortlinks lib + handler end-to-end coverage.
 *
 * Unit (L1):
 *   - generateCode: base62, 6-char, never repeats inside a single call
 *   - isValidCodeShape: accept-list of base62 / reject everything else
 *
 * Behavioral (L2):
 *   - POST /api/v2/admin/events response carries `shortcode`
 *   - GET /s/:code 302-redirects to /api/v2/events/:id
 *   - GET /s/:code increments clicks counter + stamps last_clicked_at
 *   - GET /s/<malformed> returns 404 (probing reveals nothing)
 *   - GET /s/<unknown valid-shape> returns 404 (same shape as malformed)
 *   - Anonymity-principle compliance: shortlinks table has NO column
 *     that could carry per-attendee identity (counter + timestamp only).
 *
 * Static (L1 source-scan):
 *   - handlers/shortlink-resolve.ts never reads IP / Cookie / Referer
 *     from the request (anonymity-principle gate).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  generateCode,
  isValidCodeShape,
  createShortlink,
  resolveCode,
  incrementClick,
} from '../src/lib/shortlinks';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose240-test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

interface CreateEventResponse {
  ok: boolean;
  status?: number;
  id?: string;
  slug?: string;
  shortcode?: string | null;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
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

beforeAll(async () => {
  await applyMigrations();
  // Clean slate for this brand so re-runs are deterministic.
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
});

describe('OSE-240: generateCode', () => {
  test('produces a 6-character base62 string', () => {
    const code = generateCode();
    expect(code).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(code.length).toBe(6);
  });

  test('produces high entropy (1000 codes, near-zero collisions)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      set.add(generateCode());
    }
    // 62^6 = 56.8 billion; 1000 draws should have 0 collisions with
    // overwhelming probability. Allow 1 collision as a flake guard.
    expect(set.size).toBeGreaterThanOrEqual(999);
  });
});

describe('OSE-240: isValidCodeShape', () => {
  test('accepts valid base62 6-char strings', () => {
    expect(isValidCodeShape('abc123')).toBe(true);
    expect(isValidCodeShape('AbCdEf')).toBe(true);
    expect(isValidCodeShape('Z9z0Aa')).toBe(true);
  });

  test('rejects wrong-length strings', () => {
    expect(isValidCodeShape('')).toBe(false);
    expect(isValidCodeShape('abc')).toBe(false);
    expect(isValidCodeShape('abcdefg')).toBe(false);
  });

  test('rejects non-base62 characters', () => {
    expect(isValidCodeShape('abc-12')).toBe(false);
    expect(isValidCodeShape('abc 12')).toBe(false);
    expect(isValidCodeShape('abc.12')).toBe(false);
    expect(isValidCodeShape('abc/12')).toBe(false);
  });

  test('rejects non-string inputs gracefully', () => {
    // @ts-expect-error testing runtime safety
    expect(isValidCodeShape(undefined)).toBe(false);
    // @ts-expect-error testing runtime safety
    expect(isValidCodeShape(null)).toBe(false);
    // @ts-expect-error testing runtime safety
    expect(isValidCodeShape(123456)).toBe(false);
  });
});

describe('OSE-240: createShortlink + resolveCode lib round-trip', () => {
  test('creates a shortlink for an event and resolves it back', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose240_lib_${Date.now()}`;
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(eventId, BRAND, 'Lib roundtrip', 'lib-roundtrip', 'active')
      .run();

    const { code } = await createShortlink(tenv, eventId);
    expect(isValidCodeShape(code)).toBe(true);

    const resolved = await resolveCode(tenv, code);
    expect(resolved).not.toBeNull();
    expect(resolved!.event_id).toBe(eventId);
    expect(resolved!.code).toBe(code);
  });

  test('resolveCode returns null for unknown but valid-shape codes', async () => {
    const tenv = env as unknown as TestEnv;
    const result = await resolveCode(tenv, 'ZzZzZz');
    expect(result).toBeNull();
  });

  test('resolveCode returns null for malformed codes (DB never hit)', async () => {
    const tenv = env as unknown as TestEnv;
    expect(await resolveCode(tenv, '')).toBeNull();
    expect(await resolveCode(tenv, 'abc-12')).toBeNull();
    expect(await resolveCode(tenv, 'too-long-code')).toBeNull();
  });

  test('incrementClick raises the counter + stamps last_clicked_at', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose240_click_${Date.now()}`;
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(eventId, BRAND, 'Click counter', 'click-counter', 'active')
      .run();
    const { code } = await createShortlink(tenv, eventId);

    const afterFirst = await incrementClick(tenv, code);
    expect(afterFirst).toBe(1);
    const afterSecond = await incrementClick(tenv, code);
    expect(afterSecond).toBe(2);

    const row = await tenv.DB.prepare(`SELECT last_clicked_at FROM shortlinks WHERE code = ?`)
      .bind(code)
      .first<{ last_clicked_at: string }>();
    expect(row?.last_clicked_at).toBeTruthy();
  });
});

describe('OSE-240: POST /api/v2/admin/events returns shortcode', () => {
  test('newly-created event response carries a base62 shortcode', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ title: 'OSE-240 e2e create', brand_id: BRAND }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateEventResponse;
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^evt_/);
    expect(typeof body.shortcode).toBe('string');
    expect(isValidCodeShape(body.shortcode as string)).toBe(true);
  });
});

describe('OSE-240: GET /s/:code redirect + click counter', () => {
  test('valid code -> 302 redirect to /api/v2/events/:id', async () => {
    // Create an event so we have a code to resolve.
    const create = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ title: 'OSE-240 redirect target', brand_id: BRAND }),
    });
    const created = (await create.json()) as CreateEventResponse;
    expect(created.shortcode).toBeTruthy();

    const res = await SELF.fetch(`https://t.test/s/${created.shortcode}`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    expect(location).toContain(`/api/v2/events/${created.id}`);
    // Cache-Control: no-store prevents intermediaries from masking click signals.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('redirect increments the click counter exactly once per hit', async () => {
    const create = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ title: 'OSE-240 counter test', brand_id: BRAND }),
    });
    const created = (await create.json()) as CreateEventResponse;
    const code = created.shortcode as string;

    // Three redirects → three increments
    for (let i = 0; i < 3; i++) {
      const res = await SELF.fetch(`https://t.test/s/${code}`, { redirect: 'manual' });
      expect(res.status).toBe(302);
    }

    const tenv = env as unknown as TestEnv;
    const row = await tenv.DB.prepare(`SELECT clicks FROM shortlinks WHERE code = ?`)
      .bind(code)
      .first<{ clicks: number }>();
    expect(row?.clicks).toBe(3);
  });

  test('malformed code -> 404 (probing reveals nothing)', async () => {
    const res = await SELF.fetch('https://t.test/s/<<<malformed>>>', { redirect: 'manual' });
    expect(res.status).toBe(404);
  });

  test('unknown valid-shape code -> 404 (same 404 as malformed)', async () => {
    const res = await SELF.fetch('https://t.test/s/ZzZzZz', { redirect: 'manual' });
    expect(res.status).toBe(404);
  });
});

describe('OSE-240: anonymity-principle compliance', () => {
  test('shortlinks table schema has NO column that could carry per-attendee identity', async () => {
    const tenv = env as unknown as TestEnv;
    const info = await tenv.DB.prepare(`PRAGMA table_info('shortlinks')`).all<{ name: string }>();
    const cols = (info.results ?? []).map((r) => r.name);
    expect(cols).toEqual(['code', 'event_id', 'created_at', 'clicks', 'last_clicked_at']);

    // Sanity: every forbidden PII-bearing column name from the
    // pii-invariant gate MUST be absent from the new table.
    const forbidden = [
      'ip_address',
      'ip_addr',
      'client_ip',
      'remote_ip',
      'remote_addr',
      'x_forwarded_for',
      'cf_connecting_ip',
      'user_ip',
      'anonymous_id',
      'session_id',
      'cookie',
      'user_agent',
      'referer',
      'email',
      'email_hash',
    ];
    for (const f of forbidden) {
      expect(cols, `shortlinks has forbidden PII column '${f}'`).not.toContain(f);
    }
  });

  test('handlers/shortlink-resolve.ts source has zero per-attendee identity reads', () => {
    // Static-source check: the resolve handler MUST NOT read IP, anon_id,
    // session cookie, or Referer. If a future refactor adds any of those,
    // this gate fails before the change can land.
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
    );
    const entry = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/handlers/shortlink-resolve.ts')
    );
    expect(entry, 'shortlink-resolve.ts source not in TEST_SOURCE_FILES_JSON').toBeDefined();
    const src = entry![1];

    const forbiddenReads = [
      /\bCf-Connecting-Ip\b/i,
      /\bX-Forwarded-For\b/i,
      /\brequest\.headers\.get\(['"]?[Cc]ookie['"]?\)/,
      /\bgetOrCreateAnonId\b/, // public anon_id helper
      /\bsetAnonCookie\b/,
      /\brequest\.headers\.get\(['"]?[Rr]eferer['"]?\)/,
    ];
    const violations: string[] = [];
    for (const pattern of forbiddenReads) {
      if (pattern.test(src)) violations.push(pattern.source);
    }
    expect(
      violations,
      `shortlink-resolve.ts reads per-attendee identity (violates OSE anonymity principle): ${violations.join(', ')}`
    ).toEqual([]);
  });
});
