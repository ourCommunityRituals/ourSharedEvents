/**
 * OSE-1552 scope 2: rename a campaign, or change its status (workers pool).
 *
 *   PUT /api/v2/admin/campaigns/:id     body { title?, status? }
 *
 * Rules, each held by cases below (the code is in src/lib/campaigns.ts and
 * src/handlers/campaigns.ts; the owner decisions are OSE ADR-030):
 *   1. A campaign is a title and a status. An update takes those two fields and
 *      nothing else. The brand never changes.
 *   2. Brand wall: another brand's campaign reads like one that does not exist,
 *      and nothing is written.
 *   3. Only an active campaign is announced: pausing or completing one takes it
 *      out of the public sponsor bundle at once, and its sponsor still shows.
 *   4. The write passes the admin write guard and is audited.
 *
 * The matrix (tests/brand-matrix.spec.ts) runs the route as every brand pair.
 * Staging twin: bruno/ose-api/18. Campaigns (S14), requests 60 to 72.
 *
 * @born-red rename and status | method: each fault was put in src, this file
 * was run and the named cases failed, then the fault was removed. (a) the
 * unknown-field check dropped: "any other field is refused" failed; (b)
 * `brand_id` added to the update fields and written: "the brand never changes"
 * failed; (c) the brand scope dropped from the UPDATE and the guard's campaign
 * branch skipped for this path: "another brand's campaign", "platform" and 12
 * matrix cells failed; (d) the title check skipped: the bad-title cases failed;
 * (e) the status check skipped: "an unknown status" failed; (f) COALESCE
 * replaced by a plain assignment: "a rename leaves the status" and "a status
 * change leaves the title" failed; (g) the status predicate dropped from the
 * public read: "paused" and "completed" failed; (h) the audit call dropped from
 * the route: both audit cases failed; (i) requireAdmin dropped from the route:
 * "anonymous" failed; (j) updated_at not stamped: "a rename leaves the status"
 * failed | date: 2026-11-15
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

const evt = (b: BrandFx) => `cu-${b.key}-evt`;
const cmp = (b: BrandFx) => `cu-${b.key}-campaign`;
const spo = (b: BrandFx) => `cu-${b.key}-sponsor`;
const plc = (b: BrandFx) => `spl_cu-${b.key}-sponsor`;
const TITLE = (b: BrandFx) => `Pangolin Autumn Run ${b.key}`;
const OLD = '2020-01-01T00:00:00.000Z';

const owner = (b: BrandFx) => ({ kind: 'owner' as const, brand: b });
const path = (id: string) => `/api/v2/admin/campaigns/${id}`;

interface Row {
  id: string;
  brand_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

async function rowOf(id: string): Promise<Row | null> {
  return env.DB.prepare(
    'SELECT id, brand_id, title, status, created_at, updated_at FROM campaigns WHERE id = ?'
  )
    .bind(id)
    .first<Row>();
}

/** One brand: an event, a campaign, and an accepted placement that is in the campaign. */
async function seedBrand(b: BrandFx) {
  await env.DB.prepare(
    `INSERT INTO events
       (id, brand_id, title, slug, status, is_published, data_class, start_date, settings_json)
     VALUES (?, ?, ?, ?, 'active', 1, 'synthetic', '2099-06-01', '{"useSponsors":true}')
     ON CONFLICT(id) DO NOTHING`
  )
    .bind(evt(b), b.brandId, `Event ${evt(b)}`, `slug-${evt(b)}`)
    .run();
  await env.DB.prepare(
    `INSERT INTO campaigns (id, brand_id, title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)
     ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title,
       status = 'active', created_at = excluded.created_at, updated_at = excluded.updated_at`
  )
    .bind(cmp(b), b.brandId, TITLE(b), OLD, OLD)
    .run();
  await seedSplitSponsor(env.DB, {
    id: spo(b),
    eventId: evt(b),
    brandId: b.brandId,
    name: `Sponsor cu ${b.key}`,
    campaignId: cmp(b),
    placementId: plc(b),
    sponsorAccepted: 1,
    organizerAccepted: 1,
  });
}

async function bundleSponsor(
  b: BrandFx
): Promise<{ id: string; campaign?: { id: string; title: string } } | undefined> {
  const res = await callAs(
    { kind: 'anonymous' },
    'GET',
    `/api/v2/events/${evt(b)}/sponsor-bundle?surface=public`
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    bundle: { sponsors: Array<{ id: string; campaign?: { id: string; title: string } }> };
  };
  return body.bundle.sponsors.find((s) => s.id === spo(b));
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
  await seedBrand(A);
  await seedBrand(B);
});

// ── rule 1: a title and a status, and nothing else ────────────────────────────

describe('an organizer renames a campaign or changes its status', () => {
  test('a rename leaves the status, and answers the campaign as it now is', async () => {
    const res = await callAs(owner(A), 'PUT', path(cmp(A)), { title: '  Winter\n  Lights  ' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; item: Row };
    expect(body.id).toBe(cmp(A));
    // One line: runs of whitespace collapse, as at create.
    expect(body.item).toMatchObject({ title: 'Winter Lights', status: 'active' });
    const row = await rowOf(cmp(A));
    expect(row).toMatchObject({
      title: 'Winter Lights',
      status: 'active',
      brand_id: A.brandId,
      created_at: OLD,
    });
    expect(row?.updated_at).not.toBe(OLD);
    expect(body.item).toEqual(row);
  });

  test.each(['paused', 'completed', 'active'])(
    'a status change to %s leaves the title',
    async (status) => {
      await env.DB.prepare(`UPDATE campaigns SET status = 'paused' WHERE id = ?`)
        .bind(cmp(A))
        .run();
      const res = await callAs(owner(A), 'PUT', path(cmp(A)), { status });
      expect(res.status).toBe(200);
      expect(await rowOf(cmp(A))).toMatchObject({ title: TITLE(A), status });
    }
  );

  test('a title and a status together', async () => {
    const res = await callAs(owner(A), 'PUT', path(cmp(A)), { title: 'Both', status: 'paused' });
    expect(res.status).toBe(200);
    expect(await rowOf(cmp(A))).toMatchObject({ title: 'Both', status: 'paused' });
  });

  test.each([
    ['description', { title: 'x', description: 'more' }],
    ['brand_id', { title: 'x', brand_id: B.brandId }],
    ['id', { title: 'x', id: 'cu-other' }],
    ['tier', { status: 'paused', tier: 'mid' }],
  ])('any other field is refused, and nothing is written: %s', async (_name, body) => {
    const before = await rowOf(cmp(A));
    const res = await callAs(owner(A), 'PUT', path(cmp(A)), body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('UNKNOWN_FIELD');
    expect(await rowOf(cmp(A))).toEqual(before);
  });

  test('the brand never changes', async () => {
    await callAs(owner(A), 'PUT', path(cmp(A)), { title: 'x', brand_id: B.brandId });
    await callAs({ kind: 'key-all' }, 'PUT', path(cmp(A)), { brand_id: B.brandId });
    expect((await rowOf(cmp(A)))?.brand_id).toBe(A.brandId);
  });

  test.each([
    ['an empty body', {}, 'NOTHING_TO_UPDATE'],
    ['an empty title', { title: '   ' }, 'MISSING_TITLE'],
    ['a title that is not text', { title: 7 }, 'MISSING_TITLE'],
    ['a title over 120 characters', { title: 'x'.repeat(121) }, 'INVALID_TITLE'],
    ['an unknown status', { status: 'archived' }, 'INVALID_STATUS'],
    ['a status that is not text', { status: 1 }, 'INVALID_STATUS'],
    ['a good title with a bad status', { title: 'Fine', status: 'gone' }, 'INVALID_STATUS'],
  ])('%s is refused, and nothing is written', async (_name, body, code) => {
    const before = await rowOf(cmp(A));
    const res = await callAs(owner(A), 'PUT', path(cmp(A)), body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe(code);
    expect(await rowOf(cmp(A))).toEqual(before);
  });

  test('a body that is not a JSON object is refused', async () => {
    for (const body of [[{ title: 'x' }], 'text', null]) {
      const res = await callAs(owner(A), 'PUT', path(cmp(A)), body);
      expect(res.status).toBe(400);
    }
    expect((await rowOf(cmp(A)))?.title).toBe(TITLE(A));
  });

  test('the list shows the new title, and its order does not follow a rename', async () => {
    const order = async () => {
      const res = await callAs(owner(A), 'GET', '/api/v2/admin/campaigns');
      const items = ((await res.json()) as { items: Row[] }).items;
      return items.map((i) => i.id);
    };
    const before = await order();
    await callAs(owner(A), 'PUT', path(cmp(A)), { title: 'Aardvark first by name' });
    expect(await order()).toEqual(before);
    const res = await callAs(owner(A), 'GET', '/api/v2/admin/campaigns');
    expect(await res.text()).toContain('Aardvark first by name');
  });
});

// ── rule 2: the brand wall ────────────────────────────────────────────────────

describe("the brand wall: another brand's campaign cannot be renamed or paused", () => {
  test("another brand's campaign reads like an unknown one, and nothing is written", async () => {
    const before = await rowOf(cmp(B));
    const cross = await callAs(owner(A), 'PUT', path(cmp(B)), { title: 'taken', status: 'paused' });
    const unknown = await callAs(owner(A), 'PUT', path(UNKNOWN_ID), { title: 'taken' });
    expect(cross.status).toBe(404);
    expect(shape(await cross.text(), cmp(B))).toBe(shape(await unknown.text(), UNKNOWN_ID));
    expect(await rowOf(cmp(B))).toEqual(before);
  });

  test.each([{ kind: 'platform' as const }, { kind: 'key-none' as const }])(
    'a $kind caller reaches no tenant campaign',
    async (caller) => {
      const before = await rowOf(cmp(A));
      const res = await callAs(caller, 'PUT', path(cmp(A)), { status: 'paused' });
      expect(res.status).toBe(404);
      expect(await rowOf(cmp(A))).toEqual(before);
    }
  );

  test('the automation key updates within a brand, and cannot move a campaign out of it', async () => {
    const res = await callAs({ kind: 'key-all' }, 'PUT', path(cmp(B)), { status: 'completed' });
    expect(res.status).toBe(200);
    expect(await rowOf(cmp(B))).toMatchObject({ status: 'completed', brand_id: B.brandId });
  });

  test('an anonymous caller gets 401, never a scope answer', async () => {
    const before = await rowOf(cmp(A));
    const res = await callAs({ kind: 'anonymous' }, 'PUT', path(cmp(A)), { title: 'anon' });
    expect(res.status).toBe(401);
    expect(await rowOf(cmp(A))).toEqual(before);
  });
});

// ── rule 3: only an active campaign is announced ──────────────────────────────

describe('a status change is what the public sees', () => {
  test('active: the sponsor carries the campaign, and a rename shows at once', async () => {
    expect((await bundleSponsor(A))?.campaign).toEqual({ id: cmp(A), title: TITLE(A) });
    await callAs(owner(A), 'PUT', path(cmp(A)), { title: 'Renamed Run' });
    expect((await bundleSponsor(A))?.campaign).toEqual({ id: cmp(A), title: 'Renamed Run' });
  });

  test.each(['paused', 'completed'])(
    '%s: the campaign is no longer named, and its sponsor still shows',
    async (status) => {
      expect((await callAs(owner(A), 'PUT', path(cmp(A)), { status })).status).toBe(200);
      const sponsor = await bundleSponsor(A);
      expect(sponsor).toBeDefined();
      expect(sponsor).not.toHaveProperty('campaign');
      // Back to active: it is named again.
      await callAs(owner(A), 'PUT', path(cmp(A)), { status: 'active' });
      expect((await bundleSponsor(A))?.campaign).toEqual({ id: cmp(A), title: TITLE(A) });
    }
  );

  test('pausing one brand campaign changes nothing for another brand', async () => {
    await callAs(owner(A), 'PUT', path(cmp(A)), { status: 'paused' });
    expect((await bundleSponsor(B))?.campaign).toEqual({ id: cmp(B), title: TITLE(B) });
  });
});

// ── rule 4: the admin write guard and the audit log ───────────────────────────

describe('the update passes the admin write guard and is audited', () => {
  test('a cross-site update is refused and writes nothing', async () => {
    const before = await rowOf(cmp(A));
    const ctx = createExecutionContext();
    const res = await route(
      new Request(`https://ose.test${path(cmp(A))}`, {
        method: 'PUT',
        headers: {
          ...headersAsEmail(A.ownerEmail),
          'Sec-Fetch-Site': 'cross-site',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'from elsewhere' }),
      }),
      routerEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(403);
    expect(await rowOf(cmp(A))).toEqual(before);
  });

  test('an update leaves an audit row in the campaign brand', async () => {
    await env.DB.prepare('DELETE FROM admin_audit_log WHERE resource_id = ?').bind(cmp(A)).run();
    expect((await callAs(owner(A), 'PUT', path(cmp(A)), { status: 'paused' })).status).toBe(200);
    const rows = await env.DB.prepare(
      `SELECT action, outcome, resource_type, brand_id FROM admin_audit_log WHERE resource_id = ?`
    )
      .bind(cmp(A))
      .all();
    expect(rows.results).toEqual([
      {
        action: 'UPDATE_CAMPAIGN',
        outcome: 'success',
        resource_type: 'campaign',
        brand_id: A.brandId,
      },
    ]);
  });

  test('a refused update is audited as denied, never as a write', async () => {
    await env.DB.prepare('DELETE FROM admin_audit_log WHERE resource_id = ?').bind(cmp(A)).run();
    expect((await callAs(owner(A), 'PUT', path(cmp(A)), { status: 'nope' })).status).toBe(400);
    const rows = await env.DB.prepare(
      `SELECT action, outcome FROM admin_audit_log WHERE resource_id = ?`
    )
      .bind(cmp(A))
      .all();
    expect(rows.results).toEqual([{ action: 'UPDATE_CAMPAIGN', outcome: 'denied' }]);
  });
});
