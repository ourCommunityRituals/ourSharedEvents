/**
 * Partner links between groups, route layer (owner 2026-11-28,
 * src/handlers/event-partners.ts, migration 0128).
 *
 * Three brands: the organizer (A), the invited partner (B) and an outsider (C).
 *
 * Held here:
 *   1. the organizer invites, lists and withdraws on its own event; another
 *      brand's admin gets the 404 that "does not exist" gets;
 *   2. an invite to the organizer's own brand, to the public brand, or with a
 *      body that is not JSON is refused;
 *   3. only the invited brand sees the link and answers it; the outsider gets
 *      404 on both;
 *   4. the event page names the partner only while both sides accept, and a
 *      public body reads "Co-hosted with ... (public body)";
 *   5. the partner reads the event's floored total only while both accept, and
 *      it is the organizer's own figure; never a per-stop row;
 *   6. each write is in the audit log.
 *
 * @born-red owner 2026-11-28 | method: one fault at a time, each restored:
 *   1. partnerScope answering every brand ('1 = 1'): 2 red;
 *   2. the counts read without the "both accept" check: 1 red;
 *   3. the page query without partnerOnSql: 2 red;
 *   4. respond without `organizer_accepted = 1` in offeredLink: 1 red.
 * date: 2026-11-28
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { usePaidReportPlan } from './helpers/paid-report-plan';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND_A = 'brand-epl-a';
const BRAND_B = 'brand-epl-b';
const BRAND_C = 'brand-epl-c';
const OWNER_A = 'owner-epl-a@example.com';
const OWNER_B = 'owner-epl-b@example.com';
const OWNER_C = 'owner-epl-c@example.com';
const WALK = 'evt-epl-walk';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function asEmail(email: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
    'Sec-Fetch-Site': 'same-origin',
  };
}
const A = asEmail(OWNER_A);
const B = asEmail(OWNER_B);
const C = asEmail(OWNER_C);
const KEY = { Authorization: 'Bearer test-admin-key-e2e-2026' };

type Json = Record<string, any>;
let nextIp = 1;
async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<{ status: number; json: Json; text: string }> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, {
      method,
      headers: {
        'CF-Connecting-IP': `198.51.100.${nextIp++ % 250}`,
        ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    /* a page */
  }
  return { status: res.status, json, text };
}

const run = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

const page = async () => (await call('GET', `/events/${WALK}`, { Accept: 'text/html' })).text;
const invite = (who: Record<string, string>, body: unknown) =>
  call('POST', `/api/v2/admin/events/${WALK}/partners`, who, body);
const links = async (who: Record<string, string>) =>
  ((await call('GET', '/api/v2/admin/partner-links', who)).json.links ?? []) as Json[];

beforeAll(async () => {
  await applyMigrations();
  await usePaidReportPlan();
  for (const [email, brand] of [
    [OWNER_A, BRAND_A],
    [OWNER_B, BRAND_B],
    [OWNER_C, BRAND_C],
  ])
    await run(
      `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
      email,
      brand
    );
});

beforeEach(async () => {
  await run(`DELETE FROM event_partners WHERE event_id LIKE 'evt-epl-%'`);
  await run(`DELETE FROM scan_placement_events WHERE event_id LIKE 'evt-epl-%'`);
  await run(`DELETE FROM poster_deployments WHERE event_id LIKE 'evt-epl-%'`);
  await run(`DELETE FROM events WHERE id LIKE 'evt-epl-%'`);
  await run(
    `INSERT INTO events (id, brand_id, title, slug, status, qr_verified, is_published, start_date, end_date, timezone, settings_json)
     VALUES (?, ?, 'First Friday Art Walk', ?, 'active', 1, 1, '2099-06-04', '2099-06-04', 'America/Chicago', '{}')`,
    WALK,
    BRAND_A,
    WALK
  );
  await run(
    `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active)
     VALUES ('pd-epl-1', ?, 'qrt_pd-epl-1', 'Stop', 1)`,
    WALK
  );
  for (let i = 0; i < 7; i++)
    await run(
      `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket) VALUES (?, ?, 'pd-epl-1', '2099-06-04T18:00')`,
      `epl-scan-${i}`,
      WALK
    );
});

describe('the organizer side', () => {
  test('invites, lists, and another brand cannot reach the event', async () => {
    const res = await invite(A, { partner_brand_id: BRAND_B, partner_name: 'Hollyhock Eats' });
    expect(res.status).toBe(201);
    expect(res.json.partner).toMatchObject({
      partner_brand_id: BRAND_B,
      partner_name: 'Hollyhock Eats',
      kind: 'partner',
      organizer_accepted: true,
      partner_accepted: null,
      on: false,
    });
    const list = await call('GET', `/api/v2/admin/events/${WALK}/partners`, A);
    expect(list.json.partners).toHaveLength(1);

    expect((await invite(C, { partner_brand_id: BRAND_C, partner_name: 'Outsider' })).status).toBe(
      404
    );
    expect((await call('GET', `/api/v2/admin/events/${WALK}/partners`, C)).status).toBe(404);
  });

  test.each([
    ['its own brand', { partner_brand_id: BRAND_A, partner_name: 'Self' }],
    ['the public brand', { partner_brand_id: 'root', partner_name: 'Everyone' }],
    ['no name', { partner_brand_id: BRAND_B }],
  ])('refuses an invite to %s', async (_n, body) => {
    expect((await invite(A, body)).status).toBe(400);
  });

  test('refuses a body that is not JSON', async () => {
    const ctx = createExecutionContext();
    const res = await route(
      new Request(`https://ose.test/api/v2/admin/events/${WALK}/partners`, {
        method: 'POST',
        headers: { ...A, 'Content-Type': 'text/plain' },
        body: 'partner_brand_id=x',
      }),
      routerEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});

describe('the partner side', () => {
  test('only the invited brand sees and answers the link; the page names it only while both accept', async () => {
    const id = (await invite(A, { partner_brand_id: BRAND_B, partner_name: 'Hollyhock Eats' })).json
      .partner.id as string;

    expect((await links(B)).map((l) => [l.id, l.event_title])).toEqual([
      [id, 'First Friday Art Walk'],
    ]);
    expect(await links(C)).toEqual([]);
    expect(await page()).not.toContain('data-testid="event-partners"');

    expect(
      (await call('POST', `/api/v2/admin/partner-links/${id}/respond`, C, { accept: true })).status
    ).toBe(404);
    expect(
      (await call('POST', `/api/v2/admin/partner-links/${id}/respond`, B, { accept: 'yes' })).status
    ).toBe(400);
    const yes = await call('POST', `/api/v2/admin/partner-links/${id}/respond`, B, {
      accept: true,
    });
    expect(yes.status).toBe(200);
    expect(yes.json.on).toBe(true);
    expect(await page()).toContain('With Hollyhock Eats');

    const no = await call('POST', `/api/v2/admin/partner-links/${id}/respond`, B, {
      accept: false,
    });
    expect(no.status).toBe(200);
    expect(await page()).not.toContain('Hollyhock Eats');
  });

  test('a public body reads as a co-host and a public body on the page', async () => {
    const id = (
      await invite(A, {
        partner_brand_id: BRAND_B,
        partner_name: 'Fernbrook Park District',
        kind: 'partner',
        is_public_body: true,
      })
    ).json.partner.id as string;
    await call('POST', `/api/v2/admin/partner-links/${id}/respond`, B, { accept: true });
    expect(await page()).toContain('Co-hosted with Fernbrook Park District (public body)');
  });

  test('the floored total only while both accept, the organizer figure, no per-stop rows', async () => {
    const id = (await invite(A, { partner_brand_id: BRAND_B, partner_name: 'Hollyhock Eats' })).json
      .partner.id as string;
    const counts = (who: Record<string, string>) =>
      call('GET', `/api/v2/admin/partner-links/${id}/counts`, who);

    expect((await counts(B)).status).toBe(404); // not answered yet
    await call('POST', `/api/v2/admin/partner-links/${id}/respond`, B, { accept: true });
    const got = await counts(B);
    expect(got.status).toBe(200);
    expect(Object.keys(got.json).sort()).toEqual(['event_id', 'id', 'ok', 'scans', 'status']);
    const organizer = await call('GET', `/api/v2/admin/events/${WALK}/booths/counts`, KEY);
    expect(got.json.scans).toEqual(organizer.json.total);
    expect((await counts(C)).status).toBe(404);
  });

  test('a withdrawn link: gone from the page, the partner list, the counts and the answer', async () => {
    const id = (await invite(A, { partner_brand_id: BRAND_B, partner_name: 'Hollyhock Eats' })).json
      .partner.id as string;
    await call('POST', `/api/v2/admin/partner-links/${id}/respond`, B, { accept: true });
    const w = await call('POST', `/api/v2/admin/events/${WALK}/partners/${id}/withdraw`, A, {});
    expect(w.status).toBe(200);
    expect(await page()).not.toContain('Hollyhock Eats');
    expect(await links(B)).toEqual([]);
    expect((await call('GET', `/api/v2/admin/partner-links/${id}/counts`, B)).status).toBe(404);
    expect(
      (await call('POST', `/api/v2/admin/partner-links/${id}/respond`, B, { accept: true })).status
    ).toBe(404);
    expect(
      (await call('POST', `/api/v2/admin/events/${WALK}/partners/${id}/withdraw`, C, {})).status
    ).toBe(404);
  });
});

describe('the audit log', () => {
  test('records the invite, the answer and the withdrawal', async () => {
    const id = (await invite(A, { partner_brand_id: BRAND_B, partner_name: 'Hollyhock Eats' })).json
      .partner.id as string;
    await call('POST', `/api/v2/admin/partner-links/${id}/respond`, B, { accept: true });
    await call('POST', `/api/v2/admin/events/${WALK}/partners/${id}/withdraw`, A, {});
    const rows = await tenv.DB.prepare(
      `SELECT action FROM admin_audit_log
        WHERE action IN ('INVITE_PARTNER', 'ANSWER_PARTNER', 'WITHDRAW_PARTNER')
          AND (resource_id = ? OR resource_id = ?) AND outcome = 'success'`
    )
      .bind(WALK, id)
      .all<{ action: string }>();
    const actions = new Set((rows.results ?? []).map((r) => r.action));
    expect([...actions].sort()).toEqual(['ANSWER_PARTNER', 'INVITE_PARTNER', 'WITHDRAW_PARTNER']);
  });
});
