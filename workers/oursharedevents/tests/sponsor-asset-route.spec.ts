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
import { describe, test, expect, beforeAll } from 'vitest';
import { handleSponsorAsset, generateMonogramSvg } from '../src/handlers/sponsor-asset-route';

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
    "INSERT OR IGNORE INTO events (id, brand_id, title, slug) VALUES ('evt_asset', 'b', 'E', 'evt-asset')"
  ).run();
  // A 1-format sponsor: only 'poster' set (points at an R2 key), no logo_url.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO sponsors (id, event_id, name, is_active, poster_url)
     VALUES ('spn_1fmt', 'evt_asset', 'One Format Co', 1, 'sponsors/spn_1fmt/poster')`
  ).run();
  await e().UPLOADS_BUCKET.put('sponsors/spn_1fmt/poster', PNG, {
    httpMetadata: { contentType: 'image/png' },
  });
  // A no-asset sponsor: nothing uploaded, no logo → pure monogram.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO sponsors (id, event_id, name, is_active) VALUES ('spn_bare', 'evt_asset', 'Bare Co', 1)"
  ).run();
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
