/**
 * Admin events list — server-side brand scoping (INVARIANT #9 tenant_isolation).
 *
 * HISTORY. handleAdminListEvents (events.ts) used to issue
 *   `SELECT ... FROM events ORDER BY created_at DESC LIMIT ?`
 * with NO `WHERE brand_id`, so on a shared multi-tenant instance a brand-A
 * operator received brand B's events — a live #9 breach (enterprise/admin fleet
 * rank 1). OSE-666/B1 closed it: the list now derives the caller's brand scope
 * from the SERVER-VERIFIED actor identity (extractAdminActor -> the CF Access
 * email) via resolveAdminBrandScope, fail-closed.
 *
 * This spec was born red: it shipped first as a characterization tripwire that
 * asserted the leak (green while broken), then — when B1 landed — the tripwire
 * was retired and the TARGET CONTRACT below was armed. These tests now enforce
 * the wall: they fail if scoping regresses to the unscoped SELECT.
 *
 * @born-red invariant#9 | method: characterization-tripwire -> armed-target | armed: 2026-08-07
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleAdminListEvents, type EventsEnv } from '../src/handlers/events';

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

const eventsEnv = env as unknown as EventsEnv;

/** base64url-encode a JSON object (no padding), for a decode-only fake JWT. */
function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A request carrying a CF Access JWT with the given email. extractAdminActor
 * DECODES the payload (no signature verify at that layer), so an unsigned token
 * is sufficient to exercise identity-derived scope in-test.
 */
function reqAsEmail(email: string, query = ''): Request {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.sig`;
  return new Request(`https://x/api/v2/admin/events${query}`, {
    headers: { 'Cf-Access-Jwt-Assertion': jwt },
  });
}

function reqAnon(query = ''): Request {
  return new Request(`https://x/api/v2/admin/events${query}`);
}

interface EventRow {
  id: string;
  brand_id: string;
}
interface ListBody {
  ok: boolean;
  items: EventRow[];
}

async function list(req: Request): Promise<ListBody> {
  const res = await handleAdminListEvents(req, eventsEnv);
  return (await res.json()) as ListBody;
}

beforeAll(async () => {
  await applyMigrations();
  await seedEvent('evt-A1', 'brand-A', 'Brand A Launch');
  await seedEvent('evt-A2', 'brand-A', 'Brand A Followup');
  await seedEvent('evt-B1', 'brand-B', 'Brand B Gala');

  // Interim membership source (B2 replaces with an audited table). brand-A
  // operator is mapped; the "outsider" email is deliberately absent. Note the
  // email-actor path ignores ADMIN_SCOPE_ALL entirely (it only ever elevates
  // `key:` actors), so the global test opt-in cannot mask these assertions.
  eventsEnv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({ 'a@brand-a.test': ['brand-A'] });
});

describe('INVARIANT #9 — admin events list is scoped to the caller brand', () => {
  test('a brand-A operator receives ONLY brand-A events', async () => {
    const body = await list(reqAsEmail('a@brand-a.test'));
    expect(body.ok).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((e) => e.brand_id === 'brand-A')).toBe(true);
  });

  test('cross-tenant isolation: a brand-A operator never receives a brand-B event', async () => {
    const body = await list(reqAsEmail('a@brand-a.test'));
    expect(body.items.some((e) => e.brand_id === 'brand-B')).toBe(false);
  });

  test('deny-all-until-scoped: an unmapped operator receives ZERO rows, not all rows', async () => {
    const body = await list(reqAsEmail('outsider@nowhere.test'));
    expect(body.items.length).toBe(0);
  });

  test('unauthenticated caller is denied (fail-closed), never handed the table', async () => {
    const body = await list(reqAnon());
    expect(body.items.length).toBe(0);
  });

  test('scope is server-derived, not caller-chosen: a forged ?brand_id= cannot widen the set', async () => {
    const body = await list(reqAsEmail('a@brand-a.test', '?brand_id=brand-B'));
    expect(body.items.some((e) => e.brand_id === 'brand-B')).toBe(false);
    expect(body.items.every((e) => e.brand_id === 'brand-A')).toBe(true);
  });
});

describe('INVARIANT #9 — automation opt-in (key actor + ADMIN_SCOPE_ALL) is the only unscoped path', () => {
  test('a key actor with ADMIN_SCOPE_ALL=true sees all brands (CI/automation)', async () => {
    const prev = (eventsEnv as { ADMIN_SCOPE_ALL?: string }).ADMIN_SCOPE_ALL;
    const prevAllow = (eventsEnv as { ALLOW_ADMIN_KEY_FALLBACK?: string }).ALLOW_ADMIN_KEY_FALLBACK;
    const prevKey = (eventsEnv as { ADMIN_KEY?: string }).ADMIN_KEY;
    try {
      (eventsEnv as { ADMIN_SCOPE_ALL?: string }).ADMIN_SCOPE_ALL = 'true';
      (eventsEnv as { ALLOW_ADMIN_KEY_FALLBACK?: string }).ALLOW_ADMIN_KEY_FALLBACK = 'true';
      (eventsEnv as { ADMIN_KEY?: string }).ADMIN_KEY = 'ci-secret-token';
      const req = new Request('https://x/api/v2/admin/events', {
        headers: { Authorization: 'Bearer ci-secret-token' },
      });
      const body = (await handleAdminListEvents(req, eventsEnv).then((r) => r.json())) as ListBody;
      const brands = new Set(body.items.map((e) => e.brand_id));
      expect(brands.has('brand-A')).toBe(true);
      expect(brands.has('brand-B')).toBe(true);
    } finally {
      (eventsEnv as { ADMIN_SCOPE_ALL?: string }).ADMIN_SCOPE_ALL = prev;
      (eventsEnv as { ALLOW_ADMIN_KEY_FALLBACK?: string }).ALLOW_ADMIN_KEY_FALLBACK = prevAllow;
      (eventsEnv as { ADMIN_KEY?: string }).ADMIN_KEY = prevKey;
    }
  });
});
