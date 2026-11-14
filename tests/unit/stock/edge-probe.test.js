const { readFileSync } = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

let ep;
beforeAll(async () => {
  ep = await import('../../../scripts/stock/edge-probe.mjs');
});

const ROOT = path.join(__dirname, '../../..');
// Built, not literal: stand-ins, kept out of the committed-secret scan's way.
const fake = (n) => ['stand', 'in', n].join('-');
const ENV = {
  CF_ACCESS_CLIENT_ID: fake(1),
  CF_ACCESS_CLIENT_SECRET: fake(2),
  OCR_CI_EDGE_TOKEN: fake(3),
};
const SECRETS = Object.values(ENV);

const headersOf = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });
const challenged = (ray) =>
  Promise.resolve({
    status: 403,
    headers: headersOf({ 'cf-mitigated': 'challenge', 'cf-ray': ray }),
  });
const passed = (status, ray, extra = {}) =>
  Promise.resolve({ status, headers: headersOf({ 'cf-ray': ray, ...extra }) });
const RAY = 'a5711b1a7f66a3a7-SEA';
// The Worker's own answers, as read on stg 2026-11-08: /q/<made-up> goes home,
// /s/<made-up> is a 404, the event page and the zip page are 200. The two
// calendar addresses (OSE-2022) answer 200 here too.
const worker = (pathname) =>
  pathname.startsWith('/q/')
    ? passed(302, RAY, { location: 'https://stg.oursharedevents.com/' })
    : pathname.startsWith('/s/')
      ? passed(404, RAY)
      : passed(200, RAY);

// An edge that challenges the listed shapes on /s/ and /events/ only: the short
// link, the event page and the per-event calendar file (3 of the 6 reads).
function edge({ challenge }) {
  const seen = [];
  const fetch = (url, init) => {
    seen.push({ url, init });
    const h = init.headers || {};
    const shape = h['CF-Access-Client-Id'] ? 'check' : h['X-OCR-CI'] ? 'edge-only' : 'plain';
    const p = new URL(url).pathname;
    if (challenge.includes(shape) && (p.startsWith('/s/') || p.startsWith('/events/'))) {
      return challenged('a5711b195919fa42-SEA');
    }
    return worker(p);
  };
  return { fetch, seen };
}

function run(env, fetch, extra = {}) {
  const out = [];
  const summary = [];
  return ep
    .main(env, {
      ...extra,
      fetch,
      write: (s) => out.push(s),
      appendFile: (_f, s) => summary.push(s),
    })
    .then((code) => ({ code, out: out.join(''), summary: summary.join('') }));
}

describe('stg edge probe', () => {
  test('green when every read shaped like the stock check gets through', async () => {
    const { fetch, seen } = edge({ challenge: ['plain'] });
    const r = await run({ ...ENV, GITHUB_STEP_SUMMARY: 'summary.md' }, fetch);
    expect(r.code).toBe(0);
    expect(r.out).toContain('"Stock data (stg)" can run');
    expect(r.summary).toContain('## stg edge probe');
    expect(seen).toHaveLength(ep.SHAPES.length * ep.PROBE_PATHS.length);
  });

  // Born red: the edge of runs 42394101331..42437943542, which challenged the check's reads.
  test('red, with the Ray IDs, when the edge challenges the check shape', async () => {
    const { fetch } = edge({ challenge: ['check', 'plain'] });
    const r = await run(ENV, fetch);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      '3 of 6 reads shaped like the stock check failed from this runner (3 challenged at the edge'
    );
    expect(r.out).toContain(
      '| check | `/s/edge-probe` | 403 | CHALLENGED | a5711b195919fa42-SEA |'
    );
    expect(r.out).toContain('| edge-only | `/s/edge-probe` | 404 | no |');
    expect(r.out).toContain('| check | `/q/edge-probe` | 302 → home | no |');
  });

  test('red when a check read never reaches anything', async () => {
    const err = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const fetch = () => Promise.reject(err);
    const r = await run(ENV, fetch);
    expect(r.code).toBe(1);
    expect(r.out).toContain('error: TypeError ENOTFOUND');
  });

  // An error status the edge did not mark as a challenge is still a failed read.
  test.each([403, 429, 503])('red on an unchallenged %i to a check read', async (status) => {
    const fetch = (url) => {
      const p = new URL(url).pathname;
      return p.startsWith('/events/') ? passed(status, RAY) : worker(p);
    };
    const r = await run(ENV, fetch);
    expect(r.code).toBe(1);
    expect(r.out).toContain('(0 challenged at the edge, 2 an unexpected answer or none)');
  });

  test('each path passes only on the Worker’s own answer for it', () => {
    const row = (path, status, redirect = '') => ({
      shape: 'check',
      path,
      status,
      redirect,
      challenged: false,
    });
    expect(ep.readOk(row('/q/edge-probe', 302, 'home'))).toBe(true);
    expect(ep.readOk(row('/q/edge-probe', 302, 'this-site'))).toBe(false);
    expect(ep.readOk(row('/q/edge-probe', 301, 'home'))).toBe(false);
    expect(ep.readOk(row('/q/edge-probe', 404))).toBe(false);
    expect(ep.readOk(row('/s/edge-probe', 302, 'home'))).toBe(false);
    expect(ep.readOk(row('/s/edge-probe', 404))).toBe(true);
    expect(ep.readOk(row('/q/edge-probe', 200))).toBe(false);
    expect(ep.readOk(row('/events/test-event-001', 200))).toBe(true);
    expect(ep.readOk(row('/events/test-event-001', 404))).toBe(false);
    expect(ep.readOk(row('/events/test-event-001', 302, 'home'))).toBe(false);
    expect(ep.readOk(row('/?zip=60453', 404))).toBe(false);
    expect(ep.readOk(row('/elsewhere', 200))).toBe(false);
    expect(ep.readOk({ ...row('/s/edge-probe', 404), challenged: true })).toBe(false);
  });

  // A Cloudflare Access login is a redirect off the site: the read never reached the Worker.
  test('red when every read is sent to an Access login', async () => {
    const fetch = () =>
      passed(302, RAY, {
        location:
          'https://mzdano.cloudflareaccess.com/cdn-cgi/access/login/stg.oursharedevents.com',
      });
    const r = await run(ENV, fetch);
    expect(r.code).toBe(1);
    expect(r.out).toContain('6 of 6 reads shaped like the stock check failed');
    expect(r.out).toContain('| check | `/q/edge-probe` | 302 → elsewhere | no |');
    expect(r.out).not.toContain('cloudflareaccess');
  });

  // A fetch error can quote a malformed header value; only a fixed text is reported.
  test('a fetch error that quotes a header value reports none of it', async () => {
    const leak = `Headers.append: "${ENV.CF_ACCESS_CLIENT_SECRET}\r" is an invalid header value.`;
    const fetch = () => Promise.reject(new TypeError(leak));
    const r = await run({ ...ENV, GITHUB_STEP_SUMMARY: 'summary.md' }, fetch);
    expect(r.code).toBe(1);
    const printed = r.out.replace(/^::add-mask::.*\n/gm, '');
    for (const text of [printed, r.summary]) {
      expect(text).not.toContain('stand-in');
      expect(text).not.toContain('Headers.append');
    }
    expect(r.out).toContain('error: TypeError |');
  });

  test('a stalled read becomes an error row within its deadline, and the table still prints', async () => {
    const fetch = (url, init) =>
      new URL(url).pathname.startsWith('/s/')
        ? new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () => reject(init.signal.reason))
          )
        : worker(new URL(url).pathname);
    const started = Date.now();
    const r = await run(ENV, fetch, { readTimeoutMs: 20 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/\| check \| `\/s\/edge-probe` \| none \| no \| error: /);
    expect(r.out).toContain('| check | `/?zip=60453` | 200 | no |');
  });

  test('red, and reads nothing, without the edge token', async () => {
    const { fetch, seen } = edge({ challenge: [] });
    const r = await run({ ...ENV, OCR_CI_EDGE_TOKEN: '' }, fetch);
    expect(r.code).toBe(1);
    expect(seen).toHaveLength(0);
  });

  test('each shape sends exactly its headers, never follows a redirect, stays on stg', async () => {
    const { fetch, seen } = edge({ challenge: [] });
    await run(ENV, fetch);
    const byShape = (n) => seen.slice(n * ep.PROBE_PATHS.length, (n + 1) * ep.PROBE_PATHS.length);
    for (const s of seen) expect(s.init.redirect).toBe('manual');
    for (const s of seen) expect(new URL(s.url).origin).toBe('https://stg.oursharedevents.com');
    expect(byShape(0)[0].init.headers).toEqual({
      'CF-Access-Client-Id': ENV.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': ENV.CF_ACCESS_CLIENT_SECRET,
      'X-OCR-CI': ENV.OCR_CI_EDGE_TOKEN,
    });
    expect(byShape(1)[0].init.headers).toEqual({ 'X-OCR-CI': ENV.OCR_CI_EDGE_TOKEN });
    expect(byShape(2)[0].init.headers).toEqual({});
  });

  test('no secret value is printed or summarized except as a mask command', async () => {
    const { fetch } = edge({ challenge: ['check'] });
    const r = await run({ ...ENV, GITHUB_STEP_SUMMARY: 'summary.md' }, fetch);
    const printed = r.out.replace(/^::add-mask::.*\n/gm, '');
    for (const v of SECRETS) {
      expect(printed).not.toContain(v);
      expect(r.summary).not.toContain(v);
    }
    expect(r.out).toContain(`::add-mask::${ENV.OCR_CI_EDGE_TOKEN}\n`);
  });

  test('a Ray ID that is not ray-shaped is dropped', async () => {
    const fetch = () =>
      Promise.resolve({ status: 200, headers: headersOf({ 'cf-ray': '<b>x</b>' }) });
    const r = await run(ENV, fetch);
    expect(r.out).not.toContain('<b>');
  });
});

describe('stg edge probe workflow', () => {
  const wf = yaml.load(
    readFileSync(path.join(ROOT, '.github/workflows/stg-edge-probe.yml'), 'utf8')
  );

  test('dispatch only, read-only token, and runs this probe', () => {
    expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
    expect(wf.permissions).toEqual({ contents: 'read' });
    const steps = wf.jobs.probe.steps;
    const probe = steps.find((s) => s.name === 'Probe');
    expect(probe.run).toBe('node scripts/stock/edge-probe.mjs');
    expect(Object.keys(probe.env).sort()).toEqual(Object.keys(ENV).sort());
  });

  test('carries no deploy, D1, R2 or admin credential', () => {
    const text = readFileSync(path.join(ROOT, '.github/workflows/stg-edge-probe.yml'), 'utf8');
    expect(text).not.toMatch(/CLOUDFLARE_API_TOKEN|ADMIN_KEY|wrangler/);
  });
});
