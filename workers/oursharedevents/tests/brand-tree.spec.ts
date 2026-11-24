/**
 * Brands that contain brands (Part of OSE-1553, OSE-1532).
 *
 * Owner, 2026-11-23: a company's ventures each run their own events as
 * separate brands, and the parent company reaches all of them. The tree is
 * `brand_parents` (migration 0118), read by lib/brand-tree.ts inside
 * resolveAdminBrandScopeAsync, the one place every admin route takes its scope.
 *
 * What this holds (Invariant #9, tenant isolation):
 *   - a member of the parent reaches the parent and every venture below it:
 *     lists their events, creates events in any of them;
 *   - a member of a venture reaches that venture only: never the parent, never
 *     a sibling, and cannot create in either;
 *   - automation actors (key:, svc:) are never widened by the tree;
 *   - the platform brand and the public brand never enter the tree (the table
 *     refuses them, and the walk drops them);
 *   - a loop or a deep chain stops (MAX_BRAND_DEPTH, MAX_REACHABLE_BRANDS);
 *   - the tree unreadable → exactly the member's own brands, never more.
 *
 * @born-red OSE-1553 | method: run before resolveAdminBrandScopeAsync called
 *   withDescendants (the expansion line taken out) | date: 2026-11-23 |
 *   verified: the parent-reach tests went red (the parent saw only its own
 *   events and its create in a venture was refused 403); the isolation tests
 *   stayed green, as they must.
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleAdminListEvents, handleCreateEvent, type EventsEnv } from '../src/handlers/events';
import {
  PLATFORM_BRAND_ID,
  PUBLIC_BRAND_ID,
  resolveAdminBrandScopeAsync,
} from '../src/lib/admin-brand-scope';
import { MAX_BRAND_DEPTH, withDescendants } from '../src/lib/brand-tree';

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

const eventsEnv = env as unknown as EventsEnv;

function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function jwtFor(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.s`;
}
function listAs(email: string): Request {
  return new Request('https://x/api/v2/admin/events', {
    headers: { 'Cf-Access-Jwt-Assertion': jwtFor(email) },
  });
}
function createAs(email: string, brandId: string, title: string): Request {
  return new Request('https://x/api/v2/admin/events', {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': jwtFor(email), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      brand_id: brandId,
      attendance_mode: 'in_person',
      location: 'Practice Hall',
      start_date: '2099-06-01',
    }),
  });
}

const CO = 'bt-co';
const CLUB = 'bt-club';
const LEAGUE = 'bt-league';
const NIGHT = 'bt-league-night'; // a league's own night, one level further down
const OTHER = 'bt-other'; // another company, outside the tree

const PARENT_ADMIN = 'owner@bt-co.test';
const CLUB_ADMIN = 'club@bt-co.test';
const LEAGUE_ADMIN = 'league@bt-co.test';

async function member(email: string, brand: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'organizer')
     ON CONFLICT(email, brand_id) DO NOTHING`
  )
    .bind(email, brand)
    .run();
}
async function parent(child: string, of: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES (?, ?)
     ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = excluded.parent_brand_id`
  )
    .bind(child, of)
    .run();
}
async function event(id: string, brand: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, ?, ?, 'draft')
     ON CONFLICT(id) DO NOTHING`
  )
    .bind(id, brand, `E ${id}`, `slug-${id}`)
    .run();
}
async function brandsSeenBy(email: string): Promise<Set<string>> {
  const res = await handleAdminListEvents(listAs(email), eventsEnv);
  const body = (await res.json()) as { items: Array<{ brand_id: string }> };
  return new Set(body.items.map((e) => e.brand_id));
}

beforeAll(async () => {
  await applyMigrations();
  await parent(CLUB, CO);
  await parent(LEAGUE, CO);
  await parent(NIGHT, LEAGUE);
  for (const [id, b] of [
    ['bt-e-co', CO],
    ['bt-e-club', CLUB],
    ['bt-e-league', LEAGUE],
    ['bt-e-night', NIGHT],
    ['bt-e-other', OTHER],
  ] as const)
    await event(id, b);
  await member(PARENT_ADMIN, CO);
  await member(CLUB_ADMIN, CLUB);
  await member(LEAGUE_ADMIN, LEAGUE);
});

describe('a member of the parent reaches every venture below it', () => {
  test('scope: the parent, its ventures, and a venture of a venture', async () => {
    const scope = await resolveAdminBrandScopeAsync(PARENT_ADMIN, eventsEnv);
    expect(scope).toEqual({ mode: 'scoped', brandIds: [CO, CLUB, LEAGUE, NIGHT] });
  });

  test('the events list shows every venture, and nothing outside the tree', async () => {
    const seen = await brandsSeenBy(PARENT_ADMIN);
    expect(seen).toEqual(new Set([CO, CLUB, LEAGUE, NIGHT]));
  });

  test('it creates an event in a venture, and in the parent itself', async () => {
    for (const b of [CLUB, CO]) {
      const res = await handleCreateEvent(
        createAs(PARENT_ADMIN, b, `bt parent in ${b}`),
        eventsEnv
      );
      expect(res.status, b).toBe(201);
      const { id } = (await res.json()) as { id: string };
      const row = await env.DB.prepare('SELECT brand_id FROM events WHERE id = ?')
        .bind(id)
        .first<{ brand_id: string }>();
      expect(row?.brand_id).toBe(b);
    }
  });
});

describe('a member of a venture reaches that venture only', () => {
  test('never the parent, never a sibling', async () => {
    expect(await resolveAdminBrandScopeAsync(CLUB_ADMIN, eventsEnv)).toEqual({
      mode: 'scoped',
      brandIds: [CLUB],
    });
    expect(await brandsSeenBy(CLUB_ADMIN)).toEqual(new Set([CLUB]));
  });

  test('a venture with a venture below it reaches down, not up', async () => {
    expect(await brandsSeenBy(LEAGUE_ADMIN)).toEqual(new Set([LEAGUE, NIGHT]));
  });

  test('it cannot create in the parent or a sibling', async () => {
    for (const b of [CO, LEAGUE]) {
      const res = await handleCreateEvent(createAs(CLUB_ADMIN, b, `bt club in ${b}`), eventsEnv);
      expect(res.status, b).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('BRAND_FORBIDDEN');
    }
  });
});

describe('nothing else widens', () => {
  test('an automation key actor is never expanded', async () => {
    const keyed = { ...eventsEnv, ADMIN_SCOPE_ALL: undefined } as EventsEnv;
    expect(await resolveAdminBrandScopeAsync('key:admin', keyed)).toEqual({ mode: 'deny' });
  });

  test('the staging CI service actor keeps its one brand', async () => {
    const svc = {
      ...eventsEnv,
      WORKER_ENV: 'staging',
      CI_SERVICE_ACTOR_BRAND: CO,
    } as EventsEnv;
    expect(await resolveAdminBrandScopeAsync('svc:ci', svc)).toEqual({
      mode: 'scoped',
      brandIds: [CO],
    });
  });

  test('the table refuses the platform brand and the public brand, either side', async () => {
    for (const [child, of] of [
      [PLATFORM_BRAND_ID, CO],
      [PUBLIC_BRAND_ID, CO],
      [CLUB, PLATFORM_BRAND_ID],
      [CLUB, PUBLIC_BRAND_ID],
      [CO, CO],
    ]) {
      await expect(
        env.DB.prepare('INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES (?, ?)')
          .bind(child, of)
          .run(),
        `${child} under ${of}`
      ).rejects.toThrow(/CHECK constraint failed/);
    }
  });

  test('a member of the public brand gains nothing from the tree', async () => {
    expect(await withDescendants(env.DB, [PUBLIC_BRAND_ID])).toEqual([PUBLIC_BRAND_ID]);
    expect(await withDescendants(env.DB, [PLATFORM_BRAND_ID])).toEqual([PLATFORM_BRAND_ID]);
  });
});

describe('the walk is bounded and fails closed', () => {
  test('a loop stops: each brand once', async () => {
    await parent('bt-loop-b', 'bt-loop-a');
    await parent('bt-loop-a', 'bt-loop-b');
    expect(await withDescendants(env.DB, ['bt-loop-a'])).toEqual(['bt-loop-a', 'bt-loop-b']);
  });

  test(`a chain deeper than ${MAX_BRAND_DEPTH} levels stops at ${MAX_BRAND_DEPTH}`, async () => {
    const chain = Array.from({ length: MAX_BRAND_DEPTH + 3 }, (_, i) => `bt-deep-${i}`);
    for (let i = 1; i < chain.length; i++) await parent(chain[i], chain[i - 1]);
    expect(await withDescendants(env.DB, [chain[0]])).toEqual(chain.slice(0, MAX_BRAND_DEPTH + 1));
  });

  test('the tree unreadable: exactly the given brands', async () => {
    const broken = {
      prepare: () => {
        throw new Error('D1 down');
      },
    } as unknown as D1Database;
    expect(await withDescendants(broken, [CO])).toEqual([CO]);
    expect(await withDescendants(undefined, [CO])).toEqual([CO]);
  });
});
