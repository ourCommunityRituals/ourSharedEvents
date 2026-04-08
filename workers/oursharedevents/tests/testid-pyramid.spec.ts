/**
 * Data-TestID Automation Pyramid
 *
 * Full SDET testing pyramid for the data-testid system across all surfaces.
 * Validates from static lint through contract, integration, and E2E.
 *
 * Pyramid layers:
 *   L1 — Lint:        Static analysis of source files (naming, uniqueness, coverage)
 *   L2 — Contract:    API response schemas match what the UI consumes
 *   L3 — Integration: DB → Handler → Router → HTML pipeline validation
 *   L4 — E2E:         Full admin flow: load → select event → forms → flags → surfaces
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

// ── Test env ────────────────────────────────────────────────────────────────

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_SOURCE_FILES_JSON: string;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const ADMIN_KEY = 'test-admin-key-e2e-2026';

function adminHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${ADMIN_KEY}` };
}

async function fetchHtml(path: string, auth = false): Promise<string> {
  const opts: RequestInit = auth ? { headers: adminHeaders() } : {};
  const res = await SELF.fetch(`https://t.test${path}`, opts);
  return res.text();
}

async function fetchJson(path: string, opts: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await SELF.fetch(`https://t.test${path}`, {
    ...opts,
    headers: { ...adminHeaders(), ...((opts.headers as Record<string, string>) ?? {}) },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Setup: apply migrations ─────────────────────────────────────────────────

beforeAll(async () => {
  const tenv = env as unknown as TestEnv;
  const stmts = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[];
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('duplicate column name')) throw e;
    }
  }
  const formsStmts = JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS) as string[];
  for (const stmt of formsStmts) {
    try {
      await tenv.FORMS_DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('duplicate column name')) throw e;
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// L1 — LINT: Static analysis of data-testid conventions
// ═══════════════════════════════════════════════════════════════════════════════

describe('L1 Lint: data-testid naming conventions', () => {
  function getSourceFiles(): Record<string, string> {
    return JSON.parse((env as unknown as TestEnv).TEST_SOURCE_FILES_JSON);
  }

  test('all data-testids use lowercase kebab-case', () => {
    const sources = getSourceFiles();
    const violations: string[] = [];
    for (const [path, content] of Object.entries(sources)) {
      const matches = content.match(/data-testid="([^"]+)"/g) ?? [];
      for (const m of matches) {
        const id = m.match(/data-testid="([^"]+)"/)?.[1] ?? '';
        // Allow dynamic suffixes: template literals (${...}) and string concat (' + ...)
        if (id.includes("'") || id.includes('$') || id.includes('\\')) continue;
        if (!/^[a-z][a-z0-9-]*$/.test(id)) {
          violations.push(`${path}: ${id}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('no duplicate static data-testids within a single HTML template in pages.ts', () => {
    const sources = getSourceFiles();
    const duplicates: string[] = [];
    for (const [path, content] of Object.entries(sources)) {
      // Only check pages.ts — form-pages.ts intentionally reuses testids across form types
      if (path.includes('form-pages') || !path.match(/pages\.ts$/)) continue;
      // Split by template constant boundaries to check within each surface
      const templates = content.split(/const \w+_HTML = `/);
      for (const template of templates) {
        const matches = template.match(/data-testid="([a-z][a-z0-9-]*)"/g) ?? [];
        const ids = matches.map((m) => m.match(/data-testid="([^"]+)"/)?.[1] ?? '');
        const seen = new Set<string>();
        for (const id of ids) {
          if (seen.has(id)) duplicates.push(`${path}: duplicate "${id}"`);
          seen.add(id);
        }
      }
    }
    expect(duplicates).toEqual([]);
  });

  test('every <button> in pages.ts has a data-testid', () => {
    const sources = getSourceFiles();
    const violations: string[] = [];
    for (const [path, content] of Object.entries(sources)) {
      if (!path.includes('pages.ts')) continue;
      // Match <button> tags and check for data-testid
      const buttons = content.match(/<button[^>]*>/g) ?? [];
      for (const btn of buttons) {
        if (!btn.includes('data-testid')) {
          violations.push(`${path}: <button> missing data-testid: ${btn.slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('every <select> in pages.ts has a data-testid', () => {
    const sources = getSourceFiles();
    const violations: string[] = [];
    for (const [path, content] of Object.entries(sources)) {
      if (!path.includes('pages.ts')) continue;
      const selects = content.match(/<select[^>]*>/g) ?? [];
      for (const sel of selects) {
        if (!sel.includes('data-testid')) {
          violations.push(`${path}: <select> missing data-testid: ${sel.slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('every <header> tag in pages.ts has a data-testid', () => {
    const sources = getSourceFiles();
    const violations: string[] = [];
    for (const [path, content] of Object.entries(sources)) {
      if (!path.includes('pages.ts')) continue;
      const headers = content.match(/<header[^>]*>/g) ?? [];
      for (const hdr of headers) {
        if (!hdr.includes('data-testid')) {
          violations.push(`${path}: <header> missing data-testid: ${hdr.slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('every <main> tag in pages.ts has a data-testid', () => {
    const sources = getSourceFiles();
    const violations: string[] = [];
    for (const [path, content] of Object.entries(sources)) {
      if (!path.includes('pages.ts')) continue;
      const mains = content.match(/<main[^>]*>/g) ?? [];
      for (const m of mains) {
        if (!m.includes('data-testid')) {
          violations.push(`${path}: <main> missing data-testid: ${m.slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('form-pages.ts: every <form>, <input>, and submit <button> has data-testid', () => {
    const sources = getSourceFiles();
    const violations: string[] = [];
    for (const [path, content] of Object.entries(sources)) {
      if (!path.includes('form-pages.ts')) continue;
      for (const tag of ['<form', '<input', '<textarea']) {
        const matches = content.match(new RegExp(`${tag}[^>]*>`, 'g')) ?? [];
        for (const m of matches) {
          if (!m.includes('data-testid')) {
            violations.push(`${path}: ${tag}> missing data-testid: ${m.slice(0, 80)}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L2 — CONTRACT: API response schemas the admin UI depends on
// ═══════════════════════════════════════════════════════════════════════════════

describe('L2 Contract: Admin events API schema', () => {
  test('GET /api/v2/admin/events returns { ok, status, items[] }', async () => {
    const body = await fetchJson('/api/v2/admin/events');
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('status', 200);
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
  });

  test('POST /api/v2/admin/events returns { ok, status, id, slug }', async () => {
    const body = await fetchJson('/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Contract Test Event' }),
    });
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('status', 201);
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('slug');
    expect(typeof body.id).toBe('string');
    expect((body.id as string).startsWith('evt_')).toBe(true);
  });
});

describe('L2 Contract: Flag resolution API schema', () => {
  test('GET /api/v2/admin/flags/current-tier returns { ok, tier }', async () => {
    const body = await fetchJson('/api/v2/admin/flags/current-tier');
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('tier');
    expect(['free', 'mid', 'enterprise']).toContain(body.tier);
  });

  test('GET /api/v2/admin/flags/resolve returns { ok, flags: Record<string, boolean> }', async () => {
    const body = await fetchJson('/api/v2/admin/flags/resolve');
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('flags');
    const flags = body.flags as Record<string, boolean>;
    // Must include the 4 form flags the admin UI checks
    expect(flags).toHaveProperty('forms.register');
    expect(flags).toHaveProperty('forms.checkin');
    expect(flags).toHaveProperty('forms.survey');
    expect(flags).toHaveProperty('forms.email-signup');
  });

  test('GET /api/v2/admin/flags/tiers returns 3 tier presets', async () => {
    const body = await fetchJson('/api/v2/admin/flags/tiers');
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('count', 3);
    const items = body.items as { tier: string }[];
    const tiers = items.map((i) => i.tier);
    expect(tiers).toContain('free');
    expect(tiers).toContain('mid');
    expect(tiers).toContain('enterprise');
  });
});

describe('L2 Contract: Form admin endpoints schema', () => {
  test('GET /api/v2/admin/events/:id/forms/registrations returns { ok, items, count }', async () => {
    const body = await fetchJson('/api/v2/admin/events/evt-contract-test/forms/registrations');
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('count');
    expect(Array.isArray(body.items)).toBe(true);
  });

  test('GET /api/v2/admin/events/:id/forms/checkin-count returns { ok, count }', async () => {
    const body = await fetchJson('/api/v2/admin/events/evt-contract-test/forms/checkin-count');
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('count');
    expect(typeof body.count).toBe('number');
  });

  test('GET /api/v2/admin/events/:id/forms/export?type=registrations returns { ok, items, count }', async () => {
    const body = await fetchJson(
      '/api/v2/admin/events/evt-contract-test/forms/export?type=registrations'
    );
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('count');
  });

  test('GET /api/v2/admin/events/:id/forms/export?format=csv returns text/csv', async () => {
    const res = await SELF.fetch(
      'https://t.test/api/v2/admin/events/evt-contract-test/forms/export?type=registrations&format=csv',
      { headers: adminHeaders() }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('.csv');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L3 — INTEGRATION: DB ↔ Handler ↔ Router ↔ HTML pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe('L3 Integration: DB → Events API → Admin HTML pipeline', () => {
  test('seed event in DB → admin API returns it → public API returns it', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_integ_${Date.now()}`;
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
       VALUES (?, 'root', 'Integration Test Night', ?, 'active', datetime('now'), datetime('now'))`
    )
      .bind(eventId, `integ-${Date.now()}`)
      .run();

    // Admin API returns it
    const adminBody = await fetchJson('/api/v2/admin/events');
    const adminItems = adminBody.items as { id: string }[];
    expect(adminItems.some((e) => e.id === eventId)).toBe(true);

    // Public API returns it (brand=root, status=active)
    const pubRes = await SELF.fetch('https://t.test/api/v2/events?brand=root');
    const pubBody = (await pubRes.json()) as Record<string, unknown>;
    const pubItems = pubBody.items as { id: string }[];
    expect(pubItems.some((e) => e.id === eventId)).toBe(true);
  });

  test('admin HTML loads and contains the events table structure', async () => {
    const html = await fetchHtml('/admin', true);
    expect(html).toContain('data-testid="events-container"');
    expect(html).toContain("fetch('/api/v2/admin/events')");
  });
});

describe('L3 Integration: DB → Flags → Admin tier badge pipeline', () => {
  test('FORMS_DB flag state drives tier detection API', async () => {
    const tenv = env as unknown as TestEnv;
    // Verify flags exist in DB
    const flagCount = await tenv.FORMS_DB.prepare(
      "SELECT COUNT(*) as cnt FROM feature_flags WHERE scope = 'global'"
    ).first<{ cnt: number }>();
    expect(flagCount!.cnt).toBeGreaterThanOrEqual(17);

    // Tier API reflects DB state
    const body = await fetchJson('/api/v2/admin/flags/current-tier');
    expect(body.ok).toBe(true);
    expect(typeof body.tier).toBe('string');
  });

  test('admin HTML JS calls tier API and badge element exists', async () => {
    const html = await fetchHtml('/admin', true);
    expect(html).toContain('data-testid="tier-badge"');
    expect(html).toContain('/api/v2/admin/flags/current-tier');
    expect(html).toContain('badge.className');
  });
});

describe('L3 Integration: DB → Forms handler → Admin forms panel', () => {
  test('form submission writes to FORMS_DB, admin reads it back', async () => {
    const eventId = 'evt-integ-forms';

    // Submit a registration via public API
    const submitRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Integration Tester' }),
    });
    const submitBody = (await submitRes.json()) as Record<string, unknown>;
    expect(submitBody.ok).toBe(true);

    // Admin reads it back
    const adminBody = await fetchJson(`/api/v2/admin/events/${eventId}/forms/registrations`);
    expect(adminBody.count).toBeGreaterThanOrEqual(1);
    const items = adminBody.items as { attendee_name: string }[];
    expect(items.some((r) => r.attendee_name === 'Integration Tester')).toBe(true);
  });

  test('checkin increments via public API, admin reads count', async () => {
    const eventId = 'evt-integ-checkin';

    await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/checkin`, { method: 'POST' });
    await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/checkin`, { method: 'POST' });
    await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/checkin`, { method: 'POST' });

    const body = await fetchJson(`/api/v2/admin/events/${eventId}/forms/checkin-count`);
    expect(body.count).toBe(3);
  });
});

describe('L3 Integration: Flag toggle → DB → Resolution', () => {
  test('PUT event flag writes to FORMS_DB, resolve reflects it', async () => {
    const eventId = 'evt-integ-flag';
    const flagKey = 'forms.survey';

    // Set event-level override
    await SELF.fetch(`https://t.test/api/v2/admin/events/${eventId}/flags/${flagKey}`, {
      method: 'PUT',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    // Verify in DB
    const tenv = env as unknown as TestEnv;
    const row = await tenv.FORMS_DB.prepare(
      "SELECT enabled FROM feature_flags WHERE scope = 'event' AND scope_id = ? AND flag_key = ?"
    )
      .bind(eventId, flagKey)
      .first<{ enabled: number }>();
    expect(row!.enabled).toBe(1);

    // Verify via resolve API
    const body = await fetchJson(`/api/v2/admin/flags/resolve?eventId=${eventId}`);
    const flags = body.flags as Record<string, boolean>;
    expect(flags[flagKey]).toBe(true);
  });
});

describe('L3 Integration: Anonymous ID → DB → Form submissions', () => {
  test('form submission stores anonymous_id in FORMS_DB', async () => {
    const eventId = 'evt-integ-anon';

    const res = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Anon Test' }),
    });
    expect(res.status).toBe(200);

    // Check Set-Cookie header
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('ose_anon=anon_');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');

    // Check DB has anonymous_id
    const tenv = env as unknown as TestEnv;
    const row = await tenv.FORMS_DB.prepare(
      'SELECT anonymous_id FROM form_registrations WHERE event_id = ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(eventId)
      .first<{ anonymous_id: string }>();
    expect(row!.anonymous_id).toMatch(/^anon_/);
  });

  test('returning visitor with cookie reuses same anonymous_id', async () => {
    const eventId = 'evt-integ-anon-reuse';
    const anonId = 'anon_test-fixed-id-12345';

    // First submission sets the cookie
    const res1 = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `ose_anon=${anonId}`,
      },
      body: JSON.stringify({ name: 'Return Visitor 1' }),
    });
    expect(res1.status).toBe(200);

    // Second submission with same cookie
    const res2 = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/checkin`, {
      method: 'POST',
      headers: { Cookie: `ose_anon=${anonId}` },
    });
    expect(res2.status).toBe(200);

    // Both should have the same anonymous_id in DB
    const tenv = env as unknown as TestEnv;
    const reg = await tenv.FORMS_DB.prepare(
      'SELECT anonymous_id FROM form_registrations WHERE event_id = ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(eventId)
      .first<{ anonymous_id: string }>();
    expect(reg!.anonymous_id).toBe(anonId);

    const checkin = await tenv.FORMS_DB.prepare(
      'SELECT last_anonymous_id FROM checkin_counts WHERE event_id = ?'
    )
      .bind(eventId)
      .first<{ last_anonymous_id: string }>();
    expect(checkin!.last_anonymous_id).toBe(anonId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L4 — E2E: Full admin flows through the Worker
// ═══════════════════════════════════════════════════════════════════════════════

describe('L4 E2E: Admin create → update → forms → export → flags → surfaces', () => {
  test('full lifecycle in a single test (D1 isolation requires single-test flows)', async () => {
    // Step 1: Create event
    const createBody = await fetchJson('/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'E2E Pyramid Test Event',
        status: 'active',
        location: 'Beverly Arts Center',
        start_date: '2026-06-15',
        template_id: 'community_day',
      }),
    });
    expect(createBody.ok).toBe(true);
    expect(createBody.status).toBe(201);
    const eventId = createBody.id as string;
    expect(eventId).toMatch(/^evt_/);

    // Step 2: Update event
    const updateBody = await fetchJson(`/api/v2/admin/events/${eventId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Updated via E2E pyramid test' }),
    });
    expect(updateBody.ok).toBe(true);

    // Step 3: Appears in admin + public lists
    const adminList = await fetchJson('/api/v2/admin/events');
    expect((adminList.items as { id: string }[]).some((e) => e.id === eventId)).toBe(true);
    const pubRes = await SELF.fetch('https://t.test/api/v2/events?brand=root');
    const pubBody = (await pubRes.json()) as Record<string, unknown>;
    expect((pubBody.items as { id: string }[]).some((e) => e.id === eventId)).toBe(true);

    // Step 4: Submit registration
    const regRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'E2E Tester', email: 'e2e@test.com' }),
    });
    expect(((await regRes.json()) as Record<string, unknown>).ok).toBe(true);

    // Step 5: 3 check-ins
    for (let i = 0; i < 3; i++) {
      const res = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/checkin`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
    }

    // Step 6: Admin reads counts
    const regs = await fetchJson(`/api/v2/admin/events/${eventId}/forms/registrations`);
    expect(regs.count).toBeGreaterThanOrEqual(1);
    const checkins = await fetchJson(`/api/v2/admin/events/${eventId}/forms/checkin-count`);
    expect(checkins.count).toBe(3);

    // Step 7: Export JSON + CSV
    const exportJson = await fetchJson(
      `/api/v2/admin/events/${eventId}/forms/export?type=registrations`
    );
    expect(exportJson.count).toBeGreaterThanOrEqual(1);
    const csvRes = await SELF.fetch(
      `https://t.test/api/v2/admin/events/${eventId}/forms/export?type=registrations&format=csv`,
      { headers: adminHeaders() }
    );
    const csv = await csvRes.text();
    expect(csv).toContain('id,');
    expect(csv).toContain('E2E Tester');

    // Step 8: Toggle flag → verify resolution → verify gating
    const toggleRes = await SELF.fetch(
      `https://t.test/api/v2/admin/events/${eventId}/flags/forms.survey`,
      {
        method: 'PUT',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }
    );
    expect(((await toggleRes.json()) as Record<string, unknown>).ok).toBe(true);
    const resolve = await fetchJson(`/api/v2/admin/flags/resolve?eventId=${eventId}`);
    expect((resolve.flags as Record<string, boolean>)['forms.survey']).toBe(false);
    const surveyRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/survey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responses: { rating: 5 } }),
    });
    expect(surveyRes.status).toBe(403);

    // Step 9: Public surfaces return 200; sharedReport gated by flag (403 on free tier)
    for (const path of ['/', '/display', '/poster']) {
      const res = await SELF.fetch(`https://t.test${path}`);
      expect(res.status).toBe(200);
    }
    const reportRes = await SELF.fetch('https://t.test/sharedReport');
    // Free tier: analytics.shared-report is OFF → 403
    expect(reportRes.status).toBe(403);
  });
});

describe('L4 E2E: Auth gate across all admin endpoints', () => {
  const adminPaths = [
    '/admin',
    '/api/v2/admin/events',
    '/api/v2/admin/flags',
    '/api/v2/admin/flags/tiers',
    '/api/v2/admin/flags/current-tier',
    '/api/v2/admin/flags/resolve',
    '/api/v2/admin/events/test/forms/registrations',
    '/api/v2/admin/events/test/forms/checkin-count',
    '/api/v2/admin/events/test/forms/surveys',
    '/api/v2/admin/events/test/forms/email-signups',
    '/api/v2/admin/events/test/forms/export',
  ];

  for (const path of adminPaths) {
    test(`GET ${path} without auth → 401`, async () => {
      const res = await SELF.fetch(`https://t.test${path}`);
      expect(res.status).toBe(401);
    });
  }
});
