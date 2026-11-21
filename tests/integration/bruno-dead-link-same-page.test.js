/**
 * The staging check "a malformed and an unknown /s/ code answer the same page"
 * (Bruno pages folder 17, OSE-2164), run here against pages shaped like the
 * ones staging serves.
 *
 * Why it is here. On staging the edge adds a script for its JavaScript check to
 * an HTML page read by a script client, and Bruno is one. That script holds the
 * request's Ray ID, the time and a nonce, so no two reads are equal byte for
 * byte. The check first compared every byte, passed against a local worker and
 * failed on staging (main run 44822179645, T2 Contract (pages)). The same thing
 * happened to the stall check (tests/integration/bruno-stall-not-found-same-page.test.js).
 *
 * This file runs the two requests' own scripts, read from their files, against:
 *   1. two reads that differ only in what the edge adds: the check passes;
 *   2. an unknown-code page that differs from the malformed one in any other
 *      way, down to one character: the check fails.
 *
 * Run: npx vitest run tests/integration/bruno-dead-link-same-page.test.js
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const FOLDER = join(
  __dirname,
  '..',
  '..',
  'bruno',
  'ose-pages',
  '17. Dead Links Say Something (OSE-2164)'
);
const SAME = 'A malformed and an unknown code answer the same bytes (no oracle)';

/** The after-response script of the request whose file name starts with `prefix`. */
function scriptOf(prefix) {
  const name = readdirSync(FOLDER).find((f) => f.startsWith(prefix));
  if (!name) throw new Error(`no request "${prefix}" in folder 17`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a request file of this repo
  const doc = yaml.load(readFileSync(join(FOLDER, name), 'utf8'));
  return doc.runtime.scripts.find((s) => s.type === 'after-response').code;
}

/** Run one request's script the way Bruno does (lenient edge mode). */
function runRequest(prefix, vars, body) {
  const results = [];
  const res = {
    getStatus: () => 404,
    getHeader: () => undefined,
    getBody: () => body,
  };
  const bru = {
    setVar: (k, v) => vars.set(k, v),
    getVar: (k) => vars.get(k),
    getEnvVar: () => undefined,
  };
  const declare = (name, fn) => {
    try {
      fn();
      results.push({ name, error: null });
    } catch (err) {
      results.push({ name, error: String(err?.message ?? err) });
    }
  };
  const fakeRequire = () => ({ isStrict: () => false });
  new Function('res', 'bru', 'test', 'expect', 'require', scriptOf(prefix))(
    res,
    bru,
    declare,
    expect,
    fakeRequire
  );
  return results;
}

/** The malformed request, then the unknown one, sharing variables as one run does. */
function run(malformed, unknown) {
  const vars = new Map();
  runRequest('OSE-2164 - GET s-code (malformed)', vars, malformed);
  return runRequest('OSE-2164 - GET s-code (unknown)', vars, unknown).find((r) => r.name === SAME);
}

/** The Worker's dead-link page (handlers/shortlink-resolve.ts through renderErrorPage). */
const WORKER_404 = `<!DOCTYPE html>
<html lang="en" dir="ltr" data-surface="ose-error">
<head>
  <meta charset="utf-8" />
  <title>This link doesn&#39;t work – OurSharedEvents</title>
  <link rel="stylesheet" href="/ui.css" />
</head>
<body>
  <main data-testid="error-main">
    <p class="error-status" data-testid="error-status">Error 404</p>
    <h1 class="error-title" data-testid="error-title">This link doesn&#39;t work</h1>
    <a class="error-cta" data-testid="error-cta" href="/events">See events near you</a>
  </main>
</body>
</html>`;

/** The edge's JavaScript-check script, in the shape staging serves (values made up). */
const edgeCheck = ({ ray, time, nonce }) =>
  `<script nonce="${nonce}">(function(){function c(){var b=a.contentDocument;if(b){var d=b.createElement('script');d.nonce='${nonce}';d.innerHTML="window.__CF$cv$params={r:'${ray}',t:'${time}'};var u='/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=${ray}';";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');document.body.appendChild(a);c()}})();</script>`;

const served = (page, read) => page.replace('</body>', `${edgeCheck(read)}\n</body>`);

const READ_1 = {
  ray: '1111111111111111',
  time: 'MTExMTExMTExMQ==',
  nonce: 'AAAAAAAAAAAAAAAAAAAAAA==',
};
const READ_2 = {
  ray: '2222222222222222',
  time: 'MjIyMjIyMjIyMg==',
  nonce: 'BBBBBBBBBBBBBBBBBBBBBB==',
};

describe('Bruno pages folder 17: a malformed and an unknown /s/ code answer the same page', () => {
  test('two reads that differ only in what the edge adds: the check passes', () => {
    const r = run(served(WORKER_404, READ_1), served(WORKER_404, READ_2));
    expect(r).toBeDefined();
    expect(r.error).toBeNull();
  });

  test('with no edge in front (a local worker), the check passes too', () => {
    expect(run(WORKER_404, WORKER_404).error).toBeNull();
  });

  const LEAKS = [
    ['other copy', WORKER_404.replace('doesn&#39;t work</h1>', 'was taken down</h1>')],
    [
      'a link the malformed page does not have',
      WORKER_404.replace('</main>', '<a href="/events/e-1">The event</a></main>'),
    ],
    [
      'another place for the button to go',
      WORKER_404.replace('href="/events">', 'href="/events/e-1">'),
    ],
    ['one character', WORKER_404.replace('See events near you', 'See events near you.')],
  ];
  test.each(LEAKS)(
    'an unknown-code page with %s fails the check, behind the edge too',
    (_, leak) => {
      expect(run(served(WORKER_404, READ_1), served(leak, READ_2)).error).not.toBeNull();
      expect(run(WORKER_404, leak).error).not.toBeNull();
    }
  );
});
