/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own stock files */
/**
 * CCR 2026-11-07 group 4 (R-13): the stock gates' surviving mutants. Each test
 * here was watched failing on the planted fault named beside it.
 *
 * @born-red stock-gates | method: (1) checkNodes `count !== want` as
 *   `count < want`, (2) checkSearches `count === expected` as `count >= expected`,
 *   (3) MAP_GATE set to 11, (4) edge-probe withDeadline returning fetchFn
 *   unchanged, (5) makeSeed's totals guard removed, (6) trimToTotals keeping one
 *   extra per node — each turned its test red | date: 2026-11-08
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const W = require('./worker-bodies');

const ROOT = path.join(__dirname, '../../..');
const readJson = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const BASE = 'https://stg.oursharedevents.com';
const { nodes } = readJson('stock/nodes.json');
const TOTALS = readJson('stock/totals.json');

let cf;
let ep;
let ms;
let landing;
beforeAll(async () => {
  cf = await import('../../../scripts/stock/check-full.mjs');
  ep = await import('../../../scripts/stock/edge-probe.mjs');
  ms = await import('../../../scripts/stock/make-seed.mjs');
  landing = await import('../../../workers/oursharedevents/src/lib/landing-area.ts');
});

describe('the map gate is the landing’s own', () => {
  test('MAP_GATE equals landing-area.ts LIST_MAX', () => {
    expect(cf.MAP_GATE).toBe(landing.LIST_MAX);
  });
});

describe('over-counts fail, not only under-counts', () => {
  // A node holding one stock event more than the seed says.
  const node = nodes.find((n) => (TOTALS.totals[n.id] || 0) > 0);
  const want = TOTALS.totals[node.id];
  const today = '2026-11-04';

  test('checkNodes: one stock event over the seed fails its node', async () => {
    const ids = Array.from({ length: want + 1 }, (_, i) => `evt_over_${i}`);
    const manifest = {
      date: today,
      items: [
        { kind: 'sponsor', id: 'sp_over', node: node.id, tier: 'premium' },
        ...ids.map((id) => ({ kind: 'event', id, node: node.id })),
      ],
      qr: ids.map((id) => ({
        eventId: id,
        node: node.id,
        qPath: `/q/qrt_${id}`,
        sPath: `/s/SC_${id}`,
      })),
    };
    const listed = ids.map((id) => ({ id, h3_res7: node.cells[0], start_date: '2026-11-05' }));
    const client = { get: async () => W.publicEvents(listed) };
    const ok = (status, extra = {}) => ({
      status,
      headers: { get: (k) => extra[k.toLowerCase()] ?? null },
      text: async () =>
        '<section data-testid="landing-area"></section><section data-testid="pre-sponsor-strip"></section>',
    });
    const fetchPublic = async (url) => {
      const p = new URL(url).pathname;
      const m = p.match(/^\/(?:q\/qrt_|s\/SC_)(.+)$/);
      if (m) return ok(302, { location: `${BASE}/events/${m[1]}` });
      return ok(200);
    };
    const results = await cf.checkNodes({
      client,
      fetchPublic,
      manifest,
      nodes: [node],
      today,
      expected: { [node.id]: want },
      sleep: async () => {},
    });
    expect(results[node.id].pass).toBe(false);
    expect(results[node.id].reasons).toContain(`count:${want + 1}/${want}`);
  });

  test('checkSearches: a search one over its total fails', async () => {
    const [q, total] = Object.entries(TOTALS.searches).find(([, n]) => n > 0);
    const results = await cf.checkSearches({
      searches: { [q]: total },
      sleep: async () => {},
      fetchPublic: async () => ({
        status: 200,
        headers: { get: () => null },
        text: async () =>
          `<p class="disc-summary" data-testid="disc-summary">${total + 1} events in ${q}</p>`,
      }),
    });
    expect(results[q].pass).toBe(false);
    expect(results[q].reasons).toEqual([`count:${total + 1}/${total}`]);
  });
});

describe('the edge probe’s deadline is real', () => {
  test('every read carries an abort signal that fires, so a read that never answers ends', async () => {
    const signals = [];
    // Hangs for good unless its signal aborts: with no deadline the run never ends.
    const fetch = (url, init = {}) => {
      signals.push(init.signal);
      return new Promise((_resolve, reject) => {
        if (init.signal) init.signal.addEventListener('abort', () => reject(init.signal.reason));
      });
    };
    const code = await ep.main(
      { CF_ACCESS_CLIENT_ID: 'x', CF_ACCESS_CLIENT_SECRET: 'y', OCR_CI_EDGE_TOKEN: 'z' },
      { fetch, readTimeoutMs: 10, write: () => {}, appendFile: () => {} }
    );
    expect(code).toBe(1);
    expect(signals.length).toBe(ep.SHAPES.length * ep.PROBE_PATHS.length);
    for (const s of signals) {
      expect(s).toBeInstanceOf(AbortSignal);
      expect(s.aborted).toBe(true);
    }
  }, 5000);
});

describe('make-seed guards', () => {
  test('makeSeed refuses to run without the owner’s totals', async () => {
    await expect(
      ms.makeSeed({
        finds: [],
        businesses: [],
        eventTypeIds: [],
        nodes: [],
        geocode: async () => null,
      })
    ).rejects.toThrow('totals are required');
  });

  test('trimToTotals leaves each node at exactly its total, never above', () => {
    const ev = (node, i) => ({
      node,
      offsetDays: i,
      localStart: '19:00',
      title: `t${i}`,
      event_type_id: `type-${i % 3}`,
    });
    const events = [
      ...Array.from({ length: 7 }, (_, i) => ev('a', i)),
      ...Array.from({ length: 2 }, (_, i) => ev('b', i)),
    ];
    const { kept, dropped } = ms.trimToTotals(events, { a: 4, b: 5 });
    expect(kept.filter((e) => e.node === 'a')).toHaveLength(4);
    expect(kept.filter((e) => e.node === 'b')).toHaveLength(2);
    expect(dropped).toHaveLength(3);
  });

  test('the committed seed holds exactly the owner’s totals per node', () => {
    const seed = readJson('stock/seed/seed.json');
    for (const [node, n] of Object.entries(TOTALS.totals)) {
      expect(
        seed.events.filter((e) => e.node === node),
        node
      ).toHaveLength(n);
    }
  });
});
