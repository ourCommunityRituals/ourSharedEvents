/**
 * OSE-722 [BLOCKER] — per-ID sponsor SUB-resource handlers lack brand-scope.
 * Red-team spec (#9 sibling of OSE-710).
 *
 * VERIFIED GAP: handleSetSponsorEventTypes / handleGetSponsorEventTypes /
 * handleSetSponsorAreas / handleGetSponsorAreas took the :id straight to SQL on
 * sponsor_event_types / sponsor_areas with NO brand-scope predicate — so a
 * brand-A operator who knows a brand-B sponsor id could read AND replace its
 * event-types / service areas cross-tenant. Same INVARIANT #9 hole OSE-710
 * closed on the sponsor GET/PUT/DELETE verbs, one level down.
 *
 * The fix gates every sub-resource handler on isSponsorReachable() — the PARENT
 * sponsor must be inside the caller's authorized brand scope, else 404
 * (indistinguishable from "does not exist"). This spec proves brand-A cannot
 * reach brand-B on any of the four verbs and that a cross-tenant PUT lands no
 * write, while the legitimate brand-A id still works.
 *
 * @born-red invariant#9 | method: cross-tenant-per-id-subresource | date: 2026-08-12
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  handleSetSponsorEventTypes,
  handleGetSponsorEventTypes,
  handleSetSponsorAreas,
  handleGetSponsorAreas,
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
      if (msg.includes('no such column')) continue;
      throw e;
    }
  }
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
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
  return new Request('https://x/api/v2/admin/sponsors/x/event-types', init);
}
function reqAnon(method = 'GET', body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request('https://x/api/v2/admin/sponsors/x/areas', init);
}

const sEnv = env as unknown as SponsorsEnv;

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare(
    "INSERT INTO events (id, brand_id, title, slug, status) VALUES ('evt-A1','brand-A','A','slug-a','active')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO events (id, brand_id, title, slug, status) VALUES ('evt-B1','brand-B','B','slug-b','active')"
  ).run();
  // OSE-799 A2: split model; each business inherits its event's brand (the #9 key).
  await seedSplitSponsor(env.DB, { id: 'sp-A1', eventId: 'evt-A1', name: 'Acme A', tier: 'gold' });
  await seedSplitSponsor(env.DB, {
    id: 'sp-B1',
    eventId: 'evt-B1',
    name: 'Competitor B',
    tier: 'gold',
  });
  // Brand-B sponsor already has one event-type + one area — the cross-tenant
  // caller must not be able to see or clobber them.
  await env.DB.prepare(
    "INSERT INTO sponsor_event_types (id, sponsor_id, template_id) VALUES ('set-B1','sp-B1','bar_night')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO sponsor_areas (id, sponsor_id, zip_code, radius_miles) VALUES ('sa-B1','sp-B1','60601',10)"
  ).run();

  sEnv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({ 'a@brand-a.test': ['brand-A'] });
});

describe('OSE-722 / #9 — sub-resource GET is brand-scoped', () => {
  test('brand-A CAN read their own sponsor event-types', async () => {
    const res = await handleGetSponsorEventTypes(reqAsEmail('a@brand-a.test'), sEnv, 'sp-A1');
    expect(res.status).toBe(200);
  });

  test('brand-A CANNOT read a brand-B sponsor event-types (404, no leak)', async () => {
    const res = await handleGetSponsorEventTypes(reqAsEmail('a@brand-a.test'), sEnv, 'sp-B1');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; items?: unknown };
    expect(body.ok).toBe(false);
    expect(body.items).toBeUndefined();
  });

  test('brand-A CANNOT read a brand-B sponsor areas (404)', async () => {
    const res = await handleGetSponsorAreas(reqAsEmail('a@brand-a.test'), sEnv, 'sp-B1');
    expect(res.status).toBe(404);
  });

  test('anon + unmapped operators reach nothing (fail-closed)', async () => {
    expect((await handleGetSponsorEventTypes(reqAnon(), sEnv, 'sp-A1')).status).toBe(404);
    expect(
      (await handleGetSponsorAreas(reqAsEmail('outsider@nowhere.test'), sEnv, 'sp-A1')).status
    ).toBe(404);
  });
});

describe('OSE-722 / #9 — sub-resource SET is brand-scoped (cross-tenant MUTATION)', () => {
  test('brand-A CANNOT replace a brand-B sponsor event-types (404, no write)', async () => {
    const res = await handleSetSponsorEventTypes(
      reqAsEmail('a@brand-a.test', 'PUT', { template_ids: ['pwned'] }),
      sEnv,
      'sp-B1'
    );
    expect(res.status).toBe(404);
    // brand-B's original mapping is untouched — the DELETE+INSERT never ran.
    const rows = await env.DB.prepare(
      "SELECT template_id FROM sponsor_event_types WHERE sponsor_id = 'sp-B1'"
    ).all<{ template_id: string }>();
    const ids = (rows.results ?? []).map((r) => r.template_id);
    expect(ids).toEqual(['bar_night']);
    expect(ids).not.toContain('pwned');
  });

  test('brand-A CANNOT replace a brand-B sponsor areas (404, no write)', async () => {
    const res = await handleSetSponsorAreas(
      reqAsEmail('a@brand-a.test', 'PUT', { areas: [{ zip_code: '90210' }] }),
      sEnv,
      'sp-B1'
    );
    expect(res.status).toBe(404);
    const rows = await env.DB.prepare(
      "SELECT zip_code FROM sponsor_areas WHERE sponsor_id = 'sp-B1'"
    ).all<{ zip_code: string }>();
    expect((rows.results ?? []).map((r) => r.zip_code)).toEqual(['60601']);
  });

  test('unmapped operator CANNOT mutate any sub-resource (fail-closed)', async () => {
    const res = await handleSetSponsorEventTypes(
      reqAsEmail('outsider@nowhere.test', 'PUT', { template_ids: ['x'] }),
      sEnv,
      'sp-A1'
    );
    expect(res.status).toBe(404);
    const cnt = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM sponsor_event_types WHERE sponsor_id = 'sp-A1'"
    ).first<{ c: number }>();
    expect(cnt?.c).toBe(0); // sp-A1 still has no event-types — nothing was written
  });

  test('brand-A CAN replace their own sponsor event-types', async () => {
    const res = await handleSetSponsorEventTypes(
      reqAsEmail('a@brand-a.test', 'PUT', { template_ids: ['trivia', 'darts'] }),
      sEnv,
      'sp-A1'
    );
    expect(res.status).toBe(200);
    const rows = await env.DB.prepare(
      "SELECT template_id FROM sponsor_event_types WHERE sponsor_id = 'sp-A1' ORDER BY template_id"
    ).all<{ template_id: string }>();
    expect((rows.results ?? []).map((r) => r.template_id)).toEqual(['darts', 'trivia']);
  });
});
