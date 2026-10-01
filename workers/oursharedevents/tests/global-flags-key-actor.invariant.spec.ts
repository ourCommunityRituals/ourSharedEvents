/**
 * R-5 (OSE-850) — global flag mutations are key-actor only (INVARIANT #9).
 *
 * `PUT /api/v2/admin/flags/:key` and `POST /api/v2/admin/flags/apply-tier` change
 * every brand at once. There is no brand to scope them by, so the rule is about
 * actor class: `key:` automation may call them, and no human may, whatever the
 * role (brand_owner and the platform brand included). Before this, any
 * allowlisted email could flip a platform-wide flag.
 *
 * The key path must work with ADMIN_SCOPE_ALL unset, which is its real state in
 * production. The per-event override stays human-reachable inside the caller's
 * brand (scoped by OSE-1080's object guard; the owner-only capability arrives
 * with R-2 / OSE-841).
 *
 * @born-red invariant#9 | method: key-actor-only-global-mutation | armed: 2026-10-01
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { PLATFORM_BRAND_ID } from '../src/lib/admin-brand-scope';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv & { ADMIN_SCOPE_ALL?: string };
const SCOPE_ALL = routerEnv.ADMIN_SCOPE_ALL;

async function applyStatements(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode-only CF Access JWT (CF_ACCESS_TEAM_DOMAIN is unset in tests). */
function asEmail(email: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
  };
}

/** `key:ocr-internal`: the automation path production actually enables. */
const OCR_INTERNAL = { 'X-OCR-Internal': 'test-ocr-internal-secret-2026' };

async function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<Response> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const ctx = createExecutionContext();
  const res = await route(new Request(`https://ose.test${path}`, init), routerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const BRAND_A = 'gfk-a';
const BRAND_B = 'gfk-b';
const EVT_A = 'evt-gfk-A';
const EVT_B = 'evt-gfk-B';
const FLAG = 'forms.register';
const ROLES = ['brand_owner', 'organizer', 'sponsor_manager', 'staff'] as const;
const roleEmail = (role: string): string => `gfk-${role}@example.com`;
const PLATFORM_MEMBER = 'gfk-platform@example.com';

async function globalFlagRows(): Promise<string> {
  const rows = await tenv.FORMS_DB.prepare(
    `SELECT flag_key, enabled FROM feature_flags WHERE scope = 'global' ORDER BY flag_key`
  ).all();
  return JSON.stringify(rows.results ?? []);
}

beforeAll(async () => {
  await applyStatements(tenv.DB, tenv.TEST_MIGRATION_STATEMENTS);
  await applyStatements(tenv.FORMS_DB, tenv.TEST_FORMS_MIGRATION_STATEMENTS);
  for (const [id, brand] of [
    [EVT_A, BRAND_A],
    [EVT_B, BRAND_B],
  ]) {
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, ?, ?, 'active')`
    )
      .bind(id, brand, `GFK ${id}`, id.toLowerCase())
      .run();
  }
  for (const role of ROLES) {
    await tenv.DB.prepare(
      `INSERT INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, ?)`
    )
      .bind(roleEmail(role), BRAND_A, role)
      .run();
  }
  await tenv.DB.prepare(
    `INSERT INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`
  )
    .bind(PLATFORM_MEMBER, PLATFORM_BRAND_ID)
    .run();
});

afterEach(() => {
  routerEnv.ADMIN_SCOPE_ALL = SCOPE_ALL;
});

describe('R-5 — PUT /flags/:key refuses every human', () => {
  test.each([...ROLES])('%s in brand A → 403, flag unchanged', async (role) => {
    const before = await globalFlagRows();
    const res = await call('PUT', `/api/v2/admin/flags/${FLAG}`, asEmail(roleEmail(role)), {
      enabled: false,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('KEY_ACTOR_ONLY');
    expect(await globalFlagRows()).toBe(before);
  });

  test('a platform-brand member is still a human → 403', async () => {
    const res = await call('PUT', `/api/v2/admin/flags/${FLAG}`, asEmail(PLATFORM_MEMBER), {
      enabled: false,
    });
    expect(res.status).toBe(403);
  });

  test('a real key and an invented key give byte-identical refusals', async () => {
    const who = asEmail(roleEmail('brand_owner'));
    const real = await call('PUT', `/api/v2/admin/flags/${FLAG}`, who, { enabled: true });
    const fake = await call('PUT', '/api/v2/admin/flags/no.such.flag', who, { enabled: true });
    expect(real.status).toBe(403);
    expect(fake.status).toBe(403);
    expect(await real.text()).toBe(await fake.text());
  });

  test('a forged ?brand_id= grants nothing', async () => {
    const res = await call(
      'PUT',
      `/api/v2/admin/flags/${FLAG}?brand_id=${PLATFORM_BRAND_ID}&scope=all`,
      asEmail(roleEmail('brand_owner')),
      { enabled: false, brand_id: PLATFORM_BRAND_ID, actor: 'key:admin' }
    );
    expect(res.status).toBe(403);
  });

  test('the refusal is audited as SET_FLAG denied', async () => {
    await call('PUT', `/api/v2/admin/flags/${FLAG}`, asEmail(roleEmail('staff')), {
      enabled: false,
    });
    const row = await tenv.DB.prepare(
      `SELECT outcome FROM admin_audit_log WHERE action = 'SET_FLAG' AND actor = ?
        ORDER BY created_at DESC LIMIT 1`
    )
      .bind(roleEmail('staff'))
      .first<{ outcome: string }>();
    expect(row?.outcome).toBe('denied');
  });

  test('unauthenticated → 401 (auth runs first)', async () => {
    expect((await call('PUT', `/api/v2/admin/flags/${FLAG}`, {}, { enabled: false })).status).toBe(
      401
    );
  });
});

describe('R-5 — POST /flags/apply-tier refuses every human', () => {
  test.each([...ROLES, 'platform'])('%s → 403, tier unchanged', async (role) => {
    const before = await globalFlagRows();
    const who = role === 'platform' ? PLATFORM_MEMBER : roleEmail(role);
    const res = await call('POST', '/api/v2/admin/flags/apply-tier', asEmail(who), {
      tier: 'enterprise',
    });
    expect(res.status).toBe(403);
    expect(await globalFlagRows()).toBe(before);
  });
});

describe('R-5 — key actors keep the path, with ADMIN_SCOPE_ALL unset', () => {
  test('key:ocr-internal sets a global flag', async () => {
    delete routerEnv.ADMIN_SCOPE_ALL;
    const res = await call('PUT', `/api/v2/admin/flags/${FLAG}`, OCR_INTERNAL, {
      enabled: false,
    });
    expect(res.status).toBe(200);
    const row = await tenv.FORMS_DB.prepare(
      `SELECT enabled FROM feature_flags WHERE scope = 'global' AND flag_key = ?`
    )
      .bind(FLAG)
      .first<{ enabled: number }>();
    expect(row?.enabled).toBe(0);
  });

  test('key:ocr-internal applies a tier', async () => {
    delete routerEnv.ADMIN_SCOPE_ALL;
    const res = await call('POST', '/api/v2/admin/flags/apply-tier', OCR_INTERNAL, {
      tier: 'free',
    });
    expect(res.status).toBe(200);
  });
});

describe('R-5 — per-event overrides stay human, inside the brand', () => {
  test("brand A's owner sets an override on an A event → 200", async () => {
    const res = await call(
      'PUT',
      `/api/v2/admin/events/${EVT_A}/flags/${FLAG}`,
      asEmail(roleEmail('brand_owner')),
      { enabled: false }
    );
    expect(res.status).toBe(200);
  });

  test("brand A's owner on a brand B event → 404, nothing written", async () => {
    const res = await call(
      'PUT',
      `/api/v2/admin/events/${EVT_B}/flags/${FLAG}`,
      asEmail(roleEmail('brand_owner')),
      { enabled: false }
    );
    expect(res.status).toBe(404);
    const row = await tenv.FORMS_DB.prepare(
      `SELECT COUNT(*) AS n FROM feature_flags WHERE scope = 'event' AND scope_id = ?`
    )
      .bind(EVT_B)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
