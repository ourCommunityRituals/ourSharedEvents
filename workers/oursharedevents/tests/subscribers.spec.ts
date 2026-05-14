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

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  ADMIN_KEY: string;
}

const tenv = () => env as unknown as TestEnv;

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

  test('email column is UNIQUE for idempotent INSERT OR IGNORE', async () => {
    // sqlite_master CREATE INDEX entries reveal the UNIQUE constraint
    const idx = await tenv()
      .DB.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='subscribers'")
      .all<{ sql: string | null }>();
    const sqls = idx.results.map((r) => r.sql ?? '').join('\n');
    // Either an explicit UNIQUE INDEX on (email) OR the column carries
    // UNIQUE in the table DDL (auto-index sqlite_autoindex_subscribers_1).
    const tableDdl = await tenv()
      .DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='subscribers'")
      .first<{ sql: string }>();
    const allDdl = sqls + '\n' + (tableDdl?.sql ?? '');
    expect(allDdl.toUpperCase()).toContain('UNIQUE');
    expect(allDdl).toContain('email');
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

    const row = await tenv()
      .DB.prepare('SELECT ip_hash FROM subscribers WHERE email = ?')
      .bind(email)
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

    const count = await tenv()
      .DB.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE email = ?')
      .bind(email)
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
    // Seed two subscribers
    await tenv()
      .DB.prepare('INSERT OR IGNORE INTO subscribers (email, ip_hash, source) VALUES (?, ?, ?)')
      .bind('admin-list-1@example.com', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'landing')
      .run();
    await tenv()
      .DB.prepare('INSERT OR IGNORE INTO subscribers (email, ip_hash, source) VALUES (?, ?, ?)')
      .bind('admin-list-2@example.com', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'landing')
      .run();

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

    await tenv()
      .DB.prepare(
        'INSERT OR IGNORE INTO subscribers (email, ip_hash, source, created_at) VALUES (?, ?, ?, ?)'
      )
      .bind(oldEmail, 'a'.repeat(32), 'landing', oldDate)
      .run();
    await tenv()
      .DB.prepare(
        'INSERT OR IGNORE INTO subscribers (email, ip_hash, source, created_at) VALUES (?, ?, ?, ?)'
      )
      .bind(recentEmail, 'b'.repeat(32), 'landing', recentDate)
      .run();

    // Apply the same SQL the cron uses, with a 365-day window.
    const res = await tenv()
      .DB.prepare("DELETE FROM subscribers WHERE created_at < datetime('now', ?)")
      .bind('-365 days')
      .run();
    expect((res.meta?.changes ?? 0) >= 1).toBe(true);

    const oldStill = await tenv()
      .DB.prepare('SELECT 1 AS x FROM subscribers WHERE email = ?')
      .bind(oldEmail)
      .first();
    expect(oldStill).toBeNull();

    const recentStill = await tenv()
      .DB.prepare('SELECT 1 AS x FROM subscribers WHERE email = ?')
      .bind(recentEmail)
      .first();
    expect(recentStill).not.toBeNull();
  });

  test('source code: runSubscribersRetentionLifecycle is a no-op when env knob unset', () => {
    // Locked into the file's behaviour via static check — if someone changes
    // the function to default-to-deleting (e.g. hardcoded 365 days), this
    // catches it.
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as { TEST_SOURCE_FILES_JSON: string }).TEST_SOURCE_FILES_JSON
    );
    const indexFile = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/index.ts')
    );
    expect(indexFile, 'src/index.ts not found in TEST_SOURCE_FILES_JSON').toBeDefined();
    const content = indexFile![1];

    // The function must read SUBSCRIBERS_RETENTION_DAYS, must early-return
    // a noop log when not finite/positive, and must NOT contain a hardcoded
    // `'-NNN days'` fallback that bypasses the env knob.
    expect(content).toMatch(/SUBSCRIBERS_RETENTION_DAYS/);
    expect(content).toMatch(/SUBSCRIBERS_RETENTION_NOOP/);
    expect(content).not.toMatch(/-\s*\d{2,}\s*days/);
  });
});

describe('L2 behavioral: data-subject erase removes subscribers row', () => {
  test('POST /api/v2/admin/data-subject/erase deletes from subscribers', async () => {
    const email = `erase-me-${Date.now()}@example.com`;

    await tenv()
      .DB.prepare('INSERT OR IGNORE INTO subscribers (email, ip_hash, source) VALUES (?, ?, ?)')
      .bind(email, 'cccccccccccccccccccccccccccccccc', 'landing')
      .run();

    const beforeRow = await tenv()
      .DB.prepare('SELECT 1 AS x FROM subscribers WHERE email = ?')
      .bind(email)
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
      .DB.prepare('SELECT 1 AS x FROM subscribers WHERE email = ?')
      .bind(email)
      .first();
    expect(afterRow).toBeNull();
  });
});
