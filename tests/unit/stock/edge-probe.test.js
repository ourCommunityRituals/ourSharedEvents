const { readFileSync } = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

let ep;
beforeAll(async () => {
  ep = await import('../../../scripts/stock/edge-probe.mjs');
});

const ROOT = path.join(__dirname, '../../..');
const ENV = {
  CF_ACCESS_CLIENT_ID: 'access-id-value-1',
  CF_ACCESS_CLIENT_SECRET: 'access-secret-value-2',
  OCR_CI_EDGE_TOKEN: 'edge-token-value-3',
};
const SECRETS = Object.values(ENV);

const headersOf = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });
const challenged = (ray) =>
  Promise.resolve({
    status: 403,
    headers: headersOf({ 'cf-mitigated': 'challenge', 'cf-ray': ray }),
  });
const passed = (status, ray) => Promise.resolve({ status, headers: headersOf({ 'cf-ray': ray }) });

// An edge that challenges the listed shapes on /s/ and /events/ only.
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
    return passed(p.startsWith('/q/') ? 302 : 200, 'a5711b1a7f66a3a7-SEA');
  };
  return { fetch, seen };
}

function run(env, fetch) {
  const out = [];
  const summary = [];
  return ep
    .main(env, {
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
    expect(r.out).toContain('2 of 4 reads shaped like the stock check were stopped');
    expect(r.out).toContain(
      '| check | `/s/edge-probe` | 403 | CHALLENGED | a5711b195919fa42-SEA |'
    );
    expect(r.out).toContain('| edge-only | `/s/edge-probe` | 200 | no |');
  });

  test('red when a check read never reaches anything', async () => {
    const fetch = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'));
    const r = await run(ENV, fetch);
    expect(r.code).toBe(1);
    expect(r.out).toContain('error: getaddrinfo ENOTFOUND');
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
