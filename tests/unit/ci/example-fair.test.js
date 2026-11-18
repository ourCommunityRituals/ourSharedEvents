// vitest globals: true (vitest.config.ts).
// The example fair on staging (scripts/ci/example-fair.mjs, OSE-2009): one
// made-up fair with twelve stalls, loaded through the admin API by a
// dispatch-only workflow. It is only safe to run if it never runs anywhere but
// staging, never carries a person's contact in its fixture, never makes a
// second fair, removes only its own rows, and never prints a credential. Each
// block below pins one of those, against an in-memory admin API.
//
// Born red (2026-11-18), each fault injected alone and seen failing here: the
// production check removed; the email, phone and web-address shapes each
// removed from the fixture guard; the slug lookup skipped in load (a second
// fair); the marks check dropped from remove (another event with the slug was
// deleted); the admin headers written into an error message; the Bearer key
// sent on public reads; extra stalls never taken out of use; the fair created
// on the map; the masks not written; a stock search town put in the fixture;
// the workflow given a schedule, taken out of the stg-writer group, or given
// an input in its run text.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

// Production, from the one shared table (config/production-hosts.js), never spelled here (ADR-021).
const { PRODUCTION_HOSTS } = require('../../../config/production-hosts');

const ROOT = join(__dirname, '..', '..', '..');
let F;
beforeAll(async () => {
  F = await import('../../../scripts/ci/example-fair.mjs');
});

const STG = 'https://stg.oursharedevents.com';
const LOCAL = 'http://127.0.0.1:8787';
// Stand-ins, marked so a leak is easy to find in a test failure.
const KEY_MARK = 'adminkey-LEAK-MARKER-1';
const ACCESS_MARK = 'access-LEAK-MARKER-2';
const EDGE_MARK = 'edge-LEAK-MARKER-3';
const ENV = {
  ADMIN_KEY: KEY_MARK,
  CF_ACCESS_CLIENT_ID: 'access-id-LEAK-MARKER-4',
  CF_ACCESS_CLIENT_SECRET: ACCESS_MARK,
  OCR_CI_EDGE_TOKEN: EDGE_MARK,
};
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'scripts/ci/example-fair.json'), 'utf8'));

// ── An in-memory admin API and public pages, as the Worker answers them ──────

const TRANSITIONS = {
  draft: ['ready', 'archived'],
  ready: ['active', 'draft', 'archived'],
  active: ['archived', 'ready'],
  archived: ['active', 'draft'],
};

function fakeSite({ pageSize = 100 } = {}) {
  const events = new Map();
  const booths = new Map();
  const seen = [];
  let n = 0;
  const json = (status, body, extra = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...extra },
    });
  const html = (status, body, extra = {}) =>
    new Response(body, { status, headers: { 'content-type': 'text/html', ...extra } });
  const boothsOf = (id) => [...booths.values()].filter((b) => b.event_id === id);

  function addEvent(row) {
    const id = row.id ?? `evt_${++n}`;
    events.set(id, {
      brand_id: 'root',
      status: 'draft',
      is_published: 0,
      data_class: 'production',
      created_by: 'person@example.test',
      starts_at: null,
      activity: false,
      ...row,
      id,
    });
    return id;
  }
  function addBooth(row) {
    const id = row.id ?? `booth_${++n}`;
    booths.set(id, { sort: 0, category: null, is_active: true, ...row, id });
    return id;
  }

  async function fetch(href, init = {}) {
    const url = new URL(href);
    const method = init.method ?? 'GET';
    const headers = init.headers ?? {};
    const body = init.body ? JSON.parse(init.body) : undefined;
    seen.push({
      method,
      path: url.pathname,
      search: url.search,
      headers: { ...headers },
      redirect: init.redirect,
    });
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const isAdmin = url.pathname.startsWith('/api/v2/admin/');
    if (isAdmin && headers.Authorization !== `Bearer ${KEY_MARK}`) {
      return json(401, { code: 'UNAUTHORIZED' });
    }

    // /api/v2/admin/events
    if (isAdmin && parts.length === 4 && parts[3] === 'events') {
      if (method === 'GET') {
        const all = [...events.values()].map((e) => {
          const row = { ...e };
          delete row.activity;
          return row;
        });
        const start = Number(url.searchParams.get('cursor') ?? 0);
        const items = all.slice(start, start + pageSize);
        const hasMore = start + pageSize < all.length;
        return json(200, {
          items,
          pagination: { hasMore, nextCursor: hasMore ? String(start + pageSize) : null },
        });
      }
      if (method === 'POST') {
        if (body.slug && [...events.values()].some((e) => e.slug === body.slug)) {
          return json(409, { code: 'SLUG_TAKEN' });
        }
        if (!body.attendance_mode) return json(400, { code: 'MISSING_FIELD' });
        const id = addEvent({
          title: body.title,
          slug: body.slug,
          status: body.status,
          description: body.description,
          location: body.location,
          start_date: body.start_date,
          timezone: body.timezone,
          starts_at: body.start_time ? `${body.start_date}T15:00:00.000Z` : null,
          event_type_id: body.event_type_id,
          is_published: body.is_published === true ? 1 : 0,
          data_class: body.data_class ?? 'production',
          created_by: 'key:admin',
        });
        return json(201, { id, data_class: events.get(id).data_class });
      }
    }
    // /api/v2/admin/events/:id
    if (isAdmin && parts.length === 5 && parts[3] === 'events') {
      const e = events.get(parts[4]);
      if (!e) return json(404, { code: 'NOT_FOUND' });
      if (method === 'PUT') {
        if (typeof body.status === 'string' && body.status !== e.status) {
          if (!TRANSITIONS[e.status].includes(body.status)) {
            return json(409, { code: 'INVALID_TRANSITION' });
          }
          e.status = body.status;
        }
        for (const k of [
          'title',
          'description',
          'location',
          'start_date',
          'timezone',
          'event_type_id',
        ]) {
          if (k in body) e[k] = body[k];
        }
        if ('start_time' in body) e.starts_at = `${e.start_date}T15:00:00.000Z`;
        if ('is_published' in body) e.is_published = body.is_published ? 1 : 0;
        return json(200, { id: e.id });
      }
      if (method === 'DELETE') {
        if (e.activity) return json(409, { code: 'EVENT_HAS_ACTIVITY' });
        for (const b of boothsOf(e.id)) booths.delete(b.id);
        events.delete(e.id);
        return json(200, { id: e.id, deleted: true });
      }
    }
    // /api/v2/admin/events/:id/booths[/bulk|/:boothId]
    if (isAdmin && parts[3] === 'events' && parts[5] === 'booths') {
      const e = events.get(parts[4]);
      if (!e) return json(404, { code: 'NOT_FOUND' });
      if (parts.length === 6 && method === 'GET') return json(200, { booths: boothsOf(e.id) });
      if (parts.length === 7 && parts[6] === 'bulk' && method === 'POST') {
        const taken = new Set(boothsOf(e.id).map((b) => b.number.toLowerCase()));
        if (body.booths.some((b) => taken.has(b.number.toLowerCase()))) {
          return json(409, { code: 'BOOTHS_REFUSED' });
        }
        for (const b of body.booths) addBooth({ ...b, event_id: e.id });
        return json(201, { created: body.booths.length });
      }
      const b = booths.get(parts[6]);
      if (!b || b.event_id !== e.id) return json(404, { code: 'NOT_FOUND' });
      if (method === 'PUT') {
        Object.assign(b, body);
        return json(200, { booth: b });
      }
      if (method === 'DELETE') {
        b.is_active = false;
        return json(200, { booth: b });
      }
    }

    // Public pages: only a live event is public; off the map is open by link.
    if (url.pathname === '/api/v2/events') {
      const items = [...events.values()]
        .filter((e) => e.status === 'active' && e.is_published === 1)
        .map((e) => ({ id: e.id }));
      return json(200, { items });
    }
    if (url.pathname === '/events') {
      const listed = [...events.values()].filter(
        (e) => e.status === 'active' && e.is_published === 1
      );
      return html(200, listed.map((e) => `<a href="/events/${e.id}">x</a>`).join(''));
    }
    if (parts[0] === 'events' && parts.length >= 2) {
      const e = events.get(parts[1]);
      if (!e || e.status !== 'active') return html(404, 'not found');
      const inUse = boothsOf(e.id).filter((b) => b.is_active);
      const robots = e.is_published === 1 ? {} : { 'x-robots-tag': 'noindex' };
      if (parts.length === 2) {
        const link =
          inUse.length > 0 ? '<a data-testid="event-stalls-link">See the stalls</a>' : '';
        return html(200, `<h1>${e.title}</h1>${link}`, robots);
      }
      if (parts.length === 3 && parts[2] === 'booths') {
        if (inUse.length === 0) return html(404, 'not found');
        const cats = [...new Set(inUse.map((b) => b.category))];
        const groups = cats
          .map(
            (c) =>
              `<section data-testid="booth-list-group">${inUse
                .filter((b) => b.category === c)
                .map(() => '<a data-testid="booth-list-row">x</a>')
                .join('')}</section>`
          )
          .join('');
        return html(200, groups, robots);
      }
      if (parts.length === 4 && parts[2] === 'booths') {
        const b = inUse.find((x) => x.number.toLowerCase() === parts[3].toLowerCase());
        if (!b) return html(404, 'not found');
        return html(
          200,
          `<h1 class="bp-name" id="booth-name" data-testid="booth-name">${b.name}</h1>`,
          robots
        );
      }
    }
    return json(404, { code: 'NO_ROUTE' });
  }

  const writes = () => seen.filter((s) => s.method !== 'GET').length;
  return { fetch, events, booths, seen, writes, addEvent, addBooth, boothsOf };
}

/** One run of main against the fake site; everything it writes is kept. */
async function run(site, argv, env = {}) {
  const out = [];
  const summary = [];
  const code = await F.main(
    argv,
    {
      ...ENV,
      EXAMPLE_FAIR_BASE_URL: LOCAL,
      EXAMPLE_FAIR_ALLOW_LOCAL: '1',
      GITHUB_STEP_SUMMARY: 'summary.md',
      ...env,
    },
    {
      fetch: site.fetch,
      write: (s) => out.push(s),
      appendSummary: (_file, text) => summary.push(text),
      sleep: async () => {},
      verifyAttempts: 1,
    }
  );
  return { code, out: out.join(''), summary: summary.join('') };
}

const ours = (site) =>
  [...site.events.values()].filter((e) => e.slug === 'example-fair-lantern-row');

// ── Staging only ────────────────────────────────────────────────────────────

describe('assertTarget: staging only, production refused first', () => {
  test('accepts the staging origin', () => {
    expect(F.assertTarget(STG)).toBe(STG);
    expect(F.assertTarget(`${STG}/`)).toBe(STG);
  });

  test('refuses production by the shared rule, even when a local run is allowed', () => {
    expect(PRODUCTION_HOSTS.size).toBeGreaterThan(0);
    for (const host of PRODUCTION_HOSTS) {
      expect(() => F.assertTarget(`https://${host}`)).toThrow(/production/);
      expect(() => F.assertTarget(`http://${host}`, { allowLocal: true })).toThrow(/production/);
    }
  });

  test('refuses any other host, a path, plain http and junk', () => {
    expect(() => F.assertTarget('https://example.com')).toThrow(/staging only/);
    expect(() => F.assertTarget(`${STG}/events`)).toThrow(/staging only/);
    expect(() => F.assertTarget('http://stg.oursharedevents.com')).toThrow(/staging only/);
    expect(() => F.assertTarget('not a url')).toThrow(/not a URL/);
  });

  test('a local worker only when allowed, and never in CI', () => {
    expect(() => F.assertTarget(LOCAL)).toThrow(/staging only/);
    expect(F.assertTarget(LOCAL, { allowLocal: true })).toBe(LOCAL);
    expect(() => F.assertTarget(LOCAL, { allowLocal: true, inCi: true })).toThrow(/staging only/);
  });

  test('main refuses production before it sends anything', async () => {
    const site = fakeSite();
    for (const host of PRODUCTION_HOSTS) {
      await expect(
        F.main(
          [],
          { ...ENV, EXAMPLE_FAIR_BASE_URL: `https://${host}`, EXAMPLE_FAIR_ALLOW_LOCAL: '1' },
          {
            fetch: site.fetch,
            write: () => {},
          }
        )
      ).rejects.toThrow(/production/);
    }
    expect(site.seen).toHaveLength(0);
  });

  test('on staging, main needs the Access service token', async () => {
    await expect(
      F.main([], { ADMIN_KEY: KEY_MARK }, { fetch: fakeSite().fetch, write: () => {} })
    ).rejects.toThrow(/CF_ACCESS_CLIENT_ID/);
  });
});

// ── The fixture ─────────────────────────────────────────────────────────────

describe('the fixture: made up, twelve stalls in four categories, no contact of anyone', () => {
  test('the committed fixture passes every check', () => {
    expect(F.fixtureProblems(fixture())).toEqual([]);
    expect(() => F.loadFixture()).not.toThrow();
  });

  test('twelve stalls, numbered A1 to D3, in four categories of the fixed list', () => {
    const fx = fixture();
    expect(fx.stalls.map((s) => s.number)).toEqual([
      'A1',
      'A2',
      'A3',
      'B1',
      'B2',
      'B3',
      'C1',
      'C2',
      'C3',
      'D1',
      'D2',
      'D3',
    ]);
    expect(new Set(fx.stalls.map((s) => s.category)).size).toBe(4);
  });

  test("the category list is the Worker's own (lib/event-booths.ts)", () => {
    const src = readFileSync(join(ROOT, 'workers/oursharedevents/src/lib/event-booths.ts'), 'utf8');
    const block = src.match(/export const BOOTH_CATEGORIES = \[([\s\S]*?)\] as const;/);
    expect(block).not.toBeNull();
    const list = [...block[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(F.BOOTH_CATEGORIES).toEqual(list);
  });

  const withText = (where, text) => {
    const fx = fixture();
    if (where === 'stall') fx.stalls[4].name = text;
    else fx.event[where] = text;
    return fx;
  };

  test.each([
    ['stall', 'Wobbly Teapot (ask for jo@pottery.test)', /email-shaped/],
    ['stall', 'Wobbly Teapot 773 555 0142', /phone-shaped/],
    ['stall', 'Wobbly Teapot (773) 555-0142', /phone-shaped/],
    ['stall', 'Wobbly Teapot, wobblyteapot.com', /web-address-shaped/],
    ['description', 'More at https://example.test/fair', /web-address-shaped/],
    ['location', 'Hall at www.lanternrow.test', /web-address-shaped/],
    ['title', 'Fair, call 3125550199', /phone-shaped/],
  ])('refuses a %s text that holds a contact: %s', (where, text, why) => {
    const problems = F.fixtureProblems(withText(where, text));
    expect(problems.join('; ')).toMatch(why);
  });

  test('it can move no stock total: no place, zip or town the stock checks search for', () => {
    // check-full.mjs counts manifest ids per node cell, and /events?q= for each
    // search in stock/totals.json. The fair has no coordinates, no address and no
    // zip (the fixture takes none), and no text that one of those searches matches.
    const fx = fixture();
    for (const k of ['lat', 'lon', 'where_address', 'zip_code']) {
      expect(fx.event[k]).toBeUndefined();
    }
    const totals = JSON.parse(readFileSync(join(ROOT, 'stock/totals.json'), 'utf8'));
    const text = JSON.stringify(fx).toLowerCase();
    const searches = Object.keys(totals.searches);
    expect(searches.length).toBeGreaterThan(0);
    for (const s of searches) expect(text).not.toContain(s.toLowerCase());
  });

  test('the date and time fields are checked by their own format, not as phone numbers', () => {
    const fx = fixture();
    expect(F.contactShapedTexts(fx)).toEqual([]);
    fx.event.start_date = '2027-02-30';
    expect(F.fixtureProblems(fx).join('; ')).toMatch(/real YYYY-MM-DD/);
  });

  test('refuses a sponsor, an unknown field, a repeated number, a fifth category', () => {
    const a = fixture();
    a.sponsors = [{ name: 'Someone' }];
    expect(F.fixtureProblems(a).join('; ')).toMatch(/unknown top-level field: sponsors/);
    const b = fixture();
    b.stalls[0].contact_name = 'Someone';
    expect(F.fixtureProblems(b).join('; ')).toMatch(/unknown field contact_name/);
    const c = fixture();
    c.stalls[1].number = 'a1';
    expect(F.fixtureProblems(c).join('; ')).toMatch(/number must look like A1|repeats/);
    const d = fixture();
    d.stalls[11].category = 'clothing';
    expect(F.fixtureProblems(d).join('; ')).toMatch(/4 categories, not 5/);
  });
});

// ── Load: one fair, twelve stalls, however often it runs ────────────────────

describe('load is idempotent', () => {
  test('the first load makes one fair and twelve stalls, as a synthetic draft off the map', async () => {
    const site = fakeSite();
    const r = await run(site, []);
    expect(r.code).toBe(0);
    const fairs = ours(site);
    expect(fairs).toHaveLength(1);
    const [e] = fairs;
    expect(e).toMatchObject({
      status: 'draft',
      is_published: 0,
      data_class: 'synthetic',
      brand_id: 'root',
    });
    expect(site.boothsOf(e.id).filter((b) => b.is_active)).toHaveLength(12);
    expect(r.out).toContain(`Event id: \`${e.id}\``);
    expect(r.out).toContain(`${LOCAL}/events/${e.id}/booths/A1`);
  });

  test('a second load writes nothing and leaves exactly one fair and its twelve stalls', async () => {
    const site = fakeSite({ pageSize: 2 });
    site.addEvent({ title: 'Someone else', slug: 'someone-else' });
    site.addEvent({ title: 'Another', slug: 'another' });
    expect((await run(site, [])).code).toBe(0);
    const before = site.writes();
    const second = await run(site, []);
    expect(second.code).toBe(0);
    expect(site.writes()).toBe(before);
    expect(ours(site)).toHaveLength(1);
    expect(site.booths.size).toBe(12);
    expect(second.out).toContain('| Event created | 0 |');
    expect(second.out).toContain('| Stalls created | 0 |');
  });

  test('open-by-link makes it live and off the map; its pages open and no list shows it', async () => {
    const site = fakeSite();
    const r = await run(site, ['--state=open-by-link']);
    expect(r.code).toBe(0);
    const [e] = ours(site);
    expect(e).toMatchObject({ status: 'active', is_published: 0 });
    expect(r.out).not.toMatch(/\*\*FAIL\*\*/);
    expect(r.out).toContain('| pass | stall list rows | 12 rows, wanted 12 |');
    expect(r.out).toContain('| pass | stall list groups | 4 groups, wanted 4 |');
  });

  test('switching state walks the state machine and keeps the same fair', async () => {
    const site = fakeSite();
    await run(site, []);
    const [first] = ours(site);
    expect((await run(site, ['--state=open-by-link'])).code).toBe(0);
    expect(ours(site)).toHaveLength(1);
    expect(ours(site)[0]).toMatchObject({ id: first.id, status: 'active' });
    expect((await run(site, [], { EXAMPLE_FAIR_STATE: 'draft' })).code).toBe(0);
    expect(ours(site)[0]).toMatchObject({ id: first.id, status: 'draft' });
    const puts = site.seen.filter((s) => s.method === 'PUT').length;
    expect(puts).toBe(4); // ready, active, then ready, draft
  });

  test('a fair that drifted is brought back: fields, a renamed stall, an extra stall', async () => {
    const site = fakeSite();
    await run(site, []);
    const [e] = ours(site);
    e.title = 'Changed by hand';
    e.is_published = 1;
    const a1 = site.boothsOf(e.id).find((b) => b.number === 'A1');
    a1.name = 'Renamed';
    site.addBooth({ event_id: e.id, number: 'E1', name: 'Extra', category: 'other' });
    expect((await run(site, [])).code).toBe(0);
    expect(ours(site)[0]).toMatchObject({ title: 'Lantern Row Craft Fair', is_published: 0 });
    expect(a1.name).toBe('Marigold Dumpling Cart');
    const inUse = site.boothsOf(e.id).filter((b) => b.is_active);
    expect(inUse.map((b) => b.number).sort()).toEqual(
      fixture()
        .stalls.map((s) => s.number)
        .sort()
    );
  });

  test('a slug held by an event this job did not make stops the load and changes nothing', async () => {
    const site = fakeSite();
    site.addEvent({ title: 'A person made this', slug: 'example-fair-lantern-row' });
    await expect(run(site, [])).rejects.toThrow(/did not make; nothing was changed/);
    expect(site.writes()).toBe(0);
  });

  test('isExampleFair needs every mark', () => {
    const slug = 'example-fair-lantern-row';
    const row = { slug, brand_id: 'root', data_class: 'synthetic', created_by: 'key:admin' };
    expect(F.isExampleFair(row, slug)).toBe(true);
    expect(F.isExampleFair({ ...row, created_by: 'svc:ci' }, slug)).toBe(true);
    expect(F.isExampleFair({ ...row, created_by: 'person@example.test' }, slug)).toBe(false);
    expect(F.isExampleFair({ ...row, data_class: 'production' }, slug)).toBe(false);
    expect(F.isExampleFair({ ...row, brand_id: 'other' }, slug)).toBe(false);
    expect(F.isExampleFair({ ...row, slug: 'other' }, slug)).toBe(false);
  });

  test('statusPath goes through ready between draft and active', () => {
    expect(F.statusPath('draft', 'active')).toEqual(['ready', 'active']);
    expect(F.statusPath('active', 'draft')).toEqual(['ready', 'draft']);
    expect(F.statusPath('archived', 'active')).toEqual(['active']);
    expect(F.statusPath('draft', 'draft')).toEqual([]);
  });
});

// ── Remove: only what it made ───────────────────────────────────────────────

describe('--remove deletes only its own rows', () => {
  test('deletes the fair and its stalls; another event and its stalls stay', async () => {
    const site = fakeSite();
    const other = site.addEvent({
      title: 'A real-looking event',
      slug: 'other-fair',
      status: 'active',
      is_published: 1,
    });
    site.addBooth({ event_id: other, number: 'A1', name: 'Kept', category: 'food' });
    await run(site, ['--state=open-by-link']);
    expect(site.events.size).toBe(2);

    const r = await run(site, ['--remove']);
    expect(r.code).toBe(0);
    expect(ours(site)).toHaveLength(0);
    expect([...site.events.keys()]).toEqual([other]);
    expect([...site.booths.values()].map((b) => b.event_id)).toEqual([other]);
    expect(r.out).toMatch(/and its stalls were deleted/);
    // The delete is confirmed by a second delete that finds nothing.
    const deletes = site.seen.filter(
      (s) => s.method === 'DELETE' && /\/events\/[^/]+$/.test(s.path)
    );
    expect(deletes).toHaveLength(2);
  });

  test('never touches an event with the slug that lacks its marks', async () => {
    const site = fakeSite();
    const theirs = site.addEvent({
      slug: 'example-fair-lantern-row',
      title: 'Theirs',
      data_class: 'synthetic',
    });
    const r = await run(site, ['--remove']);
    expect(r.code).toBe(0);
    expect(site.events.has(theirs)).toBe(true);
    expect(site.writes()).toBe(0);
    expect(r.out).toMatch(/No example fair was found/);
    expect(r.out).toMatch(/1 other event\(s\) hold the slug; they were not touched/);
  });

  test('a fair with recorded scans is archived, not deleted', async () => {
    const site = fakeSite();
    await run(site, ['--state=open-by-link']);
    ours(site)[0].activity = true;
    const r = await run(site, ['--remove']);
    expect(r.code).toBe(0);
    expect(ours(site)[0].status).toBe('archived');
    expect(r.out).toMatch(/archived \(off every public page\), not deleted/);
  });

  test('nothing to remove is not an error', async () => {
    const r = await run(fakeSite(), ['--remove']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/nothing was removed/);
  });
});

// ── Never a credential in the output ────────────────────────────────────────

describe('no secret or header in what it prints', () => {
  const leaks = (text) => /LEAK-MARKER/.test(text);

  test('a full load and remove print no secret, in the log or the summary', async () => {
    const site = fakeSite();
    const a = await run(site, ['--state=open-by-link']);
    const b = await run(site, ['--remove']);
    for (const r of [a, b]) {
      expect(leaks(r.out)).toBe(false);
      expect(leaks(r.summary)).toBe(false);
      expect(r.out).not.toMatch(/authorization|cf-access-client|x-ocr-ci/i);
    }
  });

  test('the Bearer key goes to admin calls only; public reads carry no admin header', async () => {
    const site = fakeSite();
    await run(site, ['--state=open-by-link']);
    for (const s of site.seen) {
      expect(s.redirect).toBe('manual');
      if (s.path.startsWith('/api/v2/admin/')) {
        expect(s.headers.Authorization).toBe(`Bearer ${KEY_MARK}`);
      } else {
        expect(s.headers.Authorization).toBeUndefined();
        expect(s.headers['X-OCR-CI']).toBe(EDGE_MARK);
      }
    }
  });

  test('a refused call names the method, path and status, never a header', async () => {
    const site = fakeSite();
    const refuse = async (href, init) =>
      String(href).includes('/api/v2/admin/')
        ? new Response('<html>Sign in</html>', {
            status: 403,
            headers: { 'content-type': 'text/html' },
          })
        : site.fetch(href, init);
    let message = '';
    try {
      await F.main(
        [],
        { ...ENV, EXAMPLE_FAIR_BASE_URL: LOCAL, EXAMPLE_FAIR_ALLOW_LOCAL: '1' },
        {
          fetch: refuse,
          write: () => {},
          sleep: async () => {},
        }
      );
    } catch (err) {
      message = err.message;
    }
    expect(message).toMatch(/^GET \/api\/v2\/admin\/events answered 403 \(not the Worker/);
    expect(leaks(message)).toBe(false);
  });

  test('in Actions, every secret is masked before anything else is written', async () => {
    const site = fakeSite();
    const out = [];
    await F.main(
      [],
      { ...ENV, GITHUB_ACTIONS: 'true', EXAMPLE_FAIR_BASE_URL: STG },
      { fetch: site.fetch, write: (s) => out.push(s), sleep: async () => {}, verifyAttempts: 1 }
    ).catch(() => {});
    const masks = out.filter((s) => s.startsWith('::add-mask::'));
    expect(masks).toHaveLength(4);
    expect(out.slice(0, 4)).toEqual(masks);
  });
});

// ── The workflow that runs it ───────────────────────────────────────────────

describe('the workflow: dispatch only, staging writer, the existing secrets', () => {
  const text = readFileSync(join(ROOT, '.github/workflows/stg-example-fair.yml'), 'utf8');
  const wf = yaml.load(text);
  const job = wf.jobs['example-fair'];
  const step = job.steps.find((s) => /scripts\/ci\/example-fair\.mjs/.test(s.run ?? ''));

  test('runs only when dispatched: no schedule, no push, no pull request', () => {
    const on = wf.on ?? wf[true];
    expect(Object.keys(on)).toEqual(['workflow_dispatch']);
  });

  test('takes the action and the state as fixed choices, defaulting to load and draft', () => {
    const inputs = (wf.on ?? wf[true]).workflow_dispatch.inputs;
    expect(inputs.action).toMatchObject({
      type: 'choice',
      options: ['load', 'remove'],
      default: 'load',
    });
    expect(inputs.state).toMatchObject({
      type: 'choice',
      options: ['draft', 'open-by-link'],
      default: 'draft',
    });
  });

  test('is one of the stg writers, never cancelled mid-run, and runs from main only', () => {
    expect(wf.concurrency).toEqual({
      group: 'stg-writer',
      'cancel-in-progress': false,
      queue: 'max',
    });
    expect(String(job.if)).toContain("github.ref == 'refs/heads/main'");
    expect(String(job.if)).not.toMatch(/\|\|/);
  });

  test('reads the repo only', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toBeUndefined();
  });

  test('passes the inputs through env, never into the script text', () => {
    expect(step.run).not.toMatch(/\$\{\{/);
    expect(step.env.EXAMPLE_FAIR_ACTION).toMatch(/inputs\.action/);
    expect(step.env.EXAMPLE_FAIR_STATE).toMatch(/inputs\.state/);
    expect(step.env.EXAMPLE_FAIR_BASE_URL).toBeUndefined();
    expect(step.env.EXAMPLE_FAIR_ALLOW_LOCAL).toBeUndefined();
  });

  test('uses only the secrets the lifecycle job already uses: no Cloudflare token, no new secret', () => {
    const secrets = [...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect([...new Set(secrets)].sort()).toEqual(
      ['ADMIN_KEY', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'OCR_CI_EDGE_TOKEN'].sort()
    );
    const lifecycle = readFileSync(
      join(ROOT, '.github/workflows/staging-event-lifecycle.yml'),
      'utf8'
    );
    for (const s of secrets) expect(lifecycle).toContain(`secrets.${s}`);
  });
});
