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

  // ADR-028: the report says what a calendar app, which sends no header, would see.
  test('reports the calendar addresses as a calendar app reads them, outside the verdict', async () => {
    // The edge challenges the header-less shape only: CI passes, a calendar app does not.
    const blocked = await run(
      { ...ENV, GITHUB_STEP_SUMMARY: 'summary.md' },
      edge({ challenge: ['plain'] }).fetch
    );
    expect(blocked.code).toBe(0);
    const line =
      'Calendar addresses read with no header, as a calendar app reads them: 1 of 2 reached the Worker.';
    expect(blocked.out).toContain(line);
    expect(blocked.summary).toContain(line);
    expect(blocked.out).toContain('RUNBOOK-CALENDAR-EDGE-RULE.md');

    const open = await run(ENV, edge({ challenge: [] }).fetch);
    expect(open.code).toBe(0);
    expect(open.out).toContain('2 of 2 reached the Worker. A calendar app can load them.');
  });

  // OSE-2023: the calendar-edge-rule workflow runs this before and after it writes the rule.
  test('--calendar-app reads only the calendar addresses, with no header and no secret', async () => {
    const blocked = edge({ challenge: ['plain'] });
    const r1 = await (async () => {
      const out = [];
      const summary = [];
      const code = await ep.calendarAppRead(
        { GITHUB_STEP_SUMMARY: 'summary.md' },
        { fetch: blocked.fetch, write: (s) => out.push(s), appendFile: (_f, s) => summary.push(s) }
      );
      return { code, out: out.join(''), summary: summary.join('') };
    })();
    expect(r1.code).toBe(1);
    expect(r1.out).toContain('1 of 2 reached the Worker.');
    expect(r1.summary).toContain('## What a calendar app sees on stg');
    expect(blocked.seen).toHaveLength(2);
    for (const { url, init } of blocked.seen) {
      expect(new URL(url).pathname.endsWith('/calendar.ics')).toBe(true);
      expect(init.headers).toEqual({});
      expect(init.redirect).toBe('manual');
    }

    // Report only: the same blocked read is reported and does not fail.
    const told = [];
    const reported = await ep.calendarAppRead(
      {},
      { fetch: edge({ challenge: ['plain'] }).fetch, write: (s) => told.push(s), reportOnly: true }
    );
    expect(reported).toBe(0);
    expect(told.join('')).toContain('1 of 2 reached the Worker.');

    const open = edge({ challenge: [] });
    const out = [];
    const code = await ep.calendarAppRead({}, { fetch: open.fetch, write: (s) => out.push(s) });
    expect(code).toBe(0);
    expect(out.join('')).toContain('2 of 2 reached the Worker. A calendar app can load them.');
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

/**
 * OSE-2082: the stock workflow's first job. For seven days (2026-11-07 to 11-14)
 * each stock run learned the edge was challenging it only after it had loaded a
 * day, and then purged it. `--preflight` asks first.
 *
 * Born red (each fault injected alone in scripts/stock/edge-probe.mjs, then removed):
 *   P1 preflightVerdict always ok            -> the challenged and unexpected-answer cases fail
 *   P2 the Ray ID left out of the reason     -> "names the path, the Ray ID and the fix" fails
 *   P3 the fix sentence left out             -> the same case fails
 *   P4 the reason not written to the output  -> "hands the reason to the announce job" fails
 *   P5 the preflight reads the plain shape   -> "makes the stock check's own reads" fails
 */
describe('the stock run’s edge check (--preflight)', () => {
  const pre = (env, fetch) => {
    const out = [];
    const files = {};
    return ep
      .preflight(env, {
        fetch,
        write: (s) => out.push(s),
        appendFile: (f, s) => {
          files[f] = (files[f] || '') + s;
        },
      })
      .then((code) => ({ code, out: out.join(''), files }));
  };
  const GH = { ...ENV, GITHUB_STEP_SUMMARY: 'summary.md', GITHUB_OUTPUT: 'output.txt' };
  const CHALLENGE_RAY = 'a5711b195919fa42-SEA';

  test('makes the stock check’s own reads of the pages the check reads, and no other', async () => {
    const { fetch, seen } = edge({ challenge: [] });
    const r = await pre(GH, fetch);
    expect(r.code).toBe(0);
    expect(seen.map((c) => new URL(c.url).pathname + new URL(c.url).search)).toEqual([
      '/q/edge-probe',
      '/s/edge-probe',
      '/events/test-event-001',
      '/?zip=60453',
    ]);
    for (const c of seen) {
      expect(c.init.method).toBe('GET');
      expect(c.init.headers['X-OCR-CI']).toBe(ENV.OCR_CI_EDGE_TOKEN);
      expect(c.init.headers['CF-Access-Client-Id']).toBe(ENV.CF_ACCESS_CLIENT_ID);
    }
  });

  test('green: says the run goes on, and writes no reason', async () => {
    const r = await pre(GH, edge({ challenge: [] }).fetch);
    expect(r.code).toBe(0);
    expect(r.out).toContain('The stock run goes on.');
    expect(r.files['summary.md']).toContain('## Stock data: edge check');
    expect(r.files['output.txt']).toBeUndefined();
  });

  test('a challenged /s/ or /events/ read stops the run: the reason names the path, the Ray ID and the fix', async () => {
    const r = await pre(GH, edge({ challenge: ['check'] }).fetch);
    expect(r.code).toBe(1);
    const reason =
      `Stopped before the seed; nothing on stg was loaded or purged. edge-challenged: /s/edge-probe ray=${CHALLENGE_RAY}, /events/test-event-001 ray=${CHALLENGE_RAY}. ` +
      "Fix: the stg CI skip rule must skip Super Bot Fight Mode on every path. Run scripts/ci/cf-waf-stg-ci-skip.mjs; don't edit the dashboard.";
    expect(r.out).toContain(reason);
    expect(r.files['summary.md']).toContain(reason);
  });

  test('hands the reason to the announce job as the step output `reason`, on one line', async () => {
    const r = await pre(GH, edge({ challenge: ['check'] }).fetch);
    const output = r.files['output.txt'];
    expect(output).toMatch(
      /^reason=Stopped before the seed; .*edge-challenged: \/s\/edge-probe ray=/
    );
    expect(output.trimEnd().split('\n')).toHaveLength(1);
  });

  test('one challenged read is enough', async () => {
    const fetch = (url, init) =>
      new URL(url).pathname.startsWith('/events/')
        ? challenged(CHALLENGE_RAY)
        : edge({ challenge: [] }).fetch(url, init);
    const { ok, bad, reason } = ep.preflightVerdict(
      await Promise.all(
        ep.PREFLIGHT_PATHS.map((p) => ep.probeOne(ep.shapeFetch('check', ENV, fetch), 'check', p))
      )
    );
    expect(ok).toBe(false);
    expect(bad.map((r) => r.path)).toEqual(['/events/test-event-001']);
    expect(reason).toContain(`edge-challenged: /events/test-event-001 ray=${CHALLENGE_RAY}. Fix:`);
  });

  test('an answer that is not the Worker’s stops the run too, and is not called a challenge', async () => {
    const fetch = (url, init) =>
      new URL(url).pathname.startsWith('/s/')
        ? passed(503, RAY)
        : edge({ challenge: [] }).fetch(url, init);
    const r = await pre(GH, fetch);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      `Stopped before the seed; nothing on stg was loaded or purged. not the Worker's answer: /s/edge-probe status 503 ray=${RAY}.`
    );
    expect(r.out).not.toContain('Super Bot Fight Mode');
  });

  test('a read that never answers stops the run', async () => {
    const r = await pre(GH, () => Promise.reject(new TypeError('fetch failed')));
    expect(r.code).toBe(1);
    expect(r.out).toContain("not the Worker's answer: /q/edge-probe no answer");
  });

  test('without the edge token it fails before any read', async () => {
    const { fetch, seen } = edge({ challenge: [] });
    const r = await pre({ ...GH, OCR_CI_EDGE_TOKEN: '' }, fetch);
    expect(r.code).toBe(1);
    expect(seen).toHaveLength(0);
  });

  test('prints no secret, in the log, the summary or the output', async () => {
    const r = await pre(GH, edge({ challenge: ['check'] }).fetch);
    const text = [r.out.replace(/::add-mask::.*\n/g, ''), ...Object.values(r.files)].join('\n');
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });
});
