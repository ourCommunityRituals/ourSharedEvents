/**
 * OSE-834 slice 2d — unit tests for the deploy-freshness gate's pure logic.
 *
 * Puts the born-red cases (also the script's `--self-test`) into the CI test
 * pyramid so a regression in the freshness logic is caught by the T0 `tests`
 * shard, not only by the gate's own CI step. The module exports pure functions
 * and is import-safe (its CLI entrypoint is isMain-guarded), so importing here
 * never performs a fetch.
 *
 * Root vitest config runs with `globals: true` and `sourceType: 'script'` for
 * test files, so the ESM module under test is loaded via dynamic import().
 */

let isFresh;
let parseSha;
let readHealth;
let isTransientStatus;
let describeFailure;

beforeAll(async () => {
  ({ isFresh, parseSha, readHealth, isTransientStatus, describeFailure } =
    await import('../../../scripts/assert-deploy-freshness.mjs'));
});

/** A fake fetch that answers each call from `script` in turn (a status or an Error). */
function scriptedFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = script[Math.min(calls.length - 1, script.length - 1)];
    if (next instanceof Error) throw next;
    const {
      status,
      body = { version: 'stg-abc1234-20261114', db: status === 200 ? 'ok' : 'error' },
    } = typeof next === 'number' ? { status: next } : next;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: {
        'content-type': typeof body === 'string' ? 'text/html' : 'application/json',
        'cf-ray': 'ray-1',
      },
    });
  };
  impl.calls = calls;
  return impl;
}

const noSleep = async () => {};

describe('deploy-freshness readHealth — one transient 503 is not a stale build', () => {
  test('a 503 then a 200 reads the 200 on the second try (run 43574886316)', async () => {
    const fetchImpl = scriptedFetch([503, 200]);
    const res = await readHealth('https://stg.example/health', {}, { fetchImpl, sleep: noSleep });
    expect(res.status).toBe(200);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  test('a network error then a 200 reads the 200', async () => {
    const fetchImpl = scriptedFetch([new TypeError('fetch failed'), 200]);
    const res = await readHealth('https://stg.example/health', {}, { fetchImpl, sleep: noSleep });
    expect(res.status).toBe(200);
  });

  test('a 503 on every try still fails closed after the last attempt', async () => {
    const fetchImpl = scriptedFetch([503]);
    const res = await readHealth(
      'https://stg.example/health',
      {},
      { fetchImpl, sleep: noSleep, attempts: 3 }
    );
    expect(res.status).toBe(503);
    expect(fetchImpl.calls).toHaveLength(3);
  });

  test('a network error on every try rethrows after the last attempt', async () => {
    const fetchImpl = scriptedFetch([new TypeError('fetch failed')]);
    await expect(
      readHealth('https://stg.example/health', {}, { fetchImpl, sleep: noSleep, attempts: 2 })
    ).rejects.toThrow('fetch failed');
    expect(fetchImpl.calls).toHaveLength(2);
  });

  test('a 4xx is not retried: it is a configuration fault, not a blip', async () => {
    const fetchImpl = scriptedFetch([403, 200]);
    const res = await readHealth('https://stg.example/health', {}, { fetchImpl, sleep: noSleep });
    expect(res.status).toBe(403);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  test('a 200 is never retried, so a stale version still fails on the first read', async () => {
    const fetchImpl = scriptedFetch([
      { status: 200, body: { version: 'stg-def5678-20261114' } },
      200,
    ]);
    const res = await readHealth('https://stg.example/health', {}, { fetchImpl, sleep: noSleep });
    expect(fetchImpl.calls).toHaveLength(1);
    expect(isFresh((await res.json()).version, 'abc1234')).toBe(false);
  });

  test('waits between tries', async () => {
    const waits = [];
    const fetchImpl = scriptedFetch([503, 503, 200]);
    await readHealth(
      'https://stg.example/health',
      {},
      { fetchImpl, sleep: async (ms) => waits.push(ms) }
    );
    expect(waits.length).toBe(2);
    expect(waits.every((ms) => ms > 0)).toBe(true);
  });

  test('only 502, 503 and 504 count as transient', () => {
    expect([502, 503, 504].every(isTransientStatus)).toBe(true);
    expect([200, 400, 401, 403, 404, 429, 500].some(isTransientStatus)).toBe(false);
  });
});

describe('deploy-freshness describeFailure — the next 503 says where it came from', () => {
  test('a Worker 503 names its db field and the cf-ray', async () => {
    const res = new Response(
      JSON.stringify({ ok: false, db: 'error', version: 'stg-abc1234-20261114', _debug: {} }),
      {
        status: 503,
        headers: { 'content-type': 'application/json', 'cf-ray': 'ray-9' },
      }
    );
    const text = await describeFailure(res);
    expect(text).toContain('db=error');
    expect(text).toContain('cf-ray=ray-9');
    expect(text).not.toContain('_debug');
  });

  test('an edge 503 (not JSON) shows a short, single-line excerpt', async () => {
    const html = '<html>\n<body>error code: 1102</body>\n</html>' + 'x'.repeat(500);
    const res = new Response(html, { status: 503, headers: { 'content-type': 'text/html' } });
    const text = await describeFailure(res);
    expect(text).toContain('error code: 1102');
    expect(text).not.toContain('\n');
    expect(text.length).toBeLessThan(400);
  });
});

describe('OSE-834 2d — deploy-freshness parseSha', () => {
  test('extracts the short sha from a stamped staging version', () => {
    expect(parseSha('stg-abc1234-20260908')).toBe('abc1234');
  });

  test('returns the sha, not the trailing date segment', () => {
    // 20260908 is hex-shaped but comes after the sha → must not win.
    expect(parseSha('stg-abc1234-20260908')).toBe('abc1234');
  });

  test('placeholder / non-sha versions parse to null', () => {
    expect(parseSha('stg-2026.03.22')).toBeNull();
    expect(parseSha('dev-local')).toBeNull();
    expect(parseSha('unknown')).toBeNull();
    expect(parseSha(null)).toBeNull();
    expect(parseSha('')).toBeNull();
  });
});

describe('OSE-834 2d — deploy-freshness isFresh', () => {
  test('fresh when the deployed sha equals the merge sha', () => {
    expect(isFresh('stg-abc1234-20260908', 'abc1234')).toBe(true);
  });

  test('stale when the deployed sha differs from the merge sha (the OSE-834 defect)', () => {
    expect(isFresh('stg-abc1234-20260908', 'def5678')).toBe(false);
  });

  test('a full-length merge sha matches the short deployed sha (prefix, either direction)', () => {
    // Built at runtime (no committed 40-char hex literal — detect-secrets reads
    // one as a secret; OCR-130 lesson). 'abc1234' + 33 chars = a 40-char sha
    // whose short-sha prefix is what the deploy stamp carries.
    expect(isFresh('stg-abc1234-20260908', 'abc1234' + 'a'.repeat(33))).toBe(true);
  });

  test('the date segment is never mistaken for the sha', () => {
    expect(isFresh('stg-abc1234-20260908', '20260908')).toBe(false);
  });

  test('case-insensitive sha comparison', () => {
    expect(isFresh('stg-ABC1234-20260908', 'abc1234')).toBe(true);
  });

  test('fails closed on placeholder / unknown / empty / null', () => {
    expect(isFresh('stg-2026.03.22', 'abc1234')).toBe(false);
    expect(isFresh('unknown', 'abc1234')).toBe(false);
    expect(isFresh('dev-local', 'abc1234')).toBe(false);
    expect(isFresh('stg-abc1234-20260908', '')).toBe(false);
    expect(isFresh(null, 'abc1234')).toBe(false);
    expect(isFresh('stg-abc1234-20260908', undefined)).toBe(false);
  });
});
