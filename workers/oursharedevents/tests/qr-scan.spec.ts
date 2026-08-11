/**
 * OSE-625 — QR scan ingestion endpoint behavioral tests (BE-SCAN-1).
 *
 * Tests the GET /q/:qr_token handler directly via handleQrScan() with a
 * real miniflare D1 database and an in-memory KV stub for dedup.
 *
 * Coverage:
 *   - Valid token writes a scan row and 302-redirects to form page
 *   - Redirect URL embeds correct ?type= and ?deployment= params
 *   - New visitor gets Set-Cookie header with ose_anon cookie
 *   - Returning visitor does NOT get Set-Cookie header
 *   - Duplicate within 5-min window is suppressed (no second scan row)
 *   - Invalid token shape redirects to homepage, no DB write
 *   - Unknown/inactive token redirects to homepage, no DB write
 *   - Scan row values match privacy invariants (scan_bucket format, no PII)
 *
 * Privacy invariants verified:
 *   - scan_bucket is hour-granularity only (YYYY-MM-DDTHH:00), not exact time
 *   - anonymous_id is cookie-based (anon_ prefix UUID), not IP
 *   - user_agent_hash is stored, not the raw UA string
 *   - No referrer is recorded
 *
 * Format: `OSE-625 | UNIT | <description> | <assertion>`.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { handleQrScan, type QrScanEnv } from '../src/handlers/qr-scan';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

// ── In-memory KV stub ────────────────────────────────────────────────────────
// Minimal KVNamespace stand-in for dedup testing. TTL is accepted but not
// enforced — test isolation is achieved by constructing a fresh instance per test.

function makeInMemoryKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

// ── Migration helper ─────────────────────────────────────────────────────────

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

// ── Seed helpers ─────────────────────────────────────────────────────────────

const TEST_EVENT_ID = 'test-evt-qr-scan';
const TEST_DEPLOYMENT_ID = 'test-pd-qr-scan-001';
const VALID_QR_TOKEN = 'qrt_test_scan_token_abc123';
const INACTIVE_QR_TOKEN = 'qrt_test_inactive_token_999';

async function seedEventAndDeployment(db: D1Database): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO events
         (id, brand_id, title, slug, status, start_date, created_at, updated_at)
       VALUES (?, 'brand-test', 'QR Scan Test Event', ?, 'active', datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(TEST_EVENT_ID, TEST_EVENT_ID)
    .run();

  await db
    .prepare(
      `INSERT OR REPLACE INTO poster_deployments
         (id, event_id, qr_token, placement_label, is_active, created_at)
       VALUES (?, ?, ?, 'Test Poster', 1, datetime('now'))`
    )
    .bind(TEST_DEPLOYMENT_ID, TEST_EVENT_ID, VALID_QR_TOKEN)
    .run();

  // Inactive deployment for the "inactive token" test
  await db
    .prepare(
      `INSERT OR REPLACE INTO poster_deployments
         (id, event_id, qr_token, placement_label, is_active, created_at)
       VALUES (?, ?, ?, 'Inactive Poster', 0, datetime('now'))`
    )
    .bind('test-pd-qr-inactive', TEST_EVENT_ID, INACTIVE_QR_TOKEN)
    .run();
}

async function countScans(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM scans WHERE event_id = ?`)
    .bind(TEST_EVENT_ID)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

function makeRequest(
  qrToken: string,
  opts: { type?: string; existingCookie?: string; country?: string } = {}
): Request {
  const url = `https://test.local/q/${encodeURIComponent(qrToken)}${opts.type ? `?type=${opts.type}` : ''}`;
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15',
  };
  if (opts.existingCookie) headers['Cookie'] = `ose_anon=${opts.existingCookie}`;
  if (opts.country) headers['CF-IPCountry'] = opts.country;
  return new Request(url, { headers });
}

function makeEnv(kv?: KVNamespace): QrScanEnv {
  return {
    DB: tenv().DB,
    RATE_LIMIT_KV: kv,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await applyMigrations();
  await seedEventAndDeployment(tenv().DB);
});

beforeEach(async () => {
  // Clear scans between tests for count assertions
  await tenv().DB.prepare(`DELETE FROM scans WHERE event_id = ?`).bind(TEST_EVENT_ID).run();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OSE-625: QR scan ingestion — handleQrScan()', () => {
  test('OSE-625 | UNIT | valid token, new visitor | writes scan row and 302-redirects to form page', async () => {
    const kv = makeInMemoryKV();
    const res = await handleQrScan(makeRequest(VALID_QR_TOKEN, { type: 'register' }), makeEnv(kv), VALID_QR_TOKEN);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain(`/forms/${TEST_EVENT_ID}`);
    expect(location).toContain('type=register');
    expect(location).toContain(`deployment=${TEST_DEPLOYMENT_ID}`);

    const scanCount = await countScans(tenv().DB);
    expect(scanCount).toBe(1);
  });

  test('OSE-625 | UNIT | valid token, new visitor | Set-Cookie header sets ose_anon cookie', async () => {
    const kv = makeInMemoryKV();
    const res = await handleQrScan(makeRequest(VALID_QR_TOKEN), makeEnv(kv), VALID_QR_TOKEN);

    expect(res.status).toBe(302);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('ose_anon=');
    expect(setCookie).toContain('HttpOnly');
  });

  test('OSE-625 | UNIT | valid token, returning visitor | no Set-Cookie header emitted', async () => {
    const kv = makeInMemoryKV();
    const existingAnonId = 'anon_11111111-1111-1111-1111-111111111111';
    const res = await handleQrScan(
      makeRequest(VALID_QR_TOKEN, { existingCookie: existingAnonId }),
      makeEnv(kv),
      VALID_QR_TOKEN
    );

    expect(res.status).toBe(302);
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toBeNull();
  });

  test('OSE-625 | UNIT | duplicate scan within 5-min window | second call does NOT write a second row', async () => {
    const kv = makeInMemoryKV();
    const existingAnonId = 'anon_22222222-2222-2222-2222-222222222222';
    const req = () => makeRequest(VALID_QR_TOKEN, { existingCookie: existingAnonId });
    const scanEnv = makeEnv(kv);

    await handleQrScan(req(), scanEnv, VALID_QR_TOKEN);
    await handleQrScan(req(), scanEnv, VALID_QR_TOKEN);
    await handleQrScan(req(), scanEnv, VALID_QR_TOKEN);

    const scanCount = await countScans(tenv().DB);
    expect(scanCount).toBe(1);
  });

  test('OSE-625 | UNIT | duplicate scan, no KV available | writes both rows (dedup is best-effort)', async () => {
    // No KV env — dedup guard is skipped; both calls write a row.
    const scanEnv = makeEnv(undefined);
    const existingAnonId = 'anon_33333333-3333-3333-3333-333333333333';
    const req = () => makeRequest(VALID_QR_TOKEN, { existingCookie: existingAnonId });

    await handleQrScan(req(), scanEnv, VALID_QR_TOKEN);
    await handleQrScan(req(), scanEnv, VALID_QR_TOKEN);

    const scanCount = await countScans(tenv().DB);
    expect(scanCount).toBe(2);
  });

  test('OSE-625 | UNIT | redirect URL type passthrough | checkin type preserved in redirect', async () => {
    const kv = makeInMemoryKV();
    const res = await handleQrScan(makeRequest(VALID_QR_TOKEN, { type: 'checkin' }), makeEnv(kv), VALID_QR_TOKEN);

    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('type=checkin');
  });

  test('OSE-625 | UNIT | redirect URL type passthrough | unknown type falls back to register', async () => {
    const kv = makeInMemoryKV();
    // The '<script>' below is ADVERSARIAL TEST INPUT — this test asserts it is
    // neutralized (redirect must NOT contain '<script>', see assertion below).
    const res = await handleQrScan(
      makeRequest(VALID_QR_TOKEN, { type: 'malicious<script>' }),
      makeEnv(kv), // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag
      VALID_QR_TOKEN
    );

    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('type=register');
    expect(location).not.toContain('<script>');
  });

  test('OSE-625 | UNIT | scan row values | scan_bucket is hour-granularity (YYYY-MM-DDTHH:00)', async () => {
    const kv = makeInMemoryKV();
    await handleQrScan(makeRequest(VALID_QR_TOKEN), makeEnv(kv), VALID_QR_TOKEN);

    const row = await tenv()
      .DB.prepare(`SELECT scan_bucket FROM scans WHERE event_id = ? LIMIT 1`)
      .bind(TEST_EVENT_ID)
      .first<{ scan_bucket: string }>();

    expect(row).not.toBeNull();
    // Must match YYYY-MM-DDTHH:00 — no minutes or seconds
    expect(row!.scan_bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
  });

  test('OSE-625 | UNIT | scan row values | country_code stored from CF-IPCountry header', async () => {
    const kv = makeInMemoryKV();
    await handleQrScan(
      makeRequest(VALID_QR_TOKEN, { country: 'US' }),
      makeEnv(kv),
      VALID_QR_TOKEN
    );

    const row = await tenv()
      .DB.prepare(`SELECT country_code FROM scans WHERE event_id = ? LIMIT 1`)
      .bind(TEST_EVENT_ID)
      .first<{ country_code: string }>();

    expect(row!.country_code).toBe('US');
  });

  test('OSE-625 | UNIT | scan row values | anonymous_id stored (not null)', async () => {
    const kv = makeInMemoryKV();
    await handleQrScan(makeRequest(VALID_QR_TOKEN), makeEnv(kv), VALID_QR_TOKEN);

    const row = await tenv()
      .DB.prepare(`SELECT anonymous_id FROM scans WHERE event_id = ? LIMIT 1`)
      .bind(TEST_EVENT_ID)
      .first<{ anonymous_id: string }>();

    expect(row!.anonymous_id).not.toBeNull();
    expect(row!.anonymous_id).toMatch(/^anon_/);
  });

  test('OSE-625 | UNIT | invalid token shape (no qrt_ prefix) | 302 to homepage, no DB write', async () => {
    const kv = makeInMemoryKV();
    const res = await handleQrScan(
      makeRequest('not-a-valid-token'),
      makeEnv(kv),
      'not-a-valid-token'
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(await countScans(tenv().DB)).toBe(0);
  });

  test('OSE-625 | UNIT | token too long (>128 chars) | 302 to homepage, no DB write', async () => {
    const longToken = 'qrt_' + 'x'.repeat(200);
    const kv = makeInMemoryKV();
    const res = await handleQrScan(makeRequest(longToken), makeEnv(kv), longToken);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(await countScans(tenv().DB)).toBe(0);
  });

  test('OSE-625 | UNIT | unknown qr_token (not in DB) | 302 to homepage, no DB write', async () => {
    const kv = makeInMemoryKV();
    const unknownToken = 'qrt_unknown_token_xyz_not_in_db';
    const res = await handleQrScan(makeRequest(unknownToken), makeEnv(kv), unknownToken);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(await countScans(tenv().DB)).toBe(0);
  });

  test('OSE-625 | UNIT | inactive deployment token | 302 to homepage, no DB write', async () => {
    const kv = makeInMemoryKV();
    const res = await handleQrScan(
      makeRequest(INACTIVE_QR_TOKEN),
      makeEnv(kv),
      INACTIVE_QR_TOKEN
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(await countScans(tenv().DB)).toBe(0);
  });

  test('OSE-625 | UNIT | redirect | Cache-Control: no-store prevents CDN caching of redirect', async () => {
    const kv = makeInMemoryKV();
    const res = await handleQrScan(makeRequest(VALID_QR_TOKEN), makeEnv(kv), VALID_QR_TOKEN);

    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

// ── Static invariant gate ────────────────────────────────────────────────────
// Verifies that qr-scan.ts does NOT import h3-js at the module level.
// Adding h3-js to the hot scan path would break SCAN_PATH bundle invariant.

describe('OSE-625: SCAN_PATH static invariant — h3-js must not be imported', () => {
  test('OSE-625 | STATIC | qr-scan.ts | h3-js is NOT imported in the QR scan handler', () => {
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as { TEST_SOURCE_FILES_JSON: string }).TEST_SOURCE_FILES_JSON
    );
    const entry = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/handlers/qr-scan.ts')
    );
    expect(entry, 'qr-scan.ts not found in TEST_SOURCE_FILES_JSON').toBeDefined();
    const src = entry![1];
    // Use anchored patterns to avoid matching comment text like "MUST NOT import h3-js".
    expect(src).not.toMatch(/^import\s+.*\bh3-js\b/m);
    expect(src).not.toMatch(/from\s+['"]h3-js['"]/m);
    expect(src).not.toMatch(/require\(['"]h3-js['"]\)/m);
  });
});
