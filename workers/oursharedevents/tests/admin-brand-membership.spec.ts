/**
 * OSE-666 / B2 — audited membership table backs admin brand scope (#9 + #24).
 *
 * The admin_brand_memberships table (migration 0050) is the source of truth for
 * "which brand(s) + role an operator has", replacing the interim env map. Scope
 * is still server-derived from the caller's verified email, never a client
 * brand_id, and still fail-closed.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleAdminListEvents, type EventsEnv } from '../src/handlers/events';
import { resolveAdminBrandScopeAsync, resolveAdminRoles } from '../src/lib/admin-brand-scope';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
}

const eventsEnv = env as unknown as EventsEnv & { ADMIN_BRAND_MEMBERSHIP?: string };

function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function reqAsEmail(email: string): Request {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64url({ alg: 'none' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.s`;
  return new Request('https://x/api/v2/admin/events', {
    headers: { 'Cf-Access-Jwt-Assertion': jwt },
  });
}

async function seedMembership(email: string, brandId: string, role: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO admin_brand_memberships (email, brand_id, role)
     VALUES (?, ?, ?) ON CONFLICT(email, brand_id) DO UPDATE SET role = excluded.role`
  )
    .bind(email, brandId, role)
    .run();
}

async function seedEvent(id: string, brandId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, ?, ?, 'active')
     ON CONFLICT(id) DO NOTHING`
  )
    .bind(id, brandId, `E ${id}`, `slug-${id}`)
    .run();
}

interface ListBody {
  ok: boolean;
  items: Array<{ id: string; brand_id: string }>;
}

beforeAll(async () => {
  await applyMigrations();
  await seedEvent('b2-evt-A', 'b2-brand-A');
  await seedEvent('b2-evt-A2', 'b2-brand-A');
  await seedEvent('b2-evt-B', 'b2-brand-B');
  await seedMembership('owner@b2a.test', 'b2-brand-A', 'brand_owner');
});

describe('OSE-666/B2 — membership table backs brand scope', () => {
  test('an operator is scoped to the brand(s) in their membership rows', async () => {
    const res = await handleAdminListEvents(reqAsEmail('owner@b2a.test'), eventsEnv);
    const body = (await res.json()) as ListBody;
    expect(body.ok).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((e) => e.brand_id === 'b2-brand-A')).toBe(true);
    expect(body.items.some((e) => e.brand_id === 'b2-brand-B')).toBe(false);
  });

  test('the DB table WINS over the interim env map (table is source of truth)', async () => {
    const prev = eventsEnv.ADMIN_BRAND_MEMBERSHIP;
    try {
      // env map says brand-B, but the membership table says brand-A → table wins.
      eventsEnv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({ 'owner@b2a.test': ['b2-brand-B'] });
      const scope = await resolveAdminBrandScopeAsync('owner@b2a.test', eventsEnv);
      expect(scope).toEqual({ mode: 'scoped', brandIds: ['b2-brand-A'] });
    } finally {
      eventsEnv.ADMIN_BRAND_MEMBERSHIP = prev;
    }
  });

  test('an operator with NO membership row falls back to deny (fail-closed)', async () => {
    const prev = eventsEnv.ADMIN_BRAND_MEMBERSHIP;
    try {
      delete eventsEnv.ADMIN_BRAND_MEMBERSHIP; // no env-map fallback either
      const scope = await resolveAdminBrandScopeAsync('nobody@b2a.test', eventsEnv);
      expect(scope).toEqual({ mode: 'deny' });
    } finally {
      eventsEnv.ADMIN_BRAND_MEMBERSHIP = prev;
    }
  });

  test('resolveAdminRoles returns the role vocabulary from the table (OSE-671 groundwork)', async () => {
    const roles = await resolveAdminRoles('owner@b2a.test', eventsEnv);
    expect(roles).toEqual([{ brandId: 'b2-brand-A', role: 'brand_owner' }]);
  });

  test('a forged ?brand_id= cannot widen scope beyond the membership rows', async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = `${b64url({ alg: 'none' })}.${b64url({ email: 'owner@b2a.test', iat: now - 10, exp: now + 3600 })}.s`;
    const res = await handleAdminListEvents(
      new Request('https://x/api/v2/admin/events?brand_id=b2-brand-B', {
        headers: { 'Cf-Access-Jwt-Assertion': jwt },
      }),
      eventsEnv
    );
    const body = (await res.json()) as ListBody;
    expect(body.items.some((e) => e.brand_id === 'b2-brand-B')).toBe(false);
  });
});
