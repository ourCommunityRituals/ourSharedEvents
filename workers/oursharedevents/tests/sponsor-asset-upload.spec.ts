/**
 * OSE-733 / T6 — R2 sponsors/ namespace: token-auth upload + serve-guard extension.
 *
 * Security-bracketed:
 *   [ENTRY] the serve guard still blocks '..' traversal on BOTH events/ and
 *           sponsors/ prefixes, and rejects any other prefix.
 *   - upload is authorized by the invite token (not admin); wrong/missing → 401.
 *   - a draft_token belonging to another brand cannot be written (403); unknown
 *     draft → 404.
 *   - SVG / GIF / spoofed content rejected (raster-only crop source).
 *   - re-upload of the same format UPSERTs (no UNIQUE violation).
 *   [EXIT]  handler 503s gracefully when UPLOADS_BUCKET is unbound.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleSponsorAssetUpload, handleGetUploadedFile } from '../src/handlers/upload';
import { mintSponsorInviteToken } from '../src/lib/sponsor-invite';

interface RawEnv {
  DB: D1Database;
  UPLOADS_BUCKET: R2Bucket;
  SPONSOR_INVITE_SIGNING_SECRET: string;
  TEST_MIGRATION_STATEMENTS: string;
}
const e = () => env as unknown as RawEnv;

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4,
]);

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

function uploadReq(token: string | null, bytes: Uint8Array, mime: string, name = 'a.png'): Request {
  const fd = new FormData();
  fd.append('file', new File([bytes], name, { type: mime }));
  return new Request('https://x/up', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: fd,
  });
}

async function mint(brand: string): Promise<string> {
  const t = await mintSponsorInviteToken(e(), { brand_id: brand });
  return t!;
}

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO sponsor_business_draft (draft_token, brand_id, name) VALUES ('draft_up1', 'brand_up', 'Up Co')"
  ).run();
});

describe('OSE-733 — serve-guard extension (traversal shared across prefixes)', () => {
  test('a sponsors/ key serves bytes; events/ still works; other prefixes + ".." are 400', async () => {
    await e().UPLOADS_BUCKET.put('sponsors/draft_up1/poster', PNG);
    await e().UPLOADS_BUCKET.put('events/evt1/pic.png', PNG);

    const sponsorsGet = await handleGetUploadedFile(
      new Request('https://x'),
      e(),
      'sponsors/draft_up1/poster'
    );
    expect(sponsorsGet.status).toBe(200);

    const eventsGet = await handleGetUploadedFile(
      new Request('https://x'),
      e(),
      'events/evt1/pic.png'
    );
    expect(eventsGet.status).toBe(200);

    // '..' rejected under BOTH allowed prefixes (mandatory guard test).
    for (const bad of ['sponsors/../events/evt1/pic.png', 'events/../../etc', 'other/x', '']) {
      const res = await handleGetUploadedFile(new Request('https://x'), e(), bad);
      expect(res.status, `key "${bad}" must be rejected`).toBe(400);
    }
  });
});

describe('OSE-733 — sponsor asset upload auth + tenant isolation', () => {
  test('missing/invalid token → 401', async () => {
    const res = await handleSponsorAssetUpload(
      uploadReq(null, PNG, 'image/png'),
      e(),
      'draft_up1',
      'poster'
    );
    expect(res.status).toBe(401);
  });

  test('invalid format → 400', async () => {
    const res = await handleSponsorAssetUpload(
      uploadReq(await mint('brand_up'), PNG, 'image/png'),
      e(),
      'draft_up1',
      'billboard'
    );
    expect(res.status).toBe(400);
  });

  test('valid upload → 201 and UPSERTs sponsor_asset_draft', async () => {
    const token = await mint('brand_up');
    const res = await handleSponsorAssetUpload(
      uploadReq(token, PNG, 'image/png'),
      e(),
      'draft_up1',
      'poster'
    );
    expect(res.status).toBe(201);
    const row = await env.DB.prepare(
      "SELECT url, content_type FROM sponsor_asset_draft WHERE draft_token='draft_up1' AND format='poster'"
    ).first<{ url: string; content_type: string }>();
    expect(row?.content_type).toBe('image/png');
    expect(row?.url).toBe('/api/v2/uploads/sponsors/draft_up1/poster');

    // Re-upload the same format → UPSERT, still exactly one row (no UNIQUE error).
    const res2 = await handleSponsorAssetUpload(
      uploadReq(token, PNG, 'image/png'),
      e(),
      'draft_up1',
      'poster'
    );
    expect(res2.status).toBe(201);
    const cnt = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM sponsor_asset_draft WHERE draft_token='draft_up1' AND format='poster'"
    ).first<{ c: number }>();
    expect(cnt?.c).toBe(1);
  });

  test("another brand's token cannot upload to this draft (403)", async () => {
    const res = await handleSponsorAssetUpload(
      uploadReq(await mint('brand_attacker'), PNG, 'image/png'),
      e(),
      'draft_up1',
      'banner'
    );
    expect(res.status).toBe(403);
  });

  test('unknown draft → 404', async () => {
    const res = await handleSponsorAssetUpload(
      uploadReq(await mint('brand_up'), PNG, 'image/png'),
      e(),
      'no_such_draft',
      'poster'
    );
    expect(res.status).toBe(404);
  });
});

describe('OSE-733 — raster-only crop source', () => {
  test('SVG mime rejected (415)', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const res = await handleSponsorAssetUpload(
      uploadReq(await mint('brand_up'), svg, 'image/svg+xml', 'a.svg'),
      e(),
      'draft_up1',
      'square'
    );
    expect(res.status).toBe(415);
  });

  test('content spoofed as PNG but actually SVG rejected (415)', async () => {
    const svgBytes = new TextEncoder().encode('<svg></svg>aaaaaaaaaaaaaaaa');
    const res = await handleSponsorAssetUpload(
      uploadReq(await mint('brand_up'), svgBytes, 'image/png'),
      e(),
      'draft_up1',
      'vertical'
    );
    expect(res.status).toBe(415);
  });

  test('GIF rejected (415)', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const res = await handleSponsorAssetUpload(
      uploadReq(await mint('brand_up'), gif, 'image/gif', 'a.gif'),
      e(),
      'draft_up1',
      'banner'
    );
    expect(res.status).toBe(415);
  });
});

describe('OSE-733 — graceful 503 when UPLOADS_BUCKET unbound', () => {
  test('503 with a valid token + format but no bucket', async () => {
    const unbound = {
      DB: e().DB,
      SPONSOR_INVITE_SIGNING_SECRET: e().SPONSOR_INVITE_SIGNING_SECRET,
      UPLOADS_BUCKET: undefined,
    };
    const res = await handleSponsorAssetUpload(
      uploadReq(await mint('brand_up'), PNG, 'image/png'),
      unbound,
      'draft_up1',
      'poster'
    );
    expect(res.status).toBe(503);
  });
});
