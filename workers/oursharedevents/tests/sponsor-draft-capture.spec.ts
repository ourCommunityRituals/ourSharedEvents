/**
 * OSE-732 / T6a — sponsor onboarding draft-capture handler.
 *
 * Security-bracketed coverage:
 *   [ENTRY]  brand_id comes ONLY from the signed invite token; a body-supplied
 *            brand_id is ignored (#9). Invalid/missing token → 401.
 *   - category_selections fails closed (unknown category / malformed → 400).
 *   - a draft_token owned by another brand cannot be overwritten (403).
 *   - is_local/lat/lon are never read from the body; geocode failure is fail-safe
 *     (is_local_derived=0, is_local_review_flag=1).
 *   [EXIT]   the handler writes ONLY to sponsor_business_draft (sponsors is
 *            untouched) — the draft stays resolver-invisible (#25).
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleCreateSponsorDraft, type SponsorDraftEnv } from '../src/handlers/sponsors-draft';
import { mintSponsorInviteToken } from '../src/lib/sponsor-invite';
import { promoteSponsorDraft, type PromotionEnv } from '../src/lib/sponsor-promotion';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;
const denv = () => env as unknown as SponsorDraftEnv;

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      if (msg.includes('no such column')) continue;
      throw e;
    }
  }
}

function req(token: string | null, body: unknown): Request {
  return new Request('https://x/api/v2/sponsors/draft', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function mint(brand: string, extra: Record<string, string> = {}): Promise<string> {
  const t = await mintSponsorInviteToken(denv(), { brand_id: brand, ...extra });
  expect(t, 'mint requires SPONSOR_INVITE_SIGNING_SECRET bound in vitest.config').toBeTruthy();
  return t!;
}

beforeAll(async () => {
  await applyMigrations();
});

describe('OSE-732 — draft-capture auth + tenant isolation', () => {
  test('missing invite token → 401', async () => {
    const res = await handleCreateSponsorDraft(req(null, { name: 'X' }), denv());
    expect(res.status).toBe(401);
  });

  test('garbage/forged token → 401', async () => {
    const res = await handleCreateSponsorDraft(req('not.a.valid.token', { name: 'X' }), denv());
    expect(res.status).toBe(401);
  });

  test('valid token → 200; brand_id from CLAIM, body brand_id IGNORED (#9)', async () => {
    const token = await mint('brand_good');
    const res = await handleCreateSponsorDraft(
      req(token, { name: 'Good Co', brand_id: 'brand_EVIL', category_selections: [] }),
      denv()
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; draft_token: string };
    expect(json.ok).toBe(true);

    const row = await env.DB.prepare(
      'SELECT brand_id, name, status FROM sponsor_business_draft WHERE draft_token = ?'
    )
      .bind(json.draft_token)
      .first<{ brand_id: string; name: string; status: string }>();
    expect(row?.brand_id).toBe('brand_good'); // NOT brand_EVIL
    expect(row?.status).toBe('draft');
  });

  test('body is_local / lat / lon are ignored; geocode failure is fail-safe', async () => {
    const token = await mint('brand_geo');
    const res = await handleCreateSponsorDraft(
      req(token, {
        name: 'Geo Co',
        address_raw: '123 Main St',
        is_local_derived: 1, // hostile client toggle — must be ignored
        lat: 99.9,
        lon: 88.8,
        category_selections: [],
      }),
      denv()
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { draft_token: string; is_local_review_flag: number };
    expect(json.is_local_review_flag).toBe(1);
    const row = await env.DB.prepare(
      'SELECT is_local_derived, is_local_review_flag, lat, lon FROM sponsor_business_draft WHERE draft_token = ?'
    )
      .bind(json.draft_token)
      .first<{
        is_local_derived: number;
        is_local_review_flag: number;
        lat: number | null;
        lon: number | null;
      }>();
    expect(row?.is_local_derived).toBe(0); // never the client's 1
    expect(row?.is_local_review_flag).toBe(1);
    expect(row?.lat).toBeNull(); // never the client's 99.9 (geocode failed in test env)
  });
});

describe('OSE-732 — category_selections fail-closed', () => {
  test('unknown category → 400', async () => {
    const token = await mint('brand_cat');
    const res = await handleCreateSponsorDraft(
      req(token, {
        name: 'C',
        category_selections: [{ category: 'not_a_real_category', mode: 'whole' }],
      }),
      denv()
    );
    expect(res.status).toBe(400);
  });

  test('malformed (not an array) → 400', async () => {
    const token = await mint('brand_cat2');
    const res = await handleCreateSponsorDraft(
      req(token, { name: 'C', category_selections: { category: 'bar_events' } }),
      denv()
    );
    expect(res.status).toBe(400);
  });

  test('bad mode → 400', async () => {
    const token = await mint('brand_cat3');
    const res = await handleCreateSponsorDraft(
      req(token, {
        name: 'C',
        category_selections: [{ category: 'bar_events', mode: 'buy_it_all' }],
      }),
      denv()
    );
    expect(res.status).toBe(400);
  });

  test('valid registry category → 200', async () => {
    const token = await mint('brand_cat4');
    const res = await handleCreateSponsorDraft(
      req(token, {
        name: 'C',
        category_selections: [{ category: 'bar_events', mode: 'custom', excluded: ['bar_night'] }],
      }),
      denv()
    );
    expect(res.status).toBe(200);
  });
});

describe('OSE-732 — cross-tenant + resolver-invisibility', () => {
  test("another brand cannot overwrite an existing brand's draft (403)", async () => {
    const good = await mint('brand_owner');
    const created = await handleCreateSponsorDraft(
      req(good, { name: 'Owner', category_selections: [] }),
      denv()
    );
    const { draft_token } = (await created.json()) as { draft_token: string };

    const evil = await mint('brand_attacker');
    const res = await handleCreateSponsorDraft(
      req(evil, { name: 'Hijack', draft_token, category_selections: [] }),
      denv()
    );
    expect(res.status).toBe(403);

    // The original owner's row is unchanged.
    const row = await env.DB.prepare(
      'SELECT brand_id, name FROM sponsor_business_draft WHERE draft_token = ?'
    )
      .bind(draft_token)
      .first<{ brand_id: string; name: string }>();
    expect(row?.brand_id).toBe('brand_owner');
    expect(row?.name).toBe('Owner');
  });

  test('draft capture writes ONLY to sponsor_business_draft, never sponsors (#25)', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsor_business').first<{
      c: number;
    }>();
    const token = await mint('brand_isolation');
    await handleCreateSponsorDraft(req(token, { name: 'Iso', category_selections: [] }), denv());
    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsor_business').first<{
      c: number;
    }>();
    expect(after?.c).toBe(before?.c);
  });

  test('handler source imports neither the resolver nor the allocation module', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const entry = Object.entries(sources).find(([p]) =>
      /handlers\/sponsors-draft\.ts$/.test(p.replace(/\\/g, '/'))
    );
    expect(entry).toBeTruthy();
    expect(entry![1]).not.toMatch(/sponsor-resolver|sponsor-allocation/);
  });
});

// OSE-1433 (Copilot review on #721): the draft path is a sponsor-logo write too.
// Capture applies the same host rule as admin create/update, and promotion
// refuses a draft captured before the rule rather than copying its logo into
// sponsor_asset. Born red against main: capture returned 200 and stored the
// URL verbatim; promotion copied it.
describe('OSE-1433 | the draft path applies the logo host rule', () => {
  test('capture: a private or local logo host → 400 INVALID_LOGO_URL, nothing stored', async () => {
    const token = await mint('brand-logo-1433');
    for (const logo_url of [
      'http://127.0.0.1/l.png',
      'http://169.254.169.254/x',
      'http://intranet/l.png',
    ]) {
      const res = await handleCreateSponsorDraft(req(token, { name: 'Logo Co', logo_url }), denv());
      expect(res.status, logo_url).toBe(400);
      expect(((await res.json()) as { code?: string }).code, logo_url).toBe('INVALID_LOGO_URL');
    }
    const stored = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM sponsor_business_draft WHERE brand_id = 'brand-logo-1433'"
    ).first<{ c: number }>();
    expect(stored?.c).toBe(0);
  });

  test('capture: a public logo host is accepted and stored', async () => {
    const token = await mint('brand-logo-1433b');
    const res = await handleCreateSponsorDraft(
      req(token, { name: 'Logo Co', logo_url: 'https://cdn.example.com/l.png' }),
      denv()
    );
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT logo_url FROM sponsor_business_draft WHERE brand_id = 'brand-logo-1433b'"
    ).first<{ logo_url: string }>();
    expect(row?.logo_url).toBe('https://cdn.example.com/l.png');
  });

  test('promotion: a draft captured before the rule is refused before any write', async () => {
    await env.DB.prepare(
      "INSERT INTO events (id, brand_id, title, slug, status) VALUES ('evt-1433','brand-1433p','P','slug-1433','active') ON CONFLICT(id) DO NOTHING"
    ).run();
    await env.DB.prepare(
      `INSERT INTO sponsor_business_draft
         (draft_token, brand_id, event_id, name, logo_url, category_selections,
          covenant_acknowledged_at, status, free_tier_eligible, eligibility_source)
       VALUES ('d_1433', 'brand-1433p', 'evt-1433', 'Old Draft', 'http://10.0.0.5/l.png',
               '[]', '2026-08-12T00:00:00Z', 'draft', 1, 'community_benefit')`
    ).run();
    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsor_business').first<{
      c: number;
    }>();
    const res = await promoteSponsorDraft(env as unknown as PromotionEnv, 'd_1433');
    expect(res).toEqual({ ok: false, code: 'INVALID_LOGO_URL', status: 400 });
    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsor_business').first<{
      c: number;
    }>();
    expect(after?.c).toBe(before?.c);
    const assets = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM sponsor_asset WHERE url = 'http://10.0.0.5/l.png'"
    ).first<{ c: number }>();
    expect(assets?.c).toBe(0);
  });

  test('promotion: an already-promoted draft keeps its 409, even with a now-refused logo', async () => {
    await env.DB.prepare(
      `INSERT INTO sponsor_business_draft
         (draft_token, brand_id, event_id, name, logo_url, category_selections,
          covenant_acknowledged_at, status, free_tier_eligible, eligibility_source)
       VALUES ('d_1433_done', 'brand-1433p', 'evt-1433', 'Done Draft', 'http://10.0.0.5/l.png',
               '[]', '2026-08-12T00:00:00Z', 'promoted', 1, 'community_benefit')`
    ).run();
    const res = await promoteSponsorDraft(env as unknown as PromotionEnv, 'd_1433_done');
    expect(res).toEqual({ ok: false, code: 'ALREADY_PROMOTED', status: 409 });
  });
});
