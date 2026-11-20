/**
 * The staging check "a malformed and an unknown /s/ code answer the same page"
 * (Bruno pages folder 17, requests 2 and 3), run here against pages shaped like
 * the ones staging serves.
 *
 * Why it is here. On staging the edge adds a script to an HTML page for any
 * client that has not passed its JavaScript check, and Bruno never has. That
 * script holds the request's Ray ID, the time and a nonce, so no two reads of one
 * address are equal byte for byte. The check compared every byte. It passed
 * against a local worker, where there is no edge, and failed on staging (main run
 * 44822179645, head 2849de9). The stall check met the same edge first (main run
 * 43662968814, tests/integration/bruno-stall-not-found-same-page.test.js); this
 * check now takes out the same two things that one does.
 *
 * It runs the two requests' own scripts, read from their files, against:
 *   1. reads that differ only in what the edge adds: the check passes;
 *   2. an unknown code whose page differs from the malformed code's in any other
 *      way, down to one character: the check fails and says where.
 *
 * What the check leaves out, and why that tells a visitor nothing:
 *   - the edge's script, found by `window.__CF$cv$params`. The edge writes it
 *     after the Worker has answered, from the request alone. No /s/ page from the
 *     Worker carries that name (workers/oursharedevents/tests/dead-link-words.spec.ts).
 *   - the value of each `nonce` attribute: random per response.
 * Everything else must be equal.
 *
 * Run: npx vitest run tests/integration/bruno-dead-link-same-page.test.js
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const COLLECTION = join(__dirname, '..', '..', 'bruno', 'ose-pages');
const FOLDER = join(COLLECTION, '17. Dead Links Say Something (OSE-2164)');
const SAME_PAGE = 'A malformed and an unknown code answer the same page (no oracle)';
// The one module the requests load, from the collection as Bruno resolves it.
const edgeModule = require(join(COLLECTION, 'lib', 'edge.js'));

/** The after-response script of the request with this `seq`. */
function scriptOf(seq) {
  const names = readdirSync(FOLDER).filter((f) => f.endsWith('.yml') && f !== 'folder.yml');
  const docs = names.map((name) => ({
    name,
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a request file of this repo
    doc: yaml.load(readFileSync(join(FOLDER, name), 'utf8')),
  }));
  const found = docs.find((d) => d.doc.info.seq === seq);
  if (!found) throw new Error(`no request with seq ${seq} in folder 17`);
  return found.doc.runtime.scripts.find((s) => s.type === 'after-response').code;
}

/**
 * Run one request's script the way Bruno does: `res`, `bru`, `test`, `expect`
 * and `require` in scope. Returns each test it declared, with its error if it failed.
 */
function runRequest(seq, vars, response, strict) {
  const results = [];
  const res = {
    getStatus: () => response.status,
    getHeader: (k) => (response.headers ?? {})[String(k).toLowerCase()],
    getBody: () => response.body,
  };
  const bru = {
    setVar: (k, v) => vars.set(k, v),
    getVar: (k) => vars.get(k),
    getEnvVar: (k) => (k === 'pagesEdgeStrict' && strict ? '1' : undefined),
  };
  const declare = (name, fn) => {
    try {
      fn();
      results.push({ name, error: null });
    } catch (err) {
      results.push({ name, error: String(err?.message ?? err) });
    }
  };
  const load = (p) => {
    if (p === './lib/edge.js') return edgeModule;
    throw new Error(`the script loads ${p}, which this test does not provide`);
  };
  new Function('res', 'bru', 'test', 'expect', 'require', scriptOf(seq))(
    res,
    bru,
    declare,
    expect,
    load
  );
  return results;
}

/** Requests 2 (malformed) then 3 (unknown), sharing variables as one Bruno run does. */
function runPair({ malformed, unknown }, strict = false) {
  const vars = new Map();
  const html = (body) => ({
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
  });
  return {
    malformed: runRequest(2, vars, html(malformed), strict),
    unknown: runRequest(3, vars, html(unknown), strict),
  };
}

const samePage = (results) => results.find((r) => r.name === SAME_PAGE);

// ── The pages ────────────────────────────────────────────────────────────────

/** The Worker's /s/ 404 for a browser (handlers/shortlink-resolve.ts, renderErrorPage). */
const WORKER_404 = `<!DOCTYPE html>
<html lang="en" dir="ltr" data-surface="ose-error">
<head>
  <meta charset="utf-8" />
  <title>This link doesn&#39;t go anywhere – OurSharedEvents</title>
  <link rel="stylesheet" href="/ui.css" />
</head>
<body>
  <header data-testid="error-header"><a href="/" data-testid="error-brand">OurSharedEvents</a></header>
  <main data-testid="error-main">
    <p class="error-status" data-testid="error-status">Error 404</p>
    <h1 class="error-title" data-testid="error-title">This link doesn&#39;t go anywhere</h1>
    <p class="error-body" data-testid="error-body">The link may be mistyped, or the event may have been taken down.</p>
    <a class="error-cta" data-testid="error-cta" href="/events">See events near you</a>
  </main>
  <footer data-testid="legal-footer"><a href="/events">Browse Events</a> <a href="/privacy">Privacy</a></footer>
</body>
</html>`;

/**
 * The script the edge adds for its JavaScript check, in the shape staging served
 * it (values replaced). Per request: the Ray ID in two places, the time, and the
 * nonce on the tag and twice inside the text.
 */
const edgeCheck = ({ ray, time, nonce }) =>
  `<script nonce="${nonce}">(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement('script');d.nonce='${nonce}';d.innerHTML="window.__CF$cv$params={r:'${ray}',t:'${time}'};var l=window.parent.location,o;try{o=new URL(l.origin).origin}catch(e){o=''}var u='/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=${ray}',a=document.createElement('script');a.nonce='${nonce}';a.src=o?new URL(u,o).href:u;document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.visibility='hidden';document.body.appendChild(a);c()}})();</script>`;

/** The edge's page-view beacon: the same on every read but for the nonce. */
const edgeBeacon = ({ nonce }) =>
  `<script defer src="https://static.cloudflareinsights.com/beacon.min.js/v0" integrity="sha512-0" nonce="${nonce}" data-cf-beacon='{"version":"2024.11.0","token":"00000000000000000000000000000000","spa":2}' crossorigin="anonymous"></script>`;

/** A page as staging serves it to a client that has not passed the check. */
const served = (page, read) =>
  page.replace('</body>', `${edgeCheck(read)}${edgeBeacon(read)}\n</body>`);

// Made-up values in the shapes the edge uses. Repeated characters on purpose:
// the committed-secret scan reads a random-looking string in a test as a secret.
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

/** Staging, where the unknown code's Worker page is `unknown`. */
const staging = ({ unknown = WORKER_404 } = {}, strict = false) =>
  runPair({ malformed: served(WORKER_404, READ_1), unknown: served(unknown, READ_2) }, strict);

// ── The cases ────────────────────────────────────────────────────────────────

describe('Bruno pages folder 17: a malformed and an unknown /s/ code answer the same page', () => {
  test('two reads that differ only in what the edge adds: the check passes', () => {
    for (const strict of [false, true]) {
      const run = staging({}, strict);
      for (const [name, results] of Object.entries(run)) {
        for (const r of results) {
          expect(r.error, `${name} (strict ${strict}): ${r.name}`).toBeNull();
        }
      }
      // The comparison ran; it was not skipped.
      expect(samePage(run.unknown), `strict ${strict}`).toBeDefined();
    }
  });

  test('with no edge in front (a local worker), the check passes too', () => {
    const run = runPair({ malformed: WORKER_404, unknown: WORKER_404 });
    expect(samePage(run.unknown).error).toBeNull();
  });

  // Each of these is a page that would tell a prober the code exists in some form.
  const LEAKS = [
    [
      'other copy',
      WORKER_404.replace('may have been taken down', 'was taken down'),
      'was taken down',
    ],
    [
      'a link the malformed code does not have',
      WORKER_404.replace('</main>', '<a href="/events/evt-1">The event</a></main>'),
      'The event',
    ],
    [
      'another place for the button to go',
      WORKER_404.replace('href="/events">See events', 'href="/events/evt-1">See events'),
      '/events/evt-1',
    ],
    // The message quotes each side as JSON, so a quote in the mark is escaped.
    ['another language', WORKER_404.replace('lang="en"', 'lang="es"'), 'lang=\\"es\\"'],
    ['another status line', WORKER_404.replace('Error 404', 'Error 410'), 'Error 410'],
    ['a comment', WORKER_404.replace('</main>', '<!-- known --></main>'), 'known'],
    [
      'one character',
      WORKER_404.replace('See events near you', 'See events near you.'),
      'near you.',
    ],
    [
      'a script of the Worker’s own',
      WORKER_404.replace('</main>', '<script nonce="x">var known=1</script></main>'),
      'var known=1',
    ],
  ];

  test.each(LEAKS)(
    'an unknown code whose page has %s: the check fails and shows where',
    (_label, page, mark) => {
      for (const strict of [false, true]) {
        const result = samePage(staging({ unknown: page }, strict).unknown);
        expect(result, `strict ${strict}`).toBeDefined();
        expect(result.error, `strict ${strict}`).not.toBeNull();
        expect(result.error).toContain(mark);
      }
    }
  );

  test('the check needs the malformed page: with none kept, it fails instead of passing', () => {
    const vars = new Map();
    const results = runRequest(
      3,
      vars,
      { status: 404, headers: { 'content-type': 'text/html' }, body: WORKER_404 },
      false
    );
    expect(samePage(results).error).not.toBeNull();
  });
});
