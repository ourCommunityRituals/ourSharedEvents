/**
 * OSE-735 / T7b — GET /api/v2/sponsors/:id/asset/:format serve route.
 *
 * Headline #25: a sponsor missing 3 of 4 formats is NEVER dropped from a surface
 * — resolveAssetSource returns a 200 (real or monogram) for ALL four formats of
 * a 1-format sponsor. Proven end-to-end here through the route: R2 hit for the
 * uploaded format, monogram for the rest.
 *
 * Also: unknown sponsor → 404; invalid format → 400; monogram is a valid SVG.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll, vi } from 'vitest';
import { handleSponsorAsset, generateMonogramSvg } from '../src/handlers/sponsor-asset-route';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { fetchAndProxyLogo, LOGO_MAX_IN_FLIGHT } from '../src/lib/sponsor-logo';

interface RawEnv {
  DB: D1Database;
  UPLOADS_BUCKET: R2Bucket;
  TEST_MIGRATION_STATEMENTS: string;
}
const e = () => env as unknown as RawEnv;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FORMATS = ['poster', 'banner', 'vertical', 'square'] as const;

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(e().TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate column name')) continue;
      if (msg.includes('no such column')) continue;
      throw err;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare(
    // OSE-1900: the event chose to have sponsors, so its sponsors' creative is served.
    `INSERT OR IGNORE INTO events (id, brand_id, title, slug, settings_json) VALUES ('evt_asset', 'b', 'E', 'evt-asset', '{"useSponsors":true}')`
  ).run();
  // A 1-format sponsor: only 'poster' set (points at an R2 key), no logo_url.
  // OSE-799 A2: per-format creative is a sponsor_asset row (format='poster').
  await seedSplitSponsor(env.DB, {
    id: 'spn_1fmt',
    eventId: 'evt_asset',
    name: 'One Format Co',
    posterUrl: 'sponsors/spn_1fmt/poster',
  });
  await e().UPLOADS_BUCKET.put('sponsors/spn_1fmt/poster', PNG, {
    httpMetadata: { contentType: 'image/png' },
  });
  // A no-asset sponsor: nothing uploaded, no logo → pure monogram.
  await seedSplitSponsor(env.DB, { id: 'spn_bare', eventId: 'evt_asset', name: 'Bare Co' });
  await seedSplitSponsor(env.DB, {
    id: 'spn_unconfirmed',
    eventId: 'evt_asset',
    name: 'Unconfirmed Co',
    sponsorAccepted: 0,
    posterUrl: 'sponsors/spn_unconfirmed/poster',
  });
  await e().UPLOADS_BUCKET.put('sponsors/spn_unconfirmed/poster', PNG, {
    httpMetadata: { contentType: 'image/png' },
  });
});

describe('OSE-735 — always-200 across all four formats (headline #25)', () => {
  test('1-format sponsor returns 200 for ALL four formats (R2 for poster, monogram otherwise)', async () => {
    for (const fmt of FORMATS) {
      const res = await handleSponsorAsset(new Request('https://x'), e(), 'spn_1fmt', fmt);
      expect(res.status, `format ${fmt} must be 200`).toBe(200);
      const ct = res.headers.get('Content-Type') ?? '';
      if (fmt === 'poster')
        expect(ct).toContain('image/png'); // the real R2 object
      else expect(ct).toContain('image/svg+xml'); // monogram fallback
    }
  });

  test('bare sponsor (no asset, no logo) → 200 monogram for every format', async () => {
    for (const fmt of FORMATS) {
      const res = await handleSponsorAsset(new Request('https://x'), e(), 'spn_bare', fmt);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type') ?? '').toContain('image/svg+xml');
      const body = await res.text();
      expect(body).toMatch(/<svg[\s>]/);
    }
  });

  test('unconfirmed sponsor → 404 before creative or monogram can expose its identity', async () => {
    for (const fmt of FORMATS) {
      const res = await handleSponsorAsset(new Request('https://x'), e(), 'spn_unconfirmed', fmt);
      expect(res.status, `format ${fmt} must stay hidden without sponsor consent`).toBe(404);
      expect(await res.text()).not.toContain('Unconfirmed Co');
    }
  });
});

describe('OSE-735 — error cases + monogram shape', () => {
  test('unknown sponsor → 404', async () => {
    const res = await handleSponsorAsset(new Request('https://x'), e(), 'no_such', 'poster');
    expect(res.status).toBe(404);
  });

  test('invalid format → 400', async () => {
    const res = await handleSponsorAsset(new Request('https://x'), e(), 'spn_bare', 'billboard');
    expect(res.status).toBe(400);
  });

  test('monogram is deterministic, well-formed SVG with the initial letter, no brand hex', () => {
    const a = generateMonogramSvg('spn_bare', 'Bare Co');
    const b = generateMonogramSvg('spn_bare', 'Bare Co');
    expect(a).toBe(b); // deterministic
    expect(a).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(a).toContain('>B<'); // first letter of "Bare Co"
    expect(a).not.toMatch(/#[0-9a-fA-F]{3,6}\b/); // color is HSL, not a brand hex literal
    expect(a).toMatch(/hsl\(/);
  });

  test('monogram escapes hostile label content (no raw markup injection)', () => {
    const svg = generateMonogramSvg('x', '<script>alert(1)</script>');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

// OSE-1433 (Copilot review on #721): this route proxies the logo through the
// same shared fetcher as /logo, so it shares the per-isolate in-flight cap.
// With the cap full, it falls through to the monogram without a fetch.
describe('OSE-1433 | the asset route shares the logo in-flight cap', () => {
  test('cap full → monogram (200) and no upstream request', async () => {
    await seedSplitSponsor(env.DB, {
      id: 'spn_logo_cap',
      eventId: 'evt_asset',
      name: 'Logo Cap Co',
      logoUrl: 'https://cdn.example.com/cap.png',
    });
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
    try {
      const pending = Array.from({ length: LOGO_MAX_IN_FLIGHT }, (_, i) =>
        fetchAndProxyLogo(`https://cdn.example.com/hold-${i}.png`)
      );
      await Promise.resolve();
      expect(held).toHaveBeenCalledTimes(LOGO_MAX_IN_FLIGHT);
      const res = await handleSponsorAsset(new Request('https://x'), e(), 'spn_logo_cap', 'poster');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/svg/);
      expect(held).toHaveBeenCalledTimes(LOGO_MAX_IN_FLIGHT);
      release.forEach((r) => r());
      await Promise.all(pending);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
