const W = require('./worker-bodies');

let createClient;
let buildDay;
let sponsorTier;
let SPONSOR_TIER_WIRE;
beforeAll(async () => {
  ({ createClient } = await import('../../../scripts/stock/client.mjs'));
  ({ buildDay, sponsorTier, SPONSOR_TIER_WIRE } =
    await import('../../../scripts/stock/build-full.mjs'));
});

const BASE = 'https://stg-full.oursharedevents.com';
const SECRET = 'sekret-value-123';

const reply = (status, body, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});

// A fake Worker: records every call and hands back ids.
function fakeSite({
  failUpload = false,
  artStatus = 200,
  noShortcode = false,
  eventWarnings = [],
  // the upload answer's file object, as the Worker would send it (null: no file)
  uploadFile,
} = {}) {
  const calls = [];
  let n = 0;
  const next = (p) => `${p}_${++n}`;
  const placementOf = new Map();
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    // Compare parsed origins, never a string prefix: `${BASE}.evil.example`
    // shares the prefix but is another host.
    const parsed = new URL(String(url));
    if (parsed.origin !== new URL(BASE).origin) {
      calls.push({ method, path: String(url), external: true });
      return reply(artStatus, {}, { 'content-type': 'image/png' });
    }
    const path = parsed.pathname + parsed.search;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, path, body, headers: init.headers });
    if (method === 'POST' && path === '/api/v2/admin/events') {
      const id = next('evt');
      return reply(
        201,
        W.eventCreate({
          id,
          shortcode: noShortcode ? null : `SC${id.split('_')[1]}`,
          warnings: eventWarnings,
        })
      );
    }
    if (method === 'POST' && path.endsWith('/poster-deployments')) {
      return reply(201, W.posterCreate({ id: next('pd'), qr_token: next('qrt') }));
    }
    if (method === 'POST' && path.endsWith('/short-links')) {
      return reply(200, W.shortLinks());
    }
    if (method === 'POST' && path.endsWith('/uploads')) {
      if (failUpload) return reply(500, {});
      const good = W.upload({ key: next('events/up'), url: '/api/v2/uploads/events/x/art.png' });
      if (uploadFile === undefined) return reply(201, good);
      return reply(201, { ...good, file: uploadFile });
    }
    if (method === 'POST' && path === '/api/v2/admin/sponsors') {
      return reply(201, W.sponsorCreate({ id: next('sp') }));
    }
    if (method === 'PUT' && /^\/api\/v2\/admin\/sponsors\/[^/]+$/.test(path)) {
      placementOf.set(`${path.split('/').pop()}|${body.event_id}`, next('spl'));
      return reply(200, { ok: true });
    }
    if (method === 'GET' && path.startsWith('/api/v2/admin/sponsors?eventId=')) {
      const eid = path.split('=')[1];
      const items = [...placementOf]
        .filter(([k]) => k.endsWith(`|${eid}`))
        .map(([k, pid]) => ({
          id: k.split('|')[0],
          event_id: eid,
          placement_id: pid,
        }));
      return reply(200, W.sponsorList(items));
    }
    if (method === 'PUT') return reply(200, { ok: true });
    return reply(404, {});
  };
  return { fetch, calls };
}

const client = (fetch, extra = {}) =>
  createClient({
    baseUrl: BASE,
    adminKey: SECRET,
    accessClientId: 'cid',
    accessClientSecret: SECRET,
    fetch,
    sleep: async () => {},
    ...extra,
  });

const row = (node, sector, day, i = 0) => ({
  venue: `Venue ${node} ${sector} ${day} ${i}`,
  address: '1 Main St',
  sector,
  node,
  event_type_id: 'type-a',
  starts_at: `2026-11-${String(day).padStart(2, '0')}T19:00:00-06:00`,
  ends_at: null,
  title: `Title ${node} ${sector} ${day} ${i}`,
  summary: 'A summary',
  source_url: 'https://example.com/x',
  cell: '872664540ffffff',
  lat: 41.7,
  lng: -87.7,
});

const rowsFor = (node, privateN, publicN) => [
  ...Array.from({ length: privateN }, (_, i) => row(node, 'private', 10 + i, i)),
  ...Array.from({ length: publicN }, (_, i) => row(node, 'public', 1 + i, i)),
];

const businesses = [
  // as the seed holds them: each with the point its address geocoded to
  {
    name: 'Anchor Co',
    address: '2 Main St',
    node: 'beverly',
    anchor: true,
    lat: 41.71,
    lng: -87.68,
  },
  {
    name: 'Regional Co',
    address: '3 Main St',
    node: 'beverly',
    anchor: false,
    lat: 41.72,
    lng: -87.67,
  },
  {
    name: 'Corner Shop',
    address: '4 Main St',
    node: 'beverly',
    anchor: false,
    lat: 41.73,
    lng: -87.66,
  },
];

const args = (site, over = {}) => ({
  client: client(site.fetch),
  accepted: rowsFor('beverly', 10, 5),
  businesses,
  regionals: { regionals: ['Regional Co'] },
  posts: [],
  artTags: { tags: {} },
  // per node, how many stock events it gets (the seed's count in a real run)
  expected: { beverly: 12, bridgeport: 12 },
  date: '2026-11-04',
  fetch: site.fetch,
  ...over,
});

const callsTo = (site, method, re) =>
  site.calls.filter((c) => c.method === method && re.test(c.path));

describe('createClient', () => {
  test('refuses any base URL but the full staging site', () => {
    expect(() =>
      createClient({
        baseUrl: 'https://stg.oursharedevents.com',
        fetch: async () => reply(200, {}),
      })
    ).toThrow(/baseUrl/);
    expect(() => client(async () => reply(200, {}))).not.toThrow();
  });

  test('sends the access headers, the bearer key and JSON content type', async () => {
    const site = fakeSite();
    await client(site.fetch).post('/api/v2/admin/events', { title: 't' });
    expect(site.calls[0].headers).toEqual({
      'CF-Access-Client-Id': 'cid',
      'CF-Access-Client-Secret': SECRET,
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
    });
  });

  test('a failed call throws method, path and status, never a secret or header', async () => {
    const c = client(async () => reply(403, {}));
    const err = await c.post('/api/v2/admin/events/evt_1/uploads?k=v', {}).catch((e) => e);
    expect(err.message).toBe('POST /api/v2/admin/events/evt_1/uploads failed: 403');
    expect(err.message).not.toContain(SECRET);
  });

  test('a network failure hides the underlying message', async () => {
    const c = client(async () => {
      throw new Error(`boom ${SECRET}`);
    });
    const err = await c.get('/api/v2/admin/sponsors').catch((e) => e);
    expect(err.message).toBe('GET /api/v2/admin/sponsors failed: network error');
  });

  test('paces to at most 5 requests per second', async () => {
    let t = 1000;
    const sleeps = [];
    const c = client(async () => reply(200, {}), {
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    await c.get('/a');
    await c.get('/b');
    await c.get('/c');
    expect(sleeps).toEqual([200, 200]);
    t += 500;
    await c.get('/d');
    expect(sleeps).toEqual([200, 200]);
  });

  test('upload posts multipart form data without a JSON content type', async () => {
    const site = fakeSite();
    await client(site.fetch).upload('evt_1', new Uint8Array([1]), 'image/png');
    const call = site.calls[0];
    expect(call.path).toBe('/api/v2/admin/events/evt_1/uploads');
    expect(call.body).toBeInstanceOf(FormData);
    expect(call.body.get('file').type).toBe('image/png');
    expect(call.headers['Content-Type']).toBeUndefined();
  });
});

describe('sponsorTier', () => {
  test('anchor is premium, a listed regional is mid, the rest local', () => {
    const regionals = { regionals: ['Regional Co'] };
    expect(sponsorTier({ name: 'A', anchor: true }, regionals)).toBe('premium');
    expect(sponsorTier({ name: 'Regional Co', anchor: false }, regionals)).toBe('mid');
    expect(sponsorTier({ name: 'Corner', anchor: false }, regionals)).toBe('local');
    expect(sponsorTier({ name: 'Regional Co', anchor: false }, ['Regional Co'])).toBe('mid');
  });
});

describe('buildDay', () => {
  test('15 accepted rows with 12 expected: all private, then the soonest public', async () => {
    const site = fakeSite();
    const accepted = rowsFor('beverly', 10, 5);
    const manifest = await buildDay(args(site, { accepted }));
    const events = callsTo(site, 'POST', /^\/api\/v2\/admin\/events$/);
    expect(events).toHaveLength(12);
    const titles = events.map((c) => c.body.title);
    expect(titles.filter((t) => t.includes('private'))).toHaveLength(10);
    expect(titles.filter((t) => t.includes('public')).sort()).toEqual([
      'Title beverly public 1 0',
      'Title beverly public 2 1',
    ]);
    expect(manifest.short).toEqual({});
  });

  test('a node with 11 accepted creates 11 and is short by 1', async () => {
    const site = fakeSite();
    const manifest = await buildDay(args(site, { accepted: rowsFor('beverly', 6, 5) }));
    expect(callsTo(site, 'POST', /^\/api\/v2\/admin\/events$/)).toHaveLength(11);
    expect(manifest.short).toEqual({ beverly: 1 });
  });

  test('the quantity comes from the expected count per node, not the code', async () => {
    const site = fakeSite();
    const manifest = await buildDay(
      args(site, { accepted: rowsFor('beverly', 6, 5), expected: { beverly: 3 } })
    );
    expect(callsTo(site, 'POST', /^\/api\/v2\/admin\/events$/)).toHaveLength(3);
    expect(manifest.short).toEqual({});
  });

  test('a node expected to hold 0, or not named at all, gets no events and is not short', async () => {
    const site = fakeSite();
    const manifest = await buildDay(
      args(site, {
        accepted: [...rowsFor('beverly', 2, 0), ...rowsFor('bridgeport', 2, 0)],
        expected: { beverly: 0 },
        nodeIds: ['beverly', 'bridgeport'],
      })
    );
    expect(callsTo(site, 'POST', /^\/api\/v2\/admin\/events$/)).toHaveLength(0);
    expect(manifest.items.filter((i) => i.kind === 'event')).toEqual([]);
    expect(manifest.short).toEqual({});
  });

  test('a node with no accepted rows is short by the whole target', async () => {
    const site = fakeSite();
    const manifest = await buildDay(args(site, { accepted: [] }));
    expect(manifest.short).toEqual({ beverly: 12 });
  });

  test('each event body carries the fields the Worker reads', async () => {
    const site = fakeSite();
    await buildDay(args(site, { accepted: [row('beverly', 'private', 10)] }));
    const body = callsTo(site, 'POST', /^\/api\/v2\/admin\/events$/)[0].body;
    expect(body).toMatchObject({
      brand_id: 'root',
      status: 'active',
      is_published: true,
      event_type_id: 'type-a',
      lat: 41.7,
      lon: -87.7,
      where_address: '1 Main St',
      start_date: '2026-11-10',
      start_time: '19:00',
      timezone: 'America/Chicago',
      title: 'Title beverly private 10 0',
    });
    expect(body).not.toHaveProperty('lng');
  });

  test('one poster deployment and one short-links call per event, with the QR recorded', async () => {
    const site = fakeSite();
    const manifest = await buildDay(args(site, { accepted: rowsFor('beverly', 2, 1) }));
    expect(callsTo(site, 'POST', /\/poster-deployments$/)).toHaveLength(3);
    expect(callsTo(site, 'POST', /\/short-links$/)).toHaveLength(3);
    expect(manifest.qr).toHaveLength(3);
    expect(manifest.qr[0]).toMatchObject({
      node: 'beverly',
      sPath: expect.stringMatching(/^\/s\/SC/),
    });
    expect(manifest.qr[0].qPath).toMatch(/^\/q\/qrt_/);
  });

  test('uploads art only when pickArt returns a post, and sets the cover', async () => {
    const posts = [
      { id: 'p1', caption: 'x', hashtags: ['typea'], mediaUrl: 'https://cdn.example/p1.png' },
    ];
    const artTags = { tags: { typea: 'type-a' } };
    const site = fakeSite();
    const withArt = await buildDay(
      args(site, { accepted: [row('beverly', 'private', 10)], posts, artTags })
    );
    expect(callsTo(site, 'POST', /\/uploads$/)).toHaveLength(1);
    expect(site.calls.find((c) => c.external).path).toBe('https://cdn.example/p1.png');
    expect(callsTo(site, 'PUT', /^\/api\/v2\/admin\/events\/evt_/)[0].body).toEqual({
      cover_image_url: '/api/v2/uploads/events/x/art.png',
    });
    expect(withArt.items.some((i) => i.kind === 'upload')).toBe(true);

    const none = fakeSite();
    await buildDay(args(none, { accepted: [row('beverly', 'private', 10)] }));
    expect(callsTo(none, 'POST', /\/uploads$/)).toHaveLength(0);
  });

  test('onRecord fires after every recorded id, with the manifest as it stands', async () => {
    const seen = [];
    const manifest = await buildDay(
      args(fakeSite(), {
        onRecord: (m) => seen.push(m.items.map((i) => `${i.kind}:${i.id}`)),
      })
    );
    expect(seen).toHaveLength(manifest.items.length);
    seen.forEach((snapshot, i) => expect(snapshot).toHaveLength(i + 1));
    expect(seen[seen.length - 1]).toEqual(manifest.items.map((i) => `${i.kind}:${i.id}`));
    expect(new Set(manifest.items.map((i) => i.kind))).toEqual(
      new Set(['sponsor', 'event', 'poster', 'placement'])
    );
  });

  test('art tagged by category fits through typeCategory', async () => {
    const posts = [
      { id: 'p1', caption: 'x', hashtags: ['music'], mediaUrl: 'https://cdn.example/p1.png' },
    ];
    const artTags = { tags: { music: 'MUSIC' } };
    const accepted = [row('beverly', 'private', 10)];
    const withMap = fakeSite();
    await buildDay(
      args(withMap, { accepted, posts, artTags, typeCategory: new Map([['type-a', 'MUSIC']]) })
    );
    expect(callsTo(withMap, 'POST', /\/uploads$/)).toHaveLength(1);
    const without = fakeSite();
    await buildDay(args(without, { accepted, posts, artTags }));
    expect(callsTo(without, 'POST', /\/uploads$/)).toHaveLength(0);
  });

  test.each([
    ['an upload failure', { failUpload: true }],
    ['a download failure', { artStatus: 404 }],
  ])('%s is a warning, never fatal', async (_name, opts) => {
    const posts = [
      { id: 'p1', caption: 'x', hashtags: ['typea'], mediaUrl: 'https://cdn.example/p1.png' },
    ];
    const site = fakeSite(opts);
    const manifest = await buildDay(
      args(site, {
        accepted: [row('beverly', 'private', 10)],
        posts,
        artTags: { tags: { typea: 'type-a' } },
      })
    );
    expect(manifest.warnings).toHaveLength(1);
    expect(manifest.warnings[0]).toMatch(/art skipped/);
    expect(manifest.items.filter((i) => i.kind === 'event')).toHaveLength(1);
    expect(callsTo(site, 'PUT', /^\/api\/v2\/admin\/events\//)).toHaveLength(0);
  });

  const ART = {
    posts: [
      { id: 'p1', caption: 'x', hashtags: ['typea'], mediaUrl: 'https://cdn.example/p1.png' },
    ],
    artTags: { tags: { typea: 'type-a' } },
  };

  test("the upload is read from the Worker's file object: its key is recorded, its url is the cover", async () => {
    const site = fakeSite();
    const manifest = await buildDay(
      args(site, { accepted: [row('beverly', 'private', 10)], ...ART })
    );
    const uploads = manifest.items.filter((i) => i.kind === 'upload');
    expect(uploads).toHaveLength(1);
    expect(uploads[0].id).toMatch(/^events\/up_\d+$/);
    expect(callsTo(site, 'PUT', /^\/api\/v2\/admin\/events\/evt_/)[0].body).toEqual({
      cover_image_url: '/api/v2/uploads/events/x/art.png',
    });
    expect(manifest.warnings).toEqual([]);
  });

  test.each([
    ['no file object', null],
    ['a key the purge could not name', { key: "events/x/a b'.png", url: '/api/v2/uploads/x' }],
    ['no key', { url: '/api/v2/uploads/x' }],
  ])('an upload answer with %s warns, records nothing and sets no cover', async (_n, file) => {
    const site = fakeSite({ uploadFile: file });
    const manifest = await buildDay(
      args(site, { accepted: [row('beverly', 'private', 10)], ...ART })
    );
    expect(manifest.items.filter((i) => i.kind === 'upload')).toEqual([]);
    expect(callsTo(site, 'PUT', /^\/api\/v2\/admin\/events\//)).toHaveLength(0);
    expect(manifest.warnings).toEqual([expect.stringMatching(/^art skipped for evt_\d+: /)]);
    expect(manifest.items.filter((i) => i.kind === 'event')).toHaveLength(1);
  });

  test('an upload answer with a safe key but no url records the key for the purge, and sets no cover', async () => {
    const site = fakeSite({ uploadFile: { key: 'events/evt_1/1-art.png' } });
    const manifest = await buildDay(
      args(site, { accepted: [row('beverly', 'private', 10)], ...ART })
    );
    expect(manifest.items.filter((i) => i.kind === 'upload').map((i) => i.id)).toEqual([
      'events/evt_1/1-art.png',
    ]);
    expect(callsTo(site, 'PUT', /^\/api\/v2\/admin\/events\//)).toHaveLength(0);
    expect(manifest.warnings).toEqual([expect.stringMatching(/no url$/)]);
  });

  test('one sponsor per business with the mapped tier, premium for the anchor', async () => {
    const site = fakeSite();
    await buildDay(args(site, { accepted: [] }));
    const sponsors = callsTo(site, 'POST', /^\/api\/v2\/admin\/sponsors$/);
    expect(sponsors.map((c) => c.body.name)).toEqual(['Anchor Co', 'Regional Co', 'Corner Shop']);
    expect(sponsors.every((c) => c.body.brand_id === 'root')).toBe(true);
    // the Worker's own vocabulary, one distinct word per stock tier
    expect(new Set(sponsors.map((c) => c.body.tier)).size).toBe(3);
  });

  test('each sponsor is sent its geocoded point as lat/lon, so the Worker can tag its cells', async () => {
    const site = fakeSite();
    await buildDay(args(site, { accepted: [] }));
    const sponsors = callsTo(site, 'POST', /^\/api\/v2\/admin\/sponsors$/);
    expect(sponsors.map((c) => [c.body.lat, c.body.lon])).toEqual([
      [41.71, -87.68],
      [41.72, -87.67],
      [41.73, -87.66],
    ]);
    expect(sponsors.every((c) => !('lng' in c.body))).toBe(true);
  });

  test('every event gets its node anchor, and every placement id goes to acceptSql', async () => {
    const site = fakeSite();
    const manifest = await buildDay(args(site, { accepted: rowsFor('beverly', 2, 1) }));
    const anchorId = manifest.items.find((i) => i.kind === 'sponsor').id;
    const attaches = callsTo(site, 'PUT', /^\/api\/v2\/admin\/sponsors\//);
    expect(attaches.filter((c) => c.path.endsWith(`/${anchorId}`))).toHaveLength(3);
    const placements = manifest.items.filter((i) => i.kind === 'placement');
    expect(placements).toHaveLength(9);
    expect(manifest.acceptSql).toEqual(placements.map((p) => p.id));
  });

  describe('regional and local sponsors', () => {
    const biz = (name, node, anchor) => ({
      name,
      address: 'x',
      node,
      anchor,
      lat: 41.7,
      lng: -87.7,
    });
    const ev = (node, n) => ({ ...row(node, 'public', 1 + n, 0), title: `Title ${node} ${n}` });
    const tierBiz = (node, mids, locals) => [
      biz(`A ${node}`, node, true),
      ...Array.from({ length: mids }, (_, i) => biz(`Mid ${node} ${i}`, node, false)),
      ...Array.from({ length: locals }, (_, i) => biz(`Loc ${node} ${i}`, node, false)),
    ];
    // sponsor id -> its business name, plus every attach as { sponsor, event }
    const index = (manifest, site) => {
      const created = callsTo(site, 'POST', /^\/api\/v2\/admin\/sponsors$/);
      const sponsors = manifest.items.filter((i) => i.kind === 'sponsor');
      const nameOf = new Map(sponsors.map((sp, i) => [sp.id, created[i].body.name]));
      const attaches = callsTo(site, 'PUT', /^\/api\/v2\/admin\/sponsors\//).map((c) => ({
        sponsor: c.path.split('/').pop(),
        event: c.body.event_id,
      }));
      return { nameOf, attaches, sponsors };
    };

    test('1 anchor, 2 regional, 3 local, 4 events: one placement per tier each, all used', async () => {
      const site = fakeSite();
      const manifest = await buildDay(
        args(site, {
          accepted: Array.from({ length: 4 }, (_, n) => ev('beverly', n)),
          businesses: tierBiz('beverly', 2, 3),
          regionals: { regionals: ['Mid beverly 0', 'Mid beverly 1'] },
        })
      );
      const { attaches, sponsors } = index(manifest, site);
      const tierOfId = new Map(sponsors.map((sp) => [sp.id, sp.tier]));
      const events = manifest.items.filter((i) => i.kind === 'event').map((e) => e.id);
      expect(events).toHaveLength(4);
      for (const e of events) {
        const tiers = attaches
          .filter((a) => a.event === e)
          .map((a) => tierOfId.get(a.sponsor))
          .sort();
        expect(tiers).toEqual(['local', 'mid', 'premium']);
      }
      const uses = (tier) => {
        const m = new Map();
        for (const a of attaches.filter((x) => tierOfId.get(x.sponsor) === tier)) {
          m.set(a.sponsor, (m.get(a.sponsor) || 0) + 1);
        }
        return [...m.values()].sort();
      };
      // round-robin: every sponsor used, counts differ by at most one
      expect(uses('mid')).toEqual([2, 2]);
      expect(uses('local')).toEqual([1, 1, 2]);
      expect(manifest.items.filter((i) => i.kind === 'placement')).toHaveLength(12);
    });

    test('the round-robin follows event name, not build order', async () => {
      const site = fakeSite();
      // build order (private first) differs from name order
      const accepted = [
        { ...row('beverly', 'public', 1), title: 'Zeta' },
        { ...row('beverly', 'private', 2), title: 'Alpha' },
      ];
      const manifest = await buildDay(
        args(site, {
          accepted,
          businesses: tierBiz('beverly', 2, 0),
          regionals: { regionals: ['Mid beverly 0', 'Mid beverly 1'] },
        })
      );
      const { nameOf, attaches } = index(manifest, site);
      const ids = manifest.items.filter((x) => x.kind === 'event').map((x) => x.id);
      const titles = callsTo(site, 'POST', /^\/api\/v2\/admin\/events$/).map((c) => c.body.title);
      const evTitle = new Map(ids.map((id, i) => [id, titles[i]]));
      const midOf = (title) =>
        attaches
          .filter((a) => evTitle.get(a.event) === title && /^Mid/.test(nameOf.get(a.sponsor)))
          .map((a) => nameOf.get(a.sponsor));
      expect(midOf('Alpha')).toEqual(['Mid beverly 0']);
      expect(midOf('Zeta')).toEqual(['Mid beverly 1']);
    });

    test('a node with no regional or local sponsor gets the anchor only', async () => {
      const site = fakeSite();
      const manifest = await buildDay(
        args(site, {
          accepted: [ev('beverly', 0), ev('beverly', 1)],
          businesses: tierBiz('beverly', 0, 0),
        })
      );
      const { attaches, sponsors } = index(manifest, site);
      expect(attaches).toHaveLength(2);
      expect(attaches.every((a) => a.sponsor === sponsors[0].id)).toBe(true);
      expect(manifest.items.filter((i) => i.kind === 'placement')).toHaveLength(2);
    });

    test('every new placement id is recorded with its node and is in acceptSql', async () => {
      const site = fakeSite();
      const manifest = await buildDay(
        args(site, {
          accepted: [ev('beverly', 0), ev('beverly', 1)],
          businesses: tierBiz('beverly', 1, 1),
          regionals: { regionals: ['Mid beverly 0'] },
        })
      );
      const placements = manifest.items.filter((i) => i.kind === 'placement');
      expect(placements).toHaveLength(6);
      expect(placements.every((p) => p.node === 'beverly')).toBe(true);
      expect(manifest.acceptSql).toEqual(placements.map((p) => p.id));
      expect(new Set(manifest.acceptSql).size).toBe(6);
    });

    test('a sponsor is never attached to an event in another node', async () => {
      const site = fakeSite();
      const manifest = await buildDay(
        args(site, {
          accepted: [ev('beverly', 0), ev('beverly', 1), ev('bridgeport', 0)],
          businesses: [...tierBiz('beverly', 1, 2), ...tierBiz('bridgeport', 1, 1)],
          regionals: { regionals: ['Mid beverly 0', 'Mid bridgeport 0'] },
          nodeIds: ['beverly', 'bridgeport'],
        })
      );
      const { nameOf, attaches } = index(manifest, site);
      const nodeOfEvent = new Map(
        manifest.items.filter((i) => i.kind === 'event').map((e) => [e.id, e.node])
      );
      expect(attaches).toHaveLength(9);
      for (const a of attaches) {
        expect(
          nameOf.get(a.sponsor).endsWith(` ${nodeOfEvent.get(a.event)}`) ||
            nameOf.get(a.sponsor).includes(` ${nodeOfEvent.get(a.event)} `)
        ).toBe(true);
      }
    });
  });

  test('a node with no anchor creates its events and warns about the missing placements', async () => {
    const site = fakeSite();
    const manifest = await buildDay(
      args(site, {
        accepted: [row('beverly', 'private', 10)],
        businesses: [{ name: 'Corner', address: 'x', node: 'beverly', anchor: false }],
      })
    );
    expect(manifest.items.filter((i) => i.kind === 'placement')).toHaveLength(0);
    expect(manifest.warnings[0]).toMatch(/no anchor sponsor in beverly/);
  });

  test('every created id lands in the manifest with its node', async () => {
    const site = fakeSite();
    const manifest = await buildDay(args(site, { accepted: rowsFor('beverly', 2, 0) }));
    const kinds = manifest.items.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] || 0) + 1 }), {});
    expect(kinds).toEqual({ sponsor: 3, event: 2, poster: 2, placement: 6 });
    expect(manifest.items.every((i) => i.id && i.node === 'beverly')).toBe(true);
    expect(manifest.date).toBe('2026-11-04');
  });

  test('a failed call rethrows with the partial manifest attached and no secret', async () => {
    const site = fakeSite();
    const failing = async (url, init) => {
      if (String(url).endsWith('/short-links')) return reply(500, {});
      return site.fetch(url, init);
    };
    const err = await buildDay(
      args(site, {
        client: client(failing),
        accepted: [row('beverly', 'private', 10)],
      })
    ).catch((e) => e);
    expect(err.message).toMatch(/POST \/api\/v2\/admin\/events\/evt_\d+\/short-links failed: 500/);
    expect(err.message).not.toContain(SECRET);
    expect(err.manifest.items.some((i) => i.kind === 'event')).toBe(true);
  });
});

describe('rulings round', () => {
  const SIX = [
    'blue-island',
    'beverly',
    'auburn-gresham',
    'evergreen-park',
    'oak-lawn',
    'mount-greenwood',
  ];
  const TWELVE_EACH = Object.fromEntries(SIX.map((n) => [n, 12]));

  test('start date and time are the Chicago wall clock of starts_at', async () => {
    const site = fakeSite();
    const find = { ...row('beverly', 'private', 10), starts_at: '2026-11-05T02:00:00Z' };
    await buildDay(args(site, { accepted: [find] }));
    const body = callsTo(site, 'POST', /^\/api\/v2\/admin\/events$/)[0].body;
    expect(body).toMatchObject({
      start_date: '2026-11-04',
      start_time: '20:00',
      timezone: 'America/Chicago',
    });
  });

  test('short covers all six nodes when there are no rows at all', async () => {
    const site = fakeSite();
    const manifest = await buildDay(
      args(site, { accepted: [], nodeIds: SIX, expected: TWELVE_EACH })
    );
    expect(manifest.short).toEqual(Object.fromEntries(SIX.map((n) => [n, 12])));
  });

  test('a node passed in but short by some rows reports only its gap', async () => {
    const site = fakeSite();
    const manifest = await buildDay(
      args(site, { accepted: rowsFor('beverly', 12, 0), nodeIds: SIX, expected: TWELVE_EACH })
    );
    expect(manifest.short.beverly).toBeUndefined();
    expect(manifest.short['oak-lawn']).toBe(12);
    expect(Object.keys(manifest.short)).toHaveLength(5);
  });

  test('every wire tier is one the Worker accepts', () => {
    const valid = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];
    expect(Object.keys(SPONSOR_TIER_WIRE).sort()).toEqual(['local', 'mid', 'premium']);
    for (const v of Object.values(SPONSOR_TIER_WIRE)) expect(valid).toContain(v);
  });
});

describe('fix round 1', () => {
  test('a redirect is a failure, never followed, and leaks nothing', async () => {
    const seen = [];
    const redirecting = async (url, init) => {
      seen.push(init);
      return {
        ...reply(302, {}, { location: `https://team.cloudflareaccess.com/?s=${SECRET}` }),
        type: 'basic',
      };
    };
    const err = await client(redirecting)
      .post('/api/v2/admin/events', {})
      .catch((e) => e);
    expect(seen[0].redirect).toBe('manual');
    expect(err.message).toBe('POST /api/v2/admin/events failed: redirected (HTTP 302)');
    expect(err.message).not.toContain(SECRET);
    expect(err.message).not.toContain('cloudflareaccess');
  });

  test('an opaque redirect is a failure too', async () => {
    const opaque = async () => ({ ...reply(0, {}), ok: false, type: 'opaqueredirect' });
    const err = await client(opaque)
      .get('/api/v2/admin/sponsors')
      .catch((e) => e);
    expect(err.message).toBe('GET /api/v2/admin/sponsors failed: redirected (HTTP 0)');
  });

  test('a non-JSON 200 throws without a body excerpt', async () => {
    const html = async () => ({
      ...reply(200, {}),
      json: async () => {
        throw new SyntaxError(`Unexpected token < ${SECRET}`);
      },
    });
    const err = await client(html)
      .get('/api/v2/admin/sponsors')
      .catch((e) => e);
    expect(err.message).toBe('GET /api/v2/admin/sponsors failed: not JSON');
  });

  test('sPath is the /s/ routing link from the event shortcode', async () => {
    const site = fakeSite();
    const manifest = await buildDay(args(site, { accepted: rowsFor('beverly', 2, 0) }));
    expect(manifest.qr.every((q) => q.sPath.startsWith('/s/SC'))).toBe(true);
  });

  test('a null shortcode warns and omits sPath', async () => {
    const site = fakeSite({ noShortcode: true });
    const manifest = await buildDay(args(site, { accepted: [row('beverly', 'private', 10)] }));
    expect(manifest.qr[0]).not.toHaveProperty('sPath');
    expect(manifest.warnings.join('|')).toMatch(/no shortcode for evt_/);
  });

  test("the event create's own warnings are copied, keyed by event id", async () => {
    const site = fakeSite({
      eventWarnings: [{ code: 'SHORTLINK_CREATE_FAILED', message: 'x' }],
    });
    const manifest = await buildDay(args(site, { accepted: [row('beverly', 'private', 10)] }));
    expect(manifest.warnings).toContainEqual(
      expect.stringMatching(/^evt_\d+ SHORTLINK_CREATE_FAILED$/)
    );
  });

  test('the anchor is sent as title and recorded as premium', async () => {
    const site = fakeSite();
    const manifest = await buildDay(args(site, { accepted: [] }));
    const anchor = callsTo(site, 'POST', /^\/api\/v2\/admin\/sponsors$/).find(
      (c) => c.body.name === 'Anchor Co'
    );
    expect(anchor.body.tier).toBe('title');
    expect(manifest.items.find((i) => i.kind === 'sponsor').tier).toBe('premium');
  });

  test('a missing or invalid starts_at sorts last, deterministically', async () => {
    const good = { ...row('beverly', 'private', 10), title: 'good' };
    const none = { ...row('beverly', 'private', 5), title: 'none', starts_at: undefined };
    const junk = { ...row('beverly', 'private', 6), title: 'junk', starts_at: 'not a date' };
    const run = async (accepted) => {
      const site = fakeSite();
      await buildDay(args(site, { accepted, expected: { beverly: 1 } }));
      return callsTo(site, 'POST', /^\/api\/v2\/admin\/events$/).map((c) => c.body.title);
    };
    expect(await run([none, junk, good])).toEqual(['good']);
    expect(await run([junk, good, none])).toEqual(['good']);
  });
});

describe('final review: the end date', () => {
  const bodyFor = async (ends_at) => {
    const site = fakeSite();
    const manifest = await buildDay(
      args(site, { accepted: [{ ...row('beverly', 'private', 10), ends_at }] })
    );
    return { body: callsTo(site, 'POST', /^\/api\/v2\/admin\/events$/)[0].body, manifest };
  };

  test('ends_at is sent as end_date, the Chicago date of the end', async () => {
    // 02:00 UTC on the 11th is 20:00 on the 10th in Chicago
    const { body, manifest } = await bodyFor('2026-11-11T02:00:00Z');
    expect(body.end_date).toBe('2026-11-10');
    expect(body.start_date).toBe('2026-11-10');
    expect(body).not.toHaveProperty('end_time'); // the Worker has no end time field
    expect(manifest.warnings).toEqual([]);
  });

  test('a multi-day event ends on its own Chicago date', async () => {
    const { body } = await bodyFor('2026-11-12T22:00:00-06:00');
    expect(body.end_date).toBe('2026-11-12');
  });

  test('no ends_at sends no end_date', async () => {
    const { body, manifest } = await bodyFor(null);
    expect(body).not.toHaveProperty('end_date');
    expect(manifest.warnings).toEqual([]);
  });

  test.each([
    ['unreadable', 'soon'],
    ['before the start', '2026-11-09T19:00:00-06:00'],
  ])('an ends_at that is %s is not sent, and says so', async (reason, ends_at) => {
    const { body, manifest } = await bodyFor(ends_at);
    expect(body).not.toHaveProperty('end_date');
    expect(manifest.warnings).toHaveLength(1);
    expect(manifest.warnings[0]).toMatch(/^evt_\d+ ends_at not sent: /);
    expect(manifest.warnings[0].endsWith(reason)).toBe(true);
  });
});
