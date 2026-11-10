/* eslint-disable security/detect-non-literal-fs-filename -- reads fixed repo files and this folder's own test files */
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const W = require('./worker-bodies');

let checkNodes;
let MAP_GATE;
let EXPECTED;
let PER_NODE;
beforeAll(async () => {
  ({ checkNodes, MAP_GATE } = await import('../../../scripts/stock/check-full.mjs'));
  const { expectedByNode } = await import('../../../scripts/stock/seed.mjs');
  EXPECTED = expectedByNode(
    readJson('stock/seed/seed.json'),
    nodes.map((n) => n.id)
  );
  PER_NODE = EXPECTED[A];
});

const ROOT = path.join(__dirname, '../../..');
const readJson = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
// The one source of the quantity is the committed seed (EXPECTED, set above).
// No count for the live site is written in this file.
const { nodes } = readJson('stock/nodes.json');
const node = (id) => nodes.find((n) => n.id === id);
// A populated node, and the node the owner keeps empty (2026-11-05).
const A = 'evergreen-park';
const EMPTY = 'mount-greenwood';

const BASE = 'https://stg.oursharedevents.com';
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
// What the Cloudflare edge answers a challenged read: the Worker never runs. The
// cf-ray header names the request in the dashboard's Security Events.
const RAY = 'a56c65f64daac071-ORD';
const challengeWith = (ray) => ({
  status: 403,
  ok: false,
  headers: {
    get: (k) => {
      const key = k.toLowerCase();
      if (key === 'cf-mitigated') return 'challenge';
      if (key === 'cf-ray') return ray;
      return null;
    },
  },
  text: async () => '<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>',
});
const challenge = challengeWith(RAY);

const MAP_FIRST =
  '<section data-testid="landing-area"></section><section data-testid="landing-doors"></section>';
const DOORS_FIRST =
  '<section data-testid="landing-doors"></section><section data-testid="landing-area"></section>';

// An event page's sponsor strip as pages.ts renders it: one sponsor as art.
const THUMB = '/api/v2/sponsors/sp_x/logo?slot=sidebar';
const thumbTag = (src) =>
  `<img class="ose-sponsor-thumb" data-testid="sponsor-thumb" src="${src}" alt="X" loading="lazy">`;
const STRIP_WITH_ART = `<section data-testid="pre-sponsor-strip">${thumbTag(THUMB.replace(/&/g, '&amp;'))}</section>`;
const STRIP_NAMES_ONLY =
  '<section data-testid="pre-sponsor-strip"><a href="/sponsors/sp_x">X</a></section>';

function site({ listed, override = {}, listFails = false }) {
  const calls = [];
  const client = {
    get: async (p) => {
      calls.push({ via: 'client', path: p });
      if (listFails) throw new Error('GET /api/v2/events failed: 503');
      return W.publicEvents(listed);
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
      return html(STRIP_WITH_ART);
    }
    if (p.startsWith('/api/v2/uploads/')) return status(200);
    if (p.startsWith('/api/v2/sponsors/')) return status(200);
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
    expected: EXPECTED,
    sleep: async () => {},
    ...over,
  });

describe('checkNodes: the count', () => {
  test('exactly its seed count of the day’s events listed in the node’s own cells passes', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const r = await run(site({ listed }), manifest);
    expect(r[A]).toEqual({
      pass: true,
      count: PER_NODE,
      expected: PER_NODE,
      totalListed: PER_NODE,
      reasons: [],
    });
  });

  test('one short of its seed count fails with the count and the expected number', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE - 1 });
    const r = await run(site({ listed }), manifest);
    expect(r[A].pass).toBe(false);
    expect(r[A].count).toBe(PER_NODE - 1);
    expect(r[A].expected).toBe(PER_NODE);
    expect(r[A].reasons).toContain(`count:${PER_NODE - 1}/${PER_NODE}`);
  });

  test('one short plus 5 of a neighbour’s events in its cells still fails: neighbours never count', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE - 1, 'oak-lawn': 5 });
    // the neighbour's events sit in this node's cell (a shared border cell, say)
    for (const e of listed) {
      if (e.id.includes('oak-lawn')) e.h3_res7 = node(A).cells[0];
    }
    const r = await run(site({ listed }), manifest);
    expect(r[A].pass).toBe(false);
    expect(r[A].count).toBe(PER_NODE - 1);
    expect(r[A].totalListed).toBe(PER_NODE - 1 + 5);
  });

  test('its seed count of stock events plus 3 hand-made ones (not in the manifest) passes', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    for (let i = 0; i < 3; i++) {
      listed.push({ id: `hand_${i}`, h3_res7: node(A).cells[0], start_date: DAY_AFTER });
    }
    const r = await run(site({ listed }), manifest);
    expect(r[A].pass).toBe(true);
    expect(r[A].count).toBe(PER_NODE);
    expect(r[A].totalListed).toBe(PER_NODE + 3);
  });

  test('a stock event listed outside the node’s cells is a cell-mismatch and is not counted', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const outside = nodes.flatMap((n) => n.cells).find((c) => !node(A).cells.includes(c));
    listed[0].h3_res7 = outside;
    const r = await run(site({ listed }), manifest);
    expect(r[A].pass).toBe(false);
    expect(r[A].count).toBe(PER_NODE - 1);
    expect(r[A].reasons).toContain(`cell-mismatch:${listed[0].id}`);
  });

  test('a stock event outside the 90-day window, or not listed at all, is not counted', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    listed[0].start_date = plusDays(TODAY, 91);
    const gone = listed.pop();
    const r = await run(site({ listed }), manifest);
    expect(r[A].count).toBe(PER_NODE - 2);
    expect(r[A].reasons).toContain(`not-listed:${listed[0].id}`);
    expect(r[A].reasons).toContain(`not-listed:${gone.id}`);
  });

  test('the window holds today and today + 90', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    listed[0].start_date = TODAY;
    listed[1].start_date = plusDays(TODAY, 90);
    const r = await run(site({ listed }), manifest);
    expect(r[A].pass).toBe(true);
  });

  // Owner 2026-11-06: a place may hold fewer than the map gate (Auburn Gresham 8).
  test('a place under the map gate is checked on its count; its landing-map check is skipped', async () => {
    const under = MAP_GATE - 1;
    const { manifest, listed } = day({ [A]: under });
    const zip = node(A).zips[0];
    const r = await run(
      site({ listed, override: { [`/?zip=${zip}`]: html(DOORS_FIRST) } }),
      manifest,
      { expected: { ...EXPECTED, [A]: under } }
    );
    expect(r[A]).toMatchObject({ pass: true, count: under, expected: under, reasons: [] });
    expect(r[A].skipped).toEqual(['landing-map']);
  });

  test('a place under the map gate still fails one short of its total', async () => {
    const under = MAP_GATE - 1;
    const { manifest, listed } = day({ [A]: under - 1 });
    const r = await run(site({ listed }), manifest, { expected: { ...EXPECTED, [A]: under } });
    expect(r[A].pass).toBe(false);
    expect(r[A].reasons).toEqual([`count:${under - 1}/${under}`]);
  });

  test('a node with no expected count is refused before any request', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const s = site({ listed });
    const partial = { ...EXPECTED };
    delete partial[A];
    await expect(run(s, manifest, { expected: partial })).rejects.toThrow(
      `no expected count for ${A}`
    );
    await expect(run(s, manifest, { expected: undefined })).rejects.toThrow(
      'expected counts are required'
    );
    expect(s.calls).toEqual([]);
  });

  test('every node gets a result; one node failing never fails another', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE, 'oak-lawn': EXPECTED['oak-lawn'] - 1 });
    const r = await run(site({ listed }), manifest);
    expect(Object.keys(r).sort()).toEqual(nodes.map((n) => n.id).sort());
    expect(r[A].pass).toBe(true);
    expect(r['oak-lawn'].pass).toBe(false);
    expect(r['blue-island']).toMatchObject({
      pass: false,
      count: 0,
      expected: EXPECTED['blue-island'],
    });
  });

  test('an unreadable events list fails every node and throws nothing', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const r = await run(site({ listed, listFails: true }), manifest);
    expect(r[A].pass).toBe(false);
    expect(r[A].reasons).toContain('events-list-unreadable');
  });
});

describe('checkNodes: a node expected to hold 0 (owner, 2026-11-05)', () => {
  // Every populated node with exactly its seed count, as on a good load.
  const fullDay = () => day(Object.fromEntries(Object.entries(EXPECTED).filter(([, n]) => n > 0)));
  const populatedCells = () =>
    new Set(nodes.filter((n) => EXPECTED[n.id] > 0).flatMap((n) => n.cells));

  test('the committed seed expects the empty node to hold 0', () => {
    expect(EXPECTED[EMPTY]).toBe(0);
  });

  test('passes with no stock event in its cells, and its landing map is never read', async () => {
    const { manifest, listed } = fullDay();
    const s = site({ listed });
    const r = await run(s, manifest);
    expect(r[EMPTY]).toEqual({
      pass: true,
      count: 0,
      expected: 0,
      totalListed: 0,
      reasons: [],
      skipped: ['landing-map'],
    });
    for (const n of nodes) if (EXPECTED[n.id] > 0) expect(r[n.id].pass, n.id).toBe(true);
    const zip = node(EMPTY).zips[0];
    expect(s.calls.some((c) => String(c.url || '').includes(`zip=${zip}`))).toBe(false);
  });

  test('fails when a stock event is listed in a cell that is its own alone', async () => {
    const { manifest, listed } = fullDay();
    const own = node(EMPTY).cells.find((c) => !populatedCells().has(c));
    expect(own).toBeDefined();
    listed[0].h3_res7 = own;
    const r = await run(site({ listed }), manifest);
    expect(r[EMPTY].pass).toBe(false);
    expect(r[EMPTY].count).toBe(1);
    expect(r[EMPTY].reasons).toContain(`stock-in-empty-node:${listed[0].id}`);
  });

  test('a neighbour’s stock event in a border cell they share does not count against it', async () => {
    const { manifest, listed } = fullDay();
    const shared = node(EMPTY).cells.find((c) => node(A).cells.includes(c));
    expect(shared).toBeDefined();
    const mine = listed.find((e) => e.id.includes(A));
    mine.h3_res7 = shared;
    const r = await run(site({ listed }), manifest);
    expect(r[EMPTY].pass).toBe(true);
    expect(r[EMPTY].count).toBe(0);
    expect(r[EMPTY].totalListed).toBe(1);
    expect(r[A].pass).toBe(true);
  });

  test('fails when the manifest assigns it a stock event', async () => {
    const { manifest, listed } = fullDay();
    manifest.items.push({ kind: 'event', id: 'evt_stray', node: EMPTY });
    const r = await run(site({ listed }), manifest);
    expect(r[EMPTY].pass).toBe(false);
    expect(r[EMPTY].reasons).toContain('unexpected-stock:evt_stray');
  });

  test('hand-made events in its cells never fail it', async () => {
    const { manifest, listed } = fullDay();
    for (const c of node(EMPTY).cells) {
      listed.push({ id: `hand_${c}`, h3_res7: c, start_date: DAY_AFTER });
    }
    const r = await run(site({ listed }), manifest);
    expect(r[EMPTY].pass).toBe(true);
    expect(r[EMPTY].totalListed).toBe(node(EMPTY).cells.length);
  });

  test('an unreadable events list fails it too', async () => {
    const { manifest, listed } = fullDay();
    const r = await run(site({ listed, listFails: true }), manifest);
    expect(r[EMPTY].pass).toBe(false);
    expect(r[EMPTY].reasons).toEqual(['events-list-unreadable']);
  });
});

describe('checkNodes: anchor, zip, QR, pages and art', () => {
  test('a node with no premium sponsor fails with no-anchor', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE }, { premium: false });
    const r = await run(site({ listed }), manifest);
    expect(r[A].pass).toBe(false);
    expect(r[A].reasons).toEqual(['no-anchor']);
  });

  test('the zip view must lead with the area, before the doors', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const zip = node(A).zips[0];
    const r = await run(
      site({ listed, override: { [`/?zip=${zip}`]: html(DOORS_FIRST) } }),
      manifest
    );
    expect(r[A].pass).toBe(false);
    expect(r[A].reasons).toEqual([`zip-not-map-first:${zip}`]);
  });

  test('an sPath answering 200 fails', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const s = site({ listed, override: { [manifest.qr[0].sPath]: html('') } });
    const r = await run(s, manifest);
    expect(r[A].pass).toBe(false);
    expect(r[A].reasons).toEqual([`shortlink-broken:${manifest.qr[0].eventId}`]);
  });

  test('an sPath redirecting to another event fails', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const s = site({
      listed,
      override: { [manifest.qr[0].sPath]: redirect(`${BASE}/events/other`) },
    });
    const r = await run(s, manifest);
    expect(r[A].reasons).toEqual([`shortlink-broken:${manifest.qr[0].eventId}`]);
  });

  test('a missing sPath (no shortcode) fails with no-shortcode', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    delete manifest.qr[0].sPath;
    const r = await run(site({ listed }), manifest);
    expect(r[A].pass).toBe(false);
    expect(r[A].reasons).toEqual([`no-shortcode:${manifest.qr[0].eventId}`]);
  });

  test('a qPath sent home (an unknown token) fails', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const s = site({ listed, override: { [manifest.qr[0].qPath]: redirect('/') } });
    const r = await run(s, manifest);
    expect(r[A].reasons).toEqual([`qr-broken:${manifest.qr[0].eventId}`]);
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
        const { manifest, listed } = day({ [A]: PER_NODE });
        manifest.qr[0][field] = bad;
        const s = site({ listed });
        const r = await run(s, manifest);
        expect(r[A].reasons, bad).toEqual([`bad-path:${manifest.qr[0].eventId}`]);
        const leaked = s.calls.filter(
          (c) => c.via === 'public' && !String(c.url).startsWith(`${BASE}/`)
        );
        expect(leaked, bad).toEqual([]);
        expect(
          s.calls.some((c) => String(c.url).includes('evil')),
          bad
        ).toBe(false);
        // every other read still happens: exactly one fewer than a clean run
        const clean = day({ [A]: PER_NODE });
        const cs = site({ listed: clean.listed });
        await run(cs, clean.manifest);
        const reads = (x) => x.calls.filter((c) => c.via === 'public').length;
        expect(reads(s), bad).toBe(reads(cs) - 1);
      }
    }
  );

  test('a missing qPath fails with no-qr', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    delete manifest.qr[0].qPath;
    const r = await run(site({ listed }), manifest);
    expect(r[A].reasons).toEqual([`no-qr:${manifest.qr[0].eventId}`]);
  });

  test('an event with no QR entry fails with no-qr', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const dropped = manifest.qr.shift();
    const r = await run(site({ listed }), manifest);
    expect(r[A].reasons).toEqual([`no-qr:${dropped.eventId}`]);
  });

  test('an event page without the sponsor strip fails', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const id = listed[0].id;
    const r = await run(
      site({ listed, override: { [`/events/${id}`]: html('<h1>x</h1>') } }),
      manifest
    );
    expect(r[A].reasons).toEqual([`no-sponsor-strip:${id}`]);
  });

  test('a broken art URL fails; an event with no art does not', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const broken = listed[0];
    delete listed[1].cover_image_url;
    const r = await run(
      site({ listed, override: { [broken.cover_image_url]: status(404) } }),
      manifest
    );
    expect(r[A].reasons).toEqual([`art-broken:${broken.id}`]);
  });

  // Owner 2026-11-10: with art on the day, every stock sponsor shows a picture
  // from the same pool (build-full.mjs giveSponsorsArt).
  describe('sponsor art', () => {
    const pageOf = (listed, body) =>
      Object.fromEntries(listed.map((e) => [`/events/${e.id}`, html(body)]));

    test('a day with art: a strip that shows only names fails, event by event', async () => {
      const { manifest, listed } = day({ [A]: PER_NODE });
      const r = await run(site({ listed, override: pageOf(listed, STRIP_NAMES_ONLY) }), manifest);
      expect(r[A].reasons).toEqual(listed.map((e) => `no-sponsor-art:${e.id}`));
    });

    test('a day with no art: names only is right, and passes', async () => {
      const { manifest, listed } = day({ [A]: PER_NODE });
      for (const e of listed) delete e.cover_image_url;
      const r = await run(site({ listed, override: pageOf(listed, STRIP_NAMES_ONLY) }), manifest);
      expect(r[A]).toMatchObject({ pass: true, reasons: [] });
    });

    test('a picture that does not load fails every event that shows it', async () => {
      const { manifest, listed } = day({ [A]: PER_NODE });
      const r = await run(site({ listed, override: { [THUMB]: status(404) } }), manifest);
      expect(r[A].reasons).toEqual(listed.map((e) => `sponsor-art-broken:${e.id}`));
    });

    test('each picture is read once per run, however many pages show it', async () => {
      const { manifest, listed } = day({ [A]: PER_NODE });
      const s = site({ listed });
      const r = await run(s, manifest);
      expect(r[A].pass).toBe(true);
      expect(s.calls.filter((c) => String(c.url) === `${BASE}${THUMB}`)).toHaveLength(1);
    });

    test('a picture on another host is refused, never fetched', async () => {
      const { manifest, listed } = day({ [A]: PER_NODE });
      const off = `<section data-testid="pre-sponsor-strip">${thumbTag('//elsewhere.example/a.png')}</section>`;
      const s = site({ listed, override: pageOf(listed, off) });
      const r = await run(s, manifest);
      expect(r[A].reasons).toEqual(listed.map((e) => `sponsor-art-off-site:${e.id}`));
      expect(s.calls.some((c) => String(c.url).includes('elsewhere'))).toBe(false);
    });

    test('a challenged picture read is named as the edge, not as broken art', async () => {
      const { manifest, listed } = day({ [A]: PER_NODE });
      const r = await run(site({ listed, override: { [THUMB]: challenge } }), manifest);
      expect(r[A].reasons).toEqual(listed.map(() => `edge-challenged:${THUMB} ray=${RAY}`));
    });
  });

  test('art on another host is refused, never fetched', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    listed[0].cover_image_url = 'https://elsewhere.example/a.png';
    const s = site({ listed });
    const r = await run(s, manifest);
    expect(r[A].reasons).toEqual([`art-off-site:${listed[0].id}`]);
    expect(s.calls.some((c) => String(c.url).includes('elsewhere'))).toBe(false);
  });

  // Run 42359815222 (2026-11-07): stg answered /q/, /s/ and /events/<id> with a
  // Cloudflare managed challenge to the check's non-browser reads, and every event
  // was reported as a broken QR, link and page. The edge is named as the edge.
  test('an edge challenge is named as the edge, never as a broken QR, link, page or art', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const ev = listed[0];
    const qr = manifest.qr[0];
    const zip = node(A).zips[0];
    const r = await run(
      site({
        listed,
        override: {
          [`/?zip=${zip}`]: challenge,
          [qr.qPath]: challenge,
          [qr.sPath]: challenge,
          [`/events/${ev.id}`]: challenge,
          [ev.cover_image_url]: challenge,
        },
      }),
      manifest
    );
    expect(r[A].pass).toBe(false);
    expect(r[A].reasons).toEqual([
      `edge-challenged:/?zip=${zip} ray=${RAY}`,
      `edge-challenged:${qr.qPath} ray=${RAY}`,
      `edge-challenged:${qr.sPath} ray=${RAY}`,
      `edge-challenged:/events/${ev.id} ray=${RAY}`,
      `edge-challenged:${ev.cover_image_url} ray=${RAY}`,
    ]);
  });

  // The ray is a header the edge sets; only a ray-shaped value is written into the
  // summary, and a challenge without one is still named.
  test('a challenge without a ray, or with a malformed one, is named without it', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const [a, b] = listed;
    const r = await run(
      site({
        listed,
        override: {
          [`/events/${a.id}`]: challengeWith(null),
          [`/events/${b.id}`]: challengeWith('x|y<script>'),
        },
      }),
      manifest
    );
    expect(r[A].reasons).toEqual([
      `edge-challenged:/events/${a.id}`,
      `edge-challenged:/events/${b.id}`,
    ]);
  });

  test('a public read that throws is a reason, not a crash', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const s = site({ listed });
    const real = s.fetchPublic;
    s.fetchPublic = async (url, init) => {
      if (String(url).endsWith(manifest.qr[0].qPath)) throw new Error('socket hang up');
      return real(url, init);
    };
    const r = await run(s, manifest);
    expect(r[A].reasons).toEqual([`qr-broken:${manifest.qr[0].eventId}`]);
  });

  test('public reads go only to the full site, with no headers and redirect: manual', async () => {
    const { manifest, listed } = day({ [A]: PER_NODE });
    const s = site({ listed });
    await run(s, manifest);
    const pub = s.calls.filter((c) => c.via === 'public');
    expect(pub.length).toBeGreaterThan(0);
    for (const c of pub) {
      expect(String(c.url).startsWith(`${BASE}/`)).toBe(true);
      expect(c.init).toEqual({
        method: 'GET',
        redirect: 'manual',
        signal: expect.any(AbortSignal),
      });
    }
    expect(s.calls.filter((c) => c.via === 'client').map((c) => c.path)).toEqual([
      '/api/v2/events',
    ]);
  });
});

describe('no live count is written in the stock tests', () => {
  // A check result's numbers come from the committed seed and the manifest, never a literal.
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

  test('the check and purge tests pass no literal expected count', () => {
    for (const f of ['check-full.test.js', 'purge-full.test.js']) {
      const text = readFileSync(path.join(__dirname, f), 'utf8');
      expect(text.match(/perNode\s*:/g), f).toBeNull();
      expect(text.match(/expected:\s*\{\s*['"\w-]+\s*:\s*\d/g), f).toBeNull();
    }
  });
});

// Owner 2026-11-07: every zip and town search reads its permanent total on stg.
describe('checkSearches: each /events search reads its total', () => {
  let checkSearches;
  // the owner's totals, never a literal (stock/totals.json)
  const S = readJson('stock/totals.json').searches;
  const AG = S['Auburn Gresham'];
  const ZIP = S['60620'];
  const OL = S['Oak Lawn'];
  const MG = S['Mount Greenwood'];
  beforeAll(async () => {
    ({ checkSearches } = await import('../../../scripts/stock/check-full.mjs'));
  });
  const summary = (n, label) => ({
    status: 200,
    text: async () =>
      `<p class="disc-summary" data-testid="disc-summary">${n} event${n === 1 ? '' : 's'} in ${label}</p>`,
  });
  const run = (pages, searches) => {
    const calls = [];
    return checkSearches({
      searches,
      sleep: async () => {},
      fetchPublic: async (url, init) => {
        calls.push({ url, init });
        const q = new URL(url).searchParams.get('q');
        return pages[q] ?? { status: 404, text: async () => '' };
      },
    }).then((results) => ({ results, calls }));
  };

  test('passes when every search reads its total', async () => {
    const { results } = await run(
      { 'Auburn Gresham': summary(AG, 'Auburn Gresham'), 60620: summary(ZIP, '60620') },
      { 'Auburn Gresham': AG, 60620: ZIP }
    );
    expect(results['Auburn Gresham']).toEqual({ pass: true, count: AG, expected: AG, reasons: [] });
    expect(results['60620'].pass).toBe(true);
  });

  test('fails a town one short of its total (the CI fixture missing): 8 of 9', async () => {
    const { results } = await run(
      { 'Auburn Gresham': summary(AG - 1, 'Auburn Gresham') },
      { 'Auburn Gresham': AG }
    );
    expect(results['Auburn Gresham']).toEqual({
      pass: false,
      count: AG - 1,
      expected: AG,
      reasons: [`count:${AG - 1}/${AG}`],
    });
  });

  test('reads "0 events" and "1 event" alike', async () => {
    const { results } = await run(
      { 'Mount Greenwood': summary(MG, 'Mount Greenwood'), x: summary(1, 'x') },
      { 'Mount Greenwood': MG, x: 1 }
    );
    expect(results['Mount Greenwood'].pass).toBe(true);
    expect(results.x.pass).toBe(true);
  });

  // A failed read answers 200 with a zero summary next to the public error
  // (handlePublicPage): an empty place must not pass on it.
  test('an HTTP-200 error page with a zero summary fails, even where 0 is expected', async () => {
    const errorPage = {
      status: 200,
      text: async () =>
        '<p class="error" data-testid="public-error">Could not load events. Please try again.</p>' +
        '<p class="disc-summary" data-testid="disc-summary">0 events in Mount Greenwood</p>',
    };
    const { results } = await run({ 'Mount Greenwood': errorPage }, { 'Mount Greenwood': MG });
    expect(results['Mount Greenwood']).toEqual({
      pass: false,
      count: null,
      expected: MG,
      reasons: ['events-list-error'],
    });
  });

  test('an edge challenge is named as the edge, never as an unreadable page', async () => {
    const { results } = await run({ 'Oak Lawn': challenge }, { 'Oak Lawn': OL });
    expect(results['Oak Lawn']).toEqual({
      pass: false,
      count: null,
      expected: OL,
      reasons: [`edge-challenged ray=${RAY}`],
    });
  });

  test('a page without its summary line fails as unreadable, never as a count', async () => {
    const { results } = await run({}, { 'Oak Lawn': OL });
    expect(results['Oak Lawn']).toEqual({
      pass: false,
      count: null,
      expected: OL,
      reasons: ['summary-unreadable'],
    });
  });

  test('asks only stg /events with the search encoded, and no redirect', async () => {
    const { calls } = await run({ 'Oak Lawn': summary(OL, 'Oak Lawn') }, { 'Oak Lawn': OL });
    expect(calls).toEqual([
      {
        url: 'https://stg.oursharedevents.com/events?q=Oak%20Lawn',
        init: { method: 'GET', redirect: 'manual', signal: expect.any(AbortSignal) },
      },
    ]);
  });

  test('a search with no expected count is refused', async () => {
    await expect(run({}, { 'Oak Lawn': -1 })).rejects.toThrow('no expected count');
  });
});

// CCR 2026-11-07 group 2 (owner decision 2A): a read the harness could not make
// is "unverified", never a broken page; every read has a deadline; and the
// searches can be judged while yesterday's load is still listed.
describe('check honesty (CCR 2026-11-07, decision 2A)', () => {
  let cf;
  beforeAll(async () => {
    cf = await import('../../../scripts/stock/check-full.mjs');
  });
  const S = readJson('stock/totals.json').searches;
  const OL = S['Oak Lawn'];

  test('a node whose only reasons are edge challenges or a busy database is unverified', () => {
    const r = (reasons) => ({ pass: false, reasons });
    expect(
      cf.isUnverified(r([`edge-challenged:/s/x ray=${RAY}`, 'edge-challenged:/events/e']))
    ).toBe(true);
    expect(cf.isUnverified(r(['d1-busy']))).toBe(true);
    expect(cf.isUnverified(r(['edge-challenged:/s/x', 'count:3/10']))).toBe(false);
    expect(cf.isUnverified(r(['read-timeout:/s/x']))).toBe(false);
    expect(cf.isUnverified(r([]))).toBe(false);
    expect(cf.isUnverified({ pass: true, reasons: [] })).toBe(false);
  });

  test('every public read carries a deadline, and a read that never answers fails its node', async () => {
    const d = day({ [A]: 1 });
    const s = site({ listed: d.listed });
    const signals = [];
    const hanging = async (url, init) => {
      signals.push(init && init.signal);
      return new Promise((resolve, reject) => {
        if (init && init.signal) {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }
      });
    };
    const results = await run({ ...s, fetchPublic: hanging }, d.manifest, {
      expected: { ...EXPECTED, [A]: 1 },
      readTimeoutMs: 5,
    });
    expect(signals.length).toBeGreaterThan(0);
    for (const sig of signals) expect(sig).toBeInstanceOf(AbortSignal);
    expect(results[A].pass).toBe(false);
    expect(results[A].reasons.some((x) => x.startsWith('read-timeout:'))).toBe(true);
  }, 5000);

  test('a search read that never answers fails with read-timeout', async () => {
    const results = await cf.checkSearches({
      searches: { 'Oak Lawn': OL },
      sleep: async () => {},
      readTimeoutMs: 5,
      fetchPublic: (url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    expect(results['Oak Lawn']).toEqual({
      pass: false,
      count: null,
      expected: OL,
      reasons: ['read-timeout'],
    });
  }, 5000);

  const page = (summary, ids) => ({
    status: 200,
    text: async () =>
      `<p class="disc-summary" data-testid="disc-summary">${summary} events in Oak Lawn</p>` +
      ids
        .map((id) => `<article data-testid="public-event-card" data-event-id="${id}"></article>`)
        .join(''),
  });

  test('with yesterday still listed, the search counts only what the swap will leave', async () => {
    const today = Array.from({ length: OL }, (_, i) => `t_${i}`);
    const stale = Array.from({ length: OL }, (_, i) => `y_${i}`);
    const results = await cf.checkSearches({
      searches: { 'Oak Lawn': OL },
      exclude: new Set(stale),
      sleep: async () => {},
      fetchPublic: async () => page(2 * OL, [...today, ...stale]),
    });
    expect(results['Oak Lawn']).toEqual({ pass: true, count: OL, expected: OL, reasons: [] });
  });

  test('an over-count after the exclusion still fails', async () => {
    const ids = Array.from({ length: OL + 1 }, (_, i) => `t_${i}`);
    const results = await cf.checkSearches({
      searches: { 'Oak Lawn': OL },
      exclude: new Set(['y_0']),
      sleep: async () => {},
      fetchPublic: async () => page(OL + 2, [...ids, 'y_0']),
    });
    expect(results['Oak Lawn'].pass).toBe(false);
    expect(results['Oak Lawn'].reasons).toEqual([`count:${OL + 1}/${OL}`]);
  });

  test('when cards and the summary disagree, an excluding search cannot be judged', async () => {
    const results = await cf.checkSearches({
      searches: { 'Oak Lawn': OL },
      exclude: new Set(['y_0']),
      sleep: async () => {},
      fetchPublic: async () => page(OL + 5, ['t_0', 'y_0']),
    });
    expect(results['Oak Lawn'].pass).toBe(false);
    expect(results['Oak Lawn'].reasons).toEqual(['cards-unreadable']);
  });
});
