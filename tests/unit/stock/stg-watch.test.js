/**
 * stg watch (scripts/stock/stg-watch.mjs, .github/workflows/stg-watch.yml).
 *
 * From 2026-11-07 stg held no stock events for days while main stayed green. The
 * watch reads every search in stock/totals.json on stg on its own schedule, so an
 * empty stg is red the same day. Every expected number here is read from
 * stock/totals.json, never written as a literal.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '../../..');
const S = JSON.parse(readFileSync(path.join(ROOT, 'stock/totals.json'), 'utf8')).searches;
const ZIPS = Object.keys(S).filter((k) => /^\d{5}$/.test(k));
const EMPTY_ZIP = ZIPS.find((z) => S[z] === 0);
const FULL_ZIP = ZIPS.find((z) => S[z] > 0);

// Built, not literal: stand-ins, kept out of the committed-secret scan's way.
const fake = (n) => ['stand', 'in', n].join('-');
const ENV = {
  CF_ACCESS_CLIENT_ID: fake(1),
  CF_ACCESS_CLIENT_SECRET: fake(2),
  OCR_CI_EDGE_TOKEN: fake(3),
};

let w;
beforeAll(async () => {
  w = await import('../../../scripts/stock/stg-watch.mjs');
});

const headersOf = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });
const page = (html, status = 200, headers = {}) => ({
  status,
  headers: headersOf(headers),
  text: async () => html,
});
const cards = (n, prefix = 'ev') =>
  Array.from({ length: n }, (_, i) => `<a href="/events/${prefix}-${i}/slug">x</a>`).join('');
const searchPage = (n, q) =>
  page(`<p data-testid="disc-summary">${n} event${n === 1 ? '' : 's'} in ${q}</p>${cards(n, 's')}`);
const zipPage = (zip, n) =>
  page(n === 0 ? `<p>${w.nothingNear(zip)}</p>` : `<section>${cards(n, 'z')}</section>`);

/** stg as it should be, with per-path overrides. */
function site(overrides = {}) {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, init });
    const u = new URL(url);
    const key =
      u.pathname === '/' ? `zip:${u.searchParams.get('zip')}` : `q:${u.searchParams.get('q')}`;
    if (key in overrides) return overrides[key];
    if (key.startsWith('zip:')) {
      const zip = key.slice(4);
      return zipPage(zip, S[zip]);
    }
    const q = key.slice(2);
    return searchPage(S[q], q);
  };
  return { fetch, seen };
}

async function run(fetch) {
  const out = [];
  const summary = [];
  const code = await w.main(
    { ...ENV, GITHUB_STEP_SUMMARY: 'summary.md' },
    {
      fetch,
      sleep: async () => {},
      write: (s) => out.push(s),
      appendFile: (_f, s) => summary.push(s),
    }
  );
  return { code, out: out.join(''), summary: summary.join('') };
}

describe('stg watch: the searches read their permanent totals', () => {
  test('the totals hold a zip expected empty and one expected populated', () => {
    expect(EMPTY_ZIP).toBeDefined();
    expect(FULL_ZIP).toBeDefined();
    expect(w.loadSearches()).toEqual(S);
  });

  test('green when every search and zip page reads its total', async () => {
    const { fetch } = site();
    const r = await run(fetch);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Every stg search reads its permanent total');
    expect(r.summary).toContain('## stg searches');
  });

  test('red when stg is empty: every populated search reads 0 (2026-11-07/08)', async () => {
    const overrides = {};
    for (const q of Object.keys(S)) overrides[`q:${q}`] = searchPage(0, q);
    for (const z of ZIPS) overrides[`zip:${z}`] = zipPage(z, 0);
    const r = await run(site(overrides).fetch);
    expect(r.code).toBe(1);
    const populated = Object.values(S).filter((n) => n > 0).length;
    const populatedZips = ZIPS.filter((z) => S[z] > 0).length;
    expect(r.out).toContain(
      `${populated + populatedZips} of ${Object.keys(S).length + ZIPS.length}`
    );
    const zipRow = r.out.split('\n').find((l) => l.includes(`/?zip=${FULL_ZIP}\``));
    expect(zipRow).toContain('RED: empty');
  });

  test('red when one search is one short of its total', async () => {
    const q = Object.keys(S).find((k) => S[k] > 0);
    const r = await run(site({ [`q:${q}`]: searchPage(S[q] - 1, q) }).fetch);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`count:${S[q] - 1}/${S[q]}`);
  });

  test('red when the empty zip shows events', async () => {
    const r = await run(site({ [`zip:${EMPTY_ZIP}`]: zipPage(EMPTY_ZIP, 2) }).fetch);
    expect(r.code).toBe(1);
    expect(r.out).toContain('not-empty');
  });

  test('red when a populated zip page says "Nothing near"', async () => {
    const r = await run(site({ [`zip:${FULL_ZIP}`]: zipPage(FULL_ZIP, 0) }).fetch);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`empty:"${w.nothingNear(FULL_ZIP)}"`);
  });

  test('red, named as the edge with its Ray ID, when a read is challenged', async () => {
    const challenged = page('Just a moment...', 403, {
      'cf-mitigated': 'challenge',
      'cf-ray': 'a5773321efc2fefc-GRU',
    });
    const r = await run(site({ [`zip:${FULL_ZIP}`]: challenged }).fetch);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`edge-challenged:/?zip=${FULL_ZIP} ray=a5773321efc2fefc-GRU`);
  });

  test('red on an error page or a non-200, never green on an empty answer', async () => {
    const r1 = await run(
      site({ [`zip:${EMPTY_ZIP}`]: page('<div data-testid="public-error"></div>') }).fetch
    );
    expect(r1.code).toBe(1);
    expect(r1.out).toContain('page-error');
    const r2 = await run(site({ [`zip:${EMPTY_ZIP}`]: page('', 500) }).fetch);
    expect(r2.code).toBe(1);
    expect(r2.out).toContain('status:500');
  });

  test('red when a read throws or times out', async () => {
    const { fetch } = site();
    const failing = async (url, init) => {
      if (new URL(url).searchParams.get('zip') === FULL_ZIP) throw new Error('boom');
      return fetch(url, init);
    };
    const r = await run(failing);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`read-error:/?zip=${FULL_ZIP}`);
  });

  test("reads with the stock check's own headers, manual redirects, a deadline, and prints no header value", async () => {
    const { fetch, seen } = site();
    const r = await run(fetch);
    expect(seen.length).toBe(Object.keys(S).length + ZIPS.length);
    for (const { url, init } of seen) {
      expect(new URL(url).origin).toBe('https://stg.oursharedevents.com');
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeDefined();
      expect(init.headers['X-OCR-CI']).toBe(ENV.OCR_CI_EDGE_TOKEN);
    }
    const printed = r.out.replace(/::add-mask::.*\n/g, '') + r.summary;
    for (const v of Object.values(ENV)) expect(printed).not.toContain(v);
  });

  test('a reason holding a backslash and a pipe cannot break its table row', () => {
    const table = w.report({
      searches: { q: { pass: false, count: null, expected: 1, reasons: ['a\\|b'] } },
      zips: {},
    });
    const row = table.split('\n')[2];
    expect(row).toContain('a\\\\\\|b');
    // five unescaped pipes: four cells
    expect(row.match(/(?<!\\)\|/g)).toHaveLength(5);
  });

  test('eventLinks counts distinct events, not links', () => {
    expect(
      w.eventLinks('<a href="/events/a">1</a><a href="/events/a/x">2</a><a href="/events/b">3</a>')
        .size
    ).toBe(2);
  });
});

describe('stg watch workflow', () => {
  const file = path.join(ROOT, '.github/workflows/stg-watch.yml');
  const wf = yaml.load(readFileSync(file, 'utf8'));

  test('runs on a schedule (twice a day) and on dispatch', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(wf.on.schedule.length).toBeGreaterThanOrEqual(1);
  });

  test('the scheduled reads start after the 09:23 UTC stock load', () => {
    for (const { cron } of wf.on.schedule) {
      const [min, hour] = cron.split(' ').map(Number);
      expect(hour * 60 + min).toBeGreaterThan(9 * 60 + 23 + 60);
    }
  });

  test('runs the edge probe and the search watch, each with only the read headers', () => {
    const step = (job, re) => wf.jobs[job].steps.find((s) => re.test(String(s.run || '')));
    expect(step('edge', /edge-probe\.mjs/).run).toBe('node scripts/stock/edge-probe.mjs');
    expect(step('searches', /stg-watch\.mjs/).run).toBe('node scripts/stock/stg-watch.mjs');
    for (const job of ['edge', 'searches']) {
      const s = step(job, /scripts\/stock\//);
      expect(Object.keys(s.env).sort()).toEqual(Object.keys(ENV).sort());
    }
  });

  test('announces after both jobs, red or green, from main only, with issues: write alone', () => {
    const a = wf.jobs.announce;
    expect(a.needs).toEqual(['edge', 'searches']);
    expect(a.if).toMatch(/always\(\)/);
    expect(a.if).toMatch(/github\.ref == 'refs\/heads\/main'/);
    expect(a.permissions).toEqual({ contents: 'read', issues: 'write' });
    const s = a.steps.find((x) => /announce-run\.mjs/.test(String(x.run || '')));
    expect(s.env.ANNOUNCE_KEY).toBe('stg-watch');
    expect(s.env.NEEDS).toBe('${{ toJSON(needs) }}');
  });

  test('the workflow token stays read-only; only announce widens it', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    for (const [name, job] of Object.entries(wf.jobs)) {
      if (name !== 'announce') expect(job.permissions, name).toBeUndefined();
    }
  });

  test('reads only: no deploy, D1, R2 or admin credential, and not in the stg-writer group', () => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/CLOUDFLARE_API_TOKEN|ADMIN_KEY|wrangler/);
    expect(wf.concurrency.group).not.toBe('stg-writer');
  });
});
