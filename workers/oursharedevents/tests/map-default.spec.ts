/**
 * OSE-1560 — the map defaults to off, and a sponsor the organizer adds flips it on.
 *
 * PO decisions (2026-10-03):
 *   - A new event is OFF the map unless the organizer says otherwise. Nothing is
 *     listed publicly by omission (the default-on map was the risk: a home
 *     event listed by someone not choosing).
 *   - When the ORGANIZER adds or approves a sponsor, the map setting turns on,
 *     but only if the organizer has not chosen the map value themselves. A
 *     sponsor's own request never changes it. The publish grace window still
 *     applies before the event is publicly listed.
 *
 * "Has the organizer chosen?" is a server-managed marker in events.settings_json
 * (`mapDefault: true`): written when an event is created with no map choice,
 * removed by any explicit map write. A row with no marker (every event that
 * existed before this change, and every event whose organizer chose) is never
 * flipped, so an organizer's earlier "off" is safe.
 *
 * Runtime-bound (SELF.fetch, env.DB, real routes) → workers pool.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleAdminCreateSponsor } from '../src/handlers/sponsors';
import { handleAdminAnswerSponsorRequest } from '../src/handlers/sponsor-home';
import { mintSponsorHomeToken } from '../src/lib/sponsor-home-auth';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  SHARED_REPORT_SIGNING_SECRET: string;
}
const E = env as unknown as TestEnv & Record<string, string>;
const ADMIN = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
};
const BRAND = 'root';

const OFF_NOTE = "This event isn't on the map. You can turn that on any time.";
const ON_NOTE = 'This event is now on the map because it has a sponsor.';

beforeAll(async () => {
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await E.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
});

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(method: string, path: string, body?: unknown) {
  const res = await SELF.fetch(`https://localhost${path}`, {
    method,
    headers: ADMIN,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as J };
}

let typeId = '';
async function eventType(): Promise<string> {
  if (!typeId) {
    const t = await E.DB.prepare('SELECT id FROM event_type_registry LIMIT 1').first<{
      id: string;
    }>();
    typeId = t!.id;
  }
  return typeId;
}

/** A create body that already has its core values, so it can walk the lifecycle. */
async function core(title: string, extra: J = {}): Promise<J> {
  return {
    title,
    start_date: '2027-06-01',
    start_time: '18:00',
    timezone: 'America/Chicago',
    event_type_id: await eventType(),
    ...extra,
  };
}

async function row(id: string) {
  return E.DB.prepare(
    'SELECT status, is_published, settings_json, listed_from, qr_verified FROM events WHERE id = ?'
  )
    .bind(id)
    .first<{
      status: string;
      is_published: number;
      settings_json: string;
      listed_from: string | null;
      qr_verified: number;
    }>();
}

async function inPublicList(id: string): Promise<boolean> {
  const res = await SELF.fetch(`https://localhost/api/v2/events?brand=${BRAND}`);
  const body = (await res.json()) as { items: { id: string }[] };
  return body.items.some((e) => e.id === id);
}

let n = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${n++}`;

async function newEvent(extra: J = {}): Promise<string> {
  const c = await api('POST', '/api/v2/admin/events', await core(uid('Map default'), extra));
  expect(c.status).toBe(201);
  return c.body.id as string;
}

async function addSponsor(eventId: string, name = uid('Sponsor')) {
  return api('POST', '/api/v2/admin/sponsors', { name, tier: 'primary', event_id: eventId });
}

async function flipAudits(eventId: string) {
  const r = await E.DB.prepare(
    `SELECT actor, details, brand_id FROM admin_audit_log
      WHERE action = 'MAP_ON_BY_SPONSOR' AND resource_type = 'event' AND resource_id = ?`
  )
    .bind(eventId)
    .all<{ actor: string | null; details: string | null; brand_id: string | null }>();
  return r.results ?? [];
}

// ─── The default ──────────────────────────────────────────────────────────────

describe('a new event is off the map unless the organizer says so', () => {
  test('no map choice: stored off, and the response says so in the heads-up words', async () => {
    const c = await api('POST', '/api/v2/admin/events', { title: uid('Bare') });
    expect(c.status).toBe(201);
    expect((await row(c.body.id)).is_published).toBe(0);
    expect(c.body.map).toEqual({ on: false, by_default: true, note: OFF_NOTE });
  });

  test('an explicit choice is honoured, and no default heads-up is attached', async () => {
    const on = await api('POST', '/api/v2/admin/events', { title: uid('On'), is_published: true });
    expect((await row(on.body.id)).is_published).toBe(1);
    expect(on.body.map).toEqual({ on: true, by_default: false, note: null });

    const off = await api('POST', '/api/v2/admin/events', {
      title: uid('Off'),
      is_published: false,
    });
    expect((await row(off.body.id)).is_published).toBe(0);
    expect(off.body.map).toEqual({ on: false, by_default: false, note: null });
  });

  test('a malformed map value fails toward off, never on', async () => {
    for (const bad of ['yes', 'true', 2, {}, []]) {
      const c = await api('POST', '/api/v2/admin/events', { title: uid('Bad'), is_published: bad });
      expect(c.status).toBe(201);
      expect((await row(c.body.id)).is_published, JSON.stringify(bad)).toBe(0);
    }
  });

  test('stays off through every lifecycle write, and is never publicly listed', async () => {
    const id = await newEvent();
    const steps: Array<[string, () => Promise<{ status: number }>]> = [
      ['PUT status ready', () => api('PUT', `/api/v2/admin/events/${id}`, { status: 'ready' })],
      ['verify-qr (go live)', () => api('POST', `/api/v2/admin/events/${id}/verify-qr`)],
      [
        'PUT other field while live',
        () => api('PUT', `/api/v2/admin/events/${id}`, { description: 'x' }),
      ],
      [
        'PUT status archived',
        () => api('PUT', `/api/v2/admin/events/${id}`, { status: 'archived' }),
      ],
      [
        'PUT status active (go live again)',
        () => api('PUT', `/api/v2/admin/events/${id}`, { status: 'active' }),
      ],
      ['unverify-qr', () => api('POST', `/api/v2/admin/events/${id}/unverify-qr`)],
      ['PUT status draft', () => api('PUT', `/api/v2/admin/events/${id}`, { status: 'draft' })],
    ];
    for (const [label, run] of steps) {
      const r = await run();
      expect(r.status, label).toBe(200);
      const after = await row(id);
      expect(after.is_published, `${label}: still off the map`).toBe(0);
      expect(await inPublicList(id), `${label}: not in the public list`).toBe(false);
    }
    // The one that goes live and stays: confirm it is live yet unlisted.
    await api('PUT', `/api/v2/admin/events/${id}`, { status: 'ready' });
    await api('POST', `/api/v2/admin/events/${id}/verify-qr`);
    expect((await row(id)).status).toBe('active');
    expect(await inPublicList(id)).toBe(false);
  });

  test('the marker is server-managed: a client cannot write it', async () => {
    const c = await api('POST', '/api/v2/admin/events', {
      title: uid('Forge'),
      settings: { mapDefault: false },
    });
    expect(c.status).toBe(400);
    expect(c.body.code).toBe('INVALID_SETTINGS');

    const id = await newEvent();
    const p = await api('PUT', `/api/v2/admin/events/${id}`, { settings: { mapDefault: false } });
    expect(p.status).toBe(400);
    expect(p.body.code).toBe('INVALID_SETTINGS');
    expect(JSON.parse((await row(id)).settings_json).mapDefault).toBe(true);
  });

  test('the admin list says whether the map is still at its default', async () => {
    const id = await newEvent();
    const list = await api('GET', '/api/v2/admin/events?limit=100');
    const item = (list.body.items as J[]).find((e) => e.id === id)!;
    expect(item.is_published).toBe(0);
    expect(item.map_default).toBe(1);
    // The raw settings blob (and its marker) is not handed out here.
    expect(item.settings_json).toBeUndefined();
  });

  test('turning the map on or off is the organizer choosing: the default marker goes', async () => {
    const id = await newEvent();
    const on = await api('PUT', `/api/v2/admin/events/${id}`, { is_published: true });
    expect(on.status).toBe(200);
    expect(on.body.map).toEqual({ on: true, by_default: false, note: null });
    let r = await row(id);
    expect(r.is_published).toBe(1);
    expect(JSON.parse(r.settings_json).mapDefault).toBeUndefined();

    const off = await api('PUT', `/api/v2/admin/events/${id}`, { is_published: false });
    expect(off.body.map.on).toBe(false);
    r = await row(id);
    expect(r.is_published).toBe(0);
    expect(JSON.parse(r.settings_json).mapDefault).toBeUndefined();
  });

  test('one PUT may carry settings and the map choice together; both land', async () => {
    const id = await newEvent();
    const p = await api('PUT', `/api/v2/admin/events/${id}`, {
      is_published: true,
      settings: { showQRSection: false },
    });
    expect(p.status).toBe(200);
    const r = await row(id);
    const s = JSON.parse(r.settings_json);
    expect(r.is_published).toBe(1);
    expect(s.showQRSection).toBe(false);
    expect(s.mapDefault).toBeUndefined();
  });

  test('a PUT that does not mention the map leaves the marker alone', async () => {
    const id = await newEvent();
    await api('PUT', `/api/v2/admin/events/${id}`, { description: 'hello' });
    await api('PUT', `/api/v2/admin/events/${id}`, { settings: { showQRSection: false } });
    expect(JSON.parse((await row(id)).settings_json).mapDefault).toBe(true);
  });
});

// ─── The sponsor flip ─────────────────────────────────────────────────────────

describe('the organizer adding a sponsor turns the default map on', () => {
  test('add at create: on, says so, audited, brand-attributed', async () => {
    const id = await newEvent();
    const s = await addSponsor(id);
    expect(s.status).toBe(201);
    expect(s.body.map).toEqual({ changed: true, on: true, reason: 'sponsor', note: ON_NOTE });
    const r = await row(id);
    expect(r.is_published).toBe(1);
    expect(JSON.parse(r.settings_json).mapDefault).toBeUndefined();

    const audits = await flipAudits(id);
    expect(audits).toHaveLength(1);
    expect(audits[0].brand_id).toBe(BRAND);
    expect(audits[0].actor).toBe('key:admin');
    expect(JSON.parse(audits[0].details!).via).toBe('organizer_add');
  });

  test('attaching a pool sponsor later flips it too', async () => {
    const id = await newEvent();
    const pool = await api('POST', '/api/v2/admin/sponsors', {
      name: uid('Pool'),
      tier: 'primary',
    });
    expect(pool.status).toBe(201);
    expect(pool.body.map).toBeUndefined();
    expect((await row(id)).is_published).toBe(0);

    const att = await api('PUT', `/api/v2/admin/sponsors/${pool.body.id}`, { event_id: id });
    expect(att.status).toBe(200);
    expect(att.body.map).toEqual({ changed: true, on: true, reason: 'sponsor', note: ON_NOTE });
    expect((await row(id)).is_published).toBe(1);
    expect((await flipAudits(id)).map((a) => JSON.parse(a.details!).via)).toEqual([
      'organizer_add',
    ]);
  });

  test("never overrides the organizer's own off: chosen at create", async () => {
    const id = await newEvent({ is_published: false });
    const s = await addSponsor(id);
    expect(s.status).toBe(201);
    expect(s.body.map).toBeUndefined();
    expect((await row(id)).is_published).toBe(0);
    expect(await flipAudits(id)).toHaveLength(0);
  });

  test("never overrides the organizer's own off: chosen after the default", async () => {
    const id = await newEvent();
    await api('PUT', `/api/v2/admin/events/${id}`, { is_published: false });
    const s = await addSponsor(id);
    expect(s.body.map).toBeUndefined();
    expect((await row(id)).is_published).toBe(0);
  });

  test('an event that existed before this change (off, no marker) is never flipped', async () => {
    const id = uid('legacy');
    await E.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published) VALUES (?, ?, 'Legacy', ?, 'draft', 0)`
    )
      .bind(id, BRAND, id)
      .run();
    const s = await addSponsor(id);
    expect(s.status).toBe(201);
    expect(s.body.map).toBeUndefined();
    expect((await row(id)).is_published).toBe(0);
  });

  test('an event already on is untouched, with no flip audit', async () => {
    const id = await newEvent({ is_published: true });
    const s = await addSponsor(id);
    expect(s.body.map).toBeUndefined();
    expect((await row(id)).is_published).toBe(1);
    expect(await flipAudits(id)).toHaveLength(0);
  });

  test('removing the last sponsor does not turn the map back off', async () => {
    const id = await newEvent();
    const s = await addSponsor(id);
    expect((await row(id)).is_published).toBe(1);
    const del = await api('DELETE', `/api/v2/admin/sponsors/${s.body.id}`);
    expect(del.status).toBe(200);
    expect((await row(id)).is_published).toBe(1);
  });

  test('once the organizer turns it off after the flip, a second sponsor leaves it off', async () => {
    const id = await newEvent();
    await addSponsor(id);
    await api('PUT', `/api/v2/admin/events/${id}`, { is_published: false });
    const second = await addSponsor(id);
    expect(second.body.map).toBeUndefined();
    expect((await row(id)).is_published).toBe(0);
  });

  test("a sponsor in another brand never flips this brand's event", async () => {
    // Not reachable through the API (cross-brand attach is refused); prove the
    // flip itself is brand-bound by driving it with a mismatched sponsor row.
    const id = await newEvent();
    const foreign = uid('foreign-sp');
    await E.DB.batch([
      E.DB.prepare(
        `INSERT INTO sponsor_business (id, brand_id, name, tier) VALUES (?, 'someone-else', 'F', 'primary')`
      ).bind(foreign),
      E.DB.prepare(
        `INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active)
         VALUES (?, ?, ?, 'primary', 'organizer', 1)`
      ).bind(uid('spl'), foreign, id),
    ]);
    const { mapFlipStatement } = await import('../src/lib/map-default');
    const res = await mapFlipStatement(E.DB, {
      eventId: id,
      sponsorId: foreign,
      graceMinutes: '0',
    }).run();
    expect(res.meta.changes).toBe(0);
    expect((await row(id)).is_published).toBe(0);
  });
});

describe('a sponsor asking never changes the map; the organizer approving does', () => {
  async function seedRequestable(opts: { marker: boolean; published: number }) {
    const eventId = uid('req-ev');
    const sponsorId = uid('req-sp');
    // OSE-1900: a sponsor can ask only an event that chose to have sponsors, so
    // the event has. What is under test here is the map and its marker.
    const settings = opts.marker
      ? '{"mapDefault":true,"useSponsors":true}'
      : '{"useSponsors":true}';
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await E.DB.batch([
      E.DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, start_date, is_published, settings_json, listed_from)
         VALUES (?, ?, 'Req', ?, 'active', ?, 1, ?, NULL)`
      ).bind(eventId, BRAND, eventId, future, settings),
      E.DB.prepare(
        `INSERT INTO sponsor_business (id, brand_id, name, tier) VALUES (?, ?, 'Asker', 'primary')`
      ).bind(sponsorId, BRAND),
    ]);
    const token = (await mintSponsorHomeToken(E, sponsorId, BRAND))!.token;
    const ask = await SELF.fetch('https://localhost/api/v2/sponsor/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, event_id: eventId }),
    });
    expect(ask.status).toBe(201);
    const askBody = (await ask.json()) as J;
    // The request is made on a published event (that is the only kind it can
    // target). Now put the event in the state under test.
    await E.DB.prepare('UPDATE events SET is_published = ? WHERE id = ?')
      .bind(opts.published, eventId)
      .run();
    return { eventId, sponsorId, placementId: askBody.id as string };
  }

  test('the request alone changes nothing about the map or its marker', async () => {
    const { eventId } = await seedRequestable({ marker: true, published: 1 });
    const r = await row(eventId);
    expect(r.is_published).toBe(1);
    expect(JSON.parse(r.settings_json).mapDefault).toBe(true);
    expect(await flipAudits(eventId)).toHaveLength(0);
  });

  test('a request cannot target an event that is off the map (so it cannot be a way on)', async () => {
    const eventId = uid('req-off');
    const sponsorId = uid('req-sp');
    await E.DB.batch([
      E.DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, start_date, is_published, settings_json)
         VALUES (?, ?, 'Off', ?, 'active', date('now','+10 day'), 0, '{"mapDefault":true,"useSponsors":true}')`
      ).bind(eventId, BRAND, eventId),
      E.DB.prepare(
        `INSERT INTO sponsor_business (id, brand_id, name, tier) VALUES (?, ?, 'Asker', 'primary')`
      ).bind(sponsorId, BRAND),
    ]);
    const token = (await mintSponsorHomeToken(E, sponsorId, BRAND))!.token;
    const ask = await SELF.fetch('https://localhost/api/v2/sponsor/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, event_id: eventId }),
    });
    expect(ask.status).toBe(404);
    expect((await row(eventId)).is_published).toBe(0);
  });

  test('approving flips an event still at its default; declining does not', async () => {
    const a = await seedRequestable({ marker: true, published: 0 });
    const declined = await api('POST', `/api/v2/admin/sponsor-requests/${a.placementId}/respond`, {
      approve: false,
    });
    expect(declined.status).toBe(200);
    expect(declined.body.map).toBeUndefined();
    expect((await row(a.eventId)).is_published).toBe(0);

    // The organizer may change their mind: approve after a decline.
    const approved = await api('POST', `/api/v2/admin/sponsor-requests/${a.placementId}/respond`, {
      approve: true,
    });
    expect(approved.status).toBe(200);
    expect(approved.body.map).toEqual({
      changed: true,
      on: true,
      reason: 'sponsor',
      note: ON_NOTE,
    });
    expect((await row(a.eventId)).is_published).toBe(1);
    const audits = await flipAudits(a.eventId);
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0].details!).via).toBe('request_approved');
  });

  test("approving never overrides an organizer's own off (no marker)", async () => {
    const a = await seedRequestable({ marker: false, published: 0 });
    const approved = await api('POST', `/api/v2/admin/sponsor-requests/${a.placementId}/respond`, {
      approve: true,
    });
    expect(approved.status).toBe(200);
    expect(approved.body.map).toBeUndefined();
    expect((await row(a.eventId)).is_published).toBe(0);
  });

  test('the handler is reachable without the router too (same answer)', async () => {
    const a = await seedRequestable({ marker: true, published: 0 });
    const res = await handleAdminAnswerSponsorRequest(
      new Request(`https://localhost/x`, {
        method: 'POST',
        headers: ADMIN,
        body: JSON.stringify({ approve: true }),
      }),
      E as never,
      a.placementId
    );
    expect(res.status).toBe(200);
    expect((await row(a.eventId)).is_published).toBe(1);
  });
});

// ─── Dr of Security: listing, grace, coordinates ──────────────────────────────

describe('the flip is not a way around the listing delay or the cell-only rule', () => {
  const withGrace = (m: string) => ({ ...E, PUBLISH_GRACE_MINUTES: m }) as never;

  async function liveDefaultOff(): Promise<string> {
    const id = uid('live-default');
    await E.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, qr_verified, is_published, settings_json,
                           start_date, listed_from, lat, lon, h3_res9, h3_res7)
       VALUES (?, ?, 'Live', ?, 'active', 1, 0, '{"mapDefault":true}', date('now','+5 day'),
               ?, 41.69, -87.68, '892664544cbffff', '872664544ffffff')`
    )
      .bind(id, BRAND, id, new Date(Date.now() - 3_600_000).toISOString())
      .run();
    return id;
  }

  function createSponsorWithGrace(eventId: string, minutes: string) {
    return handleAdminCreateSponsor(
      new Request('https://localhost/api/v2/admin/sponsors', {
        method: 'POST',
        headers: ADMIN,
        body: JSON.stringify({ name: uid('G'), tier: 'primary', event_id: eventId }),
      }),
      withGrace(minutes)
    );
  }

  test('on a live event the flip starts the grace window: not listed until it ends', async () => {
    const id = await liveDefaultOff();
    const res = await createSponsorWithGrace(id, '10');
    expect(res.status).toBe(201);
    const r = await row(id);
    expect(r.is_published).toBe(1);
    expect(new Date(r.listed_from!).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(await inPublicList(id)).toBe(false);

    // Window over → it lists itself; nothing has to run.
    await E.DB.prepare('UPDATE events SET listed_from = ? WHERE id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), id)
      .run();
    expect(await inPublicList(id)).toBe(true);
  });

  test('nothing is public before the organizer adds: the default-off live event is unlisted', async () => {
    const id = await liveDefaultOff();
    expect(await inPublicList(id)).toBe(false);
  });

  test('the flip and its audit carry no coordinates', async () => {
    const id = await liveDefaultOff();
    const res = await createSponsorWithGrace(id, '0');
    const text = JSON.stringify(await res.json());
    for (const bad of ['41.69', '-87.68', '892664544cbffff', 'h3_res9', '"lat"', '"lon"']) {
      expect(text, `response must not contain ${bad}`).not.toContain(bad);
    }
    for (const a of await flipAudits(id)) {
      const d = a.details ?? '';
      for (const bad of ['41.69', '-87.68', '892664544cbffff', 'lat', 'lon', 'h3']) {
        expect(d, `audit details must not contain ${bad}`).not.toContain(bad);
      }
    }
    // Once its window is over the event is on the map. The map is the event's
    // own public pin (OSE-1242, the organizer's venue, not an attendee); the
    // flip adds nothing to it, and the finer res-9 cell is still never emitted.
    await E.DB.prepare('UPDATE events SET listed_from = ? WHERE id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), id)
      .run();
    const mapRes = await SELF.fetch(
      'https://localhost/api/v2/events/map?cell=872664544ffffff&brand=root'
    );
    expect(mapRes.status).toBe(200);
    const mapText = JSON.stringify(await mapRes.json());
    expect(mapText).toContain(id);
    for (const bad of ['892664544cbffff', 'h3_res9']) {
      expect(mapText, `map must not contain ${bad}`).not.toContain(bad);
    }
  });

  test('the flip with no place to map: the setting is on, the event stays unmapped (no cell)', async () => {
    const id = await newEvent();
    const s = await addSponsor(id);
    expect(s.body.map.changed).toBe(true);
    const r = await E.DB.prepare('SELECT is_published, h3_res7, lat, lon FROM events WHERE id = ?')
      .bind(id)
      .first<{
        is_published: number;
        h3_res7: string | null;
        lat: number | null;
        lon: number | null;
      }>();
    expect(r!.is_published).toBe(1);
    expect(r!.h3_res7).toBeNull();
    expect(r!.lat).toBeNull();
    expect(r!.lon).toBeNull();
  });
});
