/**
 * OSE-1552 scope 1: an event can be in one campaign (workers pool).
 *
 *   GET        /api/v2/admin/campaigns/:id/events
 *   PUT/DELETE /api/v2/admin/campaigns/:id/events/:eventId
 *   events.campaign_id (migration 0110)
 *
 * Rules, each held by cases below (the code is in src/lib/campaigns.ts; the
 * owner decisions are OSE ADR-030):
 *   1. Brand wall: an event joins a campaign only in its own brand. The rule is
 *      in the UPDATE, so the automation key is held to it too. Out-of-brand and
 *      unknown read as the same 404.
 *   2. One campaign per event: a second add moves the event.
 *   3. Not public: nothing an anonymous caller can read changes when an event
 *      joins a campaign.
 *   4. Two links, kept apart: a placement's campaign and its event's campaign
 *      never overwrite each other (OSE-1552 scope 4 is an open owner decision).
 *   5. Every write passes the admin write guard and is audited.
 *
 * The matrix (tests/brand-matrix.spec.ts) runs the same routes as every brand
 * pair; this file holds what the matrix cannot express: an OWN campaign against
 * another brand's event, the automation key, and the public side.
 * Static twin: tests/e2e/0-architecture/campaign-brand-and-consent.invariant.spec.ts.
 * Staging twin: bruno/ose-api/18. Campaigns (S14), requests 30 to 46.
 *
 * @born-red event link | method: each fault was put in src, this file was run
 * and the named cases failed, then the fault was removed. (a) the same-brand
 * EXISTS dropped from the add UPDATE: "the automation key" failed; (b) the
 * remove not tied to its campaign: "a remove names the campaign" failed; (c) the
 * caller's brand scope dropped from the remove, and (d) the brand match dropped
 * from the member list: "linked past the API" failed; (e) the add also copying
 * the event's campaign onto its placements: "no public read changes" and two of
 * the "never overwrite" cases failed; (f) the add also writing updated_at:
 * "campaign_id and nothing else" failed (it passed at first, because an earlier
 * case had left the same stamp; the case now sets an old stamp first);
 * (g) requireAdmin dropped from the member list route: "anonymous" failed;
 * (h) the audit call dropped from the route: both audit cases failed; (i) every
 * brand lock off at once (the guard's campaign branch, the campaign lookup scope
 * and the event scope): five cases here and 42 matrix cells failed; (j) migration
 * 0110 moved out of migrations/: schema.spec, constraints.spec and
 * check-schema-guard.mjs failed | date: 2026-11-15
 *
 * @born-red locals on a campaign | method: the same. (k) the bundle marking a
 * sponsor local once it carries a campaign: "the bigger sponsor joining the
 * campaign labels it and changes nothing else" failed | date: 2026-11-15
 *
 * Not killed alone, and why: dropping only the caller's brand scope from the add
 * UPDATE, or only the campaign lookup scope, changes nothing a caller can see,
 * because the same-brand EXISTS and the route guard return the same 404. They
 * are second locks; (i) shows the cases fail when all of them are gone.
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { route } from '../src/router';
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

const evt = (b: BrandFx, n = 1) => `ce-${b.key}-evt-${n}`;
const cmp = (b: BrandFx, n = 1) => `ce-${b.key}-campaign-${n}`;
const spo = (b: BrandFx) => `ce-${b.key}-sponsor`;
const plc = (b: BrandFx) => `spl_ce-${b.key}-sponsor`;
const TITLE = (b: BrandFx, n = 1) => `Quokka Harvest Series ${b.key} ${n}`;

async function seedEvent(id: string, b: BrandFx, start = '2099-06-01') {
  await env.DB.prepare(
    `INSERT INTO events
       (id, brand_id, title, slug, status, is_published, data_class, start_date, settings_json)
     VALUES (?, ?, ?, ?, 'active', 1, 'synthetic', ?, '{"useSponsors":true}')
     ON CONFLICT(id) DO UPDATE SET campaign_id = NULL, start_date = excluded.start_date`
  )
    .bind(id, b.brandId, `Event ${id}`, `slug-${id}`, start)
    .run();
}

async function seedCampaign(id: string, b: BrandFx, title: string) {
  await env.DB.prepare(
    `INSERT INTO campaigns (id, brand_id, title, status) VALUES (?, ?, ?, 'active')
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, status = 'active'`
  )
    .bind(id, b.brandId, title)
    .run();
}

/** One brand: two events, two campaigns, and an accepted placement on event 1 in no campaign. */
async function seedBrand(b: BrandFx) {
  await seedEvent(evt(b, 1), b, '2099-06-02');
  await seedEvent(evt(b, 2), b, '2099-06-01');
  await seedCampaign(cmp(b, 1), b, TITLE(b, 1));
  await seedCampaign(cmp(b, 2), b, TITLE(b, 2));
  await seedSplitSponsor(env.DB, {
    id: spo(b),
    eventId: evt(b, 1),
    brandId: b.brandId,
    name: `Sponsor ce ${b.key}`,
    placementId: plc(b),
    sponsorAccepted: 1,
    organizerAccepted: 1,
  });
  await env.DB.prepare('UPDATE sponsor_placement SET campaign_id = NULL WHERE id = ?')
    .bind(plc(b))
    .run();
}

async function campaignOfEvent(eventId: string): Promise<string | null | undefined> {
  const row = await env.DB.prepare('SELECT campaign_id FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ campaign_id: string | null }>();
  return row ? row.campaign_id : undefined;
}

async function campaignOfPlacement(placementId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT campaign_id FROM sponsor_placement WHERE id = ?')
    .bind(placementId)
    .first<{ campaign_id: string | null }>();
  return row?.campaign_id ?? null;
}

/** Put an event in a campaign past the API (for arranging a case, or a mislink). */
async function linkEvent(eventId: string, campaignId: string | null) {
  await env.DB.prepare('UPDATE events SET campaign_id = ? WHERE id = ?')
    .bind(campaignId, eventId)
    .run();
}

async function eventRow(eventId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first();
  return row as Record<string, unknown>;
}

const eventPath = (campaignId: string, eventId: string) =>
  `/api/v2/admin/campaigns/${campaignId}/events/${eventId}`;
const listPath = (campaignId: string) => `/api/v2/admin/campaigns/${campaignId}/events`;

async function listed(caller: Parameters<typeof callAs>[0], campaignId: string): Promise<string[]> {
  const res = await callAs(caller, 'GET', listPath(campaignId));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: Array<{ id: string }> };
  return body.items.map((i) => i.id);
}

/**
 * Bodies differ only by the id echoed, the request id, the time, and a sponsor's
 * beacon token, which carries an expiry in whole seconds: two reads either side
 * of a second read differently with nothing changed (seen on main, run 43784818898).
 */
function shape(text: string, ...ids: string[]): string {
  let out = text;
  for (const id of ids) out = out.split(id).join('<id>');
  return out
    .replace(/"requestId":"[^"]*"/g, '"requestId":"<r>"')
    .replace(/"timestamp":"[^"]*"/g, '"timestamp":"<t>"')
    .replace(/"beacon_token":"[^"]*"/g, '"beacon_token":"<b>"');
}

const owner = (b: BrandFx) => ({ kind: 'owner' as const, brand: b });

beforeAll(async () => {
  await seedBrandFixture();
});

beforeEach(async () => {
  await env.DB.prepare(`UPDATE events SET campaign_id = NULL WHERE id LIKE 'ce-%'`).run();
  await env.DB.prepare(
    `UPDATE sponsor_placement SET campaign_id = NULL WHERE id LIKE 'spl_ce-%'`
  ).run();
  await seedBrand(A);
  await seedBrand(B);
});

// ── add, move, remove, list ───────────────────────────────────────────────────

describe('an organizer puts an event in a campaign of its own brand', () => {
  test('add, read back, remove', async () => {
    const put = await callAs(owner(A), 'PUT', eventPath(cmp(A), evt(A)));
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ ok: true, id: evt(A), campaign_id: cmp(A) });
    expect(await campaignOfEvent(evt(A))).toBe(cmp(A));
    expect(await listed(owner(A), cmp(A))).toEqual([evt(A)]);

    const del = await callAs(owner(A), 'DELETE', eventPath(cmp(A), evt(A)));
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ ok: true, id: evt(A), campaign_id: null });
    expect(await campaignOfEvent(evt(A))).toBeNull();
    expect(await listed(owner(A), cmp(A))).toEqual([]);
  });

  test('the add writes campaign_id and nothing else on the event', async () => {
    // A fixed, old stamp: a write that touched updated_at could not land on it again.
    await env.DB.prepare(`UPDATE events SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`)
      .bind(evt(A))
      .run();
    const before = await eventRow(evt(A));
    expect((await callAs(owner(A), 'PUT', eventPath(cmp(A), evt(A)))).status).toBe(200);
    const after = await eventRow(evt(A));
    expect(after).toEqual({ ...before, campaign_id: cmp(A) });
  });

  test('an event is in at most one campaign: a second add moves it', async () => {
    expect((await callAs(owner(A), 'PUT', eventPath(cmp(A, 1), evt(A)))).status).toBe(200);
    expect((await callAs(owner(A), 'PUT', eventPath(cmp(A, 2), evt(A)))).status).toBe(200);
    expect(await campaignOfEvent(evt(A))).toBe(cmp(A, 2));
    expect(await listed(owner(A), cmp(A, 1))).toEqual([]);
    expect(await listed(owner(A), cmp(A, 2))).toEqual([evt(A)]);
  });

  test('adding the same event twice is the same answer', async () => {
    for (let i = 0; i < 2; i++) {
      expect((await callAs(owner(A), 'PUT', eventPath(cmp(A), evt(A)))).status).toBe(200);
    }
    expect(await listed(owner(A), cmp(A))).toEqual([evt(A)]);
  });

  test('the list is by start date, and carries an id, a title, a status and a start only', async () => {
    await linkEvent(evt(A, 1), cmp(A)); // starts 2099-06-02
    await linkEvent(evt(A, 2), cmp(A)); // starts 2099-06-01
    const res = await callAs(owner(A), 'GET', listPath(cmp(A)));
    const body = (await res.json()) as { campaign_id: string; items: Record<string, unknown>[] };
    expect(body.campaign_id).toBe(cmp(A));
    expect(body.items.map((i) => i.id)).toEqual([evt(A, 2), evt(A, 1)]);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(['id', 'start_date', 'status', 'title']);
    }
  });

  test('a remove names the campaign the event is in, or changes nothing', async () => {
    await linkEvent(evt(A), cmp(A, 1));
    const res = await callAs(owner(A), 'DELETE', eventPath(cmp(A, 2), evt(A)));
    expect(res.status).toBe(404);
    expect(await campaignOfEvent(evt(A))).toBe(cmp(A, 1));
  });

  test('an event in a campaign can still be deleted', async () => {
    await seedEvent('ce-abc-evt-gone', A);
    await linkEvent('ce-abc-evt-gone', cmp(A));
    const res = await callAs(owner(A), 'DELETE', '/api/v2/admin/events/ce-abc-evt-gone');
    expect(res.status).toBe(200);
    expect(await campaignOfEvent('ce-abc-evt-gone')).toBeUndefined();
  });
});

// ── rule 1: the brand wall ────────────────────────────────────────────────────

describe("the brand wall: an event never joins another brand's campaign", () => {
  test("another brand's campaign, own event: 404 like an unknown campaign, nothing written", async () => {
    const cross = await callAs(owner(A), 'PUT', eventPath(cmp(B), evt(A)));
    const unknown = await callAs(owner(A), 'PUT', eventPath(UNKNOWN_ID, evt(A)));
    expect(cross.status).toBe(404);
    expect(shape(await cross.text(), cmp(B))).toBe(shape(await unknown.text(), UNKNOWN_ID));
    expect(await campaignOfEvent(evt(A))).toBeNull();
  });

  test("own campaign, another brand's event: 404 like an unknown event, nothing written", async () => {
    const cross = await callAs(owner(A), 'PUT', eventPath(cmp(A), evt(B)));
    const unknown = await callAs(owner(A), 'PUT', eventPath(cmp(A), UNKNOWN_ID));
    expect(cross.status).toBe(404);
    expect(shape(await cross.text(), evt(B))).toBe(shape(await unknown.text(), UNKNOWN_ID));
    expect(await campaignOfEvent(evt(B))).toBeNull();
  });

  test('the automation key cannot join two brands either: the wall is in the write', async () => {
    const res = await callAs({ kind: 'key-all' }, 'PUT', eventPath(cmp(A), evt(B)));
    expect(res.status).toBe(404);
    expect(await campaignOfEvent(evt(B))).toBeNull();
    // Positive control: the same key adds within one brand.
    expect((await callAs({ kind: 'key-all' }, 'PUT', eventPath(cmp(B), evt(B)))).status).toBe(200);
    expect(await campaignOfEvent(evt(B))).toBe(cmp(B));
  });

  test("another brand cannot remove an event, by its own campaign or the owner's", async () => {
    await linkEvent(evt(B), cmp(B));
    for (const campaignId of [cmp(A), cmp(B)]) {
      const res = await callAs(owner(A), 'DELETE', eventPath(campaignId, evt(B)));
      expect(res.status).toBe(404);
      expect(await campaignOfEvent(evt(B))).toBe(cmp(B));
    }
  });

  test("another brand's campaign cannot be listed, and reads like an unknown one", async () => {
    await linkEvent(evt(B), cmp(B));
    const cross = await callAs(owner(A), 'GET', listPath(cmp(B)));
    const unknown = await callAs(owner(A), 'GET', listPath(UNKNOWN_ID));
    expect(cross.status).toBe(404);
    const text = await cross.text();
    expect(text).not.toContain(evt(B));
    expect(shape(text, cmp(B))).toBe(shape(await unknown.text(), UNKNOWN_ID));
  });

  test("an event linked past the API to another brand's campaign is not listed under it", async () => {
    await linkEvent(evt(A), cmp(B));
    await linkEvent(evt(B), cmp(B));
    for (const caller of [owner(B), { kind: 'key-all' as const }]) {
      expect(await listed(caller, cmp(B))).toEqual([evt(B)]);
    }
    // Neither brand's admin can act on the pair; the automation scope can clear it.
    expect((await callAs(owner(B), 'DELETE', eventPath(cmp(B), evt(A)))).status).toBe(404);
    expect((await callAs(owner(A), 'DELETE', eventPath(cmp(B), evt(A)))).status).toBe(404);
    expect(await campaignOfEvent(evt(A))).toBe(cmp(B));
    expect((await callAs({ kind: 'key-all' }, 'DELETE', eventPath(cmp(B), evt(A)))).status).toBe(
      200
    );
    expect(await campaignOfEvent(evt(A))).toBeNull();
  });

  test.each([{ kind: 'platform' as const }, { kind: 'key-none' as const }])(
    'a $kind caller reaches no tenant campaign',
    async (caller) => {
      await linkEvent(evt(A, 2), cmp(A));
      expect((await callAs(caller, 'PUT', eventPath(cmp(A), evt(A)))).status).toBe(404);
      expect((await callAs(caller, 'DELETE', eventPath(cmp(A), evt(A, 2)))).status).toBe(404);
      const list = await callAs(caller, 'GET', listPath(cmp(A)));
      expect(list.status).toBe(404);
      expect(await list.text()).not.toContain(evt(A, 2));
      expect(await campaignOfEvent(evt(A))).toBeNull();
      expect(await campaignOfEvent(evt(A, 2))).toBe(cmp(A));
    }
  );

  test('an anonymous caller gets 401, never a scope answer', async () => {
    await linkEvent(evt(A, 2), cmp(A));
    for (const [method, path] of [
      ['PUT', eventPath(cmp(A), evt(A))],
      ['DELETE', eventPath(cmp(A), evt(A, 2))],
      ['GET', listPath(cmp(A))],
    ]) {
      const res = await callAs({ kind: 'anonymous' }, method, path);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.text()).not.toContain(evt(A, 2));
    }
    expect(await campaignOfEvent(evt(A))).toBeNull();
    expect(await campaignOfEvent(evt(A, 2))).toBe(cmp(A));
  });
});

// ── rule 5: the admin write guard and the audit log ───────────────────────────

describe('every write passes the admin write guard and is audited', () => {
  test.each(['PUT', 'DELETE'])('a cross-site %s is refused and writes nothing', async (method) => {
    await linkEvent(evt(A), method === 'PUT' ? null : cmp(A));
    const before = await campaignOfEvent(evt(A));
    const ctx = createExecutionContext();
    const res = await route(
      new Request(`https://ose.test${eventPath(cmp(A), evt(A))}`, {
        method,
        headers: { ...headersAsEmail(A.ownerEmail), 'Sec-Fetch-Site': 'cross-site' },
      }),
      routerEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(403);
    expect(await campaignOfEvent(evt(A))).toBe(before);
  });

  test('add and remove each leave an audit row in the campaign brand', async () => {
    await env.DB.prepare('DELETE FROM admin_audit_log WHERE resource_id = ?').bind(cmp(A)).run();
    expect((await callAs(owner(A), 'PUT', eventPath(cmp(A), evt(A)))).status).toBe(200);
    expect((await callAs(owner(A), 'DELETE', eventPath(cmp(A), evt(A)))).status).toBe(200);
    const rows = await env.DB.prepare(
      `SELECT action, outcome, resource_type, brand_id FROM admin_audit_log
        WHERE resource_id = ? ORDER BY action`
    )
      .bind(cmp(A))
      .all();
    expect(rows.results).toEqual([
      {
        action: 'ADD_CAMPAIGN_EVENT',
        outcome: 'success',
        resource_type: 'campaign',
        brand_id: A.brandId,
      },
      {
        action: 'REMOVE_CAMPAIGN_EVENT',
        outcome: 'success',
        resource_type: 'campaign',
        brand_id: A.brandId,
      },
    ]);
  });

  test('a refused add is audited as denied, never as a write', async () => {
    await env.DB.prepare('DELETE FROM admin_audit_log WHERE resource_id = ?').bind(cmp(A)).run();
    expect((await callAs(owner(A), 'PUT', eventPath(cmp(A), evt(B)))).status).toBe(404);
    const rows = await env.DB.prepare(
      `SELECT action, outcome FROM admin_audit_log WHERE resource_id = ?`
    )
      .bind(cmp(A))
      .all();
    expect(rows.results).toEqual([{ action: 'ADD_CAMPAIGN_EVENT', outcome: 'denied' }]);
  });
});

// ── rule 3: not public ────────────────────────────────────────────────────────

describe("an event's campaign is not public", () => {
  const PUBLIC_READS = (eventId: string) => [
    `/api/v2/events/${eventId}`,
    `/api/v2/events/${eventId}/sponsors`,
    `/api/v2/events/${eventId}/sponsor-bundle?surface=public`,
    `/api/v2/events?brand=${A.brandId}&limit=100`,
    `/api/v2/events?limit=100`,
  ];

  async function publicTexts(eventId: string): Promise<string[]> {
    const out: string[] = [];
    for (const path of PUBLIC_READS(eventId)) {
      const res = await callAs({ kind: 'anonymous' }, 'GET', path);
      expect(res.status, path).toBe(200);
      out.push(shape(await res.text()));
    }
    return out;
  }

  test('no public read changes when an event joins a campaign, and none names it', async () => {
    const before = await publicTexts(evt(A));
    expect((await callAs(owner(A), 'PUT', eventPath(cmp(A), evt(A)))).status).toBe(200);
    const after = await publicTexts(evt(A));
    expect(after).toEqual(before);
    for (const text of after) {
      expect(text).not.toContain(cmp(A));
      expect(text).not.toContain(TITLE(A));
      expect(text).not.toContain('campaign_id');
    }
  });

  test('the public events list cannot be narrowed by a campaign', async () => {
    await linkEvent(evt(A), cmp(A));
    const base = await callAs({ kind: 'anonymous' }, 'GET', `/api/v2/events?brand=${A.brandId}`);
    const ids = ((await base.json()) as { items: Array<{ id: string }> }).items.map((i) => i.id);
    for (const q of [`campaign=${cmp(A)}`, `campaign_id=${cmp(A)}`]) {
      const res = await callAs(
        { kind: 'anonymous' },
        'GET',
        `/api/v2/events?brand=${A.brandId}&${q}`
      );
      const got = ((await res.json()) as { items: Array<{ id: string }> }).items.map((i) => i.id);
      expect(got, q).toEqual(ids);
    }
  });
});

// ── rule 4: two links, kept apart ─────────────────────────────────────────────

describe("a placement's campaign and its event's campaign never overwrite each other", () => {
  async function bundleCampaign(eventId: string, sponsorId: string): Promise<unknown> {
    const res = await callAs(
      { kind: 'anonymous' },
      'GET',
      `/api/v2/events/${eventId}/sponsor-bundle?surface=public`
    );
    const body = (await res.json()) as {
      bundle: { sponsors: Array<{ id: string; campaign?: unknown }> };
    };
    return body.bundle.sponsors.find((s) => s.id === sponsorId)?.campaign;
  }
  const placementPath = (campaignId: string, placementId: string) =>
    `/api/v2/admin/campaigns/${campaignId}/placements/${placementId}`;

  test('adding or removing the event leaves the placement in its own campaign', async () => {
    expect((await callAs(owner(A), 'PUT', placementPath(cmp(A, 1), plc(A)))).status).toBe(200);
    expect((await callAs(owner(A), 'PUT', eventPath(cmp(A, 2), evt(A)))).status).toBe(200);
    expect(await campaignOfPlacement(plc(A))).toBe(cmp(A, 1));
    expect(await campaignOfEvent(evt(A))).toBe(cmp(A, 2));
    // The public bundle still reads the placement's own campaign.
    expect(await bundleCampaign(evt(A), spo(A))).toEqual({ id: cmp(A, 1), title: TITLE(A, 1) });

    expect((await callAs(owner(A), 'DELETE', eventPath(cmp(A, 2), evt(A)))).status).toBe(200);
    expect(await campaignOfPlacement(plc(A))).toBe(cmp(A, 1));
    expect(await bundleCampaign(evt(A), spo(A))).toEqual({ id: cmp(A, 1), title: TITLE(A, 1) });
  });

  test('attaching or detaching the placement leaves the event in its own campaign', async () => {
    expect((await callAs(owner(A), 'PUT', eventPath(cmp(A, 2), evt(A)))).status).toBe(200);
    expect((await callAs(owner(A), 'PUT', placementPath(cmp(A, 1), plc(A)))).status).toBe(200);
    expect(await campaignOfEvent(evt(A))).toBe(cmp(A, 2));
    expect((await callAs(owner(A), 'DELETE', placementPath(cmp(A, 1), plc(A)))).status).toBe(200);
    expect(await campaignOfEvent(evt(A))).toBe(cmp(A, 2));
    expect(await campaignOfPlacement(plc(A))).toBeNull();
  });

  test('a placement with no campaign gets none from its event', async () => {
    expect((await callAs(owner(A), 'PUT', eventPath(cmp(A), evt(A)))).status).toBe(200);
    expect(await campaignOfPlacement(plc(A))).toBeNull();
    expect(await bundleCampaign(evt(A), spo(A))).toBeUndefined();
  });
});

// ── the Local Sponsor Covenant holds on an event in a campaign ────────────────
// Owner, 2026-11-15: "The locals still apply even on a campaign." The covenant
// is a floor on the local sponsors' share of rotation (brain invariant 25,
// lib/sponsor-allocation.ts), not a rank. A campaign is a label on a sponsor: it
// is never an input to which sponsors show, their order, or their shares.

describe('the local sponsors keep their share on an event that is in a campaign', () => {
  const LOCAL = 'ce-abc-local';
  const BIG = 'ce-abc-big';

  /** The whole public bundle with each sponsor's `campaign` label taken off. */
  async function bundleWithoutLabels(): Promise<{
    text: string;
    ids: string[];
    labelled: string[];
  }> {
    const res = await callAs(
      { kind: 'anonymous' },
      'GET',
      `/api/v2/events/${evt(A, 2)}/sponsor-bundle?surface=public`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bundle: { sponsors: Array<{ id: string; is_local?: number; campaign?: unknown }> };
    } & Record<string, unknown>;
    const labelled = body.bundle.sponsors.filter((s) => s.campaign).map((s) => s.id);
    const strip = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(strip)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v as Record<string, unknown>)
                // `updated_at`: attaching a placement stamps the placement (slice 1).
                .filter(
                  ([k]) =>
                    !['campaign', 'updated_at', 'beacon_token', 'requestId', 'timestamp'].includes(
                      k
                    )
                )
                .map(([k, x]) => [k, strip(x)])
            )
          : v;
    return {
      text: JSON.stringify(strip(body)),
      ids: body.bundle.sponsors.map((s) => s.id),
      labelled,
    };
  }

  beforeEach(async () => {
    await seedSplitSponsor(env.DB, {
      id: LOCAL,
      eventId: evt(A, 2),
      brandId: A.brandId,
      name: 'Corner Bakery ce',
      tier: 'bronze',
      isLocal: 1,
      placementId: `spl_${LOCAL}`,
      sponsorAccepted: 1,
      organizerAccepted: 1,
    });
    await seedSplitSponsor(env.DB, {
      id: BIG,
      eventId: evt(A, 2),
      brandId: A.brandId,
      name: 'Title Partner ce',
      tier: 'title',
      isLocal: 0,
      placementId: `spl_${BIG}`,
      sponsorAccepted: 1,
      organizerAccepted: 1,
    });
    await env.DB.prepare(`UPDATE sponsor_placement SET campaign_id = NULL WHERE id IN (?, ?)`)
      .bind(`spl_${LOCAL}`, `spl_${BIG}`)
      .run();
  });

  test('both sponsors show, and the bundle marks the local one (the test sees locality)', async () => {
    const res = await callAs(
      { kind: 'anonymous' },
      'GET',
      `/api/v2/events/${evt(A, 2)}/sponsor-bundle?surface=public`
    );
    const raw = await res.text();
    const body = JSON.parse(raw) as {
      bundle: { sponsors: Array<{ id: string; is_local?: number }> };
    };
    const by = (id: string) => body.bundle.sponsors.find((s) => s.id === id);
    expect(by(LOCAL)).toBeDefined();
    expect(by(BIG)).toBeDefined();
    expect(by(LOCAL)?.is_local).toBe(1);
    expect(by(BIG)?.is_local).toBe(0);
  });

  test('the event joining a campaign changes no sponsor, order or share', async () => {
    const before = await bundleWithoutLabels();
    expect((await callAs(owner(A), 'PUT', eventPath(cmp(A), evt(A, 2)))).status).toBe(200);
    const after = await bundleWithoutLabels();
    expect(after.text).toBe(before.text);
    expect(after.ids).toEqual(before.ids);
  });

  test('the bigger sponsor joining the campaign labels it and changes nothing else', async () => {
    const before = await bundleWithoutLabels();
    expect((await callAs(owner(A), 'PUT', eventPath(cmp(A), evt(A, 2)))).status).toBe(200);
    const put = await callAs(
      owner(A),
      'PUT',
      `/api/v2/admin/campaigns/${cmp(A)}/placements/spl_${BIG}`
    );
    expect(put.status).toBe(200);
    const after = await bundleWithoutLabels();
    expect(after.labelled).toEqual([BIG]);
    expect(after.text).toBe(before.text);
    expect(after.ids).toEqual(before.ids);
  });
});
