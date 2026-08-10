/**
 * Sponsor card event-scoping — invariant guard spec.
 *
 * Idea #1 from the invariant-first frontend fleet. The Sponsors card used to
 * render an UNSCOPED, all-events sponsor list. On a shared/multi-tenant
 * instance that lets an organizer see — and mis-edit / deactivate — another
 * organizer's sponsor. The fix scopes the list by event id, enforced in the
 * SQL WHERE clause of handleAdminListSponsors (bound parameter), never by a
 * client-side .filter() that a query string could widen.
 *
 * Invariant #2 (hyperlocal_geo_resolution) is touched ONLY as read/display
 * scoping — the sponsor RESOLUTION engine (tier sort, surface filter, dedup)
 * is not modified. A guard here proves it stays inert.
 *
 * @born-red invariant#2 | method: design-time-negative-assertion | date: 2026-08-07
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleAdminListSponsors, type SponsorsEnv } from '../src/handlers/sponsors';
import { filterSponsorsForSurface, buildSponsorBundle } from '../src/lib/sponsor-resolver';

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
  await env.DB.prepare(
    `INSERT INTO sponsors (id, event_id, name, tier, placement_formats, is_active)
     VALUES (?, ?, ?, 'gold', '{}', 1)`
  )
    .bind(id, eventId, name)
    .run();
}

/** base64url-encode a JSON object (no padding), for a decode-only fake JWT. */
function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A request carrying a CF Access JWT with the given email. extractAdminActor
 * DECODES the payload (no signature verify at that layer), so an unsigned token
 * is enough to exercise identity-derived scope in-test. Mirrors the events
 * scope spec so both #9 enforcement points are proven the same way.
 */
function reqAsEmail(email: string, query = ''): Request {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.sig`;
  return new Request(`https://x/api/v2/admin/sponsors${query}`, {
    headers: { 'Cf-Access-Jwt-Assertion': jwt },
  });
}

function reqAnon(query = ''): Request {
  return new Request(`https://x/api/v2/admin/sponsors${query}`);
}

const sponsorsEnv = env as unknown as SponsorsEnv;

beforeAll(async () => {
  await applyMigrations();
  // Two organizers / brands, one event each, plus a second event under brand A.
  await seedEvent('evt-A1', 'brand-A', 'Brand A Launch');
  await seedEvent('evt-A2', 'brand-A', 'Brand A Followup');
  await seedEvent('evt-B1', 'brand-B', 'Brand B Gala');
  await seedSponsor('sp-A1', 'evt-A1', 'Acme (A1)');
  await seedSponsor('sp-A2', 'evt-A2', 'Beta (A2)');
  await seedSponsor('sp-B1', 'evt-B1', 'Competitor (B1)');

  // OSE-674 / OSE-666 B2: scope is now derived from the SERVER-VERIFIED actor,
  // not the client query. Map the brand-A operator; brand-B has no operator here
  // so cross-tenant reach is provably impossible. (Email actors ignore
  // ADMIN_SCOPE_ALL, so the global test opt-in cannot mask these assertions.)
  sponsorsEnv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({ 'a@brand-a.test': ['brand-A'] });
});

describe('INVARIANT #2 — Sponsor card server-side event scoping (now actor-gated, OSE-674)', () => {
  test('?eventId=E returns only that event’s sponsors, and echoes scopedTo', async () => {
    const res = await handleAdminListSponsors(reqAsEmail('a@brand-a.test', '?eventId=evt-A1'), sponsorsEnv);
    const body = (await res.json()) as { ok: boolean; items: Array<{ event_id: string }>; scopedTo: string };
    expect(body.ok).toBe(true);
    expect(body.scopedTo).toBe('evt-A1');
    expect(body.items.length).toBe(1);
    expect(body.items.every((s) => s.event_id === 'evt-A1')).toBe(true);
  });

  test('cross-organizer isolation: scoping to a brand-A event never returns a brand-B sponsor', async () => {
    const res = await handleAdminListSponsors(reqAsEmail('a@brand-a.test', '?eventId=evt-A1'), sponsorsEnv);
    const body = (await res.json()) as { items: Array<{ event_id: string }> };
    expect(body.items.some((s) => s.event_id === 'evt-B1')).toBe(false);
  });

  test('brand_id scope returns only that brand’s sponsors', async () => {
    const res = await handleAdminListSponsors(reqAsEmail('a@brand-a.test', '?brand_id=brand-A'), sponsorsEnv);
    const body = (await res.json()) as { items: Array<{ event_id: string }> };
    // brand-A owns evt-A1 + evt-A2 → sp-A1, sp-A2; never sp-B1
    expect(body.items.map((s) => s.event_id).sort()).toEqual(['evt-A1', 'evt-A2']);
    expect(body.items.some((s) => s.event_id === 'evt-B1')).toBe(false);
  });

  test('no query → scoped operator sees only their own brand (never the whole table)', async () => {
    // OSE-674: the old "unscoped call returns ALL sponsors" back-compat was the
    // #9 leak. A scoped operator with no query now gets only their brand's rows.
    const res = await handleAdminListSponsors(reqAsEmail('a@brand-a.test'), sponsorsEnv);
    const body = (await res.json()) as { ok: boolean; items: Array<{ event_id: string }> };
    expect(body.ok).toBe(true);
    expect(body.items.map((s) => s.event_id).sort()).toEqual(['evt-A1', 'evt-A2']);
    expect(body.items.some((s) => s.event_id === 'evt-B1')).toBe(false);
  });
});

describe('INVARIANT #9 — cross-event sponsor tenant isolation (OSE-674, the sharpest #9 trap)', () => {
  test('forged ?brand_id= to another tenant → 403 (cannot widen scope)', async () => {
    const res = await handleAdminListSponsors(reqAsEmail('a@brand-a.test', '?brand_id=brand-B'), sponsorsEnv);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('BRAND_FORBIDDEN');
  });

  test('forged ?eventId= from another tenant → empty (server scope caps it)', async () => {
    const res = await handleAdminListSponsors(reqAsEmail('a@brand-a.test', '?eventId=evt-B1'), sponsorsEnv);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  test('unauthenticated caller → deny (zero rows, never the whole table)', async () => {
    const res = await handleAdminListSponsors(reqAnon('?brand_id=brand-A'), sponsorsEnv);
    const body = (await res.json()) as { ok: boolean; items: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.items).toEqual([]);
  });

  test('unmapped operator → deny (fail-closed)', async () => {
    const res = await handleAdminListSponsors(reqAsEmail('outsider@nowhere.test'), sponsorsEnv);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });
});

describe('INVARIANT #2 — resolution engine stays inert (management-list change only)', () => {
  // The management-list change is server-side scoping + display naming only.
  // These assertions pin the resolver's real contract so a regression here
  // would prove the resolution path was disturbed by the scoping work.
  function row(id: string, tier: string, placements: Record<string, boolean>) {
    return {
      id,
      event_id: 'e',
      name: id.toUpperCase(),
      logo_url: null,
      website_url: null,
      tier,
      placement_formats: JSON.stringify(placements),
      click_token: null,
      impression_token: null,
      is_active: 1,
      is_local: 0,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
  }

  test('filterSponsorsForSurface returns ALL sponsors — placement is uniform (#25)', () => {
    const fixture = [
      row('mobile-yes', 'gold', { mobileBanner: true }),
      row('poster-only', 'gold', { posterTop: true }),
    ];
    // OSE-661: the named-slot filter is retired; every sponsor is eligible for
    // every surface (uniform placement — only frequency is purchasable).
    const publicSet = filterSponsorsForSurface(fixture, 'public');
    expect(publicSet.map((s) => s.id).sort()).toEqual(['mobile-yes', 'poster-only']);
  });

  test('buildSponsorBundle still returns the bundle shape (sponsors + surface_sponsors + rotation)', () => {
    const fixture = [row('tv', 'title', { tvTop: true })];
    const bundle = buildSponsorBundle(fixture);
    expect(bundle.sponsors).toHaveLength(1);
    expect(bundle.surface_sponsors.tvTop.map((s) => s.id)).toEqual(['tv']);
    expect(bundle.rotation_config.sponsorSlots).toBeGreaterThanOrEqual(1);
  });
});
