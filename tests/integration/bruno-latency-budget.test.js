/**
 * OSE-2091: the T2 Bruno latency budget (lib/latency-budget.js in bruno/ose-api and bruno/ose-pages).
 *
 * One over-budget sample on shared staging used to turn T2 red with nothing
 * broken. The budget now retries a safe read once and allows a few slow samples
 * per run, and this file proves it still goes red on a real regression:
 *   - the rules, as a pure function;
 *   - the Bruno glue with a fake `bru` (retry wanted or not, counter kept);
 *   - a real `bru run` of tests/fixtures/bruno-latency against a local server
 *     that delays chosen paths: the injected slow responses must fail.
 * Plus the wiring: both collections call the module with their budgets, and
 * the two copies of the module are identical.
 */
const { readFileSync, mkdtempSync, cpSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = join(__dirname, '..', '..');
const API_LIB = join(ROOT, 'bruno/ose-api/lib/latency-budget.js');
const PAGES_LIB = join(ROOT, 'bruno/ose-pages/lib/latency-budget.js');
const lib = require(API_LIB);

function sample(over) {
  return Object.assign(
    {
      elapsed: 100,
      budget: 1000,
      status: 200,
      method: 'GET',
      slowSoFar: 0,
      resendable: true,
      retry: null,
    },
    over
  );
}

describe('latency budget rules (judge)', () => {
  test('under budget passes and is not a slow sample', () => {
    expect(lib.judge(sample({ elapsed: 999 }))).toMatchObject({ pass: true, slow: false });
  });

  test('over budget with a fast retry of the same status passes as one slow sample', () => {
    const v = lib.judge(sample({ elapsed: 1100, retry: { elapsed: 200, status: 200 } }));
    expect(v).toMatchObject({ pass: true, slow: true });
    expect(v.label).toContain('retry 200ms');
  });

  test('over budget with a slow retry fails: the endpoint is slow, not the sample', () => {
    const v = lib.judge(sample({ elapsed: 1100, retry: { elapsed: 1050, status: 200 } }));
    expect(v.pass).toBe(false);
    expect(v.label).toContain('retry also slow');
  });

  test('at the hard ceiling fails with no allowance, even with a fast retry', () => {
    const at = lib.judge(
      sample({ elapsed: 1000 * lib.HARD_CEILING_FACTOR, retry: { elapsed: 10, status: 200 } })
    );
    expect(at.pass).toBe(false);
    expect(at.label).toContain('hard ceiling');
    expect(
      lib.judge(
        sample({ elapsed: 1000 * lib.HARD_CEILING_FACTOR - 1, retry: { elapsed: 10, status: 200 } })
      ).pass
    ).toBe(true);
  });

  test('a write is never retried and uses the run allowance, then fails', () => {
    const write = { elapsed: 1500, method: 'POST', resendable: false };
    for (let n = 0; n < lib.SLOW_SAMPLES_PER_RUN; n++) {
      expect(lib.judge(sample({ ...write, slowSoFar: n })).pass).toBe(true);
    }
    const over = lib.judge(sample({ ...write, slowSoFar: lib.SLOW_SAMPLES_PER_RUN }));
    expect(over.pass).toBe(false);
    expect(over.label).toContain('not re-sent: a POST');
  });

  test('a retry that answers with another status does not clear the sample, it uses the allowance', () => {
    const v = lib.judge(sample({ elapsed: 1100, retry: { elapsed: 10, status: 503 } }));
    expect(v).toMatchObject({ pass: true, slow: true });
    expect(v.label).toContain('retry unusable: status 503');
    expect(
      lib.judge(
        sample({
          elapsed: 1100,
          slowSoFar: lib.SLOW_SAMPLES_PER_RUN,
          retry: { elapsed: 10, status: 503 },
        })
      ).pass
    ).toBe(false);
  });

  test('fast retries still count: a run of transient slow reads beyond the allowance fails', () => {
    const v = lib.judge(
      sample({
        elapsed: 1100,
        slowSoFar: lib.SLOW_SAMPLES_PER_RUN,
        retry: { elapsed: 10, status: 200 },
      })
    );
    expect(v.pass).toBe(false);
  });

  test('the allowance and the ceiling stay as measured (2 per run, 2x budget)', () => {
    // 15 main runs, ~6,300 samples (2026-11-16): at most one over-budget sample
    // per leg per run, worst 1.01x budget. Loosening either needs new evidence.
    expect(lib.SLOW_SAMPLES_PER_RUN).toBe(2);
    expect(lib.HARD_CEILING_FACTOR).toBe(2);
  });
});

describe('which requests may be re-sent (canResend)', () => {
  test.each([
    ['GET', 'https://stg.oursharedevents.com/api/v2/events?x=1', true],
    ['HEAD', 'https://stg.oursharedevents.com/', true],
    ['GET', 'https://stg.oursharedevents.com/events/abc', true],
    ['GET', 'https://stg.oursharedevents.com/tv/abc', true],
    ['POST', 'https://stg.oursharedevents.com/api/v2/sponsor/requests', false],
    ['PUT', 'https://stg.oursharedevents.com/api/v2/admin/events/x', false],
    ['DELETE', 'https://stg.oursharedevents.com/api/v2/admin/events/x', false],
    ['OPTIONS', 'https://stg.oursharedevents.com/api/v2/events', false],
    ['GET', 'https://stg.oursharedevents.com/q/token123', false],
    ['GET', 'https://stg.oursharedevents.com/s/code', false],
    ['GET', 'https://stg.oursharedevents.com/e/code', false],
    ['GET', 'https://stg.oursharedevents.com/p/code', false],
    ['GET', 'https://stg.oursharedevents.com/r/code', false],
    ['GET', 'https://stg.oursharedevents.com/c/code', false],
    ['GET', 'https://stg.oursharedevents.com/es/e/code', false],
  ])('%s %s -> %s', (method, url, want) => {
    expect(lib.canResend(method, url)).toBe(want);
  });
});

describe('Bruno glue (enforce) with a fake bru', () => {
  function fakeCtx({
    method = 'GET',
    url = 'http://h/x',
    status = 200,
    elapsed,
    budget = 1000,
    retryMs = 0,
    retryStatus = 200,
    vars = {},
  }) {
    const sent = [];
    const tests = [];
    const bru = {
      getVar: (k) => vars[k],
      setVar: (k, v) => {
        vars[k] = v;
      },
      sendRequest: async (cfg, cb) => {
        sent.push(cfg);
        await new Promise((r) => setTimeout(r, retryMs));
        cb(null, { status: retryStatus });
      },
    };
    const req = { getMethod: () => method, getUrl: () => url, getHeaders: () => ({ 'X-A': '1' }) };
    const res = { getStatus: () => status };
    const t = (name, fn) => {
      let ok = true;
      try {
        fn();
      } catch {
        ok = false;
      }
      tests.push({ name, ok });
    };
    const ex = (v) => ({ to: { equal: (w) => expect(v).toBe(w) } });
    return { ctx: { bru, req, res, test: t, expect: ex, elapsed, budget }, sent, tests, vars };
  }

  test('a fast sample sends nothing and records one passing test', async () => {
    const f = fakeCtx({ elapsed: 10 });
    await lib.enforce(f.ctx);
    expect(f.sent).toHaveLength(0);
    expect(f.tests).toEqual([{ name: 'Response time < 1000ms (actual: 10ms)', ok: true }]);
  });

  test('a slow read is re-sent once, with the same method, url and headers', async () => {
    const f = fakeCtx({ elapsed: 1200 });
    await lib.enforce(f.ctx);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ method: 'GET', url: 'http://h/x', headers: { 'X-A': '1' } });
    expect(f.tests[0].ok).toBe(true);
    expect(f.vars[lib.SLOW_SAMPLES_VAR]).toBe(1);
  });

  test('injected slowness on the retry too: red', async () => {
    const f = fakeCtx({ elapsed: 1200, retryMs: 1050 });
    await lib.enforce(f.ctx);
    expect(f.tests[0].ok).toBe(false);
  });

  test('a slow write is not re-sent', async () => {
    const f = fakeCtx({ elapsed: 1200, method: 'POST' });
    await lib.enforce(f.ctx);
    expect(f.sent).toHaveLength(0);
    expect(f.tests[0].ok).toBe(true);
  });

  test('a sample at the hard ceiling is not re-sent and is red', async () => {
    const f = fakeCtx({ elapsed: 2000 });
    await lib.enforce(f.ctx);
    expect(f.sent).toHaveLength(0);
    expect(f.tests[0].ok).toBe(false);
  });

  test('the counter carries across requests: the third slow write in a run is red', async () => {
    const vars = {};
    const oks = [];
    for (let i = 0; i < 3; i++) {
      const f = fakeCtx({ elapsed: 1200, method: 'PUT', vars });
      await lib.enforce(f.ctx);
      oks.push(f.tests[0].ok);
    }
    expect(oks).toEqual([true, true, false]);
  });
});

describe('collection wiring', () => {
  test('the two copies of the module are identical (Bruno loads only from inside a collection)', () => {
    expect(readFileSync(PAGES_LIB, 'utf8')).toBe(readFileSync(API_LIB, 'utf8'));
  });

  test('the API collection enforces 6000 ms, and 9000 ms for the decrypted registrations read', () => {
    const yaml = require('js-yaml');
    const code = yaml
      .load(readFileSync(join(ROOT, 'bruno/ose-api/opencollection.yml'), 'utf8'))
      .request.scripts.find((s) => s.type === 'after-response').code;
    expect(code).toContain("await require('./lib/latency-budget.js').enforce(");
    expect(code).toContain("req.getPath().includes('/forms/registrations')");
    expect(code).toContain('budget: isAdminRegistrationsRead ? 9000 : 6000');
    expect(code).not.toMatch(/to\.be\.below\(/);
  });

  test('the Pages collection enforces 3000 ms', () => {
    const yaml = require('js-yaml');
    const code = yaml
      .load(readFileSync(join(ROOT, 'bruno/ose-pages/opencollection.yml'), 'utf8'))
      .request.scripts.find((s) => s.type === 'after-response').code;
    expect(code).toContain("await require('./lib/latency-budget.js').enforce(");
    expect(code).toContain('budget: 3000');
    expect(code).not.toMatch(/to\.be\.below\(/);
  });
});

// The fixture's budget is 400 ms (hard ceiling 800 ms). The server answers /fast
// at once, /slow/* after 600 ms every time, /slow-once/* after 600 ms the first
// time only, /very-slow/* after 1000 ms, and /q/slow after 600 ms.
describe('born red: a real bru run against injected slow responses', () => {
  let server;
  let port;
  let dir;
  const hits = {};
  let report;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url.split('?')[0];
      hits[`${req.method} ${path}`] = (hits[`${req.method} ${path}`] || 0) + 1;
      let delay = 0;
      if (path.startsWith('/slow/') || path === '/q/slow') delay = 600;
      if (path.startsWith('/very-slow/')) delay = 1000;
      if (path.startsWith('/slow-once/') && hits[`${req.method} ${path}`] === 1) delay = 600;
      req.resume();
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      }, delay);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;

    dir = mkdtempSync(join(tmpdir(), 'bruno-latency-'));
    cpSync(join(ROOT, 'tests/fixtures/bruno-latency'), dir, { recursive: true });
    cpSync(API_LIB, join(dir, 'lib', 'latency-budget.js'), { recursive: true });

    const out = join(dir, 'report.json');
    const bin = join(ROOT, 'node_modules/@usebruno/cli/bin/bru.js');
    const code = await new Promise((resolve) => {
      const p = spawn(
        process.execPath,
        [
          bin,
          'run',
          '.',
          '-r',
          '--env',
          'local',
          '--env-var',
          `baseUrl=http://127.0.0.1:${port}`,
          '--reporter-json',
          out,
        ],
        { cwd: dir, stdio: 'ignore' }
      );
      p.on('exit', resolve);
    });
    report = { code, json: JSON.parse(readFileSync(out, 'utf8')) };
  }, 60_000);

  afterAll(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function latencyTest(requestName) {
    const results = report.json[0]?.results ?? report.json.results;
    const r = results.find((x) => x.test.filename.endsWith(`${requestName}.yml`));
    expect(r, requestName).toBeTruthy();
    expect(r.error ?? null, `${requestName} script error`).toBeNull();
    const t = r.postResponseTestResults.find((x) => x.description.startsWith('Response time <'));
    expect(t, `${requestName} latency test`).toBeTruthy();
    return t;
  }

  test('the run exits non-zero: the injected slowness turned it red', () => {
    expect(report.code).not.toBe(0);
  });

  test('a fast read passes', () => {
    expect(latencyTest('fast read').status).toBe('pass');
  });

  test('one slow read with a fast retry passes, and was sent exactly twice', () => {
    expect(latencyTest('slow once then fast read').status).toBe('pass');
    expect(hits['GET /slow-once/a']).toBe(2);
  });

  test('a read that is slow on retry too fails', () => {
    const t = latencyTest('always slow read');
    expect(t.status).toBe('fail');
    expect(t.description).toContain('retry also slow');
    expect(hits['GET /slow/b']).toBe(2);
  });

  test('a read at the hard ceiling fails and is not re-sent', () => {
    const t = latencyTest('far too slow read');
    expect(t.status).toBe('fail');
    expect(hits['GET /very-slow/c']).toBe(1);
  });

  test('slow writes are never re-sent; two pass, the third in the run fails', () => {
    expect(latencyTest('slow write one').status).toBe('pass');
    expect(latencyTest('slow write two').status).toBe('pass');
    expect(latencyTest('slow write three').status).toBe('fail');
    expect([hits['POST /slow/w1'], hits['POST /slow/w2'], hits['POST /slow/w3']]).toEqual([
      1, 1, 1,
    ]);
  });

  test('a slow counted read (/q/) is not re-sent, so it is not counted twice', () => {
    const t = latencyTest('slow scan');
    expect(t.status).toBe('pass');
    expect(t.description).toContain('not re-sent: a counted read');
    expect(hits['GET /q/slow']).toBe(1);
  });
});
