/**
 * OSE-1316 / OSE-1317 — Create Sponsor field rules, API half.
 *
 *   Tier     REQUIRED  — a create without one is a 400 (MISSING_TIER), not a
 *                        silent 'primary'; an unknown tier is INVALID_TIER.
 *   Event    optional  — a sponsor can sit in its brand's pool with no event,
 *                        and be attached to one later (PUT event_id).
 *   Logos    optional, TWO of them — header (wide, format 'logo') and sidebar
 *                        (square/compact, format 'logo_compact', migration 0081),
 *                        stored separately, never one image reused.
 *   Website  optional  — https:// only when present; http:, javascript:, and
 *                        garbage are refused, and a public read never carries a
 *                        non-https link even for a row stored before the rule.
 *
 * UI half (form + display side rail, run in jsdom): sponsor-create-fields-ui.spec.ts.
 *
 * @born-red OSE-1316/OSE-1317 | method: spec written first and run against
 *   origin/main via a tagged stash of the change (tier-only create was 400
 *   MISSING_FIELD event_id, a tier-less create was 201 'primary', website was
 *   stored unvalidated, sidebar_logo_url was dropped, the public read returned a
 *   javascript: website) — red; green with the change | date: 2026-09-30
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };

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

const BRAND = 'ose1316';
const EVENT = 'ose1316-evt';
const LATER_EVENT = 'ose1316-later-evt';
const OTHER_BRAND_EVENT = 'ose1316-other-brand-evt';

beforeAll(async () => {
  await applyMigrations();
  for (const [id, brand] of [
    [EVENT, BRAND],
    [LATER_EVENT, BRAND],
    [OTHER_BRAND_EVENT, 'ose1316-other'],
  ]) {
    await env.DB.prepare(
      // OSE-1900: the events chose to have sponsors, so a public read returns them.
      `INSERT INTO events (id, brand_id, title, slug, status, settings_json)
       VALUES (?, ?, 'Sponsor Fields', ?, 'active', '{"useSponsors":true}') ON CONFLICT(id) DO NOTHING`
    )
      .bind(id, brand, id)
      .run();
  }
});

type Json = Record<string, unknown>;

async function create(payload: Json): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch('https://t.test/api/v2/admin/sponsors', {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

async function update(id: string, payload: Json): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch(`https://t.test/api/v2/admin/sponsors/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

async function list(query = ''): Promise<Json[]> {
  const res = await SELF.fetch(`https://t.test/api/v2/admin/sponsors${query}`, { headers: ADMIN });
  const body = (await res.json()) as { items?: Json[] };
  return body.items ?? [];
}

async function business(id: string) {
  return env.DB.prepare('SELECT brand_id, tier, website_url FROM sponsor_business WHERE id = ?')
    .bind(id)
    .first<{ brand_id: string; tier: string | null; website_url: string | null }>();
}

async function placements(id: string) {
  const r = await env.DB.prepare(
    'SELECT event_id, tier FROM sponsor_placement WHERE sponsor_business_id = ? ORDER BY event_id'
  )
    .bind(id)
    .all<{ event_id: string; tier: string }>();
  return r.results ?? [];
}

async function assets(id: string) {
  const r = await env.DB.prepare(
    'SELECT format, url FROM sponsor_asset WHERE sponsor_business_id = ? ORDER BY format'
  )
    .bind(id)
    .all<{ format: string; url: string }>();
  return r.results ?? [];
}

describe('OSE-1316/1317 | tier is required', () => {
  test('a create with NO tier is refused with 400 MISSING_TIER (no silent default)', async () => {
    const { status, body } = await create({ name: 'No Tier Co', event_id: EVENT });
    expect(status).toBe(400);
    expect(body.code).toBe('MISSING_TIER');
    expect(String(body.error)).toMatch(/tier/i);
    const rows = await env.DB.prepare(
      "SELECT id FROM sponsor_business WHERE name = 'No Tier Co'"
    ).all();
    expect(rows.results ?? []).toHaveLength(0);
  });

  test('a blank tier is also MISSING_TIER; an unknown tier is INVALID_TIER', async () => {
    expect((await create({ name: 'Blank', tier: '  ' })).body.code).toBe('MISSING_TIER');
    const bad = await create({ name: 'Bad', tier: 'diamond' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_TIER');
  });

  test('tier cannot be cleared on update', async () => {
    const { body } = await create({ name: 'Keep Tier', tier: 'gold' });
    const res = await update(String(body.id), { tier: null });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_TIER');
    expect((await business(String(body.id)))?.tier).toBe('gold');
  });
});

describe('OSE-1316/1317 | event is optional', () => {
  test('tier-only create succeeds, and the sponsor is in its brand pool at that tier', async () => {
    for (const tier of ['title', 'gold', 'primary']) {
      const { status, body } = await create({ name: `Pool ${tier}`, tier, brand_id: BRAND });
      expect(status, JSON.stringify(body)).toBe(201);
      expect(body.tier).toBe(tier);
      expect(body.event_id).toBeNull();
      expect(body.placement_id).toBeNull();
      const b = await business(String(body.id));
      expect(b).toMatchObject({ brand_id: BRAND, tier });
      expect(await placements(String(body.id))).toHaveLength(0);
      // The pool: the admin list for the brand includes it, at its tier, with no event.
      const row = (await list(`?brand_id=${BRAND}`)).find((r) => r.id === body.id);
      expect(row, 'pool sponsor must be listed').toBeDefined();
      expect(row).toMatchObject({ tier, event_id: null, is_active: 1 });
    }
  });

  test('create with an event stores the sponsor↔event link (a placement at that tier)', async () => {
    const { status, body } = await create({ name: 'Linked Co', tier: 'silver', event_id: EVENT });
    expect(status).toBe(201);
    expect(body.event_id).toBe(EVENT);
    expect(typeof body.placement_id).toBe('string');
    expect(await placements(String(body.id))).toEqual([{ event_id: EVENT, tier: 'silver' }]);
    expect((await business(String(body.id)))?.brand_id).toBe(BRAND);
    const row = (await list(`?eventId=${EVENT}`)).find((r) => r.id === body.id);
    expect(row).toMatchObject({ event_id: EVENT, tier: 'silver' });
  });

  test('a pool sponsor is attached to an event later, at its own tier', async () => {
    const { body } = await create({ name: 'Attach Later', tier: 'platinum', brand_id: BRAND });
    const id = String(body.id);
    expect((await list(`?eventId=${LATER_EVENT}`)).some((r) => r.id === id)).toBe(false);

    const res = await update(id, { event_id: LATER_EVENT });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await placements(id)).toEqual([{ event_id: LATER_EVENT, tier: 'platinum' }]);
    const row = (await list(`?eventId=${LATER_EVENT}`)).find((r) => r.id === id);
    expect(row).toMatchObject({ event_id: LATER_EVENT, tier: 'platinum' });

    // Attaching again is a no-op, not a duplicate or an error.
    expect((await update(id, { event_id: LATER_EVENT })).status).toBe(200);
    expect(await placements(id)).toHaveLength(1);
  });

  test('attaching an event from another brand is refused (#9 — the pool never widens)', async () => {
    const { body } = await create({ name: 'Brand Fence', tier: 'bronze', brand_id: BRAND });
    const res = await update(String(body.id), { event_id: OTHER_BRAND_EVENT });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EVENT_NOT_FOUND');
    expect(await placements(String(body.id))).toHaveLength(0);
  });

  test('an unknown event_id is still a 400, and a malformed brand_id is refused', async () => {
    expect((await create({ name: 'Ghost', tier: 'gold', event_id: 'nope-404' })).body.code).toBe(
      'EVENT_NOT_FOUND'
    );
    expect(
      (await create({ name: 'Bad Brand', tier: 'gold', brand_id: 'Not A Brand!' })).body.code
    ).toBe('INVALID_BRAND');
  });
});

describe('OSE-1317 | website URL — optional, https only', () => {
  test('empty / absent → stored as null (no link)', async () => {
    for (const website_url of [undefined, '', '   ']) {
      const { status, body } = await create({ name: 'No Site', tier: 'gold', website_url });
      expect(status).toBe(201);
      expect((await business(String(body.id)))?.website_url).toBeNull();
    }
  });

  test('a valid https URL is stored', async () => {
    const { status, body } = await create({
      name: 'Good Site',
      tier: 'gold',
      website_url: 'https://acme.example.com/about',
    });
    expect(status).toBe(201);
    expect((await business(String(body.id)))?.website_url).toBe('https://acme.example.com/about');
  });

  test('malformed websites are refused with a clear message (create AND update)', async () => {
    const bad = [
      'http://acme.example.com',
      'javascript:alert(1)',
      'JavaScript:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'acme dot com',
      'www.acme.com',
      'https://' + 'a'.repeat(600) + '.com',
    ];
    const { body: okBody } = await create({ name: 'Site Target', tier: 'gold' });
    for (const website_url of bad) {
      const c = await create({ name: 'Bad Site', tier: 'gold', website_url });
      expect(c.status, website_url).toBe(400);
      expect(c.body.code).toBe('INVALID_WEBSITE_URL');
      expect(String(c.body.error)).toMatch(/https:\/\//);
      const u = await update(String(okBody.id), { website_url });
      expect(u.status, website_url).toBe(400);
      expect(u.body.code).toBe('INVALID_WEBSITE_URL');
    }
    expect((await business(String(okBody.id)))?.website_url).toBeNull();
  });

  test('a public read never carries a non-https website, even for a row stored before the rule', async () => {
    const { body } = await create({ name: 'Legacy Site', tier: 'gold', event_id: EVENT });
    const id = String(body.id);
    // Simulate a pre-rule row + an accepted placement (so it renders publicly).
    await env.DB.prepare(
      "UPDATE sponsor_business SET website_url = 'javascript:alert(1)' WHERE id = ?"
    )
      .bind(id)
      .run();
    await env.DB.prepare(
      'UPDATE sponsor_placement SET sponsor_accepted = 1 WHERE sponsor_business_id = ?'
    )
      .bind(id)
      .run();
    const res = await SELF.fetch(`https://t.test/api/v2/events/${EVENT}/sponsors`);
    const pub = (await res.json()) as { items?: Json[]; sponsors?: Json[] };
    const items = pub.items ?? pub.sponsors ?? [];
    const row = items.find((s) => s.id === id);
    expect(row, JSON.stringify(pub)).toBeDefined();
    expect(row!.website_url).toBeNull();
  });
});

describe('OSE-1317 | header logo and sidebar logo are separate, both optional', () => {
  test('both stored separately (formats logo + logo_compact) and read back separately', async () => {
    const { status, body } = await create({
      name: 'Two Logos',
      tier: 'gold',
      event_id: EVENT,
      logo_url: 'https://cdn.example.com/wide.png',
      sidebar_logo_url: 'https://cdn.example.com/square.png',
    });
    expect(status, JSON.stringify(body)).toBe(201);
    const id = String(body.id);
    expect(await assets(id)).toEqual([
      { format: 'logo', url: 'https://cdn.example.com/wide.png' },
      { format: 'logo_compact', url: 'https://cdn.example.com/square.png' },
    ]);
    const res = await SELF.fetch(`https://t.test/api/v2/admin/sponsors/${id}`, { headers: ADMIN });
    const item = ((await res.json()) as { item: Json }).item;
    expect(item.logo_url).toBe('https://cdn.example.com/wide.png');
    expect(item.sidebar_logo_url).toBe('https://cdn.example.com/square.png');
  });

  test('no logos at all is a valid sponsor (no asset rows, nothing to break)', async () => {
    const { status, body } = await create({ name: 'Name Only', tier: 'primary' });
    expect(status).toBe(201);
    expect(await assets(String(body.id))).toEqual([]);
  });

  test('update sets and clears the sidebar logo without touching the header logo', async () => {
    const { body } = await create({
      name: 'Logo Edit',
      tier: 'gold',
      logo_url: 'https://cdn.example.com/w.png',
    });
    const id = String(body.id);
    expect((await update(id, { sidebar_logo_url: 'https://cdn.example.com/s.png' })).status).toBe(
      200
    );
    expect((await assets(id)).map((a) => a.format)).toEqual(['logo', 'logo_compact']);
    expect((await update(id, { sidebar_logo_url: null })).status).toBe(200);
    expect(await assets(id)).toEqual([{ format: 'logo', url: 'https://cdn.example.com/w.png' }]);
  });

  test('a hostile sidebar logo scheme is refused', async () => {
    const res = await create({
      name: 'Evil Logo',
      tier: 'gold',
      sidebar_logo_url: 'javascript:alert(1)',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_SIDEBAR_LOGO_URL');
  });
});

describe('OSE-1316/1317 | hostile input stays data', () => {
  test('a hostile name is stored verbatim (escaping is the renderer’s job) and never breaks SQL', async () => {
    const name = `"><img src=x onerror=alert(1)>'); DROP TABLE sponsor_business;--`;
    const { status, body } = await create({ name, tier: 'gold', brand_id: BRAND });
    expect(status).toBe(201);
    const row = await env.DB.prepare('SELECT name FROM sponsor_business WHERE id = ?')
      .bind(String(body.id))
      .first<{ name: string }>();
    expect(row?.name).toBe(name);
  });
});
