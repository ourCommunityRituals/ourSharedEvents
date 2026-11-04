/* eslint-disable security/detect-non-literal-fs-filename -- reads fixed repo files and this folder's own test files */
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

let checkNodes;
let MAP_GATE;
beforeAll(async () => {
  ({ checkNodes, MAP_GATE } = await import('../../../scripts/stock/check-full.mjs'));
});

const ROOT = path.join(__dirname, '../../..');
const readJson = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
// The one source of the quantity. No count for the live site is written in this file.
const targets = readJson('stock/targets.json');
const PER_NODE = targets.perNode;
const { nodes } = readJson('stock/nodes.json');
const node = (id) => nodes.find((n) => n.id === id);

const BASE = 'https://stg-full.oursharedevents.com';
const TODAY = '2026-11-04';
const DAY_AFTER = '2026-11-05';

const plusDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// ── A day's manifest and a fake site that serves it ─────────────────────────
// events: { [nodeId]: count }. Every event is listed in its node's first cell.
function day(events, { premium = true } = {}) {
  const manifest = { date: TODAY, items: [], qr: [], acceptSql: [], short: {}, warnings: [] };
  const listed = [];
  for (const [nodeId, n] of Object.entries(events)) {
    manifest.items.push({
      kind: 'sponsor',
      id: `sp_${nodeId}`,
      node: nodeId,
      tier: premium ? 'premium' : 'mid',
    });
    for (let i = 0; i < n; i++) {
      const id = `evt_${nodeId}_${i}`;
      manifest.items.push({ kind: 'event', id, node: nodeId });
      manifest.items.push({ kind: 'poster', id: `pd_${id}`, node: nodeId });
      manifest.qr.push({ eventId: id, node: nodeId, qPath: `/q/qrt_${id}`, sPath: `/s/SC_${id}` });
      listed.push({
        id,
        h3_res7: node(nodeId).cells[0],
        start_date: DAY_AFTER,
        cover_image_url: `/api/v2/uploads/events/${id}/art.png`,
      });
    }
  }
  return { manifest, listed };
}

const html = (body) => ({
  status: 200,
  ok: true,
  headers: { get: () => 'text/html' },
  text: async () => `<!doctype html><html><body>${body}</body></html>`,
});
const redirect = (location) => ({
  status: 302,
  ok: false,
  headers: { get: (k) => (k.toLowerCase() === 'location' ? location : null) },
  text: async () => '',
});
const status = (code) => ({
  status: code,
  ok: code >= 200 && code < 300,
  headers: { get: () => null },
  text: async () => '',
});

const MAP_FIRST =
  '<section data-testid="landing-area"></section><section data-testid="landing-doors"></section>';
const DOORS_FIRST =
  '<section data-testid="landing-doors"></section><section data-testid="landing-area"></section>';

function site({ listed, override = {}, listFails = false }) {
  const calls = [];
  const client = {
    get: async (p) => {
      calls.push({ via: 'client', path: p });
      if (listFails) throw new Error('GET /api/v2/events failed: 503');
      return { ok: true, items: listed };
    },
  };
  const fetchPublic = async (url, init) => {
    calls.push({ via: 'public', url, init });
    const p = String(url).slice(BASE.length);
    if (override[p]) return override[p];
    if (p.startsWith('/?zip=')) return html(MAP_FIRST);
    let m = p.match(/^\/q\/qrt_(.+)$/);
    if (m) return redirect(`${BASE}/events/${m[1]}?type=register&deployment=pd_${m[1]}`);
    m = p.match(/^\/s\/SC_(.+)$/);
    if (m) return redirect(`${BASE}/events/${m[1]}`);
    if (/^\/events\/[^/]+$/.test(p)) {
      return html('<section data-testid="pre-sponsor-strip"></section>');
    }
    if (p.startsWith('/api/v2/uploads/')) return status(200);
    return status(404);
  };
  return { client, fetchPublic, calls };
}

const run = (s, manifest, over = {}) =>
  checkNodes({
    client: s.client,
    fetchPublic: s.fetchPublic,
    manifest,
    nodes,
    today: TODAY,
    targets,
    sleep: async () => {},
    ...over,
  });

describe('checkNodes: the count', () => {
  test('exactly perNode of the day’s events listed in the node’s own cells passes', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const r = await run(site({ listed }), manifest);
    expect(r.beverly).toEqual({
      pass: true,
      count: PER_NODE,
      expected: PER_NODE,
      totalListed: PER_NODE,
      reasons: [],
    });
  });

  test('one short of perNode fails with the count and the expected number', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE - 1 });
    const r = await run(site({ listed }), manifest);
    expect(r.beverly.pass).toBe(false);
    expect(r.beverly.count).toBe(PER_NODE - 1);
    expect(r.beverly.expected).toBe(PER_NODE);
    expect(r.beverly.reasons).toContain(`count:${PER_NODE - 1}/${PER_NODE}`);
  });

  test('one short plus 5 of a neighbour’s events in its cells still fails: neighbours never count', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE - 1, 'mount-greenwood': 5 });
    // the neighbour's events sit in Beverly's cell (a shared border cell, say)
    for (const e of listed) {
      if (e.id.includes('mount-greenwood')) e.h3_res7 = node('beverly').cells[0];
    }
    const r = await run(site({ listed }), manifest);
    expect(r.beverly.pass).toBe(false);
    expect(r.beverly.count).toBe(PER_NODE - 1);
    expect(r.beverly.totalListed).toBe(PER_NODE - 1 + 5);
  });

  test('perNode stock events plus 3 hand-made ones (not in the manifest) passes', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    for (let i = 0; i < 3; i++) {
      listed.push({ id: `hand_${i}`, h3_res7: node('beverly').cells[0], start_date: DAY_AFTER });
    }
    const r = await run(site({ listed }), manifest);
    expect(r.beverly.pass).toBe(true);
    expect(r.beverly.count).toBe(PER_NODE);
    expect(r.beverly.totalListed).toBe(PER_NODE + 3);
  });

  test('a stock event listed outside the node’s cells is a cell-mismatch and is not counted', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const outside = nodes.flatMap((n) => n.cells).find((c) => !node('beverly').cells.includes(c));
    listed[0].h3_res7 = outside;
    const r = await run(site({ listed }), manifest);
    expect(r.beverly.pass).toBe(false);
    expect(r.beverly.count).toBe(PER_NODE - 1);
    expect(r.beverly.reasons).toContain(`cell-mismatch:${listed[0].id}`);
  });

  test('a stock event outside the 90-day window, or not listed at all, is not counted', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    listed[0].start_date = plusDays(TODAY, 91);
    const gone = listed.pop();
    const r = await run(site({ listed }), manifest);
    expect(r.beverly.count).toBe(PER_NODE - 2);
    expect(r.beverly.reasons).toContain(`not-listed:${listed[0].id}`);
    expect(r.beverly.reasons).toContain(`not-listed:${gone.id}`);
  });

  test('the window holds today and today + 90', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    listed[0].start_date = TODAY;
    listed[1].start_date = plusDays(TODAY, 90);
    const r = await run(site({ listed }), manifest);
    expect(r.beverly.pass).toBe(true);
  });

  test('perNode below the map gate is refused before any request', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const s = site({ listed });
    await expect(run(s, manifest, { targets: { perNode: MAP_GATE - 1 } })).rejects.toThrow(
      'perNode below the map gate of 10'
    );
    expect(s.calls).toEqual([]);
  });

  test('every node gets a result; one node failing never fails another', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE, 'oak-lawn': PER_NODE - 1 });
    const r = await run(site({ listed }), manifest);
    expect(Object.keys(r).sort()).toEqual(nodes.map((n) => n.id).sort());
    expect(r.beverly.pass).toBe(true);
    expect(r['oak-lawn'].pass).toBe(false);
    expect(r['blue-island']).toMatchObject({ pass: false, count: 0, expected: PER_NODE });
  });

  test('an unreadable events list fails every node and throws nothing', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const r = await run(site({ listed, listFails: true }), manifest);
    expect(r.beverly.pass).toBe(false);
    expect(r.beverly.reasons).toContain('events-list-unreadable');
  });
});

describe('checkNodes: anchor, zip, QR, pages and art', () => {
  test('a node with no premium sponsor fails with no-anchor', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE }, { premium: false });
    const r = await run(site({ listed }), manifest);
    expect(r.beverly.pass).toBe(false);
    expect(r.beverly.reasons).toEqual(['no-anchor']);
  });

  test('the zip view must lead with the area, before the doors', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const zip = node('beverly').zips[0];
    const r = await run(
      site({ listed, override: { [`/?zip=${zip}`]: html(DOORS_FIRST) } }),
      manifest
    );
    expect(r.beverly.pass).toBe(false);
    expect(r.beverly.reasons).toEqual([`zip-not-map-first:${zip}`]);
  });

  test('an sPath answering 200 fails', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const s = site({ listed, override: { [manifest.qr[0].sPath]: html('') } });
    const r = await run(s, manifest);
    expect(r.beverly.pass).toBe(false);
    expect(r.beverly.reasons).toEqual([`shortlink-broken:${manifest.qr[0].eventId}`]);
  });

  test('an sPath redirecting to another event fails', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const s = site({
      listed,
      override: { [manifest.qr[0].sPath]: redirect(`${BASE}/events/other`) },
    });
    const r = await run(s, manifest);
    expect(r.beverly.reasons).toEqual([`shortlink-broken:${manifest.qr[0].eventId}`]);
  });

  test('a missing sPath (no shortcode) fails with no-shortcode', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    delete manifest.qr[0].sPath;
    const r = await run(site({ listed }), manifest);
    expect(r.beverly.pass).toBe(false);
    expect(r.beverly.reasons).toEqual([`no-shortcode:${manifest.qr[0].eventId}`]);
  });

  test('a qPath sent home (an unknown token) fails', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const s = site({ listed, override: { [manifest.qr[0].qPath]: redirect('/') } });
    const r = await run(s, manifest);
    expect(r.beverly.reasons).toEqual([`qr-broken:${manifest.qr[0].eventId}`]);
  });

  test.each([['qPath'], ['sPath']])(
    'a %s that would leave the site is refused and never fetched',
    async (field) => {
      for (const bad of [
        '.evil.example/x',
        '//evil.example/x',
        'https://evil.example/x',
        '@evil.example/x',
      ]) {
        const { manifest, listed } = day({ beverly: PER_NODE });
        manifest.qr[0][field] = bad;
        const s = site({ listed });
        const r = await run(s, manifest);
        expect(r.beverly.reasons, bad).toEqual([`bad-path:${manifest.qr[0].eventId}`]);
        const leaked = s.calls.filter(
          (c) => c.via === 'public' && !String(c.url).startsWith(`${BASE}/`)
        );
        expect(leaked, bad).toEqual([]);
        expect(
          s.calls.some((c) => String(c.url).includes('evil')),
          bad
        ).toBe(false);
        // every other read still happens: exactly one fewer than a clean run
        const clean = day({ beverly: PER_NODE });
        const cs = site({ listed: clean.listed });
        await run(cs, clean.manifest);
        const reads = (x) => x.calls.filter((c) => c.via === 'public').length;
        expect(reads(s), bad).toBe(reads(cs) - 1);
      }
    }
  );

  test('a missing qPath fails with no-qr', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    delete manifest.qr[0].qPath;
    const r = await run(site({ listed }), manifest);
    expect(r.beverly.reasons).toEqual([`no-qr:${manifest.qr[0].eventId}`]);
  });

  test('an event with no QR entry fails with no-qr', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const dropped = manifest.qr.shift();
    const r = await run(site({ listed }), manifest);
    expect(r.beverly.reasons).toEqual([`no-qr:${dropped.eventId}`]);
  });

  test('an event page without the sponsor strip fails', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const id = listed[0].id;
    const r = await run(
      site({ listed, override: { [`/events/${id}`]: html('<h1>x</h1>') } }),
      manifest
    );
    expect(r.beverly.reasons).toEqual([`no-sponsor-strip:${id}`]);
  });

  test('a broken art URL fails; an event with no art does not', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const broken = listed[0];
    delete listed[1].cover_image_url;
    const r = await run(
      site({ listed, override: { [broken.cover_image_url]: status(404) } }),
      manifest
    );
    expect(r.beverly.reasons).toEqual([`art-broken:${broken.id}`]);
  });

  test('art on another host is refused, never fetched', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    listed[0].cover_image_url = 'https://elsewhere.example/a.png';
    const s = site({ listed });
    const r = await run(s, manifest);
    expect(r.beverly.reasons).toEqual([`art-off-site:${listed[0].id}`]);
    expect(s.calls.some((c) => String(c.url).includes('elsewhere'))).toBe(false);
  });

  test('a public read that throws is a reason, not a crash', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const s = site({ listed });
    const real = s.fetchPublic;
    s.fetchPublic = async (url, init) => {
      if (String(url).endsWith(manifest.qr[0].qPath)) throw new Error('socket hang up');
      return real(url, init);
    };
    const r = await run(s, manifest);
    expect(r.beverly.reasons).toEqual([`qr-broken:${manifest.qr[0].eventId}`]);
  });

  test('public reads go only to the full site, with no headers and redirect: manual', async () => {
    const { manifest, listed } = day({ beverly: PER_NODE });
    const s = site({ listed });
    await run(s, manifest);
    const pub = s.calls.filter((c) => c.via === 'public');
    expect(pub.length).toBeGreaterThan(0);
    for (const c of pub) {
      expect(String(c.url).startsWith(`${BASE}/`)).toBe(true);
      expect(c.init).toEqual({ method: 'GET', redirect: 'manual' });
    }
    expect(s.calls.filter((c) => c.via === 'client').map((c) => c.path)).toEqual([
      '/api/v2/events',
    ]);
  });
});

describe('no live count is written in the stock tests', () => {
  // A check result's numbers come from stock/targets.json and the manifest, never a literal.
  test('no count, expected or totalListed is compared to a numeric literal', () => {
    const dir = __dirname;
    const offenders = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.test.js'))) {
      const text = readFileSync(path.join(dir, f), 'utf8');
      // a live-sized count has two digits or more (the map gate is 10)
      const patterns = [
        /\b(?:count|expected|totalListed)\s*:\s*\d{2,}/g,
        /\.(?:count|expected|totalListed)\)\s*\.\s*(?:toBe|toEqual)\(\s*\d{2,}/g,
        /`count:\d{2,}/g,
      ];
      for (const re of patterns) for (const m of text.matchAll(re)) offenders.push(`${f}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  test('the check and purge tests pass no literal perNode', () => {
    for (const f of ['check-full.test.js', 'purge-full.test.js']) {
      const text = readFileSync(path.join(__dirname, f), 'utf8');
      expect(text.match(/perNode\s*:\s*\d/g), f).toBeNull();
    }
  });
});
