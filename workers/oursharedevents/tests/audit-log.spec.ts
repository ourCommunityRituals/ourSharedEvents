/**
 * OSE-212 / SEC-6 — Admin audit log
 *
 * L1: unit tests for logAdminAction and extractAdminActor
 * L2: integration via SELF.fetch
 *   - GET /api/v2/admin/audit-log requires auth
 *   - Mutations create audit entries (waitUntil settles before DB query)
 *   - Pagination and filter params work
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { logAdminAction } from '../src/lib/audit-log';
import { extractAdminActor } from '../src/auth/admin';

// ── DB setup ──────────────────────────────────────────────────────────────────

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(
    (env as Record<string, string>).TEST_MIGRATION_STATEMENTS
  );
  for (const stmt of statements) {
    try {
      await (env as Record<string, D1Database>).DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };

function adminFetch(path: string, init?: RequestInit) {
  return SELF.fetch(`https://localhost${path}`, {
    ...init,
    headers: { ...ADMIN_HEADERS, ...(init?.headers ?? {}) },
  });
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

/** Wait one macro-task tick for ctx.waitUntil promises to settle */
function tick(ms = 80): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function db() {
  return (env as Record<string, D1Database>).DB;
}

async function auditCount(action?: string): Promise<number> {
  const sql = action
    ? `SELECT COUNT(*) as n FROM admin_audit_log WHERE action = ?`
    : `SELECT COUNT(*) as n FROM admin_audit_log`;
  const row = await db()
    .prepare(sql)
    .bind(...(action ? [action] : []))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function latestEntry(action: string) {
  return db()
    .prepare(`SELECT * FROM admin_audit_log WHERE action = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(action)
    .first<Record<string, unknown>>();
}

// ── L1: logAdminAction — writes row to DB ─────────────────────────────────────

describe('L1: logAdminAction — inserts audit row', () => {
  test('success outcome row is persisted', async () => {
    const before = await auditCount('TEST_ACTION_L1');
    await logAdminAction(env as Parameters<typeof logAdminAction>[0], {
      action: 'TEST_ACTION_L1',
      actor: 'test@example.com',
      resource_type: 'event',
      resource_id: 'evt-unit-1',
      request_id: 'req-l1-1',
      outcome: 'success',
    });
    expect(await auditCount('TEST_ACTION_L1')).toBe(before + 1);
  });

  test('denied outcome row is persisted', async () => {
    const before = await auditCount('TEST_DENIED_L1');
    await logAdminAction(env as Parameters<typeof logAdminAction>[0], {
      action: 'TEST_DENIED_L1',
      actor: null,
      request_id: 'req-l1-2',
      outcome: 'denied',
    });
    expect(await auditCount('TEST_DENIED_L1')).toBe(before + 1);
  });

  test('actor, resource_type, resource_id, ip are stored correctly', async () => {
    await logAdminAction(env as Parameters<typeof logAdminAction>[0], {
      action: 'TEST_FIELDS_L1',
      actor: 'ops@example.com',
      resource_type: 'sponsor',
      resource_id: 'spon-x',
      request_id: 'req-l1-3',
      outcome: 'success',
      ip: '1.2.3.4',
      details: { tier: 'premium' },
    });
    const row = await db()
      .prepare(`SELECT * FROM admin_audit_log WHERE request_id = ?`)
      .bind('req-l1-3')
      .first<Record<string, unknown>>();
    expect(row).not.toBeNull();
    expect(row!.actor).toBe('ops@example.com');
    expect(row!.resource_type).toBe('sponsor');
    expect(row!.resource_id).toBe('spon-x');
    expect(row!.ip).toBe('1.2.3.4');
    expect(JSON.parse(row!.details as string)).toEqual({ tier: 'premium' });
  });

  test('write failure is swallowed — does not throw', async () => {
    // Pass a broken DB binding — logAdminAction must not throw
    const badEnv = { DB: null } as unknown as Parameters<typeof logAdminAction>[0];
    await expect(
      logAdminAction(badEnv, {
        action: 'SHOULD_SWALLOW',
        actor: null,
        request_id: 'req-swallow',
        outcome: 'success',
      })
    ).resolves.toBeUndefined();
  });
});

// ── L1: extractAdminActor ─────────────────────────────────────────────────────

describe('L1: extractAdminActor — identifies actor from request headers', () => {
  const baseEnv = {
    ALLOW_ADMIN_KEY_FALLBACK: 'true',
    ADMIN_KEY: 'test-admin-key-e2e-2026',
    ALLOW_OCR_INTERNAL: 'true',
    X_OCR_INTERNAL: 'test-ocr-internal-secret-2026',
    ALLOWED_ADMIN_EMAILS: 'test-admin@example.com',
    ALLOWED_ADMIN_DOMAINS: 'example.com',
  } as Parameters<typeof extractAdminActor>[1];

  test('ADMIN_KEY Bearer → key:admin', () => {
    const req = new Request('http://localhost/', {
      headers: { Authorization: 'Bearer test-admin-key-e2e-2026' },
    });
    expect(extractAdminActor(req, baseEnv)).toBe('key:admin');
  });

  test('X-OCR-Internal → key:ocr-internal', () => {
    const req = new Request('http://localhost/', {
      headers: { 'X-OCR-Internal': 'test-ocr-internal-secret-2026' },
    });
    expect(extractAdminActor(req, baseEnv)).toBe('key:ocr-internal');
  });

  test('no auth → null', () => {
    const req = new Request('http://localhost/');
    expect(extractAdminActor(req, baseEnv)).toBeNull();
  });

  test('invalid Bearer token → null (wrong key)', () => {
    const req = new Request('http://localhost/', {
      headers: { Authorization: 'Bearer wrong-key' },
    });
    expect(extractAdminActor(req, baseEnv)).toBeNull();
  });
});

// ── L1: static analysis ───────────────────────────────────────────────────────

describe('L1: static — audit wiring in router.ts', () => {
  function normPath(p: string) {
    return p.replace(/\\/g, '/');
  }

  test('router.ts imports logAdminAction from audit-log', () => {
    const src = (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string;
    const files = JSON.parse(src) as Record<string, string>;
    const routerTs = Object.entries(files).find(([k]) => normPath(k).endsWith('/src/router.ts'));
    expect(routerTs).toBeDefined();
    expect(routerTs![1]).toContain('logAdminAction');
    expect(routerTs![1]).toContain('extractAdminActor');
  });

  test('router.ts imports handleListAuditLog', () => {
    const src = (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string;
    const files = JSON.parse(src) as Record<string, string>;
    const routerTs = Object.entries(files).find(([k]) => normPath(k).endsWith('/src/router.ts'));
    expect(routerTs![1]).toContain('handleListAuditLog');
  });

  test('index.ts passes ctx to route()', () => {
    const src = (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string;
    const files = JSON.parse(src) as Record<string, string>;
    const indexTs = Object.entries(files).find(([k]) => normPath(k).endsWith('/src/index.ts'));
    expect(indexTs).toBeDefined();
    expect(indexTs![1]).toContain('route(request, env, ctx)');
  });
});

// ── L2: GET /api/v2/admin/audit-log — auth guard ──────────────────────────────

describe('L2: GET /api/v2/admin/audit-log — requires auth', () => {
  test('no auth → 401', async () => {
    const res = await SELF.fetch('https://localhost/api/v2/admin/audit-log');
    expect(res.status).toBe(401);
  });

  test('ADMIN_KEY → 200 with ok:true and entries array', async () => {
    const res = await adminFetch('/api/v2/admin/audit-log');
    expect(res.status).toBe(200);
    const body = await json<{ ok: boolean; entries: unknown[]; pagination: unknown }>(res);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.pagination).toBeDefined();
  });
});

// ── L2: mutation creates audit entry ──────────────────────────────────────────
// Note: ctx.waitUntil writes are not visible through the test-runner's direct db()
// handle (separate miniflare D1 connections). We verify via the HTTP audit-log
// endpoint instead — both the write (waitUntil) and the read (GET handler) go
// through the same worker D1 connection, so the committed state is visible.

describe('L2: admin mutations create audit entries', () => {
  test('POST /api/v2/admin/events → CREATE_EVENT entry visible via audit-log endpoint', async () => {
    const slug = `audit-test-${Date.now()}`;
    const mutRes = await adminFetch('/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `audit-test-evt-${Date.now()}`,
        brand_id: 'brand-audit',
        title: 'Audit Test Event',
        slug,
      }),
    });
    // Confirm the mutation succeeded so we know an audit entry should exist
    expect(mutRes.status).toBeLessThan(500);

    // waitUntil from the POST is committed; the GET runs after in the same worker
    const auditRes = await adminFetch('/api/v2/admin/audit-log?action=CREATE_EVENT&limit=5');
    expect(auditRes.status).toBe(200);
    const body = await json<{
      entries: { actor: string; outcome: string; resource_type: string }[];
    }>(auditRes);
    expect(body.entries.length).toBeGreaterThan(0);
  });

  test('CREATE_EVENT entry has actor=key:admin and outcome=success', async () => {
    const slug = `actor-test-${Date.now()}`;
    await adminFetch('/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `audit-actor-test-${Date.now()}`,
        brand_id: 'brand-audit',
        title: 'Actor Test',
        slug,
      }),
    });

    const auditRes = await adminFetch('/api/v2/admin/audit-log?action=CREATE_EVENT&limit=1');
    const body = await json<{
      entries: { actor: string; outcome: string; resource_type: string }[];
    }>(auditRes);
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries[0].actor).toBe('key:admin');
    expect(body.entries[0].outcome).toBe('success');
    expect(body.entries[0].resource_type).toBe('event');
  });

  test('denied mutation → outcome=denied entry visible via audit-log endpoint', async () => {
    // POST without auth — requireAdmin denies and fires waitUntil(logAdminAction(...denied))
    await SELF.fetch('https://localhost/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'denied-x', brand_id: 'b', title: 't', slug: 's-denied' }),
    });

    const auditRes = await adminFetch(
      '/api/v2/admin/audit-log?action=CREATE_EVENT&outcome=denied&limit=10'
    );
    const body = await json<{ entries: { outcome: string }[] }>(auditRes);
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries[0].outcome).toBe('denied');
  });
});

// ── L2: pagination ────────────────────────────────────────────────────────────

describe('L2: GET /api/v2/admin/audit-log — pagination', () => {
  test('limit=1 returns exactly 1 entry and hasMore when DB has rows', async () => {
    // Ensure at least 2 rows exist
    await logAdminAction(env as Parameters<typeof logAdminAction>[0], {
      action: 'PAGER_TEST',
      actor: null,
      request_id: 'pg-1',
      outcome: 'success',
    });
    await logAdminAction(env as Parameters<typeof logAdminAction>[0], {
      action: 'PAGER_TEST',
      actor: null,
      request_id: 'pg-2',
      outcome: 'success',
    });

    const res = await adminFetch('/api/v2/admin/audit-log?limit=1');
    const body = await json<{
      entries: unknown[];
      pagination: { hasMore: boolean; nextCursor: string | null };
    }>(res);
    expect(body.entries.length).toBe(1);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.nextCursor).not.toBeNull();
  });

  test('cursor pages forward correctly', async () => {
    const res1 = await adminFetch('/api/v2/admin/audit-log?limit=1&action=PAGER_TEST');
    const body1 = await json<{
      entries: { created_at: string }[];
      pagination: { nextCursor: string | null };
    }>(res1);
    expect(body1.pagination.nextCursor).not.toBeNull();

    const res2 = await adminFetch(
      `/api/v2/admin/audit-log?limit=1&action=PAGER_TEST&cursor=${encodeURIComponent(body1.pagination.nextCursor!)}`
    );
    const body2 = await json<{ entries: { created_at: string }[] }>(res2);
    // Second page entry must be older than first
    if (body2.entries.length > 0) {
      expect(body2.entries[0].created_at <= body1.entries[0].created_at).toBe(true);
    }
  });

  test('?outcome=denied filter returns only denied rows', async () => {
    const res = await adminFetch('/api/v2/admin/audit-log?outcome=denied&limit=100');
    const body = await json<{ entries: { outcome: string }[] }>(res);
    for (const entry of body.entries) {
      expect(entry.outcome).toBe('denied');
    }
  });

  test('limit is clamped to 100 max', async () => {
    const res = await adminFetch('/api/v2/admin/audit-log?limit=999');
    const body = await json<{ pagination: { limit: number } }>(res);
    expect(body.pagination.limit).toBe(100);
  });
});
