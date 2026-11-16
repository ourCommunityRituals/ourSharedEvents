/**
 * OSE-2090: a 5xx in a staging Bruno run keeps what is needed to find it in the
 * Worker's logs: the status, the error `code` and the request id. Before this,
 * run 43802459749 kept only "503 Service Unavailable", so which error it was
 * could not be told.
 *
 * Runs each CI collection's own after-response script with a fake req/res and
 * reads what it prints. It must print one line for a 5xx and nothing otherwise,
 * and never the URL (a signed link is a credential) or the body.
 *
 * Seen red: with the [5xx] block taken out of a collection, or changed to print
 * the body, these tests fail.
 *
 * Run: npx vitest run tests/integration/bruno-5xx-diagnostics.test.js
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** The collections CI runs against staging, read from the T2 matrix. */
function ciCollections() {
  const wf = yaml.load(read('.github/workflows/oursharedevents-ci.yml'));
  return wf.jobs['contract-staging-sub'].strategy.matrix.include.map((m) => m.collection);
}

const RID = '0b4f6c1e-9a7d-4c2b-8e3f-1a2b3c4d5e6f';
const SECRET_URL = 'https://stg.oursharedevents.com/r/sig_SECRET123?token=abc';
const BODY_TEXT = 'Mount Greenwood row 4c4381db';

/** Run a collection's after-response script; return the lines it logged. */
function runAfterResponse(rel, { status, body, headers = {}, method = 'GET', tests = [] }) {
  const script = (yaml.load(read(rel)).request?.scripts ?? []).find(
    (s) => s.type === 'after-response'
  );
  expect(script?.code, rel).toBeTruthy();
  const lines = [];
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = {
    getStatus: () => status,
    getBody: () => body,
    getHeader: (k) => {
      if (lower.throws && /request-id/i.test(k)) throw new TypeError('header read failed');
      return lower[String(k).toLowerCase()];
    },
    getHeaders: () => lower,
    getResponseTime: () => 10,
  };
  const req = {
    getUrl: () => SECRET_URL,
    getPath: () => '/r/sig_SECRET123',
    getMethod: () => method,
    getHeader: () => undefined,
    getName: () => 'a request',
  };
  const bru = { getVar: () => Date.now(), setVar() {}, getEnvVar: () => '' };
  const fakeConsole = { log: (...a) => lines.push(a.join(' ')), warn() {}, error() {} };
  // test() bodies are not run: only what the script itself prints matters here.
  new Function('bru', 'req', 'res', 'test', 'expect', 'console', script.code)(
    bru,
    req,
    res,
    (name) => tests.push(name),
    () => ({}),
    fakeConsole
  );
  return lines;
}

describe('OSE-2090: a 5xx in a staging Bruno run keeps its code and request id', () => {
  const collections = ciCollections();

  test('CI runs the api and pages collections', () => {
    expect(collections).toEqual(expect.arrayContaining(['bruno/ose-api', 'bruno/ose-pages']));
  });

  for (const dir of collections) {
    const rel = `${dir}/opencollection.yml`;

    test(`${dir}: a JSON 503 prints its status, code and request id, once`, () => {
      const lines = runAfterResponse(rel, {
        status: 503,
        body: { ok: false, code: 'DB_ERROR', error: BODY_TEXT, requestId: RID },
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': RID },
      });
      expect(lines).toEqual([`[5xx] GET status=503 code=DB_ERROR requestId=${RID}`]);
    });

    test(`${dir}: the request id comes from the body when the header is missing`, () => {
      const lines = runAfterResponse(rel, {
        status: 500,
        method: 'POST',
        body: { code: 'INTERNAL', requestId: RID },
      });
      expect(lines).toEqual([`[5xx] POST status=500 code=INTERNAL requestId=${RID}`]);
    });

    test(`${dir}: never the URL or the body, and odd values print as '-'`, () => {
      const lines = runAfterResponse(rel, {
        status: 502,
        body: `<html>${BODY_TEXT}</html>`,
        headers: { 'Content-Type': 'text/html', 'X-Request-Id': 'not an id; ' + BODY_TEXT },
      });
      expect(lines).toEqual(['[5xx] GET status=502 code=- requestId=-']);
      const odd = runAfterResponse(rel, {
        status: 503,
        body: { code: `DB_ERROR ${BODY_TEXT}`, requestId: 'undefined value' },
      });
      expect(odd).toEqual(['[5xx] GET status=503 code=- requestId=-']);
      // Only the shapes the Worker makes: a UUID, or req-<digits>. A token is not one.
      const token = runAfterResponse(rel, {
        status: 503,
        body: {},
        headers: { 'X-Request-Id': 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6' },
      });
      expect(token).toEqual(['[5xx] GET status=503 code=- requestId=-']);
      const fallback = runAfterResponse(rel, {
        status: 503,
        body: {},
        headers: { 'X-Request-Id': 'req-1794843930645' },
      });
      expect(fallback).toEqual(['[5xx] GET status=503 code=- requestId=req-1794843930645']);
      for (const l of [...lines, ...odd]) {
        expect(l).not.toMatch(/SECRET|token|Greenwood|4c4381db/);
      }
    });

    test(`${dir}: if the block itself fails, the request keeps its other checks`, () => {
      const tests = [];
      const lines = runAfterResponse(rel, {
        status: 503,
        body: { code: 'DB_ERROR' },
        headers: { 'Content-Type': 'application/json', throws: 'yes' },
        tests,
      });
      expect(lines).toEqual(['[5xx] diagnostics failed: TypeError']);
      expect(
        tests.some((t) => /Response time/.test(t)),
        tests.join(' | ')
      ).toBe(true);
    });

    test(`${dir}: a 2xx, 3xx or 4xx prints nothing`, () => {
      for (const status of [200, 302, 401, 404]) {
        const lines = runAfterResponse(rel, {
          status,
          body: { code: 'NOT_FOUND', requestId: RID },
          headers: { 'X-Request-Id': RID },
        });
        expect(lines, String(status)).toEqual([]);
      }
    });
  }
});
