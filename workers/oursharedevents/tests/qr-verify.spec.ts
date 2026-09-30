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

/** OSE-1420: the QR evidence both doors into `active` require — a shortlink
 *  (digital poster QR) or an active poster deployment (physical scan token). */
async function seedShortlink(eventId: string): Promise<void> {
  await db()
    .prepare(
      `INSERT OR REPLACE INTO shortlinks (code, event_id, created_at) VALUES (?, ?, datetime('now'))`
    )
    .bind(`sl${eventId.slice(-6)}${Date.now().toString(36).slice(-4)}`, eventId)
    .run();
}
async function seedPosterDeployment(eventId: string, isActive = 1): Promise<void> {
  await db()
    .prepare(
      `INSERT OR REPLACE INTO poster_deployments (id, event_id, qr_token, placement_label, is_active)
       VALUES (?, ?, ?, 'front door', ?)`
    )
    .bind(`pd_${eventId}`, eventId, `qrt_${eventId}`, isActive)
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

  // OSE-1420 — "QR verified" is a proof, not an assertion. verify-qr refuses
  // an event no QR resolves to, and says which evidence is missing.
  test('event in ready with NO shortlink and NO poster → 409 NO_QR_EVIDENCE with counts', async () => {
    const id = `qr-test-noevidence-${Date.now()}`;
    await insertEvent(id, 'ready');
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}/verify-qr`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(409);
    const body = await json<{
      ok: boolean;
      code: string;
      from: string;
      to: string;
      evidence: { shortlinks: number; active_deployments: number; scans: number };
      error: string;
    }>(res);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('NO_QR_EVIDENCE');
    expect(body.from).toBe('ready');
    expect(body.to).toBe('active');
    expect(body.evidence).toEqual({ shortlinks: 0, active_deployments: 0, scans: 0 });
    expect(body.error).toMatch(/share link|poster/);
    const row = await db()
      .prepare('SELECT status, qr_verified FROM events WHERE id = ?')
      .bind(id)
      .first<{ status: string; qr_verified: number }>();
    expect(row).toEqual({ status: 'ready', qr_verified: 0 });
  });

  test('event in ready with only an INACTIVE poster deployment → 409 NO_QR_EVIDENCE', async () => {
    const id = `qr-test-inactive-pd-${Date.now()}`;
    await insertEvent(id, 'ready');
    await seedPosterDeployment(id, 0);
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}/verify-qr`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(409);
    expect((await json<{ code: string }>(res)).code).toBe('NO_QR_EVIDENCE');
  });

  test('event in ready with only an active poster deployment → 200, receipt counts it', async () => {
    const id = `qr-test-poster-only-${Date.now()}`;
    await insertEvent(id, 'ready');
    await seedPosterDeployment(id, 1);
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}/verify-qr`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await json<{
      ok: boolean;
      evidence: { shortlinks: number; active_deployments: number; scans: number };
    }>(res);
    expect(body.ok).toBe(true);
    expect(body.evidence).toEqual({ shortlinks: 0, active_deployments: 1, scans: 0 });
  });

  test('event in ready → 200, status active, qrVerified true', async () => {
    const id = `qr-test-ready-${Date.now()}`;
    await insertEvent(id, 'ready');
    await seedShortlink(id); // OSE-1420: the auto-minted shortlink is the QR evidence
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}/verify-qr`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await json<{
      ok: boolean;
      event: { id: string; status: string; qrVerified: boolean };
      evidence: { shortlinks: number; active_deployments: number; scans: number };
    }>(res);
    expect(body.ok).toBe(true);
    expect(body.event.id).toBe(id);
    expect(body.event.status).toBe('active');
    expect(body.event.qrVerified).toBe(true);
    expect(body.evidence.shortlinks).toBe(1);
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

// ── PUT status keeps qr_verified in lockstep (CCR-PR567 re-run item 2) ────────
// verify-qr / unverify-qr are the admin's QR-verified edges, but they are NOT the
// only door to `active`: PUT /admin/events/:id moves archived -> active directly
// (the L1 "Go live again" edge) and active -> ready/archived. Before this fix that
// PUT was a bare UPDATE that never touched qr_verified, so an event archived while
// qr_verified=0 could reach `active` with qr_verified=0 — violating the invariant
// `active <=> qr_verified=1`. The PUT write now couples qr_verified to the target
// state in BOTH directions, so the invariant holds no matter which door is used.

describe('PUT status couples qr_verified to the target state (item 2)', () => {
  const PUT_HEADERS = { ...ADMIN_HEADERS, 'Content-Type': 'application/json' };
  async function setQr(id: string, v: number): Promise<void> {
    await db().prepare('UPDATE events SET qr_verified = ? WHERE id = ?').bind(v, id).run();
  }
  async function readQr(id: string): Promise<number | null> {
    const row = await db()
      .prepare('SELECT qr_verified FROM events WHERE id = ?')
      .bind(id)
      .first<{ qr_verified: number }>();
    return row ? row.qr_verified : null;
  }
  async function putStatus(id: string, body: Record<string, unknown>): Promise<Response> {
    return SELF.fetch(`https://localhost/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: PUT_HEADERS,
      body: JSON.stringify(body),
    });
  }

  test('archived -> active via PUT sets qr_verified = 1 (the "Go live again" edge)', async () => {
    const id = `qr-put-archived-active-${Date.now()}`;
    await insertEvent(id, 'archived');
    await seedShortlink(id); // OSE-1420: the second door asks for the same evidence
    await setQr(id, 0); // archived while never QR-verified
    const res = await putStatus(id, { status: 'active' });
    expect(res.status).toBe(200);
    expect(await readQr(id)).toBe(1);
  });

  // OSE-1420 — the second door cannot be the one that forgot to ask.
  test('archived -> active via PUT with NO QR evidence → 409 NO_QR_EVIDENCE, nothing written', async () => {
    const id = `qr-put-archived-noevidence-${Date.now()}`;
    await insertEvent(id, 'archived');
    await setQr(id, 0);
    const res = await putStatus(id, { status: 'active' });
    expect(res.status).toBe(409);
    const body = await json<{ code: string; from: string; to: string; requestId: string }>(res);
    expect(body.code).toBe('NO_QR_EVIDENCE');
    expect(body.from).toBe('archived');
    expect(body.to).toBe('active');
    expect(typeof body.requestId).toBe('string');
    expect(await readQr(id)).toBe(0);
    const row = await db()
      .prepare('SELECT status FROM events WHERE id = ?')
      .bind(id)
      .first<{ status: string }>();
    expect(row?.status).toBe('archived');
  });

  test('active -> ready via PUT resets qr_verified = 0', async () => {
    const id = `qr-put-active-ready-${Date.now()}`;
    await insertEvent(id, 'active');
    await setQr(id, 1);
    const res = await putStatus(id, { status: 'ready' });
    expect(res.status).toBe(200);
    expect(await readQr(id)).toBe(0);
  });

  test('a field-only PUT (no status) leaves qr_verified untouched', async () => {
    const id = `qr-put-fieldonly-${Date.now()}`;
    await insertEvent(id, 'active');
    await setQr(id, 1);
    const res = await putStatus(id, { title: 'Renamed but still live' });
    expect(res.status).toBe(200);
    expect(await readQr(id)).toBe(1); // no lifecycle move → not touched
  });
});
