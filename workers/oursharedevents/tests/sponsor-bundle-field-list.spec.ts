/**
 * OSE-2048: the public sponsor bundle sends a named field list (workers pool).
 *
 *   GET /api/v2/events/:id/sponsor-bundle?surface=public|display|poster
 *
 * The lists below are written out by hand ON PURPOSE. They are not imported
 * from src/lib/public-sponsor-projection.ts: a field added to, or taken off,
 * the answer must fail here until someone changes this file too.
 *
 * What is held:
 *   1. the answer, the bundle, `surface_sponsors` and `rotation_config` each
 *      carry exactly their named keys;
 *   2. every sponsor in every list carries exactly the named keys;
 *   3. a sponsor's `campaign` is `{ id, title }` and nothing else;
 *   4. a field that is not on the list never leaves, whether it comes from the
 *      resolver's row, the mock fixture or the bundle;
 *   5. the list in src is the list in this file.
 *
 * A sponsor's `beacon_token` holds an expiry in whole seconds, so it is checked
 * by type only and is never part of a compared value.
 *
 * Staging twin: bruno/ose-api/18. Campaigns (S14), request 29.
 *
 * @born-red OSE-2048 | method: this file was run before the handler used the
 * projection, and "a column the read adds" failed (the probe column was in
 * every sponsor of the answer); the other cases passed, which is the evidence
 * that the list is the shape the answer already had. Then, with the handler
 * changed, each fault was put in src, this file was run, the named cases
 * failed, and the fault was removed: (a) the handler sending `bundle` again in
 * place of `toPublicSponsorBundle(bundle)`: "a column the read adds" failed;
 * (b) `'brand_id'` added to the list in src: "a field that is not on the
 * list", "a bundle keeps its lists" and "the list in src" failed; (c) `'title'`
 * taken off the list: "a live sponsor", "every list", "a column the read adds"
 * and "the list in src" failed; (d) the campaign sent whole in place of its two
 * picked fields: "a campaign carries" failed; (e) `debug: true` added beside
 * `bundle` in the handler's answer: "the answer and the bundle" and "a
 * mock-mode answer" failed; (f) `rotation_config` sent whole, and (g) every
 * key of `surface_sponsors` kept: "a bundle keeps its lists" failed each time.
 * The Bruno twin was run on a local worker (a test rig, not staging) with
 * fault (a) plus `sb.brand_id AS brand_id` added to the resolver's SELECT: its
 * three sponsor-field tests failed, 3 of 363 in the folder | date: 2026-11-18
 *
 * What this does not prove: that staging answers this way (the Bruno twin does,
 * once it has run there), and anything about the poster bundle's `sponsors`,
 * which carries the same resolver rows and has no list of its own.
 */

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import { handleGetSponsorBundle } from '../src/handlers/sponsors';
import {
  PUBLIC_SPONSOR_BUNDLE_FIELDS,
  PUBLIC_SPONSOR_CAMPAIGN_FIELDS,
  PUBLIC_SPONSOR_FIELDS,
  PUBLIC_SPONSOR_REQUIRED_FIELDS,
  PUBLIC_SPONSOR_ROTATION_FIELDS,
  PUBLIC_SPONSOR_SURFACE_FIELDS,
  toPublicSponsor,
  toPublicSponsorBundle,
} from '../src/lib/public-sponsor-projection';
import type { SponsorBundle, SponsorRow } from '../src/lib/sponsor-resolver';
import { applyMigrations } from './helpers/brand-matrix';
import { seedSplitSponsor } from './helpers/seed-sponsor';

// ── The lists, by hand ───────────────────────────────────────────────────────

const ANSWER_KEYS = ['bundle', 'ok', 'status'];
const BUNDLE_KEYS = ['rotation_config', 'sponsors', 'surface_sponsors'];
const SURFACE_KEYS = ['mobileBanner', 'posterTop', 'tvSide', 'tvTop'];
const ROTATION_KEYS = ['rotationMs', 'sponsorSlots'];
const CAMPAIGN_KEYS = ['id', 'title'];

/** A live sponsor on show, with no campaign. */
const LIVE_SPONSOR_KEYS = [
  'address_line',
  'beacon_token',
  'card_url',
  'click_token',
  'created_at',
  'display_name',
  'display_token',
  'event_id',
  'has_header_image',
  'header_text',
  'id',
  'is_active',
  'is_local',
  'logo_url',
  'name',
  'placement_formats',
  'sidebar_logo_url',
  'tier',
  'title',
  'updated_at',
  'website_url',
];

const REQUIRED_KEYS = ['event_id', 'id', 'logo_url', 'name', 'tier', 'website_url'];

// ── Fixture ──────────────────────────────────────────────────────────────────

const EVT = 'sbf-evt';
const BRAND = 'sbf-brand';
const PLAIN = 'sbf-plain';
const FULL = 'sbf-full';
const CAMPAIGN = 'sbf-campaign';

type Sponsor = Record<string, unknown>;
interface Answer {
  ok: boolean;
  status: number;
  bundle: {
    sponsors: Sponsor[];
    surface_sponsors: Record<string, Sponsor[]>;
    rotation_config: Record<string, unknown>;
  };
}

const keys = (o: object) => Object.keys(o).sort();

async function read(surface: string | null): Promise<Answer> {
  const q = surface ? `?surface=${surface}` : '';
  const res = await SELF.fetch(`http://localhost/api/v2/events/${EVT}/sponsor-bundle${q}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Answer;
}

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare(
    `INSERT INTO events
       (id, brand_id, title, slug, status, is_published, data_class, start_date, settings_json)
     VALUES (?, ?, 'Field list event', 'sbf-evt', 'active', 1, 'synthetic', '2099-06-01',
             '{"useSponsors":true}')
     ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json`
  )
    .bind(EVT, BRAND)
    .run();
  await env.DB.prepare(
    `INSERT INTO campaigns (id, brand_id, title, status, created_at, updated_at)
     VALUES (?, ?, 'Field list season', 'active', '2026-01-01T00:00:00.000Z',
             '2026-01-01T00:00:00.000Z')
     ON CONFLICT(id) DO UPDATE SET status = excluded.status`
  )
    .bind(CAMPAIGN, BRAND)
    .run();
  await seedSplitSponsor(env.DB, { id: PLAIN, eventId: EVT, brandId: BRAND, name: 'Plain Co' });
  await seedSplitSponsor(env.DB, {
    id: FULL,
    eventId: EVT,
    brandId: BRAND,
    name: 'Full Co',
    websiteUrl: 'https://full.example',
    logoUrl: 'https://img.example/full.png',
    compactLogoUrl: 'https://img.example/full-compact.png',
    clickToken: 'click-full',
    displayToken: 'display-full',
    isLocal: 1,
    campaignId: CAMPAIGN,
  });
});

// ── The route ────────────────────────────────────────────────────────────────

describe('sponsor bundle: the answer is a named field list', () => {
  test('the answer and the bundle carry exactly their named keys', async () => {
    for (const surface of ['public', 'display', 'poster', null]) {
      const body = await read(surface);
      expect(keys(body)).toEqual(ANSWER_KEYS);
      expect(keys(body.bundle)).toEqual(BUNDLE_KEYS);
      expect(keys(body.bundle.surface_sponsors)).toEqual(SURFACE_KEYS);
      expect(keys(body.bundle.rotation_config)).toEqual(ROTATION_KEYS);
    }
  });

  test('a live sponsor carries exactly the named keys', async () => {
    const { sponsors } = (await read('public')).bundle;
    expect(sponsors.map((s) => s.id).sort()).toEqual([FULL, PLAIN]);

    const plain = sponsors.find((s) => s.id === PLAIN)!;
    expect(keys(plain)).toEqual(LIVE_SPONSOR_KEYS);

    const full = sponsors.find((s) => s.id === FULL)!;
    expect(keys(full)).toEqual([...LIVE_SPONSOR_KEYS, 'campaign'].sort());

    // Named values only. The token is checked by type: it holds an expiry.
    expect(typeof full.beacon_token).toBe('string');
    expect(full.title).toBe('Full Co');
    expect(full.website_url).toBe('https://full.example');
    expect(full.has_header_image).toBe(false);
  });

  test('every list holds sponsors with the same named keys', async () => {
    for (const surface of ['public', 'display', 'poster']) {
      const { surface_sponsors } = (await read(surface)).bundle;
      for (const name of SURFACE_KEYS) {
        const list = surface_sponsors[name]!;
        expect(list.length, `${surface} ${name}`).toBeGreaterThan(0);
        for (const s of list) {
          const want =
            s.id === FULL ? [...LIVE_SPONSOR_KEYS, 'campaign'].sort() : LIVE_SPONSOR_KEYS;
          expect(keys(s), `${surface} ${name} ${String(s.id)}`).toEqual(want);
        }
      }
    }
  });

  test('a campaign carries its id and its title, nothing else', async () => {
    const full = (await read('public')).bundle.sponsors.find((s) => s.id === FULL)!;
    expect(keys(full.campaign as object)).toEqual(CAMPAIGN_KEYS);
    expect(full.campaign).toEqual({ id: CAMPAIGN, title: 'Field list season' });

    // The projection itself: a campaign object with more on it loses the rest.
    const out = toPublicSponsor({
      id: 's',
      campaign: { id: 'c', title: 't', brand_id: 'b', status: 'active' },
    });
    expect(out.campaign).toEqual({ id: 'c', title: 't' });
    expect(toPublicSponsor({ id: 's', campaign: 'not-an-object' })).toEqual({ id: 's' });
  });

  test('a column the read adds never reaches the answer', async () => {
    // The same database, with one more column on every row any read returns.
    // That is what a SELECT changed for an internal reason looks like.
    const leaky = (stmt: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(stmt, {
        get(target, prop) {
          if (prop === 'bind') return (...a: unknown[]) => leaky(target.bind(...a));
          if (prop === 'all') {
            return async () => {
              const r = await target.all<Record<string, unknown>>();
              return { ...r, results: r.results.map((x) => ({ ...x, leak_probe: 'LEAK-PROBE' })) };
            };
          }
          const v = Reflect.get(target, prop) as unknown;
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    const db = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === 'prepare') return (sql: string) => leaky(target.prepare(sql));
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });

    const res = await handleGetSponsorBundle(
      new Request(`http://localhost/api/v2/events/${EVT}/sponsor-bundle?surface=public`),
      { ...env, DB: db } as unknown as Parameters<typeof handleGetSponsorBundle>[1],
      EVT
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Data-Source')).toBe('live');
    const raw = await res.text();
    const body = JSON.parse(raw) as Answer;
    expect(body.bundle.sponsors.map((s) => s.id).sort()).toEqual([FULL, PLAIN]);
    // A yes or no, so a failure does not print the whole answer.
    expect(raw.includes('leak_probe')).toBe(false);
    expect(raw.includes('LEAK-PROBE')).toBe(false);
    expect(keys(body.bundle.sponsors.find((s) => s.id === PLAIN)!)).toEqual(LIVE_SPONSOR_KEYS);
  });

  test('a mock-mode answer carries the same named keys', async () => {
    // No DB binding is mock mode. Today the mock bundle holds no sponsor (the
    // fixture has no is_active, so the rotation drops every row); if it ever
    // holds one, that sponsor stays inside the list like any other.
    const res = await handleGetSponsorBundle(
      new Request('http://localhost/api/v2/events/evt_mock/sponsor-bundle?surface=public'),
      {
        SHARED_REPORT_SIGNING_SECRET: 'test-shared-report-signing-secret-do-not-use',
      } as unknown as Parameters<typeof handleGetSponsorBundle>[1],
      'evt_mock'
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Data-Source')).toBe('mock');
    const body = (await res.json()) as Answer;
    expect(keys(body)).toEqual(ANSWER_KEYS);
    expect(keys(body.bundle)).toEqual(BUNDLE_KEYS);
    expect(keys(body.bundle.surface_sponsors)).toEqual(SURFACE_KEYS);
    const allowed = [...LIVE_SPONSOR_KEYS, 'campaign'];
    for (const s of body.bundle.sponsors) for (const k of keys(s)) expect(allowed).toContain(k);
  });
});

// ── The projection ───────────────────────────────────────────────────────────

describe('sponsor bundle: the projection', () => {
  const row = (id: string, extra: Record<string, unknown> = {}): SponsorRow =>
    ({
      id,
      event_id: 'e',
      name: `Name ${id}`,
      logo_url: null,
      website_url: null,
      tier: 'primary',
      placement_formats: '[]',
      click_token: null,
      display_token: null,
      is_active: 1,
      is_local: 0,
      created_at: '',
      updated_at: '',
      ...extra,
    }) as SponsorRow;

  test('a field that is not on the list never leaves', () => {
    const out = toPublicSponsor(
      row('a', {
        brand_id: 'brand-x',
        has_card: 1,
        contact_email: 'someone@example.test',
        header_image_url: 'https://img.example/h.png',
        h3_res7: '872664c1affffff',
        display_order: 3,
        title: undefined,
      })
    );
    expect(keys(out)).toEqual(
      [
        'click_token',
        'created_at',
        'display_token',
        'is_active',
        'is_local',
        'placement_formats',
        'updated_at',
        ...REQUIRED_KEYS,
      ].sort()
    );
    for (const k of keys(out)) expect(PUBLIC_SPONSOR_FIELDS).toContain(k);
  });

  test('a bundle keeps its lists and their order, and drops what is not named', () => {
    const a = row('a');
    const b = row('b', { brand_id: 'brand-x' });
    const bundle = {
      sponsors: [a, b],
      surface_sponsors: { posterTop: [b, a], tvTop: [a, b], tvSide: [a, b, a], mobileBanner: [a] },
      rotation_config: { sponsorSlots: 3, rotationMs: 5000, internal: true },
      debug: 'x',
    } as unknown as SponsorBundle;
    (bundle.surface_sponsors as Record<string, unknown>).extraSurface = [a];

    const out = toPublicSponsorBundle(bundle);
    expect(keys(out)).toEqual(BUNDLE_KEYS);
    expect(keys(out.surface_sponsors)).toEqual(SURFACE_KEYS);
    expect(out.rotation_config).toEqual({ sponsorSlots: 3, rotationMs: 5000 });
    expect(out.sponsors.map((s) => s.id)).toEqual(['a', 'b']);
    expect((out.surface_sponsors.posterTop as Sponsor[]).map((s) => s.id)).toEqual(['b', 'a']);
    expect((out.surface_sponsors.tvSide as Sponsor[]).map((s) => s.id)).toEqual(['a', 'b', 'a']);
    expect(JSON.stringify(out).includes('brand-x')).toBe(false);
    // The rows handed in are not changed.
    expect((b as unknown as Record<string, unknown>).brand_id).toBe('brand-x');
  });

  test('the list in src is the list in this file', () => {
    expect([...PUBLIC_SPONSOR_FIELDS].sort()).toEqual([...LIVE_SPONSOR_KEYS, 'campaign'].sort());
    expect([...PUBLIC_SPONSOR_REQUIRED_FIELDS].sort()).toEqual(REQUIRED_KEYS);
    expect([...PUBLIC_SPONSOR_CAMPAIGN_FIELDS].sort()).toEqual(CAMPAIGN_KEYS);
    expect([...PUBLIC_SPONSOR_BUNDLE_FIELDS].sort()).toEqual(BUNDLE_KEYS);
    expect([...PUBLIC_SPONSOR_SURFACE_FIELDS].sort()).toEqual(SURFACE_KEYS);
    expect([...PUBLIC_SPONSOR_ROTATION_FIELDS].sort()).toEqual(ROTATION_KEYS);
    expect(new Set(PUBLIC_SPONSOR_FIELDS).size).toBe(PUBLIC_SPONSOR_FIELDS.length);
  });
});
