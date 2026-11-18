// vitest globals: true (vitest.config.ts).
// Room burst (scripts/ci/room-burst.mjs): fresh browsers from one address at a
// staging poster. The script's report is only worth reading if it never counts
// the edge's answer as the Worker's, never prints a cookie, and never runs
// anywhere but staging. Each case below pins one of those.
//
// Born red (2026-11-18): with classify's cf-mitigated check removed, the edge
// cases fail (a 403 challenge reads as 'other', a 429 block as 'limited_429');
// with the Set-Cookie name cut removed from scanOnce, the scanOnce cookie case fails.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

// Production, from the one shared table (config/production-hosts.js), never spelled here (ADR-021).
const { PRODUCTION_HOSTS } = require('../../../config/production-hosts');

const ROOT = join(__dirname, '..', '..', '..');
let B;
beforeAll(async () => {
  B = await import('../../../scripts/ci/room-burst.mjs');
});

const BASE = 'https://stg.oursharedevents.com';
const TO_EVENT = `${BASE}/events/room-burst-event?type=register&deployment=pd_room_burst`;

describe('classify: whose answer is it', () => {
  test('a 403 challenge with cf-mitigated is the edge, never the Worker', () => {
    expect(B.classify({ status: 403, cfMitigated: 'challenge' })).toBe('edge');
  });

  test('a 429 with cf-mitigated is the edge too, not a Worker 429', () => {
    expect(B.classify({ status: 429, cfMitigated: 'block' })).toBe('edge');
  });

  test('cf-mitigated wins even on a redirect that looks like the Worker', () => {
    expect(
      B.classify({
        status: 302,
        location: TO_EVENT,
        setCookies: ['ose_anon='],
        cfMitigated: 'challenge',
      })
    ).toBe('edge');
  });

  test('a redirect to the event with ose_anon set is a minted cookie', () => {
    expect(B.classify({ status: 302, location: TO_EVENT, setCookies: ['ose_anon='] })).toBe(
      'minted'
    );
  });

  test('a redirect to the event with no ose_anon is a browser the Worker did not count', () => {
    expect(B.classify({ status: 302, location: TO_EVENT, setCookies: [] })).toBe('not_counted');
    expect(B.classify({ status: 302, location: TO_EVENT, setCookies: ['CF_Authorization='] })).toBe(
      'not_counted'
    );
    expect(B.classify({ status: 302, location: TO_EVENT, setCookies: ['ose_anon_other='] })).toBe(
      'not_counted'
    );
  });

  test('a 429 with no cf-mitigated is its own class', () => {
    expect(B.classify({ status: 429 })).toBe('limited_429');
  });

  test('a redirect elsewhere is Access; a redirect home is a missing poster', () => {
    expect(
      B.classify({ status: 302, location: 'https://ocr.cloudflareaccess.com/cdn-cgi/access/login' })
    ).toBe('access');
    expect(B.classify({ status: 302, location: '/' })).toBe('home');
    expect(B.classify({ status: 302, location: `${BASE}/` })).toBe('home');
  });

  test('a redirect to another event is not this one', () => {
    expect(
      B.classify({ status: 302, location: `${BASE}/events/test-event-001?type=register` })
    ).toBe('access');
  });

  test('errors and server failures are other', () => {
    expect(B.classify({ status: 0 })).toBe('other');
    expect(B.classify({ status: 500 })).toBe('other');
    expect(B.classify(undefined)).toBe('other');
  });
});

describe('assertStagingTarget: staging only', () => {
  test('accepts the staging origin', () => {
    expect(B.assertStagingTarget(BASE)).toBe(BASE);
    expect(B.assertStagingTarget(`${BASE}/`)).toBe(BASE);
  });

  test('refuses production by the shared rule', () => {
    expect(PRODUCTION_HOSTS.size).toBeGreaterThan(0);
    for (const host of PRODUCTION_HOSTS) {
      expect(() => B.assertStagingTarget(`https://${host}`)).toThrow(/production/);
    }
  });

  test('refuses any other host, a path, and junk', () => {
    expect(() => B.assertStagingTarget('https://example.com')).toThrow(/staging only/);
    expect(() => B.assertStagingTarget(`${BASE}/q/x`)).toThrow(/staging only/);
    expect(() => B.assertStagingTarget('http://stg.oursharedevents.com')).toThrow(/staging only/);
    expect(() => B.assertStagingTarget('not a url')).toThrow(/not a URL/);
  });
});

describe('parsePlan and sendTimes', () => {
  test('defaults to 150 browsers over 20 s, second scan after 11 s', () => {
    expect(B.parsePlan({})).toEqual({ requests: 150, seconds: 20, retryAfter: 11 });
  });

  test('refuses values outside the bounds', () => {
    expect(() => B.parsePlan({ BURST_REQUESTS: '301' })).toThrow(/BURST_REQUESTS/);
    expect(() => B.parsePlan({ BURST_REQUESTS: '0' })).toThrow(/BURST_REQUESTS/);
    expect(() => B.parsePlan({ BURST_SECONDS: '1.5' })).toThrow(/BURST_SECONDS/);
    expect(() => B.parsePlan({ BURST_RETRY_AFTER_SECONDS: '-1' })).toThrow(/RETRY/);
  });

  test('spreads the burst evenly inside the window', () => {
    const t = B.sendTimes(150, 20);
    expect(t).toHaveLength(150);
    expect(t[0]).toBe(0);
    expect(t[149]).toBeLessThan(20_000);
    expect(t[1] - t[0]).toBe(133);
  });
});

describe('summarize', () => {
  test('counts per class and per 10-second window', () => {
    const times = B.sendTimes(150, 20);
    const results = times.map((atMs, index) => ({
      index,
      atMs,
      kind: index % 75 < 60 ? 'minted' : 'not_counted',
    }));
    const s = B.summarize(results);
    expect(s.sent).toBe(150);
    expect(s.totals.minted).toBe(120);
    expect(s.totals.not_counted).toBe(30);
    expect(s.reachedWorker).toBe(150);
    expect(s.windows.map((w) => [w.window, w.sent, w.minted, w.notCounted])).toEqual([
      [0, 75, 60, 15],
      [1, 75, 60, 15],
    ]);
    expect(s.firstNotCounted).toEqual({ index: 60, atMs: times[60] });
  });

  test('edge answers are never counted as reaching the Worker', () => {
    const s = B.summarize([
      { index: 0, atMs: 0, kind: 'edge' },
      { index: 1, atMs: 10, kind: 'minted' },
    ]);
    expect(s.reachedWorker).toBe(1);
    expect(B.wrongAnswers(s)).toEqual({ edge: 1, access: 0, home: 0, other: 0 });
  });
});

describe('burst: what is sent and what is kept', () => {
  // A stand-in cookie value, marked so a leak is easy to find in a test failure.
  const COOKIE_VALUE = 'anon_5f0c1d2e-LEAK-MARKER';
  const ACCESS_VALUE = 'access-test-value';

  function fakeFetch(seen) {
    return async (url, init) => {
      seen.push({ url, headers: { ...init.headers }, redirect: init.redirect });
      return new Response(null, {
        status: 302,
        headers: [
          ['location', TO_EVENT],
          ['set-cookie', `ose_anon=${COOKIE_VALUE}; HttpOnly; Secure; SameSite=Lax; Path=/`],
        ],
      });
    };
  }

  test('sends fresh browsers: no Cookie header, the CI header, no redirect follow', async () => {
    const seen = [];
    const headers = B.scanHeaders({
      OCR_CI_EDGE_TOKEN: 'ci-token-0123456789abcdef',
      CF_ACCESS_CLIENT_ID: 'id',
      CF_ACCESS_CLIENT_SECRET: ACCESS_VALUE,
    });
    const results = await B.burst({
      base: BASE,
      count: 3,
      seconds: 1,
      headers,
      fetchImpl: fakeFetch(seen),
      sleep: async () => {},
    });
    expect(results.map((r) => r.kind)).toEqual(['minted', 'minted', 'minted']);
    for (const s of seen) {
      expect(s.url).toBe(`${BASE}/q/qrt_room_burst`);
      expect(s.redirect).toBe('manual');
      expect(Object.keys(s.headers).map((k) => k.toLowerCase())).not.toContain('cookie');
      expect(s.headers['X-OCR-CI']).toBe('ci-token-0123456789abcdef');
    }
  });

  test('never keeps or prints a cookie value', async () => {
    const results = await B.burst({
      base: BASE,
      count: 2,
      seconds: 1,
      headers: {},
      fetchImpl: fakeFetch([]),
      sleep: async () => {},
    });
    const s = B.summarize(results);
    const report = B.formatReport({
      plan: { requests: 2, seconds: 1 },
      burst: s,
      retry: null,
      scans: { before: 0, placementRows: 2, returnRows: 2, distinctIds: 2 },
    }).join('\n');
    expect(JSON.stringify(results)).not.toContain('LEAK-MARKER');
    expect(report).not.toContain('LEAK-MARKER');
    expect(report).toContain('| Cookie minted (Worker, counted) | 2 | - |');
  });

  test('scanOnce keeps only the cookie name, never its value', async () => {
    const answer = await B.scanOnce(`${BASE}/q/qrt_room_burst`, {}, fakeFetch([]));
    expect(answer.setCookies).toEqual(['ose_anon=']);
    expect(JSON.stringify(answer)).not.toContain('LEAK-MARKER');
    expect(B.classify(answer)).toBe('minted');
  });

  test('a network error is other, not a minted cookie', async () => {
    const results = await B.burst({
      base: BASE,
      count: 1,
      seconds: 1,
      headers: {},
      fetchImpl: async () => {
        throw new Error('reset');
      },
      sleep: async () => {},
    });
    expect(results[0].kind).toBe('other');
  });
});

describe('countsFromWranglerJson', () => {
  test('reads the first row as numbers', () => {
    expect(B.countsFromWranglerJson('[{"results":[{"n":149,"d":"149"}],"success":true}]')).toEqual({
      n: 149,
      d: 149,
    });
  });

  test('refuses an answer with no row', () => {
    expect(() => B.countsFromWranglerJson('[{"results":[]}]')).toThrow(/no row/);
  });
});

describe('the workflow that runs it', () => {
  const wf = yaml.load(
    readFileSync(join(ROOT, '.github', 'workflows', 'stg-room-burst.yml'), 'utf8')
  );
  const steps = wf.jobs['room-burst'].steps;
  const at = (re) => steps.findIndex((s) => re.test(s.run ?? ''));

  test('runs only when dispatched, so it never slows or loads a main run', () => {
    expect(Object.keys(wf.on ?? wf[true])).toEqual(['workflow_dispatch']);
  });

  test('is one of the stg writers, never cancelled mid-run', () => {
    expect(wf.concurrency.group).toBe('stg-writer');
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
  });

  test('resets, seeds, bursts, then resets again even after a failure', () => {
    const firstReset = at(/room-burst-reset\.sql/);
    const seed = at(/room-burst-seed\.sql/);
    const run = at(/scripts\/ci\/room-burst\.mjs/);
    const lastReset =
      steps.length -
      1 -
      [...steps].reverse().findIndex((s) => /room-burst-reset\.sql/.test(s.run ?? ''));
    expect(firstReset).toBeGreaterThanOrEqual(0);
    expect(firstReset).toBeLessThan(seed);
    expect(seed).toBeLessThan(run);
    expect(lastReset).toBeGreaterThan(run);
    expect(String(steps[lastReset].if)).toMatch(/always\(\)/);
  });

  test('installs the worker dependencies before any wrangler step', () => {
    const install = steps.findIndex(
      (s) =>
        /\bnpm ci\b/.test(s.run ?? '') &&
        /WORKER_DIR|oursharedevents/.test(s['working-directory'] ?? '')
    );
    expect(install).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(at(/room-burst-reset\.sql/));
  });

  test('passes the dispatch inputs through env, never into the script text', () => {
    const runStep = steps[at(/scripts\/ci\/room-burst\.mjs/)];
    expect(runStep.run).not.toMatch(/\$\{\{/);
    expect(runStep.env.BURST_REQUESTS).toMatch(/inputs\.requests/);
    expect(runStep.env.BURST_SECONDS).toMatch(/inputs\.seconds/);
  });
});
