/**
 * Sponsor public card + OSE default image (migration 0083) — API / page half.
 *
 * Decided 2026-09-30: a sponsor is valid with only a business name. Logos are
 * optional; a sponsor with no logo gets the OSE default image. A sponsor may
 * deliberately show only a simple card — title (display name, else business
 * name), location, contact — all optional and public by the sponsor's choice.
 * A tap goes to the https website when there is one, otherwise to that card.
 *
 *   - card fields: create / update / clear / validate (400 codes)
 *   - public bundle: title + card_url + address_line; never contact, never geo
 *   - GET /sponsors/:id: renders only a sponsor that is on show; escapes all;
 *     default image when no logo, the same-origin proxy when there is one
 *   - GET /sponsor-default-logo.svg: static, locked-down headers
 *   - logo proxy: ?slot=sidebar prefers the compact logo; cache misses are
 *     rate-limited (it is public and each miss is an outbound fetch)
 *   - tier equity (#5): every tier gets the same card / image options
 *
 * UI half (form image choice, surfaces, run in jsdom): sponsor-public-card-ui.spec.ts.
 *
 * @born-red 0083 | method: src + migration 0083 stashed, tests kept, run against
 *   origin/main. This file cannot load there (it imports the new sponsor-card
 *   modules), so its red is a load failure, not per-assertion; the jsdom half
 *   (sponsor-public-card-ui.spec.ts) is behaviourally red 9/9 on the same tree.
 *   Green with the change | date: 2026-09-30
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  handleSponsorLogo,
  SPONSOR_LOGO_READ_MAX,
  SPONSOR_LOGO_NEGATIVE_TTL_S,
  SPONSOR_LOGO_MAX_IN_FLIGHT,
} from '../src/handlers/sponsors';
import { handleSponsorCardPage } from '../src/handlers/sponsor-card';
import { checkCardField, telHref, sponsorTitle } from '../src/lib/sponsor-card';

const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const TIERS = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];

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

const BRAND = 'ose0083';
const EVENT = 'ose0083-evt';

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare(
    // OSE-1900: the event chose to have sponsors, so its sponsor's card and logo are served.
    `INSERT INTO events (id, brand_id, title, slug, status, settings_json)
     VALUES (?, ?, 'Card Night', ?, 'active', '{"useSponsors":true}') ON CONFLICT(id) DO NOTHING`
  )
    .bind(EVENT, BRAND, EVENT)
    .run();
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

async function card(id: string) {
  return env.DB.prepare(
    'SELECT display_name, address_line, contact_phone, contact_email FROM sponsor_business WHERE id = ?'
  )
    .bind(id)
    .first<Json>();
}

/** Create a sponsor on EVENT and accept the placement so it is on show. */
async function onShow(payload: Json): Promise<string> {
  const { status, body } = await create({ tier: 'gold', event_id: EVENT, ...payload });
  expect(status, JSON.stringify(body)).toBe(201);
  const id = String(body.id);
  await env.DB.prepare(
    'UPDATE sponsor_placement SET sponsor_accepted = 1 WHERE sponsor_business_id = ?'
  )
    .bind(id)
    .run();
  return id;
}

async function publicRow(id: string): Promise<Json | undefined> {
  const res = await SELF.fetch(`https://t.test/api/v2/events/${EVENT}/sponsors`);
  const pub = (await res.json()) as { items?: Json[] };
  return (pub.items ?? []).find((s) => s.id === id);
}

/** A KV that says this caller is already far over any limit. */
const OVER_LIMIT_KV = {
  get: async () => JSON.stringify({ count: 1_000_000, resetAt: Date.now() + 60_000 }),
  put: async () => {},
} as unknown as KVNamespace;

describe('0083 | card fields: all optional, validated, clearable', () => {
  test('a sponsor with only a business name (and tier) is complete', async () => {
    const { status, body } = await create({ name: 'Name Only', tier: 'primary' });
    expect(status).toBe(201);
    expect(await card(String(body.id))).toEqual({
      display_name: null,
      address_line: null,
      contact_phone: null,
      contact_email: null,
    });
  });

  test('display name, location, phone and email are stored and read back', async () => {
    const { status, body } = await create({
      name: 'Joe Pizza LLC',
      tier: 'gold',
      display_name: "  Joe's   Pizza — Beverly ",
      address_line: '10255 S Western Ave,\n Chicago',
      contact_phone: '(773) 555-0100',
      contact_email: 'Hello@JoesPizza.example',
    });
    expect(status, JSON.stringify(body)).toBe(201);
    const id = String(body.id);
    expect(await card(id)).toEqual({
      display_name: "Joe's Pizza — Beverly",
      address_line: '10255 S Western Ave, Chicago',
      contact_phone: '(773) 555-0100',
      contact_email: 'hello@joespizza.example',
    });
    const res = await SELF.fetch(`https://t.test/api/v2/admin/sponsors/${id}`, { headers: ADMIN });
    const item = ((await res.json()) as { item: Json }).item;
    expect(item.display_name).toBe("Joe's Pizza — Beverly");
    expect(item.contact_email).toBe('hello@joespizza.example');
  });

  test.each([
    ['contact_phone', 'call us', 'INVALID_CONTACT_PHONE'],
    ['contact_phone', '555-01', 'INVALID_CONTACT_PHONE'],
    ['contact_email', 'not-an-email', 'INVALID_CONTACT_EMAIL'],
    ['contact_email', 'a@b', 'INVALID_CONTACT_EMAIL'],
    // CCR PR #699: mailto: parameter injection — a stored address must not be
    // able to prefill a visitor's recipients, subject or body.
    ['contact_email', 'a@b.co?bcc=x@y.example&body=wire', 'INVALID_CONTACT_EMAIL'],
    ['contact_email', 'a@b.co&subject=hi', 'INVALID_CONTACT_EMAIL'],
    ['contact_email', 'a%3Fb@c.example', 'INVALID_CONTACT_EMAIL'],
    ['contact_email', 'a@b.example#x', 'INVALID_CONTACT_EMAIL'],
    ['display_name', 'x'.repeat(81), 'INVALID_DISPLAY_NAME'],
    ['address_line', 'x'.repeat(201), 'INVALID_ADDRESS_LINE'],
    ['display_name', 42, 'INVALID_DISPLAY_NAME'],
  ])('create refuses a bad %s (%s) with %s', async (field, value, code) => {
    const { status, body } = await create({ name: 'Bad Card', tier: 'gold', [field]: value });
    expect(status).toBe(400);
    expect(body.code).toBe(code);
  });

  test('update sets, and "" / null clears, each card field', async () => {
    const { body } = await create({ name: 'Edit Card', tier: 'gold' });
    const id = String(body.id);
    expect(
      (
        await update(id, {
          display_name: 'Edited',
          address_line: 'Beverly',
          contact_phone: '+1 773 555 0100 ext 12',
          contact_email: 'a@b.example',
        })
      ).status
    ).toBe(200);
    expect(await card(id)).toMatchObject({ display_name: 'Edited', address_line: 'Beverly' });
    expect(
      (
        await update(id, {
          display_name: '',
          address_line: null,
          contact_phone: '',
          contact_email: null,
        })
      ).status
    ).toBe(200);
    expect(await card(id)).toEqual({
      display_name: null,
      address_line: null,
      contact_phone: null,
      contact_email: null,
    });
    const bad = await update(id, { contact_email: 'nope' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_CONTACT_EMAIL');
  });

  test('tier equity (#5): every tier gets the same image + card options', async () => {
    for (const tier of TIERS) {
      const { status, body } = await create({
        name: `Tier ${tier}`,
        tier,
        display_name: `Shown ${tier}`,
        address_line: 'Blue Island',
        contact_phone: '(708) 555-0100',
        contact_email: 'x@y.example',
        logo_url: 'https://cdn.example.com/w.png',
        sidebar_logo_url: 'https://cdn.example.com/s.png',
      });
      expect(status, `${tier}: ${JSON.stringify(body)}`).toBe(201);
      expect(await card(String(body.id))).toMatchObject({ display_name: `Shown ${tier}` });
    }
  });

  test('switching to the OSE default on an edit clears both logos', async () => {
    const { body } = await create({
      name: 'Had Logos',
      tier: 'gold',
      logo_url: 'https://cdn.example.com/w.png',
      sidebar_logo_url: 'https://cdn.example.com/s.png',
    });
    const id = String(body.id);
    expect((await update(id, { logo_url: null, sidebar_logo_url: null })).status).toBe(200);
    const assets = await env.DB.prepare(
      'SELECT format FROM sponsor_asset WHERE sponsor_business_id = ? AND url IS NOT NULL'
    )
      .bind(id)
      .all();
    expect(assets.results ?? []).toEqual([]);
  });
});

describe('0083 | the public bundle: title, card_url, location — never contact or geo', () => {
  test('title is the display name; card_url is the card; contact + geo stay out', async () => {
    const id = await onShow({
      name: 'Legal Name LLC',
      display_name: 'Corner Shop',
      address_line: 'Beverly, Chicago',
      contact_phone: '(773) 555-0199',
      contact_email: 'shop@example.com',
      lat: 41.7,
      lon: -87.68,
    });
    const row = await publicRow(id);
    expect(row).toBeDefined();
    expect(row!.title).toBe('Corner Shop');
    expect(row!.name).toBe('Legal Name LLC');
    expect(row!.card_url).toBe(`/sponsors/${id}`);
    expect(row!.address_line).toBe('Beverly, Chicago');
    for (const k of ['contact_phone', 'contact_email', 'lat', 'lon', 'h3_res9', 'h3_res7']) {
      expect(row, k).not.toHaveProperty(k);
    }
  });

  test('no display name → the title is the business name', async () => {
    const id = await onShow({ name: 'Plain Name Co' });
    expect((await publicRow(id))!.title).toBe('Plain Name Co');
  });
});

describe('0083 | GET /sponsors/:id — the public card', () => {
  test('renders title, business name, location, tel: and mailto:, with the OSE default image', async () => {
    const id = await onShow({
      name: 'Card Co LLC',
      display_name: 'Card Co',
      address_line: '123 Main St, Blue Island',
      contact_phone: '(708) 555-0100 x 7',
      contact_email: 'hi@cardco.example',
    });
    const res = await SELF.fetch(`https://t.test/sponsors/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('content-security-policy')).toMatch(/img-src 'self' data:/);
    const page = await res.text();
    expect(page).toContain('data-testid="sponsor-card-title">Card Co</h2>');
    expect(page).toContain('data-testid="sponsor-card-business">Card Co LLC</p>');
    expect(page).toContain('123 Main St, Blue Island');
    expect(page).toContain('href="tel:7085550100;ext=7"');
    expect(page).toContain('href="mailto:hi@cardco.example"');
    expect(page).toContain('src="/sponsor-default-logo.svg"');
    expect(page).not.toContain('sponsor-card-website');
  });

  test('a card with only a name is valid: no location, no contact buttons', async () => {
    const id = await onShow({ name: 'Just A Name' });
    const page = await (await SELF.fetch(`https://t.test/sponsors/${id}`)).text();
    expect(page).toContain('>Just A Name</h2>');
    expect(page).not.toContain('sponsor-card-address');
    expect(page).not.toContain('sponsor-card-phone');
    expect(page).not.toContain('sponsor-card-email');
    expect(page).not.toContain('sponsor-card-business');
  });

  test('a sponsor with a logo loads it through the same-origin proxy, never the stored URL', async () => {
    const id = await onShow({ name: 'Logo Co', logo_url: 'https://cdn.example.com/logo.png' });
    const page = await (await SELF.fetch(`https://t.test/sponsors/${id}`)).text();
    expect(page).toContain(`src="/api/v2/sponsors/${id}/logo"`);
    expect(page).toContain('data-default-src="/sponsor-default-logo.svg"');
    expect(page).not.toContain('cdn.example.com');
  });

  test('hostile stored values are escaped everywhere they land', async () => {
    const id = await onShow({ name: 'Safe LLC' });
    await env.DB.prepare(
      `UPDATE sponsor_business SET display_name = ?, address_line = ?, contact_email = ?,
              website_url = 'javascript:alert(1)' WHERE id = ?`
    )
      .bind('"><script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'a"b@x.example', id)
      .run();
    const page = await (await SELF.fetch(`https://t.test/sponsors/${id}`)).text();
    expect(page).not.toContain('<script>alert(1)');
    expect(page).not.toContain('<img src=x');
    expect(page).not.toContain('mailto:a"b');
    expect(page).not.toContain('javascript:alert');
    expect(page).toContain('&quot;&gt;&lt;script&gt;');
  });

  test('only a sponsor on show is reachable: pool, unaccepted, inactive and unknown all 404', async () => {
    const pool = await create({ name: 'Pool Only', tier: 'gold' });
    const unaccepted = await create({ name: 'Unaccepted', tier: 'gold', event_id: EVENT });
    const inactiveId = await onShow({ name: 'Gone' });
    await env.DB.prepare('UPDATE sponsor_business SET is_active = 0 WHERE id = ?')
      .bind(inactiveId)
      .run();
    for (const id of [
      String(pool.body.id),
      String(unaccepted.body.id),
      inactiveId,
      'sp_nope',
      'bad%20id',
    ]) {
      const res = await SELF.fetch(`https://t.test/sponsors/${id}`);
      expect(res.status, id).toBe(404);
    }
  });

  test('the card is rate-limited like every public read', async () => {
    const id = await onShow({ name: 'Limited' });
    const res = await handleSponsorCardPage(
      new Request(`https://t.test/sponsors/${id}`, {
        headers: { 'CF-Connecting-IP': '203.0.113.9' },
      }),
      { DB: env.DB, RATE_LIMIT_KV: OVER_LIMIT_KV },
      id
    );
    expect(res.status).toBe(429);
  });
});

describe('0083 | the OSE default image and the logo proxy', () => {
  test('GET /sponsor-default-logo.svg is a static, locked-down SVG', async () => {
    const res = await SELF.fetch('https://t.test/sponsor-default-logo.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\/svg\+xml/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    const svg = await res.text();
    expect(svg).toMatch(/^<svg /);
    expect(svg).not.toMatch(/<script|href=|url\(/i);
  });

  test('?slot=sidebar serves the compact logo when only that one exists', async () => {
    // The stored host is unreachable, so a lookup that FOUND a logo ends at 502
    // (upstream failed) while one that found none is a 404.
    const id = await onShow({
      name: 'Compact Only',
      sidebar_logo_url: 'https://logo.invalid/s.png',
    });
    expect((await SELF.fetch(`https://t.test/api/v2/sponsors/${id}/logo`)).status).toBe(404);
    expect(
      (await SELF.fetch(`https://t.test/api/v2/sponsors/${id}/logo?slot=sidebar`)).status
    ).toBe(502);
  });

  test('a logo-proxy cache miss is rate-limited (it is an outbound fetch)', async () => {
    const id = await onShow({
      name: 'Proxy Limited',
      logo_url: 'https://logo.invalid/limited.png',
    });
    const res = await handleSponsorLogo(
      new Request(`https://t.test/api/v2/sponsors/${id}/logo`, {
        headers: { 'CF-Connecting-IP': '203.0.113.10' },
      }),
      { ...(env as unknown as Record<string, unknown>), RATE_LIMIT_KV: OVER_LIMIT_KV } as never,
      id
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(SPONSOR_LOGO_READ_MAX).toBeGreaterThanOrEqual(120);
  });
});

describe('0083 | pure helpers', () => {
  test('title falls back to the name; blank display names do not win', () => {
    expect(sponsorTitle({ name: 'A', display_name: null })).toBe('A');
    expect(sponsorTitle({ name: 'A', display_name: '   ' })).toBe('A');
    expect(sponsorTitle({ name: 'A', display_name: 'B' })).toBe('B');
  });

  test('tel: keeps only what dials', () => {
    expect(telHref('(773) 555-0100')).toBe('tel:7735550100');
    expect(telHref('+1 773.555.0100 ext. 42')).toBe('tel:+17735550100;ext=42');
  });

  test('whitespace-only means "clear", not "a blank title"', () => {
    expect(checkCardField('display_name', '   ')).toEqual({ ok: true, value: null });
  });
});

// ── CCR PR #699 holds ───────────────────────────────────────────────────────

const DRAFT_EVENT = 'ose0083-draft-evt';

async function auditRows(id: string) {
  const r = await env.DB.prepare(
    `SELECT action, details FROM admin_audit_log WHERE resource_type = 'sponsor' AND resource_id = ?
      ORDER BY rowid`
  )
    .bind(id)
    .all<{ action: string; details: string | null }>();
  return r.results ?? [];
}

describe('CCR PR #699 | gates, audit, retention', () => {
  beforeAll(async () => {
    await env.DB.prepare(
      // OSE-1900: opted in, so what keeps this one off the card is the draft status alone.
      `INSERT INTO events (id, brand_id, title, slug, status, settings_json)
       VALUES (?, ?, 'Draft Night', ?, 'draft', '{"useSponsors":true}') ON CONFLICT(id) DO NOTHING`
    )
      .bind(DRAFT_EVENT, BRAND, DRAFT_EVENT)
      .run();
  });

  test('a sponsor placed only on a draft event is not on show: its card 404s', async () => {
    const { body } = await create({
      name: 'Draft Only',
      tier: 'gold',
      event_id: DRAFT_EVENT,
      contact_phone: '(773) 555-0142',
    });
    const id = String(body.id);
    await env.DB.prepare(
      'UPDATE sponsor_placement SET sponsor_accepted = 1 WHERE sponsor_business_id = ?'
    )
      .bind(id)
      .run();
    expect((await SELF.fetch(`https://t.test/sponsors/${id}`)).status).toBe(404);
  });

  test('the logo proxy has the same consent gate: an unaccepted sponsor gets no logo', async () => {
    const { body } = await create({
      name: 'Not Accepted Logo',
      tier: 'gold',
      event_id: EVENT,
      logo_url: 'https://logo.invalid/pending.png',
    });
    const id = String(body.id);
    // Placement is active but the sponsor has not accepted → not served (404,
    // not 502: the lookup never reaches the upstream).
    expect((await SELF.fetch(`https://t.test/api/v2/sponsors/${id}/logo`)).status).toBe(404);
    await env.DB.prepare(
      'UPDATE sponsor_placement SET sponsor_accepted = 1 WHERE sponsor_business_id = ?'
    )
      .bind(id)
      .run();
    expect((await SELF.fetch(`https://t.test/api/v2/sponsors/${id}/logo`)).status).toBe(502);
  });

  test('sponsor writes are audited (by the router) and the audit never copies contact values', async () => {
    const { body } = await create({
      name: 'Audited Co',
      tier: 'gold',
      contact_email: 'secret@audited.example',
    });
    const id = String(body.id);
    await update(id, { contact_phone: '(773) 555-0177' });
    await SELF.fetch(`https://t.test/api/v2/admin/sponsors/${id}`, {
      method: 'DELETE',
      headers: ADMIN,
    });
    const rows = await auditRows(id);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('UPDATE_SPONSOR');
    expect(actions).toContain('DELETE_SPONSOR');
    const all = JSON.stringify(rows);
    expect(all).not.toContain('secret@audited.example');
    expect(all).not.toContain('555-0177');
  });

  test('deactivating a sponsor clears its location and contact (Invariant #8)', async () => {
    const { body } = await create({
      name: 'Leaving Co',
      tier: 'gold',
      display_name: 'Leaving',
      address_line: '1 Home St',
      contact_phone: '(773) 555-0188',
      contact_email: 'owner@leaving.example',
    });
    const id = String(body.id);
    const res = await SELF.fetch(`https://t.test/api/v2/admin/sponsors/${id}`, {
      method: 'DELETE',
      headers: ADMIN,
    });
    expect(res.status).toBe(200);
    expect(await card(id)).toEqual({
      display_name: 'Leaving',
      address_line: null,
      contact_phone: null,
      contact_email: null,
    });
  });
});

describe('CCR PR #699 | logo proxy success path + edge cache', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const upstream = vi.fn(
    async (url: string) =>
      new Response(PNG, {
        status: 200,
        headers: { 'content-type': 'image/png', 'x-upstream': url },
      })
  );
  const proxyEnv = (kv?: KVNamespace) =>
    ({
      ...(env as unknown as Record<string, unknown>),
      ...(kv ? { RATE_LIMIT_KV: kv } : {}),
    }) as never;
  const get = (id: string, slot = '', kv?: KVNamespace) =>
    handleSponsorLogo(
      new Request(`https://t.test/api/v2/sponsors/${id}/logo${slot}`, {
        headers: { 'CF-Connecting-IP': '203.0.113.40' },
      }),
      proxyEnv(kv),
      id
    );

  afterEach(() => {
    vi.unstubAllGlobals();
    upstream.mockClear();
  });

  test('a successful proxy is served with the hardened headers', async () => {
    vi.stubGlobal('fetch', upstream);
    const u = `https://cdn.example.com/ok-${Date.now()}.png`;
    const id = await onShow({ name: 'Proxy OK', logo_url: u });
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    // OSE-1432: the full header set the T2 Bruno request asserts on staging, so
    // the offline layer and the staging layer check the same contract.
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
    expect(upstream).toHaveBeenCalledWith(u, expect.anything());
  });

  // OSE-1432 mirror of the T2 "not on show" case: the sponsor HAS a logo, so the
  // 404 comes from the consent gate, not from missing data, and nothing is fetched.
  test('a pool sponsor with a logo, and an unknown id, get 404 with no upstream fetch', async () => {
    vi.stubGlobal('fetch', upstream);
    const { status, body } = await create({
      name: 'Pool With Logo',
      tier: 'gold',
      logo_url: `https://cdn.example.com/pool-${Date.now()}.png`,
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect((await get(String(body.id))).status).toBe(404);
    expect((await get(String(body.id), '?slot=sidebar')).status).toBe(404);
    expect((await get('sb_does_not_exist')).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  test('?slot=sidebar prefers the compact logo and falls back to the header logo', async () => {
    vi.stubGlobal('fetch', upstream);
    const t = Date.now();
    const both = await onShow({
      name: 'Both Logos',
      logo_url: `https://cdn.example.com/wide-${t}.png`,
      sidebar_logo_url: `https://cdn.example.com/square-${t}.png`,
    });
    const headerOnly = await onShow({
      name: 'Header Only',
      logo_url: `https://cdn.example.com/w2-${t}.png`,
    });
    expect((await get(both, '?slot=sidebar')).status).toBe(200);
    expect(upstream).toHaveBeenLastCalledWith(
      `https://cdn.example.com/square-${t}.png`,
      expect.anything()
    );
    expect((await get(both)).status).toBe(200);
    expect(upstream).toHaveBeenLastCalledWith(
      `https://cdn.example.com/wide-${t}.png`,
      expect.anything()
    );
    expect((await get(headerOnly, '?slot=sidebar')).status).toBe(200);
    expect(upstream).toHaveBeenLastCalledWith(
      `https://cdn.example.com/w2-${t}.png`,
      expect.anything()
    );
  });

  test('a cache hit makes no upstream fetch and does not spend the rate limit', async () => {
    vi.stubGlobal('fetch', upstream);
    const id = await onShow({
      name: 'Cached',
      logo_url: `https://cdn.example.com/c-${Date.now()}.png`,
    });
    expect((await get(id)).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    // Second view, even for a caller far over the limit: served from the edge
    // cache, no outbound fetch, no 429.
    const again = await get(id, '', OVER_LIMIT_KV);
    expect(again.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(PNG);
  });

  // OSE-1433 replaces the PR #699 rule "a failed upstream is not cached": a
  // dead host is now remembered for SPONSOR_LOGO_NEGATIVE_TTL_S, so repeated
  // views do not re-fetch it. Born red against the #699 handler (2 calls).
  test('OSE-1433: a failed upstream is remembered: a second view within the TTL makes no upstream call', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', failing);
    const id = await onShow({
      name: 'Dead Host',
      logo_url: `https://cdn.example.com/f-${Date.now()}.png`,
    });
    expect((await get(id)).status).toBe(502);
    const again = await get(id);
    expect(again.status).toBe(502);
    expect(again.headers.get('cache-control')).toBe('no-store');
    expect(failing).toHaveBeenCalledTimes(1);
    expect(SPONSOR_LOGO_NEGATIVE_TTL_S).toBe(60);
  });

  test('OSE-1433: a remembered failure does not shadow a later success for a new URL', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', failing);
    const t = Date.now();
    const id = await onShow({ name: 'Fixed Logo', logo_url: `https://cdn.example.com/x-${t}.png` });
    expect((await get(id)).status).toBe(502);
    // The admin fixes the logo: a new URL is a new cache key.
    expect((await update(id, { logo_url: `https://cdn.example.com/y-${t}.png` })).status).toBe(200);
    vi.stubGlobal('fetch', upstream);
    expect((await get(id)).status).toBe(200);
  });

  test('OSE-1433: a private or local logo host is refused on write', async () => {
    for (const logo_url of [
      'http://127.0.0.1/l.png',
      'http://169.254.169.254/latest/meta-data',
      'http://localhost:8787/l.png',
      'http://[::1]/l.png',
    ]) {
      const { status, body } = await create({ tier: 'gold', name: 'Sneaky', logo_url });
      expect(status, logo_url).toBe(400);
      expect(JSON.stringify(body), logo_url).toContain('INVALID_LOGO_URL');
    }
  });

  test('OSE-1433: a logo URL stored before the host rule is refused at fetch, with no request', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const id = await onShow({
      name: 'Old Row',
      logo_url: `https://cdn.example.com/o-${Date.now()}.png`,
    });
    await env.DB.prepare(
      "UPDATE sponsor_asset SET url = 'http://10.0.0.5/l.png' WHERE sponsor_business_id = ? AND format = 'logo'"
    )
      .bind(id)
      .run();
    expect((await get(id)).status).toBe(422);
    expect(f).not.toHaveBeenCalled();
  });

  // Copilot review on #721: the caches cannot coalesce simultaneous cold misses,
  // so the isolate caps upstream fetches in flight. Distinct URLs keep every
  // request a cold miss; the stub holds each fetch open until released.
  test('OSE-1433: concurrent cold misses are capped per isolate; the extra one gets a 503 and no fetch', async () => {
    const release: Array<() => void> = [];
    const held = vi.fn(
      () =>
        new Promise<Response>((resolve) =>
          release.push(() =>
            resolve(new Response(PNG, { headers: { 'content-type': 'image/png' } }))
          )
        )
    );
    vi.stubGlobal('fetch', held);
    const t = Date.now();
    const ids: string[] = [];
    for (let i = 0; i <= SPONSOR_LOGO_MAX_IN_FLIGHT; i++) {
      ids.push(
        await onShow({ name: `Burst ${i}`, logo_url: `https://cdn.example.com/b${i}-${t}.png` })
      );
    }
    const pending = ids.slice(0, SPONSOR_LOGO_MAX_IN_FLIGHT).map((id) => get(id));
    // Let every held request reach its upstream fetch.
    for (let i = 0; i < 50 && held.mock.calls.length < SPONSOR_LOGO_MAX_IN_FLIGHT; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(held).toHaveBeenCalledTimes(SPONSOR_LOGO_MAX_IN_FLIGHT);
    const extra = await get(ids[SPONSOR_LOGO_MAX_IN_FLIGHT]);
    expect(extra.status).toBe(503);
    expect(extra.headers.get('cache-control')).toBe('no-store');
    expect(held).toHaveBeenCalledTimes(SPONSOR_LOGO_MAX_IN_FLIGHT);
    release.forEach((r) => r());
    for (const res of await Promise.all(pending)) expect(res.status).toBe(200);
    // The slots are given back: the next cold miss fetches again.
    vi.stubGlobal('fetch', upstream);
    expect((await get(ids[SPONSOR_LOGO_MAX_IN_FLIGHT])).status).toBe(200);
  });

  test('OSE-1433: an unanswered sponsor request gets no logo (same organizer rule as the card)', async () => {
    vi.stubGlobal('fetch', upstream);
    const id = await onShow({
      name: 'Asked To Join',
      logo_url: `https://cdn.example.com/r-${Date.now()}.png`,
    });
    await env.DB.prepare(
      "UPDATE sponsor_placement SET source = 'sponsor_request', organizer_accepted = NULL WHERE sponsor_business_id = ?"
    )
      .bind(id)
      .run();
    expect((await get(id)).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
