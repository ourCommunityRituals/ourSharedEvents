let createClient;
let buildDay;
let sponsorTier;
beforeAll(async () => {
  ({ createClient } = await import('../../../scripts/stock/client.mjs'));
  ({ buildDay, sponsorTier } = await import('../../../scripts/stock/build-full.mjs'));
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
function fakeSite({ failUpload = false, artStatus = 200 } = {}) {
  const calls = [];
  let n = 0;
  const next = (p) => `${p}_${++n}`;
  const placementOf = new Map();
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (!String(url).startsWith(BASE)) {
      calls.push({ method, path: String(url), external: true });
      return reply(artStatus, {}, { 'content-type': 'image/png' });
    }
    const path = String(url).slice(BASE.length);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, path, body, headers: init.headers });
    if (method === 'POST' && path === '/api/v2/admin/events') {
      return reply(201, { id: next('evt') });
    }
    if (method === 'POST' && path.endsWith('/poster-deployments')) {
      return reply(201, { id: next('pd'), qr_token: next('qrt') });
    }
    if (method === 'POST' && path.endsWith('/short-links')) {
      return reply(200, { code: 'ABC234', links: { share: '/e/ABC234' } });
    }
    if (method === 'POST' && path.endsWith('/uploads')) {
      if (failUpload) return reply(500, {});
      return reply(201, { key: next('events/up'), url: '/api/v2/uploads/events/x/art.png' });
    }
    if (method === 'POST' && path === '/api/v2/admin/sponsors') {
      return reply(201, { id: next('sp') });
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
      return reply(200, { items });
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
  { name: 'Anchor Co', address: '2 Main St', node: 'beverly', anchor: true },
  { name: 'Regional Co', address: '3 Main St', node: 'beverly', anchor: false },
  { name: 'Corner Shop', address: '4 Main St', node: 'beverly', anchor: false },
];

const args = (site, over = {}) => ({
  client: client(site.fetch),
  accepted: rowsFor('beverly', 10, 5),
  businesses,
  regionals: { regionals: ['Regional Co'] },
  posts: [],
  artTags: { tags: {} },
  targets: { perNode: 12 },
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
  test('15 accepted rows with perNode 12: all private, then the soonest public', async () => {
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

  test('the quantity comes from targets, not the code', async () => {
    const site = fakeSite();
    const manifest = await buildDay(
      args(site, { accepted: rowsFor('beverly', 6, 5), targets: { perNode: 3 } })
    );
    expect(callsTo(site, 'POST', /^\/api\/v2\/admin\/events$/)).toHaveLength(3);
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
    expect(manifest.qr[0]).toMatchObject({ node: 'beverly', sPath: '/e/ABC234' });
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

  test('one sponsor per business with the mapped tier, premium for the anchor', async () => {
    const site = fakeSite();
    await buildDay(args(site, { accepted: [] }));
    const sponsors = callsTo(site, 'POST', /^\/api\/v2\/admin\/sponsors$/);
    expect(sponsors.map((c) => c.body.name)).toEqual(['Anchor Co', 'Regional Co', 'Corner Shop']);
    expect(sponsors.every((c) => c.body.brand_id === 'root')).toBe(true);
    // the Worker's own vocabulary, one distinct word per stock tier
    expect(new Set(sponsors.map((c) => c.body.tier)).size).toBe(3);
  });

  test('one placement per event, for the node anchor, and its id goes to acceptSql', async () => {
    const site = fakeSite();
    const manifest = await buildDay(args(site, { accepted: rowsFor('beverly', 2, 1) }));
    const anchorId = manifest.items.find((i) => i.kind === 'sponsor').id;
    const attaches = callsTo(site, 'PUT', /^\/api\/v2\/admin\/sponsors\//);
    expect(attaches).toHaveLength(3);
    expect(attaches.every((c) => c.path.endsWith(`/${anchorId}`))).toBe(true);
    const placements = manifest.items.filter((i) => i.kind === 'placement');
    expect(placements).toHaveLength(3);
    expect(manifest.acceptSql).toEqual(placements.map((p) => p.id));
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
    expect(kinds).toEqual({ sponsor: 3, event: 2, poster: 2, placement: 2 });
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
