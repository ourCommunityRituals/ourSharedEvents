/**
 * OSE-2144: nothing is more live than its container (owner, 2026-11-18).
 *
 * A public read of anything that belongs to an event answers only while the
 * event is Published (`status = 'active'`, domain/event-state.ts eventLiveSql).
 * This spec holds the four gaps the sweep found, at the workers-pool layer:
 *
 *   1. GET /api/v2/events/:id/sponsors and /sponsor-bundle answer no sponsor for
 *      a draft, ready or archived event;
 *   2. impression and click on a draft, ready or archived event answer the same
 *      as an unknown placement and write nothing;
 *   3. GET /api/v2/sponsors/:id/logo and /asset/:format answer 404 when the
 *      sponsor's only accepted placement is not on a live event;
 *   4. GET /q/:token for a draft, ready or archived event counts nothing, sets
 *      no cookie, and redirects home without the event id.
 *
 * And the two written exceptions hold:
 *   5. an archived event that was listed still shows its recap sponsor strip
 *      (names; its art is not served once the event is not live);
 *   6. an archived event's SharedReport still opens with a valid signed link.
 *
 * Every case has a live control on the same seed, so a pass is never "nothing
 * renders anywhere". The staging layer is bruno/ose-api
 * "26. Live container (OSE-2144)".
 *
 * @born-red OSE-2144 | method: (1) run against main 43a25c1 (no status check in
 * the resolver, impression/click, the logo and asset statements or the /q
 * lookup): 26 of 33 failed, every non-live case in sections 1-4 and the recap
 * "no art" case; the live controls and both exceptions passed. (2) On this
 * branch, one fault at a time: the resolver's stop removed (the 5 Path 2 cases
 * failed); the /q live test removed (10); impression/click, the logo and the
 * asset each back to the consent rule alone (5 each); the live test widened to
 * ready/active/archived (16); the recap statement made to ask live (section 5
 * failed) | date: 2026-11-18
 *
 * Runtime-bound (SELF.fetch, env.DB) → workers pool.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import { mintBeaconToken } from '../src/lib/beacon-token';
import { mintSignedLinkToken } from '../src/lib/shared-report-auth';
import { handleQrScan, type QrScanEnv } from '../src/handlers/qr-scan';
import { handleSponsorAsset } from '../src/handlers/sponsor-asset-route';
import { resolveSponsorsForEvent } from '../src/lib/sponsor-resolver';
import { seedSplitSponsor } from './helpers/seed-sponsor';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  SHARED_REPORT_SIGNING_SECRET: string;
  ANON_ID_HASH_PEPPER: string;
}
const tenv = env as unknown as TestEnv;

const BRAND = 'ose-live-container';
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

type Status = 'active' | 'draft' | 'ready' | 'archived';
interface Case {
  status: Status;
  listed: 0 | 1;
  eventId: string;
  sponsorId: string;
  name: string;
  qrToken: string;
}

const mk = (status: Status, listed: 0 | 1): Case => {
  const k = `${status}-${listed}`;
  return {
    status,
    listed,
    eventId: `lc-evt-${k}`,
    sponsorId: `lc-sp-${k}`,
    name: `Container Sponsor ${status} ${listed}`,
    qrToken: `qrt_lc_${status}_${listed}`,
  };
};

/**
 * Path 2 (template + geo, dark by default): one business subscribed to the
 * template every event here uses, with no placement and no areas, so the match
 * alone would show it. It shows on the live event with the switch on (the
 * control); on any other event only the resolver's stop keeps it out.
 */
const TEMPLATE = 'lc-tpl';
const PATH2 = 'lc-sp-path2';

const LIVE = mk('active', 1);
/** Every state that is not Published, listed and unlisted where it matters. */
const NOT_LIVE: Case[] = [
  mk('draft', 0),
  mk('ready', 0),
  mk('archived', 0),
  // Archived after being listed: the recap exception's event. Everywhere but
  // the recap page it is as closed as any other non-live event.
  mk('archived', 1),
  // is_published = 1 alone never makes a draft live.
  mk('draft', 1),
];

async function applyMigrations(stmtsJson: string, db: D1Database): Promise<void> {
  for (const stmt of JSON.parse(stmtsJson) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        !msg.includes('duplicate column name') &&
        !msg.includes('already exists') &&
        !msg.includes('no such column')
      ) {
        throw e;
      }
    }
  }
}

async function seedCase(c: Case): Promise<void> {
  await tenv.DB.prepare(
    `INSERT OR REPLACE INTO events
       (id, brand_id, title, slug, status, start_date, location, is_published, listed_from,
        settings_json, template_id)
     VALUES (?, ?, ?, ?, ?, ?, 'Eagles Hall', ?, ?, '{"useSponsors":true}', ?)`
  )
    .bind(
      c.eventId,
      BRAND,
      `Container ${c.status} ${c.listed}`,
      c.eventId,
      c.status,
      day(c.status === 'archived' ? -3 : 10),
      c.listed,
      c.listed ? day(-20) : null,
      TEMPLATE
    )
    .run();
  await seedSplitSponsor(tenv.DB, {
    id: c.sponsorId,
    eventId: c.eventId,
    brandId: BRAND,
    name: c.name,
    // Refused by the logo proxy (not a public host): a served logo answers
    // 422 with no outbound fetch, a refused one 404.
    logoUrl: 'https://localhost/logo.png',
    clickToken: `clk_${c.sponsorId}`,
    displayToken: `dsp_${c.sponsorId}`,
  });
  // A header image too, so the ?slot=header case has a live control that is
  // served (422 from the refused host), not a 404 for having none.
  await tenv.DB.prepare('UPDATE sponsor_business SET header_image_url = ? WHERE id = ?')
    .bind('https://localhost/header.png', c.sponsorId)
    .run();
  await tenv.DB.prepare(
    `INSERT OR REPLACE INTO poster_deployments
       (id, event_id, qr_token, placement_label, is_active, created_at)
     VALUES (?, ?, ?, 'Container wall', 1, datetime('now'))`
  )
    .bind(`lc-pd-${c.status}-${c.listed}`, c.eventId, c.qrToken)
    .run();
}

const get = (path: string, init?: RequestInit) => SELF.fetch(`https://t.test${path}`, init);
const getJson = async (path: string) => (await (await get(path)).json()) as Record<string, unknown>;

async function rows(table: string, eventId: string): Promise<number> {
  const r = await tenv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE event_id = ?`)
    .bind(eventId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

let ipSeq = 10;
async function beacon(c: { eventId: string; sponsorId: string }, kind: 'impression' | 'click') {
  const res = await get(`/api/v2/events/${c.eventId}/sponsors/${c.sponsorId}/${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'CF-Connecting-IP': `198.51.100.${ipSeq++}`,
    },
    body: JSON.stringify({
      surface: 'public',
      placement: 'mobileBanner',
      beacon_token: await mintBeaconToken(
        env as unknown as Parameters<typeof mintBeaconToken>[0],
        c.eventId,
        c.sponsorId
      ),
    }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function scanEnv(): QrScanEnv {
  return { DB: tenv.DB, ANON_ID_HASH_PEPPER: tenv.ANON_ID_HASH_PEPPER };
}
const scanReq = (token: string) =>
  new Request(`https://t.test/q/${token}?type=register`, { headers: { 'User-Agent': UA } });

beforeAll(async () => {
  await applyMigrations(tenv.TEST_MIGRATION_STATEMENTS, tenv.DB);
  await applyMigrations(tenv.TEST_FORMS_MIGRATION_STATEMENTS, tenv.FORMS_DB);
  await tenv.DB.prepare(
    `INSERT OR IGNORE INTO event_templates (id, name, description, category)
     VALUES (?, 'Container template', 'OSE-2144 fixture', 'general')`
  )
    .bind(TEMPLATE)
    .run();
  for (const c of [LIVE, ...NOT_LIVE]) await seedCase(c);
  await tenv.DB.batch([
    tenv.DB.prepare('DELETE FROM sponsor_business WHERE id = ?').bind(PATH2),
    tenv.DB.prepare(
      `INSERT INTO sponsor_business (id, brand_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, 'Container Path Two', 1, datetime('now'), datetime('now'))`
    ).bind(PATH2, BRAND),
    tenv.DB.prepare(
      `INSERT OR REPLACE INTO sponsor_event_types (id, sponsor_id, template_id, is_active)
       VALUES ('lc-set-path2', ?, ?, 1)`
    ).bind(PATH2, TEMPLATE),
  ]);
});

const label = (c: Case) => `${c.status}${c.listed ? ', listed' : ''}`;

describe('1. the sponsor resolver answers no sponsor unless the event is live', () => {
  test('live control: the resolver, /sponsors and /sponsor-bundle show the sponsor', async () => {
    expect((await resolveSponsorsForEvent(tenv.DB, LIVE.eventId)).map((s) => s.id)).toEqual([
      LIVE.sponsorId,
    ]);
    const list = await getJson(`/api/v2/events/${LIVE.eventId}/sponsors`);
    expect((list.items as { id: string }[]).map((s) => s.id)).toEqual([LIVE.sponsorId]);
    const bundle = await getJson(`/api/v2/events/${LIVE.eventId}/sponsor-bundle?surface=display`);
    expect(JSON.stringify(bundle)).toContain(LIVE.sponsorId);
  });

  test('live control: the dark Path 2 match, switched on, shows the subscribed business', async () => {
    const ids = (
      await resolveSponsorsForEvent(tenv.DB, LIVE.eventId, { geoMatchEnabled: true })
    ).map((s) => s.id);
    expect(ids).toContain(PATH2);
  });

  for (const c of NOT_LIVE) {
    test(`${label(c)}: the resolver, /sponsors and /sponsor-bundle show none`, async () => {
      expect(await resolveSponsorsForEvent(tenv.DB, c.eventId)).toEqual([]);
      // The dark Path 2 (template + geo) is behind the same stop: switched on,
      // the subscribed business matches this event's template, and is kept out
      // only because the event is not live.
      expect(await resolveSponsorsForEvent(tenv.DB, c.eventId, { geoMatchEnabled: true })).toEqual(
        []
      );
      const list = await getJson(`/api/v2/events/${c.eventId}/sponsors`);
      expect(list.items).toEqual([]);
      for (const surface of ['', '?surface=display', '?surface=poster', '?surface=public']) {
        const text = JSON.stringify(
          await getJson(`/api/v2/events/${c.eventId}/sponsor-bundle${surface}`)
        );
        expect(text, `sponsor-bundle${surface}`).not.toContain(c.sponsorId);
        expect(text, `sponsor-bundle${surface}`).not.toContain(c.name);
        expect(text, `sponsor-bundle${surface}`).not.toContain('beacon_token');
      }
    });
  }
});

describe('2. impression and click count nothing unless the event is live', () => {
  test('live control: both write a row', async () => {
    const d0 = await rows('sponsor_displays', LIVE.eventId);
    expect((await beacon(LIVE, 'impression')).status).toBe(201);
    expect((await beacon(LIVE, 'click')).status).toBe(201);
    expect(await rows('sponsor_displays', LIVE.eventId)).toBe(d0 + 2);
  });

  for (const c of NOT_LIVE) {
    test(`${label(c)}: the same answer as an unknown placement, and no row`, async () => {
      const before = await rows('sponsor_displays', c.eventId);
      for (const kind of ['impression', 'click'] as const) {
        const unknown = await beacon({ eventId: c.eventId, sponsorId: 'lc-sp-nobody' }, kind);
        const real = await beacon(c, kind);
        expect(real.status, kind).toBe(404);
        // requestId and timestamp differ on every answer; nothing else may.
        const same = ({ requestId: _r, timestamp: _t, ...rest }: Record<string, unknown>) => rest;
        expect(same(real.body), kind).toEqual(same(unknown.body));
      }
      expect(await rows('sponsor_displays', c.eventId)).toBe(before);
    });
  }
});

describe('3. the logo and asset proxy serve art only for a sponsor on a live event', () => {
  const logo = (id: string, slot = '') => get(`/api/v2/sponsors/${id}/logo${slot}`);
  const asset = (id: string) =>
    handleSponsorAsset(
      new Request('https://t.test'),
      env as unknown as Parameters<typeof handleSponsorAsset>[1],
      id,
      'square'
    );

  test('live control: the logo is served (422 from the proxy, not 404) and so is the asset', async () => {
    expect((await logo(LIVE.sponsorId)).status).toBe(422);
    expect((await logo(LIVE.sponsorId, '?slot=sidebar')).status).toBe(422);
    expect((await logo(LIVE.sponsorId, '?slot=header')).status).toBe(422);
    expect((await asset(LIVE.sponsorId)).status).toBe(200);
  });

  for (const c of NOT_LIVE) {
    test(`${label(c)}: the only placement is not live, so logo and asset are 404`, async () => {
      for (const slot of ['', '?slot=sidebar', '?slot=header']) {
        expect((await logo(c.sponsorId, slot)).status, `logo${slot}`).toBe(404);
      }
      expect((await asset(c.sponsorId)).status).toBe(404);
    });
  }
});

describe('4. /q for an event that is not live counts nothing and goes home', () => {
  test('live control: the scan is counted and lands on the event', async () => {
    const before = await rows('scan_placement_events', LIVE.eventId);
    const res = await handleQrScan(scanReq(LIVE.qrToken), scanEnv(), LIVE.qrToken);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain(`/events/${LIVE.eventId}`);
    expect(await rows('scan_placement_events', LIVE.eventId)).toBe(before + 1);
  });

  for (const c of NOT_LIVE) {
    test(`${label(c)}: no count, no cookie, and home without the event id`, async () => {
      const before = await rows('scan_placement_events', c.eventId);
      const res = await handleQrScan(scanReq(c.qrToken), scanEnv(), c.qrToken);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/');
      expect(res.headers.get('Set-Cookie')).toBeNull();
      expect(await rows('scan_placement_events', c.eventId)).toBe(before);
      expect(await rows('scan_node_returns', c.eventId)).toBe(0);
      // The same answer as a code nobody issued.
      const unknown = await handleQrScan(scanReq('qrt_lc_nobody'), scanEnv(), 'qrt_lc_nobody');
      expect([res.status, res.headers.get('Location')]).toEqual([
        unknown.status,
        unknown.headers.get('Location'),
      ]);
    });

    test(`${label(c)}: the routed /q answers the same, and the rate-limited path too`, async () => {
      const routed = await get(`/q/${c.qrToken}`, { redirect: 'manual' });
      expect(routed.status).toBe(302);
      expect(routed.headers.get('Location') ?? '').not.toContain(c.eventId);
      const limited = await handleQrScan(scanReq(c.qrToken), scanEnv(), c.qrToken, false);
      expect(limited.headers.get('Location')).toBe('/');
    });
  }
});

describe('5. the written exception: an archived, listed event keeps its recap sponsors', () => {
  const RECAP = NOT_LIVE.find((c) => c.status === 'archived' && c.listed === 1)!;

  test('the recap page names the sponsor, and asks for no art it would not get', async () => {
    const res = await get(`/events/${RECAP.eventId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(RECAP.name);
    // The logo route is live-only (section 3), so the recap shows the name.
    expect(html).not.toContain(`/api/v2/sponsors/${RECAP.sponsorId}/logo`);
  });

  test('live control: the live page shows the sponsor as its wide logo', async () => {
    const html = await (await get(`/events/${LIVE.eventId}`)).text();
    // The banner uses the wide logo (top banner), served at the default slot.
    expect(html).toContain(`src="/api/v2/sponsors/${LIVE.sponsorId}/logo"`);
  });

  test('an archived event that was never listed has no recap to show', async () => {
    const unlisted = NOT_LIVE.find((c) => c.status === 'archived' && c.listed === 0)!;
    const html = await (await get(`/events/${unlisted.eventId}`)).text();
    expect(html).not.toContain(unlisted.name);
  });
});

describe('6. the written exception: an archived event’s SharedReport opens with a valid link', () => {
  test('a signed link to an archived event’s report answers 200', async () => {
    const archived = NOT_LIVE.find((c) => c.status === 'archived' && c.listed === 1)!;
    const token = await mintSignedLinkToken(
      { SHARED_REPORT_SIGNING_SECRET: tenv.SHARED_REPORT_SIGNING_SECRET },
      archived.eventId,
      'bar_owner'
    );
    expect(token).toBeTruthy();
    const res = await get(`/api/v2/events/${archived.eventId}/shared-report`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const bad = await get(`/api/v2/events/${archived.eventId}/shared-report`, {
      headers: { Authorization: 'Bearer not-a-token' },
    });
    expect(bad.status).not.toBe(200);
  });
});
