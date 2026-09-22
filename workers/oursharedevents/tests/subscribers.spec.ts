/**
 * OSE-207 / BE-17 — Subscribers PII guardrails
 *
 * Acceptance criteria from the Co-Architect AC amendment (2026-04-25):
 *   - subscribers.ip_address column does NOT exist
 *   - subscribers.ip_hash column DOES exist
 *   - ip_hash is populated as 32 hex chars (or NULL if pepper missing)
 *     and is NEVER an IPv4/IPv6 literal
 *   - Subscribe is idempotent (UNIQUE on email; duplicate returns 200)
 *   - Admin enumerate endpoint exists at GET /api/v2/admin/subscribers
 *     and writes an admin_audit_log entry per call
 *   - Data-subject erase deletes from subscribers (in addition to
 *     email_signups + form_registrations)
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { hashEmail, encryptText, decryptText } from '../src/lib/pii';

// Must match the workers test env in vitest.workers.config.mts so in-test
// hashes line up with what the subscribe handler writes.
const FORMS_HASH_PEPPER = 'test-forms-hash-pepper-do-not-use-in-prod';
const FORMS_ENCRYPTION_KEY = 'test-forms-encryption-secret-32ch';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  ADMIN_KEY: string;
}

const tenv = () => env as unknown as TestEnv;

/**
 * Seed a subscriber row in the A-5 shape (email_hash + email_encrypted). Mirrors
 * what handleSubscribe writes so seeded rows are indistinguishable from real
 * ones. `createdAt` is optional (defaults to the column default).
 */
async function seedSubscriber(email: string, ipHash: string, createdAt?: string): Promise<string> {
  const emailHash = await hashEmail(email, FORMS_HASH_PEPPER, { requirePepper: true });
  const emailEncrypted = await encryptText(email, FORMS_ENCRYPTION_KEY);
  if (createdAt) {
    await tenv()
      .DB.prepare(
        'INSERT OR IGNORE INTO subscribers (email_hash, email_encrypted, ip_hash, source, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(emailHash, emailEncrypted, ipHash, 'landing', createdAt)
      .run();
  } else {
    await tenv()
      .DB.prepare(
        'INSERT OR IGNORE INTO subscribers (email_hash, email_encrypted, ip_hash, source) VALUES (?, ?, ?, ?)'
      )
      .bind(emailHash, emailEncrypted, ipHash, 'landing')
      .run();
  }
  return emailHash;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup — apply both DBs' migrations once
// ─────────────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  const main: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of main) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      // After migration 0028 drops ip_address, replaying that ALTER on a
      // schema where it's already gone is OK to ignore.
      if (msg.includes('no such column')) continue;
      throw e;
    }
  }
  const forms: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of forms) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// L2 SCHEMA — PRAGMA-level assertions on the subscribers table
// ═════════════════════════════════════════════════════════════════════════════

describe('L2: subscribers schema after migration 0028', () => {
  test('ip_address column does NOT exist (raw IP banned)', async () => {
    const info = await tenv().DB.prepare('PRAGMA table_info(subscribers)').all();
    const cols = info.results.map((r) => (r as { name: string }).name);
    expect(cols).not.toContain('ip_address');
  });

  test('ip_hash column exists with TEXT affinity', async () => {
    const info = await tenv().DB.prepare('PRAGMA table_info(subscribers)').all<{
      name: string;
      type: string;
    }>();
    const col = info.results.find((r) => r.name === 'ip_hash');
    expect(col).toBeDefined();
    expect(col!.type.toUpperCase()).toContain('TEXT');
  });

  test('plaintext email column does NOT exist (A-5: encrypted at rest)', async () => {
    const info = await tenv().DB.prepare('PRAGMA table_info(subscribers)').all();
    const cols = info.results.map((r) => (r as { name: string }).name);
    expect(cols).not.toContain('email');
  });

  test('email_hash + email_encrypted columns exist (dedup key + read-back)', async () => {
    const info = await tenv().DB.prepare('PRAGMA table_info(subscribers)').all<{
      name: string;
    }>();
    const cols = info.results.map((r) => r.name);
    expect(cols).toContain('email_hash');
    expect(cols).toContain('email_encrypted');
  });

  test('email_hash carries the UNIQUE constraint for idempotent dedup', async () => {
    // migration 0071: UNIQUE moved from plaintext email → peppered email_hash.
    const idx = await tenv()
      .DB.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='subscribers'")
      .all<{ sql: string | null }>();
    const sqls = idx.results.map((r) => r.sql ?? '').join('\n');
    const tableDdl = await tenv()
      .DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='subscribers'")
      .first<{ sql: string }>();
    const allDdl = sqls + '\n' + (tableDdl?.sql ?? '');
    expect(allDdl.toUpperCase()).toContain('UNIQUE');
    expect(allDdl).toContain('email_hash');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L2 BEHAVIORAL — POST /subscribe end-to-end
// ═════════════════════════════════════════════════════════════════════════════

describe('L2 behavioral: POST /subscribe writes ip_hash, never raw IP', () => {
  test('subscribe with pepper configured → ip_hash is 32 hex chars', async () => {
    const email = `ipcheck-${Date.now()}@example.com`;
    const res = await SELF.fetch('https://test.local/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(JSON.stringify({ email }).length),
        'CF-Connecting-IP': '203.0.113.42', // RFC 5737 test address
      },
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(200);

    const emailHash = await hashEmail(email, FORMS_HASH_PEPPER, { requirePepper: true });
    const row = await tenv()
      .DB.prepare('SELECT ip_hash FROM subscribers WHERE email_hash = ?')
      .bind(emailHash)
      .first<{ ip_hash: string | null }>();

    expect(row).not.toBeNull();
    expect(row!.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    // Critical: must NOT be the raw IPv4 literal
    expect(row!.ip_hash).not.toBe('203.0.113.42');
    expect(row!.ip_hash).not.toContain('.');
    expect(row!.ip_hash).not.toContain(':');
  });

  test('idempotent: duplicate email → 200, single row remains', async () => {
    const email = `idem-${Date.now()}@example.com`;
    const payload = JSON.stringify({ email });

    const first = await SELF.fetch('https://test.local/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(payload.length),
        'CF-Connecting-IP': '198.51.100.7',
      },
      body: payload,
    });
    expect(first.status).toBe(200);

    const second = await SELF.fetch('https://test.local/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(payload.length),
        'CF-Connecting-IP': '198.51.100.7',
      },
      body: payload,
    });
    expect(second.status).toBe(200);

    const emailHash = await hashEmail(email, FORMS_HASH_PEPPER, { requirePepper: true });
    const count = await tenv()
      .DB.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE email_hash = ?')
      .bind(emailHash)
      .first<{ n: number }>();
    expect(count!.n).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A-5 DATA-AT-REST — subscribers.email is encrypted + hashed, never plaintext
// (FIX 1 born-red)
// ═════════════════════════════════════════════════════════════════════════════

describe('A-5: subscribe stores email_hash + email_encrypted, never plaintext', () => {
  test('raw row has no plaintext email; email_encrypted is v1:, email_hash is 64-hex; admin list decrypts back', async () => {
    const email = `atrest-${Date.now()}@example.com`;
    const res = await SELF.fetch('https://test.local/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(JSON.stringify({ email }).length),
        'CF-Connecting-IP': '203.0.113.99',
      },
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(200);

    const emailHash = await hashEmail(email, FORMS_HASH_PEPPER, { requirePepper: true });
    const row = await tenv()
      .DB.prepare('SELECT * FROM subscribers WHERE email_hash = ?')
      .bind(emailHash)
      .first<Record<string, unknown>>();

    expect(row).not.toBeNull();
    // The plaintext column is dropped — there is no `email` value at all.
    expect(row).not.toHaveProperty('email');
    // email_hash is a 64-char hex HMAC-SHA256.
    expect(String(row!.email_hash)).toMatch(/^[0-9a-f]{64}$/);
    // email_encrypted is AES-GCM ciphertext with the versioned `v1:` prefix.
    expect(String(row!.email_encrypted)).toMatch(/^v1:/);
    // The stored ciphertext is NOT the plaintext email.
    expect(String(row!.email_encrypted)).not.toContain(email);
    // It decrypts back to the original email.
    expect(await decryptText(String(row!.email_encrypted), FORMS_ENCRYPTION_KEY)).toBe(email);

    // Admin list returns the decrypted email verbatim (shape unchanged).
    const list = await SELF.fetch('https://test.local/api/v2/admin/subscribers?limit=100', {
      headers: { Authorization: `Bearer ${tenv().ADMIN_KEY}` },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: Array<{ email: string }> };
    expect(body.items.some((i) => i.email === email)).toBe(true);
  });

  test('second subscribe with the same email is deduped by email_hash (ON CONFLICT)', async () => {
    const email = `atrest-dedup-${Date.now()}@example.com`;
    const payload = JSON.stringify({ email });
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': String(payload.length),
      'CF-Connecting-IP': '203.0.113.100',
    };
    const first = await SELF.fetch('https://test.local/subscribe', {
      method: 'POST',
      headers,
      body: payload,
    });
    expect(first.status).toBe(200);
    const second = await SELF.fetch('https://test.local/subscribe', {
      method: 'POST',
      headers,
      body: payload,
    });
    expect(second.status).toBe(200);

    const emailHash = await hashEmail(email, FORMS_HASH_PEPPER, { requirePepper: true });
    const count = await tenv()
      .DB.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE email_hash = ?')
      .bind(emailHash)
      .first<{ n: number }>();
    expect(count!.n).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L2 BEHAVIORAL — Admin enumerate endpoint + audit
// ═════════════════════════════════════════════════════════════════════════════

describe('L2 behavioral: admin enumerate writes audit log entry', () => {
  test('GET /api/v2/admin/subscribers requires auth (401 without token)', async () => {
    const res = await SELF.fetch('https://test.local/api/v2/admin/subscribers');
    expect(res.status).toBe(401);
  });

  test('GET /api/v2/admin/subscribers (authed) returns items + writes audit', async () => {
    // Seed two subscribers (A-5 encrypted+hashed shape)
    await seedSubscriber('admin-list-1@example.com', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await seedSubscriber('admin-list-2@example.com', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

    const before = await tenv()
      .DB.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'LIST_SUBSCRIBERS'")
      .first<{ n: number }>();

    const res = await SELF.fetch('https://test.local/api/v2/admin/subscribers?limit=10', {
      headers: { Authorization: `Bearer ${tenv().ADMIN_KEY}` },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      items: Array<{ email: string; source: string | null; created_at: string }>;
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(2);

    // Audit fire-and-forget — small grace period for ctx.waitUntil to flush
    await new Promise((r) => setTimeout(r, 100));
    const after = await tenv()
      .DB.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'LIST_SUBSCRIBERS'")
      .first<{ n: number }>();
    expect(after!.n).toBeGreaterThan(before!.n);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L2 BEHAVIORAL — Data-subject erase covers subscribers (Phase C)
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// L2 BEHAVIORAL — Subscribers retention lifecycle (OSE-207 follow-up)
// ═════════════════════════════════════════════════════════════════════════════

describe('L2 behavioral: subscribers retention SQL pattern matches the cron', () => {
  // The scheduled() handler isn't directly invokable from cloudflare:test
  // SELF.fetch (it's only fired by Cloudflare's cron in real deploys), so
  // this test asserts that the DELETE pattern used by
  // runSubscribersRetentionLifecycle in src/index.ts performs the
  // expected retention semantics when executed directly against DB.

  test('DELETE WHERE created_at < datetime("now", "-N days") removes old rows only', async () => {
    // Seed two rows: one 400 days old, one 10 days old
    const oldEmail = `retention-old-${Date.now()}@example.com`;
    const recentEmail = `retention-recent-${Date.now()}@example.com`;
    const oldDate = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();
    const recentDate = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();

    const oldHash = await seedSubscriber(oldEmail, 'a'.repeat(32), oldDate);
    const recentHash = await seedSubscriber(recentEmail, 'b'.repeat(32), recentDate);

    // Apply the same SQL the cron uses, with a 365-day window.
    const res = await tenv()
      .DB.prepare("DELETE FROM subscribers WHERE created_at < datetime('now', ?)")
      .bind('-365 days')
      .run();
    expect((res.meta?.changes ?? 0) >= 1).toBe(true);

    const oldStill = await tenv()
      .DB.prepare('SELECT 1 AS x FROM subscribers WHERE email_hash = ?')
      .bind(oldHash)
      .first();
    expect(oldStill).toBeNull();

    const recentStill = await tenv()
      .DB.prepare('SELECT 1 AS x FROM subscribers WHERE email_hash = ?')
      .bind(recentHash)
      .first();
    expect(recentStill).not.toBeNull();
  });

  test('source code: runSubscribersRetentionLifecycle defaults to a bounded retention window', () => {
    // The retention cron must not leave subscriber PII uncapped by default.
    // A blank/unset env knob falls back to a finite default window, while an
    // explicit non-positive value remains a no-op/disabled state.
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as { TEST_SOURCE_FILES_JSON: string }).TEST_SOURCE_FILES_JSON
    );
    const indexFile = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/index.ts')
    );
    expect(indexFile, 'src/index.ts not found in TEST_SOURCE_FILES_JSON').toBeDefined();
    const content = indexFile![1];

    expect(content).toMatch(/SUBSCRIBERS_RETENTION_DAYS/);
    expect(content).toMatch(/DEFAULT_SUBSCRIBERS_RETENTION_DAYS/);
    expect(content).toMatch(/365/);
    expect(content).toMatch(/SUBSCRIBERS_RETENTION_NOOP/);
  });
});

describe('L2 behavioral: data-subject erase removes subscribers row', () => {
  test('POST /api/v2/admin/data-subject/erase deletes from subscribers', async () => {
    const email = `erase-me-${Date.now()}@example.com`;

    const emailHash = await seedSubscriber(email, 'cccccccccccccccccccccccccccccccc');

    const beforeRow = await tenv()
      .DB.prepare('SELECT 1 AS x FROM subscribers WHERE email_hash = ?')
      .bind(emailHash)
      .first();
    expect(beforeRow).not.toBeNull();

    const res = await SELF.fetch('https://test.local/api/v2/admin/data-subject/erase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenv().ADMIN_KEY}`,
      },
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      subscribersDeleted: number;
      emailHash: string;
    };
    expect(body.ok).toBe(true);
    expect(body.subscribersDeleted).toBe(1);
    // Contract: raw email never returned — only the hash
    expect(body.emailHash).toMatch(/^[0-9a-f]{64}$/);

    const afterRow = await tenv()
      .DB.prepare('SELECT 1 AS x FROM subscribers WHERE email_hash = ?')
      .bind(emailHash)
      .first();
    expect(afterRow).toBeNull();
  });
});
