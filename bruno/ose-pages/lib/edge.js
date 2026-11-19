// The Cloudflare edge, as a staging page check sees it (OSE-2160, F-51).
//
// The staging edge challenges a non-browser read of some pages (403, with a
// `cf-mitigated` header) before the Worker runs. A request that accepted 403 as
// a pass, "200 or 403 (feature flag)", passed on that challenge page and proved
// nothing about the Worker: a "proof on staging" for a page story could go green
// on Cloudflare's own HTML.
//
// This module is the one place the collection decides what to do about it. Two
// modes, by the environment variable `pagesEdgeStrict` (the repository variable
// PAGES_EDGE_STRICT; `1` is strict, anything else, unset included, is lenient):
//
//   lenient  (the default)  an answer from the edge is named in the log and the
//            requests keep accepting 200 or 403, as before. Nothing goes red that
//            was green. The owner decides when the stg skip rule covers the pages
//            (docs/runbooks/RUNBOOK-STG-CI-SKIP-RULE.md); until then strict would
//            fail on the challenge it exists to find.
//   strict   any answer that carries `cf-mitigated` fails (enforce), and a page
//            request accepts 200 only (pageStatus): a 403 is not a feature flag,
//            it is a page that did not load.
//
// What is never judged: the edge's answer on the paths that are meant to meet it
// (admin and its aliases sit behind Cloudflare Access, /api/ has its own
// contracts, calendar files have their own strict switch, OSE-2022), see
// EDGE_EXPECTED. Those requests say so in their own names ("blocked at edge OR 401").
//
// A phone user agent goes on every request (PHONE_USER_AGENT, set by the
// collection's before-request script): the edge challenges a script client's
// agent string, not a phone's. It is not a way round the edge: the CI header
// the skip rule matches (X-OCR-CI) is unchanged and goes on the base URL only.
//
// One copy: only the pages collection reads this. Bruno loads a module from
// inside the running collection. tests/integration/bruno-edge-hook.test.js runs
// the real collection against a local server that answers like the edge.

const PHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// Paths whose answer may come from the edge by design. A prefix, the way an
// Access destination matches.
const EDGE_EXPECTED = ['/admin', '/manage', '/api/', '/brands/'];

function isStrict(bru) {
  return String(bru.getEnvVar('pagesEdgeStrict')) === '1';
}

function pathOf(url) {
  const u = String(url);
  const i = u.indexOf('/', u.indexOf('://') + 3);
  return i < 0 ? '/' : u.slice(i).split('?')[0];
}

function edgeExpected(url) {
  const p = pathOf(url);
  if (/\.ics$/.test(p)) return true;
  return EDGE_EXPECTED.some(function (x) {
    return p.indexOf(x) === 0;
  });
}

// The `cf-mitigated` value ("challenge", "block"), or '' when the Worker answered.
function mitigation(res) {
  const v = res.getHeader('cf-mitigated');
  return typeof v === 'string' ? v.trim() : '';
}

// Collection after-response: name the edge's answer, and in strict mode fail it.
// Prints the path and the mitigation only: never a header value that is a secret
// (there is none in a response) and never the body.
function enforce(ctx) {
  const m = mitigation(ctx.res);
  if (m === '') return;
  const url = ctx.req.getUrl();
  if (edgeExpected(url)) return;
  const p = pathOf(url)
    .replace(/[^A-Za-z0-9/_.=&%-]/g, '_')
    .slice(0, 120);
  if (isStrict(ctx.bru)) {
    ctx.test(
      'EDGE (strict, OSE-2160): the Worker answered ' + p + ', not a Cloudflare ' + m,
      function () {
        ctx.expect(m).to.eql('');
      }
    );
  } else {
    ctx.console.log(
      '[edge] ' +
        p +
        ' was answered by Cloudflare (' +
        m +
        '), not the Worker; lenient until PAGES_EDGE_STRICT=1'
    );
  }
}

// A page request's status check. Lenient: 200 or 403, under the name the request
// always had (`name`). Strict: 200 only, under a name that says so.
function pageStatus(ctx) {
  if (isStrict(ctx.bru)) {
    ctx.test('Returns 200 (strict, OSE-2160: a 403 is not accepted)', function () {
      ctx.expect(ctx.res.getStatus()).to.equal(200);
    });
  } else {
    ctx.test(ctx.name, function () {
      ctx.expect([200, 403]).to.include(ctx.res.getStatus());
    });
  }
}

module.exports = {
  PHONE_USER_AGENT: PHONE_USER_AGENT,
  EDGE_EXPECTED: EDGE_EXPECTED,
  isStrict: isStrict,
  edgeExpected: edgeExpected,
  mitigation: mitigation,
  enforce: enforce,
  pageStatus: pageStatus,
};
