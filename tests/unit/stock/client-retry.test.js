/**
 * OSE-2082: a 502, 503 or 504 (or a network error) from the staging admin API is
 * tried again where repeating is safe, and never makes a second row.
 *
 * Why: run 43533830657 (2026-11-14) died in the build on one 503 from
 * POST /api/v2/admin/events/:id/poster-deployments, and the run then purged stg.
 *
 * The fake site below keeps its rows, like the Worker's database. A fault can
 * answer 503 without writing the row (the usual case) or after writing it (the
 * answer was lost on the way back). The second kind is the one a blind retry
 * turns into a duplicate row.
 *
 * Born red (each fault injected alone in scripts/stock, then removed):
 *   F1 never try again (RETRY_WAITS_MS = [])               -> the "then success" cases fail
 *   F2 try a create again without the read (skip landed()) -> the "no second row" cases fail
 *   F3 try again on every status (500 and 403 too)         -> the "returns at once" cases fail
 *   F4 drop the status from the last error                 -> the "names the method" cases fail
 *   F5 a timed-out call counts as a network error          -> the timeout case fails
 *   F6 build-full ignores created_at (madeSince -> true)   -> "an older row with the same name" fails
 *   F7 build-full's event read returns the row it found    -> "an event that landed" fails
 *   F8 the short-links ask not marked idempotent           -> "asked again, the build goes on" fails
 */
const W = require('./worker-bodies');

let createClient;
let RETRY_WAITS_MS;
let buildDay;
beforeAll(async () => {
  ({ createClient, RETRY_WAITS_MS } = await import('../../../scripts/stock/client.mjs'));
  ({ buildDay } = await import('../../../scripts/stock/build-full.mjs'));
});

const BASE = 'https://stg.oursharedevents.com';
// Built, not literal: a stand-in, kept out of the committed-secret scan's way.
const SECRET = ['stand', 'in', 'key'].join('-');
const NOW = Date.parse('2026-11-14T00:25:00Z');

const reply = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  headers: { get: () => null },
});

/**
 * A fake Worker with rows that stay. `faults` is a list of
 * { method, path: RegExp, times, status = 503, lands = false, error, timeout }:
 * the next `times` matching calls fail; with `lands`, the row is written first.
 */
function site({ faults = [], sponsors = [], events = [] } = {}) {
  const calls = [];
  const db = { sponsors: [...sponsors], events: [...events], posters: [] };
  let n = 0;
  const id = (p) => `${p}_${++n}`;
  const stamp = () => new Date(NOW + 1000).toISOString();

  function write(method, path, body) {
    if (method === 'POST' && path === '/api/v2/admin/sponsors') {
      const row = { id: id('sp'), name: body.name, event_id: null, created_at: stamp() };
      db.sponsors.push(row);
      return reply(201, W.sponsorCreate({ id: row.id }));
    }
    if (method === 'POST' && path === '/api/v2/admin/events') {
      const row = {
        id: id('evt'),
        title: body.title,
        start_date: body.start_date,
        location: body.location,
        created_at: stamp(),
      };
      db.events.push(row);
      return reply(201, W.eventCreate({ id: row.id, shortcode: `SC${n}` }));
    }
    const poster = path.match(/^\/api\/v2\/admin\/events\/([^/]+)\/poster-deployments$/);
    if (method === 'POST' && poster) {
      const row = {
        id: id('pd'),
        event_id: poster[1],
        qr_token: id('qrt'),
        placement_label: body.placement_label,
        placement_type: body.placement_type,
      };
      db.posters.push(row);
      return reply(201, W.posterCreate({ id: row.id, qr_token: row.qr_token }));
    }
    if (method === 'POST' && path.endsWith('/short-links')) return reply(200, W.shortLinks());
    if (method === 'GET' && path === '/api/v2/admin/sponsors?brand_id=root') {
      return reply(200, W.sponsorList(db.sponsors));
    }
    if (method === 'GET' && path.startsWith('/api/v2/admin/sponsors?eventId=')) {
      const eid = path.split('=')[1];
      return reply(
        200,
        W.sponsorList(
          db.sponsors
            .filter((s) => (s.placements || {})[eid])
            .map((s) => ({ id: s.id, event_id: eid, placement_id: s.placements[eid] }))
        )
      );
    }
    if (method === 'GET' && path === '/api/v2/admin/events?limit=100') {
      return reply(200, W.adminEventList(db.events));
    }
    if (method === 'GET' && poster) {
      return reply(200, W.posterList(db.posters.filter((p) => p.event_id === poster[1])));
    }
    const sponsor = path.match(/^\/api\/v2\/admin\/sponsors\/([^/]+)$/);
    if (method === 'PUT' && sponsor && body.event_id) {
      const row = db.sponsors.find((s) => s.id === sponsor[1]);
      row.placements = row.placements || {};
      // INSERT OR IGNORE, as the Worker: a repeat attaches nothing more
      row.placements[body.event_id] = row.placements[body.event_id] || id('spl');
      return reply(200, { ok: true });
    }
    if (method === 'PUT') return reply(200, { ok: true });
    if (method === 'GET') return reply(200, { ok: true });
    return reply(404, {});
  }

  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const parsed = new URL(String(url));
    const path = parsed.pathname + parsed.search;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, path, body });
    const fault = faults.find((f) => f.times > 0 && f.method === method && f.path.test(path));
    if (fault) {
      fault.times -= 1;
      if (fault.lands) write(method, path, body);
      if (fault.timeout) {
        // what fetch does when its AbortSignal.timeout fires
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw new Error('aborted');
      }
      if (fault.error) throw new Error(`socket hang up ${SECRET}`);
      return reply(fault.status ?? 503, { ok: false });
    }
    return write(method, path, body);
  };
  const to = (method, re) => calls.filter((c) => c.method === method && re.test(c.path));
  return { fetch, calls, db, to };
}

function client(s, extra = {}) {
  const sleeps = [];
  const c = createClient({
    baseUrl: BASE,
    adminKey: SECRET,
    accessClientId: 'cid',
    accessClientSecret: SECRET,
    fetch: s.fetch,
    // the pacing gap and the retry waits both come through here
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => NOW,
    ...extra,
  });
  return { c, sleeps, waits: () => sleeps.filter((ms) => RETRY_WAITS_MS.includes(ms)) };
}

const POSTER = '/api/v2/admin/events/evt_1/poster-deployments';
const fault = (method, path, times, more = {}) => ({ method, path, times, ...more });

describe('a read or a PUT: tried again as it is', () => {
  test.each([502, 503, 504])('GET: a %i then success passes', async (status) => {
    const s = site({ faults: [fault('GET', /event-types/, 1, { status })] });
    const { c, waits } = client(s);
    await expect(c.get('/api/v2/admin/event-types')).resolves.toEqual({ ok: true });
    expect(s.to('GET', /event-types/)).toHaveLength(2);
    expect(waits()).toEqual([RETRY_WAITS_MS[0]]);
  });

  test('PUT: a 503 twice then success passes, waiting longer the second time', async () => {
    const s = site({ faults: [fault('PUT', /sponsors\/sp_9$/, 2)] });
    const { c, waits } = client(s);
    await expect(c.put('/api/v2/admin/sponsors/sp_9', { logo_url: '/x' })).resolves.toEqual({
      ok: true,
    });
    expect(s.to('PUT', /sponsors\/sp_9$/)).toHaveLength(3);
    expect(waits()).toEqual(RETRY_WAITS_MS);
    expect(RETRY_WAITS_MS[1]).toBeGreaterThan(RETRY_WAITS_MS[0]);
  });

  test('a network error then success passes', async () => {
    const s = site({ faults: [fault('GET', /event-types/, 1, { error: true })] });
    await expect(client(s).c.get('/api/v2/admin/event-types')).resolves.toEqual({ ok: true });
  });

  test('a 503 three times fails, naming the method, path, status and tries; no fourth try', async () => {
    const s = site({ faults: [fault('GET', /event-types/, 9)] });
    const err = await client(s)
      .c.get('/api/v2/admin/event-types?x=1')
      .catch((e) => e);
    expect(err.message).toBe('GET /api/v2/admin/event-types failed: 503 (3 tries)');
    expect(s.to('GET', /event-types/)).toHaveLength(3);
  });

  test('a network error three times fails without the underlying message', async () => {
    const s = site({ faults: [fault('GET', /event-types/, 9, { error: true })] });
    const err = await client(s)
      .c.get('/api/v2/admin/event-types')
      .catch((e) => e);
    expect(err.message).toBe('GET /api/v2/admin/event-types failed: network error (3 tries)');
    expect(err.message).not.toContain(SECRET);
  });

  test.each([400, 401, 403, 404, 409, 429, 500])('a %i returns at once', async (status) => {
    const s = site({ faults: [fault('GET', /event-types/, 9, { status })] });
    const { c, waits } = client(s);
    const err = await c.get('/api/v2/admin/event-types').catch((e) => e);
    expect(err.message).toBe(`GET /api/v2/admin/event-types failed: ${status}`);
    expect(s.to('GET', /event-types/)).toHaveLength(1);
    expect(waits()).toEqual([]);
  });

  test('a call that timed out is not made again: it already had its deadline', async () => {
    const s = site({ faults: [fault('GET', /event-types/, 9, { timeout: true })] });
    const err = await client(s, { timeoutMs: 5 })
      .c.get('/api/v2/admin/event-types')
      .catch((e) => e);
    expect(err.message).toBe('GET /api/v2/admin/event-types failed: timed out');
    expect(s.to('GET', /event-types/)).toHaveLength(1);
  });
});

describe('a create (POST): tried again only after a read shows it did not land', () => {
  test('with no read given, a 503 is final: one POST', async () => {
    const s = site({ faults: [fault('POST', /poster-deployments$/, 1)] });
    const err = await client(s)
      .c.post(POSTER, { placement_label: 'Hall' })
      .catch((e) => e);
    expect(err.message).toBe(`POST ${POSTER} failed: 503`);
    expect(s.to('POST', /poster-deployments$/)).toHaveLength(1);
  });

  test('the upload is never sent twice', async () => {
    const s = site({ faults: [fault('POST', /uploads$/, 1)] });
    const err = await client(s)
      .c.upload('evt_1', new Uint8Array([1]), 'image/png')
      .catch((e) => e);
    expect(err.message).toBe('POST /api/v2/admin/events/evt_1/uploads failed: 503');
    expect(s.to('POST', /uploads$/)).toHaveLength(1);
  });

  test('the read says not there: the create is sent again, after the wait and the read', async () => {
    const s = site({ faults: [fault('POST', /poster-deployments$/, 1)] });
    const { c } = client(s);
    const order = [];
    const got = await c.post(
      POSTER,
      { placement_label: 'Hall', placement_type: 'venue' },
      {
        landed: async () => {
          order.push(`read after ${s.to('POST', /poster-deployments$/).length} POST`);
          return null;
        },
      }
    );
    expect(got.id).toBe('pd_1');
    expect(order).toEqual(['read after 1 POST']);
    expect(s.to('POST', /poster-deployments$/)).toHaveLength(2);
    expect(s.db.posters).toHaveLength(1);
  });

  test('the read finds the row: it is the answer, and no second POST is sent', async () => {
    const s = site({ faults: [fault('POST', /poster-deployments$/, 1, { lands: true })] });
    const got = await client(s).c.post(
      POSTER,
      { placement_label: 'Hall', placement_type: 'venue' },
      { landed: async () => ({ id: s.db.posters[0].id }) }
    );
    expect(got).toEqual({ id: 'pd_1' });
    expect(s.to('POST', /poster-deployments$/)).toHaveLength(1);
    expect(s.db.posters).toHaveLength(1);
  });

  test('the read fails: the create is not sent again, and the error names both', async () => {
    const s = site({ faults: [fault('POST', /poster-deployments$/, 1)] });
    const err = await client(s)
      .c.post(
        POSTER,
        {},
        {
          landed: async () => {
            throw new Error(`GET ${POSTER} failed: 503 (3 tries)`);
          },
        }
      )
      .catch((e) => e);
    expect(err.message).toBe(
      `POST ${POSTER} failed: 503; not sent again, the read after it failed: GET ${POSTER} failed: 503 (3 tries)`
    );
    expect(s.to('POST', /poster-deployments$/)).toHaveLength(1);
  });

  test('a 503 three times, the read saying not there each time, fails after three POSTs', async () => {
    const s = site({ faults: [fault('POST', /poster-deployments$/, 9)] });
    let reads = 0;
    const err = await client(s)
      .c.post(POSTER, {}, { landed: async () => (reads++, null) })
      .catch((e) => e);
    expect(err.message).toBe(`POST ${POSTER} failed: 503 (3 tries)`);
    expect(s.to('POST', /poster-deployments$/)).toHaveLength(3);
    expect(reads).toBe(2);
  });

  test('a route that answers a repeat with the same row is tried again as it is', async () => {
    const s = site({ faults: [fault('POST', /short-links$/, 1)] });
    await expect(
      client(s).c.post('/api/v2/admin/events/evt_1/short-links', {}, { idempotent: true })
    ).resolves.toEqual(W.shortLinks());
    expect(s.to('POST', /short-links$/)).toHaveLength(2);
  });
});

// ── The build's own creates, against rows that stay ──────────────────────────

const row = (i) => ({
  venue: `Venue ${i}`,
  address: '1 Main St',
  sector: 'private',
  node: 'beverly',
  event_type_id: 'type-a',
  starts_at: `2026-11-${10 + i}T19:00:00-06:00`,
  ends_at: null,
  title: `Title ${i}`,
  summary: 'A summary',
  lat: 41.7,
  lng: -87.7,
});
const businesses = [
  { name: 'Anchor Co', address: '2 Main St', node: 'beverly', anchor: true, lat: 41.7, lng: -87.6 },
  {
    name: 'Corner Shop',
    address: '4 Main St',
    node: 'beverly',
    anchor: false,
    lat: 41.7,
    lng: -87.6,
  },
];
const build = (s, over = {}) =>
  buildDay({
    client: client(s).c,
    accepted: [row(1), row(2)],
    businesses,
    regionals: { regionals: [] },
    posts: [],
    artTags: { tags: {} },
    expected: { beverly: 2 },
    date: '2026-11-04',
    fetch: s.fetch,
    now: () => NOW,
    ...over,
  });
const ids = (manifest, kind) => manifest.items.filter((i) => i.kind === kind).map((i) => i.id);

describe('buildDay: the incident, a 503 from the poster create (run 43533830657)', () => {
  test('the 503 wrote nothing: the build goes on, with one poster per event', async () => {
    const s = site({ faults: [fault('POST', /poster-deployments$/, 1)] });
    const manifest = await build(s);
    expect(ids(manifest, 'poster')).toHaveLength(2);
    expect(s.db.posters).toHaveLength(2);
    expect(s.to('POST', /poster-deployments$/)).toHaveLength(3);
    expect(manifest.qr.map((q) => q.qPath)).toEqual(s.db.posters.map((p) => `/q/${p.qr_token}`));
  });

  test('the 503 came after the row was written: that poster is used, none is made twice', async () => {
    const s = site({ faults: [fault('POST', /poster-deployments$/, 1, { lands: true })] });
    const manifest = await build(s);
    expect(s.db.posters).toHaveLength(2);
    expect(s.to('POST', /poster-deployments$/)).toHaveLength(2);
    expect(ids(manifest, 'poster').sort()).toEqual(s.db.posters.map((p) => p.id).sort());
    expect(manifest.qr.map((q) => q.qPath)).toEqual(s.db.posters.map((p) => `/q/${p.qr_token}`));
  });

  test('the 503 three times: the build fails with the method, path and status, and keeps its manifest', async () => {
    const s = site({ faults: [fault('POST', /poster-deployments$/, 9)] });
    const err = await build(s).catch((e) => e);
    expect(err.message).toMatch(
      /^POST \/api\/v2\/admin\/events\/evt_\d+\/poster-deployments failed: 503 \(3 tries\)$/
    );
    expect(ids(err.manifest, 'event')).toHaveLength(1);
    expect(s.db.posters).toHaveLength(0);
  });
});

describe('buildDay: a sponsor create that fails', () => {
  test('nothing written: sent again, one sponsor per business', async () => {
    const s = site({ faults: [fault('POST', /admin\/sponsors$/, 1)] });
    const manifest = await build(s);
    expect(s.db.sponsors.map((x) => x.name)).toEqual(['Anchor Co', 'Corner Shop']);
    expect(ids(manifest, 'sponsor')).toEqual(s.db.sponsors.map((x) => x.id));
  });

  test('written, answer lost: that sponsor is used, no second one is made', async () => {
    const s = site({ faults: [fault('POST', /admin\/sponsors$/, 1, { lands: true })] });
    const manifest = await build(s);
    expect(s.db.sponsors.map((x) => x.name)).toEqual(['Anchor Co', 'Corner Shop']);
    expect(s.to('POST', /admin\/sponsors$/)).toHaveLength(2);
    expect(ids(manifest, 'sponsor')).toEqual(s.db.sponsors.map((x) => x.id));
  });

  test('an older row with the same name (the load before this one) is not taken for it', async () => {
    const old = {
      id: 'sp_old',
      name: 'Anchor Co',
      event_id: null,
      created_at: new Date(NOW - 24 * 3600_000).toISOString(),
    };
    const s = site({ sponsors: [old], faults: [fault('POST', /admin\/sponsors$/, 1)] });
    const manifest = await build(s);
    expect(ids(manifest, 'sponsor')).not.toContain('sp_old');
    expect(s.db.sponsors.filter((x) => x.name === 'Anchor Co')).toHaveLength(2);
  });

  test('two new rows that could be it: the build stops and makes no third', async () => {
    const twin = (id) => ({
      id,
      name: 'Anchor Co',
      event_id: null,
      created_at: new Date(NOW).toISOString(),
    });
    const s = site({
      sponsors: [twin('sp_a'), twin('sp_b')],
      faults: [fault('POST', /admin\/sponsors$/, 1)],
    });
    const err = await build(s).catch((e) => e);
    expect(err.message).toBe(
      'POST /api/v2/admin/sponsors: 2 rows could be the one a failed create made'
    );
    expect(s.to('POST', /admin\/sponsors$/)).toHaveLength(1);
  });
});

describe('buildDay: an event create that fails', () => {
  test('nothing written: sent again, one event per row', async () => {
    const s = site({ faults: [fault('POST', /admin\/events$/, 1)] });
    const manifest = await build(s);
    expect(s.db.events.map((e) => e.title)).toEqual(['Title 1', 'Title 2']);
    expect(ids(manifest, 'event')).toEqual(s.db.events.map((e) => e.id));
  });

  test('an event that landed is put on the manifest for the purge, never made twice, and the build stops', async () => {
    const s = site({ faults: [fault('POST', /admin\/events$/, 1, { lands: true })] });
    const err = await build(s).catch((e) => e);
    expect(err.message).toBe(
      'POST /api/v2/admin/events failed, but the event was made; it is on the manifest for the purge and was not made again'
    );
    expect(s.db.events).toHaveLength(1);
    expect(s.to('POST', /admin\/events$/)).toHaveLength(1);
    expect(ids(err.manifest, 'event')).toEqual([s.db.events[0].id]);
  });

  test('the same title on another date is another event: not taken for it', async () => {
    const other = {
      id: 'evt_old',
      title: 'Title 1',
      start_date: '2026-11-12',
      location: 'Venue 1',
      created_at: new Date(NOW).toISOString(),
    };
    const s = site({ events: [other], faults: [fault('POST', /admin\/events$/, 1)] });
    const manifest = await build(s);
    expect(ids(manifest, 'event')).not.toContain('evt_old');
    expect(ids(manifest, 'event')).toHaveLength(2);
  });
});

describe('buildDay: the short link ask', () => {
  test('a 503 then success: asked again, the build goes on', async () => {
    const s = site({ faults: [fault('POST', /short-links$/, 1)] });
    const manifest = await build(s);
    expect(ids(manifest, 'event')).toHaveLength(2);
    expect(s.to('POST', /short-links$/)).toHaveLength(3);
  });
});
