/**
 * A sponsor logo may be an image uploaded to OSE (owner 2026-11-10).
 *
 * The staging stock sponsors take their art from the same R2 pool as the stock
 * events' poster art (scripts/stock/build-full.mjs giveSponsorsArt), until a
 * real sponsor uploads its own. So a sponsor's logo_url / sidebar_logo_url may
 * be an `/api/v2/uploads/…` path, and the logo proxy reads it from R2 instead
 * of fetching it — behind the same consent gate, with the same image-type,
 * size and header rules as a fetched logo.
 *
 * Mock layer (workers pool). The staging layer is the Bruno request in
 * `bruno/ose-api/14. Public Sponsor Card & Logo (OSE-1432)/`.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleSponsorAsset } from '../src/handlers/sponsor-asset-route';

interface TestEnv {
  DB: D1Database;
  UPLOADS_BUCKET: R2Bucket;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'upl-logo';
const EVENT = 'upl-logo-evt';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const ART_KEY = `events/${EVENT}/1-stock-art.png`;
const ART = `/api/v2/uploads/${ART_KEY}`;
const PDF_KEY = `events/${EVENT}/2-flyer.pdf`;

type Json = Record<string, unknown>;

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv().TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('no such column')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare(
    // OSE-1900: the event chose to have sponsors, so its sponsors' logos are served.
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, settings_json)
     VALUES (?, ?, 'Upload Night', ?, 'active', 1, date('now', '+7 days'), date('now', '+8 days'), '{"useSponsors":true}')
     ON CONFLICT(id) DO NOTHING`
  )
    .bind(EVENT, BRAND, EVENT)
    .run();
  await tenv().UPLOADS_BUCKET.put(ART_KEY, PNG, { httpMetadata: { contentType: 'image/png' } });
  await tenv().UPLOADS_BUCKET.put(PDF_KEY, new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
    httpMetadata: { contentType: 'application/pdf' },
  });
});

async function create(payload: Json): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch('https://t.test/api/v2/admin/sponsors', {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand_id: BRAND, tier: 'gold', ...payload }),
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

/** Create a sponsor on EVENT; accept the placement unless told not to. */
async function sponsor(payload: Json, accepted = true): Promise<string> {
  const { status, body } = await create({ event_id: EVENT, ...payload });
  expect(status, JSON.stringify(body)).toBe(201);
  const id = String(body.id);
  if (accepted) {
    await env.DB.prepare(
      'UPDATE sponsor_placement SET sponsor_accepted = 1 WHERE sponsor_business_id = ?'
    )
      .bind(id)
      .run();
  }
  return id;
}

async function storedLogo(id: string, format: 'logo' | 'logo_compact'): Promise<unknown> {
  const row = await env.DB.prepare(
    'SELECT url FROM sponsor_asset WHERE sponsor_business_id = ? AND format = ?'
  )
    .bind(id, format)
    .first<{ url: string }>();
  return row?.url ?? null;
}

const logo = (id: string, slot = '') =>
  SELF.fetch(`https://t.test/api/v2/sponsors/${encodeURIComponent(id)}/logo${slot}`);

describe('writing an uploaded logo', () => {
  test('create stores an uploaded image path as the header and the sidebar logo', async () => {
    const id = await sponsor({ name: 'Stock Art Co', logo_url: ART, sidebar_logo_url: ART });
    expect(await storedLogo(id, 'logo')).toBe(ART);
    expect(await storedLogo(id, 'logo_compact')).toBe(ART);
  });

  test('update sets an uploaded image path, and can clear it', async () => {
    const id = await sponsor({ name: 'Later Art Co' });
    expect((await update(id, { logo_url: ART })).status).toBe(200);
    expect(await storedLogo(id, 'logo')).toBe(ART);
    expect((await update(id, { logo_url: null })).status).toBe(200);
    expect(await storedLogo(id, 'logo')).toBeNull();
  });

  test.each([
    ['a climb out of the uploads folder', '/api/v2/uploads/events/../../secret.png'],
    ['a dot segment', '/api/v2/uploads/./events/x.png'],
    ['a same-site path outside uploads', '/api/v2/admin/sponsors'],
    ['a bare relative path', 'events/x/art.png'],
    ['a query riding along', '/api/v2/uploads/events/x/art.png?x=1'],
    ['an encoded climb', '/api/v2/uploads/events/%2e%2e/art.png'],
  ])('refuses %s on create and on update, nothing stored', async (_name, bad) => {
    const created = await create({ name: 'Bad Path', logo_url: bad });
    expect(created.status, bad).toBe(400);
    expect(created.body.code).toBe('INVALID_LOGO_URL');

    const id = await sponsor({ name: 'Bad Path Later' });
    const updated = await update(id, { sidebar_logo_url: bad });
    expect(updated.status, bad).toBe(400);
    expect(updated.body.code).toBe('INVALID_SIDEBAR_LOGO_URL');
    expect(await storedLogo(id, 'logo_compact')).toBeNull();
  });

  test('an outside logo still has to be on a public host (the OSE-1433 rule is unchanged)', async () => {
    const { status, body } = await create({ name: 'Local', logo_url: 'http://localhost/a.png' });
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_LOGO_URL');
  });
});

describe('serving an uploaded logo', () => {
  test('the proxy reads it from R2: the image, with the hardened headers', async () => {
    const id = await sponsor({ name: 'Served Art Co', logo_url: ART });
    const res = await logo(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-length')).toBe(String(PNG.byteLength));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  test('the sidebar slot falls back to the uploaded header logo', async () => {
    const id = await sponsor({ name: 'Sidebar Art Co', logo_url: ART });
    const res = await logo(id, '?slot=sidebar');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  test('an upload that is gone is a 404, never a broken image', async () => {
    const id = await sponsor({
      name: 'Gone Art Co',
      logo_url: `/api/v2/uploads/events/${EVENT}/9-gone.png`,
    });
    const res = await logo(id);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('an upload that is not an image (a PDF) is refused, 422', async () => {
    const id = await sponsor({ name: 'Pdf Co', logo_url: `/api/v2/uploads/${PDF_KEY}` });
    expect((await logo(id)).status).toBe(422);
  });

  test('the consent gate holds: a sponsor that has not accepted is a 404, art or not', async () => {
    const id = await sponsor({ name: 'Not Yet Co', logo_url: ART }, false);
    expect((await logo(id)).status).toBe(404);
  });

  test('the per-format asset route shows the uploaded logo, not the monogram', async () => {
    const id = await sponsor({ name: 'Asset Art Co', logo_url: ART });
    const res = await handleSponsorAsset(new Request('https://x'), tenv(), id, 'square');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});

describe('the event page', () => {
  test('a sponsor whose logo is an upload shows as thumbnail art through the proxy', async () => {
    const id = await sponsor({ name: 'Page Art Co', logo_url: ART });
    const html = await (await SELF.fetch(`https://t.test/events/${EVENT}`)).text();
    expect(html).toContain(`src="/api/v2/sponsors/${id}/logo?slot=sidebar"`);
    expect(html).toContain('alt="Page Art Co"');
    // the page asks the proxy; the upload path itself is never the thumb's src
    expect(html).not.toContain(`src="${ART}"`);
  });
});
