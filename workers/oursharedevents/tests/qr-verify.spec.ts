/**
 * OSE-213 / BE-18 — QR verify/unverify admin endpoints
 *
 * L2: integration via SELF.fetch
 *   POST /api/v2/admin/events/:id/verify-qr   — READY → ACTIVE
 *   POST /api/v2/admin/events/:id/unverify-qr — ACTIVE → READY
 *
 * Auth: Bearer test-admin-key-e2e-2026
 * Base URL: https://localhost (router redirects http→https)
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

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

function db() {
  return (env as Record<string, D1Database>).DB;
}

async function insertEvent(id: string, status: string): Promise<void> {
  await db()
    .prepare(
      `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, created_at, updated_at)
       VALUES (?, 'brand-qr-test', 'QR Test Event', ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(id, id, status)
    .run();
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

// ── QR Verify — POST /api/v2/admin/events/:id/verify-qr ──────────────────────

describe('QR Verify — POST /api/v2/admin/events/:id/verify-qr', () => {
  test('no auth → 401', async () => {
    const res = await SELF.fetch(
      'https://localhost/api/v2/admin/events/qr-no-auth-test/verify-qr',
      { method: 'POST' }
    );
    expect(res.status).toBe(401);
  });

  test('event not found → 404 EVENT_NOT_FOUND', async () => {
    const res = await SELF.fetch(
      'https://localhost/api/v2/admin/events/qr-nonexistent-verify/verify-qr',
      { method: 'POST', headers: ADMIN_HEADERS }
    );
    expect(res.status).toBe(404);
    const body = await json<{ ok: boolean; code: string }>(res);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('EVENT_NOT_FOUND');
  });

  test('event in draft → 409 INVALID_TRANSITION', async () => {
    const id = `qr-test-draft-${Date.now()}`;
    await insertEvent(id, 'draft');
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}/verify-qr`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(409);
    const body = await json<{ ok: boolean; code: string; from: string; to: string }>(res);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_TRANSITION');
    expect(body.from).toBe('draft');
    expect(body.to).toBe('active');
  });

  test('event in ready → 200, status active, qrVerified true', async () => {
    const id = `qr-test-ready-${Date.now()}`;
    await insertEvent(id, 'ready');
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}/verify-qr`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await json<{
      ok: boolean;
      event: { id: string; status: string; qrVerified: boolean };
    }>(res);
    expect(body.ok).toBe(true);
    expect(body.event.id).toBe(id);
    expect(body.event.status).toBe('active');
    expect(body.event.qrVerified).toBe(true);
  });

  test('event in active (already active) → 409 INVALID_TRANSITION', async () => {
    const id = `qr-test-already-active-${Date.now()}`;
    await insertEvent(id, 'active');
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}/verify-qr`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(409);
    const body = await json<{ ok: boolean; code: string; from: string; to: string }>(res);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_TRANSITION');
    expect(body.from).toBe('active');
    expect(body.to).toBe('active');
  });
});

// ── QR Unverify — POST /api/v2/admin/events/:id/unverify-qr ──────────────────

describe('QR Unverify — POST /api/v2/admin/events/:id/unverify-qr', () => {
  test('no auth → 401', async () => {
    const res = await SELF.fetch(
      'https://localhost/api/v2/admin/events/qr-no-auth-unverify/unverify-qr',
      { method: 'POST' }
    );
    expect(res.status).toBe(401);
  });

  test('event not found → 404 EVENT_NOT_FOUND', async () => {
    const res = await SELF.fetch(
      'https://localhost/api/v2/admin/events/qr-nonexistent-unverify/unverify-qr',
      { method: 'POST', headers: ADMIN_HEADERS }
    );
    expect(res.status).toBe(404);
    const body = await json<{ ok: boolean; code: string }>(res);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('EVENT_NOT_FOUND');
  });

  test('event in ready (not active) → 409 INVALID_TRANSITION', async () => {
    const id = `qr-test-ready-unverify-${Date.now()}`;
    await insertEvent(id, 'ready');
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}/unverify-qr`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(409);
    const body = await json<{ ok: boolean; code: string; from: string; to: string }>(res);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_TRANSITION');
    expect(body.from).toBe('ready');
    expect(body.to).toBe('ready');
  });

  test('event in active → 200, status ready, qrVerified false', async () => {
    const id = `qr-test-active-${Date.now()}`;
    await insertEvent(id, 'active');
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}/unverify-qr`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await json<{
      ok: boolean;
      event: { id: string; status: string; qrVerified: boolean };
    }>(res);
    expect(body.ok).toBe(true);
    expect(body.event.id).toBe(id);
    expect(body.event.status).toBe('ready');
    expect(body.event.qrVerified).toBe(false);
  });
});
