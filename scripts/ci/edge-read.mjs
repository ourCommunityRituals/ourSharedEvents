// Did a staging read reach the Worker, or did the edge answer it? (OSE-2022)
//
// The Cloudflare edge answers a non-browser read of some stg paths with a managed
// challenge (403, cf-mitigated: challenge) before the Worker runs. A staging test
// that accepts that 403 as a pass proves nothing about the Worker, and nobody sees
// that it proved nothing. This module is what such a test calls:
//
//   edgeHeaders(env)        the X-OCR-CI header the stg skip rule matches, when the
//                           token is set (scripts/ci/cf-waf-stg-ci-skip.mjs)
//   edgeChallenged(s, h)    true for the edge's own answer
//   edgeOwnRequest(u, o)    true for a call the edge's own page scripts make
//   noteEdgeChallenge(...)  counts it where a person looks: a GitHub warning and a
//                           step-summary line. With CALENDAR_EDGE_STRICT=1 it throws,
//                           so the test fails. The caller says whether the read
//                           carried the header (headerSent).
//
// The strict switch is a repository variable the owner sets once the skip rule
// covers the path. Until then a challenge is shown, not hidden and not red.
// Nothing here prints a header value.

import { appendFileSync } from 'node:fs';

/** Headers to add to a stg read so the CI skip rule lets it through. */
export function edgeHeaders(env = process.env) {
  const token = typeof env.OCR_CI_EDGE_TOKEN === 'string' ? env.OCR_CI_EDGE_TOKEN : '';
  return token === '' ? {} : { 'X-OCR-CI': token };
}

/** True when the answer is the edge's challenge, not the Worker's. */
export function edgeChallenged(status, headers) {
  const raw = headers && (headers['cf-mitigated'] ?? headers['CF-Mitigated']);
  return status === 403 && String(raw || '').trim() !== '';
}

// What the edge itself adds to a page it serves, and where those scripts call.
// Cloudflare serves everything under /cdn-cgi/ itself, and no Worker route can
// (developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint). Only the
// two it has been seen to add on stg are listed, so anything new under /cdn-cgi/
// still shows as a request of the page:
//   /cdn-cgi/challenge-platform/…  JavaScript detections, the bot check's page script
//   /cdn-cgi/rum                   the Web Analytics timing beacon
const EDGE_OWN_PATHS = [/^\/cdn-cgi\/challenge-platform\//, /^\/cdn-cgi\/rum\/?$/];

/**
 * True when a request a page made is the edge's own, not the application's: it
 * goes to the site's own origin, at a path the edge serves itself (EDGE_OWN_PATHS).
 * Anything else is not, the same path on another host included. A test that
 * records what a page asks for uses this to set the edge's calls apart by exact
 * path; it never excuses a route the Worker serves. A local Worker has no edge
 * and makes none of these calls.
 */
export function edgeOwnRequest(url, siteOrigin) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.origin === siteOrigin && EDGE_OWN_PATHS.some((p) => p.test(u.pathname));
}

export function edgeStrict(env = process.env) {
  return env.CALENDAR_EDGE_STRICT === '1';
}

// A path is written into a workflow command and a Markdown table, so keep it to
// the characters a path we read can hold.
const safePath = (path) =>
  String(path)
    .replace(/[^A-Za-z0-9/_.?=&%-]/g, '_')
    .slice(0, 200);

// Whether the challenged read carried the header, in words. A set token is not a
// sent header: a browser navigation sends none unless the page was told to
// (passStgEdge, tests/e2e/helpers/stg-edge.ts). So the caller says what was sent,
// and when it does not say, nothing is claimed either way.
function sentWords(env, headerSent) {
  if (headerSent === true) return 'with X-OCR-CI';
  if (!edgeHeaders(env)['X-OCR-CI']) return 'without X-OCR-CI (no token set)';
  if (headerSent === false) return 'without X-OCR-CI (the token is set; this read did not send it)';
  return 'token set; the caller did not say whether this read sent X-OCR-CI';
}

/**
 * Record that the edge challenged `path`. Returns the message. Throws in strict mode.
 * `opts.headerSent`: true when the challenged read carried X-OCR-CI, false when it
 * did not. `opts.write` (stdout) and `opts.appendFile` (the step summary) are for tests.
 */
export function noteEdgeChallenge(path, env = process.env, opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s));
  const append = opts.appendFile || appendFileSync;
  const p = safePath(path);
  const sent = sentWords(env, opts.headerSent);
  // With the header sent, the rule is what to look at. Without it, the read is.
  const remedy =
    opts.headerSent === false
      ? 'The read must send the header before the skip rule can let it through'
      : 'The skip rule must cover the path';
  const message =
    `The stg edge challenged ${p} (${sent}); the Worker did not answer, so this check ` +
    `proved nothing about it. ${remedy}: ` +
    `docs/runbooks/RUNBOOK-STG-CI-SKIP-RULE.md.`;
  write(`::warning title=Edge challenge (OSE-2022)::${message}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    append(
      env.GITHUB_STEP_SUMMARY,
      `- Edge challenge: \`${p}\` did not reach the Worker (${sent}).\n`
    );
  }
  if (edgeStrict(env)) throw new Error(`CALENDAR_EDGE_STRICT=1: ${message}`);
  return message;
}
