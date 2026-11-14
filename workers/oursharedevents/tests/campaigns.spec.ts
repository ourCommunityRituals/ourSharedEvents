/**
 * Showcase S14: campaigns an organizer can use (workers pool).
 *
 *   GET/POST /api/v2/admin/campaigns
 *   PUT/DELETE /api/v2/admin/campaigns/:id/placements/:placementId
 *   GET /api/v2/events/:id/sponsor-bundle   (each shown sponsor's `campaign`)
 *
 * Three rules, each held by cases below (the rules are in src/lib/campaigns.ts):
 *   1. Brand wall: another brand's campaign can never be attached or seen.
 *   2. Consent: a campaign never appears for a placement without the event's
 *      yes and both sides' consent (the per-placement on-show rule).
 *   3. A campaign title is never a filter, a search key or a sort key.
 *
 * The matrix (tests/brand-matrix.spec.ts) runs the same routes as every brand
 * pair; this file holds what the matrix cannot express: an OWN campaign against
 * another brand's placement, the automation key, and the public side.
 * Static twin for rule 3: tests/campaign-never-a-filter.spec.ts.
 * Staging twin: bruno/ose-api/18. Campaigns (S14).
 *
 * @born-red S14 | method: each fault was put in src, this file was run and the
 * named cases failed, then the fault was removed. (a) the same-brand EXISTS
 * dropped from the attach UPDATE: "own campaign, another brand's placement",
 * "the automation key" and "a refused attach is audited as denied" failed;
 * (b) the brand predicate dropped from the campaign lookup and the guard's
 * campaign branch returning true: "another brand's campaign cannot be attached"
 * and the platform caller failed; (c) `c.brand_id = e.brand_id` dropped from the
 * public read: "mislinked" failed; (d) PLACEMENT_ON_SHOW_SQL replaced by
 * `1 = 1`: "the event is a draft" failed, and with the bundle also listing what
 * the read returned, all eight not-on-show cases failed; (e) the status
 * predicate dropped: "paused" and "completed" failed; (f) `ORDER BY title` in
 * the list: "the list order" failed; (g) the unknown-field check dropped: "only
 * a title and a status" failed; (h) the create brand check dropped and (i) the
 * list's brand scope dropped: "a list never carries" failed; (j) the detach not
 * tied to its campaign: both detach cases failed; (k) the brand-matched
 * subquery in lib/sponsor-promotion.ts replaced by the draft's own id: "a
 * sign-up that names another brand's campaign" failed; (l) the brand match
 * dropped from the report's campaign join: "the SharedReport names no campaign"
 * failed | date: 2026-11-13
 *
 * Not killed, and why: dropping only the bundle's "attach to a sponsor it
 * already shows" step changes nothing a caller can see, because the read's
 * own consent rule returns the same rows. It is a second lock, not a rule.
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { route } from '../src/router';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { promoteSponsorDraft, type PromotionEnv } from '../src/lib/sponsor-promotion';
import {
  BRANDS,
  UNKNOWN_ID,
  callAs,
  headersAsEmail,
  routerEnv,
  seedBrandFixture,
  type BrandFx,
} from './helpers/brand-matrix';
import { seedSplitSponsor } from './helpers/seed-sponsor';

const A = BRANDS[1]; // abc
const B = BRANDS[2]; // cbc

const evt = (b: BrandFx) => `cs-${b.key}-evt`;
const spo = (b: BrandFx) => `cs-${b.key}-sponsor`;
const plc = (b: BrandFx) => `spl_cs-${b.key}-sponsor`;
const cmp = (b: BrandFx) => `cs-${b.key}-campaign`;
const TITLE = (b: BrandFx) => `Zebra Partner Season ${b.key}`;

async function seedEvent(id: string, b: BrandFx, opts: { status?: string; uses?: boolean } = {}) {
  await env.DB.prepare(
    `INSERT INTO events
       (id, brand_id, title, slug, status, is_published, data_class, start_date, settings_json)
     VALUES (?, ?, ?, ?, ?, 1, 'synthetic', '2099-06-01', ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, settings_json = excluded.settings_json`
  )
    .bind(
      id,
      b.brandId,
      `Event ${id}`,
      `slug-${id}`,
      opts.status ?? 'active',
      opts.uses === false ? '{}' : '{"useSponsors":true}'
    )
    .run();
}

async function seedCampaign(
  id: string,
  b: BrandFx,
  title: string,
  status = 'active',
  at = '2026-01-01T00:00:00.000Z'
) {
  // An upsert, not REPLACE: the test database enforces the placement's foreign key.
  await env.DB.prepare(
    `INSERT INTO campaigns (id, brand_id, title, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, status = excluded.status,
       created_at = excluded.created_at`
  )
    .bind(id, b.brandId, title, status, at, at)
    .run();
}

/** One brand's event, campaign and an accepted sponsor placement that is NOT in the campaign. */
async function seedBrand(b: BrandFx) {
  await seedEvent(evt(b), b);
  await seedCampaign(cmp(b), b, TITLE(b));
  await seedSplitSponsor(env.DB, {
    id: spo(b),
    eventId: evt(b),
    brandId: b.brandId,
    name: `Sponsor ${b.key}`,
    placementId: plc(b),
    sponsorAccepted: 1,
    organizerAccepted: 1,
  });
}

async function campaignOf(placementId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT campaign_id FROM sponsor_placement WHERE id = ?')
    .bind(placementId)
    .first<{ campaign_id: string | null }>();
  return row?.campaign_id ?? null;
}

async function setPlacement(placementId: string, sql: string, ...binds: unknown[]) {
  await env.DB.prepare(`UPDATE sponsor_placement SET ${sql} WHERE id = ?`)
    .bind(...binds, placementId)
    .run();
}

const attachPath = (campaignId: string, placementId: string) =>
  `/api/v2/admin/campaigns/${campaignId}/placements/${placementId}`;

interface BundleSponsor {
  id: string;
  campaign?: { id: string; title: string };
}

async function publicBundle(eventId: string): Promise<{ raw: string; sponsors: BundleSponsor[] }> {
  const res = await callAs(
    { kind: 'anonymous' },
    'GET',
    `/api/v2/events/${eventId}/sponsor-bundle?surface=public`
  );
  expect(res.status).toBe(200);
  const raw = await res.text();
  const body = JSON.parse(raw) as { bundle: { sponsors: BundleSponsor[] } };
  return { raw, sponsors: body.bundle.sponsors };
}

/** Error bodies differ only by the id echoed, the request id and the time. */
function shape(text: string, ...ids: string[]): string {
  let out = text;
  for (const id of ids) out = out.split(id).join('<id>');
  return out
    .replace(/"requestId":"[^"]*"/g, '"requestId":"<r>"')
    .replace(/"timestamp":"[^"]*"/g, '"timestamp":"<t>"');
}

beforeAll(async () => {
  await seedBrandFixture();
});

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM sponsor_displays WHERE id LIKE 'cs-disp-%'`).run();
  await env.DB.prepare(
    `UPDATE sponsor_placement SET campaign_id = NULL
      WHERE campaign_id LIKE 'cmp_%' OR campaign_id LIKE 'cs-%'`
  ).run();
  await env.DB.prepare(`DELETE FROM campaigns WHERE id LIKE 'cmp_%' OR id LIKE 'cs-%'`).run();
  await seedBrand(A);
  await seedBrand(B);
});

// ── create and list ───────────────────────────────────────────────────────────

describe('S14 admin: create and list campaigns on a brand', () => {
  test('an owner creates a campaign in their own brand and reads it back', async () => {
    const res = await callAs({ kind: 'owner', brand: A }, 'POST', '/api/v2/admin/campaigns', {
      title: '  Winter   partner\nseries ',
      status: 'paused',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; item: Record<string, unknown> };
    // The id is one ourWKRP's creator file accepts as `oseCampaignId`.
    expect(body.id).toMatch(/^cmp_[A-Za-z0-9_-]{1,60}$/);
    expect(body.item).toMatchObject({
      id: body.id,
      brand_id: A.brandId,
      title: 'Winter partner series',
      status: 'paused',
    });

    const list = await callAs({ kind: 'owner', brand: A }, 'GET', '/api/v2/admin/campaigns');
    expect(list.status).toBe(200);
    const items = ((await list.json()) as { items: Array<Record<string, unknown>> }).items;
    const mine = items.find((c) => c.id === body.id);
    expect(mine).toBeDefined();
    expect(Object.keys(mine ?? {}).sort()).toEqual([
      'brand_id',
      'created_at',
      'id',
      'status',
      'title',
      'updated_at',
    ]);
  });

  test('status defaults to active', async () => {
    const res = await callAs({ kind: 'owner', brand: A }, 'POST', '/api/v2/admin/campaigns', {
      title: 'Default status',
    });
    expect(((await res.json()) as { item: { status: string } }).item.status).toBe('active');
  });

  test('a campaign takes only a title and a status: any other field is refused', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaigns').first<{
      n: number;
    }>();
    const res = await callAs({ kind: 'owner', brand: A }, 'POST', '/api/v2/admin/campaigns', {
      title: 'With extras',
      description: 'not a campaign field',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('UNKNOWN_FIELD');
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaigns').first<{
      n: number;
    }>();
    expect(after?.n).toBe(before?.n);
  });

  test.each([
    ['no title', {}, 'MISSING_TITLE'],
    ['a blank title', { title: '   ' }, 'MISSING_TITLE'],
    ['a title that is not text', { title: 7 }, 'MISSING_TITLE'],
    ['a title over 120 characters', { title: 'x'.repeat(121) }, 'INVALID_TITLE'],
    ['an unknown status', { title: 'ok', status: 'archived' }, 'INVALID_STATUS'],
    ['a status that is not text', { title: 'ok', status: 1 }, 'INVALID_STATUS'],
    ['a brand that is not text', { title: 'ok', brand_id: 5 }, 'INVALID_BRAND'],
    ['a malformed brand', { title: 'ok', brand_id: 'Not A Brand' }, 'INVALID_BRAND'],
  ])('%s is refused with 400 and nothing is written', async (_n, payload, code) => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaigns').first<{
      n: number;
    }>();
    const res = await callAs(
      { kind: 'owner', brand: A },
      'POST',
      '/api/v2/admin/campaigns',
      payload
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe(code);
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaigns').first<{
      n: number;
    }>();
    expect(after?.n).toBe(before?.n);
  });

  test('a body that is not a JSON object is refused', async () => {
    const res = await callAs({ kind: 'owner', brand: A }, 'POST', '/api/v2/admin/campaigns', [
      'title',
    ]);
    expect(res.status).toBe(400);
  });

  test('every caller kind without a brand is refused or sees nothing', async () => {
    expect((await callAs({ kind: 'anonymous' }, 'GET', '/api/v2/admin/campaigns')).status).toBe(
      401
    );
    expect(
      (await callAs({ kind: 'anonymous' }, 'POST', '/api/v2/admin/campaigns', { title: 'x' }))
        .status
    ).toBe(401);
    const none = await callAs({ kind: 'key-none' }, 'GET', '/api/v2/admin/campaigns');
    expect(((await none.json()) as { items: unknown[] }).items).toEqual([]);
    expect(
      (await callAs({ kind: 'key-none' }, 'POST', '/api/v2/admin/campaigns', { title: 'x' })).status
    ).toBe(403);
  });
});

// ── the admin write guard and the audit log ───────────────────────────────────

describe('S14 admin: every write passes the admin write guard and is audited', () => {
  async function crossSite(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      ...headersAsEmail(A.ownerEmail),
      'Sec-Fetch-Site': 'cross-site',
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const ctx = createExecutionContext();
    const res = await route(new Request(`https://ose.test${path}`, init), routerEnv, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  test('a cross-site create is refused and writes nothing', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaigns').first<{
      n: number;
    }>();
    const res = await crossSite('POST', '/api/v2/admin/campaigns', { title: 'from elsewhere' });
    expect(res.status).toBe(403);
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaigns').first<{
      n: number;
    }>();
    expect(after?.n).toBe(before?.n);
  });

  test.each(['PUT', 'DELETE'])('a cross-site %s of a placement is refused', async (method) => {
    await setPlacement(plc(A), 'campaign_id = ?', method === 'PUT' ? null : cmp(A));
    const before = await campaignOf(plc(A));
    const res = await crossSite(method, attachPath(cmp(A), plc(A)));
    expect(res.status).toBe(403);
    expect(await campaignOf(plc(A))).toBe(before);
  });

  test('create, attach and detach each leave an audit row in the campaign brand', async () => {
    const created = await callAs({ kind: 'owner', brand: A }, 'POST', '/api/v2/admin/campaigns', {
      title: 'Audited',
    });
    const id = ((await created.json()) as { id: string }).id;
    expect((await callAs({ kind: 'owner', brand: A }, 'PUT', attachPath(id, plc(A)))).status).toBe(
      200
    );
    expect(
      (await callAs({ kind: 'owner', brand: A }, 'DELETE', attachPath(id, plc(A)))).status
    ).toBe(200);
    const rows = await env.DB.prepare(
      `SELECT action, outcome, resource_type, brand_id FROM admin_audit_log
        WHERE resource_id = ? ORDER BY action`
    )
      .bind(id)
      .all<{ action: string; outcome: string; resource_type: string; brand_id: string | null }>();
    expect(rows.results).toEqual([
      {
        action: 'ATTACH_CAMPAIGN_PLACEMENT',
        outcome: 'success',
        resource_type: 'campaign',
        brand_id: A.brandId,
      },
      {
        action: 'CREATE_CAMPAIGN',
        outcome: 'success',
        resource_type: 'campaign',
        brand_id: A.brandId,
      },
      {
        action: 'DETACH_CAMPAIGN_PLACEMENT',
        outcome: 'success',
        resource_type: 'campaign',
        brand_id: A.brandId,
      },
    ]);
  });

  test('a refused attach is audited as denied, never as a write', async () => {
    const res = await callAs({ kind: 'owner', brand: A }, 'PUT', attachPath(cmp(A), plc(B)));
    expect(res.status).toBe(404);
    const row = await env.DB.prepare(
      `SELECT outcome FROM admin_audit_log
        WHERE resource_id = ? AND action = 'ATTACH_CAMPAIGN_PLACEMENT'
        ORDER BY created_at DESC LIMIT 1`
    )
      .bind(cmp(A))
      .first<{ outcome: string }>();
    expect(row?.outcome).toBe('denied');
  });
});

// ── rule 1: the brand wall ────────────────────────────────────────────────────

describe("S14 rule 1: another brand's campaign can never be attached or seen", () => {
  test('an owner attaches their own campaign to their own placement, and detaches it', async () => {
    const put = await callAs({ kind: 'owner', brand: A }, 'PUT', attachPath(cmp(A), plc(A)));
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ id: plc(A), event_id: evt(A), campaign_id: cmp(A) });
    expect(await campaignOf(plc(A))).toBe(cmp(A));

    const del = await callAs({ kind: 'owner', brand: A }, 'DELETE', attachPath(cmp(A), plc(A)));
    expect(del.status).toBe(200);
    expect(await campaignOf(plc(A))).toBeNull();
  });

  test("another brand's campaign cannot be attached to an own placement", async () => {
    const cross = await callAs({ kind: 'owner', brand: A }, 'PUT', attachPath(cmp(B), plc(A)));
    const unknown = await callAs(
      { kind: 'owner', brand: A },
      'PUT',
      attachPath(UNKNOWN_ID, plc(A))
    );
    expect(cross.status).toBe(404);
    // Not yours reads exactly like does not exist.
    expect(shape(await cross.text(), cmp(B))).toBe(shape(await unknown.text(), UNKNOWN_ID));
    expect(await campaignOf(plc(A))).toBeNull();
  });

  test("own campaign, another brand's placement: refused, and it reads like an unknown placement", async () => {
    const cross = await callAs({ kind: 'owner', brand: A }, 'PUT', attachPath(cmp(A), plc(B)));
    const unknown = await callAs(
      { kind: 'owner', brand: A },
      'PUT',
      attachPath(cmp(A), UNKNOWN_ID)
    );
    expect(cross.status).toBe(404);
    expect(shape(await cross.text(), plc(B))).toBe(shape(await unknown.text(), UNKNOWN_ID));
    expect(await campaignOf(plc(B))).toBeNull();
  });

  test('the automation key cannot join two brands either: the wall is in the write', async () => {
    const res = await callAs({ kind: 'key-all' }, 'PUT', attachPath(cmp(A), plc(B)));
    expect(res.status).toBe(404);
    expect(await campaignOf(plc(B))).toBeNull();
    // Positive control: the same key attaches within one brand.
    expect((await callAs({ kind: 'key-all' }, 'PUT', attachPath(cmp(B), plc(B)))).status).toBe(200);
    expect(await campaignOf(plc(B))).toBe(cmp(B));
  });

  test("another brand cannot detach a placement, by its own campaign or the owner's", async () => {
    await setPlacement(plc(B), 'campaign_id = ?', cmp(B));
    for (const campaignId of [cmp(A), cmp(B)]) {
      const res = await callAs(
        { kind: 'owner', brand: A },
        'DELETE',
        attachPath(campaignId, plc(B))
      );
      expect(res.status).toBe(404);
      expect(await campaignOf(plc(B))).toBe(cmp(B));
    }
  });

  test('a detach names the campaign the placement is in, or changes nothing', async () => {
    await seedCampaign('cs-abc-second', A, 'Second');
    await setPlacement(plc(A), 'campaign_id = ?', cmp(A));
    const res = await callAs(
      { kind: 'owner', brand: A },
      'DELETE',
      attachPath('cs-abc-second', plc(A))
    );
    expect(res.status).toBe(404);
    expect(await campaignOf(plc(A))).toBe(cmp(A));
  });

  test.each([{ kind: 'platform' as const }, { kind: 'key-none' as const }])(
    'a $kind caller reaches no tenant campaign',
    async (caller) => {
      const res = await callAs(caller, 'PUT', attachPath(cmp(A), plc(A)));
      expect(res.status).toBe(404);
      expect(await campaignOf(plc(A))).toBeNull();
    }
  );

  test('an anonymous caller gets 401 on the by-id routes, never a scope answer', async () => {
    for (const method of ['PUT', 'DELETE']) {
      expect((await callAs({ kind: 'anonymous' }, method, attachPath(cmp(A), plc(A)))).status).toBe(
        401
      );
    }
  });

  test("a list never carries another brand's campaign, and a create cannot name one", async () => {
    const list = await callAs({ kind: 'owner', brand: A }, 'GET', '/api/v2/admin/campaigns');
    const text = await list.text();
    expect(text).toContain(cmp(A));
    expect(text).not.toContain(cmp(B));
    expect(text).not.toContain(TITLE(B));

    const res = await callAs({ kind: 'owner', brand: A }, 'POST', '/api/v2/admin/campaigns', {
      title: 'In your brand',
      brand_id: B.brandId,
    });
    expect(res.status).toBe(403);
    const row = await env.DB.prepare(
      `SELECT 1 AS x FROM campaigns WHERE title = 'In your brand'`
    ).first();
    expect(row).toBeNull();
  });

  test("a placement mislinked to another brand's campaign shows no campaign in public", async () => {
    // Written past the API, as a bad import or an old row could be.
    await setPlacement(plc(A), 'campaign_id = ?', cmp(B));
    const { raw, sponsors } = await publicBundle(evt(A));
    expect(sponsors.map((s) => s.id)).toEqual([spo(A)]);
    expect(sponsors[0].campaign).toBeUndefined();
    expect(raw).not.toContain(cmp(B));
    expect(raw).not.toContain(TITLE(B));
  });
});

// ── rule 1, the older paths: a campaign id that arrives without the campaign API ──

describe('S14 rule 1: the sponsor sign-up path and the report hold the same brand wall', () => {
  // A sponsor's own sign-up draft may carry a campaign_id from its request body
  // (handlers/sponsors-draft.ts). Promotion is the one place it becomes a placement.
  // Its own event, so a promoted sponsor never joins the other cases' bundle.
  const SIGNUP_EVT = 'cs-abc-signup-evt';
  beforeEach(() => seedEvent(SIGNUP_EVT, A));

  async function promote(token: string, campaignId: string): Promise<string | null> {
    await env.DB.prepare(
      `INSERT INTO sponsor_business_draft
         (draft_token, brand_id, event_id, campaign_id, name, category_selections,
          covenant_acknowledged_at, status, free_tier_eligible, eligibility_source)
       VALUES (?, ?, ?, ?, ?, ?, '2026-08-12T00:00:00Z', 'draft', 1, 'community_benefit')`
    )
      .bind(
        token,
        A.brandId,
        SIGNUP_EVT,
        campaignId,
        `Co ${token}`,
        JSON.stringify([{ category: 'bar_events', mode: 'whole' }])
      )
      .run();
    const res = await promoteSponsorDraft(env as unknown as PromotionEnv, token);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return null;
    const row = await env.DB.prepare(
      'SELECT campaign_id FROM sponsor_placement WHERE sponsor_business_id = ? AND event_id = ?'
    )
      .bind(res.sponsor_id, SIGNUP_EVT)
      .first<{ campaign_id: string | null }>();
    expect(row, 'the promotion wrote a placement').not.toBeNull();
    return row?.campaign_id ?? null;
  }

  test("a sign-up that names another brand's campaign is promoted with no campaign", async () => {
    expect(await promote(`cs-draft-cross-${Date.now()}`, cmp(B))).toBeNull();
  });

  test("a sign-up that names its own brand's campaign keeps it (positive control)", async () => {
    expect(await promote(`cs-draft-own-${Date.now()}`, cmp(A))).toBe(cmp(A));
  });

  async function reportFor(campaignId: string): Promise<string> {
    await setPlacement(plc(A), 'campaign_id = ?', campaignId);
    await env.DB.prepare('DELETE FROM sponsor_displays WHERE event_id = ?').bind(evt(A)).run();
    for (let i = 0; i < 6; i++) {
      await env.DB.prepare(
        `INSERT INTO sponsor_displays (id, sponsor_id, event_id, surface, placement, event_type, created_at)
         VALUES (?, ?, ?, 'public', 'mobileBanner', 'impression', '2026-06-01T12:00:00Z')`
      )
        .bind(`cs-disp-${i}`, spo(A), evt(A))
        .run();
    }
    return JSON.stringify(await buildSharedReport(env.DB, evt(A)));
  }

  test("the SharedReport names no campaign for a placement linked to another brand's campaign", async () => {
    const raw = await reportFor(cmp(B));
    expect(raw).toContain(spo(A)); // the sponsor's displays are still counted
    expect(raw).not.toContain(cmp(B));
    expect(raw).not.toContain(TITLE(B));
  });

  test("the SharedReport names the brand's own campaign (positive control)", async () => {
    const raw = await reportFor(cmp(A));
    expect(raw).toContain(cmp(A));
    expect(raw).toContain(TITLE(A));
  });
});

// ── rule 2: consent ───────────────────────────────────────────────────────────

describe('S14 rule 2: a campaign appears only for a placement that is on show', () => {
  beforeEach(async () => {
    await setPlacement(plc(A), 'campaign_id = ?', cmp(A));
  });

  test('on show: the sponsor carries its campaign, id and title only', async () => {
    const { sponsors } = await publicBundle(evt(A));
    expect(sponsors).toHaveLength(1);
    expect(sponsors[0].campaign).toEqual({ id: cmp(A), title: TITLE(A) });
  });

  test('the same campaign rides on every reference to the sponsor in the bundle', async () => {
    const res = await callAs(
      { kind: 'anonymous' },
      'GET',
      `/api/v2/events/${evt(A)}/sponsor-bundle`
    );
    const body = (await res.json()) as {
      bundle: { surface_sponsors: Record<string, BundleSponsor[]> };
    };
    for (const list of Object.values(body.bundle.surface_sponsors)) {
      for (const s of list) expect(s.campaign).toEqual({ id: cmp(A), title: TITLE(A) });
    }
  });

  const NOT_ON_SHOW: Array<[string, () => Promise<void>]> = [
    ['the sponsor has not answered', () => setPlacement(plc(A), 'sponsor_accepted = NULL')],
    ['the sponsor declined', () => setPlacement(plc(A), 'sponsor_accepted = 0')],
    ['the organizer declined', () => setPlacement(plc(A), 'organizer_accepted = 0')],
    [
      'a sponsor request the organizer has not answered',
      () => setPlacement(plc(A), `source = 'sponsor_request', organizer_accepted = NULL`),
    ],
    ['the placement is switched off', () => setPlacement(plc(A), 'is_active = 0')],
    [
      'the business is switched off',
      async () => {
        await env.DB.prepare('UPDATE sponsor_business SET is_active = 0 WHERE id = ?')
          .bind(spo(A))
          .run();
      },
    ],
    ['the event has not opted in to sponsors', () => seedEvent(evt(A), A, { uses: false })],
    ['the event is a draft', () => seedEvent(evt(A), A, { status: 'draft' })],
  ];

  test.each(NOT_ON_SHOW)('%s: no campaign, by id or by title', async (_name, arrange) => {
    await arrange();
    const { raw, sponsors } = await publicBundle(evt(A));
    for (const s of sponsors) expect(s.campaign).toBeUndefined();
    expect(raw).not.toContain(cmp(A));
    expect(raw).not.toContain(TITLE(A));
    expect(raw).not.toContain('"campaign"');
  });

  test.each(['paused', 'completed'])(
    'a %s campaign is not announced; the sponsor still shows',
    async (status) => {
      await seedCampaign(cmp(A), A, TITLE(A), status);
      const { raw, sponsors } = await publicBundle(evt(A));
      expect(sponsors.map((s) => s.id)).toEqual([spo(A)]);
      expect(raw).not.toContain(TITLE(A));
      expect(raw).not.toContain('"campaign"');
    }
  );

  test('a sponsor with no campaign has no campaign field', async () => {
    await setPlacement(plc(A), 'campaign_id = NULL');
    const { raw } = await publicBundle(evt(A));
    expect(raw).not.toContain('"campaign"');
  });

  test('only the sponsor bundle carries it: the public event and sponsor list are unchanged', async () => {
    for (const path of [`/api/v2/events/${evt(A)}`, `/api/v2/events/${evt(A)}/sponsors`]) {
      const res = await callAs({ kind: 'anonymous' }, 'GET', path);
      expect(res.status).toBe(200);
      const raw = await res.text();
      expect(raw, path).not.toContain(TITLE(A));
      expect(raw, path).not.toContain(cmp(A));
    }
  });
});

// ── rule 3: a title is never a filter ─────────────────────────────────────────

describe('S14 rule 3: a campaign title is never a filter, search or sort key', () => {
  async function listIds(query = ''): Promise<string[]> {
    const res = await callAs({ kind: 'owner', brand: A }, 'GET', `/api/v2/admin/campaigns${query}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: Array<{ id: string }> }).items
      .map((c) => c.id)
      .filter((id) => id.startsWith('cs-'));
  }

  beforeEach(async () => {
    // Created oldest to newest as Mango, Zebra, Apple: no title order matches time order.
    const rows: Array<[string, string, string]> = [
      ['cs-abc-t1', 'Mango', '2026-01-01T00:00:00.000Z'],
      [cmp(A), TITLE(A), '2026-01-02T00:00:00.000Z'],
      ['cs-abc-t3', 'Apple', '2026-01-03T00:00:00.000Z'],
    ];
    for (const [id, title, at] of rows) await seedCampaign(id, A, title, 'active', at);
  });

  test('the list order is newest first, never by title', async () => {
    expect(await listIds()).toEqual(['cs-abc-t3', cmp(A), 'cs-abc-t1']);
  });

  test.each([
    '?title=Apple',
    '?q=Apple',
    '?search=Apple',
    '?campaign=Apple',
    '?campaign_title=Apple',
    '?sort=title',
    '?order=title',
    '?title=Apple&sort=title&q=Apple',
  ])('the list ignores %s', async (query) => {
    expect(await listIds(query)).toEqual(await listIds());
  });

  test('the public events list cannot be narrowed or reordered by a campaign', async () => {
    await setPlacement(plc(A), 'campaign_id = ?', cmp(A));
    const ids = async (query: string) => {
      const res = await callAs(
        { kind: 'anonymous' },
        'GET',
        `/api/v2/events?brand=${A.brandId}${query}`
      );
      expect(res.status).toBe(200);
      const raw = await res.text();
      expect(raw).not.toContain(TITLE(A));
      return [...raw.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
    };
    const plain = await ids('');
    expect(plain).toContain(evt(A));
    const title = encodeURIComponent(TITLE(A));
    for (const q of [
      `&campaign=${cmp(A)}`,
      `&campaign_id=${cmp(A)}`,
      `&campaign_title=${title}`,
      `&q=${title}`,
      `&search=${title}`,
      '&sort=campaign',
    ]) {
      const res = await callAs(
        { kind: 'anonymous' },
        'GET',
        `/api/v2/events?brand=${A.brandId}${q}`
      );
      // A parameter the list does not know is ignored or refused; it never selects.
      if (res.status === 200) expect(await ids(q), q).toEqual(plain);
      else expect(res.status, q).toBe(400);
    }
  });

  test('the sponsor bundle cannot be narrowed by a campaign', async () => {
    await setPlacement(plc(A), 'campaign_id = ?', cmp(A));
    const other = await callAs(
      { kind: 'anonymous' },
      'GET',
      `/api/v2/events/${evt(A)}/sponsor-bundle?surface=public&campaign=${cmp(B)}&campaign_title=nope`
    );
    const body = (await other.json()) as { bundle: { sponsors: BundleSponsor[] } };
    expect(body.bundle.sponsors.map((s) => s.id)).toEqual([spo(A)]);
  });
});
