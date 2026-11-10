/**
 * OSE-1826 — the sponsor's header block (migration 0105), API half.
 *
 * Owner 2026-11-09: "Sponsored by" is a small label and each sponsor gets a
 * header block on the digital poster: a full-width header image and a short
 * text, both from the sponsor's settings. This is the space hyperlocal,
 * first-tier sponsors pay for.
 *
 *   - admin create / update: header_image_url (http(s), public host, max 500)
 *     and header_text (max 140, whitespace collapsed); '' / null clears each
 *   - the public bundle (poster-bundle and /sponsors): header_text and a
 *     has_header_image yes/no; the image's address never leaves the server
 *   - the logo proxy ?slot=header: serves the header image behind the same
 *     two-sided consent gate; no header image is a 404, never the logo
 *   - tier equity (#5): every tier gets the same block
 *   - deactivating a sponsor clears both
 *
 * The page half (markup, fallback, failed image) is poster-sponsor-header.spec.ts
 * (jsdom); the phone check is tests/playwright/poster-digital-actions.spec.ts.
 *
 * @born-red OSE-1826 | method: run with the server half stashed (src/handlers/
 *   sponsors.ts, src/lib/sponsor-card.ts, src/lib/sponsor-resolver.ts back at
 *   the parent commit, migration 0105 kept so the columns exist) and with
 *   planted faults: the proxy's header slot falling back to the logo, the
 *   bundle publishing the image address, the delete leaving header_text
 * | date: 2026-11-09
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { handleSponsorLogo } from '../src/handlers/sponsors';
import { checkCardField, HEADER_TEXT_MAX } from '../src/lib/sponsor-card';

const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const TIERS = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
}

const BRAND = 'ose1826';
const EVENT = 'ose1826-evt';

beforeAll(async () => {
  const tenv = env as unknown as TestEnv;
  await applyMigrations(tenv.DB, tenv.TEST_MIGRATION_STATEMENTS);
  // The poster bundle reads the forms side for its codes.
  await applyMigrations(tenv.FORMS_DB, tenv.TEST_FORMS_MIGRATION_STATEMENTS);
  await env.DB.prepare(
    // OSE-1900: the event chose to have sponsors, so its sponsor is on show.
    `INSERT INTO events (id, brand_id, title, slug, status, start_date, settings_json)
     VALUES (?, ?, 'Header Night', ?, 'active', '2026-11-11', '{"useSponsors":true}') ON CONFLICT(id) DO NOTHING`
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

async function stored(id: string) {
  return env.DB.prepare('SELECT header_image_url, header_text FROM sponsor_business WHERE id = ?')
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

async function bundleSponsor(id: string): Promise<Json | undefined> {
  const res = await SELF.fetch(`https://t.test/api/v2/events/${EVENT}/poster-bundle`);
  expect(res.status).toBe(200);
  const b = (await res.json()) as { sponsors?: Json[] };
  return (b.sponsors ?? []).find((s) => s.id === id);
}

describe('OSE-1826 | header image and text: optional, validated, clearable', () => {
  test('stored on create and read back by the admin', async () => {
    const { status, body } = await create({
      name: 'Western Ave Bakery',
      tier: 'primary',
      header_image_url: 'https://cdn.example.com/bakery-header.jpg',
      header_text: '  Fresh bread   every morning,\n two blocks from the square. ',
    });
    expect(status, JSON.stringify(body)).toBe(201);
    const id = String(body.id);
    expect(await stored(id)).toEqual({
      header_image_url: 'https://cdn.example.com/bakery-header.jpg',
      // Whitespace collapsed: one block of text, never a layout of its own.
      header_text: 'Fresh bread every morning, two blocks from the square.',
    });
    const res = await SELF.fetch(`https://t.test/api/v2/admin/sponsors/${id}`, { headers: ADMIN });
    const one = (await res.json()) as Json;
    const item = (one.item ?? one.sponsor ?? one) as Json;
    expect(item.header_image_url).toBe('https://cdn.example.com/bakery-header.jpg');
    expect(item.header_text).toBe('Fresh bread every morning, two blocks from the square.');
  });

  test('a sponsor with neither is complete (the fallback is logo and name)', async () => {
    const { status, body } = await create({ name: 'Plain Co', tier: 'primary' });
    expect(status).toBe(201);
    expect(await stored(String(body.id))).toEqual({ header_image_url: null, header_text: null });
  });

  test.each([
    ['javascript:alert(1)', 'a script address'],
    ['data:image/png;base64,AAAA', 'a data address'],
    ['ftp://cdn.example.com/h.png', 'another scheme'],
    ['https://127.0.0.1/h.png', 'a local host'],
    ['https://10.0.0.5/h.png', 'a private host'],
    [`https://cdn.example.com/${'a'.repeat(500)}.png`, 'over 500 characters'],
    [42, 'not text'],
  ])('header image %s (%s) is refused with INVALID_HEADER_IMAGE_URL', async (value) => {
    const { status, body } = await create({
      name: 'Bad Header',
      tier: 'gold',
      header_image_url: value,
    });
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_HEADER_IMAGE_URL');
  });

  test(`header text over ${HEADER_TEXT_MAX} characters is refused; exactly ${HEADER_TEXT_MAX} is kept`, async () => {
    const over = await create({ name: 'Long', tier: 'gold', header_text: 'x'.repeat(141) });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('INVALID_HEADER_TEXT');
    const edge = await create({ name: 'Edge', tier: 'gold', header_text: 'y'.repeat(140) });
    expect(edge.status).toBe(201);
    expect((await stored(String(edge.body.id)))!.header_text).toBe('y'.repeat(140));
    expect(checkCardField('header_text', 42)).toMatchObject({ ok: false });
  });

  test('update sets each, and "" / null clears each; a bad value changes nothing', async () => {
    const { body } = await create({ name: 'Editable', tier: 'gold' });
    const id = String(body.id);
    expect(
      (
        await update(id, {
          header_image_url: 'https://cdn.example.com/e.png',
          header_text: 'Open late on Fridays',
        })
      ).status
    ).toBe(200);
    expect(await stored(id)).toEqual({
      header_image_url: 'https://cdn.example.com/e.png',
      header_text: 'Open late on Fridays',
    });
    const bad = await update(id, { header_image_url: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_HEADER_IMAGE_URL');
    expect((await stored(id))!.header_image_url).toBe('https://cdn.example.com/e.png');
    expect((await update(id, { header_image_url: '', header_text: null })).status).toBe(200);
    expect(await stored(id)).toEqual({ header_image_url: null, header_text: null });
  });

  test('tier equity (#5): every tier can set the same header block', async () => {
    for (const tier of TIERS) {
      const { status, body } = await create({
        name: `Tier ${tier}`,
        tier,
        header_image_url: 'https://cdn.example.com/t.png',
        header_text: 'Same block at every tier',
      });
      expect(status, `${tier}: ${JSON.stringify(body)}`).toBe(201);
    }
  });

  test('deactivating a sponsor clears its header image and text', async () => {
    const { body } = await create({
      name: 'Leaving Bakery',
      tier: 'gold',
      header_image_url: 'https://cdn.example.com/leaving.png',
      header_text: 'Last day Sunday',
    });
    const id = String(body.id);
    const res = await SELF.fetch(`https://t.test/api/v2/admin/sponsors/${id}`, {
      method: 'DELETE',
      headers: ADMIN,
    });
    expect(res.status).toBe(200);
    expect(await stored(id)).toEqual({ header_image_url: null, header_text: null });
  });
});

describe('OSE-1826 | the public bundle: the text and a yes/no, never the image address', () => {
  test('a sponsor on show carries header_text and has_header_image: true', async () => {
    const id = await onShow({
      name: 'Bundle Bakery',
      header_image_url: 'https://cdn.example.com/bundle-secret-path.png',
      header_text: 'Two blocks from the square',
    });
    const s = await bundleSponsor(id);
    expect(s, 'sponsor in the poster bundle').toBeDefined();
    expect(s!.header_text).toBe('Two blocks from the square');
    expect(s!.has_header_image).toBe(true);
    expect(s).not.toHaveProperty('header_image_url');
    expect(JSON.stringify(s)).not.toContain('bundle-secret-path');
  });

  test('a sponsor with neither: header_text null, has_header_image false', async () => {
    const id = await onShow({ name: 'Bundle Plain' });
    const s = await bundleSponsor(id);
    expect(s!.header_text).toBeNull();
    expect(s!.has_header_image).toBe(false);
  });

  test('an unaccepted sponsor is not in the bundle at all (two-sided consent)', async () => {
    const { body } = await create({
      name: 'Not Yet',
      tier: 'gold',
      event_id: EVENT,
      header_text: 'Should not show',
    });
    expect(await bundleSponsor(String(body.id))).toBeUndefined();
  });
});

describe('OSE-1826 | the logo proxy ?slot=header', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const upstream = vi.fn(
    async (url: string) =>
      new Response(PNG, {
        status: 200,
        headers: { 'content-type': 'image/png', 'x-upstream': url },
      })
  );
  const get = (id: string, slot = '?slot=header') =>
    handleSponsorLogo(
      new Request(`https://t.test/api/v2/sponsors/${id}/logo${slot}`, {
        headers: { 'CF-Connecting-IP': '203.0.113.41' },
      }),
      env as never,
      id
    );

  afterEach(() => {
    vi.unstubAllGlobals();
    upstream.mockClear();
  });

  test('serves the header image (not the logo) for a sponsor on show', async () => {
    vi.stubGlobal('fetch', upstream);
    const t = Date.now();
    const id = await onShow({
      name: 'Proxy Header',
      logo_url: `https://cdn.example.com/logo-${t}.png`,
      header_image_url: `https://cdn.example.com/header-${t}.png`,
    });
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(upstream).toHaveBeenLastCalledWith(
      `https://cdn.example.com/header-${t}.png`,
      expect.anything()
    );
    // The plain logo route still serves the logo.
    expect((await get(id, '')).status).toBe(200);
    expect(upstream).toHaveBeenLastCalledWith(
      `https://cdn.example.com/logo-${t}.png`,
      expect.anything()
    );
  });

  test('no header image is a 404 with no fetch, never the logo in its place', async () => {
    vi.stubGlobal('fetch', upstream);
    const id = await onShow({
      name: 'Logo Only',
      logo_url: `https://cdn.example.com/only-logo-${Date.now()}.png`,
    });
    expect((await get(id)).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  test('the same consent gate: an unaccepted or pool sponsor gets no header image', async () => {
    vi.stubGlobal('fetch', upstream);
    const pending = await create({
      name: 'Pending Header',
      tier: 'gold',
      event_id: EVENT,
      header_image_url: `https://cdn.example.com/pending-${Date.now()}.png`,
    });
    expect((await get(String(pending.body.id))).status).toBe(404);
    const pool = await create({
      name: 'Pool Header',
      tier: 'gold',
      header_image_url: `https://cdn.example.com/pool-${Date.now()}.png`,
    });
    expect((await get(String(pool.body.id))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  test('the route answers through the router too (public, same-origin)', async () => {
    const res = await SELF.fetch(`https://t.test/api/v2/sponsors/sb_nope/logo?slot=header`);
    expect(res.status).toBe(404);
  });
});
