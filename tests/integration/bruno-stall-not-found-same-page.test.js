/**
 * The staging check "a closed stall answers the same page as an unknown stall"
 * (Bruno folder 19, requests 185 to 187), run here against pages shaped like
 * the ones staging serves.
 *
 * Why it is here. On staging the edge adds a script to an HTML page for any
 * client that has not passed its JavaScript check, and Bruno never has. That
 * script holds the request's Ray ID (twice), the time and the page's nonce, so
 * no two reads of one address are equal byte for byte. The check first compared
 * every byte but the nonce attribute. It passed against a local worker, where
 * there is no edge, and failed on staging (main run 43662968814). Nothing in
 * T0 put an edge in front of the check, so T0 could not see it.
 *
 * This file is that edge. It runs the three requests' own scripts, read from
 * their files, against:
 *   1. three reads that differ only in what the edge adds: the check passes;
 *   2. a closed stall whose page differs from the unknown stall's in any other
 *      way, down to one character: the check fails and says where.
 *
 * What the check leaves out, and why that tells a visitor nothing:
 *   - the edge's script, found by `window.__CF$cv$params`. The edge writes it
 *     after the Worker has answered, from the request alone. No stall 404 from
 *     the Worker carries that name (workers/oursharedevents/tests/booth-page.spec.ts).
 *   - the value of each `nonce` attribute: 16 random bytes per response.
 * Everything else must be equal.
 *
 * Run: npx vitest run tests/integration/bruno-stall-not-found-same-page.test.js
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const FOLDER = join(__dirname, '..', '..', 'bruno', 'ose-api', '19. Booths (OSE-1998)');
const SAME_PAGE = 'OSE-1998 page: the same page as an unknown stall';

/** The after-response script of the page request with this `seq`. */
function scriptOf(seq) {
  const name = readdirSync(FOLDER).find((f) => f.startsWith(`OSE-1998 - page - ${seq} `));
  if (!name) throw new Error(`no page request ${seq} in folder 19`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a request file of this repo
  const doc = yaml.load(readFileSync(join(FOLDER, name), 'utf8'));
  expect(doc.info.seq, name).toBe(seq);
  return doc.runtime.scripts.find((s) => s.type === 'after-response').code;
}

/**
 * Run one request's script the way Bruno does: `res`, `bru`, `test` and
 * `expect` in scope. Returns each test it declared, with its error if it failed.
 */
function runRequest(seq, vars, response) {
  const results = [];
  const res = {
    getStatus: () => response.status,
    getHeader: (k) => (response.headers ?? {})[String(k).toLowerCase()],
    getBody: () => response.body,
  };
  const bru = {
    setVar: (k, v) => vars.set(k, v),
    getVar: (k) => vars.get(k),
  };
  const declare = (name, fn) => {
    try {
      fn();
      results.push({ name, error: null });
    } catch (err) {
      results.push({ name, error: String(err?.message ?? err) });
    }
  };
  new Function('res', 'bru', 'test', 'expect', scriptOf(seq))(res, bru, declare, expect);
  return results;
}

/** Requests 185, 186 and 187 in order, sharing variables as one Bruno run does. */
function runFolder(pages) {
  const vars = new Map();
  const html = (body) => ({
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
  });
  return {
    unknown: runRequest(185, vars, html(pages.unknown)),
    outOfUse: runRequest(186, vars, html(pages.outOfUse)),
    draftFair: runRequest(187, vars, html(pages.draftFair)),
  };
}

const samePage = (results) => results.find((r) => r.name === SAME_PAGE);

// ── The pages ────────────────────────────────────────────────────────────────

/** The Worker's stall 404 (handlers/booth-page.ts through renderErrorPage). */
const WORKER_404 = `<!DOCTYPE html>
<html lang="en" data-surface="ose-error">
<head>
  <meta charset="utf-8" />
  <title>We couldn&#39;t find that stall – OurSharedEvents</title>
  <link rel="stylesheet" href="/ui.css" />
</head>
<body>
  <header data-testid="error-header"><a href="/" data-testid="error-brand">OurSharedEvents</a></header>
  <main data-testid="error-main">
    <p class="error-status" data-testid="error-status">Error 404</p>
    <h1 class="error-title" data-testid="error-title">We couldn&#39;t find that stall</h1>
    <p class="error-body" data-testid="error-body">This stall isn&#39;t open to the public. Its fair may not be published yet, or the stall may have closed. See what&#39;s coming up next.</p>
    <a class="error-cta" data-testid="error-cta" href="/events">Browse upcoming events</a>
  </main>
  <footer data-testid="legal-footer"><a href="/events">Browse Events</a> <a href="/privacy">Privacy</a></footer>
</body>
</html>`;

/**
 * The script the edge adds for its JavaScript check, as staging served it on
 * 2026-11-15 (values replaced). Per request: the Ray ID in two places, the
 * time, and the nonce on the tag and twice inside the text.
 */
const edgeCheck = ({ ray, time, nonce }) =>
  `<script nonce="${nonce}">(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement('script');d.nonce='${nonce}';d.innerHTML="window.__CF$cv$params={r:'${ray}',t:'${time}'};var l=window.parent.location,o;try{o=new URL(l.origin).origin}catch(e){o=''}var u='/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=${ray}',a=document.createElement('script');a.nonce='${nonce}';a.src=o?new URL(u,o).href:u;document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.visibility='hidden';document.body.appendChild(a);c()}})();</script>`;

/** The edge's page-view beacon: the same on every read but for the nonce. */
const edgeBeacon = ({ nonce }) =>
  `<script defer src="https://static.cloudflareinsights.com/beacon.min.js/v0" integrity="sha512-0" nonce="${nonce}" data-cf-beacon='{"version":"2024.11.0","token":"00000000000000000000000000000000","spa":2}' crossorigin="anonymous"></script>`;

/** A page as staging serves it to a client that has not passed the check. */
const served = (page, read) =>
  page.replace('</body>', `${edgeCheck(read)}${edgeBeacon(read)}\n</body>`);

// Made-up values in the shapes the edge uses (16 hex, base64 of ten digits, 24
// base64). Repeated characters on purpose: the committed-secret scan in S0 reads
// a random-looking string in a test file as a secret.
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
const READ_3 = {
  ray: '3333333333333333',
  time: 'MzMzMzMzMzMzMw==',
  nonce: 'CCCCCCCCCCCCCCCCCCCCCC==',
};

/** Staging with a closed stall whose page is `outOfUse`, a draft fair's `draftFair`. */
const staging = ({ outOfUse = WORKER_404, draftFair = WORKER_404 } = {}) =>
  runFolder({
    unknown: served(WORKER_404, READ_1),
    outOfUse: served(outOfUse, READ_2),
    draftFair: served(draftFair, READ_3),
  });

// ── The cases ────────────────────────────────────────────────────────────────

describe('Bruno folder 19: a closed stall answers the same page as an unknown stall', () => {
  test('three reads that differ only in what the edge adds: the check passes', () => {
    const run = staging();
    for (const [name, results] of Object.entries(run)) {
      for (const r of results) expect(r.error, `${name}: ${r.name}`).toBeNull();
    }
    // The comparison ran on both closed stalls; it was not skipped.
    expect(samePage(run.outOfUse)).toBeDefined();
    expect(samePage(run.draftFair)).toBeDefined();
  });

  test('with no edge in front (a local worker), the check passes too', () => {
    const run = runFolder({ unknown: WORKER_404, outOfUse: WORKER_404, draftFair: WORKER_404 });
    expect(samePage(run.outOfUse).error).toBeNull();
    expect(samePage(run.draftFair).error).toBeNull();
  });

  // Each of these is a page that would tell a visitor the stall is there.
  const LEAKS = [
    [
      'other copy',
      WORKER_404.replace('the stall may have closed', 'this stall has closed'),
      'this stall has closed',
    ],
    [
      'a link the unknown stall does not have',
      WORKER_404.replace('</main>', '<a href="/events/fair-1">Back to the fair</a></main>'),
      'Back to the fair',
    ],
    [
      'another place for the button to go',
      WORKER_404.replace('href="/events">Browse upcoming', 'href="/events/fair-1">Browse upcoming'),
      '/events/fair-1',
    ],
    ['another title', WORKER_404.replace('<title>We couldn', '<title>Closed: we couldn'), 'Closed'],
    ['another heading', WORKER_404.replace('find that stall</h1>', 'find stall L3</h1>'), 'L3'],
    ['no status line', WORKER_404.replace(/\s*<p class="error-status".*<\/p>/, ''), '<h1'],
    ['a comment', WORKER_404.replace('</main>', '<!-- retired --></main>'), 'retired'],
    [
      'one character',
      WORKER_404.replace('Browse upcoming events', 'Browse upcoming events.'),
      'Browse upcoming events.',
    ],
    [
      'a script of the page’s own',
      WORKER_404.replace('</main>', '</main><script nonce="n">var stall="L3";</script>'),
      'stall=',
    ],
    [
      'an attribute',
      WORKER_404.replace('data-surface="ose-error"', 'data-surface="ose-closed"'),
      'ose-closed',
    ],
  ];

  test.each(LEAKS)(
    'a stall out of use with %s: the check fails and shows it',
    (_label, page, shown) => {
      const run = staging({ outOfUse: page });
      expect(page).not.toBe(WORKER_404);
      expect(samePage(run.outOfUse).error).toContain(shown);
      // The draft fair's page is still the unknown stall's.
      expect(samePage(run.draftFair).error).toBeNull();
    }
  );

  test.each(LEAKS)(
    'a draft fair’s stall with %s: the check fails and shows it',
    (_label, page, shown) => {
      const run = staging({ draftFair: page });
      expect(samePage(run.draftFair).error).toContain(shown);
      expect(samePage(run.outOfUse).error).toBeNull();
    }
  );

  test('a failure names the place and shows both pages there', () => {
    const page = WORKER_404.replace('the stall may have closed', 'this stall has closed');
    const { error } = samePage(staging({ outOfUse: page }).outOfUse);
    expect(error).toMatch(/character \d+/);
    expect(error).toContain('this stall has closed');
    expect(error).toContain('the stall may have closed');
  });

  test('what the edge adds is left out only as a whole script that names its marker', () => {
    // The marker in the page's text, outside a script, is compared like any text.
    const page = WORKER_404.replace('</main>', '<p>window.__CF$cv$params</p></main>');
    expect(samePage(staging({ outOfUse: page }).outOfUse).error).toContain('__CF$cv$params');
    // A second script next to the edge's is compared: the edge's ends at its own closing tag.
    const two = WORKER_404.replace('</body>', '<script nonce="n">var stall="L3";</script></body>');
    expect(samePage(staging({ outOfUse: two }).outOfUse).error).toContain('stall=');
  });

  test('the three requests take the same things out of the page', () => {
    const kept = [185, 186, 187].map(
      (seq) => /var workerPage = function[\s\S]*?\n\};/.exec(scriptOf(seq))?.[0]
    );
    expect(kept[0]).toBeTruthy();
    expect(kept[1]).toBe(kept[0]);
    expect(kept[2]).toBe(kept[0]);
  });

  test('a read the edge challenged is named, and nothing is compared against it', () => {
    const vars = new Map();
    const challenged = { status: 403, headers: { 'cf-mitigated': 'challenge' }, body: '<html>' };
    const first = runRequest(185, vars, challenged);
    expect(first.map((r) => r.name).join()).toContain('EDGE');
    expect(vars.get('boothNotFoundBody')).toBeUndefined();
    const second = runRequest(186, vars, challenged);
    expect(second.map((r) => r.name).join()).toContain('EDGE');
    expect(samePage(second)).toBeUndefined();
  });
});
