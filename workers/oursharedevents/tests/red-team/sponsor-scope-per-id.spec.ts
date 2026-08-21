/**
 * OSE-710 [BLOCKER] — per-ID sponsor endpoints lack brand-scope (cross-tenant
 * mutation). Red-team spec.
 *
 * VERIFIED GAP: resolveAdminBrandScopeAsync is enforced ONLY at the sponsors
 * LIST endpoint (handleAdminListSponsors). handleAdminGetSponsor /
 * handleAdminUpdateSponsor / handleAdminDeleteSponsor took an :id straight to
 * the SQL with NO brand-scope predicate — so a brand-A operator who knows (or
 * guesses/enumerates) a brand-B sponsor id could GET / PUT / DELETE it. That is
 * a live INVARIANT #9 (tenant_isolation) hole: read + cross-tenant MUTATION.
 *
 * This spec seeds a brand-A operator and a brand-B sponsor and asserts the
 * brand-A actor CANNOT reach the brand-B id on any per-ID verb (404/empty on
 * GET, 404 on PUT/DELETE — indistinguishable from "does not exist", so the id
 * is not even confirmed to exist), while the legitimate brand-A id still works.
 * Anonymous / unmapped callers reach nothing (fail-closed).
 *
 * Enforcement mirrors the list endpoint: the scope predicate lives in the SQL
 * WHERE (event_id IN (SELECT id FROM events WHERE brand_id IN (...scope))),
 * bound-parameterised, never a client-side filter a query string could widen.
 *
 * @born-red invariant#9 | method: cross-tenant-per-id-mutation | date: 2026-08-11
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  handleAdminGetSponsor,
  handleAdminUpdateSponsor,
  handleAdminDeleteSponsor,
  type SponsorsEnv,
} from '../../src/handlers/sponsors';
import { seedSplitSponsor } from '../helpers/seed-sponsor';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

async function seedEvent(id: string, brandId: string, title: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status)
     VALUES (?, ?, ?, ?, 'active')`
  )
    .bind(id, brandId, title, `slug-${id}`)
    .run();
}

async function seedSponsor(id: string, eventId: string, name: string): Promise<void> {
  // OSE-799 A2: split model; sponsor_business.brand_id is inherited from the event.
  await seedSplitSponsor(env.DB, { id, eventId, name, tier: 'gold' });
}

/** base64url-encode a JSON object (no padding), for a decode-only fake JWT. */
function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A request carrying a CF Access JWT for the given email. extractAdminActor
 * DECODES the payload (no signature verify at that layer), so an unsigned token
 * is enough to exercise identity-derived scope in-test — mirrors the sponsor
 * list scope spec so both #9 enforcement points are proven the same way.
 */
function reqAsEmail(email: string, method = 'GET', body?: unknown): Request {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.sig`;
  const init: RequestInit = {
    method,
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request('https://x/api/v2/admin/sponsors/x', init);
}

function reqAnon(method = 'GET', body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request('https://x/api/v2/admin/sponsors/x', init);
}

const sponsorsEnv = env as unknown as SponsorsEnv;

beforeAll(async () => {
  await applyMigrations();
  // OSE-799 A2: THREE brands. Brand A has an operator; B and C do NOT — so any
  // brand-A reach into a B or C sponsor is provably a cross-tenant breach. The
  // third tenant (C) guards against a two-brand scope bug that only a wholly
  // unrelated bystander surfaces. Each business inherits its event's brand.
  await seedEvent('evt-A1', 'brand-A', 'Brand A Launch');
  await seedEvent('evt-B1', 'brand-B', 'Brand B Gala');
  await seedEvent('evt-C1', 'brand-C', 'Brand C Fair');
  await seedSponsor('sp-A1', 'evt-A1', 'Acme (A1)');
  await seedSponsor('sp-B1', 'evt-B1', 'Competitor (B1)');
  await seedSponsor('sp-C1', 'evt-C1', 'Bystander (C1)');

  // Server-verified actor → brand-A only. Email actors ignore ADMIN_SCOPE_ALL,
  // so the global CI opt-in cannot mask these assertions.
  sponsorsEnv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({ 'a@brand-a.test': ['brand-A'] });
});

describe('OSE-710 / INVARIANT #9 — per-ID sponsor GET is brand-scoped', () => {
  test('brand-A operator CAN read their own sponsor', async () => {
    const res = await handleAdminGetSponsor(reqAsEmail('a@brand-a.test'), sponsorsEnv, 'sp-A1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; item: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.item.id).toBe('sp-A1');
  });

  test('brand-A operator CANNOT read a brand-B sponsor (forged id → 404/not-found)', async () => {
    const res = await handleAdminGetSponsor(reqAsEmail('a@brand-a.test'), sponsorsEnv, 'sp-B1');
    // 404, indistinguishable from "does not exist" — the id is never confirmed.
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; item?: unknown };
    expect(body.ok).toBe(false);
    expect(body.item).toBeUndefined();
  });

  test('brand-A operator CANNOT read a third-tenant (brand-C) sponsor either (404)', async () => {
    // OSE-799 A2: the bystander tenant — no shared event, no shared operator.
    const res = await handleAdminGetSponsor(reqAsEmail('a@brand-a.test'), sponsorsEnv, 'sp-C1');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; item?: unknown };
    expect(body.ok).toBe(false);
    expect(body.item).toBeUndefined();
  });

  test('unauthenticated caller CANNOT read any sponsor by id (fail-closed)', async () => {
    const res = await handleAdminGetSponsor(reqAnon(), sponsorsEnv, 'sp-A1');
    expect(res.status).toBe(404);
  });

  test('unmapped operator CANNOT read any sponsor by id (fail-closed)', async () => {
    const res = await handleAdminGetSponsor(
      reqAsEmail('outsider@nowhere.test'),
      sponsorsEnv,
      'sp-A1'
    );
    expect(res.status).toBe(404);
  });
});

describe('OSE-710 / INVARIANT #9 — per-ID sponsor UPDATE is brand-scoped (cross-tenant MUTATION)', () => {
  test('brand-A operator CANNOT rename a brand-B sponsor (forged id → 404, no write)', async () => {
    const res = await handleAdminUpdateSponsor(
      reqAsEmail('a@brand-a.test', 'PUT', { name: 'PWNED' }),
      sponsorsEnv,
      'sp-B1'
    );
    expect(res.status).toBe(404);
    // The brand-B row must be untouched — the mutation never landed.
    const row = await env.DB.prepare('SELECT name FROM sponsor_business WHERE id = ?')
      .bind('sp-B1')
      .first<{ name: string }>();
    expect(row?.name).toBe('Competitor (B1)');
  });

  test('unmapped operator CANNOT update any sponsor (fail-closed, no write)', async () => {
    const res = await handleAdminUpdateSponsor(
      reqAsEmail('outsider@nowhere.test', 'PUT', { name: 'PWNED2' }),
      sponsorsEnv,
      'sp-A1'
    );
    expect(res.status).toBe(404);
    const row = await env.DB.prepare('SELECT name FROM sponsor_business WHERE id = ?')
      .bind('sp-A1')
      .first<{ name: string }>();
    expect(row?.name).toBe('Acme (A1)');
  });

  test('brand-A operator CAN update their own sponsor', async () => {
    const res = await handleAdminUpdateSponsor(
      reqAsEmail('a@brand-a.test', 'PUT', { name: 'Acme Renamed' }),
      sponsorsEnv,
      'sp-A1'
    );
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT name FROM sponsor_business WHERE id = ?')
      .bind('sp-A1')
      .first<{ name: string }>();
    expect(row?.name).toBe('Acme Renamed');
  });
});

describe('OSE-710 / INVARIANT #9 — per-ID sponsor DELETE is brand-scoped (cross-tenant MUTATION)', () => {
  test('brand-A operator CANNOT soft-delete a brand-B sponsor (forged id → 404, row stays active)', async () => {
    const res = await handleAdminDeleteSponsor(
      reqAsEmail('a@brand-a.test', 'DELETE'),
      sponsorsEnv,
      'sp-B1'
    );
    expect(res.status).toBe(404);
    const row = await env.DB.prepare(
      'SELECT is_active FROM sponsor_placement WHERE sponsor_business_id = ?'
    )
      .bind('sp-B1')
      .first<{ is_active: number }>();
    expect(row?.is_active).toBe(1);
  });

  test('unauthenticated caller CANNOT delete any sponsor (fail-closed, row stays active)', async () => {
    const res = await handleAdminDeleteSponsor(reqAnon('DELETE'), sponsorsEnv, 'sp-A1');
    expect(res.status).toBe(404);
    const row = await env.DB.prepare(
      'SELECT is_active FROM sponsor_placement WHERE sponsor_business_id = ?'
    )
      .bind('sp-A1')
      .first<{ is_active: number }>();
    expect(row?.is_active).toBe(1);
  });

  test('brand-A operator CAN soft-delete their own sponsor', async () => {
    const res = await handleAdminDeleteSponsor(
      reqAsEmail('a@brand-a.test', 'DELETE'),
      sponsorsEnv,
      'sp-A1'
    );
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT is_active FROM sponsor_placement WHERE sponsor_business_id = ?'
    )
      .bind('sp-A1')
      .first<{ is_active: number }>();
    expect(row?.is_active).toBe(0);
  });
});
