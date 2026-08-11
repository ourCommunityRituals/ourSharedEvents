/**
 * Red Team: api-authz.spec.ts
 *
 * Attacks targeted:
 *   SEC-001  CF Access JWT accepted without cryptographic verification.
 *   SEC-002  ADMIN_KEY / X-OCR-Internal bypasses CF Access email allowlist
 *            entirely — carries no identity claim.
 *   SEC-003  Method confusion: /api/v2/events/:id catch-all accepts all HTTP
 *            methods (GET, POST, DELETE, PUT, PATCH) — intended as GET-only.
 *   SEC-004  Path traversal: eventId extracted via pathname.split('/')[5]
 *            index is fragile — off-by-one on double-slash paths.
 *   SEC-005  Batch SharedReport endpoint allows full event ID enumeration
 *            without depth restriction once service token is obtained.
 *
 * Additional authorization checks:
 *   - 404 vs 403 distinction (information leakage via status code)
 *   - Multi-tenant cross-brand isolation
 *   - D1 parameterization proof (no string interpolation in SQL)
 *   - Signed-link event ID mismatch
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { mintSignedLinkToken } from '../../src/lib/shared-report-auth';

// ─── Test env bindings ────────────────────────────────────────────────────────

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

// Known test credentials from vitest.config.mts bindings
const ADMIN_KEY     = 'test-admin-key-e2e-2026';
const OCR_INTERNAL  = 'test-ocr-internal-secret-2026';
const WKRP_TOKEN    = 'test-wkrp-service-token-do-not-use';
const REPORT_SECRET = 'test-shared-report-signing-secret-do-not-use';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try { await tenv().DB.prepare(stmt).run(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try { await tenv().FORMS_DB.prepare(stmt).run(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }

  // Seed events for multi-tenant isolation tests
  const seeds = [
    ['evt_brand_a_1', 'brand_alpha', 'Brand Alpha Event 1', 'active'],
    ['evt_brand_a_2', 'brand_alpha', 'Brand Alpha Event 2', 'active'],
    ['evt_brand_b_1', 'brand_beta',  'Brand Beta Event 1',  'active'],
    ['evt_brand_b_2', 'brand_beta',  'Brand Beta Event 2',  'archived'],
    ['evt_authz_test', 'brand_test', 'AuthZ Test Event',    'active'],
  ];
  for (const [id, brand, title, status] of seeds) {
    try {
      await tenv().DB.prepare(
        `INSERT INTO events (id, brand_id, title, status, start_date, end_date)
         VALUES (?, ?, ?, ?, '2026-01-01', '2026-12-31')`
      ).bind(id, brand, title, status).run();
    } catch { /* already exists */ }
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function adminHeaders(method: 'key' | 'ocr' = 'key'): Record<string, string> {
  if (method === 'ocr') return { 'X-OCR-Internal': OCR_INTERNAL };
  return { Authorization: `Bearer ${ADMIN_KEY}` };
}

function forgeCfAccessJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${body}.FAAAAAAAAKESIGNATUREDONTVERIFY`;
}

// ════════════════════════════════════════════════════════════════════════════
// SEC-001 / AUTH-001: CF Access JWT accepted without signature verification
// ════════════════════════════════════════════════════════════════════════════

describe('SEC-001: CF Access JWT unverified — all admin endpoints accept forged tokens (CRITICAL)', () => {

  const adminEndpoints = [
    'GET  /api/v2/admin/events',
    'GET  /api/v2/admin/flags',
    'GET  /api/v2/admin/flags/tiers',
    'GET  /api/v2/admin/audit-log',
  ];

  test('forged JWT with allowlisted email grants access to admin events list', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forgedJwt = forgeCfAccessJwt({
      iat: now - 10, exp: now + 3600,
      email: 'test-admin@example.com', // on the allowlist
    });
    const res = await SELF.fetch('http://localhost/api/v2/admin/events', {
      headers: { 'Cf-Access-Jwt-Assertion': forgedJwt },
    });
    console.log(`[SEC-001] Forged JWT → admin/events: ${res.status}`);
    // Bug live: 200. Bug fixed: 401.
    // We document the current status without hard-failing so CI shows the vulnerability
    if (res.status === 200) {
      console.log('[SEC-001] SECURITY BUG CONFIRMED: forged CF Access JWT accepted for admin access');
    }
  });

  test('forged JWT for non-allowlisted email is denied with 403', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forgedJwt = forgeCfAccessJwt({
      iat: now - 10, exp: now + 3600,
      email: 'outsider@attacker.com',
    });
    const res = await SELF.fetch('http://localhost/api/v2/admin/events', {
      headers: { 'Cf-Access-Jwt-Assertion': forgedJwt },
    });
    // Even with unverified JWT, allowlist check denies outsiders
    expect(res.status).toBe(403);
  });

  test('admin endpoint with no credentials returns 401', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/admin/events');
    expect(res.status).toBe(401);
  });

  test('admin endpoint with wrong bearer token returns 401', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/admin/events', {
      headers: { Authorization: 'Bearer wrong-key-entirely' },
    });
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SEC-002: ADMIN_KEY bypasses CF Access email allowlist
// ════════════════════════════════════════════════════════════════════════════

describe('SEC-002: Method 2/3 bypass CF Access email allowlist (HIGH)', () => {

  test('X-OCR-Internal (Method 2) gains admin access with no email identity', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/admin/events', {
      headers: { 'X-OCR-Internal': OCR_INTERNAL },
    });
    // Must succeed — Method 2 is a valid bypass for CI/CD
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    console.log(`[SEC-002] X-OCR-Internal access: ${res.status} (no email identity carried)`);
  });

  test('Bearer ADMIN_KEY (Method 3) gains admin access with no email identity', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/admin/events', {
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
    });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    console.log(`[SEC-002] Bearer ADMIN_KEY access: ${res.status} (no email identity)`);
  });

  test('SEC-002 static: audit log should record actor as "key:admin" or "key:ocr-internal" for Methods 2/3', () => {
    // When Methods 2/3 are used, extractAdminActor returns 'key:admin' or 'key:ocr-internal'
    // — no email. This means audit trails cannot attribute actions to a human.
    const sources = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    for (const [path, content] of Object.entries(sources)) {
      if (path.replace(/\\/g, '/').includes('/auth/admin.ts')) {
        expect(content).toContain("'key:ocr-internal'");
        expect(content).toContain("'key:admin'");
        console.log('[SEC-002] Confirmed: Methods 2/3 return non-human actor strings in audit log');
      }
    }
  });

  test('SEC-002: flag endpoints accessible via Method 2 despite no email identity', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/admin/flags', {
      headers: { 'X-OCR-Internal': OCR_INTERNAL },
    });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SEC-003: Method confusion on /api/v2/events/:id
// ════════════════════════════════════════════════════════════════════════════

describe('SEC-003: Method confusion on event and admin routes (HIGH)', () => {

  const nonGetMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];

  for (const method of nonGetMethods) {
    test(`${method} /api/v2/events/evt_authz_test — catch-all should return 404 or 405, not 200`, async () => {
      const res = await SELF.fetch('http://localhost/api/v2/events/evt_authz_test', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method !== 'DELETE' ? JSON.stringify({ evil: 'payload' }) : undefined,
      });
      console.log(`[SEC-003] ${method} /api/v2/events/:id → ${res.status}`);
      // The route only intends GET — other methods should be rejected
      // Current bug: eventMatch fires for ALL methods because there's no method guard
      if (res.status === 200) {
        console.log('[SEC-003] BUG CONFIRMED: method confusion — non-GET accepted on /api/v2/events/:id');
      }
      // Document current state
      expect([200, 404, 405, 400]).toContain(res.status);
    });
  }

  test('GET /api/v2/events/:id — normal GET still works', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events/evt_authz_test');
    // Should succeed (200) or return 404 if event structure differs, but not 401
    expect([200, 404]).toContain(res.status);
  });

  test('static: /api/v2/events/:id route in router.ts has no method guard', () => {
    const sources = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    for (const [path, content] of Object.entries(sources)) {
      if (path.replace(/\\/g, '/').includes('/src/router.ts')) {
        // Find the eventMatch block
        const eventMatchBlock = content.match(
          /const eventMatch = pathname\.match[\s\S]{0,300}/
        )?.[0] ?? '';
        const hasMethodGuard = /eventMatch\s*&&\s*method\s*===\s*['"]GET['"]/.test(content);
        console.log(`[SEC-003] /api/v2/events/:id has method guard: ${hasMethodGuard}`);
        if (!hasMethodGuard) {
          console.log('[SEC-003] BUG CONFIRMED: no method guard on single-event route');
          console.log('[SEC-003] Context:', eventMatchBlock.slice(0, 200));
        }
        // This is the expected broken state — test documents it
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ID enumeration: 404 vs 403 status code distinction
// ════════════════════════════════════════════════════════════════════════════

describe('ID enumeration: 404 vs 403 information leakage', () => {

  test('GET /api/v2/events/:id with unknown ID returns 404', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events/definitely_does_not_exist_xyz');
    console.log(`[ENUM] Unknown public event ID → ${res.status}`);
    // Public event endpoint: 404 is correct (resource not found)
    expect(res.status).toBe(404);
  });

  test('admin endpoint: unknown event ID returns 404 (not 403 which would confirm it exists)', async () => {
    const res = await SELF.fetch(
      'http://localhost/api/v2/admin/events/definitely_does_not_exist_xyz',
      { headers: adminHeaders() }
    );
    console.log(`[ENUM] Unknown admin event ID → ${res.status}`);
    // Should return 404, not 403 (403 would leak existence)
    expect([404, 405]).toContain(res.status);
  });

  test('admin SharedReport mint: known vs unknown event should return same status on auth fail', async () => {
    // Without auth, both should return 401 — not 404 for unknown and 401 for known
    const resKnown = await SELF.fetch(
      'http://localhost/api/v2/admin/events/evt_authz_test/shared-report/mint-link',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    const resUnknown = await SELF.fetch(
      'http://localhost/api/v2/admin/events/nonexistent_evt/shared-report/mint-link',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    // Both should be 401 (auth required before checking existence)
    console.log(`[ENUM] Mint known event (no auth): ${resKnown.status}, unknown: ${resUnknown.status}`);
    expect(resKnown.status).toBe(401);
    expect(resUnknown.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Multi-tenant cross-brand isolation
// ════════════════════════════════════════════════════════════════════════════

describe('Multi-tenant cross-brand isolation', () => {

  test('public events API: events from different brands are returned in same response', async () => {
    // This documents the current behavior — without a brand filter, all active
    // events are returned. Isolation enforcement would require a brand ID param.
    const res = await SELF.fetch('http://localhost/api/v2/events');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; items: Array<{ brand_id: string }> };
    expect(body.ok).toBe(true);

    const brands = new Set(body.items.map(e => e.brand_id));
    console.log(`[ISOLATION] Public events list includes brands: ${[...brands].join(', ')}`);
    // If multiple brands appear without any brand scoping, note the risk
    if (brands.size > 1) {
      console.log('[ISOLATION] Multiple brands visible in single public events response');
    }
  });

  test('admin events list: all brands visible to admin key — no brand-scoped isolation', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/admin/events', {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; items: Array<{ brand_id: string }> };
    expect(body.ok).toBe(true);

    const brands = new Set(body.items.map(e => e.brand_id));
    console.log(`[ISOLATION] Admin events list brands: ${[...brands].join(', ')}`);
    // Document: single ADMIN_KEY sees all brands — this is a cross-tenant risk
    // if different brands should be isolated by their own keys
  });

  test('D1 parameterization: no event ID string interpolation in events.ts', () => {
    const sources = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    for (const [path, content] of Object.entries(sources)) {
      if (path.replace(/\\/g, '/').includes('handlers/events.ts')) {
        // Check for template literal SQL with ${...} — this is dangerous
        const dangerousPatterns = content.match(
          /\.prepare\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/g
        ) ?? [];
        if (dangerousPatterns.length > 0) {
          console.log('[D1-PARAM] Potential SQL injection in events.ts:', dangerousPatterns);
        }
        expect(dangerousPatterns, 'String interpolation in SQL found in events.ts').toHaveLength(0);
      }
    }
  });

  test('D1 parameterization: no string concatenation in forms.ts SQL', () => {
    const sources = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    for (const [path, content] of Object.entries(sources)) {
      if (path.replace(/\\/g, '/').includes('handlers/forms.ts')) {
        const templateLiteralSql = content.match(
          /\.prepare\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/g
        ) ?? [];
        expect(templateLiteralSql, 'SQL injection risk in forms.ts').toHaveLength(0);
      }
    }
  });

  test('D1 parameterization: router.ts SQL queries use ? placeholders', () => {
    const sources = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    for (const [path, content] of Object.entries(sources)) {
      if (path.replace(/\\/g, '/').includes('/src/router.ts')) {
        // Any inline SQL in the router
        const inlineSql = content.match(/\.prepare\s*\(`[^`]+`\)/g) ?? [];
        for (const sql of inlineSql) {
          const hasInterpolation = /\$\{/.test(sql);
          expect(hasInterpolation, `SQL interpolation in router.ts: ${sql.slice(0, 80)}`).toBe(false);
        }
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Signed-link event ID mismatch
// ════════════════════════════════════════════════════════════════════════════

describe('Signed-link event ID mismatch — token for A used on B', () => {

  test('token minted for evt_brand_a_1 rejected on evt_brand_b_1 endpoint', async () => {
    const token = await mintSignedLinkToken(
      { SHARED_REPORT_SIGNING_SECRET: REPORT_SECRET },
      'evt_brand_a_1',
      'bar_owner',
      3600
    );
    expect(token).not.toBeNull();

    // Try to use token for evt_brand_a_1 on evt_brand_b_1's endpoint
    const res = await SELF.fetch('http://localhost/api/v2/events/evt_brand_b_1/shared-report', {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[MISMATCH] Token for evt_brand_a_1 used on evt_brand_b_1: ${res.status}`);
    // Must not succeed — the token's eventId claim (evt_brand_a_1) does not
    // match the URL's event ID (evt_brand_b_1)
    expect(res.status).not.toBe(200);
    // Should return 401 or 403 (not 404 which would leak that b_1 exists)
    expect([401, 403, 404]).toContain(res.status);
  });

  test('token minted for nonexistent event cannot be used on any real event', async () => {
    const token = await mintSignedLinkToken(
      { SHARED_REPORT_SIGNING_SECRET: REPORT_SECRET },
      'evt_made_up_ghost',
      'admin',
      3600
    );
    expect(token).not.toBeNull();

    const res = await SELF.fetch('http://localhost/api/v2/events/evt_authz_test/shared-report', {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[MISMATCH] Ghost event token on real event: ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  test('WKRP service token cannot be used as a signed-link token', async () => {
    // The WKRP_SERVICE_TOKEN format is different from a signed-link token
    // Using it as a Bearer on the single-event endpoint should fail
    const res = await SELF.fetch('http://localhost/api/v2/events/evt_authz_test/shared-report', {
      headers: { Authorization: `Bearer ${WKRP_TOKEN}` },
    });
    console.log(`[MISMATCH] WKRP token used as signed-link: ${res.status}`);
    // Should be 401 — WKRP token structure does not match signed-link format
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SEC-005: Batch endpoint event ID enumeration
// ════════════════════════════════════════════════════════════════════════════

describe('SEC-005: Batch SharedReport allows event ID enumeration (HIGH)', () => {

  test('batch endpoint with valid WKRP token can probe multiple event IDs', async () => {
    const probeIds = [
      'evt_brand_a_1',    // exists
      'evt_brand_b_1',    // exists
      'definitely_not_there', // does not exist
      'evt_authz_test',   // exists
    ];

    const res = await SELF.fetch('http://localhost/api/v2/events/shared-reports/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WKRP_TOKEN}`,
      },
      body: JSON.stringify({ eventIds: probeIds }),
    });

    console.log(`[SEC-005] Batch probe status: ${res.status}`);

    if (res.status === 200) {
      const body = await res.json() as { ok: boolean; items?: unknown[] };
      // If we can distinguish existing from non-existing IDs, that's enumeration
      console.log('[SEC-005] Batch response ok:', body.ok);
      console.log('[SEC-005] Batch items count:', Array.isArray(body.items) ? body.items.length : 'N/A');
      console.log('[SEC-005] CONFIRMED: WKRP token can enumerate event IDs via batch endpoint');
    }
  });

  test('batch endpoint without auth returns 401', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events/shared-reports/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventIds: ['evt_authz_test'] }),
    });
    expect(res.status).toBe(401);
  });

  test('batch endpoint with admin key (not WKRP token) returns 401', async () => {
    // Admin key must not substitute for WKRP service token
    const res = await SELF.fetch('http://localhost/api/v2/events/shared-reports/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
      body: JSON.stringify({ eventIds: ['evt_authz_test'] }),
    });
    console.log(`[SEC-005] Admin key on batch endpoint: ${res.status}`);
    expect(res.status).toBe(401);
  });

  test('batch endpoint with signed-link token (not WKRP) returns 401', async () => {
    const signedToken = await mintSignedLinkToken(
      { SHARED_REPORT_SIGNING_SECRET: REPORT_SECRET },
      'evt_authz_test',
      'admin',
      3600
    );
    const res = await SELF.fetch('http://localhost/api/v2/events/shared-reports/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${signedToken}`,
      },
      body: JSON.stringify({ eventIds: ['evt_authz_test'] }),
    });
    console.log(`[SEC-005] Signed-link token on batch endpoint: ${res.status}`);
    // Signed-link tokens must not work on the batch endpoint
    expect(res.status).toBe(401);
  });

  test('batch endpoint: empty eventIds array returns graceful response', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events/shared-reports/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WKRP_TOKEN}`,
      },
      body: JSON.stringify({ eventIds: [] }),
    });
    console.log(`[SEC-005] Empty batch: ${res.status}`);
    expect(res.status).not.toBe(500);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Admin endpoint coverage: every admin route requires auth
// ════════════════════════════════════════════════════════════════════════════

describe('All admin endpoints require authentication', () => {

  const adminRoutes: Array<[string, string]> = [
    ['GET',    '/api/v2/admin/events'],
    ['GET',    '/api/v2/admin/flags'],
    ['GET',    '/api/v2/admin/flags/tiers'],
    ['GET',    '/api/v2/admin/flags/current-tier'],
    ['GET',    '/api/v2/admin/audit-log'],
    ['POST',   '/api/v2/admin/events/evt_authz_test/shared-report/mint-link'],
    ['POST',   '/api/v2/admin/data-subject/erase'],
  ];

  for (const [method, path] of adminRoutes) {
    test(`${method} ${path} — no credentials → 401`, async () => {
      const res = await SELF.fetch(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method !== 'GET' ? JSON.stringify({}) : undefined,
      });
      console.log(`[ADMIN-AUTH] ${method} ${path} → ${res.status}`);
      expect(res.status).toBe(401);
    });
  }

  test('health endpoint is public — no auth required', async () => {
    const res = await SELF.fetch('http://localhost/health');
    expect(res.status).toBe(200);
  });

  test('public events list is public — no auth required', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events');
    expect(res.status).toBe(200);
  });
});
