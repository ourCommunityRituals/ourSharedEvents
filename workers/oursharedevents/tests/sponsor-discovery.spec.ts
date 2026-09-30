/**
 * Sponsor discovery (TRIANGLE next slice #2 in the screen map, #5 in this pass):
 * a sponsor browses its brand's published, upcoming events from /sponsor and
 * asks to back one; the organizer approves or declines.
 *
 * The property that matters most is CONSENT (ADR-019): a request is the
 * sponsor's yes but NOT the organizer's, so it must render on no public
 * surface until the organizer approves. These tests hold that at the public
 * sponsor API and the public event page, then prove approval turns it on.
 *
 * Also: brand scope from the signed claim (#9), the discoverable predicate
 * (published / active / upcoming / not already linked), the open-request cap,
 * token failure modes, organizer scope (out of brand = 404), idempotence, and
 * the audit trail.
 *
 * Runtime-bound (SELF.fetch, env.DB) → workers pool.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { mintSponsorHomeToken } from '../src/lib/sponsor-home-auth';
import { MAX_OPEN_REQUESTS, readDiscoverableEvents } from '../src/lib/sponsor-discovery';
import { handleAdminAnswerSponsorRequest, type SponsorHomeEnv } from '../src/handlers/sponsor-home';

const BRAND = 'ose-sponsor-discovery';
const OTHER = 'ose-sponsor-discovery-other';
const ADMIN_HEADERS = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
};

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  SHARED_REPORT_SIGNING_SECRET: string;
}
const tenv = env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function seedEvent(
  id: string,
  opts: {
    brand?: string;
    status?: string;
    published?: number;
    start?: string | null;
    cell?: string | null;
  } = {}
) {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, start_date, location, is_published, h3_res7)
     VALUES (?, ?, ?, ?, ?, ?, 'Eagles Hall', ?, ?)`
  )
    .bind(
      id,
      opts.brand ?? BRAND,
      `Disc ${id}`,
      `slug-${id}`,
      opts.status ?? 'active',
      opts.start === undefined ? day(10) : opts.start,
      opts.published ?? 1,
      opts.cell ?? null
    )
    .run();
}

const CELL = '872664c1effffff';
let token = '';

async function ask(eventId: string, t = token) {
  const res = await SELF.fetch('https://x/api/v2/sponsor/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: t, event_id: eventId }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function answer(placementId: string, approve: boolean) {
  const res = await SELF.fetch(`https://x/api/v2/admin/sponsor-requests/${placementId}/respond`, {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ approve }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function publicSponsorNames(eventId: string): Promise<string[]> {
  const res = await SELF.fetch(`https://x/api/v2/events/${eventId}/sponsors`);
  const body = (await res.json()) as {
    items?: { name?: string }[];
    sponsors?: { name?: string }[];
  };
  return (body.items ?? body.sponsors ?? []).map((s) => String(s.name));
}

async function placement(id: string) {
  return tenv.DB.prepare(
    'SELECT is_active, organizer_accepted, sponsor_accepted, source FROM sponsor_placement WHERE id = ?'
  )
    .bind(id)
    .first<{
      is_active: number;
      organizer_accepted: number | null;
      sponsor_accepted: number | null;
      source: string;
    }>();
}

beforeAll(async () => {
  await applyMigrations();
  await tenv.DB.prepare(
    `DELETE FROM sponsor_placement WHERE sponsor_business_id IN ('sd-bakery','sd-other')`
  ).run();
  await tenv.DB.prepare(`DELETE FROM sponsor_business WHERE id IN ('sd-bakery','sd-other')`).run();
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id IN (?, ?)').bind(BRAND, OTHER).run();

  await seedEvent('sd-open-near', { cell: CELL, start: day(5) });
  await seedEvent('sd-open-later', { start: day(30) });
  await seedEvent('sd-unpublished', { published: 0 });
  await seedEvent('sd-draft', { status: 'draft' });
  await seedEvent('sd-past', { start: day(-10) });
  await seedEvent('sd-undated', { start: null });
  await seedEvent('sd-already', {});
  await seedEvent('sd-other-brand', { brand: OTHER });
  for (let i = 0; i < MAX_OPEN_REQUESTS + 1; i++)
    await seedEvent(`sd-cap-${i}`, { start: day(60 + i) });

  await tenv.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name, tier, is_active, h3_res7)
     VALUES ('sd-bakery', ?, 'Discovery Bakery', 'gold', 1, ?)`
  )
    .bind(BRAND, CELL)
    .run();
  await tenv.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name, tier, is_active) VALUES ('sd-other', ?, 'Other Co', 'gold', 1)`
  )
    .bind(OTHER)
    .run();
  // An organizer-made placement the sponsor already has (declined, even).
  await tenv.DB.prepare(
    `INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted)
     VALUES ('sd-p-already', 'sd-bakery', 'sd-already', 'gold', 'organizer', 1, 0)`
  ).run();

  token = (await mintSponsorHomeToken(tenv, 'sd-bakery', BRAND))!.token;
});

describe('discoverable events', () => {
  test('only this brand’s published, active, upcoming events the sponsor is not on', async () => {
    const rows = await readDiscoverableEvents(tenv.DB, {
      id: 'sd-bakery',
      brand_id: BRAND,
      h3_res7: CELL,
    });
    const ids = rows.map((r) => r.id);
    expect(ids.slice(0, 2)).toEqual(['sd-open-near', 'sd-open-later']); // soonest first
    for (const hidden of [
      'sd-unpublished',
      'sd-draft',
      'sd-past',
      'sd-undated',
      'sd-already',
      'sd-other-brand',
    ]) {
      expect(ids).not.toContain(hidden);
    }
    expect(rows.find((r) => r.id === 'sd-open-near')!.near).toBe(1);
    expect(rows.find((r) => r.id === 'sd-open-later')!.near).toBe(0);
  });

  test('the sponsor page lists them with an Ask to join button', async () => {
    const res = await SELF.fetch(`https://x/sponsor?t=${encodeURIComponent(token)}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('data-testid="sponsor-home-discover"');
    expect(html).toMatch(/data-testid="discover-card" data-event-id="sd-open-near"/);
    expect(html).toContain('data-action="sponsor-request" data-event-id="sd-open-near"');
    expect(html).toContain('data-testid="discover-near"');
    expect(html).not.toContain('sd-other-brand');
    expect(html).not.toContain('sd-unpublished');
  });
});

describe('a sponsor asks — and it stays OFF every public surface', () => {
  let placementId = '';

  test('201, stored as the sponsor’s yes but switched off', async () => {
    const { status, body } = await ask('sd-open-near');
    expect(status).toBe(201);
    placementId = String(body.id);
    expect(await placement(placementId)).toEqual({
      is_active: 0,
      organizer_accepted: null,
      sponsor_accepted: 1,
      source: 'sponsor_request',
    });
  });

  test('not on the public sponsor API or the public event page', async () => {
    expect(await publicSponsorNames('sd-open-near')).not.toContain('Discovery Bakery');
    const page = await (await SELF.fetch('https://x/events/sd-open-near')).text();
    expect(page).not.toContain('Discovery Bakery');
  });

  test('the sponsor page shows it under Your requests and no longer offers it', async () => {
    const html = await (
      await SELF.fetch(`https://x/sponsor?t=${encodeURIComponent(token)}`)
    ).text();
    expect(html).toContain('data-testid="sponsor-home-requests"');
    expect(html).toContain('Waiting for the organizer');
    expect(html).not.toContain('data-action="sponsor-request" data-event-id="sd-open-near"');
  });

  test('asking again for the same event is refused (no longer discoverable)', async () => {
    expect((await ask('sd-open-near')).status).toBe(404);
  });

  test('the admin sponsors list shows it as a request, with its placement id', async () => {
    const res = await SELF.fetch('https://x/api/v2/admin/sponsors?eventId=sd-open-near', {
      headers: ADMIN_HEADERS,
    });
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    const row = body.items.find((r) => r.id === 'sd-bakery')!;
    expect(row).toMatchObject({
      placement_id: placementId,
      placement_active: 0,
      placement_source: 'sponsor_request',
      organizer_accepted: null,
    });
  });

  test('the organizer approves → on the public surfaces; a second answer is 409', async () => {
    const { status, body } = await answer(placementId, true);
    expect(status).toBe(200);
    expect(body.approved).toBe(true);
    expect(await placement(placementId)).toMatchObject({
      is_active: 1,
      organizer_accepted: 1,
      sponsor_accepted: 1,
    });
    expect(await publicSponsorNames('sd-open-near')).toContain('Discovery Bakery');
    expect((await answer(placementId, false)).status).toBe(409);
  });

  test('both writes are audited, the sponsor’s under sponsor:<id>', async () => {
    const rows = await tenv.DB.prepare(
      `SELECT action, actor FROM admin_audit_log WHERE resource_id = ? ORDER BY created_at`
    )
      .bind(placementId)
      .all<{ action: string; actor: string }>();
    const actions = (rows.results ?? []).map((r) => `${r.action}:${r.actor.split(':')[0]}`);
    expect(actions).toContain('SPONSOR_REQUEST_PLACEMENT:sponsor');
    expect(actions.some((a) => a.startsWith('ANSWER_SPONSOR_REQUEST:'))).toBe(true);
  });
});

describe('organizer decline', () => {
  test('stays off, and the sponsor sees the answer', async () => {
    const { body } = await ask('sd-open-later');
    const id = String(body.id);
    expect((await answer(id, false)).status).toBe(200);
    expect(await placement(id)).toMatchObject({ is_active: 0, organizer_accepted: 0 });
    expect(await publicSponsorNames('sd-open-later')).not.toContain('Discovery Bakery');
    const html = await (
      await SELF.fetch(`https://x/sponsor?t=${encodeURIComponent(token)}`)
    ).text();
    expect(html).toContain('The organizer said no');
  });

  test('an organizer outside the event’s brand gets 404, and nothing changes', async () => {
    const { body } = await ask('sd-cap-0');
    const id = String(body.id);
    const e = {
      ...(env as unknown as SponsorHomeEnv),
      ADMIN_BRAND_MEMBERSHIP: JSON.stringify({ 'x@other.test': [OTHER] }),
    } as SponsorHomeEnv;
    const b64 = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const now = Math.floor(Date.now() / 1000);
    const jwt = `${b64({ alg: 'none' })}.${b64({ email: 'x@other.test', iat: now - 5, exp: now + 600 })}.sig`;
    const res = await handleAdminAnswerSponsorRequest(
      new Request(`https://x/api/v2/admin/sponsor-requests/${id}/respond`, {
        method: 'POST',
        headers: { 'Cf-Access-Jwt-Assertion': jwt, 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve: true }),
      }),
      e,
      id
    );
    expect(res.status).toBe(404);
    expect(await placement(id)).toMatchObject({ is_active: 0, organizer_accepted: null });
  });
});

describe('limits and refusals', () => {
  test(`at most ${MAX_OPEN_REQUESTS} waiting requests at once`, async () => {
    // sd-cap-0 is already waiting (previous test). Fill to the cap, then one more.
    const statuses: number[] = [];
    for (let i = 1; i <= MAX_OPEN_REQUESTS; i++) statuses.push((await ask(`sd-cap-${i}`)).status);
    expect(statuses.slice(0, MAX_OPEN_REQUESTS - 1).every((s) => s === 201)).toBe(true);
    const last = await ask(`sd-cap-${MAX_OPEN_REQUESTS}`);
    expect(last.status).toBe(409);
    expect(last.body.code).toBe('TOO_MANY_OPEN');
  });

  test('another brand’s event is 404 even with a valid token', async () => {
    const t = (await mintSponsorHomeToken(tenv, 'sd-other', OTHER))!.token;
    expect((await ask('sd-open-later', t)).status).toBe(404);
  });

  test('bad or missing token is 401; missing event_id is 400', async () => {
    expect((await ask('sd-open-later', 'nope.nope')).status).toBe(401);
    const [p, s] = token.split('.');
    expect(
      (await ask('sd-open-later', `${p}.${s.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'))}`)).status
    ).toBe(401);
    expect((await ask('')).status).toBe(400);
  });

  test('the admin answer route needs admin auth', async () => {
    const res = await SELF.fetch('https://x/api/v2/admin/sponsor-requests/whatever/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve: true }),
    });
    expect([401, 403]).toContain(res.status);
  });
});
