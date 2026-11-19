/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own collection and workflow, and a temp folder this test makes */
/**
 * OSE-2160 (F-51): staging Bruno proof cannot go green on a Cloudflare challenge page.
 *
 * Before this, a page request in bruno/ose-pages accepted "200 or 403" (the 403
 * meant to be a feature flag), so the edge's challenge page, a 403 with a
 * `cf-mitigated` header, passed the request and the run was green.
 *
 * This file proves, with the real `bru run` of the real collection against a
 * local server that answers like the edge:
 *   - strict mode (pagesEdgeStrict=1): an edge answer fails the run, by the
 *     collection hook and by the request itself (200 only);
 *   - lenient mode (the default): the same answer still passes, as it did, and
 *     the hook names it in the log;
 *   - a plain Worker answer passes in both, and a Worker 403 (no header) is
 *     still told apart from the edge's;
 *   - every request goes out with a phone user agent;
 *   - no request under bruno/ose-pages accepts `[200, 403]` by itself: they all
 *     go through lib/edge.js, which is where the strict switch lives.
 *
 * Seen red: make enforce() return early, or put `[200, 403]` back in a request,
 * and the cases below fail.
 */
const { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = join(__dirname, '..', '..');
const PAGES = join(ROOT, 'bruno/ose-pages');
const edge = require(join(PAGES, 'lib/edge.js'));
// A page whose request needs only a status and a DOCTYPE, so what is red is the edge.
const REQUEST = '3. MVP Surfaces/GET -poster.yml';
const DOCTYPE_PAGE = '<!DOCTYPE html><html><head><title>t</title></head><body>page</body></html>';

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('wiring: every page request goes through lib/edge.js', () => {
  const requests = walk(PAGES).filter((f) => f.endsWith('.yml'));

  test('no request under bruno/ose-pages accepts [200, 403] by itself', () => {
    const offenders = requests
      .filter((f) => /\[\s*200\s*,\s*403\s*\]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(PAGES.length + 1));
    expect(offenders, 'a 403 is accepted only inside lib/edge.js, under the strict switch').toEqual(
      []
    );
  });

  test('the 26 requests that accepted 403 call pageStatus', () => {
    const calls = requests.filter((f) => readFileSync(f, 'utf8').includes('lib/edge.js'));
    expect(calls.length).toBeGreaterThanOrEqual(26);
  });

  test('the collection runs the hook and sets the phone user agent', () => {
    const yaml = require('js-yaml');
    const scripts = yaml.load(readFileSync(join(PAGES, 'opencollection.yml'), 'utf8')).request
      .scripts;
    const after = scripts.find((s) => s.type === 'after-response').code;
    const before = scripts.find((s) => s.type === 'before-request').code;
    expect(after).toContain("require('./lib/edge.js').enforce(");
    // Written out in the script, so it must equal the module's constant.
    expect(before).toContain(`req.setHeader('User-Agent', '${edge.PHONE_USER_AGENT}')`);
  });

  test('the staging environment declares the switch, empty (lenient)', () => {
    const yaml = require('js-yaml');
    const env = yaml.load(readFileSync(join(PAGES, 'environments/ose-staging.yml'), 'utf8'));
    expect(env.variables).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'pagesEdgeStrict', value: '' })])
    );
  });

  test('the T2 step passes the switch from the repository variable', () => {
    const wf = readFileSync(join(ROOT, '.github/workflows/oursharedevents-ci.yml'), 'utf8');
    expect(wf).toContain('PAGES_EDGE_STRICT: ${{ vars.PAGES_EDGE_STRICT }}');
    expect(wf).toContain('--env-var "pagesEdgeStrict=$PAGES_EDGE_STRICT"');
  });
});

describe('lib/edge.js rules', () => {
  const bru = (strict) => ({ getEnvVar: () => (strict === undefined ? undefined : strict) });

  test('strict only for exactly 1', () => {
    expect(edge.isStrict(bru('1'))).toBe(true);
    for (const v of [undefined, '', '0', 'true', 'yes']) expect(edge.isStrict(bru(v))).toBe(false);
  });

  test('the edge answers admin, /api/, /brands/ and calendar files by design; pages are judged', () => {
    for (const p of [
      '/admin',
      '/manage',
      '/api/v2/events',
      '/brands/root/calendar.ics',
      '/events/e1/calendar.ics',
    ]) {
      expect(edge.edgeExpected(`https://stg.oursharedevents.com${p}?x=1`), p).toBe(true);
    }
    for (const p of ['/', '/events', '/forms/e1?type=register', '/map', '/display', '/poster']) {
      expect(edge.edgeExpected(`https://stg.oursharedevents.com${p}`), p).toBe(false);
    }
  });

  test('enforce: strict fails an edge answer once, lenient only logs, a Worker answer is silent', () => {
    const run = (strict, headers, url = 'https://stg.oursharedevents.com/forms/e1') => {
      const tests = [];
      const logs = [];
      edge.enforce({
        bru: bru(strict),
        req: { getUrl: () => url },
        res: { getHeader: (k) => headers[k.toLowerCase()] },
        test: (name, fn) => {
          try {
            fn();
            tests.push({ name, ok: true });
          } catch {
            tests.push({ name, ok: false });
          }
        },
        expect: (v) => ({
          to: {
            eql: (w) => {
              if (v !== w) throw new Error('x');
            },
          },
        }),
        console: { log: (l) => logs.push(l) },
      });
      return { tests, logs };
    };
    const strict = run('1', { 'cf-mitigated': 'challenge' });
    expect(strict.tests).toHaveLength(1);
    expect(strict.tests[0].ok).toBe(false);
    expect(strict.tests[0].name).toContain('not a Cloudflare challenge');
    const lenient = run('', { 'cf-mitigated': 'challenge' });
    expect(lenient.tests).toEqual([]);
    expect(lenient.logs[0]).toContain('/forms/e1');
    expect(lenient.logs[0]).toContain('challenge');
    expect(run('1', {}).tests).toEqual([]);
    expect(run('1', {}).logs).toEqual([]);
    expect(
      run('1', { 'cf-mitigated': 'challenge' }, 'https://stg.oursharedevents.com/admin').tests
    ).toEqual([]);
  });
});

describe('born red: a real bru run of the pages collection against answers that look like the edge', () => {
  let server;
  let port;
  let mode = 'worker';
  const userAgents = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      userAgents.push(req.headers['user-agent'] ?? '');
      if (mode === 'challenge') {
        // What Cloudflare serves: a 403 HTML challenge, with cf-mitigated.
        res.writeHead(403, { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge' });
        res.end(DOCTYPE_PAGE.replace('page', 'Just a moment...'));
      } else if (mode === 'worker-403') {
        // The Worker's own 403 (a feature flag): JSON, no cf-mitigated.
        res.writeHead(403, { 'Content-Type': 'text/html', 'X-Monetization-Inert': 'true' });
        res.end(DOCTYPE_PAGE);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html', 'X-Monetization-Inert': 'true' });
        res.end(DOCTYPE_PAGE);
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  afterAll(() => server?.close());

  /** Run the one request; return the exit code and what each test said. */
  async function bruRun(runMode, strict) {
    mode = runMode;
    const dir = mkdtempSync(join(tmpdir(), 'bruno-edge-'));
    const out = join(dir, 'report.json');
    try {
      const args = [
        join(ROOT, 'node_modules/@usebruno/cli/bin/bru.js'),
        'run',
        REQUEST,
        '--env',
        'ose-staging',
        '--env-var',
        `baseUrl=http://127.0.0.1:${port}`,
        ...(strict ? ['--env-var', 'pagesEdgeStrict=1'] : []),
        '--reporter-json',
        out,
      ];
      let stdout = '';
      const code = await new Promise((resolve) => {
        const p = spawn(process.execPath, args, { cwd: PAGES, stdio: ['ignore', 'pipe', 'pipe'] });
        p.stdout.on('data', (d) => (stdout += d));
        p.stderr.on('data', (d) => (stdout += d));
        p.on('exit', resolve);
      });
      const json = JSON.parse(readFileSync(out, 'utf8'));
      const results = json[0]?.results ?? json.results;
      const tests = results.flatMap((r) => r.postResponseTestResults ?? []);
      return { code, tests, stdout };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const failed = (r) => r.tests.filter((t) => t.status === 'fail').map((t) => t.description);

  test('strict: an edge challenge page turns the run red, by the hook and by the status check', async () => {
    const r = await bruRun('challenge', true);
    expect(r.code).not.toBe(0);
    const f = failed(r);
    expect(f.some((d) => d.startsWith('EDGE (strict, OSE-2160)'))).toBe(true);
    expect(f).toContain('Returns 200 (strict, OSE-2160: a 403 is not accepted)');
  }, 60_000);

  test('lenient (the default): the same challenge page still passes, and the log names it', async () => {
    const r = await bruRun('challenge', false);
    expect(r.code).toBe(0);
    expect(failed(r)).toEqual([]);
    expect(r.stdout).toContain('was answered by Cloudflare (challenge), not the Worker');
  }, 60_000);

  test('a Worker 200 passes in both modes', async () => {
    for (const strict of [false, true]) {
      const r = await bruRun('worker', strict);
      expect(r.code, `strict=${strict}`).toBe(0);
      expect(failed(r)).toEqual([]);
    }
  }, 120_000);

  test('a Worker 403 (no cf-mitigated) is told apart: lenient passes, strict fails the status only', async () => {
    const lenient = await bruRun('worker-403', false);
    expect(lenient.code).toBe(0);
    const strict = await bruRun('worker-403', true);
    expect(strict.code).not.toBe(0);
    const f = failed(strict);
    expect(f).toContain('Returns 200 (strict, OSE-2160: a 403 is not accepted)');
    expect(f.some((d) => d.startsWith('EDGE (strict'))).toBe(false);
  }, 120_000);

  test('every request carries the phone user agent', () => {
    expect(userAgents.length).toBeGreaterThan(0);
    for (const ua of userAgents) expect(ua).toBe(edge.PHONE_USER_AGENT);
    expect(edge.PHONE_USER_AGENT).toMatch(/iPhone.*Mobile/);
  });
});
