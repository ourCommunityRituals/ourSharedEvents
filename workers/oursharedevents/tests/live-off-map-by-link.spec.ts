/**
 * A live event's page opens by link while it is off the map (PO decision, 2026-10-07).
 *
 * "Off the map" (`events.is_published = 0`, the default for every new event)
 * means not listed. It does not mean hidden. For a LIVE event (status `active`):
 *
 *   - every surface someone reaches with a link they were given works exactly
 *     as it does for a listed live event: the event page, its short link and
 *     poster scan, the actions on the page, the calendar file, the venue image;
 *   - every surface where strangers find events on their own keeps leaving it
 *     out: the list, the map, the sitemap, sponsor discovery, "more at this
 *     venue". The same set the publish grace window uses (lib/publish-grace.ts).
 *
 * Draft and ready events stay closed to the public. Archived events are not
 * changed by this decision.
 *
 * Before this, `/events/:id` answered 404 for any event that was off the map,
 * so a live event's QR codes and short link landed on "We couldn't find that
 * event" (reported on staging for `pcard-live-evt`).
 *
 * Runtime-bound (SELF.fetch, env.DB, the real routes) → workers pool.
 */
import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { handleSitemapXml } from '../src/lib/crawl-policy';
import { readDiscoverableEvents } from '../src/lib/sponsor-discovery';
import { createShortlink } from '../src/lib/shortlinks';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv;
const ORIGIN = 'https://localhost';
const ADMIN = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
};
const BRAND = 'root';
// Blue Island corridor (res 7), as in the publish-grace spec.
const RES7 = '872664544ffffff';
// The 404 page's title, as served (the apostrophe is escaped in the HTML).
const NOT_FOUND_TITLE = 'We couldn&#39;t find that event';

async function applyAll(db: D1Database, statementsJson: string): Promise<void> {
  for (const stmt of JSON.parse(statementsJson) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column name') ||
        m.includes('already exists') ||
        m.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyAll(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await applyAll(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

let n = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${n++}`;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const longAgo = () => new Date(Date.now() - 86_400_000).toISOString();

type Status = 'draft' | 'ready' | 'active' | 'archived';
interface SeedOpts {
  published?: 0 | 1;
  /** Days from today. Default: starts in 5 days (so the page offers Register). */
  startsIn?: number;
  endsIn?: number;
  location?: string;
  /** null = never was live. Default: listed long ago for active/archived, null otherwise. */
  listedFrom?: string | null;
}

/**
 * One row, straight into D1, with the short link every event gets when it is
 * created (handlers/events.ts). Returns its id and title.
 */
async function seed(status: Status, opts: SeedOpts = {}) {
  const id = uid(`offmap-${status}`).replace(/[^a-zA-Z0-9_-]/g, '');
  const title = `Off map ${id}`;
  const listedFrom =
    opts.listedFrom !== undefined
      ? opts.listedFrom
      : status === 'active' || status === 'archived'
        ? longAgo()
        : null;
  await E.DB.prepare(
    // OSE-1900: every event here chose to have sponsors, so sponsor discovery
    // below turns on the map setting alone, which is what this spec is about.
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date,
                         location, h3_res7, listed_from, qr_verified, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{"useSponsors":true}', datetime('now'), datetime('now'))`
  )
    .bind(
      id,
      BRAND,
      title,
      id,
      status,
      opts.published ?? 0,
      inDays(opts.startsIn ?? 5),
      opts.endsIn === undefined ? null : inDays(opts.endsIn),
      opts.location ?? `Eagles Bowl ${id}, Sawyer MI`,
      RES7,
      listedFrom,
      status === 'active' ? 1 : 0
    )
    .run();
  await createShortlink(E, id);
  return { id, title };
}

async function putOnTheMap(id: string): Promise<void> {
  await E.DB.prepare('UPDATE events SET is_published = 1 WHERE id = ?').bind(id).run();
}

const get = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual', ...init });

async function admin(method: string, path: string, body?: unknown) {
  const res = await SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: ADMIN,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The path a redirect points at, on this origin. */
function pathOf(location: string | null): string {
  expect(location, 'the redirect names a destination').toBeTruthy();
  const u = new URL(location!, ORIGIN);
  expect(u.origin).toBe(ORIGIN);
  return u.pathname + u.search;
}

/** The venue image goes through route() so Google can be a stubbed fetch. */
function stubGoogle() {
  const f = vi.fn(
    async (_url: unknown) =>
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
  );
  vi.stubGlobal('fetch', f);
  return f;
}
async function venueImage(id: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test/api/v2/maps/venue-image?event=${id}`, {
      headers: { 'CF-Connecting-IP': '203.0.113.77' },
    }),
    {
      ...(env as unknown as RouterEnv),
      GOOGLE_MAPS_API_KEY: 'test-maps-key-off-map',
    } as unknown as RouterEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const sitemap = () =>
  handleSitemapXml(new Request(`${ORIGIN}/sitemap.xml`), {
    DB: E.DB,
    WORKER_ENV: 'production',
  }).then((r) => r.text());

// ═════════════════════════════════════════════════════════════════════════════
// Reached by a link someone was given
// ═════════════════════════════════════════════════════════════════════════════

describe('a live event that is off the map opens by link', () => {
  test('its page answers 200 with the real page, not "couldn\'t find"', async () => {
    const ev = await seed('active');
    const res = await get(`/events/${ev.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="event-title"');
    expect(html).toContain(ev.title);
    expect(html).not.toContain(NOT_FOUND_TITLE);
  });

  test('a new event published without a map choice: the short link on its poster lands on the page', async () => {
    // The whole path an organizer walks: create (no map choice), ready, publish.
    const type = await E.DB.prepare('SELECT id FROM event_type_registry LIMIT 1').first<{
      id: string;
    }>();
    const title = uid('Backyard bocce');
    const created = await admin('POST', '/api/v2/admin/events', {
      title,
      attendance_mode: 'in_person',
      start_date: inDays(5),
      start_time: '18:00',
      timezone: 'America/Chicago',
      event_type_id: type!.id,
      location: 'Eagles Bowl, Sawyer MI',
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect((await admin('PUT', `/api/v2/admin/events/${id}`, { status: 'ready' })).status).toBe(
      200
    );
    expect((await admin('POST', `/api/v2/admin/events/${id}/verify-qr`)).status).toBe(200);
    const row = await E.DB.prepare('SELECT status, is_published FROM events WHERE id = ?')
      .bind(id)
      .first<{ status: string; is_published: number }>();
    expect(row, 'live, and off the map because nobody chose').toEqual({
      status: 'active',
      is_published: 0,
    });

    // The poster's own first code is the event page's short link.
    const bundle = await get(`/api/v2/events/${id}/poster-bundle`);
    expect(bundle.status).toBe(200);
    const slots = ((await bundle.json()) as { slots: { url: string }[] }).slots;
    const shortPath = pathOf(slots[0].url);
    expect(shortPath).toMatch(/^\/s\/[0-9A-Za-z]{6}$/);

    const hop = await get(shortPath);
    expect(hop.status).toBe(302);
    const landing = pathOf(hop.headers.get('Location'));
    expect(landing).toBe(`/events/${id}`);
    const page = await get(landing);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(title);
    expect(html).not.toContain(NOT_FOUND_TITLE);
  });

  test('a poster scan (/q/) lands on the page', async () => {
    const ev = await seed('active');
    const token = `qrt_${ev.id}`;
    await E.DB.prepare(
      `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active, created_at)
       VALUES (?, ?, ?, 'Front window', 1, datetime('now'))`
    )
      .bind(`pd-${ev.id}`, ev.id, token)
      .run();

    const hop = await get(`/q/${token}`);
    expect(hop.status).toBe(302);
    const landing = pathOf(hop.headers.get('Location'));
    expect(landing.startsWith(`/events/${ev.id}?`)).toBe(true);
    const page = await get(landing);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(ev.title);
    expect(html).not.toContain(NOT_FOUND_TITLE);
  });

  test('before the event: the Register action on the page opens its form, and the form saves', async () => {
    const ev = await seed('active', { startsIn: 5 });
    const page = await get(`/events/${ev.id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    const href = html.match(new RegExp(`href="(/events/${ev.id}/register[^"]*)"`))?.[1];
    expect(href, 'the page offers Register').toBeTruthy();

    const form = await get(href!.replace(/&amp;/g, '&'));
    expect(form.status, 'the form opens; it is not sent back to /events').toBe(200);
    const formHtml = await form.text();
    expect(formHtml).toContain('data-testid="form-register"');
    expect(formHtml).toContain(ev.title);

    const saved = await get(`/api/v2/events/${ev.id}/forms/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Link Holder' }),
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { ok: boolean }).ok).toBe(true);
  });

  test('during the event: the Check in action on the page opens its form, and the check-in counts', async () => {
    const ev = await seed('active', { startsIn: -1, endsIn: 1 });
    const page = await get(`/events/${ev.id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('data-testid="event-title-live"');
    const href = html.match(new RegExp(`href="(/events/${ev.id}/checkin[^"]*)"`))?.[1];
    expect(href, 'the page offers Check in').toBeTruthy();

    const form = await get(href!.replace(/&amp;/g, '&'));
    expect(form.status).toBe(200);
    expect(await form.text()).toContain(ev.title);

    const tapped = await get(`/api/v2/events/${ev.id}/forms/checkin`, { method: 'POST' });
    expect(tapped.status).toBe(200);
    expect(((await tapped.json()) as { ok: boolean }).ok).toBe(true);
  });

  test('the calendar file the page links to downloads', async () => {
    const ev = await seed('active');
    const html = await (await get(`/events/${ev.id}`)).text();
    const href = html.match(/href="(\/events\/[^"]+\/calendar\.ics)"/)?.[1];
    expect(href, 'the page offers the calendar file').toBe(`/events/${ev.id}/calendar.ics`);
    const res = await get(href!);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/calendar');
    expect(await res.text()).toContain(ev.title);
  });

  test('the venue map image the page shows loads', async () => {
    const ev = await seed('active');
    const html = await (await get(`/events/${ev.id}`)).text();
    expect(html).toContain(`/api/v2/maps/venue-image?event=${ev.id}`);
    const google = stubGoogle();
    const res = await venueImage(ev.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/png');
    expect(google).toHaveBeenCalledTimes(1);
  });

  test('what the poster, the TV and the sponsor strip read by event id still answers', async () => {
    const ev = await seed('active');
    for (const path of [
      `/api/v2/events/${ev.id}`,
      `/api/v2/events/${ev.id}/poster-bundle`,
      `/api/v2/events/${ev.id}/display-config`,
      `/api/v2/events/${ev.id}/sponsor-bundle`,
      `/api/v2/events/${ev.id}/sponsors`,
    ]) {
      expect((await get(path)).status, path).toBe(200);
    }
  });

  test('its page asks search engines not to index it; a listed page does not', async () => {
    const off = await seed('active');
    const res = await get(`/events/${off.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(await res.text()).toMatch(/<meta name="robots" content="noindex" \/>/);

    const listed = await seed('active', { published: 1 });
    const control = await get(`/events/${listed.id}`);
    expect(control.status).toBe(200);
    expect(control.headers.get('X-Robots-Tag')).toBeNull();
    expect(await control.text()).not.toContain('name="robots"');
  });

  test('the admin preview of a live off-map event goes to its public page, as for a listed one', async () => {
    const ev = await seed('active');
    const res = await get(`/api/v2/admin/events/${ev.id}/preview`, { headers: ADMIN });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`/events/${ev.id}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Listing and discovery
// ═════════════════════════════════════════════════════════════════════════════

describe('…and stays out of every place where strangers find events', () => {
  async function inListApi(id: string): Promise<boolean> {
    const res = await get(`/api/v2/events?brand=${BRAND}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: { id: string }[] }).items.some((e) => e.id === id);
  }
  const listPage = async () => (await get('/events')).text();
  async function mapText(): Promise<string> {
    const res = await get(`/api/v2/events/map?cell=${RES7}`);
    expect(res.status).toBe(200);
    return res.text();
  }
  const discoverable = async (sponsorId: string) =>
    (await readDiscoverableEvents(E.DB, { id: sponsorId, brand_id: BRAND, h3_res7: null })).map(
      (e) => e.id
    );

  test('not on the list, the map, the sitemap or sponsor discovery, while its page is open', async () => {
    const ev = await seed('active');
    const sponsorId = `sp-${ev.id}`;

    expect((await get(`/events/${ev.id}`)).status, 'open by link').toBe(200);

    expect(await inListApi(ev.id), 'list API').toBe(false);
    expect(await listPage(), '/events page').not.toContain(ev.id);
    expect(await mapText(), 'map API').not.toContain(ev.id);
    expect(await sitemap(), 'sitemap').not.toContain(ev.id);
    expect(await discoverable(sponsorId), 'sponsor discovery').not.toContain(ev.id);

    // Control: every one of those reads shows it once the organizer puts it on
    // the map, so "not shown" above is the map setting and not a read that
    // never shows anything.
    await putOnTheMap(ev.id);
    expect(await inListApi(ev.id), 'list API, on the map').toBe(true);
    expect(await listPage(), '/events page, on the map').toContain(ev.id);
    expect(await mapText(), 'map API, on the map').toContain(ev.id);
    expect(await sitemap(), 'sitemap, on the map').toContain(ev.id);
    expect(await discoverable(sponsorId), 'sponsor discovery, on the map').toContain(ev.id);
  });

  test('"more at this venue" on another event\'s page does not name it', async () => {
    const venue = `Shared Hall ${uid('v')}, Sawyer MI`;
    const listed = await seed('active', { published: 1, startsIn: 3, location: venue });
    const off = await seed('active', { startsIn: 6, location: venue });

    const before = await (await get(`/events/${listed.id}`)).text();
    expect(before).not.toContain(off.id);
    expect(before).not.toContain(off.title);

    await putOnTheMap(off.id);
    expect(await (await get(`/events/${listed.id}`)).text()).toContain(off.id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Not live: nothing opens
// ═════════════════════════════════════════════════════════════════════════════

describe('a draft or ready event stays closed to the public, on the map or off', () => {
  const cases: [Status, 0 | 1][] = [
    ['draft', 0],
    ['draft', 1],
    ['ready', 0],
    ['ready', 1],
  ];

  test.each(cases)('%s, is_published = %i: the page is the generic 404', async (status, pub) => {
    const ev = await seed(status, { published: pub });
    const res = await get(`/events/${ev.id}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain(NOT_FOUND_TITLE);
    expect(html, 'a closed event is never named').not.toContain(ev.title);
  });

  test.each(cases)(
    '%s, is_published = %i: calendar, venue image, form and register are closed',
    async (status, pub) => {
      const ev = await seed(status, { published: pub });

      expect((await get(`/events/${ev.id}/calendar.ics`)).status, 'calendar').toBe(404);

      const google = stubGoogle();
      expect((await venueImage(ev.id)).status, 'venue image').toBe(404);
      expect(google, 'no billed map load for a closed event').not.toHaveBeenCalled();
      vi.unstubAllGlobals();

      const form = await get(`/forms/${ev.id}?type=register`);
      expect(form.status, 'form page forwards to the list').toBe(302);
      expect(pathOf(form.headers.get('Location'))).toBe('/events');

      const reg = await get(`/api/v2/events/${ev.id}/forms/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Too Early' }),
      });
      expect(reg.status, 'register').toBe(410);
    }
  );
});

describe('archived events are not changed by this decision', () => {
  test('off the map, was live once: the named "has ended" page (410)', async () => {
    const ev = await seed('archived');
    const res = await get(`/events/${ev.id}`);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain(`${ev.title} has ended`);
  });

  test('off the map, never live (archived from draft): the generic 404, never named', async () => {
    const ev = await seed('archived', { listedFrom: null });
    const res = await get(`/events/${ev.id}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain(NOT_FOUND_TITLE);
    expect(html).not.toContain(ev.title);
  });

  test('off the map: calendar and venue image stay closed', async () => {
    const ev = await seed('archived');
    expect((await get(`/events/${ev.id}/calendar.ics`)).status).toBe(404);
    const google = stubGoogle();
    expect((await venueImage(ev.id)).status).toBe(404);
    expect(google).not.toHaveBeenCalled();
  });

  test('on the map: the recap page still renders', async () => {
    const ev = await seed('archived', { published: 1, startsIn: -3, endsIn: -2 });
    const res = await get(`/events/${ev.id}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(ev.title);
  });
});
