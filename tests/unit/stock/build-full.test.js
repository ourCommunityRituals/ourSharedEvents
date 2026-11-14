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

const BASE = 'https://stg.oursharedevents.com';
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
  // each upload answers its own address (art_<n>.png) instead of one shared one
  distinctUploads = false,
  // PUT /api/v2/admin/sponsors/:id with a logo_url: its HTTP status
  logoStatus = 200,
  // PUT poster-codes: its HTTP status, and (optional) the codes it answers with
  codesStatus = 200,
  codesAnswer,
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
      const key = next('events/up');
      const url = distinctUploads
        ? `/api/v2/uploads/events/x/art_${n}.png`
        : '/api/v2/uploads/events/x/art.png';
      const good = W.upload({ key, url });
      if (uploadFile === undefined) return reply(201, good);
      return reply(201, { ...good, file: uploadFile });
    }
    if (method === 'POST' && path === '/api/v2/admin/sponsors') {
      return reply(201, W.sponsorCreate({ id: next('sp') }));
    }
    if (
      method === 'PUT' &&
      /^\/api\/v2\/admin\/sponsors\/[^/]+$/.test(path) &&
      'logo_url' in body
    ) {
      return logoStatus === 200 ? reply(200, { ok: true }) : reply(logoStatus, { ok: false });
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
    if (method === 'PUT' && /^\/api\/v2\/admin\/events\/[^/]+\/poster-codes$/.test(path)) {
      if (codesStatus !== 200) return reply(codesStatus, { ok: false, code: 'PLAN_LIMIT' });
      const codes = codesAnswer
        ? codesAnswer(body)
        : [
            { kind: 'public', code: `PUB${++n}` },
            ...body.codes.map((c) => ({ kind: c.kind, code: `K${c.kind.slice(0, 3)}${++n}` })),
          ];
      return reply(200, W.posterCodes({ codes }));
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
  test('refuses any base URL but the staging site', () => {
    expect(() =>
      createClient({
        baseUrl: 'https://stg-full.oursharedevents.com',
        fetch: async () => reply(200, {}),
      })
    ).toThrow(/baseUrl/);
    expect(() => client(async () => reply(200, {}))).not.toThrow();
  });

  test('sends the access headers, the bearer key and JSON content type', async () => {
    const site = fakeSite();
    await client(site.fetch).post('/api/v2/admin/events', {
      attendance_mode: 'in_person',
      location: 'Test Hall',
      title: 't',
    });
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

  test('each event opts in to sponsors, or the sponsors it is given would never show (OSE-1900)', async () => {
    // Born red 2026-11-09: failed with the `settings` line taken out of build-full.mjs.
    const site = fakeSite();
    await buildDay(args(site, { accepted: [row('beverly', 'private', 10)] }));
    const body = callsTo(site, 'POST', /^\/api\/v2\/admin\/events$/)[0].body;
    expect(body.settings).toEqual({ useSponsors: true });
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

  test('a local photo (stock/art) is read from disk, never downloaded, and set as the cover', async () => {
    const posts = [
      { id: 'mural', caption: 'x', hashtags: ['typea'], file: '/repo/stock/art/m.jpg' },
    ];
    const artTags = { tags: { typea: 'type-a' } };
    const site = fakeSite();
    const read = [];
    const manifest = await buildDay(
      args(site, {
        accepted: [row('beverly', 'private', 10)],
        posts,
        artTags,
        readFile: async (p) => {
          read.push(p);
          return new Uint8Array([0xff, 0xd8, 0xff]);
        },
      })
    );
    expect(read).toEqual(['/repo/stock/art/m.jpg']);
    expect(site.calls.some((c) => c.external)).toBe(false);
    expect(callsTo(site, 'POST', /\/uploads$/)).toHaveLength(1);
    expect(callsTo(site, 'PUT', /^\/api\/v2\/admin\/events\/evt_/)[0].body).toEqual({
      cover_image_url: '/api/v2/uploads/events/x/art.png',
    });
    expect(manifest.items.some((i) => i.kind === 'upload')).toBe(true);
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

  // Owner 2026-11-10: the stock sponsors show art from the same pool as the stock
  // events, until a real sponsor uploads its own.
  describe('sponsor art from the event art pool', () => {
    const readFile = async () => new Uint8Array([0xff, 0xd8, 0xff]);
    const artTags = { tags: { typea: 'type-a', typeb: 'type-b' } };
    const photo = (id, tag) => ({
      id,
      caption: 'x',
      hashtags: [tag],
      file: `/repo/stock/art/${id}.jpg`,
    });
    const logoCalls = (site) =>
      callsTo(site, 'PUT', /^\/api\/v2\/admin\/sponsors\//).filter((c) => 'logo_url' in c.body);
    // two events, each matching one of two photos, so the pool holds two pictures
    const twoPictures = (site, over = {}) =>
      buildDay(
        args(site, {
          accepted: [
            row('beverly', 'private', 10),
            { ...row('beverly', 'private', 11), event_type_id: 'type-b' },
          ],
          posts: [photo('mural', 'typea'), photo('court', 'typeb')],
          artTags,
          readFile,
          ...over,
        })
      );

    test('every sponsor gets an uploaded event picture as its logo, round-robin in creation order', async () => {
      const site = fakeSite({ distinctUploads: true });
      const manifest = await twoPictures(site);
      const covers = callsTo(site, 'PUT', /^\/api\/v2\/admin\/events\/evt_/).map(
        (c) => c.body.cover_image_url
      );
      expect(new Set(covers).size).toBe(2);
      const sponsorIds = manifest.items.filter((i) => i.kind === 'sponsor').map((i) => i.id);
      expect(logoCalls(site).map((c) => [c.path.split('/').pop(), c.body])).toEqual([
        [sponsorIds[0], { logo_url: covers[0] }],
        [sponsorIds[1], { logo_url: covers[1] }],
        [sponsorIds[2], { logo_url: covers[0] }],
      ]);
      expect(manifest.warnings).toEqual([]);
    });

    test('one picture uploaded for several events counts once: its first upload is the logo', async () => {
      const site = fakeSite({ distinctUploads: true });
      await buildDay(
        args(site, {
          accepted: [row('beverly', 'private', 10), row('beverly', 'private', 11)],
          posts: [photo('mural', 'typea')],
          artTags,
          readFile,
        })
      );
      const covers = callsTo(site, 'PUT', /^\/api\/v2\/admin\/events\/evt_/).map(
        (c) => c.body.cover_image_url
      );
      expect(covers).toHaveLength(2);
      expect(covers[0]).not.toBe(covers[1]);
      expect(logoCalls(site).map((c) => c.body.logo_url)).toEqual([
        covers[0],
        covers[0],
        covers[0],
      ]);
    });

    test('no picture uploaded: no sponsor is given a logo, and the build says nothing of it', async () => {
      const site = fakeSite();
      const manifest = await buildDay(args(site, { accepted: rowsFor('beverly', 2, 1) }));
      expect(logoCalls(site)).toEqual([]);
      expect(manifest.warnings).toEqual([]);
    });

    test('a logo the Worker refuses is named, and the other sponsors still get theirs', async () => {
      const site = fakeSite({ distinctUploads: true, logoStatus: 400 });
      const manifest = await twoPictures(site);
      expect(logoCalls(site)).toHaveLength(3);
      expect(manifest.warnings.filter((w) => /^sponsor art not set for sp_/.test(w))).toHaveLength(
        3
      );
    });

    test('the logos are set after every placement, so a refused logo cannot cost a placement', async () => {
      const site = fakeSite({ distinctUploads: true });
      await twoPictures(site);
      const sponsorPuts = callsTo(site, 'PUT', /^\/api\/v2\/admin\/sponsors\//);
      const firstLogo = sponsorPuts.findIndex((c) => 'logo_url' in c.body);
      expect(firstLogo).toBeGreaterThan(0);
      expect(sponsorPuts.slice(firstLogo).every((c) => 'logo_url' in c.body)).toBe(true);
    });
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

// CCR 2026-11-07 group 2: an id the admin API hands back goes into SQL and R2 keys
// at purge time, so it is checked before it is recorded. A bad one stops the build,
// with what was made so far on record for the purge.
describe('buildDay validates the ids the admin API returns', () => {
  const tamper = (match, patch) => {
    const site = fakeSite();
    const base = site.fetch;
    site.fetch = async (url, init = {}) => {
      const res = await base(url, init);
      const path = new URL(String(url)).pathname;
      if ((init.method || 'GET') !== 'POST' || !match.test(path)) return res;
      const body = await res.json();
      return { ...res, json: async () => ({ ...body, ...patch(body) }) };
    };
    return site;
  };
  test.each([
    ['an event id with a quote', /^\/api\/v2\/admin\/events$/, () => ({ id: "evt_1'); --" })],
    ['a missing event id', /^\/api\/v2\/admin\/events$/, () => ({ id: undefined })],
    ['a sponsor id with a space', /^\/api\/v2\/admin\/sponsors$/, () => ({ id: 'sp 1' })],
    ['a poster id that is a number', /\/poster-deployments$/, () => ({ id: 7 })],
    ['a QR token that climbs a path', /\/poster-deployments$/, () => ({ qr_token: '../admin' })],
    ['a shortcode with a slash', /^\/api\/v2\/admin\/events$/, () => ({ shortcode: 'a/b' })],
  ])('%s stops the build, with its manifest so far', async (_name, re, patch) => {
    const site = tamper(re, patch);
    const err = await buildDay(args(site, { client: client(site.fetch) })).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/unsafe/);
    expect(err.manifest).toBeDefined();
    for (const i of err.manifest.items) expect(String(i.id)).toMatch(/^[A-Za-z0-9_:./-]{1,200}$/);
  });
});

describe('createClient: every admin call has a deadline (CCR 2026-11-07 R-11)', () => {
  test('a call that never answers fails as timed out, without a secret', async () => {
    const hanging = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error(`aborted ${SECRET}`)));
      });
    const err = await client(hanging, { timeoutMs: 5 })
      .get('/api/v2/events')
      .catch((e) => e);
    expect(err.message).toBe('GET /api/v2/events failed: timed out');
  }, 5000);
});

describe('poster showcase (owner 2026-11-08): code sets and art orientation', () => {
  const CODE_SETS = {
    default: 'events',
    types: { 'type-reg': 'events+registration', 'type-don': 'events+registration+donation' },
    donateUrl: 'https://example.org/donate',
  };
  const LAND = {
    id: 'land',
    caption: '',
    hashtags: ['land'],
    file: '/x/land.jpg',
    orientation: 'landscape',
  };
  const PORT = {
    id: 'port',
    caption: '',
    hashtags: ['port'],
    file: '/x/port.jpg',
    orientation: 'portrait',
  };
  // every type fits only the landscape photo, so each portrait is the build's doing
  const ART = { tags: { land: ['type-a', 'type-reg', 'type-don'], port: [] } };
  const typed = () => [
    { ...row('beverly', 'private', 10, 0), event_type_id: 'type-a' },
    { ...row('beverly', 'private', 11, 1), event_type_id: 'type-a' },
    { ...row('beverly', 'private', 12, 2), event_type_id: 'type-reg' },
    { ...row('beverly', 'private', 13, 3), event_type_id: 'type-reg' },
    { ...row('beverly', 'private', 14, 4), event_type_id: 'type-don' },
    { ...row('beverly', 'private', 15, 5), event_type_id: 'type-don' },
  ];
  const run = (site, over = {}) =>
    buildDay(
      args(site, {
        accepted: typed(),
        expected: { beverly: 6 },
        posts: [LAND, PORT],
        artTags: ART,
        codeSets: CODE_SETS,
        readFile: async () => new Uint8Array([1]),
        ...over,
      })
    );
  const codePuts = (site) => callsTo(site, 'PUT', /\/poster-codes$/);

  test('events saves nothing; registration saves REGISTER; donation adds the https link', async () => {
    const site = fakeSite();
    await run(site);
    const bodies = codePuts(site).map((c) => c.body);
    expect(bodies).toEqual([
      { codes: [{ kind: 'register' }] },
      { codes: [{ kind: 'register' }] },
      {
        codes: [
          { kind: 'register' },
          { kind: 'donation', target_url: 'https://example.org/donate' },
        ],
      },
      {
        codes: [
          { kind: 'register' },
          { kind: 'donation', target_url: 'https://example.org/donate' },
        ],
      },
    ]);
  });

  test('the codes are saved through the organizer route, after the poster is placed', async () => {
    const site = fakeSite();
    await run(site);
    const paths = site.calls.map((c) => `${c.method} ${c.path}`);
    const firstPut = paths.findIndex((p) => /\/poster-codes$/.test(p));
    const firstPoster = paths.findIndex((p) => /\/poster-deployments$/.test(p));
    expect(firstPoster).toBeGreaterThan(-1);
    expect(firstPut).toBeGreaterThan(firstPoster);
  });

  test('each QR entry records its set, its art orientation and its saved /s codes', async () => {
    const site = fakeSite();
    const m = await run(site);
    expect(m.qr.map((q) => q.set)).toEqual([
      'events',
      'events',
      'events+registration',
      'events+registration',
      'events+registration+donation',
      'events+registration+donation',
    ]);
    for (const q of m.qr) expect(['landscape', 'portrait']).toContain(q.orientation);
    const don = m.qr.filter((q) => q.set === 'events+registration+donation');
    for (const q of don) {
      expect(q.codes.register).toMatch(/^\/s\/Kreg\d+$/);
      expect(q.codes.donation).toMatch(/^\/s\/Kdon\d+$/);
    }
    const ev = m.qr.filter((q) => q.set === 'events');
    for (const q of ev) expect(q.codes).toEqual({});
  });

  test('every set shows both orientations, though the tags fit only the landscape photo', async () => {
    const site = fakeSite();
    const m = await run(site);
    const pairs = new Set(m.qr.map((q) => `${q.set} ${q.orientation}`));
    expect(pairs.size).toBe(6);
    expect(m.warnings.filter((w) => /showcase/.test(w))).toEqual([]);
  });

  // ── failure cases ──
  test('a refused save (403 PLAN_LIMIT) is named per event and the build goes on', async () => {
    const site = fakeSite({ codesStatus: 403 });
    const m = await run(site);
    expect(m.items.filter((i) => i.kind === 'event')).toHaveLength(6);
    const named = m.warnings.filter((w) => /^poster codes not saved for evt_\d+: .*403/.test(w));
    expect(named).toHaveLength(4);
    for (const q of m.qr) expect(q.codes).toEqual({});
  });

  test('an answer without a code it was asked to save is named, never recorded', async () => {
    const site = fakeSite({
      codesAnswer: () => [
        { kind: 'public', code: 'PUB1' },
        { kind: 'register', code: 'REG1' },
      ],
    });
    const m = await run(site);
    const don = m.qr.filter((q) => q.set === 'events+registration+donation');
    for (const q of don) {
      expect(q.codes).toEqual({ register: '/s/REG1' });
      expect(m.warnings).toContain(`poster code donation missing for ${q.eventId}`);
    }
  });

  test('an unsafe code in the answer is named, never recorded as a path', async () => {
    const site = fakeSite({
      codesAnswer: (body) => body.codes.map((c) => ({ kind: c.kind, code: '../admin?x=1' })),
    });
    const m = await run(site);
    for (const q of m.qr) expect(Object.values(q.codes)).toEqual([]);
    expect(m.warnings.some((w) => /poster code register missing for evt_/.test(w))).toBe(true);
  });

  test('a pair the stock cannot show is named in the warnings', async () => {
    const site = fakeSite();
    const m = await run(site, { posts: [LAND] });
    expect(m.warnings).toEqual(
      expect.arrayContaining([
        'showcase pair not shown: events portrait',
        'showcase pair not shown: events+registration portrait',
        'showcase pair not shown: events+registration+donation portrait',
      ])
    );
  });

  test('an art upload that fails leaves no orientation recorded', async () => {
    const site = fakeSite({ failUpload: true });
    const m = await run(site);
    for (const q of m.qr) expect(q.orientation).toBeNull();
  });

  test('without code sets the build saves no codes (as before)', async () => {
    const site = fakeSite();
    await run(site, { codeSets: undefined });
    expect(codePuts(site)).toEqual([]);
  });
});
