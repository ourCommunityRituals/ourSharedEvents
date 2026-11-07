/* eslint-disable security/detect-non-literal-fs-filename -- reads fixed repo files */
/**
 * The nightly event lifecycle (scripts/lifecycle/event-lifecycle.mjs) against a
 * fake site that behaves like the Worker's public surfaces and admin API. Each
 * fault below breaks one behaviour of the site, and the test names the checks
 * that must go red for it: a check that cannot fail counts as absent (AGENTS.md,
 * born red). The same checks were also watched red against a local worker with
 * the faults planted in the Worker source (PR body).
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../../..');
const readJson = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));

let L;
let PLACES;
beforeAll(async () => {
  L = await import('../../../scripts/lifecycle/event-lifecycle.mjs');
  PLACES = L.placesFrom(readJson('stock/nodes.json'), readJson('stock/seed/seed.json'));
});

const STG = 'https://stg.oursharedevents.com';
// Production, from the one shared table (config/production-hosts.js), never spelled here (ADR-021).
const { PRODUCTION_HOSTS } = require('../../../config/production-hosts');
const PROD = [...PRODUCTION_HOSTS].map((h) => `https://${h}`);
const KEY = 'unit-test-admin-key';
const ACCESS_ID = 'unit-access-id';
const ACCESS_PART2 = 'unit-access-part2';

// ── The fake site ───────────────────────────────────────────────────────────

const TOWN_ZIPS = {
  'oak lawn': ['60453'],
  'evergreen park': ['60805'],
  'blue island': ['60406'],
  'auburn gresham': ['60620'],
};

function fakeSite(faults = {}) {
  const today = () => L.chicagoDate(Date.now());
  const events = new Map();
  let seq = 0;
  const calls = [];
  // Two ordinary events per town, as stg has (the stock load).
  for (const p of PLACES) {
    for (const off of [3, 30]) {
      const id = `evt_other_${p.node}_${off}`;
      events.set(id, {
        id,
        title: `Other ${p.town} ${off}`,
        start_date: L.addDays(today(), off),
        zip: p.zip,
        cell: p.cell,
        published: true,
        brand_id: 'root',
        created_by: 'key:admin',
      });
    }
  }
  let rateLimited = false;
  let staleReads = faults.staleReads || 0;

  const inWindow = (e, fut = 90) =>
    e.start_date >= today() && e.start_date <= L.addDays(today(), fut);
  const listed = () => [...events.values()].filter((e) => e.published);
  const zipOf = (address) => (/(\d{5})\s*$/.exec(address || '') || [])[1] || null;

  const html = (body, status = 200, headers = {}) =>
    new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
  const json = (o, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

  function card(e, landing) {
    const fut = faults.landingWindow || 90;
    const cls = landing && inWindow(e, fut) ? ' when-next-90' : '';
    const t = landing ? 'area-card' : 'public-event-card';
    const n = landing ? 'area-card-name' : 'public-event-name';
    const title = faults.listsOldTitle && e.oldTitle ? e.oldTitle : e.title;
    return `<article class="event-card${cls}" data-testid="${t}" data-event-id="${e.id}" data-phase="pre_event">
      <a class="event-card-link" href="/events/${e.id}"></a><div><h3 data-testid="${n}">${title}</h3></div></article>`;
  }

  async function handle(url, init) {
    const u = new URL(url);
    const method = init.method || 'GET';
    const h = init.headers || {};
    calls.push({ method, path: u.pathname + u.search, headers: h, redirect: init.redirect });
    if (h['CF-Access-Client-Id'] !== ACCESS_ID) return html('access', 403);
    if (
      faults.rateLimitOnce &&
      !rateLimited &&
      method === 'GET' &&
      !u.pathname.startsWith('/api/v2/admin')
    ) {
      rateLimited = true;
      return json({ ok: false }, 429);
    }

    // admin
    if (u.pathname.startsWith('/api/v2/admin/events')) {
      if (h.Authorization !== `Bearer ${KEY}`) return json({ ok: false }, 401);
      const id = decodeURIComponent(u.pathname.split('/')[5] || '');
      if (method === 'POST' && !id) {
        const b = JSON.parse(init.body);
        const nid = `evt_test_${++seq}`;
        events.set(nid, {
          id: nid,
          title: b.title,
          start_date: b.start_date,
          zip: zipOf(b.where_address),
          cell: L.placesFrom ? cellFor(b) : null,
          published: faults.createUnpublished ? false : b.is_published === true,
          brand_id: b.brand_id,
          created_by: 'key:admin',
          data_class:
            faults.dataClassIgnored || faults.dataClassStoredWrong ? 'production' : b.data_class,
        });
        if (faults.createFails) return json({ ok: false, id: nid, code: 'X' }, 500);
        return json(
          { ok: true, id: nid, data_class: faults.dataClassIgnored ? 'production' : b.data_class },
          201
        );
      }
      if (method === 'GET' && !id) {
        return json({
          ok: true,
          items: [...events.values()]
            .filter((e) => e.created_by === 'key:admin')
            .map((e) => ({
              id: e.id,
              title: e.title,
              brand_id: e.brand_id,
              data_class: e.data_class,
            })),
          pagination: { hasMore: false, nextCursor: null },
        });
      }
      const e = events.get(id);
      if (!e) return json({ ok: false, code: 'NOT_FOUND' }, 404);
      if (method === 'PUT') {
        const b = JSON.parse(init.body);
        if (faults.putFails) return json({ ok: false }, 503);
        if ('title' in b && !faults.putIgnoresTitle) {
          e.oldTitle = e.title;
          e.title = b.title;
        }
        if ('start_date' in b && !faults.putIgnoresDate) e.start_date = b.start_date;
        if ('where_address' in b && !faults.putIgnoresPlace) {
          e.zip = zipOf(b.where_address);
          e.cell = cellFor(b);
        }
        if ('is_published' in b && !faults.unpublishIgnored) e.published = b.is_published;
        return json({ ok: true, id });
      }
      if (method === 'DELETE') {
        if (faults.deleteFails) return json({ ok: false }, 503);
        if (!faults.deleteNoop) events.delete(id);
        return json({ ok: true, deleted: true });
      }
    }

    if (method !== 'GET') return json({ ok: false }, 405);
    if (staleReads > 0 && u.pathname !== '/api/v2/admin/events') {
      staleReads -= 1;
      return html('<p data-testid="public-error">Could not load events.</p>');
    }

    // public
    if (u.pathname === '/') {
      const hiddenTest = [...events.values()].some(
        (e) => e.id.startsWith('evt_test_') && !e.published
      );
      if (faults.landingError || (faults.landingErrorOnceUnpublished && hiddenTest)) {
        return html(
          '<div class="empty-state" data-testid="area-empty">Nothing on the map yet.</div>'
        );
      }
      const zip = u.searchParams.get('zip');
      let items = listed();
      if (zip && !faults.zipNoFilter) items = items.filter((e) => e.zip === zip);
      return html(
        `<input type="radio" name="win" id="win-week" class="toggle-radio" />` +
          `<input type="radio" name="win" id="win-next-90" class="toggle-radio" checked />` +
          (faults.whereLive ? '<input data-testid="where-input" name="where">' : '') +
          items.map((e) => card(e, true)).join('')
      );
    }
    if (u.pathname === '/events') {
      const qv = (u.searchParams.get('q') || '').toLowerCase();
      const when = u.searchParams.get('when');
      let items = listed();
      if (qv && !faults.searchNoFilter) {
        const zips = TOWN_ZIPS[qv] || (/^\d{5}$/.test(qv) ? [qv] : null);
        items = zips
          ? items.filter((e) => zips.includes(e.zip))
          : items.filter((e) => e.title.toLowerCase().includes(qv));
      }
      if (when === 'next-90') items = items.filter((e) => inWindow(e));
      return html(
        `<p data-testid="disc-summary">${items.length} events</p>` +
          items.map((e) => card(e, false)).join('')
      );
    }
    if (u.pathname === '/api/v2/events') {
      return json({
        ok: true,
        items: listed().map((e) => ({
          id: e.id,
          title: e.title,
          start_date: e.start_date,
          h3_res7: faults.apiWrongCell ? '8726645ffffffff' : e.cell,
        })),
      });
    }
    if (u.pathname === '/api/v2/events/map') {
      const cell = u.searchParams.get('cell');
      const fut = faults.mapWindow || 90;
      const items = [...events.values()]
        .filter(
          (e) => (faults.mapIgnoresPublished || e.published) && e.cell === cell && inWindow(e, fut)
        )
        .map((e) => ({ id: e.id, name: e.title, startDateISO: `${e.start_date}T17:00:00.000Z` }));
      return json({ ok: true, items });
    }
    if (u.pathname.startsWith('/events/')) {
      if (faults.challengeEventPage) {
        return html('Just a moment', 403, { 'cf-mitigated': 'challenge' });
      }
      const e = events.get(decodeURIComponent(u.pathname.slice(8)));
      return e ? html(`<h1>${e.title}</h1>`) : html('not found', 404);
    }
    return html('nope', 404);
  }

  function cellFor(b) {
    const p = PLACES.find((x) => x.address === b.where_address);
    return p ? p.cell : null;
  }

  return { fetch: (url, init) => handle(url, init || {}), events, calls };
}

async function runAll(
  faults = {},
  { steps = ['sweep', 'create', 'edit', 'window', 'remove'], ctxOver = {} } = {}
) {
  const site = fakeSite(faults);
  const lines = [];
  const report = L.createReport({ log: (l) => lines.push(l) });
  const today = L.chicagoDate(Date.now());
  const state = L.planRun({ places: PLACES, today, runTag: 'unit-1' });
  // Fixed towns, whatever tonight's turn: Oak Lawn, then Evergreen Park.
  state.from = PLACES[0];
  state.to = PLACES[1];
  const ctx = {
    site: L.createSite({
      baseUrl: STG,
      adminKey: KEY,
      accessClientId: ACCESS_ID,
      accessClientSecret: ACCESS_PART2,
      fetch: site.fetch,
      sleep: async () => {},
    }),
    report,
    state,
    save: () => {},
    whereSearch: false,
    window: { pastDays: 0, futureDays: 90 },
    attempts: 3,
    delayMs: 0,
    sleep: async () => {},
    ...ctxOver,
  };
  for (const s of steps) {
    const before = report.failed().length;
    await L.STEPS[s](ctx);
    if (report.failed().length > before) break; // the workflow skips later steps
  }
  await L.STEPS.cleanup(ctx);
  return { site, report, lines, state };
}

const failedNames = (r) => r.report.failed().map((f) => f.name);

// ── Target guard ────────────────────────────────────────────────────────────

describe('target: staging only', () => {
  test('stg is accepted, with or without a trailing slash', () => {
    expect(L.assertTarget(STG)).toBe(STG);
    expect(L.assertTarget(`${STG}/`)).toBe(STG);
  });

  test.each(PROD.flatMap((p) => [p, `${p}/admin`]))('refuses production: %s', (url) => {
    expect(() => L.assertTarget(url)).toThrow(/ADR-021/);
  });

  test.each([
    'https://stg.oursharedevents.com.evil.example',
    'http://stg.oursharedevents.com',
    'https://stg.oursharedevents.com/admin',
    'https://oursharedevents-prd.workers.dev',
    'not a url',
  ])('refuses %s', (url) => {
    expect(() => L.assertTarget(url)).toThrow();
  });

  test('a local worker only when asked, never in CI, origin only', () => {
    expect(() => L.assertTarget('http://127.0.0.1:8794')).toThrow();
    expect(L.assertTarget('http://127.0.0.1:8794', { allowLocal: true })).toBe(
      'http://127.0.0.1:8794'
    );
    expect(() =>
      L.assertTarget('http://127.0.0.1:8794', { allowLocal: true, inCi: true })
    ).toThrow();
    expect(() => L.assertTarget('http://127.0.0.1:8794/x', { allowLocal: true })).toThrow();
    for (const p of PROD) expect(() => L.assertTarget(p, { allowLocal: true })).toThrow(/ADR-021/);
  });
});

// ── Plan ────────────────────────────────────────────────────────────────────

describe('the plan', () => {
  test('the four test towns, each at a seed venue in its own zip, with a res-7 cell', () => {
    expect(PLACES.map((p) => p.zip)).toEqual(['60453', '60805', '60406', '60620']);
    for (const p of PLACES) {
      expect(p.address.endsWith(p.zip)).toBe(true);
      expect(p.cell).toMatch(/^87[0-9a-f]{13}$/);
      expect(typeof p.eventTypeId).toBe('string');
    }
  });

  test('two different towns a night, every town in turn', () => {
    const seen = new Set();
    for (let i = 0; i < 4; i++) {
      const { from, to } = L.pickTowns(PLACES, L.addDays('2026-11-07', i));
      expect(from.node).not.toBe(to.node);
      seen.add(from.node);
    }
    expect(seen.size).toBe(4);
  });

  test('window edges: just inside and just outside 90 days; the past edges once the window reaches back', () => {
    expect(L.windowEdgeCases({ pastDays: 0, futureDays: 90 })).toEqual([
      { name: '88 days ahead', offset: 88, shown: true },
      { name: '93 days ahead', offset: 93, shown: false },
    ]);
    const withPast = L.windowEdgeCases({ pastDays: 30, futureDays: 90 });
    expect(withPast.map((c) => [c.offset, c.shown])).toEqual([
      [88, true],
      [93, false],
      [-28, true],
      [-33, false],
    ]);
  });

  test('titles carry the prefix the sweep looks for, and only safe characters', () => {
    const s = L.planRun({ places: PLACES, today: '2026-11-07', runTag: '123-1' });
    expect(s.title.startsWith(L.TITLE_PREFIX)).toBe(true);
    expect(s.newTitle.startsWith(L.TITLE_PREFIX)).toBe(true);
    expect(s.title).not.toBe(s.newTitle);
    expect(() => L.planRun({ places: PLACES, today: '2026-11-07', runTag: '<b>' })).toThrow();
  });
});

// ── Parsing ─────────────────────────────────────────────────────────────────

describe('reading the pages', () => {
  test('cards by id, name and window class; the checked window', () => {
    const page =
      '<input type="radio" name="win" id="win-next-90" class="toggle-radio" checked />' +
      '<article class="event-card when-next-90 type-x" data-testid="area-card" data-event-id="evt_1" data-phase="pre_event">' +
      '<h3 data-testid="area-card-name">Hello</h3></article>';
    const cards = L.cardsOf(page, 'area-card');
    expect(cards.get('evt_1').name).toBe('Hello');
    expect(cards.get('evt_1').classes.has('when-next-90')).toBe(true);
    expect(L.landingDefaultWindow(page)).toBe('next-90');
    expect(L.cardsOf(page, 'public-event-card').size).toBe(0);
  });
});

// ── The whole run ───────────────────────────────────────────────────────────

describe('a healthy site', () => {
  test('every check passes, and nothing is left behind', async () => {
    const r = await runAll();
    expect(failedNames(r)).toEqual([]);
    expect(r.report.results.length).toBeGreaterThan(50);
    expect([...r.site.events.keys()].filter((id) => id.startsWith('evt_test_'))).toEqual([]);
  });

  test('admin calls carry the key; public reads never do, and nothing follows a redirect', async () => {
    const r = await runAll();
    for (const c of r.site.calls) {
      expect(c.redirect).toBe('manual');
      const isAdmin = c.path.startsWith('/api/v2/admin/');
      expect(Boolean(c.headers.Authorization)).toBe(isAdmin);
    }
  });

  test('no secret appears in any log line', async () => {
    const r = await runAll({ deleteFails: true });
    const all = r.lines.join('\n');
    for (const s of [KEY, ACCESS_ID, ACCESS_PART2]) expect(all).not.toContain(s);
  });

  test('a change that reaches a read late still passes (the checks poll)', async () => {
    const r = await runAll({ staleReads: 2 });
    expect(failedNames(r)).toEqual([]);
  });

  test('a 429 is waited out, not failed', async () => {
    const r = await runAll({ rateLimitOnce: true });
    expect(failedNames(r)).toEqual([]);
  });
});

describe('born red: each fault turns its checks red', () => {
  test('create not labelled synthetic', async () => {
    const r = await runAll({ dataClassIgnored: true });
    expect(failedNames(r)).toEqual(['create: the admin API creates the event live and synthetic']);
    // still cleaned up: the id was recorded from the answer
    expect([...r.site.events.keys()].filter((id) => id.startsWith('evt_test_'))).toEqual([]);
  });

  test('create answers synthetic but stores production', async () => {
    const r = await runAll({ dataClassStoredWrong: true });
    expect(failedNames(r)).toEqual(['create: the admin list stores it as synthetic']);
  });

  test('create answers an error after making a row: cleanup still deletes it', async () => {
    const r = await runAll({ createFails: true });
    expect(failedNames(r)).toContain('create: the admin API creates the event live and synthetic');
    expect([...r.site.events.keys()].filter((id) => id.startsWith('evt_test_'))).toEqual([]);
  });

  test('created off the map', async () => {
    const r = await runAll({ createUnpublished: true });
    const f = failedNames(r);
    for (const n of [
      'create: landing /',
      'create: /events',
      'create: public API /api/v2/events',
      'create: landing ?zip=60453',
    ]) {
      expect(f).toContain(n);
    }
    expect(f.some((n) => n.startsWith('create: map cell'))).toBe(true);
  });

  test('the edit keeps the old title', async () => {
    const r = await runAll({ putIgnoresTitle: true });
    const f = failedNames(r);
    expect(f).toContain('edit: landing /');
    expect(f).toContain('edit: /events');
    expect(f).toContain('edit: the event page shows the new title');
    expect(f.some((n) => /^edit: map cell/.test(n))).toBe(true);
  });

  test('a page keeps showing the old title', async () => {
    const r = await runAll({ listsOldTitle: true });
    expect(failedNames(r)).toContain('edit: landing /');
  });

  test('the edit keeps the old date', async () => {
    const r = await runAll({ putIgnoresDate: true });
    const f = failedNames(r);
    expect(f).toContain('edit: public API /api/v2/events');
    expect(f.some((n) => /^edit: map cell/.test(n))).toBe(true);
  });

  test('the edit keeps the old town', async () => {
    const r = await runAll({ putIgnoresPlace: true });
    const f = failedNames(r);
    expect(f).toContain('edit: landing ?zip=60805');
    expect(f).toContain('edit: /events ?q=Evergreen Park');
    expect(f).toContain('edit: old town landing ?zip=60453');
    expect(f).toContain('edit: old town /events ?q=Oak Lawn');
  });

  test('the landing zip view lists every zip', async () => {
    const r = await runAll({ zipNoFilter: true });
    expect(failedNames(r)).toEqual(['edit: old town landing ?zip=60453']);
  });

  test('/events search lists every place', async () => {
    const r = await runAll({ searchNoFilter: true });
    expect(failedNames(r)).toEqual([
      'edit: old town /events ?q=Oak Lawn',
      'edit: old town /events ?q=60453',
    ]);
  });

  test('the public API reports the wrong cell', async () => {
    const r = await runAll({ apiWrongCell: true });
    expect(failedNames(r)).toEqual(['create: public API /api/v2/events']);
  });

  test('the landing window reaches past 90 days', async () => {
    const r = await runAll({ landingWindow: 120 });
    expect(failedNames(r)).toEqual([
      'window 93 days ahead: landing /',
      'window 93 days ahead: landing ?zip=60805',
    ]);
  });

  test('the map window reaches past 90 days', async () => {
    const r = await runAll({ mapWindow: 120 });
    expect(failedNames(r)).toEqual(['window 93 days ahead: map cell ' + r.state.to.cell]);
  });

  test('unpublish is ignored', async () => {
    const r = await runAll({ unpublishIgnored: true });
    const f = failedNames(r);
    expect(f).toContain('unpublish: landing /');
    expect(f).toContain('unpublish: /events');
    expect(f).toContain(`unpublish: map cell ${r.state.to.cell}`);
  });

  test('the map ignores unpublish', async () => {
    const r = await runAll({ mapIgnoresPublished: true });
    expect(failedNames(r)).toEqual([`unpublish: map cell ${r.state.to.cell}`]);
  });

  test('delete answers 200 and keeps the row', async () => {
    const r = await runAll({ deleteNoop: true, unpublishIgnored: false });
    const f = failedNames(r);
    expect(f).toContain('delete: the admin API no longer knows it');
    expect(f).toContain('delete: the event page is gone');
    // a 200 that deletes nothing is not taken as gone
    expect(f).toContain('sweep: no lifecycle event is left on the site');
  });

  test('delete fails: cleanup reports the event it could not delete', async () => {
    const r = await runAll({ deleteFails: true });
    const f = failedNames(r);
    expect(f).toContain('delete: the admin API deletes it');
    expect(f).toContain("cleanup: the run's event is deleted");
  });

  test('the landing page fails to read its events: it can show nothing, nor vouch for an absence', async () => {
    const r = await runAll({ landingError: true });
    expect(failedNames(r)).toContain('create: landing /');
    const r2 = await runAll({ landingErrorOnceUnpublished: true });
    expect(failedNames(r2)).toEqual(['unpublish: landing /', 'unpublish: landing ?zip=60805']);
    expect(r2.report.failed()[0].detail).toContain('lists no other event');
  });

  test('the edge challenges the event page', async () => {
    const r = await runAll({ challengeEventPage: true });
    expect(failedNames(r)).toEqual(['create: the event page shows it']);
    expect(r.report.failed()[0].detail).toContain('edge challenged');
  });

  test('the town search goes live while the workflow still has it off', async () => {
    const r = await runAll({ whereLive: true });
    expect(failedNames(r)).toEqual([
      'create: the landing town search is off here, and off on the site',
    ]);
  });
});

describe('the sweep', () => {
  test('deletes a lifecycle event an earlier run left, and only those', async () => {
    const site = fakeSite();
    site.events.set('evt_left', {
      id: 'evt_left',
      title: `${'Nightly lifecycle check'} 99-1`,
      start_date: '2026-12-01',
      zip: '60453',
      cell: PLACES[0].cell,
      published: true,
      brand_id: 'root',
      created_by: 'key:admin',
    });
    site.events.set('evt_brand', {
      id: 'evt_brand',
      title: `${'Nightly lifecycle check'} on another brand`,
      start_date: '2026-12-01',
      zip: '60453',
      cell: PLACES[0].cell,
      published: true,
      brand_id: 'abc',
      created_by: 'key:admin',
    });
    const report = L.createReport({ log: () => {} });
    const ctx = {
      site: L.createSite({
        baseUrl: STG,
        adminKey: KEY,
        accessClientId: ACCESS_ID,
        accessClientSecret: ACCESS_PART2,
        fetch: site.fetch,
        sleep: async () => {},
      }),
      report,
    };
    await L.sweep(ctx);
    expect(site.events.has('evt_left')).toBe(false);
    expect(site.events.has('evt_brand')).toBe(true);
    expect(site.events.has('evt_other_oak-lawn_3')).toBe(true);
    expect(report.results[0].detail).toContain('1 left from an earlier run');
  });
});

describe('the run summary table', () => {
  test('a cell escapes backslashes before pipes, and keeps to one row', async () => {
    const { tableCell } = await import('../../../scripts/lifecycle/run.mjs');
    const BS = String.fromCharCode(92); // one backslash
    expect(tableCell('a|b')).toBe(`a${BS}|b`);
    // a trailing backslash must not swallow the pipe that ends the cell
    expect(tableCell(`ends in ${BS}`)).toBe(`ends in ${BS}${BS}`);
    expect(tableCell(`${BS}|`)).toBe(`${BS}${BS}${BS}|`);
    expect(tableCell('one\ntwo\r\nthree')).toBe('one two three');
  });
});
